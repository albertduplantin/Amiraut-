"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection, AccessDeniedError } from "@/lib/auth";
import { requestTacticalMode } from "@/lib/turnEngine";

export type TacticalActionResult = { ok: true } | { ok: false; error: string };

export async function requestTacticalModeAction(params: { detectionId: string }): Promise<TacticalActionResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanViewDetection(session, params.detectionId);
    await requestTacticalMode(params.detectionId);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath(`/team/tactical/${params.detectionId}`);
  revalidatePath("/team/orders");
  return { ok: true };
}
