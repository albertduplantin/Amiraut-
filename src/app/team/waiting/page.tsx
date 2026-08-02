import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function WaitingPage() {
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  const [openTurn, latestPublished, currentTurn] = await Promise.all([
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId, status: "PENDING_ORDERS" },
      orderBy: { number: "desc" },
    }),
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId, status: "PUBLISHED" },
      orderBy: { number: "desc" },
    }),
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId },
      orderBy: { number: "desc" },
    }),
  ]);
  if (openTurn?.weatherId) {
    redirect("/team/orders");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-100">
      <h1 className="text-2xl font-semibold">En attente</h1>
      <p className="max-w-md text-slate-400">
        {currentTurn?.status === "PENDING_ARBITER_REVIEW" || currentTurn?.status === "RESOLVING"
          ? "Tous les ordres ont été soumis. L'arbitre est en train de résoudre les détections du tour."
          : "L'arbitre n'a pas encore ouvert les ordres de ce tour (météo à définir)."}
      </p>
      {latestPublished && (
        <Link href="/team/reports" className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500">
          Voir le dernier rapport de renseignement (tour {latestPublished.number})
        </Link>
      )}
    </div>
  );
}
