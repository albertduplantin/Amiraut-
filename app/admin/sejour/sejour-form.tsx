"use client";

import { useActionState } from "react";
import { upsertSejourAction } from "@/lib/actions/admin";

export function SejourForm({
  sejour,
}: {
  sejour: {
    id: string;
    nom: string;
    description: string;
    dateDebut: string;
    dateFin: string;
    prixNuit: string;
    prixRepas: string;
    infosPratiques: string;
  } | null;
}) {
  const [state, formAction, pending] = useActionState(upsertSejourAction, undefined);

  return (
    <form action={formAction} className="card">
      {sejour && <input type="hidden" name="id" value={sejour.id} />}
      <label>
        Nom du séjour
        <input type="text" name="nom" required defaultValue={sejour?.nom} />
      </label>
      <label>
        Description
        <textarea name="description" required defaultValue={sejour?.description} />
      </label>
      <div className="form-row">
        <label>
          Date de début
          <input type="date" name="dateDebut" required defaultValue={sejour?.dateDebut} />
        </label>
        <label>
          Date de fin
          <input type="date" name="dateFin" required defaultValue={sejour?.dateFin} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Prix de la nuitée (€, petit-déj compris)
          <input
            type="number"
            name="prixNuit"
            min="0"
            step="0.01"
            defaultValue={sejour?.prixNuit ?? "0"}
          />
        </label>
        <label>
          Prix d&apos;un repas (€, déjeuner ou dîner)
          <input
            type="number"
            name="prixRepas"
            min="0"
            step="0.01"
            defaultValue={sejour?.prixRepas ?? "0"}
          />
        </label>
      </div>
      <label>
        Infos pratiques (adresse, comment venir, parking...)
        <textarea name="infosPratiques" defaultValue={sejour?.infosPratiques} />
      </label>
      {state?.error && <p className="error-text">{state.error}</p>}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Enregistrement..." : "Enregistrer"}
      </button>
    </form>
  );
}
