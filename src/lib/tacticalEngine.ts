import "server-only";
import { prisma } from "@/lib/prisma";
import { distanceNm, bearingDeg, destinationPoint, pathLengthNm, speedBudgetNm, turnPenaltyNm, buildTimedTrack, type LatLng } from "@/lib/geo";
import { effectiveSensorRangeNm, type WeatherConditions } from "@/lib/weather";
import {
  resolveGunEngagement,
  resolveTorpedoEngagement,
  resolveDepthChargeAttack,
  resolveHedgehogAttack,
  resolveBombingEngagement,
  resolveAirCombatEngagement,
  resolveTorpedoSalvoIntercept,
  resolveStrafingEngagement,
  resolveDcaAttack,
  pilotSkillMultiplier,
  torpedoDangerZoneWidthM,
  DEFAULT_TORPEDO_RELIABILITY,
  rollLocalizedDamage,
  selectTorpedoBattery,
  isTorpedoArcClear,
  isInGunArc,
  ASDIC_ATTACK_RANGE_M,
  type CombatProfile,
  type DepthBand as CombatDepthBand,
  type HitChanceBreakdown,
  type TorpedoSpreadType,
} from "@/lib/combat";
import {
  describeShot,
  describeLocalizedEffect,
  describeMagazineHit,
  describeHitChanceDebug,
  describeLocalizedRollDebug,
  assessFiringReveal,
  type LocalizedEffectStored,
} from "@/lib/tacticalNarrative";
import { OrderValidationError, currentOpenTurn, switchTurnToTacticalScale } from "@/lib/turnEngine";
import { classifySilhouette, DEFAULT_TURNING_RADIUS_M, DEFAULT_ACCELERATION_KNOTS_PER_MIN } from "@/lib/shipSilhouettes";
import type { DepthBand, SensorType, WeaponType, TorpedoSpread as PrismaTorpedoSpread } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";

/** Précision réduite d'un tireur au télépointage endommagé (voir Unit.fireControlDamaged) — cas Bismarck, 27 mai 1941. */
const FIRE_CONTROL_DAMAGED_ACCURACY_MULTIPLIER = 0.7;
/** Vitesse plancher laissée à un navire dont la salle des machines a été touchée : jamais totalement paralysé par ce seul dégât. */
const MIN_SPEED_CAP_KNOTS = 5;

/** Choisit au hasard une pièce encore active de la cible à désactiver (une tourelle, sinon les tubes lance-torpilles) — null si plus rien à désactiver. */
function pickWeaponSlotToDisable(profile: CombatProfile | null | undefined, alreadyDisabled: string[]): string | null {
  const gunSlots = (profile?.guns ?? []).map((_, i) => gunWeaponSlot(i)).filter((s) => !alreadyDisabled.includes(s));
  if (gunSlots.length > 0) return gunSlots[Math.floor(Math.random() * gunSlots.length)];
  if (profile?.torpedoTubes && !alreadyDisabled.includes(TORPEDO_WEAPON_SLOT)) return TORPEDO_WEAPON_SLOT;
  return null;
}

const NM_TO_M = 1852;

/** Deux manches consécutives sans le moindre contact = rupture de contact. */
const ROUNDS_WITHOUT_CONTACT_TO_END = 2;

/** Repli quand aucune pièce principale n'est encore à portée de rien. */
const DEFAULT_ROUND_MINUTES = 5;

/** Repli si la classe n'a pas encore emergencyDiveSeconds renseigné (~moyenne toutes marines, voir UnitClass.emergencyDiveSeconds). */
const DEFAULT_EMERGENCY_DIVE_SECONDS = 45;

type SensorSpec = { type: SensorType; rangeNm: number };

function parseSensors(json: unknown): SensorSpec[] {
  return Array.isArray(json) ? (json as SensorSpec[]) : [];
}

function isNightWeather(w: WeatherConditions | null): boolean {
  return !w || w.daylight === "NIGHT" || w.daylight === "POLAR_NIGHT";
}

// ── Manœuvre : rayon de virage et accélération ──────────────
//
// Repli par TYPE de navire (destroyer/croiseur/cuirassé/sous-marin/cargo,
// déduit du nom de la classe comme pour les silhouettes) si une classe n'a
// pas encore ces champs renseignés individuellement — typiquement une
// nouvelle classe ajoutée sans recherche dédiée. Voir
// shipSilhouettes.ts (DEFAULT_TURNING_RADIUS_M/DEFAULT_ACCELERATION_KNOTS_PER_MIN)
// pour les valeurs et leur méthodologie, et prisma/seed.ts pour le détail
// par classe individuelle quand il existe.
export function defaultTurningRadiusM(category: string, className: string): number {
  return DEFAULT_TURNING_RADIUS_M[classifySilhouette(category, className)];
}
export function defaultAccelerationKnotsPerMin(category: string, className: string): number {
  return DEFAULT_ACCELERATION_KNOTS_PER_MIN[classifySilhouette(category, className)];
}

/**
 * Vitesse de référence d'une unité pour cette manche : celle qu'elle avait
 * juste avant (dernière manche tactique jouée, ou dernier ordre
 * stratégique si c'est la toute première manche du combat) — sert à la
 * fois de valeur par défaut affichée au joueur et de base pour le
 * plafonnement par accélération. Traite plusieurs unités en une passe
 * (évite N allers-retours base pour l'écran d'ordres).
 */
