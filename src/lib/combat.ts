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

export type CombatProfile = {
  guns?: GunBattery[];
  torpedoTubes?: TorpedoBattery;
  /** Types de torpilles au choix (sous-marins) ; absent = type unique de `torpedoTubes`. */
  torpedoTypes?: TorpedoTypeSpec[];
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
  rng?: () => number;
}): GunEngagementResult | null {
  const rng = params.rng ?? Math.random;
  const battery = params.forcedBattery ?? selectGunBattery(params.attackerProfile, params.rangeM, params.relativeBearingDeg);
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
export function torpedoHitChancePercent(params: {
  rangeM: number;
  maxRangeM: number;
  torpedoSpeedKnots: number;
  targetLengthM: number;
  targetBeamM: number;
  targetSpeedKnots: number;
  angleOfAttackDeg: number;
}): number {
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
  return clamp(baseAccuracy * rangeFactor * sizeFactor * speedFactor * 100, 0, 90);
}

function torpedoDamagePerHit(rng: () => number): number {
  const variability = 0.75 + rng() * 0.6; // 0.75x à 1.35x
  return REFERENCE_DAMAGE_PER_TORPEDO_HIT * variability;
}

export type TorpedoEngagementResult = {
  battery: TorpedoBattery;
  hitChancePercent: number;
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
  rng?: () => number;
}): TorpedoEngagementResult | null {
  const rng = params.rng ?? Math.random;
  const battery = params.attackerProfile?.torpedoTubes;
  if (!battery || params.rangeM > battery.rangeM) return null;

  const hitChancePercent = torpedoHitChancePercent({
    rangeM: params.rangeM,
    maxRangeM: battery.rangeM,
    torpedoSpeedKnots: battery.speedKnots,
    targetLengthM: params.targetLengthM,
    targetBeamM: params.targetBeamM,
    targetSpeedKnots: params.targetSpeedKnots,
    angleOfAttackDeg: params.angleOfAttackDeg,
  });

  const hitRoll = rng() * 100;
  const hit = hitRoll < hitChancePercent;
  if (!hit) {
    return { battery, hitChancePercent, hitRoll, hit: false, hits: 0, damagePoints: 0 };
  }

  const firepowerRatio = params.attackerHealthMax > 0 ? clamp(params.attackerHealthCurrent / params.attackerHealthMax, 0, 1) : 1;
  const effectiveTubeCount = Math.max(1, Math.ceil(battery.count * firepowerRatio));

  const hits = rollHitCount(effectiveTubeCount, rng);
  let damagePoints = 0;
  for (let i = 0; i < hits; i++) damagePoints += torpedoDamagePerHit(rng);

  return { battery, hitChancePercent, hitRoll, hit: true, hits, damagePoints };
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
