/**
 * Seed V1 : convoi JW55B / RA55A (décembre 1943), qui a débouché sur la
 * bataille du cap Nord (26 déc. 1943, coulage du Scharnhorst).
 *
 * Caractéristiques des UnitClass (tonnage, blindage, armement, DCA, valeur
 * en points) tirées du fichier "Avions et Navires Amirauté.pdf" — la base de
 * données de navires du jeu de plateau original Amirauté de Paul Bois.
 * Stockées dans `weaponSystems` (réservé phase 2 / moteur de combat) ; seule
 * `maxSpeedKnots` (vitesse maxi du tableau) est utilisée par le moteur de
 * tour V1. Les portées de capteurs (radar/visuel/hydrophone) et la
 * détectabilité restent des heuristiques V1, le jeu original gérant la
 * détection via un système séparé (règles principales, non encore digérées).
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

const SOURCE = "Amirauté (Paul Bois) — Avions et Navires";

// Positions vérifiées en mer (pas sur terre) par double contrôle sur le fond
// de carte : absence de couche terrestre (bois/herbe/bâti/...) ET présence
// positive de la couche "water" au point exact (une simple absence de terre
// ne suffit pas : de petits bras de mer peuvent n'avoir ni l'un ni l'autre
// selon le niveau de zoom). Akureyri et Kåfjord d'origine tombaient sur la
// terre ferme (la première coordonnée de Kåfjord était en fait à l'intérieur
// des terres, près du village, pas dans le fjord) ; corrigées.
const LOCH_EWE = { lat: 57.87, lng: -5.6 };
const AKUREYRI = { lat: 65.66, lng: -18.05 }; // mouillage dans l'Eyjafjörður, au large d'Akureyri
const KAFJORD = { lat: 70.0, lng: 23.2 }; // Altafjorden, au large de Kåfjord (mouillage réel du Tirpitz/Scharnhorst)
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
        "Le Kriegsmarine engage le Scharnhorst depuis Kåfjord, dans l'Altenfjord (opération Ostfront), et des U-boots " +
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

  // ── Royaume-Uni ──────────────────────────────────────────────

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
      profileImageUrl: "http://www.ibiblio.org/hyperwar/USN/ref/ONI/ONI-201/img/oni201-8.PNG",
      historicalNote:
        "Cuirassé rapide entré en service en 1940-41, 36 730t, armé de 10 canons de 356mm (calibre réduit imposé par les traités navals) et 16 canons secondaires de 133mm. Doté d'un radar performant. Pilier de la Home Fleet en 1943.",
      weaponSystems: {
        displacementTons: 36730,
        armorMm: { vertical: 381, horizontal: 152 },
        mainGuns: "10 x 356mm (portée 37 000m)",
        secondaryGuns: "16 x 133mm (portée 23 400m)",
        antiAircraft1943: "16 x 133mm, 96 x 40mm, 57 x 20mm",
        aircraft: "2 hydravions",
        originalGamePoints: 99.03,
        source: SOURCE,
      },
    },
  });

  const classCruiserTown = await prisma.unitClass.create({
    data: {
      name: "Croiseur léger classe Town (sous-classe Southampton)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      sensors: [
        { type: "RADAR", rangeNm: 18 },
        { type: "VISUAL", rangeNm: 13 },
      ],
      detectability: 1.1,
      iconKey: "cruiser",
      profileImageUrl: "http://www.ibiblio.org/hyperwar/USN/ref/ONI/ONI-201/img/oni201-46.PNG",
      historicalNote:
        "HMS Sheffield, 11 730t, armé de 12 canons de 152mm. Croiseur léger rapide et bien équipé en radar de veille.",
      weaponSystems: {
        displacementTons: 11730,
        armorMm: { vertical: 114, horizontal: 38 },
        mainGuns: "12 x 152mm (portée 22 500m)",
        torpedoes: "6 x 533mm",
        antiAircraft1943: "8 x 102mm, 8 x 40mm, 8 mitrailleuses",
        originalGamePoints: 29.62,
        source: SOURCE,
      },
    },
  });

  const classCruiserEdinburgh = await prisma.unitClass.create({
    data: {
      name: "Croiseur léger classe Town (sous-classe Edinburgh)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 30,
      sensors: [
        { type: "RADAR", rangeNm: 19 },
        { type: "VISUAL", rangeNm: 13 },
      ],
      detectability: 1.15,
      iconKey: "cruiser",
      historicalNote:
        "HMS Belfast, 11 500t, un peu plus lourdement blindé que la sous-classe Southampton. Son radar fut le premier à détecter le Scharnhorst lors de la bataille du cap Nord.",
      weaponSystems: {
        displacementTons: 11500,
        armorMm: { vertical: 114, horizontal: 76 },
        mainGuns: "12 x 152mm (portée 22 600m)",
        torpedoes: "6 x 533mm",
        antiAircraft1943: "12 x 102mm, 16 x 40mm, 22 x 20mm",
        aircraft: "2 hydravions",
        originalGamePoints: 33.55,
        source: SOURCE,
      },
    },
  });

  const classCruiserCrownColony = await prisma.unitClass.create({
    data: {
      name: "Croiseur léger classe Crown Colony (Fiji)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 31,
      sensors: [
        { type: "RADAR", rangeNm: 17 },
        { type: "VISUAL", rangeNm: 12 },
      ],
      detectability: 1.0,
      iconKey: "cruiser",
      historicalNote: "HMS Jamaica, 8 530t, plus petit et plus récent que les Town, armé de 12 canons de 152mm.",
      weaponSystems: {
        displacementTons: 8530,
        armorMm: { vertical: 89, horizontal: 51 },
        mainGuns: "12 x 152mm (portée 22 600m)",
        torpedoes: "6 x 533mm",
        antiAircraft1943: "8 x 102mm, 8 x 40mm, 22 x 20mm",
        aircraft: "2 hydravions",
        originalGamePoints: 24.78,
        source: SOURCE,
      },
    },
  });

  const classHeavyCruiser = await prisma.unitClass.create({
    data: {
      name: "Croiseur lourd classe County",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      sensors: [
        { type: "RADAR", rangeNm: 18 },
        { type: "VISUAL", rangeNm: 13 },
      ],
      detectability: 1.15,
      iconKey: "cruiser",
      profileImageUrl: "http://www.ibiblio.org/hyperwar/USN/ref/ONI/ONI-201/img/oni201-36.PNG",
      historicalNote:
        "HMS Norfolk, 10 900t, armé de 8 canons de 203mm. Échangea les premiers coups de canon avec le Scharnhorst et fut endommagé lors de la bataille du cap Nord.",
      weaponSystems: {
        displacementTons: 10900,
        armorMm: { vertical: 25, horizontal: 38 },
        mainGuns: "8 x 203mm (portée 19 200m)",
        torpedoes: "8 x 533mm",
        antiAircraft1943: "8 x 102mm, 28 x 40mm, 32 x 20mm",
        aircraft: "1 hydravion",
        originalGamePoints: 17.2,
        source: SOURCE,
      },
    },
  });

  const classDestroyerM = await prisma.unitClass.create({
    data: {
      name: "Destroyer classe M (Home Fleet, 1941-42)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 36,
      sensors: [
        { type: "RADAR", rangeNm: 15 },
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 3 },
      ],
      detectability: 0.85,
      iconKey: "destroyer",
      historicalNote:
        "HMS Milne, Matchless, Meteor, Musketeer : 1 925t, armés de 6 canons de 120mm et 4 tubes lance-torpilles de 533mm.",
      weaponSystems: {
        displacementTons: 1925,
        mainGuns: "6 x 120mm (portée 18 200m)",
        torpedoes: "4 x 533mm",
        antiAircraft: "6 x 120mm, 1 x 102mm, 4 x 40mm, 2 x 20mm, 12 mitrailleuses",
        originalGamePoints: 2.12,
        source: SOURCE,
      },
    },
  });

  const classDestroyerTribal = await prisma.unitClass.create({
    data: {
      name: "Destroyer classe Tribal (1938-39)",
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
      historicalNote:
        "HMS Ashanti : 1 960t, fortement armé pour un destroyer (8 canons de 120mm), moins de tubes lance-torpilles que la moyenne (4 x 533mm).",
      weaponSystems: {
        displacementTons: 1960,
        mainGuns: "8 x 120mm (portée 18 200m)",
        torpedoes: "4 x 533mm",
        antiAircraft: "8 x 120mm, 4 x 40mm, 8 mitrailleuses",
        originalGamePoints: 2.16,
        source: SOURCE,
      },
    },
  });

  const classDestroyerS = await prisma.unitClass.create({
    data: {
      name: "Destroyer classe S (1943-44)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 37,
      sensors: [
        { type: "RADAR", rangeNm: 16 },
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 3 },
      ],
      detectability: 0.85,
      iconKey: "destroyer",
      historicalNote:
        "HMS Saumarez, Savage, Scorpion, HNoMS Stord : 1 800t, les plus récents et rapides destroyers de la force de couverture, 8 tubes lance-torpilles de 533mm.",
      weaponSystems: {
        displacementTons: 1800,
        mainGuns: "4 x 120mm (portée 18 200m)",
        torpedoes: "8 x 533mm",
        antiAircraft: "4 x 120mm, 10 x 20mm",
        originalGamePoints: 1.98,
        source: SOURCE,
      },
    },
  });

  const classEscort = await prisma.unitClass.create({
    data: {
      name: "Destroyer ancien classe W (escorte rapprochée)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 18,
      sensors: [
        { type: "SONAR", rangeNm: 3 },
        { type: "VISUAL", rangeNm: 9 },
      ],
      detectability: 0.75,
      iconKey: "escort",
      profileImageUrl:
        "https://ia800801.us.archive.org/BookReader/BookReaderImages.php?zip=/26/items/FM30-51/FM30-51_jp2.zip&file=FM30-51_jp2/FM30-51_0166.jp2&id=FM30-51&scale=2&rotate=0",
      historicalNote:
        "HMS Westcott (classe W, 1919), 1 325t : destroyer de la Première Guerre mondiale reconverti à l'escorte de convoi. HMS Speedwell (dragueur de mines) et HMS Acanthus (corvette classe Flower) ne figurent pas dans la base de données du jeu original ; leurs caractéristiques restent approximées.",
      weaponSystems: {
        displacementTons: 1325,
        mainGuns: "4 x 102mm (portée 12 500m)",
        torpedoes: "6 x 533mm",
        antiAircraft: "4 x 102mm, 1 x 76mm, 2 x 40mm",
        originalGamePoints: 1.19,
        source: SOURCE,
        note: "Vitesse en jeu volontairement réduite à 18 nds pour représenter la vitesse d'escorte de convoi, pas la vitesse maxi réelle du navire (34 nds).",
      },
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
      historicalNote:
        "Cargos marchands transportant le matériel de guerre prêté-bail vers l'URSS — non armés ou à peine, lents et très détectables. Toute l'opération existe pour les amener à bon port. Absents de la base de données de navires de guerre du jeu original.",
    },
  });

  // ── Allemagne ────────────────────────────────────────────────

  const classScharnhorst = await prisma.unitClass.create({
    data: {
      name: "Cuirassé de bataille classe Scharnhorst",
      nation: "Allemagne",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      sensors: [
        { type: "RADAR", rangeNm: 12 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.3,
      iconKey: "battleship_de",
      profileImageUrl: "http://www.ibiblio.org/hyperwar/USN/ref/ONI/ONI-204/img/ONI-204-26.JPG",
      historicalNote:
        "31 850t, armé de 9 canons de 283mm (portée 41 000m, supérieure à celle du Duke of York) mais moins bien blindé et moins bien équipé en radar que son adversaire britannique. Coulé le 26 décembre 1943 lors de la bataille du cap Nord après un combat acharné ; sur environ 1 968 hommes d'équipage, seuls 36 survécurent.",
      weaponSystems: {
        displacementTons: 31850,
        armorMm: { vertical: 350, horizontal: 80 },
        mainGuns: "9 x 283mm (portée 41 000m)",
        secondaryGuns: "12 x 149mm (portée 22 000m), 14 x 105mm (portée 17 700m)",
        antiAircraft: "14 x 105mm, 16 x 37mm, 40 x 20mm",
        aircraft: "4 hydravions",
        originalGamePoints: 82.34,
        source: SOURCE,
      },
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
      profileImageUrl: "http://www.ibiblio.org/hyperwar/USN/ref/ONI/ONI-204/img/ONI-204-98.JPG",
      historicalNote:
        "Z29, Z30, Z33, Z34, Z38 : 2 600t, armés de 5 canons de 149mm (plus puissants que leurs homologues alliés) mais réputés peu marins par gros temps. Lors de l'opération Ostfront, l'amiral Bey les renvoya vers l'Altenfjord avant l'engagement final en raison du mauvais temps : ils ne combattirent pas aux côtés du Scharnhorst.",
      weaponSystems: {
        displacementTons: 2600,
        mainGuns: "5 x 149mm (portée 22 000m)",
        torpedoes: "8 x 533mm",
        antiAircraft: "4 x 37mm, 15 x 20mm",
        mines: "60",
        originalGamePoints: 2.86,
        source: SOURCE,
      },
    },
  });

  const classUboat = await prisma.unitClass.create({
    data: {
      name: "Sous-marin type VIIC (patrouille)",
      nation: "Allemagne",
      category: "SUBMARINE",
      maxSpeedKnots: 18,
      sensors: [
        { type: "HYDROPHONE", rangeNm: 4 },
        { type: "VISUAL", rangeNm: 6 },
      ],
      detectability: 0.5,
      iconKey: "uboat",
      profileImageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a8/VIIC_uboat_line.svg",
      historicalNote:
        "770t, le sous-marin le plus construit de la guerre (554 unités). Déployé en lignes de patrouille (ici « Eisenbart ») pour repérer les convois arctiques et alerter le commandement. Vitesse : 18 nds en surface, 8 nds en plongée — très discret immergé, mais doit faire surface pour se déplacer vite ou transmettre un rapport.",
      weaponSystems: {
        displacementTons: 770,
        surfaceSpeedKnots: 18,
        submergedSpeedKnots: 8,
        torpedoes: "5 x 533mm (4 tubes avant, 1 arrière), 14 tonnes de torpilles",
        antiAircraft: "6 x 20mm",
        originalGamePoints: 0.85,
        source: SOURCE,
      },
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
  const mClassNames = ["HMS Milne", "HMS Matchless", "HMS Meteor", "HMS Musketeer"];
  for (const name of mClassNames) {
    await createUnit(scenario.id, fleetCloseEscort.id, classDestroyerM.id, name, LOCH_EWE);
  }
  await createUnit(scenario.id, fleetCloseEscort.id, classDestroyerTribal.id, "HMS Ashanti", LOCH_EWE);

  await createUnit(scenario.id, fleetCruisers.id, classCruiserEdinburgh.id, "HMS Belfast", AKUREYRI);
  await createUnit(scenario.id, fleetCruisers.id, classHeavyCruiser.id, "HMS Norfolk", AKUREYRI);
  await createUnit(scenario.id, fleetCruisers.id, classCruiserTown.id, "HMS Sheffield", AKUREYRI);

  await createUnit(
    scenario.id,
    fleetCoveringForce.id,
    classBattleshipKGV.id,
    "HMS Duke of York",
    AKUREYRI,
    "Navire amiral de la Home Fleet (amiral Bruce Fraser) lors de l'opération. C'est elle qui porta le coup de grâce au Scharnhorst à courte distance dans la soirée du 26 décembre 1943."
  );
  await createUnit(scenario.id, fleetCoveringForce.id, classCruiserCrownColony.id, "HMS Jamaica", AKUREYRI);
  for (const name of ["HMS Saumarez", "HMS Savage", "HMS Scorpion", "HNoMS Stord"]) {
    await createUnit(scenario.id, fleetCoveringForce.id, classDestroyerS.id, name, AKUREYRI);
  }

  await createUnit(
    scenario.id,
    fleetScharnhorst.id,
    classScharnhorst.id,
    "Scharnhorst",
    KAFJORD,
    "Appareille de l'Altenfjord le 25 décembre 1943 sous le commandement du contre-amiral Erich Bey pour l'opération Ostfront, avec l'intention d'intercepter le convoi JW55B."
  );
  for (const name of ["Z29", "Z30", "Z33", "Z34", "Z38"]) {
    await createUnit(scenario.id, fleetScharnhorst.id, classNarvikDestroyer.id, name, KAFJORD);
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
  position: { lat: number; lng: number },
  historicalNote?: string
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
      historicalNote,
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
