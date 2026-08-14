import type { ScenarioDefinition } from "./types";

/**
 * Golfe de Gascogne, 30 juillet 1943 — combat aéronaval.
 *
 * Sixième scénario de la bibliothèque, le premier construit spécifiquement
 * pour tester le bloc combat aérien contre sous-marin (DCA, mitraillage,
 * bombardement/grenadage basse altitude, niveau d'équipage — recherche
 * 2026-08-14) : aucun scénario existant ne combinait un Sunderland
 * réellement armé (celui de denmark-strait.ts n'a aucun combatProfile,
 * ajouté avant ce bloc) et des U-Boote équipés de DCA.
 *
 * L'été 1943 marque un tournant dans la « bataille du golfe de Gascogne » :
 * face aux pertes croissantes causées par le radar ASV et le projecteur
 * Leigh Light du Coastal Command, l'amiral Dönitz ordonne aux U-Boote de
 * traverser le golfe groupés et EN SURFACE, pour combattre à la DCA plutôt
 * que plonger (« gruppenfahrt ») — l'appui-feu mutuel devait compenser la
 * vulnérabilité de la plongée d'urgence face à un avion déjà en approche.
 *
 * Le 30 juillet 1943, trois U-Boote naviguant ainsi groupés sont repérés
 * dans le golfe : U-461 et U-462 (ravitailleurs Type XIV « Milchkuh »,
 * sans tube lance-torpilles) et U-504 (Type IXC). Le Sunderland « U » du
 * 461 Squadron RAAF (Flt Lt Dudley Marrows) repère U-461 — coïncidence
 * amusante, l'indicatif de l'avion était justement « U » — et l'attaque
 * malgré le tir de DCA groupé des trois sous-marins ; U-461 est coulé. Le
 * même jour, des appareils du 502 Squadron (Halifax, Liberator) et
 * l'escorte du Cdr F. J. Walker coulent U-462 et U-504 — non modélisés ici
 * (l'utilisateur souhaitait spécifiquement tester le Sunderland), mais
 * mentionnés pour le contexte : ce combat isolé du 30 juillet fait partie
 * d'une action plus large où les trois U-Boote du groupe ont été perdus.
 *
 * Classes définies en ligne plutôt que via la bibliothèque partagée
 * (`uboat-type-viic`/`uboat-type-ixa` existants) : leurs fiches sont
 * calibrées pour 1941-1942, avant le renforcement de la DCA embarquée —
 * les ajouter à des classes partagées aurait à tort donné une DCA à des
 * U-Boote plus anciens dans PQ-18/HG 53.
 */
