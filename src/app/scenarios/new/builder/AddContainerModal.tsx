"use client";

import { useState } from "react";
import type { BuilderTeam } from "./types";
import { NATIONS } from "./nations";

const fieldClass = "mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm";

/**
 * Assistant "+" (Phase 3, retour utilisateur 2026-08-15) : "on peut choisir
 * la nationalité (donc le camp) ensuite soit task force navale, soit base
 * aérienne" — et depuis le troisième chantier (même date), une 3e option
 * "station d'écoute". Les trois demandent maintenant une équipe cible :
 * une base aérienne appartient désormais à une équipe (retour utilisateur
 * — "elles doivent apparaître au même endroit en liste" que les task
 * forces, dans le camp), ce n'est plus un objet global partagé.
 *
 * Nationalité : ne se choisit ici QUE pour une nouvelle équipe — elle fixe
 * alors la nation du camp (voir BuilderTeam.nation, nations.ts), pas un
 * simple filtre. Choisir une équipe existante hérite directement de sa
 * nation déjà fixée.
 */
export function AddContainerModal({
  teams,
  onClose,
  onCreateFleet,
  onCreateAirbase,
  onCreateStation,
}: {
  teams: BuilderTeam[];
  onClose: () => void;
  onCreateFleet: (target: { teamClientId: string } | { newTeamName: string; nation: string }) => void;
  onCreateAirbase: (target: { teamClientId: string } | { newTeamName: string; nation: string }) => void;
  onCreateStation: (target: { teamClientId: string } | { newTeamName: string; nation: string }) => void;
}) {
  const [kind, setKind] = useState<"fleet" | "airbase" | "station" | null>(null);
  const [teamChoice, setTeamChoice] = useState<string>(teams[0]?.clientId ?? "__new__");
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamNation, setNewTeamNation] = useState(NATIONS[0].value);

  function resolveTarget(): { teamClientId: string } | { newTeamName: string; nation: string } {
    return teamChoice === "__new__" ? { newTeamName: newTeamName.trim() || newTeamNation, nation: newTeamNation } : { teamClientId: teamChoice };
  }

  function submit() {
    const target = resolveTarget();
    if (kind === "fleet") onCreateFleet(target);
    else if (kind === "airbase") onCreateAirbase(target);
    else if (kind === "station") onCreateStation(target);
    onClose();
  }

  const KIND_LABEL: Record<string, string> = { fleet: "la task force", airbase: "la base aérienne", station: "la station d'écoute" };

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
        <div className="mt-1 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setKind("fleet")}
            className={`rounded-md border px-2 py-3 text-sm ${kind === "fleet" ? "border-brass-500 bg-brass-950/30 text-brass-300" : "border-slate-700 hover:bg-slate-900"}`}
          >
            ⚓ Task force
          </button>
          <button
            type="button"
            onClick={() => setKind("airbase")}
            className={`rounded-md border px-2 py-3 text-sm ${kind === "airbase" ? "border-brass-500 bg-brass-950/30 text-brass-300" : "border-slate-700 hover:bg-slate-900"}`}
          >
            ✈ Base aérienne
          </button>
          <button
            type="button"
            onClick={() => setKind("station")}
            className={`rounded-md border px-2 py-3 text-sm ${kind === "station" ? "border-brass-500 bg-brass-950/30 text-brass-300" : "border-slate-700 hover:bg-slate-900"}`}
          >
            📡 Station d&apos;écoute
          </button>
        </div>

        {kind && (
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
              <>
                <label className="block text-xs font-medium text-slate-400">
                  Nationalité (fixe la nation du camp, filtre la bibliothèque)
                  <select value={newTeamNation} onChange={(e) => setNewTeamNation(e.target.value)} className={fieldClass}>
                    {NATIONS.map((n) => (
                      <option key={n.value} value={n.value}>
                        {n.flag} {n.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-400">
                  Nom de la nouvelle équipe
                  <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder={newTeamNation} className={fieldClass} />
                </label>
              </>
            )}
            <button type="button" onClick={submit} className="w-full rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
              Créer {KIND_LABEL[kind]}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
