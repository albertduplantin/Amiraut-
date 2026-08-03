"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import {
  budgetCircleFeatureCollection,
  colorForId,
  lineFeatureCollection,
  multiLineFeatureCollection,
  multiLineFeatureCollectionColored,
  pointsFeatureCollection,
} from "@/lib/mapData";
import { clampPathToBudget, pathLengthNm, speedBudgetNm, type LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import { submitOrderAction, submitFleetOrderAction, requestFleetTransferAction, cancelFleetTransferAction } from "./actions";

type SensorSpec = { type: string; rangeNm: number };

type UnitDto = {
  id: string;
  name: string;
  pennant: string | null;
  fleetId: string;
  fleetName: string;
  pendingFleetName: string | null;
  className: string;
  nation: string;
  category: string;
  maxSpeedKnots: number;
  lengthMeters: number | null;
  sensors: SensorSpec[];
  detectability: number;
  historicalNote: string | null;
  profileImageUrl: string | null;
  status: string;
  healthCurrent: number | null;
  healthMax: number | null;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
  depthBand: string;
  depthChargesRemaining: number | null;
  existingOrder: { speedKnots: number; waypoints: LatLng[]; depthBand: string | null } | null;
};

/**
 * Vitesse à laquelle un sous-marin patrouille en écoutant activement à
 * l'hydrophone : historiquement, la portée utile de détection acoustique
 * (GHG) restait significative jusqu'à ~4-6nds, puis chutait vite au-delà à
 * cause du bruit propre (uboat.net/articles/id/52 : à 4nds, un U-Boot
 * gardait encore 5-10nm sur un destroyer, 3.5-7.5nm sur un cargo).
 */
const LISTENING_SPEED_KNOTS = 4;

const DEPTH_BAND_ORDER = ["SURFACE", "SHALLOW", "MEDIUM", "DEEP"] as const;
type DepthBandKey = (typeof DEPTH_BAND_ORDER)[number];

type UnitDraft = { speedKnots: number; waypoints: LatLng[]; saved: boolean; depthBand: DepthBandKey | null };
type FleetDraft = { speedKnots: number; waypoints: LatLng[] };
type Mode = "unit" | "fleet";
type SortMode = "fleet" | "type" | "name";

type LastContact = {
  detectionEventId: string;
  targetUnitId: string;
  targetName: string;
  unitClassName: string;
  category: string;
  iconKey: string;
  lat: number;
  lng: number;
  method: string;
  cpaMinutesIntoTurn: number;
  observedBy: string;
};

export function OrdersClient(props: {
  turnId: string;
  turnNumber: number;
  turnDurationMinutes: number;
  weather: { visibilityNm: number; seaState: number; daylight: string; precipitation: string } | null;
  mapCenter: LatLng;
  mapZoom: number;
  teamProgress: { submitted: number; total: number };
  globalProgress: { submitted: number; total: number };
  teamFleets: { id: string; name: string }[];
  lastReportTurnNumber: number | null;
  lastContacts: LastContact[];
  units: UnitDto[];
}) {
  const { turnId, turnNumber, turnDurationMinutes, weather, units, teamFleets, lastContacts, lastReportTurnNumber } = props;

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

  const allUnitPositions = useMemo(
    () => [...units.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), ...lastContacts.map((c) => ({ lat: c.lat, lng: c.lng }))],
    [units, lastContacts]
  );

  const [mode, setMode] = useState<Mode>("fleet");
  const [sortMode, setSortMode] = useState<SortMode>("fleet");
  const sortedUnits = useMemo(() => {
    const copy = [...units];
    switch (sortMode) {
      case "type":
        copy.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
        break;
      case "name":
        copy.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        copy.sort((a, b) => a.fleetName.localeCompare(b.fleetName) || a.name.localeCompare(b.name));
    }
    return copy;
  }, [units, sortMode]);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(units[0]?.id ?? null);
  const [selectedFleetId, setSelectedFleetId] = useState<string | null>(fleets[0]?.fleetId ?? null);

  const [unitDrafts, setUnitDrafts] = useState<Record<string, UnitDraft>>(() => {
    const initial: Record<string, UnitDraft> = {};
    for (const unit of units) {
      initial[unit.id] = unit.existingOrder
        ? {
            speedKnots: unit.existingOrder.speedKnots,
            waypoints: unit.existingOrder.waypoints,
            saved: true,
            depthBand: (unit.existingOrder.depthBand as DepthBandKey | null) ?? null,
          }
        : { speedKnots: defaultSpeed(unit.maxSpeedKnots), waypoints: [], saved: false, depthBand: null };
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
  const [fleetTransferTarget, setFleetTransferTarget] = useState("");
  const [fleetTransferError, setFleetTransferError] = useState<string | null>(null);
  const [isFleetTransferPending, startFleetTransferTransition] = useTransition();
  const gameMapRef = useRef<GameMapHandle>(null);

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
      const previous = selectedUnitDraft.waypoints[selectedUnitDraft.waypoints.length - 1] ?? start;
      const budget = speedBudgetNm(selectedUnitDraft.speedKnots, turnDurationMinutes);
      const clamped = clampPathToBudget([start, ...selectedUnitDraft.waypoints, pos], budget);
      const newPoint = clamped[clamped.length - 1];
      if (gameMapRef.current && !gameMapRef.current.isWaterSegment(previous, newPoint)) {
        setError("Trajet impossible : il traverserait la terre.");
        return;
      }
      setError(null);
      setUnitDrafts((prev) => ({
        ...prev,
        [selectedUnit.id]: { ...prev[selectedUnit.id], waypoints: clamped.slice(1), saved: false },
      }));
      return;
    }

    if (!selectedFleet || !selectedFleetDraft) return;
    const previous = selectedFleetDraft.waypoints[selectedFleetDraft.waypoints.length - 1] ?? selectedFleet.centroid;
    const budget = speedBudgetNm(selectedFleetDraft.speedKnots, turnDurationMinutes);
    const clamped = clampPathToBudget([selectedFleet.centroid, ...selectedFleetDraft.waypoints, pos], budget);
    const newPoint = clamped[clamped.length - 1];
    if (gameMapRef.current && !gameMapRef.current.isWaterSegment(previous, newPoint)) {
      setError("Trajet impossible : il traverserait la terre.");
      return;
    }
    setError(null);
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

  function updateUnitDepthBand(depthBand: DepthBandKey) {
    if (!selectedUnit) return;
    setUnitDrafts((prev) => ({ ...prev, [selectedUnit.id]: { ...prev[selectedUnit.id], depthBand, saved: false } }));
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
        depthBand: selectedUnitDraft.depthBand ?? undefined,
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
          next[unit.id] = { speedKnots: selectedFleetDraft.speedKnots, waypoints: translated, saved: true, depthBand: prev[unit.id]?.depthBand ?? null };
        }
        return next;
      });
    });
  }

  function requestTransfer() {
    if (!selectedUnit || !fleetTransferTarget) return;
    setFleetTransferError(null);
    startFleetTransferTransition(async () => {
      const result = await requestFleetTransferAction({ unitId: selectedUnit.id, targetFleetId: fleetTransferTarget });
      if (!result.ok) {
        setFleetTransferError(result.error);
        return;
      }
      setFleetTransferTarget("");
    });
  }

  function cancelTransfer() {
    if (!selectedUnit) return;
    setFleetTransferError(null);
    startFleetTransferTransition(async () => {
      const result = await cancelFleetTransferAction({ unitId: selectedUnit.id });
      if (!result.ok) setFleetTransferError(result.error);
    });
  }

  function inspectUnit(unitId: string) {
    setMode("unit");
    setSelectedUnitId(unitId);
  }

  function handleShipMarkerClick(unitId: string) {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return;
    setMode("fleet");
    setSelectedFleetId(unit.fleetId);
  }

  const flyToPoint =
    mode === "unit" ? (selectedUnit ? { lat: selectedUnit.currentLat, lng: selectedUnit.currentLng } : null) : (selectedFleet?.centroid ?? null);

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        // Derniers contacts confirmés (tour précédent) : dernière position
        // connue, pas la position réelle actuelle de l'ennemi — c'est du
        // brouillard de guerre, pas un suivi en direct.
        id: "last-known-contacts",
        kind: "points",
        data: pointsFeatureCollection(
          lastContacts.map((c) => ({ lat: c.lat, lng: c.lng, properties: { name: `${c.unitClassName} (dernier contact)` } }))
        ),
        color: "#f97316",
        radius: 6,
        showLabels: true,
      },
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(units.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: "#38bdf8",
        radius: 6,
        showLabels: true,
      },
    ];

    const savedPaths = units
      .filter((u) => unitDrafts[u.id]?.saved)
      .map((u) => ({
        points: [{ lat: u.currentLat, lng: u.currentLng }, ...unitDrafts[u.id].waypoints],
        color: colorForId(u.id),
      }))
      .filter((p) => p.points.length >= 2);
    if (savedPaths.length > 0) {
      list.push({
        id: "saved-paths",
        kind: "line",
        data: multiLineFeatureCollectionColored(savedPaths),
        colorByFeature: true,
        width: 2,
      });
    }

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
  }, [units, unitDrafts, mode, selectedUnitId, selectedUnitDraft, unitRemainingNm, selectedFleetId, selectedFleetDraft, fleetRemainingNm, lastContacts]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () =>
      units.map((u) => {
        const silhouette = classifySilhouette(u.category, u.className);
        return {
          id: u.id,
          lat: u.currentLat,
          lng: u.currentLng,
          headingDeg: u.currentHeadingDeg ?? 0,
          color: "#38bdf8",
          silhouette,
          lengthMeters: u.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
          status: u.status as "ACTIVE" | "DAMAGED" | "SUNK",
        };
      }),
    [units]
  );

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <h1 className="font-display text-lg tracking-wide text-brass-300">
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
              className={`flex-1 rounded-l-md px-2 py-1.5 ${mode === "unit" ? "bg-brass-900/50" : "hover:bg-slate-900"}`}
            >
              Par navire
            </button>
            <button
              onClick={() => setMode("fleet")}
              className={`flex-1 rounded-r-md px-2 py-1.5 ${mode === "fleet" ? "bg-brass-900/50" : "hover:bg-slate-900"}`}
            >
              Par flotte
            </button>
          </div>

          {mode === "unit" ? (
            <>
              <label className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                Trier par
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                >
                  <option value="fleet">Flotte</option>
                  <option value="type">Type</option>
                  <option value="name">Nom</option>
                </select>
              </label>
              <ul className="space-y-1">
              {sortedUnits.map((unit) => {
                const draft = unitDrafts[unit.id];
                return (
                  <li key={unit.id}>
                    <button
                      onClick={() => setSelectedUnitId(unit.id)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                        unit.id === selectedUnitId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span
                            className="inline-block h-2.5 w-1.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: colorForId(unit.fleetId) }}
                            title={`Flotte : ${unit.fleetName}`}
                          />
                          {draft?.saved && (
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: colorForId(unit.id) }}
                              title="Trajet enregistré"
                            />
                          )}
                          {unit.name}
                          {unit.status === "DAMAGED" && (
                            <span className="text-amber-400" title="Endommagé">
                              ⚠
                            </span>
                          )}
                        </span>
                        {draft?.saved && <span className="text-emerald-400">✓</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {unit.className} · {unit.fleetName}
                        {unit.pendingFleetName && <span className="text-amber-400"> → {unit.pendingFleetName}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
              </ul>
            </>
          ) : (
            <ul className="space-y-1">
              {fleets.map((fleet) => {
                const allSaved = fleet.units.every((u) => unitDrafts[u.id]?.saved);
                return (
                  <li key={fleet.fleetId}>
                    <button
                      onClick={() => setSelectedFleetId(fleet.fleetId)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                        fleet.fleetId === selectedFleetId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-medium">
                          <span
                            className="inline-block h-2.5 w-1.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: colorForId(fleet.fleetId) }}
                          />
                          {fleet.fleetName}
                        </span>
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
            ref={gameMapRef}
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            onClick={handleMapClick}
            fitToPoints={allUnitPositions}
            flyToPoint={flyToPoint}
            shipMarkers={shipMarkers}
            onShipMarkerClick={handleShipMarkerClick}
            className="h-full w-full"
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          <LastContactsPanel lastReportTurnNumber={lastReportTurnNumber} lastContacts={lastContacts} />

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

              {selectedUnit.category === "SUBMARINE" && (
                <button
                  onClick={() => updateUnitSpeed(LISTENING_SPEED_KNOTS)}
                  className={`w-full rounded-md border px-3 py-1.5 text-xs transition ${
                    selectedUnitDraft.speedKnots === LISTENING_SPEED_KNOTS
                      ? "border-brass-500 bg-brass-900/50"
                      : "border-slate-700 hover:bg-slate-900"
                  }`}
                  title="À cette vitesse, l'hydrophone reste efficace : au-delà, le bruit propre du sous-marin masque le signal (voir GHG, uboat.net/articles/id/52)."
                >
                  🎧 Vitesse d&apos;écoute ({LISTENING_SPEED_KNOTS} nds)
                </button>
              )}

              <div className="rounded-md bg-slate-900 p-3 text-sm">
                <div>Budget : {unitBudgetNm.toFixed(1)} nm</div>
                <div>Utilisé : {unitUsedNm.toFixed(1)} nm</div>
                <div>Restant : {unitRemainingNm.toFixed(1)} nm</div>
              </div>

              {selectedUnit.category === "SUBMARINE" && (
                <DepthBandControl
                  currentDepthBand={selectedUnit.depthBand as DepthBandKey}
                  draftDepthBand={selectedUnitDraft.depthBand}
                  onChange={updateUnitDepthBand}
                />
              )}

              <div className="flex gap-2">
                <button onClick={clearUnitPath} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
                  Effacer
                </button>
                <button
                  onClick={saveUnitOrderClick}
                  disabled={isPending}
                  className="flex-1 rounded-md bg-brass-600 px-3 py-1.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
                >
                  {isPending ? "Enregistrement…" : "Enregistrer l'ordre"}
                </button>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="space-y-2 border-t border-slate-800 pt-4">
                <h3 className="text-sm font-semibold text-slate-400">Flotte</h3>
                <p className="text-xs text-slate-500">
                  Actuellement : {selectedUnit.fleetName}
                  {selectedUnit.pendingFleetName && (
                    <span className="text-amber-400"> → transfert vers {selectedUnit.pendingFleetName} au tour suivant</span>
                  )}
                </p>

                {selectedUnit.pendingFleetName ? (
                  <button
                    onClick={cancelTransfer}
                    disabled={isFleetTransferPending}
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs hover:bg-slate-900 disabled:opacity-50"
                  >
                    Annuler le transfert
                  </button>
                ) : (
                  teamFleets.filter((f) => f.id !== selectedUnit.fleetId).length > 0 && (
                    <div className="flex gap-2">
                      <select
                        value={fleetTransferTarget}
                        onChange={(e) => setFleetTransferTarget(e.target.value)}
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                      >
                        <option value="">Choisir une flotte…</option>
                        {teamFleets
                          .filter((f) => f.id !== selectedUnit.fleetId)
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={requestTransfer}
                        disabled={!fleetTransferTarget || isFleetTransferPending}
                        className="rounded-md bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                      >
                        Demander
                      </button>
                    </div>
                  )
                )}

                {fleetTransferError && <p className="text-xs text-red-400">{fleetTransferError}</p>}

                <p className="text-[11px] italic text-slate-600">
                  Représente un ordre transmis par signal au commandement (comme le détachement de destroyers de
                  l&apos;amiral Fraser vers sa Force 2 pendant la bataille du cap Nord) : prend effet au tour
                  suivant, le temps que le navire rallie sa nouvelle formation.
                </p>
              </div>

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
                  className="flex-1 rounded-md bg-brass-600 px-3 py-1.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
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
                      <button
                        onClick={() => inspectUnit(u.id)}
                        className="flex w-full items-center gap-1.5 rounded-md bg-slate-900 px-2 py-1 text-left text-xs hover:bg-slate-800"
                      >
                        {unitDrafts[u.id]?.saved && (
                          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorForId(u.id) }} />
                        )}
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

const DEPTH_BAND_LABELS: Record<DepthBandKey, string> = {
  SURFACE: "Surface",
  SHALLOW: "Immersion faible",
  MEDIUM: "Immersion moyenne",
  DEEP: "Grande immersion",
};

/**
 * Un seul palier adjacent par tour (livret original) : les boutons hors
 * portée d'un cran depuis le palier actuel sont désactivés. `draftDepthBand`
 * (nul tant que le joueur n'a rien changé) reflète le choix de ce tour ;
 * `currentDepthBand` est le palier figé du tour précédent, base de la
 * contrainte d'adjacence.
 */
function DepthBandControl({
  currentDepthBand,
  draftDepthBand,
  onChange,
}: {
  currentDepthBand: DepthBandKey;
  draftDepthBand: DepthBandKey | null;
  onChange: (band: DepthBandKey) => void;
}) {
  const selected = draftDepthBand ?? currentDepthBand;
  const currentIndex = DEPTH_BAND_ORDER.indexOf(currentDepthBand);

  return (
    <div className="rounded-md bg-slate-900 p-3 text-sm">
      <div className="mb-2 text-xs font-semibold text-slate-400">Immersion (1 palier par tour)</div>
      <div className="flex flex-col gap-1">
        {DEPTH_BAND_ORDER.map((band, i) => {
          const adjacent = Math.abs(i - currentIndex) <= 1;
          return (
            <button
              key={band}
              disabled={!adjacent}
              onClick={() => onChange(band)}
              className={`rounded-md px-2 py-1 text-left text-xs transition ${
                selected === band
                  ? "bg-brass-900/50 ring-1 ring-brass-500"
                  : adjacent
                    ? "hover:bg-slate-800"
                    : "cursor-not-allowed opacity-30"
              }`}
            >
              {DEPTH_BAND_LABELS[band]}
              {band === currentDepthBand && <span className="text-slate-500"> (actuel)</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Derniers contacts confirmés par l'arbitre au tour précédent : sans ça, le
 * joueur dessine ses ordres à l'aveugle malgré les détections déjà connues
 * de son camp (elles n'apparaissaient auparavant que dans l'écran des
 * rapports, séparé de celui des ordres).
 */
function LastContactsPanel({
  lastReportTurnNumber,
  lastContacts,
}: {
  lastReportTurnNumber: number | null;
  lastContacts: LastContact[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (lastReportTurnNumber === null) return null;

  return (
    <div className="mb-4 rounded-md border border-orange-900/50 bg-orange-950/20">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-orange-300"
      >
        <span>
          Derniers contacts connus (tour {lastReportTurnNumber}) — {lastContacts.length}
        </span>
        <span className="text-xs text-orange-400">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="border-t border-orange-900/50 px-3 py-2">
          {lastContacts.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun contact ennemi au dernier tour publié.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {lastContacts.map((c, i) => (
                <li key={i} className="rounded bg-slate-900/60 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-200">{c.unitClassName}</span>
                    <Link
                      href={`/team/tactical/${c.detectionEventId}`}
                      className="shrink-0 rounded border border-orange-800 px-1.5 py-0.5 text-[10px] text-orange-300 hover:bg-orange-950/50"
                    >
                      Mode tactique
                    </Link>
                  </div>
                  <div className="text-slate-500">
                    repéré par {c.observedBy} ({formatSensor(c.method)}), +{Math.round(c.cpaMinutesIntoTurn)} min
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ShipDetailPanel({ unit }: { unit: UnitDto }) {
  const healthRatio = unit.healthMax && unit.healthMax > 0 ? clamp01((unit.healthCurrent ?? 0) / unit.healthMax) : null;
  return (
    <div className="space-y-2 border-t border-slate-800 pt-4">
      <h3 className="text-sm font-semibold text-slate-400">Caractéristiques</h3>
      {healthRatio !== null && (
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className={unit.status === "DAMAGED" ? "text-amber-400" : "text-slate-400"}>
              {unit.status === "DAMAGED" ? "Endommagé" : "État"}
            </span>
            <span className="text-slate-500">
              {Math.round(unit.healthCurrent ?? 0)} / {Math.round(unit.healthMax ?? 0)} pts
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full ${healthRatio < 0.6 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${healthRatio * 100}%` }}
            />
          </div>
        </div>
      )}
      {unit.profileImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={unit.profileImageUrl}
          alt={`Silhouette de ${unit.className}`}
          className="max-h-40 w-full rounded-md border border-slate-800 bg-white object-contain p-1"
        />
      )}
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
          {unit.depthChargesRemaining != null && (
            <tr>
              <td className="py-0.5 pr-2 text-slate-500">Grenades ASM</td>
              <td>{unit.depthChargesRemaining}</td>
            </tr>
          )}
        </tbody>
      </table>
      {unit.historicalNote && <p className="text-xs italic text-slate-400">{unit.historicalNote}</p>}
    </div>
  );
}

function defaultSpeed(maxSpeedKnots: number) {
  return Math.max(1, Math.round(maxSpeedKnots * 0.7));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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