export const biscay1943: ScenarioDefinition = {
  key: "biscay-1943",
  name: "Golfe de Gascogne — combat aéronaval (30 juillet 1943)",
  description:
    "Trois U-Boote traversent le golfe de Gascogne groupés et en surface — la doctrine « gruppenfahrt » de l'été 1943 : combattre à la DCA plutôt que plonger face à l'aviation alliée. Un Sunderland du 461 Squadron RAAF les prend en chasse.",
  briefing:
    "30 juillet 1943, golfe de Gascogne. Depuis le printemps, le radar ASV et le projecteur Leigh Light du Coastal Command rendent la traversée du golfe de plus en plus meurtrière pour les U-Boote en transit vers/depuis leurs bases de Bretagne. L'amiral Dönitz a ordonné de traverser groupés et en surface plutôt que de plonger à la moindre alerte : l'appui-feu DCA mutuel de plusieurs U-Boote doit compenser la vulnérabilité d'une plongée d'urgence entamée trop tard face à un avion déjà en approche. U-461 et U-462, deux ravitailleurs Type XIV « Milchkuh » sans arme offensive, naviguent ainsi flanqués d'U-504, un sous-marin de combat Type IXC. Un Sunderland du 461 Squadron RAAF, en patrouille de veille radar/visuelle, vient de les repérer.",
  dateLabel: "30 juillet 1943, matinée",
  mapCenterLat: 45.5,
  mapCenterLng: -9.0,
  mapDefaultZoom: 8,
  defaultTurnMinutes: 30,
  tacticalRoundMinutes: 3,
  weather: {
    visibilityNm: 12,
    seaState: 3,
    daylight: "DAY",
    precipitation: "NONE",
    windKnots: 15,
    notes: "Combat diurne — la doctrine de traversée groupée en surface visait justement à survivre aux patrouilles diurnes du Coastal Command, pas seulement aux attaques nocturnes au Leigh Light.",
  },

  unitClasses: [
    {
      key: "sunderland-asw-1943",
      name: "Hydravion Short Sunderland Mk III (RAF/RAAF Coastal Command, 1943)",
      nation: "Royaume-Uni/Australie",
      category: "AIRCRAFT",
      maxSpeedKnots: 125, // vitesse de croisière de patrouille, pas la max en palier — même convention que le Sunderland de denmark-strait.ts.
      lengthMeters: 26,
      turningRadiusM: 500,
      accelerationKnotsPerMin: 8,
      // Maniabilité très faible (dogfight) — compense par ses tourelles
      // défensives ("Flying Porcupine"), pas par la manœuvre. Même
      // convention que les autres hydravions/bombardiers lourds de la
      // bibliothèque (~0.1-0.3, voir combat.ts).
      agility: 0.15,
      // 461 Squadron RAAF, équipage expérimenté de Coastal Command mi-1943
      // (plusieurs succès contre U-Boote cette année-là) — pas un niveau
      // "élite" réservé à la chasse, mais un équipage largement rodé.
      pilotSkill: "B",
      sensors: [
        { type: "VISUAL", rangeNm: 30 },
        { type: "RADAR", rangeNm: 15 }, // ASV Mk.III, généralisé sur Coastal Command en 1943 — plus fiable et longue portée que le Mk.II de 1941 (voir denmark-strait.ts).
      ],
      detectability: 1,
      iconKey: "aircraft",
      resistancePoints: 4,
      enduranceMinutes: 780, // ~13h de patrouille, Sunderland Coastal Command.
      combatProfile: {
        // Grenades ASM larguées depuis la soute (Torpex Mk VIII, ~130kg) —
        // passe basse et droite, pas un piqué de chasseur-bombardier ni un
        // ricochet anti-navire, d'où method: LEVEL.
        bombs: { count: 8, weightKg: 130, method: "LEVEL" },
        // Tourelles défensives nez/queue (.303 Browning) — servent aussi
        // bien au combat air-air qu'au mitraillage de suppression d'un
        // U-Boot en surface avant/pendant la passe de grenadage.
        guns: [
          { calibreMm: 7.7, count: 1, rangeM: 400, roundsPerMinute: 600, arc: "FORWARD" },
          { calibreMm: 7.7, count: 4, rangeM: 400, roundsPerMinute: 800, arc: "AFT" },
        ],
      },
      historicalNote:
        "461 Squadron RAAF, Coastal Command. Le 30 juillet 1943, le Sunderland « U » (Flt Lt Dudley Marrows) repère et attaque U-461 malgré la DCA groupée des trois U-Boote du convoi — coïncidence amusante avec l'indicatif de l'avion. U-461 est coulé ; l'avion rentre endommagé mais entier.",
      weaponSystems: { role: "Patrouille maritime / lutte anti-sous-marine", equipage: "10-13 hommes" },
    },
    {
      key: "uboat-xiv-milchkuh",
      name: "Sous-marin ravitailleur Type XIV « Milchkuh » (U-461/U-462)",
      nation: "Allemagne",
      category: "SUBMARINE",
      // Vitesse de surface estimée (plus lent qu'un Type VIIC — conçu pour
      // l'autonomie de ravitaillement, pas le combat), pas de source
      // chiffrée précise trouvée cette session.
      maxSpeedKnots: 14.4,
      lengthMeters: 67.1,
      beamMeters: 9.35,
      turningRadiusM: 200,
      accelerationKnotsPerMin: 3,
      sensors: [
        { type: "HYDROPHONE", rangeNm: 8 },
        { type: "VISUAL", rangeNm: 6 },
      ],
      detectability: 0.55,
      iconKey: "uboat",
      // Potentiel à proportion du déplacement (1688t contre 770t pour un
      // Type VIIC à 0.85 dans la bibliothèque) — même méthode que le reste
      // de la bibliothèque.
      resistancePoints: 1.9,
      emergencyDiveSeconds: 30,
      combatProfile: {
        // AUCUN tube lance-torpilles : un ravitailleur "Milchkuh" n'est pas
        // un combattant — sa seule défense est la DCA.
        antiAircraft: { gunCount: 3 }, // 2x 3.7cm SK C/30 + 1x 2cm C/30 — armement de base du Type XIV (uboat.net).
      },
      historicalNote:
        "1 688t, sous-marin ravitailleur ('vache à lait') sans tube lance-torpilles — sa mission est de réapprovisionner d'autres U-Boote en carburant/torpilles/vivres en haute mer, pas de combattre. U-461 et U-462 naviguaient groupés avec U-504 le 30 juillet 1943 selon la doctrine de traversée en surface avec appui DCA mutuel ; les deux ont été coulés ce jour-là (U-461 par le Sunderland du 461 Squadron, U-462 par le 502 Squadron et l'escorte du Cdr Walker).",
      weaponSystems: {
        displacementTons: 1688,
        role: "Ravitailleur (carburant, torpilles, vivres) — sans arme offensive",
        antiAircraft: "2 x 3.7cm SK C/30, 1 x 2cm C/30",
      },
    },
    {
      key: "uboat-ixc-1943",
      name: "Sous-marin Type IXC (U-504, configuration 1943)",
      nation: "Allemagne",
      category: "SUBMARINE",
      // Repris des caractéristiques du Type IXA déjà en bibliothèque (même
      // famille, tailles/vitesses très proches) — voir seed-library-hg53.ts.
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
      resistancePoints: 1.1,
      emergencyDiveSeconds: 30,
      combatProfile: {
        torpedoTubes: { count: 6, rangeM: 5000, speedKnots: 40, arc: "FORWARD" },
        torpedoTypes: [
          { id: "g7a", label: "G7a (à vapeur)", speedKnots: 44, rangeM: 7500, wakeVisible: true },
          { id: "g7e", label: "G7e (électrique)", speedKnots: 30, rangeM: 5000, wakeVisible: false },
        ],
        // DCA renforcée par rapport au Type IXA de 1941 (uboat-type-ixa,
        // qui portait encore un canon de pont de 105mm) — le canon de pont
        // est retiré et la DCA augmentée sur toute la flotte à partir de
        // l'été 1943, sur ordre de Dönitz (doctrine générale, pas un
        // chiffre spécifique à U-504 faute de source précise trouvée).
        antiAircraft: { gunCount: 2 },
      },
      submergedRangeNmAt4kt: 78,
      oxygenEnduranceHours: 60,
      torpedoStock: 22,
      historicalNote:
        "1 032t, sous-marin océanique de combat — contrairement aux Type XIV du même groupe, U-504 conserve ses tubes lance-torpilles. Coulé le 30 juillet 1943 dans la même action que U-461/U-462, par l'escorte du Cdr F. J. Walker (2nd Escort Group) — non détaillé ici.",
      weaponSystems: {
        displacementTons: 1032,
        torpedoes: "6 x 533mm (4 tubes avant, 2 arrière), 22 torpilles",
        antiAircraft: "DCA renforcée 1943 (canon de pont retiré)",
      },
    },
  ],

  teams: [
    {
      name: "RAF Coastal Command — 461 Squadron RAAF",
      colorHex: "#3b82f6",
      fleets: [
        {
          name: "Patrouille",
          units: [
            {
              name: "Sunderland « U »",
              classKey: "sunderland-asw-1943",
              lat: 45.55,
              lng: -8.95,
              headingDeg: 210,
              historicalNote: "Flt Lt Dudley Marrows — en patrouille de veille radar/visuelle au moment du contact.",
              baseLat: 47.65,
              baseLng: -2.76,
              baseName: "Mont-de-Marsan / détachement avancé (Bretagne)",
            },
          ],
        },
      ],
    },
    {
      name: "Kriegsmarine — groupe de transit (gruppenfahrt)",
      colorHex: "#dc2626",
      fleets: [
        {
          name: "Groupe de surface (appui DCA mutuel)",
          units: [
            { name: "U-461", classKey: "uboat-xiv-milchkuh", lat: 45.5, lng: -9.0, headingDeg: 250, historicalNote: "Repéré et attaqué par le Sunderland « U » — coulé." },
            { name: "U-462", classKey: "uboat-xiv-milchkuh", lat: 45.48, lng: -9.03, headingDeg: 250 },
            { name: "U-504", classKey: "uboat-ixc-1943", lat: 45.52, lng: -8.97, headingDeg: 250 },
          ],
        },
      ],
    },
  ],

  objectives: [
    {
      teamName: "RAF Coastal Command — 461 Squadron RAAF",
      text: "Attaquez le groupe de U-Boote en surface — chaque passe de grenadage ou de mitraillage s'expose à la DCA groupée des trois sous-marins, reproduisez le succès historique du 30 juillet 1943 malgré ce risque.",
    },
    {
      teamName: "Kriegsmarine — groupe de transit (gruppenfahrt)",
      text: "Traversez le golfe de Gascogne en conservant l'appui DCA mutuel du groupe ; abattez l'avion si l'occasion se présente plutôt que de plonger séparément, conformément à la doctrine de l'été 1943.",
    },
  ],

  source:
    "Action du 30 juillet 1943 d'après historyofwar.org (461 Squadron RAAF), Wikipedia (U-461, U-462) et uboat.net (armement DCA du Type XIV : 2x3.7cm + 1x2cm, plateforme quadruple 2cm sur certaines unités dont U-462) — recherches web du 2026-08-14. Type IXC repris des caractéristiques du Type IXA déjà en bibliothèque (prisma/seed-library-hg53.ts), DCA et absence de canon de pont ajustées pour la doctrine de 1943 (estimation, pas de source chiffrée spécifique à U-504).",
};
