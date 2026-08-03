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

  const detection = await prisma.detectionEvent.findUnique({
    where: { id: detectionId },
    include: {
      observerUnit: {
        include: {
          unitClass: true,
          fleet: { select: { teamId: true } },
        },
      },
      targetUnit: {
        select: {
          name: true,
          unitClass: {
            select: {
              name: true,
              category: true,
              iconKey: true,
              lengthMeters: true,
              beamMeters: true,
              maxSpeedKnots: true,
            },
          },
        },
      },
    },
  });

  // Seule l'équipe observatrice a accès à cette page (voir assertCanViewDetection) :
  // ne pas exposer aux joueurs le fait qu'ils ont eux-mêmes été repérés.
  if (!detection || detection.observerUnit.fleet.teamId !== session.teamId) {
    redirect("/team/orders");
  }

  const [scenario, alreadyFired] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.combatEvent.findMany({
      where: { detectionEventId: detection.id },
      select: { weaponType: true },
    }),
  ]);

  const observerUnitClass = detection.observerUnit.unitClass;

  return (
    <TacticalClient
      detectionId={detection.id}
      detectionConfirmed={detection.arbiterStatus === "CONFIRMED" || detection.arbiterStatus === "ADDED_MANUALLY"}
      tacticalModeRequested={detection.tacticalModeRequested}
      method={detection.method}
      cpaDistanceNm={detection.cpaDistanceNm}
      cpaMinutesIntoTurn={detection.cpaMinutesIntoTurn}
      mapZoom={scenario.mapDefaultZoom}
      weaponTypesAlreadyFired={alreadyFired.map((c) => c.weaponType)}
      observer={{
        id: detection.observerUnit.id,
        name: detection.observerUnit.name,
        className: observerUnitClass.name,
        category: observerUnitClass.category,
        lengthMeters: observerUnitClass.lengthMeters,
        beamMeters: observerUnitClass.beamMeters,
        maxSpeedKnots: observerUnitClass.maxSpeedKnots,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combatProfile: observerUnitClass.combatProfile as any,
        healthCurrent: detection.observerUnit.healthCurrent,
        healthMax: detection.observerUnit.healthMax,
        currentLat: detection.observerUnit.currentLat,
        currentLng: detection.observerUnit.currentLng,
        currentHeadingDeg: detection.observerUnit.currentHeadingDeg,
        depthBand: detection.observerUnit.depthBand,
        batteryChargePercent: detection.observerUnit.batteryChargePercent,
        oxygenHoursRemaining: detection.observerUnit.oxygenHoursRemaining,
        oxygenEnduranceHours: observerUnitClass.oxygenEnduranceHours,
        torpedoesRemaining: detection.observerUnit.torpedoesRemaining,
      }}
      target={{
        name: detection.targetUnit.name,
        className: detection.targetUnit.unitClass.name,
        category: detection.targetUnit.unitClass.category,
        iconKey: detection.targetUnit.unitClass.iconKey,
        lengthMeters: detection.targetUnit.unitClass.lengthMeters,
        beamMeters: detection.targetUnit.unitClass.beamMeters,
        maxSpeedKnots: detection.targetUnit.unitClass.maxSpeedKnots,
        lastKnownLat: detection.targetLatAtCpa,
        lastKnownLng: detection.targetLngAtCpa,
      }}
    />
  );
}
