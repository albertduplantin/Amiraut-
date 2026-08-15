import type { PrismaClient } from "../../src/generated/prisma/client";
import type { ScenarioDefinition, ScenarioUnitClass } from "./types";
import { validateScenarioDefinition } from "./validation";
import { denmarkStrait } from "./denmark-strait";
import { northCape } from "./north-cape";
import { pq18 } from "./pq18";
import { hg53 } from "./hg53";
import { biscay1943 } from "./biscay-1943";

/**
 * Bibliothèque de scénarios intégrés. Ajouter un scénario = ajouter une
 * définition ici ; les scénarios créés par les joueurs (module éditeur,
 * voir src/app/scenarios/new) suivent exactement le même format, stockés en
 * base dans `CustomScenario` — voir findScenarioAsync/listAllScenarioSummaries
 * ci-dessous pour les deux confondus.
 */
export const SCENARIO_LIBRARY: ScenarioDefinition[] = [denmarkStrait, northCape, pq18, hg53, biscay1943];

export function findScenario(key: string): ScenarioDefinition | undefined {
  return SCENARIO_LIBRARY.find((s) => s.key === key);
}

/** Résumé léger d'un scénario pour une liste de sélection (voir /create). */
export type ScenarioSummary = {
  key: string;
  name: string;
  description: string;
  dateLabel: string;
  defaultTurnMinutes: number;
  teamNames: string[];
  // Détail flotte/unité par équipe : permet à /create de proposer, sans
  // instancier le scénario au préalable, à quel joueur chaque flotte est
  // confiée (bloc 2) et dans quelle flotte chaque unité démarre (bloc 2,
  // répartition des forces modifiable).
  teams: { name: string; fleets: { name: string; unitNames: string[] }[] }[];
  custom: boolean;
  /** `id` de la ligne `CustomScenario` — présent uniquement pour un scénario custom (retour utilisateur 2026-08-15) : permet à /create de proposer "Modifier" (édition en place, identifiée par id) en plus de "Dupliquer et modifier". Absent pour un scénario intégré, qui n'a pas de ligne en base. */
  id?: string;
};

function toSummary(def: ScenarioDefinition, custom: boolean, id?: string): ScenarioSummary {
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    dateLabel: def.dateLabel,
    defaultTurnMinutes: def.defaultTurnMinutes,
    teamNames: def.teams.map((t) => t.name),
    teams: def.teams.map((t) => ({
      name: t.name,
      fleets: t.fleets.map((f) => ({ name: f.name, unitNames: f.units.map((u) => u.name) })),
    })),
    custom,
    id,
  };
}

/** Bibliothèque intégrée + scénarios créés par les joueurs, pour la page /create. */
export async function listAllScenarioSummaries(prisma: PrismaClient): Promise<ScenarioSummary[]> {
  const custom = await prisma.customScenario.findMany({ orderBy: { createdAt: "desc" } });
  const customSummaries: ScenarioSummary[] = [];
  for (const c of custom) {
    try {
      customSummaries.push(toSummary(validateScenarioDefinition(c.definition), true, c.id));
    } catch {
      // Un scénario custom invalide (schéma changé depuis) n'empêche pas
      // d'afficher le reste de la bibliothèque — juste ignoré ici.
    }
  }
  return [...SCENARIO_LIBRARY.map((s) => toSummary(s, false)), ...customSummaries];
}

/** Cherche un scénario par clé, dans la bibliothèque intégrée puis dans les scénarios créés par les joueurs. */
export async function findScenarioAsync(prisma: PrismaClient, key: string): Promise<ScenarioDefinition | undefined> {
  const builtin = findScenario(key);
  if (builtin) return builtin;
  const custom = await prisma.customScenario.findUnique({ where: { key } });
  if (!custom) return undefined;
  return validateScenarioDefinition(custom.definition);
}

/**
 * Cherche un scénario CUSTOM par `id` (retour utilisateur 2026-08-15 —
 * "modifier un scénario sans nécessairement le dupliquer") : `id`, pas
 * `key`, car la clé reste éditable dans le formulaire — l'identifier par sa
 * clé casserait la ré-identification si l'utilisateur la modifie avant
 * d'enregistrer. Volontairement absent de la bibliothèque intégrée : ces
 * scénarios sont du code source, aucune ligne en base à retrouver/écraser.
 */
