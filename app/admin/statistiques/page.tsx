import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { prisma } from "@/lib/prisma";
import { daysBetween, dateKey, formatDateShort } from "@/lib/format";

export default async function AdminStatistiquesPage() {
  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <p className="section muted">
        Configure d&apos;abord le <Link href="/admin/sejour">séjour</Link>.
      </p>
    );
  }

  const [reservationsNuit, reservationsRepas] = await Promise.all([
    prisma.reservationNuit.findMany({ where: { sejourId: sejour.id } }),
    prisma.reservationRepas.findMany({ where: { sejourId: sejour.id } }),
  ]);

  const days = daysBetween(sejour.dateDebut, sejour.dateFin);

  const nuitsParJour = new Map<string, number>();
  for (const r of reservationsNuit) {
    const key = dateKey(r.date);
    nuitsParJour.set(key, (nuitsParJour.get(key) ?? 0) + 1);
  }

  const repasParJour = new Map<string, { dejeuner: number; diner: number }>();
  for (const r of reservationsRepas) {
    const key = dateKey(r.date);
    if (!repasParJour.has(key)) repasParJour.set(key, { dejeuner: 0, diner: 0 });
    const entry = repasParJour.get(key)!;
    if (r.type === "DEJEUNER") entry.dejeuner += 1;
    else entry.diner += 1;
  }

  const rows = days.map((day, idx) => {
    const key = dateKey(day);
    const veille = new Date(day);
    veille.setUTCDate(veille.getUTCDate() - 1);
    const petitDej = nuitsParJour.get(dateKey(veille)) ?? 0;
    const repas = repasParJour.get(key) ?? { dejeuner: 0, diner: 0 };
    const isLast = idx === days.length - 1;
    const nuitees = isLast ? null : (nuitsParJour.get(key) ?? 0);

    return {
      key,
      label: formatDateShort(day),
      petitDej,
      dejeuner: repas.dejeuner,
      diner: repas.diner,
      nuitees,
    };
  });

  const maxValue = Math.max(
    1,
    ...rows.flatMap((r) => [r.petitDej, r.dejeuner, r.diner, r.nuitees ?? 0])
  );

  return (
    <div className="section">
      <h2>Occupation et repas par jour</h2>
      <p className="muted">Sert de base pour anticiper les courses et les couverts.</p>

      <div className="table-wrap section">
        <table>
          <thead>
            <tr>
              <th>Jour</th>
              <th>Petits-déj</th>
              <th>Déjeuners</th>
              <th>Dîners</th>
              <th>Nuitées</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.petitDej}</td>
                <td>{row.dejeuner}</td>
                <td>{row.diner}</td>
                <td>{row.nuitees === null ? "—" : row.nuitees}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Vue graphique (repas par jour)</h2>
      <div className="card section">
        <div className="card-list">
          {rows.map((row) => (
            <div key={row.key}>
              <div className="muted" style={{ marginBottom: 4 }}>
                {row.label}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 40 }}>
                <div
                  title={`${row.petitDej} petits-déj`}
                  style={{
                    width: `${(row.petitDej / maxValue) * 100}%`,
                    background: "var(--accent)",
                    height: 12,
                    borderRadius: 4,
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 16 }}>
                <div
                  title={`${row.dejeuner} déjeuners`}
                  style={{
                    width: `${(row.dejeuner / maxValue) * 100}%`,
                    background: "var(--primary)",
                    height: 12,
                    borderRadius: 4,
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 16 }}>
                <div
                  title={`${row.diner} dîners`}
                  style={{
                    width: `${(row.diner / maxValue) * 100}%`,
                    background: "var(--primary-dark)",
                    height: 12,
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="muted section">
          <span style={{ color: "var(--accent)" }}>■</span> petits-déj ·{" "}
          <span style={{ color: "var(--primary)" }}>■</span> déjeuners ·{" "}
          <span style={{ color: "var(--primary-dark)" }}>■</span> dîners
        </p>
      </div>

      <h2 className="section">Remplissage des jeux</h2>
      <div className="table-wrap section">
        <table>
          <thead>
            <tr>
              <th>Jeu</th>
              <th>Inscrits</th>
              <th>Places max</th>
              <th>Liste d&apos;attente</th>
              <th>Remplissage</th>
            </tr>
          </thead>
          <tbody>
            {sejour.jeux.map((jeu) => {
              const taux = Math.round((jeu.inscriptions.length / jeu.placesMax) * 100);
              return (
                <tr key={jeu.id}>
                  <td>{jeu.nom}</td>
                  <td>{jeu.inscriptions.length}</td>
                  <td>{jeu.placesMax}</td>
                  <td>{jeu.waitlist.length}</td>
                  <td>{taux}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
