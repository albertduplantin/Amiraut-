"use client";

import { useState } from "react";
import type { LibraryClassOption, BuilderTeam, UnitCategory } from "./types";

const CATEGORY_LABEL: Record<UnitCategory, string> = {
  SURFACE_SHIP: "Navires de surface",
  SUBMARINE: "Sous-marins",
  AIRCRAFT: "Avions",
};

/**
 * Panneau bibliothèque (retour utilisateur 2026-08-14) : liste les classes
 * partagées groupées par catégorie, chacune avec une cible (task force) et
 * un bouton "Ajouter" — chemin bouton construit EN MÊME TEMPS que la
 * structure (voir le plan, §"glisser-déposer") plutôt qu'en repli tardif :
 * le glisser-déposer viendra en Phase 6 comme accélérateur superposé.
 */
export function LibraryBrowserPanel({
  classes,
  teams,
  onAddUnit,
}: {
  classes: LibraryClassOption[];
  teams: BuilderTeam[];
  onAddUnit: (libraryClass: LibraryClassOption, teamClientId: string, fleetClientId: string) => void;
}) {
  const targets = teams.flatMap((t) => t.fleets.map((f) => ({ value: `${t.clientId}::${f.clientId}`, label: `${t.name} / ${f.name}` })));
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const effectiveTarget = targets.some((t) => t.value === target) ? target : (targets[0]?.value ?? "");

  const byCategory = new Map<UnitCategory, LibraryClassOption[]>();
  for (const c of classes) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  function add(libClass: LibraryClassOption) {
    const [teamClientId, fleetClientId] = effectiveTarget.split("::");
    if (!teamClientId || !fleetClientId) return;
    onAddUnit(libClass, teamClientId, fleetClientId);
  }

  return (
    <div className="panel-brass space-y-3 p-3">
      <h3 className="font-display text-sm text-brass-300">Bibliothèque</h3>

      <label className="block text-xs text-slate-400">
        Ajouter à…
        <select
          value={effectiveTarget}
          onChange={(e) => setTarget(e.target.value)}
          disabled={targets.length === 0}
          className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
        >
          {targets.length === 0 && <option value="">Aucune task force — créez-en une d&apos;abord</option>}
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {classes.length === 0 && <p className="text-xs text-slate-600">Aucune classe dans la bibliothèque.</p>}

      <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
        {(["SURFACE_SHIP", "SUBMARINE", "AIRCRAFT"] as const).map((cat) => {
          const list = byCategory.get(cat);
          if (!list || list.length === 0) return null;
          return (
            <div key={cat}>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_LABEL[cat]}</h4>
              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs">
                    <span className="truncate" title={`${c.name} — ${c.nation}`}>
                      <span className="font-medium">{c.name}</span> <span className="text-slate-500">— {c.nation}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => add(c)}
                      disabled={targets.length === 0}
                      className="shrink-0 rounded border border-brass-700 px-2 py-0.5 text-brass-400 hover:bg-brass-900/30 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      + Ajouter
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
