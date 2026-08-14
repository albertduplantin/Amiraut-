"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, AccessDeniedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  submitTacticalMovementForUnit,
  finishMovementPhase,
  submitTacticalFireShot,
  finishFirePhase,
  postTacticalMessage,
  fireTorpedoSalvo,
  type FireShotResult,
} from "@/lib/tacticalEngine";
import { OrderValidationError } from "@/lib/turnEngine";
import type { DepthBand, WeaponType, TorpedoSpread } from "@/generated/prisma/client";
import type { LatLng } from "@/lib/geo";

export type TacticalActionResult = { ok: true } | { ok: false; error: string };
export type FireShotActionResult = { ok: true; result: FireShotResult } | { ok: false; error: string };
export type FireTorpedoSalvoActionResult = { ok: true; salvoId: string; headingDeg: number } | { ok: false; error: string };

async function assertOwnsUnits(teamId: string, unitIds: string[]) {
  const count = await prisma.unit.count({ where: { id: { in: unitIds }, fleet: { teamId } } });
  if (count !== unitIds.length) throw new AccessDeniedError("Une de ces unités ne vous appartient pas.");
}

/**
 * Enregistre le mouvement d'UN navire (voir tacticalEngine.submitTacticalMovementForUnit) :
 * rappelable plusieurs fois, y compris pour changer d'avis, tant que la phase n'est pas
 * terminée. Pas de vitesse en paramètre : elle est déduite de la longueur du trajet.
 */
export async function submitMovementForUnitAction(params: {
  engagementId: string;
  unitId: string;
  path: LatLng[];
  depthBand?: DepthBand;
}): Promise<TacticalActionResult & { speedKnots?: number }> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertOwnsUnits(session.teamId, [params.unitId]);
    const result = await submitTacticalMovementForUnit({
      engagementId: params.engagementId,
      teamId: session.teamId,
      unitId: params.unitId,
      path: params.path,
      depthBand: params.depthBand,
    });
    revalidatePath("/team/orders");
    return { ok: true, speedKnots: result.speedKnots };
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Le camp annonce qu'il a fini de positionner ses navires cette manche ; un navire jamais repositionné garde sa position. */
export async function finishMovementPhaseAction(params: { engagementId: string }): Promise<TacticalActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await finishMovementPhase({ engagementId: params.engagementId, teamId: session.teamId });
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
  /** Quelle pièce précise tire — voir gunWeaponSlot/TORPEDO_WEAPON_SLOT dans tacticalEngine.ts. */
  weaponSlot: string;
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
      weaponSlot: params.weaponSlot,
      torpedoTypeId: params.torpedoTypeId,
    });
    revalidatePath("/team/orders");
    return { ok: true, result };
  } catch (error) {
    if (error instanceof AccessDeniedError || error instanceof OrderValidationError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Tir d'une salve de torpilles (navires/sous-marins) — action de la phase
 * de MOUVEMENT, pas de tir : voir tacticalEngine.fireTorpedoSalvo. La salve
 * avance ensuite manche après manche jusqu'à interception ou portée
 * maximale dépassée, résolue automatiquement à chaque résolution de
 * mouvement (aucun second appel nécessaire côté joueur).
 */
export async function fireTorpedoSalvoAction(params: {
  engagementId: string;
  unitId: string;
  aimLat: number;
  aimLng: number;
  spread: TorpedoSpread;
  torpedoTypeId?: string;
  targetUnitId?: string;
}): Promise<FireTorpedoSalvoActionResult> {
  const session = await getSession();
  try {
    assertPlayer(session);
    await assertOwnsUnits(session.teamId, [params.unitId]);
    const result = await fireTorpedoSalvo({
      engagementId: params.engagementId,
      teamId: session.teamId,
      unitId: params.unitId,
      aimLat: params.aimLat,
      aimLng: params.aimLng,
      spread: params.spread,
      torpedoTypeId: params.torpedoTypeId,
      targetUnitId: params.targetUnitId,
    });
    revalidatePath("/team/orders");
    return { ok: true, salvoId: result.salvoId, headingDeg: result.headingDeg };
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
