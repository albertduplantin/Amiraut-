"use client";

import type { Dispatch, SetStateAction } from "react";
import type { BuilderTeam, BuilderAirbase, BuilderSquadron, ClientIdGenerator } from "./types";
import { allUnits } from "./types";
import { UnitRosterRow } from "./UnitRosterRow";

const fieldClass = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm";

/**
 * Task forces (retour utilisateur 2026-08-14) : colonnes par équipe, cartes
 * par flotte (task force). Gardes explicites (message inline plutôt que de
 * produire un brouillon invalide) : au moins deux équipes, au moins une
 * task force par équipe, au moins une unité par task force — mêmes
 * contraintes que ScenarioDefinitionSchema côté serveur.
 */
export function TeamsBoard({
  teams,
  setTeams,
  airbases,
  squadrons,
  nextClientId,
  selectedUnitClientId,
  onSelectUnitForPlacement,
}: {
  teams: BuilderTeam[];
  setTeams: Dispatch<SetStateAction<BuilderTeam[]>>;
  airbases: BuilderAirbase[];
  squadrons: BuilderSquadron[];
  nextClientId: ClientIdGenerator;
  /** Placement interactif sur la carte (Phase 5, retour utilisateur 2026-08-14). */
  selectedUnitClientId: string | null;
  onSelectUnitForPlacement: (teamClientId: string, fleetClientId: string, unitClientId: string) => void;
}) {
  function addTeam() {
    setTeams((prev) => [
      ...prev,
      {
        clientId: nextClientId("team"),
        name: `Équipe ${prev.length + 1}`,
        colorHex: prev.length % 2 === 0 ? "#3388ff" : "#dc2626",
        fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }],
      },
    ]);
  }
  function removeTeam(teamClientId: string) {
    setTeams((prev) => prev.filter((t) => t.clientId !== teamClientId));
  }
  function updateTeam(teamClientId: string, patch: Partial<Pick<BuilderTeam, "name" | "colorHex">>) {
    setTeams((prev) => prev.map((t) => (t.clientId === teamClientId ? { ...t, ...patch } : t)));
  }
  function addFleet(teamClientId: string) {
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId
          ? { ...t, fleets: [...t.fleets, { clientId: nextClientId("fleet"), name: `Task Force ${t.fleets.length + 1}`, units: [] }] }
          : t
      )
    );
  }
  function removeFleet(teamClientId: string, fleetClientId: string) {
    setTeams((prev) => prev.map((t) => (t.clientId === teamClientId ? { ...t, fleets: t.fleets.filter((f) => f.clientId !== fleetClientId) } : t)));
  }
  function updateFleetName(teamClientId: string, fleetClientId: string, name: string) {
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId ? { ...t, fleets: t.fleets.map((f) => (f.clientId === fleetClientId ? { ...f, name } : f)) } : t
      )
    );
  }
  function removeUnit(teamClientId: string, fleetClientId: string, unitClientId: string) {
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId
          ? {
              ...t,
              fleets: t.fleets.map((f) =>
                f.clientId === fleetClientId ? { ...f, units: f.units.filter((u) => u.clientId !== unitClientId) } : f
              ),
            }
          : t
      )
    );
  }
  function updateUnit(teamClientId: string, fleetClientId: string, unitClientId: string, patch: Partial<BuilderTeam["fleets"][number]["units"][number]>) {
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId
          ? {
              ...t,
              fleets: t.fleets.map((f) =>
                f.clientId === fleetClientId
                  ? { ...f, units: f.units.map((u) => (u.clientId === unitClientId ? { ...u, ...patch } : u)) }
                  : f
              ),
            }
          : t
      )
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm text-brass-300">Task forces</h3>
        <button type="button" onClick={addTeam} className="text-xs text-brass-400 hover:text-brass-300">
          + Nouvelle équipe
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {teams.map((team) => {
          const allSurfaceUnits = allUnits(teams).filter((u) => u.classRef.category === "SURFACE_SHIP");
          return (
            <div key={team.clientId} className="panel-brass space-y-3 p-3">
              <div className="flex items-center gap-2">
                <input type="color" value={team.colorHex} onChange={(e) => updateTeam(team.clientId, { colorHex: e.target.value })} className="h-7 w-7 rounded border border-slate-700 bg-slate-950" />
                <input
                  value={team.name}
                  onChange={(e) => updateTeam(team.clientId, { name: e.target.value })}
                  className={`${fieldClass} flex-1 font-medium`}
                />
                <button
                  type="button"
                  onClick={() => removeTeam(team.clientId)}
                  disabled={teams.length <= 2}
                  title={teams.length <= 2 ? "Il faut au moins deux équipes" : undefined}
                  className="text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Supprimer l&apos;équipe
                </button>
              </div>

              <div className="space-y-2">
                {team.fleets.map((fleet) => (
                  <div key={fleet.clientId} className="rounded-md border border-slate-800 bg-slate-950/40 p-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={fleet.name}
                        onChange={(e) => updateFleetName(team.clientId, fleet.clientId, e.target.value)}
                        className={`${fieldClass} flex-1 text-xs`}
                      />
                      <button
                        type="button"
                        onClick={() => removeFleet(team.clientId, fleet.clientId)}
                        disabled={team.fleets.length <= 1}
                        title={team.fleets.length <= 1 ? "Il faut au moins une task force par équipe" : undefined}
                        className="text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Supprimer
                      </button>
                    </div>
                    {fleet.units.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-600">Aucune unité — ajoutez-en depuis la bibliothèque.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {fleet.units.map((unit) => (
                          <UnitRosterRow
                            key={unit.clientId}
                            unit={unit}
                            airbases={airbases}
                            squadrons={squadrons}
                            carrierCandidates={allSurfaceUnits.filter((u) => u.clientId !== unit.clientId)}
                            onChange={(patch) => updateUnit(team.clientId, fleet.clientId, unit.clientId, patch)}
                            onRemove={() => removeUnit(team.clientId, fleet.clientId, unit.clientId)}
                            removeDisabledReason={fleet.units.length <= 1 ? "Il faut au moins une unité par task force" : null}
                            isSelectedForPlacement={selectedUnitClientId === unit.clientId}
                            onSelectForPlacement={() => onSelectUnitForPlacement(team.clientId, fleet.clientId, unit.clientId)}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => addFleet(team.clientId)} className="text-xs text-brass-400 hover:text-brass-300">
                + Nouvelle task force
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
