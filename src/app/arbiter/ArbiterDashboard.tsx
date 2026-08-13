"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { multiLineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import type { LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import {
  confirmDetectionAction,
  rejectDetectionAction,
  addManualDetectionAction,
  publishTurnAction,
  setWeatherAction,
  updateUnitPositionAction,
  updateFleetPositionAction,
} from "./actions";
import {
  toggleArbiterPauseAction,
  arbiterEndEngagementAction,
} from "./battle/[engagementId]/actions";

/**
 * Tableau de bord arbitre unifié : carte au centre (toujours visible,
 * doublant comme outil de repositionnement), panneaux latéraux
 * rétractables — gauche pour choisir une unité/flotte, droite pour les
 * quatre tâches courantes (vue d'ensemble, météo, détections, combats).
 * Remplace la navigation par pages séparées (/arbiter/review,
 * /arbiter/positions) : tout reste accessible sans quitter cet écran, à
 * l'exception du journal complet d'un combat (chat, ajustements fins),
 * volontairement laissé sur sa page dédiée — un clic, pas un aller-retour.
 */

type UnitDto = {
  id: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  status: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  fleetId: string;
  fleetName: string;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
  healthCurrent: number | null;
  healthMax: number | null;
  depthBand: string;
};

type DetectionDto = {
  id: string;
  observerUnitId: string;
  observerName: string;
  observerTeam: string;
  targetUnitId: string;
  targetName: string;
  targetTeam: string;
  method: string;
  cpaDistanceNm: number;
  cpaMinutesIntoTurn: number;
  observerLatAtCpa: number;
  observerLngAtCpa: number;
  targetLatAtCpa: number;
  targetLngAtCpa: number;
  arbiterStatus: string;
  systemProposed: boolean;
};

type EngagementDto = {
  id: string;
  roundNumber: number;
  roundMinutes: number;
  status: string;
  arbiterPaused: boolean;
  endReason: string | null;
  teams: { id: string; name: string }[];
  submittedTeamIds: string[];
  participants: {
    unitId: string;
    teamId: string;
    teamName: string;
    teamColor: string;
    name: string;
    status: string;
    healthCurrent: number | null;
    healthMax: number | null;
  }[];
};

type Selection = { kind: "unit"; unitId: string } | { kind: "fleet"; fleetId: string } | null;
type RightPanel = "overview" | "weather" | "detections" | "combats" | null;

