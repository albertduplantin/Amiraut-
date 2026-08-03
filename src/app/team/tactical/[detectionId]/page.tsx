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

  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } });

  return (
    <TacticalClient
      detectionId={detection.id}
      tacticalModeRequested={detection.tacticalModeRequested}
      method={detection.method}
      cpaDistanceNm={detection.cpaDistanceNm}
      cpaMinutesIntoTurn={detection.cpaMinutesIntoTurn}
      mapZoom={scenario.mapDefaultZoom}
      observer={{
        id: detection.observerUnit.id,
        name: detection.observerUnit.name,
        className: detection.observerUnit.unitClass.name,
        category: detection.observerUnit.unitClass.category,
        lengthMeters: detection.observerUnit.unitClass.lengthMeters,
        beamMeters: detection.observerUnit.unitClass.beamMeters,
        maxSpeedKnots: detection.observerUnit.unitClass.maxSpeedKnots,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combatProfile: detection.observerUnit.unitClass.combatProfile as any,
        healthCurrent: detection.observerUnit.healthCurrent,
        healthMax: detection.observerUnit.healthMax,
        currentLat: detection.observerUnit.currentLat,
        currentLng: detection.observerUnit.currentLng,
        currentHeadingDeg: detection.observerUnit.currentHeadingDeg,
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
