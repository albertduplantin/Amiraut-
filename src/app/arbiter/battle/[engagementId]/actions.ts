"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertArbiter, AccessDeniedError } from "@/lib/auth";
import {
  setEngagementPaused,
  postTacticalMessage,
  arbiterAdjustUnit,
  endEngagement,
} from "@/lib/tacticalEngine";
import { OrderValidationError } from "@/lib/turnEngine";

export type ArbiterBattleResult = { ok: true } | { ok: false; error: string };

export async function toggleArbiterPauseAction(params: { engagementId: string; paused: boolean }): Promise<ArbiterBattleResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
    await setEngagementPaused(params.engagementId, params.paused);
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/arbiter/battle/${params.engagementId}`);
  revalidatePath("/team/orders");
  return { ok: true };
}

export async function sendArbiterEventAction(params: { engagementId: string; body: string; teamId?: string }): Promise<ArbiterBattleResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
    if (!params.body.trim()) throw new OrderValidationError("Message vide.");
    await postTacticalMessage({
      engagementId: params.engagementId,
      kind: "ARBITER_EVENT",
      authorName: "Arbitre",
      body: params.body.trim().slice(0, 500),
      teamId: params.teamId,
    });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/arbiter/battle/${params.engagementId}`);
  revalidatePath("/team/orders");
  return { ok: true };
}

export async function arbiterAdjustUnitAction(params: {
  engagementId: string;
  unitId: string;
  healthDelta: number;
  note: string;
}): Promise<ArbiterBattleResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
    if (!params.note.trim()) throw new OrderValidationError("Précisez la nature de l'événement.");
    await arbiterAdjustUnit({
      unitId: params.unitId,
      healthDelta: params.healthDelta,
      note: params.note.trim(),
      engagementId: params.engagementId,
    });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/arbiter/battle/${params.engagementId}`);
  revalidatePath("/team/orders");
  return { ok: true };
}

export async function arbiterEndEngagementAction(params: { engagementId: string }): Promise<ArbiterBattleResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
    await endEngagement(params.engagementId, "ARBITER_ENDED");
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/arbiter/battle/${params.engagementId}`);
  revalidatePath("/team/orders");
  revalidatePath("/arbiter");
  return { ok: true };
}
