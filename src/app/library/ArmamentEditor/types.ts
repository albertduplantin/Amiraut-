/**
 * Types partagés par les éditeurs d'armement visuels (retour utilisateur
 * 2026-08-14, remplace les 3 textareas JSON de LibraryForm.tsx) — miroir
 * manuel des schémas zod de prisma/scenarios/validation.ts (mêmes noms de
 * champs, même forme), pas une réutilisation directe : ces schémas restent
 * la source de vérité pour la validation serveur, ceux-ci ne servent qu'à
 * typer l'état du formulaire.
 */

export type SensorType = "RADAR" | "VISUAL" | "HYDROPHONE" | "SONAR" | "HF_DF";
export type Sensor = { type: SensorType; rangeNm: number };

export type GunArc = "FORWARD" | "AFT" | "ALL_ROUND" | "BROADSIDE";
export type GunBattery = {
  calibreMm: number;
  count: number;
  rangeM: number;
  roundsPerMinute: number;
  arc: GunArc;
};

export type TorpedoTubes = {
  count: number;
  rangeM: number;
  speedKnots: number;
  arc?: GunArc;
};

export type TorpedoType = {
  id: string;
  label: string;
  speedKnots: number;
  rangeM: number;
  wakeVisible: boolean;
};

export type BombMethod = "DIVE" | "LEVEL" | "SKIP";
export type BombLoadout = {
  count: number;
  weightKg: number;
  method: BombMethod;
};

export type AntiAircraftBattery = { gunCount: number };

export type CombatProfileValue = {
  guns: GunBattery[];
  torpedoTubes: TorpedoTubes | null;
  torpedoTypes: TorpedoType[];
  bombs: BombLoadout | null;
  antiAircraft: AntiAircraftBattery | null;
};

export const EMPTY_COMBAT_PROFILE: CombatProfileValue = {
  guns: [],
  torpedoTubes: null,
  torpedoTypes: [],
  bombs: null,
  antiAircraft: null,
};

/** Reconstruit un CombatProfileValue depuis le JSON déjà en base (édition d'une classe existante) — tolérant à un objet incomplet/mal formé plutôt que de planter. */
export function combatProfileFromJson(value: unknown): CombatProfileValue {
  if (!value || typeof value !== "object") return EMPTY_COMBAT_PROFILE;
  const v = value as Record<string, unknown>;
  return {
    guns: Array.isArray(v.guns) ? (v.guns as GunBattery[]) : [],
    torpedoTubes: v.torpedoTubes && typeof v.torpedoTubes === "object" ? (v.torpedoTubes as TorpedoTubes) : null,
    torpedoTypes: Array.isArray(v.torpedoTypes) ? (v.torpedoTypes as TorpedoType[]) : [],
    bombs: v.bombs && typeof v.bombs === "object" ? (v.bombs as BombLoadout) : null,
    antiAircraft: v.antiAircraft && typeof v.antiAircraft === "object" ? (v.antiAircraft as AntiAircraftBattery) : null,
  };
}

/** Objet combatProfile prêt à envoyer au serveur — undefined (pas {}) si rien n'est renseigné, pour rester optionnel côté zod. */
export function combatProfileToJson(value: CombatProfileValue): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (value.guns.length > 0) out.guns = value.guns;
  if (value.torpedoTubes) out.torpedoTubes = value.torpedoTubes;
  if (value.torpedoTypes.length > 0) out.torpedoTypes = value.torpedoTypes;
  if (value.bombs) out.bombs = value.bombs;
  if (value.antiAircraft) out.antiAircraft = value.antiAircraft;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sensorsFromJson(value: unknown): Sensor[] {
  return Array.isArray(value) ? (value as Sensor[]) : [];
}

export type WeaponSystemRow = { label: string; value: string };

/** weaponSystems (JSON libre, texte affiché aux joueurs) modélisé comme des lignes libellé/valeur plutôt qu'un objet arbitraire — toutes les classes existantes n'y stockent que des chaînes descriptives (ex: "6 x 152mm"). */
export function weaponSystemsFromJson(value: unknown): WeaponSystemRow[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).map(([label, v]) => ({ label, value: String(v) }));
}

export function weaponSystemsToJson(rows: WeaponSystemRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const label = row.label.trim();
    if (!label) continue;
    out[label] = row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
