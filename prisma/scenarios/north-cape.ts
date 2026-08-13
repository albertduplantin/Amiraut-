import type { ScenarioDefinition } from "./types";

/**
 * Cap Nord, 26 décembre 1943 — la traque et la destruction du Scharnhorst.
 *
 * Choisi comme second scénario de référence parce qu'il est aux antipodes
 * du détroit du Danemark : pas un duel bref à courte distance par temps
 * clair, mais une chasse de plusieurs heures dans la nuit polaire totale,
 * où le radar remplace presque entièrement l'œil humain — et où le
 * renseignement (Ultra a révélé la sortie du Scharnhorst dès le 21
 * décembre) donne à la Royal Navy un avantage que le joueur allemand ne
 * soupçonne pas. Un seul grand bâtiment allemand, sorti sans escorte de
 * destroyers (rappelés par mauvais temps), contre l'ensemble de la Home
 * Fleet répartie en deux forces séparées : exactement la tension qu'un
 * scénario à ordres longue durée et communications doit faire vivre — le
 * Kriegsmarine doit décider s'il rompt le silence radio pour rendre compte
 * à son commandement, la Royal Navy équipe désormais ses destroyers d'un
 * détecteur HF/DF (généralisé sur l'escorte britannique à cette date,
 * contrairement à 1941).
 *
 * Positions de départ approximées à l'aube du 26 décembre : le Scharnhorst
 * vient de quitter l'Altafjord pour intercepter le convoi JW 55B, la force
 * de couverture rapprochée (Force 1, vice-amiral Burnett) croise au nord du
 * convoi, la force de couverture lointaine (Force 2, amiral Fraser) remonte
 * du sud-ouest pour lui couper la retraite — exactement la manœuvre qui,
 * dans la réalité, se refermera sur lui dix-sept heures plus tard.
 */
