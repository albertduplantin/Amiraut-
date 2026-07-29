import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveSejour } from "@/lib/sejour";
import { daysBetween, dateKey, formatDateLong, formatDateShort } from "@/lib/format";
import { InscriptionForm } from "./inscription-form";
import { inscrireJeuAction, quitterJeuAction } from "@/lib/actions/inscription";

const jeuHeureFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

type PlanningEntry = {
  key: string;
  date: Date;
  sortMinutes: number;
  label: string;
  detail?: string;
};

export default async function MonEspacePage() {
  const session = await getSession();
  if (!session) redirect("/connexion");
  if (session.role === "ADMIN") redirect("/admin");

  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <div className="container">
        <h1>Mon espace</h1>
        <p className="muted section">Aucun séjour n&apos;est configuré pour le moment.</p>
      </div>
    );
  }

  const [reservationsNuit, reservationsRepas] = await Promise.all([
    prisma.reservationNuit.findMany({
      where: { sejourId: sejour.id, userId: session.userId },
    }),
    prisma.reservationRepas.findMany({
      where: { sejourId: sejour.id, userId: session.userId },
    }),
  ]);

  const days = daysBetween(sejour.dateDebut, sejour.dateFin);
  const dayRows = days.map((day, idx) => {
    const isLast = idx === days.length - 1;
    return {
      key: dateKey(day),
      dayLabel: formatDateLong(day),
      nightLabel: isLast
        ? null
        : `Nuit du ${formatDateShort(day)} au ${formatDateShort(days[idx + 1])}`,
    };
  });

  const initialNuits = reservationsNuit.map((r) => dateKey(r.date));
  const initialRepasDej = reservationsRepas
    .filter((r) => r.type === "DEJEUNER")
    .map((r) => dateKey(r.date));
  const initialRepasDin = reservationsRepas
    .filter((r) => r.type === "DINER")
    .map((r) => dateKey(r.date));

  const jeuxInscrits = sejour.jeux.filter((jeu) =>
    jeu.inscriptions.some((i) => i.userId === session.userId)
  );

  // --- Mon planning : timeline chronologique nuits + repas + jeux ---
  const planning: PlanningEntry[] = [];

  for (const nuit of reservationsNuit) {
    const lendemain = new Date(nuit.date);
    lendemain.setUTCDate(lendemain.getUTCDate() + 1);
    planning.push({
      key: `nuit-${nuit.id}`,
      date: nuit.date,
      sortMinutes: 23 * 60,
      label: `Nuit du ${formatDateShort(nuit.date)} au ${formatDateShort(lendemain)}`,
      detail: "Petit-déjeuner compris",
    });
  }

  for (const r of reservationsRepas) {
    const isDejeuner = r.type === "DEJEUNER";
    planning.push({
      key: `repas-${r.id}`,
      date: r.date,
      sortMinutes: isDejeuner ? 12 * 60 : 19 * 60 + 30,
      label: isDejeuner ? "Déjeuner" : "Dîner",
    });
  }

  for (const jeu of jeuxInscrits) {
    planning.push({
      key: `jeu-${jeu.id}`,
      date: jeu.debut,
      sortMinutes: jeu.debut.getUTCHours() * 60 + jeu.debut.getUTCMinutes(),
      label: jeu.nom,
      detail: jeuHeureFormatter.format(jeu.debut),
    });
  }

  planning.sort((a, b) => {
    const dayDiff = dateKey(a.date).localeCompare(dateKey(b.date));
    if (dayDiff !== 0) return dayDiff;
    return a.sortMinutes - b.sortMinutes;
  });

  return (
    <div className="container">
      <h1>Mon espace</h1>
      <p className="muted">{sejour.nom}</p>

      {planning.length > 0 && (
        <section className="section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2>Mon planning</h2>
            <a className="btn btn-sm" href="/api/ics/mon-planning">
              Exporter (.ics)
            </a>
          </div>
          <div className="card section">
            <div className="card-list">
              {planning.map((entry) => (
                <div key={entry.key} style={{ display: "flex", gap: 12 }}>
                  <span className="muted" style={{ minWidth: 110 }}>
                    {formatDateShort(entry.date)}
                  </span>
                  <span>
                    <strong>{entry.label}</strong>
                    {entry.detail && <span className="muted"> — {entry.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Hébergement et repas</h2>
        <p className="muted">
          Coche les nuits et les repas auxquels tu participes — pas besoin d&apos;être là
          toute la période.
        </p>
        <div className="section">
          <InscriptionForm
            sejourId={sejour.id}
            prixNuitCts={sejour.prixNuitCts}
            prixRepasCts={sejour.prixRepasCts}
            days={dayRows}
            initialNuits={initialNuits}
            initialRepasDej={initialRepasDej}
            initialRepasDin={initialRepasDin}
          />
        </div>
      </section>

      {sejour.jeux.length > 0 && (
        <section className="section">
          <h2>Jeux proposés</h2>
          <div className="card-list section">
            {sejour.jeux.map((jeu) => {
              const inscrit = jeu.inscriptions.some((i) => i.userId === session.userId);
              const positionAttente = jeu.waitlist.findIndex(
                (w) => w.userId === session.userId
              );
              const enAttente = positionAttente !== -1;
              const placesRestantes = jeu.placesMax - jeu.inscriptions.length;
              const complet = placesRestantes <= 0;

              let badgeText: string;
              if (inscrit) badgeText = "Inscrit·e";
              else if (enAttente) badgeText = `En liste d'attente (position ${positionAttente + 1})`;
              else if (complet) badgeText = `Complet · ${jeu.waitlist.length} en liste d'attente`;
              else badgeText = `${placesRestantes} place(s) restante(s)`;

              let buttonLabel: string;
              let buttonAction = inscrireJeuAction;
              let buttonClass = "btn-primary";
              if (inscrit) {
                buttonLabel = "Se désinscrire";
                buttonAction = quitterJeuAction;
                buttonClass = "btn-danger";
              } else if (enAttente) {
                buttonLabel = "Quitter la liste d'attente";
                buttonAction = quitterJeuAction;
                buttonClass = "btn-danger";
              } else if (complet) {
                buttonLabel = "Rejoindre la liste d'attente";
              } else {
                buttonLabel = "S'inscrire";
              }

              return (
                <div className="card" key={jeu.id}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <h3>{jeu.nom}</h3>
                      <p className="muted">
                        {jeuHeureFormatter.format(jeu.debut)} · {jeu.dureeMinutes} min ·{" "}
                        {badgeText}
                      </p>
                      {jeu.description && <p style={{ marginTop: 6 }}>{jeu.description}</p>}
                    </div>
                    <form action={buttonAction}>
                      <input type="hidden" name="jeuId" value={jeu.id} />
                      <button className={`btn ${buttonClass} btn-sm`} type="submit">
                        {buttonLabel}
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