export async function getLastKnownSpeedsByUnit(
  engagementId: string,
  unitIds: string[],
  currentRoundNumber: number
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (unitIds.length === 0) return result;

  if (currentRoundNumber > 1) {
    const priorMoves = await prisma.tacticalAction.findMany({
      where: { engagementId, phase: "MOVEMENT", roundNumber: { lt: currentRoundNumber }, unitId: { in: unitIds } },
      orderBy: { roundNumber: "desc" },
      select: { unitId: true, speedKnots: true },
    });
    for (const m of priorMoves) {
      if (!result.has(m.unitId) && m.speedKnots != null) result.set(m.unitId, m.speedKnots);
    }
  }

  const missingUnitIds = unitIds.filter((id) => !result.has(id));
  if (missingUnitIds.length > 0) {
    const lastOrders = await Promise.all(
      missingUnitIds.map((unitId) =>
        prisma.unitOrder.findFirst({ where: { unitId }, orderBy: { submittedAt: "desc" }, select: { unitId: true, speedKnots: true } })
      )
    );
    for (const o of lastOrders) if (o) result.set(o.unitId, o.speedKnots);
  }

  return result;
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

  // Le feu tactique n'est plus un simple transit : le tour stratégique
  // (habituellement des heures) se resserre à l'échelle du combat.
  await switchTurnToTacticalScale(params.turnId);

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
    const guns = profile?.guns ?? [];
    if (guns.length === 0) continue;
    const rangeM = c.distanceNm * NM_TO_M;
    // Seule la pièce principale (le plus gros calibre du bord) fixe le
    // rythme des manches : une DCA à 10 coups/minute donnerait des manches
    // de quelques secondes, injouables.
    const mainCalibreMm = Math.max(...guns.map((g) => g.calibreMm));
    for (const gun of guns) {
      if (gun.calibreMm !== mainCalibreMm) continue;
      // Défensif : une classe d'unité instanciée avant l'ajout de la cadence
      // de tir (`roundsPerMinute`) au modèle peut encore porter un profil de
      // combat sans ce champ — l'ignorer plutôt que propager un NaN jusqu'à
      // l'écriture en base (Prisma rejette alors la valeur comme "manquante").
      if (typeof gun.roundsPerMinute !== "number" || !Number.isFinite(gun.roundsPerMinute) || gun.roundsPerMinute <= 0) continue;
      if (gun.rangeM >= rangeM && (fastestRpm === null || gun.roundsPerMinute > fastestRpm)) {
        fastestRpm = gun.roundsPerMinute;
      }
    }
  }
  if (fastestRpm === null || fastestRpm <= 0) return fallback;
  // `roundMinutes` est un Int en base : on arrondit ici plutôt que de risquer
  // une valeur fractionnaire (ex. 60/7 ≈ 8,57) rejetée par Prisma.
  const minutes = Math.round(Math.max(MIN_ROUND_MINUTES, Math.min(MAX_ROUND_MINUTES, 60 / fastestRpm)));
  return Number.isFinite(minutes) ? minutes : fallback;
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
    targetLatSnapshot: number;
    targetLngSnapshot: number;
  }[] = [];

  // Grenades ASM tirées à la manche précédente : le SONAR (écoute active)
  // de l'escorteur qui a attaqué reste sourd cette manche-ci, le temps de
  // reprendre l'écoute après avoir dû passer au-dessus de sa cible — voir
  // Unit.sonarBlindNextRound et submitTacticalFireShot. Remis à false une
  // fois consommé, mais PAS ici : `advanceOrEnd` appelle déjà cette fonction
  // en prévisualisation dès le passage à la manche N+1 (avant tout
  // mouvement), et `resolveMovementPhase` la rappelle ensuite pour de vrai
  // une fois les positions réelles connues — remettre le drapeau à false ici
  // le viderait dès le premier appel, avant que la manche qui compte n'ait
  // eu l'occasion de le lire. Voir resolveMovementPhase, seul endroit où il
  // est effectivement consommé.

  for (const observer of engagement.participants) {
    if (observer.unit.status === "SUNK") continue;
    const sensors = parseSensors(observer.unit.unitClass.sensors);
    const sonarBlind = observer.unit.sonarBlindNextRound;

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
        // La goniométrie HF (HF_DF) ne se déclenche jamais par simple
        // proximité, seulement par une émission radio adverse — voir
        // turnEngine.ts (resolveTurnDetections) pour l'équivalent côté tour
        // stratégique. Les signaux (/team/comms) se composent à l'échelle du
        // TOUR, pas de la manche tactique : pas encore de mécanique
        // d'interception à ce grain-là, donc HF_DF reste inerte ici plutôt
        // que de se déclencher à tort par simple distance (bug constaté à
        // l'ajout du premier HF_DF sur une unité engagée tactiquement, voir
        // scénario PQ-18).
        if (sensor.type === "HF_DF") continue;
        // Immergé : ni radar ni visuel, seulement l'écoute.
        if (targetSubmerged && (sensor.type === "RADAR" || sensor.type === "VISUAL")) continue;
        // Contact ASDIC actif rompu par une attaque aux grenades ASM la manche précédente (Hedgehog non concerné, voir plus haut).
        if (sonarBlind && sensor.type === "SONAR") continue;
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
          targetLatSnapshot: target.unit.currentLat,
          targetLngSnapshot: target.unit.currentLng,
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

/**
 * Enregistre (ou met à jour) le mouvement d'UN navire pour la manche en
 * cours — sans marquer l'équipe comme prête : peut être rappelé plusieurs
 * fois pour le même navire (le joueur change d'avis) ou pour des navires
 * différents, dans l'ordre qu'il veut, tant que `finishMovementPhase` n'a
 * pas été appelé.
 */
/**
 * Vitesse min/max qu'une unité peut effectivement atteindre CETTE manche,
 * compte tenu de sa vitesse précédente et de son accélération/décélération
 * maximale (jamais instantanée) — partagé entre la validation serveur et
 * l'affichage client (voir page.tsx), pour que les deux s'accordent
 * toujours sur les mêmes bornes.
 */
export function reachableSpeedRange(params: {
  lastSpeedKnots: number;
  accelKnotsPerMin: number;
  roundMinutes: number;
  effectiveMaxSpeedKnots: number;
}): { minReachable: number; maxReachable: number } {
  const maxDelta = params.accelKnotsPerMin * params.roundMinutes;
  return {
    minReachable: Math.max(0, params.lastSpeedKnots - maxDelta),
    maxReachable: Math.min(params.effectiveMaxSpeedKnots, params.lastSpeedKnots + maxDelta),
  };
}

/**
 * Enregistre (ou met à jour) le mouvement d'UN navire pour la manche en
 * cours — sans marquer l'équipe comme prête : peut être rappelé plusieurs
 * fois pour le même navire (le joueur change d'avis) ou pour des navires
 * différents, dans l'ordre qu'il veut, tant que `finishMovementPhase` n'a
 * pas été appelé.
 *
 * Pas de vitesse choisie séparément (retour joueur : un curseur de vitesse
 * est redondant avec le tracé) — la vitesse est DÉDUITE de la longueur du
 * trajet dessiné (distance ÷ durée de la manche), et doit tomber dans la
 * fourchette atteignable compte tenu de l'accélération ET de la
 * décélération maximales (aucune des deux n'est instantanée) : un trajet
 * trop court est refusé exactement comme un trajet trop long, plutôt que
 * d'être silencieusement corrigé à la place du joueur.
 */
export async function submitTacticalMovementForUnit(params: {
  engagementId: string;
  teamId: string;
  unitId: string;
  path: LatLng[];
  depthBand?: DepthBand;
}) {
  const engagement = await assertEngagementOpen(params.engagementId, "AWAITING_MOVEMENT");
  const lastSpeedByUnit = await getLastKnownSpeedsByUnit(params.engagementId, [params.unitId], engagement.roundNumber);

  const participant = await prisma.tacticalParticipant.findUnique({
    where: { engagementId_unitId: { engagementId: params.engagementId, unitId: params.unitId } },
    include: { unit: { include: { unitClass: true } } },
  });
  if (!participant || participant.teamId !== params.teamId) {
    throw new OrderValidationError("Cette unité ne participe pas à cet engagement pour votre camp.");
  }

  // Une avarie de machines (voir Unit.speedCapKnots, cas Scharnhorst au cap
  // Nord) plafonne la vitesse en dessous du maximum théorique de la classe.
  const effectiveMaxSpeedKnots =
    participant.unit.speedCapKnots != null
      ? Math.min(participant.unit.unitClass.maxSpeedKnots, participant.unit.speedCapKnots)
      : participant.unit.unitClass.maxSpeedKnots;

  // Accélération/décélération : la vitesse ne peut changer que d'un écart
  // plafonné par manche (recherche historique, voir prisma/seed.ts) — un
  // cuirassé ne passe pas de 10 à 28 nds en 5 minutes, et inversement ne
  // s'arrête pas net non plus.
  const accelKnotsPerMin =
    participant.unit.unitClass.accelerationKnotsPerMin ??
    defaultAccelerationKnotsPerMin(participant.unit.unitClass.category, participant.unit.unitClass.name);
  const lastSpeed = lastSpeedByUnit.get(params.unitId) ?? 0;
  const { minReachable, maxReachable: maxReachableBeforeDive } = reachableSpeedRange({
    lastSpeedKnots: lastSpeed,
    accelKnotsPerMin,
    roundMinutes: engagement.roundMinutes,
    effectiveMaxSpeedKnots,
  });

  // Plongée d'urgence (voir UnitClass.emergencyDiveSeconds, recherche
  // 2026-08-14) : le temps passé à plonger n'est pas disponible pour faire
  // route — un sous-marin qui plonge depuis la surface cette manche voit son
  // budget de vitesse max réduit à due proportion du temps de plongée dans
  // la durée de la manche (jamais totalement immobilisé : au-delà de sa
  // plongée, il continue sur son erre).
  const isDivingThisRound =
    participant.unit.unitClass.category === "SUBMARINE" &&
    participant.unit.depthBand === "SURFACE" &&
    params.depthBand != null &&
    params.depthBand !== "SURFACE";
  const maxReachable = isDivingThisRound
    ? maxReachableBeforeDive *
      (1 -
        Math.min(
          0.9,
          (participant.unit.unitClass.emergencyDiveSeconds ?? DEFAULT_EMERGENCY_DIVE_SECONDS) / (engagement.roundMinutes * 60)
        ))
    : maxReachableBeforeDive;

  const turningRadiusNm =
    (participant.unit.unitClass.turningRadiusM ?? defaultTurningRadiusM(participant.unit.unitClass.category, participant.unit.unitClass.name)) /
    NM_TO_M;
  const start = { lat: participant.unit.currentLat, lng: participant.unit.currentLng };

  let effectivePath: LatLng[];
  let impliedSpeedKnots: number;

  if (participant.unit.rudderJammed) {
    // Gouvernail bloqué (voir Unit.rudderJammed, cas Bismarck 24 mai 1941) :
    // le navire ne peut plus choisir sa route, seulement sa vitesse — le cap
    // du trajet envoyé par le client est ignoré, on ne garde que sa distance
    // totale (jusqu'où le joueur a voulu pousser les machines), imposée en
    // ligne droite dans le cap actuel. Faute de pouvoir gouverner, on
    // simplifie en supposant qu'il pousse à pleine vitesse disponible.
    impliedSpeedKnots = maxReachable;
    const budgetNm = speedBudgetNm(impliedSpeedKnots, engagement.roundMinutes);
    effectivePath = budgetNm > 0 ? [destinationPoint(start, participant.unit.currentHeadingDeg ?? 0, budgetNm)] : [];
  } else {
    const fullPath = [start, ...params.path];
    const usedNm = pathLengthNm(fullPath) + turnPenaltyNm(fullPath, turningRadiusNm);
    impliedSpeedKnots = usedNm / (engagement.roundMinutes / 60);
    if (impliedSpeedKnots > maxReachable + 0.05) {
      throw new OrderValidationError(
        `${participant.unit.name} : trajet de ${usedNm.toFixed(2)}nm impliquant ${impliedSpeedKnots.toFixed(0)}nds, trop rapide (accélération max ${accelKnotsPerMin.toFixed(1)}nds/min depuis ${lastSpeed.toFixed(0)}nds, max atteignable ${maxReachable.toFixed(0)}nds ce tour-ci).`
      );
    }
    if (impliedSpeedKnots < minReachable - 0.05) {
      const minNm = speedBudgetNm(minReachable, engagement.roundMinutes);
      throw new OrderValidationError(
        `${participant.unit.name} : trajet de ${usedNm.toFixed(2)}nm trop court — ce navire ne peut pas ralentir en dessous de ${minReachable.toFixed(0)}nds ce tour-ci (décélération max ${accelKnotsPerMin.toFixed(1)}nds/min depuis ${lastSpeed.toFixed(0)}nds), il doit parcourir au moins ${minNm.toFixed(2)}nm.`
      );
    }
    effectivePath = params.path;
  }

  await prisma.tacticalAction.upsert({
    where: {
      engagementId_roundNumber_phase_unitId_weaponSlot: {
        engagementId: params.engagementId,
        roundNumber: engagement.roundNumber,
        phase: "MOVEMENT",
        unitId: params.unitId,
        weaponSlot: "",
      },
    },
    create: {
      engagementId: params.engagementId,
      roundNumber: engagement.roundNumber,
      phase: "MOVEMENT",
      unitId: params.unitId,
      teamId: params.teamId,
      speedKnots: impliedSpeedKnots,
      movementPath: effectivePath,
      depthBand: params.depthBand,
    },
    update: { speedKnots: impliedSpeedKnots, movementPath: effectivePath, depthBand: params.depthBand },
  });

  return { speedKnots: impliedSpeedKnots };
}

/**
 * L'équipe annonce qu'elle a fini de positionner ses navires cette manche ;
 * la manche se résout dès que les deux camps l'ont fait. Un navire jamais
 * explicitement repositionné garde sa position (choix valide, symétrique
 * du "garder le feu" en phase de tir) — voir `resolveMovementPhase`.
 */
export async function finishMovementPhase(params: { engagementId: string; teamId: string }) {
  const engagement = await assertEngagementOpen(params.engagementId, "AWAITING_MOVEMENT");
  await markSubmitted(params.engagementId, engagement.roundNumber, "MOVEMENT", params.teamId);
  return maybeResolvePhase(params.engagementId);
}

export type FireShotResult = {
  hit: boolean;
  hits: number;
  damagePoints: number;
  hitChancePercent: number;
  /** Tirage au sort (0-100) : touché si en-dessous de `hitChancePercent`. Affiché aux joueurs pour rendre le jet transparent. */
  hitRoll: number;
  narrative: string;
  /** Détail des calculs (précision + tirage de localisation), à des fins de débogage — voir tacticalNarrative.ts. */
  debugInfo: string | null;
  revealRadiusNm: number;
};

/**
 * Résout un tir immédiatement à la validation, pour un compte rendu
 * instantané — mais n'inflige les dégâts qu'à la résolution de la phase
 * (voir `resolveFirePhase`) : le potentiel réel de la cible en base ne
 * bouge pas tant que les deux camps n'ont pas fini de tirer, pour que tous
 * les tirs de la manche restent simultanés (on ne sait pas encore, en
 * tirant, si la cible a déjà encaissé un autre coup ailleurs).
 */
/** Identifie une pièce précise dans `combatProfile.guns[]` (ex: "gun:0") ou la batterie de torpilles / les grenades ASM. */
export function gunWeaponSlot(gunIndex: number): string {
  return `gun:${gunIndex}`;
}
export const TORPEDO_WEAPON_SLOT = "torpedo";
export const DEPTH_CHARGE_WEAPON_SLOT = "depth_charge";
export const HEDGEHOG_WEAPON_SLOT = "hedgehog";
export const BOMB_WEAPON_SLOT = "bomb";

function parseGunSlotIndex(weaponSlot: string): number | null {
  if (!weaponSlot.startsWith("gun:")) return null;
  const index = Number(weaponSlot.slice(4));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export async function submitTacticalFireShot(params: {
  engagementId: string;
  teamId: string;
  unitId: string;
  targetUnitId: string;
  weaponType: WeaponType;
  /** Quelle pièce précise du bord tire — voir `gunWeaponSlot`/`TORPEDO_WEAPON_SLOT`/`DEPTH_CHARGE_WEAPON_SLOT`. Un navire peut faire tirer chacune de ses pièces séparément la même manche. */
  weaponSlot: string;
  torpedoTypeId?: string;
}): Promise<FireShotResult> {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({
    where: { id: params.engagementId },
    include: { turn: { include: { weather: true } } },
  });
  if (engagement.status === "RESOLVED") throw new OrderValidationError("Cet engagement est terminé.");
  if (engagement.arbiterPaused) throw new OrderValidationError("L'arbitre a suspendu le combat.");
  if (engagement.status !== "AWAITING_FIRE") throw new OrderValidationError("Ce n'est pas la phase de tir.");

  const participant = await prisma.tacticalParticipant.findUnique({
    where: { engagementId_unitId: { engagementId: params.engagementId, unitId: params.unitId } },
    include: { unit: { include: { unitClass: true } } },
  });
  if (!participant || participant.teamId !== params.teamId) {
    throw new OrderValidationError("Cette unité ne participe pas à cet engagement pour votre camp.");
  }
  const attacker = participant.unit;
  if (attacker.status === "SUNK") throw new OrderValidationError("Cette unité est coulée.");

  const alreadyFired = await prisma.tacticalAction.findUnique({
    where: {
      engagementId_roundNumber_phase_unitId_weaponSlot: {
        engagementId: params.engagementId,
        roundNumber: engagement.roundNumber,
        phase: "FIRE",
        unitId: params.unitId,
        weaponSlot: params.weaponSlot,
      },
    },
  });
  if (alreadyFired) throw new OrderValidationError(`${attacker.name} : cette pièce a déjà tiré cette manche.`);
  if (attacker.disabledWeaponSlots.includes(params.weaponSlot)) {
    throw new OrderValidationError(`${attacker.name} : cette pièce est hors service.`);
  }

  // On ne tire que sur ce que son camp a détecté à l'issue du mouvement.
  const contact = await prisma.tacticalContact.findFirst({
    where: {
      engagementId: params.engagementId,
      roundNumber: engagement.roundNumber,
      observerTeamId: params.teamId,
      targetUnitId: params.targetUnitId,
    },
  });
  if (!contact) throw new OrderValidationError("Cible non détectée par votre camp à cette manche.");

  const target = await prisma.unit.findUniqueOrThrow({ where: { id: params.targetUnitId }, include: { unitClass: true } });
  if (target.status === "SUNK") throw new OrderValidationError("Cette cible est déjà coulée.");

  const profile = attacker.unitClass.combatProfile as CombatProfile | null;
  const rangeM =
    distanceNm({ lat: attacker.currentLat, lng: attacker.currentLng }, { lat: target.currentLat, lng: target.currentLng }) *
    NM_TO_M;
  const targetSubmerged = target.unitClass.category === "SUBMARINE" && target.depthBand !== "SURFACE";

  const attackerHealthCurrent = attacker.healthCurrent ?? attacker.healthMax ?? 1;
  const attackerHealthMax = attacker.healthMax ?? 1;

  let outcome:
    | { hitChancePercent: number; hitRoll: number; hit: boolean; hits: number; damagePoints: number; hitChanceBreakdown?: HitChanceBreakdown }
    | null = null;
  let calibreMm: number | null = null;
  let wakeVisible = true;
  // Télépointage endommagé (voir Unit.fireControlDamaged, cas Bismarck 27
  // mai 1941) : pénalise toute solution de tir au canon ou à la torpille,
  // pas les grenades ASM (résolues à l'oreille, pas à l'optique).
  const accuracyMultiplier = attacker.fireControlDamaged ? FIRE_CONTROL_DAMAGED_ACCURACY_MULTIPLIER : 1;
  // Niveau de l'équipage (avions uniquement, voir UnitClass.pilotSkill) —
  // composé avec accuracyMultiplier ci-dessus pour les seuls tirs air-air/
  // bombardement/mitraillage, jamais pour l'artillerie ou les torpilles de
  // navire/sous-marin (recherche 2026-08-14, Amirauté 2013 §4.6.3.1).
  const pilotSkillFactor = attacker.unitClass.category === "AIRCRAFT" ? pilotSkillMultiplier(attacker.unitClass.pilotSkill) : 1;
  const airAttackAccuracyMultiplier = accuracyMultiplier * pilotSkillFactor;

  // ── DCA : riposte automatique d'un navire (ou sous-marin en surface)
  // ciblé par un avion ──────────────────────────────────────────────────
  // (bombardement, torpille aérienne, mitraillage — voir resolveDcaAttack
  // dans combat.ts) — résolue AVANT l'attaque elle-même : un avion abattu
  // avant d'avoir largué/tiré ne fait en principe pas de dégâts, sauf le
  // tirage à ~50% qui le laisse quand même achever sa passe (Amirauté 2013
  // §4.6.2.4). Ne concerne que les attaques avion → cible de surface,
  // jamais l'inverse — et jamais un sous-marin immergé (voir targetSubmerged
  // plus haut), qui n'a pas de pièce à l'air libre pour riposter. Un U-Boot
  // équipé de flak peut ainsi abattre l'avion qui l'attaque en surface, cas
  // historique bien documenté (ex. combats du golfe de Gascogne, 1943,
  // recherche 2026-08-14).
  let dcaNarrative: string | null = null;
  let dcaAbortsAttack = false;
  if (attacker.unitClass.category === "AIRCRAFT" && (target.unitClass.category === "SURFACE_SHIP" || (target.unitClass.category === "SUBMARINE" && !targetSubmerged))) {
    const targetProfile = target.unitClass.combatProfile as CombatProfile | null;
    const aaBattery = targetProfile?.antiAircraft;
    if (aaBattery) {
      const dca = resolveDcaAttack({
        battery: aaBattery,
        targetAgility: attacker.unitClass.agility,
        targetLengthM: attacker.unitClass.lengthMeters,
      });
      if (dca.hit) {
        const attackerHealthAfter = Math.max(0, attackerHealthCurrent - dca.damagePoints);
        const destroyed = attackerHealthAfter <= 0;
        await prisma.unit.update({
          where: { id: attacker.id },
          data: {
            healthCurrent: attackerHealthAfter,
            status: destroyed ? "SUNK" : attackerHealthAfter < attackerHealthMax * 0.6 ? "DAMAGED" : "ACTIVE",
          },
        });
        if (destroyed) {
          dcaAbortsAttack = Math.random() >= 0.5;
          dcaNarrative = dcaAbortsAttack
            ? `La DCA de ${target.name} abat ${attacker.name} avant qu'il ait pu achever son attaque.`
            : `La DCA de ${target.name} touche ${attacker.name} à mort, mais l'appareil a le temps d'achever sa passe avant de s'écraser.`;
        } else {
          dcaNarrative = `La DCA de ${target.name} touche ${attacker.name} au passage — l'appareil encaisse mais poursuit son attaque.`;
        }
      }
    }
  }

  if (params.weaponType === "DEPTH_CHARGE") {
    if (!targetSubmerged) throw new OrderValidationError("Les grenades ASM ne visent qu'un sous-marin immergé.");
    const dc = resolveDepthChargeAttack({
      chargesAvailable: attacker.depthChargesRemaining ?? 0,
      rangeM,
      maxRangeM: ASDIC_ATTACK_RANGE_M,
      targetDepthBand: target.depthBand as CombatDepthBand,
    });
    if (!dc) throw new OrderValidationError("Pas assez de grenades ASM à bord pour une passe.");
    outcome = { hitChancePercent: dc.hitChancePercent, hitRoll: dc.hitRoll, hit: dc.hit, hits: dc.hit ? 1 : 0, damagePoints: dc.damagePoints };
    await prisma.unit.update({
      where: { id: attacker.id },
      data: {
        depthChargesRemaining: Math.max(0, (attacker.depthChargesRemaining ?? 0) - dc.chargesUsed),
        // L'escorteur doit passer directement au-dessus de sa cible pour
        // larguer ses grenades : le contact ASDIC actif se rompt le temps de
        // la passe, à la différence du Hedgehog (voir HEDGEHOG ci-dessous) —
        // consommé puis remis à false par recomputeContacts à la manche
        // suivante.
        sonarBlindNextRound: true,
      },
    });
  } else if (params.weaponType === "HEDGEHOG") {
    if (!targetSubmerged) throw new OrderValidationError("Le Hedgehog ne vise qu'un sous-marin immergé.");
    const hh = resolveHedgehogAttack({
      roundsAvailable: attacker.hedgehogRoundsRemaining ?? 0,
      rangeM,
      maxRangeM: ASDIC_ATTACK_RANGE_M,
      targetDepthBand: target.depthBand as CombatDepthBand,
    });
    if (!hh) throw new OrderValidationError("Plus de salve de Hedgehog à bord.");
    outcome = { hitChancePercent: hh.hitChancePercent, hitRoll: hh.hitRoll, hit: hh.hit, hits: hh.hit ? 1 : 0, damagePoints: hh.damagePoints };
    await prisma.unit.update({
      where: { id: attacker.id },
      data: { hedgehogRoundsRemaining: Math.max(0, (attacker.hedgehogRoundsRemaining ?? 0) - hh.roundsUsed) },
      // Pas de sonarBlindNextRound ici : le Hedgehog tire vers l'avant sans
      // jamais rompre l'écoute ASDIC — c'est tout l'intérêt de l'arme.
    });
  } else if (params.weaponType === "GUN" && target.unitClass.category === "AIRCRAFT") {
    // Combat air-air : même WeaponType GUN que l'artillerie navale (une
    // mitrailleuse/un canon d'avion reste une "pièce" au sens du modèle),
    // mais la cible est un autre avion — formule dédiée (voir
    // airCombatHitChanceBreakdown dans combat.ts), pas de notion d'arc ou
    // de portée graduée à cette échelle. Sert aussi bien à un chasseur qui
    // attaque qu'à un bombardier/hydravion qui riposte à la mitrailleuse
    // flexible depuis sa tourelle.
    const gunIndex = parseGunSlotIndex(params.weaponSlot);
    const battery = gunIndex !== null ? (profile?.guns?.[gunIndex] ?? null) : null;
    if (!battery) throw new OrderValidationError("Cette pièce est introuvable sur cet avion.");
    calibreMm = battery.calibreMm;
    const targetProfile = target.unitClass.combatProfile as CombatProfile | null;
    outcome = resolveAirCombatEngagement({
      attackerAgility: attacker.unitClass.agility,
      defenderAgility: target.unitClass.agility,
      defenderHasDefensiveGuns: (targetProfile?.guns?.length ?? 0) > 0,
      // Niveau d'équipage des deux côtés : celui de l'attaquant multiplie sa
      // précision, celui du défenseur la divise (un pilote d'élite en
      // défense encaisse moins qu'un débutant, voir combat.ts).
      accuracyMultiplier: airAttackAccuracyMultiplier / pilotSkillMultiplier(target.unitClass.pilotSkill),
    });
  } else if (
    params.weaponType === "GUN" &&
    attacker.unitClass.category === "AIRCRAFT" &&
    (target.unitClass.category === "SURFACE_SHIP" || (target.unitClass.category === "SUBMARINE" && !targetSubmerged))
  ) {
    // Mitraillage/roquettes : un avion qui attaque un navire de surface (ou
    // un sous-marin EN SURFACE — mitraillage de suppression avant/pendant
    // une passe de grenadage, cas historique bien documenté contre les
    // U-Boote du golfe de Gascogne en 1943) au canon/à la roquette plutôt
    // qu'à la bombe ou à la torpille — très précis mais presque sans effet
    // contre un bâtiment de tonnage significatif (voir
    // resolveStrafingEngagement, combat.ts). Recherche 2026-08-14, Amirauté
    // 2013 §4.6.3.6.
    const gunIndex = parseGunSlotIndex(params.weaponSlot);
    const battery = gunIndex !== null ? (profile?.guns?.[gunIndex] ?? null) : null;
    if (!battery) throw new OrderValidationError("Cette pièce est introuvable sur cet avion.");
    calibreMm = battery.calibreMm;
    if (dcaAbortsAttack) {
      outcome = { hitChancePercent: 0, hitRoll: 100, hit: false, hits: 0, damagePoints: 0 };
    } else {
      const strafe = resolveStrafingEngagement({
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        accuracyMultiplier: airAttackAccuracyMultiplier,
      });
      outcome = { ...strafe, hits: strafe.hit ? 1 : 0 };
    }
  } else if (params.weaponType === "BOMB") {
    // Une bombe/grenade ASM larguée par avion vise un navire de surface ou
    // un sous-marin EN SURFACE (jamais immergé — targetSubmerged plus haut,
    // même règle que les grenades ASM/Hedgehog embarqués) : c'est très
    // exactement la lutte anti-sous-marine aérienne historique (Sunderland/
    // Catalina contre U-Boot pris en surface, recherche 2026-08-14).
    // resolveBombingEngagement (combat.ts) reste inchangée — sa dépendance
    // à targetBeamM rend déjà un U-Boot (~6-9m de large) mécaniquement plus
    // dur à toucher qu'un navire de guerre, sans formule dédiée nécessaire.
    if (target.unitClass.category !== "SURFACE_SHIP" && !(target.unitClass.category === "SUBMARINE" && !targetSubmerged)) {
      throw new OrderValidationError("Une bombe/grenade ASM aérienne ne vise qu'un navire de surface ou un sous-marin en surface.");
    }
    outcome = dcaAbortsAttack
      ? { hitChancePercent: 0, hitRoll: 100, hit: false, hits: 0, damagePoints: 0 }
      : resolveBombingEngagement({
          attackerProfile: profile,
          attackerHealthCurrent,
          attackerHealthMax,
          targetLengthM: target.unitClass.lengthMeters ?? 100,
          targetBeamM: target.unitClass.beamMeters ?? 12,
          targetSpeedKnots: 0,
          accuracyMultiplier: airAttackAccuracyMultiplier,
        });
  } else if (params.weaponType === "GUN") {
    if (targetSubmerged) throw new OrderValidationError("Un sous-marin immergé n'est pas canonnable.");
    const gunIndex = parseGunSlotIndex(params.weaponSlot);
    const battery = gunIndex !== null ? (profile?.guns?.[gunIndex] ?? null) : null;
    if (!battery) throw new OrderValidationError("Cette pièce est introuvable sur ce navire.");
    const bearingToTarget = bearingDeg(
      { lat: attacker.currentLat, lng: attacker.currentLng },
      { lat: target.currentLat, lng: target.currentLng }
    );
    const relativeBearing = bearingToTarget - (attacker.currentHeadingDeg ?? 0);
    calibreMm = battery.calibreMm;
    if (battery.rangeM < rangeM) throw new OrderValidationError("Cette pièce est hors de portée pour cette cible.");
    if (!isInGunArc(battery.arc, relativeBearing)) throw new OrderValidationError("Cette pièce est hors de son arc de tir pour cette cible.");
    outcome = resolveGunEngagement({
      attackerProfile: profile,
      attackerHealthCurrent,
      attackerHealthMax,
      targetLengthM: target.unitClass.lengthMeters ?? 100,
      targetBeamM: target.unitClass.beamMeters ?? 12,
      targetSpeedKnots: 0,
      rangeM,
      relativeBearingDeg: relativeBearing,
      forcedBattery: battery,
      accuracyMultiplier,
    });
  } else if (params.weaponType === "TORPEDO") {
    // Torpille de NAVIRE/SOUS-MARIN : plus résolue ici depuis la refonte
    // 2026-08-14 (voir fireTorpedoSalvo/advanceTorpedoSalvos) — une torpille
    // met plusieurs minutes à atteindre sa cible, largement plus qu'une
    // manche tactique, et doit donc pouvoir être esquivée par un
    // changement de cap après le lancement, ce qu'une résolution
    // instantanée en phase de tir ne permet jamais. Seule la torpille
    // AÉRIENNE (larguée à quelques centaines de mètres, temps de trajet
    // négligeable) reste sur ce chemin instantané.
    if (attacker.unitClass.category !== "AIRCRAFT") {
      throw new OrderValidationError(
        "Les torpilles de navire/sous-marin se tirent désormais en phase de mouvement (cap + largeur de salve), pas ici."
      );
    }
    if (target.unitClass.category === "AIRCRAFT") throw new OrderValidationError("Une torpille ne vise pas un avion — torpille aérienne ou pas, la cible reste un navire.");
    if (targetSubmerged) throw new OrderValidationError("Une torpille classique ne touche pas un sous-marin immergé.");
    if (attacker.torpedoesRemaining != null && attacker.torpedoesRemaining <= 0) {
      throw new OrderValidationError("Plus aucune torpille à bord.");
    }
    const battery = selectTorpedoBattery(profile, params.torpedoTypeId);
    if (!battery) throw new OrderValidationError("Aucun tube lance-torpilles disponible.");
    const bearingToTarget = bearingDeg(
      { lat: attacker.currentLat, lng: attacker.currentLng },
      { lat: target.currentLat, lng: target.currentLng }
    );
    if (!isTorpedoArcClear(battery, bearingToTarget - (attacker.currentHeadingDeg ?? 0))) {
      throw new OrderValidationError("Cette cible est hors de l'arc de tir des tubes lance-torpilles.");
    }
    wakeVisible = profile?.torpedoTypes?.find((t) => t.id === params.torpedoTypeId)?.wakeVisible ?? true;
    const lineOfFire = bearingDeg(
      { lat: target.currentLat, lng: target.currentLng },
      { lat: attacker.currentLat, lng: attacker.currentLng }
    );
    // Un appareil abattu par la DCA avant d'avoir largué (voir plus haut) ne
    // consomme pas sa torpille — elle n'a jamais quitté les soutes.
    outcome = dcaAbortsAttack
      ? { hitChancePercent: 0, hitRoll: 100, hit: false, hits: 0, damagePoints: 0 }
      : resolveTorpedoEngagement({
          attackerProfile: { ...profile, torpedoTubes: battery },
          attackerHealthCurrent,
          attackerHealthMax,
          targetLengthM: target.unitClass.lengthMeters ?? 100,
          targetBeamM: target.unitClass.beamMeters ?? 12,
          targetSpeedKnots: 0,
          angleOfAttackDeg: lineOfFire - (target.currentHeadingDeg ?? 0),
          rangeM,
          accuracyMultiplier: airAttackAccuracyMultiplier,
        });
    if (!dcaAbortsAttack && outcome && attacker.torpedoesRemaining != null) {
      await prisma.unit.update({
        where: { id: attacker.id },
        data: { torpedoesRemaining: Math.max(0, attacker.torpedoesRemaining - 1) },
      });
    }
  } else {
    throw new OrderValidationError("Type d'arme inconnu.");
  }

  if (!outcome) throw new OrderValidationError("Ce tir n'est pas possible dans ces conditions.");

  // Potentiel de la cible EN DÉBUT DE MANCHE (rien de cette manche n'est
  // encore appliqué en base) : c'est la bonne référence pour une estimation
  // individuelle, même si d'autres tirs simultanés viendront s'y ajouter.
  const targetHealthMax = target.healthMax ?? 1;
  const targetHealthBeforePhase = target.healthCurrent ?? targetHealthMax;
  const damageRatio = targetHealthMax > 0 ? outcome.damagePoints / targetHealthMax : 0;

  // Dégâts localisés (voir Unit.disabledWeaponSlots &c.) : seulement les
  // coups au but "solides", et seulement sur un bâtiment de surface (une
  // tourelle ou un gouvernail n'a pas de sens pour un sous-marin ici). Le
  // mitraillage/roquettes d'un avion sur un navire est explicitement exclu :
  // Marlière est clair sur le fait que ces attaques ne causent jamais que des
  // dégâts superficiels à un bâtiment de tonnage significatif (déjà traduit
  // par le plafond de resolveStrafingEngagement) — elles ne doivent donc
  // jamais pouvoir, en plus, désactiver une tourelle ou bloquer un gouvernail.
  const isAircraftStrafingShip = params.weaponType === "GUN" && attacker.unitClass.category === "AIRCRAFT" && target.unitClass.category === "SURFACE_SHIP";
  let localizedEffect: LocalizedEffectStored | null = null;
  let localizedDebugLine: string | null = null;
  if (
    outcome.hit &&
    !isAircraftStrafingShip &&
    (params.weaponType === "GUN" || params.weaponType === "TORPEDO" || params.weaponType === "BOMB") &&
    target.unitClass.category === "SURFACE_SHIP"
  ) {
    const { effect, debug } = rollLocalizedDamage({ weaponType: params.weaponType, damageRatio });
    localizedDebugLine = describeLocalizedRollDebug(debug);
    if (effect.type === "TURRET") {
      const slot = pickWeaponSlotToDisable(target.unitClass.combatProfile as CombatProfile | null, target.disabledWeaponSlots);
      if (slot) localizedEffect = { type: "WEAPON_DISABLED", slot };
    } else if (effect.type === "ENGINE") {
      localizedEffect = { type: "ENGINE", speedReductionRatio: effect.speedReductionRatio };
    } else if (effect.type === "RUDDER" && !target.rudderJammed) {
      localizedEffect = { type: "RUDDER" };
    } else if (effect.type === "FIRE_CONTROL" && !target.fireControlDamaged) {
      localizedEffect = { type: "FIRE_CONTROL" };
    } else if (effect.type === "MAGAZINE") {
      localizedEffect = { type: "MAGAZINE" };
    }
  }

  // Un coup dans un magasin est catastrophique et quasi instantané (cas
  // Hood) : on porte les dégâts de CE tir à l'exact potentiel restant de la
  // cible plutôt qu'un multiple arbitraire, pour qu'il la coule pile sans
  // fausser les statistiques de dégâts affichées.
  const finalDamagePoints = localizedEffect?.type === "MAGAZINE" ? targetHealthBeforePhase : outcome.damagePoints;
  const provisionalRemaining = outcome.hit ? Math.max(0, targetHealthBeforePhase - finalDamagePoints) : targetHealthBeforePhase;
  const provisionalSunk = provisionalRemaining <= 0;

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
  const reveal = assessFiringReveal({ weaponType: params.weaponType, calibreMm, torpedoWakeVisible: wakeVisible, isNight });

  // Trace de calcul, à des fins de débogage/transparence (pas une règle du
  // livret original) — voir tacticalNarrative.ts.
  const debugLines: string[] = [];
  if (outcome.hitChanceBreakdown) debugLines.push(`Précision : ${describeHitChanceDebug(outcome.hitChanceBreakdown)}`);
  if (localizedDebugLine) debugLines.push(localizedDebugLine);
  const debugInfo = debugLines.length > 0 ? debugLines.join(" ") : null;

  // Un appareil abattu avant d'avoir pu larguer/tirer (voir la DCA plus
  // haut) n'a JAMAIS atteint sa cible : le récit habituel (qui parle d'un
  // coup raté "normal") n'a plus de sens et est entièrement remplacé par le
  // récit de la DCA plutôt que d'y être juxtaposé.
  const narrative =
    dcaAbortsAttack && dcaNarrative
      ? dcaNarrative
      : (dcaNarrative ? dcaNarrative + " " : "") +
        (localizedEffect?.type === "MAGAZINE"
          ? describeMagazineHit(attacker.name, target.name)
          : describeShot({
              attackerName: attacker.name,
              targetName: target.name,
              weaponType: params.weaponType,
              hit: outcome.hit,
              hits: outcome.hits,
              damagePoints: finalDamagePoints,
              damageRatio,
              targetSunk: provisionalSunk,
              rangeNm: rangeM / NM_TO_M,
              targetIsAircraft: target.unitClass.category === "AIRCRAFT",
            }) + (localizedEffect ? " " + describeLocalizedEffect(localizedEffect, target.name) : ""));

  try {
    await prisma.tacticalAction.create({
      data: {
        engagementId: params.engagementId,
        roundNumber: engagement.roundNumber,
        phase: "FIRE",
        unitId: params.unitId,
        teamId: params.teamId,
        targetUnitId: params.targetUnitId,
        weaponType: params.weaponType,
        weaponSlot: params.weaponSlot,
        torpedoTypeId: params.torpedoTypeId,
        resolved: true,
        hit: outcome.hit,
        hits: outcome.hits,
        damagePoints: finalDamagePoints,
        targetSunk: provisionalSunk,
        hitChancePercent: outcome.hitChancePercent,
        hitRoll: outcome.hitRoll,
        localizedEffect: localizedEffect ?? undefined,
        narrative,
        debugInfo,
        revealedShooter: reveal.revealRadiusNm > 0,
        applied: false,
      },
    });
  } catch (error) {
    // Filet de sécurité contre un double clic quasi simultané : la
    // contrainte unique (engagement, manche, phase, navire, pièce) protège
    // la règle « une seule fois par pièce et par manche » même en cas de
    // course.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new OrderValidationError(`${attacker.name} : cette pièce a déjà tiré cette manche.`);
    }
    throw error;
  }

  return {
    hit: outcome.hit,
    hits: outcome.hits,
    damagePoints: finalDamagePoints,
    hitChancePercent: outcome.hitChancePercent,
    hitRoll: outcome.hitRoll,
    narrative,
    debugInfo,
    revealRadiusNm: reveal.revealRadiusNm,
  };
}

export type AutoAirEncounterResult = {
  weaponType: WeaponType;
  hit: boolean;
  hits: number;
  damagePoints: number;
  hitChancePercent: number;
  hitRoll: number;
  narrative: string;
  targetSunk: boolean;
};

/**
 * Résolution automatique (bloc air-air/air-mer, choix hybride demandé par
 * l'utilisateur) : un seul jet, pas de phase de tir manche par manche —
 * l'avion largue tout ce qu'il a d'un coup contre la cible désignée par
 * cette détection. Volontairement plus simple que l'engagement tactique
 * manuel (submitTacticalFireShot) : pas de dégâts localisés (tourelle,
 * gouvernail…), juste touché/raté et des dégâts de coque — cohérent avec
 * l'esprit "rapide" de cette option face à l'engagement tactique complet.
 * Ne concerne que l'avion attaquant : un navire qui détecte un avion garde
 * la voie de l'engagement tactique classique pour riposter à la DCA.
 */
export async function resolveAirEncounterAutomatically(params: { detectionEventId: string; teamId: string }): Promise<AutoAirEncounterResult> {
  const detection = await prisma.detectionEvent.findUniqueOrThrow({
    where: { id: params.detectionEventId },
    include: {
      observerUnit: { include: { unitClass: true, fleet: true } },
      targetUnit: { include: { unitClass: true, fleet: true } },
    },
  });
  if (detection.observerUnit.fleet.teamId !== params.teamId) {
    throw new OrderValidationError("Cette détection n'appartient pas à votre équipe.");
  }
  if (detection.arbiterStatus !== "CONFIRMED" && detection.arbiterStatus !== "ADDED_MANUALLY") {
    throw new OrderValidationError("Cette détection n'a pas encore été confirmée par l'arbitre.");
  }

  const attacker = detection.observerUnit;
  const target = detection.targetUnit;
  if (attacker.unitClass.category !== "AIRCRAFT") {
    throw new OrderValidationError("La résolution automatique n'est proposée que pour un avion qui attaque.");
  }
  if (attacker.status === "SUNK") throw new OrderValidationError("Cet avion est hors de combat.");
  if (target.status === "SUNK") throw new OrderValidationError("Cette cible est déjà hors de combat.");

  const profile = attacker.unitClass.combatProfile as CombatProfile | null;
  const attackerHealthCurrent = attacker.healthCurrent ?? attacker.healthMax ?? 1;
  const attackerHealthMax = attacker.healthMax ?? 1;

  let weaponType: WeaponType;
  let outcome: { hitChancePercent: number; hitRoll: number; hit: boolean; hits: number; damagePoints: number };

  if (target.unitClass.category === "AIRCRAFT") {
    if (!profile?.guns?.length) throw new OrderValidationError("Cet avion n'a pas d'armement air-air.");
    weaponType = "GUN";
    const targetProfile = target.unitClass.combatProfile as CombatProfile | null;
    outcome = resolveAirCombatEngagement({
      attackerAgility: attacker.unitClass.agility,
      defenderAgility: target.unitClass.agility,
      defenderHasDefensiveGuns: (targetProfile?.guns?.length ?? 0) > 0,
    });
  } else if (target.unitClass.category === "SURFACE_SHIP") {
    if (profile?.bombs) {
      weaponType = "BOMB";
      const bombResult = resolveBombingEngagement({
        attackerProfile: profile,
        attackerHealthCurrent,
        attackerHealthMax,
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        targetBeamM: target.unitClass.beamMeters ?? 12,
        targetSpeedKnots: 0,
      });
      if (!bombResult) throw new OrderValidationError("Aucune bombe disponible.");
      outcome = bombResult;
    } else if (profile?.torpedoTubes) {
      if (attacker.torpedoesRemaining != null && attacker.torpedoesRemaining <= 0) {
        throw new OrderValidationError("Plus aucune torpille à bord.");
      }
      weaponType = "TORPEDO";
      const torpedoResult = resolveTorpedoEngagement({
        attackerProfile: profile,
        attackerHealthCurrent,
        attackerHealthMax,
        targetLengthM: target.unitClass.lengthMeters ?? 100,
        targetBeamM: target.unitClass.beamMeters ?? 12,
        targetSpeedKnots: 0,
        angleOfAttackDeg: 45,
        rangeM: 0,
      });
      if (!torpedoResult) throw new OrderValidationError("Aucun tube lance-torpilles disponible.");
      outcome = torpedoResult;
    } else {
      throw new OrderValidationError("Cet avion n'a ni bombe ni torpille pour attaquer un navire.");
    }
  } else {
    throw new OrderValidationError("Cible non attaquable automatiquement (sous-marin immergé notamment).");
  }

  const targetHealthMax = target.healthMax ?? 1;
  const targetHealthBefore = target.healthCurrent ?? targetHealthMax;
  const finalDamagePoints = outcome.hit ? outcome.damagePoints : 0;
  const newHealth = Math.max(0, targetHealthBefore - finalDamagePoints);
  const targetSunk = newHealth <= 0;

  await prisma.unit.update({
    where: { id: target.id },
    data: { healthCurrent: newHealth, status: targetSunk ? "SUNK" : newHealth < targetHealthMax * 0.6 ? "DAMAGED" : target.status },
  });
  if (weaponType === "TORPEDO" && attacker.torpedoesRemaining != null) {
    await prisma.unit.update({ where: { id: attacker.id }, data: { torpedoesRemaining: Math.max(0, attacker.torpedoesRemaining - 1) } });
  }

  const narrative = describeShot({
    attackerName: attacker.name,
    targetName: target.name,
    weaponType,
    hit: outcome.hit,
    hits: outcome.hits,
    damagePoints: finalDamagePoints,
    damageRatio: targetHealthMax > 0 ? finalDamagePoints / targetHealthMax : 0,
    targetSunk,
    rangeNm: detection.cpaDistanceNm,
    targetIsAircraft: target.unitClass.category === "AIRCRAFT",
  });

  await prisma.combatEvent.create({
    data: {
      turnId: detection.turnId,
      detectionEventId: detection.id,
      attackerUnitId: attacker.id,
      targetUnitId: target.id,
      weaponType,
      rangeNm: detection.cpaDistanceNm,
      hitChancePercent: outcome.hitChancePercent,
      hits: outcome.hits,
      damagePoints: finalDamagePoints,
      targetHealthLeft: newHealth,
      targetSunk,
      firedTactically: false,
    },
  });

  return {
    weaponType,
    hit: outcome.hit,
    hits: outcome.hits,
    damagePoints: finalDamagePoints,
    hitChancePercent: outcome.hitChancePercent,
    hitRoll: outcome.hitRoll,
    narrative,
    targetSunk,
  };
}

/** Un camp annonce qu'il a fini de tirer cette manche ; la manche se résout dès que les deux camps l'ont fait. */
export async function finishFirePhase(params: { engagementId: string; teamId: string }) {
  const engagement = await assertEngagementOpen(params.engagementId, "AWAITING_FIRE");
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
    include: { participants: { include: { unit: { include: { unitClass: true } } } } },
  });

  const moves = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "MOVEMENT" },
  });
  const moveByUnit = new Map(moves.map((m) => [m.unitId, m]));

  // Navires sans ordre cette manche : la décélération n'étant pas
  // instantanée, un navire lancé ne peut pas s'arrêter net juste parce
  // qu'il a été oublié — il continue sur son erre, au cap connu, à sa
  // vitesse minimale atteignable (0 s'il n'allait déjà pas vite).
  const untouchedUnitIds = engagement.participants.filter((p) => p.unit.status !== "SUNK" && !moveByUnit.has(p.unitId)).map((p) => p.unitId);
  const lastSpeedByUnit = await getLastKnownSpeedsByUnit(engagementId, untouchedUnitIds, engagement.roundNumber);

  // Trajectoire de chaque unité PENDANT cette manche (position de départ,
  // déjà connue avant toute mise à jour ci-dessous, + le chemin réellement
  // parcouru) — sert exclusivement à advanceTorpedoSalvos plus bas, pour
  // vérifier si une salve en transit croise la route d'une cible qui a
  // continué de bouger APRÈS le lancement. Construite ici plutôt que
  // recalculée depuis la base : `engagement.participants` contient encore
  // les positions de PRÉ-manche à ce stade de la fonction.
  const unitTracksThisRound = new Map<string, UnitRoundTrack>();
  for (const p of engagement.participants) {
    const move = moveByUnit.get(p.unitId);
    const start = { lat: p.unit.currentLat, lng: p.unit.currentLng };
    let track: ReturnType<typeof buildTimedTrack>;
    if (move) {
      const path = Array.isArray(move.movementPath) ? (move.movementPath as unknown as LatLng[]) : [];
      track = buildTimedTrack([start, ...path], move.speedKnots ?? 0);
    } else {
      const lastSpeed = lastSpeedByUnit.get(p.unitId) ?? 0;
      const coastNm = lastSpeed > 0 ? speedBudgetNm(lastSpeed, engagement.roundMinutes) : 0;
      const dest = coastNm > 0 ? destinationPoint(start, p.unit.currentHeadingDeg ?? 0, coastNm) : start;
      track = buildTimedTrack([start, dest], lastSpeed);
    }
    unitTracksThisRound.set(p.unitId, {
      teamId: p.teamId,
      category: p.unit.unitClass.category,
      lengthMeters: p.unit.unitClass.lengthMeters ?? 100,
      beamMeters: p.unit.unitClass.beamMeters ?? 12,
      track,
      status: p.unit.status,
      // Palier EFFECTIF pour cette manche (l'ordre de cette manche prime sur
      // la valeur figée du tour précédent) — une torpille classique ne
      // touche jamais un sous-marin immergé, exactement comme submitTacticalFireShot.
      depthBand: move?.depthBand ?? p.unit.depthBand,
    });
  }

  for (const p of engagement.participants) {
    if (p.unit.status === "SUNK") continue;
    const move = moveByUnit.get(p.unitId);

    if (!move) {
      const lastSpeed = lastSpeedByUnit.get(p.unitId) ?? 0;
      if (lastSpeed <= 0) continue; // n'allait déjà pas vite : garde sa position, comme avant.
      const effectiveMaxSpeedKnots =
        p.unit.speedCapKnots != null ? Math.min(p.unit.unitClass.maxSpeedKnots, p.unit.speedCapKnots) : p.unit.unitClass.maxSpeedKnots;
      const accelKnotsPerMin =
        p.unit.unitClass.accelerationKnotsPerMin ?? defaultAccelerationKnotsPerMin(p.unit.unitClass.category, p.unit.unitClass.name);
      const { minReachable } = reachableSpeedRange({
        lastSpeedKnots: lastSpeed,
        accelKnotsPerMin,
        roundMinutes: engagement.roundMinutes,
        effectiveMaxSpeedKnots,
      });
      if (minReachable <= 0) continue;
      const coastNm = speedBudgetNm(minReachable, engagement.roundMinutes);
      const dest = destinationPoint({ lat: p.unit.currentLat, lng: p.unit.currentLng }, p.unit.currentHeadingDeg ?? 0, coastNm);
      await prisma.unit.update({ where: { id: p.unitId }, data: { currentLat: dest.lat, currentLng: dest.lng } });
      continue;
    }

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

  await advanceTorpedoSalvos({
    engagementId,
    roundNumber: engagement.roundNumber,
    roundMinutes: engagement.roundMinutes,
    unitTracks: unitTracksThisRound,
  });

  await recomputeContacts(engagementId, engagement.roundNumber);

  // Contact ASDIC rompu par des grenades ASM la manche précédente (voir
  // recomputeContacts) : consommé ICI, une fois les positions réelles de
  // cette manche connues et prises en compte ci-dessus — pas dans
  // recomputeContacts elle-même, qui est aussi appelée en prévisualisation
  // dès le passage de manche (voir advanceOrEnd) avant que ce mouvement-ci
  // n'ait eu lieu.
  const sonarBlindObserverIds = engagement.participants.filter((p) => p.unit.sonarBlindNextRound).map((p) => p.unitId);
  if (sonarBlindObserverIds.length > 0) {
    await prisma.unit.updateMany({ where: { id: { in: sonarBlindObserverIds } }, data: { sonarBlindNextRound: false } });
  }

  await prisma.tacticalEngagement.update({ where: { id: engagementId }, data: { status: "AWAITING_FIRE" } });
}

