"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { resolveAirEncounterAutomaticallyAction, breakOffAirEncounterAction } from "./actions";

/**
 * Écran de décision pour une détection impliquant un avion (bloc combat
 * aérien) — deux choix, jamais de combat tactique manche par manche depuis
 * l'abandon du tactique pour l'aviation (retour utilisateur 2026-08-14) :
 * résoudre en un seul jet (voir resolveAirEncounterAutomatically), ou
 * rompre le combat et rentrer à la base (voir breakOffAirEncounter) — pas
 * toujours possible en air-air (faut être au moins aussi rapide que
 * l'adversaire, voir canBreakOff/breakOffDisabledReason). Un avion de
 * reconnaissance pure sans aucun armement n'a pas de bouton "Résoudre" du
 * tout en air-mer/air-sous-marin (voir canResolve, page.tsx) : il n'a rien
 * à attaquer, seule la reconnaissance-et-retour a un sens pour lui.
 */
export function ChooseEngagementMode(props: {
  detectionId: string;
  observerName: string;
  targetName: string;
  canResolve: boolean;
  canBreakOff: boolean;
  breakOffDisabledReason: string | null;
}) {
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

  function breakOff() {
    setError(null);
    startTransition(async () => {
      const res = await breakOffAirEncounterAction({ detectionId: props.detectionId });
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
            {anySunk ? "Cible détruite !" : anyHit ? "Coup au but" : passes.length > 0 ? "Sans effet" : "Contact rompu"}
          </h1>
          <div className="mt-3 space-y-2 text-left text-sm text-slate-300">
            {passes.length > 0 ? passes.map((p, i) => <p key={i}>{p.narrative}</p>) : <p>L&apos;avion rompt le combat et rentre à sa base, sans opposition.</p>}
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
          {props.canResolve
            ? "Résolution automatique — un seul passage, résultat immédiat, pas de manche de tir."
            : "Avion non armé — aucune attaque possible, seule la reconnaissance a un sens ici."}
        </p>

        <div className="mt-5 space-y-3">
          {props.canResolve && (
            <button
              onClick={resolveAuto}
              disabled={isPending}
              className="w-full rounded-md border border-brass-700 bg-brass-900/30 px-4 py-3 text-left text-sm hover:bg-brass-900/50 disabled:opacity-50"
            >
              <div className="font-medium text-brass-300">{isPending ? "Résolution…" : "Résoudre le contact"}</div>
              <div className="mt-0.5 text-xs text-slate-400">Attaque immédiatement.</div>
            </button>
          )}

          {props.canBreakOff ? (
            <button
              onClick={breakOff}
              disabled={isPending}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-4 py-3 text-left text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              <div className="font-medium">
                {isPending ? "…" : props.canResolve ? "Rompre le contact — rentrer à la base" : "Effectuer la reconnaissance et rentrer à la base"}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {props.canResolve
                  ? "Renonce à attaquer — pas totalement sans risque, l'adversaire garde une dernière chance de tirer."
                  : "Passage d'observation — pas sans risque, la DCA adverse garde une dernière chance de tirer."}
              </div>
            </button>
          ) : (
            <div className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-4 py-3 text-left text-sm text-slate-600">
              <div className="font-medium">Rupture impossible</div>
              <div className="mt-0.5 text-xs">{props.breakOffDisabledReason ?? "Trop lent pour rompre le combat."}</div>
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
