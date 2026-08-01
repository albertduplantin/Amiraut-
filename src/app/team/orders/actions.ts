"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanOrderUnit, AccessDeniedError } from "@/lib/auth";
import { saveUnitOrder, OrderValidationError } from "@/lib/turnEngine";
import type { LatLng } from "@/lib/geo";

export type SubmitOrderResult = { ok: true } | { ok: false; error: string };

export async function submitOrderAction(params: {
  turnId: string;
  unitId: string;
  speedKnots: number;
  waypoints: LatLng[];
}): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await saveUnitOrder({
      turnId: params.turnId,
      unitId: params.unitId,
      submittedById: session.participantId,
      speedKnots: params.speedKnots,
      waypoints: params.waypoints,
    });
  } catch (error) {
    if (error instanceof OrderValidationError || error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/team/orders");
  revalidatePath("/team/waiting");
  return { ok: true };
}
