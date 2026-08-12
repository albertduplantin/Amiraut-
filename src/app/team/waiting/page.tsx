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
    <div className="chart-room-bg flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center text-slate-100">
      <h1 className="font-display text-2xl tracking-wide text-brass-300">En attente</h1>
      <p className="max-w-md text-slate-400">
        {currentTurn?.status === "PENDING_ARBITER_REVIEW" || currentTurn?.status === "RESOLVING"
          ? "Tous les ordres ont été soumis. L'arbitre est en train de résoudre les détections du tour."
          : "L'arbitre n'a pas encore ouvert les ordres de ce tour (météo à définir)."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {latestPublished && (
          <Link href="/team/reports" className="rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
            Voir le dernier rapport de renseignement (tour {latestPublished.number})
          </Link>
        )}
        <Link href="/team/comms" className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-900">
          📡 Communications
        </Link>
      </div>
    </div>
  );
}
