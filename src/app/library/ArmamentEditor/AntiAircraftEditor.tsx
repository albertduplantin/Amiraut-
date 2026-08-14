"use client";

import type { AntiAircraftBattery } from "./types";

const DEFAULT_AA: AntiAircraftBattery = { gunCount: 4 };

/** DCA embarquée (bloc optionnel unique, navires/sous-marins en surface) — retour utilisateur 2026-08-14, remplace la partie "antiAircraft" du textarea JSON `combatProfileText`. */
export function AntiAircraftEditor({ value, onChange }: { value: AntiAircraftBattery | null; onChange: (next: AntiAircraftBattery | null) => void }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? DEFAULT_AA : null)} className="h-4 w-4" />
        Équipé de DCA
      </label>
      {value && (
        <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
          <label className="text-xs text-slate-500" title="Chances d'abattre l'avion attaquant — voir combat.ts, resolveDcaAttack">
            Nombre de pièces
            <input
              type="number"
              min={1}
              value={value.gunCount}
              onChange={(e) => onChange({ gunCount: Number(e.target.value) })}
              className="mt-0.5 block w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}
