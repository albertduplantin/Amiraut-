"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions/auth";

async function requireParticipant() {
  const session = await getSession();
  if (!session) redirect("/connexion");
  return session;
}

export async function saveReservationsAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await requireParticipant();
  const sejourId = formData.get("sejourId");
  if (typeof sejourId !== "string" || !sejourId) {
    return { error: "Séjour introuvable" };
  }

  const nuitDates: Date[] = [];
  const repas: { date: Date; type: "DEJEUNER" | "DINER" }[] = [];

  for (const [key, value] of formData.entries()) {
    if (value !== "on") continue;
    if (key.startsWith("nuit_")) {
      nuitDates.push(new Date(key.slice("nuit_".length)));
    } else if (key.startsWith("repas_dejeuner_")) {
      repas.push({ date: new Date(key.slice("repas_dejeuner_".length)), type: "DEJEUNER" });
    } else if (key.startsWith("repas_diner_")) {
      repas.push({ date: new Date(key.slice("repas_diner_".length)), type: "DINER" });
    }
  }

  await prisma.$transaction([
    prisma.reservationNuit.deleteMany({
      where: { sejourId, userId: session.userId },
    }),
    prisma.reservationRepas.deleteMany({
      where: { sejourId, userId: session.userId },
    }),
    ...(nuitDates.length
      ? [
          prisma.reservationNuit.createMany({
            data: nuitDates.map((date) => ({ sejourId, userId: session.userId, date })),
          }),
        ]
      : []),
    ...(repas.length
      ? [
          prisma.reservationRepas.createMany({
            data: repas.map((r) => ({
              sejourId,
              userId: session.userId,
              date: r.date,
              type: r.type,
            })),
          }),
        ]
      : []),
  ]);

  revalidatePath("/mon-espace");
  return { error: undefined, success: true };
}

export async function inscrireJeuAction(formData: FormData) {
  const session = await requireParticipant();
  const jeuId = formData.get("jeuId");
  if (typeof jeuId !== "string" || !jeuId) return;

  await prisma.$transaction(async (tx) => {
    const jeu = await tx.jeu.findUnique({
      where: { id: jeuId },
      include: { _count: { select: { inscriptions: true } } },
    });
    if (!jeu) return;

    const dejaInscrit = await tx.inscriptionJeu.findUnique({
      where: { jeuId_userId: { jeuId, userId: session.userId } },
    });
    if (dejaInscrit) return;

    if (jeu._count.inscriptions < jeu.placesMax) {
      await tx.inscriptionJeu.create({ data: { jeuId, userId: session.userId } });
      await tx.jeuWaitlist.deleteMany({ where: { jeuId, userId: session.userId } });
    } else {
      await tx.jeuWaitlist.upsert({
        where: { jeuId_userId: { jeuId, userId: session.userId } },
        create: { jeuId, userId: session.userId },
        update: {},
      });
    }
  });

  revalidatePath("/mon-espace");
  revalidatePath("/");
}

export async function quitterJeuAction(formData: FormData) {
  const session = await requireParticipant();
  const jeuId = formData.get("jeuId");
  if (typeof jeuId !== "string" || !jeuId) return;

  await prisma.$transaction(async (tx) => {
    const confirmee = await tx.inscriptionJeu.findUnique({
      where: { jeuId_userId: { jeuId, userId: session.userId } },
    });

    if (confirmee) {
      await tx.inscriptionJeu.delete({ where: { id: confirmee.id } });

      // Promotion automatique du premier de la liste d'attente
      const suivant = await tx.jeuWaitlist.findFirst({
        where: { jeuId },
        orderBy: { createdAt: "asc" },
      });
      if (suivant) {
        await tx.jeuWaitlist.delete({ where: { id: suivant.id } });
        await tx.inscriptionJeu.create({
          data: { jeuId, userId: suivant.userId },
        });
      }
    } else {
      await tx.jeuWaitlist.deleteMany({ where: { jeuId, userId: session.userId } });
    }
  });

  revalidatePath("/mon-espace");
  revalidatePath("/");
}
