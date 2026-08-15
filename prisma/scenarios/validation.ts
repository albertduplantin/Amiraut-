import { z } from "zod";
import type { ScenarioDefinition } from "./types";

/**
 * Miroir zod de `ScenarioDefinition` (types.ts), pour valider un scénario
 * créé par un joueur avant de l'enregistrer ou de l'instancier — jamais
 * confiance dans un JSON venu du client, même si un aperçu l'a déjà
 * accepté côté navigateur.
 */

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

const SensorSchema = z.object({
  type: z.enum(["RADAR", "VISUAL", "HYDROPHONE", "SONAR", "HF_DF"]),
  rangeNm: z.number().positive(),
});

const GunArcSchema = z.enum(["FORWARD", "AFT", "ALL_ROUND", "BROADSIDE"]);

const GunBatterySchema = z.object({
  calibreMm: z.number().positive(),
  count: z.number().int().positive(),
  rangeM: z.number().positive(),
  roundsPerMinute: z.number().positive(),
  arc: GunArcSchema,
});

const TorpedoTubesSchema = z.object({
  count: z.number().int().positive(),
  rangeM: z.number().positive(),
  speedKnots: z.number().positive(),
  arc: GunArcSchema.optional(),
});

const TorpedoTypeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  speedKnots: z.number().positive(),
  rangeM: z.number().positive(),
  wakeVisible: z.boolean(),
});

const BombLoadoutSchema = z.object({
  count: z.number().int().positive(),
  weightKg: z.number().positive(),
  method: z.enum(["DIVE", "LEVEL", "SKIP"]),
});

const AntiAircraftBatterySchema = z.object({
  gunCount: z.number().int().positive(),
});

export const UnitClassSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  nation: z.string().min(1),
  category: z.enum(["SURFACE_SHIP", "SUBMARINE", "AIRCRAFT"]),
  maxSpeedKnots: z.number().positive(),
  lengthMeters: z.number().positive().optional(),
  beamMeters: z.number().positive().optional(),
  turningRadiusM: z.number().positive().optional(),
  accelerationKnotsPerMin: z.number().positive().optional(),
  // Combat air-air (avions) — voir combat.ts, airCombatHitChanceBreakdown.
  agility: z.number().min(0).max(1).optional(),
  pilotSkill: z.enum(["A", "B", "C", "D", "E", "F"]).optional(),
  sensors: z.array(SensorSchema).min(1, "au moins un capteur"),
  detectability: z.number().positive().optional(),
  iconKey: z.string().min(1),
  profileImageUrl: z.string().optional(),
  historicalNote: z.string().optional(),
  resistancePoints: z.number().positive(),
  combatProfile: z
    .object({
      guns: z.array(GunBatterySchema).optional(),
      torpedoTubes: TorpedoTubesSchema.optional(),
      torpedoTypes: z.array(TorpedoTypeSchema).optional(),
      bombs: BombLoadoutSchema.optional(),
      antiAircraft: AntiAircraftBatterySchema.optional(),
    })
    .optional(),
  weaponSystems: z.record(z.string(), z.unknown()).optional(),
  depthChargeStock: z.number().int().nonnegative().optional(),
  hedgehogStock: z.number().int().nonnegative().optional(),
  submergedRangeNmAt4kt: z.number().positive().optional(),
  oxygenEnduranceHours: z.number().positive().optional(),
  torpedoStock: z.number().int().nonnegative().optional(),
  emergencyDiveSeconds: z.number().positive().optional(),
  enduranceMinutes: z.number().positive().optional(),
  passive: z.boolean().optional(),
});

/** Variante bibliothèque (arbitre, /library) : mêmes champs + un repère de classement libre. */
export const LibraryUnitClassSchema = UnitClassSchema.extend({
  theater: z.string().optional(),
});

