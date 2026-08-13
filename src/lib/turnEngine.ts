import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildTimedTrack, distanceNm, pathLengthNm, speedBudgetNm, bearingDeg, destinationPoint, type LatLng } from "@/lib/geo";
import { effectiveSensorRangeNm } from "@/lib/weather";
import {
  resolveGunEngagement,
  resolveTorpedoEngagement,
  resolveDepthChargeAttack,
  type CombatProfile,
  type DepthBand as CombatDepthBand,
} from "@/lib/combat";
import type { ArbiterStatus, SensorType, DepthBand, SignalChannel } from "@/generated/prisma/client";

const NM_TO_M = 1852;
/** Portée effective d'une passe d'attaque aux grenades ASM (livret : ASDIC ~2000m). */
const ASDIC_ATTACK_RANGE_M = 2000;

/**
 * Autonomie sous-marine : la batterie se vide en (vitesse/4nds)^4 fois plus
 * vite qu'au régime économique de référence (calibré sur deux points réels
 * uboat.net : un Type VIIC tient ~20h à 4nds mais seulement ~1h à pleine
 * vitesse ~8nds immergé — (8/4)^4 = 16, proche du rapport observé 20/1).
 * L'oxygène/CO2, lui, se consomme au temps passé immergé quelle que soit la
 * vitesse (l'équipage respire pareil, vite ou lentement).
 */
const BATTERY_SPEED_EXPONENT = 4;
const BATTERY_REFERENCE_SPEED_KNOTS = 4;

/**
 * Un Kurzsignal (~20s d'antenne) réduit la portée effective de goniométrie
 * par rapport à un message long en Morse (conçu précisément pour passer
 * sous le temps nécessaire à un relèvement précis — voir la recherche
 * historique du projet, uboat.net/Kurzsignale). Modélisé comme une portée
 * d'interception réduite plutôt qu'une précision de relèvement séparée.
 */
const KURZSIGNAL_INTERCEPT_RANGE_RATIO = 0.35;

/**
 * Deux régimes bien distincts de goniométrie HF historiquement documentés
 * (voir la recherche du projet, uboat.net/allies/technical/hfdf.htm et
 * corvusintell.com/blog/sigint-rf/hf-direction-finding-network) :
 *  - onde de sol (un HF/DF embarqué sur un escorteur) : 15-25nm, relèvement
 *    quasi immédiat et précis — modélisée directement par le rangeNm du
 *    capteur, sans marge d'erreur.
 *  - onde réfléchie sur l'ionosphère (réseau de stations côtières
 *    triangulant à distance, ex: Islande/Écosse/Terre-Neuve) : des
 *    centaines à des milliers de milles, mais une position seulement
 *    approximative — une « boîte » d'incertitude de 10 à 30nm de côté une
 *    fois les relèvements recoupés, pas un point exact.
 * Au-delà de HF_DF_SKYWAVE_RANGE_THRESHOLD_NM, un capteur HF_DF est donc
 * traité comme un réseau à longue portée : la position rapportée est
 * déplacée aléatoirement dans un rayon HF_DF_SKYWAVE_JITTER_NM plutôt que
 * donnée exacte.
 */
const HF_DF_SKYWAVE_RANGE_THRESHOLD_NM = 60;
const HF_DF_SKYWAVE_JITTER_NM = 15;

/**
 * Durée d'un tour en mode bataille tactique. Le livret original résout le
 * combat par tranches de 5 minutes ; on reste dans cet ordre de grandeur
 * pour que manœuvres et tirs se jouent à l'échelle du combat plutôt qu'à
 * celle du transit (un tour de patrouille dure typiquement 1 à 4 heures).
 */
const TACTICAL_TURN_MINUTES = 10;

/**
 * Resserre l'échelle de temps du tour en cours : appelé dès qu'un
 * engagement tactique commence. Ne réduit jamais un tour déjà tactique, et
 * ne touche pas à un tour où des ordres ont déjà été soumis (ce serait
 * invalider des trajets déjà planifiés sur la durée précédente).
 */
export async function switchTurnToTacticalScale(turnId: string): Promise<boolean> {
  const turn = await prisma.turn.findUniqueOrThrow({ where: { id: turnId } });
  if (turn.tacticalMode || turn.status !== "PENDING_ORDERS") return false;

  const orderCount = await prisma.unitOrder.count({ where: { turnId } });
  if (orderCount > 0) return false;

  await prisma.turn.update({
    where: { id: turnId },
    data: { tacticalMode: true, durationMinutes: Math.min(turn.durationMinutes, TACTICAL_TURN_MINUTES) },
  });
  return true;
}

