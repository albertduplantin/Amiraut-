"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { budgetCircleFeatureCollection, lineFeatureCollection, multiLineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import { clampPathToBudget, pathLengthNm, speedBudgetNm, bearingDeg, type LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import {
  gunHitChancePercent,
  torpedoHitChancePercent,
  listUsableGunBatteries,
  isTorpedoArcClear,
  type CombatProfile,
  type GunBattery,
} from "@/lib/combat";
import { assessFiringReveal } from "@/lib/tacticalNarrative";
import { submitMovementAction, submitFireAction, sendBattleChatAction } from "./actions";

type OwnUnit = {
  id: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  combatProfile: CombatProfile | null;
  maxSpeedKnots: number;
  healthCurrent: number | null;
  healthMax: number | null;
  status: string;
  currentLat: number;
  currentLng: number;
  headingDeg: number | null;
  depthBand: string;
  batteryChargePercent: number | null;
  oxygenHoursRemaining: number | null;
  oxygenEnduranceHours: number | null;
  torpedoesRemaining: number | null;
};

type Contact = {
  targetUnitId: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  beamMeters: number | null;
  maxSpeedKnots: number;
  method: string;
  distanceNm: number;
  bearingDeg: number;
  lat: number;
  lng: number;
  status: string;
};

type OwnAction = {
  unitId: string;
  phase: string;
  headingDeg: number | null;
  speedKnots: number | null;
  movementPath: LatLng[] | null;
  depthBand: string | null;
  targetUnitId: string | null;
  weaponType: string | null;
  torpedoTypeId: string | null;
  resolved: boolean;
  hit: boolean | null;
  hits: number | null;
  damagePoints: number | null;
  targetSunk: boolean | null;
  narrative: string | null;
};

type LogEntry = {
  roundNumber: number;
  unitId: string;
  targetUnitId: string | null;
  weaponType: string | null;
  hit: boolean | null;
  hits: number | null;
  damagePoints: number | null;
  targetSunk: boolean | null;
  narrative: string | null;
};

type BattleMessage = { id: string; kind: string; authorName: string; body: string; roundNumber: number; teamId: string | null };

type MovementDraft = { speedKnots: number; path: LatLng[] };
type PlannedShot = { targetUnitId: string; weaponType: "GUN" | "TORPEDO"; torpedoTypeId?: string };

const NM_TO_M = 1852;
const ASSUMED_TARGET_SPEED_RATIO = 0.7;

