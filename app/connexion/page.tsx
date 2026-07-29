"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "@/lib/actions/auth";

export default function ConnexionPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Connexion</h1>
      <div className="card section">
        <form action={formAction}>
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
              autoComplete="current-password"
            />
          </label>
          {state?.error && <p className="error-text">{state.error}</p>}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
      <p className="muted section">
        Pas encore de compte ? <Link href="/creer-compte">Créer un compte</Link>
      </p>
    </div>
  );
}
