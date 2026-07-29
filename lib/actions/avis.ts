"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function laisserAvisAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/connexion");

  const jeuId = String(formData.get("jeuId") ?? "");
  const note = Number(formData.get("note") ?? 0);
  const commentaire = String(formData.get("commentaire") ?? "").trim();

  if (!jeuId || note < 1 || note > 5) return;

  const jeu = await prisma.jeu.findUnique({ where: { id: jeuId } });
  if (!jeu || jeu.debut > new Date()) return;

  const etaitInscrit = await prisma.inscriptionJeu.findUnique({
    where: { jeuId_userId: { jeuId, userId: session.userId } },
  });
  if (!etaitInscrit) return;

  await prisma.avisJeu.upsert({
    where: { jeuId_userId: { jeuId, userId: session.userId } },
    create: { jeuId, userId: session.userId, note, commentaire: commentaire || null },
    update: { note, commentaire: commentaire || null },
  });

  revalidatePath("/mon-espace");
  revalidatePath("/");
  revalidatePath("/admin/jeux");
}
