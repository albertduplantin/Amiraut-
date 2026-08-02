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
  revalidatePath("/arbiter/review");
}

export async function rejectDetectionAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);
  await setDetectionStatus(String(formData.get("detectionId")), "REJECTED");
  revalidatePath("/arbiter/review");
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

  revalidatePath("/arbiter/review");
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

  revalidatePath("/arbiter/positions");
  revalidatePath("/team/orders");
  return { ok: true };
}

export async function publishTurnAction(formData: FormData) {
  const session = await getSession();
  assertArbiter(session);
  await publishTurn(String(formData.get("turnId")));
  revalidatePath("/arbiter");
  revalidatePath("/arbiter/review");
  revalidatePath("/team/orders");
  revalidatePath("/team/reports");
  revalidatePath("/team/waiting");
}
