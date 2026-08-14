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

  // Partie close (voir gameEnd.ts) : plus rien à arbitrer, direction le
  // compte rendu de fin d'opération plutôt qu'un tableau de bord périmé.
  if (scenario.status === "COMPLETED") {
    redirect("/report");
  }

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

  // Filet automatique navire-contre-navire, supervisé par l'arbitre (retour
  // utilisateur 2026-08-14) : candidats sur l'ENSEMBLE du scénario, pas
  // seulement le tour en cours — voir previewAutomaticShipResolution/
  // applyAutomaticShipResolution (tacticalEngine.ts). Portée V1 : navire de
  // surface contre navire de surface uniquement.
  const shipDetections = await prisma.detectionEvent.findMany({
    where: {
      turn: { scenarioId: session.scenarioId },
      arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] },
      observerUnit: { unitClass: { category: "SURFACE_SHIP" }, status: { in: ["ACTIVE", "DAMAGED"] } },
      targetUnit: { unitClass: { category: "SURFACE_SHIP" }, status: { in: ["ACTIVE", "DAMAGED"] } },
    },
    include: {
      observerUnit: { select: { id: true, name: true, fleet: { select: { team: { select: { name: true } } } } } },
      targetUnit: { select: { id: true, name: true, fleet: { select: { team: { select: { name: true } } } } } },
      turn: { select: { number: true } },
    },
    orderBy: [{ turn: { number: "desc" } }],
  });

  const relevantTurnIds = Array.from(new Set(shipDetections.map((d) => d.turnId)));
  const combatEventsForPairs =
    relevantTurnIds.length > 0
      ? await prisma.combatEvent.findMany({
          where: { turnId: { in: relevantTurnIds } },
          select: { turnId: true, attackerUnitId: true, targetUnitId: true },
        })
      : [];
  const resolvedPairKeys = new Set(
    combatEventsForPairs.map((c) => `${c.turnId}:${[c.attackerUnitId, c.targetUnitId].sort().join("-")}`)
  );
  const openEngagementPairKeys = new Set<string>();
  for (const eng of engagements) {
    const unitIds = eng.participants.map((p) => p.unitId);
    for (let i = 0; i < unitIds.length; i++) {
      for (let j = i + 1; j < unitIds.length; j++) {
        openEngagementPairKeys.add([unitIds[i], unitIds[j]].sort().join("-"));
      }
    }
  }
  const pendingShipEncounters = shipDetections.filter((d) => {
    const pairKey = [d.observerUnitId, d.targetUnitId].sort().join("-");
    if (resolvedPairKeys.has(`${d.turnId}:${pairKey}`)) return false;
    if (openEngagementPairKeys.has(pairKey)) return false;
    return true;
  });

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
      pendingShipEncounters={pendingShipEncounters.map((d) => ({
        id: d.id,
        observerName: d.observerUnit.name,
        observerTeam: d.observerUnit.fleet.team.name,
        targetName: d.targetUnit.name,
        targetTeam: d.targetUnit.fleet.team.name,
        turnNumber: d.turn.number,
        cpaDistanceNm: d.cpaDistanceNm,
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
