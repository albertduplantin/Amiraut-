import type { ScenarioDefinition } from "./types";

/**
 * Convoi HG 53, 8 février 1941 — au large du cap Saint-Vincent.
 *
 * Quatrième scénario de la bibliothèque, le premier à combiner sous-marin,
 * navires de surface ET avion de RECONNAISSANCE (pas seulement chasseur ou
 * bombardier) — demandé explicitement pour tester ce rôle particulier. Le
 * Focke-Wulf Fw 200 Condor, ici, n'est pas qu'un bombardier : sa vraie
 * valeur est de repérer et suivre un convoi pour guider les U-Boote vers
 * lui, rôle qui vaut à l'appareil son surnom de « fléau de l'Atlantique ».
 *
 * Dans la nuit du 7 au 8 février 1941, l'U-37 (Kptlt. Victor Oehrn) repère
 * le convoi HG 53 (21 navires, Gibraltar → Liverpool) au large du cap Saint-
 * Vincent et torpille plusieurs cargos. À l'aube, cinq Fw 200 Condor du
 * Kampfgeschwader 40 décollent de Bordeaux-Mérignac ; ils retrouvent le
 * convoi à midi, à 400 milles au sud-ouest de Lisbonne, et larguent vingt
 * bombes — six touchent leur cible, coulant cinq cargos supplémentaires.
 * L'U-37, resté en contact, continue d'émettre des signaux de relèvement
 * qui guideront le croiseur lourd Admiral Hipper vers les traînards trois
 * jours plus tard (hors scope de ce scénario). Neuf navires perdus au
 * total — l'un des désastres qui poussera l'Amirauté à hâter la mise en
 * service des premiers porte-avions d'escorte.
 *
 * Escorte volontairement modeste et sans les équipements des scénarios
 * suivants (PQ-18 1942, Cap Nord 1943) : ni radar de veille surface, ni
 * Hedgehog, ni goniométrie HF — aucun des trois n'était encore en service
 * sur l'escorte de convois en février 1941. Bon contraste technologique
 * avec les deux scénarios plus tardifs de la bibliothèque.
 *
 * Le sous-marin (Type IXA, longue portée — différent du Type VIIC déjà en
 * bibliothèque) est une nouvelle classe bibliothèque (voir
 * prisma/seed-library-hg53.ts) ; le Condor existait déjà
 * (seed-aircraft-library.ts). Les deux escorteurs restent définis en ligne,
 * comme les navires des scénarios précédents.
 */
