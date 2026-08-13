"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertArbiter, AccessDeniedError } from "@/lib/auth";
import { setTurnWeather, setDetectionStatus, addManualDetection, publishTurn } from "@/lib/turnEngine";
import { prisma } from "@/lib/prisma";

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

export async function publishTurnAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);
  await publishTurn(String(formData.get("turnId")));
  revalidatePath("/arbiter");
  revalidatePath("/team/orders");
  revalidatePath("/team/reports");
  revalidatePath("/team/waiting");
}
