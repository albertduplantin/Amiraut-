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
  teams: { name: string; fleets: { name: string; unitNames: string[] }[] }[];
  custom: boolean;
  /** Présent uniquement pour un scénario custom — active le lien "Modifier" (édition en place, retour utilisateur 2026-08-15). */
  id?: string;
};

/** Palette pour les codes couleur des joueurs partageant une équipe (bloc 2) — lisible sur fond sombre, sans redite avec le rouge/bleu déjà utilisés pour les deux camps. */
const PLAYER_COLORS = ["#38bdf8", "#facc15", "#4ade80", "#f472b6", "#c084fc", "#fb923c"];

type TeamPlayer = { displayName: string; colorHex: string };
type TeamMultiplayerState = {
  enabled: boolean;
  players: TeamPlayer[];
  /** Nom de flotte → index dans `players`. */
  fleetAssignment: Record<string, number>;
};

function defaultTeamState(): TeamMultiplayerState {
  return { enabled: false, players: [{ displayName: "Joueur 1", colorHex: PLAYER_COLORS[0] }], fleetAssignment: {} };
}

export function CreateGameForm({ scenarios }: { scenarios: ScenarioSummary[] }) {
  const [scenarioKey, setScenarioKey] = useState(scenarios[0]?.key ?? "");
  const [withArbiter, setWithArbiter] = useState(true);
  const selected = scenarios.find((s) => s.key === scenarioKey) ?? scenarios[0];
  const [turnMinutes, setTurnMinutes] = useState(selected?.defaultTurnMinutes ?? 60);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<CreateGameResult, { ok: true }> | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [teamStates, setTeamStates] = useState<Record<string, TeamMultiplayerState>>({});
  // Répartition des forces (bloc 2) : clé "équipe::flotteOrigine::unité" →
  // nom de la flotte cible (même équipe uniquement). Absente = flotte
  // d'origine du scénario, inchangée.
  const [fleetOverrides, setFleetOverrides] = useState<Record<string, string>>({});

  function selectScenario(key: string) {
    setScenarioKey(key);
    const s = scenarios.find((sc) => sc.key === key);
    if (s) setTurnMinutes(s.defaultTurnMinutes);
    setTeamStates({});
    setFleetOverrides({});
  }

  function unitFleetAssignment(teamName: string, originalFleetName: string, unitName: string): string {
    return fleetOverrides[`${teamName}::${originalFleetName}::${unitName}`] ?? originalFleetName;
  }

  function reassignUnit(teamName: string, originalFleetName: string, unitName: string, targetFleetName: string) {
    const key = `${teamName}::${originalFleetName}::${unitName}`;
    setFleetOverrides((prev) => {
      const next = { ...prev };
      if (targetFleetName === originalFleetName) delete next[key];
      else next[key] = targetFleetName;
      return next;
    });
  }

  function teamState(teamName: string): TeamMultiplayerState {
    return teamStates[teamName] ?? defaultTeamState();
  }

  function updateTeamState(teamName: string, next: TeamMultiplayerState) {
    setTeamStates((prev) => ({ ...prev, [teamName]: next }));
  }

  function toggleMultiplayer(teamName: string, enabled: boolean) {
    const current = teamState(teamName);
    updateTeamState(teamName, { ...current, enabled });
  }

  function addPlayer(teamName: string) {
    const current = teamState(teamName);
    const nextIndex = current.players.length;
    const players = [...current.players, { displayName: `Joueur ${nextIndex + 1}`, colorHex: PLAYER_COLORS[nextIndex % PLAYER_COLORS.length] }];
    updateTeamState(teamName, { ...current, players });
  }

  function removePlayer(teamName: string, index: number) {
    const current = teamState(teamName);
    if (current.players.length <= 1) return;
    const players = current.players.filter((_, i) => i !== index);
    // Réaffecte les flottes qui pointaient sur le joueur retiré (ou sur un
    // index désormais décalé) au premier joueur restant, plutôt que de
    // laisser une flotte orpheline.
    const fleetAssignment: Record<string, number> = {};
    for (const [fleet, playerIndex] of Object.entries(current.fleetAssignment)) {
      if (playerIndex === index) fleetAssignment[fleet] = 0;
      else fleetAssignment[fleet] = playerIndex > index ? playerIndex - 1 : playerIndex;
    }
    updateTeamState(teamName, { ...current, players, fleetAssignment });
  }

  function renamePlayer(teamName: string, index: number, displayName: string) {
    const current = teamState(teamName);
    const players = current.players.map((p, i) => (i === index ? { ...p, displayName } : p));
    updateTeamState(teamName, { ...current, players });
  }

  function assignFleet(teamName: string, fleetName: string, playerIndex: number) {
    const current = teamState(teamName);
    updateTeamState(teamName, { ...current, fleetAssignment: { ...current.fleetAssignment, [fleetName]: playerIndex } });
  }

  function submit() {
    if (!selected) return;
    setError(null);

    const playersByTeamName: Record<string, { displayName: string; colorHex: string; fleetNames: string[] | null }[]> = {};
    for (const team of selected.teams) {
      const state = teamStates[team.name];
      if (!state?.enabled || state.players.length <= 1) continue;
      const fleetNames = team.fleets.map((f) => f.name);
      playersByTeamName[team.name] = state.players.map((player, index) => ({
        displayName: player.displayName.trim() || `Joueur ${index + 1}`,
        colorHex: player.colorHex,
        fleetNames: fleetNames.filter((f) => (state.fleetAssignment[f] ?? 0) === index),
      }));
    }

    startTransition(async () => {
      const res = await createGameAction({
        scenarioKey: selected.key,
        withArbiter,
        turnMinutes,
        playersByTeamName: Object.keys(playersByTeamName).length > 0 ? playersByTeamName : undefined,
        fleetOverridesByUnit: Object.keys(fleetOverrides).length > 0 ? fleetOverrides : undefined,
      });
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
                  <span className="flex items-center gap-2 font-medium">
                    {p.colorHex && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.colorHex }} />}
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
            <div className="flex gap-3">
              <Link href="/library" className="text-xs text-brass-400 hover:text-brass-300">
                Bibliothèque de classes
              </Link>
              <Link href="/scenarios/new" className="text-xs text-brass-400 hover:text-brass-300">
                + Créer un scénario
              </Link>
            </div>
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
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-slate-600">Camps : {s.teamNames.join(" contre ")}</p>
                  {/* stopPropagation : dans le <button> de sélection du scénario, ne doit pas le choisir pour la partie en cours de création. */}
                  <span className="flex items-center gap-2">
                    {/* "Modifier" (retour utilisateur 2026-08-15 — "modifier un scénario sans nécessairement le dupliquer") : uniquement pour un scénario custom (id présent) — un scénario intégré est du code source, aucune ligne en base à écraser. */}
                    {s.id && (
                      <Link
                        href={`/scenarios/new?edit=${encodeURIComponent(s.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-brass-400 hover:text-brass-300"
                        title="Édite ce scénario en place — écrase l'original à l'enregistrement"
                      >
                        Modifier →
                      </Link>
                    )}
                    <Link
                      href={`/scenarios/new?duplicate=${encodeURIComponent(s.key)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-brass-400 hover:text-brass-300"
                      title="Crée une copie à part — l'original n'est jamais modifié"
                    >
                      Dupliquer et modifier →
                    </Link>
                  </span>
                </div>
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

        {selected && selected.teams.length > 0 && (
          <div className="mt-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Joueurs par camp</h2>
            <p className="text-xs text-slate-500">
              Par défaut, un seul lien par camp donne accès à toute l&apos;équipe. Activez « plusieurs joueurs » pour répartir les
              flottes entre coéquipiers, chacun avec son propre lien et son code couleur.
            </p>
            {selected.teams.map((team) => {
              const state = teamState(team.name);
              return (
                <div key={team.name} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{team.name}</h3>
                    <label className="flex items-center gap-1.5 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={state.enabled}
                        onChange={(e) => toggleMultiplayer(team.name, e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      Plusieurs joueurs
                    </label>
                  </div>

                  {!state.enabled ? (
                    <p className="mt-1 text-xs text-slate-600">
                      1 joueur — accès à toute l&apos;équipe ({team.fleets.map((f) => f.name).join(", ")}).
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <ul className="space-y-1.5">
                        {state.players.map((player, index) => (
                          <li key={index} className="flex items-center gap-2">
                            <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: player.colorHex }} />
                            <input
                              value={player.displayName}
                              onChange={(e) => renamePlayer(team.name, index, e.target.value)}
                              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                            />
                            {state.players.length > 1 && (
                              <button
                                onClick={() => removePlayer(team.name, index)}
                                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                                title="Retirer ce joueur"
                              >
                                ✕
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => addPlayer(team.name)}
                        className="rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
                      >
                        + Ajouter un joueur
                      </button>

                      <div className="border-t border-slate-800 pt-2">
                        <p className="mb-1 text-xs text-slate-500">Flotte confiée à :</p>
                        <ul className="space-y-1">
                          {team.fleets.map(({ name: fleetName }) => (
                            <li key={fleetName} className="flex items-center justify-between gap-2 text-xs">
                              <span>{fleetName}</span>
                              <select
                                value={state.fleetAssignment[fleetName] ?? 0}
                                onChange={(e) => assignFleet(team.name, fleetName, Number(e.target.value))}
                                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                              >
                                {state.players.map((player, index) => (
                                  <option key={index} value={index}>
                                    {player.displayName || `Joueur ${index + 1}`}
                                  </option>
                                ))}
                              </select>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selected && selected.teams.some((t) => t.fleets.length > 1) && (
          <div className="mt-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Répartition des forces</h2>
            <p className="text-xs text-slate-500">
              Par défaut, chaque unité démarre dans la flotte prévue par le scénario. Déplacez-la vers une autre flotte de la
              même équipe si vous voulez rééquilibrer les formations avant le début de la partie.
            </p>
            {selected.teams
              .filter((t) => t.fleets.length > 1)
              .map((team) => (
                <div key={team.name} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                  <h3 className="mb-2 text-sm font-medium">{team.name}</h3>
                  <ul className="space-y-1">
                    {team.fleets.flatMap((fleet) =>
                      fleet.unitNames.map((unitName) => (
                        <li key={`${fleet.name}::${unitName}`} className="flex items-center justify-between gap-2 text-xs">
                          <span>{unitName}</span>
                          <select
                            value={unitFleetAssignment(team.name, fleet.name, unitName)}
                            onChange={(e) => reassignUnit(team.name, fleet.name, unitName, e.target.value)}
                            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                          >
                            {team.fleets.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))}
          </div>
        )}

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
