"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions/auth";

async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (session.role !== "ADMIN") redirect("/");
  return session;
}

function eurosToCents(value: FormDataEntryValue | null) {
  const n = Number(String(value ?? "0").replace(",", "."));
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

const sejourSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis"),
  description: z.string().trim().min(1, "La description est requise"),
  dateDebut: z.string().min(1, "Date de début requise"),
  dateFin: z.string().min(1, "Date de fin requise"),
  infosPratiques: z.string().trim().optional(),
});

export async function upsertSejourAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = sejourSchema.safeParse({
    nom: formData.get("nom"),
    description: formData.get("description"),
    dateDebut: formData.get("dateDebut"),
    dateFin: formData.get("dateFin"),
    infosPratiques: formData.get("infosPratiques"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const dateDebut = new Date(parsed.data.dateDebut);
  const dateFin = new Date(parsed.data.dateFin);
  if (dateFin < dateDebut) {
    return { error: "La date de fin doit être après la date de début" };
  }

  const id = formData.get("id");
  const data = {
    nom: parsed.data.nom,
    description: parsed.data.description,
    dateDebut,
    dateFin,
    prixNuitCts: eurosToCents(formData.get("prixNuit")),
    prixRepasCts: eurosToCents(formData.get("prixRepas")),
    infosPratiques: parsed.data.infosPratiques || null,
  };

  if (typeof id === "string" && id) {
    await prisma.sejour.update({ where: { id }, data });
  } else {
    await prisma.sejour.create({ data });
  }

  revalidatePath("/");
  revalidatePath("/admin/sejour");
  return { error: undefined, success: true };
}

// --- Editos ---

export async function upsertEditoAction(formData: FormData) {
  await requireAdmin();
  const sejourId = String(formData.get("sejourId") ?? "");
  const titre = String(formData.get("titre") ?? "").trim();
  const contenu = String(formData.get("contenu") ?? "").trim();
  const id = formData.get("id");

  if (!sejourId || !titre || !contenu) return;

  if (typeof id === "string" && id) {
    await prisma.edito.update({ where: { id }, data: { titre, contenu } });
  } else {
    const count = await prisma.edito.count({ where: { sejourId } });
    await prisma.edito.create({ data: { sejourId, titre, contenu, ordre: count } });
  }

  revalidatePath("/");
  revalidatePath("/admin/editos");
}

export async function deleteEditoAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.edito.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/admin/editos");
}

// --- Programme ---

export async function upsertProgrammeAction(formData: FormData) {
  await requireAdmin();
  const sejourId = String(formData.get("sejourId") ?? "");
  const date = String(formData.get("date") ?? "");
  const heure = String(formData.get("heure") ?? "").trim();
  const titre = String(formData.get("titre") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const id = formData.get("id");

  if (!sejourId || !date || !titre) return;

  const data = {
    sejourId,
    date: new Date(date),
    heure: heure || null,
    titre,
    description: description || null,
  };

  if (typeof id === "string" && id) {
    await prisma.programmeItem.update({ where: { id }, data });
  } else {
    await prisma.programmeItem.create({ data });
  }

  revalidatePath("/");
  revalidatePath("/admin/programme");
}

export async function deleteProgrammeAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.programmeItem.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/admin/programme");
}

// --- Jeux ---

export async function upsertJeuAction(formData: FormData) {
  await requireAdmin();
  const sejourId = String(formData.get("sejourId") ?? "");
  const nom = String(formData.get("nom") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const debut = String(formData.get("debut") ?? "");
  const dureeMinutes = Number(formData.get("dureeMinutes") ?? 60);
  const placesMax = Number(formData.get("placesMax") ?? 4);
  const id = formData.get("id");

  if (!sejourId || !nom || !debut) return;

  const data = {
    sejourId,
    nom,
    description: description || null,
    debut: new Date(debut),
    dureeMinutes: Number.isFinite(dureeMinutes) ? dureeMinutes : 60,
    placesMax: Number.isFinite(placesMax) ? placesMax : 4,
  };

  if (typeof id === "string" && id) {
    await prisma.jeu.update({ where: { id }, data });
  } else {
    await prisma.jeu.create({ data });
  }

  revalidatePath("/");
  revalidatePath("/admin/jeux");
  revalidatePath("/mon-espace");
}

export async function deleteJeuAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.jeu.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/admin/jeux");
  revalidatePath("/mon-espace");
}

// --- Réinitialisation de mot de passe (sans email) ---

export type ResetPasswordResult = { tempPassword?: string; error?: string } | undefined;

export async function resetPasswordAction(
  _prev: ResetPasswordResult,
  formData: FormData
): Promise<ResetPasswordResult> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Utilisateur introuvable" };

  const tempPassword = randomBytes(6).toString("base64url");

  await prisma.user.update({
    where: { id: userId },
    data: {
      password: await hashPassword(tempPassword),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  return { tempPassword };
}

// --- Galerie photo ---

export async function ajouterPhotoAction(formData: FormData) {
  await requireAdmin();
  const sejourId = String(formData.get("sejourId") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  const legende = String(formData.get("legende") ?? "").trim();

  if (!sejourId || !url) return;

  const count = await prisma.photo.count({ where: { sejourId } });
  await prisma.photo.create({
    data: { sejourId, url, legende: legende || null, ordre: count },
  });

  revalidatePath("/");
  revalidatePath("/admin/galerie");
}

export async function supprimerPhotoAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.photo.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/admin/galerie");
}
