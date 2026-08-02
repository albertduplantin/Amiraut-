"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { pointsFeatureCollection } from "@/lib/mapData";
import type { LatLng } from "@/lib/geo";
import { classifySilhouette } from "@/lib/shipSilhouettes";
import { updateUnitPositionAction } from "../actions";

type UnitDto = {
  id: string;
  name: string;
  className: string;
  category: string;
  teamName: string;
  teamColor: string;
  fleetName: string;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
};

export function PositionsClient(props: { mapCenter: LatLng; mapZoom: number; units: UnitDto[] }) {
  const [units, setUnits] = useState(props.units);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [draftPosition, setDraftPosition] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [isPending, startTransition] = useTransition();
  const gameMapRef = useRef<GameMapHandle>(null);

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;
  const allUnitPositions = useMemo(() => units.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), [units]);

  const grouped = useMemo(() => {
    const byTeam = new Map<string, UnitDto[]>();
    for (const u of units) {
      const list = byTeam.get(u.teamName) ?? [];
      list.push(u);
      byTeam.set(u.teamName, list);
    }
    return Array.from(byTeam.entries());
  }, [units]);

  function selectUnit(id: string) {
    setSelectedUnitId(id);
    setDraftPosition(null);
    setError(null);
    setSavedFlash(false);
  }

  function handleMapClick(pos: LatLng) {
    if (!selectedUnit) return;
    if (gameMapRef.current && !gameMapRef.current.isWaterPoint(pos)) {
      setError("Position impossible : elle tombe sur la terre.");
      return;
    }
    setError(null);
    setSavedFlash(false);
    setDraftPosition(pos);
  }

  function save() {
    if (!selectedUnit || !draftPosition) return;
    setError(null);
    startTransition(async () => {
      const result = await updateUnitPositionAction({ unitId: selectedUnit.id, lat: draftPosition.lat, lng: draftPosition.lng });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUnits((prev) => prev.map((u) => (u.id === selectedUnit.id ? { ...u, currentLat: draftPosition.lat, currentLng: draftPosition.lng } : u)));
      setDraftPosition(null);
      setSavedFlash(true);
    });
  }

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        id: "all-units",
        kind: "points",
        data: pointsFeatureCollection(units.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: "#38bdf8",
        radius: 6,
        showLabels: true,
      },
    ];

    if (selectedUnit) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection([{ lat: selectedUnit.currentLat, lng: selectedUnit.currentLng, properties: {} }]),
        color: "#facc15",
        radius: 10,
      });
    }

    if (draftPosition) {
      list.push({
        id: "draft",
        kind: "points",
        data: pointsFeatureCollection([{ lat: draftPosition.lat, lng: draftPosition.lng, properties: { name: "nouvelle position" } }]),
        color: "#f97316",
        radius: 9,
        showLabels: true,
      });
    }

    return list;
  }, [units, selectedUnit, draftPosition]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () =>
      units.map((u) => ({
        id: u.id,
        lat: u.currentLat,
        lng: u.currentLng,
        headingDeg: u.currentHeadingDeg ?? 0,
        color: u.teamColor,
        silhouette: classifySilhouette(u.category, u.className),
      })),
    [units]
  );

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="border-b border-slate-800 px-4 py-2">
        <h1 className="font-display text-lg tracking-wide text-brass-300">Repositionner des unités</h1>
        <p className="text-xs text-slate-500">
          Sélectionne une unité, clique sa nouvelle position sur la carte, puis enregistre. Utile pour corriger une
          position de départ mal placée.
        </p>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-800 p-3">
          {grouped.map(([teamName, teamUnits]) => (
            <div key={teamName} className="mb-4">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{teamName}</h2>
              <ul className="space-y-1">
                {teamUnits.map((unit) => (
                  <li key={unit.id}>
                    <button
                      onClick={() => selectUnit(unit.id)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                        unit.id === selectedUnitId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                      }`}
                    >
                      <div className="font-medium">{unit.name}</div>
                      <div className="text-xs text-slate-500">
                        {unit.className} · {unit.fleetName}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <main className="relative flex-1">
          <GameMap
            ref={gameMapRef}
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            onClick={handleMapClick}
            fitToPoints={allUnitPositions}
            shipMarkers={shipMarkers}
            className="h-full w-full"
          />
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          {selectedUnit ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">{selectedUnit.name}</h2>
                <p className="text-xs text-slate-500">
                  {selectedUnit.className} · {selectedUnit.teamName}
                </p>
              </div>

              <div className="rounded-md bg-slate-900 p-3 text-xs">
                <div>Position actuelle : {selectedUnit.currentLat.toFixed(4)}, {selectedUnit.currentLng.toFixed(4)}</div>
                {draftPosition && (
                  <div className="mt-1 text-orange-400">
                    Nouvelle position : {draftPosition.lat.toFixed(4)}, {draftPosition.lng.toFixed(4)}
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500">Clique sur la carte pour choisir une nouvelle position en mer.</p>

              <button
                onClick={save}
                disabled={!draftPosition || isPending}
                className="w-full rounded-md bg-brass-600 px-3 py-1.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
              >
                {isPending ? "Enregistrement…" : "Enregistrer la nouvelle position"}
              </button>

              {error && <p className="text-sm text-red-400">{error}</p>}
              {savedFlash && !error && <p className="text-sm text-emerald-400">Position mise à jour ✓</p>}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sélectionne une unité dans la liste.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
