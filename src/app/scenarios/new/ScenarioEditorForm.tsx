"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { GameMap, type MapSourceConfig } from "@/components/GameMap";
import { pointsFeatureCollection, colorForId } from "@/lib/mapData";
import { ScenarioDefinitionSchema } from "../../../../prisma/scenarios/validation";
import { createCustomScenarioAction } from "./actions";

/**
 * Éditeur de scénarios (module séparé de la feuille de route). Les champs
 * simples (nom, dates, météo…) ont chacun leur contrôle ; l'ordre de
 * bataille (classes d'unités, équipes/flottes/unités, objectifs) — une
 * structure profondément imbriquée et de forme variable — se rédige en
 * JSON, avec validation et aperçu carte avant enregistrement. Un outil pour
 * qui veut composer un scénario complet, pas un assistant pas-à-pas : voir
 * le format complet dans prisma/scenarios/types.ts.
 */

const EXAMPLE_OOB = {
  unitClasses: [
    {
      key: "destroyer-generique",
      name: "Destroyer générique",
      nation: "Royaume-Uni",
      category: "SURFACE_SHIP",
      maxSpeedKnots: 36,
      lengthMeters: 100,
      turningRadiusM: 200,
      accelerationKnotsPerMin: 4,
      sensors: [
        { type: "RADAR", rangeNm: 10 },
        { type: "VISUAL", rangeNm: 12 },
      ],
      detectability: 0.8,
      iconKey: "destroyer",
      resistancePoints: 8,
      combatProfile: {
        guns: [{ calibreMm: 120, count: 4, rangeM: 15000, roundsPerMinute: 8, arc: "ALL_ROUND" }],
      },
    },
    {
      key: "sous-marin-generique",
      name: "Sous-marin générique",
      nation: "Allemagne",
      category: "SUBMARINE",
      maxSpeedKnots: 17,
      lengthMeters: 67,
      turningRadiusM: 150,
      accelerationKnotsPerMin: 2,
      sensors: [
        { type: "HYDROPHONE", rangeNm: 6 },
        { type: "VISUAL", rangeNm: 8 },
      ],
      detectability: 0.6,
      iconKey: "submarine",
      resistancePoints: 4,
      submergedRangeNmAt4kt: 80,
      oxygenEnduranceHours: 48,
      torpedoStock: 14,
      combatProfile: {
        torpedoTubes: { count: 4, rangeM: 5000, speedKnots: 30 },
      },
    },
  ],
  teams: [
    {
      name: "Camp A",
      colorHex: "#3b82f6",
      fleets: [
        {
          name: "Flotte A1",
          units: [{ name: "Navire A1-1", classKey: "destroyer-generique", lat: 60, lng: -10, headingDeg: 90 }],
        },
      ],
    },
    {
      name: "Camp B",
      colorHex: "#dc2626",
      fleets: [
        {
          name: "Flotte B1",
          units: [{ name: "Navire B1-1", classKey: "sous-marin-generique", lat: 60.2, lng: -9.5, headingDeg: 270 }],
        },
      ],
    },
  ],
  objectives: [
    { teamName: "Camp A", text: "Décrivez ici l'objectif du camp A." },
    { teamName: "Camp B", text: "Décrivez ici l'objectif du camp B." },
  ],
};

