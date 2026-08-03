"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { pointsFeatureCollection } from "@/lib/mapData";
import type { LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import { updateUnitPositionAction, updateFleetPositionAction } from "../actions";

type UnitDto = {
  id: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  teamName: string;
  teamColor: string;
  fleetId: string;
  fleetName: string;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
};

type Selection = { kind: "unit"; unitId: string } | { kind: "fleet"; fleetId: string } | null;

export function PositionsClient(props: { mapCenter: LatLng; mapZoom: number; units: UnitDto[] }) {
  const [units, setUnits] = useState(props.units);
  const [selection, setSelection] = useState<Selection>(null);
  const [unitDraftPosition, setUnitDraftPosition] = useState<LatLng | null>(null);
  const [fleetDraftOffset, setFleetDraftOffset] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [isPending, startTransition] = useTransition();
  const gameMapRef = useRef<GameMapHandle>(null);

  const allUnitPositions = useMemo(() => units.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), [units]);

  const fleets = useMemo(() => {
    const byFleet = new Map<
      string,
      { fleetId: string; fleetName: string; teamName: string; teamColor: string; units: UnitDto[] }
    >();
    for (const u of units) {
      const entry = byFleet.get(u.fleetId) ?? { fleetId: u.fleetId, fleetName: u.fleetName, teamName: u.teamName, teamColor: u.teamColor, units: [] };
      entry.units.push(u);
      byFleet.set(u.fleetId, entry);
    }
    return Array.from(byFleet.values());
  }, [units]);

  const groupedByTeam = useMemo(() => {
    const byTeam = new Map<string, typeof fleets>();
    for (const f of fleets) {
      const list = byTeam.get(f.teamName) ?? [];
      list.push(f);
      byTeam.set(f.teamName, list);
    }
    return Array.from(byTeam.entries());
  }, [fleets]);

  const selectedUnit = selection?.kind === "unit" ? (units.find((u) => u.id === selection.unitId) ?? null) : null;
  const selectedFleet = selection?.kind === "fleet" ? (fleets.find((f) => f.fleetId === selection.fleetId) ?? null) : null;

  function selectUnit(id: string) {
    setSelection({ kind: "unit", unitId: id });
    setUnitDraftPosition(null);
    setFleetDraftOffset(null);
    setError(null);
    setSavedFlash(false);
  }

  function selectFleet(id: string) {
    setSelection({ kind: "fleet", fleetId: id });
    setUnitDraftPosition(null);
    setFleetDraftOffset(null);
    setError(null);
    setSavedFlash(false);
  }

  function handleMapClick(pos: LatLng) {
    if (selectedUnit) {
      if (gameMapRef.current && !gameMapRef.current.isWaterPoint(pos)) {
        setError("Position impossible : elle tombe sur la terre.");
        return;
      }
      setError(null);
      setSavedFlash(false);
      setUnitDraftPosition(pos);
      return;
    }

    if (selectedFleet) {
      const centroid = {
        lat: selectedFleet.units.reduce((s, u) => s + u.currentLat, 0) / selectedFleet.units.length,
        lng: selectedFleet.units.reduce((s, u) => s + u.currentLng, 0) / selectedFleet.units.length,
      };
      const delta = { lat: pos.lat - centroid.lat, lng: pos.lng - centroid.lng };
      const allInWater = selectedFleet.units.every(
        (u) => !gameMapRef.current || gameMapRef.current.isWaterPoint({ lat: u.currentLat + delta.lat, lng: u.currentLng + delta.lng })
      );
      if (!allInWater) {
        setError("Déplacement impossible : au moins un navire de la flotte tomberait sur la terre.");
        return;
      }
      setError(null);
      setSavedFlash(false);
      setFleetDraftOffset(delta);
    }
  }

  function handleShipMarkerClick(unitId: string) {
    selectUnit(unitId);
  }

  function save() {
    if (selectedUnit && unitDraftPosition) {
      setError(null);
      startTransition(async () => {
        const result = await updateUnitPositionAction({ unitId: selectedUnit.id, lat: unitDraftPosition.lat, lng: unitDraftPosition.lng });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setUnits((prev) =>
          prev.map((u) => (u.id === selectedUnit.id ? { ...u, currentLat: unitDraftPosition.lat, currentLng: unitDraftPosition.lng } : u))
        );
        setUnitDraftPosition(null);
        setSavedFlash(true);
      });
      return;
    }

    if (selectedFleet && fleetDraftOffset) {
      setError(null);
      startTransition(async () => {
        const result = await updateFleetPositionAction({
          fleetId: selectedFleet.fleetId,
          deltaLat: fleetDraftOffset.lat,
          deltaLng: fleetDraftOffset.lng,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setUnits((prev) =>
          prev.map((u) =>
            u.fleetId === selectedFleet.fleetId
              ? { ...u, currentLat: u.currentLat + fleetDraftOffset.lat, currentLng: u.currentLng + fleetDraftOffset.lng }
              : u
          )
        );
        setFleetDraftOffset(null);
        setSavedFlash(true);
      });
    }
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
        fadeAboveZoom: 7,
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

    if (selectedFleet) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection(selectedFleet.units.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: {} }))),
        color: "#facc15",
        radius: 9,
      });
    }

    if (unitDraftPosition) {
      list.push({
        id: "draft",
        kind: "points",
        data: pointsFeatureCollection([{ lat: unitDraftPosition.lat, lng: unitDraftPosition.lng, properties: { name: "nouvelle position" } }]),
        color: "#f97316",
        radius: 9,
        showLabels: true,
      });
    }

    if (selectedFleet && fleetDraftOffset) {
      list.push({
        id: "draft",
        kind: "points",
        data: pointsFeatureCollection(
          selectedFleet.units.map((u) => ({
            lat: u.currentLat + fleetDraftOffset.lat,
            lng: u.currentLng + fleetDraftOffset.lng,
            properties: { name: u.name },
          }))
        ),
        color: "#f97316",
        radius: 8,
        showLabels: true,
      });
    }

    return list;
  }, [units, selectedUnit, selectedFleet, unitDraftPosition, fleetDraftOffset]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () =>
      units.map((u) => {
        const silhouette = classifySilhouette(u.category, u.className);
        return {
          id: u.id,
          lat: u.currentLat,
          lng: u.currentLng,
          headingDeg: u.currentHeadingDeg ?? 0,
          color: u.teamColor,
          silhouette,
          lengthMeters: u.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
        };
      }),
    [units]
  );

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="border-b border-slate-800 px-4 py-2">
        <h1 className="font-display text-lg tracking-wide text-brass-300">Repositionner des unités</h1>
        <p className="text-xs text-slate-500">
          Clique sur une flotte (ci-contre) ou un navire (liste ou carte) pour le sélectionner, clique la nouvelle
          position sur la carte, puis enregistre. Une flotte se déplace en bloc, formation conservée.
        </p>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-800 p-3">
          {groupedByTeam.map(([teamName, teamFleets]) => (
            <div key={teamName} className="mb-4">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{teamName}</h2>
              {teamFleets.map((fleet) => (
                <div key={fleet.fleetId} className="mb-2">
                  <button
                    onClick={() => selectFleet(fleet.fleetId)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
                      selection?.kind === "fleet" && selection.fleetId === fleet.fleetId
                        ? "bg-brass-900/50 ring-1 ring-brass-500"
                        : "hover:bg-slate-900"
                    }`}
                  >
                    ⚓ {fleet.fleetName} <span className="text-xs font-normal text-slate-500">({fleet.units.length})</span>
                  </button>
                  <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-800 pl-2">
                    {fleet.units.map((unit) => (
                      <li key={unit.id}>
                        <button
                          onClick={() => selectUnit(unit.id)}
                          className={`w-full rounded-md px-2 py-1 text-left text-xs transition ${
                            selection?.kind === "unit" && selection.unitId === unit.id
                              ? "bg-brass-900/50 ring-1 ring-brass-500"
                              : "hover:bg-slate-900"
                          }`}
                        >
                          {unit.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
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
            showScaleAndRuler
            onShipMarkerClick={handleShipMarkerClick}
            className="h-full w-full"
          />
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          {selectedUnit ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">{selectedUnit.name}</h2>
                <p className="text-xs text-slate-500">
                  {selectedUnit.className} · {selectedUnit.teamName} · {selectedUnit.fleetName}
                </p>
              </div>

              <div className="rounded-md bg-slate-900 p-3 text-xs">
                <div>
                  Position actuelle : {selectedUnit.currentLat.toFixed(4)}, {selectedUnit.currentLng.toFixed(4)}
                </div>
                {unitDraftPosition && (
                  <div className="mt-1 text-orange-400">
                    Nouvelle position : {unitDraftPosition.lat.toFixed(4)}, {unitDraftPosition.lng.toFixed(4)}
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500">Clique sur la carte pour choisir une nouvelle position en mer.</p>

              <button
                onClick={save}
                disabled={!unitDraftPosition || isPending}
                className="w-full rounded-md bg-brass-600 px-3 py-1.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
              >
                {isPending ? "Enregistrement…" : "Enregistrer la nouvelle position"}
              </button>

              {error && <p className="text-sm text-red-400">{error}</p>}
              {savedFlash && !error && <p className="text-sm text-emerald-400">Position mise à jour ✓</p>}
            </div>
          ) : selectedFleet ? (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold">⚓ {selectedFleet.fleetName}</h2>
                <p className="text-xs text-slate-500">
                  {selectedFleet.teamName} · {selectedFleet.units.length} navires
                </p>
              </div>

              <div className="rounded-md bg-slate-900 p-3 text-xs">
                {fleetDraftOffset ? (
                  <div className="text-orange-400">
                    Déplacement : {fleetDraftOffset.lat >= 0 ? "+" : ""}
                    {fleetDraftOffset.lat.toFixed(4)}, {fleetDraftOffset.lng >= 0 ? "+" : ""}
                    {fleetDraftOffset.lng.toFixed(4)} (formation conservée)
                  </div>
                ) : (
                  <div>Clique la carte pour choisir le nouveau centre de la flotte.</div>
                )}
              </div>

              <ul className="space-y-1 text-xs">
                {selectedFleet.units.map((u) => (
                  <li key={u.id} className="rounded bg-slate-900/60 px-2 py-1 text-slate-400">
                    {u.name}
                  </li>
                ))}
              </ul>

              <button
                onClick={save}
                disabled={!fleetDraftOffset || isPending}
                className="w-full rounded-md bg-brass-600 px-3 py-1.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
              >
                {isPending ? "Enregistrement…" : "Déplacer toute la flotte"}
              </button>

              {error && <p className="text-sm text-red-400">{error}</p>}
              {savedFlash && !error && <p className="text-sm text-emerald-400">Flotte déplacée ✓</p>}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sélectionne une flotte ou un navire dans la liste (ou clique un navire sur la carte).</p>
          )}
        </aside>
      </div>
    </div>
  );
}
