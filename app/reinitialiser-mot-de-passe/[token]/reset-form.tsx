"use client";

import { useActionState } from "react";
import { resetPasswordWithTokenAction } from "@/lib/actions/password-reset";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    resetPasswordWithTokenAction,
    undefined
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <label>
        Nouveau mot de passe
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
        {pending ? "Enregistrement..." : "Choisir ce mot de passe"}
      </button>
    </form>
  );
}
