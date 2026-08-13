/**
 * Moteur de combat — artillerie et torpilles (phase 2, volets 1 et 2 ;
 * aviation/ASM à suivre). Adapté des règles originales d'Amirauté (Paul
 * Bois) : la résolution reste en jets indépendants (chance de toucher →
 * nombre de coups au but → dégâts par coup), et la puissance de feu se
 * dégrade en proportion directe des dommages subis plutôt qu'un seuil
 * binaire.
 *
 * Les formules de chance de toucher ci-dessous sont *inspirées* des
 * exemples chiffrés du livret (artillerie : 17 %/70 % à 28000/14000m pour
 * un cuirassé de 380mm, 7 %/50 % à 16000/8000m pour un croiseur de 152mm ;
 * torpilles : 55 % à 3600m sous 35°, 1 % sous 120°, cf. p. 6) sans en
 * reproduire les tables exactes — l'auteur original invite lui-même à
 * l'adaptation (« ces pièces ne prétendent pas être des règles sans
 * appel »).
 */

import type { WeaponType } from "@/generated/prisma/client";

/**
 * Arc de tir d'une pièce, en fonction de son emplacement à bord : une
 * tourelle avant ne peut pas tirer pile derrière (masquée par sa propre
 * passerelle/cheminées), et inversement pour une tourelle arrière ; les
 * tubes lance-torpilles, montés sur l'axe du navire, ne portent qu'au
 * travers, ni pile devant ni pile derrière. Simplification en quatre
 * catégories plutôt qu'un degré exact par modèle de tourelle, rarement
 * documenté avec cette précision.
 */
export type GunArc = "FORWARD" | "AFT" | "ALL_ROUND" | "BROADSIDE";

