"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteLibraryClassAction } from "../../actions";

/** Suppression d'une classe de la bibliothèque — double clic de confirmation plutôt qu'une boîte de dialogue navigateur. */
export function DeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLibraryClassAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/library");
    });
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="mt-2 text-xs text-red-500 hover:text-red-400">
        Supprimer cette classe de la bibliothèque
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-red-900 bg-red-950/30 p-3 text-xs">
      <p className="text-red-300">
        Supprimer « {name} » de la bibliothèque ? Les parties déjà créées avec cette classe ne sont pas affectées (chaque partie
        garde sa propre copie).
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={confirmDelete}
          disabled={isPending}
          className="rounded-md bg-red-700 px-3 py-1 text-red-100 hover:bg-red-600 disabled:opacity-50"
        >
          {isPending ? "…" : "Confirmer la suppression"}
        </button>
        <button onClick={() => setConfirming(false)} className="rounded-md border border-slate-700 px-3 py-1 hover:bg-slate-900">
          Annuler
        </button>
      </div>
      {error && <p className="mt-2 text-red-400">{error}</p>}
    </div>
  );
}
