import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection } from "@/lib/auth";
import { openOrJoinEngagementForDetection } from "@/lib/tacticalEngine";

/**
 * Point d'entrée sans interface : ouvre (ou rejoint) le combat rapproché sur
 * ce contact, puis renvoie vers /team/orders — qui bascule automatiquement
 * en vue tactique dès qu'un engagement est actif pour l'équipe. Séparé en
 * route dédiée pour que le lien « Engager » reste un simple clic, sans
 * étape de confirmation intermédiaire.
 */
export default async function OpenBattlePage({ params }: { params: Promise<{ detectionId: string }> }) {
  const { detectionId } = await params;
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  try {
    assertPlayer(session);
    await assertCanViewDetection(session, detectionId);
    await openOrJoinEngagementForDetection(detectionId);
  } catch {
    // `redirect()` lève une exception interne Next.js qu'il ne faut pas
    // avaler ici — mais dans tous les cas (succès ou échec), la destination
    // est la même page, qui réévaluera l'état à jour.
  }
  redirect("/team/orders");
}
