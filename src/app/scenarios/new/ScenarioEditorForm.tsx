"use client";

import { useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { pointsFeatureCollection } from "@/lib/mapData";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import type { LatLng } from "@/lib/geo";
import { ScenarioDefinitionSchema } from "../../../../prisma/scenarios/validation";
import type { ScenarioDefinition, ScenarioTeam, ScenarioUnit, ScenarioUnitClass } from "../../../../prisma/scenarios/types";
import { createCustomScenarioAction } from "./actions";
import {
  type BuilderTeam,
  type BuilderAirbase,
  type BuilderSquadron,
  type BuilderUnit,
  type ClassRef,
  type BaseRef,
  type LibraryClassOption,
  type ClientIdGenerator,
  createClientIdGenerator,
  allUnits,
  surfaceShipUnits,
} from "./builder/types";
import { LibraryBrowserPanel } from "./builder/LibraryBrowserPanel";
import { TeamsBoard } from "./builder/TeamsBoard";
import { AirbasesPanel } from "./builder/AirbasesPanel";
import { SquadronsPanel } from "./builder/SquadronsPanel";
import { ObjectivesEditor } from "./builder/ObjectivesEditor";
import { allowDrop, readDragPayload } from "./builder/dragDrop";
import { applyFormationAtCenter } from "./builder/formation";
import { AddContainerModal } from "./builder/AddContainerModal";
import { AddUnitWizardModal } from "./builder/AddUnitWizardModal";

/**
 * Constructeur de scénarios (module séparé de la feuille de route) —
 * entièrement visuel depuis le 2026-08-14 (retour utilisateur) : task
 * forces, escadrilles, bases aériennes et unités se composent par
 * boutons/sélecteurs plutôt qu'en JSON (voir builder/), en référençant
 * toujours des classes EXISTANTES de la bibliothèque partagée (`/library`)
 * — pas d'auteur de classe inline ici (la modal de création rapide, Phase
 * 6, comble "à la volée" sans quitter le flux). Les champs simples (nom,
 * dates, météo…) restent chacun leur propre contrôle, inchangés.
 *
 * `duplicateFrom` (bouton « Dupliquer et modifier » sur /create) :
 * pré-remplit tout, y compris les task forces/bases/escadrilles, avec le
 * contenu COMPLET d'un scénario existant — clé et nom légèrement modifiés
 * pour éviter toute collision. L'original n'est jamais modifié,
 * "Enregistrer" crée toujours une entrée séparée dans CustomScenario.
 */

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

/** Clé dérivée d'un scénario dupliqué, distincte de l'original (voir duplicateFrom) — un court suffixe aléatoire suffit, pas besoin d'unicité garantie ici, juste de collision peu probable ; le serveur revalide de toute façon à l'enregistrement. */
function duplicateKey(originalKey: string) {
  return `${originalKey}-variante-${Date.now().toString(36).slice(-4)}`;
}

function classKeyFor(ref: ClassRef): string {
  return ref.kind === "library" ? ref.libraryKey : ref.key;
}

/** Reconstitue la référence de classe d'une unité dupliquée — bibliothèque (résolue par libraryKey si la classe existe encore), ou classe en ligne héritée telle quelle (voir ClassRef, types.ts du builder). */
function classRefFromScenario(classKey: string, source: ScenarioDefinition, libraryClasses: LibraryClassOption[]): ClassRef {
  const entry = source.unitClasses.find((c) => c.key === classKey);
  const fallbackDef: ScenarioUnitClass = { key: classKey, name: classKey, nation: "?", category: "SURFACE_SHIP", maxSpeedKnots: 10, sensors: [], iconKey: "cargo", resistancePoints: 1 };
  if (!entry) return { kind: "inline", key: classKey, name: classKey, category: "SURFACE_SHIP", def: fallbackDef };
  if ("libraryKey" in entry) {
    const lib = libraryClasses.find((l) => l.key === entry.libraryKey);
    if (lib) return { kind: "library", libraryClassId: lib.id, libraryKey: lib.key, name: lib.name, category: lib.category };
    // Référence bibliothèque introuvable (classe supprimée depuis le scénario dupliqué) : repli minimal plutôt que de planter l'affichage.
    return { kind: "inline", key: entry.key, name: `${entry.libraryKey} (bibliothèque introuvable)`, category: "SURFACE_SHIP", def: { ...fallbackDef, key: entry.key } };
  }
  return { kind: "inline", key: entry.key, name: entry.name, category: entry.category, def: entry };
}

/** Reconstitue la source de base d'une unité dupliquée — voir BaseRef (types.ts du builder). */
function baseRefFromUnit(u: ScenarioUnit): BaseRef {
  if (u.squadronKey) return { kind: "squadron", key: u.squadronKey };
  if (u.airbaseKey) return { kind: "airbase", key: u.airbaseKey };
  if (u.carrierUnitName) return { kind: "carrier", unitName: u.carrierUnitName };
  if (u.baseLat != null || u.baseLng != null || u.baseName) {
    return { kind: "literal", lat: u.baseLat != null ? String(u.baseLat) : "", lng: u.baseLng != null ? String(u.baseLng) : "", name: u.baseName ?? "" };
  }
  return { kind: "none" };
}

function buildInitialTeams(duplicateFrom: ScenarioDefinition | null, libraryClasses: LibraryClassOption[], nextClientId: ClientIdGenerator): BuilderTeam[] {
  if (!duplicateFrom) {
    return [
      { clientId: nextClientId("team"), name: "Camp A", colorHex: "#3388ff", fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }] },
      { clientId: nextClientId("team"), name: "Camp B", colorHex: "#dc2626", fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }] },
    ];
  }
  return duplicateFrom.teams.map((t) => ({
    clientId: nextClientId("team"),
    name: t.name,
    colorHex: t.colorHex,
    fleets: t.fleets.map((f) => ({
      clientId: nextClientId("fleet"),
      name: f.name,
      units: f.units.map(
        (u): BuilderUnit => ({
          clientId: nextClientId("unit"),
          name: u.name,
          pennant: u.pennant ?? "",
          headingDeg: u.headingDeg != null ? String(u.headingDeg) : "",
          historicalNote: u.historicalNote ?? "",
          lat: String(u.lat),
          lng: String(u.lng),
          classRef: classRefFromScenario(u.classKey, duplicateFrom, libraryClasses),
          baseRef: baseRefFromUnit(u),
        })
      ),
    })),
  }));
}

