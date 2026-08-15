"use client";

import { useMemo, useState } from "react";
import type { LibraryClassOption } from "./types";
import { AIRCRAFT_TYPES, typeLabel } from "./unitTypeTaxonomy";

/**
 * Assistant "+ Avion" (Phase 4, retour utilisateur 2026-08-15, troisième
 * chantier) — variante d'`AddUnitWizardModal.tsx` (même squelette : puces
 * de type → liste filtrée par nation → choix) pour une base aérienne. Un
 * porte-avions gagnera le même bouton en Phase 5, une fois son affichage
 * dépliant construit (voir le plan) — le glisser-déposer d'une classe
 * avion directement sur le porte-avions fonctionne déjà sans attendre.
 */
export function AddAircraftWizardModal({
  targetLabel,
  libraryClasses,
  preferredNation,
  onClose,
  onPick,
}: {
  targetLabel: string;
  libraryClasses: LibraryClassOption[];
  preferredNation?: string;
  onClose: () => void;
  onPick: (libClass: LibraryClassOption) => void;
}) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [nationFilter, setNationFilter] = useState(preferredNation ?? "");

  const aircraftClasses = useMemo(() => libraryClasses.filter((c) => c.category === "AIRCRAFT"), [libraryClasses]);

  const countByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of aircraftClasses) counts.set(c.iconKey, (counts.get(c.iconKey) ?? 0) + 1);
    return counts;
  }, [aircraftClasses]);

  const nations = useMemo(() => Array.from(new Set(aircraftClasses.map((c) => c.nation))).sort(), [aircraftClasses]);

  const filtered = useMemo(() => {
    if (!selectedType) return [];
    return aircraftClasses.filter((c) => c.iconKey === selectedType && (!nationFilter || c.nation === nationFilter));
  }, [aircraftClasses, selectedType, nationFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="chart-room-bg max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-800 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-brass-300">Ajouter un avion — {targetLabel}</h2>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type d&apos;avion</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {AIRCRAFT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSelectedType(t.key)}
              disabled={(countByType.get(t.key) ?? 0) === 0}
              className={`rounded-full border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-30 ${
                selectedType === t.key ? "border-brass-500 bg-brass-950/30 text-brass-300" : "border-slate-700 hover:bg-slate-900"
              }`}
            >
              {t.label} {countByType.get(t.key) ? `(${countByType.get(t.key)})` : ""}
            </button>
          ))}
        </div>

        {selectedType && (
          <div className="mt-4 border-t border-slate-800 pt-3">
            <label className="block text-xs font-medium text-slate-400">
              Nationalité (filtre)
              <select value={nationFilter} onChange={(e) => setNationFilter(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
                <option value="">Toutes</option>
                {nations.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {filtered.length === 0 && <p className="text-xs text-slate-600">Aucune classe {typeLabel("AIRCRAFT", selectedType).toLowerCase()} pour ce filtre.</p>}
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(c);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-left text-sm hover:border-brass-600 hover:bg-brass-950/20"
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-slate-500">{c.nation}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
