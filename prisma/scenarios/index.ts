import type { PrismaClient } from "../../src/generated/prisma/client";
import type { ScenarioDefinition } from "./types";
import { validateScenarioDefinition } from "./validation";
import { denmarkStrait } from "./denmark-strait";
import { northCape } from "./north-cape";

/**
 * Bibliothèque de scénarios intégrés. Ajouter un scénario = ajouter une
 * définition ici ; les scénarios créés par les joueurs (module éditeur,
 * voir src/app/scenarios/new) suivent exactement le même format, stockés en
 * base dans `CustomScenario` — voir findScenarioAsync/listAllScenarioSummaries
 * ci-dessous pour les deux confondus.
 */
export const SCENARIO_LIBRARY: ScenarioDefinition[] = [denmarkStrait, northCape];

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
  // Détail flotte par équipe (bloc 2, plusieurs joueurs par camp) : permet
  // à /create de proposer, flotte par flotte, à quel joueur elle est
  // confiée — sans instancier le scénario au préalable.
  teams: { name: string; fleetNames: string[] }[];
  custom: boolean;
};

function toSummary(def: ScenarioDefinition, custom: boolean): ScenarioSummary {
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    dateLabel: def.dateLabel,
    defaultTurnMinutes: def.defaultTurnMinutes,
    teamNames: def.teams.map((t) => t.name),
    teams: def.teams.map((t) => ({ name: t.name, fleetNames: t.fleets.map((f) => f.name) })),
    custom,
  };
}

/** Bibliothèque intégrée + scénarios créés par les joueurs, pour la page /create. */
export async function listAllScenarioSummaries(prisma: PrismaClient): Promise<ScenarioSummary[]> {
  const custom = await prisma.customScenario.findMany({ orderBy: { createdAt: "desc" } });
  const customSummaries: ScenarioSummary[] = [];
  for (const c of custom) {
    try {
      customSummaries.push(toSummary(validateScenarioDefinition(c.definition), true));
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

  // Classes d'unités
  const classIdByKey = new Map<string, string>();
  for (const uc of definition.unitClasses) {
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
        submergedRangeNmAt4kt: uc.submergedRangeNmAt4kt,
        oxygenEnduranceHours: uc.oxygenEnduranceHours,
        torpedoStock: uc.torpedoStock,
      },
    });
    classIdByKey.set(uc.key, created.id);
  }
  const resistanceByKey = new Map(definition.unitClasses.map((uc) => [uc.key, uc.resistancePoints]));

  // Équipes, flottes, unités
  const teamIdByName = new Map<string, string>();
  // Clé "équipe::flotte" — plusieurs équipes peuvent réutiliser le même nom
  // de flotte, d'où le namespacing (voir playersByTeamName ci-dessous).
  const fleetIdByTeamAndName = new Map<string, string>();
  for (const t of definition.teams) {
    const team = await prisma.team.create({
      data: { scenarioId: scenario.id, name: t.name, colorHex: t.colorHex },
    });
    teamIdByName.set(t.name, team.id);

    for (const f of t.fleets) {
      const fleet = await prisma.fleet.create({ data: { teamId: team.id, name: f.name } });
      fleetIdByTeamAndName.set(`${t.name}::${f.name}`, fleet.id);
      for (const u of f.units) {
        const classId = classIdByKey.get(u.classKey);
        if (!classId) throw new Error(`Classe inconnue « ${u.classKey} » pour l'unité ${u.name}`);
        const health = resistanceByKey.get(u.classKey) ?? 10;
        const unitClass = definition.unitClasses.find((c) => c.key === u.classKey)!;
        await prisma.unit.create({
          data: {
            scenarioId: scenario.id,
            fleetId: fleet.id,
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
            torpedoesRemaining: unitClass.torpedoStock ?? undefined,
            batteryChargePercent: unitClass.category === "SUBMARINE" ? 100 : undefined,
            oxygenHoursRemaining: unitClass.category === "SUBMARINE" ? unitClass.oxygenEnduranceHours : undefined,
            baseLat: u.baseLat,
            baseLng: u.baseLng,
            baseName: u.baseName,
          },
        });
      }
    }
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
