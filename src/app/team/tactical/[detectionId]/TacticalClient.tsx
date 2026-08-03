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

type ObserverDto = {
  id: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  beamMeters: number | null;
  maxSpeedKnots: number;
  combatProfile: CombatProfile | null;
  healthCurrent: number | null;
  healthMax: number | null;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
  depthBand: string;
  batteryChargePercent: number | null;
  oxygenHoursRemaining: number | null;
  oxygenEnduranceHours: number | null;
  torpedoesRemaining: number | null;
};

type TargetDto = {
  name: string;
  className: string;
  category: string;
  iconKey: string;
  lengthMeters: number | null;
  beamMeters: number | null;
  maxSpeedKnots: number;
  lastKnownLat: number;
  lastKnownLng: number;
};

const NM_TO_M = 1852;
/** Vitesse « de croisière type » utilisée pour l'estimation de chance de toucher, faute de connaître la vitesse réelle actuelle de la cible (brouillard de guerre). */
const ASSUMED_TARGET_SPEED_RATIO = 0.7;

export function TacticalClient(props: {
  detectionId: string;
  detectionConfirmed: boolean;
  tacticalModeRequested: boolean;
  method: string;
  cpaDistanceNm: number;
  cpaMinutesIntoTurn: number;
  mapZoom: number;
  weaponTypesAlreadyFired: string[];
  observer: ObserverDto;
  target: TargetDto;
}) {
  const { observer, target } = props;
  const [isPending, startTransition] = useTransition();
  const [requested, setRequested] = useState(props.tacticalModeRequested);
  const [error, setError] = useState<string | null>(null);
  const [firedWeapons, setFiredWeapons] = useState<string[]>(props.weaponTypesAlreadyFired);
  const [isFiring, startFiring] = useTransition();
  const [fireResult, setFireResult] = useState<TacticalFireResult | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);

  const torpedoTypes = observer.combatProfile?.torpedoTypes ?? null;
  const hasGuns = (observer.combatProfile?.guns?.length ?? 0) > 0;
  const hasTorpedoes = !!observer.combatProfile?.torpedoTubes;
  const torpedoBlockedByDepth =
    observer.category === "SUBMARINE" && (observer.depthBand === "MEDIUM" || observer.depthBand === "DEEP");
  const outOfTorpedoes = observer.torpedoesRemaining != null && observer.torpedoesRemaining <= 0;

  const [selectedWeapon, setSelectedWeapon] = useState<"GUN" | "TORPEDO" | null>(() => {
    if (hasGuns && !firedWeapons.includes("GUN")) return "GUN";
    if (hasTorpedoes && !torpedoBlockedByDepth && !outOfTorpedoes && !firedWeapons.includes("TORPEDO")) return "TORPEDO";
    return null;
  });
  const [selectedTorpedoTypeId, setSelectedTorpedoTypeId] = useState<string | null>(torpedoTypes?.[0]?.id ?? null);

  const currentRangeNm = useMemo(
    () => distanceNm({ lat: observer.currentLat, lng: observer.currentLng }, { lat: target.lastKnownLat, lng: target.lastKnownLng }),
    [observer.currentLat, observer.currentLng, target.lastKnownLat, target.lastKnownLng]
  );

  const bearingToTargetDeg = useMemo(
    () => bearingDeg({ lat: observer.currentLat, lng: observer.currentLng }, { lat: target.lastKnownLat, lng: target.lastKnownLng }),
    [observer.currentLat, observer.currentLng, target.lastKnownLat, target.lastKnownLng]
  );

  const estimate = useMemo(() => {
    const rangeM = currentRangeNm * NM_TO_M;
    const targetLengthM = target.lengthMeters ?? 100;
    const targetBeamM = target.beamMeters ?? 12;
    const assumedTargetSpeedKnots = target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO;

    const battery = selectGunBattery(observer.combatProfile, rangeM);
    const gunChance = battery
      ? gunHitChancePercent({
          calibreMm: battery.calibreMm,
          rangeM,
          maxRangeM: battery.rangeM,
          targetLengthM,
          targetBeamM,
          targetSpeedKnots: assumedTargetSpeedKnots,
        })
      : null;

    const torpedoBattery = selectTorpedoBattery(observer.combatProfile, selectedTorpedoTypeId);
    const torpedoChance =
      torpedoBattery && rangeM <= torpedoBattery.rangeM
        ? torpedoHitChancePercent({
            rangeM,
            maxRangeM: torpedoBattery.rangeM,
            torpedoSpeedKnots: torpedoBattery.speedKnots,
            targetLengthM,
            targetBeamM,
            targetSpeedKnots: assumedTargetSpeedKnots,
            // Angle de tir inconnu (cap actuel de la cible non observable) :
            // hypothèse médiane (travers partiel), ni le meilleur ni le pire cas.
            angleOfAttackDeg: 45,
          })
        : null;

    return { gunChance, torpedoChance, battery };
  }, [currentRangeNm, observer.combatProfile, target.lengthMeters, target.beamMeters, target.maxSpeedKnots, selectedTorpedoTypeId]);

  const targetSilhouette = classifySilhouette(target.category, target.className);
  const observerSilhouette = classifySilhouette(observer.category, observer.className);

  const sources = useMemo<MapSourceConfig[]>(
    () => [
      {
        id: "range-line",
        kind: "line",
        data: multiLineFeatureCollection([
          [
            { lat: observer.currentLat, lng: observer.currentLng },
            { lat: target.lastKnownLat, lng: target.lastKnownLng },
          ],
        ]),
        color: "#f97316",
        width: 2,
        dashed: true,
      },
      {
        id: "last-known-target",
        kind: "points",
        data: pointsFeatureCollection([{ lat: target.lastKnownLat, lng: target.lastKnownLng, properties: { name: `${target.name} (dernier contact)` } }]),
        color: "#f97316",
        radius: 6,
        showLabels: true,
      },
    ],
    [observer.currentLat, observer.currentLng, target.lastKnownLat, target.lastKnownLng, target.name]
  );

  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () => [
      {
        id: "observer",
        lat: observer.currentLat,
        lng: observer.currentLng,
        headingDeg: observer.currentHeadingDeg ?? 0,
        color: "#38bdf8",
        silhouette: observerSilhouette,
        lengthMeters: observer.lengthMeters ?? DEFAULT_LENGTH_METERS[observerSilhouette],
      },
      {
        id: "target-last-known",
        lat: target.lastKnownLat,
        lng: target.lastKnownLng,
        headingDeg: 0,
        color: "#f97316",
        silhouette: targetSilhouette,
        lengthMeters: target.lengthMeters ?? DEFAULT_LENGTH_METERS[targetSilhouette],
      },
    ],
    [observer, observerSilhouette, target, targetSilhouette]
  );

  function submitTacticalRequest() {
    setError(null);
    startTransition(async () => {
      const result = await requestTacticalModeAction({ detectionId: props.detectionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRequested(true);
    });
  }

  function fire() {
    if (!selectedWeapon) return;
    setFireError(null);
    setFireResult(null);
    startFiring(async () => {
      const result = await fireTacticalWeaponAction({
        detectionId: props.detectionId,
        weaponType: selectedWeapon,
        torpedoTypeId: selectedWeapon === "TORPEDO" ? (selectedTorpedoTypeId ?? undefined) : undefined,
      });
      if (!result.ok) {
        setFireError(result.error);
        return;
      }
      setFireResult(result.result);
      setFiredWeapons((prev) => [...prev, selectedWeapon]);
      setSelectedWeapon(null);
    });
  }

  const canFire = props.detectionConfirmed && selectedWeapon !== null && !isFiring;

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">Mode bataille tactique</h1>
          <p className="text-xs text-slate-500">
            {observer.name} vs {target.name}
          </p>
        </div>
        <Link href="/team/orders" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
          Retour aux ordres
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1">
          <GameMap
            center={{ lat: (observer.currentLat + target.lastKnownLat) / 2, lng: (observer.currentLng + target.lastKnownLng) / 2 }}
            zoom={props.mapZoom}
            sources={sources}
            fitToPoints={[
              { lat: observer.currentLat, lng: observer.currentLng },
              { lat: target.lastKnownLat, lng: target.lastKnownLng },
            ]}
            shipMarkers={shipMarkers}
            shipMarkersMinZoom={0}
            className="h-full w-full"
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4 text-sm">
          <div className="mb-4 rounded-md border border-orange-900/50 bg-orange-950/20 p-3">
            <p className="text-xs text-orange-300">
              Dernier contact confirmé : {formatMethod(props.method)} à {props.cpaDistanceNm.toFixed(1)}nm, +
              {Math.round(props.cpaMinutesIntoTurn)}min dans le tour précédent. La position de la cible ci-dessous est celle
              du dernier contact, pas sa position réelle actuelle : vous tirez sur une solution de tir estimée.
            </p>
          </div>

          <h2 className="mb-1 font-semibold">{observer.name}</h2>
          <p className="mb-3 text-xs text-slate-500">{observer.className}</p>

          {observer.category === "SUBMARINE" && (
            <SubmarineStatusPanel observer={observer} />
          )}

          <h2 className="mb-1 mt-4 font-semibold text-orange-300">{target.name}</h2>
          <p className="mb-3 text-xs text-slate-500">{target.className} (dernière position connue)</p>

          <div className="mb-4 rounded-md bg-slate-900 p-3">
            <div>Distance actuelle estimée : {currentRangeNm.toFixed(1)} nm</div>
            <div>Relèvement : {Math.round(bearingToTargetDeg)}°</div>
          </div>

          {/* ── Sélection de l'arme et tir ─────────────────────── */}
          <div className="mb-4 rounded-md border border-brass-700/40 bg-slate-900 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-400">Arme</div>
            <div className="mb-2 flex gap-2">
              <WeaponButton
                label="Canon"
                available={hasGuns}
                alreadyFired={firedWeapons.includes("GUN")}
                selected={selectedWeapon === "GUN"}
                onClick={() => setSelectedWeapon("GUN")}
              />
              <WeaponButton
                label="Torpille"
                available={hasTorpedoes && !torpedoBlockedByDepth && !outOfTorpedoes}
                alreadyFired={firedWeapons.includes("TORPEDO")}
                unavailableReason={
                  torpedoBlockedByDepth
                    ? "immersion trop grande"
                    : outOfTorpedoes
                      ? "plus de torpilles"
                      : undefined
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
                      {t.speedKnots}nds · portée {(t.rangeM / 1000).toFixed(1)}km · {t.wakeVisible ? "sillage visible" : "sans sillage"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mb-2 rounded-md bg-slate-950/60 p-2 text-xs">
              {selectedWeapon === "GUN" &&
                (estimate.gunChance !== null ? (
                  <div>
                    Artillerie ({estimate.battery?.calibreMm}mm) : ~{estimate.gunChance.toFixed(0)}% de chances de toucher
                  </div>
                ) : (
                  <div className="text-slate-500">Aucune batterie à portée de cette distance.</div>
                ))}
              {selectedWeapon === "TORPEDO" &&
                (estimate.torpedoChance !== null ? (
                  <div>Torpilles : ~{estimate.torpedoChance.toFixed(0)}% de chances de toucher</div>
                ) : (
                  <div className="text-slate-500">Cible hors de portée des torpilles.</div>
                ))}
              {!selectedWeapon && <div className="text-slate-500">Choisissez une arme pour voir l&apos;estimation.</div>}
              <div className="mt-1 text-slate-600">
                Hypothèse : cible à {Math.round(target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO)}nds, angle médian —
                l&apos;issue réelle dépend de la position et de la vitesse actuelles véritables de la cible.
              </div>
            </div>

            <button
              onClick={fire}
              disabled={!canFire}
              className="w-full rounded-md bg-red-800 px-3 py-2 font-medium hover:bg-red-700 disabled:opacity-40"
            >
              {isFiring ? "Tir en cours…" : "🔥 Faire feu"}
            </button>
            {!props.detectionConfirmed && (
              <p className="mt-1 text-xs text-amber-400">Cette détection n&apos;est plus confirmée par l&apos;arbitre.</p>
            )}
            {fireError && <p className="mt-1 text-xs text-red-400">{fireError}</p>}
          </div>

          {fireResult && (
            <div
              className={`mb-4 rounded-md border p-3 text-sm ${
                fireResult.hit ? "border-red-700 bg-red-950/40" : "border-slate-700 bg-slate-900"
              }`}
            >
              <div className="font-semibold">{fireResult.hit ? "Coup au but !" : "Tir manqué."}</div>
              {fireResult.hit && (
                <div className="text-xs text-slate-300">
                  {fireResult.hits} impact{fireResult.hits > 1 ? "s" : ""} · {fireResult.damagePoints.toFixed(1)} pts de dégâts
                  {fireResult.targetSunk && <span className="text-red-400"> · cible coulée</span>}
                </div>
              )}
              <div className="text-xs text-slate-500">Chance de toucher calculée : {fireResult.hitChancePercent.toFixed(0)}%</div>
            </div>
          )}

          <button
            onClick={submitTacticalRequest}
            disabled={requested || isPending}
            className="w-full rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900 disabled:opacity-50"
          >
            {requested ? "Arbitre signalé ✓" : isPending ? "Envoi…" : "Signaler cet engagement à l'arbitre"}
          </button>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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
      title={alreadyFired ? "Déjà tiré ce tour-ci" : unavailableReason}
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

function SubmarineStatusPanel({ observer }: { observer: ObserverDto }) {
  const battery = observer.batteryChargePercent ?? 100;
  const oxygenMax = observer.oxygenEnduranceHours ?? 48;
  const oxygen = observer.oxygenHoursRemaining ?? oxygenMax;
  const oxygenRatio = oxygenMax > 0 ? Math.max(0, Math.min(1, oxygen / oxygenMax)) : 0;

  return (
    <div className="mb-2 space-y-2 rounded-md bg-slate-900 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Palier d&apos;immersion</span>
        <span className="font-medium">{formatDepthBand(observer.depthBand)}</span>
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
          <span>{oxygen.toFixed(1)}h / {oxygenMax.toFixed(0)}h</span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full ${oxygenRatio < 0.3 ? "bg-amber-500" : "bg-sky-500"}`}
            style={{ width: `${oxygenRatio * 100}%` }}
          />
        </div>
      </div>
      {observer.torpedoesRemaining != null && (
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Torpilles restantes</span>
          <span className="font-medium">{observer.torpedoesRemaining}</span>
        </div>
      )}
    </div>
  );
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
