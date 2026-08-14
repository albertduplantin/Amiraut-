import { prisma } from "@/lib/prisma";
import { findScenarioAsync } from "../../../../prisma/scenarios/index";
import { ScenarioEditorForm } from "./ScenarioEditorForm";

/**
 * `?duplicate=<key>` (bouton « Dupliquer et modifier » sur /create, retour
 * utilisateur 2026-08-14) : pré-remplit l'éditeur avec le contenu COMPLET
 * d'un scénario existant — intégré (fichier TS) ou déjà créé par un joueur
 * — plutôt que l'exemple générique. `findScenarioAsync` cherche déjà dans
 * les deux bibliothèques, exactement ce qu'il faut ici. Une clé introuvable
 * (lien périmé, faute de frappe) retombe silencieusement sur l'éditeur
 * vierge plutôt que de planter la page.
 */
export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<{ duplicate?: string }> }) {
  const { duplicate } = await searchParams;
  const duplicateFrom = duplicate ? (await findScenarioAsync(prisma, duplicate)) ?? null : null;
  return <ScenarioEditorForm duplicateFrom={duplicateFrom} />;
}
