"use client";

import { useState } from "react";
import type { BuilderTeam } from "./types";
import { ObjectivesEditor } from "./ObjectivesEditor";

const fieldClass = "mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm";
const labelClass = "block text-sm";

export type ScenarioMetaTab = "info" | "weather" | "objectives";

/**
 * Infos de scénario en onglets (Phase 4, retour utilisateur 2026-08-15) —
 * remplace les deux `<fieldset>` "Informations générales"/"Météo de
 * départ" toujours visibles en colonne gauche (ancienne disposition) :
 * accès par bouton d'en-tête (voir ScenarioEditorForm.tsx, nav du header),
 * comme "Vue d'ensemble/Météo/Détections/Combats" côté arbitre. Contenu
 * repris tel quel des anciens `<fieldset>` — tous les `useState` restent
 * dans ScenarioEditorForm (props contrôlées), aucune perte de logique.
 */
export function ScenarioMetaModal({
  initialTab,
  onClose,
  validationIssues,
  name,
  updateName,
  keyValue,
  onKeyChange,
  description,
  setDescription,
  briefing,
  setBriefing,
  dateLabel,
  setDateLabel,
  source,
  setSource,
  mapCenterLat,
  setMapCenterLat,
  mapCenterLng,
  setMapCenterLng,
  mapDefaultZoom,
  setMapDefaultZoom,
  defaultTurnMinutes,
  setDefaultTurnMinutes,
  tacticalRoundMinutes,
  setTacticalRoundMinutes,
  visibilityNm,
  setVisibilityNm,
  seaState,
  setSeaState,
  daylight,
  setDaylight,
  precipitation,
  setPrecipitation,
  windKnots,
  setWindKnots,
  weatherNotes,
  setWeatherNotes,
  teams,
  objectivesByTeamName,
  onChangeObjectiveText,
}: {
  initialTab: ScenarioMetaTab;
  onClose: () => void;
  validationIssues: string[];
  name: string;
  updateName: (v: string) => void;
  keyValue: string;
  onKeyChange: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  briefing: string;
  setBriefing: (v: string) => void;
  dateLabel: string;
  setDateLabel: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  mapCenterLat: number;
  setMapCenterLat: (v: number) => void;
  mapCenterLng: number;
  setMapCenterLng: (v: number) => void;
  mapDefaultZoom: number;
  setMapDefaultZoom: (v: number) => void;
  defaultTurnMinutes: number;
  setDefaultTurnMinutes: (v: number) => void;
  tacticalRoundMinutes: number;
  setTacticalRoundMinutes: (v: number) => void;
  visibilityNm: number;
  setVisibilityNm: (v: number) => void;
  seaState: number;
  setSeaState: (v: number) => void;
  daylight: string;
  setDaylight: (v: string) => void;
  precipitation: string;
  setPrecipitation: (v: string) => void;
  windKnots: number;
  setWindKnots: (v: number) => void;
  weatherNotes: string;
  setWeatherNotes: (v: string) => void;
  teams: BuilderTeam[];
  objectivesByTeamName: Record<string, string>;
  onChangeObjectiveText: (teamName: string, text: string) => void;
}) {
  const [tab, setTab] = useState<ScenarioMetaTab>(initialTab);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="chart-room-bg max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-800 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <nav className="flex gap-1 text-xs">
            {(
              [
                ["info", "Infos générales"],
                ["weather", "Météo"],
                ["objectives", "Objectifs"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 ${tab === key ? "bg-brass-900/50 text-brass-300 ring-1 ring-brass-500" : "text-slate-400 hover:bg-slate-900"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {tab === "info" && (
          <div className="mt-4 space-y-3">
            <label className={labelClass}>
              Nom
              <input value={name} onChange={(e) => updateName(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Clé (identifiant unique, généré depuis le nom)
              <input value={keyValue} onChange={(e) => onKeyChange(e.target.value)} className={`${fieldClass} font-mono`} />
            </label>
            <label className={labelClass}>
              Description courte
              <input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Briefing (affiché aux joueurs)
              <textarea value={briefing} onChange={(e) => setBriefing(e.target.value)} rows={3} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Date affichée (ex : 24 mai 1941, 05h52)
              <input value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Sources
              <input value={source} onChange={(e) => setSource(e.target.value)} className={fieldClass} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className={labelClass}>
                Centre lat.
                <input type="number" step="0.01" value={mapCenterLat} onChange={(e) => setMapCenterLat(Number(e.target.value))} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Centre lng.
                <input type="number" step="0.01" value={mapCenterLng} onChange={(e) => setMapCenterLng(Number(e.target.value))} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Zoom
                <input type="number" value={mapDefaultZoom} onChange={(e) => setMapDefaultZoom(Number(e.target.value))} className={fieldClass} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelClass}>
                Durée du 1er tour (min)
                <input type="number" value={defaultTurnMinutes} onChange={(e) => setDefaultTurnMinutes(Number(e.target.value))} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Durée d&apos;une manche tactique (min)
                <input type="number" value={tacticalRoundMinutes} onChange={(e) => setTacticalRoundMinutes(Number(e.target.value))} className={fieldClass} />
              </label>
            </div>
          </div>
        )}

        {tab === "weather" && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className={labelClass}>
                Visibilité (nm)
                <input type="number" value={visibilityNm} onChange={(e) => setVisibilityNm(Number(e.target.value))} className={fieldClass} />
              </label>
              <label className={labelClass}>
                État de mer (0-9)
                <input type="number" min={0} max={9} value={seaState} onChange={(e) => setSeaState(Number(e.target.value))} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Luminosité
                <select value={daylight} onChange={(e) => setDaylight(e.target.value)} className={fieldClass}>
                  <option value="DAY">Jour</option>
                  <option value="TWILIGHT">Crépuscule</option>
                  <option value="NIGHT">Nuit</option>
                  <option value="POLAR_NIGHT">Nuit polaire</option>
                  <option value="POLAR_DAY">Jour polaire</option>
                </select>
              </label>
              <label className={labelClass}>
                Précipitations
                <select value={precipitation} onChange={(e) => setPrecipitation(e.target.value)} className={fieldClass}>
                  <option value="NONE">Aucune</option>
                  <option value="RAIN">Pluie</option>
                  <option value="SNOW">Neige</option>
                  <option value="FOG">Brouillard</option>
                </select>
              </label>
              <label className={labelClass}>
                Vent (nds)
                <input type="number" value={windKnots} onChange={(e) => setWindKnots(Number(e.target.value))} className={fieldClass} />
              </label>
            </div>
            <label className={labelClass}>
              Notes météo (optionnel)
              <input value={weatherNotes} onChange={(e) => setWeatherNotes(e.target.value)} className={fieldClass} />
            </label>
          </div>
        )}

        {tab === "objectives" && (
          <div className="mt-4">
            <ObjectivesEditor
              teams={teams}
              textByTeamName={new Map(Object.entries(objectivesByTeamName))}
              onChangeText={onChangeObjectiveText}
            />
          </div>
        )}

        {validationIssues.length > 0 && (
          <div className="mt-4 rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            <p className="mb-1 font-semibold">{validationIssues.length} problème(s) avant enregistrement :</p>
            <ul className="list-inside list-disc space-y-0.5">
              {validationIssues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
