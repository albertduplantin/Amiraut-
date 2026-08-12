import "server-only";
import { prisma } from "@/lib/prisma";
import { distanceNm, bearingDeg, pathLengthNm, speedBudgetNm, type LatLng } from "@/lib/geo";
import { effectiveSensorRangeNm, type WeatherConditions } from "@/lib/weather";
import {
  resolveGunEngagement,
  resolveTorpedoEngagement,
  resolveDepthChargeAttack,
  selectGunBattery,
  selectTorpedoBattery,
  isTorpedoArcClear,
  type CombatProfile,
  type DepthBand as CombatDepthBand,
} from "@/lib/combat";
import { describeShot, assessFiringReveal } from "@/lib/tacticalNarrative";
import { OrderValidationError, currentOpenTurn } from "@/lib/turnEngine";
import type { DepthBand, SensorType, WeaponType } from "@/generated/prisma/client";

const NM_TO_M = 1852;
const ASDIC_ATTACK_RANGE_M = 2000;

/** Deux manches consécutives sans le moindre contact = rupture de contact. */
const ROUNDS_WITHOUT_CONTACT_TO_END = 2;

/** Repli quand aucune pièce principale n'est encore à portée de rien. */
const DEFAULT_ROUND_MINUTES = 5;

type SensorSpec = { type: SensorType; rangeNm: number };

function parseSensors(json: unknown): SensorSpec[] {
  return Array.isArray(json) ? (json as SensorSpec[]) : [];
}

function isNightWeather(w: WeatherConditions | null): boolean {
  return !w || w.daylight === "NIGHT" || w.daylight === "POLAR_NIGHT";
}

// ── Ouverture d'un engagement ───────────────────────────────

/**
 * Ouvre une bataille tactique autour d'un contact : on y embarque toutes
 * les unités des deux camps assez proches pour peser sur l'affaire, pas
 * seulement le couple qui s'est repéré.
 */
export async function openTacticalEngagement(params: {
  scenarioId: string;
  turnId: string;
  seedUnitIds: string[];
  /** Rayon autour du barycentre des unités initiales pour recruter les participants. */
  gatherRadiusNm?: number;
  syncMode?: "SYNC" | "ASYNC";
  roundMinutes?: number;
}) {
  const radius = params.gatherRadiusNm ?? 25;

  const seeds = await prisma.unit.findMany({
    where: { id: { in: params.seedUnitIds } },
    include: { fleet: { select: { teamId: true } } },
  });
  if (seeds.length === 0) throw new OrderValidationError("Aucune unité pour ouvrir l'engagement.");

  const centre = {
    lat: seeds.reduce((s, u) => s + u.currentLat, 0) / seeds.length,
    lng: seeds.reduce((s, u) => s + u.currentLng, 0) / seeds.length,
  };

  const nearby = await prisma.unit.findMany({
    where: { scenarioId: params.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } },
    include: { fleet: { select: { teamId: true } } },
  });
  const participants = nearby.filter(
    (u) => distanceNm(centre, { lat: u.currentLat, lng: u.currentLng }) <= radius
  );

  const engagement = await prisma.tacticalEngagement.create({
    data: {
      scenarioId: params.scenarioId,
      turnId: params.turnId,
      syncMode: params.syncMode ?? "ASYNC",
      roundMinutes: params.roundMinutes ?? 5,
      participants: {
        create: participants.map((u) => ({ unitId: u.id, teamId: u.fleet.teamId, joinedRound: 1 })),
      },
    },
  });

  // Contacts de départ : ce que chaque camp voit dès l'ouverture.
  await recomputeContacts(engagement.id, 1);

  // La durée par défaut passée en paramètre ne sert que de repli si aucune
  // pièce principale n'est encore à portée à l'ouverture.
  const roundMinutes = await computeNextRoundMinutes(engagement.id, 1, params.roundMinutes ?? DEFAULT_ROUND_MINUTES);
  if (roundMinutes !== engagement.roundMinutes) {
    await prisma.tacticalEngagement.update({ where: { id: engagement.id }, data: { roundMinutes } });
  }
  return { ...engagement, roundMinutes };
}

