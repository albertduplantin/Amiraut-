"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, AccessDeniedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitTacticalMovement, submitTacticalFire, postTacticalMessage } from "@/lib/tacticalEngine";
import { OrderValidationError } from "@/lib/turnEngine";
import type { DepthBand, WeaponType } from "@/generated/prisma/client";
import type { LatLng } from "@/lib/geo";

export type BattleActionResult = { ok: true } | { ok: false; error: string };

async function assertOwnsUnits(teamId: string, unitIds: string[]) {
  const count = await prisma.unit.count({ where: { id: { in: unitIds }, fleet: { teamId } } });
  if (count !== unitIds.length) throw new AccessDeniedError("Une de ces unités ne vous appartient pas.");
}

export async function submitMovementAction(params: {
  engagementId: string;
  moves: { unitId: string; speedKnots: number; path: LatLng[]; depthBand?: DepthBand }[];
}): Promise<BattleActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertOwnsUnits(session.teamId, params.moves.map((m) => m.unitId));
    await submitTacticalMovement({ engagementId: params.engagementId, teamId: session.teamId, moves: params.moves });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/team/battle/${params.engagementId}`);
  return { ok: true };
}

export async function submitFireAction(params: {
  engagementId: string;
  shots: { unitId: string; targetUnitId: string; weaponType: WeaponType; torpedoTypeId?: string }[];
}): Promise<BattleActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertOwnsUnits(session.teamId, params.shots.map((s) => s.unitId));
    await submitTacticalFire({ engagementId: params.engagementId, teamId: session.teamId, shots: params.shots });
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/team/battle/${params.engagementId}`);
  revalidatePath("/team/orders");
  revalidatePath("/team/reports");
  return { ok: true };
}

export async function sendBattleChatAction(params: { engagementId: string; body: string }): Promise<BattleActionResult> {
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
  revalidatePath(`/team/battle/${params.engagementId}`);
  return { ok: true };
}