export function ArbiterDashboard(props: {
  scenarioName: string;
  turnId: string;
  turnNumber: number;
  turnStatus: string;
  turnDurationMinutes: number;
  tacticalMode: boolean;
  weather: {
    visibilityNm: number;
    seaState: number;
    daylight: string;
    precipitation: string;
    windKnots: number | null;
    notes: string | null;
  } | null;
  orderCount: number;
  activeUnitCount: number;
  mapCenter: LatLng;
  mapZoom: number;
  teams: { id: string; name: string; colorHex: string }[];
  units: UnitDto[];
  detections: DetectionDto[];
  engagements: EngagementDto[];
}) {
  const router = useRouter();
  const [units, setUnits] = useState(props.units);
  const [prevPropsUnits, setPrevPropsUnits] = useState(props.units);
  if (props.units !== prevPropsUnits) {
    setPrevPropsUnits(props.units);
    setUnits(props.units);
  }
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<RightPanel>(
    props.turnStatus === "PENDING_ARBITER_REVIEW" || props.turnStatus === "RESOLVING"
      ? "detections"
      : props.engagements.length > 0
        ? "combats"
        : "overview"
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [unitDraftPosition, setUnitDraftPosition] = useState<LatLng | null>(null);
  const [fleetDraftOffset, setFleetDraftOffset] = useState<{ lat: number; lng: number } | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [hoveredDetectionId, setHoveredDetectionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const gameMapRef = useRef<GameMapHandle>(null);

  // Vue en direct : se rafraîchit toute seule dès qu'un combat est en
  // cours, comme la page de bataille qu'elle remplace en usage courant.
  useEffect(() => {
    if (props.engagements.length === 0) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [props.engagements.length, router]);

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
    setPosError(null);
    setSavedFlash(false);
    setLeftOpen(true);
  }

  function selectFleet(id: string) {
    setSelection({ kind: "fleet", fleetId: id });
    setUnitDraftPosition(null);
    setFleetDraftOffset(null);
    setPosError(null);
    setSavedFlash(false);
  }

  function handleMapClick(pos: LatLng) {
    if (selectedUnit) {
      if (gameMapRef.current && !gameMapRef.current.isWaterPoint(pos)) {
        setPosError("Position impossible : elle tombe sur la terre.");
        return;
      }
      setPosError(null);
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
        setPosError("Déplacement impossible : au moins un navire de la flotte tomberait sur la terre.");
        return;
      }
      setPosError(null);
      setSavedFlash(false);
      setFleetDraftOffset(delta);
    }
  }

  function savePosition() {
    if (selectedUnit && unitDraftPosition) {
      setPosError(null);
      startTransition(async () => {
        const result = await updateUnitPositionAction({ unitId: selectedUnit.id, lat: unitDraftPosition.lat, lng: unitDraftPosition.lng });
        if (!result.ok) {
          setPosError(result.error);
          return;
        }
        setUnits((prev) => prev.map((u) => (u.id === selectedUnit.id ? { ...u, currentLat: unitDraftPosition.lat, currentLng: unitDraftPosition.lng } : u)));
        setUnitDraftPosition(null);
        setSavedFlash(true);
      });
      return;
    }
    if (selectedFleet && fleetDraftOffset) {
      setPosError(null);
      startTransition(async () => {
        const result = await updateFleetPositionAction({ fleetId: selectedFleet.fleetId, deltaLat: fleetDraftOffset.lat, deltaLng: fleetDraftOffset.lng });
        if (!result.ok) {
          setPosError(result.error);
          return;
        }
        setUnits((prev) =>
          prev.map((u) => (u.fleetId === selectedFleet.fleetId ? { ...u, currentLat: u.currentLat + fleetDraftOffset.lat, currentLng: u.currentLng + fleetDraftOffset.lng } : u))
        );
        setFleetDraftOffset(null);
        setSavedFlash(true);
      });
    }
  }

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [];

    if (selectedUnit) {
      list.push({ id: "highlight", kind: "points", data: pointsFeatureCollection([{ lat: selectedUnit.currentLat, lng: selectedUnit.currentLng, properties: {} }]), color: "#facc15", radius: 10 });
    }
    if (selectedFleet) {
      list.push({ id: "highlight", kind: "points", data: pointsFeatureCollection(selectedFleet.units.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: {} }))), color: "#facc15", radius: 9 });
    }
    if (unitDraftPosition) {
      list.push({ id: "draft", kind: "points", data: pointsFeatureCollection([{ lat: unitDraftPosition.lat, lng: unitDraftPosition.lng, properties: { name: "nouvelle position" } }]), color: "#f97316", radius: 9, showLabels: true });
    }
    if (selectedFleet && fleetDraftOffset) {
      list.push({
        id: "draft",
        kind: "points",
        data: pointsFeatureCollection(selectedFleet.units.map((u) => ({ lat: u.currentLat + fleetDraftOffset.lat, lng: u.currentLng + fleetDraftOffset.lng, properties: { name: u.name } }))),
        color: "#f97316",
        radius: 8,
        showLabels: true,
      });
    }

    // Panneau Détections actif : superpose les lignes de CPA et le survol,
    // sur la même carte plutôt que sur un écran séparé.
    if (rightPanel === "detections" && props.detections.length > 0) {
      list.push({
        id: "detection-links",
        kind: "line",
        data: multiLineFeatureCollection(props.detections.map((d) => [{ lat: d.observerLatAtCpa, lng: d.observerLngAtCpa }, { lat: d.targetLatAtCpa, lng: d.targetLngAtCpa }])),
        color: "#f97316",
        width: 1,
        dashed: true,
      });
      list.push({
        id: "detection-points",
        kind: "points",
        data: pointsFeatureCollection(props.detections.map((d) => ({ lat: d.targetLatAtCpa, lng: d.targetLngAtCpa, properties: { name: `CPA ${d.cpaDistanceNm.toFixed(1)}nm` } }))),
        color: "#f97316",
        radius: 4,
      });
      const hovered = props.detections.find((d) => d.id === hoveredDetectionId) ?? null;
      if (hovered) {
        list.push({
          id: "detection-highlight-line",
          kind: "line",
          data: multiLineFeatureCollection([[{ lat: hovered.observerLatAtCpa, lng: hovered.observerLngAtCpa }, { lat: hovered.targetLatAtCpa, lng: hovered.targetLngAtCpa }]]),
          color: "#facc15",
          width: 4,
        });
        list.push({
          id: "detection-highlight-points",
          kind: "points",
          data: pointsFeatureCollection([
            { lat: hovered.observerLatAtCpa, lng: hovered.observerLngAtCpa, properties: { name: hovered.observerName } },
            { lat: hovered.targetLatAtCpa, lng: hovered.targetLngAtCpa, properties: { name: hovered.targetName } },
          ]),
          color: "#facc15",
          radius: 8,
        });
      }
    }

    return list;
  }, [selectedUnit, selectedFleet, unitDraftPosition, fleetDraftOffset, rightPanel, props.detections, hoveredDetectionId]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () =>
      units.map((u) => {
        const silhouette = classifySilhouette(u.category, u.className);
        const damageRatio = u.healthMax && u.healthMax > 0 ? Math.max(0, 1 - Math.max(0, u.healthCurrent ?? u.healthMax) / u.healthMax) : 0;
        return {
          id: u.id,
          lat: u.currentLat,
          lng: u.currentLng,
          headingDeg: u.currentHeadingDeg ?? 0,
          color: u.teamColor,
          silhouette,
          lengthMeters: u.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
          status: u.status as "ACTIVE" | "DAMAGED" | "SUNK",
          damageRatio,
        };
      }),
    [units]
  );

  const allUnitPositions = useMemo(() => units.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), [units]);

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">{props.scenarioName}</h1>
          <p className="text-xs text-slate-500">
            Tour {props.turnNumber} — {formatTurnStatus(props.turnStatus)} ·{" "}
            {props.turnDurationMinutes < 60 ? `${props.turnDurationMinutes} min` : `${props.turnDurationMinutes / 60} h`}
            {props.tacticalMode && <span className="ml-2 rounded bg-red-900/60 px-2 py-0.5 text-[11px] text-red-200">⚔ échelle tactique</span>}
          </p>
        </div>
        <nav className="flex gap-1 text-xs">
          <PanelTabButton label="Vue d'ensemble" active={rightPanel === "overview"} onClick={() => setRightPanel(rightPanel === "overview" ? null : "overview")} />
          <PanelTabButton label="Météo" active={rightPanel === "weather"} onClick={() => setRightPanel(rightPanel === "weather" ? null : "weather")} />
          <PanelTabButton
            label={`Détections${props.detections.length > 0 ? ` (${props.detections.length})` : ""}`}
            active={rightPanel === "detections"}
            highlight={props.turnStatus === "PENDING_ARBITER_REVIEW"}
            onClick={() => setRightPanel(rightPanel === "detections" ? null : "detections")}
          />
          <PanelTabButton
            label={`Combats${props.engagements.length > 0 ? ` (${props.engagements.length})` : ""}`}
            active={rightPanel === "combats"}
            highlight={props.engagements.length > 0}
            onClick={() => setRightPanel(rightPanel === "combats" ? null : "combats")}
          />
        </nav>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className={`shrink-0 overflow-y-auto border-r border-slate-800 transition-all ${leftOpen ? "w-64 p-3" : "w-0 p-0"}`}>
          {leftOpen && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unités</h2>
                <button onClick={() => setLeftOpen(false)} className="text-slate-600 hover:text-slate-400" title="Replier">
                  ◂
                </button>
              </div>
              {groupedByTeam.map(([teamName, teamFleets]) => (
                <div key={teamName} className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{teamName}</h3>
                  {teamFleets.map((fleet) => (
                    <div key={fleet.fleetId} className="mb-2">
                      <button
                        onClick={() => selectFleet(fleet.fleetId)}
                        className={`w-full rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
                          selection?.kind === "fleet" && selection.fleetId === fleet.fleetId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
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
                                selection?.kind === "unit" && selection.unitId === unit.id ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                              }`}
                            >
                              {unit.name}
                              {unit.status === "SUNK" && <span className="ml-1 text-slate-600">(coulé)</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </aside>
        {!leftOpen && (
          <button onClick={() => setLeftOpen(true)} className="w-5 shrink-0 border-r border-slate-800 text-slate-600 hover:bg-slate-900 hover:text-slate-400" title="Déplier les unités">
            ▸
          </button>
        )}

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
            onShipMarkerClick={selectUnit}
            className="h-full w-full"
          />
          {(selectedUnit || selectedFleet) && (
            <div className="absolute bottom-4 left-4 max-w-xs rounded-md border border-slate-700 bg-slate-950/90 p-3 text-xs shadow-lg">
              {selectedUnit && (
                <>
                  <div className="font-medium">{selectedUnit.name}</div>
                  <div className="text-slate-500">
                    {selectedUnit.className} · {selectedUnit.teamName}
                  </div>
                  <div className="mt-1 text-slate-400">
                    {selectedUnit.currentLat.toFixed(4)}, {selectedUnit.currentLng.toFixed(4)}
                  </div>
                  {unitDraftPosition && <div className="mt-1 text-orange-400">→ {unitDraftPosition.lat.toFixed(4)}, {unitDraftPosition.lng.toFixed(4)}</div>}
                </>
              )}
              {selectedFleet && (
                <>
                  <div className="font-medium">⚓ {selectedFleet.fleetName}</div>
                  <div className="text-slate-500">
                    {selectedFleet.teamName} · {selectedFleet.units.length} navires
                  </div>
                  {fleetDraftOffset && <div className="mt-1 text-orange-400">Formation déplacée, conservée</div>}
                </>
              )}
              <p className="mt-1 text-slate-600">Clique la carte pour choisir la nouvelle position.</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => setSelection(null)} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-900">
                  Fermer
                </button>
                <button
                  onClick={savePosition}
                  disabled={(!unitDraftPosition && !fleetDraftOffset) || isPending}
                  className="flex-1 rounded bg-brass-600 px-2 py-1 font-medium hover:bg-brass-500 disabled:opacity-50"
                >
                  {isPending ? "…" : "Enregistrer"}
                </button>
              </div>
              {posError && <p className="mt-1 text-red-400">{posError}</p>}
              {savedFlash && !posError && <p className="mt-1 text-emerald-400">Position mise à jour ✓</p>}
            </div>
          )}
        </main>

        {rightPanel && (
          <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
            {rightPanel === "overview" && <OverviewPanel {...props} />}
            {rightPanel === "weather" && (
              <WeatherPanel turnId={props.turnId} turnNumber={props.turnNumber} turnDurationMinutes={props.turnDurationMinutes} weather={props.weather} hasOrders={props.orderCount > 0} />
            )}
            {rightPanel === "detections" && (
              <DetectionsPanel
                turnId={props.turnId}
                turnStatus={props.turnStatus}
                units={units}
                detections={props.detections}
                hoveredDetectionId={hoveredDetectionId}
                onHover={setHoveredDetectionId}
              />
            )}
            {rightPanel === "combats" && <CombatsPanel engagements={props.engagements} />}
          </aside>
        )}
      </div>
    </div>
  );
}

function PanelTabButton({ label, active, highlight, onClick }: { label: string; active: boolean; highlight?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 transition ${
        active
          ? "border-brass-500 bg-brass-900/40 text-brass-200"
          : highlight
            ? "border-amber-700 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50"
            : "border-slate-700 text-slate-400 hover:bg-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

function OverviewPanel(props: {
  turnNumber: number;
  turnStatus: string;
  turnDurationMinutes: number;
  orderCount: number;
  activeUnitCount: number;
  turnId: string;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-400">Vue d&apos;ensemble</h2>
      <div className="rounded-md bg-slate-900 p-3 text-sm">
        <div>
          Tour {props.turnNumber} — {formatTurnStatus(props.turnStatus)}
        </div>
        <div className="text-xs text-slate-500">
          Durée : {props.turnDurationMinutes < 60 ? `${props.turnDurationMinutes} min` : `${props.turnDurationMinutes / 60} h`}
        </div>
      </div>
      {props.turnStatus === "PENDING_ORDERS" && (
        <div className="rounded-md bg-slate-900 p-3 text-sm">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>Ordres soumis</span>
            <span>
              {props.orderCount}/{props.activeUnitCount}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-brass-500"
              style={{ width: `${props.activeUnitCount > 0 ? (props.orderCount / props.activeUnitCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      {(props.turnStatus === "PENDING_ARBITER_REVIEW" || props.turnStatus === "RESOLVING") && (
        <p className="text-sm text-amber-300">Tous les ordres sont soumis — passez à l&apos;onglet « Détections » pour revoir et publier.</p>
      )}
      <Link href="/team/reports" className="block text-xs text-slate-500 hover:text-slate-300">
        Voir les rapports publiés →
      </Link>
    </div>
  );
}

function SubmitButton({ idleLabel, pendingLabel }: { idleLabel: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full rounded-md bg-brass-600 px-3 py-1.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-60">
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

function WeatherPanel(props: {
  turnId: string;
  turnNumber: number;
  turnDurationMinutes: number;
  weather: { visibilityNm: number; seaState: number; daylight: string; precipitation: string; windKnots: number | null; notes: string | null } | null;
  hasOrders: boolean;
}) {
  if (props.hasOrders) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400">Météo</h2>
        <p className="text-sm text-slate-500">
          Des ordres ont déjà été soumis pour le tour {props.turnNumber} : la météo n&apos;est plus modifiable jusqu&apos;au tour suivant.
        </p>
        {props.weather && (
          <div className="rounded-md bg-slate-900 p-3 text-xs text-slate-400">
            Visibilité {props.weather.visibilityNm}nm · état de mer {props.weather.seaState} · {props.weather.daylight}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-400">{props.weather ? `Modifier les paramètres du tour ${props.turnNumber}` : `Définir la météo du tour ${props.turnNumber}`}</h2>
      <form action={setWeatherAction} className="space-y-3 text-sm">
        <input type="hidden" name="turnId" value={props.turnId} />
        <label className="block">
          Durée de ce tour (heures)
          <input name="durationHours" type="number" min={1} step="0.5" defaultValue={props.turnDurationMinutes / 60} required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <label className="block">
          Visibilité (nm)
          <input name="visibilityNm" type="number" step="0.5" defaultValue={props.weather?.visibilityNm ?? 8} required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <label className="block">
          État de mer (0-9)
          <input name="seaState" type="number" min={0} max={9} defaultValue={props.weather?.seaState ?? 4} required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <label className="block">
          Luminosité
          <select name="daylight" defaultValue={props.weather?.daylight ?? "NIGHT"} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
            <option value="DAY">Jour</option>
            <option value="TWILIGHT">Crépuscule</option>
            <option value="NIGHT">Nuit</option>
            <option value="POLAR_NIGHT">Nuit polaire</option>
            <option value="POLAR_DAY">Jour polaire</option>
          </select>
        </label>
        <label className="block">
          Précipitations
          <select name="precipitation" defaultValue={props.weather?.precipitation ?? "NONE"} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
            <option value="NONE">Aucune</option>
            <option value="RAIN">Pluie</option>
            <option value="SNOW">Neige</option>
            <option value="FOG">Brouillard</option>
          </select>
        </label>
        <label className="block">
          Vent (nds, optionnel)
          <input name="windKnots" type="number" step="1" defaultValue={props.weather?.windKnots ?? undefined} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <label className="block">
          Notes (optionnel)
          <textarea name="notes" rows={2} defaultValue={props.weather?.notes ?? undefined} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <SubmitButton pendingLabel="Enregistrement…" idleLabel={props.weather ? "Enregistrer" : "Ouvrir le tour aux ordres"} />
      </form>
    </div>
  );
}

function DetectionsPanel(props: {
  turnId: string;
  turnStatus: string;
  units: UnitDto[];
  detections: DetectionDto[];
  hoveredDetectionId: string | null;
  onHover: (id: string | null) => void;
}) {
  const [manualObserver, setManualObserver] = useState(props.units[0]?.id ?? "");
  if (props.turnStatus !== "PENDING_ARBITER_REVIEW" && props.turnStatus !== "RESOLVING") {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400">Détections</h2>
        <p className="text-sm text-slate-500">Rien à revoir pour l&apos;instant — attendez que tous les ordres du tour soient soumis.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-400">Détections proposées ({props.detections.length})</h2>
        <form action={publishTurnAction}>
          <input type="hidden" name="turnId" value={props.turnId} />
          <PublishButton />
        </form>
      </div>
      <ul className="space-y-2">
        {props.detections.map((d) => (
          <li
            key={d.id}
            onMouseEnter={() => props.onHover(d.id)}
            onMouseLeave={() => props.onHover(null)}
            className={`rounded-md border p-2 text-sm transition-colors ${props.hoveredDetectionId === d.id ? "border-yellow-400 bg-slate-800" : "border-slate-800 bg-slate-900"}`}
          >
            <div>
              <span className="font-medium">{d.observerName}</span> ({d.observerTeam}) → <span className="font-medium">{d.targetName}</span> ({d.targetTeam})
            </div>
            <div className="text-xs text-slate-500">
              {formatMethod(d.method)} · CPA {d.cpaDistanceNm.toFixed(1)}nm à +{Math.round(d.cpaMinutesIntoTurn)}min · {statusLabel(d.arbiterStatus)}
            </div>
            <div className="mt-1 flex gap-2">
              <form action={confirmDetectionAction}>
                <input type="hidden" name="detectionId" value={d.id} />
                <ConfirmButton disabled={d.arbiterStatus === "CONFIRMED" || d.arbiterStatus === "ADDED_MANUALLY"} />
              </form>
              <form action={rejectDetectionAction}>
                <input type="hidden" name="detectionId" value={d.id} />
                <RejectButton disabled={d.arbiterStatus === "REJECTED"} />
              </form>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ajouter une détection manuelle</h3>
      <form action={addManualDetectionAction} className="space-y-2 text-sm">
        <input type="hidden" name="turnId" value={props.turnId} />
        <label className="block">
          Observateur
          <select name="observerUnitId" value={manualObserver} onChange={(e) => setManualObserver(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
            {props.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.teamName})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Cible
          <select name="targetUnitId" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
            {props.units.filter((u) => u.teamId !== props.units.find((x) => x.id === manualObserver)?.teamId).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.teamName})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Méthode
          <select name="method" defaultValue="VISUAL" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
            <option value="VISUAL">Visuel</option>
            <option value="RADAR">Radar</option>
            <option value="HYDROPHONE">Hydrophone</option>
            <option value="SONAR">Sonar</option>
            <option value="OTHER">Autre</option>
          </select>
        </label>
        <label className="block">
          Note (optionnel)
          <input name="note" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
        </label>
        <AddManualButton />
      </form>
    </div>
  );
}

function PublishButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium hover:bg-emerald-500 disabled:opacity-60">
      {pending ? "Publication…" : "Publier le tour"}
    </button>
  );
}
function ConfirmButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="rounded bg-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-600 disabled:opacity-40">
      {pending ? "…" : "Confirmer"}
    </button>
  );
}
function RejectButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="rounded bg-red-800 px-2 py-0.5 text-xs hover:bg-red-700 disabled:opacity-40">
      {pending ? "…" : "Rejeter"}
    </button>
  );
}
function AddManualButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-brass-700 px-3 py-1.5 text-xs font-medium hover:bg-brass-600 disabled:opacity-60">
      {pending ? "Ajout…" : "Ajouter"}
    </button>
  );
}

function CombatsPanel({ engagements }: { engagements: EngagementDto[] }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function togglePause(engagementId: string, paused: boolean) {
    startTransition(async () => {
      await toggleArbiterPauseAction({ engagementId, paused });
      router.refresh();
    });
  }
  function endNow(engagementId: string) {
    startTransition(async () => {
      await arbiterEndEngagementAction({ engagementId });
      router.refresh();
    });
  }

  if (engagements.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400">Combats</h2>
        <p className="text-sm text-slate-500">Aucun combat tactique en cours.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-400">Combats en cours ({engagements.length})</h2>
      {engagements.map((e) => {
        const byTeam = new Map<string, EngagementDto["participants"]>();
        for (const p of e.participants) {
          const list = byTeam.get(p.teamId) ?? [];
          list.push(p);
          byTeam.set(p.teamId, list);
        }
        return (
          <div key={e.id} className="rounded-md border border-red-900/50 bg-red-950/10 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-red-300">
                Manche {e.roundNumber} — {e.status === "AWAITING_MOVEMENT" ? "mouvement" : e.status === "AWAITING_FIRE" ? "tir" : "terminée"}
                {e.arbiterPaused && <span className="ml-2 text-amber-400">⏸ suspendu</span>}
              </span>
              <Link href={`/arbiter/battle/${e.id}`} className="text-xs text-slate-500 hover:text-slate-300">
                Journal complet →
              </Link>
            </div>

            {Array.from(byTeam.entries()).map(([teamId, ps]) => (
              <table key={teamId} className="mb-1 w-full text-xs">
                <tbody>
                  {ps.map((p) => {
                    const ratio = p.healthMax && p.healthMax > 0 ? Math.max(0, (p.healthCurrent ?? 0) / p.healthMax) : null;
                    return (
                      <tr key={p.unitId} className="border-t border-red-900/30">
                        <td className="py-1 pr-2" style={{ color: p.teamColor }}>
                          {p.name}
                        </td>
                        <td className="w-20 py-1">
                          {ratio !== null && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                              <div className={`h-full ${ratio < 0.6 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${ratio * 100}%` }} />
                            </div>
                          )}
                        </td>
                        <td className={`py-1 pl-2 text-right ${p.status === "SUNK" ? "text-red-400" : p.status === "DAMAGED" ? "text-amber-400" : "text-slate-500"}`}>
                          {p.status === "SUNK" ? "coulé" : p.status === "DAMAGED" ? "endommagé" : "actif"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}

            {e.status !== "RESOLVED" && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => togglePause(e.id, !e.arbiterPaused)}
                  disabled={isPending}
                  className={`rounded px-2 py-1 text-xs font-medium ${e.arbiterPaused ? "bg-emerald-700 hover:bg-emerald-600" : "bg-amber-800 hover:bg-amber-700"}`}
                >
                  {e.arbiterPaused ? "▶ Relancer" : "⏸ Suspendre"}
                </button>
                <button onClick={() => endNow(e.id)} disabled={isPending} className="rounded bg-red-900 px-2 py-1 text-xs font-medium hover:bg-red-800">
                  Mettre fin
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTurnStatus(status: string) {
  switch (status) {
    case "PENDING_ORDERS":
      return "en attente d'ordres";
    case "RESOLVING":
      return "résolution en cours";
    case "PENDING_ARBITER_REVIEW":
      return "en attente de revue arbitre";
    case "PUBLISHED":
      return "publié";
    default:
      return status;
  }
}
function formatMethod(method: string) {
  switch (method) {
    case "RADAR":
      return "radar";
    case "VISUAL":
      return "visuel";
    case "HYDROPHONE":
      return "hydrophone";
    case "SONAR":
      return "sonar";
    case "HF_DF":
      return "goniométrie HF";
    default:
      return method;
  }
}
function statusLabel(status: string) {
  switch (status) {
    case "PROPOSED":
      return "proposé";
    case "CONFIRMED":
      return "confirmé";
    case "REJECTED":
      return "rejeté";
    case "ADDED_MANUALLY":
      return "ajouté manuellement";
    default:
      return status;
  }
}
