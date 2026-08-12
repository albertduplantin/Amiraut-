"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GameMap, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { pointsFeatureCollection } from "@/lib/mapData";
import type { LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";

type OwnUnit = {
  id: string;
  name: string;
  pennant: string | null;
  status: string;
  healthCurrent: number | null;
  healthMax: number | null;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
  unitClass: { name: string; iconKey: string; category: string; lengthMeters: number | null };
};

type CombatLogEntry = {
  side: "ATTACKER" | "TARGET";
  attackerName: string;
  targetName: string;
  weaponType: string;
  hits: number;
  damagePoints: number;
  targetSunk: boolean;
};

type Contact = {
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

type ReportDto = {
  turnNumber: number;
  gameStartAt: string;
  ownUnits: OwnUnit[];
  contacts: Contact[];
  combats: CombatLogEntry[];
  narrative: string | null;
};

export function ReportsClient(props: { mapCenter: LatLng; mapZoom: number; reports: ReportDto[] }) {
  const [turnIndex, setTurnIndex] = useState(0);
  const report = props.reports[turnIndex];

  const sources = useMemo<MapSourceConfig[]>(
    () => [
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(
          report.ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))
        ),
        color: "#38bdf8",
        radius: 6,
        showLabels: true,
        fadeAboveZoom: 7,
      },
      {
        id: "contacts",
        kind: "points",
        data: pointsFeatureCollection(
          report.contacts.map((c) => ({ lat: c.lat, lng: c.lng, properties: { name: `${c.unitClassName} (${c.method})` } }))
        ),
        color: "#f97316",
        radius: 7,
        showLabels: true,
      },
    ],
    [report]
  );

  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () =>
      report.ownUnits.map((u) => {
        const silhouette = classifySilhouette(u.unitClass.category, u.unitClass.name);
        return {
          id: u.id,
          lat: u.currentLat,
          lng: u.currentLng,
          headingDeg: u.currentHeadingDeg ?? 0,
          color: "#38bdf8",
          silhouette,
          lengthMeters: u.unitClass.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
          status: u.status as "ACTIVE" | "DAMAGED" | "SUNK",
        };
      }),
    [report]
  );

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <h1 className="font-display text-lg tracking-wide text-brass-300">Rapport de renseignement — Tour {report.turnNumber}</h1>
        <div className="flex items-center gap-3">
          <select
            value={turnIndex}
            onChange={(e) => setTurnIndex(Number(e.target.value))}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
          >
            {props.reports.map((r, i) => (
              <option key={r.turnNumber} value={i}>
                Tour {r.turnNumber} — {new Date(r.gameStartAt).toLocaleDateString("fr-FR")}
              </option>
            ))}
          </select>
          <Link href="/team/orders" className="rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-900">
            Ordres
          </Link>
          <Link href="/team/comms" className="rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-900">
            📡 Communications
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1">
          <GameMap
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            fitToPoints={[...report.ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), ...report.contacts.map((c) => ({ lat: c.lat, lng: c.lng }))]}
            shipMarkers={shipMarkers}
            showScaleAndRuler
            className="h-full w-full"
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          {report.narrative && (
            <div className="mb-4 rounded-md border border-slate-800 bg-slate-900 p-3 text-sm italic text-slate-300">
              {report.narrative}
            </div>
          )}

          <h2 className="mb-2 text-sm font-semibold text-slate-400">Vos unités ({report.ownUnits.length})</h2>
          <ul className="mb-6 space-y-1 text-sm">
            {report.ownUnits.map((u) => {
              const ratio = u.healthMax && u.healthMax > 0 ? Math.max(0, Math.min(1, (u.healthCurrent ?? 0) / u.healthMax)) : null;
              return (
                <li key={u.id} className="rounded-md bg-slate-900 px-2 py-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{u.name}</span>
                    <span className={`text-xs ${statusColor(u.status)}`}>{statusLabel(u.status)}</span>
                  </div>
                  <div className="text-xs text-slate-500">{u.unitClass.name}</div>
                  {ratio !== null && u.status !== "SUNK" && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                      <div className={`h-full ${ratio < 0.6 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${ratio * 100}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {report.combats.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-slate-400">Combats ({report.combats.length})</h2>
              <ul className="mb-6 space-y-1 text-sm">
                {report.combats.map((c, i) => (
                  <li key={i} className="rounded-md bg-red-950/40 px-2 py-1">
                    <div>
                      <span className="font-medium">{c.attackerName}</span> →{" "}
                      <span className="font-medium">{c.targetName}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatWeapon(c.weaponType)} · {c.hits > 0 ? `${c.hits} coup${c.hits > 1 ? "s" : ""} au but, ${c.damagePoints} pts` : "tir manqué"}
                      {c.targetSunk && <span className="text-red-400"> · coulé</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="mb-2 text-sm font-semibold text-slate-400">Contacts détectés ({report.contacts.length})</h2>
          {report.contacts.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun contact ennemi ce tour-ci.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {report.contacts.map((c, i) => (
                <li key={i} className="rounded-md bg-orange-950/40 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.unitClassName}</span>
                    {turnIndex === 0 && (
                      <Link
                        href={`/team/battle/open/${c.detectionEventId}`}
                        className="shrink-0 rounded border border-orange-800 px-1.5 py-0.5 text-[10px] text-orange-300 hover:bg-orange-950/50"
                      >
                        Engager
                      </Link>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    repéré par {c.observedBy} ({formatMethod(c.method)}), +{Math.round(c.cpaMinutesIntoTurn)} min
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case "ACTIVE":
      return "actif";
    case "DAMAGED":
      return "endommagé";
    case "SUNK":
      return "coulé";
    case "WITHDRAWN":
      return "retiré";
    default:
      return status;
  }
}

function statusColor(status: string) {
  switch (status) {
    case "DAMAGED":
      return "text-amber-400";
    case "SUNK":
      return "text-red-400";
    default:
      return "text-slate-500";
  }
}

function formatWeapon(weaponType: string) {
  switch (weaponType) {
    case "GUN":
      return "artillerie";
    case "TORPEDO":
      return "torpille";
    case "DEPTH_CHARGE":
      return "grenades ASM";
    default:
      return weaponType;
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
