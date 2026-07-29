"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/lib/actions/password-reset";

export default function MotDePasseOubliePage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Mot de passe oublié</h1>
      <div className="card section">
        {state?.success ? (
          <p>
            Si un compte existe avec cet email, tu vas recevoir un lien de réinitialisation
            d&apos;ici quelques minutes. Pense à vérifier tes spams. Si tu ne reçois rien,
            contacte l&apos;organisateur qui peut réinitialiser ton mot de passe directement.
          </p>
        ) : (
          <form action={formAction}>
            <label>
              Email
              <input type="email" name="email" required autoComplete="email" />
            </label>
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? "Envoi..." : "Recevoir un lien de réinitialisation"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