/**
 * Durée de la manche à venir : le temps que met la pièce principale la plus
 * rapide actuellement à portée (chez n'importe quel participant) pour
 * boucler un cycle de tir complet. Seule la batterie principale compte —
 * une DCA à 10 coups/minute donnerait des manches de quelques secondes,
 * injouables — plancher à 1 min pour rester jouable, plafond à 10 min
 * quand rien n'est encore à portée.
 */
const MIN_ROUND_MINUTES = 1;
const MAX_ROUND_MINUTES = 10;

async function computeNextRoundMinutes(engagementId: string, contactRoundNumber: number, fallback: number): Promise<number> {
  const contacts = await prisma.tacticalContact.findMany({ where: { engagementId, roundNumber: contactRoundNumber } });
  if (contacts.length === 0) return fallback;

  const participants = await prisma.tacticalParticipant.findMany({
    where: { engagementId },
    include: { unit: { include: { unitClass: true } } },
  });
  const byUnitId = new Map(participants.map((p) => [p.unitId, p.unit]));

  let fastestRpm: number | null = null;
  for (const c of contacts) {
    const observer = byUnitId.get(c.observerUnitId);
    const profile = observer?.unitClass.combatProfile as CombatProfile | null;
    const rangeM = c.distanceNm * NM_TO_M;
    for (const gun of profile?.guns ?? []) {
      if (gun.rangeM >= rangeM && (fastestRpm === null || gun.roundsPerMinute > fastestRpm)) {
        fastestRpm = gun.roundsPerMinute;
      }
    }
  }
  if (fastestRpm === null || fastestRpm <= 0) return fallback;
  return Math.max(MIN_ROUND_MINUTES, Math.min(MAX_ROUND_MINUTES, 60 / fastestRpm));
}

/**
 * Ouvre le combat tactique sur un contact confirmé, ou rejoint celui déjà en
 * cours si un camp l'a engagé le premier — le duel se joue à deux, un
 * engagement ne se double pas.
 */
export async function openOrJoinEngagementForDetection(detectionEventId: string) {
  const detection = await prisma.detectionEvent.findUniqueOrThrow({
    where: { id: detectionEventId },
    include: {
      turn: { select: { scenarioId: true } },
      observerUnit: { select: { id: true } },
      targetUnit: { select: { id: true } },
    },
  });
  if (detection.arbiterStatus !== "CONFIRMED" && detection.arbiterStatus !== "ADDED_MANUALLY") {
    throw new OrderValidationError("Cette détection n'est pas confirmée par l'arbitre.");
  }

  const existing = await prisma.tacticalEngagement.findFirst({
    where: {
      scenarioId: detection.turn.scenarioId,
      status: { not: "RESOLVED" },
      participants: { some: { unitId: detection.observerUnitId } },
    },
    include: { participants: { select: { unitId: true } } },
  });
  if (existing && existing.participants.some((p) => p.unitId === detection.targetUnitId)) {
    return existing;
  }

  const currentTurn = await currentOpenTurn(detection.turnId);
  return openTacticalEngagement({
    scenarioId: detection.turn.scenarioId,
    turnId: currentTurn.id,
    seedUnitIds: [detection.observerUnitId, detection.targetUnitId],
  });
}

// ── Détection à l'échelle tactique ──────────────────────────

/**
 * Recalcule qui voit qui. Appelé à l'ouverture puis après chaque phase de
 * mouvement : c'est là qu'un sous-marin jusqu'alors invisible peut se faire
 * accrocher, et là qu'un tireur de la manche précédente paie sa lueur de
 * bouche.
 */
