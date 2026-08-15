import { prisma } from "@/lib/prisma";
import { findScenarioAsync, findCustomScenarioById } from "../../../../prisma/scenarios/index";
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
 * `?edit=<id>` (bouton « Modifier » sur /create, retour utilisateur
 * 2026-08-15 — "modifier un scénario sans nécessairement le dupliquer") :
 * même pré-remplissage, mais identifié par `id` (stable même si la clé est
 * renommée dans le formulaire) et réservé aux scénarios CUSTOM
 * (`findCustomScenarioById`, jamais la bibliothèque intégrée — un scénario
 * intégré est du code source, aucune ligne en base à éditer). `editingId`
 * transmis au formulaire fait passer "Enregistrer" en écrasement de la même
 * ligne plutôt qu'en création d'une nouvelle (voir ScenarioEditorForm.tsx).
 * Les deux paramètres sont mutuellement exclusifs ; `edit` prime si les deux
 * sont présents par erreur.
 *
 * `libraryClasses` (constructeur visuel, retour utilisateur 2026-08-14) :
 * alimente le panneau bibliothèque (glisser/choisir une classe existante) —
 * voir builder/LibraryBrowserPanel.tsx.
 */
export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<{ duplicate?: string; edit?: string }> }) {
  const { duplicate, edit } = await searchParams;
  const [duplicateFrom, editingDefinition, libraryClassRows] = await Promise.all([
    duplicate && !edit ? findScenarioAsync(prisma, duplicate) : Promise.resolve(undefined),
    edit ? findCustomScenarioById(prisma, edit) : Promise.resolve(undefined),
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
  // `edit` introuvable (scénario supprimé entre-temps, lien périmé) retombe sur l'éditeur vierge plutôt que de planter — même filet que `duplicate`.
  return (
    <ScenarioEditorForm
      duplicateFrom={editingDefinition ?? duplicateFrom ?? null}
      editingId={editingDefinition ? edit! : null}
      libraryClasses={libraryClasses}
    />
  );
}
