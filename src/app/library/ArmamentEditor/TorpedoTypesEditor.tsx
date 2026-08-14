"use client";

import type { TorpedoType } from "./types";
import { labelClass } from "./styles";

/**
 * Types de torpilles au choix (sous-marins à torpilles multiples, ex: G7a
 * vapeur vs G7e électrique) — retour utilisateur 2026-08-14, remplace la
 * partie "torpedoTypes" du textarea JSON `combatProfileText`. Absent =
 * type unique défini par TorpedoTubesEditor, comportement inchangé.
 */
export function TorpedoTypesEditor({ value, onChange }: { value: TorpedoType[]; onChange: (next: TorpedoType[]) => void }) {
  function updateRow(index: number, patch: Partial<TorpedoType>) {
    onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }
  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([...value, { id: `type-${value.length + 1}`, label: "", speedKnots: 30, rangeM: 5000, wakeVisible: true }]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={labelClass}>Types de torpilles au choix (optionnel)</span>
        <button type="button" onClick={addRow} className="text-xs text-brass-400 hover:text-brass-300">
          + Ajouter un type
        </button>
      </div>
      {value.length === 0 && <p className="text-xs text-slate-600">Un seul type — celui défini ci-dessus.</p>}
      <div className="space-y-2">
        {value.map((t, i) => (
          <div key={i} className="grid grid-cols-6 items-end gap-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <label className="text-xs text-slate-500">
              Identifiant
              <input
                value={t.id}
                onChange={(e) => updateRow(i, { id: e.target.value })}
                placeholder="g7a"
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Nom affiché
              <input
                value={t.label}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="G7a (vapeur)"
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Vitesse (nds)
              <input
                type="number"
                min={0}
                value={t.speedKnots}
                onChange={(e) => updateRow(i, { speedKnots: Number(e.target.value) })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              Portée (m)
              <input
                type="number"
                min={0}
                value={t.rangeM}
                onChange={(e) => updateRow(i, { rangeM: Number(e.target.value) })}
                className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-500" title="Sillage de bulles visible en surface, trahit la position du tireur (G7a) — contrairement à une torpille électrique (G7e)">
              <input type="checkbox" checked={t.wakeVisible} onChange={(e) => updateRow(i, { wakeVisible: e.target.checked })} className="h-4 w-4" />
              Sillage visible
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