export async function recomputeContacts(engagementId: string, roundNumber: number) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: {
      turn: { include: { weather: true } },
      participants: { include: { unit: { include: { unitClass: true } } } },
    },
  });

  const weather: WeatherConditions | null = engagement.turn.weather
    ? {
        visibilityNm: engagement.turn.weather.visibilityNm,
        seaState: engagement.turn.weather.seaState,
        daylight: engagement.turn.weather.daylight,
        precipitation: engagement.turn.weather.precipitation,
      }
    : null;
  const fallbackWeather: WeatherConditions = weather ?? {
    visibilityNm: 10,
    seaState: 3,
    daylight: "DAY",
    precipitation: "NONE",
  };

  // Unités qui ont tiré à la manche précédente et se sont trahies.
  const revealing = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: roundNumber - 1, phase: "FIRE", revealedShooter: true },
    select: { unitId: true, weaponType: true, torpedoTypeId: true },
  });
  const revealRadiusByUnit = new Map<string, number>();
  for (const r of revealing) {
    const shooter = engagement.participants.find((p) => p.unitId === r.unitId);
    const profile = shooter?.unit.unitClass.combatProfile as CombatProfile | null;
    const calibre = profile?.guns?.[0]?.calibreMm ?? null;
    const wake = profile?.torpedoTypes?.find((t) => t.id === r.torpedoTypeId)?.wakeVisible ?? true;
    const assessment = assessFiringReveal({
      weaponType: r.weaponType as WeaponType,
      calibreMm: calibre,
      torpedoWakeVisible: wake,
      isNight: isNightWeather(weather),
    });
    revealRadiusByUnit.set(r.unitId, Math.max(revealRadiusByUnit.get(r.unitId) ?? 0, assessment.revealRadiusNm));
  }

  const rows: {
    engagementId: string;
    roundNumber: number;
    observerTeamId: string;
    observerUnitId: string;
    targetUnitId: string;
    method: SensorType;
    distanceNm: number;
  }[] = [];

  for (const observer of engagement.participants) {
    if (observer.unit.status === "SUNK") continue;
    const sensors = parseSensors(observer.unit.unitClass.sensors);

    for (const target of engagement.participants) {
      if (target.teamId === observer.teamId) continue;
      if (target.unit.status === "SUNK") continue;

      const d = distanceNm(
        { lat: observer.unit.currentLat, lng: observer.unit.currentLng },
        { lat: target.unit.currentLat, lng: target.unit.currentLng }
      );

      const targetSubmerged = target.unit.unitClass.category === "SUBMARINE" && target.unit.depthBand !== "SURFACE";

      let best: { type: SensorType; margin: number } | null = null;
      for (const sensor of sensors) {
        // Immergé : ni radar ni visuel, seulement l'écoute.
        if (targetSubmerged && (sensor.type === "RADAR" || sensor.type === "VISUAL")) continue;
        const range = effectiveSensorRangeNm(
          sensor.type,
          sensor.rangeNm,
          fallbackWeather,
          target.unit.unitClass.detectability,
          0
        );
        const margin = range - d;
        if (margin >= 0 && (!best || margin > best.margin)) best = { type: sensor.type, margin };
      }

      // Le tir de la manche précédente trahit, même hors de portée des capteurs.
      const revealRadius = revealRadiusByUnit.get(target.unitId) ?? 0;
      if (!best && revealRadius > 0 && d <= revealRadius && !targetSubmerged) {
        best = { type: "VISUAL", margin: revealRadius - d };
      }

      if (best) {
        rows.push({
          engagementId,
          roundNumber,
          observerTeamId: observer.teamId,
          observerUnitId: observer.unitId,
          targetUnitId: target.unitId,
          method: best.type,
          distanceNm: d,
        });
      }
    }
  }

  await prisma.tacticalContact.deleteMany({ where: { engagementId, roundNumber } });
  if (rows.length > 0) {
    await prisma.tacticalContact.createMany({ data: rows, skipDuplicates: true });
  }
  return rows;
}

// ── Soumission des ordres ───────────────────────────────────

