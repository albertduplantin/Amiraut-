import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { bearingDeg, distanceNm } from "@/lib/geo";
import { getLastKnownSpeedsByUnit, defaultTurningRadiusM, defaultAccelerationKnotsPerMin } from "@/lib/tacticalEngine";
import { OrdersClient } from "./OrdersClient";
import { TacticalView } from "./TacticalView";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  // Dès qu'un combat rapproché est en cours pour cette équipe, il remplace
  // l'écran d'ordres longue durée sur cette même page — pas de bascule
  // d'URL ni de bandeau "mode tactique" : le joueur reste sur la carte.
  const activeEngagement = await prisma.tacticalEngagement.findFirst({
    where: { status: { not: "RESOLVED" }, participants: { some: { teamId: session.teamId } } },
    orderBy: { startedAt: "desc" },
  });

  if (activeEngagement) {
    return renderTacticalView(activeEngagement.id, session.teamId);
  }
  return renderStrategicView(session.scenarioId, session.teamId, session.fleetIds ?? null);
}

async function renderTacticalView(engagementId: string, teamId: string) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: {
      participants: { select: { unitId: true, teamId: true } },
      turn: { select: { number: true } },
      scenario: { select: { mapCenterLat: true, mapCenterLng: true, mapDefaultZoom: true } },
    },
  });
  if (!engagement.participants.some((p) => p.teamId === teamId)) {
    redirect("/team/orders");
  }

  const ownUnits = await prisma.unit.findMany({
    where: { id: { in: engagement.participants.filter((p) => p.teamId === teamId).map((p) => p.unitId) } },
    include: { unitClass: true },
    orderBy: { name: "asc" },
  });

  const enemyUnitIds = engagement.participants.filter((p) => p.teamId !== teamId).map((p) => p.unitId);
  const enemyUnits = await prisma.unit.findMany({
    where: { id: { in: enemyUnitIds } },
    select: { id: true, currentLat: true, currentLng: true, status: true },
  });
  const enemyById = new Map(enemyUnits.map((u) => [u.id, u]));

  const contacts = await prisma.tacticalContact.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, observerTeamId: teamId },
    include: { targetUnit: { include: { unitClass: true } } },
  });
  // Un même ennemi peut être vu par plusieurs de nos unités : on garde le
  // meilleur relevé (distance la plus courte).
  const bestContactByTarget = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    const existing = bestContactByTarget.get(c.targetUnitId);
    if (!existing || c.distanceNm < existing.distanceNm) bestContactByTarget.set(c.targetUnitId, c);
  }

  const ownFireActionsThisRound = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "FIRE", teamId },
  });

  // Vitesse de départ par défaut à la manche 1 : celle du dernier ordre
  // stratégique soumis pour ce navire (la vitesse qu'il avait juste avant
  // le passage à l'échelle de combat). Aux manches suivantes : sa propre
  // vitesse soumise à la manche tactique précédente. Fonction partagée
  // avec le moteur (submitTacticalMovement s'en sert aussi pour plafonner
  // l'accélération) : une seule source de vérité, jamais de désaccord
  // affichage/validation.
  const lastSpeedByUnit = await getLastKnownSpeedsByUnit(engagementId, ownUnits.map((u) => u.id), engagement.roundNumber);

  // Vecteur estimé pour les contacts ennemis (cap/vitesse déduits du
  // déplacement de la cible entre la manche précédente et celle-ci) : voir
  // TacticalContact.targetLatSnapshot/targetLngSnapshot.
  const estimatedVectorByTarget = new Map<string, { headingDeg: number; speedKnots: number }>();
  if (engagement.roundNumber > 1) {
    const currentBest = Array.from(bestContactByTarget.values());
    const prevContacts = await prisma.tacticalContact.findMany({
      where: {
        engagementId,
        roundNumber: engagement.roundNumber - 1,
        observerTeamId: teamId,
        targetUnitId: { in: currentBest.map((c) => c.targetUnitId) },
      },
    });
    // Un même ennemi peut avoir été vu par plusieurs de nos unités à la
    // manche précédente aussi : même règle que pour la manche courante, on
    // garde le relevé le plus précis (distance la plus courte).
    const bestPrevByTarget = new Map<string, (typeof prevContacts)[number]>();
    for (const c of prevContacts) {
      const existing = bestPrevByTarget.get(c.targetUnitId);
      if (!existing || c.distanceNm < existing.distanceNm) bestPrevByTarget.set(c.targetUnitId, c);
    }
    for (const c of currentBest) {
      const prev = bestPrevByTarget.get(c.targetUnitId);
      if (!prev || prev.targetLatSnapshot == null || prev.targetLngSnapshot == null || c.targetLatSnapshot == null || c.targetLngSnapshot == null) {
        continue;
      }
      const prevPos = { lat: prev.targetLatSnapshot, lng: prev.targetLngSnapshot };
      const currentPos = { lat: c.targetLatSnapshot, lng: c.targetLngSnapshot };
      const movedNm = distanceNm(prevPos, currentPos);
      if (movedNm < 0.05) continue; // bruit d'arrondi, pas un vrai déplacement
      estimatedVectorByTarget.set(c.targetUnitId, {
        headingDeg: bearingDeg(prevPos, currentPos),
        speedKnots: (movedNm / engagement.roundMinutes) * 60,
      });
    }
  }

  const battleLog = await prisma.tacticalAction.findMany({
    where: { engagementId, phase: "FIRE", resolved: true, teamId },
    orderBy: [{ roundNumber: "desc" }, { createdAt: "desc" }],
    take: 30,
  });
  const messages = await prisma.tacticalMessage.findMany({
    where: { engagementId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const submissions = await prisma.tacticalSubmission.findMany({
    where: {
      engagementId,
      roundNumber: engagement.roundNumber,
      phase: engagement.status === "AWAITING_MOVEMENT" ? "MOVEMENT" : "FIRE",
    },
  });
  const teamsInEngagement = Array.from(new Set(engagement.participants.map((p) => p.teamId)));
  const teams = await prisma.team.findMany({ where: { id: { in: teamsInEngagement } }, select: { id: true, name: true } });

  return (
    <TacticalView
      engagementId={engagementId}
      status={engagement.status}
      roundNumber={engagement.roundNumber}
      roundMinutes={engagement.roundMinutes}
      turnNumber={engagement.turn.number}
      arbiterPaused={engagement.arbiterPaused}
      endReason={engagement.endReason}
      teamId={teamId}
      teams={teams}
      mapCenter={{ lat: engagement.scenario.mapCenterLat, lng: engagement.scenario.mapCenterLng }}
      mapZoom={engagement.scenario.mapDefaultZoom}
      submittedTeamIds={submissions.map((s) => s.teamId)}
      ownUnits={ownUnits.map((u) => ({
        id: u.id,
        name: u.name,
        className: u.unitClass.name,
        category: u.unitClass.category,
        lengthMeters: u.unitClass.lengthMeters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combatProfile: u.unitClass.combatProfile as any,
        maxSpeedKnots: u.unitClass.maxSpeedKnots,
        healthCurrent: u.healthCurrent,
        healthMax: u.healthMax,
        status: u.status,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        headingDeg: u.currentHeadingDeg,
        depthBand: u.depthBand,
        lastSpeedKnots: lastSpeedByUnit.get(u.id) ?? 0,
        turningRadiusM: u.unitClass.turningRadiusM ?? defaultTurningRadiusM(u.unitClass.category),
        accelerationKnotsPerMin: u.unitClass.accelerationKnotsPerMin ?? defaultAccelerationKnotsPerMin(u.unitClass.category),
        torpedoesRemaining: u.torpedoesRemaining,
      }))}
      contacts={Array.from(bestContactByTarget.values()).map((c) => {
        const observer = ownUnits.find((u) => u.id === c.observerUnitId);
        const enemy = enemyById.get(c.targetUnitId);
        // Position du marqueur : la position réelle de la cible au moment du
        // relevé, déjà photographiée dans le contact (targetLatSnapshot/Lng)
        // — pas une nouvelle fuite d'information par rapport à distance+
        // relèvement déjà partagés, juste une reconstruction plus directe.
        const markerPos =
          c.targetLatSnapshot != null && c.targetLngSnapshot != null
            ? { lat: c.targetLatSnapshot, lng: c.targetLngSnapshot }
            : { lat: 0, lng: 0 };
        const normalizedBearing = observer
          ? ((bearingDeg({ lat: observer.currentLat, lng: observer.currentLng }, markerPos) % 360) + 360) % 360
          : 0;
        const estimate = estimatedVectorByTarget.get(c.targetUnitId) ?? null;
        return {
          targetUnitId: c.targetUnitId,
          name: c.targetUnit.name,
          className: c.targetUnit.unitClass.name,
          category: c.targetUnit.unitClass.category,
          lengthMeters: c.targetUnit.unitClass.lengthMeters,
          beamMeters: c.targetUnit.unitClass.beamMeters,
          maxSpeedKnots: c.targetUnit.unitClass.maxSpeedKnots,
          distanceNm: c.distanceNm,
          bearingDeg: normalizedBearing,
          lat: markerPos.lat,
          lng: markerPos.lng,
          status: enemy?.status ?? "ACTIVE",
          estimatedHeadingDeg: estimate?.headingDeg ?? null,
          estimatedSpeedKnots: estimate?.speedKnots ?? null,
        };
      })}
      ownFireActionsThisRound={ownFireActionsThisRound.map((a) => ({
        unitId: a.unitId,
        weaponSlot: a.weaponSlot,
        targetUnitId: a.targetUnitId,
        weaponType: a.weaponType,
        hit: a.hit,
        hits: a.hits,
        damagePoints: a.damagePoints,
        narrative: a.narrative,
      }))}
      battleLog={battleLog.map((a) => ({
        roundNumber: a.roundNumber,
        targetUnitId: a.targetUnitId,
        hit: a.hit,
        hits: a.hits,
        damagePoints: a.damagePoints,
        narrative: a.narrative,
      }))}
      messages={messages.map((m) => ({ id: m.id, kind: m.kind, authorName: m.authorName, body: m.body, roundNumber: m.roundNumber }))}
    />
  );
}

async function renderStrategicView(scenarioId: string, teamId: string, fleetIds: string[] | null) {
  const turn = await prisma.turn.findFirst({
    where: { scenarioId, status: "PENDING_ORDERS" },
    orderBy: { number: "desc" },
    include: { weather: true },
  });

  if (!turn || !turn.weatherId) {
    redirect("/team/waiting");
  }

  const lastPublishedTurn = await prisma.turn.findFirst({
    where: { scenarioId, status: "PUBLISHED" },
    orderBy: { number: "desc" },
  });
  const lastReport = lastPublishedTurn
    ? await prisma.report.findUnique({
        where: { turnId_teamId: { turnId: lastPublishedTurn.id, teamId } },
      })
    : null;

  const [scenario, units, teamFleets, teamUnitCount, teamOrderCount, allActiveUnitCount, allOrderCount] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: scenarioId } }),
    prisma.unit.findMany({
      where: {
        scenarioId,
        status: { in: ["ACTIVE", "DAMAGED"] },
        fleet: { teamId, ...(fleetIds ? { id: { in: fleetIds } } : {}) },
      },
      include: {
        unitClass: {
          select: {
            name: true,
            nation: true,
            maxSpeedKnots: true,
            lengthMeters: true,
            iconKey: true,
            category: true,
            sensors: true,
            detectability: true,
            historicalNote: true,
            profileImageUrl: true,
            oxygenEnduranceHours: true,
          },
        },
        fleet: { select: { name: true } },
        pendingFleet: { select: { name: true } },
        orders: {
          where: { turnId: turn.id },
          include: { waypoints: { orderBy: { sequence: "asc" } } },
        },
      },
      orderBy: [{ fleet: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.fleet.findMany({
      where: { teamId, ...(fleetIds ? { id: { in: fleetIds } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.unit.count({ where: { scenarioId, status: { in: ["ACTIVE", "DAMAGED"] }, fleet: { teamId } } }),
    prisma.unitOrder.count({ where: { turnId: turn.id, unit: { fleet: { teamId } } } }),
    prisma.unit.count({ where: { scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } } }),
    prisma.unitOrder.count({ where: { turnId: turn.id } }),
  ]);

  return (
    <OrdersClient
      turnId={turn.id}
      turnNumber={turn.number}
      turnDurationMinutes={turn.durationMinutes}
      weather={
        turn.weather
          ? {
              visibilityNm: turn.weather.visibilityNm,
              seaState: turn.weather.seaState,
              daylight: turn.weather.daylight,
              precipitation: turn.weather.precipitation,
            }
          : null
      }
      mapCenter={{ lat: scenario.mapCenterLat, lng: scenario.mapCenterLng }}
      mapZoom={scenario.mapDefaultZoom}
      teamProgress={{ submitted: teamOrderCount, total: teamUnitCount }}
      globalProgress={{ submitted: allOrderCount, total: allActiveUnitCount }}
      teamFleets={teamFleets}
      lastReportTurnNumber={lastPublishedTurn?.number ?? null}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lastContacts={(lastReport?.contacts as any[] | undefined) ?? []}
      units={units.map((u) => ({
        id: u.id,
        name: u.name,
        pennant: u.pennant,
        fleetId: u.fleetId,
        fleetName: u.fleet.name,
        pendingFleetName: u.pendingFleet?.name ?? null,
        className: u.unitClass.name,
        nation: u.unitClass.nation,
        category: u.unitClass.category,
        maxSpeedKnots: u.unitClass.maxSpeedKnots,
        lengthMeters: u.unitClass.lengthMeters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sensors: u.unitClass.sensors as any,
        detectability: u.unitClass.detectability,
        historicalNote: u.historicalNote ?? u.unitClass.historicalNote,
        profileImageUrl: u.unitClass.profileImageUrl,
        status: u.status,
        healthCurrent: u.healthCurrent,
        healthMax: u.healthMax,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        currentHeadingDeg: u.currentHeadingDeg,
        depthBand: u.depthBand,
        depthChargesRemaining: u.depthChargesRemaining,
        batteryChargePercent: u.batteryChargePercent,
        oxygenHoursRemaining: u.oxygenHoursRemaining,
        oxygenEnduranceHours: u.unitClass.oxygenEnduranceHours,
        torpedoesRemaining: u.torpedoesRemaining,
        existingOrder:
          u.orders.length > 0
            ? {
                speedKnots: u.orders[0].speedKnots,
                waypoints: u.orders[0].waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
                depthBand: u.orders[0].depthBand,
              }
            : null,
      }))}
    />
  );
}
