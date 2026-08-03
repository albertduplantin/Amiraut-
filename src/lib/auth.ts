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

/** Vérifie que le joueur en session a le droit de donner des ordres à toute cette flotte. */
export async function assertCanOrderFleet(session: Session & { teamId: string }, fleetId: string) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId }, select: { teamId: true } });
  if (!fleet) throw new AccessDeniedError("Flotte introuvable.");
  if (fleet.teamId !== session.teamId) {
    throw new AccessDeniedError("Cette flotte n'appartient pas à votre équipe.");
  }
  if (session.fleetIds && !session.fleetIds.includes(fleetId)) {
    throw new AccessDeniedError("Cette flotte n'est pas dans votre périmètre.");
  }
}

/**
 * Vérifie que le joueur en session a le droit de voir cette détection.
 * Seule l'équipe observatrice y a accès (même règle que la génération des
 * contacts de rapport) : une équipe ne doit jamais apprendre par ce biais
 * qu'elle a elle-même été repérée — ce serait une fuite du brouillard de
 * guerre.
 */
export async function assertCanViewDetection(session: Session & { teamId: string }, detectionEventId: string) {
  const detection = await prisma.detectionEvent.findUnique({
    where: { id: detectionEventId },
    select: { observerUnit: { select: { fleet: { select: { teamId: true } } } } },
  });
  if (!detection) throw new AccessDeniedError("Détection introuvable.");
  if (detection.observerUnit.fleet.teamId !== session.teamId) {
    throw new AccessDeniedError("Cette détection n'appartient pas à votre équipe.");
  }
}

/**
 * Vérifie qu'un joueur peut engager cette cible avec cette unité : l'unité
 * doit être la sienne, et la cible doit avoir été repérée par son camp
 * (n'importe laquelle de ses unités — les contacts se partagent par radio).
 * Interdit donc de tirer sur une unité dont on ignore l'existence.
 */
export async function assertCanFireAt(
  session: Session & { teamId: string },
  attackerUnitId: string,
  targetUnitId: string
) {
  await assertCanOrderUnit(session, attackerUnitId);

  const contact = await prisma.detectionEvent.findFirst({
    where: {
      targetUnitId,
      observerUnit: { fleet: { teamId: session.teamId } },
      arbiterStatus: { in: ["CONFIRMED", "ADDED_MANUALLY"] },
    },
  });
  if (!contact) {
    throw new AccessDeniedError("Cette cible n'a été repérée par aucune de vos unités.");
  }
}
