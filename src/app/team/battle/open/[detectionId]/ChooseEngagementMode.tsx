"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { resolveAirEncounterAutomaticallyAction } from "./actions";
import { openTacticalEngagementAction } from "./openAction";

export function ChooseEngagementMode(props: { detectionId: string; observerName: string; targetName: string; canAutoResolve: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ narrative: string; hit: boolean; targetSunk: boolean } | null>(null);

  function resolveAuto() {
    setError(null);
    startTransition(async () => {
      const res = await resolveAirEncounterAutomaticallyAction({ detectionId: props.detectionId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ narrative: res.result.narrative, hit: res.result.hit, targetSunk: res.result.targetSunk });
    });
  }

  function openTactical() {
    setError(null);
    startTransition(async () => {
      await openTacticalEngagementAction({ detectionId: props.detectionId });
    });
  }

  if (result) {
    return (
      <div className="chart-room-bg flex min-h-screen items-center justify-center text-slate-100">
        <div className="mx-4 w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
          <h1 className={`font-display text-xl ${result.targetSunk ? "text-brass-300" : "text-slate-200"}`}>
            {result.targetSunk ? "Cible détruite !" : result.hit ? "Coup au but" : "Sans effet"}
          </h1>
          <p className="mt-3 text-sm text-slate-300">{result.narrative}</p>
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
        <p className="mt-2 text-sm text-slate-400">Comment voulez-vous résoudre ce contact ?</p>

        <div className="mt-5 space-y-3">
          {props.canAutoResolve && (
            <button
              onClick={resolveAuto}
              disabled={isPending}
              className="w-full rounded-md border border-brass-700 bg-brass-900/30 px-4 py-3 text-left text-sm hover:bg-brass-900/50 disabled:opacity-50"
            >
              <div className="font-medium text-brass-300">Résolution automatique</div>
              <div className="mt-0.5 text-xs text-slate-400">
                Un seul passage — {props.observerName} largue tout ce qu&apos;il a d&apos;un coup sur {props.targetName}. Résultat immédiat, pas de
                manche de tir.
              </div>
            </button>
          )}
          <button
            onClick={openTactical}
            disabled={isPending}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-4 py-3 text-left text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            <div className="font-medium">Engagement tactique complet</div>
            <div className="mt-0.5 text-xs text-slate-400">Bascule en mode combat rapproché — mouvement et tir, manche par manche, comme un duel de navires.</div>
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