/** Ordre des paliers d'immersion : un ordre ne peut déplacer l'unité que d'un cran. */
const DEPTH_BAND_ORDER: DepthBand[] = ["SURFACE", "SHALLOW", "MEDIUM", "DEEP"];

function isAdjacentDepthBand(current: DepthBand, requested: DepthBand): boolean {
  const from = DEPTH_BAND_ORDER.indexOf(current);
  const to = DEPTH_BAND_ORDER.indexOf(requested);
  return Math.abs(from - to) <= 1;
}

const SensorSchema = z.object({
  type: z.enum(["RADAR", "VISUAL", "HYDROPHONE", "SONAR", "HF_DF", "OTHER"]),
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
  // Bloc 3 : marque cet ordre comme permanent — reconduit automatiquement
  // (même cap, même vitesse) chaque tour suivant jusqu'à ce qu'une
  // détection impliquant l'unité soit confirmée, ou annulation manuelle.
  // Une soumission sans ce drapeau annule un éventuel ordre permanent
  // précédent : reprendre la main manuellement redevient un ordre ponctuel.
  standing?: boolean;
}) {
  const { turnId, unitId, submittedById, speedKnots, waypoints, depthBand, standing } = params;

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

  const effectiveDepthBand = depthBand ?? unit.depthBand;
  if (unit.unitClass.category === "SUBMARINE" && effectiveDepthBand !== "SURFACE") {
    const turnDurationHours = turn.durationMinutes / 60;
    const oxygenRemaining = unit.oxygenHoursRemaining ?? unit.unitClass.oxygenEnduranceHours ?? 48;
    if (oxygenRemaining < turnDurationHours) {
      throw new OrderValidationError(
        `Autonomie en oxygène insuffisante pour rester immergé ce tour (${oxygenRemaining.toFixed(1)}h restantes) : il faut faire surface.`
      );
    }

    const baselineHours = (unit.unitClass.submergedRangeNmAt4kt ?? 80) / BATTERY_REFERENCE_SPEED_KNOTS;
    const consumptionRatio = Math.pow(Math.max(speedKnots, 0.1) / BATTERY_REFERENCE_SPEED_KNOTS, BATTERY_SPEED_EXPONENT);
    const batteryNeededPercent = baselineHours > 0 ? ((turnDurationHours * consumptionRatio) / baselineHours) * 100 : 0;
    const batteryRemaining = unit.batteryChargePercent ?? 100;
    if (batteryRemaining < batteryNeededPercent) {
      throw new OrderValidationError(
        `Batterie insuffisante pour tenir ce tour immergé à ${speedKnots}nds (${batteryRemaining.toFixed(0)}% restants) : il faut faire surface ou ralentir.`
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

    // Un ordre manuel dessiné à la main remplace toujours un éventuel plan
    // de vol de patrouille aérienne (le joueur reprend la main sur l'avion) ;
    // le statut "permanent" du cap tenu, lui, suit le drapeau `standing`.
    await tx.unit.update({
      where: { id: unitId },
      data: standing
        ? { standingOrderActive: true, standingOrderKind: "TRANSIT", standingSpeedKnots: speedKnots }
        : {
            standingOrderActive: false,
            standingOrderKind: null,
            standingSpeedKnots: null,
            airMissionState: null,
            airHomeLat: null,
            airHomeLng: null,
            airPatrolLat: null,
            airPatrolLng: null,
            fuelMinutesRemaining: null,
          },
    });
  });

  await checkTurnProgress(turnId);
}

/**
 * Ordre permanent de patrouille aérienne (bloc 3) — avions uniquement.
 * Lance immédiatement le premier décollage (ordre de ce tour vers la zone
 * de recherche) puis le cycle décollage → recherche → retour se reconduit
 * automatiquement tant que l'ordre reste actif (voir applyAirPatrolLeg).
 */
export async function saveAirPatrolOrder(params: { turnId: string; unitId: string; patrolPoint: LatLng }) {
  const { turnId, unitId, patrolPoint } = params;

  const [turn, unit] = await Promise.all([
    prisma.turn.findUniqueOrThrow({ where: { id: turnId } }),
    prisma.unit.findUniqueOrThrow({ where: { id: unitId }, include: { unitClass: true } }),
  ]);

  if (turn.status !== "PENDING_ORDERS") throw new OrderValidationError("Ce tour n'accepte plus d'ordres.");
  if (!turn.weatherId) throw new OrderValidationError("La météo du tour n'a pas encore été définie par l'arbitre.");
  if (unit.unitClass.category !== "AIRCRAFT") {
    throw new OrderValidationError("Seul un avion peut recevoir un ordre de patrouille aérienne.");
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.unitOrder.findUnique({ where: { turnId_unitId: { turnId, unitId } } });
    if (existing) {
      await tx.waypoint.deleteMany({ where: { orderId: existing.id } });
      await tx.unitOrder.delete({ where: { id: existing.id } });
    }

    await tx.unit.update({
      where: { id: unitId },
      data: {
        standingOrderActive: true,
        standingOrderKind: "AIR_PATROL",
        standingSpeedKnots: null,
        airMissionState: "OUTBOUND",
        // Base d'affectation si le scénario en définit une (voir
        // Unit.baseLat/Lng) — sinon repli sur la position courante, comme
        // avant : compatible avec les scénarios qui n'ont pas encore de
        // base distincte renseignée.
        airHomeLat: unit.baseLat ?? unit.currentLat,
        airHomeLng: unit.baseLng ?? unit.currentLng,
        airPatrolLat: patrolPoint.lat,
        airPatrolLng: patrolPoint.lng,
        fuelMinutesRemaining: unit.unitClass.enduranceMinutes ?? DEFAULT_ENDURANCE_MINUTES,
      },
    });
  });

  await applyAirPatrolLeg(turnId, turn.durationMinutes, unitId);
  await checkTurnProgress(turnId);
}

