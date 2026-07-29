"use client";

import { useState } from "react";
import { deleteMyAccountAction } from "@/lib/actions/profil";

export function DeleteAccountForm() {
  const [confirmation, setConfirmation] = useState("");

  return (
    <form action={deleteMyAccountAction} className="card">
      <p className="muted">
        Cela supprime définitivement ton compte ainsi que toutes tes réservations
        (nuits, repas, jeux, covoiturage). Tape <strong>SUPPRIMER</strong> pour confirmer.
      </p>
      <input
        type="text"
        name="confirmation"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder="SUPPRIMER"
      />
      <button
        className="btn btn-danger"
        type="submit"
        disabled={confirmation !== "SUPPRIMER"}
      >
        Supprimer définitivement mon compte
      </button>
    </form>
  );
}
