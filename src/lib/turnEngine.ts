import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildTimedTrack, distanceNm, pathLengthNm, speedBudgetNm, bearingDeg, type LatLng } from "@/lib/geo";
import { effectiveSensorRangeNm } from "@/lib/weather";
import {
  resolveGunEngagement,
  resolveTorpedoEngagement,
  resolveDepthChargeAttack,
  type CombatProfile,
  type DepthBand as CombatDepthBand,
} from "@/lib/combat";
import type { ArbiterStatus, SensorType, DepthBand } from "@/generated/prisma/client";

const NM_TO_M = 1852;
/** Portée effective d'une passe d'attaque aux grenades ASM (livret : ASDIC ~2000m). */
const ASDIC_ATTACK_RANGE_M = 2000;

/** Ordre des paliers d'immersion : un ordre ne peut déplacer l'unité que d'un cran. */
const DEPTH_BAND_ORDER: DepthBand[] = ["SURFACE", "SHALLOW", "MEDIUM", "DEEP"];

function isAdjacentDepthBand(current: DepthBand, requested: DepthBand): boolean {
  const from = DEPTH_BAND_ORDER.indexOf(current);
  const to = DEPTH_BAND_ORDER.indexOf(requested);
  return Math.abs(from - to) <= 1;
}

const SensorSchema = z.object({
  type: z.enum(["RADAR", "VISUAL", "HYDROPHONE", "SONAR", "OTHER"]),
  rangeNm: z.number().positive(),
});
const SensorsSchema = z.array(SensorSchema);

function parseSensors(sensorsJson: unknown) {
  return SensorsSchema.parse(sensorsJson);
}

/** Distance validation tolerance to absorb floating point rounding on the client. */
const BUDGET_TOLERANCE = 1.005;
/** Pas d'échantillonnage pour le calcul du point de rapprochement maximal (CPA). */
const CPA_SAMPLE_STEP_MINUTES = 2;

export class OrderValidationError extends Error {}

export type OrderValidationResult = {
  budgetNm: number;
  usedNm: number;
};

/**
 * Valide qu'un trajet (position actuelle + waypoints) tient dans le budget de
 * distance de l'unité pour la durée du tour. Lève `OrderValidationError` sinon.
 */
export function validateOrderPath(params: {
  currentPosition: LatLng;
  waypoints: LatLng[];
  speedKnots: number;
  maxSpeedKnots: number;
  turnDurationMinutes: number;
}): OrderValidationResult {
  const { currentPosition, waypoints, speedKnots, maxSpeedKnots, turnDurationMinutes } = params;

  if (speedKnots <= 0) throw new OrderValidationError("La vitesse doit être positive.");
  if (speedKnots > maxSpeedKnots) {
    throw new OrderValidationError(
      `Vitesse ${speedKnots}nds supérieure à la vitesse max de l'unité (${maxSpeedKnots}nds).`
    );
  }

  const budgetNm = speedBudgetNm(speedKnots, turnDurationMinutes);
  const usedNm = pathLengthNm([currentPosition, ...waypoints]);

  if (usedNm > budgetNm * BUDGET_TOLERANCE) {
    throw new OrderValidationError(
      `Trajet de ${usedNm.toFixed(1)}nm, budget disponible ${budgetNm.toFixed(1)}nm à ${speedKnots}nds.`
    );
  }

  return { budgetNm, usedNm };
}

/**
 * Enregistre l'ordre d'une unité pour un tour (remplace un éventuel ordre
 * précédent pour la même unité/tour), puis déclenche la résolution du tour si
 * toutes les unités actives ont désormais un ordre soumis.
 */
