"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertArbiter, AccessDeniedError } from "@/lib/auth";
import { setTurnWeather, setDetectionStatus, addManualDetection, publishTurn, OrderValidationError } from "@/lib/turnEngine";
import { endGame } from "@/lib/gameEnd";
import { prisma } from "@/lib/prisma";
import { previewAutomaticShipResolution, applyAutomaticShipResolution, type AutoShipResolutionPreview } from "@/lib/tacticalEngine";

export async function setWeatherAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);

  const turnId = String(formData.get("turnId"));
  await setTurnWeather(turnId, {
    visibilityNm: Number(formData.get("visibilityNm")),
    seaState: Number(formData.get("seaState")),
    daylight: String(formData.get("daylight")),
    precipitation: String(formData.get("precipitation")),
    windKnots: formData.get("windKnots") ? Number(formData.get("windKnots")) : undefined,
    notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    durationMinutes: formData.get("durationHours") ? Number(formData.get("durationHours")) * 60 : undefined,
  });

  revalidatePath("/arbiter");
}

export async function confirmDetectionAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);
  await setDetectionStatus(String(formData.get("detectionId")), "CONFIRMED");
  revalidatePath("/arbiter");
}

export async function rejectDetectionAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);
  await setDetectionStatus(String(formData.get("detectionId")), "REJECTED");
  revalidatePath("/arbiter");
}

export async function addManualDetectionAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);

  await addManualDetection({
    turnId: String(formData.get("turnId")),
    observerUnitId: String(formData.get("observerUnitId")),
    targetUnitId: String(formData.get("targetUnitId")),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    method: String(formData.get("method")) as any,
    note: formData.get("note") ? String(formData.get("note")) : undefined,
  });

  revalidatePath("/arbiter");
}

export type UpdatePositionResult = { ok: true } | { ok: false; error: string };

/** Repositionne une unité (typiquement pour corriger une position de départ mal placée). */
export async function updateUnitPositionAction(params: {
  unitId: string;
  lat: number;
  lng: number;
}): Promise<UpdatePositionResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }

  await prisma.unit.update({ where: { id: params.unitId }, data: { currentLat: params.lat, currentLng: params.lng } });

  revalidatePath("/arbiter");
  revalidatePath("/team/orders");
  return { ok: true };
}

/** Déplace toute une flotte d'un même écart (formation conservée). */
export async function updateFleetPositionAction(params: {
  fleetId: string;
  deltaLat: number;
  deltaLng: number;
}): Promise<UpdatePositionResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }

  const units = await prisma.unit.findMany({
    where: { fleetId: params.fleetId, status: { in: ["ACTIVE", "DAMAGED"] } },
    select: { id: true, currentLat: true, currentLng: true },
  });

  await prisma.$transaction(
    units.map((u) =>
      prisma.unit.update({
        where: { id: u.id },
        data: { currentLat: u.currentLat + params.deltaLat, currentLng: u.currentLng + params.deltaLng },
      })
    )
  );

  revalidatePath("/arbiter");
  revalidatePath("/team/orders");
  return { ok: true };
}

/**
 * Publie le tour ET ouvre le suivant aux ordres en un seul geste — voir le
 * commentaire sur publishTurn (turnEngine.ts). Les champs météo/durée sont
 * ceux du formulaire fusionné dans DetectionsPanel (ArbiterDashboard.tsx),
 * mêmes noms que setWeatherAction pour rester cohérent.
 */
export async function publishTurnAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);
  await publishTurn(String(formData.get("turnId")), {
    weather: {
      visibilityNm: Number(formData.get("visibilityNm")),
      seaState: Number(formData.get("seaState")),
      daylight: String(formData.get("daylight")),
      precipitation: String(formData.get("precipitation")),
      windKnots: formData.get("windKnots") ? Number(formData.get("windKnots")) : undefined,
      notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    },
    durationMinutes: formData.get("durationHours") ? Number(formData.get("durationHours")) * 60 : undefined,
  });
  revalidatePath("/arbiter");
  revalidatePath("/team/orders");
  revalidatePath("/team/reports");
  revalidatePath("/team/waiting");
}

export type PreviewShipResolutionResult = { ok: true; preview: AutoShipResolutionPreview } | { ok: false; error: string };

/**
 * Filet automatique navire-contre-navire, supervisé par l'arbitre (retour
 * utilisateur 2026-08-14) : calcule un tir de canon unique SANS RIEN
 * ÉCRIRE en base — voir previewAutomaticShipResolution (tacticalEngine.ts)
 * et applyShipResolutionAction, qui applique le résultat une fois que
 * l'arbitre l'a vu et approuvé.
 */
export async function previewShipResolutionAction(params: { detectionId: string }): Promise<PreviewShipResolutionResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
    const preview = await previewAutomaticShipResolution(params.detectionId);
    return { ok: true, preview };
  } catch (error) {
    if (error instanceof OrderValidationError || error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export type ApplyShipResolutionResult = { ok: true } | { ok: false; error: string };

/** Applique un résultat déjà prévisualisé (voir previewShipResolutionAction) — aucun nouveau tirage. */
export async function applyShipResolutionAction(params: {
  detectionId: string;
  preview: AutoShipResolutionPreview;
}): Promise<ApplyShipResolutionResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
    await applyAutomaticShipResolution(params.detectionId, params.preview);
  } catch (error) {
    if (error instanceof OrderValidationError || error instanceof AccessDeniedError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
  revalidatePath("/arbiter");
  revalidatePath("/team/orders");
  revalidatePath("/team/reports");
  return { ok: true };
}

/**
 * Termine définitivement la partie (voir gameEnd.ts) et renvoie l'arbitre
 * sur le compte rendu de fin d'opération. scenarioId vient de la session,
 * jamais du formulaire — un arbitre ne doit pouvoir clore que SA partie.
 */
export async function endGameAction() {
  const session = await getSession();
  assertArbiter(session);
  await endGame(session.scenarioId);
  revalidatePath("/arbiter");
  revalidatePath("/team/orders");
  revalidatePath("/team/waiting");
  revalidatePath("/team/reports");
  redirect("/report");
}
