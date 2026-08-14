"use client";

import { useState, useTransition } from "react";
import { endGameAction } from "./actions";

/** Met fin à la partie — double confirmation (action irréversible, pas de boîte de dialogue navigateur, même convention que DeleteButton en bibliothèque). */
export function EndGameButton() {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full rounded-md border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/30"
      >
        Mettre fin à la partie
      </button>
    );
  }

  return (
    <div className="rounded-md border border-red-900 bg-red-950/30 p-3 text-xs">
      <p className="text-red-300">
        Mettre fin à la partie ? Plus aucun ordre, tir ou changement ne sera accepté ensuite. Un compte rendu de fin
        d&apos;opération sera généré pour tous les participants — la partie n&apos;est pas supprimée, seulement close.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => startTransition(() => endGameAction())}
          disabled={isPending}
          className="rounded-md bg-red-700 px-3 py-1 text-red-100 hover:bg-red-600 disabled:opacity-50"
        >
          {isPending ? "Clôture…" : "Confirmer la fin de partie"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={isPending} className="rounded-md border border-slate-700 px-3 py-1 hover:bg-slate-900">
          Annuler
        </button>
      </div>
    </div>
  );
}
