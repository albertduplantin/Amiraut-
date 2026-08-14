"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanOrderUnit, assertCanOrderFleet, AccessDeniedError } from "@/lib/auth";
import {
  saveUnitOrder,
  saveAirPatrolOrder,
  saveRouteOrder,
  saveAirPatrolRotationOrder,
  cancelStandingOrder,
  requestFleetTransfer,
  cancelFleetTransfer,
  OrderValidationError,
} from "@/lib/turnEngine";
import { prisma } from "@/lib/prisma";
import type { LatLng } from "@/lib/geo";
import type { DepthBand } from "@/generated/prisma/client";

export type SubmitOrderResult = { ok: true } | { ok: false; error: string };

export async function submitOrderAction(params: {
  turnId: string;
  unitId: string;
  speedKnots: number;
  waypoints: LatLng[];
  depthBand?: DepthBand;
  standing?: boolean;
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
      depthBand: params.depthBand,
      standing: params.standing,
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
 * Ordre permanent de patrouille aérienne (bloc 3) : décollage → recherche →
 * retour, reconduit automatiquement tant qu'il n'est pas annulé.
 */
export async function submitAirPatrolAction(params: {
  turnId: string;
  unitId: string;
  patrolPoint: LatLng;
}): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await saveAirPatrolOrder({ turnId: params.turnId, unitId: params.unitId, patrolPoint: params.patrolPoint });
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
 * Ordre permanent « trajectoire longue durée » (bloc 3, refonte) : le
 * joueur dessine le trajet complet de son unité en une fois, vitesse par
 * segment — voir saveRouteOrder dans turnEngine.ts.
 */
export async function submitRouteOrderAction(params: {
  turnId: string;
  unitId: string;
  segments: { lat: number; lng: number; speedKnots: number }[];
}): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await saveRouteOrder({
      turnId: params.turnId,
      unitId: params.unitId,
      submittedById: session.participantId,
      segments: params.segments,
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
 * Ordre permanent « rotation de patrouilles » (bloc 3, refonte) : une file
 * de zones successives, chacune survolée un nombre de cycles donné avant de
 * passer à la suivante — voir saveAirPatrolRotationOrder dans turnEngine.ts.
 */
export async function submitAirPatrolRotationAction(params: {
  turnId: string;
  unitId: string;
  zones: { lat: number; lng: number; cyclesCount: number }[];
}): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await saveAirPatrolRotationOrder({ turnId: params.turnId, unitId: params.unitId, zones: params.zones });
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

/** Annule l'ordre permanent (maintien de cap ou patrouille aérienne) d'une unité. */
export async function cancelStandingOrderAction(params: { unitId: string }): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderUnit(session, params.unitId);
    await cancelStandingOrder(params.unitId);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  revalidatePath("/team/orders");
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
 * flotte (formation simple préservée, pas de rotation). `standing` (bloc 3)
 * marque l'ordre comme permanent pour toute la flotte d'un coup — jusque-là
 * réservé à un ordre navire par navire.
 */
export async function submitFleetOrderAction(params: {
  turnId: string;
  fleetId: string;
  speedKnots: number;
  waypoints: LatLng[];
  // Bloc 3 (extension flotte) : même drapeau qu'un ordre individuel, propagé
  // tel quel à chaque navire de la flotte — voir saveUnitOrder.
  standing?: boolean;
}): Promise<SubmitOrderResult> {
  const session = await getSession();

  try {
    assertPlayer(session);
    await assertCanOrderFleet(session, params.fleetId);

    const units = await prisma.unit.findMany({
      where: { fleetId: params.fleetId, status: { in: ["ACTIVE", "DAMAGED"] } },
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
          standing: params.standing,
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
