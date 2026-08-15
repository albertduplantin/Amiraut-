"use client";

import { useState } from "react";
import type { LibraryClassOption, BuilderTeam, BuilderAirbase, UnitCategory } from "./types";
import { carrierUnits } from "./types";
import { setDragPayload } from "./dragDrop";
// Chemin : builder/ → new/ → scenarios/ → app/ → library/ (trois niveaux).
import { QuickCreateClassModal } from "../../../library/QuickCreateClassModal";

const CATEGORY_LABEL: Record<UnitCategory, string> = {
  SURFACE_SHIP: "Navires de surface",
  SUBMARINE: "Sous-marins",
  AIRCRAFT: "Avions",
};

type Target =
  | { kind: "fleet"; value: string; label: string; teamClientId: string; fleetClientId: string }
  | { kind: "airbase"; value: string; label: string; teamClientId: string; airbaseKey: string }
  | { kind: "carrier"; value: string; label: string; teamClientId: string; carrierUnitName: string };

/**
 * Panneau bibliothèque (retour utilisateur 2026-08-14) : liste les classes
 * partagées groupées par catégorie, chacune avec une cible et un bouton
 * "Ajouter" — chemin bouton construit EN MÊME TEMPS que la structure (voir
 * le plan, §"glisser-déposer") ; chaque ligne est aussi `draggable` (Phase
 * 6) — accélérateur superposé, pas un remplacement, le bouton reste le
 * chemin de référence. "+ Nouvelle classe" (Phase 6, même retour
 * utilisateur — "créer des avions à la volée") ouvre une modal de création
 * rapide plutôt que de quitter vers /library/new.
 *
 * Cibles par catégorie (Phase 4, retour utilisateur 2026-08-15, troisième
 * chantier — "les avions ne peuvent être ajoutés que dans les bases
 * aériennes ou un porte-avions") : la liste "Ajouter à…" propose task
 * forces ET bases aériennes ET porte-avions ensemble, mais `add()` refuse
 * la combinaison catégorie/cible incompatible avec un message explicite —
 * plus simple qu'un filtre dynamique de la liste selon la ligne survolée
 * (chaque ligne a son propre bouton "+ Ajouter", la cible reste un choix
 * global fait une fois).
 */
export function LibraryBrowserPanel({
  classes,
  teams,
  airbases,
  onAddUnit,
  onAddAircraftToAirbase,
  onAddAircraftToCarrier,
}: {
  classes: LibraryClassOption[];
  teams: BuilderTeam[];
  airbases: BuilderAirbase[];
  onAddUnit: (libraryClass: LibraryClassOption, teamClientId: string, fleetClientId: string) => void;
  onAddAircraftToAirbase: (libraryClass: LibraryClassOption, teamClientId: string, airbaseKey: string) => void;
  onAddAircraftToCarrier: (libraryClass: LibraryClassOption, teamClientId: string, carrierUnitName: string) => void;
}) {
  const [extraClasses, setExtraClasses] = useState<LibraryClassOption[]>([]);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const allClasses = [...classes, ...extraClasses];

  const targets: Target[] = [
    ...teams.flatMap((t) =>
      t.fleets
        .filter((f) => f.kind !== "station" && f.kind !== "aviation")
        .map((f): Target => ({ kind: "fleet", value: `fleet:${t.clientId}:${f.clientId}`, label: `⚓ ${t.name} / ${f.name}`, teamClientId: t.clientId, fleetClientId: f.clientId }))
    ),
    ...airbases.map((a): Target => {
      const team = teams.find((t) => t.clientId === a.teamClientId);
      return { kind: "airbase", value: `airbase:${a.teamClientId}:${a.key}`, label: `✈ ${team?.name ?? "?"} / ${a.name || a.key}`, teamClientId: a.teamClientId, airbaseKey: a.key };
    }),
    ...teams.flatMap((t) =>
      carrierUnits([t], allClasses).map((c): Target => ({ kind: "carrier", value: `carrier:${t.clientId}:${c.name}`, label: `🛫 ${t.name} / ${c.name}`, teamClientId: t.clientId, carrierUnitName: c.name }))
    ),
  ];
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const effectiveTarget = targets.some((t) => t.value === target) ? target : (targets[0]?.value ?? "");

  const byCategory = new Map<UnitCategory, LibraryClassOption[]>();
  for (const c of allClasses) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  function add(libClass: LibraryClassOption) {
    const t = targets.find((x) => x.value === effectiveTarget);
    if (!t) return;
    if (libClass.category === "AIRCRAFT" && t.kind === "fleet") {
      setAddError("Un avion ne peut être ajouté qu'à une base aérienne ou un porte-avions, pas directement à une task force.");
      setTimeout(() => setAddError(null), 4000);
      return;
    }
    if (libClass.category !== "AIRCRAFT" && t.kind !== "fleet") {
      setAddError("Seul un avion peut être ajouté à une base aérienne ou un porte-avions.");
      setTimeout(() => setAddError(null), 4000);
      return;
    }
    if (t.kind === "fleet") onAddUnit(libClass, t.teamClientId, t.fleetClientId);
    else if (t.kind === "airbase") onAddAircraftToAirbase(libClass, t.teamClientId, t.airbaseKey);
    else onAddAircraftToCarrier(libClass, t.teamClientId, t.carrierUnitName);
  }

  return (
    <div className="panel-brass space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm text-brass-300">Bibliothèque</h3>
        <button type="button" onClick={() => setShowQuickCreate(true)} className="text-xs text-brass-400 hover:text-brass-300">
          + Nouvelle classe
        </button>
      </div>

      <label className="block text-xs text-slate-400">
        Ajouter à…
        <select
          value={effectiveTarget}
          onChange={(e) => setTarget(e.target.value)}
          disabled={targets.length === 0}
          className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
        >
          {targets.length === 0 && <option value="">Aucune task force/base — créez-en une d&apos;abord</option>}
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {addError && <p className="text-xs text-red-400">{addError}</p>}

      {allClasses.length === 0 && <p className="text-xs text-slate-600">Aucune classe dans la bibliothèque.</p>}

      <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
        {(["SURFACE_SHIP", "SUBMARINE", "AIRCRAFT"] as const).map((cat) => {
          const list = byCategory.get(cat);
          if (!list || list.length === 0) return null;
          return (
            <div key={cat}>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_LABEL[cat]}</h4>
              <ul className="space-y-1">
                {list.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => setDragPayload(e, { kind: "libraryClass", libraryClassId: c.id })}
                    title={
                      c.category === "AIRCRAFT"
                        ? "Glisser vers une base aérienne ou un porte-avions, ou choisir une cible et cliquer + Ajouter"
                        : "Glisser vers une task force, ou choisir une cible et cliquer + Ajouter"
                    }
                    className="flex cursor-grab items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs active:cursor-grabbing"
                  >
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

      {showQuickCreate && (
        <QuickCreateClassModal
          onClose={() => setShowQuickCreate(false)}
          onCreated={(newClass) => {
            setExtraClasses((prev) => [...prev, newClass]);
            setShowQuickCreate(false);
          }}
        />
      )}
    </div>
  );
}
