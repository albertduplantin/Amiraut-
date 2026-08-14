"use server";

import { revalidatePath } from "next/cache";
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
      pilotSkill: data.pilotSkill,
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
      hedgehogStock: data.hedgehogStock,
      submergedRangeNmAt4kt: data.submergedRangeNmAt4kt,
      oxygenEnduranceHours: data.oxygenEnduranceHours,
      torpedoStock: data.torpedoStock,
      emergencyDiveSeconds: data.emergencyDiveSeconds,
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
      pilotSkill: data.pilotSkill,
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
      hedgehogStock: data.hedgehogStock,
      submergedRangeNmAt4kt: data.submergedRangeNmAt4kt,
      oxygenEnduranceHours: data.oxygenEnduranceHours,
      torpedoStock: data.torpedoStock,
      emergencyDiveSeconds: data.emergencyDiveSeconds,
      enduranceMinutes: data.enduranceMinutes,
      passive: data.passive ?? false,
      theater: data.theater,
    },
  });

  revalidatePath("/library");
  return { ok: true, id };
}

export type DeleteLibraryClassResult = { ok: true } | { ok: false; error: string };

/**
 * Supprime une classe de la bibliothèque — garde-fou ajouté le 2026-08-14
 * (retour utilisateur, chantier constructeur de scénario visuel) : le
 * constructeur fait de `{key, libraryKey}` le chemin d'autorat PAR DÉFAUT
 * (glisser une classe depuis la bibliothèque), donc supprimer une classe
 * encore référencée par un scénario enregistré (`CustomScenario`) casserait
 * silencieusement ce scénario au prochain lancement — `instantiateScenario`
 * lèverait "Classe de bibliothèque introuvable" bien après coup, sans lien
 * évident avec cette suppression. Les scénarios INTÉGRÉS (fichiers TS,
 * `prisma/scenarios/*.ts`) ne sont jamais concernés : ils ne référencent
 * jamais la bibliothèque partagée par ce même mécanisme au moment de la
 * suppression (relecture à chaque déploiement, pas en base).
 */
export async function deleteLibraryClassAction(id: string): Promise<DeleteLibraryClassResult> {
  const session = await getSession();
  try {
    assertArbiter(session);
  } catch (error) {
    if (error instanceof AccessDeniedError) return { ok: false, error: error.message };
    throw error;
  }

  const target = await prisma.libraryUnitClass.findUnique({ where: { id }, select: { key: true } });
  if (!target) return { ok: false, error: "Classe introuvable." };

  const customScenarios = await prisma.customScenario.findMany({ select: { name: true, definition: true } });
  const referencedBy: string[] = [];
  for (const s of customScenarios) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unitClasses = (s.definition as any)?.unitClasses;
    if (!Array.isArray(unitClasses)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (unitClasses.some((uc: any) => uc?.libraryKey === target.key)) referencedBy.push(s.name);
  }
  if (referencedBy.length > 0) {
    return {
      ok: false,
      error: `Cette classe est utilisée par ${referencedBy.length === 1 ? "le scénario" : "les scénarios"} « ${referencedBy.join(" », « ")} » — retirez-la de ${referencedBy.length === 1 ? "ce scénario" : "ces scénarios"} avant de la supprimer.`,
    };
  }

  await prisma.libraryUnitClass.delete({ where: { id } });
  revalidatePath("/library");
  return { ok: true };
}
