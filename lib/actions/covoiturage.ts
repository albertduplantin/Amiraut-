"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

async function requireParticipant() {
  const session = await getSession();
  if (!session) redirect("/connexion");
  return session;
}

export async function creerAnnonceCovoiturageAction(formData: FormData) {
  const session = await requireParticipant();
  const sejourId = String(formData.get("sejourId") ?? "");
  const type = String(formData.get("type") ?? "");
  const lieu = String(formData.get("lieu") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();

  if (!sejourId || (type !== "PROPOSE" && type !== "RECHERCHE") || !lieu) return;

  await prisma.covoiturageAnnonce.create({
    data: {
      sejourId,
      userId: session.userId,
      type,
      lieu,
      message: message || null,
    },
  });

  revalidatePath("/mon-espace");
}

export async function supprimerAnnonceCovoiturageAction(formData: FormData) {
  const session = await requireParticipant();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.covoiturageAnnonce.deleteMany({
    where: { id, userId: session.userId },
  });

  revalidatePath("/mon-espace");
}
