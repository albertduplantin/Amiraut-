"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createGameAction, type CreateGameResult } from "./actions";

type ScenarioSummary = {
  key: string;
  name: string;
  description: string;
  dateLabel: string;
  defaultTurnMinutes: number;
  teamNames: string[];
  custom: boolean;
};

export function CreateGameForm({ scenarios }: { scenarios: ScenarioSummary[] }) {
  const [scenarioKey, setScenarioKey] = useState(scenarios[0]?.key ?? "");
  const [withArbiter, setWithArbiter] = useState(true);
  const selected = scenarios.find((s) => s.key === scenarioKey) ?? scenarios[0];
  const [turnMinutes, setTurnMinutes] = useState(selected?.defaultTurnMinutes ?? 60);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<CreateGameResult, { ok: true }> | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  function selectScenario(key: string) {
    setScenarioKey(key);
    const s = scenarios.find((sc) => sc.key === key);
    if (s) setTurnMinutes(s.defaultTurnMinutes);
  }

  function submit() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await createGameAction({ scenarioKey: selected.key, withArbiter, turnMinutes });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
    });
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/play/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 1500);
    });
  }

  if (result) {
    return (
      <div className="chart-room-bg min-h-screen text-slate-100">
        <div className="mx-auto max-w-2xl px-6 py-12">
          <h1 className="font-display text-2xl text-brass-300">Partie créée</h1>
          <p className="mt-2 text-sm text-slate-400">
            Distribuez un lien à chaque participant — chacun n&apos;a besoin que du sien.
          </p>
          <ul className="mt-6 space-y-3">
            {result.participants.map((p) => (
              <li key={p.token} className="rounded-md border border-slate-800 bg-slate-900 p-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">
                    {p.label} <span className="text-xs text-slate-500">({p.role === "ARBITER" ? "arbitre" : "joueur"})</span>
                  </span>
                  <button
                    onClick={() => copyLink(p.token)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                  >
                    {copiedToken === p.token ? "Copié !" : "Copier le lien"}
                  </button>
                </div>
                <code className="block break-all text-xs text-slate-500">/play/{p.token}</code>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex gap-3">
            <Link href={`/play/${result.participants[0].token}`} className="rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
              Ouvrir ma partie
            </Link>
            <button
              onClick={() => setResult(null)}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-900"
            >
              Créer une autre partie
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-room-bg min-h-screen text-slate-100">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-display text-2xl text-brass-300">Créer une partie</h1>
        <p className="mt-2 text-sm text-slate-400">Choisissez un scénario de la bibliothèque, puis distribuez les liens générés.</p>

        <div className="mt-8 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scénario</h2>
            <Link href="/scenarios/new" className="text-xs text-brass-400 hover:text-brass-300">
              + Créer un scénario
            </Link>
          </div>
          {scenarios.length === 0 && <p className="text-sm text-slate-500">Aucun scénario disponible pour l&apos;instant.</p>}
          <div className="space-y-2">
            {scenarios.map((s) => (
              <button
                key={s.key}
                onClick={() => selectScenario(s.key)}
                className={`w-full rounded-md border p-4 text-left transition ${
                  s.key === scenarioKey ? "border-brass-500 bg-brass-900/20" : "border-slate-800 bg-slate-900 hover:bg-slate-850"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-medium">
                    {s.name}
                    {s.custom && (
                      <span className="rounded border border-brass-700 px-1 py-0.5 text-[10px] font-normal text-brass-400">
                        créé par un joueur
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500">{s.dateLabel}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{s.description}</p>
                <p className="mt-1 text-xs text-slate-600">Camps : {s.teamNames.join(" contre ")}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Options</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withArbiter} onChange={(e) => setWithArbiter(e.target.checked)} className="h-4 w-4" />
            Avec arbitre (recommandé) — sans arbitre, la détection se résout entièrement en automatique.
          </label>
          <label className="block text-sm">
            Échelle de temps du premier tour (minutes)
            <input
              type="number"
              min={10}
              max={720}
              step={5}
              value={turnMinutes}
              onChange={(e) => setTurnMinutes(Number(e.target.value))}
              className="mt-1 block w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
            <span className="mt-0.5 block text-xs text-slate-500">
              Par défaut pour ce scénario : {selected?.defaultTurnMinutes} min. Ajustable seulement pour le tour de départ — le combat
              tactique bascule ensuite automatiquement sur sa propre échelle, plus courte.
            </span>
          </label>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          onClick={submit}
          disabled={isPending || !selected}
          className="mt-8 rounded-md bg-brass-600 px-5 py-2.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
        >
          {isPending ? "Création…" : "Créer la partie"}
        </button>
      </div>
    </div>
  );
}
