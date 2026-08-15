"use client";

import type { BuilderUnit, BuilderAirbase, BuilderSquadron, BaseRef } from "./types";

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
 * Ligne d'unité posée (task force ou roster d'escadrille) — nom, classe
 * (lecture seule : le changement de classe n'est pas pris en charge dans ce
 * constructeur, voir ClassRef), position (saisie numérique — remplacée par
 * le clic-carte en Phase 5), et pour un avion, la source de base
 * (aucune/base aérienne/escadrille/porte-avions), retour utilisateur
 * 2026-08-14.
 */
export function UnitRosterRow({
  unit,
  airbases,
  squadrons,
  carrierCandidates,
  onChange,
  onRemove,
  removeDisabledReason,
  isSelectedForPlacement,
  onSelectForPlacement,
}: {
  unit: BuilderUnit;
  airbases: BuilderAirbase[];
  squadrons: BuilderSquadron[];
  /** Unités de surface posées, pour le rattachement porte-avions direct — jamais l'unité elle-même. */
  carrierCandidates: BuilderUnit[];
  onChange: (patch: Partial<BuilderUnit>) => void;
  onRemove: () => void;
  removeDisabledReason: string | null;
  /** Placement interactif sur la carte (Phase 5, retour utilisateur 2026-08-14) — voir ScenarioEditorForm.handleMapClick. */
  isSelectedForPlacement: boolean;
  onSelectForPlacement: () => void;
}) {
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
  const positioned = unit.lat.trim() !== "" && unit.lng.trim() !== "";

  return (
    <li className={`rounded-md border p-2 ${isSelectedForPlacement ? "border-brass-500 bg-brass-950/20 ring-1 ring-brass-500" : "border-slate-800 bg-slate-900/60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={unit.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={`${fieldClass} min-w-[10rem] flex-1`}
          placeholder="Nom de l'unité"
        />
        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400" title={unit.classRef.kind === "inline" ? "Classe héritée du scénario dupliqué, non modifiable ici" : "Classe de bibliothèque"}>
          {unit.classRef.name}
          {unit.classRef.kind === "inline" && " (héritée)"}
        </span>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          Lat
          <input value={unit.lat} onChange={(e) => onChange({ lat: e.target.value })} className={`${fieldClass} w-20`} placeholder="60.0" />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          Lng
          <input value={unit.lng} onChange={(e) => onChange({ lng: e.target.value })} className={`${fieldClass} w-20`} placeholder="-10.0" />
        </label>
        <button
          type="button"
          onClick={onSelectForPlacement}
          title="Placer en cliquant sur la carte"
          className={`text-xs ${isSelectedForPlacement ? "text-brass-300" : "text-brass-500 hover:text-brass-400"}`}
        >
          🎯{isSelectedForPlacement ? " en cours…" : ""}
        </button>
        {!positioned && <span className="text-[11px] text-amber-400">non positionné</span>}
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabledReason !== null}
          title={removeDisabledReason ?? undefined}
          className="ml-auto text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Retirer
        </button>
      </div>

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
    </li>
  );
}
