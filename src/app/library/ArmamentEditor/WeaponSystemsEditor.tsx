"use client";

import type { WeaponSystemRow } from "./types";
import { labelClass } from "./styles";

/**
 * Fiche d'armement affichée aux joueurs (texte libre, jamais lu par le
 * moteur de combat — voir UnitClass.weaponSystems) — retour utilisateur
 * 2026-08-14, remplace le textarea JSON `weaponSystemsText`. Modélisé
 * comme des lignes libellé/valeur plutôt qu'un objet JSON arbitraire :
 * suffisant pour l'usage réel constaté (ex. "mainGuns": "6 x 152mm").
 */
export function WeaponSystemsEditor({ value, onChange }: { value: WeaponSystemRow[]; onChange: (next: WeaponSystemRow[]) => void }) {
  function updateRow(index: number, patch: Partial<WeaponSystemRow>) {
    onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([...value, { label: "", value: "" }]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={labelClass}>Fiche d&apos;armement affichée aux joueurs (optionnel)</span>
        <button type="button" onClick={addRow} className="text-xs text-brass-400 hover:text-brass-300">
          + Ajouter une ligne
        </button>
      </div>
      {value.length === 0 && <p className="text-xs text-slate-600">Aucune ligne.</p>}
      <div className="space-y-2">
        {value.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={row.label}
              onChange={(e) => updateRow(i, { label: e.target.value })}
              placeholder="mainGuns"
              className="w-1/3 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
            <input
              value={row.value}
              onChange={(e) => updateRow(i, { value: e.target.value })}
              placeholder="6 x 152mm"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
            <button type="button" onClick={() => removeRow(i)} className="text-xs text-red-500 hover:text-red-400">
              Retirer
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
