"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanOrderUnit, assertCanOrderFleet, AccessDeniedError } from "@/lib/auth";
import { saveUnitOrder, requestFleetTransfer, cancelFleetTransfer, OrderValidationError } from "@/lib/turnEngine";
import { prisma } from "@/lib/prisma";
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

export type FleetTransferResult = { ok: true } | { ok: false; error: string };

/**
 * Demande un changement de flotte pour une unité. Ordre transmis par
 * signal : ne s'applique qu'à la publication du tour en cours (voir
 * `requestFleetTransfer` dans turnEngine.ts pour la justification
 * historique), pas immédiatement.
 */
export async function requestFleetTransferAction(params: {
  unitId: string;
  targetFleetId: string;
}): Promise<FleetTransferResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await assertCanOrderFleet(session, params.targetFleetId);
    await requestFleetTransfer({ unitId: params.unitId, targetFleetId: params.targetFleetId });
  } catch (error) {
    if (error instanceof OrderValidationError || error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/team/orders");
  return { ok: true };
}

export async function cancelFleetTransferAction(params: { unitId: string }): Promise<FleetTransferResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await cancelFleetTransfer(params.unitId);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/team/orders");
  return { ok: true };
}

/**
 * Applique un trajet unique à toute une flotte : chaque navire suit le même
 * tracé, décalé pour conserver sa position relative actuelle au sein de la
 * flotte (formation simple préservée, pas de rotation).
 */
export async function submitFleetOrderAction(params: {
  turnId: string;
  fleetId: string;
  speedKnots: number;
  waypoints: LatLng[];
}): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderFleet(session, params.fleetId);

    const units = await prisma.unit.findMany({
      where: { fleetId: params.fleetId, status: "ACTIVE" },
      select: { id: true, name: true, currentLat: true, currentLng: true },
    });
    if (units.length === 0) {
      return { ok: false, error: "Aucune unité active dans cette flotte." };
    }

    const centroid = {
      lat: units.reduce((sum, u) => sum + u.currentLat, 0) / units.length,
      lng: units.reduce((sum, u) => sum + u.currentLng, 0) / units.length,
    };

    for (const unit of units) {
      const offset = { lat: unit.currentLat - centroid.lat, lng: unit.currentLng - centroid.lng };
      const translatedWaypoints = params.waypoints.map((w) => ({ lat: w.lat + offset.lat, lng: w.lng + offset.lng }));

      try {
        await saveUnitOrder({
          turnId: params.turnId,
          unitId: unit.id,
          submittedById: session.participantId,
          speedKnots: params.speedKnots,
          waypoints: translatedWaypoints,
        });
      } catch (error) {
        if (error instanceof OrderValidationError) {
          return { ok: false, error: `${unit.name} : ${error.message}` };
        }
        throw error;
      }
    }
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
