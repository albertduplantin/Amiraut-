"use client";

import { useMemo, useState, useTransition } from "react";
import { GameMap, type MapSourceConfig } from "@/components/GameMap";
import {
  budgetCircleFeatureCollection,
  lineFeatureCollection,
  multiLineFeatureCollection,
  pointsFeatureCollection,
} from "@/lib/mapData";
import { clampPathToBudget, pathLengthNm, speedBudgetNm, type LatLng } from "@/lib/geo";
import { submitOrderAction, submitFleetOrderAction } from "./actions";

type SensorSpec = { type: string; rangeNm: number };

type UnitDto = {
  id: string;
  name: string;
  pennant: string | null;
  fleetId: string;
  fleetName: string;
  className: string;
  nation: string;
  category: string;
  maxSpeedKnots: number;
  sensors: SensorSpec[];
  detectability: number;
  historicalNote: string | null;
  currentLat: number;
  currentLng: number;
  existingOrder: { speedKnots: number; waypoints: LatLng[] } | null;
};

type UnitDraft = { speedKnots: number; waypoints: LatLng[]; saved: boolean };
type FleetDraft = { speedKnots: number; waypoints: LatLng[] };
type Mode = "unit" | "fleet";

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

  const fleets = useMemo(() => {
    const byFleet = new Map<string, UnitDto[]>();
    for (const unit of units) {
      const list = byFleet.get(unit.fleetId) ?? [];
      list.push(unit);
      byFleet.set(unit.fleetId, list);
    }
    return Array.from(byFleet.entries()).map(([fleetId, fleetUnits]) => ({
      fleetId,
      fleetName: fleetUnits[0].fleetName,
      units: fleetUnits,
      minMaxSpeedKnots: Math.min(...fleetUnits.map((u) => u.maxSpeedKnots)),
      centroid: {
        lat: fleetUnits.reduce((s, u) => s + u.currentLat, 0) / fleetUnits.length,
        lng: fleetUnits.reduce((s, u) => s + u.currentLng, 0) / fleetUnits.length,
      },
    }));
  }, [units]);

  const allUnitPositions = useMemo(() => units.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), [units]);

  const [mode, setMode] = useState<Mode>("unit");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(units[0]?.id ?? null);
  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(fleets[0]?.fleetId ?? null);

  const [unitDrafts, setUnitDrafts] = useState<Record<string, UnitDraft>>(() => {
    const initial: Record<string, UnitDraft> = {};
    for (const unit of units) {
      initial[unit.id] = unit.existingOrder
        ? { speedKnots: unit.existingOrder.speedKnots, waypoints: unit.existingOrder.waypoints, saved: true }
        : { speedKnots: defaultSpeed(unit.maxSpeedKnots), waypoints: [], saved: false };
    }
    return initial;
  });
  const [fleetDrafts, setFleetDrafts] = useState<Record<string, FleetDraft>>(() => {
    const initial: Record<string, FleetDraft> = {};
    for (const fleet of fleets) {
      initial[fleet.fleetId] = { speedKnots: defaultSpeed(fleet.minMaxSpeedKnots), waypoints: [] };
    }
    return initial;
  });

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;
  const selectedUnitDraft = selectedUnitId ? unitDrafts[selectedUnitId] : null;

  const selectedFleet = fleets.find((f) => f.fleetId === selectedFleetId) ?? null;
  const selectedFleetDraft = selectedFleetId ? fleetDrafts[selectedFleetId] : null;

  const unitBudgetNm = selectedUnit && selectedUnitDraft ? speedBudgetNm(selectedUnitDraft.speedKnots, turnDurationMinutes) : 0;
  const unitUsedNm =
    selectedUnit && selectedUnitDraft
      ? pathLengthNm([{ lat: selectedUnit.currentLat, lng: selectedUnit.currentLng }, ...selectedUnitDraft.waypoints])
      : 0;
  const unitRemainingNm = Math.max(0, unitBudgetNm - unitUsedNm);
  const unitLastPoint =
    selectedUnit && selectedUnitDraft
      ? (selectedUnitDraft.waypoints[selectedUnitDraft.waypoints.length - 1] ?? {
          lat: selectedUnit.currentLat,
          lng: selectedUnit.currentLng,
        })
      : null;

  const fleetBudgetNm = selectedFleet && selectedFleetDraft ? speedBudgetNm(selectedFleetDraft.speedKnots, turnDurationMinutes) : 0;
  const fleetUsedNm =
    selectedFleet && selectedFleetDraft ? pathLengthNm([selectedFleet.centroid, ...selectedFleetDraft.waypoints]) : 0;
  const fleetRemainingNm = Math.max(0, fleetBudgetNm - fleetUsedNm);
  const fleetLastPoint =
    selectedFleet && selectedFleetDraft
      ? (selectedFleetDraft.waypoints[selectedFleetDraft.waypoints.length - 1] ?? selectedFleet.centroid)
      : null;
  const fleetAllSaved = selectedFleet ? selectedFleet.units.every((u) => unitDrafts[u.id]?.saved) : false;

  function handleMapClick(pos: LatLng) {
    if (mode === "unit") {
      if (!selectedUnit || !selectedUnitDraft) return;
      const start = { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng };
      const budget = speedBudgetNm(selectedUnitDraft.speedKnots, turnDurationMinutes);
      const clamped = clampPathToBudget([start, ...selectedUnitDraft.waypoints, pos], budget);
      setUnitDrafts((prev) => ({
        ...prev,
        [selectedUnit.id]: { ...prev[selectedUnit.id], waypoints: clamped.slice(1), saved: false },
      }));
      return;
    }

    if (!selectedFleet || !selectedFleetDraft) return;
    const budget = speedBudgetNm(selectedFleetDraft.speedKnots, turnDurationMinutes);
    const clamped = clampPathToBudget([selectedFleet.centroid, ...selectedFleetDraft.waypoints, pos], budget);
    setFleetDrafts((prev) => ({ ...prev, [selectedFleet.fleetId]: { ...prev[selectedFleet.fleetId], waypoints: clamped.slice(1) } }));
  }

  function updateUnitSpeed(speedKnots: number) {
    if (!selectedUnit) return;
    setUnitDrafts((prev) => {
      const budget = speedBudgetNm(speedKnots, turnDurationMinutes);
      const start = { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng };
      const clamped = clampPathToBudget([start, ...prev[selectedUnit.id].waypoints], budget);
      return { ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], speedKnots, waypoints: clamped.slice(1), saved: false } };
    });
  }

  function updateFleetSpeed(speedKnots: number) {
    if (!selectedFleet) return;
    setFleetDrafts((prev) => {
      const budget = speedBudgetNm(speedKnots, turnDurationMinutes);
      const clamped = clampPathToBudget([selectedFleet.centroid, ...prev[selectedFleet.fleetId].waypoints], budget);
      return { ...prev, [selectedFleet.fleetId]: { speedKnots, waypoints: clamped.slice(1) } };
    });
  }

  function clearUnitPath() {
    if (!selectedUnit) return;
    setUnitDrafts((prev) => ({ ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], waypoints: [], saved: false } }));
  }

  function clearFleetPath() {
    if (!selectedFleet) return;
    setFleetDrafts((prev) => ({ ...prev, [selectedFleet.fleetId]: { ...prev[selectedFleet.fleetId], waypoints: [] } }));
  }

  function saveUnitOrderClick() {
    if (!selectedUnit || !selectedUnitDraft) return;
    setError(null);
    startTransition(async () => {
      const result = await submitOrderAction({
        turnId,
        unitId: selectedUnit.id,
        speedKnots: selectedUnitDraft.speedKnots,
        waypoints: selectedUnitDraft.waypoints,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUnitDrafts((prev) => ({ ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], saved: true } }));
    });
  }

  function saveFleetOrderClick() {
    if (!selectedFleet || !selectedFleetDraft) return;
    setError(null);
    startTransition(async () => {
      const result = await submitFleetOrderAction({
        turnId,
        fleetId: selectedFleet.fleetId,
        speedKnots: selectedFleetDraft.speedKnots,
        waypoints: selectedFleetDraft.waypoints,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUnitDrafts((prev) => {
        const next = { ...prev };
        for (const unit of selectedFleet.units) {
          const offset = { lat: unit.currentLat - selectedFleet.centroid.lat, lng: unit.currentLng - selectedFleet.centroid.lng };
          const translated = selectedFleetDraft.waypoints.map((w) => ({ lat: w.lat + offset.lat, lng: w.lng + offset.lng }));
          next[unit.id] = { speedKnots: selectedFleetDraft.speedKnots, waypoints: translated, saved: true };
        }
        return next;
      });
    });
  }

  function inspectUnit(unitId: string) {
    setMode("unit");
    setSelectedUnitId(unitId);
  }

  const flyToPoint =
    mode === "unit" ? (selectedUnit ? { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng } : null) : (selectedFleet?.centroid ?? null);

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(units.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: "#38bdf8",
        radius: 6,
        showLabels: true,
      },
    ];

    if (mode === "unit" && selectedUnit) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection([{ lat: selectedUnit.currentLat, lng: selectedUnit.currentLng, properties: {} }]),
        color: "#facc15",
        radius: 10,
      });
    }

    if (mode === "unit" && selectedUnit && selectedUnitDraft) {
      const start = { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng };
      list.push({ id: "draft-path", kind: "line", data: lineFeatureCollection([start, ...selectedUnitDraft.waypoints]), color: "#facc15", width: 3 });
      if (unitLastPoint) {
        list.push({
          id: "budget-ring",
          kind: "line",
          data: budgetCircleFeatureCollection(unitLastPoint, unitRemainingNm),
          color: "#facc15",
          width: 1,
          dashed: true,
        });
      }
    }

    if (mode === "fleet" && selectedFleet && selectedFleetDraft) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection(selectedFleet.units.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: {} }))),
        color: "#facc15",
        radius: 9,
      });

      const fleetPath = [selectedFleet.centroid, ...selectedFleetDraft.waypoints];
      const perShipPaths = selectedFleet.units.map((u) => {
        const offset = { lat: u.currentLat - selectedFleet.centroid.lat, lng: u.currentLng - selectedFleet.centroid.lng };
        return fleetPath.map((p) => ({ lat: p.lat + offset.lat, lng: p.lng + offset.lng }));
      });
      list.push({ id: "draft-path", kind: "line", data: multiLineFeatureCollection(perShipPaths), color: "#facc15", width: 2 });

      if (fleetLastPoint) {
        list.push({
          id: "budget-ring",
          kind: "line",
          data: budgetCircleFeatureCollection(fleetLastPoint, fleetRemainingNm),
          color: "#facc15",
          width: 1,
          dashed: true,
        });
      }
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, mode, selectedUnitId, selectedUnitDraft, unitRemainingNm, selectedFleetId, selectedFleetDraft, fleetRemainingNm]);

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
          <div className="mb-3 flex rounded-md border border-slate-800 text-sm">
            <button
              onClick={() => setMode("unit")}
              className={`flex-1 rounded-l-md px-2 py-1.5 ${mode === "unit" ? "bg-sky-900/60" : "hover:bg-slate-900"}`}
            >
              Par navire
            </button>
            <button
              onClick={() => setMode("fleet")}
              className={`flex-1 rounded-r-md px-2 py-1.5 ${mode === "fleet" ? "bg-sky-900/60" : "hover:bg-slate-900"}`}
            >
              Par flotte
            </button>
          </div>

          {mode === "unit" ? (
            <ul className="space-y-1">
              {units.map((unit) => {
                const draft = unitDrafts[unit.id];
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
          ) : (
            <ul className="space-y-1">
              {fleets.map((fleet) => {
                const allSaved = fleet.units.every((u) => unitDrafts[u.id]?.saved);
                return (
                  <li key={fleet.fleetId}>
                    <button
                      onClick={() => setSelectedFleetId(fleet.fleetId)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                        fleet.fleetId === selectedFleetId ? "bg-sky-900/60 ring-1 ring-sky-600" : "hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{fleet.fleetName}</span>
                        {allSaved && <span className="text-emerald-400">✓</span>}
                      </div>
                      <div className="text-xs text-slate-500">{fleet.units.length} navires</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="relative flex-1">
          <GameMap
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            onClick={handleMapClick}
            fitToPoints={allUnitPositions}
            flyToPoint={flyToPoint}
            className="h-full w-full"
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          {mode === "unit" && selectedUnit && selectedUnitDraft ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">{selectedUnit.name}</h2>
                <p className="text-xs text-slate-500">
                  {selectedUnit.className} · {selectedUnit.nation}
                </p>
              </div>

              <label className="block text-sm">
                Vitesse : {selectedUnitDraft.speedKnots} nds (max {selectedUnit.maxSpeedKnots})
                <input
                  type="range"
                  min={1}
                  max={selectedUnit.maxSpeedKnots}
                  value={selectedUnitDraft.speedKnots}
                  onChange={(e) => updateUnitSpeed(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>

              <div className="rounded-md bg-slate-900 p-3 text-sm">
                <div>Budget : {unitBudgetNm.toFixed(1)} nm</div>
                <div>Utilisé : {unitUsedNm.toFixed(1)} nm</div>
                <div>Restant : {unitRemainingNm.toFixed(1)} nm</div>
              </div>

              <div className="flex gap-2">
                <button onClick={clearUnitPath} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
                  Effacer
                </button>
                <button
                  onClick={saveUnitOrderClick}
                  disabled={isPending}
                  className="flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
                >
                  {isPending ? "Enregistrement…" : "Enregistrer l'ordre"}
                </button>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <ShipDetailPanel unit={selectedUnit} />
            </div>
          ) : mode === "fleet" && selectedFleet && selectedFleetDraft ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">{selectedFleet.fleetName}</h2>
                <p className="text-xs text-slate-500">{selectedFleet.units.length} navires · un seul trajet, formation conservée</p>
              </div>

              <label className="block text-sm">
                Vitesse : {selectedFleetDraft.speedKnots} nds (max {selectedFleet.minMaxSpeedKnots}, limité par le plus lent)
                <input
                  type="range"
                  min={1}
                  max={selectedFleet.minMaxSpeedKnots}
                  value={selectedFleetDraft.speedKnots}
                  onChange={(e) => updateFleetSpeed(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>

              <div className="rounded-md bg-slate-900 p-3 text-sm">
                <div>Budget : {fleetBudgetNm.toFixed(1)} nm</div>
                <div>Utilisé : {fleetUsedNm.toFixed(1)} nm</div>
                <div>Restant : {fleetRemainingNm.toFixed(1)} nm</div>
              </div>

              <div className="flex gap-2">
                <button onClick={clearFleetPath} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
                  Effacer
                </button>
                <button
                  onClick={saveFleetOrderClick}
                  disabled={isPending}
                  className="flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
                >
                  {isPending ? "Enregistrement…" : fleetAllSaved ? "Ordre enregistré ✓" : "Enregistrer l'ordre de flotte"}
                </button>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div>
                <h3 className="mb-1 text-sm font-semibold text-slate-400">Navires de la flotte</h3>
                <ul className="space-y-1">
                  {selectedFleet.units.map((u) => (
                    <li key={u.id}>
                      <button onClick={() => inspectUnit(u.id)} className="w-full rounded-md bg-slate-900 px-2 py-1 text-left text-xs hover:bg-slate-800">
                        <span className="font-medium">{u.name}</span> <span className="text-slate-500">— {u.className}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sélectionnez une unité ou une flotte pour dessiner son trajet.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function ShipDetailPanel({ unit }: { unit: UnitDto }) {
  return (
    <div className="space-y-2 border-t border-slate-800 pt-4">
      <h3 className="text-sm font-semibold text-slate-400">Caractéristiques</h3>
      <table className="w-full text-xs">
        <tbody>
          <tr>
            <td className="py-0.5 pr-2 text-slate-500">Nation</td>
            <td>{unit.nation}</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-2 text-slate-500">Catégorie</td>
            <td>{formatCategory(unit.category)}</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-2 text-slate-500">Vitesse max</td>
            <td>{unit.maxSpeedKnots} nds</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-2 align-top text-slate-500">Capteurs</td>
            <td>
              {unit.sensors.map((s, i) => (
                <div key={i}>
                  {formatSensor(s.type)} : {s.rangeNm} nm
                </div>
              ))}
            </td>
          </tr>
          <tr>
            <td className="py-0.5 pr-2 text-slate-500">Détectabilité</td>
            <td>{unit.detectability.toFixed(2)}×</td>
          </tr>
        </tbody>
      </table>
      {unit.historicalNote && <p className="text-xs italic text-slate-400">{unit.historicalNote}</p>}
    </div>
  );
}

function defaultSpeed(maxSpeedKnots: number) {
  return Math.max(1, Math.round(maxSpeedKnots * 0.7));
}

function formatCategory(category: string) {
  switch (category) {
    case "SURFACE_SHIP":
      return "navire de surface";
    case "SUBMARINE":
      return "sous-marin";
    case "AIRCRAFT":
      return "avion";
    default:
      return category;
  }
}

function formatSensor(type: string) {
  switch (type) {
    case "RADAR":
      return "radar";
    case "VISUAL":
      return "visuel";
    case "HYDROPHONE":
      return "hydrophone";
    case "SONAR":
      return "sonar";
    default:
      return type;
  }
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