/** Angle absolu entre deux gisements (0-180°). */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Vrai si une cible au relèvement donné (par rapport à la proue du navire,
 * 0° = droit devant, 180° = droit derrière) est dans l'arc de tir de la
 * pièce. Le secteur aveugle fait 60° (30° de chaque côté de l'axe masqué).
 */
export function isInGunArc(arc: GunArc, relativeBearingDeg: number): boolean {
  const b = ((relativeBearingDeg % 360) + 360) % 360;
  switch (arc) {
    case "ALL_ROUND":
      return true;
    case "FORWARD":
      return angleDiff(b, 180) > 30; // aveugle pile derrière
    case "AFT":
      return angleDiff(b, 0) > 30; // aveugle pile devant
    case "BROADSIDE":
      return angleDiff(b, 0) > 30 && angleDiff(b, 180) > 30; // aveugle devant ET derrière
    default:
      // Défensif : une classe d'unité instanciée avant l'ajout des arcs de
      // tir au modèle peut porter un profil de combat sans ce champ. Sans
      // repli, la pièce serait silencieusement exclue de tout tir — on
      // préfère la traiter comme tout-azimut (comportement d'avant l'ajout
      // des arcs) plutôt que désarmer discrètement le navire.
      return true;
  }
}

export type GunBattery = {
  calibreMm: number;
  count: number;
  rangeM: number;
  /** Coups par minute et par pièce (cadence réelle du modèle, pas un idéal théorique). */
  roundsPerMinute: number;
  arc: GunArc;
};
/** Les tubes lance-torpilles sont montés sur l'axe du navire : arc au travers uniquement, par défaut. */
export type TorpedoBattery = { count: number; rangeM: number; speedKnots: number; arc?: GunArc };

/**
 * Variante de torpille sélectionnable (sous-marins) : G7a à vapeur (44nds,
 * sillage de bulles visible en surface — trahit la position du tireur) vs
 * G7e électrique (30nds, sans sillage, mais plus lente donc plus facile à
 * esquiver). Un choix tactique réel, pas juste un chiffre différent.
 */
export type TorpedoTypeSpec = { id: string; label: string; speedKnots: number; rangeM: number; wakeVisible: boolean };

/**
 * Charge de bombes (avions uniquement) — voir bombHitChanceBreakdown. Le
 * piqué (Stuka, Dauntless) vise directement la cible en la gardant en vue
 * jusqu'au largage : nettement plus précis que le bombardement horizontal
 * (He 111, Ju 88 haute altitude), qui doit figer sa solution de tir bien
 * avant l'impact — une cible manoeuvrière esquive alors presque toujours
 * (constat récurrent de la guerre du Pacifique comme de Méditerranée).
 */
export type BombLoadout = {
  count: number;
  /** Poids unitaire en kg — sert à calibrer les dégâts (voir bombDamagePerHit). */
  weightKg: number;
  method: "DIVE" | "LEVEL";
};

export type CombatProfile = {
  guns?: GunBattery[];
  torpedoTubes?: TorpedoBattery;
  /** Types de torpilles au choix (sous-marins) ; absent = type unique de `torpedoTubes`. */
  torpedoTypes?: TorpedoTypeSpec[];
  bombs?: BombLoadout;
};

/** Batterie de torpilles effective pour un tir : type choisi si fourni et disponible, sinon le tube par défaut. */
export function selectTorpedoBattery(
  profile: CombatProfile | null | undefined,
  torpedoTypeId?: string | null
): TorpedoBattery | null {
  if (torpedoTypeId) {
    const type = profile?.torpedoTypes?.find((t) => t.id === torpedoTypeId);
    if (type) return { count: profile?.torpedoTubes?.count ?? 1, rangeM: type.rangeM, speedKnots: type.speedKnots };
  }
  return profile?.torpedoTubes ?? null;
}

/** Les tubes torpilles n'ont pas de champ `arc` obligatoire (héritage) : travers par défaut, la configuration la plus courante. */
export function isTorpedoArcClear(battery: TorpedoBattery, relativeBearingDeg: number): boolean {
  return isInGunArc(battery.arc ?? "BROADSIDE", relativeBearingDeg);
}

/**
 * Dégâts moyens d'un coup de 380mm, calibrés sur l'indication du livret
 * qu'un croiseur lourd bien protégé encaisse 4 à 5 obus de 380 avant de
 * succomber (p. 4).
 *
 * La référence est le potentiel réel des unités du jeu, pas une échelle
 * abstraite : un croiseur lourd classe County vaut 17,2 points dans la base
 * du livret, donc un coup de 380 vaut 17,2 / 4,5 ≈ 3,8 points. (Une version
 * antérieure supposait des navires à ~100 points et rendait chaque impact
 * instantanément fatal — un cuirassé coulait en une salve.)
 */
const REFERENCE_DAMAGE_PER_380MM_HIT = 3.8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Meilleure batterie utilisable à la distance donnée (la plus grosse dont la portée couvre `rangeM`). */
/**
 * `relativeBearingDeg`, si fourni, exclut aussi les pièces dont l'arc de
 * tir ne couvre pas le relèvement de la cible (une tourelle avant ne peut
 * pas viser pile derrière, par exemple).
 */
export function selectGunBattery(
  profile: CombatProfile | null | undefined,
  rangeM: number,
  relativeBearingDeg?: number
): GunBattery | null {
  if (!profile?.guns || profile.guns.length === 0) return null;
  const usable = profile.guns.filter(
    (g) => g.rangeM >= rangeM && (relativeBearingDeg === undefined || isInGunArc(g.arc, relativeBearingDeg))
  );
  if (usable.length === 0) return null;
  return usable.reduce((best, g) => (g.calibreMm > best.calibreMm ? g : best));
}

/** Toutes les pièces à portée et dans l'arc, pas seulement la plus grosse — pour lister les options au joueur. */
export function listUsableGunBatteries(
  profile: CombatProfile | null | undefined,
  rangeM: number,
  relativeBearingDeg?: number
): GunBattery[] {
  if (!profile?.guns) return [];
  return profile.guns.filter(
    (g) => g.rangeM >= rangeM && (relativeBearingDeg === undefined || isInGunArc(g.arc, relativeBearingDeg))
  );
}

/** Détail des facteurs qui composent une chance de toucher — à des fins de transparence/débogage, voir describeHitChanceDebug dans tacticalNarrative.ts. */
export type HitChanceBreakdown = {
  baseAccuracy: number;
  rangeRatio: number;
  rangeFactor: number;
  sizeFactor: number;
  speedFactor: number;
  accuracyMultiplier: number;
  finalPercent: number;
};

export function gunHitChanceBreakdown(params: {
  calibreMm: number;
  rangeM: number;
  maxRangeM: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  /** Télépointage endommagé côté tireur (voir rollLocalizedDamage) : multiplie la précision brute. 1 = intact. */
  accuracyMultiplier?: number;
}): HitChanceBreakdown {
  const rangeRatio = clamp(params.rangeM / params.maxRangeM, 0, 1);
  const rangeFactor = Math.pow(1 - rangeRatio, 1.6);
  const targetArea = Math.max(50, params.targetLengthM * params.targetBeamM);
  // 1800m² ~ un croiseur léger moyen, référence neutre (facteur 1).
  const sizeFactor = clamp(targetArea / 1800, 0.15, 2.2);
  const speedFactor = 1 / (1 + params.targetSpeedKnots / 22);
  const baseAccuracy = params.calibreMm >= 280 ? 0.6 : params.calibreMm >= 150 ? 0.72 : 0.85;
  const accuracyMultiplier = params.accuracyMultiplier ?? 1;
  const finalPercent = clamp(baseAccuracy * rangeFactor * sizeFactor * speedFactor * accuracyMultiplier * 100, 0, 95);
  return { baseAccuracy, rangeRatio, rangeFactor, sizeFactor, speedFactor, accuracyMultiplier, finalPercent };
}

export function gunHitChancePercent(params: Parameters<typeof gunHitChanceBreakdown>[0]): number {
  return gunHitChanceBreakdown(params).finalPercent;
}

function gunDamagePerHit(calibreMm: number, rng: () => number): number {
  const base = REFERENCE_DAMAGE_PER_380MM_HIT * Math.pow(calibreMm / 380, 3);
  const variability = 0.7 + rng() * 0.6; // 0.7x à 1.3x
  return base * variability;
}

/**
 * Nombre de coups au but dans une salve qui a encadré la cible.
 *
 * Une salve encadrante ne met pas la moitié de ses obus au but : au
 * détroit du Danemark, le Bismarck a placé environ 5 coups sur 93 obus
 * tirés. On garde donc une probabilité faible par pièce supplémentaire,
 * pour qu'une salve réussie donne typiquement 1 ou 2 impacts et non la
 * moitié de la bordée.
 */
function rollHitCount(effectiveGunCount: number, rng: () => number): number {
  if (effectiveGunCount <= 0) return 0;
  let hits = 1;
  for (let i = 1; i < effectiveGunCount; i++) {
    if (rng() < 0.12) hits++;
  }
  return hits;
}

export type GunEngagementResult = {
  battery: GunBattery;
  hitChancePercent: number;
  hitChanceBreakdown: HitChanceBreakdown;
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
  /** Relèvement de la cible relatif à la proue : exclut les pièces hors arc. */
  relativeBearingDeg?: number;
  /**
   * Impose cette pièce précise plutôt que de laisser `selectGunBattery` en
   * choisir une automatiquement — nécessaire quand le joueur a
   * explicitement désigné laquelle tirer (tir multi-armes : chaque pièce
   * du bord peut tirer séparément la même manche, pas seulement "la
   * meilleure").
   */
  forcedBattery?: GunBattery;
  /** Télépointage endommagé côté tireur (voir rollLocalizedDamage) : multiplie la précision brute. 1 = intact. */
  accuracyMultiplier?: number;
  rng?: () => number;
}): GunEngagementResult | null {
  const rng = params.rng ?? Math.random;
  const battery = params.forcedBattery ?? selectGunBattery(params.attackerProfile, params.rangeM, params.relativeBearingDeg);
  if (!battery) return null;

  const hitChanceBreakdown = gunHitChanceBreakdown({
    calibreMm: battery.calibreMm,
    rangeM: params.rangeM,
    maxRangeM: battery.rangeM,
    targetLengthM: params.targetLengthM,
    targetBeamM: params.targetBeamM,
    targetSpeedKnots: params.targetSpeedKnots,
    accuracyMultiplier: params.accuracyMultiplier,
  });
  const hitChancePercent = hitChanceBreakdown.finalPercent;

  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;
  if (!hit) {
    return { battery, hitChancePercent, hitChanceBreakdown, hitRoll, hit: false, hits: 0, damagePoints: 0 };
  }

  // La puissance de feu se dégrade en proportion directe des dommages subis (livret p. 8).
  const firepowerRatio = params.attackerHealthMax > 0 ? clamp(params.attackerHealthCurrent / params.attackerHealthMax, 0, 1) : 1;
  const effectiveGunCount = Math.max(1, Math.ceil(battery.count * firepowerRatio));

  const hits = rollHitCount(effectiveGunCount, rng);
  let damagePoints = 0;
  for (let i = 0; i < hits; i++) damagePoints += gunDamagePerHit(battery.calibreMm, rng);

  return { battery, hitChancePercent, hitChanceBreakdown, hitRoll, hit: true, hits, damagePoints };
}

