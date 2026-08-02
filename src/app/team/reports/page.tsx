import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ReportsClient } from "./ReportsClient";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  const [scenario, reports] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.report.findMany({
      where: { teamId: session.teamId },
      include: { turn: { select: { number: true, gameStartAt: true } } },
      orderBy: { turn: { number: "desc" } },
    }),
  ]);

  if (reports.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Aucun rapport publié pour l&apos;instant.
      </div>
    );
  }

  return (
    <ReportsClient
      mapCenter={{ lat: scenario.mapCenterLat, lng: scenario.mapCenterLng }}
      mapZoom={scenario.mapDefaultZoom}
      reports={reports.map((r) => ({
        turnNumber: r.turn.number,
        gameStartAt: r.turn.gameStartAt.toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ownUnits: r.ownUnits as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contacts: r.contacts as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combats: (r.combats ?? []) as any,
        narrative: r.narrative,
      }))}
    />
  );
}
