import "server-only";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/session";

export class AccessDeniedError extends Error {}

export function assertArbiter(session: Session | null): asserts session is Session {
  if (!session || session.role !== "ARBITER") {
    throw new AccessDeniedError("Action réservée à l'arbitre.");
  }
}

export function assertPlayer(
  session: Session | null
): asserts session is Session & { teamId: string } {
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    throw new AccessDeniedError("Action réservée à un joueur affecté à une équipe.");
  }
}

/** Vérifie que le joueur en session a le droit de donner des ordres à cette unité. */
export async function assertCanOrderUnit(session: Session & { teamId: string }, unitId: string) {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    select: { fleetId: true, fleet: { select: { teamId: true } } },
  });
  if (!unit) throw new AccessDeniedError("Unité introuvable.");
  if (unit.fleet.teamId !== session.teamId) {
    throw new AccessDeniedError("Cette unité n'appartient pas à votre équipe.");
  }
  if (session.fleetIds && !session.fleetIds.includes(unit.fleetId)) {
    throw new AccessDeniedError("Cette flotte n'est pas dans votre périmètre.");
  }
}
