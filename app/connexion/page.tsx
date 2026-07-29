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
          <div role="status" aria-live="polite">
            {state?.error && <p className="error-text">{state.error}</p>}
          </div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
      <p className="muted section">
        Pas encore de compte ? <Link href="/creer-compte">Créer un compte</Link>
      </p>
      <p className="muted">
        <Link href="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
      </p>
    </div>
  );
}