// ── Salve de torpilles en transit (navires/sous-marins) ──────
//
// Recherche 2026-08-14 (Paul Bois + Amirauté 2013 de Francis Marlière — voir
// combat.ts pour la justification complète et les sources). Une salve de
// torpilles n'est pas résolue dans la manche où elle est tirée : elle
// avance manche après manche (voir advanceTorpedoSalvos, appelée depuis
// resolveMovementPhase, APRÈS que toutes les unités ont bougé) jusqu'à
// interception, portée maximale dépassée, ou fin de l'engagement — une
// cible peut donc esquiver en changeant de cap après le lancement.

/** Pas d'échantillonnage (minutes) pour chercher le point de plus courte approche entre une salve et une cible pendant une manche — même principe que CPA_SAMPLE_STEP_MINUTES côté détection stratégique. */
const TORPEDO_SALVO_SAMPLE_STEP_MINUTES = 0.5;

/**
 * Tir d'une salve de torpilles — action de la phase de MOUVEMENT, pas de
 * tir (voir le commentaire ci-dessus). Une salve = tout le contenu d'un
 * affût tiré ensemble (Amirauté 2013 §2.2.2.5 : "une salve de torpille ne
 * peut provenir que d'un seul affût") ; `aimLat/aimLng` sert uniquement à
 * déduire un CAP (le joueur "dessine sa trajectoire" en visant un point),
 * pas une portée — la salve voyage ensuite en ligne droite jusqu'à
 * interception ou épuisement de sa portée réelle.
 */
