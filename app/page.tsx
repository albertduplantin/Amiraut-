import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { centsToEuros, formatDateLong as formatDate, formatDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <div className="container">
        <h1>Les Semaines de l&apos;Hexagone</h1>
        <p className="muted section">
          Aucun séjour n&apos;est configuré pour le moment. Revenez bientôt !
        </p>
      </div>
    );
  }

  const programmeParJour = new Map<string, typeof sejour.programme>();
  for (const item of sejour.programme) {
    const key = item.date.toISOString().slice(0, 10);
    if (!programmeParJour.has(key)) programmeParJour.set(key, []);
    programmeParJour.get(key)!.push(item);
  }

  return (
    <div className="container">
      <h1>{sejour.nom}</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        Du {formatDateShort(sejour.dateDebut)} au {formatDateShort(sejour.dateFin)}
      </p>
      <p className="prose section">{sejour.description}</p>

      <div className="btn-row section">
        <Link className="btn btn-primary" href="/mon-espace">
          S&apos;inscrire
        </Link>
      </div>

      {sejour.editos.length > 0 && (
        <section className="section">
          {sejour.editos.map((edito) => (
            <div className="card" key={edito.id} style={{ marginBottom: 12 }}>
              <h2>{edito.titre}</h2>
              <p className="prose">{edito.contenu}</p>
            </div>
          ))}
        </section>
      )}

      <section className="section">
        <h2>Tarifs</h2>
        <div className="stats-row section" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="muted">Nuitée (petit-déj compris)</div>
            <div className="value">{centsToEuros(sejour.prixNuitCts)}</div>
          </div>
          <div className="stat">
            <div className="muted">Repas (déjeuner ou dîner)</div>
            <div className="value">{centsToEuros(sejour.prixRepasCts)}</div>
          </div>
        </div>
      </section>

      {programmeParJour.size > 0 && (
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
            <h2>Programme</h2>
            <a className="btn btn-sm" href="/api/ics/programme">
              Ajouter à mon agenda (.ics)
            </a>
          </div>
          <div className="card-list section" style={{ marginTop: 12 }}>
            {[...programmeParJour.entries()].map(([key, items]) => (
              <div className="card" key={key}>
                <h3 style={{ textTransform: "capitalize" }}>
                  {formatDate(items[0].date)}
                </h3>
                <div className="card-list" style={{ marginTop: 10 }}>
                  {items.map((item) => (
                    <div key={item.id}>
                      <strong>{item.heure ? `${item.heure} — ` : ""}{item.titre}</strong>
                      {item.description && (
                        <p className="muted">{item.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sejour.jeux.length > 0 && (
        <section className="section">
          <h2>Jeux proposés</h2>
          <div className="card-list section" style={{ marginTop: 12 }}>
            {sejour.jeux.map((jeu) => {
              const placesRestantes = jeu.placesMax - jeu.inscriptions.length;
              return (
                <div className="card" key={jeu.id}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <h3>{jeu.nom}</h3>
                    <span
                      className={`badge ${placesRestantes <= 0 ? "badge-muted" : ""}`}
                    >
                      {placesRestantes > 0
                        ? `${placesRestantes} place(s) restante(s)`
                        : jeu.waitlist.length > 0
                          ? `Complet · ${jeu.waitlist.length} en liste d'attente`
                          : "Complet"}
                    </span>
                  </div>
                  <p className="muted" style={{ marginTop: 4 }}>
                    {new Intl.DateTimeFormat("fr-FR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(jeu.debut)}{" "}
                    · {jeu.dureeMinutes} min
                  </p>
                  {jeu.description && <p style={{ marginTop: 8 }}>{jeu.description}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {sejour.infosPratiques && (
        <section className="section">
          <h2>Infos pratiques</h2>
          <p className="prose section">{sejour.infosPratiques}</p>
        </section>
      )}
    </div>
  );
}
