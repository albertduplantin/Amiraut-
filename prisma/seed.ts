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

// ── Disposition de flotte (espacements historiques) ───────────
// Convoi : colonnes ~910m, navires d'une même colonne ~460m (cf. recherche
// sur les instructions de convoi US/UK 1943-44). Écran ASW/ligne de file :
// ~2000m en arc avant pour un écran autour d'un navire capital, ~450m entre
// navires d'une ligne de file. Les mêmes constantes et la même géométrie
// servent au script ponctuel qui a corrigé une partie déjà en cours
// (positions trop rapprochées, cf. historique) : garder les deux alignés
// en cas de futur ajustement.
const CONVOY_COLUMN_SPACING_M = 910;
const CONVOY_ROW_SPACING_M = 460;
const LINE_AHEAD_SPACING_M = 450;
const SCREEN_RADIUS_M = 2000;
const CLOSE_ESCORT_RADIUS_M = 1500;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Déplace `ref` de `alongM` mètres dans la direction `headingDeg`, et `acrossM` mètres à 90° à droite de ce cap. */
function offsetPoint(ref: { lat: number; lng: number }, alongM: number, acrossM: number, headingDeg: number) {
  const headingRad = toRad(headingDeg);
  const acrossRad = toRad(headingDeg + 90);
  const dNorthM = alongM * Math.cos(headingRad) + acrossM * Math.cos(acrossRad);
  const dEastM = alongM * Math.sin(headingRad) + acrossM * Math.sin(acrossRad);
  const dLat = dNorthM / 111320;
  const dLng = dEastM / (111320 * Math.cos(toRad(ref.lat)));
  return { lat: ref.lat + dLat, lng: ref.lng + dLng };
}

function convoyGridPositions(ref: { lat: number; lng: number }, headingDeg: number, count: number) {
  const numColumns = Math.min(count, 3);
  const numRows = Math.ceil(count / numColumns);
  return Array.from({ length: count }, (_, i) => {
    const col = i % numColumns;
    const row = Math.floor(i / numColumns);
    const along = (row - (numRows - 1) / 2) * CONVOY_ROW_SPACING_M;
    const across = (col - (numColumns - 1) / 2) * CONVOY_COLUMN_SPACING_M;
    return offsetPoint(ref, along, across, headingDeg);
  });
}

function lineAheadPositions(ref: { lat: number; lng: number }, headingDeg: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const along = (i - (count - 1) / 2) * LINE_AHEAD_SPACING_M;
    return offsetPoint(ref, along, 0, headingDeg);
  });
}

function screenArcPositions(ref: { lat: number; lng: number }, headingDeg: number, count: number, radiusM: number) {
  const spanDeg = 200;
  return Array.from({ length: count }, (_, i) => {
    const relBearing = count > 1 ? -spanDeg / 2 + (i * spanDeg) / (count - 1) : 0;
    return offsetPoint(ref, radiusM * Math.cos(toRad(relBearing)), radiusM * Math.sin(toRad(relBearing)), headingDeg);
  });
}

