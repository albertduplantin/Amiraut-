"use client";

import { useState } from "react";
import type { LibraryClassOption, BuilderTeam, BuilderAirbase, UnitCategory } from "./types";
import { carrierUnits } from "./types";
import { setDragPayload } from "./dragDrop";
import { nationFlag } from "./nations";
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
 *
 * Quantité pour les avions (Phase 6, retour utilisateur 2026-08-15—
 * "pouvoir en ajouter plusieurs du même type à la fois [...] cela devient
 * une escadrille") : un petit sélecteur -/+ apparaît à côté du bouton
 * "+ Ajouter" d'une classe AVION uniquement — 1 = avion isolé (comportement
 * inchangé), plus de 1 = escadrille auto-créée (voir addAircraftToBase,
 * ScenarioEditorForm.tsx). Un seul sélecteur partagé pour toute la liste
 * plutôt qu'un par ligne : plus simple, et la quantité n'a de sens que pour
 * l'avion qu'on est en train d'ajouter.
 *
 * Filtre nation (Phase 7, retour utilisateur 2026-08-15 — "si un camp a
 * une nationalité, on ne puisse choisir que les bateaux de cette
 * nationalité") : une fois une cible choisie dans "Ajouter à…", la liste
 * ENTIÈRE se filtre sur la nation de l'équipe propriétaire de cette cible
 * — restreint aussi ce qui peut être glissé-déposé, pas seulement le
 * bouton "+ Ajouter", puisque c'est la même liste pour les deux chemins.
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
  onAddAircraftToAirbase: (libraryClass: LibraryClassOption, teamClientId: string, airbaseKey: string, quantity?: number) => void;
  onAddAircraftToCarrier: (libraryClass: LibraryClassOption, teamClientId: string, carrierUnitName: string, quantity?: number) => void;
}) {
  const [extraClasses, setExtraClasses] = useState<LibraryClassOption[]>([]);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [aircraftQuantity, setAircraftQuantity] = useState(1);
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
  const targetTeamNation = teams.find((t) => t.clientId === targets.find((x) => x.value === effectiveTarget)?.teamClientId)?.nation ?? null;
  const visibleClasses = targetTeamNation ? allClasses.filter((c) => c.nation === targetTeamNation) : allClasses;

  const byCategory = new Map<UnitCategory, LibraryClassOption[]>();
  for (const c of visibleClasses) {
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
    else if (t.kind === "airbase") onAddAircraftToAirbase(libClass, t.teamClientId, t.airbaseKey, aircraftQuantity);
    else onAddAircraftToCarrier(libClass, t.teamClientId, t.carrierUnitName, aircraftQuantity);
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
      {targetTeamNation && (
        <p className="text-[11px] text-slate-500">
          Filtré sur {nationFlag(targetTeamNation)} {targetTeamNation}.
        </p>
      )}
      {(() => {
        const t = targets.find((x) => x.value === effectiveTarget);
        if (!t || t.kind === "fleet") return null;
        return (
          <label className="block text-xs text-slate-400">
            Quantité (avions)
            <div className="mt-1 flex items-center gap-1">
              <button type="button" onClick={() => setAircraftQuantity((q) => Math.max(1, q - 1))} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-900">
                −
              </button>
              <input
                type="number"
                min={1}
                max={24}
                value={aircraftQuantity}
                onChange={(e) => setAircraftQuantity(Math.min(24, Math.max(1, Number(e.target.value) || 1)))}
                className="w-12 rounded-md border border-slate-700 bg-slate-950 px-1 py-1 text-center text-xs"
              />
              <button type="button" onClick={() => setAircraftQuantity((q) => Math.min(24, q + 1))} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-900">
                +
              </button>
              {aircraftQuantity > 1 && <span className="ml-1 text-[11px] text-brass-400">→ escadrille de {aircraftQuantity}</span>}
            </div>
          </label>
        );
      })()}
      {addError && <p className="text-xs text-red-400">{addError}</p>}

      {visibleClasses.length === 0 && (
        <p className="text-xs text-slate-600">
          {allClasses.length === 0 ? "Aucune classe dans la bibliothèque." : `Aucune classe ${targetTeamNation} dans la bibliothèque.`}
        </p>
      )}

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