export function BattleClient(props: {
  engagementId: string;
  status: string;
  roundNumber: number;
  roundMinutes: number;
  syncMode: string;
  arbiterPaused: boolean;
  endReason: string | null;
  teamId: string;
  teams: { id: string; name: string }[];
  mapCenter: LatLng;
  mapZoom: number;
  submittedTeamIds: string[];
  ownUnits: OwnUnit[];
  contacts: Contact[];
  ownActions: OwnAction[];
  battleLog: LogEntry[];
  messages: BattleMessage[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chatBody, setChatBody] = useState("");
  const gameMapRef = useRef<GameMapHandle>(null);

  const livingOwnUnits = props.ownUnits.filter((u) => u.status !== "SUNK");
  const liveContacts = props.contacts.filter((c) => c.status !== "SUNK");

  const [selectedShipId, setSelectedShipId] = useState<string | null>(livingOwnUnits[0]?.id ?? null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedWeaponIndex, setSelectedWeaponIndex] = useState<number | null>(null);
  const [selectedTorpedoTypeId, setSelectedTorpedoTypeId] = useState<string | null>(null);

  const [movementDrafts, setMovementDrafts] = useState<Record<string, MovementDraft>>(() => {
    const init: Record<string, MovementDraft> = {};
    for (const u of props.ownUnits) {
      const prior = props.ownActions.find((a) => a.unitId === u.id && a.phase === "MOVEMENT");
      init[u.id] = { speedKnots: prior?.speedKnots ?? 0, path: prior?.movementPath ?? [] };
    }
    return init;
  });
  const [plannedShots, setPlannedShots] = useState<Record<string, PlannedShot>>(() => {
    const init: Record<string, PlannedShot> = {};
    for (const a of props.ownActions) {
      if (a.phase === "FIRE" && a.targetUnitId && a.weaponType) {
        init[a.unitId] = { targetUnitId: a.targetUnitId, weaponType: a.weaponType as "GUN" | "TORPEDO", torpedoTypeId: a.torpedoTypeId ?? undefined };
      }
    }
    return init;
  });

  const hasSubmittedThisPhase = props.submittedTeamIds.includes(props.teamId);

  // Rafraîchit automatiquement en attendant l'autre camp.
  useEffect(() => {
    if (props.status === "RESOLVED") return;
    if (!hasSubmittedThisPhase) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [hasSubmittedThisPhase, props.status, router]);

  const selectedShip = livingOwnUnits.find((u) => u.id === selectedShipId) ?? null;
  const selectedTarget = liveContacts.find((c) => c.targetUnitId === selectedTargetId) ?? null;
  const isMovementPhase = props.status === "AWAITING_MOVEMENT";

  const draft = selectedShip ? movementDrafts[selectedShip.id] : null;
  const budgetNm = selectedShip && draft ? speedBudgetNm(draft.speedKnots, props.roundMinutes) : 0;
  const usedNm =
    selectedShip && draft
      ? pathLengthNm([{ lat: selectedShip.currentLat, lng: selectedShip.currentLng }, ...draft.path])
      : 0;
  const remainingNm = Math.max(0, budgetNm - usedNm);
  const lastPoint = useMemo(
    () =>
      selectedShip && draft
        ? (draft.path[draft.path.length - 1] ?? { lat: selectedShip.currentLat, lng: selectedShip.currentLng })
        : null,
    [selectedShip, draft]
  );

  function updateDraftSpeed(speedKnots: number) {
    if (!selectedShip) return;
    setMovementDrafts((prev) => {
      const budget = speedBudgetNm(speedKnots, props.roundMinutes);
      const clamped = clampPathToBudget([{ lat: selectedShip.currentLat, lng: selectedShip.currentLng }, ...prev[selectedShip.id].path], budget);
      return { ...prev, [selectedShip.id]: { speedKnots, path: clamped.slice(1) } };
    });
  }

  function clearDraftPath() {
    if (!selectedShip) return;
    setMovementDrafts((prev) => ({ ...prev, [selectedShip.id]: { ...prev[selectedShip.id], path: [] } }));
  }

  function handleMapClick(pos: LatLng) {
    if (!isMovementPhase || !selectedShip || !draft) return;
    const start = { lat: selectedShip.currentLat, lng: selectedShip.currentLng };
    const previous = draft.path[draft.path.length - 1] ?? start;
    const budget = speedBudgetNm(draft.speedKnots, props.roundMinutes);
    const clamped = clampPathToBudget([start, ...draft.path, pos], budget);
    const newPoint = clamped[clamped.length - 1];
    if (gameMapRef.current && !gameMapRef.current.isWaterSegment(previous, newPoint)) {
      setError("Trajet impossible : il traverserait la terre.");
      return;
    }
    setError(null);
    setMovementDrafts((prev) => ({ ...prev, [selectedShip.id]: { ...prev[selectedShip.id], path: clamped.slice(1) } }));
  }

  function handleMarkerClick(markerId: string) {
    if (markerId.startsWith("own-")) {
      setSelectedShipId(markerId.slice(4));
      setSelectedWeaponIndex(null);
    } else if (markerId.startsWith("contact-")) {
      setSelectedTargetId(markerId.slice(8));
    }
  }

  function submitMovement() {
    setError(null);
    startTransition(async () => {
      const result = await submitMovementAction({
        engagementId: props.engagementId,
        moves: livingOwnUnits.map((u) => ({
          unitId: u.id,
          speedKnots: movementDrafts[u.id]?.speedKnots ?? 0,
          path: movementDrafts[u.id]?.path ?? [],
        })),
      });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function submitFire() {
    setError(null);
    startTransition(async () => {
      const shots = Object.entries(plannedShots).map(([unitId, s]) => ({
        unitId,
        targetUnitId: s.targetUnitId,
        weaponType: s.weaponType,
        torpedoTypeId: s.torpedoTypeId,
      }));
      const result = await submitFireAction({ engagementId: props.engagementId, shots });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function sendChat() {
    if (!chatBody.trim()) return;
    startTransition(async () => {
      await sendBattleChatAction({ engagementId: props.engagementId, body: chatBody });
      setChatBody("");
      router.refresh();
    });
  }

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(livingOwnUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: "#38bdf8",
        radius: 5,
        showLabels: true,
        fadeAboveZoom: 8,
      },
      {
        id: "contacts",
        kind: "points",
        data: pointsFeatureCollection(liveContacts.map((c) => ({ lat: c.lat, lng: c.lng, properties: { name: c.className } }))),
        color: "#f97316",
        radius: 5,
        showLabels: true,
        fadeAboveZoom: 8,
      },
    ];

    if (selectedShip) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection([{ lat: selectedShip.currentLat, lng: selectedShip.currentLng, properties: {} }]),
        color: "#facc15",
        radius: 10,
      });
    }
    if (selectedTarget) {
      list.push({
        id: "highlight-target",
        kind: "points",
        data: pointsFeatureCollection([{ lat: selectedTarget.lat, lng: selectedTarget.lng, properties: {} }]),
        color: "#fbbf24",
        radius: 10,
      });
    }

    if (isMovementPhase && selectedShip && draft) {
      const start = { lat: selectedShip.currentLat, lng: selectedShip.currentLng };
      list.push({ id: "draft-path", kind: "line", data: lineFeatureCollection([start, ...draft.path]), color: "#facc15", width: 3 });
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

    if (!isMovementPhase && selectedShip && selectedTarget) {
      list.push({
        id: "firing-line",
        kind: "line",
        data: multiLineFeatureCollection([
          [
            { lat: selectedShip.currentLat, lng: selectedShip.currentLng },
            { lat: selectedTarget.lat, lng: selectedTarget.lng },
          ],
        ]),
        color: "#facc15",
        width: 2,
        dashed: true,
      });
    }

    return list;
  }, [livingOwnUnits, liveContacts, selectedShip, selectedTarget, isMovementPhase, draft, lastPoint, remainingNm]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(() => {
    const own = livingOwnUnits.map((u) => {
      const silhouette = classifySilhouette(u.category, u.className);
      return {
        id: `own-${u.id}`,
        lat: u.currentLat,
        lng: u.currentLng,
        headingDeg: u.headingDeg ?? 0,
        color: u.id === selectedShipId ? "#facc15" : "#38bdf8",
        silhouette,
        lengthMeters: u.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
        status: u.status as "ACTIVE" | "DAMAGED" | "SUNK",
      };
    });
    const enemies = liveContacts.map((c) => {
      const silhouette = classifySilhouette(c.category, c.className);
      return {
        id: `contact-${c.targetUnitId}`,
        lat: c.lat,
        lng: c.lng,
        headingDeg: 0,
        color: c.targetUnitId === selectedTargetId ? "#fbbf24" : "#f97316",
        silhouette,
        lengthMeters: c.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
      };
    });
    return [...own, ...enemies];
  }, [livingOwnUnits, liveContacts, selectedShipId, selectedTargetId]);

  const fitPoints = [
    ...props.ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng })),
    ...props.contacts.map((c) => ({ lat: c.lat, lng: c.lng })),
  ];

  if (props.status === "RESOLVED") {
    return (
      <div className="chart-room-bg flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-slate-100">
        <h1 className="font-display text-2xl text-brass-300">Combat terminé</h1>
        <p className="text-slate-400">{formatEndReason(props.endReason)}</p>
        <Link href="/team/orders" className="rounded-md bg-brass-600 px-4 py-2 font-medium hover:bg-brass-500">
          Retour aux ordres
        </Link>
      </div>
    );
  }

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">
            Bataille tactique — manche {props.roundNumber}
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({formatDuration(props.roundMinutes)} · {props.syncMode === "SYNC" ? "synchrone" : "asynchrone"})
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Phase : {isMovementPhase ? "mouvement" : "tir"}
            {props.arbiterPaused && <span className="ml-2 text-amber-400">⏸ suspendu par l&apos;arbitre</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {props.teams.map((t) => (
            <span
              key={t.id}
              className={`rounded px-2 py-1 ${
                props.submittedTeamIds.includes(t.id) ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-800 text-slate-400"
              }`}
            >
              {t.name} {props.submittedTeamIds.includes(t.id) ? "✓ prêt" : "…"}
            </span>
          ))}
        </div>
        <Link href="/team/orders" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
          Retour aux ordres
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-800 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-400">Mes unités</h2>
          <ul className="mb-4 space-y-1">
            {livingOwnUnits.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => {
                    setSelectedShipId(u.id);
                    setSelectedWeaponIndex(null);
                  }}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                    u.id === selectedShipId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {u.name}
                      {u.status === "DAMAGED" && <span className="ml-1 text-amber-400">⚠</span>}
                    </span>
                    {!isMovementPhase && plannedShots[u.id] && <span className="text-emerald-400">🎯</span>}
                    {isMovementPhase && (movementDrafts[u.id]?.path.length ?? 0) > 0 && <span className="text-emerald-400">➜</span>}
                  </div>
                  <div className="text-slate-500">{u.className}</div>
                </button>
              </li>
            ))}
          </ul>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-400">Contacts</h2>
          {liveContacts.length === 0 ? (
            <p className="text-xs text-slate-600">Aucun.</p>
          ) : (
            <ul className="space-y-1">
              {liveContacts.map((c) => (
                <li key={c.targetUnitId}>
                  <button
                    onClick={() => setSelectedTargetId(c.targetUnitId)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                      c.targetUnitId === selectedTargetId ? "bg-orange-950/60 ring-1 ring-orange-500" : "hover:bg-slate-900"
                    }`}
                  >
                    <div className="font-medium text-orange-200">{c.className}</div>
                    <div className="text-slate-500">
                      {c.distanceNm.toFixed(1)}nm, gis. {Math.round(c.bearingDeg)}°
                    </div>
                  </button>
                </li>
              ))}
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
            fitToPoints={fitPoints}
            shipMarkers={shipMarkers}
            onShipMarkerClick={handleMarkerClick}
            shipMarkersMinZoom={0}
            showScaleAndRuler
            className="h-full w-full"
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4 text-sm">
          {hasSubmittedThisPhase ? (
            <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-950/20 p-4">
              <p className="text-emerald-300">Ordres soumis. En attente de l&apos;autre camp…</p>
              <p className="mt-1 text-xs text-slate-500">Cette page se rafraîchit toute seule.</p>
            </div>
          ) : props.arbiterPaused ? (
            <p className="rounded-md border border-amber-800 bg-amber-950/30 p-4 text-amber-200">
              L&apos;arbitre a suspendu le combat.
            </p>
          ) : selectedShip ? (
            isMovementPhase ? (
              <MovementDashboard
                ship={selectedShip}
                draft={draft!}
                budgetNm={budgetNm}
                usedNm={usedNm}
                remainingNm={remainingNm}
                roundMinutes={props.roundMinutes}
                onSpeedChange={updateDraftSpeed}
                onClear={clearDraftPath}
              />
            ) : (
              <FireDashboard
                ship={selectedShip}
                target={selectedTarget}
                plannedShot={plannedShots[selectedShip.id]}
                selectedWeaponIndex={selectedWeaponIndex}
                setSelectedWeaponIndex={setSelectedWeaponIndex}
                selectedTorpedoTypeId={selectedTorpedoTypeId}
                setSelectedTorpedoTypeId={setSelectedTorpedoTypeId}
                onPlan={(shot) => setPlannedShots((prev) => ({ ...prev, [selectedShip.id]: shot }))}
                onClearPlan={() =>
                  setPlannedShots((prev) => {
                    const next = { ...prev };
                    delete next[selectedShip.id];
                    return next;
                  })
                }
              />
            )
          ) : (
            <p className="text-sm text-slate-500">Sélectionnez une unité.</p>
          )}

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          {!hasSubmittedThisPhase && !props.arbiterPaused && (
            <button
              onClick={isMovementPhase ? submitMovement : submitFire}
              disabled={isPending}
              className={`mt-3 w-full rounded-md px-3 py-2 font-medium disabled:opacity-50 ${
                isMovementPhase ? "bg-brass-600 hover:bg-brass-500" : "bg-red-800 hover:bg-red-700"
              }`}
            >
              {isPending ? "Envoi…" : isMovementPhase ? "Valider le mouvement" : "Valider les tirs"}
            </button>
          )}

          {props.battleLog.length > 0 && (
            <div className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Journal de combat</h2>
              <ul className="space-y-2">
                {props.battleLog
                  .filter((a) => a.narrative)
                  .map((a, i) => (
                    <li key={i} className={`rounded-md px-3 py-2 text-xs ${a.hit ? "bg-red-950/40" : "bg-slate-800/60"}`}>
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">Manche {a.roundNumber}</div>
                      {a.narrative}
                      {a.hit && (
                        <div className="mt-1 text-slate-400">
                          {a.hits} impact{(a.hits ?? 0) > 1 ? "s" : ""} · {a.damagePoints?.toFixed(1)} pts
                          {a.targetSunk && <span className="text-red-400"> · coulé</span>}
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Communications</h2>
            <div className="mb-2 max-h-40 space-y-1 overflow-y-auto text-xs">
              {props.messages.length === 0 && <p className="text-slate-600">Aucun message.</p>}
              {props.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded px-2 py-1 ${
                    m.kind === "ARBITER_EVENT" ? "bg-orange-950/40 text-orange-200" : m.kind === "SYSTEM" ? "bg-slate-800/60 text-slate-400" : "bg-slate-800 text-slate-200"
                  }`}
                >
                  <span className="font-medium">{m.authorName}</span> (T{m.roundNumber}) : {m.body}
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={chatBody}
                onChange={(e) => setChatBody(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Message…"
                className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
              <button onClick={sendChat} className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
                Envoyer
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MovementDashboard({
  ship,
  draft,
  budgetNm,
  usedNm,
  remainingNm,
  roundMinutes,
  onSpeedChange,
  onClear,
}: {
  ship: OwnUnit;
  draft: MovementDraft;
  budgetNm: number;
  usedNm: number;
  remainingNm: number;
  roundMinutes: number;
  onSpeedChange: (speed: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">{ship.name}</h2>
        <p className="text-xs text-slate-500">{ship.className}</p>
      </div>
      <HealthBar unit={ship} />
      <label className="block text-xs">
        Vitesse : {draft.speedKnots} nds (max {ship.maxSpeedKnots})
        <input
          type="range"
          min={0}
          max={ship.maxSpeedKnots}
          value={draft.speedKnots}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="mt-1 w-full"
        />
      </label>
      <div className="rounded-md bg-slate-900 p-3 text-xs">
        <div>Budget cette manche : {budgetNm.toFixed(2)} nm ({formatDuration(roundMinutes)})</div>
        <div>Utilisé : {usedNm.toFixed(2)} nm</div>
        <div>Restant : {remainingNm.toFixed(2)} nm</div>
      </div>
      <p className="text-xs text-slate-500">Cliquez sur la carte pour tracer le trajet de cette manche.</p>
      <button onClick={onClear} className="w-full rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
        Effacer le trajet
      </button>
    </div>
  );
}

function FireDashboard({
  ship,
  target,
  plannedShot,
  selectedWeaponIndex,
  setSelectedWeaponIndex,
  selectedTorpedoTypeId,
  setSelectedTorpedoTypeId,
  onPlan,
  onClearPlan,
}: {
  ship: OwnUnit;
  target: Contact | null;
  plannedShot: PlannedShot | undefined;
  selectedWeaponIndex: number | null;
  setSelectedWeaponIndex: (i: number | null) => void;
  selectedTorpedoTypeId: string | null;
  setSelectedTorpedoTypeId: (id: string | null) => void;
  onPlan: (shot: PlannedShot) => void;
  onClearPlan: () => void;
}) {
  const relativeBearing = useMemo(() => {
    if (!target) return null;
    return bearingDeg({ lat: ship.currentLat, lng: ship.currentLng }, { lat: target.lat, lng: target.lng }) - (ship.headingDeg ?? 0);
  }, [ship, target]);

  const rangeM = target ? target.distanceNm * NM_TO_M : null;

  const usableGuns: GunBattery[] =
    rangeM !== null ? listUsableGunBatteries(ship.combatProfile, rangeM, relativeBearing ?? undefined) : [];
  const allGuns = useMemo(() => ship.combatProfile?.guns ?? [], [ship.combatProfile]);
  const torpedoTypes = ship.combatProfile?.torpedoTypes ?? null;
  const torpedoBattery = ship.combatProfile?.torpedoTubes ?? null;
  const torpedoInArc = torpedoBattery && relativeBearing !== null ? isTorpedoArcClear(torpedoBattery, relativeBearing) : null;
  const torpedoInRange = torpedoBattery && rangeM !== null ? rangeM <= torpedoBattery.rangeM : null;
  const outOfTorpedoes = ship.torpedoesRemaining != null && ship.torpedoesRemaining <= 0;

  const estimate = useMemo(() => {
    if (!target || rangeM === null) return null;
    const targetLengthM = target.lengthMeters ?? 100;
    const targetBeamM = target.beamMeters ?? 12;
    const assumedSpeed = target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO;

    if (selectedWeaponIndex !== null && allGuns[selectedWeaponIndex]) {
      const battery = allGuns[selectedWeaponIndex];
      return gunHitChancePercent({
        calibreMm: battery.calibreMm,
        rangeM,
        maxRangeM: battery.rangeM,
        targetLengthM,
        targetBeamM,
        targetSpeedKnots: assumedSpeed,
      });
    }
    if (selectedWeaponIndex === -1 && torpedoBattery) {
      const type = torpedoTypes?.find((t) => t.id === selectedTorpedoTypeId);
      return torpedoHitChancePercent({
        rangeM,
        maxRangeM: type?.rangeM ?? torpedoBattery.rangeM,
        torpedoSpeedKnots: type?.speedKnots ?? torpedoBattery.speedKnots,
        targetLengthM,
        targetBeamM,
        targetSpeedKnots: assumedSpeed,
        angleOfAttackDeg: 45,
      });
    }
    return null;
  }, [target, rangeM, selectedWeaponIndex, allGuns, torpedoBattery, torpedoTypes, selectedTorpedoTypeId]);

  const reveal =
    selectedWeaponIndex !== null
      ? assessFiringReveal({
          weaponType: selectedWeaponIndex === -1 ? "TORPEDO" : "GUN",
          calibreMm: selectedWeaponIndex >= 0 ? allGuns[selectedWeaponIndex]?.calibreMm : null,
          torpedoWakeVisible: torpedoTypes?.find((t) => t.id === selectedTorpedoTypeId)?.wakeVisible ?? true,
          isNight: false,
        })
      : null;

  function plan() {
    if (!target) return;
    if (selectedWeaponIndex === -1) {
      onPlan({ targetUnitId: target.targetUnitId, weaponType: "TORPEDO", torpedoTypeId: selectedTorpedoTypeId ?? undefined });
    } else if (selectedWeaponIndex !== null) {
      onPlan({ targetUnitId: target.targetUnitId, weaponType: "GUN" });
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">{ship.name}</h2>
        <p className="text-xs text-slate-500">{ship.className}</p>
      </div>
      <HealthBar unit={ship} />
      {ship.category === "SUBMARINE" && <SubmarineStatus unit={ship} />}

      <div>
        <h3 className="mb-1 text-xs font-semibold text-slate-400">Armement</h3>
        <ul className="space-y-1">
          {allGuns.map((g, i) => {
            const usable = usableGuns.includes(g);
            return (
              <li key={i}>
                <button
                  onClick={() => setSelectedWeaponIndex(i)}
                  disabled={!target}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                    selectedWeaponIndex === i
                      ? "bg-brass-900/50 ring-1 ring-brass-500"
                      : usable
                        ? "border border-slate-700 hover:bg-slate-800"
                        : "cursor-not-allowed opacity-40"
                  }`}
                  title={!target ? "Choisissez une cible" : !usable ? "Hors de portée ou hors arc de tir" : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span>
                      Canon {g.calibreMm}mm ×{g.count} ({formatArc(g.arc)})
                    </span>
                    <span className="text-slate-500">{g.roundsPerMinute} c/min</span>
                  </div>
                  {target && !usable && (
                    <div className="text-[11px] text-amber-400">
                      {rangeM !== null && g.rangeM < rangeM ? "hors de portée" : "hors arc de tir"}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
          {torpedoBattery && (
            <li>
              <button
                onClick={() => setSelectedWeaponIndex(-1)}
                disabled={!target || outOfTorpedoes}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                  selectedWeaponIndex === -1
                    ? "bg-brass-900/50 ring-1 ring-brass-500"
                    : torpedoInArc !== false && torpedoInRange !== false && !outOfTorpedoes
                      ? "border border-slate-700 hover:bg-slate-800"
                      : "cursor-not-allowed opacity-40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Torpilles ({formatArc(torpedoBattery.arc ?? "BROADSIDE")})</span>
                  {ship.torpedoesRemaining != null && <span className="text-slate-500">{ship.torpedoesRemaining} restantes</span>}
                </div>
                {target && outOfTorpedoes && <div className="text-[11px] text-amber-400">plus de torpilles</div>}
                {target && !outOfTorpedoes && torpedoInRange === false && <div className="text-[11px] text-amber-400">hors de portée</div>}
                {target && !outOfTorpedoes && torpedoInRange !== false && torpedoInArc === false && (
                  <div className="text-[11px] text-amber-400">hors arc de tir</div>
                )}
              </button>
            </li>
          )}
          {allGuns.length === 0 && !torpedoBattery && <li className="text-xs text-slate-600">Aucune arme.</li>}
        </ul>
      </div>

      {selectedWeaponIndex === -1 && torpedoTypes && torpedoTypes.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-400">Type de torpille</div>
          {torpedoTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTorpedoTypeId(t.id)}
              className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                selectedTorpedoTypeId === t.id ? "bg-brass-900/50 ring-1 ring-brass-500" : "border border-slate-700 hover:bg-slate-800"
              }`}
            >
              {t.label} — {t.speedKnots}nds, {(t.rangeM / 1000).toFixed(1)}km, {t.wakeVisible ? "sillage visible" : "sans sillage"}
            </button>
          ))}
        </div>
      )}

      {!target && <p className="text-xs text-slate-500">Sélectionnez un contact (carte ou liste) pour viser.</p>}

      {target && selectedWeaponIndex !== null && (
        <div className="rounded-md bg-slate-950/60 p-2 text-xs">
          <div>
            Cible : {target.className} — {target.distanceNm.toFixed(1)}nm, gis. {Math.round(target.bearingDeg)}°
          </div>
          {estimate !== null ? <div>Chance de toucher : ~{estimate.toFixed(0)}%</div> : <div className="text-slate-500">Non tirable.</div>}
          {reveal && reveal.revealRadiusNm > 0 && (
            <div className="mt-1 text-amber-400">
              ⚠ {reveal.label} — {reveal.reason}
            </div>
          )}
          <button
            onClick={plan}
            disabled={estimate === null}
            className="mt-2 w-full rounded-md bg-red-800 px-2 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-40"
          >
            Prévoir ce tir
          </button>
        </div>
      )}

      {plannedShot && (
        <div className="rounded-md border border-emerald-800 bg-emerald-950/20 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span>Tir prévu : {plannedShot.weaponType === "GUN" ? "canon" : "torpille"}</span>
            <button onClick={onClearPlan} className="text-slate-400 underline hover:text-slate-200">
              annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HealthBar({ unit }: { unit: OwnUnit }) {
  const ratio = unit.healthMax && unit.healthMax > 0 ? Math.max(0, Math.min(1, (unit.healthCurrent ?? 0) / unit.healthMax)) : null;
  if (ratio === null) return null;
  return (
    <div className="rounded-md bg-slate-900 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className={unit.status === "DAMAGED" ? "text-amber-400" : "text-slate-400"}>
          {unit.status === "DAMAGED" ? "Endommagé" : "État"}
        </span>
        <span className="text-slate-500">
          {Math.round(unit.healthCurrent ?? 0)} / {Math.round(unit.healthMax ?? 0)} pts
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${ratio < 0.6 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function SubmarineStatus({ unit }: { unit: OwnUnit }) {
  const battery = unit.batteryChargePercent ?? 100;
  const oxygenMax = unit.oxygenEnduranceHours ?? 48;
  const oxygen = unit.oxygenHoursRemaining ?? oxygenMax;
  return (
    <div className="rounded-md bg-slate-900 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Immersion</span>
        <span>{formatDepthBand(unit.depthBand)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Batterie</span>
        <span>{battery.toFixed(0)}%</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Oxygène</span>
        <span>
          {oxygen.toFixed(1)}h / {oxygenMax.toFixed(0)}h
        </span>
      </div>
    </div>
  );
}

function formatArc(arc: string) {
  switch (arc) {
    case "FORWARD":
      return "avant";
    case "AFT":
      return "arrière";
    case "ALL_ROUND":
      return "tout azimut";
    case "BROADSIDE":
      return "travers";
    default:
      return arc;
  }
}

function formatDuration(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

function formatDepthBand(band: string) {
  switch (band) {
    case "SURFACE":
      return "Surface";
    case "SHALLOW":
      return "Immersion faible";
    case "MEDIUM":
      return "Immersion moyenne";
    case "DEEP":
      return "Grande immersion";
    default:
      return band;
  }
}

function formatEndReason(reason: string | null) {
  switch (reason) {
    case "ALL_ENEMIES_SUNK":
      return "L'adversaire a été anéanti ou s'est retiré.";
    case "CONTACT_LOST":
      return "Le contact a été rompu.";
    case "OUT_OF_AMMUNITION":
      return "Plus aucun camp n'a de quoi tirer.";
    case "ARBITER_ENDED":
      return "L'arbitre a mis fin au combat.";
    case "DISENGAGED":
      return "Rupture de contact volontaire.";
    default:
      return "Combat terminé.";
  }
}