// ── Torpilles ───────────────────────────────────────────────

/**
 * Dégâts moyens d'une torpille de 533mm. Une torpille touche sous la
 * flottaison (voie d'eau, envahissement) et fut historiquement souvent
 * plus dévastatrice qu'un coup de canon équivalent — d'où une référence
 * légèrement supérieure à celle d'un coup de 380mm.
 */
const REFERENCE_DAMAGE_PER_TORPEDO_HIT = 4.8;

/**
 * Chance de toucher pour une torpille. `angleOfAttackDeg` est l'angle entre
 * le cap de la cible et la ligne de tir (0°/180° = cible de face/de dos,
 * la plus dure à toucher ; 90° = cible de travers, la plus facile) — le
 * livret l'appelle « angle de tir », aigu si la cible se rapproche, obtus
 * si elle s'éloigne (p. 6).
 */
export function torpedoHitChanceBreakdown(params: {
  rangeM: number;
  maxRangeM: number;
  torpedoSpeedKnots: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  angleOfAttackDeg: number;
  /** Télépointage endommagé côté tireur (voir rollLocalizedDamage) : multiplie la précision brute. 1 = intact. */
  accuracyMultiplier?: number;
}): HitChanceBreakdown {
  const rangeRatio = clamp(params.rangeM / params.maxRangeM, 0, 1);
  const rangeFactor = Math.pow(1 - rangeRatio, 1.3);
  // Profil exposé par la cible : plein travers (sin=1) présente toute sa
  // longueur, de face/de dos (sin=0) seulement sa largeur.
  const exposedLengthM = Math.max(
    params.targetBeamM,
    params.targetLengthM * Math.abs(Math.sin((params.angleOfAttackDeg * Math.PI) / 180))
  );
  const sizeFactor = clamp((exposedLengthM * params.targetBeamM) / 1800, 0.1, 2.5);
  // Une cible rapide laisse moins de temps pour corriger la solution de tir ;
  // une torpille rapide en laisse moins besoin.
  const speedFactor = params.torpedoSpeedKnots / (params.torpedoSpeedKnots + params.targetSpeedKnots * 1.5);
  const baseAccuracy = 0.55;
  const accuracyMultiplier = params.accuracyMultiplier ?? 1;
  const finalPercent = clamp(baseAccuracy * rangeFactor * sizeFactor * speedFactor * accuracyMultiplier * 100, 0, 90);
  return { baseAccuracy, rangeRatio, rangeFactor, sizeFactor, speedFactor, accuracyMultiplier, finalPercent };
}

