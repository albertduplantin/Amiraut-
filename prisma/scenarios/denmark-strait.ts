import type { ScenarioDefinition } from "./types";

/**
 * Détroit du Danemark, 24 mai 1941, 05h52–06h09.
 *
 * Le duel d'artillerie le plus célèbre de la guerre navale : dix-sept
 * minutes, quatre bâtiments lourds, et le Hood qui explose à la cinquième
 * salve du Bismarck. Choisi comme scénario de référence pour la bataille
 * tactique parce qu'il est court, entièrement à l'artillerie, et que son
 * issue réelle a tenu à quelques minutes de manœuvre : le Hood approchait
 * de biais pour réduire la distance, exposant ses ponts au tir plongeant
 * — exactement le genre d'arbitrage que le mode tactique doit faire vivre.
 *
 * Positions de départ approximées au moment de l'ouverture du feu, sur la
 * base de la position de l'épave du Hood (63°20'N, 31°50'O) et des routes
 * relevées dans les rapports d'après-bataille.
 */
export const denmarkStrait: ScenarioDefinition = {
  key: "denmark-strait-1941",
  name: "Détroit du Danemark — Hood contre Bismarck (24 mai 1941)",
  description:
    "Dix-sept minutes d'artillerie lourde dans le détroit du Danemark : la Force H de l'amiral Holland intercepte le Bismarck et le Prinz Eugen en route pour l'Atlantique.",
  briefing:
    "05h52. L'aube se lève sur le détroit du Danemark, mer 4, visibilité correcte. Le vice-amiral Holland, sur le Hood, a intercepté l'escadre allemande et fonce en oblique pour réduire la distance au plus vite : son navire, conçu en 1916, a un pont fragile et redoute le tir plongeant à longue portée. Cette approche lui coûte l'usage de ses tourelles arrière. En face, le Bismarck et le Prinz Eugen ont toutes leurs pièces sur l'arc et une conduite de tir excellente. Historiquement, le Hood explose à 06h00 ; le Prince of Wales, à peine sorti des chantiers et encore encombré d'ouvriers civils, poursuit seul puis rompt le combat à 06h09.",
  dateLabel: "24 mai 1941, 05h52",
  mapCenterLat: 63.35,
  mapCenterLng: -31.8,
  mapDefaultZoom: 9,
  defaultTurnMinutes: 30,
  tacticalRoundMinutes: 3,
  weather: {
    visibilityNm: 12,
    seaState: 4,
    daylight: "DAY",
    precipitation: "NONE",
    windKnots: 20,
    notes: "Aube claire, mer formée, grains de neige épars sur l'horizon nord.",
  },

  unitClasses: [
    {
      key: "hood",
      name: "Croiseur de bataille HMS Hood",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 31,
      lengthMeters: 262,
      beamMeters: 31.8,
      turningRadiusM: 300, // croiseur de bataille rapide (conception 1916 modernisée), plus manœuvrant qu'un cuirassé pur.
      accelerationKnotsPerMin: 3,
      sensors: [
        { type: "RADAR", rangeNm: 13 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.25,
      iconKey: "battleship",
      resistancePoints: 41,
      // Silhouette de profil : Shipbucket (CC BY-NC 4.0, www.shipbucket.com), fournie par l'utilisateur.
      profileImageUrl: "/ships/hood.webp",
      historicalNote:
        "48 360 t. « The Mighty Hood », fierté de la Royal Navy pendant vingt ans, mais un croiseur de bataille de 1916 : blindage de pont insuffisant contre le tir plongeant moderne. Il explose à 06h00 le 24 mai 1941 ; 3 survivants sur 1 418 hommes.",
      combatProfile: {
        // 4 tourelles doubles : A, B avant, X, Y arrière.
        guns: [
          { calibreMm: 381, count: 4, rangeM: 26500, roundsPerMinute: 2, arc: "FORWARD" },
          { calibreMm: 381, count: 4, rangeM: 26500, roundsPerMinute: 2, arc: "AFT" },
          { calibreMm: 102, count: 14, rangeM: 15000, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 48360,
        armorMm: { belt: 305, deck: 76 },
        mainGuns: "8 x 381mm (4 tourelles doubles)",
        antiAircraft: "14 x 102mm, 24 x 40mm",
      },
    },
    {
      key: "kgv-pow",
      name: "Cuirassé HMS Prince of Wales (classe King George V)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 28,
      lengthMeters: 227,
      beamMeters: 31.4,
      turningRadiusM: 280, // cuirassé moderne (classe KGV) : voir méthodologie prisma/seed.ts.
      accelerationKnotsPerMin: 2.5,
      sensors: [
        { type: "RADAR", rangeNm: 15 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.2,
      iconKey: "battleship",
      resistancePoints: 48,
      // Silhouette de profil : Shipbucket (CC BY-NC 4.0, www.shipbucket.com), fournie par l'utilisateur.
      profileImageUrl: "/ships/prince-of-wales.png",
      historicalNote:
        "43 786 t. Tout juste sorti de chantier : des ouvriers de Vickers étaient encore à bord pendant la bataille, et ses tourelles quadruples de 356mm s'enrayèrent à répétition. Il place malgré tout le coup qui perce les soutes du Bismarck et le contraint à renoncer à sa croisière.",
      combatProfile: {
        // 2 tourelles quadruples avant (A, B) + 1 tourelle double arrière (Y).
        guns: [
          { calibreMm: 356, count: 8, rangeM: 35000, roundsPerMinute: 2, arc: "FORWARD" },
          { calibreMm: 356, count: 2, rangeM: 35000, roundsPerMinute: 2, arc: "AFT" },
          { calibreMm: 133, count: 16, rangeM: 21000, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 43786,
        armorMm: { belt: 374, deck: 152 },
        mainGuns: "10 x 356mm (2 tourelles quadruples, 1 double)",
        antiAircraft: "16 x 133mm, 32 x 40mm",
      },
    },
    {
      key: "bismarck",
      name: "Cuirassé Bismarck",
      nation: "Allemagne",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 30,
      lengthMeters: 251,
      beamMeters: 36,
      turningRadiusM: 280, // cuirassé moderne : diamètre tactique resserré ~600yd (voir méthodologie prisma/seed.ts).
      accelerationKnotsPerMin: 2.5,
      sensors: [
        { type: "RADAR", rangeNm: 12 },
        { type: "VISUAL", rangeNm: 15 },
      ],
      detectability: 1.3,
      iconKey: "battleship",
      resistancePoints: 55,
      // Silhouette de profil : Shipbucket (CC BY-NC 4.0, www.shipbucket.com), fournie par l'utilisateur.
      profileImageUrl: "/ships/bismarck.png",
      historicalNote:
        "50 300 t, le plus puissant cuirassé européen de son temps. Conduite de tir remarquable : il encadre le Hood dès la troisième salve et le détruit à la cinquième. Touché aux soutes par le Prince of Wales, il devra renoncer à l'Atlantique et sera coulé trois jours plus tard.",
      combatProfile: {
        // 4 tourelles doubles : Anton, Bruno avant, Caesar, Dora arrière.
        guns: [
          { calibreMm: 380, count: 4, rangeM: 36500, roundsPerMinute: 2.5, arc: "FORWARD" },
          { calibreMm: 380, count: 4, rangeM: 36500, roundsPerMinute: 2.5, arc: "AFT" },
          { calibreMm: 150, count: 12, rangeM: 23000, roundsPerMinute: 6, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 50300,
        armorMm: { belt: 320, deck: 120 },
        mainGuns: "8 x 380mm (4 tourelles doubles)",
        antiAircraft: "16 x 105mm, 16 x 37mm",
      },
    },
    {
      key: "prinz-eugen",
      name: "Croiseur lourd Prinz Eugen (classe Admiral Hipper)",
      nation: "Allemagne",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      lengthMeters: 212,
      beamMeters: 21.7,
      turningRadiusM: 320, // croiseur lourd : voir méthodologie dans prisma/seed.ts (ligne ~160).
      accelerationKnotsPerMin: 3.5,
      sensors: [
        { type: "RADAR", rangeNm: 11 },
        { type: "VISUAL", rangeNm: 13 },
      ],
      detectability: 1.0,
      iconKey: "cruiser",
      resistancePoints: 19,
      // Silhouette de profil : Shipbucket (CC BY-NC 4.0, www.shipbucket.com), fournie par l'utilisateur.
      // Pas de dessin Prinz Eugen disponible dans le lot fourni : on utilise
      // celui de l'Admiral Hipper (navire tête de série de la même classe,
      // conception quasi identique) en attendant un dessin dédié.
      profileImageUrl: "/ships/prinz-eugen.png",
      historicalNote:
        "16 970 t. Il ouvre le feu en même temps que le Bismarck et allume l'incendie de roquettes qui ravage la plage arrière du Hood juste avant son explosion. Seul grand bâtiment allemand de surface à survivre à la guerre.",
      combatProfile: {
        // 4 tourelles doubles : Anton, Bruno avant, Caesar, Dora arrière.
        guns: [
          { calibreMm: 203, count: 4, rangeM: 33500, roundsPerMinute: 4.5, arc: "FORWARD" },
          { calibreMm: 203, count: 4, rangeM: 33500, roundsPerMinute: 4.5, arc: "AFT" },
          { calibreMm: 105, count: 12, rangeM: 17700, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
        torpedoTubes: { count: 12, rangeM: 6000, speedKnots: 40, arc: "BROADSIDE" },
        torpedoTypes: [
          { id: "g7a", label: "G7a (à vapeur)", speedKnots: 44, rangeM: 6000, wakeVisible: true },
          { id: "g7e", label: "G7e (électrique)", speedKnots: 30, rangeM: 5000, wakeVisible: false },
        ],
      },
      weaponSystems: {
        displacementTons: 16970,
        armorMm: { belt: 80, deck: 50 },
        mainGuns: "8 x 203mm (4 tourelles doubles)",
        torpedoes: "12 x 533mm",
      },
    },
  ],

  teams: [
    {
      name: "Royal Navy — Force de combat",
      colorHex: "#3b82f6",
      fleets: [
        {
          name: "Force H (vice-amiral Holland)",
          units: [
            {
              name: "HMS Hood",
              classKey: "hood",
              pennant: "51",
              lat: 63.28,
              lng: -32.02,
              headingDeg: 300,
              historicalNote: "Navire amiral du vice-amiral Lancelot Holland. Explose à 06h00 après un coup au but dans les soutes arrière.",
            },
            {
              name: "HMS Prince of Wales",
              classKey: "kgv-pow",
              pennant: "53",
              lat: 63.272,
              lng: -32.035,
              headingDeg: 300,
              historicalNote: "En ligne de file derrière le Hood, à environ 800 m. Commandant : capitaine John Leach.",
            },
          ],
        },
      ],
    },
    {
      name: "Kriegsmarine — Rheinübung",
      colorHex: "#dc2626",
      fleets: [
        {
          name: "Escadre Lütjens",
          units: [
            {
              name: "Bismarck",
              classKey: "bismarck",
              lat: 63.42,
              lng: -31.62,
              headingDeg: 220,
              historicalNote: "Amiral Günther Lütjens à bord. Ouvre le feu sur le Hood à 05h55 et le détruit en cinq salves.",
            },
            {
              name: "Prinz Eugen",
              classKey: "prinz-eugen",
              lat: 63.432,
              lng: -31.605,
              headingDeg: 220,
              historicalNote: "En tête de la ligne allemande au moment du contact, il ouvre le feu simultanément avec le Bismarck.",
            },
          ],
        },
      ],
    },
  ],

  objectives: [
    {
      teamName: "Royal Navy — Force de combat",
      text: "Empêcher l'escadre allemande de gagner l'Atlantique Nord. Couler ou endommager assez le Bismarck pour qu'il doive rallier un port. Attention : le Hood ne supporte pas un duel prolongé à grande distance, son pont est vulnérable au tir plongeant.",
    },
    {
      teamName: "Kriegsmarine — Rheinübung",
      text: "Rompre le contact et poursuivre vers l'Atlantique en gardant le Bismarck en état de croisière. Détruire les poursuivants est un bonus, pas l'objectif : une avarie de soute suffit à faire échouer l'opération Rheinübung.",
    },
  ],

  source:
    "Positions et déroulé d'après les rapports d'après-bataille de la Royal Navy et la position relevée de l'épave du Hood (63°20'N 31°50'O). Caractéristiques : Amirauté (Paul Bois) — Avions et Navires, complétées par les données publiques usuelles.",
};