export async function submitTacticalMovement(params: {
  engagementId: string;
  teamId: string;
  moves: { unitId: string; speedKnots: number; path: LatLng[]; depthBand?: DepthBand }[];
}) {
  const engagement = await assertEngagementOpen(params.engagementId, "AWAITING_MOVEMENT");

  for (const m of params.moves) {
    const participant = await prisma.tacticalParticipant.findUnique({
      where: { engagementId_unitId: { engagementId: params.engagementId, unitId: m.unitId } },
      include: { unit: { include: { unitClass: true } } },
    });
    if (!participant || participant.teamId !== params.teamId) {
      throw new OrderValidationError("Cette unité ne participe pas à cet engagement pour votre camp.");
    }
    if (m.speedKnots < 0 || m.speedKnots > participant.unit.unitClass.maxSpeedKnots) {
      throw new OrderValidationError(
        `${participant.unit.name} : vitesse ${m.speedKnots} nds hors limites (max ${participant.unit.unitClass.maxSpeedKnots}).`
      );
    }
    if (m.path.length > 0) {
      const budgetNm = speedBudgetNm(m.speedKnots, engagement.roundMinutes);
      const usedNm = pathLengthNm([{ lat: participant.unit.currentLat, lng: participant.unit.currentLng }, ...m.path]);
      if (usedNm > budgetNm * 1.01) {
        throw new OrderValidationError(
          `${participant.unit.name} : tracé de ${usedNm.toFixed(2)}nm, budget ${budgetNm.toFixed(2)}nm à ${m.speedKnots}nds sur ${engagement.roundMinutes.toFixed(1)}min.`
        );
      }
    }

    await prisma.tacticalAction.upsert({
      where: {
        engagementId_roundNumber_phase_unitId: {
          engagementId: params.engagementId,
          roundNumber: engagement.roundNumber,
          phase: "MOVEMENT",
          unitId: m.unitId,
        },
      },
      create: {
        engagementId: params.engagementId,
        roundNumber: engagement.roundNumber,
        phase: "MOVEMENT",
        unitId: m.unitId,
        teamId: params.teamId,
        speedKnots: m.speedKnots,
        movementPath: m.path,
        depthBand: m.depthBand,
      },
      update: { speedKnots: m.speedKnots, movementPath: m.path, depthBand: m.depthBand },
    });
  }

  await markSubmitted(params.engagementId, engagement.roundNumber, "MOVEMENT", params.teamId);
  return maybeResolvePhase(params.engagementId);
}

export async function submitTacticalFire(params: {
  engagementId: string;
  teamId: string;
  shots: { unitId: string; targetUnitId: string; weaponType: WeaponType; torpedoTypeId?: string }[];
}) {
  const engagement = await assertEngagementOpen(params.engagementId, "AWAITING_FIRE");

  for (const s of params.shots) {
    const participant = await prisma.tacticalParticipant.findUnique({
      where: { engagementId_unitId: { engagementId: params.engagementId, unitId: s.unitId } },
    });
    if (!participant || participant.teamId !== params.teamId) {
      throw new OrderValidationError("Cette unité ne participe pas à cet engagement pour votre camp.");
    }

    // On ne tire que sur ce que son camp a détecté à l'issue du mouvement.
    const contact = await prisma.tacticalContact.findFirst({
      where: {
        engagementId: params.engagementId,
        roundNumber: engagement.roundNumber,
        observerTeamId: params.teamId,
        targetUnitId: s.targetUnitId,
      },
    });
    if (!contact) throw new OrderValidationError("Cible non détectée par votre camp à cette manche.");

    await prisma.tacticalAction.upsert({
      where: {
        engagementId_roundNumber_phase_unitId: {
          engagementId: params.engagementId,
          roundNumber: engagement.roundNumber,
          phase: "FIRE",
          unitId: s.unitId,
        },
      },
      create: {
        engagementId: params.engagementId,
        roundNumber: engagement.roundNumber,
        phase: "FIRE",
        unitId: s.unitId,
        teamId: params.teamId,
        targetUnitId: s.targetUnitId,
        weaponType: s.weaponType,
        torpedoTypeId: s.torpedoTypeId,
      },
      update: { targetUnitId: s.targetUnitId, weaponType: s.weaponType, torpedoTypeId: s.torpedoTypeId },
    });
  }

  await markSubmitted(params.engagementId, engagement.roundNumber, "FIRE", params.teamId);
  return maybeResolvePhase(params.engagementId);
}