export const hg53: ScenarioDefinition = {
  key: "hg53-1941",
  name: "Convoi HG 53 — Cap Saint-Vincent (8 février 1941)",
  description:
    "Un sous-marin qui a déjà frappé dans la nuit reste en contact pendant que cinq Focke-Wulf Condor retrouvent le convoi à midi pour le bombarder — la combinaison U-Boot/aviation de reconnaissance longue portée qui a valu au Condor son surnom de « fléau de l'Atlantique ».",
  briefing:
    "8 février 1941, Atlantique, 400 milles au sud-ouest de Lisbonne. Le convoi HG 53 (21 navires, parti de Gibraltar le 6 février) fait route vers Liverpool sous l'escorte modeste du destroyer HMS Velox et du sloop HMS Deptford — pas de radar de veille surface, pas de Hedgehog, pas de goniométrie HF : ces équipements n'existent pas encore sur l'escorte de convois. Dans la nuit, l'U-37 a déjà torpillé plusieurs cargos et reste en contact, résolu à torpiller ce qu'il peut avant l'aube tout en évitant les grenades ASM. À l'aube, cinq Focke-Wulf Fw 200 Condor du Kampfgeschwader 40 décollent de Bordeaux-Mérignac : leur mission n'est pas seulement de bombarder, c'est d'abord de retrouver le convoi et de guider la chasse — leur rayon d'action de 3 500km leur permet de patrouiller là où aucun chasseur allié ne peut encore les intercepter. À midi, ils localisent HG 53 et attaquent.",
  dateLabel: "8 février 1941, matinée à mi-journée",
  mapCenterLat: 34.0,
  mapCenterLng: -15.0,
  mapDefaultZoom: 8,
  defaultTurnMinutes: 30,
  tacticalRoundMinutes: 3,
  weather: {
    visibilityNm: 10,
    seaState: 3,
    daylight: "DAY",
    precipitation: "NONE",
    windKnots: 15,
    notes: "Plein jour, visibilité correcte — condition nécessaire à la fois pour la veille visuelle de l'escorte (aucun radar de surface à bord en 1941) et pour que les Condors retrouvent le convoi à l'estime après un vol de plusieurs heures.",
  },

  unitClasses: [
    {
      key: "destroyer-v-class",
      name: "Destroyer classe V (HMS Velox)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 34,
      lengthMeters: 91.4,
      beamMeters: 8.2,
      turningRadiusM: 280,
      accelerationKnotsPerMin: 5,
      combatProfile: {
        guns: [
          { calibreMm: 102, count: 2, rangeM: 15000, roundsPerMinute: 10, arc: "FORWARD" },
          { calibreMm: 102, count: 2, rangeM: 15000, roundsPerMinute: 10, arc: "AFT" },
        ],
        torpedoTubes: { count: 4, rangeM: 11000, speedKnots: 40, arc: "BROADSIDE" },
      },
      sensors: [
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 1.1 },
      ],
      detectability: 0.8,
      iconKey: "destroyer",
      resistancePoints: 4,
      depthChargeStock: 30,
      historicalNote:
        "1 272t, 4 canons de 102mm (4in), 4 tubes lance-torpilles de 21in. Chef d'escorte de HG 53 avec le sloop Deptford — pas de radar de veille surface embarqué à cette date, la détection reste à l'œil et à l'ASDIC.",
      weaponSystems: {
        displacementTons: 1272,
        mainGuns: "4 x 102mm (4in)",
        torpedoes: "4 x 533mm (21in), 2 plateformes doubles",
        antiAerien: "2 x 2pdr pom-pom",
      },
    },
    {
      key: "sloop-grimsby-class",
      name: "Sloop classe Grimsby (HMS Deptford)",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 16.5,
      lengthMeters: 81.15,
      beamMeters: 11.0,
      turningRadiusM: 220,
      accelerationKnotsPerMin: 3,
      combatProfile: {
        guns: [
          { calibreMm: 120, count: 1, rangeM: 15000, roundsPerMinute: 8, arc: "FORWARD" },
          { calibreMm: 120, count: 1, rangeM: 15000, roundsPerMinute: 8, arc: "AFT" },
        ],
      },
      sensors: [
        { type: "VISUAL", rangeNm: 10 },
        { type: "SONAR", rangeNm: 1.1 },
      ],
      detectability: 0.75,
      iconKey: "destroyer",
      resistancePoints: 3.5,
      depthChargeStock: 40,
      historicalNote:
        "990t, 2 canons de 120mm (4.7in), aucun tube lance-torpilles — un sloop est un escorteur ASM dédié, plus lent qu'un destroyer (16.5 nds) mais avec une réserve de grenades ASM plus généreuse. HMS Deptford sert de navire du commodore d'escorte lors de HG 53.",
      weaponSystems: {
        displacementTons: 990,
        mainGuns: "2 x 120mm (4.7in)",
        antiAerien: "1 x 76mm (3in) DCA",
      },
    },
    { key: "uboat-local", libraryKey: "uboat-type-ixa" },
    { key: "condor-local", libraryKey: "fw200-condor" },
  ],

  teams: [
    {
      name: "Convoi HG 53 — Escorte",
      colorHex: "#3b82f6",
      fleets: [
        {
          name: "Escorte",
          units: [
            { name: "HMS Velox", classKey: "destroyer-v-class", lat: 34.02, lng: -15.0, headingDeg: 90 },
            {
              name: "HMS Deptford",
              classKey: "sloop-grimsby-class",
              lat: 33.98,
              lng: -15.02,
              headingDeg: 90,
              historicalNote: "Navire du commodore d'escorte de HG 53.",
            },
          ],
        },
      ],
    },
    {
      name: "Kriegsmarine/Luftwaffe — U-37 & Condors",
      colorHex: "#dc2626",
      fleets: [
        {
          name: "U-37",
          units: [
            {
              name: "U-37",
              classKey: "uboat-local",
              lat: 34.0,
              lng: -14.95,
              headingDeg: 270,
              historicalNote: "Kptlt. Victor Oehrn — a déjà torpillé plusieurs cargos dans la nuit et reste en contact.",
            },
          ],
        },
        {
          name: "Kampfgeschwader 40 (reconnaissance longue portée)",
          units: [
            { name: "Condor « Emil 1 »", classKey: "condor-local", lat: 33.95, lng: -14.9, headingDeg: 215 },
            { name: "Condor « Emil 2 »", classKey: "condor-local", lat: 33.92, lng: -14.85, headingDeg: 215 },
            { name: "Condor « Emil 3 »", classKey: "condor-local", lat: 34.05, lng: -14.8, headingDeg: 215 },
          ],
        },
      ],
    },
  ],

  objectives: [
    {
      teamName: "Convoi HG 53 — Escorte",
      text: "Protégez le convoi : repoussez ou coulez l'U-37 avant qu'il ne torpille d'autres cargos, et abattez les Condors avant qu'ils ne larguent leurs bombes — sans radar de surface ni Hedgehog, vous n'avez que l'œil, l'ASDIC et les grenades ASM classiques, la technologie de 1941, pas celle de 1942-43.",
    },
    {
      teamName: "Kriegsmarine/Luftwaffe — U-37 & Condors",
      text: "L'U-37 doit maintenir le contact et torpiller autant de cibles que possible tout en évitant l'ASDIC ; les Condors doivent d'abord confirmer la position du convoi puis bombarder — reproduisez le succès historique du 8 février : six bombes sur vingt larguées ont touché leur cible.",
    },
  ],

  source:
    "Déroulé et chronologie d'après Wikipedia (Convoy HG 53) et uboat.net (U-37, Fw 200 Condor). Classes navire/sous-marin sourcées Wikipedia (HMS Velox D34, Grimsby-class sloop, Type IXA submarine) — voir prisma/seed-library-hg53.ts pour le détail complet des sources par classe. Condor repris de la bibliothèque existante (prisma/seed-aircraft-library.ts).",
};
