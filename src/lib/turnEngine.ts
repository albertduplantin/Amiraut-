import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildTimedTrack, distanceNm, pathLengthNm, speedBudgetNm, bearingDeg, type LatLng } from "@/lib/geo";
import { effectiveSensorRangeNm } from "@/lib/weather";
import type { ArbiterStatus, SensorType } from "@/generated/prisma/client";

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
}) {
  const { turnId, unitId, submittedById, speedKnots, waypoints } = params;

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
    prisma.unit.count({ where: { scenarioId: turn.scenarioId, status: "ACTIVE" } }),
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
  await prisma.turn.update({ where: { id: turnId }, data: { status: "RESOLVING" } });

  const turn = await prisma.turn.findUniqueOrThrow({
    where: { id: turnId },
    include: { weather: true },
  });
  if (!turn.weather) throw new Error("Météo du tour manquante.");

  const units = await prisma.unit.findMany({
    where: { scenarioId: turn.scenarioId, status: "ACTIVE" },
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
      let best: { type: SensorType; margin: number } | null = null;
      for (const sensor of sensors) {
        const range = effectiveSensorRangeNm(sensor.type, sensor.rangeNm, turn.weather, target.unitClass.detectability);
        const margin = range - cpa.distanceNm;
        if (margin >= 0 && (!best || margin > best.margin)) {
          best = { type: sensor.type, margin };
        }
      }

      if (!best) continue;

      await prisma.detectionEvent.upsert({
        where: { turnId_observerUnitId_targetUnitId: { turnId, observerUnitId: observer.id, targetUnitId: target.id } },
        create: {
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
        },
        update: {
          method: best.type,
          cpaDistanceNm: cpa.distanceNm,
          cpaMinutesIntoTurn: cpa.minute,
          observerLatAtCpa: cpa.observerPos.lat,
          observerLngAtCpa: cpa.observerPos.lng,
          targetLatAtCpa: cpa.targetPos.lat,
          targetLngAtCpa: cpa.targetPos.lng,
        },
      });
    }
  }

  await prisma.turn.update({
    where: { id: turnId },
    data: { status: "PENDING_ARBITER_REVIEW", resolvedAt: new Date() },
  });
}

function buildSampleTimes(durationMinutes: number) {
  const times = new Set<number>();
  for (let m = 0; m <= durationMinutes; m += CPA_SAMPLE_STEP_MINUTES) times.add(m);
  times.add(durationMinutes);
  return Array.from(times).sort((a, b) => a - b);
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
        if (order.waypoints.length === 0) continue;
        const last = order.waypoints[order.waypoints.length - 1];
        const secondToLast = order.waypoints.length > 1 ? order.waypoints[order.waypoints.length - 2] : null;
        const current = currentPositions.get(order.unitId)!;
        const from = secondToLast ?? { lat: current.currentLat, lng: current.currentLng };

        await tx.unit.update({
          where: { id: order.unitId },
          data: {
            currentLat: last.lat,
            currentLng: last.lng,
            currentHeadingDeg: bearingDeg(from, last),
            lastResolvedTurn: turn.number,
          },
        });
      }

      const pendingTransfers = await tx.unit.findMany({
        where: { scenarioId: turn.scenarioId, pendingFleetId: { not: null } },
        select: { id: true, pendingFleetId: true },
      });
      for (const u of pendingTransfers) {
        await tx.unit.update({ where: { id: u.id }, data: { fleetId: u.pendingFleetId!, pendingFleetId: null } });
      }

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateReportForTeam(tx: any, turnId: string, teamId: string) {
  const ownUnits = await tx.unit.findMany({
    where: { fleet: { teamId } },
    select: {
      id: true,
      name: true,
      pennant: true,
      status: true,
      currentLat: true,
      currentLng: true,
      currentHeadingDeg: true,
      unitClass: { select: { name: true, iconKey: true, category: true } },
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
  }));

  await tx.report.upsert({
    where: { turnId_teamId: { turnId, teamId } },
    create: { turnId, teamId, ownUnits, contacts },
    update: { ownUnits, contacts },
  });
}
