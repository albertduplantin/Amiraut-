"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ pendingLabel, idleLabel }: { pendingLabel: string; idleLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brass-600 px-4 py-1.5 font-medium hover:bg-brass-500 disabled:opacity-60"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
