"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection, assertCanFireAt, AccessDeniedError } from "@/lib/auth";
import { requestTacticalMode, fireTacticalWeapon, OrderValidationError, type TacticalFireResult } from "@/lib/turnEngine";
import type { WeaponType } from "@/generated/prisma/client";

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

export type FireResult = { ok: true; result: TacticalFireResult } | { ok: false; error: string };

export async function fireTacticalWeaponAction(params: {
  detectionId: string;
  attackerUnitId: string;
  targetUnitId: string;
  weaponType: WeaponType;
  torpedoTypeId?: string;
}): Promise<FireResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanFireAt(session, params.attackerUnitId, params.targetUnitId);
    const result = await fireTacticalWeapon({
      attackerUnitId: params.attackerUnitId,
      targetUnitId: params.targetUnitId,
      weaponType: params.weaponType,
      torpedoTypeId: params.torpedoTypeId,
    });
    revalidatePath(`/team/tactical/${params.detectionId}`);
    revalidatePath("/team/orders");
    revalidatePath("/team/reports");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