/**
 * Annule l'ordre permanent d'une unité (bloc 3). Pour une patrouille
 * aérienne en vol, l'avion termine sa jambe en cours puis rentre se poser
 * normalement (voir applyAirPatrolLeg) — il ne disparaît pas en plein vol,
 * il cesse seulement de redécoller une fois posé.
 */
export async function cancelStandingOrder(unitId: string) {
  const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } });
  if (unit.standingOrderKind === "AIR_PATROL" && unit.airMissionState && unit.airMissionState !== "RETURNING") {
    // En l'air, pas encore sur le chemin du retour : on le fait rentrer
    // dès la prochaine reconduction automatique plutôt que de l'arrêter net.
    await prisma.unit.update({ where: { id: unitId }, data: { standingOrderActive: false, airMissionState: "RETURNING" } });
    return;
  }
  await prisma.unit.update({
    where: { id: unitId },
    data: {
      standingOrderActive: false,
      standingOrderKind: null,
      standingSpeedKnots: null,
      airMissionState: null,
      airHomeLat: null,
      airHomeLng: null,
      airPatrolLat: null,
      airPatrolLng: null,
      fuelMinutesRemaining: null,
    },
  });
}

/** Longueur maximale d'un message en texte libre (visuel, TBS, W-T long). */
const SIGNAL_BODY_MAX_LENGTH = 500;
/** Un Kurzsignal est un code comprimé : quelques dizaines de caractères, pas un message rédigé. */
const KURZSIGNAL_BODY_MAX_LENGTH = 80;
const KURZSIGNAL_TYPES = ["CONTACT", "POSITION", "WEATHER"] as const;

/**
 * Envoie un message (bloc 4). Aucune validation de portée à l'émission : le
 * risque d'interception (goniométrie HF) se calcule à la résolution du tour
 * (voir resolveTurnDetections), pas ici — un joueur ne doit pas apprendre à
 * l'avance s'il va être repéré, sans quoi le choix du canal perdrait tout
 * son enjeu.
 */