export function torpedoHitChancePercent(params: Parameters<typeof torpedoHitChanceBreakdown>[0]): number {
  return torpedoHitChanceBreakdown(params).finalPercent;
}

function torpedoDamagePerHit(rng: () => number): number {
  const variability = 0.75 + rng() * 0.6; // 0.75x à 1.35x
  return REFERENCE_DAMAGE_PER_TORPEDO_HIT * variability;
}

export type TorpedoEngagementResult = {
  battery: TorpedoBattery;
  hitChancePercent: number;
  hitChanceBreakdown: HitChanceBreakdown;
  hitRoll: number;
  hit: boolean;
  hits: number;
  damagePoints: number;
};

/**
 * Résout un engagement de torpilles observateur → cible pour un tour.
 * Retourne `null` si l'attaquant n'a pas de tubes ou si la cible est hors
 * de portée.
 */
export function resolveTorpedoEngagement(params: {
  attackerProfile: CombatProfile | null | undefined;
  attackerHealthCurrent: number;
  attackerHealthMax: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  angleOfAttackDeg: number;
  rangeM: number;
  /** Télépointage endommagé côté tireur (voir rollLocalizedDamage) : multiplie la précision brute. 1 = intact. */
  accuracyMultiplier?: number;
  rng?: () => number;
}): TorpedoEngagementResult | null {
  const rng = params.rng ?? Math.random;
  const battery = params.attackerProfile?.torpedoTubes;
  if (!battery || params.rangeM > battery.rangeM) return null;

  const hitChanceBreakdown = torpedoHitChanceBreakdown({
    rangeM: params.rangeM,
    maxRangeM: battery.rangeM,
    torpedoSpeedKnots: battery.speedKnots,
    targetLengthM: params.targetLengthM,
    targetBeamM: params.targetBeamM,
    targetSpeedKnots: params.targetSpeedKnots,
    angleOfAttackDeg: params.angleOfAttackDeg,
    accuracyMultiplier: params.accuracyMultiplier,
  });
  const hitChancePercent = hitChanceBreakdown.finalPercent;

  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;
  if (!hit) {
    return { battery, hitChancePercent, hitChanceBreakdown, hitRoll, hit: false, hits: 0, damagePoints: 0 };
  }

  const firepowerRatio = params.attackerHealthMax > 0 ? clamp(params.attackerHealthCurrent / params.attackerHealthMax, 0, 1) : 1;
  const effectiveTubeCount = Math.max(1, Math.ceil(battery.count * firepowerRatio));

  const hits = rollHitCount(effectiveTubeCount, rng);
  let damagePoints = 0;
  for (let i = 0; i < hits; i++) damagePoints += torpedoDamagePerHit(rng);

  return { battery, hitChancePercent, hitChanceBreakdown, hitRoll, hit: true, hits, damagePoints };
}

// ── Bombardement aérien (avion → navire) ────────────────────
//
// Une torpille aérienne réutilise resolveTorpedoEngagement tel quel : une
// fois à l'eau, la physique est identique à une torpille de surface (même
// vitesse, même angle d'attaque qui compte). La bombe, en revanche, a un
// profil propre : précision dominée par la méthode d'attaque (piqué vs
// horizontal) plutôt que par la portée, qui n'a pas de sens ici — l'avion
// est toujours "à portée" une fois engagé dans son passage d'attaque.
//
// Précisions de base calibrées sur des constats larges de la guerre (pas
// une bataille précise) : le bombardement en piqué contre un navire de
// guerre isolé et manoeuvrant tournait couramment autour de 25-30% de
// coups au but (Stuka, Dauntless) quand le bombardement horizontal à haute
// altitude contre une cible manoeuvrière descendait souvent sous 5% — la
// solution de tir, figée bien avant l'impact, ne survit presque jamais à
// un changement de cap au bon moment.

