"use client";

import { useState } from "react";
import type { BuilderUnit, BuilderAirbase, BuilderSquadron, BaseRef, LibraryClassOption } from "./types";
import { resolveClassInfo } from "./types";
import { setDragPayload, readDragPayload, allowDrop } from "./dragDrop";

const fieldClass = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs";

function baseRefToOptionValue(ref: BaseRef): string {
  switch (ref.kind) {
    case "none":
      return "none";
    case "literal":
      return "literal";
    case "airbase":
      return `airbase:${ref.key}`;
    case "squadron":
      return `squadron:${ref.key}`;
    case "carrier":
      return `carrier:${ref.unitName}`;
  }
}

/**
 * Ligne d'unité posée (task force ou roster d'escadrille) — juste le nom
 * et un bouton 🎯 pour la positionner (retour utilisateur 2026-08-15,
 * troisième chantier, Phase 5 : "inutile de mettre des infos en plus sur
 * les bâtiments comme la latitude longitude etc.") ; pour un avion, la
 * source de base (aucune/base aérienne/escadrille/porte-avions).
 *
 * Porte-avions (Phase 4/5, retour utilisateur 2026-08-15 — "en cliquant
 * sur le porte-avions ou en glissant déposant dessus lui ajouter des
 * avions") : une ligne dont la classe est un porte-avions (iconKey
 * "carrier") accepte le glisser-déposer d'une classe AVION de la
 * bibliothèque et gagne une flèche d'expansion qui déplie la liste de ses
 * avions déjà rattachés, chacun avec son propre 🎯, plus un bouton
 * "+ Avion" (assistant guidé, comme sur une base aérienne).
 */