export async function fireTorpedoSalvo(params: {
  engagementId: string;
  teamId: string;
  unitId: string;
  aimLat: number;
  aimLng: number;
  spread: PrismaTorpedoSpread;
  torpedoTypeId?: string;
  targetUnitId?: string;
}): Promise<{ salvoId: string; headingDeg: number }> {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({ where: { id: params.engagementId } });
  if (engagement.status === "RESOLVED") throw new OrderValidationError("Cet engagement est terminé.");
  if (engagement.arbiterPaused) throw new OrderValidationError("L'arbitre a suspendu le combat.");
  if (engagement.status !== "AWAITING_MOVEMENT") throw new OrderValidationError("Les torpilles se tirent en phase de mouvement, pas de tir.");

  const participant = await prisma.tacticalParticipant.findUnique({
    where: { engagementId_unitId: { engagementId: params.engagementId, unitId: params.unitId } },
    include: { unit: { include: { unitClass: true } } },
  });
  if (!participant || participant.teamId !== params.teamId) {
    throw new OrderValidationError("Cette unité ne participe pas à cet engagement pour votre camp.");
  }
  const attacker = participant.unit;
  if (attacker.status === "SUNK") throw new OrderValidationError("Cette unité est coulée.");
  if (attacker.unitClass.category === "AIRCRAFT") {
    throw new OrderValidationError("Un avion largue sa torpille en phase de tir classique, pas ici.");
  }
  if (attacker.unitClass.category === "SUBMARINE" && (attacker.depthBand === "MEDIUM" || attacker.depthBand === "DEEP")) {
    throw new OrderValidationError("Torpilles impossibles en immersion moyenne ou grande — il faut remonter en surface ou faible immersion.");
  }

  const profile = attacker.unitClass.combatProfile as CombatProfile | null;
  const battery = selectTorpedoBattery(profile, params.torpedoTypeId);
  if (!battery) throw new OrderValidationError("Aucun tube lance-torpilles disponible.");
  if (attacker.torpedoesRemaining != null && attacker.torpedoesRemaining < battery.count) {
    throw new OrderValidationError("Pas assez de torpilles à bord pour une salve complète.");
  }

  const already = await prisma.tacticalTorpedoSalvo.findFirst({
    where: { engagementId: params.engagementId, firedByUnitId: params.unitId, firedRoundNumber: engagement.roundNumber },
  });
  if (already) throw new OrderValidationError(`${attacker.name} : déjà tiré une salve de torpilles cette manche.`);

  const origin = { lat: attacker.currentLat, lng: attacker.currentLng };
  const headingDeg = bearingDeg(origin, { lat: params.aimLat, lng: params.aimLng });
  const relativeBearing = headingDeg - (attacker.currentHeadingDeg ?? 0);
  if (!isTorpedoArcClear(battery, relativeBearing)) {
    throw new OrderValidationError("Ce cap est hors de l'arc de tir des tubes lance-torpilles.");
  }

  const salvo = await prisma.tacticalTorpedoSalvo.create({
    data: {
      engagementId: params.engagementId,
      firedRoundNumber: engagement.roundNumber,
      firedByUnitId: attacker.id,
      firedByTeamId: params.teamId,
      targetUnitId: params.targetUnitId,
      torpedoTypeId: params.torpedoTypeId,
      torpedoCount: battery.count,
      spread: params.spread,
      headingDeg,
      speedKnots: battery.speedKnots,
      maxRangeM: battery.rangeM,
      reliability: battery.reliability ?? DEFAULT_TORPEDO_RELIABILITY,
      currentLat: origin.lat,
      currentLng: origin.lng,
    },
  });

  if (attacker.torpedoesRemaining != null) {
    await prisma.unit.update({
      where: { id: attacker.id },
      data: { torpedoesRemaining: Math.max(0, attacker.torpedoesRemaining - battery.count) },
    });
  }

  return { salvoId: salvo.id, headingDeg };
}

