import type { ScenarioDefinition } from "./types";

/**
 * PQ-18, 13 septembre 1942 — opération « Goldene Zange » (Peigne d'or).
 *
 * Premier scénario combinant les trois arbres du jeu à la fois côté
 * moteur ET côté joueur : sous-marins (U-Boote, ASM), navires de surface
 * (escorte de destroyers) et avions (chasse embarquée, bombardiers,
 * torpilleurs) — voir la feuille de route, bloc combat aérien terminé le
 * 2026-08-14. Sert de scénario de test pour l'ensemble des mécaniques de
 * combat construites ce jour-là.
 *
 * PQ-18 est le premier convoi arctique escorté par un porte-avions
 * d'escorte (HMS Avenger, chasseurs Sea Hurricane des 802e/883e
 * escadrilles Fleet Air Arm) — jusque-là, les convois n'avaient aucune
 * couverture aérienne organique face aux He 111/Ju 88 basés en Norvège.
 * Le 12 septembre, l'U-88 est coulé par le HMS Faulknor ; le 13, la
 * Luftwaffe lance l'attaque coordonnée « Goldene Zange » (Ju 88 en
 * diversion, 28 He 111 torpilleurs + 35 Ju 88 à très basse altitude) qui
 * coule huit navires marchands en moins de quinze minutes — l'attaque
 * aéronavale la plus meurtrière de toute la campagne arctique.
 *
 * Classes tirées de la bibliothèque partagée (/library, voir
 * prisma/seed-aircraft-library.ts et seed-library-pq18.ts) pour les avions
 * et le sous-marin — démontre le pont bibliothèque ↔ scénario. Le
 * destroyer d'escorte reste défini en ligne (classe M, HMS Milne compris
 * — voir prisma/seed.ts, même source), comme les navires des scénarios
 * précédents.
 */
