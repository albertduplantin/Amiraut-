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
  };
  weaponSystems?: Record<string, unknown>;
  depthChargeStock?: number;
  submergedRangeNmAt4kt?: number;
  oxygenEnduranceHours?: number;
  torpedoStock?: number;
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
   */
  baseLat?: number;
  baseLng?: number;
  baseName?: string;
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
  unitClasses: ScenarioUnitClass[];
  teams: ScenarioTeam[];
  /** Objectifs affichés à chaque camp, pour donner un but clair à la partie. */
  objectives: { teamName: string; text: string }[];
  source: string;
};
