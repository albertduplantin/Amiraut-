import { NextResponse } from "next/server";
import { getActiveSejour } from "@/lib/sejour";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";

export async function GET() {
  const sejour = await getActiveSejour();
  if (!sejour) {
    return new NextResponse("Aucun séjour configuré", { status: 404 });
  }

  const events: IcsEvent[] = sejour.programme.map((item) => {
    const start = new Date(item.date);
    if (item.heure) {
      const [h, m] = item.heure.split(":").map(Number);
      start.setUTCHours(h, m, 0, 0);
    } else {
      start.setUTCHours(9, 0, 0, 0);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    return {
      uid: `programme-${item.id}@semaines-hexagone`,
      start,
      end,
      summary: item.titre,
      description: item.description ?? undefined,
    };
  });

  const ics = buildIcsCalendar(`${sejour.nom} — Programme`, events);

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="programme.ics"`,
    },
  });
}
