import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getActiveSejour } from "@/lib/sejour";
import { prisma } from "@/lib/prisma";
import { centsToEuros } from "@/lib/format";

function csvEscape(value: string) {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new NextResponse("Non autorisé", { status: 403 });
  }

  const sejour = await getActiveSejour();
  if (!sejour) {
    return new NextResponse("Aucun séjour configuré", { status: 404 });
  }

  const users = await prisma.user.findMany({
    where: { role: "PARTICIPANT" },
    include: {
      reservationsNuit: { where: { sejourId: sejour.id } },
      reservationsRepas: { where: { sejourId: sejour.id } },
      inscriptionsJeu: {
        where: { jeu: { sejourId: sejour.id } },
        include: { jeu: true },
      },
    },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
  });

  const header = [
    "Prénom",
    "Nom",
    "Email",
    "Nuitées",
    "Repas",
    "Jeux",
    "Régime / allergies",
    "Contact urgence",
    "Colocataire souhaité",
    "Total",
  ];
  const lines = [header.join(";")];

  for (const user of users) {
    const nuits = user.reservationsNuit.length;
    const repas = user.reservationsRepas.length;
    const totalCts = nuits * sejour.prixNuitCts + repas * sejour.prixRepasCts;
    const jeux = user.inscriptionsJeu.map((i) => i.jeu.nom).join(", ");
    const contactUrgence = `${user.contactUrgenceNom ?? ""} ${
      user.contactUrgenceTelephone ?? ""
    }`.trim();

    lines.push(
      [
        csvEscape(user.prenom),
        csvEscape(user.nom),
        csvEscape(user.email),
        String(nuits),
        String(repas),
        csvEscape(jeux),
        csvEscape(user.regimeAlimentaire ?? ""),
        csvEscape(contactUrgence),
        csvEscape(user.colocataireSouhaite ?? ""),
        csvEscape(centsToEuros(totalCts)),
      ].join(";")
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inscriptions-${sejour.id}.csv"`,
    },
  });
}