function buildInitialAirbases(duplicateFrom: ScenarioDefinition | null, nextClientId: ClientIdGenerator): BuilderAirbase[] {
  return (duplicateFrom?.airbases ?? []).map((a) => ({ clientId: nextClientId("airbase"), key: a.key, name: a.name, lat: String(a.lat), lng: String(a.lng) }));
}

function buildInitialSquadrons(duplicateFrom: ScenarioDefinition | null, nextClientId: ClientIdGenerator): BuilderSquadron[] {
  return (duplicateFrom?.squadrons ?? []).map((s) => ({
    clientId: nextClientId("squadron"),
    key: s.key,
    name: s.name,
    baseRef: s.airbaseKey ? { kind: "airbase", key: s.airbaseKey } : s.carrierUnitName ? { kind: "carrier", unitName: s.carrierUnitName } : { kind: "none" },
  }));
}

function buildInitialObjectives(duplicateFrom: ScenarioDefinition | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of duplicateFrom?.objectives ?? []) out[o.teamName] = o.text;
  return out;
}

export function ScenarioEditorForm({
  duplicateFrom = null,
  libraryClasses,
}: {
  duplicateFrom?: ScenarioDefinition | null;
  libraryClasses: LibraryClassOption[];
}) {
  const [name, setName] = useState(() => (duplicateFrom ? `${duplicateFrom.name} (variante)` : ""));
  const [key, setKey] = useState(() => (duplicateFrom ? duplicateKey(duplicateFrom.key) : ""));
  const [keyTouched, setKeyTouched] = useState(() => duplicateFrom !== null);
  const [description, setDescription] = useState(() => duplicateFrom?.description ?? "");
  const [briefing, setBriefing] = useState(() => duplicateFrom?.briefing ?? "");
  const [dateLabel, setDateLabel] = useState(() => duplicateFrom?.dateLabel ?? "");
  const [mapCenterLat, setMapCenterLat] = useState(() => duplicateFrom?.mapCenterLat ?? 60);
  const [mapCenterLng, setMapCenterLng] = useState(() => duplicateFrom?.mapCenterLng ?? -10);
  const [mapDefaultZoom, setMapDefaultZoom] = useState(() => duplicateFrom?.mapDefaultZoom ?? 6);
  const [defaultTurnMinutes, setDefaultTurnMinutes] = useState(() => duplicateFrom?.defaultTurnMinutes ?? 60);
  const [tacticalRoundMinutes, setTacticalRoundMinutes] = useState(() => duplicateFrom?.tacticalRoundMinutes ?? 5);
  const [source, setSource] = useState(() => duplicateFrom?.source ?? "");

  const [visibilityNm, setVisibilityNm] = useState(() => duplicateFrom?.weather.visibilityNm ?? 12);
  const [seaState, setSeaState] = useState(() => duplicateFrom?.weather.seaState ?? 3);
  const [daylight, setDaylight] = useState<string>(() => duplicateFrom?.weather.daylight ?? "DAY");
  const [precipitation, setPrecipitation] = useState<string>(() => duplicateFrom?.weather.precipitation ?? "NONE");
  const [windKnots, setWindKnots] = useState(() => duplicateFrom?.weather.windKnots ?? 15);
  const [weatherNotes, setWeatherNotes] = useState(() => duplicateFrom?.weather.notes ?? "");

  // Générateur d'identifiants client créé UNE FOIS PAR MONTAGE (état plutôt
  // que ref, jamais réassigné — voir createClientIdGenerator, builder/types.ts) :
  // évite le décalage serveur/client d'un compteur module-level partagé
  // entre requêtes.
  const [nextClientId] = useState<ClientIdGenerator>(() => createClientIdGenerator());

  const [teams, setTeams] = useState<BuilderTeam[]>(() => buildInitialTeams(duplicateFrom, libraryClasses, nextClientId));
  const [airbasesState, setAirbasesState] = useState<BuilderAirbase[]>(() => buildInitialAirbases(duplicateFrom, nextClientId));
  const [squadronsState, setSquadronsState] = useState<BuilderSquadron[]>(() => buildInitialSquadrons(duplicateFrom, nextClientId));
  const [objectivesByTeamName, setObjectivesByTeamName] = useState<Record<string, string>>(() => buildInitialObjectives(duplicateFrom));

  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Assistants de création guidée (Phase 3, retour utilisateur 2026-08-15)
  // — coexistent avec les boutons/glisser-déposer déjà en place.
  const [addContainerModalOpen, setAddContainerModalOpen] = useState(false);
  const [unitWizardFor, setUnitWizardFor] = useState<{ teamClientId: string; fleetClientId: string } | null>(null);

  // Placement interactif sur carte (Phase 5, retour utilisateur
  // 2026-08-14) : même pattern que la repositionnement côté arbitre
  // (ArbiterDashboard.tsx) — sélection → clic carte → brouillon → clic
  // "Appliquer" pour committer, mais ici RIEN n'est envoyé au serveur tant
  // que "Enregistrer le scénario" (plus bas) n'a pas été cliqué : la
  // position "appliquée" ne fait que mettre à jour l'état local du
  // formulaire.
  const [selection, setSelection] = useState<{ kind: "unit"; teamClientId: string; fleetClientId: string; unitClientId: string } | { kind: "airbase"; clientId: string } | null>(null);
  const [draftPosition, setDraftPosition] = useState<LatLng | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const gameMapRef = useRef<GameMapHandle>(null);

  const selectedUnit =
    selection?.kind === "unit"
      ? (allUnits(teams).find((u) => u.clientId === selection.unitClientId) ?? null)
      : null;
  const selectedAirbase = selection?.kind === "airbase" ? (airbasesState.find((a) => a.clientId === selection.clientId) ?? null) : null;

  function selectUnitForPlacement(teamClientId: string, fleetClientId: string, unitClientId: string) {
    setSelection((prev) =>
      prev?.kind === "unit" && prev.unitClientId === unitClientId ? null : { kind: "unit", teamClientId, fleetClientId, unitClientId }
    );
    setDraftPosition(null);
    setPosError(null);
  }
  function selectAirbaseForPlacement(clientId: string) {
    setSelection((prev) => (prev?.kind === "airbase" && prev.clientId === clientId ? null : { kind: "airbase", clientId }));
    setDraftPosition(null);
    setPosError(null);
  }

  function handleMapClick(pos: LatLng) {
    if (!selection) return;
    if (gameMapRef.current && !gameMapRef.current.isWaterPoint(pos)) {
      setPosError("Position impossible : elle tombe sur la terre.");
      return;
    }
    setPosError(null);
    setDraftPosition(pos);
  }

  /**
   * Glisser-déposer une task force/base entière sur la carte (Phase 2,
   * retour utilisateur 2026-08-15) — accélérateur de masse au-dessus du
   * mécanisme 🎯 par-unité existant (`applyDraftPosition` ci-dessous),
   * conservé pour l'ajustement fin après coup. Ne valide que le point
   * central via `isWaterPoint` (pas chaque unité de la formation
   * individuellement) — limite assumée du placeholder générique, voir
   * formation.ts.
   */
  function handleMapDrop(e: DragEvent) {
    e.preventDefault();
    const payload = readDragPayload(e);
    if (!payload) return;
    const drop = gameMapRef.current?.pixelToLatLng(e.clientX, e.clientY);
    if (!drop) return;
    if (gameMapRef.current && !gameMapRef.current.isWaterPoint(drop)) {
      setPosError("Position impossible : elle tombe sur la terre.");
      return;
    }
    setPosError(null);

    if (payload.kind === "airbase") {
      setAirbasesState((prev) => prev.map((a) => (a.clientId === payload.airbaseClientId ? { ...a, lat: String(drop.lat), lng: String(drop.lng) } : a)));
      return;
    }
    if (payload.kind === "fleet") {
      setTeams((prev) =>
        prev.map((t) => {
          if (t.clientId !== payload.teamClientId) return t;
          return {
            ...t,
            fleets: t.fleets.map((f) => {
              if (f.clientId !== payload.fleetClientId) return f;
              const positioned = f.units.filter((u) => u.lat.trim() && u.lng.trim());
              // Une unité fraîchement ajoutée depuis la bibliothèque hérite
              // du centre carte par défaut (voir handleAddUnitFromLibrary) —
              // elle a donc toujours une position "non vide" sans jamais
              // avoir été réellement placée. Si toutes les unités déjà
              // "positionnées" partagent EXACTEMENT le même point, ce n'est
              // jamais une vraie formation à préserver par translation
              // (elle resterait empilée au même endroit) : mieux vaut générer
              // une formation neuve, comme si aucune n'était positionnée.
              const distinctPositions = new Set(positioned.map((u) => `${u.lat},${u.lng}`));
              if (positioned.length > 0 && distinctPositions.size > 1) {
                // Au moins une unité déjà positionnée : translation par
                // offset centroïde→dépose, formation relative conservée —
                // même calcul que la reposition de flotte de l'arbitre
                // (ArbiterDashboard.tsx, selectFleet/fleetDraftOffset).
                const centroid = {
                  lat: positioned.reduce((s, u) => s + Number(u.lat), 0) / positioned.length,
                  lng: positioned.reduce((s, u) => s + Number(u.lng), 0) / positioned.length,
                };
                const dLat = drop.lat - centroid.lat;
                const dLng = drop.lng - centroid.lng;
                return {
                  ...f,
                  units: f.units.map((u) =>
                    u.lat.trim() && u.lng.trim() ? { ...u, lat: String(Number(u.lat) + dLat), lng: String(Number(u.lng) + dLng) } : u
                  ),
                };
              }
              // Aucune unité positionnée : formation générique de départ.
              const positions = applyFormationAtCenter(drop, f.units.length);
              return { ...f, units: f.units.map((u, i) => ({ ...u, lat: String(positions[i].lat), lng: String(positions[i].lng) })) };
            }),
          };
        })
      );
    }
  }

  function applyDraftPosition() {
    if (!draftPosition || !selection) return;
    if (selection.kind === "unit") {
      const { teamClientId, fleetClientId, unitClientId } = selection;
      setTeams((prev) =>
        prev.map((t) =>
          t.clientId === teamClientId
            ? {
                ...t,
                fleets: t.fleets.map((f) =>
                  f.clientId === fleetClientId
                    ? { ...f, units: f.units.map((u) => (u.clientId === unitClientId ? { ...u, lat: String(draftPosition.lat), lng: String(draftPosition.lng) } : u)) }
                    : f
                ),
              }
            : t
        )
      );
    } else {
      const { clientId } = selection;
      setAirbasesState((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, lat: String(draftPosition.lat), lng: String(draftPosition.lng) } : a)));
    }
    setDraftPosition(null);
  }

  function updateName(value: string) {
    setName(value);
    if (!keyTouched) setKey(slugify(value));
  }

  function handleAddUnitFromLibrary(libClass: LibraryClassOption, teamClientId: string, fleetClientId: string) {
    const newUnit: BuilderUnit = {
      clientId: nextClientId("unit"),
      name: libClass.name,
      pennant: "",
      headingDeg: "",
      historicalNote: "",
      lat: String(mapCenterLat),
      lng: String(mapCenterLng),
      classRef: { kind: "library", libraryClassId: libClass.id, libraryKey: libClass.key, name: libClass.name, category: libClass.category },
      baseRef: { kind: "none" },
    };
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId
          ? { ...t, fleets: t.fleets.map((f) => (f.clientId === fleetClientId ? { ...f, units: [...f.units, newUnit] } : f)) }
          : t
      )
    );
  }

  /**
   * Assistant "+" (Phase 3, retour utilisateur 2026-08-15) — variante
   * d'`addTeam`/`addFleet` (normalement internes à TeamsBoard.tsx) exposée
   * ici pour être appelable depuis AddContainerModal, avec en plus le
   * `preferredNation` optionnel sur la nouvelle task force.
   */
  function handleCreateFleetContainer(target: { teamClientId: string } | { newTeamName: string }, preferredNation: string) {
    const nation = preferredNation || undefined;
    if ("teamClientId" in target) {
      setTeams((prev) =>
        prev.map((t) =>
          t.clientId === target.teamClientId
            ? { ...t, fleets: [...t.fleets, { clientId: nextClientId("fleet"), name: `Task Force ${t.fleets.length + 1}`, units: [], preferredNation: nation }] }
            : t
        )
      );
      return;
    }
    setTeams((prev) => [
      ...prev,
      {
        clientId: nextClientId("team"),
        name: target.newTeamName,
        colorHex: prev.length % 2 === 0 ? "#3388ff" : "#dc2626",
        fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [], preferredNation: nation }],
      },
    ]);
  }

  function handleAddAirbase() {
    setAirbasesState((prev) => [...prev, { clientId: nextClientId("airbase"), key: `base-${prev.length + 1}`, name: "", lat: String(mapCenterLat), lng: String(mapCenterLng) }]);
  }
  function handleUpdateAirbase(clientId: string, patch: Partial<BuilderAirbase>) {
    setAirbasesState((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, ...patch } : a)));
  }
  /** Détache (unités et escadrilles qui la référençaient retombent à "Aucune") plutôt que de bloquer — champ optionnel côté schéma. */
  function handleRemoveAirbase(clientId: string) {
    const removed = airbasesState.find((a) => a.clientId === clientId);
    setAirbasesState((prev) => prev.filter((a) => a.clientId !== clientId));
    if (!removed) return;
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        fleets: t.fleets.map((f) => ({
          ...f,
          units: f.units.map((u) => (u.baseRef.kind === "airbase" && u.baseRef.key === removed.key ? { ...u, baseRef: { kind: "none" } } : u)),
        })),
      }))
    );
    setSquadronsState((prev) => prev.map((s) => (s.baseRef.kind === "airbase" && s.baseRef.key === removed.key ? { ...s, baseRef: { kind: "none" } } : s)));
    setSelection((prev) => (prev?.kind === "airbase" && prev.clientId === clientId ? null : prev));
  }

  /** Glisser-déposer d'un avion déjà en flotte vers une base aérienne/escadrille (Phase 6, retour utilisateur 2026-08-14) — voir AirbasesPanel/SquadronsPanel, dragDrop.ts. */
  function handleAssignUnitBaseRef(teamClientId: string, fleetClientId: string, unitClientId: string, baseRef: BaseRef) {
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId
          ? {
              ...t,
              fleets: t.fleets.map((f) =>
                f.clientId === fleetClientId
                  ? { ...f, units: f.units.map((u) => (u.clientId === unitClientId ? { ...u, baseRef } : u)) }
                  : f
              ),
            }
          : t
      )
    );
  }

  function handleAddSquadron() {
    setSquadronsState((prev) => [...prev, { clientId: nextClientId("squadron"), key: `escadrille-${prev.length + 1}`, name: "", baseRef: { kind: "none" } }]);
  }
  function handleUpdateSquadron(clientId: string, patch: Partial<BuilderSquadron>) {
    setSquadronsState((prev) => prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)));
  }
  function handleRemoveSquadron(clientId: string) {
    const removed = squadronsState.find((s) => s.clientId === clientId);
    setSquadronsState((prev) => prev.filter((s) => s.clientId !== clientId));
    if (!removed) return;
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        fleets: t.fleets.map((f) => ({
          ...f,
          units: f.units.map((u) => (u.baseRef.kind === "squadron" && u.baseRef.key === removed.key ? { ...u, baseRef: { kind: "none" } } : u)),
        })),
      }))
    );
  }

  const memberCountByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of allUnits(teams)) {
      if (u.baseRef.kind === "squadron") map.set(u.baseRef.key, (map.get(u.baseRef.key) ?? 0) + 1);
    }
    return map;
  }, [teams]);

  const { definition, validationIssues } = useMemo(() => {
    const unitClassMap = new Map<string, ScenarioUnitClass | { key: string; libraryKey: string }>();
    for (const u of allUnits(teams)) {
      if (u.classRef.kind === "library") unitClassMap.set(u.classRef.libraryKey, { key: u.classRef.libraryKey, libraryKey: u.classRef.libraryKey });
      else unitClassMap.set(u.classRef.key, u.classRef.def);
    }

    function mapUnit(u: BuilderUnit): ScenarioUnit {
      const base: Partial<ScenarioUnit> =
        u.baseRef.kind === "literal"
          ? { baseLat: u.baseRef.lat.trim() ? Number(u.baseRef.lat) : undefined, baseLng: u.baseRef.lng.trim() ? Number(u.baseRef.lng) : undefined, baseName: u.baseRef.name || undefined }
          : u.baseRef.kind === "airbase"
            ? { airbaseKey: u.baseRef.key }
            : u.baseRef.kind === "squadron"
              ? { squadronKey: u.baseRef.key }
              : u.baseRef.kind === "carrier"
                ? { carrierUnitName: u.baseRef.unitName }
                : {};
      return {
        name: u.name,
        classKey: classKeyFor(u.classRef),
        pennant: u.pennant.trim() || undefined,
        lat: Number(u.lat) || 0,
        lng: Number(u.lng) || 0,
        headingDeg: u.headingDeg.trim() ? Number(u.headingDeg) : undefined,
        historicalNote: u.historicalNote.trim() || undefined,
        ...base,
      };
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
      unitClasses: Array.from(unitClassMap.values()),
      teams: teams.map(
        (t): ScenarioTeam => ({
          name: t.name,
          colorHex: t.colorHex,
          fleets: t.fleets.map((f) => ({ name: f.name, units: f.units.map(mapUnit) })),
        })
      ),
      airbases: airbasesState.length > 0 ? airbasesState.map((a) => ({ key: a.key, name: a.name, lat: Number(a.lat) || 0, lng: Number(a.lng) || 0 })) : undefined,
      squadrons:
        squadronsState.length > 0
          ? squadronsState.map((s) => ({
              key: s.key,
              name: s.name,
              airbaseKey: s.baseRef.kind === "airbase" ? s.baseRef.key : undefined,
              carrierUnitName: s.baseRef.kind === "carrier" ? s.baseRef.unitName : undefined,
            }))
          : undefined,
      objectives: teams.map((t) => ({ teamName: t.name, text: objectivesByTeamName[t.name] ?? "" })),
    };
    const result = ScenarioDefinitionSchema.safeParse(candidate);
    if (!result.success) {
      return { definition: null, validationIssues: result.error.issues.map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`) };
    }
    return { definition: result.data, validationIssues: [] as string[] };
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
    teams,
    airbasesState,
    squadronsState,
    objectivesByTeamName,
  ]);

  // Silhouettes réalistes plutôt que des points colorés (Phase 5, retour
  // utilisateur 2026-08-14) — même recette qu'ArbiterDashboard.tsx :
  // longueur réelle inconnue pour une classe de bibliothèque à ce stade
  // (LibraryClassOption n'a pas ce champ), repli systématique sur
  // DEFAULT_LENGTH_METERS, suffisant pour un aperçu de composition.
  const shipMarkers = useMemo<ShipMarkerConfig[]>(
    () =>
      teams.flatMap((t) =>
        t.fleets.flatMap((f) =>
          f.units
            .filter((u) => u.lat.trim() && u.lng.trim())
            .map((u) => {
              const silhouette = classifySilhouette(u.classRef.category, u.classRef.name);
              return {
                id: u.clientId,
                lat: Number(u.lat),
                lng: Number(u.lng),
                headingDeg: u.headingDeg.trim() ? Number(u.headingDeg) : 0,
                color: t.colorHex,
                silhouette,
                lengthMeters: DEFAULT_LENGTH_METERS[silhouette],
                label: u.name,
              };
            })
        )
      ),
    [teams]
  );

  const previewSources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [];

    const airbasePoints = airbasesState.filter((a) => a.lat.trim() && a.lng.trim()).map((a) => ({ lat: Number(a.lat), lng: Number(a.lng), properties: { name: a.name || a.key } }));
    if (airbasePoints.length > 0) {
      list.push({ id: "airbases", kind: "points", data: pointsFeatureCollection(airbasePoints), color: "#38bdf8", radius: 6, showLabels: true });
    }

    if (selectedUnit && selectedUnit.lat.trim() && selectedUnit.lng.trim()) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection([{ lat: Number(selectedUnit.lat), lng: Number(selectedUnit.lng), properties: {} }]),
        color: "#facc15",
        radius: 10,
      });
    }
    if (selectedAirbase && selectedAirbase.lat.trim() && selectedAirbase.lng.trim()) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection([{ lat: Number(selectedAirbase.lat), lng: Number(selectedAirbase.lng), properties: {} }]),
        color: "#facc15",
        radius: 10,
      });
    }
    if (draftPosition) {
      list.push({
        id: "draft",
        kind: "points",
        data: pointsFeatureCollection([{ lat: draftPosition.lat, lng: draftPosition.lng, properties: { name: "nouvelle position" } }]),
        color: "#f97316",
        radius: 9,
        showLabels: true,
      });
    }
    return list;
  }, [airbasesState, selectedUnit, selectedAirbase, draftPosition]);

  // Dérivé directement de l'état brut (pas de `definition`, qui peut être
  // `null` en cours d'édition — Phase 5, retour utilisateur 2026-08-14) :
  // la carte doit rester utilisable pour placer une unité même si le reste
  // du formulaire n'est pas encore valide (objectifs vides, etc.).
  const previewPoints = useMemo(() => {
    const unitPoints = allUnits(teams)
      .filter((u) => u.lat.trim() && u.lng.trim())
      .map((u) => ({ lat: Number(u.lat), lng: Number(u.lng) }));
    const airbasePoints = airbasesState.filter((a) => a.lat.trim() && a.lng.trim()).map((a) => ({ lat: Number(a.lat), lng: Number(a.lng) }));
    return [...unitPoints, ...airbasePoints];
  }, [teams, airbasesState]);

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
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-2xl text-brass-300">{duplicateFrom ? `Dupliquer « ${duplicateFrom.name} »` : "Créer un scénario"}</h1>
          <Link href="/create" className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
            ← Retour
          </Link>
        </div>
        {duplicateFrom ? (
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Tout ci-dessous, y compris les task forces et bases, est pré-rempli avec le contenu de « {duplicateFrom.name} » —
            modifiez ce que vous voulez (ajouter une flotte, une base aérienne, des unités…) puis enregistrez : l&apos;original
            n&apos;est jamais modifié, ceci crée un nouveau scénario séparé.
          </p>
        ) : (
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Les champs simples ci-dessous, puis l&apos;ordre de bataille — task forces, escadrilles, bases aériennes, unités —
            se composent visuellement à droite, en piochant dans la bibliothèque partagée.
          </p>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-1">
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

            <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Positions — glissez ⚓/✈ une task force/base ici pour la positionner
              </h3>
              <div className="h-64 overflow-hidden rounded-md" onDragOver={allowDrop} onDrop={handleMapDrop}>
                <GameMap
                  ref={gameMapRef}
                  center={{ lat: mapCenterLat, lng: mapCenterLng }}
                  zoom={mapDefaultZoom}
                  sources={previewSources}
                  fitToPoints={previewPoints}
                  shipMarkers={shipMarkers}
                  shipMarkersMinZoom={0}
                  onClick={handleMapClick}
                />
              </div>
              {selection ? (
                <div className="mt-2 rounded-md border border-brass-700 bg-brass-950/20 p-2 text-xs">
                  <p className="text-brass-300">
                    {selectedUnit ? `Unité sélectionnée : ${selectedUnit.name}` : selectedAirbase ? `Base sélectionnée : ${selectedAirbase.name || selectedAirbase.key}` : null}
                    {" — cliquez la carte pour choisir sa position."}
                  </p>
                  {draftPosition && (
                    <p className="mt-1 text-slate-400">
                      Nouvelle position : {draftPosition.lat.toFixed(4)}, {draftPosition.lng.toFixed(4)}
                    </p>
                  )}
                  {posError && <p className="mt-1 text-red-400">{posError}</p>}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelection(null);
                        setDraftPosition(null);
                        setPosError(null);
                      }}
                      className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-900"
                    >
                      Fermer
                    </button>
                    <button
                      type="button"
                      onClick={applyDraftPosition}
                      disabled={!draftPosition}
                      className="flex-1 rounded bg-brass-600 px-2 py-1 font-medium hover:bg-brass-500 disabled:opacity-50"
                    >
                      Appliquer
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-600">
                  Cliquez le 🎯 d&apos;une unité ou d&apos;une base ci-contre pour la positionner en cliquant la carte.
                </p>
              )}
            </div>

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

          <div className="space-y-4 xl:col-span-2">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <LibraryBrowserPanel classes={libraryClasses} teams={teams} onAddUnit={handleAddUnitFromLibrary} />
              </div>
              <div className="lg:col-span-2">
                <TeamsBoard
                  teams={teams}
                  setTeams={setTeams}
                  airbases={airbasesState}
                  squadrons={squadronsState}
                  nextClientId={nextClientId}
                  selectedUnitClientId={selection?.kind === "unit" ? selection.unitClientId : null}
                  onSelectUnitForPlacement={selectUnitForPlacement}
                  libraryClasses={libraryClasses}
                  onAddUnitFromLibrary={handleAddUnitFromLibrary}
                  onOpenAddContainer={() => setAddContainerModalOpen(true)}
                  onOpenUnitWizard={(teamClientId, fleetClientId) => setUnitWizardFor({ teamClientId, fleetClientId })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <AirbasesPanel
                airbases={airbasesState}
                onAdd={handleAddAirbase}
                onUpdate={handleUpdateAirbase}
                onRemove={handleRemoveAirbase}
                selectedAirbaseClientId={selection?.kind === "airbase" ? selection.clientId : null}
                onSelectForPlacement={selectAirbaseForPlacement}
                onAssignAircraft={(teamClientId, fleetClientId, unitClientId, airbaseKey) =>
                  handleAssignUnitBaseRef(teamClientId, fleetClientId, unitClientId, { kind: "airbase", key: airbaseKey })
                }
              />
              <SquadronsPanel
                squadrons={squadronsState}
                airbases={airbasesState}
                carrierCandidates={surfaceShipUnits(teams)}
                memberCountByKey={memberCountByKey}
                onAdd={handleAddSquadron}
                onUpdate={handleUpdateSquadron}
                onRemove={handleRemoveSquadron}
                onAssignAircraft={(teamClientId, fleetClientId, unitClientId, squadronKey) =>
                  handleAssignUnitBaseRef(teamClientId, fleetClientId, unitClientId, { kind: "squadron", key: squadronKey })
                }
              />
            </div>

            <ObjectivesEditor
              teams={teams}
              textByTeamName={new Map(Object.entries(objectivesByTeamName))}
              onChangeText={(teamName, text) => setObjectivesByTeamName((prev) => ({ ...prev, [teamName]: text }))}
            />
          </div>
        </div>
      </div>

      {addContainerModalOpen && (
        <AddContainerModal
          teams={teams}
          onClose={() => setAddContainerModalOpen(false)}
          onCreateFleet={handleCreateFleetContainer}
          onCreateAirbase={handleAddAirbase}
        />
      )}

      {unitWizardFor &&
        (() => {
          const team = teams.find((t) => t.clientId === unitWizardFor.teamClientId);
          const fleet = team?.fleets.find((f) => f.clientId === unitWizardFor.fleetClientId);
          if (!team || !fleet) return null;
          return (
            <AddUnitWizardModal
              fleetName={`${team.name} / ${fleet.name}`}
              libraryClasses={libraryClasses}
              preferredNation={fleet.preferredNation}
              onClose={() => setUnitWizardFor(null)}
              onPick={(libClass) => handleAddUnitFromLibrary(libClass, unitWizardFor.teamClientId, unitWizardFor.fleetClientId)}
            />
          );
        })()}
    </div>
  );
}
