"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, clearSession, hashPassword, verifyPassword } from "@/lib/auth";

const registerSchema = z.object({
  prenom: z.string().trim().min(1, "Le prénom est requis"),
  nom: z.string().trim().min(1, "Le nom est requis"),
  email: z.string().trim().email("Email invalide"),
  password: z.string().min(8, "8 caractères minimum"),
});

export type ActionResult = { error?: string; success?: boolean } | undefined;

export async function registerAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const parsed = registerSchema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Un compte existe déjà avec cet email" };
  }

  const user = await prisma.user.create({
    data: {
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      email,
      password: await hashPassword(parsed.data.password),
    },
  });

  await createSession({ userId: user.id, role: user.role });
  redirect("/mon-espace");
}

const loginSchema = z.object({
  email: z.string().trim().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

export async function loginAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return {
      error: `Trop de tentatives échouées. Réessaie dans ${minutesLeft} minute(s).`,
    };
  }

  const valid = user ? await verifyPassword(parsed.data.password, user.password) : false;

  if (!user || !valid) {
    if (user) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_LOGIN_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
            : null,
        },
      });
    }
    return { error: "Email ou mot de passe incorrect" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  await createSession({ userId: user.id, role: user.role });
  redirect(user.role === "ADMIN" ? "/admin" : "/mon-espace");
}

export async function logoutAction() {
  await clearSession();
  redirect("/");
}