const DIVE_BOMB_BASE_ACCURACY = 0.28;
const LEVEL_BOMB_BASE_ACCURACY = 0.04;

/**
 * Dégâts d'une bombe : à poids égal, une bombe explose au contact ou juste
 * sous le pont (pas sous la flottaison comme une torpille) — référence
 * calée sur celle d'un coup de canon de calibre équivalent en énergie
 * plutôt que sur la torpille, nettement plus dévastatrice à poids égal
 * grâce à l'effet de mine sous-marin.
 */
const REFERENCE_BOMB_WEIGHT_KG = 250; // bombe SC250 allemande / 500lb US, calibre courant de la période
function bombDamagePerHit(weightKg: number, rng: () => number): number {
  const base = REFERENCE_DAMAGE_PER_380MM_HIT * 0.55 * Math.pow(weightKg / REFERENCE_BOMB_WEIGHT_KG, 0.9);
  const variability = 0.6 + rng() * 0.8; // 0.6x à 1.4x — une bombe qui touche est plus inégale en effet qu'un obus calibré
  return base * variability;
}

export function bombHitChanceBreakdown(params: {
  method: "DIVE" | "LEVEL";
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  accuracyMultiplier?: number;
}): HitChanceBreakdown {
  const targetArea = Math.max(50, params.targetLengthM * params.targetBeamM);
  const sizeFactor = clamp(targetArea / 1800, 0.15, 2.2);
  // Cible évasive : redoutable en horizontal (elle a le temps de virer
  // avant l'impact), gênante mais surmontable en piqué (le pilote corrige
  // jusqu'au dernier instant).
  const speedFactor = params.method === "DIVE" ? 1 / (1 + params.targetSpeedKnots / 30) : 1 / (1 + params.targetSpeedKnots / 10);
  const baseAccuracy = params.method === "DIVE" ? DIVE_BOMB_BASE_ACCURACY : LEVEL_BOMB_BASE_ACCURACY;
  const accuracyMultiplier = params.accuracyMultiplier ?? 1;
  const finalPercent = clamp(baseAccuracy * sizeFactor * speedFactor * accuracyMultiplier * 100, 0, 70);
  // rangeRatio/rangeFactor n'ont pas de sens pour une bombe (pas de portée
  // graduée comme un canon/une torpille) : fixés à 1, describeHitChanceDebug
  // (tacticalNarrative.ts) saute la ligne correspondante dans ce cas.
  return { baseAccuracy, rangeRatio: 1, rangeFactor: 1, sizeFactor, speedFactor, accuracyMultiplier, finalPercent };
}

export function bombHitChancePercent(params: Parameters<typeof bombHitChanceBreakdown>[0]): number {
  return bombHitChanceBreakdown(params).finalPercent;
}

export type BombingEngagementResult = {
  loadout: BombLoadout;
  hitChancePercent: number;
  hitChanceBreakdown: HitChanceBreakdown;
  hitRoll: number;
  hit: boolean;
  hits: number;
  damagePoints: number;
};

/**
 * Résout un passage de bombardement avion → navire. Retourne `null` si
 * l'attaquant n'a pas de charge de bombes.
 */
export function resolveBombingEngagement(params: {
  attackerProfile: CombatProfile | null | undefined;
  attackerHealthCurrent: number;
  attackerHealthMax: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  /** Télépointage/visée endommagée côté tireur (voir rollLocalizedDamage) : multiplie la précision brute. 1 = intact. */
  accuracyMultiplier?: number;
  rng?: () => number;
}): BombingEngagementResult | null {
  const rng = params.rng ?? Math.random;
  const loadout = params.attackerProfile?.bombs;
  if (!loadout) return null;

  const hitChanceBreakdown = bombHitChanceBreakdown({
    method: loadout.method,
    targetLengthM: params.targetLengthM,
    targetBeamM: params.targetBeamM,
    targetSpeedKnots: params.targetSpeedKnots,
    accuracyMultiplier: params.accuracyMultiplier,
  });
  const hitChancePercent = hitChanceBreakdown.finalPercent;

  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;
  if (!hit) {
    return { loadout, hitChancePercent, hitChanceBreakdown, hitRoll, hit: false, hits: 0, damagePoints: 0 };
  }

  // Un avion endommagé largue quand même toute sa charge d'un coup (pas de
  // dégradation progressive comme une bordée de canons répétée manche
  // après manche) : la santé de l'attaquant ne module donc pas le nombre de
  // bombes larguées, seulement rollHitCount la répartition des coups au but.
  const hits = rollHitCount(Math.max(1, loadout.count), rng);
  let damagePoints = 0;
  for (let i = 0; i < hits; i++) damagePoints += bombDamagePerHit(loadout.weightKg, rng);

  return { loadout, hitChancePercent, hitChanceBreakdown, hitRoll, hit: true, hits, damagePoints };
}

