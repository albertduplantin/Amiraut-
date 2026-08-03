"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { GameMap, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { multiLineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import { distanceNm, bearingDeg } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import {
  selectGunBattery,
  gunHitChancePercent,
  selectTorpedoBattery,
  torpedoHitChancePercent,
  type CombatProfile,
} from "@/lib/combat";
import { requestTacticalModeAction, fireTacticalWeaponAction } from "./actions";
import type { TacticalFireResult } from "@/lib/turnEngine";

type OwnUnitDto = {
  id: string;
  name: string;
  className: string;
  category: string;
  fleetName: string;
  lengthMeters: number | null;
  maxSpeedKnots: number;
  combatProfile: CombatProfile | null;
  healthCurrent: number | null;
  healthMax: number | null;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
  status: string;
  depthBand: string;
  batteryChargePercent: number | null;
  oxygenHoursRemaining: number | null;
  oxygenEnduranceHours: number | null;
  torpedoesRemaining: number | null;
};

type ContactDto = {
  detectionEventId: string;
  targetUnitId: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  beamMeters: number | null;
  maxSpeedKnots: number;
  method: string;
  observedBy: string;
  turnNumber: number;
  lastKnownLat: number;
  lastKnownLng: number;
};

type FiredEntry = { attackerUnitId: string; targetUnitId: string; weaponType: string };

const NM_TO_M = 1852;
/** Faute de connaître la vitesse réelle de la cible (brouillard de guerre), on suppose une allure de croisière. */
const ASSUMED_TARGET_SPEED_RATIO = 0.7;