export const northCape: ScenarioDefinition = {
  key: "north-cape-1943",
  name: "Cap Nord — la traque du Scharnhorst (26 décembre 1943)",
  description:
    "Seul et sans escorte, le cuirassé de poche Scharnhorst appareille dans la nuit polaire pour intercepter le convoi JW 55B — sans savoir que la Royal Navy, prévenue par Ultra, a déjà refermé la nasse en deux forces séparées.",
  briefing:
    "05h00, nuit polaire totale au large du cap Nord. Le contre-amiral Erich Bey a appareillé de l'Altafjord sur le Scharnhorst pour intercepter le convoi JW 55B — ses cinq destroyers d'escorte ont été rappelés par le gros temps, il navigue seul. Ce que Bey ignore : le déchiffrement Ultra a révélé la sortie allemande dès le 21 décembre, et l'amiral Fraser a pu répartir la Home Fleet en deux forces avant même que le Scharnhorst ne quitte le fjord. Au nord du convoi, le vice-amiral Burnett croise avec sa Force 1 (Belfast, Norfolk, Sheffield) — trois croiseurs, mais un avantage radar déjà décisif dans le noir complet. Loin au sud-ouest, l'amiral Fraser referme la nasse avec sa Force 2 (Duke of York, Jamaica, quatre destroyers), invisible du Scharnhorst. Mer forte, vent de tempête : ni repérage aérien ni visuel ne seront possibles avant le contact radar. Un seul choix radio du Scharnhorst peut trahir sa position à des destroyers désormais équipés de goniométrie HF.",
  dateLabel: "26 décembre 1943, 05h00",
  mapCenterLat: 71.5,
  mapCenterLng: 20,
  mapDefaultZoom: 6,
  defaultTurnMinutes: 90,
  tacticalRoundMinutes: 3,
  weather: {
    visibilityNm: 8,
    seaState: 6,
    daylight: "POLAR_NIGHT",
    precipitation: "SNOW",
    windKnots: 45,
    notes: "Nuit polaire totale, coup de vent force 9, mer forte à très forte — la Luftwaffe ne peut pas voler, la reconnaissance ne se fera que par radar.",
  },

  unitClasses: [
    {
      key: "scharnhorst",
      name: "Cuirassé de poche Scharnhorst",
      nation: "Allemagne",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 31,
      lengthMeters: 235,
      beamMeters: 30,
      turningRadiusM: 290,
      accelerationKnotsPerMin: 2.5,
      sensors: [
        // Seetakt embarqué, portée courte et fiabilité déjà en retrait sur
        // les radars alliés de 1943 — voir historicalNote.
        { type: "RADAR", rangeNm: 10 },
        { type: "VISUAL", rangeNm: 15 },
      ],
      detectability: 1.2,
      iconKey: "battleship",
      resistancePoints: 42,
      historicalNote:
        "32 100 t. Rapide et increvable — il encaissera plus de 55 obus et 11 torpilles avant de couler — mais ses deux radars Seetakt, l'un en tête de mât avant, l'autre sur le directeur arrière, sont d'une portée et d'une fiabilité déjà dépassées par le radar centimétrique britannique de 1943. Le premier accrochage avec le Norfolk lui coûtera justement son radar avant.",
      combatProfile: {
        // Tourelles Anton, Bruno (avant) et Caesar (arrière), triples.
        guns: [
          { calibreMm: 280, count: 6, rangeM: 40900, roundsPerMinute: 2.5, arc: "FORWARD" },
          { calibreMm: 280, count: 3, rangeM: 40900, roundsPerMinute: 2.5, arc: "AFT" },
          { calibreMm: 150, count: 12, rangeM: 23000, roundsPerMinute: 6, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 32100,
        armorMm: { belt: 320, deck: 95 },
        mainGuns: "9 x 280mm (3 tourelles triples) — portée exceptionnelle pour son calibre grâce à une vitesse initiale et une élévation élevées",
        antiAircraft: "14 x 105mm, 16 x 37mm",
      },
    },
    {
      key: "kgv-doy",
      name: "Cuirassé HMS Duke of York (classe King George V)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 28,
      lengthMeters: 227,
      beamMeters: 31.4,
      turningRadiusM: 280,
      accelerationKnotsPerMin: 2.5,
      sensors: [
        // Type 284/285 : radar de conduite de tir déjà mûr fin 1943, la clé
        // de l'engagement final — il accroche le Scharnhorst en pleine nuit
        // polaire sans jamais le voir à l'œil nu avant l'ouverture du feu.
        { type: "RADAR", rangeNm: 16 },
        { type: "VISUAL", rangeNm: 15 },
      ],
      detectability: 1.2,
      iconKey: "battleship",
      resistancePoints: 48,
      historicalNote:
        "43 786 t, navire amiral de la Home Fleet (amiral Fraser). Son radar de conduite de tir accroche le Scharnhorst dès 16h15 à plus de 20nm sans aucun contact visuel — c'est lui qui referme la nasse pour l'ultime combat, avec l'aide des fusées éclairantes du Belfast.",
      combatProfile: {
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
        antiAircraft: "16 x 133mm",
      },
    },
    {
      key: "belfast",
      name: "Croiseur léger HMS Belfast (classe Town, sous-type Edinburgh)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      lengthMeters: 187,
      beamMeters: 19.3,
      turningRadiusM: 300,
      accelerationKnotsPerMin: 3.5,
      sensors: [
        { type: "RADAR", rangeNm: 14 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.0,
      iconKey: "cruiser",
      resistancePoints: 17,
      historicalNote:
        "11 550 t. Navire amiral du vice-amiral Burnett (Force 1). C'est son radar qui accroche le premier le Scharnhorst à 8h40, et ses fusées éclairantes qui l'illuminent pour le Duke of York au moment décisif.",
      combatProfile: {
        guns: [
          { calibreMm: 152, count: 6, rangeM: 23000, roundsPerMinute: 8, arc: "FORWARD" },
          { calibreMm: 152, count: 6, rangeM: 23000, roundsPerMinute: 8, arc: "AFT" },
          { calibreMm: 102, count: 12, rangeM: 15000, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 11550,
        armorMm: { belt: 114, deck: 51 },
        mainGuns: "12 x 152mm (4 tourelles triples)",
      },
    },
    {
      key: "sheffield",
      name: "Croiseur léger HMS Sheffield (classe Town)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32,
      lengthMeters: 180,
      beamMeters: 19,
      turningRadiusM: 300,
      accelerationKnotsPerMin: 3.5,
      sensors: [
        { type: "RADAR", rangeNm: 14 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.0,
      iconKey: "cruiser",
      resistancePoints: 15,
      historicalNote:
        "9 100 t, en Force 1 avec le Belfast et le Norfolk. Ses vigies aperçoivent la silhouette du Scharnhorst à l'œil nu dans la pénombre à environ 7 milles — l'un des rares contacts visuels de toute la bataille.",
      combatProfile: {
        guns: [
          { calibreMm: 152, count: 6, rangeM: 23000, roundsPerMinute: 8, arc: "FORWARD" },
          { calibreMm: 152, count: 6, rangeM: 23000, roundsPerMinute: 8, arc: "AFT" },
          { calibreMm: 102, count: 8, rangeM: 15000, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 9100,
        armorMm: { belt: 114, deck: 51 },
        mainGuns: "12 x 152mm (4 tourelles triples)",
      },
    },
    {
      key: "norfolk",
      name: "Croiseur lourd HMS Norfolk (classe County)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 31.5,
      lengthMeters: 192,
      beamMeters: 20.8,
      turningRadiusM: 310,
      accelerationKnotsPerMin: 3,
      sensors: [
        { type: "RADAR", rangeNm: 13 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 1.05,
      iconKey: "cruiser",
      resistancePoints: 16,
      historicalNote:
        "9 800 t. Encaisse deux coups de 280mm lors du premier accrochage — l'un détruit une tourelle, l'autre le radar avant du Scharnhorst, l'aveuglant pour la suite de la traque. Blindage notoirement léger pour un croiseur de sa catégorie (classe County).",
      combatProfile: {
        guns: [
          { calibreMm: 203, count: 4, rangeM: 28000, roundsPerMinute: 4, arc: "FORWARD" },
          { calibreMm: 203, count: 4, rangeM: 28000, roundsPerMinute: 4, arc: "AFT" },
          { calibreMm: 102, count: 8, rangeM: 15000, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 9800,
        armorMm: { belt: 114, deck: 38 },
        mainGuns: "8 x 203mm (4 tourelles doubles)",
      },
    },
    {
      key: "jamaica",
      name: "Croiseur léger HMS Jamaica (classe Crown Colony)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 32.5,
      lengthMeters: 169,
      beamMeters: 18.9,
      turningRadiusM: 290,
      accelerationKnotsPerMin: 3.75,
      sensors: [
        { type: "RADAR", rangeNm: 14 },
        { type: "VISUAL", rangeNm: 14 },
      ],
      detectability: 0.95,
      iconKey: "cruiser",
      resistancePoints: 14,
      historicalNote: "8 800 t, en Force 2 avec le Duke of York — contribue à l'encadrement final aux côtés des 356mm du cuirassé.",
      combatProfile: {
        guns: [
          { calibreMm: 152, count: 6, rangeM: 23000, roundsPerMinute: 8, arc: "FORWARD" },
          { calibreMm: 152, count: 6, rangeM: 23000, roundsPerMinute: 8, arc: "AFT" },
          { calibreMm: 102, count: 8, rangeM: 15000, roundsPerMinute: 10, arc: "ALL_ROUND" },
        ],
      },
      weaponSystems: {
        displacementTons: 8800,
        armorMm: { belt: 89, deck: 51 },
        mainGuns: "12 x 152mm (4 tourelles triples)",
      },
    },
    {
      key: "destroyer-s",
      name: "Destroyer classe S (HMS Savage)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 36,
      lengthMeters: 100,
      beamMeters: 10.4,
      turningRadiusM: 200,
      accelerationKnotsPerMin: 4.5,
      sensors: [
        { type: "RADAR", rangeNm: 10 },
        { type: "VISUAL", rangeNm: 12 },
        // Goniométrie HF (Huff-Duff) : généralisée sur l'escorte britannique
        // fin 1943 (contrairement au détroit du Danemark en 1941) — voir
        // Signal et resolveTurnDetections pour le déclenchement, uniquement
        // sur une émission HF adverse, jamais par simple proximité.
        { type: "HF_DF", rangeNm: 35 },
      ],
      detectability: 0.75,
      iconKey: "destroyer",
      resistancePoints: 5,
      historicalNote:
        "~1 730 t. Savage, Saumarez, Scorpion et le norvégien Stord (même classe) forment la ligne de destroyers de la Force 2 : c'est leur attaque combinée à la torpille, quatre coups au but, qui immobilise le Scharnhorst pour l'estocade finale du Duke of York.",
      combatProfile: {
        guns: [
          { calibreMm: 120, count: 2, rangeM: 15000, roundsPerMinute: 12, arc: "FORWARD" },
          { calibreMm: 120, count: 2, rangeM: 15000, roundsPerMinute: 12, arc: "AFT" },
        ],
        torpedoTubes: { count: 8, rangeM: 11000, speedKnots: 41, arc: "BROADSIDE" },
        torpedoTypes: [{ id: "mk9", label: "Mark IX (torpille lourde)", speedKnots: 41, rangeM: 11000, wakeVisible: true }],
      },
      weaponSystems: {
        displacementTons: 1730,
        mainGuns: "4 x 120mm (4,7in)",
        torpedoes: "8 x 533mm (2 plateformes quadruples)",
      },
    },
  ],

  teams: [
    {
      name: "Kriegsmarine — Ostfront",
      colorHex: "#dc2626",
      fleets: [
        {
          name: "Scharnhorst (contre-amiral Bey)",
          units: [
            {
              name: "Scharnhorst",
              classKey: "scharnhorst",
              lat: 71.0,
              lng: 24.0,
              headingDeg: 30,
              historicalNote:
                "Contre-amiral Erich Bey à bord. Sorti seul de l'Altafjord, ses cinq destroyers d'escorte ayant été rappelés par le gros temps — il ignore que la Home Fleet a été prévenue de sa sortie par Ultra dès le 21 décembre.",
            },
          ],
        },
      ],
    },
    {
      name: "Royal Navy — Home Fleet",
      colorHex: "#3b82f6",
      fleets: [
        {
          name: "Force 1 (vice-amiral Burnett)",
          units: [
            {
              name: "HMS Belfast",
              classKey: "belfast",
              pennant: "35",
              lat: 73.4,
              lng: 26.5,
              headingDeg: 200,
              historicalNote: "Navire amiral de la Force 1. Premier contact radar sur le Scharnhorst à 8h40.",
            },
            {
              name: "HMS Norfolk",
              classKey: "norfolk",
              pennant: "78",
              lat: 73.42,
              lng: 26.45,
              headingDeg: 200,
              historicalNote: "Encadre le Scharnhorst au premier accrochage et détruit son radar avant.",
            },
            {
              name: "HMS Sheffield",
              classKey: "sheffield",
              pennant: "24",
              lat: 73.38,
              lng: 26.55,
              headingDeg: 200,
              historicalNote: "Vigies : contact visuel fugace sur le Scharnhorst à environ 7 milles.",
            },
          ],
        },
        {
          name: "Force 2 (amiral Fraser)",
          units: [
            {
              name: "HMS Duke of York",
              classKey: "kgv-doy",
              pennant: "17",
              lat: 70.5,
              lng: 15.0,
              headingDeg: 50,
              historicalNote: "Navire amiral de la Home Fleet. Referme la nasse par le sud-ouest, invisible du Scharnhorst jusqu'au contact radar final.",
            },
            {
              name: "HMS Jamaica",
              classKey: "jamaica",
              pennant: "44",
              lat: 70.52,
              lng: 15.05,
              headingDeg: 50,
            },
            {
              name: "HMS Savage",
              classKey: "destroyer-s",
              pennant: "G20",
              lat: 70.48,
              lng: 14.9,
              headingDeg: 50,
            },
            {
              name: "HMS Saumarez",
              classKey: "destroyer-s",
              pennant: "G12",
              lat: 70.47,
              lng: 14.95,
              headingDeg: 50,
            },
            {
              name: "HMS Scorpion",
              classKey: "destroyer-s",
              pennant: "G72",
              lat: 70.49,
              lng: 15.1,
              headingDeg: 50,
            },
            {
              name: "HNoMS Stord",
              classKey: "destroyer-s",
              pennant: "G91",
              lat: 70.46,
              lng: 15.02,
              headingDeg: 50,
              historicalNote: "Destroyer norvégien de la France libre, intégré à la Force 2 — équipage entièrement norvégien.",
            },
          ],
        },
      ],
    },
  ],

  objectives: [
    {
      teamName: "Kriegsmarine — Ostfront",
      text: "Localiser et attaquer le convoi JW 55B sans être détruit. Un seul navire, sans escorte : évitez un engagement décisif contre une force supérieure, et rendez compte à votre commandement — mais chaque émission HF risque une goniométrie adverse.",
    },
    {
      teamName: "Royal Navy — Home Fleet",
      text: "Protéger le convoi et détruire le Scharnhorst en refermant vos deux forces sur lui sans qu'il les distingue l'une de l'autre avant qu'il ne soit trop tard pour rompre le contact.",
    },
  ],

  source:
    "Déroulé et compositions de force d'après Roskill (The War at Sea) et Konstam (The Battle of North Cape) ; ordre de bataille et chronologie recoupés avec Wikipedia (Battle of the North Cape) et Naval History and Heritage Command. Caractéristiques techniques : sources publiques usuelles, complétant celles déjà utilisées pour le scénario du détroit du Danemark.",
};