// ── Combat air-air (chasse/interception) ────────────────────
//
// Un dogfight se joue à une échelle physique sans rapport avec l'artillerie
// navale (portées en centaines de mètres, cibles minuscules et très
// rapides) : formule dédiée plutôt qu'une réutilisation des facteurs
// canon/torpille, qui ne veulent rien dire à cette échelle. Le facteur
// dominant est l'écart de maniabilité (UnitClass.agility) entre attaquant
// et défenseur — un chasseur moderne monoplace face à un hydravion ou un
// bombardier lourd domine largement le duel ; deux chasseurs comparables se
// neutralisent davantage.
export function airCombatHitChanceBreakdown(params: {
  attackerAgility: number;
  defenderAgility: number;
  /** Défense active du défenseur (tourelles/mitrailleuses flexibles d'un bombardier/hydravion) : réduit la chance de l'attaquant sans l'annuler — voir historicalNote du Sunderland, surnommé "Flying Porcupine". */
  defenderHasDefensiveGuns: boolean;
  accuracyMultiplier?: number;
}): HitChanceBreakdown {
  const agilityEdge = clamp(params.attackerAgility - params.defenderAgility, -1, 1);
  // 0.5 (agilités égales) jusqu'à ~0.85 (net avantage maniabilité).
  const baseAccuracy = clamp(0.5 + agilityEdge * 0.5, 0.1, 0.85);
  const defenseFactor = params.defenderHasDefensiveGuns ? 0.75 : 1;
  const accuracyMultiplier = params.accuracyMultiplier ?? 1;
  const finalPercent = clamp(baseAccuracy * defenseFactor * accuracyMultiplier * 100, 5, 85);
  return { baseAccuracy, rangeRatio: 1, rangeFactor: 1, sizeFactor: defenseFactor, speedFactor: 1, accuracyMultiplier, finalPercent };
}

export function airCombatHitChancePercent(params: Parameters<typeof airCombatHitChanceBreakdown>[0]): number {
  return airCombatHitChanceBreakdown(params).finalPercent;
}

/**
 * Dégâts d'une passe de mitraillage air-air : les avions de cette période
 * encaissent peu (voir UnitClass.resistancePoints, souvent à un chiffre) —
 * une passe réussie est fréquemment décisive à elle seule, pas une usure
 * progressive comme l'artillerie navale.
 */
function airCombatDamagePerHit(rng: () => number): number {
  const variability = 0.8 + rng() * 0.9; // 0.8x à 1.7x — large, une rafale bien placée peut suffire à elle seule
  return 2.2 * variability;
}

export type AirCombatEngagementResult = {
  hitChancePercent: number;
  hitChanceBreakdown: HitChanceBreakdown;
  hitRoll: number;
  hit: boolean;
  hits: number;
  damagePoints: number;
};

/** Résout une passe d'interception air-air (attaquant → cible), un seul avion à la fois. */
export function resolveAirCombatEngagement(params: {
  attackerAgility: number | null | undefined;
  defenderAgility: number | null | undefined;
  defenderHasDefensiveGuns: boolean;
  accuracyMultiplier?: number;
  rng?: () => number;
}): AirCombatEngagementResult {
  const rng = params.rng ?? Math.random;
  const hitChanceBreakdown = airCombatHitChanceBreakdown({
    attackerAgility: params.attackerAgility ?? 0.5,
    defenderAgility: params.defenderAgility ?? 0.5,
    defenderHasDefensiveGuns: params.defenderHasDefensiveGuns,
    accuracyMultiplier: params.accuracyMultiplier,
  });
  const hitChancePercent = hitChanceBreakdown.finalPercent;

  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;
  if (!hit) {
    return { hitChancePercent, hitChanceBreakdown, hitRoll, hit: false, hits: 0, damagePoints: 0 };
  }

  const hits = rollHitCount(1, rng);
  let damagePoints = 0;
  for (let i = 0; i < hits; i++) damagePoints += airCombatDamagePerHit(rng);

  return { hitChancePercent, hitChanceBreakdown, hitRoll, hit: true, hits, damagePoints };
}

// ── Grenades ASM (attaque en profondeur) ───────────────────
//
// Un sous-marin immergé (SHALLOW/MEDIUM/DEEP) échappe au canon et à la
// torpille classique : seul un escorteur équipé d'ASDIC/hydrophone peut le
// prendre en chasse et l'attaquer aux grenades sous-marines. Portée ASDIC
// effective ~2000m (livret + doctrine réelle, cf. weather.ts) ; plus la
// cible est profonde, plus le réglage de profondeur des grenades et le
// temps de plongée avant explosion laissent de marge d'évasion — d'où une
// difficulté croissante avec le palier.

export type DepthBand = "SHALLOW" | "MEDIUM" | "DEEP";

