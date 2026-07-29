"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction } from "@/lib/actions/auth";

export default function CreerComptePage() {
  const [state, formAction, pending] = useActionState(registerAction, undefined);

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Créer un compte</h1>
      <div className="card section">
        <form action={formAction}>
          <div className="form-row">
            <label>
              Prénom
              <input type="text" name="prenom" required autoComplete="given-name" />
            </label>
            <label>
              Nom
              <input type="text" name="nom" required autoComplete="family-name" />
            </label>
          </div>
          <label>
            Email
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label>
            Mot de passe
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <div role="status" aria-live="polite">
            {state?.error && <p className="error-text">{state.error}</p>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Création..." : "Créer mon compte"}
          </button>
        </form>
      </div>
      <p className="muted section">
        Déjà un compte ? <Link href="/connexion">Se connecter</Link>
      </p>
    </div>
  );
}