async function assertEngagementOpen(engagementId: string, expected: "AWAITING_MOVEMENT" | "AWAITING_FIRE") {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({ where: { id: engagementId } });
  if (engagement.status === "RESOLVED") throw new OrderValidationError("Cet engagement est terminé.");
  if (engagement.arbiterPaused) throw new OrderValidationError("L'arbitre a suspendu le combat.");
  if (engagement.status !== expected) {
    throw new OrderValidationError(
      expected === "AWAITING_MOVEMENT" ? "Ce n'est pas la phase de mouvement." : "Ce n'est pas la phase de tir."
    );
  }
  return engagement;
}

async function markSubmitted(engagementId: string, roundNumber: number, phase: "MOVEMENT" | "FIRE", teamId: string) {
  await prisma.tacticalSubmission.upsert({
    where: { engagementId_roundNumber_phase_teamId: { engagementId, roundNumber, phase, teamId } },
    create: { engagementId, roundNumber, phase, teamId },
    update: { submittedAt: new Date() },
  });
}

/** Résout la phase dès que tous les camps engagés ont validé. */
async function maybeResolvePhase(engagementId: string) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: { participants: { include: { unit: { select: { status: true } } } } },
  });

  const livingTeams = new Set(
    engagement.participants.filter((p) => p.unit.status !== "SUNK").map((p) => p.teamId)
  );
  const phase = engagement.status === "AWAITING_MOVEMENT" ? "MOVEMENT" : "FIRE";
  const submissions = await prisma.tacticalSubmission.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase },
  });
  const submittedTeams = new Set(submissions.map((s) => s.teamId));

  const allIn = Array.from(livingTeams).every((t) => submittedTeams.has(t));
  if (!allIn) return { resolved: false as const, engagement };

  if (phase === "MOVEMENT") {
    await resolveMovementPhase(engagementId);
  } else {
    await resolveFirePhase(engagementId);
  }
  const updated = await prisma.tacticalEngagement.findUniqueOrThrow({ where: { id: engagementId } });
  return { resolved: true as const, engagement: updated };
}

// ── Résolution : mouvement ──────────────────────────────────

export async function resolveMovementPhase(engagementId: string) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: { participants: { include: { unit: true } } },
  });

  const moves = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "MOVEMENT" },
  });
  const moveByUnit = new Map(moves.map((m) => [m.unitId, m]));

  for (const p of engagement.participants) {
    if (p.unit.status === "SUNK") continue;
    const move = moveByUnit.get(p.unitId);
    if (!move) continue; // sans ordre : maintient sa position

    const path = Array.isArray(move.movementPath) ? (move.movementPath as unknown as LatLng[]) : [];
    if (path.length > 0) {
      const last = path[path.length - 1];
      const secondToLast = path.length > 1 ? path[path.length - 2] : { lat: p.unit.currentLat, lng: p.unit.currentLng };
      const heading = bearingDeg(secondToLast, last);
      await prisma.unit.update({
        where: { id: p.unitId },
        data: {
          currentLat: last.lat,
          currentLng: last.lng,
          currentHeadingDeg: heading,
          ...(move.depthBand ? { depthBand: move.depthBand } : {}),
        },
      });
    } else if (move.depthBand) {
      // Pas de mouvement mais changement d'immersion (ex: un sous-marin qui plonge sur place).
      await prisma.unit.update({ where: { id: p.unitId }, data: { depthBand: move.depthBand } });
    }
  }

  await prisma.tacticalAction.updateMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "MOVEMENT" },
    data: { resolved: true },
  });

  await recomputeContacts(engagementId, engagement.roundNumber);
  await prisma.tacticalEngagement.update({ where: { id: engagementId }, data: { status: "AWAITING_FIRE" } });
}

// ── Résolution : tir ────────────────────────────────────────

