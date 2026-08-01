"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanOrderUnit, assertCanOrderFleet, AccessDeniedError } from "@/lib/auth";
import { saveUnitOrder, OrderValidationError } from "@/lib/turnEngine";
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