/** Nombre de grenades consommées par passe d'attaque (livret : ~10 par passe, stock total 40-80). */
export const DEPTH_CHARGES_PER_ATTACK = 10;

const DEPTH_BAND_HIT_FACTOR: Record<DepthBand, number> = {
  SHALLOW: 1,
  MEDIUM: 0.6,
  DEEP: 0.35,
};

/**
 * Une passe de grenades bien réglée était souvent fatale à un sous-marin,
 * mais rarement du premier coup : sur l'échelle de potentiel du livret (un
 * Type VIIC vaut 0,85 point), on vise deux à trois passes réussies.
 */
const REFERENCE_DAMAGE_PER_DEPTH_CHARGE_ATTACK = 0.4;

export function depthChargeHitChancePercent(params: {
  rangeM: number;
  maxRangeM: number;
  targetDepthBand: DepthBand;
}): number {
  const rangeRatio = clamp(params.rangeM / params.maxRangeM, 0, 1);
  const rangeFactor = Math.pow(1 - rangeRatio, 1.2);
  const baseAccuracy = 0.45;
  return clamp(baseAccuracy * rangeFactor * DEPTH_BAND_HIT_FACTOR[params.targetDepthBand] * 100, 0, 80);
}

function depthChargeDamage(rng: () => number): number {
  const variability = 0.7 + rng() * 0.6; // 0.7x à 1.3x
  return REFERENCE_DAMAGE_PER_DEPTH_CHARGE_ATTACK * variability;
}

// ── Dégâts localisés ─────────────────────────────────────────
//
// Au-delà de la perte de PV, un coup au but "solide" pouvait handicaper
// durablement un système précis du navire — c'est souvent ce qui a décidé
// l'issue d'un combat plus que le total de dégâts encaissé. Quatre cas
// documentés de cette période inspirent la table ci-dessous :
//   - Bismarck, 24 mai 1941 : une seule torpille aérienne (Swordfish de
//     l'Ark Royal) bloque son gouvernail à 12° à bâbord — il ne peut plus
//     gouverner et se fait rattraper.
//   - Bismarck, 27 mai 1941 : sa tourelle avant "Anton" est détruite tôt
//     dans son dernier combat, puis son télépointage avant est balayé peu
//     après — sa riposte devient erratique avant même la perte de toutes
//     ses pièces.
//   - Scharnhorst, 26 déc. 1943 (bataille du cap Nord) : un obus de 356mm
//     du Duke of York touche sa salle des chaudières, sa vitesse tombe de
//     30 à ~22 nds — décisif pour qu'il se fasse rattraper et coulé.
//   - Hood, 24 mai 1941 : un coup plongeant à longue portée perce le pont
//     blindé et gagne un magasin — explosion, le navire coule en ~3 minutes.
// Ne s'applique qu'aux bâtiments de surface (tourelles/gouvernail/salle des
// machines n'ont pas de sens pour un sous-marin dans ce modèle) et
// seulement aux coups assez solides pour plausiblement toucher autre chose
// que la coque ; une éraflure ne désactive rien.

export type LocalizedDamageEffect =
  | { type: "NONE" }
  | { type: "MAGAZINE" }
  | { type: "TURRET" }
  | { type: "ENGINE"; speedReductionRatio: number }
  | { type: "RUDDER" }
  | { type: "FIRE_CONTROL" };

/** Un coup retirant moins de 10% du potentiel max de la cible est une éraflure : jamais de dégât localisé. */
export const LOCALIZED_DAMAGE_THRESHOLD = 0.1;

type LocalizedDamageType = LocalizedDamageEffect["type"];

/** Trace complète d'un tirage de dégât localisé, à des fins de transparence/débogage — voir describeLocalizedRollDebug dans tacticalNarrative.ts. */
export type LocalizedDamageDebug = {
  weaponType: WeaponType;
  damageRatio: number;
  threshold: number;
  belowThreshold: boolean;
  /** Table de répartition utilisée (null si sous le seuil, ou grenade ASM qui n'en a pas). */
  table: { type: LocalizedDamageType; weight: number }[] | null;
  /** Valeur brute tirée (rng() * somme des poids) ayant décidé quelle tranche de la table est tombée. */
  roll: number | null;
  rollTotal: number | null;
};

export type LocalizedDamageRoll = { effect: LocalizedDamageEffect; debug: LocalizedDamageDebug };

/**
 * Tire un type dans la table sans construire les effets candidats à
 * l'avance : un littéral `[{...}, poids]` évaluerait tous ses éléments
 * immédiatement, y compris un `rng()` supplémentaire pour un effet qui
 * n'est finalement pas retenu — en ne manipulant que des chaînes ici,
 * `rng()` n'est appelé qu'une fois pour le tirage lui-même.
 */
