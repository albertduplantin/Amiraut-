import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { upsertEditoAction, deleteEditoAction } from "@/lib/actions/admin";

export default async function AdminEditosPage() {
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
      {sejour.editos.map((edito) => (
        <form action={upsertEditoAction} className="card" key={edito.id}>
          <input type="hidden" name="id" value={edito.id} />
          <input type="hidden" name="sejourId" value={sejour.id} />
          <label>
            Titre
            <input type="text" name="titre" required defaultValue={edito.titre} />
          </label>
          <label>
            Contenu
            <textarea name="contenu" required defaultValue={edito.contenu} />
          </label>
          <div className="btn-row">
            <button className="btn btn-primary" type="submit">
              Enregistrer
            </button>
            <button
              className="btn btn-danger"
              type="submit"
              formAction={deleteEditoAction}
            >
              Supprimer
            </button>
          </div>
        </form>
      ))}

      <form action={upsertEditoAction} className="card">
        <input type="hidden" name="sejourId" value={sejour.id} />
        <h3>Ajouter un edito</h3>
        <label>
          Titre
          <input type="text" name="titre" required />
        </label>
        <label>
          Contenu
          <textarea name="contenu" required />
        </label>
        <button className="btn btn-primary" type="submit">
          Ajouter
        </button>
      </form>
    </div>
  );
}
