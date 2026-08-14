"use client";

import type { BombLoadout, BombMethod } from "./types";

const DEFAULT_BOMBS: BombLoadout = { count: 1, weightKg: 250, method: "DIVE" };
const METHOD_LABELS: Record<BombMethod, string> = {
  DIVE: "Piqué (le plus précis)",
  LEVEL: "Horizontal (moins précis contre une cible manoeuvrière)",
  SKIP: "Basse altitude / ricochet",
};

/** Charge de bombes (bloc optionnel unique) — retour utilisateur 2026-08-14, remplace la partie "bombs" du textarea JSON `combatProfileText`. */
export function BombLoadoutEditor({ value, onChange }: { value: BombLoadout | null; onChange: (next: BombLoadout | null) => void }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? DEFAULT_BOMBS : null)} className="h-4 w-4" />
        Équipé de bombes
      </label>
      {value && (
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
          <label className="text-xs text-slate-500">
            Nombre
            <input
              type="number"
              min={1}
              value={value.count}
              onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Poids unitaire (kg)
            <input
              type="number"
              min={0}
              value={value.weightKg}
              onChange={(e) => onChange({ ...value, weightKg: Number(e.target.value) })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Méthode
            <select
              value={value.method}
              onChange={(e) => onChange({ ...value, method: e.target.value as BombMethod })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            >
              {(Object.keys(METHOD_LABELS) as BombMethod[]).map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
