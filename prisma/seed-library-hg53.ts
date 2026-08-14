/**
 * Complète la bibliothèque (/library) avec la seule classe manquante pour
 * le scénario HG 53 (prisma/scenarios/hg53.ts) : le sous-marin allemand
 * longue portée. Le Fw 200 Condor existe déjà (seed-aircraft-library.ts,
 * clé "fw200-condor") — seul le sous-marin manque.
 *
 * Usage : npx tsx --env-file=.env prisma/seed-library-hg53.ts
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
    key: "uboat-type-ixa",
    name: "Sous-marin Type IXA (longue portée)",
    nation: "Allemagne",
    category: "SUBMARINE",
    maxSpeedKnots: 18.2,
    lengthMeters: 76.5,
    beamMeters: 6.51,
    turningRadiusM: 180,
    accelerationKnotsPerMin: 3,
    sensors: [
      { type: "HYDROPHONE", rangeNm: 8 },
      { type: "VISUAL", rangeNm: 7 },
    ],
    detectability: 0.5,
    iconKey: "uboat",
    // Plus gros et plus cher qu'un Type VIIC (0.85 dans la bibliothèque) —
    // potentiel augmenté à proportion du déplacement (1032t contre 770t),
    // même méthode que le reste de la bibliothèque (voir prisma/seed.ts).
    resistancePoints: 1.1,
    emergencyDiveSeconds: 30,
    combatProfile: {
      // 6 tubes (4 avant, 2 arrière) — un tiers de plus qu'un Type VIIC.
      torpedoTubes: { count: 6, rangeM: 5000, speedKnots: 40, arc: "FORWARD" },
      torpedoTypes: [
        { id: "g7a", label: "G7a (à vapeur)", speedKnots: 44, rangeM: 7500, wakeVisible: true },
        { id: "g7e", label: "G7e (électrique)", speedKnots: 30, rangeM: 5000, wakeVisible: false },
      ],
    },
    // 10 500nm à 10 nds en surface (contre 80nm pour un VIIC à 4 nds
    // immergé — même convention que le reste de la bibliothèque) : conçu
    // pour l'Atlantique lointain, pas la chasse côtière du Type VIIC.
    submergedRangeNmAt4kt: 78,
    oxygenEnduranceHours: 60,
    torpedoStock: 22,
    weaponSystems: {
      displacementTons: 1032,
      surfaceSpeedKnots: 18.2,
      submergedSpeedKnots: 7.7,
      torpedoes: "6 x 533mm (4 tubes avant, 2 arrière), 22 torpilles",
      antiAircraft: "1 x 105mm pont avant, 1 x 37mm, 1 x 20mm",
      rangeNm: "10 500nm à 10 nds en surface — conçu pour l'Atlantique lointain",
    },
    historicalNote:
      "1 032t, premier type de sous-marin océanique allemand (8 unités, 1937-39), rayon d'action bien supérieur au Type VIIC. Le 8 février 1941, l'U-37 (Kptlt. Victor Oehrn) repère le convoi HG 53 au large du cap Saint-Vincent, torpille plusieurs cargos dans la nuit puis continue d'émettre des signaux de relèvement pour guider le croiseur lourd Admiral Hipper vers les traînards.",
    theater: "Atlantique 1939-45",
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
