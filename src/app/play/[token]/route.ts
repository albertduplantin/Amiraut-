import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setSessionCookie } from "@/lib/session";

export async function GET(_req: Request, ctx: RouteContext<"/play/[token]">) {
  const { token } = await ctx.params;

  const participant = await prisma.participant.findUnique({ where: { token } });
  if (!participant) {
    redirect("/?error=invite-invalide");
  }

  await setSessionCookie(token);
  await prisma.participant.update({ where: { token }, data: { lastSeenAt: new Date() } });

  redirect(participant.role === "ARBITER" ? "/arbiter" : "/team/orders");
}
