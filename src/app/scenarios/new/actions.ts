"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { validateScenarioDefinition } from "../../../../prisma/scenarios/validation";

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
