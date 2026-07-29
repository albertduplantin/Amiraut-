import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { prisma } from "@/lib/prisma";
import { centsToEuros } from "@/lib/format";

export default async function AdminInscriptionsPage() {
  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <p className="section muted">
        Configure d&apos;abord le <Link href="/admin/sejour">séjour</Link>.
      </p>
    );
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

  const rows = users.map((user) => {
    const nuits = user.reservationsNuit.length;
    const repas = user.reservationsRepas.length;
    const totalCts = nuits * sejour.prixNuitCts + repas * sejour.prixRepasCts;
    return {
      id: user.id,
      nom: `${user.prenom} ${user.nom}`,
      email: user.email,
      nuits,
      repas,
      jeux: user.inscriptionsJeu.map((i) => i.jeu.nom),
      totalCts,
      regimeAlimentaire: user.regimeAlimentaire,
      contactUrgence:
        user.contactUrgenceNom || user.contactUrgenceTelephone
          ? `${user.contactUrgenceNom ?? ""} ${user.contactUrgenceTelephone ?? ""}`.trim()
          : null,
      colocataireSouhaite: user.colocataireSouhaite,
    };
  });

  const inscrits = rows.filter((r) => r.nuits > 0 || r.repas > 0 || r.jeux.length > 0);
  const totalRevenuCts = rows.reduce((sum, r) => sum + r.totalCts, 0);

  return (
    <div className="section">
      <div className="stats-row">
        <div className="stat">
          <div className="muted">Comptes créés</div>
          <div className="value">{users.length}</div>
        </div>
        <div className="stat">
          <div className="muted">Inscrits (nuit/repas/jeu)</div>
          <div className="value">{inscrits.length}</div>
        </div>
        <div className="stat">
          <div className="muted">Total estimé</div>
          <div className="value">{centsToEuros(totalRevenuCts)}</div>
        </div>
      </div>

      <div className="btn-row section">
        <a className="btn" href="/admin/inscriptions/export">
          Exporter en CSV
        </a>
      </div>

      <div className="table-wrap section">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Email</th>
              <th>Nuitées</th>
              <th>Repas</th>
              <th>Jeux</th>
              <th>Régime / allergies</th>
              <th>Contact urgence</th>
              <th>Colocataire souhaité</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.nom}</td>
                <td>{row.email}</td>
                <td>{row.nuits}</td>
                <td>{row.repas}</td>
                <td>{row.jeux.length ? row.jeux.join(", ") : "—"}</td>
                <td>{row.regimeAlimentaire || "—"}</td>
                <td>{row.contactUrgence || "—"}</td>
                <td>{row.colocataireSouhaite || "—"}</td>
                <td>{centsToEuros(row.totalCts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