type UnitRoundTrack = {
  teamId: string;
  category: string;
  lengthMeters: number;
  beamMeters: number;
  track: ReturnType<typeof buildTimedTrack>;
  status: string;
  /** Le type Prisma complet (4 paliers), pas combat.ts::DepthBand (3 paliers, sans SURFACE — inadapté ici). */
  depthBand: DepthBand;
};

/**
 * Avance toutes les salves IN_TRANSIT de cet engagement d'une manche, et
 * résout celles qui interceptent une cible ou dépassent leur portée
 * maximale. Appelée depuis resolveMovementPhase, APRÈS que les positions
 * réelles des unités pour cette manche sont connues (`unitTracks`) — c'est
 * ce qui permet à une cible d'esquiver en ayant changé de cap depuis le
 * lancement. Les coups résolus ici sont écrits en TacticalAction (phase
 * FIRE, non appliqués) exactement comme un tir classique : resolveFirePhase
 * de cette même manche les additionnera aux autres tirs simultanés au
 * moment d'appliquer les dégâts, sans traitement spécial nécessaire.
 */
async function advanceTorpedoSalvos(params: {
  engagementId: string;
  roundNumber: number;
  roundMinutes: number;
  unitTracks: Map<string, UnitRoundTrack>;
}) {
  const salvos = await prisma.tacticalTorpedoSalvo.findMany({
    where: { engagementId: params.engagementId, status: "IN_TRANSIT" },
    include: { firedByUnit: { select: { name: true, unitClass: { select: { agility: true } } } } },
  });
  if (salvos.length === 0) return;

  for (const salvo of salvos) {
    const remainingRangeM = salvo.maxRangeM - salvo.distanceTraveledM;
    if (remainingRangeM <= 0) {
      await finalizeMissedSalvo(params.engagementId, salvo.id, params.roundNumber, salvo.firedByUnitId, salvo.firedByTeamId, salvo.targetUnitId, salvo.firedByUnit.name);
      continue;
    }

    const roundTravelNm = (salvo.speedKnots * params.roundMinutes) / 60;
    const cappedTravelNm = Math.min(roundTravelNm, remainingRangeM / NM_TO_M);
    const origin = { lat: salvo.currentLat, lng: salvo.currentLng };
    const endOfRound = destinationPoint(origin, salvo.headingDeg, cappedTravelNm);
    const torpedoTrack = buildTimedTrack([origin, endOfRound], salvo.speedKnots);
    const sampleDurationMinutes = salvo.speedKnots > 0 ? (cappedTravelNm / salvo.speedKnots) * 60 : 0;

    // Point de plus courte approche avec chaque cible adverse encore active,
    // en échantillonnant les deux trajectoires au même instant — la torpille
    // ne tourne jamais (ligne droite), mais la cible peut avoir manœuvré.
    let best: { unitId: string; distanceM: number; distanceTraveledAtApproachM: number; impactAngleDeg: number } | null = null;
    for (const [unitId, u] of params.unitTracks) {
      if (u.teamId === salvo.firedByTeamId) continue;
      if (u.status === "SUNK") continue;
      if (u.category === "AIRCRAFT") continue; // une torpille ne vise pas un avion
      if (u.category === "SUBMARINE" && u.depthBand !== "SURFACE") continue; // une torpille classique ne touche pas un sous-marin immergé (même règle que submitTacticalFireShot)

      for (let sampleMinute = 0; sampleMinute <= sampleDurationMinutes; sampleMinute += TORPEDO_SALVO_SAMPLE_STEP_MINUTES) {
        const torpedoPos = torpedoTrack.positionAt(sampleMinute);
        const targetPos = u.track.positionAt(sampleMinute);
        const d = distanceNm(torpedoPos, targetPos) * NM_TO_M;
        if (!best || d < best.distanceM) {
          const distanceTraveledAtApproachM = salvo.distanceTraveledM + (sampleMinute / 60) * salvo.speedKnots * NM_TO_M;
          const targetPosSlightlyBefore = u.track.positionAt(Math.max(0, sampleMinute - 0.5));
          const targetHeadingAtApproach = bearingDeg(targetPosSlightlyBefore, targetPos);
          const impactAngleDeg = (((salvo.headingDeg - targetHeadingAtApproach + 540) % 360) - 180);
          best = { unitId, distanceM: d, distanceTraveledAtApproachM, impactAngleDeg };
        }
      }
    }

    const zoneWidthM = best
      ? torpedoDangerZoneWidthM({ spread: salvo.spread as TorpedoSpreadType, distanceTraveledM: best.distanceTraveledAtApproachM, torpedoCount: salvo.torpedoCount })
      : 0;
    const intercepted = best !== null && best.distanceM <= zoneWidthM / 2;

    if (!intercepted) {
      const newDistanceTraveledM = salvo.distanceTraveledM + cappedTravelNm * NM_TO_M;
      if (newDistanceTraveledM >= salvo.maxRangeM) {
        await finalizeMissedSalvo(params.engagementId, salvo.id, params.roundNumber, salvo.firedByUnitId, salvo.firedByTeamId, salvo.targetUnitId, salvo.firedByUnit.name);
      } else {
        await prisma.tacticalTorpedoSalvo.update({
          where: { id: salvo.id },
          data: { currentLat: endOfRound.lat, currentLng: endOfRound.lng, distanceTraveledM: newDistanceTraveledM },
        });
      }
      continue;
    }

    // Interception géométrique avérée : reste à savoir si le coup porte (voir combat.ts, torpedoSalvoHitChancePercent).
    const targetUnit = await prisma.unit.findUniqueOrThrow({ where: { id: best!.unitId }, include: { unitClass: true } });
    const intercept = resolveTorpedoSalvoIntercept({
      targetLengthM: targetUnit.unitClass.lengthMeters ?? 100,
      targetBeamM: targetUnit.unitClass.beamMeters ?? 12,
      impactAngleDeg: best!.impactAngleDeg,
      reliability: salvo.reliability,
      dangerZoneWidthM: zoneWidthM,
    });

    const targetHealthMax = targetUnit.healthMax ?? 1;
    const targetHealthBeforePhase = targetUnit.healthCurrent ?? targetHealthMax;
    const damageRatio = targetHealthMax > 0 ? intercept.damagePoints / targetHealthMax : 0;

    let localizedEffect: LocalizedEffectStored | null = null;
    if (intercept.hit && targetUnit.unitClass.category === "SURFACE_SHIP") {
      const { effect } = rollLocalizedDamage({ weaponType: "TORPEDO", damageRatio });
      if (effect.type === "TURRET") {
        const slot = pickWeaponSlotToDisable(targetUnit.unitClass.combatProfile as CombatProfile | null, targetUnit.disabledWeaponSlots);
        if (slot) localizedEffect = { type: "WEAPON_DISABLED", slot };
      } else if (effect.type === "ENGINE") {
        localizedEffect = { type: "ENGINE", speedReductionRatio: effect.speedReductionRatio };
      } else if (effect.type === "RUDDER" && !targetUnit.rudderJammed) {
        localizedEffect = { type: "RUDDER" };
      } else if (effect.type === "FIRE_CONTROL" && !targetUnit.fireControlDamaged) {
        localizedEffect = { type: "FIRE_CONTROL" };
      } else if (effect.type === "MAGAZINE") {
        localizedEffect = { type: "MAGAZINE" };
      }
    }

    const finalDamagePoints = localizedEffect?.type === "MAGAZINE" ? targetHealthBeforePhase : intercept.damagePoints;
    const provisionalSunk = intercept.hit && Math.max(0, targetHealthBeforePhase - finalDamagePoints) <= 0;

    const narrative =
      localizedEffect?.type === "MAGAZINE"
        ? describeMagazineHit(salvo.firedByUnit.name, targetUnit.name)
        : `Après ${(best!.distanceTraveledAtApproachM / NM_TO_M).toFixed(1)} nm de course, ` +
          describeShot({
            attackerName: salvo.firedByUnit.name,
            targetName: targetUnit.name,
            weaponType: "TORPEDO",
            hit: intercept.hit,
            hits: intercept.hit ? 1 : 0,
            damagePoints: finalDamagePoints,
            damageRatio,
            targetSunk: provisionalSunk,
            rangeNm: best!.distanceM / NM_TO_M,
          }) +
          (localizedEffect ? " " + describeLocalizedEffect(localizedEffect, targetUnit.name) : "");

    await prisma.tacticalAction.create({
      data: {
        engagementId: params.engagementId,
        roundNumber: params.roundNumber,
        phase: "FIRE",
        unitId: salvo.firedByUnitId,
        teamId: salvo.firedByTeamId,
        targetUnitId: targetUnit.id,
        weaponType: "TORPEDO",
        weaponSlot: `torpedo-salvo:${salvo.id}`,
        torpedoTypeId: salvo.torpedoTypeId,
        resolved: true,
        hit: intercept.hit,
        hits: intercept.hit ? 1 : 0,
        damagePoints: finalDamagePoints,
        targetSunk: provisionalSunk,
        hitChancePercent: intercept.hitChancePercent,
        hitRoll: intercept.hitRoll,
        localizedEffect: localizedEffect ?? undefined,
        narrative,
        // Sillage repéré au moment de l'IMPACT (approximation : le vrai
        // moment "juste" serait le lancement, mais reprendre le mécanisme
        // de réputation existant ici reste largement préférable à ne
        // jamais rien révéler — voir fireTorpedoSalvo pour la limite assumée).
        revealedShooter: true,
        applied: false,
      },
    });

    await prisma.tacticalTorpedoSalvo.update({
      where: { id: salvo.id },
      data: {
        // Interceptée n'est pas synonyme de touchée : la zone de danger a
        // croisé la route de la cible (voir plus haut), mais le jet de
        // précision peut encore rater (intercept.hit) — dans les deux cas la
        // salve est consommée, seul le statut final diffère.
        status: intercept.hit ? "HIT" : "MISSED",
        hitUnitId: intercept.hit ? targetUnit.id : null,
        resolvedRoundNumber: params.roundNumber,
        currentLat: targetUnit.currentLat,
        currentLng: targetUnit.currentLng,
        distanceTraveledM: best!.distanceTraveledAtApproachM,
      },
    });
  }
}

