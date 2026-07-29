"use client";

import { useActionState } from "react";
import { updateProfilAction } from "@/lib/actions/profil";

export function ProfilForm({
  regimeAlimentaire,
  contactUrgenceNom,
  contactUrgenceTelephone,
  colocataireSouhaite,
  afficherDansListeParticipants,
}: {
  regimeAlimentaire: string;
  contactUrgenceNom: string;
  contactUrgenceTelephone: string;
  colocataireSouhaite: string;
  afficherDansListeParticipants: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateProfilAction, undefined);

  return (
    <form action={formAction} className="card">
      <label>
        Régime alimentaire / allergies
        <textarea
          name="regimeAlimentaire"
          placeholder="Ex : végétarien, allergie aux fruits à coque..."
          defaultValue={regimeAlimentaire}
        />
      </label>
      <div className="form-row">
        <label>
          Contact d&apos;urgence — nom
          <input type="text" name="contactUrgenceNom" defaultValue={contactUrgenceNom} />
        </label>
        <label>
          Contact d&apos;urgence — téléphone
          <input
            type="tel"
            name="contactUrgenceTelephone"
            defaultValue={contactUrgenceTelephone}
          />
        </label>
      </div>
      <label>
        Colocataire souhaité·e
        <input
          type="text"
          name="colocataireSouhaite"
          placeholder="Nom de la personne avec qui tu veux partager une chambre"
          defaultValue={colocataireSouhaite}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          name="afficherDansListeParticipants"
          defaultChecked={afficherDansListeParticipants}
        />
        Afficher mon prénom dans la liste « Qui vient ? » (visible des autres inscrits)
      </label>
      <div role="status" aria-live="polite">
        {state?.success && <p className="success-text">Enregistré !</p>}
      </div>
      <button className="btn btn-sm" type="submit" disabled={pending}>
        {pending ? "Enregistrement..." : "Enregistrer mes informations"}
      </button>
    </form>
  );
}
