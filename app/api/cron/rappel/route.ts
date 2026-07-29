import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveSejour } from "@/lib/sejour";
import { sendEmail, rappelSejourEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/url";
import { dateKey, formatDateShort } from "@/lib/format";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const sejour = await getActiveSejour();
  if (!sejour) {
    return NextResponse.json({ ok: true, message: "Aucun séjour actif" });
  }

  const dansSeptJours = new Date();
  dansSeptJours.setUTCDate(dansSeptJours.getUTCDate() + 7);

  if (dateKey(sejour.dateDebut) !== dateKey(dansSeptJours)) {
    return NextResponse.json({ ok: true, message: "Pas de rappel dû aujourd'hui" });
  }

  const [nuits, repas, jeux] = await Promise.all([
    prisma.reservationNuit.findMany({
      where: { sejourId: sejour.id },
      select: { userId: true },
    }),
    prisma.reservationRepas.findMany({
      where: { sejourId: sejour.id },
      select: { userId: true },
    }),
    prisma.inscriptionJeu.findMany({
      where: { jeu: { sejourId: sejour.id } },
      select: { userId: true },
    }),
  ]);

  const userIds = [
    ...new Set([...nuits, ...repas, ...jeux].map((r) => r.userId)),
  ];

  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });

  for (const user of users) {
    await sendEmail({
      to: user.email,
      subject: `${sejour.nom} commence dans une semaine !`,
      html: rappelSejourEmail({
        prenom: user.prenom,
        sejourNom: sejour.nom,
        dateDebutFormatted: formatDateShort(sejour.dateDebut),
        lienEspace: `${getBaseUrl()}/mon-espace`,
      }),
    });
  }

  return NextResponse.json({ ok: true, notified: users.length });
}
