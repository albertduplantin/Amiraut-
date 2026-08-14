"use client";

import type { BuilderTeam } from "./types";

/**
 * Objectifs — un par équipe, synchronisé automatiquement avec la liste des
 * équipes par le parent (ScenarioEditorForm) : toujours exactement un
 * objectif par équipe, jamais orphelin ni manquant (le schéma exige que
 * chaque objectif référence une équipe existante).
 */
export function ObjectivesEditor({
  teams,
  textByTeamName,
  onChangeText,
}: {
  teams: BuilderTeam[];
  textByTeamName: Map<string, string>;
  onChangeText: (teamName: string, text: string) => void;
}) {
  return (
    <div className="panel-brass space-y-2 p-3">
      <h3 className="font-display text-sm text-brass-300">Objectifs</h3>
      <div className="space-y-2">
        {teams.map((t) => (
          <label key={t.clientId} className="block text-xs text-slate-400">
            {t.name || "(équipe sans nom)"}
            <textarea
              value={textByTeamName.get(t.name) ?? ""}
              onChange={(e) => onChangeText(t.name, e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