async function finalizeMissedSalvo(
  engagementId: string,
  salvoId: string,
  roundNumber: number,
  firedByUnitId: string,
  firedByTeamId: string,
  targetUnitId: string | null,
  firedByUnitName: string
) {
  await prisma.tacticalTorpedoSalvo.update({ where: { id: salvoId }, data: { status: "MISSED", resolvedRoundNumber: roundNumber } });
  await prisma.tacticalAction.create({
    data: {
      engagementId,
      roundNumber,
      phase: "FIRE",
      unitId: firedByUnitId,
      teamId: firedByTeamId,
      targetUnitId,
      weaponType: "TORPEDO",
      weaponSlot: `torpedo-salvo:${salvoId}`,
      resolved: true,
      hit: false,
      hits: 0,
      damagePoints: 0,
      targetSunk: false,
      hitChancePercent: 0,
      hitRoll: 100,
      narrative: `La salve de ${firedByUnitName} a épuisé sa portée sans avoir croisé la route d'une cible.`,
      applied: true, // rien à appliquer, pas la peine d'attendre resolveFirePhase pour ce cas.
    },
  });
}

// ── Résolution : tir ────────────────────────────────────────

/**
 * Applique en bloc les dégâts de tous les tirs de la manche, déjà calculés
 * individuellement au moment de chaque tir (voir `submitTacticalFireShot`) :
 * c'est ici, et seulement ici, que le potentiel réel des unités bouge en
 * base — ce qui garantit que deux tirs simultanés sur la même cible se
 * cumulent avant qu'elle ne soit déclarée coulée, plutôt que de dépendre de
 * l'ordre d'arrivée des validations.
 */
