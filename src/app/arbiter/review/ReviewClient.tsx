"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { GameMap, type MapSourceConfig } from "@/components/GameMap";
import { multiLineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import type { LatLng } from "@/lib/geo";
import { confirmDetectionAction, rejectDetectionAction, addManualDetectionAction, publishTurnAction } from "../actions";

function PublishButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-60"
    >
      {pending ? "Publication…" : "Publier le tour"}
    </button>
  );
}

function ConfirmButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded bg-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-600 disabled:opacity-40"
    >
      {pending ? "…" : "Confirmer"}
    </button>
  );
}

function RejectButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded bg-red-800 px-2 py-0.5 text-xs hover:bg-red-700 disabled:opacity-40"
    >
      {pending ? "…" : "Rejeter"}
    </button>
  );
}

function AddManualButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium hover:bg-sky-600 disabled:opacity-60"
    >
      {pending ? "Ajout…" : "Ajouter"}
    </button>
  );
}

type UnitDto = {
  id: string;
  name: string;
  className: string;
  teamId: string;
  teamName: string;
  currentLat: number;
  currentLng: number;
  path: LatLng[];
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

export function ReviewClient(props: {
  turnId: string;
  turnNumber: number;
  turnStatus: string;
  mapCenter: LatLng;
  mapZoom: number;
  teams: { id: string; name: string; colorHex: string }[];
  units: UnitDto[];
  detections: DetectionDto[];
}) {
  const { units, detections, teams } = props;

  const sources = useMemo<MapSourceConfig[]>(() => {
    const byTeam = (teamId: string) => units.filter((u) => u.teamId === teamId);
    const list: MapSourceConfig[] = [];

    teams.forEach((team, i) => {
      const teamUnits = byTeam(team.id);
      list.push({
        id: `tracks-${team.id}`,
        kind: "line",
        data: multiLineFeatureCollection(teamUnits.map((u) => u.path)),
        color: team.colorHex,
        width: 2,
        dashed: i === 1,
      });
      list.push({
        id: `units-${team.id}`,
        kind: "points",
        data: pointsFeatureCollection(teamUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: team.colorHex,
        radius: 5,
        showLabels: true,
      });
    });

    list.push({
      id: "detection-links",
      kind: "line",
      data: multiLineFeatureCollection(
        detections.map((d) => [
          { lat: d.observerLatAtCpa, lng: d.observerLngAtCpa },
          { lat: d.targetLatAtCpa, lng: d.targetLngAtCpa },
        ])
      ),
      color: "#f97316",
      width: 1,
      dashed: true,
    });

    list.push({
      id: "detection-points",
      kind: "points",
      data: pointsFeatureCollection(
        detections.map((d) => ({ lat: d.targetLatAtCpa, lng: d.targetLngAtCpa, properties: { name: `CPA ${d.cpaDistanceNm.toFixed(1)}nm` } }))
      ),
      color: "#f97316",
      radius: 4,
    });

    return list;
  }, [units, detections, teams]);

  const [manualObserver, setManualObserver] = useState(units[0]?.id ?? "");

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h1 className="text-lg font-semibold">Revue arbitre — Tour {props.turnNumber}</h1>
        <form action={publishTurnAction}>
          <input type="hidden" name="turnId" value={props.turnId} />
          <PublishButton />
        </form>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="relative flex-1">
          <GameMap
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            fitToPoints={units.map((u) => ({ lat: u.currentLat, lng: u.currentLng }))}
            className="h-full w-full"
          />
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-400">Détections proposées ({detections.length})</h2>
          <ul className="space-y-2">
            {detections.map((d) => (
              <li key={d.id} className="rounded-md border border-slate-800 bg-slate-900 p-2 text-sm">
                <div>
                  <span className="font-medium">{d.observerName}</span> ({d.observerTeam}) →{" "}
                  <span className="font-medium">{d.targetName}</span> ({d.targetTeam})
                </div>
                <div className="text-xs text-slate-500">
                  {formatMethod(d.method)} · CPA {d.cpaDistanceNm.toFixed(1)}nm à +{Math.round(d.cpaMinutesIntoTurn)}min ·{" "}
                  {statusLabel(d.arbiterStatus)}
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

          <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-400">Ajouter une détection manuelle</h2>
          <form action={addManualDetectionAction} className="space-y-2 text-sm">
            <input type="hidden" name="turnId" value={props.turnId} />

            <label className="block">
              Observateur
              <select
                name="observerUnitId"
                value={manualObserver}
                onChange={(e) => setManualObserver(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.teamName})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              Cible
              <select name="targetUnitId" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
                {units
                  .filter((u) => u.teamId !== units.find((x) => x.id === manualObserver)?.teamId)
                  .map((u) => (
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
