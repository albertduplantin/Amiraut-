"use client";

import { useState } from "react";
import type { BuilderAirbase, LibraryClassOption } from "./types";
import { allowDrop, readDragPayload, setDragPayload } from "./dragDrop";

const fieldClass = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs";

/**
 * Bases aériennes d'UNE équipe (retour utilisateur 2026-08-15, troisième
 * chantier) — rendu une fois par équipe, imbriqué dans sa carte
 * (TeamsBoard.tsx), plutôt qu'un panneau global séparé "hors des camps"
 * (c'était la friction exacte remontée : "quand j'ajoute une base
 * aérienne, elle est créée dans la partie gauche à l'extérieure des
 * camps"). Pas de wrapper `panel-brass` propre — déjà dans celui de
 * l'équipe. `onAdd` est pré-lié à l'équipe par l'appelant (TeamsBoard),
 * cette liste ne reçoit que les bases DÉJÀ filtrées pour cette équipe.
 *
 * Suppression = détache (le parent nettoie les unités/escadrilles qui la
 * référencent) plutôt que de bloquer, c'est un champ optionnel côté
 * schéma. Chaque carte accepte le glisser-déposer d'un avion déjà en task
 * force (Phase 6, réassigne) OU d'une classe de bibliothèque directement
 * (Phase 4, retour utilisateur 2026-08-15 — crée l'avion à la volée,
 * rattaché tout de suite) — rejeté dans les deux cas si ce n'est pas un
 * avion.
 */
export function AirbasesPanel({
  airbases,
  libraryClasses,
  onAdd,
  onUpdate,
  onRemove,
  selectedAirbaseClientId,
  onSelectForPlacement,
  onAssignAircraft,
  onAddAircraftFromLibrary,
  onOpenAircraftWizard,
}: {
  airbases: BuilderAirbase[];
  libraryClasses: LibraryClassOption[];
  onAdd: () => void;
  onUpdate: (clientId: string, patch: Partial<BuilderAirbase>) => void;
  onRemove: (clientId: string) => void;
  /** Placement interactif sur la carte (Phase 5, retour utilisateur 2026-08-14). */
  selectedAirbaseClientId: string | null;
  onSelectForPlacement: (clientId: string) => void;
  /** Glisser-déposer (Phase 6, retour utilisateur 2026-08-14) — réassigne un avion déjà en flotte. */
  onAssignAircraft: (teamClientId: string, fleetClientId: string, unitClientId: string, airbaseKey: string) => void;
  /** Glisser-déposer direct d'une classe de bibliothèque (Phase 4, retour utilisateur 2026-08-15) — crée l'avion à la volée. */
  onAddAircraftFromLibrary: (libClass: LibraryClassOption, teamClientId: string, airbaseKey: string) => void;
  /** Assistant guidé "+ Avion" (Phase 4, retour utilisateur 2026-08-15). */
  onOpenAircraftWizard: (teamClientId: string, airbaseKey: string) => void;
}) {
  const [dropError, setDropError] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent, a: BuilderAirbase) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload) return;
    if (payload.kind === "rosterUnit") {
      if (payload.category !== "AIRCRAFT") {
        setDropError("Seul un avion peut être rattaché à une base aérienne.");
        setTimeout(() => setDropError(null), 3000);
        return;
      }
      onAssignAircraft(payload.teamClientId, payload.fleetClientId, payload.unitClientId, a.key);
      return;
    }
    if (payload.kind === "libraryClass") {
      const libClass = libraryClasses.find((c) => c.id === payload.libraryClassId);
      if (!libClass) return;
      if (libClass.category !== "AIRCRAFT") {
        setDropError("Seul un avion peut être rattaché à une base aérienne.");
        setTimeout(() => setDropError(null), 3000);
        return;
      }
      onAddAircraftFromLibrary(libClass, a.teamClientId, a.key);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bases aériennes</h4>
        <button type="button" onClick={onAdd} className="text-[11px] text-brass-400 hover:text-brass-300">
          + Nouvelle base
        </button>
      </div>
      {dropError && <p className="text-xs text-red-400">{dropError}</p>}
      {airbases.length === 0 && <p className="text-xs text-slate-600">Aucune base aérienne.</p>}
      <ul className="space-y-2">
        {airbases.map((a) => (
          <li
            key={a.clientId}
            onDragOver={allowDrop}
            onDrop={(e) => handleDrop(e, a)}
            className={`rounded-md border p-2 transition-colors ${selectedAirbaseClientId === a.clientId ? "border-brass-500 bg-brass-950/20 ring-1 ring-brass-500" : "border-slate-800 bg-slate-950/40"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                draggable
                onDragStart={(e) => setDragPayload(e, { kind: "airbase", airbaseClientId: a.clientId })}
                title="Glisser sur la carte pour positionner la base"
                className="cursor-grab text-brass-500 active:cursor-grabbing"
              >
                ✈
              </span>
              <input value={a.name} onChange={(e) => onUpdate(a.clientId, { name: e.target.value })} placeholder="Nom (ex: Reykjavik)" className={`${fieldClass} min-w-[8rem] flex-1`} />
              <input value={a.key} onChange={(e) => onUpdate(a.clientId, { key: e.target.value })} placeholder="clé" className={`${fieldClass} w-24`} title="Clé stable, référencée par les unités/escadrilles" />
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                Lat
                <input value={a.lat} onChange={(e) => onUpdate(a.clientId, { lat: e.target.value })} className={`${fieldClass} w-20`} />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                Lng
                <input value={a.lng} onChange={(e) => onUpdate(a.clientId, { lng: e.target.value })} className={`${fieldClass} w-20`} />
              </label>
              <button
                type="button"
                onClick={() => onSelectForPlacement(a.clientId)}
                title="Placer en cliquant sur la carte"
                className={`text-xs ${selectedAirbaseClientId === a.clientId ? "text-brass-300" : "text-brass-500 hover:text-brass-400"}`}
              >
                🎯{selectedAirbaseClientId === a.clientId ? " en cours…" : ""}
              </button>
              <button type="button" onClick={() => onRemove(a.clientId)} className="ml-auto text-xs text-red-500 hover:text-red-400">
                Supprimer
              </button>
            </div>
            <button
              type="button"
              onClick={() => onOpenAircraftWizard(a.teamClientId, a.key)}
              className="mt-1 text-[11px] text-brass-400 hover:text-brass-300"
              title="Choisir un type d'avion, puis la classe précise"
            >
              + Avion
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