export function UnitRosterRow({
  unit,
  teamClientId,
  fleetClientId,
  airbases,
  squadrons,
  carrierCandidates,
  libraryClasses,
  onChange,
  onRemove,
  onAddAircraftToCarrier,
  removeDisabledReason,
  isSelectedForPlacement,
  onSelectForPlacement,
  isExpanded,
  onToggleExpanded,
  assignedAircraft,
  onOpenAircraftWizardForCarrier,
}: {
  unit: BuilderUnit;
  /** Nécessaires uniquement pour le glisser-déposer d'un avion vers une base/escadrille/porte-avions. */
  teamClientId: string;
  fleetClientId: string;
  airbases: BuilderAirbase[];
  squadrons: BuilderSquadron[];
  /** Unités de surface posées, pour le rattachement porte-avions direct — jamais l'unité elle-même. */
  carrierCandidates: BuilderUnit[];
  /** Pour détecter si CETTE unité est un porte-avions (iconKey "carrier") — voir resolveClassInfo, types.ts. */
  libraryClasses: LibraryClassOption[];
  onChange: (patch: Partial<BuilderUnit>) => void;
  onRemove: () => void;
  /** Avion créé à la volée sur ce porte-avions (Phase 4, retour utilisateur 2026-08-15). */
  onAddAircraftToCarrier: (libClass: LibraryClassOption, teamClientId: string, carrierUnitName: string) => void;
  removeDisabledReason: string | null;
  /** Placement interactif sur la carte (Phase 5, retour utilisateur 2026-08-14) — voir ScenarioEditorForm.handleMapClick. */
  isSelectedForPlacement: boolean;
  onSelectForPlacement: () => void;
  /** Arborescence dépliante (Phase 5, retour utilisateur 2026-08-15) — pertinent seulement pour un porte-avions, ignoré sinon. */
  isExpanded: boolean;
  onToggleExpanded: () => void;
  assignedAircraft: { unit: BuilderUnit; onRemove: () => void; isSelectedForPlacement: boolean; onSelectForPlacement: () => void }[];
  onOpenAircraftWizardForCarrier: () => void;
}) {
  const [dropError, setDropError] = useState<string | null>(null);

  function handleBaseRefSelect(optionValue: string) {
    if (optionValue === "none") return onChange({ baseRef: { kind: "none" } });
    if (optionValue === "literal" && unit.baseRef.kind === "literal") return onChange({ baseRef: unit.baseRef });
    const sep = optionValue.indexOf(":");
    const kind = optionValue.slice(0, sep);
    const ref = optionValue.slice(sep + 1);
    if (kind === "airbase") onChange({ baseRef: { kind: "airbase", key: ref } });
    else if (kind === "squadron") onChange({ baseRef: { kind: "squadron", key: ref } });
    else if (kind === "carrier") onChange({ baseRef: { kind: "carrier", unitName: ref } });
  }

  const isAircraft = unit.classRef.category === "AIRCRAFT";
  const isCarrier = unit.classRef.category === "SURFACE_SHIP" && resolveClassInfo(unit.classRef, libraryClasses)?.iconKey === "carrier";

  function handleDropOnCarrier(e: React.DragEvent) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload || payload.kind !== "libraryClass") return;
    const libClass = libraryClasses.find((c) => c.id === payload.libraryClassId);
    if (!libClass) return;
    if (libClass.category !== "AIRCRAFT") {
      setDropError("Seul un avion peut être rattaché à un porte-avions.");
      setTimeout(() => setDropError(null), 3000);
      return;
    }
    onAddAircraftToCarrier(libClass, teamClientId, unit.name);
  }

  return (
    <li
      draggable={isAircraft}
      onDragStart={
        isAircraft
          ? (e) => setDragPayload(e, { kind: "rosterUnit", teamClientId, fleetClientId, unitClientId: unit.clientId, category: unit.classRef.category })
          : undefined
      }
      onDragOver={isCarrier ? allowDrop : undefined}
      onDrop={isCarrier ? handleDropOnCarrier : undefined}
      title={isAircraft ? "Glisser vers une base aérienne ou une escadrille pour l'y rattacher" : isCarrier ? "Glisser un avion de la bibliothèque ici pour l'y rattacher" : undefined}
      className={`rounded-md border p-2 transition-colors ${isAircraft ? "cursor-grab active:cursor-grabbing" : ""} ${isSelectedForPlacement ? "border-brass-500 bg-brass-950/20 ring-1 ring-brass-500" : "border-slate-800 bg-slate-900/60"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isCarrier && (
          <button type="button" onClick={onToggleExpanded} className="shrink-0 text-slate-500 hover:text-slate-300" title={isExpanded ? "Replier" : "Déplier"}>
            {isExpanded ? "▾" : "▸"}
          </button>
        )}
        <input
          value={unit.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={`${fieldClass} min-w-[8rem] flex-1`}
          placeholder="Nom de l'unité"
        />
        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400" title={unit.classRef.kind === "inline" ? "Classe héritée du scénario dupliqué, non modifiable ici" : "Classe de bibliothèque"}>
          {unit.classRef.name}
          {unit.classRef.kind === "inline" && " (héritée)"}
          {isCarrier && " 🛫"}
        </span>
        <button
          type="button"
          onClick={onSelectForPlacement}
          title="Placer en cliquant sur la carte"
          className={`shrink-0 text-xs ${isSelectedForPlacement ? "text-brass-300" : "text-brass-500 hover:text-brass-400"}`}
        >
          🎯
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabledReason !== null}
          title={removeDisabledReason ?? "Retirer"}
          className="ml-auto shrink-0 text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Retirer
        </button>
      </div>

      {dropError && <p className="mt-1 text-[11px] text-red-400">{dropError}</p>}

      {isAircraft && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-1.5">
          <span className="text-[11px] text-slate-500">Base :</span>
          <select value={baseRefToOptionValue(unit.baseRef)} onChange={(e) => handleBaseRefSelect(e.target.value)} className={fieldClass}>
            <option value="none">Aucune</option>
            {unit.baseRef.kind === "literal" && <option value="literal">Position directe (héritée)</option>}
            {airbases.map((a) => (
              <option key={a.clientId} value={`airbase:${a.key}`}>
                Base aérienne : {a.name || a.key}
              </option>
            ))}
            {squadrons.map((s) => (
              <option key={s.clientId} value={`squadron:${s.key}`}>
                Escadrille : {s.name || s.key}
              </option>
            ))}
            {carrierCandidates.map((c) => (
              <option key={c.clientId} value={`carrier:${c.name}`}>
                Porte-avions : {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isCarrier && isExpanded && (
        <div className="mt-1.5 space-y-1 border-t border-slate-800 pt-1.5">
          <button type="button" onClick={onOpenAircraftWizardForCarrier} className="text-[11px] text-brass-400 hover:text-brass-300" title="Choisir un type d'avion, puis la classe précise">
            + Avion
          </button>
          {assignedAircraft.length === 0 ? (
            <p className="text-[11px] text-slate-600">Aucun avion rattaché — glissez-en un depuis la bibliothèque.</p>
          ) : (
            <ul className="space-y-1">
              {assignedAircraft.map((a) => (
                <li key={a.unit.clientId} className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px]">
                  <span className="flex-1 truncate">{a.unit.name}</span>
                  <button type="button" onClick={a.onSelectForPlacement} title="Placer en cliquant sur la carte" className={a.isSelectedForPlacement ? "text-brass-300" : "text-brass-500 hover:text-brass-400"}>
                    🎯
                  </button>
                  <button type="button" onClick={a.onRemove} className="text-red-500 hover:text-red-400" title="Retirer">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