function weightedPick(table: [LocalizedDamageType, number][], rng: () => number): { type: LocalizedDamageType; roll: number; total: number } {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  const roll = rng() * total;
  let r = roll;
  for (const [type, weight] of table) {
    if (r < weight) return { type, roll, total };
    r -= weight;
  }
  return { type: table[table.length - 1][0], roll, total };
}

/**
 * Localise un coup au but "solide". `damageRatio` est la part du potentiel
 * max de la cible retirée par CE coup (pas le total de la manche) : plus le
 * coup est lourd, plus le seuil est franchi nettement, mais la table de
 * répartition ne varie pas au-delà — un coup deux fois plus fort n'a pas
 * deux fois plus de chances de toucher un organe vital, il est juste plus
 * susceptible d'avoir dépassé le seuil.
 */
export function rollLocalizedDamage(params: { weaponType: WeaponType; damageRatio: number; rng?: () => number }): LocalizedDamageRoll {
  const threshold = LOCALIZED_DAMAGE_THRESHOLD;
  if (params.damageRatio < threshold) {
    return {
      effect: { type: "NONE" },
      debug: { weaponType: params.weaponType, damageRatio: params.damageRatio, threshold, belowThreshold: true, table: null, roll: null, rollTotal: null },
    };
  }
  const rng = params.rng ?? Math.random;

  let table: [LocalizedDamageType, number][] | null = null;
  if (params.weaponType === "TORPEDO") {
    // Coup sous la flottaison : la salle des machines et le gouvernail sont
    // les organes exposés (cas Bismarck) ; les tourelles, topside, sont
    // pratiquement hors de cause.
    table = [
      ["MAGAZINE", 6],
      ["ENGINE", 34],
      ["RUDDER", 26],
      ["FIRE_CONTROL", 4],
      ["NONE", 30],
    ];
  } else if (params.weaponType === "GUN") {
    table = [
      ["MAGAZINE", 4],
      ["TURRET", 22],
      ["ENGINE", 20],
      ["RUDDER", 16],
      ["FIRE_CONTROL", 14],
      ["NONE", 24],
    ];
  } else if (params.weaponType === "BOMB") {
    // Coup vertical sur le pont, pas à plat sur la ceinture : le blindage
    // horizontal de cette période était généralement plus mince que le
    // vertical, d'où un risque de magasin plus élevé qu'un obus équivalent
    // (cas Roma, 1943, bombe guidée dans un magasin). Moins susceptible de
    // désigner une tourelle précise qu'un impact tendu.
    table = [
      ["MAGAZINE", 10],
      ["TURRET", 10],
      ["ENGINE", 22],
      ["RUDDER", 14],
      ["FIRE_CONTROL", 14],
      ["NONE", 30],
    ];
  }

  if (!table) {
    // Grenades ASM, combat air-air : voie d'eau seulement ou sans objet — pas de table dédiée.
    return {
      effect: { type: "NONE" },
      debug: { weaponType: params.weaponType, damageRatio: params.damageRatio, threshold, belowThreshold: false, table: null, roll: null, rollTotal: null },
    };
  }

  const picked = weightedPick(table, rng);
  const debug: LocalizedDamageDebug = {
    weaponType: params.weaponType,
    damageRatio: params.damageRatio,
    threshold,
    belowThreshold: false,
    table: table.map(([type, weight]) => ({ type, weight })),
    roll: picked.roll,
    rollTotal: picked.total,
  };

  // Cas Scharnhorst (cap Nord, 30 -> ~22 nds) : une avarie de machines
  // retranche 15 à 35% de la vitesse max courante, tirée seulement pour
  // l'effet réellement retenu.
  if (picked.type === "ENGINE") return { effect: { type: "ENGINE", speedReductionRatio: 0.15 + rng() * 0.2 }, debug };
  return { effect: { type: picked.type } as LocalizedDamageEffect, debug };
}

export type DepthChargeAttackResult = {
  hitChancePercent: number;
  hitRoll: number;
  hit: boolean;
  damagePoints: number;
  chargesUsed: number;
};

/**
 * Résout une passe d'attaque aux grenades ASM. Retourne `null` si
 * l'escorteur n'a plus assez de grenades pour une passe complète.
 */
export function resolveDepthChargeAttack(params: {
  chargesAvailable: number;
  rangeM: number;
  maxRangeM: number;
  targetDepthBand: DepthBand;
  rng?: () => number;
}): DepthChargeAttackResult | null {
  if (params.chargesAvailable < DEPTH_CHARGES_PER_ATTACK) return null;
  const rng = params.rng ?? Math.random;

  const hitChancePercent = depthChargeHitChancePercent({
    rangeM: params.rangeM,
    maxRangeM: params.maxRangeM,
    targetDepthBand: params.targetDepthBand,
  });
  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;

  return {
    hitChancePercent,
    hitRoll,
    hit,
    damagePoints: hit ? depthChargeDamage(rng) : 0,
    chargesUsed: DEPTH_CHARGES_PER_ATTACK,
  };
}
