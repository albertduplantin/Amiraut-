"use client";

import { useMemo, useState } from "react";
import { GameMap, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { pointsFeatureCollection } from "@/lib/mapData";
import type { LatLng } from "@/lib/geo";
import { classifySilhouette } from "@/lib/shipSilhouettes";

type OwnUnit = {
  id: string;
  name: string;
  pennant: string | null;
  status: string;
  currentLat: number;
  currentLng: number;
  currentHeadingDeg: number | null;
  unitClass: { name: string; iconKey: string; category: string };
};

type Contact = {
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
      report.ownUnits.map((u) => ({
        id: u.id,
        lat: u.currentLat,
        lng: u.currentLng,
        headingDeg: u.currentHeadingDeg ?? 0,
        color: "#38bdf8",
        silhouette: classifySilhouette(u.unitClass.category, u.unitClass.name),
      })),
    [report]
  );

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <h1 className="font-display text-lg tracking-wide text-brass-300">Rapport de renseignement — Tour {report.turnNumber}</h1>
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
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1">
          <GameMap
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            fitToPoints={[...report.ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng })), ...report.contacts.map((c) => ({ lat: c.lat, lng: c.lng }))]}
            shipMarkers={shipMarkers}
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
            {report.ownUnits.map((u) => (
              <li key={u.id} className="rounded-md bg-slate-900 px-2 py-1">
                <span className="font-medium">{u.name}</span>{" "}
                <span className="text-xs text-slate-500">
                  {u.unitClass.name} · {u.status === "ACTIVE" ? "actif" : u.status}
                </span>
              </li>
            ))}
          </ul>

          <h2 className="mb-2 text-sm font-semibold text-slate-400">Contacts détectés ({report.contacts.length})</h2>
          {report.contacts.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun contact ennemi ce tour-ci.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {report.contacts.map((c, i) => (
                <li key={i} className="rounded-md bg-orange-950/40 px-2 py-1">
                  <span className="font-medium">{c.unitClassName}</span>
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
