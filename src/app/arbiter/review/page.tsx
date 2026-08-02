import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ReviewClient } from "./ReviewClient";

export default async function ReviewPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const turn = await prisma.turn.findFirst({
    where: {
      scenarioId: session.scenarioId,
      status: { in: ["PENDING_ARBITER_REVIEW", "RESOLVING"] },
    },
    orderBy: { number: "desc" },
  });

  if (!turn) {
    redirect("/arbiter");
  }

  const [scenario, units, detections, teams] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.unit.findMany({
      where: { scenarioId: session.scenarioId, status: "ACTIVE" },
      include: {
        unitClass: { select: { name: true } },
        fleet: { select: { teamId: true, team: { select: { name: true, colorHex: true } } } },
        orders: { where: { turnId: turn.id }, include: { waypoints: { orderBy: { sequence: "asc" } } } },
      },
    }),
    prisma.detectionEvent.findMany({
      where: { turnId: turn.id },
      include: {
        observerUnit: { select: { id: true, name: true, fleet: { select: { team: { select: { name: true } } } } } },
        targetUnit: { select: { id: true, name: true, fleet: { select: { team: { select: { name: true } } } } } },
      },
      orderBy: { cpaDistanceNm: "asc" },
    }),
    prisma.team.findMany({ where: { scenarioId: session.scenarioId } }),
  ]);

  return (
    <ReviewClient
      turnId={turn.id}
      turnNumber={turn.number}
      turnStatus={turn.status}
      mapCenter={{ lat: scenario.mapCenterLat, lng: scenario.mapCenterLng }}
      mapZoom={scenario.mapDefaultZoom}
      teams={teams.map((t) => ({ id: t.id, name: t.name, colorHex: t.colorHex }))}
      units={units.map((u) => ({
        id: u.id,
        name: u.name,
        className: u.unitClass.name,
        teamId: u.fleet.teamId,
        teamName: u.fleet.team.name,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        path:
          u.orders.length > 0
            ? [{ lat: u.currentLat, lng: u.currentLng }, ...u.orders[0].waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))]
            : [{ lat: u.currentLat, lng: u.currentLng }],
      }))}
      detections={detections.map((d) => ({
        id: d.id,
        observerUnitId: d.observerUnitId,
        observerName: d.observerUnit.name,
        observerTeam: d.observerUnit.fleet.team.name,
        targetUnitId: d.targetUnitId,
        targetName: d.targetUnit.name,
        targetTeam: d.targetUnit.fleet.team.name,
        method: d.method,
        cpaDistanceNm: d.cpaDistanceNm,
        cpaMinutesIntoTurn: d.cpaMinutesIntoTurn,
        observerLatAtCpa: d.observerLatAtCpa,
        observerLngAtCpa: d.observerLngAtCpa,
        targetLatAtCpa: d.targetLatAtCpa,
        targetLngAtCpa: d.targetLngAtCpa,
        arbiterStatus: d.arbiterStatus,
        systemProposed: d.systemProposed,
      }))}
    />
  );
}
