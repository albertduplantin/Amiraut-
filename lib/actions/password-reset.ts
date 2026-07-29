"use server";

import { randomBytes, createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, hashPassword } from "@/lib/auth";
import { sendEmail, reinitialisationMotDePasseEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import type { ActionResult } from "@/lib/actions/auth";

const RESET_TOKEN_DURATION_MINUTES = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordResetAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const parsed = z.string().trim().email().safeParse(formData.get("email"));
  const generic = {
    error: undefined,
    success: true,
  };

  if (!parsed.success) return generic;

  const email = parsed.data.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_DURATION_MINUTES * 60 * 1000),
      },
    });

    await sendEmail({
      to: user.email,
      subject: "Réinitialise ton mot de passe",
      html: reinitialisationMotDePasseEmail({
        prenom: user.prenom,
        lienReinitialisation: `${getBaseUrl()}/reinitialiser-mot-de-passe/${token}`,
      }),
    });
  }

  // Réponse générique dans tous les cas, pour ne pas révéler si l'email existe.
  return generic;
}

const newPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "8 caractères minimum"),
});

export async function resetPasswordWithTokenAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const parsed = newPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const tokenHash = hashToken(parsed.data.token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (
    !resetToken ||
    resetToken.usedAt ||
    resetToken.expiresAt < new Date()
  ) {
    return { error: "Ce lien est invalide ou a expiré. Refais une demande." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        password: await hashPassword(parsed.data.password),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: resetToken.userId } });
  await createSession({ userId: user.id, role: user.role });
  redirect(user.role === "ADMIN" ? "/admin" : "/mon-espace");
}