export async function sendSignal(params: {
  turnId: string;
  teamId: string;
  senderUnitId: string;
  channel: SignalChannel;
  body: string;
  kurzsignalType?: string;
}) {
  const { turnId, teamId, senderUnitId, channel, body, kurzsignalType } = params;

  const [turn, unit] = await Promise.all([
    prisma.turn.findUniqueOrThrow({ where: { id: turnId } }),
    prisma.unit.findUniqueOrThrow({ where: { id: senderUnitId }, include: { fleet: true } }),
  ]);

  if (turn.status !== "PENDING_ORDERS") throw new OrderValidationError("Ce tour n'accepte plus de messages.");
  if (!turn.weatherId) throw new OrderValidationError("La météo du tour n'a pas encore été définie par l'arbitre.");
  if (unit.fleet.teamId !== teamId) throw new OrderValidationError("Cette unité n'appartient pas à votre équipe.");
  if (unit.status === "SUNK") throw new OrderValidationError("Cette unité a été coulée : elle ne peut plus émettre.");

  const trimmed = body.trim();
  if (trimmed.length === 0) throw new OrderValidationError("Le message est vide.");

  if (channel === "HF_KURZSIGNAL") {
    if (!kurzsignalType || !(KURZSIGNAL_TYPES as readonly string[]).includes(kurzsignalType)) {
      throw new OrderValidationError("Choisissez une forme standard pour un Kurzsignal (contact, position ou météo).");
    }
    if (trimmed.length > KURZSIGNAL_BODY_MAX_LENGTH) {
      throw new OrderValidationError(
        `Un Kurzsignal tient en ${KURZSIGNAL_BODY_MAX_LENGTH} caractères maximum (code comprimé) : ${trimmed.length} envoyés.`
      );
    }
  } else if (trimmed.length > SIGNAL_BODY_MAX_LENGTH) {
    throw new OrderValidationError(`Message trop long (${SIGNAL_BODY_MAX_LENGTH} caractères maximum) : ${trimmed.length} envoyés.`);
  }

  await prisma.signal.create({
    data: {
      turnId,
      teamId,
      senderUnitId,
      channel,
      kurzsignalType: channel === "HF_KURZSIGNAL" ? kurzsignalType : null,
      body: trimmed,
    },
  });
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

export async function checkTurnProgress(turnId: string) {
  // Reconduit d'abord les ordres permanents (bloc 3) : sans ça, un tour où
  // toutes les unités restantes sont en ordre permanent ne se résoudrait
  // jamais, faute d'atteindre activeUnitCount ordres soumis.
  await applyStandingOrders(turnId);

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

/** Autonomie de repli si l'avion n'a pas de UnitClass.enduranceMinutes renseigné. */
const DEFAULT_ENDURANCE_MINUTES = 240;
/** Régime de croisière retenu en patrouille automatique : on économise le
 * carburant plutôt que de foncer à pleine vitesse vers la zone de recherche. */
const AIR_PATROL_CRUISE_RATIO = 0.6;
/** Marge de sécurité (minutes) avant de faire demi-tour : on rentre dès que
 * le carburant restant ne couvre plus que le vol retour + cette marge. */
const AIR_PATROL_FUEL_MARGIN_MINUTES = 15;
/** Rayon du circuit de recherche autour du point de patrouille (nm). */
const AIR_PATROL_SEARCH_RADIUS_NM = 15;

/**
 * Reconduit automatiquement, pour un tour donné, les ordres permanents des
 * unités qui n'ont pas reçu d'ordre manuel ce tour-ci (bloc 3) : maintien
 * de cap/vitesse pour un TRANSIT, jambe suivante du cycle décollage →
 * recherche → retour pour un AIR_PATROL. Idempotente.
 */
async function applyStandingOrders(turnId: string) {
  const turn = await prisma.turn.findUniqueOrThrow({ where: { id: turnId } });
  if (turn.status !== "PENDING_ORDERS" || !turn.weatherId) return;

  const candidates = await prisma.unit.findMany({
    where: {
      scenarioId: turn.scenarioId,
      status: { in: ["ACTIVE", "DAMAGED"] },
      standingOrderActive: true,
      orders: { none: { turnId } },
    },
    select: { id: true, standingOrderKind: true },
  });

  for (const candidate of candidates) {
    if (candidate.standingOrderKind === "AIR_PATROL") {
      await applyAirPatrolLeg(turnId, turn.durationMinutes, candidate.id);
    } else {
      await applyTransitLeg(turnId, turn.durationMinutes, candidate.id);
    }
  }
}

/** Reconduit un ordre TRANSIT : même cap, même vitesse que le dernier ordre. */
async function applyTransitLeg(turnId: string, turnDurationMinutes: number, unitId: string) {
  const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId }, include: { unitClass: true } });
  const turnDurationHours = turnDurationMinutes / 60;

  let depthBand: DepthBand | undefined;
  if (unit.unitClass.category === "SUBMARINE" && unit.depthBand !== "SURFACE") {
    const oxygenRemaining = unit.oxygenHoursRemaining ?? unit.unitClass.oxygenEnduranceHours ?? 48;
    const baselineHours = (unit.unitClass.submergedRangeNmAt4kt ?? 80) / BATTERY_REFERENCE_SPEED_KNOTS;
    const consumptionRatio = Math.pow(
      Math.max(unit.standingSpeedKnots ?? 0, 0.1) / BATTERY_REFERENCE_SPEED_KNOTS,
      BATTERY_SPEED_EXPONENT
    );
    const batteryNeededPercent = baselineHours > 0 ? ((turnDurationHours * consumptionRatio) / baselineHours) * 100 : 0;
    const batteryRemaining = unit.batteryChargePercent ?? 100;

    if (oxygenRemaining < turnDurationHours || batteryRemaining < batteryNeededPercent) {
      // Autonomie insuffisante pour rester immergé sans surveillance :
      // remontée automatique, l'ordre permanent s'arrête là — le joueur
      // reprend la main au tour suivant plutôt que de tomber en panne.
      depthBand = "SURFACE";
      await prisma.unit.update({
        where: { id: unitId },
        data: { standingOrderActive: false, standingOrderKind: null, standingSpeedKnots: null },
      });
    }
  }

  const maxSpeed = unit.speedCapKnots ?? unit.unitClass.maxSpeedKnots;
  const speedKnots = Math.min(unit.standingSpeedKnots && unit.standingSpeedKnots > 0 ? unit.standingSpeedKnots : maxSpeed, maxSpeed);
  const budgetNm = speedBudgetNm(speedKnots, turnDurationMinutes);
  const destination = destinationPoint({ lat: unit.currentLat, lng: unit.currentLng }, unit.currentHeadingDeg ?? 0, budgetNm);

  await prisma.unitOrder.create({
    data: {
      turnId,
      unitId,
      speedKnots,
      depthBand,
      isStanding: true,
      waypoints: { create: [{ sequence: 0, lat: destination.lat, lng: destination.lng }] },
    },
  });
}

