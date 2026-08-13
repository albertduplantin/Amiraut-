"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertArbiter, AccessDeniedError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LibraryUnitClassSchema } from "../../../prisma/scenarios/validation";

export type SaveLibraryClassResult = { ok: true; id: string } | { ok: false; error: string };

/** Enregistre une nouvelle classe dans la bibliothèque partagée (navires + avions) — voir /library. */
export async function createLibraryClassAction(input: unknown): Promise<SaveLibraryClassResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }

  const parsed = LibraryUnitClassSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") };
  }
  const data = parsed.data;

  const existing = await prisma.libraryUnitClass.findUnique({ where: { key: data.key } });
  if (existing) {
    return { ok: false, error: `La clé « ${data.key} » est déjà utilisée dans la bibliothèque — choisissez-en une autre.` };
  }

  const created = await prisma.libraryUnitClass.create({
    data: {
      key: data.key,
      name: data.name,
      nation: data.nation,
      category: data.category,
      maxSpeedKnots: data.maxSpeedKnots,
      lengthMeters: data.lengthMeters,
      beamMeters: data.beamMeters,
      turningRadiusM: data.turningRadiusM,
      accelerationKnotsPerMin: data.accelerationKnotsPerMin,
      agility: data.agility,
      sensors: data.sensors,
      detectability: data.detectability ?? 1,
      iconKey: data.iconKey,
      profileImageUrl: data.profileImageUrl,
      historicalNote: data.historicalNote,
      resistancePoints: data.resistancePoints,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      combatProfile: (data.combatProfile as any) ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      weaponSystems: (data.weaponSystems as any) ?? undefined,
      depthChargeStock: data.depthChargeStock,
      submergedRangeNmAt4kt: data.submergedRangeNmAt4kt,
      oxygenEnduranceHours: data.oxygenEnduranceHours,
      torpedoStock: data.torpedoStock,
      enduranceMinutes: data.enduranceMinutes,
      passive: data.passive ?? false,
      theater: data.theater,
    },
  });

  revalidatePath("/library");
  return { ok: true, id: created.id };
}

/** Modifie une classe existante de la bibliothèque. */
export async function updateLibraryClassAction(id: string, input: unknown): Promise<SaveLibraryClassResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }

  const parsed = LibraryUnitClassSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") };
  }
  const data = parsed.data;

  const existingWithKey = await prisma.libraryUnitClass.findUnique({ where: { key: data.key } });
  if (existingWithKey && existingWithKey.id !== id) {
    return { ok: false, error: `La clé « ${data.key} » est déjà utilisée par une autre classe — choisissez-en une autre.` };
  }

  await prisma.libraryUnitClass.update({
    where: { id },
    data: {
      key: data.key,
      name: data.name,
      nation: data.nation,
      category: data.category,
      maxSpeedKnots: data.maxSpeedKnots,
      lengthMeters: data.lengthMeters,
      beamMeters: data.beamMeters,
      turningRadiusM: data.turningRadiusM,
      accelerationKnotsPerMin: data.accelerationKnotsPerMin,
      agility: data.agility,
      sensors: data.sensors,
      detectability: data.detectability ?? 1,
      iconKey: data.iconKey,
      profileImageUrl: data.profileImageUrl,
      historicalNote: data.historicalNote,
      resistancePoints: data.resistancePoints,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      combatProfile: (data.combatProfile as any) ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      weaponSystems: (data.weaponSystems as any) ?? undefined,
      depthChargeStock: data.depthChargeStock,
      submergedRangeNmAt4kt: data.submergedRangeNmAt4kt,
      oxygenEnduranceHours: data.oxygenEnduranceHours,
      torpedoStock: data.torpedoStock,
      enduranceMinutes: data.enduranceMinutes,
      passive: data.passive ?? false,
      theater: data.theater,
    },
  });

  revalidatePath("/library");
  return { ok: true, id };
}

export async function deleteLibraryClassAction(id: string) {
  const session = await getSession();
  assertArbiter(session);
  await prisma.libraryUnitClass.delete({ where: { id } });
  revalidatePath("/library");
  redirect("/library");
}
