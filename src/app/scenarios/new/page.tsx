import { prisma } from "@/lib/prisma";
import { findScenarioAsync } from "../../../../prisma/scenarios/index";
import { ScenarioEditorForm } from "./ScenarioEditorForm";
import type { LibraryClassOption } from "./builder/types";

/**
 * `?duplicate=<key>` (bouton « Dupliquer et modifier » sur /create, retour
 * utilisateur 2026-08-14) : pré-remplit l'éditeur avec le contenu COMPLET
 * d'un scénario existant — intégré (fichier TS) ou déjà créé par un joueur
 * — plutôt que l'exemple générique. `findScenarioAsync` cherche déjà dans
 * les deux bibliothèques, exactement ce qu'il faut ici. Une clé introuvable
 * (lien périmé, faute de frappe) retombe silencieusement sur l'éditeur
 * vierge plutôt que de planter la page.
 *
 * `libraryClasses` (constructeur visuel, retour utilisateur 2026-08-14) :
 * alimente le panneau bibliothèque (glisser/choisir une classe existante) —
 * voir builder/LibraryBrowserPanel.tsx.
 */
export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<{ duplicate?: string }> }) {
  const { duplicate } = await searchParams;
  const [duplicateFrom, libraryClassRows] = await Promise.all([
    duplicate ? findScenarioAsync(prisma, duplicate) : Promise.resolve(undefined),
    prisma.libraryUnitClass.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
  ]);
  const libraryClasses: LibraryClassOption[] = libraryClassRows.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    nation: c.nation,
    category: c.category,
    theater: c.theater,
    iconKey: c.iconKey,
    passive: c.passive,
  }));
  return <ScenarioEditorForm duplicateFrom={duplicateFrom ?? null} libraryClasses={libraryClasses} />;
}