async function main() {
  await prisma.$transaction([
    prisma.report.deleteMany(),
    prisma.combatEvent.deleteMany(),
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
      lengthMeters: 227.1,
      beamMeters: 31.4,
      combatProfile: {
        guns: [
          { calibreMm: 356, count: 10, rangeM: 37000 },
          { calibreMm: 133, count: 16, rangeM: 23400 },
        ],
      },
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
      lengthMeters: 180.3,
      beamMeters: 18.9,
      combatProfile: {
        guns: [{ calibreMm: 152, count: 12, rangeM: 22500 }],
        torpedoTubes: { count: 6, rangeM: 11000, speedKnots: 30 },
      },
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
      lengthMeters: 187,
      beamMeters: 19.3,
      combatProfile: {
        guns: [{ calibreMm: 152, count: 12, rangeM: 22600 }],
        torpedoTubes: { count: 6, rangeM: 11000, speedKnots: 30 },
      },
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
      lengthMeters: 169.3,
      beamMeters: 18.9,
      combatProfile: {
        guns: [{ calibreMm: 152, count: 12, rangeM: 22600 }],
        torpedoTubes: { count: 6, rangeM: 11000, speedKnots: 30 },
      },
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
      lengthMeters: 192.9,
      beamMeters: 20.1,
      combatProfile: {
        guns: [{ calibreMm: 203, count: 8, rangeM: 19200 }],
        torpedoTubes: { count: 8, rangeM: 11000, speedKnots: 30 },
      },
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
      lengthMeters: 100.3,
      beamMeters: 10.4,
      combatProfile: {
        guns: [{ calibreMm: 120, count: 6, rangeM: 18200 }],
        torpedoTubes: { count: 4, rangeM: 11000, speedKnots: 30 },
      },
      sensors: [
        { type: "RADAR", rangeNm: 15 },
        { type: "VISUAL", rangeNm: 10 },
        // ASDIC : portée réelle ~2000m (jusqu'à 3500yd en conditions
        // idéales), inefficace au-delà de ~15nds — cf. weather.ts.
        { type: "SONAR", rangeNm: 1.1 },
      ],
      detectability: 0.85,
      iconKey: "destroyer",
      depthChargeStock: 60,
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
      lengthMeters: 114.9,
      beamMeters: 11.1,
      combatProfile: {
        guns: [{ calibreMm: 120, count: 8, rangeM: 18200 }],
        torpedoTubes: { count: 4, rangeM: 11000, speedKnots: 30 },
      },
      sensors: [
        { type: "RADAR", rangeNm: 15 },
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 1.1 },
      ],
      detectability: 0.9,
      iconKey: "destroyer",
      depthChargeStock: 60,
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
      lengthMeters: 100.3,
      beamMeters: 10.2,
      combatProfile: {
        guns: [{ calibreMm: 120, count: 4, rangeM: 18200 }],
        torpedoTubes: { count: 8, rangeM: 11000, speedKnots: 30 },
      },
      sensors: [
        { type: "RADAR", rangeNm: 16 },
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 1.1 },
      ],
      detectability: 0.85,
      iconKey: "destroyer",
      depthChargeStock: 60,
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
      lengthMeters: 95.1,
      beamMeters: 9.35,
      combatProfile: {
        guns: [{ calibreMm: 102, count: 4, rangeM: 12500 }],
        torpedoTubes: { count: 6, rangeM: 9000, speedKnots: 25 },
      },
      sensors: [
        { type: "SONAR", rangeNm: 1.1 },
        { type: "VISUAL", rangeNm: 9 },
      ],
      detectability: 0.75,
      iconKey: "escort",
      depthChargeStock: 50,
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
      lengthMeters: 135,
      beamMeters: 17.3,
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
      lengthMeters: 234.9,
      beamMeters: 30,
      combatProfile: {
        guns: [
          { calibreMm: 283, count: 9, rangeM: 41000 },
          { calibreMm: 149, count: 12, rangeM: 22000 },
          { calibreMm: 105, count: 14, rangeM: 17700 },
        ],
      },
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
      lengthMeters: 127,
      beamMeters: 12,
      combatProfile: {
        guns: [{ calibreMm: 149, count: 5, rangeM: 22000 }],
        torpedoTubes: { count: 8, rangeM: 12500, speedKnots: 30 },
      },
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
      lengthMeters: 67.1,
      beamMeters: 6.2,
      // Pas de canon en combatProfile : en 1943 un U-Boot en surface évite
      // le duel d'artillerie avec un escorteur. Combat V1 = canons
      // seulement ; le U-Boot ne peut donc pas encore engager au canon
      // (cohérent avec la doctrine réelle), les torpilles suivront.
      combatProfile: {
        torpedoTubes: { count: 5, rangeM: 5000, speedKnots: 40 },
      },
      sensors: [
        // GHG (Gruppenhorchgerät) : portée réelle ~3.5-10nm sur un navire
        // isolé selon l'état de mer (uboat.net/articles/id/52) ; ici prise à
        // l'écoute à vitesse quasi nulle — le bruit propre du sous-marin
        // dégrade fortement cette portée dès qu'il prend de la vitesse (cf.
        // effectiveSensorRangeNm dans weather.ts).
        { type: "HYDROPHONE", rangeNm: 8 },
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

  // Caps de sortie approximatifs, uniquement pour orienter la disposition
  // initiale (les joueurs redéfinissent leur route dès le tour 1) :
  // Loch Ewe vers le nord en sortie de sea loch, Akureyri vers le NNE en
  // direction du point de ralliement, Kåfjord vers l'ouest-nord-ouest en
  // sortie de l'Altafjorden.
  const LOCH_EWE_HEADING = 340;
  const AKUREYRI_HEADING = 20;
  const KAFJORD_HEADING = 290;

  const merchantNames = [
    "Collis P Huntington",
    "Daniel Willard",
    "Empire Archer",
    "Empire Pickwick",
    "Fort Astoria",
    "Fort Hall",
  ];
  const merchantPositions = convoyGridPositions(LOCH_EWE, LOCH_EWE_HEADING, merchantNames.length);
  for (let i = 0; i < merchantNames.length; i++) {
    await createUnit(scenario.id, fleetConvoy.id, classMerchant, merchantNames[i], merchantPositions[i]);
  }

  const closeEscortUnits = [
    { name: "HMS Westcott", unitClass: classEscort },
    { name: "HMS Speedwell", unitClass: classEscort },
    { name: "HMS Acanthus", unitClass: classEscort },
    { name: "HMS Milne", unitClass: classDestroyerM },
    { name: "HMS Matchless", unitClass: classDestroyerM },
    { name: "HMS Meteor", unitClass: classDestroyerM },
    { name: "HMS Musketeer", unitClass: classDestroyerM },
    { name: "HMS Ashanti", unitClass: classDestroyerTribal },
  ];
  const closeEscortPositions = screenArcPositions(LOCH_EWE, LOCH_EWE_HEADING, closeEscortUnits.length, CLOSE_ESCORT_RADIUS_M);
  for (let i = 0; i < closeEscortUnits.length; i++) {
    await createUnit(scenario.id, fleetCloseEscort.id, closeEscortUnits[i].unitClass, closeEscortUnits[i].name, closeEscortPositions[i]);
  }

  const cruiserPositions = lineAheadPositions(AKUREYRI, AKUREYRI_HEADING, 3);
  await createUnit(scenario.id, fleetCruisers.id, classCruiserEdinburgh, "HMS Belfast", cruiserPositions[0]);
  await createUnit(scenario.id, fleetCruisers.id, classHeavyCruiser, "HMS Norfolk", cruiserPositions[1]);
  await createUnit(scenario.id, fleetCruisers.id, classCruiserTown, "HMS Sheffield", cruiserPositions[2]);

  const coveringCapitalPositions = lineAheadPositions(AKUREYRI, AKUREYRI_HEADING, 2);
  await createUnit(
    scenario.id,
    fleetCoveringForce.id,
    classBattleshipKGV,
    "HMS Duke of York",
    coveringCapitalPositions[0],
    "Navire amiral de la Home Fleet (amiral Bruce Fraser) lors de l'opération. C'est elle qui porta le coup de grâce au Scharnhorst à courte distance dans la soirée du 26 décembre 1943."
  );
  await createUnit(scenario.id, fleetCoveringForce.id, classCruiserCrownColony, "HMS Jamaica", coveringCapitalPositions[1]);
  const coveringScreenNames = ["HMS Saumarez", "HMS Savage", "HMS Scorpion", "HNoMS Stord"];
  const coveringScreenPositions = screenArcPositions(AKUREYRI, AKUREYRI_HEADING, coveringScreenNames.length, SCREEN_RADIUS_M);
  for (let i = 0; i < coveringScreenNames.length; i++) {
    await createUnit(scenario.id, fleetCoveringForce.id, classDestroyerS, coveringScreenNames[i], coveringScreenPositions[i]);
  }

  await createUnit(
    scenario.id,
    fleetScharnhorst.id,
    classScharnhorst,
    "Scharnhorst",
    KAFJORD,
    "Appareille de l'Altenfjord le 25 décembre 1943 sous le commandement du contre-amiral Erich Bey pour l'opération Ostfront, avec l'intention d'intercepter le convoi JW55B."
  );
  const narvikNames = ["Z29", "Z30", "Z33", "Z34", "Z38"];
  const narvikPositions = screenArcPositions(KAFJORD, KAFJORD_HEADING, narvikNames.length, SCREEN_RADIUS_M);
  for (let i = 0; i < narvikNames.length; i++) {
    await createUnit(scenario.id, fleetScharnhorst.id, classNarvikDestroyer, narvikNames[i], narvikPositions[i]);
  }

  for (const name of ["U-277", "U-354", "U-387", "U-601"]) {
    await createUnit(scenario.id, fleetUboats.id, classUboat, name, jitter(EISENBART_LINE));
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
  unitClass: { id: string; weaponSystems: unknown; depthChargeStock?: number | null },
  name: string,
  position: { lat: number; lng: number },
  historicalNote?: string
) {
  // Potentiel de résistance = formule du livret (Dw/1000 + blindage + K%),
  // déjà calculée et stockée comme originalGamePoints lors de la recherche
  // historique des caractéristiques de chaque classe.
  const weaponSystems = unitClass.weaponSystems as { originalGamePoints?: number } | null;
  const healthMax = weaponSystems?.originalGamePoints ?? 5;

  return prisma.unit.create({
    data: {
      scenarioId,
      fleetId,
      unitClassId: unitClass.id,
      name,
      currentLat: position.lat,
      currentLng: position.lng,
      status: "ACTIVE",
      historicalNote,
      healthMax,
      healthCurrent: healthMax,
      depthChargesRemaining: unitClass.depthChargeStock ?? undefined,
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
