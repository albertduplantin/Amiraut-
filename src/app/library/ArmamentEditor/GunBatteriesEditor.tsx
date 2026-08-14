"use client";

import type { GunBattery } from "./types";
import { GunArcSelect } from "./GunArcSelect";
import { labelClass } from "./styles";

/** Batteries de canons (lignes répétables) — retour utilisateur 2026-08-14, remplace la partie "guns" du textarea JSON `combatProfileText`. */
export function GunBatteriesEditor({ value, onChange }: { value: GunBattery[]; onChange: (next: GunBattery[]) => void }) {
  function updateRow(index: number, patch: Partial<GunBattery>) {
    onChange(value.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }
  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([...value, { calibreMm: 150, count: 1, rangeM: 15000, roundsPerMinute: 6, arc: "ALL_ROUND" }]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={labelClass}>Canons</span>
        <button type="button" onClick={addRow} className="text-xs text-brass-400 hover:text-brass-300">
          + Ajouter une batterie
        </button>
      </div>
      {value.length === 0 && <p className="text-xs text-slate-600">Aucun canon.</p>}
      <div className="space-y-2">
        {value.map((g, i) => (
          <div key={i} className="grid grid-cols-6 items-end gap-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <label className="text-xs text-slate-500">
              Calibre (mm)
              <input
                type="number"
                min={0}
                value={g.calibreMm}
                onChange={(e) => updateRow(i, { calibreMm: Number(e.target.value) })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Nombre
              <input
                type="number"
                min={1}
                value={g.count}
                onChange={(e) => updateRow(i, { count: Number(e.target.value) })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Portée (m)
              <input
                type="number"
                min={0}
                value={g.rangeM}
                onChange={(e) => updateRow(i, { rangeM: Number(e.target.value) })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Cadence (cp/min)
              <input
                type="number"
                min={0}
                value={g.roundsPerMinute}
                onChange={(e) => updateRow(i, { roundsPerMinute: Number(e.target.value) })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Arc
              <GunArcSelect
                value={g.arc}
                onChange={(arc) => updateRow(i, { arc })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <button type="button" onClick={() => removeRow(i)} className="text-xs text-red-500 hover:text-red-400">
              Retirer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
