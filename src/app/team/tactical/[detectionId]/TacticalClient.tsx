"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { GameMap, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { multiLineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import { distanceNm, bearingDeg } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import { selectGunBattery, gunHitChancePercent, torpedoHitChancePercent, type CombatProfile } from "@/lib/combat";
import { requestTacticalModeAction } from "./actions";

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
  tacticalModeRequested: boolean;
  method: string;
  cpaDistanceNm: number;
  cpaMinutesIntoTurn: number;
  mapZoom: number;
  observer: ObserverDto;
  target: TargetDto;
}) {
  const { observer, target } = props;
  const [isPending, startTransition] = useTransition();
  const [requested, setRequested] = useState(props.tacticalModeRequested);
  const [error, setError] = useState<string | null>(null);

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

    const torpedoTubes = observer.combatProfile?.torpedoTubes;
    const torpedoChance =
      torpedoTubes && rangeM <= torpedoTubes.rangeM
        ? torpedoHitChancePercent({
            rangeM,
            maxRangeM: torpedoTubes.rangeM,
            torpedoSpeedKnots: torpedoTubes.speedKnots,
            targetLengthM,
            targetBeamM,
            targetSpeedKnots: assumedTargetSpeedKnots,
            // Angle de tir inconnu (cap actuel de la cible non observable) :
            // hypothèse médiane (travers partiel), ni le meilleur ni le pire cas.
            angleOfAttackDeg: 45,
          })
        : null;

    return { gunChance, torpedoChance, battery };
  }, [currentRangeNm, observer.combatProfile, target.lengthMeters, target.beamMeters, target.maxSpeedKnots]);

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
              du dernier contact, pas sa position réelle actuelle.
            </p>
          </div>

          <h2 className="mb-1 font-semibold">{observer.name}</h2>
          <p className="mb-3 text-xs text-slate-500">{observer.className}</p>

          <h2 className="mb-1 font-semibold text-orange-300">{target.name}</h2>
          <p className="mb-3 text-xs text-slate-500">{target.className} (dernière position connue)</p>

          <div className="mb-4 rounded-md bg-slate-900 p-3">
            <div>Distance actuelle estimée : {currentRangeNm.toFixed(1)} nm</div>
            <div>Relèvement : {Math.round(bearingToTargetDeg)}°</div>
          </div>

          <div className="mb-4 rounded-md bg-slate-900 p-3">
            <div className="mb-1 text-xs font-semibold text-slate-400">
              Estimation de tir (hypothèse : cible à {Math.round(target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO)}nds, angle médian)
            </div>
            {estimate.gunChance !== null && (
              <div>
                Artillerie ({estimate.battery?.calibreMm}mm) : ~{estimate.gunChance.toFixed(0)}%
              </div>
            )}
            {estimate.torpedoChance !== null && <div>Torpilles : ~{estimate.torpedoChance.toFixed(0)}%</div>}
            {estimate.gunChance === null && estimate.torpedoChance === null && (
              <div className="text-slate-500">Aucune arme à portée à cette distance.</div>
            )}
          </div>

          <button
            onClick={submitTacticalRequest}
            disabled={requested || isPending}
            className="w-full rounded-md bg-brass-600 px-3 py-2 font-medium hover:bg-brass-500 disabled:opacity-50"
          >
            {requested ? "Mode tactique demandé ✓" : isPending ? "Envoi…" : "Demander le mode bataille tactique"}
          </button>
          {requested && (
            <p className="mt-2 text-xs text-slate-500">
              L&apos;arbitre a été signalé. Il reste libre d&apos;en tenir compte (par exemple en raccourcissant le tour
              suivant pour une résolution plus fine de cet engagement).
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </aside>
      </div>
    </div>
  );
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