const UnitSchema = z.object({
  name: z.string().min(1),
  classKey: z.string().min(1),
  pennant: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  headingDeg: z.number().min(0).max(360).optional(),
  historicalNote: z.string().optional(),
  baseLat: z.number().min(-90).max(90).optional(),
  baseLng: z.number().min(-180).max(180).optional(),
  baseName: z.string().optional(),
  // Alternatives à baseLat/baseLng/baseName (constructeur visuel, retour
  // utilisateur 2026-08-14) — au plus une source de base, voir le
  // superRefine de ScenarioDefinitionSchema plus bas.
  airbaseKey: z.string().min(1).optional(),
  squadronKey: z.string().min(1).optional(),
  carrierUnitName: z.string().min(1).optional(),
});

/** Base aérienne réutilisable — voir ScenarioAirbase (types.ts). */
const AirbaseSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Optionnel, purement informatif côté constructeur — voir ScenarioAirbase.teamName (types.ts).
  teamName: z.string().min(1).optional(),
});

/** Escadrille — voir ScenarioSquadron (types.ts). */
const SquadronSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  airbaseKey: z.string().min(1).optional(),
  carrierUnitName: z.string().min(1).optional(),
});

const FleetSchema = z.object({
  name: z.string().min(1),
  units: z.array(UnitSchema).min(1, "une flotte doit avoir au moins une unité"),
});

const TeamSchema = z.object({
  name: z.string().min(1),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "couleur hexadécimale attendue, ex: #3388ff"),
  // Optionnel — voir ScenarioTeam.nation, types.ts (rétrocompatibilité).
  nation: z.string().min(1).optional(),
  fleets: z.array(FleetSchema).min(1, "une équipe doit avoir au moins une flotte"),
});

/** Référence minimale vers une classe de la bibliothèque partagée (/library) — voir types.ts. */
const UnitClassRefSchema = z.object({
  key: z.string().min(1),
  libraryKey: z.string().min(1),
});
const UnitClassEntrySchema = z.union([UnitClassSchema, UnitClassRefSchema]);