export async function findCustomScenarioById(prisma: PrismaClient, id: string): Promise<ScenarioDefinition | undefined> {
  const custom = await prisma.customScenario.findUnique({ where: { id } });
  if (!custom) return undefined;
  return validateScenarioDefinition(custom.definition);
}

/**
 * Instancie une définition de scénario en base : classes d'unités, équipes,
 * flottes, unités, météo et premier tour. Retourne les jetons d'invitation.
 */
export type PlayerSlotConfig = {
  displayName: string;
  colorHex: string;
  /** null = accès à toute l'équipe (comportement historique) ; sinon, liste de noms de flottes (voir ScenarioFleet.name). */
  fleetNames: string[] | null;
};

export async function instantiateScenario(
  prisma: PrismaClient,
  definition: ScenarioDefinition,
  options: {
    withArbiter?: boolean;
    turnMinutesOverride?: number;
    // Bloc 2 (plusieurs joueurs par camp) : un ou plusieurs joueurs par
    // équipe, chacun scopé à un sous-ensemble de flottes. Équipe absente de
    // cette table = comportement historique (un seul joueur, toute l'équipe).
    playersByTeamName?: Record<string, PlayerSlotConfig[]>;
    // Bloc 2 (répartition des forces modifiable à la création) : déplace une
    // unité vers une autre flotte de la MÊME équipe que celle définie dans
    // le scénario — clé "équipe::flotteOrigine::unité" → nom de la flotte
    // cible. Unité absente de cette table = flotte d'origine du scénario.
    fleetOverridesByUnit?: Record<string, string>;
  } = {}
) {
  // Échelle de temps initiale ajustable à la création (Lobby) : ne change
  // que la durée du premier tour stratégique, pas l'échelle du combat
  // tactique (tacticalRoundMinutes), qui reste dictée par la cadence des
  // pièces une fois le combat engagé.
  const turnMinutes = options.turnMinutesOverride ?? definition.defaultTurnMinutes;

  const scenario = await prisma.scenario.create({
    data: {
      name: definition.name,
      description: definition.description,
      mapCenterLat: definition.mapCenterLat,
      mapCenterLng: definition.mapCenterLng,
      mapDefaultZoom: definition.mapDefaultZoom,
      defaultTurnMinutes: turnMinutes,
      status: "ACTIVE",
    },
  });

  // Classes d'unités — résout d'abord les références à la bibliothèque
  // partagée (voir types.ts, { key, libraryKey }) en classes complètes.
  const classIdByKey = new Map<string, string>();
  const resolvedUnitClasses: ScenarioUnitClass[] = await Promise.all(
    definition.unitClasses.map(async (uc): Promise<ScenarioUnitClass> => {
      if (!("libraryKey" in uc)) return uc;
      const lib = await prisma.libraryUnitClass.findUnique({ where: { key: uc.libraryKey } });
      if (!lib) throw new Error(`Classe de bibliothèque introuvable : « ${uc.libraryKey} » (référencée par la clé locale « ${uc.key} »)`);
      return {
        key: uc.key,
        name: lib.name,
        nation: lib.nation,
        category: lib.category,
        maxSpeedKnots: lib.maxSpeedKnots,
        lengthMeters: lib.lengthMeters ?? undefined,
        beamMeters: lib.beamMeters ?? undefined,
        turningRadiusM: lib.turningRadiusM ?? undefined,
        accelerationKnotsPerMin: lib.accelerationKnotsPerMin ?? undefined,
        agility: lib.agility ?? undefined,
        pilotSkill: lib.pilotSkill ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sensors: lib.sensors as any,
        detectability: lib.detectability,
        iconKey: lib.iconKey,
        profileImageUrl: lib.profileImageUrl ?? undefined,
        historicalNote: lib.historicalNote ?? undefined,
        resistancePoints: lib.resistancePoints,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combatProfile: (lib.combatProfile as any) ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        weaponSystems: (lib.weaponSystems as any) ?? undefined,
        depthChargeStock: lib.depthChargeStock ?? undefined,
        hedgehogStock: lib.hedgehogStock ?? undefined,
        submergedRangeNmAt4kt: lib.submergedRangeNmAt4kt ?? undefined,
        oxygenEnduranceHours: lib.oxygenEnduranceHours ?? undefined,
        torpedoStock: lib.torpedoStock ?? undefined,
        emergencyDiveSeconds: lib.emergencyDiveSeconds ?? undefined,
        enduranceMinutes: lib.enduranceMinutes ?? undefined,
        passive: lib.passive,
      };
    })
  );

  for (const uc of resolvedUnitClasses) {
    const created = await prisma.unitClass.create({
      data: {
        name: uc.name,
        nation: uc.nation,
        category: uc.category,
        maxSpeedKnots: uc.maxSpeedKnots,
        lengthMeters: uc.lengthMeters,
        beamMeters: uc.beamMeters,
        turningRadiusM: uc.turningRadiusM,
        accelerationKnotsPerMin: uc.accelerationKnotsPerMin,
        agility: uc.agility,
        pilotSkill: uc.pilotSkill,
        sensors: uc.sensors,
        detectability: uc.detectability ?? 1,
        iconKey: uc.iconKey,
        profileImageUrl: uc.profileImageUrl,
        historicalNote: uc.historicalNote,
        enduranceMinutes: uc.enduranceMinutes,
        passive: uc.passive ?? false,
        combatProfile: uc.combatProfile ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        weaponSystems: (uc.weaponSystems as any) ?? undefined,
        depthChargeStock: uc.depthChargeStock,
        hedgehogStock: uc.hedgehogStock,
        submergedRangeNmAt4kt: uc.submergedRangeNmAt4kt,
        oxygenEnduranceHours: uc.oxygenEnduranceHours,
        torpedoStock: uc.torpedoStock,
        emergencyDiveSeconds: uc.emergencyDiveSeconds,
      },
    });
    classIdByKey.set(uc.key, created.id);
  }
  const resistanceByKey = new Map(resolvedUnitClasses.map((uc) => [uc.key, uc.resistancePoints]));

  // Bases aériennes réutilisables (constructeur visuel, retour utilisateur
  // 2026-08-14) — résolues ici en baseLat/baseLng/baseName au moment de
  // créer chaque unité, voir ScenarioAirbase (types.ts).
  const airbaseByKey = new Map((definition.airbases ?? []).map((a) => [a.key, a]));

  // Équipes, flottes, unités
  const teamIdByName = new Map<string, string>();
  // Clé "équipe::flotte" — plusieurs équipes peuvent réutiliser le même nom
  // de flotte, d'où le namespacing (voir playersByTeamName ci-dessous).
  const fleetIdByTeamAndName = new Map<string, string>();
  // Nom → {id, catégorie} de chaque unité créée — sert à résoudre les
  // références par nom (Squadron/Unit.carrierUnitName) une fois toutes les
  // unités posées, et à faire respecter strictement "réservé aux avions"/
  // "doit être un navire" avec la catégorie RÉSOLUE (contrairement au
  // superRefine côté validation.ts, limité aux classes définies en ligne).
  const unitByName = new Map<string, { id: string; category: string }>();
  // squadronKey en attente d'affectation (avions) — résolu après la
  // création des Squadron (pass B ci-dessous), voir Unit.squadronId.
  const pendingSquadronAssignment: { unitId: string; unitName: string; squadronKey: string }[] = [];
  // carrierUnitName direct (avion isolé, hors escadrille) — résolu après
  // que toutes les unités existent (un porte-avions peut être créé après
  // l'avion qui le référence dans l'ordre du scénario).
  const pendingCarrierAssignment: { unitId: string; unitName: string; carrierUnitName: string }[] = [];

  for (const t of definition.teams) {
    const team = await prisma.team.create({
      data: { scenarioId: scenario.id, name: t.name, colorHex: t.colorHex },
    });
    teamIdByName.set(t.name, team.id);

    // Toutes les flottes d'abord (fleetIdByTeamAndName complète), avant de
    // créer la moindre unité : une réaffectation peut pointer vers une
    // flotte de la même équipe créée après celle d'origine dans l'ordre du
    // scénario.
    for (const f of t.fleets) {
      const fleet = await prisma.fleet.create({ data: { teamId: team.id, name: f.name } });
      fleetIdByTeamAndName.set(`${t.name}::${f.name}`, fleet.id);
    }

    for (const f of t.fleets) {
      for (const u of f.units) {
        const classId = classIdByKey.get(u.classKey);
        if (!classId) throw new Error(`Classe inconnue « ${u.classKey} » pour l'unité ${u.name}`);
        const health = resistanceByKey.get(u.classKey) ?? 10;
        const unitClass = resolvedUnitClasses.find((c) => c.key === u.classKey)!;
        const overrideFleetName = options.fleetOverridesByUnit?.[`${t.name}::${f.name}::${u.name}`];
        const targetFleetId = overrideFleetName
          ? (fleetIdByTeamAndName.get(`${t.name}::${overrideFleetName}`) ??
            (() => {
              throw new Error(`Flotte cible inconnue « ${overrideFleetName} » pour l'unité ${u.name}`);
            })())
          : fleetIdByTeamAndName.get(`${t.name}::${f.name}`)!;
        // Base aérienne par référence (voir airbaseByKey ci-dessus) : prime
        // sur les champs littéraux si les deux sont présents (déjà rejeté
        // par ScenarioDefinitionSchema.superRefine à ce stade, mais on reste
        // défensif ici plutôt que de dépendre uniquement de la validation
        // amont). squadronKey/carrierUnitName (escadrille/porte-avions) sont
        // résolus APRÈS que toutes les unités existent, voir plus bas.
        const airbase = u.airbaseKey ? airbaseByKey.get(u.airbaseKey) : undefined;
        if (u.airbaseKey && !airbase) {
          throw new Error(`Base aérienne inconnue « ${u.airbaseKey} » pour l'unité ${u.name}`);
        }
        if ((u.squadronKey || u.carrierUnitName) && unitClass.category !== "AIRCRAFT") {
          throw new Error(`${u.name} : escadrille/porte-avions réservés aux avions (classe « ${unitClass.name} »)`);
        }
        const created = await prisma.unit.create({
          data: {
            scenarioId: scenario.id,
            fleetId: targetFleetId,
            unitClassId: classId,
            name: u.name,
            pennant: u.pennant,
            historicalNote: u.historicalNote,
            currentLat: u.lat,
            currentLng: u.lng,
            currentHeadingDeg: u.headingDeg,
            healthMax: health,
            healthCurrent: health,
            depthChargesRemaining: unitClass.depthChargeStock ?? undefined,
            hedgehogRoundsRemaining: unitClass.hedgehogStock ?? undefined,
            torpedoesRemaining: unitClass.torpedoStock ?? undefined,
            batteryChargePercent: unitClass.category === "SUBMARINE" ? 100 : undefined,
            oxygenHoursRemaining: unitClass.category === "SUBMARINE" ? unitClass.oxygenEnduranceHours : undefined,
            baseLat: airbase?.lat ?? u.baseLat,
            baseLng: airbase?.lng ?? u.baseLng,
            baseName: airbase?.name ?? u.baseName,
          },
        });
        unitByName.set(u.name, { id: created.id, category: unitClass.category });
        if (u.squadronKey) pendingSquadronAssignment.push({ unitId: created.id, unitName: u.name, squadronKey: u.squadronKey });
        if (u.carrierUnitName) pendingCarrierAssignment.push({ unitId: created.id, unitName: u.name, carrierUnitName: u.carrierUnitName });
      }
    }
  }

  // Escadrilles (retour utilisateur 2026-08-14) — créées une fois toutes les
  // unités posées (une escadrille peut référencer un porte-avions créé
  // après elle dans l'ordre du scénario, voir carrierUnitName ci-dessous).
  // La base de l'escadrille (aérienne ou porte-avions) N'EST PAS recopiée
  // sur chaque Unit membre : Unit.baseLat/baseLng restent null pour un avion
  // en escadrille, la résolution passe par Unit.squadronId → Squadron au
  // moment voulu (turnEngine.ts, saveAirPatrolOrder) — source unique,
  // jamais périmée si le porte-avions référencé change de position.
  const squadronIdByKey = new Map<string, string>();
  for (const sq of definition.squadrons ?? []) {
    const squadronAirbase = sq.airbaseKey ? airbaseByKey.get(sq.airbaseKey) : undefined;
    if (sq.airbaseKey && !squadronAirbase) {
      throw new Error(`Base aérienne inconnue « ${sq.airbaseKey} » pour l'escadrille ${sq.name}`);
    }
    let carrierUnitId: string | undefined;
    if (sq.carrierUnitName) {
      const carrier = unitByName.get(sq.carrierUnitName);
      if (!carrier) throw new Error(`Unité porte-avions inconnue « ${sq.carrierUnitName} » pour l'escadrille ${sq.name}`);
      if (carrier.category !== "SURFACE_SHIP") {
        throw new Error(`« ${sq.carrierUnitName} » n'est pas un navire de surface (escadrille ${sq.name})`);
      }
      carrierUnitId = carrier.id;
    }
    const created = await prisma.squadron.create({
      data: {
        scenarioId: scenario.id,
        name: sq.name,
        baseLat: squadronAirbase?.lat,
        baseLng: squadronAirbase?.lng,
        baseName: squadronAirbase?.name,
        carrierUnitId,
      },
    });
    squadronIdByKey.set(sq.key, created.id);
  }
  for (const pending of pendingSquadronAssignment) {
    const squadronId = squadronIdByKey.get(pending.squadronKey);
    if (!squadronId) throw new Error(`Escadrille inconnue « ${pending.squadronKey} » pour l'unité ${pending.unitName}`);
    await prisma.unit.update({ where: { id: pending.unitId }, data: { squadronId } });
  }
  for (const pending of pendingCarrierAssignment) {
    const carrier = unitByName.get(pending.carrierUnitName);
    if (!carrier) throw new Error(`Unité porte-avions inconnue « ${pending.carrierUnitName} » pour l'unité ${pending.unitName}`);
    if (carrier.category !== "SURFACE_SHIP") {
      throw new Error(`« ${pending.carrierUnitName} » n'est pas un navire de surface (rattachement de ${pending.unitName})`);
    }
    await prisma.unit.update({ where: { id: pending.unitId }, data: { carrierUnitId: carrier.id } });
  }

  // Météo + premier tour
  const weather = await prisma.weather.create({
    data: {
      visibilityNm: definition.weather.visibilityNm,
      seaState: definition.weather.seaState,
      daylight: definition.weather.daylight,
      precipitation: definition.weather.precipitation,
      windKnots: definition.weather.windKnots,
      notes: definition.weather.notes,
    },
  });
  const turn = await prisma.turn.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: "PENDING_ORDERS",
      gameStartAt: new Date(),
      durationMinutes: turnMinutes,
      weatherId: weather.id,
    },
  });

  // Participants
  const participants: { role: string; label: string; token: string; colorHex?: string }[] = [];
  if (options.withArbiter !== false) {
    const arbiter = await prisma.participant.create({
      data: { scenarioId: scenario.id, role: "ARBITER", displayName: "Arbitre" },
    });
    participants.push({ role: "ARBITER", label: "Arbitre", token: arbiter.token });
  }
  for (const t of definition.teams) {
    const slots = options.playersByTeamName?.[t.name];
    if (slots && slots.length > 0) {
      // Plusieurs joueurs pour cette équipe (bloc 2) : un participant scopé
      // par joueur, plutôt que l'unique participant "toute l'équipe" par défaut.
      for (const slot of slots) {
        const fleetIds =
          slot.fleetNames?.map((name) => {
            const id = fleetIdByTeamAndName.get(`${t.name}::${name}`);
            if (!id) throw new Error(`Flotte inconnue « ${name} » pour l'équipe ${t.name}`);
            return id;
          }) ?? null;
        const p = await prisma.participant.create({
          data: {
            scenarioId: scenario.id,
            role: "PLAYER",
            teamId: teamIdByName.get(t.name)!,
            displayName: slot.displayName,
            colorHex: slot.colorHex,
            scopeAllFleetsInTeam: fleetIds === null,
            ...(fleetIds ? { fleetScopes: { create: fleetIds.map((fleetId) => ({ fleetId })) } } : {}),
          },
        });
        participants.push({ role: "PLAYER", label: `${t.name} — ${slot.displayName}`, token: p.token, colorHex: slot.colorHex });
      }
      continue;
    }
    const p = await prisma.participant.create({
      data: {
        scenarioId: scenario.id,
        role: "PLAYER",
        teamId: teamIdByName.get(t.name)!,
        displayName: `Joueur ${t.name}`,
      },
    });
    participants.push({ role: "PLAYER", label: t.name, token: p.token });
  }

  return { scenario, turn, participants, teamIdByName };
}
