"use client";

import { useState } from "react";
import type { BuilderAirbase } from "./types";
import { allowDrop, readDragPayload } from "./dragDrop";

const fieldClass = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs";

/**
 * Bases aériennes (retour utilisateur 2026-08-14) : créées une fois,
 * référencées par plusieurs avions ou escadrilles (voir ScenarioAirbase) —
 * la position se règle ici en saisie numérique ou par clic-carte (Phase 5).
 * Suppression = détache (le parent nettoie les unités/escadrilles qui la
 * référencent) plutôt que de bloquer, c'est un champ optionnel côté
 * schéma. Chaque carte accepte aussi le glisser-déposer d'un avion déjà
 * en task force (Phase 6) pour l'y rattacher directement — rejeté si
 * l'unité déposée n'est pas un avion.
 */
export function AirbasesPanel({
  airbases,
  onAdd,
  onUpdate,
  onRemove,
  selectedAirbaseClientId,
  onSelectForPlacement,
  onAssignAircraft,
}: {
  airbases: BuilderAirbase[];
  onAdd: () => void;
  onUpdate: (clientId: string, patch: Partial<BuilderAirbase>) => void;
  onRemove: (clientId: string) => void;
  /** Placement interactif sur la carte (Phase 5, retour utilisateur 2026-08-14). */
  selectedAirbaseClientId: string | null;
  onSelectForPlacement: (clientId: string) => void;
  /** Glisser-déposer (Phase 6, retour utilisateur 2026-08-14). */
  onAssignAircraft: (teamClientId: string, fleetClientId: string, unitClientId: string, airbaseKey: string) => void;
}) {
  const [dropError, setDropError] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent, airbaseKey: string) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload || payload.kind !== "rosterUnit") return;
    if (payload.category !== "AIRCRAFT") {
      setDropError("Seul un avion peut être rattaché à une base aérienne.");
      setTimeout(() => setDropError(null), 3000);
      return;
    }
    onAssignAircraft(payload.teamClientId, payload.fleetClientId, payload.unitClientId, airbaseKey);
  }

  return (
    <div className="panel-brass space-y-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm text-brass-300">Bases aériennes</h3>
        <button type="button" onClick={onAdd} className="text-xs text-brass-400 hover:text-brass-300">
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
            onDrop={(e) => handleDrop(e, a.key)}
            className={`rounded-md border p-2 transition-colors ${selectedAirbaseClientId === a.clientId ? "border-brass-500 bg-brass-950/20 ring-1 ring-brass-500" : "border-slate-800 bg-slate-900/60"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
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
          </li>
        ))}
      </ul>
    </div>
  );
}
