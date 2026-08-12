"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, AccessDeniedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitTacticalMovement, submitTacticalFireShot, finishFirePhase, postTacticalMessage, type FireShotResult } from "@/lib/tacticalEngine";
import { OrderValidationError } from "@/lib/turnEngine";
import type { DepthBand, WeaponType } from "@/generated/prisma/client";
import type { LatLng } from "@/lib/geo";

export type TacticalActionResult = { ok: true } | { ok: false; error: string };
export type FireShotActionResult = { ok: true; result: FireShotResult } | { ok: false; error: string };

async function assertOwnsUnits(teamId: string, unitIds: string[]) {
  const count = await prisma.unit.count({ where: { id: { in: unitIds }, fleet: { teamId } } });
  if (count !== unitIds.length) throw new AccessDeniedError("Une de ces unités ne vous appartient pas.");
}

export async function submitTacticalMovementAction(params: {
  engagementId: string;
  moves: { unitId: string; speedKnots: number; path: LatLng[]; depthBand?: DepthBand }[];
}): Promise<TacticalActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertOwnsUnits(session.teamId, params.moves.map((m) => m.unitId));
    await submitTacticalMovement({ engagementId: params.engagementId, teamId: session.teamId, moves: params.moves });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath("/team/orders");
  return { ok: true };
}

/** Résout un tir immédiatement (voir tacticalEngine.submitTacticalFireShot) : le résultat est retourné pour affichage instantané. */
export async function submitFireShotAction(params: {
  engagementId: string;
  unitId: string;
  targetUnitId: string;
  weaponType: WeaponType;
  torpedoTypeId?: string;
}): Promise<FireShotActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertOwnsUnits(session.teamId, [params.unitId]);
    const result = await submitTacticalFireShot({
      engagementId: params.engagementId,
      teamId: session.teamId,
      unitId: params.unitId,
      targetUnitId: params.targetUnitId,
      weaponType: params.weaponType,
      torpedoTypeId: params.torpedoTypeId,
    });
    revalidatePath("/team/orders");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Le camp annonce qu'il a fini de tirer cette manche ; les dégâts s'appliquent dès que l'autre camp fait de même. */
export async function finishFirePhaseAction(params: { engagementId: string }): Promise<TacticalActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await finishFirePhase({ engagementId: params.engagementId, teamId: session.teamId });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath("/team/orders");
  revalidatePath("/team/reports");
  return { ok: true };
}

export async function sendBattleChatAction(params: { engagementId: string; body: string }): Promise<TacticalActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    if (!params.body.trim()) throw new OrderValidationError("Message vide.");
    const team = await prisma.team.findUniqueOrThrow({ where: { id: session.teamId } });
    await postTacticalMessage({
      engagementId: params.engagementId,
      kind: "CHAT",
      authorName: team.name,
      body: params.body.trim().slice(0, 500),
    });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath("/team/orders");
  return { ok: true };
}
