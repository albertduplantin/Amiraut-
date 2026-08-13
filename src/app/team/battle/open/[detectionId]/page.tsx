import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { openOrJoinEngagementForDetection } from "@/lib/tacticalEngine";
import { ChooseEngagementMode } from "./ChooseEngagementMode";

/**
 * Point d'entrée du lien « Engager » sur une détection confirmée. Deux cas :
 *
 *   - Navire contre navire (comportement historique, inchangé) : ouvre (ou
 *     rejoint) directement l'engagement tactique complet, sans étape
 *     intermédiaire — le lien reste un simple clic.
 *   - Un avion attaque (bloc combat aérien) : propose le choix hybride
 *     demandé par l'utilisateur entre résolution automatique (un seul jet,
 *     voir resolveAirEncounterAutomatically) et engagement tactique complet.
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
      observerUnit: { select: { name: true, unitClass: { select: { category: true } } } },
      targetUnit: { select: { name: true, status: true, unitClass: { select: { category: true } } } },
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

  return (
    <ChooseEngagementMode
      detectionId={detectionId}
      observerName={detection.observerUnit.name}
      targetName={detection.targetUnit.name}
      // Seul un avion ATTAQUANT (l'observateur de cette détection) peut
      // choisir la résolution automatique — voir resolveAirEncounterAutomatically,
      // qui largue bombes/torpilles ou ouvre le feu air-air depuis l'avion.
      // Un navire qui détecte un avion garde la voie tactique classique.
      canAutoResolve={observerIsAircraft && detection.targetUnit.status !== "SUNK"}
    />
  );
}
