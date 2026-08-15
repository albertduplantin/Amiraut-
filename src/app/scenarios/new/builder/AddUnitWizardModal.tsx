"use client";

import { useMemo, useState } from "react";
import type { LibraryClassOption } from "./types";
import { SHIP_TYPES, typeLabel } from "./unitTypeTaxonomy";

const SUBMARINE_CHIP = { key: "submarine", label: "Sous-marin" };
const TYPE_CHIPS = [...SHIP_TYPES, SUBMARINE_CHIP];

/**
 * Assistant "clic sur une task force" (Phase 3, retour utilisateur
 * 2026-08-15) : "choisir le type de bâtiment [...] la liste des bâtiments
 * se déploie [...] choisir le bateau". Un raccourci guidé au chemin
 * bouton/glisser-déposer de la bibliothèque (Phase 4/6, LibraryBrowserPanel)
 * — pas un remplacement. Puces de type plutôt qu'un `<select>` : montre
 * d'un coup d'œil les types disponibles pour CETTE task force, dépliés
 * uniquement une fois un type choisi (un croiseur lourd n'a de sens que
 * pour une task force navale — pas de variante base aérienne/escadrille,
 * celles-ci restent peuplées uniquement par glisser-déposer).
 */
export function AddUnitWizardModal({
  fleetName,
  libraryClasses,
  preferredNation,
  onClose,
  onPick,
}: {
  fleetName: string;
  libraryClasses: LibraryClassOption[];
  preferredNation?: string;
  onClose: () => void;
  onPick: (libClass: LibraryClassOption) => void;
}) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [nationFilter, setNationFilter] = useState(preferredNation ?? "");

  const shipAndSubClasses = useMemo(() => libraryClasses.filter((c) => c.category === "SURFACE_SHIP" || c.category === "SUBMARINE"), [libraryClasses]);

  const countByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of shipAndSubClasses) {
      const key = c.category === "SUBMARINE" ? "submarine" : c.iconKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [shipAndSubClasses]);

  const nations = useMemo(() => Array.from(new Set(shipAndSubClasses.map((c) => c.nation))).sort(), [shipAndSubClasses]);

  const filtered = useMemo(() => {
    if (!selectedType) return [];
    return shipAndSubClasses.filter((c) => {
      const typeKey = c.category === "SUBMARINE" ? "submarine" : c.iconKey;
      if (typeKey !== selectedType) return false;
      if (nationFilter && c.nation !== nationFilter) return false;
      return true;
    });
  }, [shipAndSubClasses, selectedType, nationFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="chart-room-bg max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-800 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-brass-300">Ajouter un bâtiment — {fleetName}</h2>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type de bâtiment</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TYPE_CHIPS.map((t) => (
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
              {filtered.length === 0 && <p className="text-xs text-slate-600">Aucune classe {typeLabel("SURFACE_SHIP", selectedType).toLowerCase()} pour ce filtre.</p>}
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