export async function saveUnitOrder(params: {
  turnId: string;
  unitId: string;
  submittedById: string;
  speedKnots: number;
  waypoints: LatLng[];
  depthBand?: DepthBand;
}) {
  const { turnId, unitId, submittedById, speedKnots, waypoints, depthBand } = params;

  const [turn, unit] = await Promise.all([
    prisma.turn.findUniqueOrThrow({ where: { id: turnId } }),
    prisma.unit.findUniqueOrThrow({ where: { id: unitId }, include: { unitClass: true } }),
  ]);

  if (turn.status !== "PENDING_ORDERS") {
    throw new OrderValidationError("Ce tour n'accepte plus d'ordres.");
  }
  if (!turn.weatherId) {
    throw new OrderValidationError("La météo du tour n'a pas encore été définie par l'arbitre.");
  }

  validateOrderPath({
    currentPosition: { lat: unit.currentLat, lng: unit.currentLng },
    waypoints,
    speedKnots,
    maxSpeedKnots: unit.unitClass.maxSpeedKnots,
    turnDurationMinutes: turn.durationMinutes,
  });

  if (depthBand) {
    if (unit.unitClass.category !== "SUBMARINE") {
      throw new OrderValidationError("Seul un sous-marin peut changer de palier d'immersion.");
    }
    if (!isAdjacentDepthBand(unit.depthBand, depthBand)) {
      throw new OrderValidationError(
        `Changement d'immersion impossible en un tour : ${unit.depthBand} → ${depthBand} (un seul palier à la fois).`
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.unitOrder.findUnique({ where: { turnId_unitId: { turnId, unitId } } });
    if (existing) {
      await tx.waypoint.deleteMany({ where: { orderId: existing.id } });
      await tx.unitOrder.delete({ where: { id: existing.id } });
    }

    await tx.unitOrder.create({
      data: {
        turnId,
        unitId,
        submittedById,
        speedKnots,
        depthBand,
        waypoints: {
          create: waypoints.map((wp, i) => ({ sequence: i, lat: wp.lat, lng: wp.lng })),
        },
      },
    });
  });

  await maybeResolveTurn(turnId);
}

/**
 * Demande le transfert d'une unité vers une autre flotte de la même équipe.
 * Ne prend effet qu'à la publication du tour en cours (voir `publishTurn`) :
 * historiquement, un tel changement passait par un ordre du commandement
 * transmis par signal (ex: le contre-amiral Fraser détachant quatre
 * destroyers de l'escorte de RA 55A pour rejoindre sa Force 2 pendant la
 * bataille du cap Nord), et le navire avait besoin de temps pour rallier sa
 * nouvelle formation — ce n'est jamais instantané.
 */
export async function requestFleetTransfer(params: { unitId: string; targetFleetId: string }) {
  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: params.unitId },
    select: { fleetId: true, fleet: { select: { teamId: true } } },
  });
  const targetFleet = await prisma.fleet.findUniqueOrThrow({ where: { id: params.targetFleetId } });

  if (targetFleet.teamId !== unit.fleet.teamId) {
    throw new OrderValidationError("Une unité ne peut être transférée que vers une flotte de sa propre équipe.");
  }
  if (params.targetFleetId === unit.fleetId) {
    throw new OrderValidationError("Cette unité appartient déjà à cette flotte.");
  }

  await prisma.unit.update({ where: { id: params.unitId }, data: { pendingFleetId: params.targetFleetId } });
}

export async function cancelFleetTransfer(unitId: string) {
  await prisma.unit.update({ where: { id: unitId }, data: { pendingFleetId: null } });
}

async function maybeResolveTurn(turnId: string) {
  const turn = await prisma.turn.findUniqueOrThrow({ where: { id: turnId } });
  if (turn.status !== "PENDING_ORDERS") return;

  const [activeUnitCount, orderCount] = await Promise.all([
    prisma.unit.count({ where: { scenarioId: turn.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } } }),
    prisma.unitOrder.count({ where: { turnId } }),
  ]);

  if (orderCount >= activeUnitCount) {
    await resolveTurnDetections(turnId);
  }
}

/**
 * Calcule les détections proposées pour un tour à partir des trajets
 * soumis, puis passe le tour en revue arbitre.
 */
