import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { bearingDeg, distanceNm, type LatLng } from "@/lib/geo";
import { getLastKnownSpeedsByUnit, defaultTurningRadiusM, defaultAccelerationKnotsPerMin } from "@/lib/tacticalEngine";
import { checkTurnProgress } from "@/lib/turnEngine";
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

  // Sillage estompé des dernières manches (retour joueur : "voir la
  // trajectoire" sans encombrer la carte indéfiniment) : jusqu'à 3 segments
  // entre positions de fin de manche consécutives, le plus récent le plus
  // sombre — voir TRAIL_ROUNDS_BACK dans TacticalView.tsx pour les teintes.
  // Navires propres : positions certaines (dernier point du trajet soumis
  // chaque manche). Contacts ennemis : uniquement leurs positions RELEVÉES
  // (TacticalContact.targetLatSnapshot), jamais leur position réelle non
  // détectée — même prudence de brouillard de guerre que pour le vecteur.
  const TRAIL_ROUNDS_TO_FETCH = 6;
  const trailFromRound = Math.max(1, engagement.roundNumber - TRAIL_ROUNDS_TO_FETCH);

  const ownMovementHistory = await prisma.tacticalAction.findMany({
    where: { engagementId, phase: "MOVEMENT", teamId, roundNumber: { gte: trailFromRound, lt: engagement.roundNumber } },
    orderBy: { roundNumber: "asc" },
  });
  const ownTrailByUnit = new Map<string, LatLng[]>();
  for (const a of ownMovementHistory) {
    const path = Array.isArray(a.movementPath) ? (a.movementPath as unknown as LatLng[]) : [];
    const lastPoint = path[path.length - 1];
    if (!lastPoint) continue; // manche sans déplacement (garde sa position) : aucun nouveau point de sillage
    const trail = ownTrailByUnit.get(a.unitId) ?? [];
    trail.push(lastPoint);
    ownTrailByUnit.set(a.unitId, trail.slice(-4));
  }

  const enemyContactHistory = await prisma.tacticalContact.findMany({
    where: { engagementId, observerTeamId: teamId, roundNumber: { gte: trailFromRound, lt: engagement.roundNumber } },
    orderBy: { roundNumber: "asc" },
  });
  const enemyTrailByTarget = new Map<string, { roundNumber: number; point: LatLng }[]>();
  for (const c of enemyContactHistory) {
    if (c.targetLatSnapshot == null || c.targetLngSnapshot == null) continue;
    const trail = enemyTrailByTarget.get(c.targetUnitId) ?? [];
    // Un même ennemi peut être relevé par plusieurs de nos unités la même
    // manche : ne garder qu'un point par manche (le plus récent suffit, la
    // précision du meilleur relevé n'est pas l'enjeu ici).
    if (trail.length === 0 || trail[trail.length - 1].roundNumber !== c.roundNumber) {
      trail.push({ roundNumber: c.roundNumber, point: { lat: c.targetLatSnapshot, lng: c.targetLngSnapshot } });
      enemyTrailByTarget.set(c.targetUnitId, trail.slice(-4));
    }
  }

  const ownFireActionsThisRound = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "FIRE", teamId },
  });
  // Navires déjà repositionnés cette manche (soumission par navire, voir
  // TacticalView) : sert à l'indicateur "validé" dans la liste et à
  // pré-remplir le brouillon avec le trajet déjà enregistré si le joueur
  // revient sur ce navire.
  const ownMovementActionsThisRound = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "MOVEMENT", teamId },
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
  // déplacement de la cible entre deux manches consécutives) : voir
  // TacticalContact.targetLatSnapshot/targetLngSnapshot.
  //
  // Piège : les contacts de la manche EN COURS ne reflètent la nouvelle
  // position d'une cible qu'une fois le mouvement de CETTE manche résolu
  // (resolveMovementPhase réécrit les contacts de la manche sur place après
  // avoir déplacé les unités). En phase de mouvement, la manche en cours
  // vient tout juste de s'ouvrir : ses contacts sont encore identiques à
  // ceux de la manche précédente (rien n'a bougé depuis) — comparer
  // manche courante vs manche-1 donnerait donc systématiquement un
  // déplacement nul. On compare plutôt les deux dernières manches
  // ENTIÈREMENT résolues : manche-1 vs manche-2 en phase de mouvement,
  // manche vs manche-1 en phase de tir (où la manche courante est déjà à
  // jour après son propre mouvement).
  const referenceRoundNumber = engagement.status === "AWAITING_FIRE" ? engagement.roundNumber : engagement.roundNumber - 1;
  const estimatedVectorByTarget = new Map<string, { headingDeg: number; speedKnots: number }>();
  if (referenceRoundNumber > 1) {
    const [refContacts, prevContacts] = await Promise.all([
      prisma.tacticalContact.findMany({ where: { engagementId, roundNumber: referenceRoundNumber, observerTeamId: teamId } }),
      prisma.tacticalContact.findMany({ where: { engagementId, roundNumber: referenceRoundNumber - 1, observerTeamId: teamId } }),
    ]);
    // Un même ennemi peut avoir été vu par plusieurs de nos unités : comme
    // pour bestContactByTarget, on garde le relevé le plus précis (distance
    // la plus courte) à chacune des deux manches comparées.
    function bestByTarget(contacts: typeof refContacts) {
      const map = new Map<string, (typeof contacts)[number]>();
      for (const c of contacts) {
        const existing = map.get(c.targetUnitId);
        if (!existing || c.distanceNm < existing.distanceNm) map.set(c.targetUnitId, c);
      }
      return map;
    }
    const bestRefByTarget = bestByTarget(refContacts);
    const bestPrevByTarget = bestByTarget(prevContacts);
    for (const [targetUnitId, c] of bestRefByTarget) {
      const prev = bestPrevByTarget.get(targetUnitId);
      if (!prev || prev.targetLatSnapshot == null || prev.targetLngSnapshot == null || c.targetLatSnapshot == null || c.targetLngSnapshot == null) {
        continue;
      }
      const prevPos = { lat: prev.targetLatSnapshot, lng: prev.targetLngSnapshot };
      const currentPos = { lat: c.targetLatSnapshot, lng: c.targetLngSnapshot };
      const movedNm = distanceNm(prevPos, currentPos);
      if (movedNm < 0.05) continue; // bruit d'arrondi, pas un vrai déplacement
      estimatedVectorByTarget.set(targetUnitId, {
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
        turningRadiusM: u.unitClass.turningRadiusM ?? defaultTurningRadiusM(u.unitClass.category, u.unitClass.name),
        accelerationKnotsPerMin: u.unitClass.accelerationKnotsPerMin ?? defaultAccelerationKnotsPerMin(u.unitClass.category, u.unitClass.name),
        torpedoesRemaining: u.torpedoesRemaining,
        disabledWeaponSlots: u.disabledWeaponSlots,
        speedCapKnots: u.speedCapKnots,
        rudderJammed: u.rudderJammed,
        fireControlDamaged: u.fireControlDamaged,
        profileImageUrl: u.unitClass.profileImageUrl,
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
          profileImageUrl: c.targetUnit.unitClass.profileImageUrl,
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
        hitChancePercent: a.hitChancePercent,
        hitRoll: a.hitRoll,
        narrative: a.narrative,
        debugInfo: a.debugInfo,
      }))}
      ownMovementActionsThisRound={ownMovementActionsThisRound.map((a) => ({
        unitId: a.unitId,
        speedKnots: a.speedKnots,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        movementPath: (a.movementPath as any) ?? null,
      }))}
      ownTrailByUnit={Object.fromEntries(ownTrailByUnit)}
      enemyTrailByTarget={Object.fromEntries(
        Array.from(enemyTrailByTarget.entries()).map(([targetUnitId, trail]) => [targetUnitId, trail.map((t) => t.point)])
      )}
      battleLog={battleLog.map((a) => ({
        roundNumber: a.roundNumber,
        targetUnitId: a.targetUnitId,
        hit: a.hit,
        hits: a.hits,
        damagePoints: a.damagePoints,
        hitChancePercent: a.hitChancePercent,
        hitRoll: a.hitRoll,
        narrative: a.narrative,
        debugInfo: a.debugInfo,
      }))}
      messages={messages.map((m) => ({ id: m.id, kind: m.kind, authorName: m.authorName, body: m.body, roundNumber: m.roundNumber }))}
    />
  );
}

