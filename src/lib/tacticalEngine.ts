import "server-only";
import { prisma } from "@/lib/prisma";
import { distanceNm, bearingDeg, destinationPoint, pathLengthNm, speedBudgetNm, turnPenaltyNm, type LatLng } from "@/lib/geo";
import { effectiveSensorRangeNm, type WeatherConditions } from "@/lib/weather";
import {
  resolveGunEngagement,
  resolveTorpedoEngagement,
  resolveDepthChargeAttack,
  rollLocalizedDamage,
  selectTorpedoBattery,
  isTorpedoArcClear,
  isInGunArc,
  type CombatProfile,
  type DepthBand as CombatDepthBand,
  type HitChanceBreakdown,
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
import type { DepthBand, SensorType, WeaponType } from "@/generated/prisma/client";
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

// ── Manœuvre : rayon de virage et accélération ──────────────
//
// Repli par catégorie si une classe de navire n'a pas encore ces champs
// renseignés (ex: ajoutée avant leur introduction, ou nouvelle classe pas
// encore documentée) — voir prisma/seed.ts pour la méthodologie de
// recherche et les valeurs par classe.
export function defaultTurningRadiusM(category: string): number {
  return category === "SUBMARINE" ? 200 : 320;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- catégorie gardée dans la signature pour permettre une différenciation future sans casser les appelants.
export function defaultAccelerationKnotsPerMin(category: string): number {
  return 3;
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
export async function submitTacticalMovementForUnit(params: {
  engagementId: string;
  teamId: string;
  unitId: string;
  speedKnots: number;
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

  if (params.speedKnots < 0 || params.speedKnots > effectiveMaxSpeedKnots) {
    throw new OrderValidationError(
      `${participant.unit.name} : vitesse ${params.speedKnots} nds hors limites (max ${effectiveMaxSpeedKnots.toFixed(0)}${
        participant.unit.speedCapKnots != null ? ", réduit par avarie" : ""
      }).`
    );
  }

  // Accélération : la vitesse ne peut changer que d'un écart plafonné par
  // manche (recherche historique, voir prisma/seed.ts) — un cuirassé ne
  // passe pas de 10 à 28 nds en 5 minutes.
  const accelKnotsPerMin = participant.unit.unitClass.accelerationKnotsPerMin ?? defaultAccelerationKnotsPerMin(participant.unit.unitClass.category);
  const lastSpeed = lastSpeedByUnit.get(params.unitId) ?? 0;
  const maxDelta = accelKnotsPerMin * engagement.roundMinutes;
  const minReachable = Math.max(0, lastSpeed - maxDelta);
  const maxReachable = Math.min(effectiveMaxSpeedKnots, lastSpeed + maxDelta);
  if (params.speedKnots < minReachable - 0.01 || params.speedKnots > maxReachable + 0.01) {
    throw new OrderValidationError(
      `${participant.unit.name} : ne peut pas passer de ${lastSpeed.toFixed(0)} à ${params.speedKnots.toFixed(0)} nds en ${engagement.roundMinutes.toFixed(1)}min (accélération max ${accelKnotsPerMin.toFixed(1)}nds/min, atteignable entre ${minReachable.toFixed(0)} et ${maxReachable.toFixed(0)}nds).`
    );
  }

  // Gouvernail bloqué (voir Unit.rudderJammed, cas Bismarck 24 mai 1941) :
  // le navire ne peut plus choisir sa route, seulement sa vitesse — le
  // tracé envoyé par le client est ignoré, on impose une ligne droite dans
  // le cap actuel sur tout le budget de la manche.
  const effectivePath = participant.unit.rudderJammed
    ? (() => {
        const budgetNm = speedBudgetNm(params.speedKnots, engagement.roundMinutes);
        if (budgetNm <= 0) return [];
        const start = { lat: participant.unit.currentLat, lng: participant.unit.currentLng };
        return [destinationPoint(start, participant.unit.currentHeadingDeg ?? 0, budgetNm)];
      })()
    : params.path;

  if (!participant.unit.rudderJammed && effectivePath.length > 0) {
    const turningRadiusNm =
      (participant.unit.unitClass.turningRadiusM ?? defaultTurningRadiusM(participant.unit.unitClass.category)) / NM_TO_M;
    const fullPath = [{ lat: participant.unit.currentLat, lng: participant.unit.currentLng }, ...effectivePath];
    const budgetNm = speedBudgetNm(params.speedKnots, engagement.roundMinutes);
    const usedNm = pathLengthNm(fullPath) + turnPenaltyNm(fullPath, turningRadiusNm);
    if (usedNm > budgetNm * 1.01) {
      throw new OrderValidationError(
        `${participant.unit.name} : tracé de ${usedNm.toFixed(2)}nm (dont manœuvre), budget ${budgetNm.toFixed(2)}nm à ${params.speedKnots}nds sur ${engagement.roundMinutes.toFixed(1)}min.`
      );
    }
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
      speedKnots: params.speedKnots,
      movementPath: effectivePath,
      depthBand: params.depthBand,
    },
    update: { speedKnots: params.speedKnots, movementPath: effectivePath, depthBand: params.depthBand },
  });
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
      data: { depthChargesRemaining: Math.max(0, (attacker.depthChargesRemaining ?? 0) - dc.chargesUsed) },
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
    if (targetSubmerged) throw new OrderValidationError("Une torpille classique ne touche pas un sous-marin immergé.");
    if (attacker.unitClass.category === "SUBMARINE" && (attacker.depthBand === "MEDIUM" || attacker.depthBand === "DEEP")) {
      throw new OrderValidationError("Torpilles impossibles en immersion moyenne ou grande.");
    }
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
    outcome = resolveTorpedoEngagement({
      attackerProfile: { ...profile, torpedoTubes: battery },
      attackerHealthCurrent,
      attackerHealthMax,
      targetLengthM: target.unitClass.lengthMeters ?? 100,
      targetBeamM: target.unitClass.beamMeters ?? 12,
      targetSpeedKnots: 0,
      angleOfAttackDeg: lineOfFire - (target.currentHeadingDeg ?? 0),
      rangeM,
      accuracyMultiplier,
    });
    if (outcome && attacker.torpedoesRemaining != null) {
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
  // tourelle ou un gouvernail n'a pas de sens pour un sous-marin ici).
  let localizedEffect: LocalizedEffectStored | null = null;
  let localizedDebugLine: string | null = null;
  if (outcome.hit && (params.weaponType === "GUN" || params.weaponType === "TORPEDO") && target.unitClass.category === "SURFACE_SHIP") {
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

  const narrative =
    localizedEffect?.type === "MAGAZINE"
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
        }) + (localizedEffect ? " " + describeLocalizedEffect(localizedEffect, target.name) : "");

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
