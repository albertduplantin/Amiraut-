"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection, AccessDeniedError } from "@/lib/auth";
import { resolveAirEncounterAutomatically, type AutoAirEncounterResult } from "@/lib/tacticalEngine";
import { OrderValidationError } from "@/lib/turnEngine";

export type AutoResolveResult = { ok: true; result: AutoAirEncounterResult } | { ok: false; error: string };

/**
 * Résolution automatique d'une détection impliquant un avion attaquant
 * (bloc combat aérien, choix hybride demandé par l'utilisateur) — voir
 * resolveAirEncounterAutomatically dans tacticalEngine.ts. Alternative à
 * l'engagement tactique complet (team/battle/open/[detectionId]/page.tsx).
 */
export async function resolveAirEncounterAutomaticallyAction(params: { detectionId: string }): Promise<AutoResolveResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertCanViewDetection(session, params.detectionId);
    const result = await resolveAirEncounterAutomatically({ detectionEventId: params.detectionId, teamId: session.teamId });
    revalidatePath("/team/orders");
    revalidatePath("/team/reports");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof OrderValidationError || error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