const WeatherSchema = z.object({
  visibilityNm: z.number().positive(),
  seaState: z.number().min(0).max(9),
  daylight: z.enum(["DAY", "TWILIGHT", "NIGHT", "POLAR_NIGHT", "POLAR_DAY"]),
  precipitation: z.enum(["NONE", "RAIN", "SNOW", "FOG"]),
  windKnots: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const ScenarioDefinitionSchema = z
  .object({
    key: z.string().regex(KEY_PATTERN, "minuscules, chiffres, tirets, 3 à 64 caractères"),
    name: z.string().min(1),
    description: z.string().min(1),
    briefing: z.string().min(1),
    dateLabel: z.string().min(1),
    mapCenterLat: z.number().min(-90).max(90),
    mapCenterLng: z.number().min(-180).max(180),
    mapDefaultZoom: z.number().min(1).max(18),
    defaultTurnMinutes: z.number().int().min(5).max(1440),
    tacticalRoundMinutes: z.number().int().min(1).max(60),
    weather: WeatherSchema,
    unitClasses: z.array(UnitClassEntrySchema).min(1, "au moins une classe d'unité"),
    teams: z.array(TeamSchema).min(2, "au moins deux équipes"),
    // Bases aériennes réutilisables (constructeur visuel, retour utilisateur
    // 2026-08-14) — voir ScenarioAirbase (types.ts).
    airbases: z.array(AirbaseSchema).optional(),
    // Escadrilles (même retour utilisateur) — voir ScenarioSquadron (types.ts).
    squadrons: z.array(SquadronSchema).optional(),
    objectives: z.array(z.object({ teamName: z.string().min(1), text: z.string().min(1) })),
    source: z.string().min(1),
  })
  .superRefine((def, ctx) => {
    const classKeys = new Set(def.unitClasses.map((c) => c.key));
    const teamNames = new Set(def.teams.map((t) => t.name));
    const airbaseKeys = new Set((def.airbases ?? []).map((a) => a.key));
    const squadronKeys = new Set((def.squadrons ?? []).map((s) => s.key));
    // Catégorie par clé de classe — seulement connue pour les classes
    // définies EN LIGNE (UnitClassSchema complet) ; une référence
    // { key, libraryKey } n'est résolue qu'à l'instanciation (accès DB
    // asynchrone) — voir instantiateScenario, seul endroit qui peut
    // appliquer strictement "réservé aux avions"/"doit être un navire" pour
    // ce cas-là. Ici, contrôle au mieux, sans faux positif.
    const categoryByClassKey = new Map(
      def.unitClasses.filter((c): c is typeof c & { category: string } => "category" in c).map((c) => [c.key, c.category])
    );
    // Nom → catégorie (au mieux, même limite) de toutes les unités du
    // scénario — pour valider `carrierUnitName` (doit référencer un navire).
    const categoryByUnitName = new Map<string, string | undefined>();
    for (const team of def.teams) {
      for (const fleet of team.fleets) {
        for (const unit of fleet.units) {
          categoryByUnitName.set(unit.name, categoryByClassKey.get(unit.classKey));
        }
      }
    }

    for (const [ai, airbase] of (def.airbases ?? []).entries()) {
      if (airbase.teamName && !teamNames.has(airbase.teamName)) {
        ctx.addIssue({ code: "custom", message: `équipe inconnue « ${airbase.teamName} »`, path: ["airbases", ai, "teamName"] });
      }
    }

    for (const [si, squadron] of (def.squadrons ?? []).entries()) {
      if (squadron.airbaseKey && !airbaseKeys.has(squadron.airbaseKey)) {
        ctx.addIssue({ code: "custom", message: `base aérienne inconnue « ${squadron.airbaseKey} »`, path: ["squadrons", si, "airbaseKey"] });
      }
      if (squadron.carrierUnitName) {
        const carrierCategory = categoryByUnitName.get(squadron.carrierUnitName);
        if (!categoryByUnitName.has(squadron.carrierUnitName)) {
          ctx.addIssue({ code: "custom", message: `unité porte-avions inconnue « ${squadron.carrierUnitName} »`, path: ["squadrons", si, "carrierUnitName"] });
        } else if (carrierCategory && carrierCategory !== "SURFACE_SHIP") {
          ctx.addIssue({ code: "custom", message: `« ${squadron.carrierUnitName} » n'est pas un navire de surface`, path: ["squadrons", si, "carrierUnitName"] });
        }
      }
      if (squadron.airbaseKey && squadron.carrierUnitName) {
        ctx.addIssue({ code: "custom", message: `« ${squadron.name} » : base aérienne OU porte-avions, pas les deux`, path: ["squadrons", si] });
      }
    }
    const dupSquadronKeys = (def.squadrons ?? []).map((s) => s.key).filter((k, i, arr) => arr.indexOf(k) !== i);
    if (dupSquadronKeys.length > 0) {
      ctx.addIssue({ code: "custom", message: `clés d'escadrille en double : ${dupSquadronKeys.join(", ")}`, path: ["squadrons"] });
    }

    for (const [ti, team] of def.teams.entries()) {
      const fleetNamesInTeam = new Map<string, number>();
      for (const [fi, fleet] of team.fleets.entries()) {
        fleetNamesInTeam.set(fleet.name, (fleetNamesInTeam.get(fleet.name) ?? 0) + 1);
        for (const [ui, unit] of fleet.units.entries()) {
          if (!classKeys.has(unit.classKey)) {
            ctx.addIssue({
              code: "custom",
              message: `classe d'unité inconnue « ${unit.classKey} »`,
              path: ["teams", ti, "fleets", fi, "units", ui, "classKey"],
            });
          }
          if (unit.airbaseKey && !airbaseKeys.has(unit.airbaseKey)) {
            ctx.addIssue({
              code: "custom",
              message: `base aérienne inconnue « ${unit.airbaseKey} »`,
              path: ["teams", ti, "fleets", fi, "units", ui, "airbaseKey"],
            });
          }
          if (unit.squadronKey && !squadronKeys.has(unit.squadronKey)) {
            ctx.addIssue({
              code: "custom",
              message: `escadrille inconnue « ${unit.squadronKey} »`,
              path: ["teams", ti, "fleets", fi, "units", ui, "squadronKey"],
            });
          }
          if (unit.carrierUnitName) {
            const carrierCategory = categoryByUnitName.get(unit.carrierUnitName);
            if (!categoryByUnitName.has(unit.carrierUnitName)) {
              ctx.addIssue({
                code: "custom",
                message: `unité porte-avions inconnue « ${unit.carrierUnitName} »`,
                path: ["teams", ti, "fleets", fi, "units", ui, "carrierUnitName"],
              });
            } else if (carrierCategory && carrierCategory !== "SURFACE_SHIP") {
              ctx.addIssue({
                code: "custom",
                message: `« ${unit.carrierUnitName} » n'est pas un navire de surface`,
                path: ["teams", ti, "fleets", fi, "units", ui, "carrierUnitName"],
              });
            }
          }
          // squadronKey/carrierUnitName réservés aux avions — vérifié au
          // mieux (catégorie de CETTE unité connue seulement si sa classe
          // est définie en ligne, voir categoryByClassKey plus haut).
          const ownCategory = categoryByClassKey.get(unit.classKey);
          if ((unit.squadronKey || unit.carrierUnitName) && ownCategory && ownCategory !== "AIRCRAFT") {
            ctx.addIssue({
              code: "custom",
              message: `${unit.name} : escadrille/porte-avions réservés aux avions`,
              path: ["teams", ti, "fleets", fi, "units", ui],
            });
          }
          // Au plus UNE source de base : littérale (baseLat/baseLng), base
          // aérienne (airbaseKey), escadrille (squadronKey) ou porte-avions
          // (carrierUnitName) — sinon ambigu, laquelle prime ?
          const baseSourcesCount =
            (unit.baseLat != null || unit.baseLng != null ? 1 : 0) +
            (unit.airbaseKey ? 1 : 0) +
            (unit.squadronKey ? 1 : 0) +
            (unit.carrierUnitName ? 1 : 0);
          if (baseSourcesCount > 1) {
            ctx.addIssue({
              code: "custom",
              message: `${unit.name} : une seule source de base à la fois (position directe, base aérienne, escadrille ou porte-avions)`,
              path: ["teams", ti, "fleets", fi, "units", ui],
            });
          }
        }
      }
      const dupFleetNames = Array.from(fleetNamesInTeam.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name);
      if (dupFleetNames.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `« ${team.name} » : noms de flotte en double : ${dupFleetNames.join(", ")}`,
          path: ["teams", ti, "fleets"],
        });
      }
    }
    for (const [oi, objective] of def.objectives.entries()) {
      if (!teamNames.has(objective.teamName)) {
        ctx.addIssue({
          code: "custom",
          message: `équipe inconnue « ${objective.teamName} »`,
          path: ["objectives", oi, "teamName"],
        });
      }
    }
    const dupClassKeys = def.unitClasses.map((c) => c.key).filter((k, i, arr) => arr.indexOf(k) !== i);
    if (dupClassKeys.length > 0) {
      ctx.addIssue({ code: "custom", message: `clés de classe en double : ${dupClassKeys.join(", ")}`, path: ["unitClasses"] });
    }
    const dupTeamNames = def.teams.map((t) => t.name).filter((n, i, arr) => arr.indexOf(n) !== i);
    if (dupTeamNames.length > 0) {
      ctx.addIssue({ code: "custom", message: `noms d'équipe en double : ${dupTeamNames.join(", ")}`, path: ["teams"] });
    }
    const dupAirbaseKeys = (def.airbases ?? []).map((a) => a.key).filter((k, i, arr) => arr.indexOf(k) !== i);
    if (dupAirbaseKeys.length > 0) {
      ctx.addIssue({ code: "custom", message: `clés de base aérienne en double : ${dupAirbaseKeys.join(", ")}`, path: ["airbases"] });
    }
  });

/** Valide un JSON quelconque en `ScenarioDefinition`, ou lève une erreur lisible (une ligne par problème). */
export function validateScenarioDefinition(input: unknown): ScenarioDefinition {
  const result = ScenarioDefinitionSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join(".") || "(racine)"} : ${issue.message}`);
    throw new Error(lines.join("\n"));
  }
  return result.data as ScenarioDefinition;
}
