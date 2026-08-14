/**
 * Format d'un scénario de la bibliothèque.
 *
 * Volontairement déclaratif et sans dépendance à Prisma : un scénario est
 * une donnée, pas du code d'insertion. C'est ce qui permettra plus tard à
 * l'éditeur de scénarios de produire exactement la même structure, et de
 * la sérialiser en JSON pour la partager entre joueurs.
 */

export type ScenarioSensor = { type: "RADAR" | "VISUAL" | "HYDROPHONE" | "SONAR" | "HF_DF"; rangeNm: number };

export type ScenarioGunArc = "FORWARD" | "AFT" | "ALL_ROUND" | "BROADSIDE";
export type ScenarioGunBattery = {
  calibreMm: number;
  count: number;
  rangeM: number;
  /** Coups par minute et par pièce (cadence réelle du modèle). */
  roundsPerMinute: number;
  arc: ScenarioGunArc;
};
export type ScenarioTorpedoTubes = { count: number; rangeM: number; speedKnots: number; arc?: ScenarioGunArc };
export type ScenarioTorpedoType = {
  id: string;
  label: string;
  speedKnots: number;
  rangeM: number;
  wakeVisible: boolean;
};

/** Charge de bombes (avions) — voir combat.ts, BombLoadout. */
export type ScenarioBombLoadout = { count: number; weightKg: number; method: "DIVE" | "LEVEL" | "SKIP" };
/** DCA embarquée (navires/sous-marins en surface) — voir combat.ts, AntiAircraftBattery. */
export type ScenarioAntiAircraftBattery = { gunCount: number };

export type ScenarioUnitClass = {
  key: string;
  name: string;
  nation: string;
  category: "SURFACE_SHIP" | "SUBMARINE" | "AIRCRAFT";
  maxSpeedKnots: number;
  lengthMeters?: number;
  beamMeters?: number;
  /** Rayon de virage réel (mètres) — voir géométrie du "diamètre tactique" en navigation. */
  turningRadiusM?: number;
  /** Vitesse de changement de vitesse (nœuds/minute) — accélération et décélération, symétriques par simplification. */
  accelerationKnotsPerMin?: number;
  /** Maniabilité en combat air-air (avions), 0-1 — voir combat.ts, airCombatHitChanceBreakdown. */
  agility?: number;
  /** Niveau de l'équipage (avions), "A" (élite) à "F" — voir combat.ts, pilotSkillMultiplier. "C" (moyen) par défaut si absent. */
  pilotSkill?: string;
  sensors: ScenarioSensor[];
  detectability?: number;
  iconKey: string;
  profileImageUrl?: string;
  historicalNote?: string;
  /** Potentiel de résistance (formule du livret : Dw/1000 + blindage + K%). */
  resistancePoints: number;
  combatProfile?: {
    guns?: ScenarioGunBattery[];
    torpedoTubes?: ScenarioTorpedoTubes;
    torpedoTypes?: ScenarioTorpedoType[];
    bombs?: ScenarioBombLoadout;
    antiAircraft?: ScenarioAntiAircraftBattery;
  };
  weaponSystems?: Record<string, unknown>;
  depthChargeStock?: number;
  /** Salves de Hedgehog (une salve = 24 projectiles) — voir UnitClass.hedgehogStock, resolveHedgehogAttack dans combat.ts. */
  hedgehogStock?: number;
  submergedRangeNmAt4kt?: number;
  oxygenEnduranceHours?: number;
  torpedoStock?: number;
  /** Temps de plongée d'urgence (sous-marins), en secondes — voir UnitClass.emergencyDiveSeconds. */
  emergencyDiveSeconds?: number;
  /** Autonomie de vol (avions uniquement) — voir Unit.fuelMinutesRemaining et le bloc 3 (patrouilles). */
  enduranceMinutes?: number;
  /** Installation immobile (ex: station d'écoute côtière) — voir UnitClass.passive. */
  passive?: boolean;
};

