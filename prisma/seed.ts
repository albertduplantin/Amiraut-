/**
 * Seed V1 : convoi JW55B / RA55A (décembre 1943), qui a débouché sur la
 * bataille du cap Nord (26 déc. 1943, coulage du Scharnhorst). Stats de
 * UnitClass plausibles pour la période, à affiner avec une recherche
 * historique plus poussée avant un usage "sérieux" du scénario.
 *
 * JW55B a quitté Loch Ewe le 22/12/1943 ; la force de couverture lourde
 * (Duke of York) a appareillé d'Akureyri (Islande) le 23/12 — positions de
 * départ approximées en conséquence, pas de porte-avions (aucun convoi
 * arctique fin 1943 n'en avait réellement).
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const LOCH_EWE = { lat: 57.87, lng: -5.6 };
const AKUREYRI = { lat: 65.68, lng: -18.09 };
const ALTENFJORD = { lat: 69.92, lng: 23.28 };
const EISENBART_LINE = { lat: 73.2, lng: 25.0 };

async function main() {
  await prisma.$transaction([
    prisma.report.deleteMany(),
    prisma.detectionEvent.deleteMany(),
    prisma.waypoint.deleteMany(),
    prisma.unitOrder.deleteMany(),
    prisma.weather.deleteMany(),
    prisma.turn.deleteMany(),
    prisma.participantFleetScope.deleteMany(),
    prisma.participant.deleteMany(),
    prisma.unit.deleteMany(),
    prisma.unitClass.deleteMany(),
    prisma.fleet.deleteMany(),
    prisma.team.deleteMany(),
    prisma.scenario.deleteMany(),
  ]);

  const scenario = await prisma.scenario.create({
    data: {
      name: "Convoi JW55B / RA55A — Bataille du cap Nord (déc. 1943)",
      description:
        "Le convoi JW55B quitte Loch Ewe le 22 décembre 1943 pour Mourmansk, escorté par le Home Fleet. " +
        "Le Kriegsmarine engage le Scharnhorst depuis l'Altenfjord (opération Ostfront) et des U-boots " +
        "de la ligne de patrouille Eisenbart. Objectif allié : livrer le convoi intact. Objectif allemand : " +
        "intercepter et détruire le convoi et/ou son escorte.",
      mapCenterLat: 70,
      mapCenterLng: 10,
      mapDefaultZoom: 4,
      defaultTurnMinutes: 360,
      status: "ACTIVE",
    },
  });

  const allies = await prisma.team.create({
    data: { scenarioId: scenario.id, name: "Alliés — Home Fleet", colorHex: "#2563eb" },
  });
  const germany = await prisma.team.create({
    data: { scenarioId: scenario.id, name: "Kriegsmarine", colorHex: "#6b7280" },
  });

  const fleetConvoy = await prisma.fleet.create({ data: { teamId: allies.id, name: "Convoi JW55B" } });
  const fleetCloseEscort = await prisma.fleet.create({ data: { teamId: allies.id, name: "Escorte rapprochée" } });
  const fleetCruisers = await prisma.fleet.create({ data: { teamId: allies.id, name: "Force de croiseurs (Force 1)" } });
  const fleetCoveringForce = await prisma.fleet.create({
    data: { teamId: allies.id, name: "Force de couverture — HMS Duke of York" },
  });

  const fleetScharnhorst = await prisma.fleet.create({
    data: { teamId: germany.id, name: "Groupe de combat Scharnhorst" },
  });
  const fleetUboats = await prisma.fleet.create({
    data: { teamId: germany.id, name: "Ligne de patrouille U-Boot « Eisenbart »" },
  });

  const classBattleshipKGV = await prisma.unitClass.create({
    data: {
      name: "Cuirassé classe King George V",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 28,
      sensors: [
        { type: "RADAR", rangeNm: 20 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.4,
      iconKey: "battleship",
    },
  });

  const classLightCruiser = await prisma.unitClass.create({
    data: {
      name: "Croiseur léger (classe Town / Crown Colony)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      sensors: [
        { type: "RADAR", rangeNm: 18 },
        { type: "VISUAL", rangeNm: 13 },
      ],
      detectability: 1.1,
      iconKey: "cruiser",
    },
  });

  const classHeavyCruiser = await prisma.unitClass.create({
    data: {
      name: "Croiseur lourd classe County",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 30,
      sensors: [
        { type: "RADAR", rangeNm: 18 },
        { type: "VISUAL", rangeNm: 13 },
      ],
      detectability: 1.15,
      iconKey: "cruiser",
    },
  });

  const classFleetDestroyer = await prisma.unitClass.create({
    data: {
      name: "Destroyer de flotte (Home Fleet)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 36,
      sensors: [
        { type: "RADAR", rangeNm: 15 },
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 3 },
      ],
      detectability: 0.9,
      iconKey: "destroyer",
    },
  });

  const classEscort = await prisma.unitClass.create({
    data: {
      name: "Escorte rapprochée (destroyer ancien / corvette / dragueur)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 18,
      sensors: [
        { type: "SONAR", rangeNm: 3 },
        { type: "VISUAL", rangeNm: 9 },
      ],
      detectability: 0.8,
      iconKey: "escort",
    },
  });

  const classMerchant = await prisma.unitClass.create({
    data: {
      name: "Cargo (type Liberty / Fort / Empire)",
      nation: "Royaume-Uni / États-Unis",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 10,
      sensors: [{ type: "VISUAL", rangeNm: 8 }],
      detectability: 1.6,
      iconKey: "merchant",
    },
  });

  const classScharnhorst = await prisma.unitClass.create({
    data: {
      name: "Cuirassé de bataille Scharnhorst",
      nation: "Allemagne",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 31,
      sensors: [
        { type: "RADAR", rangeNm: 12 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.3,
      iconKey: "battleship_de",
    },
  });

  const classNarvikDestroyer = await prisma.unitClass.create({
    data: {
      name: "Destroyer classe 1936A (type Narvik)",
      nation: "Allemagne",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 36,
      sensors: [
        { type: "RADAR", rangeNm: 8 },
        { type: "VISUAL", rangeNm: 10 },
      ],
      detectability: 0.9,
      iconKey: "destroyer_de",
    },
  });

  const classUboat = await prisma.unitClass.create({
    data: {
      name: "Sous-marin type VIIC (patrouille)",
      nation: "Allemagne",
      category: "SUBMARINE",
      maxSpeedKnots: 10,
      sensors: [
        { type: "HYDROPHONE", rangeNm: 4 },
        { type: "VISUAL", rangeNm: 6 },
      ],
      detectability: 0.5,
      iconKey: "uboat",
    },
  });

  const merchantNames = [
    "Collis P Huntington",
    "Daniel Willard",
    "Empire Archer",
    "Empire Pickwick",
    "Fort Astoria",
    "Fort Hall",
  ];
  for (const name of merchantNames) {
    await createUnit(scenario.id, fleetConvoy.id, classMerchant.id, name, LOCH_EWE);
  }

  const closeEscortNames = ["HMS Westcott", "HMS Speedwell", "HMS Acanthus"];
  for (const name of closeEscortNames) {
    await createUnit(scenario.id, fleetCloseEscort.id, classEscort.id, name, LOCH_EWE);
  }
  const oceanEscortNames = ["HMS Milne", "HMS Matchless", "HMS Meteor", "HMS Musketeer", "HMS Ashanti"];
  for (const name of oceanEscortNames) {
    await createUnit(scenario.id, fleetCloseEscort.id, classFleetDestroyer.id, name, LOCH_EWE);
  }

  await createUnit(scenario.id, fleetCruisers.id, classLightCruiser.id, "HMS Belfast", AKUREYRI);
  await createUnit(scenario.id, fleetCruisers.id, classHeavyCruiser.id, "HMS Norfolk", AKUREYRI);
  await createUnit(scenario.id, fleetCruisers.id, classLightCruiser.id, "HMS Sheffield", AKUREYRI);

  await createUnit(scenario.id, fleetCoveringForce.id, classBattleshipKGV.id, "HMS Duke of York", AKUREYRI);
  await createUnit(scenario.id, fleetCoveringForce.id, classLightCruiser.id, "HMS Jamaica", AKUREYRI);
  for (const name of ["HMS Saumarez", "HMS Savage", "HMS Scorpion", "HNoMS Stord"]) {
    await createUnit(scenario.id, fleetCoveringForce.id, classFleetDestroyer.id, name, AKUREYRI);
  }

  await createUnit(scenario.id, fleetScharnhorst.id, classScharnhorst.id, "Scharnhorst", ALTENFJORD);
  for (const name of ["Z29", "Z30", "Z33", "Z34", "Z38"]) {
    await createUnit(scenario.id, fleetScharnhorst.id, classNarvikDestroyer.id, name, ALTENFJORD);
  }

  for (const name of ["U-277", "U-354", "U-387", "U-601"]) {
    await createUnit(scenario.id, fleetUboats.id, classUboat.id, name, jitter(EISENBART_LINE));
  }

  const weather1 = await prisma.weather.create({
    data: {
      visibilityNm: 5,
      seaState: 6,
      daylight: "POLAR_NIGHT",
      precipitation: "SNOW",
      windKnots: 25,
      notes: "Nuit polaire, mer forte, grain de neige — conditions typiques de l'Arctique fin décembre.",
    },
  });

  await prisma.turn.create({
    data: {
      scenarioId: scenario.id,
      number: 1,
      status: "PENDING_ORDERS",
      gameStartAt: new Date("1943-12-22T00:00:00Z"),
      durationMinutes: scenario.defaultTurnMinutes,
      weatherId: weather1.id,
    },
  });

  const arbiter = await prisma.participant.create({
    data: {
      scenarioId: scenario.id,
      role: "ARBITER",
      displayName: "Arbitre",
    },
  });

  const alliesPlayer = await prisma.participant.create({
    data: {
      scenarioId: scenario.id,
      role: "PLAYER",
      teamId: allies.id,
      displayName: "Commandant allié",
    },
  });

  const germanyPlayer = await prisma.participant.create({
    data: {
      scenarioId: scenario.id,
      role: "PLAYER",
      teamId: germany.id,
      displayName: "Commandant allemand",
    },
  });

  console.log("\nScénario créé :", scenario.name);
  console.log("\nLiens d'invitation (base locale — adapter le domaine au déploiement) :");
  console.log("  Arbitre :", `/play/${arbiter.token}`);
  console.log("  Joueur allié :", `/play/${alliesPlayer.token}`);
  console.log("  Joueur allemand :", `/play/${germanyPlayer.token}`);
}

async function createUnit(
  scenarioId: string,
  fleetId: string,
  unitClassId: string,
  name: string,
  position: { lat: number; lng: number }
) {
  return prisma.unit.create({
    data: {
      scenarioId,
      fleetId,
      unitClassId,
      name,
      currentLat: position.lat,
      currentLng: position.lng,
      status: "ACTIVE",
    },
  });
}

function jitter(center: { lat: number; lng: number }) {
  return {
    lat: center.lat + (Math.random() - 0.5) * 1.5,
    lng: center.lng + (Math.random() - 0.5) * 3,
  };
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