export async function resolveFirePhase(engagementId: string) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: {
      turn: { include: { weather: true } },
      participants: { include: { unit: { include: { unitClass: true } } } },
    },
  });
  const isNight = isNightWeather(
    engagement.turn.weather
      ? {
          visibilityNm: engagement.turn.weather.visibilityNm,
          seaState: engagement.turn.weather.seaState,
          daylight: engagement.turn.weather.daylight,
          precipitation: engagement.turn.weather.precipitation,
        }
      : null
  );

  const shots = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "FIRE" },
  });

  const byUnit = new Map(engagement.participants.map((p) => [p.unitId, p.unit]));
  // Santé tenue en mémoire : tous les tirs d'une manche sont simultanés, un
  // navire coulé pendant la manche a quand même tiré.
  const health = new Map<string, { current: number; max: number }>();
  const getHealth = (unitId: string) => {
    if (!health.has(unitId)) {
      const u = byUnit.get(unitId)!;
      health.set(unitId, { current: u.healthCurrent ?? u.healthMax ?? 1, max: u.healthMax ?? 1 });
    }
    return health.get(unitId)!;
  };

  for (const shot of shots) {
    const attacker = byUnit.get(shot.unitId);
    const target = shot.targetUnitId ? byUnit.get(shot.targetUnitId) : null;
    if (!attacker || !target || !shot.weaponType) continue;
    if (attacker.status === "SUNK") continue;

    const targetHealth = getHealth(target.id);
    if (targetHealth.current <= 0) continue;

    const attackerHealth = getHealth(attacker.id);
    const profile = attacker.unitClass.combatProfile as CombatProfile | null;
    const rangeM =
      distanceNm(
        { lat: attacker.currentLat, lng: attacker.currentLng },
        { lat: target.currentLat, lng: target.currentLng }
      ) * NM_TO_M;

    const targetSubmerged = target.unitClass.category === "SUBMARINE" && target.depthBand !== "SURFACE";

    let outcome: { hitChancePercent: number; hit: boolean; hits: number; damagePoints: number } | null = null;
    let calibreMm: number | null = null;
    let wakeVisible = true;

    if (shot.weaponType === "DEPTH_CHARGE") {
      if (!targetSubmerged || attacker.depthChargesRemaining == null) continue;
      const dc = resolveDepthChargeAttack({
        chargesAvailable: attacker.depthChargesRemaining,
        rangeM,
        maxRangeM: ASDIC_ATTACK_RANGE_M,
        targetDepthBand: target.depthBand as CombatDepthBand,
      });
      if (!dc) continue;
      outcome = { hitChancePercent: dc.hitChancePercent, hit: dc.hit, hits: dc.hit ? 1 : 0, damagePoints: dc.damagePoints };
      await prisma.unit.update({
        where: { id: attacker.id },
        data: { depthChargesRemaining: Math.max(0, attacker.depthChargesRemaining - dc.chargesUsed) },
      });
    } else if (shot.weaponType === "GUN") {
      if (targetSubmerged) continue; // un immergé n'est pas canonnable
      // Relèvement de la cible par rapport à la proue de l'attaquant : une
      // tourelle avant ne peut pas viser pile derrière, et inversement.
      const bearingToTarget = bearingDeg(
        { lat: attacker.currentLat, lng: attacker.currentLng },
        { lat: target.currentLat, lng: target.currentLng }
      );
      const relativeBearing = bearingToTarget - (attacker.currentHeadingDeg ?? 0);
      const battery = selectGunBattery(profile, rangeM, relativeBearing);
      calibreMm = battery?.calibreMm ?? null;
      if (!battery) continue; // à portée mais hors arc : aucune pièce ne peut viser
      const r = resolveGunEngagement({
        attackerProfile: profile,
        attackerHealthCurrent: attackerHealth.current,
        attackerHealthMax: attackerHealth.max,
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        targetBeamM: target.unitClass.beamMeters ?? 12,
        targetSpeedKnots: 0,
        rangeM,
        relativeBearingDeg: relativeBearing,
      });
      if (!r) continue;
      outcome = r;
    } else if (shot.weaponType === "TORPEDO") {
      if (targetSubmerged) continue;
      if (attacker.unitClass.category === "SUBMARINE" && (attacker.depthBand === "MEDIUM" || attacker.depthBand === "DEEP")) continue;
      if (attacker.torpedoesRemaining != null && attacker.torpedoesRemaining <= 0) continue;
      const battery = selectTorpedoBattery(profile, shot.torpedoTypeId);
      if (!battery) continue;
      // Tubes montés sur l'axe du navire : pas de tir devant/derrière (ou
      // uniquement devant pour un sous-marin, cf. arc "FORWARD" du U-Boot).
      const bearingToTarget = bearingDeg(
        { lat: attacker.currentLat, lng: attacker.currentLng },
        { lat: target.currentLat, lng: target.currentLng }
      );
      if (!isTorpedoArcClear(battery, bearingToTarget - (attacker.currentHeadingDeg ?? 0))) continue;
      wakeVisible = profile?.torpedoTypes?.find((t) => t.id === shot.torpedoTypeId)?.wakeVisible ?? true;
      const lineOfFire = bearingDeg(
        { lat: target.currentLat, lng: target.currentLng },
        { lat: attacker.currentLat, lng: attacker.currentLng }
      );
      const r = resolveTorpedoEngagement({
        attackerProfile: { ...profile, torpedoTubes: battery },
        attackerHealthCurrent: attackerHealth.current,
        attackerHealthMax: attackerHealth.max,
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        targetBeamM: target.unitClass.beamMeters ?? 12,
        targetSpeedKnots: 0,
        angleOfAttackDeg: lineOfFire - (target.currentHeadingDeg ?? 0),
        rangeM,
      });
      if (!r) continue;
      outcome = r;
      if (attacker.torpedoesRemaining != null) {
        await prisma.unit.update({
          where: { id: attacker.id },
          data: { torpedoesRemaining: Math.max(0, attacker.torpedoesRemaining - 1) },
        });
      }
    }

    if (!outcome) continue;

    if (outcome.hit) targetHealth.current = Math.max(0, targetHealth.current - outcome.damagePoints);
    const sunk = targetHealth.current <= 0;
    const damageRatio = targetHealth.max > 0 ? outcome.damagePoints / targetHealth.max : 0;

    const reveal = assessFiringReveal({
      weaponType: shot.weaponType,
      calibreMm,
      torpedoWakeVisible: wakeVisible,
      isNight,
    });

    await prisma.tacticalAction.update({
      where: { id: shot.id },
      data: {
        resolved: true,
        hit: outcome.hit,
        hits: outcome.hits,
        damagePoints: outcome.damagePoints,
        targetSunk: sunk,
        hitChancePercent: outcome.hitChancePercent,
        revealedShooter: reveal.revealRadiusNm > 0,
        narrative: describeShot({
          attackerName: attacker.name,
          targetName: target.name,
          weaponType: shot.weaponType,
          hit: outcome.hit,
          hits: outcome.hits,
          damagePoints: outcome.damagePoints,
          damageRatio,
          targetSunk: sunk,
          rangeNm: rangeM / NM_TO_M,
        }),
      },
    });
  }

  // Potentiel réajusté une fois tous les tirs de la manche résolus.
  for (const [unitId, h] of health) {
    await prisma.unit.update({
      where: { id: unitId },
      data: {
        healthCurrent: h.current,
        status: h.current <= 0 ? "SUNK" : h.current < h.max * 0.6 ? "DAMAGED" : "ACTIVE",
      },
    });
  }

  await advanceOrEnd(engagementId);
}

