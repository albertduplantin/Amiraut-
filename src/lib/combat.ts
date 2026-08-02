/**
 * Moteur de combat — artillerie (v1 du phase 2, torpilles/aviation/ASM à
 * suivre). Adapté des règles originales d'Amirauté (Paul Bois) : la
 * résolution reste en trois jets indépendants (chance de toucher → nombre
 * de coups au but dans la salve → dégâts par coup), et la puissance de feu
 * se dégrade en proportion directe des dommages subis plutôt qu'un seuil
 * binaire.
 *
 * La formule de chance de toucher ci-dessous est *inspirée* des exemples
 * chiffrés du livret (17 %/70 % à 28000/14000m pour un cuirassé de 380mm,
 * 7 %/50 % à 16000/8000m pour un croiseur de 152mm) sans en reproduire les
 * tables exactes — l'auteur original invite lui-même à l'adaptation
 * (« ces pièces ne prétendent pas être des règles sans appel »).
 */

export type GunBattery = { calibreMm: number; count: number; rangeM: number };
export type TorpedoBattery = { count: number; rangeM: number; speedKnots: number };

export type CombatProfile = {
  guns?: GunBattery[];
  torpedoTubes?: TorpedoBattery;
};

/**
 * Dégâts moyens d'un coup de 380mm, calibrés sur l'indication du livret
 * qu'un croiseur lourd bien protégé encaisse l'impact de 4 à 5 obus de 380
 * avant de succomber (p. 4) : pour une cible de résistance ~100 pts,
 * un coup de 380 vaut donc environ 100/4,5 ≈ 22 points.
 */
const REFERENCE_DAMAGE_PER_380MM_HIT = 22;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Meilleure batterie utilisable à la distance donnée (la plus grosse dont la portée couvre `rangeM`). */
export function selectGunBattery(profile: CombatProfile | null | undefined, rangeM: number): GunBattery | null {
  if (!profile?.guns || profile.guns.length === 0) return null;
  const usable = profile.guns.filter((g) => g.rangeM >= rangeM);
  if (usable.length === 0) return null;
  return usable.reduce((best, g) => (g.calibreMm > best.calibreMm ? g : best));
}

export function gunHitChancePercent(params: {
  calibreMm: number;
  rangeM: number;
  maxRangeM: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
}): number {
  const rangeRatio = clamp(params.rangeM / params.maxRangeM, 0, 1);
  const rangeFactor = Math.pow(1 - rangeRatio, 1.6);
  const targetArea = Math.max(50, params.targetLengthM * params.targetBeamM);
  // 1800m² ~ un croiseur léger moyen, référence neutre (facteur 1).
  const sizeFactor = clamp(targetArea / 1800, 0.15, 2.2);
  const speedFactor = 1 / (1 + params.targetSpeedKnots / 22);
  const baseAccuracy = params.calibreMm >= 280 ? 0.6 : params.calibreMm >= 150 ? 0.72 : 0.85;
  return clamp(baseAccuracy * rangeFactor * sizeFactor * speedFactor * 100, 0, 95);
}

function gunDamagePerHit(calibreMm: number, rng: () => number): number {
  const base = REFERENCE_DAMAGE_PER_380MM_HIT * Math.pow(calibreMm / 380, 3);
  const variability = 0.7 + rng() * 0.6; // 0.7x à 1.3x
  return base * variability;
}

/** Nombre de coups au but dans la salve, borné par le nombre de pièces effectivement en état de tirer. */
function rollHitCount(effectiveGunCount: number, rng: () => number): number {
  if (effectiveGunCount <= 0) return 0;
  let hits = 1;
  for (let i = 1; i < effectiveGunCount; i++) {
    if (rng() < 0.35) hits++;
  }
  return hits;
}

export type GunEngagementResult = {
  battery: GunBattery;
  hitChancePercent: number;
  hitRoll: number;
  hit: boolean;
  hits: number;
  damagePoints: number;
};

/**
 * Résout un engagement d'artillerie observateur → cible pour un tour.
 * Retourne `null` si aucune batterie de l'attaquant ne porte à cette distance.
 */
export function resolveGunEngagement(params: {
  attackerProfile: CombatProfile | null | undefined;
  attackerHealthCurrent: number;
  attackerHealthMax: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  rangeM: number;
  rng?: () => number;
}): GunEngagementResult | null {
  const rng = params.rng ?? Math.random;
  const battery = selectGunBattery(params.attackerProfile, params.rangeM);
  if (!battery) return null;

  const hitChancePercent = gunHitChancePercent({
    calibreMm: battery.calibreMm,
    rangeM: params.rangeM,
    maxRangeM: battery.rangeM,
    targetLengthM: params.targetLengthM,
    targetBeamM: params.targetBeamM,
    targetSpeedKnots: params.targetSpeedKnots,
  });

  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;
  if (!hit) {
    return { battery, hitChancePercent, hitRoll, hit: false, hits: 0, damagePoints: 0 };
  }

  // La puissance de feu se dégrade en proportion directe des dommages subis (livret p. 8).
  const firepowerRatio = params.attackerHealthMax > 0 ? clamp(params.attackerHealthCurrent / params.attackerHealthMax, 0, 1) : 1;
  const effectiveGunCount = Math.max(1, Math.ceil(battery.count * firepowerRatio));

  const hits = rollHitCount(effectiveGunCount, rng);
  let damagePoints = 0;
  for (let i = 0; i < hits; i++) damagePoints += gunDamagePerHit(battery.calibreMm, rng);

  return { battery, hitChancePercent, hitRoll, hit: true, hits, damagePoints };
}
