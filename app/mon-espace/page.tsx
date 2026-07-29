import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveSejour } from "@/lib/sejour";
import { daysBetween, dateKey, formatDateLong, formatDateShort } from "@/lib/format";
import { InscriptionForm } from "./inscription-form";
import { inscrireJeuAction, desinscrireJeuAction } from "@/lib/actions/inscription";

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

  return (
    <div className="container">
      <h1>Mon espace</h1>
      <p className="muted">{sejour.nom}</p>

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
              const placesRestantes = jeu.placesMax - jeu.inscriptions.length;
              const complet = placesRestantes <= 0 && !inscrit;

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
                        {new Intl.DateTimeFormat("fr-FR", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(jeu.debut)}{" "}
                        · {jeu.dureeMinutes} min ·{" "}
                        {complet ? "Complet" : `${placesRestantes} place(s) restante(s)`}
                      </p>
                      {jeu.description && <p style={{ marginTop: 6 }}>{jeu.description}</p>}
                    </div>
                    <form action={inscrit ? desinscrireJeuAction : inscrireJeuAction}>
                      <input type="hidden" name="jeuId" value={jeu.id} />
                      <button
                        className={`btn ${inscrit ? "btn-danger" : "btn-primary"} btn-sm`}
                        type="submit"
                        disabled={complet}
                      >
                        {inscrit ? "Se désinscrire" : complet ? "Complet" : "S'inscrire"}
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
