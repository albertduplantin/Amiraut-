"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/lib/actions/admin";

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, undefined);

  if (state?.tempPassword) {
    return (
      <span className="muted">
        Nouveau mot de passe : <code>{state.tempPassword}</code>
      </span>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <button className="btn btn-sm" type="submit" disabled={pending}>
        {pending ? "..." : "Réinitialiser le mot de passe"}
      </button>
    </form>
  );
}
