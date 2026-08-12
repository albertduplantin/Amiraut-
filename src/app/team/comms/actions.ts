"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanOrderUnit, AccessDeniedError } from "@/lib/auth";
import { sendSignal, OrderValidationError } from "@/lib/turnEngine";
import type { SignalChannel } from "@/generated/prisma/client";

export type SendSignalResult = { ok: true } | { ok: false; error: string };

export async function sendSignalAction(params: {
  turnId: string;
  senderUnitId: string;
  channel: SignalChannel;
  body: string;
  kurzsignalType?: string;
}): Promise<SendSignalResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.senderUnitId);
    await sendSignal({
      turnId: params.turnId,
      teamId: session.teamId,
      senderUnitId: params.senderUnitId,
      channel: params.channel,
      body: params.body,
      kurzsignalType: params.kurzsignalType,
    });
  } catch (error) {
    if (error instanceof OrderValidationError || error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/team/comms");
  return { ok: true };
}
