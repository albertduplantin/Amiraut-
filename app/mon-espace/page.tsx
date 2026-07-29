import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getActiveSejour } from "@/lib/sejour";
import { daysBetween, dateKey, formatDateLong, formatDateShort } from "@/lib/format";
import { InscriptionForm } from "./inscription-form";
import { ProfilForm } from "./profil-form";
import { DeleteAccountForm } from "./delete-account-form";
import { inscrireJeuAction, quitterJeuAction, proposerJeuAction } from "@/lib/actions/inscription";
import {
  creerAnnonceCovoiturageAction,
  supprimerAnnonceCovoiturageAction,
} from "@/lib/actions/covoiturage";
import { laisserAvisAction } from "@/lib/actions/avis";

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
  warning?: string;
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

  const [reservationsNuit, reservationsRepas, moi, annoncesCovoiturage, participantsVisibles] =
    await Promise.all([
      prisma.reservationNuit.findMany({
        where: { sejourId: sejour.id, userId: session.userId },
      }),
      prisma.reservationRepas.findMany({
        where: { sejourId: sejour.id, userId: session.userId },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: session.userId } }),
      prisma.covoiturageAnnonce.findMany({
        where: { sejourId: sejour.id },
        include: { user: { select: { prenom: true, nom: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.findMany({
        where: {
          role: "PARTICIPANT",
          afficherDansListeParticipants: true,
          OR: [
            { reservationsNuit: { some: { sejourId: sejour.id } } },
            { reservationsRepas: { some: { sejourId: sejour.id } } },
            { inscriptionsJeu: { some: { jeu: { sejourId: sejour.id } } } },
          ],
        },
        select: { id: true, prenom: true },
        orderBy: { prenom: "asc" },
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

  const conflitsParJeu = new Map<string, string[]>();
  for (let i = 0; i < jeuxInscrits.length; i++) {
    for (let j = i + 1; j < jeuxInscrits.length; j++) {
      const a = jeuxInscrits[i];
      const b = jeuxInscrits[j];
      const finA = new Date(a.debut.getTime() + a.dureeMinutes * 60 * 1000);
      const finB = new Date(b.debut.getTime() + b.dureeMinutes * 60 * 1000);
      const seChevauchent = a.debut < finB && b.debut < finA;
      if (seChevauchent) {
        if (!conflitsParJeu.has(a.id)) conflitsParJeu.set(a.id, []);
        if (!conflitsParJeu.has(b.id)) conflitsParJeu.set(b.id, []);
        conflitsParJeu.get(a.id)!.push(b.nom);
        conflitsParJeu.get(b.id)!.push(a.nom);
      }
    }
  }

  for (const jeu of jeuxInscrits) {
    const conflits = conflitsParJeu.get(jeu.id);
    planning.push({
      key: `jeu-${jeu.id}`,
      date: jeu.debut,
      sortMinutes: jeu.debut.getUTCHours() * 60 + jeu.debut.getUTCMinutes(),
      label: jeu.nom,
      detail: jeuHeureFormatter.format(jeu.debut),
      warning: conflits ? `Chevauche avec ${conflits.join(", ")}` : undefined,
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
                    {entry.warning && (
                      <span className="error-text"> · ⚠️ {entry.warning}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Mes informations</h2>
        <p className="muted">
          Utile pour l&apos;organisation des repas et en cas d&apos;urgence.
        </p>
        <div className="section">
          <ProfilForm
            regimeAlimentaire={moi.regimeAlimentaire ?? ""}
            contactUrgenceNom={moi.contactUrgenceNom ?? ""}
            contactUrgenceTelephone={moi.contactUrgenceTelephone ?? ""}
            colocataireSouhaite={moi.colocataireSouhaite ?? ""}
            afficherDansListeParticipants={moi.afficherDansListeParticipants}
          />
        </div>
      </section>

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

      <section className="section">
        <h2>Jeux proposés</h2>
        {sejour.jeux.length > 0 && (
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
                      <h3>
                        {jeu.nom}
                        {jeu.proposePar && (
                          <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                            apporté par {jeu.proposePar.prenom}
                          </span>
                        )}
                      </h3>
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
        )}

        <details className="section">
          <summary className="btn btn-sm" style={{ display: "inline-flex" }}>
            Proposer un jeu que j&apos;apporte
          </summary>
          <form action={proposerJeuAction} className="card" style={{ marginTop: 12 }}>
            <input type="hidden" name="sejourId" value={sejour.id} />
            <label>
              Nom du jeu
              <input type="text" name="nom" required />
            </label>
            <label>
              Description
              <textarea name="description" />
            </label>
            <div className="form-row">
              <label>
                Début
                <input type="datetime-local" name="debut" required />
              </label>
              <label>
                Durée (minutes)
                <input type="number" name="dureeMinutes" min="15" step="15" defaultValue={60} />
              </label>
              <label>
                Places max
                <input type="number" name="placesMax" min="1" defaultValue={4} />
              </label>
            </div>
            <button className="btn btn-primary" type="submit">
              Proposer ce jeu
            </button>
          </form>
        </details>
      </section>

      <section className="section">
        <h2>Covoiturage</h2>
        <p className="muted">Propose un trajet ou indique que tu en cherches un.</p>

        {annoncesCovoiturage.length > 0 && (
          <div className="card-list section">
            {annoncesCovoiturage.map((annonce) => (
              <div className="card" key={annonce.id}>
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
                    <span className={`badge ${annonce.type === "RECHERCHE" ? "badge-muted" : ""}`}>
                      {annonce.type === "PROPOSE" ? "Propose un trajet" : "Cherche un trajet"}
                    </span>
                    <p style={{ marginTop: 6 }}>
                      <strong>{annonce.lieu}</strong> — {annonce.user.prenom} {annonce.user.nom}
                    </p>
                    {annonce.message && <p className="muted">{annonce.message}</p>}
                  </div>
                  {annonce.userId === session.userId && (
                    <form action={supprimerAnnonceCovoiturageAction}>
                      <input type="hidden" name="id" value={annonce.id} />
                      <button className="btn btn-danger btn-sm" type="submit">
                        Supprimer
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <form action={creerAnnonceCovoiturageAction} className="card section">
          <input type="hidden" name="sejourId" value={sejour.id} />
          <div className="form-row">
            <label>
              Type
              <select name="type" defaultValue="PROPOSE">
                <option value="PROPOSE">Je propose un trajet</option>
                <option value="RECHERCHE">Je cherche un trajet</option>
              </select>
            </label>
            <label>
              Lieu de départ
              <input type="text" name="lieu" required placeholder="Ville de départ" />
            </label>
          </div>
          <label>
            Message (horaires, places disponibles...)
            <textarea name="message" />
          </label>
          <button className="btn btn-primary" type="submit">
            Publier l&apos;annonce
          </button>
        </form>
      </section>

      {jeuxInscrits.some((j) => j.debut < new Date()) && (
        <section className="section">
          <h2>Avis sur les jeux joués</h2>
          <div className="card-list section">
            {jeuxInscrits
              .filter((jeu) => jeu.debut < new Date())
              .map((jeu) => {
                const monAvis = jeu.avis.find((a) => a.userId === session.userId);
                return (
                  <div className="card" key={jeu.id}>
                    <h3>{jeu.nom}</h3>
                    {monAvis ? (
                      <p className="muted">
                        Ton avis : {"⭐".repeat(monAvis.note)} {monAvis.commentaire}
                      </p>
                    ) : (
                      <form action={laisserAvisAction}>
                        <input type="hidden" name="jeuId" value={jeu.id} />
                        <div className="form-row">
                          <label>
                            Note
                            <select name="note" defaultValue="5">
                              <option value="1">1 — bof</option>
                              <option value="2">2</option>
                              <option value="3">3</option>
                              <option value="4">4</option>
                              <option value="5">5 — excellent</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          Commentaire (optionnel)
                          <textarea name="commentaire" />
                        </label>
                        <button className="btn btn-sm" type="submit">
                          Envoyer mon avis
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {participantsVisibles.length > 0 && (
        <section className="section">
          <h2>Qui vient ?</h2>
          <p className="muted">
            {participantsVisibles.map((p) => p.prenom).join(", ")}
          </p>
        </section>
      )}

      <section className="section">
        <h2>Mon compte</h2>
        <div className="section">
          <DeleteAccountForm />
        </div>
      </section>
    </div>
  );
}
