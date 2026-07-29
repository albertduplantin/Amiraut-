import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { dateKey } from "@/lib/format";
import { upsertProgrammeAction, deleteProgrammeAction } from "@/lib/actions/admin";

export default async function AdminProgrammePage() {
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
      {sejour.programme.map((item) => (
        <form action={upsertProgrammeAction} className="card" key={item.id}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="sejourId" value={sejour.id} />
          <div className="form-row">
            <label>
              Date
              <input type="date" name="date" required defaultValue={dateKey(item.date)} />
            </label>
            <label>
              Heure (optionnel)
              <input type="time" name="heure" defaultValue={item.heure ?? ""} />
            </label>
          </div>
          <label>
            Titre
            <input type="text" name="titre" required defaultValue={item.titre} />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={item.description ?? ""} />
          </label>
          <div className="btn-row">
            <button className="btn btn-primary" type="submit">
              Enregistrer
            </button>
            <button
              className="btn btn-danger"
              type="submit"
              formAction={deleteProgrammeAction}
            >
              Supprimer
            </button>
          </div>
        </form>
      ))}

      <form action={upsertProgrammeAction} className="card">
        <input type="hidden" name="sejourId" value={sejour.id} />
        <h3>Ajouter au programme</h3>
        <div className="form-row">
          <label>
            Date
            <input
              type="date"
              name="date"
              required
              min={dateKey(sejour.dateDebut)}
              max={dateKey(sejour.dateFin)}
            />
          </label>
          <label>
            Heure (optionnel)
            <input type="time" name="heure" />
          </label>
        </div>
        <label>
          Titre
          <input type="text" name="titre" required />
        </label>
        <label>
          Description
          <textarea name="description" />
        </label>
        <button className="btn btn-primary" type="submit">
          Ajouter
        </button>
      </form>
    </div>
  );
}
