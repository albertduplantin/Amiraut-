import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { openOrJoinEngagementForDetection } from "@/lib/tacticalEngine";
import type { CombatProfile } from "@/lib/combat";
import { ChooseEngagementMode } from "./ChooseEngagementMode";

/**
 * Point d'entrée du lien « Engager » sur une détection confirmée. Deux cas :
 *
 *   - Navire contre navire (inchangé) : ouvre (ou rejoint) directement
 *     l'engagement tactique complet, sans étape intermédiaire — le lien
 *     reste un simple clic.
 *   - Un avion est impliqué, qu'il soit observateur ou cible de cette
 *     détection (bloc combat aérien) : toujours résolution automatique ou
 *     rupture de combat (voir resolveAirEncounterAutomatically/
 *     breakOffAirEncounter) — le combat tactique complet a été abandonné
 *     pour l'aviation (retour utilisateur 2026-08-14). Seul le camp
 *     PROPRIÉTAIRE DE L'AVION peut agir, quel que soit qui a détecté qui
 *     (retour utilisateur du même jour) : l'autre camp voit un avis
 *     passif, sans bouton. Si l'autre camp a déjà résolu la même paire via
 *     sa propre détection (mutuelle la plupart du temps), un écran "déjà
 *     résolu" s'affiche plutôt qu'un double bouton d'action.
 */
export default async function OpenBattlePage({ params }: { params: Promise<{ detectionId: string }> }) {
  const { detectionId } = await params;
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  try {
    assertPlayer(session);
    await assertCanViewDetection(session, detectionId);
  } catch {
    redirect("/team/orders");
  }

  const detection = await prisma.detectionEvent.findUnique({
    where: { id: detectionId },
    include: {
      observerUnit: { select: { id: true, name: true, unitClass: { select: { category: true, maxSpeedKnots: true, combatProfile: true } }, fleet: { select: { teamId: true } } } },
      targetUnit: { select: { id: true, name: true, status: true, unitClass: { select: { category: true, maxSpeedKnots: true, combatProfile: true } }, fleet: { select: { teamId: true } } } },
    },
  });
  if (!detection) redirect("/team/orders");

  const observerIsAircraft = detection.observerUnit.unitClass.category === "AIRCRAFT";
  const targetIsAircraft = detection.targetUnit.unitClass.category === "AIRCRAFT";

  if (!observerIsAircraft && !targetIsAircraft) {
    // Comportement historique : engagement tactique direct, sans étape intermédiaire.
    try {
      await openOrJoinEngagementForDetection(detectionId);
    } catch {
      // Dans tous les cas (succès ou échec), la destination est la même page.
    }
    redirect("/team/orders");
  }

  const myUnit =
    detection.observerUnit.fleet.teamId === session.teamId
      ? detection.observerUnit
      : detection.targetUnit.fleet.teamId === session.teamId
        ? detection.targetUnit
        : null;
  const otherUnit = myUnit === detection.observerUnit ? detection.targetUnit : detection.observerUnit;

  if (!myUnit || myUnit.unitClass.category !== "AIRCRAFT") {
    // Mon camp n'est pas propriétaire de l'avion de cette paire (mon
    // navire l'a détecté en premier, par exemple) : rien à décider ici,
    // c'est à l'autre camp de choisir d'attaquer ou de rompre.
    return (
      <div className="chart-room-bg flex min-h-screen items-center justify-center text-slate-100">
        <div className="mx-4 w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
          <h1 className="font-display text-xl text-brass-300">
            {detection.observerUnit.name} → {detection.targetUnit.name}
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            Un avion adverse a été repéré — à son camp de décider d&apos;attaquer ou de rompre le contact, pas au vôtre.
          </p>
          <a href="/team/orders" className="mt-6 inline-block rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
            Retour aux ordres
          </a>
        </div>
      </div>
    );
  }

  const alreadyResolved = await prisma.combatEvent.findFirst({
    where: {
      turnId: detection.turnId,
      OR: [
        { attackerUnitId: detection.observerUnit.id, targetUnitId: detection.targetUnit.id },
        { attackerUnitId: detection.targetUnit.id, targetUnitId: detection.observerUnit.id },
      ],
    },
  });
  if (alreadyResolved) {
    return (
      <div className="chart-room-bg flex min-h-screen items-center justify-center text-slate-100">
        <div className="mx-4 w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
          <h1 className="font-display text-xl text-brass-300">
            {detection.observerUnit.name} → {detection.targetUnit.name}
          </h1>
          <p className="mt-3 text-sm text-slate-400">Ce contact a déjà été résolu.</p>
          <a href="/team/orders" className="mt-6 inline-block rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
            Retour aux ordres
          </a>
        </div>
      </div>
    );
  }

  // Rupture air-air : n'est possible que si mon avion est au moins aussi
  // rapide que l'adversaire (voir breakOffAirEncounter) — calculé ici pour
  // expliquer clairement pourquoi le bouton est indisponible plutôt que de
  // le cacher sans explication.
  const isAirAir = observerIsAircraft && targetIsAircraft;
  const canBreakOff = !isAirAir || myUnit.unitClass.maxSpeedKnots >= otherUnit.unitClass.maxSpeedKnots;

  // Avion de reconnaissance pure, sans aucun armement (bug corrigé le
  // 2026-08-14, revue utilisateur des cas de rencontre) : en air-mer/
  // air-sous-marin, "Résoudre le contact" n'a rigoureusement rien à faire
  // — l'avion n'a ni bombe, ni torpille, ni mitrailleuse. Un tel avion ne
  // peut qu'observer et rentrer (voir breakOffAirToSurface, qui ne
  // présuppose jamais d'arme et gère déjà très bien ce cas — la DCA
  // adverse garde sa chance). En air-air, pas de restriction : même sans
  // riposter, "Résoudre" reste une action sensée (voir
  // resolveAutoAirToAir, qui gère déjà proprement un avion sans arme).
  const myProfile = myUnit.unitClass.combatProfile as CombatProfile | null;
  const myIsArmed = !!(myProfile?.guns?.length || myProfile?.bombs || myProfile?.torpedoTubes);
  const canResolve = isAirAir || myIsArmed;

  return (
    <ChooseEngagementMode
      detectionId={detectionId}
      observerName={detection.observerUnit.name}
      targetName={detection.targetUnit.name}
      canResolve={canResolve}
      canBreakOff={canBreakOff}
      breakOffDisabledReason={isAirAir && !canBreakOff ? `${myUnit.name} est trop lent pour rompre le combat face à ${otherUnit.name}.` : null}
    />
  );
}
