"use client";

import type { TorpedoTubes } from "./types";
import { GunArcSelect } from "./GunArcSelect";

const DEFAULT_TUBES: TorpedoTubes = { count: 1, rangeM: 5000, speedKnots: 30, arc: "BROADSIDE" };

/** Tubes lance-torpilles (bloc optionnel unique) — retour utilisateur 2026-08-14, remplace la partie "torpedoTubes" du textarea JSON `combatProfileText`. */
export function TorpedoTubesEditor({ value, onChange }: { value: TorpedoTubes | null; onChange: (next: TorpedoTubes | null) => void }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? DEFAULT_TUBES : null)} className="h-4 w-4" />
        Équipé de tubes lance-torpilles
      </label>
      {value && (
        <div className="mt-2 grid grid-cols-4 gap-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
          <label className="text-xs text-slate-500">
            Nombre de tubes
            <input
              type="number"
              min={1}
              value={value.count}
              onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Portée (m)
            <input
              type="number"
              min={0}
              value={value.rangeM}
              onChange={(e) => onChange({ ...value, rangeM: Number(e.target.value) })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Vitesse (nds)
            <input
              type="number"
              min={0}
              value={value.speedKnots}
              onChange={(e) => onChange({ ...value, speedKnots: Number(e.target.value) })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            Arc
            <GunArcSelect
              value={value.arc ?? "BROADSIDE"}
              onChange={(arc) => onChange({ ...value, arc })}
              className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </label>
        </div>
      )}
    </div>
  );
}