/**
 * Reconduit un ordre AIR_PATROL : décollage → recherche → retour. Consomme
 * le carburant du tour, décide du demi-tour dès que l'autonomie restante ne
 * couvre plus le trajet retour + marge, et relance un nouveau décollage dès
 * l'atterrissage si l'ordre permanent est toujours actif.
 */
async function applyAirPatrolLeg(turnId: string, turnDurationMinutes: number, unitId: string) {
  const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId }, include: { unitClass: true } });
  const turn = await prisma.turn.findUniqueOrThrow({ where: { id: turnId } });

  const cruiseSpeedKnots = unit.unitClass.maxSpeedKnots * AIR_PATROL_CRUISE_RATIO;
  const enduranceMinutes = unit.unitClass.enduranceMinutes ?? DEFAULT_ENDURANCE_MINUTES;
  const home: LatLng = { lat: unit.airHomeLat ?? unit.currentLat, lng: unit.airHomeLng ?? unit.currentLng };
  const patrolPoint: LatLng = { lat: unit.airPatrolLat ?? unit.currentLat, lng: unit.airPatrolLng ?? unit.currentLng };
  const current: LatLng = { lat: unit.currentLat, lng: unit.currentLng };

  const fuelRemaining = Math.max(0, (unit.fuelMinutesRemaining ?? enduranceMinutes) - turnDurationMinutes);
  const budgetNm = speedBudgetNm(cruiseSpeedKnots, turnDurationMinutes);

  let state = unit.airMissionState ?? "OUTBOUND";
  if (state !== "RETURNING") {
    const timeHomeMinutes = cruiseSpeedKnots > 0 ? (distanceNm(current, home) / cruiseSpeedKnots) * 60 : 0;
    if (fuelRemaining <= timeHomeMinutes + AIR_PATROL_FUEL_MARGIN_MINUTES) state = "RETURNING";
  }

  let destination: LatLng;
  let nextState: "OUTBOUND" | "SEARCHING" | "RETURNING" = state;
  let landed = false;

  if (state === "RETURNING") {
    const distanceHome = distanceNm(current, home);
    if (distanceHome <= budgetNm) {
      destination = home;
      landed = true;
    } else {
      destination = destinationPoint(current, bearingDeg(current, home), budgetNm);
    }
  } else if (state === "OUTBOUND") {
    const distanceToPatrol = distanceNm(current, patrolPoint);
    if (distanceToPatrol <= budgetNm) {
      destination = patrolPoint;
      nextState = "SEARCHING";
    } else {
      destination = destinationPoint(current, bearingDeg(current, patrolPoint), budgetNm);
    }
  } else {
    // SEARCHING : circuit de recherche en boîte autour du point de
    // patrouille — le cap tourne de 90° à chaque tour (déterminé par le
    // numéro de tour, pas d'état supplémentaire à stocker), pour une
    // trajectoire crédible plutôt qu'un vol stationnaire.
    const legBearing = (turn.number * 90) % 360;
    destination = destinationPoint(patrolPoint, legBearing, Math.min(AIR_PATROL_SEARCH_RADIUS_NM, budgetNm));
  }

  await prisma.$transaction(async (tx) => {
    await tx.unitOrder.create({
      data: {
        turnId,
        unitId,
        speedKnots: cruiseSpeedKnots,
        isStanding: true,
        waypoints: { create: [{ sequence: 0, lat: destination.lat, lng: destination.lng }] },
      },
    });

    if (landed) {
      const relaunch = unit.standingOrderActive;
      await tx.unit.update({
        where: { id: unitId },
        data: relaunch
          ? { airMissionState: "OUTBOUND", fuelMinutesRemaining: enduranceMinutes }
          : {
              standingOrderActive: false,
              standingOrderKind: null,
              airMissionState: null,
              airHomeLat: null,
              airHomeLng: null,
              airPatrolLat: null,
              airPatrolLng: null,
              fuelMinutesRemaining: null,
            },
      });
    } else {
      await tx.unit.update({
        where: { id: unitId },
        data: { airMissionState: nextState, fuelMinutesRemaining: fuelRemaining },
      });
    }
  });
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
        // La goniométrie HF (HF_DF) ne se déclenche jamais par simple
        // proximité : seulement par une émission radio adverse ce tour-ci
        // (voir la passe dédiée à la suite de cette boucle, sur Signal).
        if (sensor.type === "HF_DF") continue;
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

  // Goniométrie HF (bloc 4) : contrairement aux autres capteurs, ne dépend
  // pas d'une trajectoire mais d'un événement discret — une émission HF ce
  // tour-ci (voir Signal). Position des deux unités approximée par leur
  // position en DÉBUT de tour (units[].currentLat/Lng, pas encore mise à
  // jour par le mouvement de ce tour) : un signal est envoyé au moment de
  // la composition des ordres, avant que quiconque ait bougé.
  const hfSignals = await prisma.signal.findMany({
    where: { turnId, channel: { in: ["HF_LONG", "HF_KURZSIGNAL"] } },
    include: { senderUnit: { select: { currentLat: true, currentLng: true, fleet: { select: { teamId: true } } } } },
  });
  const interceptedSignalIds = new Set<string>();
  if (hfSignals.length > 0) {
    for (const signal of hfSignals) {
      const senderPos = { lat: signal.senderUnit.currentLat, lng: signal.senderUnit.currentLng };
      const senderTeamId = signal.senderUnit.fleet.teamId;

      for (const observer of units) {
        if (observer.fleet.teamId === senderTeamId) continue; // pas d'auto-interception côté allié
        const dfSensor = parseSensors(observer.unitClass.sensors).find((s) => s.type === "HF_DF");
        if (!dfSensor) continue;

        const rangeMultiplier = signal.channel === "HF_KURZSIGNAL" ? KURZSIGNAL_INTERCEPT_RANGE_RATIO : 1;
        const d = distanceNm({ lat: observer.currentLat, lng: observer.currentLng }, senderPos);
        if (d > dfSensor.rangeNm * rangeMultiplier) continue;

        // Réseau à longue portée (onde réfléchie) : position rapportée
        // approximative, pas la position réelle — voir HF_DF_SKYWAVE_*.
        const reportedPos =
          dfSensor.rangeNm > HF_DF_SKYWAVE_RANGE_THRESHOLD_NM
            ? destinationPoint(senderPos, Math.random() * 360, Math.random() * HF_DF_SKYWAVE_JITTER_NM)
            : senderPos;

        interceptedSignalIds.add(signal.id);
        detectionRows.push({
          turnId,
          observerUnitId: observer.id,
          targetUnitId: signal.senderUnitId,
          method: "HF_DF",
          cpaDistanceNm: d,
          cpaMinutesIntoTurn: 0,
          observerLatAtCpa: observer.currentLat,
          observerLngAtCpa: observer.currentLng,
          targetLatAtCpa: reportedPos.lat,
          targetLngAtCpa: reportedPos.lng,
          systemProposed: true,
          arbiterStatus: "PROPOSED",
        });
      }
    }
  }

  await prisma.$transaction([
    ...(detectionRows.length > 0
      ? [prisma.detectionEvent.createMany({ data: detectionRows, skipDuplicates: true })]
      : []),
    ...(interceptedSignalIds.size > 0
      ? [prisma.signal.updateMany({ where: { id: { in: Array.from(interceptedSignalIds) } }, data: { intercepted: true } })]
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
 * Tour actuellement ouvert du scénario auquel appartient `referenceTurnId`
 * (le premier tour non publié). Un tir tactique s'y rattache : la détection
 * qui l'a déclenché, elle, appartient au tour précédent déjà publié.
 */
export async function currentOpenTurn(referenceTurnId: string) {
  const reference = await prisma.turn.findUniqueOrThrow({
    where: { id: referenceTurnId },
    select: { scenarioId: true },
  });
  const open = await prisma.turn.findFirst({
    where: { scenarioId: reference.scenarioId, status: { not: "PUBLISHED" } },
    orderBy: { number: "asc" },
  });
  if (!open) throw new OrderValidationError("Aucun tour ouvert : attendez l'ouverture du tour suivant.");
  return open;
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

      // Autonomie sous-marine : dépend du palier d'immersion EFFECTIF de ce
      // tour, déjà écrit ci-dessus (Unit.depthBand reflète maintenant le
      // choix de ce tour, pas le précédent).
      const submarineUnits = await tx.unit.findMany({
        where: { scenarioId: turn.scenarioId, unitClass: { category: "SUBMARINE" }, status: { in: ["ACTIVE", "DAMAGED"] } },
        select: {
          id: true,
          depthBand: true,
          batteryChargePercent: true,
          oxygenHoursRemaining: true,
          unitClass: { select: { submergedRangeNmAt4kt: true, oxygenEnduranceHours: true } },
        },
      });
      const orderByUnitId = new Map(orders.map((o) => [o.unitId, o]));
      const turnDurationHours = turn.durationMinutes / 60;

      for (const sub of submarineUnits) {
        const oxygenMax = sub.unitClass.oxygenEnduranceHours ?? 48;

        if (sub.depthBand === "SURFACE") {
          // Recharge complète en surface : diesel pour la batterie, air frais pour l'équipage.
          await tx.unit.update({
            where: { id: sub.id },
            data: { batteryChargePercent: 100, oxygenHoursRemaining: oxygenMax },
          });
          continue;
        }

        const speedKnots = orderByUnitId.get(sub.id)?.speedKnots ?? 0;
        const baselineHours = (sub.unitClass.submergedRangeNmAt4kt ?? 80) / BATTERY_REFERENCE_SPEED_KNOTS;
        const consumptionRatio = Math.pow(Math.max(speedKnots, 0.1) / BATTERY_REFERENCE_SPEED_KNOTS, BATTERY_SPEED_EXPONENT);
        const hoursEquivalentUsed = turnDurationHours * consumptionRatio;
        const batteryUsedPercent = baselineHours > 0 ? (hoursEquivalentUsed / baselineHours) * 100 : 0;

        const newBattery = Math.max(0, (sub.batteryChargePercent ?? 100) - batteryUsedPercent);
        const newOxygen = Math.max(0, (sub.oxygenHoursRemaining ?? oxygenMax) - turnDurationHours);

        await tx.unit.update({
          where: { id: sub.id },
          data: { batteryChargePercent: newBattery, oxygenHoursRemaining: newOxygen },
        });
      }

      const pendingTransfers = await tx.unit.findMany({
        where: { scenarioId: turn.scenarioId, pendingFleetId: { not: null } },
        select: { id: true, pendingFleetId: true },
      });
      for (const u of pendingTransfers) {
        await tx.unit.update({ where: { id: u.id }, data: { fleetId: u.pendingFleetId!, pendingFleetId: null } });
      }

      // Ordres permanents « jusqu'à détection » (bloc 3) : une détection
      // confirmée ce tour, dans un sens ou dans l'autre, rend la main au
      // joueur — le cap tenu automatiquement s'arrête là. Ne concerne que
      // le maintien de cap (TRANSIT) : une patrouille aérienne continue son
      // cycle malgré une détection, puisque repérer l'adversaire est
      // justement sa mission.
      const confirmedDetections = await tx.detectionEvent.findMany({
        where: { turnId, arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] } },
        select: { observerUnitId: true, targetUnitId: true },
      });
      const detectedUnitIds = new Set(confirmedDetections.flatMap((d) => [d.observerUnitId, d.targetUnitId]));
      if (detectedUnitIds.size > 0) {
        await tx.unit.updateMany({
          where: { id: { in: Array.from(detectedUnitIds) }, standingOrderKind: "TRANSIT" },
          data: { standingOrderActive: false, standingOrderKind: null, standingSpeedKnots: null },
        });
      }

      // Pas de combat automatique à la publication : une détection
      // confirmée par l'arbitre ouvre seulement la possibilité de
      // s'engager (voir team/battle/open/[detectionId]) — c'est aux
      // joueurs de choisir d'ouvrir le feu, manuellement, en mode
      // tactique (voir tacticalEngine.ts). resolveCombat() ci-dessous
      // reste dans le fichier mais n'est plus appelée : conservée pour
      // référence/l'historique des CombatEvent déjà en base, pas comme
      // code mort à réactiver par erreur.

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
 *
 * N'EST PLUS APPELÉE depuis publishTurn (retour joueur : le premier tir ne
 * doit jamais partir tout seul à la confirmation d'une détection — c'est au
 * joueur de choisir de s'engager, manuellement, en mode tactique). Gardée
 * ici pour référence et parce que Report.combats (voir generateReportForTeam)
 * lit encore les CombatEvent qu'elle produisait ; à retirer si on décide un
 * jour de faire remonter les résultats d'un engagement tactique dans le
 * rapport stratégique par un autre mécanisme.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
async function resolveCombat(tx: any, turnId: string) {
  const detections = await tx.detectionEvent.findMany({
    where: { turnId, arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] } },
    include: {
      observerUnit: { include: { unitClass: true } },
      targetUnit: { include: { unitClass: true } },
    },
  });
  if (detections.length === 0) return;

  // Une arme déjà tirée ce tour-ci sur cette cible (typiquement un tir
  // manuel en mode tactique) ne doit pas l'être une seconde fois par cette
  // passe automatique. La garde porte sur le couple attaquant/cible plutôt
  // que sur l'identifiant de détection : un tir tactique se rattache au tour
  // courant tout en citant la détection du tour précédent qui l'a motivé.
  const alreadyFired = await tx.combatEvent.findMany({
    where: { turnId },
    select: { attackerUnitId: true, targetUnitId: true, weaponType: true },
  });
  const alreadyFiredSet = new Set(
    alreadyFired.map(
      (c: { attackerUnitId: string; targetUnitId: string; weaponType: string }) =>
        `${c.attackerUnitId}|${c.targetUnitId}|${c.weaponType}`
    )
  );
  const hasBeenFired = (attackerId: string, targetId: string, weaponType: string) =>
    alreadyFiredSet.has(`${attackerId}|${targetId}|${weaponType}`);

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

  // Torpilles restantes, même logique (une seule passe automatique par
  // détection et par tour, mais un même attaquant peut torpiller plusieurs
  // cibles ce tour-ci et doit voir son stock baisser à chaque tir).
  const torpedoStock = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getTorpedoStock = (unit: any) => {
    if (!torpedoStock.has(unit.id)) torpedoStock.set(unit.id, unit.torpedoesRemaining ?? Infinity);
    return torpedoStock.get(unit.id)!;
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
      if (
        !hasBeenFired(attacker.id, target.id, "DEPTH_CHARGE") &&
        (d.method === "HYDROPHONE" || d.method === "SONAR") &&
        attacker.depthChargesRemaining != null
      ) {
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
            detectionEventId: d.id,
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

    if (combatProfile.guns?.length && !hasBeenFired(attacker.id, target.id, "GUN")) {
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
          detectionEventId: d.id,
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

    const torpedoesLeft = getTorpedoStock(attacker);

    if (
      combatProfile.torpedoTubes &&
      targetHealth.current > 0 &&
      attackerCanTorpedo &&
      torpedoesLeft > 0 &&
      !hasBeenFired(attacker.id, target.id, "TORPEDO")
    ) {
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
        torpedoStock.set(attacker.id, torpedoesLeft - 1);
        if (torpedoResult.hit) targetHealth.current = Math.max(0, targetHealth.current - torpedoResult.damagePoints);
        combatRows.push({
          turnId,
          detectionEventId: d.id,
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

  for (const [unitId, remaining] of torpedoStock) {
    if (Number.isFinite(remaining)) {
      await tx.unit.update({ where: { id: unitId }, data: { torpedoesRemaining: remaining } });
    }
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