export const pq18: ScenarioDefinition = {
  key: "pq18-1942",
  name: "PQ-18 — Opération « Goldene Zange » (13 septembre 1942)",
  description:
    "Premier convoi arctique protégé par un porte-avions d'escorte (HMS Avenger) affronte l'attaque aéronavale la plus lourde de la campagne : Luftwaffe et U-Boote combinés, en plein jour polaire de septembre.",
  briefing:
    "13 septembre 1942, mer de Barents, au sud de l'île aux Ours. Le convoi PQ-18 (40 navires marchands) fait route vers Arkhangelsk sous une escorte inédite : le porte-avions d'escorte HMS Avenger et ses douze Sea Hurricane, en plus des destroyers habituels. La veille, le HMS Faulknor a coulé l'U-88 d'une ligne de patrouille qui continue de filer le convoi. Ce matin, la Luftwaffe engage l'opération « Goldene Zange » (Peigne d'or) : des Ju 88 du Kampfgeschwader 30 lancent une attaque de diversion en piqué pendant que 28 He 111 torpilleurs du Kampfgeschwader 26 et des Ju 88 supplémentaires se présentent à très basse altitude, en éventail, pour saturer la DCA. En quinze minutes, huit marchands coulent. Les Sea Hurricane du HMS Avenger, décollés en urgence, se jettent dans la mêlée — la toute première fois qu'un convoi arctique dispose d'une chasse organique pour leur tenir tête.",
  dateLabel: "13 septembre 1942, matin",
  mapCenterLat: 74.28,
  mapCenterLng: 39.1,
  mapDefaultZoom: 9,
  defaultTurnMinutes: 30,
  tacticalRoundMinutes: 3,
  weather: {
    visibilityNm: 12,
    seaState: 4,
    daylight: "DAY",
    precipitation: "NONE",
    windKnots: 18,
    notes: "Plein jour polaire de septembre (contrairement à la nuit polaire de décembre) — c'est justement ce qui permet l'attaque aérienne massive du Goldene Zange, en plein jour et à très basse altitude.",
  },

  unitClasses: [
    {
      key: "destroyer-m",
      name: "Destroyer classe M (Home Fleet, 1941-42)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 36,
      lengthMeters: 100.3,
      beamMeters: 10.4,
      turningRadiusM: 300,
      accelerationKnotsPerMin: 5,
      combatProfile: {
        guns: [
          { calibreMm: 120, count: 4, rangeM: 18200, roundsPerMinute: 8, arc: "FORWARD" },
          { calibreMm: 120, count: 2, rangeM: 18200, roundsPerMinute: 8, arc: "AFT" },
        ],
        torpedoTubes: { count: 4, rangeM: 11000, speedKnots: 30, arc: "BROADSIDE" },
      },
      sensors: [
        { type: "RADAR", rangeNm: 15 },
        { type: "VISUAL", rangeNm: 10 },
        // ASDIC : portée réelle ~2000m, inefficace au-delà de ~15nds (voir weather.ts).
        { type: "SONAR", rangeNm: 1.1 },
      ],
      detectability: 0.85,
      iconKey: "destroyer",
      resistancePoints: 5,
      depthChargeStock: 60,
      historicalNote:
        "1 925t, 6 canons de 120mm, 4 tubes lance-torpilles. HMS Faulknor, Onslow et Milne assurent l'écran rapproché du convoi — Faulknor a coulé l'U-88 la veille au soir. Classe simplifiée pour les trois (Faulknor est en réalité un chef de flottille classe F, de gabarit très proche) — même convention que les destroyers classe S du scénario Cap Nord.",
      weaponSystems: {
        displacementTons: 1925,
        mainGuns: "6 x 120mm (portée 18 200m)",
        torpedoes: "4 x 533mm",
        antiAerien: "6 x 120mm, 1 x 102mm, 4 x 40mm, 2 x 20mm",
      },
    },
    { key: "uboat-local", libraryKey: "uboat-type-viic" },
    { key: "sea-hurricane-local", libraryKey: "sea-hurricane-mkib" },
    { key: "he111-local", libraryKey: "he111-h6" },
    { key: "ju88-local", libraryKey: "ju88-a4" },
  ],

  teams: [
    {
      name: "Convoi PQ-18 — Escorte alliée",
      colorHex: "#3b82f6",
      fleets: [
        {
          name: "Écran de destroyers",
          units: [
            {
              name: "HMS Faulknor",
              classKey: "destroyer-m",
              lat: 74.3,
              lng: 38.95,
              headingDeg: 60,
              historicalNote: "Chef de flottille — a coulé l'U-88 la veille au soir, 12 septembre 1942.",
            },
            { name: "HMS Onslow", classKey: "destroyer-m", lat: 74.32, lng: 39.0, headingDeg: 60 },
            { name: "HMS Milne", classKey: "destroyer-m", lat: 74.28, lng: 39.05, headingDeg: 60 },
          ],
        },
        {
          name: "Groupe aérien (HMS Avenger)",
          units: [
            {
              name: "Sea Hurricane 7A",
              classKey: "sea-hurricane-local",
              lat: 74.31,
              lng: 38.98,
              headingDeg: 120,
              baseLat: 74.3,
              baseLng: 38.95,
              baseName: "HMS Avenger (au sein de l'escorte)",
              historicalNote: "802e escadrille, Fleet Air Arm — patrouille de combat aérien (CAP) au-dessus du convoi.",
            },
            {
              name: "Sea Hurricane 7B",
              classKey: "sea-hurricane-local",
              lat: 74.33,
              lng: 39.02,
              headingDeg: 120,
              baseLat: 74.3,
              baseLng: 38.95,
              baseName: "HMS Avenger (au sein de l'escorte)",
              historicalNote: "883e escadrille, Fleet Air Arm.",
            },
          ],
        },
      ],
    },
    {
      name: "Kriegsmarine/Luftwaffe — Opération Goldene Zange",
      colorHex: "#dc2626",
      fleets: [
        {
          name: "Ligne de patrouille U-Boote",
          units: [
            { name: "U-589", classKey: "uboat-local", lat: 74.27, lng: 38.88, headingDeg: 30 },
            { name: "U-457", classKey: "uboat-local", lat: 74.34, lng: 39.12, headingDeg: 200 },
          ],
        },
        {
          name: "Kampfgeschwader 26 (torpilleurs)",
          units: [
            { name: "He 111 « Löwe 1 »", classKey: "he111-local", lat: 74.24, lng: 39.22, headingDeg: 320 },
            { name: "He 111 « Löwe 2 »", classKey: "he111-local", lat: 74.22, lng: 39.25, headingDeg: 320 },
          ],
        },
        {
          name: "Kampfgeschwader 30 (bombardiers)",
          units: [
            { name: "Ju 88 « Adler 1 »", classKey: "ju88-local", lat: 74.26, lng: 39.18, headingDeg: 320 },
            { name: "Ju 88 « Adler 2 »", classKey: "ju88-local", lat: 74.23, lng: 39.2, headingDeg: 320 },
          ],
        },
      ],
    },
  ],

  objectives: [
    {
      teamName: "Convoi PQ-18 — Escorte alliée",
      text: "Protégez le convoi : détruisez ou repoussez les U-Boote qui le filent (grenades ASM) et interceptez les avions allemands avant qu'ils n'atteignent portée de largage — vos Sea Hurricane sont votre seule vraie parade contre l'attaque à basse altitude, la DCA seule n'avait historiquement pas suffi.",
    },
    {
      teamName: "Kriegsmarine/Luftwaffe — Opération Goldene Zange",
      text: "Coordonnez l'attaque : les Ju 88 doivent faire diversion en piqué pendant que les He 111 torpillent à très basse altitude, en éventail, pour saturer la défense — reproduisez le « peigne d'or » historique. Les U-Boote profitent de la confusion pour s'approcher en surface le temps d'une salve.",
    },
  ],

  source:
    "Déroulé, ordre de bataille et chronologie d'après Wikipedia (Convoy PQ 18, Convoy PQ 18 order of battle) et recherche complémentaire (historyofwar.org pour le Sea Hurricane Mk IB, armouredcarriers.com pour le HMS Avenger). Classes navire/sous-marin reprises du livret Amirauté original (Paul Bois, « Avions et Navires ») déjà utilisé pour le seed initial du projet — voir prisma/seed.ts.",
};
