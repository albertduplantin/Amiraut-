/**
 * Complète la bibliothèque (/library) avec les deux classes manquantes pour
 * le scénario PQ-18 (prisma/scenarios/pq18.ts) : le sous-marin allemand et
 * le chasseur embarqué britannique — les seules classes de ce scénario qui
 * n'existaient pas encore. Le sous-marin reprend les caractéristiques déjà
 * établies dans prisma/seed.ts (elles-mêmes sourcées sur le livret Amirauté
 * original, "Avions et Navires" de Paul Bois — voir SOURCE dans ce fichier).
 *
 * Usage : npx tsx --env-file=.env prisma/seed-library-pq18.ts
 */
export {}; // force ce fichier en module isolé (voir seed-aircraft-library.ts).
/* eslint-disable @typescript-eslint/no-require-imports -- require() nécessaire pour intercepter "server-only" avant que src/lib/prisma ne l'importe. */
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return {};
  return origLoad.apply(this, [request, ...args]);
};

const { prisma } = require("../src/lib/prisma");
/* eslint-enable @typescript-eslint/no-require-imports */

const entries = [
  {
    key: "uboat-type-viic",
    name: "Sous-marin Type VIIC (patrouille)",
    nation: "Allemagne",
    category: "SUBMARINE",
    maxSpeedKnots: 18,
    lengthMeters: 67.1,
    beamMeters: 6.2,
    turningRadiusM: 150,
    accelerationKnotsPerMin: 3,
    sensors: [
      { type: "HYDROPHONE", rangeNm: 8 },
      { type: "VISUAL", rangeNm: 6 },
    ],
    detectability: 0.5,
    iconKey: "uboat",
    profileImageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a8/VIIC_uboat_line.svg",
    // Valeur reprise telle quelle du livret original (voir prisma/seed.ts,
    // commentaire sur REFERENCE_DAMAGE_PER_DEPTH_CHARGE_ATTACK) : 2 à 3
    // passes de grenades réussies pour couler, cohérent avec la fragilité
    // réelle d'un U-Boot une fois accroché.
    resistancePoints: 0.85,
    combatProfile: {
      torpedoTubes: { count: 5, rangeM: 5000, speedKnots: 40, arc: "FORWARD" },
      torpedoTypes: [
        { id: "g7a", label: "G7a (à vapeur)", speedKnots: 44, rangeM: 7500, wakeVisible: true },
        { id: "g7e", label: "G7e (électrique)", speedKnots: 30, rangeM: 5000, wakeVisible: false },
      ],
    },
    submergedRangeNmAt4kt: 80,
    oxygenEnduranceHours: 48,
    torpedoStock: 14,
    weaponSystems: {
      displacementTons: 770,
      surfaceSpeedKnots: 18,
      submergedSpeedKnots: 8,
      torpedoes: "5 x 533mm (4 tubes avant, 1 arrière), 14 tonnes de torpilles",
      antiAircraft: "6 x 20mm",
    },
    historicalNote:
      "770t, le sous-marin le plus construit de la guerre (554 unités). Vitesse 18 nds en surface, 8 nds en plongée — très discret immergé, mais doit faire surface pour se déplacer vite ou transmettre un rapport. Le 12 septembre 1942, l'U-88 est coulé par le destroyer HMS Faulknor au large du convoi PQ-18.",
    theater: "Atlantique/Arctique 1939-45",
  },
  {
    key: "sea-hurricane-mkib",
    name: "Hawker Sea Hurricane Mk IB",
    nation: "Royaume-Uni",
    category: "AIRCRAFT",
    maxSpeedKnots: 230,
    lengthMeters: 9.8,
    sensors: [{ type: "VISUAL", rangeNm: 9 }],
    detectability: 0.85,
    iconKey: "aircraft",
    resistancePoints: 2,
    turningRadiusM: 300,
    accelerationKnotsPerMin: 15,
    agility: 0.85,
    enduranceMinutes: 90,
    combatProfile: {
      guns: [{ calibreMm: 7.7, count: 8, rangeM: 500, roundsPerMinute: 1150, arc: "FORWARD" }],
    },
    weaponSystems: { armement: "8 x mitrailleuses Browning .303", vitessePointe: "510 km/h à 4600m", moteur: "Rolls-Royce Merlin III, 1030ch" },
    historicalNote:
      "Version navalisée du Hurricane, embarquée sur les tout premiers porte-avions d'escorte. Sur le PQ-18 (septembre 1942), les 802e et 883e escadrilles de la Fleet Air Arm en alignent 12 à bord du HMS Avenger — première fois qu'un convoi arctique dispose d'une couverture aérienne organique. Quatre appareils perdus, cinq victoires revendiquées sur les Ju 88/He 111.",
    theater: "Atlantique/Arctique 1939-45",
  },
];

async function main() {
  for (const entry of entries) {
    await prisma.libraryUnitClass.upsert({ where: { key: entry.key }, create: entry, update: entry });
    console.log("OK:", entry.name);
  }
}
main()
  .catch((err: unknown) => { console.error("FATAL:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
