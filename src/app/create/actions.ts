"use server";

import { prisma } from "@/lib/prisma";
import { findScenarioAsync, instantiateScenario, type PlayerSlotConfig } from "../../../prisma/scenarios/index";

export type CreateGameResult =
  | {
      ok: true;
      scenarioId: string;
      participants: { role: string; label: string; token: string; colorHex?: string }[];
    }
  | { ok: false; error: string };

/**
 * Crée une partie à partir d'une définition de la bibliothèque de
 * scénarios : équipes/flottes/unités, météo, premier tour, et un lien
 * d'invitation par participant. Remplace ce qui se faisait jusqu'ici à la
 * main (script ponctuel) — c'est le cœur du Lobby (bloc 2 de la feuille de
 * route). `playersByTeamName` (optionnel) permet plusieurs joueurs par
 * équipe, chacun scopé à un sous-ensemble de flottes — équipe absente de
 * cette table = un seul joueur avec accès à toute l'équipe (comportement
 * historique).
 */
export async function createGameAction(params: {
  scenarioKey: string;
  withArbiter: boolean;
  turnMinutes: number;
  playersByTeamName?: Record<string, PlayerSlotConfig[]>;
}): Promise<CreateGameResult> {
  const def = await findScenarioAsync(prisma, params.scenarioKey);
  if (!def) return { ok: false, error: "Scénario introuvable." };

  if (!Number.isFinite(params.turnMinutes) || params.turnMinutes < 10 || params.turnMinutes > 720) {
    return { ok: false, error: "Échelle de temps du tour hors limites (10 à 720 minutes)." };
  }

  try {
    const { scenario, participants } = await instantiateScenario(prisma, def, {
      withArbiter: params.withArbiter,
      turnMinutesOverride: params.turnMinutes,
      playersByTeamName: params.playersByTeamName,
    });

    return { ok: true, scenarioId: scenario.id, participants };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erreur inattendue à la création de la partie." };
  }
}
