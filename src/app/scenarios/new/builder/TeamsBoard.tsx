"use client";

import { useState, type Dispatch, type DragEvent, type SetStateAction } from "react";
import type { BuilderTeam, BuilderAirbase, BuilderSquadron, BuilderUnit, ClientIdGenerator, LibraryClassOption } from "./types";
import { allUnits } from "./types";
import { UnitRosterRow } from "./UnitRosterRow";
import { AirbasesPanel } from "./AirbasesPanel";
import { allowDrop, readDragPayload, setDragPayload } from "./dragDrop";
import { NATIONS, nationFlag } from "./nations";

const fieldClass = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm";

/** Nationalité d'une unité posée — via sa classe de bibliothèque, ou sa définition en ligne héritée (voir ClassRef, types.ts). */
function unitNation(unit: BuilderUnit, libraryClasses: LibraryClassOption[]): string | undefined {
  const ref = unit.classRef;
  if (ref.kind === "inline") return ref.def.nation;
  return libraryClasses.find((c) => c.id === ref.libraryClassId)?.nation;
}

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
  libraryClasses,
  onAddUnitFromLibrary,
  onOpenAddContainer,
  onOpenUnitWizard,
  onAddAirbaseForTeam,
  onAddStationForTeam,
  onUpdateAirbase,
  onRemoveAirbase,
  selectedAirbaseClientId,
  onSelectAirbaseForPlacement,
  onAssignAircraftToAirbase,
  onAddAircraftToAirbase,
  onOpenAircraftWizard,
  onAddAircraftToCarrier,
}: {
  teams: BuilderTeam[];
  setTeams: Dispatch<SetStateAction<BuilderTeam[]>>;
  airbases: BuilderAirbase[];
  squadrons: BuilderSquadron[];
  nextClientId: ClientIdGenerator;
  /** Placement interactif sur la carte (Phase 5, retour utilisateur 2026-08-14). */
  selectedUnitClientId: string | null;
  onSelectUnitForPlacement: (teamClientId: string, fleetClientId: string, unitClientId: string) => void;
  /** Glisser-déposer (Phase 6, retour utilisateur 2026-08-14) — dépose d'une classe de bibliothèque sur une task force. */
  libraryClasses: LibraryClassOption[];
  onAddUnitFromLibrary: (libClass: LibraryClassOption, teamClientId: string, fleetClientId: string) => void;
  /** Assistants guidés (Phase 3, retour utilisateur 2026-08-15) — coexistent avec les boutons/glisser-déposer ci-dessus. */
  onOpenAddContainer: () => void;
  onOpenUnitWizard: (teamClientId: string, fleetClientId: string) => void;
  /**
   * Bases aériennes/stations d'écoute D'UNE équipe (retour utilisateur
   * 2026-08-15, troisième chantier) — rendues dans la même liste que ses
   * task forces, plus un panneau global séparé "hors des camps".
   */
  onAddAirbaseForTeam: (teamClientId: string) => void;
  onAddStationForTeam: (teamClientId: string) => void;
  onUpdateAirbase: (clientId: string, patch: Partial<BuilderAirbase>) => void;
  onRemoveAirbase: (clientId: string) => void;
  selectedAirbaseClientId: string | null;
  onSelectAirbaseForPlacement: (clientId: string) => void;
  onAssignAircraftToAirbase: (teamClientId: string, fleetClientId: string, unitClientId: string, airbaseKey: string) => void;
  /** Avion créé à la volée sur une base (Phase 4, retour utilisateur 2026-08-15) — glisser-déposer direct d'une classe de bibliothèque. */
  onAddAircraftToAirbase: (libClass: LibraryClassOption, teamClientId: string, airbaseKey: string) => void;
  /** Assistant guidé "+ Avion" (Phase 4, retour utilisateur 2026-08-15). */
  onOpenAircraftWizard: (teamClientId: string, airbaseKey: string) => void;
  /** Avion créé à la volée sur un porte-avions (Phase 4, retour utilisateur 2026-08-15) — glisser-déposer direct sur la ligne du navire. */
  onAddAircraftToCarrier: (libClass: LibraryClassOption, teamClientId: string, carrierUnitName: string) => void;
}) {
  function addTeam() {
    setTeams((prev) => {
      // Cycle sur les 6 nations plutôt qu'alterner bleu/rouge (retour
      // utilisateur 2026-08-15, troisième chantier) — une nouvelle équipe
      // prend la prochaine nation non encore utilisée par les équipes
      // existantes, repli sur un cycle simple si toutes le sont déjà.
      const usedNations = new Set(prev.map((t) => t.nation));
      const nation = NATIONS.find((n) => !usedNations.has(n.value))?.value ?? NATIONS[prev.length % NATIONS.length].value;
      const colorHex = NATIONS.find((n) => n.value === nation)?.colorHex ?? "#94a3b8";
      return [
        ...prev,
        {
          clientId: nextClientId("team"),
          name: nation,
          colorHex,
          nation,
          fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }],
        },
      ];
    });
  }
  function removeTeam(teamClientId: string) {
    setTeams((prev) => prev.filter((t) => t.clientId !== teamClientId));
  }
  function updateTeamName(teamClientId: string, name: string) {
    setTeams((prev) => prev.map((t) => (t.clientId === teamClientId ? { ...t, name } : t)));
  }
  /**
   * Changer le drapeau d'un camp (retour utilisateur 2026-08-15) — verrou
   * confirmé par l'utilisateur : refusé tant qu'au moins une unité d'une
   * AUTRE nationalité est déjà posée dans ce camp (il faut la retirer
   * d'abord), pour ne jamais laisser un camp affiché sous un drapeau qui ne
   * correspond pas à son contenu réel.
   */
  function changeTeamNation(teamClientId: string, nation: string): string | null {
    const team = teams.find((t) => t.clientId === teamClientId);
    if (!team) return null;
    const mismatch = allUnits([team]).find((u) => {
      const n = unitNation(u, libraryClasses);
      return n && n !== nation;
    });
    if (mismatch) return `Impossible : « ${mismatch.name} » (${unitNation(mismatch, libraryClasses)}) est déjà dans ce camp. Retirez-la d'abord.`;
    const colorHex = NATIONS.find((n) => n.value === nation)?.colorHex ?? team.colorHex;
    setTeams((prev) => prev.map((t) => (t.clientId === teamClientId ? { ...t, nation, colorHex } : t)));
    return null;
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
  function handleDropOnFleet(e: DragEvent, teamClientId: string, fleetClientId: string) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload || payload.kind !== "libraryClass") return;
    const libClass = libraryClasses.find((c) => c.id === payload.libraryClassId);
    if (!libClass) return;
    // Un avion ne peut être ajouté qu'à une base aérienne/un porte-avions,
    // pas directement à une task force (Phase 4, retour utilisateur
    // 2026-08-15) — même garde que LibraryBrowserPanel.add().
    if (libClass.category === "AIRCRAFT") {
      setFleetDropError("Un avion ne peut être ajouté qu'à une base aérienne ou un porte-avions, pas directement à une task force.");
      setTimeout(() => setFleetDropError(null), 4000);
      return;
    }
    onAddUnitFromLibrary(libClass, teamClientId, fleetClientId);
  }

  /**
   * Station d'écoute (retour utilisateur 2026-08-15, troisième chantier) —
   * n'accepte que le glisser-déposer d'une classe PASSIVE de la
   * bibliothèque (pas le bouton "+ Ajouter", cette liste de cible-là reste
   * pensée pour les task forces/bases) et au plus une unité à la fois.
   */
  function handleDropOnStation(e: DragEvent, teamClientId: string, fleetClientId: string, currentUnitCount: number) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload || payload.kind !== "libraryClass") return;
    const libClass = libraryClasses.find((c) => c.id === payload.libraryClassId);
    if (!libClass) return;
    if (currentUnitCount > 0) {
      setStationDropError("Retirez d'abord l'unité actuelle avant d'en glisser une autre.");
      setTimeout(() => setStationDropError(null), 3000);
      return;
    }
    if (!libClass.passive) {
      setStationDropError("Seule une classe passive (installation immobile) peut être une station d'écoute.");
      setTimeout(() => setStationDropError(null), 3000);
      return;
    }
    onAddUnitFromLibrary(libClass, teamClientId, fleetClientId);
  }

  const [flagPickerFor, setFlagPickerFor] = useState<string | null>(null);
  const [stationDropError, setStationDropError] = useState<string | null>(null);
  const [fleetDropError, setFleetDropError] = useState<string | null>(null);
  const [nationError, setNationError] = useState<string | null>(null);

  function handleSelectNation(teamClientId: string, nation: string) {
    const error = changeTeamNation(teamClientId, nation);
    if (error) {
      setNationError(error);
      setTimeout(() => setNationError(null), 4000);
      return;
    }
    setFlagPickerFor(null);
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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-sm text-brass-300">Task forces</h3>
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <button type="button" onClick={onOpenAddContainer} className="text-xs text-brass-400 hover:text-brass-300" title="Assistant guidé : équipe → type de conteneur">
            + Task force / Base
          </button>
          <button type="button" onClick={addTeam} className="text-xs text-brass-400 hover:text-brass-300">
            + Équipe
          </button>
        </div>
      </div>
      {nationError && <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300">{nationError}</p>}
      {fleetDropError && <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300">{fleetDropError}</p>}
      <div className="grid grid-cols-1 gap-3">
        {teams.map((team) => {
          const allSurfaceUnits = allUnits(teams).filter((u) => u.classRef.category === "SURFACE_SHIP");
          return (
            <div key={team.clientId} className="panel-brass space-y-3 p-3">
              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFlagPickerFor((prev) => (prev === team.clientId ? null : team.clientId))}
                  title="Nationalité du camp — filtre la bibliothèque"
                  className="flex h-7 w-9 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-950 text-base hover:border-brass-600"
                >
                  {nationFlag(team.nation)}
                </button>
                {flagPickerFor === team.clientId && (
                  <div className="absolute left-0 top-9 z-10 flex flex-wrap gap-1 rounded-md border border-slate-700 bg-slate-950 p-2 shadow-lg">
                    {NATIONS.map((n) => (
                      <button
                        key={n.value}
                        type="button"
                        onClick={() => handleSelectNation(team.clientId, n.value)}
                        title={n.label}
                        className={`rounded px-2 py-1 text-base hover:bg-slate-900 ${team.nation === n.value ? "bg-brass-900/50 ring-1 ring-brass-500" : ""}`}
                      >
                        {n.flag}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  value={team.name}
                  onChange={(e) => updateTeamName(team.clientId, e.target.value)}
                  className={`${fieldClass} flex-1 font-medium`}
                />
                <button
                  type="button"
                  onClick={() => removeTeam(team.clientId)}
                  disabled={teams.length <= 2}
                  title={teams.length <= 2 ? "Il faut au moins deux équipes" : "Supprimer l'équipe"}
                  className="shrink-0 text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2">
                {team.fleets.filter((f) => f.kind !== "station" && f.kind !== "aviation").map((fleet) => (
                  <div
                    key={fleet.clientId}
                    onDragOver={allowDrop}
                    onDrop={(e) => handleDropOnFleet(e, team.clientId, fleet.clientId)}
                    className="rounded-md border border-slate-800 bg-slate-950/40 p-2 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        draggable
                        onDragStart={(e) => setDragPayload(e, { kind: "fleet", teamClientId: team.clientId, fleetClientId: fleet.clientId })}
                        title="Glisser sur la carte pour positionner toute la task force (formation générique)"
                        className="cursor-grab text-brass-500 active:cursor-grabbing"
                      >
                        ⚓
                      </span>
                      <input
                        value={fleet.name}
                        onChange={(e) => updateFleetName(team.clientId, fleet.clientId, e.target.value)}
                        className={`${fieldClass} flex-1 text-xs`}
                      />
                      <button
                        type="button"
                        onClick={() => removeFleet(team.clientId, fleet.clientId)}
                        disabled={team.fleets.length <= 1}
                        title={team.fleets.length <= 1 ? "Il faut au moins une task force par équipe" : "Supprimer la task force"}
                        className="shrink-0 text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenUnitWizard(team.clientId, fleet.clientId)}
                      className="mt-1 text-[11px] text-brass-400 hover:text-brass-300"
                      title="Choisir un type de bâtiment, puis la classe précise"
                    >
                      + Bâtiment
                    </button>
                    {fleet.units.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-600">Aucune unité — ajoutez-en depuis la bibliothèque.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {fleet.units.map((unit) => (
                          <UnitRosterRow
                            key={unit.clientId}
                            unit={unit}
                            teamClientId={team.clientId}
                            fleetClientId={fleet.clientId}
                            airbases={airbases}
                            squadrons={squadrons}
                            carrierCandidates={allSurfaceUnits.filter((u) => u.clientId !== unit.clientId)}
                            libraryClasses={libraryClasses}
                            onChange={(patch) => updateUnit(team.clientId, fleet.clientId, unit.clientId, patch)}
                            onRemove={() => removeUnit(team.clientId, fleet.clientId, unit.clientId)}
                            onAddAircraftToCarrier={onAddAircraftToCarrier}
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

              <AirbasesPanel
                airbases={airbases.filter((a) => a.teamClientId === team.clientId)}
                libraryClasses={libraryClasses}
                onAdd={() => onAddAirbaseForTeam(team.clientId)}
                onUpdate={onUpdateAirbase}
                onRemove={onRemoveAirbase}
                selectedAirbaseClientId={selectedAirbaseClientId}
                onSelectForPlacement={onSelectAirbaseForPlacement}
                onAssignAircraft={onAssignAircraftToAirbase}
                onAddAircraftFromLibrary={onAddAircraftToAirbase}
                onOpenAircraftWizard={onOpenAircraftWizard}
              />

              <div className="space-y-2 border-t border-slate-800 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Stations d&apos;écoute</h4>
                  <button type="button" onClick={() => onAddStationForTeam(team.clientId)} className="text-[11px] text-brass-400 hover:text-brass-300">
                    + Nouvelle station
                  </button>
                </div>
                {stationDropError && <p className="text-xs text-red-400">{stationDropError}</p>}
                {team.fleets.filter((f) => f.kind === "station").length === 0 && <p className="text-xs text-slate-600">Aucune station d&apos;écoute.</p>}
                <ul className="space-y-2">
                  {team.fleets
                    .filter((f) => f.kind === "station")
                    .map((station) => (
                      <li
                        key={station.clientId}
                        onDragOver={allowDrop}
                        onDrop={(e) => handleDropOnStation(e, team.clientId, station.clientId, station.units.length)}
                        className="rounded-md border border-slate-800 bg-slate-950/40 p-2"
                      >
                        <div className="flex items-center gap-2">
                          <span title="Station d'écoute — installation passive isolée">📡</span>
                          <input
                            value={station.name}
                            onChange={(e) => updateFleetName(team.clientId, station.clientId, e.target.value)}
                            className={`${fieldClass} flex-1 text-xs`}
                          />
                          <button
                            type="button"
                            onClick={() => removeFleet(team.clientId, station.clientId)}
                            className="shrink-0 text-xs text-red-500 hover:text-red-400"
                            title="Supprimer la station"
                          >
                            ✕
                          </button>
                        </div>
                        {station.units.length === 0 ? (
                          <p className="mt-1.5 text-[11px] text-slate-600">Glissez ici une classe passive de la bibliothèque.</p>
                        ) : (
                          <ul className="mt-1.5">
                            {station.units.map((unit) => (
                              <UnitRosterRow
                                key={unit.clientId}
                                unit={unit}
                                teamClientId={team.clientId}
                                fleetClientId={station.clientId}
                                airbases={airbases}
                                squadrons={squadrons}
                                carrierCandidates={[]}
                                libraryClasses={libraryClasses}
                                onChange={(patch) => updateUnit(team.clientId, station.clientId, unit.clientId, patch)}
                                onRemove={() => removeUnit(team.clientId, station.clientId, unit.clientId)}
                                onAddAircraftToCarrier={onAddAircraftToCarrier}
                                removeDisabledReason={null}
                                isSelectedForPlacement={selectedUnitClientId === unit.clientId}
                                onSelectForPlacement={() => onSelectUnitForPlacement(team.clientId, station.clientId, unit.clientId)}
                              />
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
