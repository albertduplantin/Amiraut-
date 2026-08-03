import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { TacticalClient } from "./TacticalClient";

export default async function TacticalPage({ params }: { params: Promise<{ detectionId: string }> }) {
  const { detectionId } = await params;
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  const focusDetection = await prisma.detectionEvent.findUnique({
    where: { id: detectionId },
    include: { observerUnit: { select: { id: true, fleet: { select: { teamId: true } } } } },
  });

  // Seule l'équipe observatrice a accès à cette page : ne pas exposer aux
  // joueurs le fait qu'ils ont eux-mêmes été repérés.
  if (!focusDetection || focusDetection.observerUnit.fleet.teamId !== session.teamId) {
    redirect("/team/orders");
  }

  const [scenario, openTurn, ownUnits, contactDetections] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId, status: { not: "PUBLISHED" } },
      orderBy: { number: "asc" },
      select: { id: true, number: true, durationMinutes: true },
    }),
    // Toutes les unités du joueur : n'importe laquelle peut engager un
    // contact connu (les comptes rendus se partagent par radio).
    prisma.unit.findMany({
      where: {
        scenarioId: session.scenarioId,
        status: { in: ["ACTIVE", "DAMAGED"] },
        fleet: { teamId: session.teamId, ...(session.fleetIds ? { id: { in: session.fleetIds } } : {}) },
      },
      include: { unitClass: true, fleet: { select: { name: true } } },
      orderBy: [{ fleet: { name: "asc" } }, { name: "asc" }],
    }),
    // Tous les contacts confirmés par l'arbitre, vus par ce camp.
    prisma.detectionEvent.findMany({
      where: {
        arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] },
        observerUnit: { fleet: { teamId: session.teamId } },
      },
      include: {
        turn: { select: { number: true } },
        observerUnit: { select: { name: true } },
        targetUnit: {
          select: {
            id: true,
            name: true,
            status: true,
            unitClass: { select: { name: true, category: true, iconKey: true, lengthMeters: true, beamMeters: true, maxSpeedKnots: true } },
          },
        },
      },
      orderBy: [{ turn: { number: "desc" } }],
    }),
  ]);

  // Un même ennemi peut être repéré par plusieurs de nos navires : on ne
  // garde que le contact le plus récent par cible (tri décroissant ci-dessus).
  const contactsByTarget = new Map<string, (typeof contactDetections)[number]>();
  for (const d of contactDetections) {
    if (!contactsByTarget.has(d.targetUnitId) && d.targetUnit.status !== "SUNK") {
      contactsByTarget.set(d.targetUnitId, d);
    }
  }

  const alreadyFired = openTurn
    ? await prisma.combatEvent.findMany({
        where: { turnId: openTurn.id, attackerUnit: { fleet: { teamId: session.teamId } } },
        select: { attackerUnitId: true, targetUnitId: true, weaponType: true },
      })
    : [];

  return (
    <TacticalClient
      detectionId={detectionId}
      currentTurnNumber={openTurn?.number ?? null}
      currentTurnDurationMinutes={openTurn?.durationMinutes ?? null}
      mapZoom={scenario.mapDefaultZoom}
      focusAttackerId={focusDetection.observerUnit.id}
      focusTargetId={focusDetection.targetUnitId}
      alreadyFired={alreadyFired}
      ownUnits={ownUnits.map((u) => ({
        id: u.id,
        name: u.name,
        className: u.unitClass.name,
        category: u.unitClass.category,
        fleetName: u.fleet.name,
        lengthMeters: u.unitClass.lengthMeters,
        maxSpeedKnots: u.unitClass.maxSpeedKnots,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combatProfile: u.unitClass.combatProfile as any,
        healthCurrent: u.healthCurrent,
        healthMax: u.healthMax,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        currentHeadingDeg: u.currentHeadingDeg,
        status: u.status,
        depthBand: u.depthBand,
        batteryChargePercent: u.batteryChargePercent,
        oxygenHoursRemaining: u.oxygenHoursRemaining,
        oxygenEnduranceHours: u.unitClass.oxygenEnduranceHours,
        torpedoesRemaining: u.torpedoesRemaining,
      }))}
      contacts={Array.from(contactsByTarget.values()).map((d) => ({
        detectionEventId: d.id,
        targetUnitId: d.targetUnitId,
        name: d.targetUnit.name,
        className: d.targetUnit.unitClass.name,
        category: d.targetUnit.unitClass.category,
        lengthMeters: d.targetUnit.unitClass.lengthMeters,
        beamMeters: d.targetUnit.unitClass.beamMeters,
        maxSpeedKnots: d.targetUnit.unitClass.maxSpeedKnots,
        method: d.method,
        observedBy: d.observerUnit.name,
        turnNumber: d.turn.number,
        lastKnownLat: d.targetLatAtCpa,
        lastKnownLng: d.targetLngAtCpa,
      }))}
    />
  );
}
