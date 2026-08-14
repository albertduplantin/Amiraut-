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

export type BuilderFleet = { clientId: string; name: string; units: BuilderUnit[] };
export type BuilderTeam = { clientId: string; name: string; colorHex: string; fleets: BuilderFleet[] };
export type BuilderAirbase = { clientId: string; key: string; name: string; lat: string; lng: string };
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