// ── Fin de manche : on continue ou on arrête ────────────────

async function advanceOrEnd(engagementId: string) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: { participants: { include: { unit: { include: { unitClass: true } } } } },
  });

  const alive = engagement.participants.filter((p) => p.unit.status !== "SUNK");
  const teamsAlive = new Set(alive.map((p) => p.teamId));
  if (teamsAlive.size < 2) {
    return endEngagement(engagementId, "ALL_ENEMIES_SUNK");
  }

  // Rupture de contact : plus rien en vue depuis assez longtemps.
  const recentRounds = Array.from(
    { length: ROUNDS_WITHOUT_CONTACT_TO_END },
    (_, i) => engagement.roundNumber - i
  ).filter((n) => n >= 1);
  const contactCount = await prisma.tacticalContact.count({
    where: { engagementId, roundNumber: { in: recentRounds } },
  });
  if (contactCount === 0 && engagement.roundNumber >= ROUNDS_WITHOUT_CONTACT_TO_END) {
    return endEngagement(engagementId, "CONTACT_LOST");
  }

  // Plus personne n'a de quoi tirer.
  const anyoneCanFight = alive.some((p) => {
    const profile = p.unit.unitClass.combatProfile as CombatProfile | null;
    if (profile?.guns?.length) return true;
    if (profile?.torpedoTubes && (p.unit.torpedoesRemaining == null || p.unit.torpedoesRemaining > 0)) return true;
    if (p.unit.depthChargesRemaining != null && p.unit.depthChargesRemaining >= 10) return true;
    return false;
  });
  if (!anyoneCanFight) {
    return endEngagement(engagementId, "OUT_OF_AMMUNITION");
  }

  // Durée de la manche à venir, sur la base de la portée déjà connue à
  // l'issue de la manche qui vient de se résoudre.
  const nextRoundMinutes = await computeNextRoundMinutes(engagementId, engagement.roundNumber, engagement.roundMinutes);

  await prisma.tacticalEngagement.update({
    where: { id: engagementId },
    data: { roundNumber: engagement.roundNumber + 1, status: "AWAITING_MOVEMENT", roundMinutes: nextRoundMinutes },
  });
  await recomputeContacts(engagementId, engagement.roundNumber + 1);
}

