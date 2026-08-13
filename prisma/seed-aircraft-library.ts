/**
 * Peuple la bibliothèque partagée (/library) avec une première sélection
 * d'avions du théâtre Atlantique/Arctique 1939-45 — chasseurs, bombardiers,
 * torpilleurs, patrouille maritime, côté Royal Navy/RAF/Fleet Air Arm et
 * Luftwaffe. Fiches sourcées sur des faits largement documentés (vitesses,
 * armement, dates, rôles) plutôt qu'une recherche archivistique exhaustive
 * par témoignage — voir la discussion avec l'utilisateur (fiche "solide et
 * sourcée", pas "approfondie avec témoignages").
 *
 * `maxSpeedKnots` suit la convention déjà en place pour le Sunderland
 * (voir prisma/scenarios/denmark-strait.ts) : une vitesse de croisière/
 * combat soutenable, pas la pointe absolue en palier — notée en historicalNote
 * quand elle diffère significativement.
 *
 * Usage : npx tsx --env-file=.env prisma/seed-aircraft-library.ts
 */
export {}; // force ce fichier en module isolé (sinon `const Module` etc. entrent en collision avec les autres scripts prisma/*.ts au typecheck global.
/* eslint-disable @typescript-eslint/no-require-imports -- require() nécessaire pour intercepter "server-only" avant que src/lib/prisma ne l'importe (voir Module._load ci-dessous). */
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return {};
  return origLoad.apply(this, [request, ...args]);
};

const { prisma } = require("../src/lib/prisma");
/* eslint-enable @typescript-eslint/no-require-imports */