export type ScenarioUnit = {
  name: string;
  classKey: string;
  pennant?: string;
  lat: number;
  lng: number;
  headingDeg?: number;
  historicalNote?: string;
  /**
   * Base aérienne d'affectation (avions uniquement) — distincte de lat/lng,
   * qui reste la position de départ affichée sur la carte au premier tour
   * (éventuellement en vol de transit). Un ordre de patrouille aérienne
   * ramène l'avion ici, pas à sa position de départ. Repli sur lat/lng côté
   * moteur si absent.
   *
   * Trois façons alternatives de renseigner cette base (au plus une à la
   * fois, voir ScenarioDefinitionSchema.superRefine) — littérale ci-dessous,
   * ou par référence via `airbaseKey`/`squadronKey`/`carrierUnitName`
   * (constructeur de scénario visuel, retour utilisateur 2026-08-14) :
   * garder les champs littéraux permet aux scénarios existants (écrits à la
   * main) de continuer à fonctionner sans migration.
   */
  baseLat?: number;
  baseLng?: number;
  baseName?: string;
  /** Référence vers `ScenarioDefinition.airbases[].key` — alternative à baseLat/baseLng/baseName. */
  airbaseKey?: string;
  /**
   * Référence vers `ScenarioDefinition.squadrons[].key` (avions uniquement) :
   * la base est héritée de l'escadrille plutôt que fixée unité par unité —
   * voir ScenarioSquadron. Réservé aux avions qui volent en groupe (chasse,
   * bombardement) ; un avion isolé (reconnaissance, attaque navale solitaire)
   * garde `airbaseKey`/`carrierUnitName`/lat-lng littéraux.
   */
  squadronKey?: string;
  /**
   * Référence directe (par nom) vers une autre unité SURFACE_SHIP du même
   * scénario servant de porte-avions — alternative mobile à une base
   * aérienne fixe : la position suit le navire (voir turnEngine.ts,
   * résolution de Unit.airHomeLat/Lng). Pas de simulation de cycles de pont
   * d'envol, juste une référence de base mobile (retour utilisateur
   * 2026-08-14, recherche historique §4.3 Amirauté 2013 — hors périmètre).
   */
  carrierUnitName?: string;
};

/**
 * Base aérienne réutilisable (constructeur de scénario visuel, retour
 * utilisateur 2026-08-14) : créée une fois, référencée par plusieurs avions
 * via `ScenarioUnit.airbaseKey` — remplace la répétition de baseLat/baseLng/
 * baseName sur chaque unité. `key` est local au scénario, comme les clés de
 * `unitClasses`.
 */
export type ScenarioAirbase = {
  key: string;
  name: string;
  lat: number;
  lng: number;
};

/**
 * Escadrille (constructeur de scénario visuel, retour utilisateur
 * 2026-08-14, recherche historique §4.1.1.1 Amirauté 2013 — l'unité
 * opérationnelle réelle de combat aérien est le groupe/escadron, pas
 * l'avion isolé) : regroupe des avions qui partagent une même base
 * (aérienne OU porte-avions, au plus une des deux). Purement organisation
 * à ce stade — le calcul de combat par groupe (dilution DCA §4.6.2.4) est
 * un chantier séparé, non construit ici ; ce conteneur en est le
 * prérequis côté données pour ne pas avoir à refaire l'éditeur plus tard.
 */
export type ScenarioSquadron = {
  key: string;
  name: string;
  airbaseKey?: string;
  carrierUnitName?: string;
};

export type ScenarioFleet = {
  name: string;
  units: ScenarioUnit[];
};

export type ScenarioTeam = {
  name: string;
  colorHex: string;
  fleets: ScenarioFleet[];
};

export type ScenarioWeather = {
  visibilityNm: number;
  seaState: number;
  daylight: "DAY" | "TWILIGHT" | "NIGHT" | "POLAR_NIGHT" | "POLAR_DAY";
  precipitation: "NONE" | "RAIN" | "SNOW" | "FOG";
  windKnots?: number;
  notes?: string;
};

export type ScenarioDefinition = {
  key: string;
  name: string;
  description: string;
  /** Contexte historique long, affiché aux joueurs au lancement. */
  briefing: string;
  dateLabel: string;
  mapCenterLat: number;
  mapCenterLng: number;
  mapDefaultZoom: number;
  defaultTurnMinutes: number;
  /** Durée d'une manche une fois le combat tactique engagé. */
  tacticalRoundMinutes: number;
  weather: ScenarioWeather;
  /**
   * Chaque entrée est soit une classe définie en ligne (comme aujourd'hui),
   * soit une simple référence { key, libraryKey } vers une classe de la
   * bibliothèque partagée (/library, arbitre) — résolue à l'instanciation
   * (voir instantiateScenario). `key` reste la clé LOCALE au scénario
   * (référencée par ScenarioUnit.classKey plus bas), indépendante du
   * libraryKey qui peut différer.
   */
  unitClasses: (ScenarioUnitClass | { key: string; libraryKey: string })[];
  teams: ScenarioTeam[];
  /** Bases aériennes réutilisables (constructeur visuel, retour utilisateur 2026-08-14) — voir ScenarioAirbase. */
  airbases?: ScenarioAirbase[];
  /** Escadrilles (constructeur visuel, retour utilisateur 2026-08-14) — voir ScenarioSquadron. */
  squadrons?: ScenarioSquadron[];
  /** Objectifs affichés à chaque camp, pour donner un but clair à la partie. */
  objectives: { teamName: string; text: string }[];
  source: string;
};
