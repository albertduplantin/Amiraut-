"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { assertArbiter } from "@/lib/auth";
import { setTurnWeather, setDetectionStatus, addManualDetection, publishTurn } from "@/lib/turnEngine";

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