export async function resolveFirePhase(engagementId: string) {
  const engagement = await prisma.tacticalEngagement.findUniqueOrThrow({ where: { id: engagementId } });

  const shots = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "FIRE", resolved: true },
  });

  const damageByTarget = new Map<string, number>();
  const localizedByTarget = new Map<string, LocalizedEffectStored[]>();
  for (const shot of shots) {
    if (!shot.hit || !shot.targetUnitId) continue;
    if (shot.damagePoints) damageByTarget.set(shot.targetUnitId, (damageByTarget.get(shot.targetUnitId) ?? 0) + shot.damagePoints);
    if (shot.localizedEffect) {
      const arr = localizedByTarget.get(shot.targetUnitId) ?? [];
      arr.push(shot.localizedEffect as unknown as LocalizedEffectStored);
      localizedByTarget.set(shot.targetUnitId, arr);
    }
  }

  const affectedTargetIds = new Set([...damageByTarget.keys(), ...localizedByTarget.keys()]);
  if (affectedTargetIds.size > 0) {
    const targets = await prisma.unit.findMany({ where: { id: { in: Array.from(affectedTargetIds) } }, include: { unitClass: true } });
    for (const target of targets) {
      const totalDamage = damageByTarget.get(target.id) ?? 0;
      const max = target.healthMax ?? 1;
      const current = target.healthCurrent ?? max;
      const next = Math.max(0, current - totalDamage);

      // Dégâts localisés cumulés de la manche (voir submitTacticalFireShot) :
      // un même navire peut encaisser plusieurs coups distincts la même
      // manche, chacun ayant proposé son propre effet indépendamment des
      // autres (aucun ne sait encore, au moment du tir, ce que les tirs
      // simultanés ont déjà décidé) — on les cumule ici, dédupliqués par pièce.
      const effects = localizedByTarget.get(target.id) ?? [];
      const disabledSlots = new Set(target.disabledWeaponSlots);
      let speedCap = target.speedCapKnots;
      let rudderJammed = target.rudderJammed;
      let fireControlDamaged = target.fireControlDamaged;
      for (const eff of effects) {
        if (eff.type === "WEAPON_DISABLED") disabledSlots.add(eff.slot);
        else if (eff.type === "ENGINE") {
          const currentEffectiveMax = speedCap ?? target.unitClass.maxSpeedKnots;
          const reduced = Math.max(MIN_SPEED_CAP_KNOTS, currentEffectiveMax * (1 - eff.speedReductionRatio));
          speedCap = speedCap == null ? reduced : Math.min(speedCap, reduced);
        } else if (eff.type === "RUDDER") rudderJammed = true;
        else if (eff.type === "FIRE_CONTROL") fireControlDamaged = true;
        // MAGAZINE : déjà reflété dans damagePoints (voir submitTacticalFireShot), rien de plus à appliquer ici.
      }

      await prisma.unit.update({
        where: { id: target.id },
        data: {
          healthCurrent: next,
          status: next <= 0 ? "SUNK" : next < max * 0.6 ? "DAMAGED" : "ACTIVE",
          disabledWeaponSlots: Array.from(disabledSlots),
          speedCapKnots: speedCap,
          rudderJammed,
          fireControlDamaged,
        },
      });
    }
  }

  await prisma.tacticalAction.updateMany({
    where: { engagementId, roundNumber: engagement.roundNumber, phase: "FIRE", resolved: true },
    data: { applied: true },
  });

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
  // Salves encore en transit à la fin de l'engagement : pas de manche
  // suivante pour les faire avancer, elles n'atteindront donc jamais leur
  // cible — les marquer MISSED plutôt que de les laisser IN_TRANSIT pour
  // toujours (voir advanceTorpedoSalvos).
  await prisma.tacticalTorpedoSalvo.updateMany({
    where: { engagementId, status: "IN_TRANSIT" },
    data: { status: "MISSED" },
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
