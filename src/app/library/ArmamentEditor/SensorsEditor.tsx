"use client";

import type { Sensor, SensorType } from "./types";
import { labelClass } from "./styles";

const SENSOR_LABELS: Record<SensorType, string> = {
  RADAR: "Radar",
  VISUAL: "Visuel",
  HYDROPHONE: "Hydrophone",
  SONAR: "Sonar",
  HF_DF: "Goniométrie HF (HF/DF)",
};

/**
 * Capteurs (lignes répétables type + portée) — retour utilisateur
 * 2026-08-14, remplace le textarea JSON `sensorsText` de LibraryForm.tsx.
 * Au moins un capteur requis côté schéma (SensorSchema.min(1)) — pas
 * appliqué ici, laissé au message d'erreur serveur si oublié, comme les
 * autres champs numériques du formulaire.
 */
export function SensorsEditor({ value, onChange }: { value: Sensor[]; onChange: (next: Sensor[]) => void }) {
  function updateRow(index: number, patch: Partial<Sensor>) {
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function removeRow(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }
  function addRow() {
    onChange([...value, { type: "RADAR", rangeNm: 10 }]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={labelClass}>Capteurs</span>
        <button type="button" onClick={addRow} className="text-xs text-brass-400 hover:text-brass-300">
          + Ajouter un capteur
        </button>
      </div>
      {value.length === 0 && <p className="text-xs text-slate-600">Aucun capteur — au moins un est requis.</p>}
      <div className="space-y-2">
        {value.map((sensor, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <select
              value={sensor.type}
              onChange={(e) => updateRow(i, { type: e.target.value as SensorType })}
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            >
              {(Object.keys(SENSOR_LABELS) as SensorType[]).map((t) => (
                <option key={t} value={t}>
                  {SENSOR_LABELS[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-500">
              Portée
              <input
                type="number"
                min={0}
                step="0.5"
                value={sensor.rangeNm}
                onChange={(e) => updateRow(i, { rangeNm: Number(e.target.value) })}
                className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
              />
              nm
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