const THEATER = "Atlantique/Arctique 1939-45";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aircraft: any[] = [
  // ── Chasseurs ──────────────────────────────────────────────
  {
    key: "spitfire-mk-vb",
    name: "Supermarine Spitfire Mk Vb",
    nation: "Royaume-Uni",
    category: "AIRCRAFT",
    maxSpeedKnots: 240,
    lengthMeters: 9.1,
    sensors: [{ type: "VISUAL", rangeNm: 9 }],
    detectability: 0.85,
    iconKey: "aircraft",
    resistancePoints: 2,
    turningRadiusM: 280,
    accelerationKnotsPerMin: 16,
    agility: 0.95,
    enduranceMinutes: 90,
    combatProfile: {
      guns: [
        { calibreMm: 20, count: 2, rangeM: 500, roundsPerMinute: 600, arc: "FORWARD" },
        { calibreMm: 7.7, count: 4, rangeM: 500, roundsPerMinute: 1150, arc: "FORWARD" },
      ],
    },
    weaponSystems: { armement: "2 x canons Hispano 20mm + 4 x mitrailleuses Browning .303", vitessePointe: "594 km/h à 3800m" },
    historicalNote:
      "Chasseur monoplace le plus produit de la RAF, référence de maniabilité de la période — virage serré et taux de roulis excellents à basse/moyenne altitude. Le Mk V (1941) introduit l'aile « C » à canons en complément du Bf 109F. Rayon d'action court : conçu pour la défense de zone (bataille d'Angleterre), pas l'escorte longue distance.",
    theater: THEATER,
  },
  {
    key: "bf109-g6",
    name: "Messerschmitt Bf 109 G-6",
    nation: "Allemagne",
    category: "AIRCRAFT",
    maxSpeedKnots: 250,
    lengthMeters: 9.0,
    sensors: [{ type: "VISUAL", rangeNm: 9 }],
    detectability: 0.85,
    iconKey: "aircraft",
    resistancePoints: 2,
    turningRadiusM: 300,
    accelerationKnotsPerMin: 15,
    agility: 0.9,
    enduranceMinutes: 80,
    combatProfile: {
      guns: [
        { calibreMm: 20, count: 1, rangeM: 500, roundsPerMinute: 550, arc: "FORWARD" },
        { calibreMm: 13, count: 2, rangeM: 500, roundsPerMinute: 900, arc: "FORWARD" },
      ],
    },
    weaponSystems: { armement: "1 x canon MG151 20mm (moteur) + 2 x MG131 13mm (capot)", vitessePointe: "621 km/h à 6300m" },
    historicalNote:
      "Chasseur le plus produit de la Luftwaffe. Excellent grimpeur, canon tirant dans l'axe de l'hélice (Motorkanone) très précis. Point faible chronique : autonomie très courte, un handicap constant sur mer où le retour au terrain laisse peu de marge — la contrainte majeure de son emploi loin des côtes.",
    theater: THEATER,
  },
  {
    key: "bf110-g",
    name: "Messerschmitt Bf 110 G",
    nation: "Allemagne",
    category: "AIRCRAFT",
    maxSpeedKnots: 230,
    lengthMeters: 12.1,
    sensors: [{ type: "VISUAL", rangeNm: 10 }],
    detectability: 0.95,
    iconKey: "aircraft",
    resistancePoints: 3,
    turningRadiusM: 450,
    accelerationKnotsPerMin: 11,
    agility: 0.45,
    enduranceMinutes: 150,
    combatProfile: {
      guns: [
        { calibreMm: 20, count: 2, rangeM: 500, roundsPerMinute: 550, arc: "FORWARD" },
        { calibreMm: 7.92, count: 4, rangeM: 500, roundsPerMinute: 1100, arc: "FORWARD" },
      ],
    },
    weaponSystems: { armement: "2 x canons MG-FF 20mm + 4 x MG17 7,92mm (avant), 1 x MG15 arrière défensif", vitessePointe: "560 km/h à 6000m" },
    historicalNote:
      "Chasseur lourd bimoteur (« Zerstörer ») — puissamment armé mais nettement moins maniable qu'un monomoteur, s'est révélé vulnérable face aux chasseurs modernes dès la bataille d'Angleterre. C'est justement ce type d'appareil qu'un Sunderland de patrouille pouvait espérer tenir à distance grâce à ses tourelles défensives, d'où son surnom de « Flying Porcupine ».",
    theater: THEATER,
  },

  // ── Bombardiers ────────────────────────────────────────────
  {
    key: "ju87-stuka",
    name: "Junkers Ju 87 R (Stuka)",
    nation: "Allemagne",
    category: "AIRCRAFT",
    maxSpeedKnots: 150,
    lengthMeters: 11.1,
    sensors: [{ type: "VISUAL", rangeNm: 9 }],
    detectability: 1,
    iconKey: "aircraft",
    resistancePoints: 2,
    turningRadiusM: 400,
    accelerationKnotsPerMin: 8,
    agility: 0.3,
    enduranceMinutes: 120,
    combatProfile: {
      guns: [{ calibreMm: 7.92, count: 2, rangeM: 500, roundsPerMinute: 1000, arc: "FORWARD" }],
      bombs: { count: 1, weightKg: 500, method: "DIVE" },
    },
    weaponSystems: { armement: "1 x bombe 500kg (centrale) + 2 x MG17 7,92mm avant, 1 x MG15 arrière défensif", vitessePointe: "383 km/h" },
    historicalNote:
      "Le bombardier en piqué le plus emblématique de la Luftwaffe — sirènes « Jericho-Trompete », piqué quasi vertical qui en fait l'arme antinavire la plus précise de son temps, mais train fixe et faible vitesse le rendent très vulnérable sans supériorité aérienne locale. Utilisé contre les convois arctiques depuis les terrains norvégiens.",
    theater: THEATER,
  },
  {
    key: "ju88-a4",
    name: "Junkers Ju 88 A-4",
    nation: "Allemagne",
    category: "AIRCRAFT",
    maxSpeedKnots: 210,
    lengthMeters: 14.4,
    sensors: [{ type: "VISUAL", rangeNm: 10 }],
    detectability: 1,
    iconKey: "aircraft",
    resistancePoints: 4,
    turningRadiusM: 550,
    accelerationKnotsPerMin: 9,
    agility: 0.4,
    enduranceMinutes: 240,
    combatProfile: {
      guns: [{ calibreMm: 7.92, count: 3, rangeM: 500, roundsPerMinute: 1000, arc: "ALL_ROUND" }],
      bombs: { count: 1, weightKg: 1400, method: "DIVE" },
    },
    weaponSystems: { armement: "jusqu'à 2400kg de bombes (charge type ~1400kg) + 3 x MG81/MG15 défensifs", vitessePointe: "470 km/h" },
    historicalNote:
      "Bombardier bimoteur le plus polyvalent de la Luftwaffe — conçu dès l'origine pour piquer (rare pour un bimoteur), aussi employé en reconnaissance et chasse de nuit. Cadre principal des attaques aériennes contre les convois arctiques JW/RA depuis 1942, aux côtés des torpilleurs He 111.",
    theater: THEATER,
  },
  {
    key: "he111-h6",
    name: "Heinkel He 111 H-6",
    nation: "Allemagne",
    category: "AIRCRAFT",
    maxSpeedKnots: 180,
    lengthMeters: 16.4,
    sensors: [{ type: "VISUAL", rangeNm: 10 }],
    detectability: 1.05,
    iconKey: "aircraft",
    resistancePoints: 4,
    turningRadiusM: 600,
    accelerationKnotsPerMin: 7,
    agility: 0.3,
    enduranceMinutes: 280,
    combatProfile: {
      guns: [{ calibreMm: 7.92, count: 4, rangeM: 500, roundsPerMinute: 1000, arc: "ALL_ROUND" }],
      bombs: { count: 1, weightKg: 2000, method: "LEVEL" },
    },
    weaponSystems: { armement: "jusqu'à 2500kg de bombes en soute, ou 2 torpilles LT F5b (variante torpilleur) + mitrailleuses défensives", vitessePointe: "405 km/h" },
    historicalNote:
      "Bombardier standard de la Luftwaffe depuis 1939, silhouette reconnaissable à ses ailes elliptiques. La variante H-6 pouvait emporter deux torpilles sous le fuselage — le Kampfgeschwader 26 (« Löwengeschwader ») l'a employé en torpilleur contre les convois arctiques dès 1942, notamment lors de l'attaque massive contre PQ-17.",
    theater: THEATER,
  },

  // ── Torpilleurs ────────────────────────────────────────────
  {
    key: "swordfish",
    name: "Fairey Swordfish Mk I",
    nation: "Royaume-Uni",
    category: "AIRCRAFT",
    maxSpeedKnots: 90,
    lengthMeters: 11.1,
    sensors: [{ type: "VISUAL", rangeNm: 10 }],
    detectability: 0.95,
    iconKey: "aircraft",
    resistancePoints: 3,
    turningRadiusM: 320,
    accelerationKnotsPerMin: 6,
    agility: 0.5,
    enduranceMinutes: 170,
    combatProfile: {
      guns: [{ calibreMm: 7.7, count: 1, rangeM: 500, roundsPerMinute: 600, arc: "ALL_ROUND" }],
      torpedoTubes: { count: 1, rangeM: 900, speedKnots: 40 },
    },
    weaponSystems: { armement: "1 x torpille Mark XII 18in, ou 1500kg de bombes/grenades ASM en alternative — 1 mitrailleuse arrière défensive", vitessePointe: "224 km/h" },
    historicalNote:
      "Biplan déjà considéré obsolète en 1939 (surnommé « Stringbag »), mais sa lenteur même le rend difficile à intercepter en piqué et à toucher par la DCA lourde. Torpille qui bloque le gouvernail du Bismarck le 26 mai 1941 (Ark Royal) — décisif pour permettre à la Home Fleet de le rattraper. Opérait aussi depuis des CAM-ships et porte-avions d'escorte sur les convois arctiques.",
    theater: THEATER,
  },
  {
    key: "albacore",
    name: "Fairey Albacore",
    nation: "Royaume-Uni",
    category: "AIRCRAFT",
    maxSpeedKnots: 110,
    lengthMeters: 12.2,
    sensors: [{ type: "VISUAL", rangeNm: 10 }],
    detectability: 1,
    iconKey: "aircraft",
    resistancePoints: 3,
    turningRadiusM: 340,
    accelerationKnotsPerMin: 7,
    agility: 0.45,
    enduranceMinutes: 170,
    combatProfile: {
      guns: [{ calibreMm: 7.7, count: 1, rangeM: 500, roundsPerMinute: 600, arc: "ALL_ROUND" }],
      torpedoTubes: { count: 1, rangeM: 900, speedKnots: 40 },
    },
    weaponSystems: { armement: "1 x torpille Mark XII 18in — 1 mitrailleuse avant, 1 arrière défensive", vitessePointe: "259 km/h" },
    historicalNote:
      "Successeur biplan désigné du Swordfish (1940), en réalité jamais pleinement remplacé par lui — les deux ont volé en parallèle jusqu'en 1943-44, le Swordfish restant préféré sur petits porte-avions d'escorte pour sa robustesse et sa facilité d'entretien en mer.",
    theater: THEATER,
  },
  {
    key: "beaufort",
    name: "Bristol Beaufort Mk I",
    nation: "Royaume-Uni",
    category: "AIRCRAFT",
    maxSpeedKnots: 180,
    lengthMeters: 12.7,
    sensors: [{ type: "VISUAL", rangeNm: 10 }],
    detectability: 1,
    iconKey: "aircraft",
    resistancePoints: 3,
    turningRadiusM: 480,
    accelerationKnotsPerMin: 9,
    agility: 0.35,
    enduranceMinutes: 240,
    combatProfile: {
      guns: [{ calibreMm: 7.7, count: 2, rangeM: 500, roundsPerMinute: 1100, arc: "ALL_ROUND" }],
      torpedoTubes: { count: 1, rangeM: 900, speedKnots: 40 },
    },
    weaponSystems: { armement: "1 x torpille 18in en soute (semi-encastrée), ou 900kg de bombes en alternative", vitessePointe: "425 km/h" },
    historicalNote:
      "Torpilleur monoplan standard du RAF Coastal Command à partir de 1940, plus rapide et moderne que les biplans de la Fleet Air Arm mais souffrant de pannes moteur récurrentes (Bristol Taurus) qui ont coûté cher en pertes non liées au combat.",
    theater: THEATER,
  },

  // ── Patrouille maritime / bombardement long rayon ──────────
  {
    key: "fw200-condor",
    name: "Focke-Wulf Fw 200 C-3 Condor",
    nation: "Allemagne",
    category: "AIRCRAFT",
    maxSpeedKnots: 150,
    lengthMeters: 23.9,
    sensors: [
      { type: "VISUAL", rangeNm: 15 },
      { type: "RADAR", rangeNm: 10 },
    ],
    detectability: 1.15,
    iconKey: "aircraft",
    resistancePoints: 5,
    turningRadiusM: 900,
    accelerationKnotsPerMin: 5,
    agility: 0.2,
    enduranceMinutes: 600,
    combatProfile: {
      guns: [{ calibreMm: 13, count: 3, rangeM: 500, roundsPerMinute: 900, arc: "ALL_ROUND" }],
      bombs: { count: 1, weightKg: 900, method: "LEVEL" },
    },
    weaponSystems: { armement: "jusqu'à 2100kg de bombes + radar de recherche FuG 200 Hohentwiel (variantes tardives) + mitrailleuses défensives multiples", vitessePointe: "360 km/h" },
    historicalNote:
      "Dérivé d'un avion de ligne civil, surnommé « le fléau de l'Atlantique » par Churchill pour ses attaques contre les convois isolés et son rôle de repérage au profit des U-Boote — endurance exceptionnelle (jusqu'à 14h de patrouille) mais structure fragilisée par cette reconversion, connue pour des ruptures de fuselage à l'atterrissage. Devient vulnérable dès l'apparition de chasseurs embarqués sur CAM-ships et porte-avions d'escorte à partir de 1941.",
    theater: THEATER,
  },
];

async function main() {
  for (const entry of aircraft) {
    await prisma.libraryUnitClass.upsert({
      where: { key: entry.key },
      create: entry,
      update: entry,
    });
    console.log("OK:", entry.name);
  }
  console.log(`\n${aircraft.length} classes d'avions dans la bibliothèque.`);
}

main()
  .catch((err: unknown) => { console.error("FATAL:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
