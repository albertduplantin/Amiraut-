import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { upsertJeuAction, deleteJeuAction } from "@/lib/actions/admin";

function toDatetimeLocal(date: Date) {
  return date.toISOString().slice(0, 16);
}

export default async function AdminJeuxPage() {
  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <p className="section muted">
        Configure d&apos;abord le <Link href="/admin/sejour">séjour</Link>.
      </p>
    );
  }

  return (
    <div className="section card-list">
      {sejour.jeux.map((jeu) => (
        <form action={upsertJeuAction} className="card" key={jeu.id}>
          <input type="hidden" name="id" value={jeu.id} />
          <input type="hidden" name="sejourId" value={sejour.id} />
          <label>
            Nom du jeu
            <input type="text" name="nom" required defaultValue={jeu.nom} />
          </label>
          {jeu.proposePar && (
            <p className="muted">
              Apporté par {jeu.proposePar.prenom} {jeu.proposePar.nom}
            </p>
          )}
          <label>
            Description
            <textarea name="description" defaultValue={jeu.description ?? ""} />
          </label>
          <div className="form-row">
            <label>
              Début
              <input
                type="datetime-local"
                name="debut"
                required
                defaultValue={toDatetimeLocal(jeu.debut)}
              />
            </label>
            <label>
              Durée (minutes)
              <input
                type="number"
                name="dureeMinutes"
                min="15"
                step="15"
                defaultValue={jeu.dureeMinutes}
              />
            </label>
            <label>
              Places max
              <input type="number" name="placesMax" min="1" defaultValue={jeu.placesMax} />
            </label>
          </div>
          <p className="muted">
            {jeu.inscriptions.length} / {jeu.placesMax} inscrit(s)
            {jeu.waitlist.length > 0 && ` · ${jeu.waitlist.length} en liste d'attente`}
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" type="submit">
              Enregistrer
            </button>
            <button className="btn btn-danger" type="submit" formAction={deleteJeuAction}>
              Supprimer
            </button>
          </div>
        </form>
      ))}

      <form action={upsertJeuAction} className="card">
        <input type="hidden" name="sejourId" value={sejour.id} />
        <h3>Ajouter un jeu</h3>
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
          Ajouter
        </button>
      </form>
    </div>
  );
}
