"use server";

import { prisma } from "@/lib/prisma";
import { findScenarioAsync, instantiateScenario } from "../../../prisma/scenarios/index";

export type CreateGameResult =
  | {
      ok: true;
      scenarioId: string;
      participants: { role: string; label: string; token: string }[];
    }
  | { ok: false; error: string };

/**
 * Crée une partie à partir d'une définition de la bibliothèque de
 * scénarios : équipes/flottes/unités, météo, premier tour, et un lien
 * d'invitation par participant (un par équipe, plus l'arbitre si demandé).
 * Remplace ce qui se faisait jusqu'ici à la main (script ponctuel) — c'est
 * le cœur du Lobby (bloc 2 de la feuille de route).
 */
export async function createGameAction(params: {
  scenarioKey: string;
  withArbiter: boolean;
  turnMinutes: number;
}): Promise<CreateGameResult> {
  const def = await findScenarioAsync(prisma, params.scenarioKey);
  if (!def) return { ok: false, error: "Scénario introuvable." };

  if (!Number.isFinite(params.turnMinutes) || params.turnMinutes < 10 || params.turnMinutes > 720) {
    return { ok: false, error: "Échelle de temps du tour hors limites (10 à 720 minutes)." };
  }

  const { scenario, participants } = await instantiateScenario(prisma, def, {
    withArbiter: params.withArbiter,
    turnMinutesOverride: params.turnMinutes,
  });

  return { ok: true, scenarioId: scenario.id, participants };
}
