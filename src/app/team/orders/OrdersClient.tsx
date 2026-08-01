"use client";

import { useMemo, useState, useTransition } from "react";
import { GameMap, type MapSourceConfig } from "@/components/GameMap";
import { budgetCircleFeatureCollection, lineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import { clampPathToBudget, pathLengthNm, speedBudgetNm, type LatLng } from "@/lib/geo";
import { submitOrderAction } from "./actions";

type UnitDto = {
  id: string;
  name: string;
  pennant: string | null;
  fleetName: string;
  className: string;
  category: string;
  maxSpeedKnots: number;
  currentLat: number;
  currentLng: number;
  existingOrder: { speedKnots: number; waypoints: LatLng[] } | null;
};

type Draft = { speedKnots: number; waypoints: LatLng[]; saved: boolean };

export function OrdersClient(props: {
  turnId: string;
  turnNumber: number;
  turnDurationMinutes: number;
  weather: { visibilityNm: number; seaState: number; daylight: string; precipitation: string } | null;
  mapCenter: LatLng;
  mapZoom: number;
  teamProgress: { submitted: number; total: number };
  globalProgress: { submitted: number; total: number };
  units: UnitDto[];
}) {
  const { turnId, turnNumber, turnDurationMinutes, weather, units } = props;

  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(units[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {};
    for (const unit of units) {
      initial[unit.id] = unit.existingOrder
        ? { speedKnots: unit.existingOrder.speedKnots, waypoints: unit.existingOrder.waypoints, saved: true }
        : { speedKnots: defaultSpeed(unit.maxSpeedKnots), waypoints: [], saved: false };
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;
  const selectedDraft = selectedUnitId ? drafts[selectedUnitId] : null;

  const budgetNm = selectedUnit && selectedDraft ? speedBudgetNm(selectedDraft.speedKnots, turnDurationMinutes) : 0;
  const usedNm =
    selectedUnit && selectedDraft
      ? pathLengthNm([{ lat: selectedUnit.currentLat, lng: selectedUnit.currentLng }, ...selectedDraft.waypoints])
      : 0;
  const remainingNm = Math.max(0, budgetNm - usedNm);
  const lastPoint =
    selectedUnit && selectedDraft
      ? (selectedDraft.waypoints[selectedDraft.waypoints.length - 1] ?? {
          lat: selectedUnit.currentLat,
          lng: selectedUnit.currentLng,
        })
      : null;

  function handleMapClick(pos: LatLng) {
    if (!selectedUnit || !selectedDraft) return;
    const start = { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng };
    const budget = speedBudgetNm(selectedDraft.speedKnots, turnDurationMinutes);
    const clamped = clampPathToBudget([start, ...selectedDraft.waypoints, pos], budget);
    setDrafts((prev) => ({
      ...prev,
      [selectedUnit.id]: { ...prev[selectedUnit.id], waypoints: clamped.slice(1), saved: false },
    }));
  }

  function updateSpeed(speedKnots: number) {
    if (!selectedUnit) return;
    setDrafts((prev) => {
      const budget = speedBudgetNm(speedKnots, turnDurationMinutes);
      const start = { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng };
      const clamped = clampPathToBudget([start, ...prev[selectedUnit.id].waypoints], budget);
      return { ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], speedKnots, waypoints: clamped.slice(1), saved: false } };
    });
  }

  function clearPath() {
    if (!selectedUnit) return;
    setDrafts((prev) => ({ ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], waypoints: [], saved: false } }));
  }

  function saveOrder() {
    if (!selectedUnit || !selectedDraft) return;
    setError(null);
    startTransition(async () => {
      const result = await submitOrderAction({
        turnId,
        unitId: selectedUnit.id,
        speedKnots: selectedDraft.speedKnots,
        waypoints: selectedDraft.waypoints,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDrafts((prev) => ({ ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], saved: true } }));
    });
  }

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(
          units.map((u) => ({
            lat: u.currentLat,
            lng: u.currentLng,
            properties: { name: u.name, selected: u.id === selectedUnitId },
          }))
        ),
        color: "#38bdf8",
        radius: 6,
        showLabels: true,
      },
    ];

    if (selectedUnit && selectedDraft) {
      const start = { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng };
      list.push({
        id: "draft-path",
        kind: "line",
        data: lineFeatureCollection([start, ...selectedDraft.waypoints]),
        color: "#facc15",
        width: 3,
      });
      if (lastPoint) {
        list.push({
          id: "budget-ring",
          kind: "line",
          data: budgetCircleFeatureCollection(lastPoint, remainingNm),
          color: "#facc15",
          width: 1,
          dashed: true,
        });
      }
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, selectedUnitId, selectedDraft, remainingNm]);

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <h1 className="text-lg font-semibold">
          Tour {turnNumber} — Ordres de mouvement ({turnDurationMinutes / 60} h)
        </h1>
        <div className="flex gap-4 text-sm text-slate-400">
          <span>
            Votre équipe : {props.teamProgress.submitted}/{props.teamProgress.total} ordres
          </span>
          <span>
            Total partie : {props.globalProgress.submitted}/{props.globalProgress.total}
          </span>
        </div>
      </header>

      {weather && (
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-1 text-xs text-slate-400">
          Météo : visibilité {weather.visibilityNm}nm · état de mer {weather.seaState} · {formatDaylight(weather.daylight)}
          {weather.precipitation !== "NONE" ? ` · ${formatPrecipitation(weather.precipitation)}` : ""}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-800 p-3">
          <ul className="space-y-1">
            {units.map((unit) => {
              const draft = drafts[unit.id];
              return (
                <li key={unit.id}>
                  <button
                    onClick={() => setSelectedUnitId(unit.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                      unit.id === selectedUnitId ? "bg-sky-900/60 ring-1 ring-sky-600" : "hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{unit.name}</span>
                      {draft?.saved && <span className="text-emerald-400">✓</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {unit.className} · {unit.fleetName}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="relative flex-1">
          <GameMap center={props.mapCenter} zoom={props.mapZoom} sources={sources} onClick={handleMapClick} className="h-full w-full" />
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          {selectedUnit && selectedDraft ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">{selectedUnit.name}</h2>
                <p className="text-xs text-slate-500">{selectedUnit.className}</p>
              </div>

              <label className="block text-sm">
                Vitesse : {selectedDraft.speedKnots} nds (max {selectedUnit.maxSpeedKnots})
                <input
                  type="range"
                  min={1}
                  max={selectedUnit.maxSpeedKnots}
                  value={selectedDraft.speedKnots}
                  onChange={(e) => updateSpeed(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>

              <div className="rounded-md bg-slate-900 p-3 text-sm">
                <div>Budget : {budgetNm.toFixed(1)} nm</div>
                <div>Utilisé : {usedNm.toFixed(1)} nm</div>
                <div>Restant : {remainingNm.toFixed(1)} nm</div>
              </div>

              <p className="text-xs text-slate-500">
                Cliquez sur la carte pour ajouter des points de passage. Le trajet est automatiquement limité à la
                distance parcourable à cette vitesse pendant la durée du tour.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={clearPath}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900"
                >
                  Effacer
                </button>
                <button
                  onClick={saveOrder}
                  disabled={isPending}
                  className="flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
                >
                  {isPending ? "Enregistrement…" : "Enregistrer l'ordre"}
                </button>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sélectionnez une unité pour dessiner son trajet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function defaultSpeed(maxSpeedKnots: number) {
  return Math.max(1, Math.round(maxSpeedKnots * 0.7));
}

function formatDaylight(daylight: string) {
  switch (daylight) {
    case "DAY":
      return "jour";
    case "TWILIGHT":
      return "crépuscule";
    case "NIGHT":
      return "nuit";
    case "POLAR_NIGHT":
      return "nuit polaire";
    case "POLAR_DAY":
      return "jour polaire";
    default:
      return daylight;
  }
}

function formatPrecipitation(precipitation: string) {
  switch (precipitation) {
    case "RAIN":
      return "pluie";
    case "SNOW":
      return "neige";
    case "FOG":
      return "brouillard";
    default:
      return precipitation;
  }
}
