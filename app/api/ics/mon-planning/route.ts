import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getActiveSejour } from "@/lib/sejour";
import { prisma } from "@/lib/prisma";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";

function atTime(date: Date, hours: number, minutes: number) {
  const d = new Date(date);
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  const sejour = await getActiveSejour();
  if (!sejour) {
    return new NextResponse("Aucun séjour configuré", { status: 404 });
  }

  const [nuits, repas, jeux] = await Promise.all([
    prisma.reservationNuit.findMany({
      where: { sejourId: sejour.id, userId: session.userId },
    }),
    prisma.reservationRepas.findMany({
      where: { sejourId: sejour.id, userId: session.userId },
    }),
    prisma.inscriptionJeu.findMany({
      where: { userId: session.userId, jeu: { sejourId: sejour.id } },
      include: { jeu: true },
    }),
  ]);

  const events: IcsEvent[] = [];

  for (const nuit of nuits) {
    const lendemain = new Date(nuit.date);
    lendemain.setUTCDate(lendemain.getUTCDate() + 1);
    events.push({
      uid: `nuit-${nuit.id}@semaines-hexagone`,
      start: atTime(nuit.date, 20, 0),
      end: atTime(lendemain, 10, 0),
      summary: "Nuitée — Les Semaines de l'Hexagone",
      description: "Petit-déjeuner compris.",
    });
  }

  for (const r of repas) {
    const isDejeuner = r.type === "DEJEUNER";
    events.push({
      uid: `repas-${r.id}@semaines-hexagone`,
      start: atTime(r.date, isDejeuner ? 12 : 19, 30),
      end: atTime(r.date, isDejeuner ? 13 : 20, 30),
      summary: isDejeuner ? "Déjeuner" : "Dîner",
    });
  }

  for (const i of jeux) {
    const start = i.jeu.debut;
    const end = new Date(start.getTime() + i.jeu.dureeMinutes * 60 * 1000);
    events.push({
      uid: `jeu-${i.id}@semaines-hexagone`,
      start,
      end,
      summary: i.jeu.nom,
      description: i.jeu.description ?? undefined,
    });
  }

  const ics = buildIcsCalendar(`${sejour.nom} — Mon planning`, events);

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="mon-planning.ics"`,
    },
  });
}