export async function resolveTurnDetections(turnId: string) {
  const turn = await prisma.turn.update({
    where: { id: turnId },
    data: { status: "RESOLVING" },
    include: { weather: true },
  });
  if (!turn.weather) throw new Error("Météo du tour manquante.");

  const units = await prisma.unit.findMany({
    where: { scenarioId: turn.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } },
    include: {
      unitClass: true,
      fleet: { select: { teamId: true } },
      orders: { where: { turnId }, include: { waypoints: { orderBy: { sequence: "asc" } } } },
    },
  });

  const tracks = new Map<string, ReturnType<typeof buildTimedTrack>>();
  for (const unit of units) {
    const order = unit.orders[0];
    const points: LatLng[] = order
      ? [{ lat: unit.currentLat, lng: unit.currentLng }, ...order.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }))]
      : [{ lat: unit.currentLat, lng: unit.currentLng }];
    const speedKnots = order?.speedKnots ?? 0;
    tracks.set(unit.id, buildTimedTrack(points, speedKnots));
  }

  const sampleTimes = buildSampleTimes(turn.durationMinutes);

  // Toutes les paires observateur/cible sont évaluées en mémoire, puis
  // écrites en un seul aller-retour : la version précédente faisait un
  // upsert par paire détectée (potentiellement des centaines sur un grand
  // scénario), ce qui dominait le temps de résolution du tour — surtout
  // avec la latence réseau entre les fonctions Vercel et la base Neon.
  const detectionRows: {
    turnId: string;
    observerUnitId: string;
    targetUnitId: string;
    method: SensorType;
    cpaDistanceNm: number;
    cpaMinutesIntoTurn: number;
    observerLatAtCpa: number;
    observerLngAtCpa: number;
    targetLatAtCpa: number;
    targetLngAtCpa: number;
    systemProposed: boolean;
    arbiterStatus: ArbiterStatus;
  }[] = [];

  for (const observer of units) {
    for (const target of units) {
      if (observer.id === target.id) continue;
      if (observer.fleet.teamId === target.fleet.teamId) continue;

      const observerTrack = tracks.get(observer.id)!;
      const targetTrack = tracks.get(target.id)!;

      let cpa = { distanceNm: Infinity, minute: 0, observerPos: { lat: 0, lng: 0 }, targetPos: { lat: 0, lng: 0 } };
      for (const minute of sampleTimes) {
        const observerPos = observerTrack.positionAt(minute);
        const targetPos = targetTrack.positionAt(minute);
        const d = distanceNm(observerPos, targetPos);
        if (d < cpa.distanceNm) {
          cpa = { distanceNm: d, minute, observerPos, targetPos };
        }
      }

      const sensors = parseSensors(observer.unitClass.sensors);
      const observerSpeedKnots = observer.orders[0]?.speedKnots ?? 0;
      // Palier effectif de la cible ce tour : l'ordre du joueur (ex: plonger
      // en réaction à une détection précédente) prime sur la valeur figée du
      // tour d'avant, puisqu'il est soumis avant la résolution de ce tour.
      const targetDepthBand: DepthBand = target.orders[0]?.depthBand ?? target.depthBand;
      const targetSubmerged = target.unitClass.category === "SUBMARINE" && targetDepthBand !== "SURFACE";

      let best: { type: SensorType; margin: number } | null = null;
      for (const sensor of sensors) {
        // Un sous-marin immergé échappe entièrement au radar et au visuel :
        // seule une détection acoustique (hydrophone/ASDIC) reste possible.
        if (targetSubmerged && (sensor.type === "RADAR" || sensor.type === "VISUAL")) continue;
        const range = effectiveSensorRangeNm(
          sensor.type,
          sensor.rangeNm,
          turn.weather,
          target.unitClass.detectability,
          observerSpeedKnots
        );
        const margin = range - cpa.distanceNm;
        if (margin >= 0 && (!best || margin > best.margin)) {
          best = { type: sensor.type, margin };
        }
      }

      if (!best) continue;

      detectionRows.push({
        turnId,
        observerUnitId: observer.id,
        targetUnitId: target.id,
        method: best.type,
        cpaDistanceNm: cpa.distanceNm,
        cpaMinutesIntoTurn: cpa.minute,
        observerLatAtCpa: cpa.observerPos.lat,
        observerLngAtCpa: cpa.observerPos.lng,
        targetLatAtCpa: cpa.targetPos.lat,
        targetLngAtCpa: cpa.targetPos.lng,
        systemProposed: true,
        arbiterStatus: "PROPOSED",
      });
    }
  }

  await prisma.$transaction([
    ...(detectionRows.length > 0
      ? [prisma.detectionEvent.createMany({ data: detectionRows, skipDuplicates: true })]
      : []),
    prisma.turn.update({
      where: { id: turnId },
      data: { status: "PENDING_ARBITER_REVIEW", resolvedAt: new Date() },
    }),
  ]);
}

