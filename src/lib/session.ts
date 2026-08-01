import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { ParticipantRole } from "@/generated/prisma/client";

export const SESSION_COOKIE_NAME = "amiraute_token";

export type Session = {
  participantId: string;
  role: ParticipantRole;
  scenarioId: string;
  teamId: string | null;
  /** null = toutes les flottes de l'équipe (scopeAllFleetsInTeam) */
  fleetIds: string[] | null;
  displayName: string;
};

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const participant = await prisma.participant.findUnique({
    where: { token },
    include: { fleetScopes: true },
  });
  if (!participant) return null;

  return {
    participantId: participant.id,
    role: participant.role,
    scenarioId: participant.scenarioId,
    teamId: participant.teamId,
    fleetIds: participant.scopeAllFleetsInTeam ? null : participant.fleetScopes.map((s) => s.fleetId),
    displayName: participant.displayName,
  };
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