export function TacticalClient(props: {
  detectionId: string;
  currentTurnNumber: number | null;
  currentTurnDurationMinutes: number | null;
  mapZoom: number;
  focusAttackerId: string;
  focusTargetId: string;
  alreadyFired: FiredEntry[];
  ownUnits: OwnUnitDto[];
  contacts: ContactDto[];
}) {
  const { ownUnits, contacts } = props;

  const [firedEntries, setFiredEntries] = useState<FiredEntry[]>(props.alreadyFired);
  const [attackerId, setAttackerId] = useState<string>(props.focusAttackerId);
  const [targetId, setTargetId] = useState<string>(props.focusTargetId);
  const [selectedWeapon, setSelectedWeapon] = useState<"GUN" | "TORPEDO" | null>(null);
  const [selectedTorpedoTypeId, setSelectedTorpedoTypeId] = useState<string | null>(null);
  const [fireResult, setFireResult] = useState<TacticalFireResult | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);
  const [isFiring, startFiring] = useTransition();
  const [requested, setRequested] = useState(false);
  const [isPending, startTransition] = useTransition();

  const attacker = ownUnits.find((u) => u.id === attackerId) ?? ownUnits[0] ?? null;
  const target = contacts.find((c) => c.targetUnitId === targetId) ?? contacts[0] ?? null;

  const hasFired = (weaponType: string) =>
    !!attacker && !!target && firedEntries.some((f) => f.attackerUnitId === attacker.id && f.targetUnitId === target.targetUnitId && f.weaponType === weaponType);

  const torpedoTypes = attacker?.combatProfile?.torpedoTypes ?? null;
  const hasGuns = (attacker?.combatProfile?.guns?.length ?? 0) > 0;
  const hasTorpedoes = !!attacker?.combatProfile?.torpedoTubes;
  const torpedoBlockedByDepth =
    attacker?.category === "SUBMARINE" && (attacker.depthBand === "MEDIUM" || attacker.depthBand === "DEEP");
  const outOfTorpedoes = attacker?.torpedoesRemaining != null && attacker.torpedoesRemaining <= 0;

  const rangeNm = useMemo(() => {
    if (!attacker || !target) return 0;
    return distanceNm(
      { lat: attacker.currentLat, lng: attacker.currentLng },
      { lat: target.lastKnownLat, lng: target.lastKnownLng }
    );
  }, [attacker, target]);

  const bearingDegToTarget = useMemo(() => {
    if (!attacker || !target) return 0;
    const raw = bearingDeg(
      { lat: attacker.currentLat, lng: attacker.currentLng },
      { lat: target.lastKnownLat, lng: target.lastKnownLng }
    );
    // Relèvement en gisement compas (0-360°) : turf renvoie -180..180.
    return ((raw % 360) + 360) % 360;
  }, [attacker, target]);

  const estimate = useMemo(() => {
    if (!attacker || !target) return { gunChance: null, torpedoChance: null, battery: null };
    const rangeM = rangeNm * NM_TO_M;
    const targetLengthM = target.lengthMeters ?? 100;
    const targetBeamM = target.beamMeters ?? 12;
    const assumedSpeed = target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO;

    const battery = selectGunBattery(attacker.combatProfile, rangeM);
    const gunChance = battery
      ? gunHitChancePercent({
          calibreMm: battery.calibreMm,
          rangeM,
          maxRangeM: battery.rangeM,
          targetLengthM,
          targetBeamM,
          targetSpeedKnots: assumedSpeed,
        })
      : null;

    const torpedoBattery = selectTorpedoBattery(attacker.combatProfile, selectedTorpedoTypeId);
    const torpedoChance =
      torpedoBattery && rangeM <= torpedoBattery.rangeM
        ? torpedoHitChancePercent({
            rangeM,
            maxRangeM: torpedoBattery.rangeM,
            torpedoSpeedKnots: torpedoBattery.speedKnots,
            targetLengthM,
            targetBeamM,
            targetSpeedKnots: assumedSpeed,
            // Cap réel de la cible inconnu : hypothèse médiane (travers partiel).
            angleOfAttackDeg: 45,
          })
        : null;

    return { gunChance, torpedoChance, battery };
  }, [attacker, target, rangeNm, selectedTorpedoTypeId]);

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: "#38bdf8",
        radius: 5,
        showLabels: true,
        fadeAboveZoom: 8,
      },
      {
        id: "contacts",
        kind: "points",
        data: pointsFeatureCollection(
          contacts.map((c) => ({ lat: c.lastKnownLat, lng: c.lastKnownLng, properties: { name: `${c.name} (T${c.turnNumber})` } }))
        ),
        color: "#f97316",
        radius: 5,
        showLabels: true,
        fadeAboveZoom: 8,
      },
    ];

    if (attacker && target) {
      list.push({
        id: "firing-line",
        kind: "line",
        data: multiLineFeatureCollection([
          [
            { lat: attacker.currentLat, lng: attacker.currentLng },
            { lat: target.lastKnownLat, lng: target.lastKnownLng },
          ],
        ]),
        color: "#facc15",
        width: 2,
        dashed: true,
      });
      list.push({
        id: "engagement-highlight",
        kind: "points",
        data: pointsFeatureCollection([
          { lat: attacker.currentLat, lng: attacker.currentLng, properties: {} },
          { lat: target.lastKnownLat, lng: target.lastKnownLng, properties: {} },
        ]),
        color: "#facc15",
        radius: 11,
      });
    }

    return list;
  }, [ownUnits, contacts, attacker, target]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(() => {
    const own = ownUnits.map((u) => {
      const silhouette = classifySilhouette(u.category, u.className);
      return {
        id: `own-${u.id}`,
        lat: u.currentLat,
        lng: u.currentLng,
        headingDeg: u.currentHeadingDeg ?? 0,
        color: u.id === attackerId ? "#facc15" : "#38bdf8",
        silhouette,
        lengthMeters: u.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
        status: u.status as "ACTIVE" | "DAMAGED" | "SUNK",
      };
    });
    const enemies = contacts.map((c) => {
      const silhouette = classifySilhouette(c.category, c.className);
      return {
        id: `contact-${c.targetUnitId}`,
        lat: c.lastKnownLat,
        lng: c.lastKnownLng,
        headingDeg: 0,
        color: c.targetUnitId === targetId ? "#fbbf24" : "#f97316",
        silhouette,
        lengthMeters: c.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
      };
    });
    return [...own, ...enemies];
  }, [ownUnits, contacts, attackerId, targetId]);

  function handleMarkerClick(markerId: string) {
    if (markerId.startsWith("own-")) {
      setAttackerId(markerId.slice(4));
      setSelectedWeapon(null);
      setFireResult(null);
      setFireError(null);
    } else if (markerId.startsWith("contact-")) {
      setTargetId(markerId.slice(8));
      setSelectedWeapon(null);
      setFireResult(null);
      setFireError(null);
    }
  }

  function fire() {
    if (!selectedWeapon || !attacker || !target) return;
    setFireError(null);
    setFireResult(null);
    startFiring(async () => {
      const result = await fireTacticalWeaponAction({
        detectionId: props.detectionId,
        attackerUnitId: attacker.id,
        targetUnitId: target.targetUnitId,
        weaponType: selectedWeapon,
        torpedoTypeId: selectedWeapon === "TORPEDO" ? (selectedTorpedoTypeId ?? undefined) : undefined,
      });
      if (!result.ok) {
        setFireError(result.error);
        return;
      }
      setFireResult(result.result);
      setFiredEntries((prev) => [
        ...prev,
        { attackerUnitId: attacker.id, targetUnitId: target.targetUnitId, weaponType: selectedWeapon },
      ]);
      setSelectedWeapon(null);
    });
  }

  function signalArbiter() {
    startTransition(async () => {
      const result = await requestTacticalModeAction({ detectionId: props.detectionId });
      if (result.ok) setRequested(true);
    });
  }

  const fitPoints = [
    ...ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng })),
    ...contacts.map((c) => ({ lat: c.lastKnownLat, lng: c.lastKnownLng })),
  ];

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">Mode bataille tactique</h1>
          <p className="text-xs text-slate-500">
            {ownUnits.length} unité{ownUnits.length > 1 ? "s" : ""} · {contacts.length} contact
            {contacts.length > 1 ? "s" : ""} connu{contacts.length > 1 ? "s" : ""}
            {props.currentTurnNumber !== null && ` · tour ${props.currentTurnNumber} en cours`}
            {props.currentTurnDurationMinutes !== null && ` (${formatDuration(props.currentTurnDurationMinutes)})`}
          </p>
        </div>
        <Link href="/team/orders" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
          Retour aux ordres
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Colonne gauche : mes unités */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-800 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-400">Mes unités</h2>
          <ul className="space-y-1">
            {ownUnits.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => handleMarkerClick(`own-${u.id}`)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                    u.id === attackerId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                  }`}
                >
                  <div className="font-medium">
                    {u.name}
                    {u.status === "DAMAGED" && <span className="ml-1 text-amber-400">⚠</span>}
                  </div>
                  <div className="text-slate-500">{u.className}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="relative flex-1">
          <GameMap
            center={{ lat: attacker?.currentLat ?? 72, lng: attacker?.currentLng ?? 15 }}
            zoom={props.mapZoom}
            sources={sources}
            fitToPoints={fitPoints}
            shipMarkers={shipMarkers}
            onShipMarkerClick={handleMarkerClick}
            shipMarkersMinZoom={0}
            showScaleAndRuler
            className="h-full w-full"
          />
        </main>

        {/* Colonne droite : contacts + poste de tir */}
        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4 text-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-400">Contacts détectés</h2>
          {contacts.length === 0 ? (
            <p className="mb-4 text-xs text-slate-500">Aucun contact ennemi confirmé pour l&apos;instant.</p>
          ) : (
            <ul className="mb-4 space-y-1">
              {contacts.map((c) => (
                <li key={c.targetUnitId}>
                  <button
                    onClick={() => handleMarkerClick(`contact-${c.targetUnitId}`)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                      c.targetUnitId === targetId ? "bg-orange-950/60 ring-1 ring-orange-500" : "hover:bg-slate-900"
                    }`}
                  >
                    <div className="font-medium text-orange-200">{c.className}</div>
                    <div className="text-slate-500">
                      repéré par {c.observedBy} ({formatMethod(c.method)}), tour {c.turnNumber}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {attacker && target ? (
            <>
              <div className="mb-3 rounded-md bg-slate-900 p-3">
                <div className="mb-1 text-xs font-semibold text-slate-400">Engagement</div>
                <div className="text-xs">
                  <span className="text-sky-300">{attacker.name}</span> →{" "}
                  <span className="text-orange-300">{target.className}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Distance estimée : {rangeNm.toFixed(1)} nm · relèvement {Math.round(bearingDegToTarget)}°
                </div>
                <div className="text-[11px] text-slate-600">
                  Position du dernier contact (tour {target.turnNumber}), pas la position réelle actuelle.
                </div>
              </div>

              {attacker.category === "SUBMARINE" && <SubmarineStatusPanel unit={attacker} />}

              <div className="mb-3 rounded-md border border-brass-700/40 bg-slate-900 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-400">Arme</div>
                <div className="mb-2 flex gap-2">
                  <WeaponButton
                    label="Canon"
                    available={hasGuns}
                    alreadyFired={hasFired("GUN")}
                    selected={selectedWeapon === "GUN"}
                    onClick={() => setSelectedWeapon("GUN")}
                  />
                  <WeaponButton
                    label="Torpille"
                    available={hasTorpedoes && !torpedoBlockedByDepth && !outOfTorpedoes}
                    alreadyFired={hasFired("TORPEDO")}
                    unavailableReason={
                      torpedoBlockedByDepth ? "immersion trop grande" : outOfTorpedoes ? "plus de torpilles" : undefined
                    }
                    selected={selectedWeapon === "TORPEDO"}
                    onClick={() => setSelectedWeapon("TORPEDO")}
                  />
                </div>

                {selectedWeapon === "TORPEDO" && torpedoTypes && torpedoTypes.length > 0 && (
                  <div className="mb-2 space-y-1">
                    <div className="text-xs font-semibold text-slate-400">Type de torpille</div>
                    {torpedoTypes.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTorpedoTypeId(t.id)}
                        className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                          selectedTorpedoTypeId === t.id ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-800"
                        }`}
                      >
                        <div className="font-medium">{t.label}</div>
                        <div className="text-slate-500">
                          {t.speedKnots}nds · portée {(t.rangeM / 1000).toFixed(1)}km ·{" "}
                          {t.wakeVisible ? "sillage visible" : "sans sillage"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mb-2 rounded-md bg-slate-950/60 p-2 text-xs">
                  {selectedWeapon === "GUN" &&
                    (estimate.gunChance !== null ? (
                      <div>
                        Artillerie ({estimate.battery?.calibreMm}mm) : ~{estimate.gunChance.toFixed(0)}% de chances
                      </div>
                    ) : (
                      <div className="text-slate-500">Aucune batterie à portée de cette distance.</div>
                    ))}
                  {selectedWeapon === "TORPEDO" &&
                    (estimate.torpedoChance !== null ? (
                      <div>Torpilles : ~{estimate.torpedoChance.toFixed(0)}% de chances</div>
                    ) : (
                      <div className="text-slate-500">Cible hors de portée des torpilles.</div>
                    ))}
                  {!selectedWeapon && <div className="text-slate-500">Choisissez une arme pour voir l&apos;estimation.</div>}
                </div>

                <button
                  onClick={fire}
                  disabled={!selectedWeapon || isFiring}
                  className="w-full rounded-md bg-red-800 px-3 py-2 font-medium hover:bg-red-700 disabled:opacity-40"
                >
                  {isFiring ? "Tir en cours…" : "🔥 Faire feu"}
                </button>
                {fireError && <p className="mt-1 text-xs text-red-400">{fireError}</p>}
              </div>

              {fireResult && (
                <div
                  className={`mb-3 rounded-md border p-3 ${
                    fireResult.hit ? "border-red-700 bg-red-950/40" : "border-slate-700 bg-slate-900"
                  }`}
                >
                  <div className="font-semibold">{fireResult.hit ? "Coup au but !" : "Tir manqué."}</div>
                  {fireResult.hit && (
                    <div className="text-xs text-slate-300">
                      {fireResult.hits} impact{fireResult.hits > 1 ? "s" : ""} · {fireResult.damagePoints.toFixed(1)} pts
                      {fireResult.targetSunk && <span className="text-red-400"> · cible coulée</span>}
                    </div>
                  )}
                  <div className="text-xs text-slate-500">Chance calculée : {fireResult.hitChancePercent.toFixed(0)}%</div>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">Sélectionnez une de vos unités et un contact pour engager.</p>
          )}

          <button
            onClick={signalArbiter}
            disabled={requested || isPending}
            className="w-full rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900 disabled:opacity-50"
          >
            {requested ? "Arbitre signalé ✓" : isPending ? "Envoi…" : "Demander un tour court à l'arbitre"}
          </button>
        </aside>
      </div>
    </div>
  );
}

function WeaponButton({
  label,
  available,
  alreadyFired,
  selected,
  unavailableReason,
  onClick,
}: {
  label: string;
  available: boolean;
  alreadyFired: boolean;
  selected: boolean;
  unavailableReason?: string;
  onClick: () => void;
}) {
  const disabled = !available || alreadyFired;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={alreadyFired ? "Déjà tiré ce tour-ci sur cette cible" : unavailableReason}
      className={`flex-1 rounded-md px-2 py-1.5 text-xs transition ${
        selected
          ? "bg-brass-900/50 ring-1 ring-brass-500"
          : disabled
            ? "cursor-not-allowed opacity-30"
            : "border border-slate-700 hover:bg-slate-800"
      }`}
    >
      {label}
      {alreadyFired && <div className="text-[10px] text-slate-500">déjà tiré</div>}
    </button>
  );
}

function SubmarineStatusPanel({ unit }: { unit: OwnUnitDto }) {
  const battery = unit.batteryChargePercent ?? 100;
  const oxygenMax = unit.oxygenEnduranceHours ?? 48;
  const oxygen = unit.oxygenHoursRemaining ?? oxygenMax;
  const oxygenRatio = oxygenMax > 0 ? Math.max(0, Math.min(1, oxygen / oxygenMax)) : 0;

  return (
    <div className="mb-3 space-y-2 rounded-md bg-slate-900 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Immersion</span>
        <span className="font-medium">{formatDepthBand(unit.depthBand)}</span>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Batterie</span>
          <span>{battery.toFixed(0)}%</span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full ${battery < 30 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${battery}%` }} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Oxygène</span>
          <span>
            {oxygen.toFixed(1)}h / {oxygenMax.toFixed(0)}h
          </span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full ${oxygenRatio < 0.3 ? "bg-amber-500" : "bg-sky-500"}`}
            style={{ width: `${oxygenRatio * 100}%` }}
          />
        </div>
      </div>
      {unit.torpedoesRemaining != null && (
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Torpilles</span>
          <span className="font-medium">{unit.torpedoesRemaining}</span>
        </div>
      )}
    </div>
  );
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
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
    default:
      return method;
  }
}
