import type { PrismaClient } from "../../src/generated/prisma/client";
import type { ScenarioDefinition } from "./types";
import { denmarkStrait } from "./denmark-strait";

/**
 * Bibliothèque de scénarios. Ajouter un scénario = ajouter une définition
 * ici ; l'éditeur de scénarios à venir produira le même format.
 */
export const SCENARIO_LIBRARY: ScenarioDefinition[] = [denmarkStrait];

export function findScenario(key: string): ScenarioDefinition | undefined {
  return SCENARIO_LIBRARY.find((s) => s.key === key);
}

/**
 * Instancie une définition de scénario en base : classes d'unités, équipes,
 * flottes, unités, météo et premier tour. Retourne les jetons d'invitation.
 */
export async function instantiateScenario(
  prisma: PrismaClient,
  definition: ScenarioDefinition,
  options: { withArbiter?: boolean } = {}
) {
  const scenario = await prisma.scenario.create({
    data: {
      name: definition.name,
      description: definition.description,
      mapCenterLat: definition.mapCenterLat,
      mapCenterLng: definition.mapCenterLng,
      mapDefaultZoom: definition.mapDefaultZoom,
      defaultTurnMinutes: definition.defaultTurnMinutes,
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
        sensors: uc.sensors,
        detectability: uc.detectability ?? 1,
        iconKey: uc.iconKey,
        profileImageUrl: uc.profileImageUrl,
        historicalNote: uc.historicalNote,
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
  for (const t of definition.teams) {
    const team = await prisma.team.create({
      data: { scenarioId: scenario.id, name: t.name, colorHex: t.colorHex },
    });
    teamIdByName.set(t.name, team.id);

    for (const f of t.fleets) {
      const fleet = await prisma.fleet.create({ data: { teamId: team.id, name: f.name } });
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
      durationMinutes: definition.defaultTurnMinutes,
      weatherId: weather.id,
    },
  });

  // Participants
  const participants: { role: string; label: string; token: string }[] = [];
  if (options.withArbiter !== false) {
    const arbiter = await prisma.participant.create({
      data: { scenarioId: scenario.id, role: "ARBITER", displayName: "Arbitre" },
    });
    participants.push({ role: "ARBITER", label: "Arbitre", token: arbiter.token });
  }
  for (const t of definition.teams) {
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
