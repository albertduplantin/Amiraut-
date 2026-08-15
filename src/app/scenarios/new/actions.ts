"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { validateScenarioDefinition } from "../../../../prisma/scenarios/validation";
import { findScenario } from "../../../../prisma/scenarios/index";

export type SaveScenarioResult = { ok: true; key: string } | { ok: false; error: string };

/**
 * Enregistre un scénario créé par un joueur (module éditeur, bloc "création
 * de scénarios" de la feuille de route). Revalide entièrement côté serveur
 * — jamais confiance dans le fait que l'aperçu côté client ait déjà validé.
 */
export async function createCustomScenarioAction(definitionJson: unknown): Promise<SaveScenarioResult> {
  let definition;
  try {
    definition = validateScenarioDefinition(definitionJson);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Scénario invalide." };
  }

  const existing = await prisma.customScenario.findUnique({ where: { key: definition.key } });
  if (existing) {
    return { ok: false, error: `La clé « ${definition.key} » est déjà utilisée par un autre scénario — choisissez-en une autre.` };
  }

  await prisma.customScenario.create({
    data: {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      definition: definition as never,
    },
  });

  revalidatePath("/create");
  return { ok: true, key: definition.key };
}

export type DeleteScenarioResult = { ok: true } | { ok: false; error: string };

/**
 * Supprime un scénario custom (retour utilisateur 2026-08-15 — "il faut
 * aussi qu'on puisse supprimer les scénarios"). Ne touche jamais une
 * partie déjà instanciée : `instantiateScenario` COPIE la définition dans
 * `Scenario`/`Team`/`Unit`... au moment de la création, sans référence
 * arrière vers `CustomScenario` — supprimer le gabarit n'affecte donc
 * jamais une partie en cours ou terminée. Depuis la migration du
 * 2026-08-15 (les 5 scénarios intégrés vivent maintenant aussi en
 * `CustomScenario`, voir amiraute-roadmap), cette action s'applique
 * potentiellement à N'IMPORTE QUEL scénario listé sur /create.
 */
export async function deleteCustomScenarioAction(id: string): Promise<DeleteScenarioResult> {
  const existing = await prisma.customScenario.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Ce scénario n'existe plus — il a peut-être déjà été supprimé." };

  await prisma.customScenario.delete({ where: { id } });

  revalidatePath("/create");
  return { ok: true };
}

/**
 * Édite EN PLACE un scénario créé par un joueur (retour utilisateur
 * 2026-08-15 — "il faut qu'on puisse modifier un scénario sans
 * nécessairement le dupliquer") : écrase la définition de la même ligne
 * `CustomScenario` (identifiée par `id`, stable même si l'utilisateur
 * renomme la clé pendant l'édition), plutôt que d'en créer une nouvelle
 * comme `createCustomScenarioAction`. Réservé aux scénarios custom — un
 * scénario intégré (bibliothèque `SCENARIO_LIBRARY`, fichier TS) n'a pas
 * de ligne en base à écraser, seule la voie "Dupliquer et modifier" a un
 * sens pour lui.
 */
export async function updateCustomScenarioAction(id: string, definitionJson: unknown): Promise<SaveScenarioResult> {
  let definition;
  try {
    definition = validateScenarioDefinition(definitionJson);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Scénario invalide." };
  }

  const existing = await prisma.customScenario.findUnique({ where: { id } });
  if (!existing) {
    return { ok: false, error: "Ce scénario n'existe plus — il a peut-être déjà été supprimé." };
  }

  if (definition.key !== existing.key) {
    // La clé change : revérifie l'unicité contre TOUTE la bibliothèque (intégrée ET les autres scénarios custom), pas seulement contre elle-même.
    if (findScenario(definition.key)) {
      return { ok: false, error: `La clé « ${definition.key} » est déjà utilisée par un scénario intégré — choisissez-en une autre.` };
    }
    const collision = await prisma.customScenario.findUnique({ where: { key: definition.key } });
    if (collision && collision.id !== id) {
      return { ok: false, error: `La clé « ${definition.key} » est déjà utilisée par un autre scénario — choisissez-en une autre.` };
    }
  }

  await prisma.customScenario.update({
    where: { id },
    data: {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      definition: definition as never,
    },
  });

  revalidatePath("/create");
  return { ok: true, key: definition.key };
}
