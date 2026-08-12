import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CommsClient } from "./CommsClient";

export default async function CommsPage() {
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  const openTurn = await prisma.turn.findFirst({
    where: { scenarioId: session.scenarioId, status: "PENDING_ORDERS" },
    orderBy: { number: "desc" },
  });

  const [units, signals] = await Promise.all([
    prisma.unit.findMany({
      where: {
        scenarioId: session.scenarioId,
        status: { in: ["ACTIVE", "DAMAGED"] },
        fleet: { teamId: session.teamId, ...(session.fleetIds ? { id: { in: session.fleetIds } } : {}) },
      },
      select: { id: true, name: true, unitClass: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.signal.findMany({
      where: { teamId: session.teamId },
      include: { senderUnit: { select: { name: true } }, turn: { select: { number: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <CommsClient
      turn={openTurn && openTurn.weatherId ? { id: openTurn.id, number: openTurn.number } : null}
      units={units.map((u) => ({ id: u.id, name: u.name, className: u.unitClass.name }))}
      signals={signals.map((s) => ({
        id: s.id,
        turnNumber: s.turn.number,
        senderName: s.senderUnit.name,
        channel: s.channel,
        kurzsignalType: s.kurzsignalType,
        body: s.body,
        intercepted: s.intercepted,
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  );
}