// Marques diacritiques combinantes (U+0300 à U+036F) laissées par la
// décomposition NFD (ex: "é" → "e" + accent) : on les retire pour un slug
// propre, sans accents ni caractères composés.
const DIACRITICS_PATTERN = /[̀-ͯ]/g;

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function ScenarioEditorForm() {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [briefing, setBriefing] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [mapCenterLat, setMapCenterLat] = useState(60);
  const [mapCenterLng, setMapCenterLng] = useState(-10);
  const [mapDefaultZoom, setMapDefaultZoom] = useState(6);
  const [defaultTurnMinutes, setDefaultTurnMinutes] = useState(60);
  const [tacticalRoundMinutes, setTacticalRoundMinutes] = useState(5);
  const [source, setSource] = useState("");

  const [visibilityNm, setVisibilityNm] = useState(12);
  const [seaState, setSeaState] = useState(3);
  const [daylight, setDaylight] = useState("DAY");
  const [precipitation, setPrecipitation] = useState("NONE");
  const [windKnots, setWindKnots] = useState(15);
  const [weatherNotes, setWeatherNotes] = useState("");

  const [oobJson, setOobJson] = useState(() => JSON.stringify(EXAMPLE_OOB, null, 2));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateName(value: string) {
    setName(value);
    if (!keyTouched) setKey(slugify(value));
  }

  function loadExample() {
    setName("Exemple de scénario");
    setKey("exemple-de-scenario-" + Date.now().toString(36));
    setKeyTouched(true);
    setDescription("Un exemple de scénario généré pour montrer le format attendu.");
    setBriefing("Contexte historique ou fictif à afficher aux joueurs au lancement de la partie.");
    setDateLabel("1er janvier 1942");
    setMapCenterLat(60.1);
    setMapCenterLng(-9.8);
    setMapDefaultZoom(8);
    setDefaultTurnMinutes(60);
    setTacticalRoundMinutes(5);
    setSource("Exemple — à remplacer par vos sources.");
    setVisibilityNm(12);
    setSeaState(3);
    setDaylight("DAY");
    setPrecipitation("NONE");
    setWindKnots(15);
    setWeatherNotes("");
    setOobJson(JSON.stringify(EXAMPLE_OOB, null, 2));
    setSaveError(null);
    setSavedKey(null);
  }

  const { definition, parseError, validationIssues } = useMemo(() => {
    let oob: unknown;
    try {
      oob = JSON.parse(oobJson);
    } catch (e) {
      return { definition: null, parseError: e instanceof Error ? e.message : "JSON invalide", validationIssues: [] as string[] };
    }
    const candidate = {
      key,
      name,
      description,
      briefing,
      dateLabel,
      mapCenterLat,
      mapCenterLng,
      mapDefaultZoom,
      defaultTurnMinutes,
      tacticalRoundMinutes,
      weather: {
        visibilityNm,
        seaState,
        daylight,
        precipitation,
        windKnots: windKnots || undefined,
        notes: weatherNotes || undefined,
      },
      source,
      ...(typeof oob === "object" && oob !== null ? oob : {}),
    };
    const result = ScenarioDefinitionSchema.safeParse(candidate);
    if (!result.success) {
      return {
        definition: null,
        parseError: null,
        validationIssues: result.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`),
      };
    }
    return { definition: result.data, parseError: null, validationIssues: [] as string[] };
  }, [
    key,
    name,
    description,
    briefing,
    dateLabel,
    mapCenterLat,
    mapCenterLng,
    mapDefaultZoom,
    defaultTurnMinutes,
    tacticalRoundMinutes,
    visibilityNm,
    seaState,
    daylight,
    precipitation,
    windKnots,
    weatherNotes,
    source,
    oobJson,
  ]);

  const previewSources = useMemo<MapSourceConfig[]>(() => {
    if (!definition) return [];
    const points = definition.teams.flatMap((team) =>
      team.fleets.flatMap((fleet) =>
        fleet.units.map((u) => ({ lat: u.lat, lng: u.lng, properties: { name: `${u.name} (${team.name})`, color: colorForId(team.name) } }))
      )
    );
    return [
      {
        id: "preview-units",
        kind: "points",
        data: pointsFeatureCollection(points),
        colorByFeature: true,
        radius: 7,
        showLabels: true,
      },
    ];
  }, [definition]);

  const previewPoints = useMemo(
    () => (definition ? definition.teams.flatMap((t) => t.fleets.flatMap((f) => f.units.map((u) => ({ lat: u.lat, lng: u.lng })))) : []),
    [definition]
  );

  function save() {
    if (!definition) return;
    setSaveError(null);
    startTransition(async () => {
      const result = await createCustomScenarioAction(definition);
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setSavedKey(result.key);
    });
  }

  if (savedKey) {
    return (
      <div className="chart-room-bg min-h-screen text-slate-100">
        <div className="mx-auto max-w-2xl px-6 py-12 text-center">
          <h1 className="font-display text-2xl text-brass-300">Scénario enregistré</h1>
          <p className="mt-3 text-slate-400">
            « {name} » est maintenant disponible dans la bibliothèque, sous la clé <code className="text-slate-300">{savedKey}</code>.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/create" className="rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
              Créer une partie avec
            </Link>
            <button
              onClick={() => setSavedKey(null)}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-900"
            >
              Créer un autre scénario
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chart-room-bg min-h-screen text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-2xl text-brass-300">Créer un scénario</h1>
          <div className="flex gap-2">
            <button onClick={loadExample} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
              Charger un exemple
            </button>
            <Link href="/create" className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
              ← Retour
            </Link>
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Un scénario intégré et un scénario créé ici suivent exactement le même format : les champs simples ci-dessous, puis l&apos;ordre
          de bataille (classes d&apos;unités, équipes, flottes, unités, objectifs) en JSON — cliquez « Charger un exemple » pour voir la
          structure attendue et partir de là.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <fieldset className="space-y-3 rounded-md border border-slate-800 bg-slate-900 p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Informations générales</legend>
              <label className="block text-sm">
                Nom
                <input
                  value={name}
                  onChange={(e) => updateName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                Clé (identifiant unique, généré depuis le nom)
                <input
                  value={key}
                  onChange={(e) => {
                    setKey(slugify(e.target.value));
                    setKeyTouched(true);
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm font-mono"
                />
              </label>
              <label className="block text-sm">
                Description courte
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                Briefing (affiché aux joueurs)
                <textarea
                  value={briefing}
                  onChange={(e) => setBriefing(e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                Date affichée (ex : 24 mai 1941, 05h52)
                <input
                  value={dateLabel}
                  onChange={(e) => setDateLabel(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                Sources
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-sm">
                  Centre lat.
                  <input
                    type="number"
                    step="0.01"
                    value={mapCenterLat}
                    onChange={(e) => setMapCenterLat(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Centre lng.
                  <input
                    type="number"
                    step="0.01"
                    value={mapCenterLng}
                    onChange={(e) => setMapCenterLng(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Zoom
                  <input
                    type="number"
                    value={mapDefaultZoom}
                    onChange={(e) => setMapDefaultZoom(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  Durée du 1er tour (min)
                  <input
                    type="number"
                    value={defaultTurnMinutes}
                    onChange={(e) => setDefaultTurnMinutes(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Durée d&apos;une manche tactique (min)
                  <input
                    type="number"
                    value={tacticalRoundMinutes}
                    onChange={(e) => setTacticalRoundMinutes(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-md border border-slate-800 bg-slate-900 p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Météo de départ</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  Visibilité (nm)
                  <input
                    type="number"
                    value={visibilityNm}
                    onChange={(e) => setVisibilityNm(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  État de mer (0-9)
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={seaState}
                    onChange={(e) => setSeaState(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  Luminosité
                  <select
                    value={daylight}
                    onChange={(e) => setDaylight(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  >
                    <option value="DAY">Jour</option>
                    <option value="TWILIGHT">Crépuscule</option>
                    <option value="NIGHT">Nuit</option>
                    <option value="POLAR_NIGHT">Nuit polaire</option>
                    <option value="POLAR_DAY">Jour polaire</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Précipitations
                  <select
                    value={precipitation}
                    onChange={(e) => setPrecipitation(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  >
                    <option value="NONE">Aucune</option>
                    <option value="RAIN">Pluie</option>
                    <option value="SNOW">Neige</option>
                    <option value="FOG">Brouillard</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Vent (nds)
                  <input
                    type="number"
                    value={windKnots}
                    onChange={(e) => setWindKnots(Number(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <label className="block text-sm">
                Notes météo (optionnel)
                <input
                  value={weatherNotes}
                  onChange={(e) => setWeatherNotes(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                />
              </label>
            </fieldset>
          </div>

          <div className="space-y-4">
            <fieldset className="rounded-md border border-slate-800 bg-slate-900 p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ordre de bataille (JSON) — classes d&apos;unités, équipes, flottes, unités, objectifs
              </legend>
              <textarea
                value={oobJson}
                onChange={(e) => setOobJson(e.target.value)}
                rows={18}
                spellCheck={false}
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
              />
            </fieldset>

            <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Aperçu des positions</h3>
              {definition ? (
                <div className="h-64 overflow-hidden rounded-md">
                  <GameMap
                    center={{ lat: mapCenterLat, lng: mapCenterLng }}
                    zoom={mapDefaultZoom}
                    sources={previewSources}
                    fitToPoints={previewPoints}
                    className="h-full w-full"
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-600">L&apos;aperçu apparaît une fois le scénario valide.</p>
              )}
            </div>

            {parseError && <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300">JSON invalide : {parseError}</p>}
            {validationIssues.length > 0 && (
              <div className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                <p className="mb-1 font-semibold">{validationIssues.length} problème(s) :</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {validationIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {saveError && <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300">{saveError}</p>}

            <button
              onClick={save}
              disabled={!definition || isPending}
              className="w-full rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
            >
              {isPending ? "Enregistrement…" : "Enregistrer le scénario"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
