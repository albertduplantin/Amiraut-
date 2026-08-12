import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { assertPlayer, assertCanViewDetection } from "@/lib/auth";
import { openOrJoinEngagementForDetection } from "@/lib/tacticalEngine";

/**
 * Point d'entrée sans interface : ouvre (ou rejoint) le combat tactique sur
 * ce contact, puis redirige vers la salle de bataille. Séparé en route
 * dédiée pour que le lien « Mode tactique » reste un simple clic, sans
 * étape de confirmation intermédiaire.
 */
export default async function OpenBattlePage({ params }: { params: Promise<{ detectionId: string }> }) {
  const { detectionId } = await params;
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  // `redirect()` lève une exception interne Next.js : elle ne doit surtout
  // pas être interceptée par le catch ci-dessous, sinon la redirection de
  // succès finirait elle-même renvoyée vers /team/orders.
  let engagementId: string | null = null;
  try {
    assertPlayer(session);
    await assertCanViewDetection(session, detectionId);
    const engagement = await openOrJoinEngagementForDetection(detectionId);
    engagementId = engagement.id;
  } catch {
    redirect("/team/orders");
  }
  redirect(`/team/battle/${engagementId}`);
}