function buildSampleTimes(durationMinutes: number) {
  const times = new Set<number>();
  for (let m = 0; m <= durationMinutes; m += CPA_SAMPLE_STEP_MINUTES) times.add(m);
  times.add(durationMinutes);
  return Array.from(times).sort((a, b) => a - b);
}

/**
 * Un joueur de l'équipe observatrice demande le mode bataille tactique pour
 * cet engagement (vue rapprochée, voir /team/tactical/[id]) : ne fait rien
 * d'autre que poser un signal pour l'arbitre, qui reste libre d'en tenir
 * compte (ex: raccourcir le tour suivant pour une résolution plus fine).
 */
export async function requestTacticalMode(detectionEventId: string) {
  await prisma.detectionEvent.update({
    where: { id: detectionEventId },
    data: { tacticalModeRequested: true },
  });
}

/** L'arbitre marque une demande de mode tactique comme traitée (elle disparaît de son tableau de bord). */
export async function acknowledgeTacticalMode(detectionEventId: string) {
  await prisma.detectionEvent.update({
    where: { id: detectionEventId },
    data: { tacticalModeAcknowledged: true },
  });
}

export async function setDetectionStatus(detectionEventId: string, status: ArbiterStatus, note?: string) {
  await prisma.detectionEvent.update({
    where: { id: detectionEventId },
    data: { arbiterStatus: status, arbiterNote: note },
  });
}

export async function addManualDetection(params: {
  turnId: string;
  observerUnitId: string;
  targetUnitId: string;
  method: SensorType;
  note?: string;
}) {
  const { turnId, observerUnitId, targetUnitId, method, note } = params;
  const [observer, target] = await Promise.all([
    prisma.unit.findUniqueOrThrow({ where: { id: observerUnitId } }),
    prisma.unit.findUniqueOrThrow({ where: { id: targetUnitId } }),
  ]);

  await prisma.detectionEvent.upsert({
    where: { turnId_observerUnitId_targetUnitId: { turnId, observerUnitId, targetUnitId } },
    create: {
      turnId,
      observerUnitId,
      targetUnitId,
      method,
      cpaDistanceNm: distanceNm(
        { lat: observer.currentLat, lng: observer.currentLng },
        { lat: target.currentLat, lng: target.currentLng }
      ),
      cpaMinutesIntoTurn: 0,
      observerLatAtCpa: observer.currentLat,
      observerLngAtCpa: observer.currentLng,
      targetLatAtCpa: target.currentLat,
      targetLngAtCpa: target.currentLng,
      systemProposed: false,
      arbiterStatus: "ADDED_MANUALLY",
      arbiterNote: note,
    },
    update: {
      arbiterStatus: "ADDED_MANUALLY",
      arbiterNote: note,
    },
  });
}

