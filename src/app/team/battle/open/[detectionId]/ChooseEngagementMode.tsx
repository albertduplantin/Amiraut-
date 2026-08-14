"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { resolveAirEncounterAutomaticallyAction } from "./actions";

/**
 * Écran de confirmation pour une détection impliquant un avion (bloc
 * combat aérien) — un seul bouton, plus de choix entre résolution
 * automatique et engagement tactique complet depuis l'abandon du combat
 * tactique pour l'aviation (retour utilisateur 2026-08-14) : l'avion de la
 * paire fait toujours sa passe en un seul jet dès que ce contact est
 * ouvert (voir resolveAirEncounterAutomatically, tacticalEngine.ts).
 */
export function ChooseEngagementMode(props: { detectionId: string; observerName: string; targetName: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [passes, setPasses] = useState<{ narrative: string; hit: boolean; targetSunk: boolean }[] | null>(null);

  function resolveAuto() {
    setError(null);
    startTransition(async () => {
      const res = await resolveAirEncounterAutomaticallyAction({ detectionId: props.detectionId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPasses(res.result.passes.map((p) => ({ narrative: p.narrative, hit: p.hit, targetSunk: p.targetSunk })));
    });
  }

  if (passes) {
    const anySunk = passes.some((p) => p.targetSunk);
    const anyHit = passes.some((p) => p.hit);
    return (
      <div className="chart-room-bg flex min-h-screen items-center justify-center text-slate-100">
        <div className="mx-4 w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
          <h1 className={`font-display text-xl ${anySunk ? "text-brass-300" : "text-slate-200"}`}>
            {anySunk ? "Cible détruite !" : anyHit ? "Coup au but" : "Sans effet"}
          </h1>
          <div className="mt-3 space-y-2 text-left text-sm text-slate-300">
            {passes.map((p, i) => (
              <p key={i}>{p.narrative}</p>
            ))}
          </div>
          <Link
            href="/team/orders"
            className="mt-6 inline-block rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500"
          >
            Retour aux ordres
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-room-bg flex min-h-screen items-center justify-center text-slate-100">
      <div className="mx-4 w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 p-6">
        <h1 className="font-display text-xl text-brass-300">
          {props.observerName} → {props.targetName}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Résolution automatique — un seul passage, résultat immédiat, pas de manche de tir.
        </p>

        <div className="mt-5">
          <button
            onClick={resolveAuto}
            disabled={isPending}
            className="w-full rounded-md border border-brass-700 bg-brass-900/30 px-4 py-3 text-sm font-medium text-brass-300 hover:bg-brass-900/50 disabled:opacity-50"
          >
            {isPending ? "Résolution…" : "Résoudre le contact"}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
