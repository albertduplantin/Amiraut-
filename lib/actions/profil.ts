"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions/auth";

export async function updateProfilAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) redirect("/connexion");

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      regimeAlimentaire: String(formData.get("regimeAlimentaire") ?? "").trim() || null,
      contactUrgenceNom: String(formData.get("contactUrgenceNom") ?? "").trim() || null,
      contactUrgenceTelephone:
        String(formData.get("contactUrgenceTelephone") ?? "").trim() || null,
      colocataireSouhaite: String(formData.get("colocataireSouhaite") ?? "").trim() || null,
    },
  });

  revalidatePath("/mon-espace");
  return { error: undefined, success: true };
}