export async function setTurnWeather(
  turnId: string,
  weather: {
    visibilityNm: number;
    seaState: number;
    daylight: string;
    precipitation: string;
    windKnots?: number;
    notes?: string;
    durationMinutes?: number;
  }
) {
  const turn = await prisma.turn.findUniqueOrThrow({ where: { id: turnId } });
  if (turn.status !== "PENDING_ORDERS") {
    throw new OrderValidationError("Ce tour n'est plus modifiable (ordres déjà en cours ou tour publié).");
  }
  const orderCount = await prisma.unitOrder.count({ where: { turnId } });
  if (orderCount > 0) {
    throw new OrderValidationError(
      "Ce tour n'est plus modifiable : des unités ont déjà soumis un ordre sur la base de ces paramètres."
    );
  }
  if (weather.durationMinutes !== undefined) {
    if (weather.durationMinutes <= 0) {
      throw new OrderValidationError("La durée du tour doit être positive.");
    }
    await prisma.turn.update({ where: { id: turnId }, data: { durationMinutes: weather.durationMinutes } });
  }
  await prisma.weather.upsert({
    where: { id: turn.weatherId ?? "__none__" },
    create: {
      visibilityNm: weather.visibilityNm,
      seaState: weather.seaState,
      daylight: weather.daylight as never,
      precipitation: weather.precipitation as never,
      windKnots: weather.windKnots,
      notes: weather.notes,
      turn: { connect: { id: turnId } },
    },
    update: {
      visibilityNm: weather.visibilityNm,
      seaState: weather.seaState,
      daylight: weather.daylight as never,
      precipitation: weather.precipitation as never,
      windKnots: weather.windKnots,
      notes: weather.notes,
    },
  });
}

/**
 * Fige les positions des unités ayant reçu un ordre, génère le rapport
 * filtré de chaque équipe, publie le tour et ouvre le suivant.
 */
export async function publishTurn(turnId: string) {
  const turn = await prisma.turn.findUniqueOrThrow({ where: { id: turnId }, include: { scenario: true } });
  if (turn.status !== "PENDING_ARBITER_REVIEW") {
    throw new Error("Ce tour n'est pas en attente de publication.");
  }

  const orders = await prisma.unitOrder.findMany({
    where: { turnId },
    include: { waypoints: { orderBy: { sequence: "asc" } } },
  });

  // Pré-charge en un seul aller-retour les positions actuelles des unités qui
  // en ont besoin (fallback "from" quand un ordre n'a qu'un seul waypoint),
  // au lieu d'un findUniqueOrThrow par unité dans la boucle : sur ~30 unités,
  // ça faisait dépasser le timeout par défaut des transactions Prisma (5s).
  const movedUnitIds = orders.filter((o) => o.waypoints.length > 0).map((o) => o.unitId);
  const currentPositions = new Map(
    (
      await prisma.unit.findMany({
        where: { id: { in: movedUnitIds } },
        select: { id: true, currentLat: true, currentLng: true },
      })
    ).map((u) => [u.id, u])
  );

  await prisma.$transaction(
    async (tx) => {
      for (const order of orders) {
        const data: {
          currentLat?: number;
          currentLng?: number;
          currentHeadingDeg?: number;
          lastResolvedTurn?: number;
          depthBand?: DepthBand;
        } = {};

        if (order.waypoints.length > 0) {
          const last = order.waypoints[order.waypoints.length - 1];
          const secondToLast = order.waypoints.length > 1 ? order.waypoints[order.waypoints.length - 2] : null;
          const current = currentPositions.get(order.unitId)!;
          const from = secondToLast ?? { lat: current.currentLat, lng: current.currentLng };
          data.currentLat = last.lat;
          data.currentLng = last.lng;
          data.currentHeadingDeg = bearingDeg(from, last);
          data.lastResolvedTurn = turn.number;
        }
        if (order.depthBand) data.depthBand = order.depthBand;

        if (Object.keys(data).length > 0) {
          await tx.unit.update({ where: { id: order.unitId }, data });
        }
      }

      const pendingTransfers = await tx.unit.findMany({
        where: { scenarioId: turn.scenarioId, pendingFleetId: { not: null } },
        select: { id: true, pendingFleetId: true },
      });
      for (const u of pendingTransfers) {
        await tx.unit.update({ where: { id: u.id }, data: { fleetId: u.pendingFleetId!, pendingFleetId: null } });
      }

      // Combat : suit directement la confirmation de détection par
      // l'arbitre (arbitrage hybride). Doit s'exécuter avant la génération
      // des rapports pour que les navires coulés/endommagés y apparaissent.
      await resolveCombat(tx, turnId);

      const teams = await tx.team.findMany({ where: { scenarioId: turn.scenarioId } });
      for (const team of teams) {
        await generateReportForTeam(tx, turnId, team.id);
      }

      await tx.turn.update({ where: { id: turnId }, data: { status: "PUBLISHED", publishedAt: new Date() } });

      await tx.turn.create({
        data: {
          scenarioId: turn.scenarioId,
          number: turn.number + 1,
          status: "PENDING_ORDERS",
          gameStartAt: new Date(turn.gameStartAt.getTime() + turn.durationMinutes * 60_000),
          durationMinutes: turn.scenario.defaultTurnMinutes,
        },
      });
    },
    { timeout: 20000 }
  );
}