export async function endEngagement(
  engagementId: string,
  reason: "ALL_ENEMIES_SUNK" | "CONTACT_LOST" | "OUT_OF_AMMUNITION" | "ARBITER_ENDED" | "DISENGAGED"
) {
  await prisma.tacticalEngagement.update({
    where: { id: engagementId },
    data: { status: "RESOLVED", endReason: reason, endedAt: new Date() },
  });
}

// ── Interventions de l'arbitre ──────────────────────────────

export async function setEngagementPaused(engagementId: string, paused: boolean) {
  await prisma.tacticalEngagement.update({ where: { id: engagementId }, data: { arbiterPaused: paused } });
}

export async function setEngagementSyncMode(engagementId: string, syncMode: "SYNC" | "ASYNC") {
  await prisma.tacticalEngagement.update({ where: { id: engagementId }, data: { syncMode } });
}

export async function postTacticalMessage(params: {
  engagementId: string;
  kind: "CHAT" | "ARBITER_EVENT" | "SYSTEM";
  authorName: string;
  body: string;
  teamId?: string | null;
}) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({ where: { id: params.engagementId } });
  return prisma.tacticalMessage.create({
    data: {
      engagementId: params.engagementId,
      kind: params.kind,
      authorName: params.authorName,
      body: params.body,
      teamId: params.teamId ?? null,
      roundNumber: engagement.roundNumber,
    },
  });
}

/**
 * Avarie ou renfort injecté par l'arbitre : il peut retirer ou rendre du
 * potentiel à une unité pour matérialiser un événement (incendie qui gagne,
 * avarie de barre, équipe de réparation qui reprend le dessus…).
 */
export async function arbiterAdjustUnit(params: { unitId: string; healthDelta: number; note: string; engagementId: string }) {
  const unit = await prisma.unit.findUniqueOrThrow({ where: { id: params.unitId } });
  const max = unit.healthMax ?? 1;
  const next = Math.max(0, Math.min(max, (unit.healthCurrent ?? max) + params.healthDelta));
  await prisma.unit.update({
    where: { id: params.unitId },
    data: { healthCurrent: next, status: next <= 0 ? "SUNK" : next < max * 0.6 ? "DAMAGED" : "ACTIVE" },
  });
  await postTacticalMessage({
    engagementId: params.engagementId,
    kind: "ARBITER_EVENT",
    authorName: "Arbitre",
    body: `${unit.name} — ${params.note}`,
  });
}
