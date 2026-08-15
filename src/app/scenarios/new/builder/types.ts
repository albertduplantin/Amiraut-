import type { ScenarioUnitClass } from "../../../../../prisma/scenarios/types";

/**
 * État structuré du constructeur de scénario visuel (retour utilisateur
 * 2026-08-14) — remplace l'ancien `oobJson` (string). Un `clientId` local
 * (jamais envoyé au serveur) identifie chaque ligne pour React/le
 * glisser-déposer (Phase 6), indépendant des clés stables du scénario
 * (`key`), qui restent éditables par l'utilisateur.
 *
 * `createClientIdGenerator` — PAS un compteur module-level partagé (bug
 * trouvé le 2026-08-15) : ce module s'exécute aussi bien côté serveur (SSR
 * de la première peinture, voir ScenarioEditorForm.tsx) que côté client
 * (hydratation), et un compteur au niveau du module survit d'une requête à
 * l'autre sur un process serveur "chaud" (Vercel réutilise l'instance) —
 * la 2e page vue démarrerait donc son SSR à un compteur déjà avancé pendant
 * que sa propre hydratation cliente repartirait de zéro, produisant des
 * `<option value>` différents des deux côtés. React conserve alors
 * silencieusement les anciennes valeurs DOM côté formulaire (pour ne pas
 * écraser une saisie utilisateur en cours d'hydratation) : un `<select>`
 * semblait "revenir en arrière" après un changement pourtant bien appliqué
 * en état. Un générateur créé UNE FOIS PAR MONTAGE de composant (voir
 * ScenarioEditorForm.tsx, `useRef`) repart à zéro identiquement des deux
 * côtés pour CE chargement de page précis, sans effet de bord entre pages
 * vues successives sur le même serveur.
 */
export function createClientIdGenerator() {
  let counter = 0;
  return (prefix: string): string => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}
export type ClientIdGenerator = ReturnType<typeof createClientIdGenerator>;

export type UnitCategory = "SURFACE_SHIP" | "SUBMARINE" | "AIRCRAFT";

export type LibraryClassOption = {
  id: string;
  key: string;
  name: string;
  nation: string;
  category: UnitCategory;
  theater: string | null;
  /** Type fin (voir unitTypeTaxonomy.ts) — filtre l'assistant guidé (Phase 3) et l'aperçu carte (Phase 4). */
  iconKey: string;
  /** Installation immobile (station d'écoute…) — filtre les classes candidates pour ce type de conteneur (3e chantier, Phase 3). */
  passive: boolean;
};

/**
 * Référence de classe pour une unité posée : soit une classe de
 * bibliothèque (chemin normal du constructeur — glisser/choisir depuis
 * LibraryBrowserPanel), soit une classe EN LIGNE héritée d'un scénario
 * dupliqué (les 5 scénarios intégrés définissent encore leurs classes
 * ainsi, pas via la bibliothèque partagée) — non éditable dans ce
 * constructeur (pas d'auteur de classe inline ici, voir le plan), mais
 * préservée telle quelle pour ne rien perdre à la duplication.
 */
export type ClassRef =
  | { kind: "library"; libraryClassId: string; libraryKey: string; name: string; category: UnitCategory }
  | { kind: "inline"; key: string; name: string; category: UnitCategory; def: ScenarioUnitClass };

/** Source de base d'un avion — voir ScenarioUnit (types.ts), au plus une à la fois. */
export type BaseRef =
  | { kind: "none" }
  | { kind: "literal"; lat: string; lng: string; name: string }
  | { kind: "airbase"; key: string }
  | { kind: "squadron"; key: string }
  | { kind: "carrier"; unitName: string };

export type BuilderUnit = {
  clientId: string;
  name: string;
  pennant: string;
  headingDeg: string;
  historicalNote: string;
  lat: string;
  lng: string;
  classRef: ClassRef;
  baseRef: BaseRef;
};

export type BuilderFleet = {
  clientId: string;
  name: string;
  units: BuilderUnit[];
  /**
   * "normal" (task force navale, par défaut), "station" (station d'écoute
   * — Phase 3, une seule unité passive) ou "aviation" (Phase 4, retour
   * utilisateur 2026-08-15 : "les avions ne peuvent être ajoutés que dans
   * les bases aériennes ou un porte-avions") — task force TECHNIQUE cachée
   * de la liste visible, une par équipe, créée à la volée (voir
   * `ensureAviationFleet`, ScenarioEditorForm.tsx) pour porter les avions
   * rattachés à une base/un porte-avions : le schéma exige qu'une unité
   * appartienne à une flotte, mais l'utilisateur ne pense jamais "quelle
   * task force" pour un avion — seulement "quelle base". Pas de nouveau
   * concept de schéma (voir le plan) — juste un marqueur d'affichage/de
   * garde-fou côté builder. `undefined` = "normal", pour ne pas casser les
   * scénarios dupliqués écrits avant ce champ.
   */
  kind?: "normal" | "station" | "aviation";
};
/** `nation` (retour utilisateur 2026-08-15, troisième chantier) — voir nations.ts ; `colorHex` en est dérivé automatiquement, plus de choix manuel. */
export type BuilderTeam = { clientId: string; name: string; colorHex: string; nation: string; fleets: BuilderFleet[] };
/** `teamClientId` (retour utilisateur 2026-08-15, troisième chantier) : une base aérienne appartient désormais à une équipe, affichée dans sa liste de forces plutôt qu'un panneau global séparé. */
export type BuilderAirbase = { clientId: string; key: string; name: string; lat: string; lng: string; teamClientId: string };
export type BuilderSquadron = {
  clientId: string;
  key: string;
  name: string;
  baseRef: { kind: "none" } | { kind: "airbase"; key: string } | { kind: "carrier"; unitName: string };
};

/** Toutes les unités posées, toutes équipes/flottes confondues — utilitaire répété par plusieurs panneaux. */
export function allUnits(teams: BuilderTeam[]): BuilderUnit[] {
  return teams.flatMap((t) => t.fleets.flatMap((f) => f.units));
}

/** Unités de surface posées (candidates porte-avions pour un rattachement d'avion). */
export function surfaceShipUnits(teams: BuilderTeam[]): BuilderUnit[] {
  return allUnits(teams).filter((u) => u.classRef.category === "SURFACE_SHIP");
}

/** Nation/type/passivité d'une classe posée — via sa classe de bibliothèque, ou sa définition en ligne héritée (voir ClassRef). Fusionne ce que plusieurs panneaux résolvaient chacun séparément (nation, iconKey). */
export function resolveClassInfo(ref: ClassRef, libraryClasses: LibraryClassOption[]): { nation: string; iconKey: string; passive: boolean } | undefined {
  if (ref.kind === "inline") return { nation: ref.def.nation, iconKey: ref.def.iconKey, passive: ref.def.passive ?? false };
  const lib = libraryClasses.find((c) => c.id === ref.libraryClassId);
  return lib ? { nation: lib.nation, iconKey: lib.iconKey, passive: lib.passive } : undefined;
}

/** Navires porte-avions posés (iconKey "carrier") — Phase 4, retour utilisateur 2026-08-15 : cible valide pour rattacher un avion, au même titre qu'une base aérienne. */
export function carrierUnits(teams: BuilderTeam[], libraryClasses: LibraryClassOption[]): BuilderUnit[] {
  return surfaceShipUnits(teams).filter((u) => resolveClassInfo(u.classRef, libraryClasses)?.iconKey === "carrier");
}
