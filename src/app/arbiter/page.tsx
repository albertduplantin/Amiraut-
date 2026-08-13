import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ArbiterDashboard } from "./ArbiterDashboard";

export default async function ArbiterDashboardPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const [scenario, turn] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId },
      orderBy: { number: "desc" },
      include: { weather: true },
    }),
  ]);

  if (!turn) {
    return <div className="p-6 text-slate-100">Aucun tour trouvé pour ce scénario.</div>;
  }

  const [orderCount, activeUnitCount, teams, units, detections, engagements] = await Promise.all([
    prisma.unitOrder.count({ where: { turnId: turn.id } }),
    prisma.unit.count({ where: { scenarioId: session.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } } }),
    prisma.team.findMany({ where: { scenarioId: session.scenarioId }, select: { id: true, name: true, colorHex: true } }),
    prisma.unit.findMany({
      where: { scenarioId: session.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } },
      include: {
        unitClass: { select: { name: true, category: true, lengthMeters: true } },
        fleet: { select: { id: true, name: true, teamId: true, team: { select: { name: true, colorHex: true } } } },
      },
      orderBy: [{ fleet: { team: { name: "asc" } } }, { fleet: { name: "asc" } }, { name: "asc" }],
    }),
    turn.status === "PENDING_ARBITER_REVIEW" || turn.status === "RESOLVING"
      ? prisma.detectionEvent.findMany({
          where: { turnId: turn.id },
          include: {
            observerUnit: { select: { id: true, name: true, fleet: { select: { team: { select: { name: true } } } } } },
            targetUnit: { select: { id: true, name: true, fleet: { select: { team: { select: { name: true } } } } } },
          },
          // Un second critère de tri est nécessaire : beaucoup de paires
          // partagent exactement la même distance de CPA (formations
          // symétriques), et sans lui l'ordre des ex-æquo n'est pas stable
          // d'une requête à l'autre.
          orderBy: [{ cpaDistanceNm: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    prisma.tacticalEngagement.findMany({
      where: { scenarioId: session.scenarioId, status: { not: "RESOLVED" } },
      include: {
        participants: {
          include: { unit: { select: { name: true, status: true, healthCurrent: true, healthMax: true } }, team: { select: { name: true, colorHex: true } } },
        },
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const engagementIds = engagements.map((e) => e.id);
  const submissions =
    engagementIds.length > 0
      ? await prisma.tacticalSubmission.findMany({ where: { engagementId: { in: engagementIds } } })
      : [];
  const submittedByEngagement = new Map<string, string[]>();
  for (const s of submissions) {
    // Ne garde que les soumissions de la manche/phase courante de chaque engagement.
    const eng = engagements.find((e) => e.id === s.engagementId);
    if (!eng) continue;
    if (s.roundNumber !== eng.roundNumber) continue;
    if (s.phase !== (eng.status === "AWAITING_MOVEMENT" ? "MOVEMENT" : "FIRE")) continue;
    const list = submittedByEngagement.get(s.engagementId) ?? [];
    list.push(s.teamId);
    submittedByEngagement.set(s.engagementId, list);
  }

  return (
    <ArbiterDashboard
      scenarioName={scenario.name}
      turnId={turn.id}
      turnNumber={turn.number}
      turnStatus={turn.status}
      turnDurationMinutes={turn.durationMinutes}
      tacticalMode={turn.tacticalMode}
      weather={
        turn.weather
          ? {
              visibilityNm: turn.weather.visibilityNm,
              seaState: turn.weather.seaState,
              daylight: turn.weather.daylight,
              precipitation: turn.weather.precipitation,
              windKnots: turn.weather.windKnots,
              notes: turn.weather.notes,
            }
          : null
      }
      orderCount={orderCount}
      activeUnitCount={activeUnitCount}
      mapCenter={{ lat: scenario.mapCenterLat, lng: scenario.mapCenterLng }}
      mapZoom={scenario.mapDefaultZoom}
      teams={teams}
      units={units.map((u) => ({
        id: u.id,
        name: u.name,
        className: u.unitClass.name,
        category: u.unitClass.category,
        lengthMeters: u.unitClass.lengthMeters,
        status: u.status,
        teamId: u.fleet.teamId,
        teamName: u.fleet.team.name,
        teamColor: u.fleet.team.colorHex,
        fleetId: u.fleet.id,
        fleetName: u.fleet.name,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        currentHeadingDeg: u.currentHeadingDeg,
        healthCurrent: u.healthCurrent,
        healthMax: u.healthMax,
        depthBand: u.depthBand,
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
      engagements={engagements.map((e) => ({
        id: e.id,
        roundNumber: e.roundNumber,
        roundMinutes: e.roundMinutes,
        status: e.status,
        arbiterPaused: e.arbiterPaused,
        endReason: e.endReason,
        teams: Array.from(new Set(e.participants.map((p) => p.teamId))).map((teamId) => {
          const p = e.participants.find((x) => x.teamId === teamId)!;
          return { id: teamId, name: p.team.name };
        }),
        submittedTeamIds: submittedByEngagement.get(e.id) ?? [],
        participants: e.participants.map((p) => ({
          unitId: p.unitId,
          teamId: p.teamId,
          teamName: p.team.name,
          teamColor: p.team.colorHex,
          name: p.unit.name,
          status: p.unit.status,
          healthCurrent: p.unit.healthCurrent,
          healthMax: p.unit.healthMax,
        })),
      }))}
    />
  );
}
