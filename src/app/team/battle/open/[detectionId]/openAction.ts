"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection } from "@/lib/auth";
import { openOrJoinEngagementForDetection } from "@/lib/tacticalEngine";

/** Bascule vers l'engagement tactique complet, depuis l'écran de choix (voir ChooseEngagementMode.tsx). */
export async function openTacticalEngagementAction(params: { detectionId: string }) {
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }
  try {
    assertPlayer(session);
    await assertCanViewDetection(session, params.detectionId);
    await openOrJoinEngagementForDetection(params.detectionId);
  } catch {
    // Dans tous les cas (succès ou échec), la destination est la même page.
  }
  redirect("/team/orders");
}