async function renderStrategicView(scenarioId: string, teamId: string, fleetIds: string[] | null) {
  // Ordres permanents (bloc 3) : reconduit d'abord ceux des unités qui n'ont
  // pas d'ordre manuel ce tour-ci, et fait avancer le tour s'il ne restait
  // plus que ça à attendre — sinon un tour où plus personne n'a besoin de
  // dessiner de trajet ne se résoudrait jamais (rien d'autre ne le déclenche).
  const openTurn = await prisma.turn.findFirst({ where: { scenarioId, status: "PENDING_ORDERS" }, orderBy: { number: "desc" } });
  if (openTurn) await checkTurnProgress(openTurn.id);

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
            enduranceMinutes: true,
            turningRadiusM: true,
            accelerationKnotsPerMin: true,
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
        turningRadiusM: u.unitClass.turningRadiusM ?? defaultTurningRadiusM(u.unitClass.category, u.unitClass.name),
        accelerationKnotsPerMin:
          u.unitClass.accelerationKnotsPerMin ?? defaultAccelerationKnotsPerMin(u.unitClass.category, u.unitClass.name),
        enduranceMinutes: u.unitClass.enduranceMinutes,
        standingOrderActive: u.standingOrderActive,
        standingOrderKind: u.standingOrderKind,
        airMissionState: u.airMissionState,
        airPatrolLat: u.airPatrolLat,
        airPatrolLng: u.airPatrolLng,
        airHomeLat: u.airHomeLat,
        airHomeLng: u.airHomeLng,
        fuelMinutesRemaining: u.fuelMinutesRemaining,
        existingOrder:
          u.orders.length > 0
            ? {
                speedKnots: u.orders[0].speedKnots,
                waypoints: u.orders[0].waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
                depthBand: u.orders[0].depthBand,
                isStanding: u.orders[0].isStanding,
              }
            : null,
      }))}
    />
  );
}