function statusFromHealth(current: number, max: number): "ACTIVE" | "DAMAGED" | "SUNK" {
  if (current <= 0) return "SUNK";
  if (current < max * 0.6) return "DAMAGED";
  return "ACTIVE";
}

/**
 * Résout l'artillerie pour toutes les détections confirmées/ajoutées
 * manuellement du tour, à la distance de CPA déjà calculée pour la
 * détection. Torpilles/aviation/ASM : phases suivantes, pas encore
 * implémentées ici.
 *
 * Simplification V1 assumée : les engagements d'un même tour sont résolus
 * en une passe, dans l'ordre des détections — pas d'alternance par pas de
 * 5 minutes comme dans le livret original (p. 11). Concrètement, un navire
 * coulé plus tôt dans la passe ne riposte pas à une détection le visant
 * plus loin dans la liste, même si elle date du même tour. À affiner si le
 * jeu montre que l'ordre de résolution donne un avantage perceptible.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveCombat(tx: any, turnId: string) {
  const detections = await tx.detectionEvent.findMany({
    where: { turnId, arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] } },
    include: {
      observerUnit: { include: { unitClass: true } },
      targetUnit: { include: { unitClass: true } },
    },
  });
  if (detections.length === 0) return;

  const orders = await tx.unitOrder.findMany({
    where: { turnId },
    select: { unitId: true, speedKnots: true, depthBand: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speedByUnit = new Map(orders.map((o: any) => [o.unitId, o.speedKnots]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const depthOrderByUnit = new Map(orders.map((o: any) => [o.unitId, o.depthBand]));

  // PV tenus en mémoire pendant la résolution : plusieurs détections du
  // même tour peuvent viser la même cible, il faut cumuler les dégâts.
  const health = new Map<string, { current: number; max: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getHealth = (unit: any) => {
    if (!health.has(unit.id)) {
      health.set(unit.id, { current: unit.healthCurrent ?? unit.healthMax ?? 1, max: unit.healthMax ?? 1 });
    }
    return health.get(unit.id)!;
  };

  // Grenades ASM restantes tenues en mémoire pendant la résolution, pour le
  // même motif que `health` (plusieurs passes possibles dans le même tour).
  const charges = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getCharges = (unit: any) => {
    if (!charges.has(unit.id)) charges.set(unit.id, unit.depthChargesRemaining ?? 0);
    return charges.get(unit.id)!;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const combatRows: any[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of detections as any[]) {
    const attacker = d.observerUnit;
    const target = d.targetUnit;
    if (attacker.status === "SUNK" || target.status === "SUNK") continue;

    const attackerHealth = getHealth(attacker);
    const targetHealth = getHealth(target);
    if (attackerHealth.current <= 0 || targetHealth.current <= 0) continue;

    const targetSpeedKnots = (speedByUnit.get(target.id) as number | undefined) ?? 0;
    const rangeM = d.cpaDistanceNm * NM_TO_M;

    const targetDepthBand: DepthBand = depthOrderByUnit.get(target.id) ?? target.depthBand;
    const attackerDepthBand: DepthBand = depthOrderByUnit.get(attacker.id) ?? attacker.depthBand;
    const targetSubmerged = target.unitClass.category === "SUBMARINE" && targetDepthBand !== "SURFACE";

    if (targetSubmerged) {
      // Un sous-marin immergé échappe au canon et à la torpille classique :
      // seul un escorteur avec des grenades ASM en réserve, ayant repéré la
      // cible à l'oreille (hydrophone/ASDIC), peut l'attaquer.
      if ((d.method === "HYDROPHONE" || d.method === "SONAR") && attacker.depthChargesRemaining != null) {
        const chargesAvailable = getCharges(attacker);
        const dcResult = resolveDepthChargeAttack({
          chargesAvailable,
          rangeM,
          maxRangeM: ASDIC_ATTACK_RANGE_M,
          targetDepthBand: targetDepthBand as CombatDepthBand,
        });
        if (dcResult) {
          charges.set(attacker.id, chargesAvailable - dcResult.chargesUsed);
          if (dcResult.hit) targetHealth.current = Math.max(0, targetHealth.current - dcResult.damagePoints);
          combatRows.push({
            turnId,
            attackerUnitId: attacker.id,
            targetUnitId: target.id,
            weaponType: "DEPTH_CHARGE",
            rangeNm: d.cpaDistanceNm,
            hitChancePercent: dcResult.hitChancePercent,
            hits: dcResult.hit ? 1 : 0,
            damagePoints: dcResult.damagePoints,
            targetHealthLeft: targetHealth.current,
            targetSunk: targetHealth.current <= 0,
          });
        }
      }
      continue;
    }

    const combatProfile = attacker.unitClass.combatProfile as CombatProfile | null;
    if (!combatProfile?.guns?.length && !combatProfile?.torpedoTubes) continue;

    if (combatProfile.guns?.length) {
      const gunResult = resolveGunEngagement({
        attackerProfile: combatProfile,
        attackerHealthCurrent: attackerHealth.current,
        attackerHealthMax: attackerHealth.max,
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        targetBeamM: target.unitClass.beamMeters ?? 12,
        targetSpeedKnots,
        rangeM,
      });
      if (gunResult) {
        if (gunResult.hit) targetHealth.current = Math.max(0, targetHealth.current - gunResult.damagePoints);
        combatRows.push({
          turnId,
          attackerUnitId: attacker.id,
          targetUnitId: target.id,
          weaponType: "GUN",
          rangeNm: d.cpaDistanceNm,
          hitChancePercent: gunResult.hitChancePercent,
          hits: gunResult.hits,
          damagePoints: gunResult.damagePoints,
          targetHealthLeft: targetHealth.current,
          targetSunk: targetHealth.current <= 0,
        });
      }
    }

    // Les torpilles suivent le tir de canon dans la même passe (une cible
    // déjà coulée par l'artillerie n'est pas torpillée en plus). Un
    // sous-marin en immersion moyenne/grande ne peut pas utiliser ses
    // torpilles (livret) — seuls SURFACE et SHALLOW le permettent.
    const attackerCanTorpedo =
      attacker.unitClass.category !== "SUBMARINE" || attackerDepthBand === "SURFACE" || attackerDepthBand === "SHALLOW";

    if (combatProfile.torpedoTubes && targetHealth.current > 0 && attackerCanTorpedo) {
      // Angle entre le cap de la cible et la ligne de tir au moment du CPA
      // (les positions y sont déjà enregistrées pour la détection) —
      // « angle de tir » du livret (p. 6) : aigu si la cible approche,
      // obtus si elle s'éloigne.
      const lineOfFireBearing = bearingDeg(
        { lat: d.targetLatAtCpa, lng: d.targetLngAtCpa },
        { lat: d.observerLatAtCpa, lng: d.observerLngAtCpa }
      );
      const angleOfAttackDeg = lineOfFireBearing - (target.currentHeadingDeg ?? 0);

      const torpedoResult = resolveTorpedoEngagement({
        attackerProfile: combatProfile,
        attackerHealthCurrent: attackerHealth.current,
        attackerHealthMax: attackerHealth.max,
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        targetBeamM: target.unitClass.beamMeters ?? 12,
        targetSpeedKnots,
        angleOfAttackDeg,
        rangeM,
      });
      if (torpedoResult) {
        if (torpedoResult.hit) targetHealth.current = Math.max(0, targetHealth.current - torpedoResult.damagePoints);
        combatRows.push({
          turnId,
          attackerUnitId: attacker.id,
          targetUnitId: target.id,
          weaponType: "TORPEDO",
          rangeNm: d.cpaDistanceNm,
          hitChancePercent: torpedoResult.hitChancePercent,
          hits: torpedoResult.hits,
          damagePoints: torpedoResult.damagePoints,
          targetHealthLeft: targetHealth.current,
          targetSunk: targetHealth.current <= 0,
        });
      }
    }
  }

  if (combatRows.length > 0) {
    await tx.combatEvent.createMany({ data: combatRows });
  }

  for (const [unitId, h] of health) {
    await tx.unit.update({
      where: { id: unitId },
      data: { healthCurrent: h.current, status: statusFromHealth(h.current, h.max) },
    });
  }

  for (const [unitId, remaining] of charges) {
    await tx.unit.update({ where: { id: unitId }, data: { depthChargesRemaining: remaining } });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateReportForTeam(tx: any, turnId: string, teamId: string) {
  const ownUnits = await tx.unit.findMany({
    where: { fleet: { teamId } },
    select: {
      id: true,
      name: true,
      pennant: true,
      status: true,
      healthCurrent: true,
      healthMax: true,
      currentLat: true,
      currentLng: true,
      currentHeadingDeg: true,
      unitClass: { select: { name: true, iconKey: true, category: true, lengthMeters: true } },
    },
  });

  const detections = await tx.detectionEvent.findMany({
    where: {
      turnId,
      observerUnit: { fleet: { teamId } },
      arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] },
    },
    include: {
      observerUnit: { select: { id: true, name: true } },
      targetUnit: { select: { id: true, name: true, unitClass: { select: { name: true, iconKey: true, category: true } } } },
    },
  });

  const contacts = detections.map((d: (typeof detections)[number]) => ({
    detectionEventId: d.id,
    targetUnitId: d.targetUnitId,
    targetName: d.targetUnit.name,
    unitClassName: d.targetUnit.unitClass.name,
    category: d.targetUnit.unitClass.category,
    iconKey: d.targetUnit.unitClass.iconKey,
    lat: d.targetLatAtCpa,
    lng: d.targetLngAtCpa,
    method: d.method,
    cpaMinutesIntoTurn: d.cpaMinutesIntoTurn,
    observedBy: d.observerUnit.name,
    observerUnitId: d.observerUnitId,
  }));

  const combatEvents = await tx.combatEvent.findMany({
    where: {
      turnId,
      OR: [{ attackerUnit: { fleet: { teamId } } }, { targetUnit: { fleet: { teamId } } }],
    },
    include: {
      attackerUnit: { select: { id: true, name: true, fleet: { select: { teamId: true } } } },
      targetUnit: { select: { id: true, name: true, fleet: { select: { teamId: true } } } },
    },
  });

  const combats = combatEvents.map((c: (typeof combatEvents)[number]) => ({
    side: c.attackerUnit.fleet.teamId === teamId ? ("ATTACKER" as const) : ("TARGET" as const),
    attackerName: c.attackerUnit.name,
    targetName: c.targetUnit.name,
    weaponType: c.weaponType,
    hits: c.hits,
    damagePoints: Math.round(c.damagePoints * 10) / 10,
    targetSunk: c.targetSunk,
  }));

  await tx.report.upsert({
    where: { turnId_teamId: { turnId, teamId } },
    create: { turnId, teamId, ownUnits, contacts, combats },
    update: { ownUnits, contacts, combats },
  });
}
