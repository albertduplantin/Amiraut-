"use client";

import { useState } from "react";
import type { BuilderTeam } from "./types";

const fieldClass = "mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm";

/**
 * Assistant "+" (Phase 3, retour utilisateur 2026-08-15) : "quand on appuie
 * sur + [...] on peut choisir la nationalité (donc le camp) ensuite soit
 * task force navale, soit base aérienne". Une base aérienne n'appartient
 * structurellement à aucune équipe (voir BuilderAirbase — un avion s'y
 * rattache via baseRef, quelle que soit son équipe), donc le choix
 * d'équipe n'a de sens que pour une task force : le type se choisit
 * D'ABORD, l'étape équipe ne s'affiche qu'ensuite si "Task force navale".
 * La nationalité reste un simple filtre mémorisé (`preferredNation`), pas
 * un lien structurel — voir types.ts.
 */
export function AddContainerModal({
  teams,
  onClose,
  onCreateFleet,
  onCreateAirbase,
}: {
  teams: BuilderTeam[];
  onClose: () => void;
  onCreateFleet: (target: { teamClientId: string } | { newTeamName: string }, preferredNation: string) => void;
  onCreateAirbase: () => void;
}) {
  const [kind, setKind] = useState<"fleet" | "airbase" | null>(null);
  const [teamChoice, setTeamChoice] = useState<string>(teams[0]?.clientId ?? "__new__");
  const [newTeamName, setNewTeamName] = useState("");
  const [nation, setNation] = useState("");

  function submitFleet() {
    const target = teamChoice === "__new__" ? { newTeamName: newTeamName.trim() || `Équipe ${teams.length + 1}` } : { teamClientId: teamChoice };
    onCreateFleet(target, nation.trim());
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="chart-room-bg w-full max-w-md rounded-lg border border-slate-800 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-brass-300">Nouveau conteneur</h2>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setKind("fleet")}
            className={`rounded-md border px-3 py-3 text-sm ${kind === "fleet" ? "border-brass-500 bg-brass-950/30 text-brass-300" : "border-slate-700 hover:bg-slate-900"}`}
          >
            ⚓ Task force navale
          </button>
          <button
            type="button"
            onClick={() => {
              setKind("airbase");
            }}
            className={`rounded-md border px-3 py-3 text-sm ${kind === "airbase" ? "border-brass-500 bg-brass-950/30 text-brass-300" : "border-slate-700 hover:bg-slate-900"}`}
          >
            ✈ Base aérienne
          </button>
        </div>

        {kind === "fleet" && (
          <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
            <label className="block text-xs font-medium text-slate-400">
              Équipe (camp)
              <select value={teamChoice} onChange={(e) => setTeamChoice(e.target.value)} className={fieldClass}>
                {teams.map((t) => (
                  <option key={t.clientId} value={t.clientId}>
                    {t.name}
                  </option>
                ))}
                <option value="__new__">+ Nouvelle équipe</option>
              </select>
            </label>
            {teamChoice === "__new__" && (
              <label className="block text-xs font-medium text-slate-400">
                Nom de la nouvelle équipe
                <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder={`Équipe ${teams.length + 1}`} className={fieldClass} />
              </label>
            )}
            <label className="block text-xs font-medium text-slate-400">
              Nationalité (facultatif — filtre uniquement, préremplit l&apos;assistant &laquo; Ajouter un bâtiment &raquo;)
              <input value={nation} onChange={(e) => setNation(e.target.value)} placeholder="ex: Royaume-Uni" className={fieldClass} />
            </label>
            <button type="button" onClick={submitFleet} className="w-full rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
              Créer la task force
            </button>
          </div>
        )}

        {kind === "airbase" && (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <p className="text-xs text-slate-500">
              Une base aérienne est partagée entre équipes (un avion s&apos;y rattache individuellement) — pas de choix d&apos;équipe ici. Nom et
              position se règlent ensuite dans le panneau &laquo; Bases aériennes &raquo;.
            </p>
            <button
              type="button"
              onClick={() => {
                onCreateAirbase();
                onClose();
              }}
              className="mt-3 w-full rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500"
            >
              Créer la base aérienne
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
