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
  aircraftForAirbase,
  aircraftForCarrier,
  resolveClassInfo,
} from "./builder/types";
import { LibraryBrowserPanel } from "./builder/LibraryBrowserPanel";
import { TeamsBoard } from "./builder/TeamsBoard";
import { allowDrop, readDragPayload } from "./builder/dragDrop";
import { applyFormationAtCenter } from "./builder/formation";
import { AddContainerModal } from "./builder/AddContainerModal";
import { AddUnitWizardModal } from "./builder/AddUnitWizardModal";
import { AddAircraftWizardModal } from "./builder/AddAircraftWizardModal";
import { ScenarioMetaModal, type ScenarioMetaTab } from "./builder/ScenarioMetaModal";
import { NATIONS } from "./builder/nations";

/**
 * Constructeur de scénarios (module séparé de la feuille de route) —
 * entièrement visuel depuis le 2026-08-14 (retour utilisateur) : task
 * forces, escadrilles, bases aériennes et unités se composent par
 * boutons/glisser-déposer/assistants guidés plutôt qu'en JSON (voir
 * builder/), en référençant toujours des classes EXISTANTES de la
 * bibliothèque partagée (`/library`) — pas d'auteur de classe inline ici
 * (la modal de création rapide, `QuickCreateClassModal`, comble "à la
 * volée" sans quitter le flux). Les infos de scénario (nom, dates,
 * météo, objectifs) se règlent dans `ScenarioMetaModal`, ouverte depuis
 * le header.
 *
 * Mise en page (retour utilisateur 2026-08-15, deuxième chantier) : 3
 * colonnes façon `ArbiterDashboard.tsx` — rail gauche collapsible (task
 * forces/bases/escadrilles), carte plein cadre au centre, bibliothèque à
 * droite. Voir `.claude/plans/robust-mapping-summit.md` pour le détail des
 * 5 phases.
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

/**
 * Clé dérivée d'un scénario dupliqué, distincte de l'original (voir
 * duplicateFrom) — pas besoin d'unicité garantie ici, juste de collision
 * peu probable en pratique (deux duplications successives de la même
 * source, jamais renommées) ; le serveur revalide de toute façon à
 * l'enregistrement.
 *
 * Volontairement SANS `Date.now()` (bug trouvé le 2026-08-15, Phase 5) :
 * cette fonction alimente la lazy init de `useState`, qui s'exécute aussi
 * bien côté SSR que côté hydratation client — un suffixe basé sur l'heure
 * diffère forcément entre les deux passes. Tant que `key` ne servait qu'à
 * la valeur d'un `<input>` contrôlé, React masquait silencieusement le
 * décalage (protection anti-écrasement de saisie utilisateur, même classe
 * de bug que `createClientIdGenerator`, voir builder/types.ts) ; depuis la
 * Phase 4 (mise en page 3 colonnes), `key` s'affiche aussi en texte brut
 * dans le sous-titre du header — un texte, contrairement à un `<input>`,
 * ne bénéficie pas de cette tolérance et déclenchait une vraie erreur
 * d'hydratation React (#418).
 */
function duplicateKey(originalKey: string) {
  return `${originalKey}-variante`;
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

/**
 * Nationalité d'une équipe dupliquée depuis un scénario antérieur à ce
 * champ (retour utilisateur 2026-08-15, troisième chantier) — `t.nation`
 * est optionnel pour rester rétrocompatible (voir ScenarioTeam, types.ts).
 * Repli sur la nation de sa première unité identifiable plutôt qu'une
 * valeur arbitraire : garantit qu'au chargement, le verrou de
 * `changeTeamNation` (TeamsBoard.tsx) ne se déclenche jamais à tort sur du
 * contenu déjà cohérent.
 */
function inferTeamNation(t: ScenarioTeam, source: ScenarioDefinition, libraryClasses: LibraryClassOption[]): string {
  for (const f of t.fleets) {
    for (const u of f.units) {
      const classRef = classRefFromScenario(u.classKey, source, libraryClasses);
      const nation = classRef.kind === "inline" ? classRef.def.nation : libraryClasses.find((l) => l.id === classRef.libraryClassId)?.nation;
      if (nation && nation !== "?") return nation;
    }
  }
  return NATIONS[0].value;
}

function buildInitialTeams(duplicateFrom: ScenarioDefinition | null, libraryClasses: LibraryClassOption[], nextClientId: ClientIdGenerator): BuilderTeam[] {
  if (!duplicateFrom) {
    return [
      { clientId: nextClientId("team"), name: NATIONS[0].value, colorHex: NATIONS[0].colorHex, nation: NATIONS[0].value, fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }] },
      { clientId: nextClientId("team"), name: NATIONS[1].value, colorHex: NATIONS[1].colorHex, nation: NATIONS[1].value, fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }] },
    ];
  }
  return duplicateFrom.teams.map((t) => ({
    clientId: nextClientId("team"),
    name: t.name,
    colorHex: t.colorHex,
    nation: t.nation ?? inferTeamNation(t, duplicateFrom, libraryClasses),
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

/**
 * `teams` déjà construites (voir l'ordre d'appel dans le composant) — sert
 * à résoudre `ScenarioAirbase.teamName` en `teamClientId` (retour
 * utilisateur 2026-08-15, troisième chantier : une base appartient
 * désormais à une équipe). Repli sur la première équipe si `teamName` est
 * absent (scénario antérieur à ce champ) ou ne correspond à aucune équipe
 * connue — l'utilisateur peut la réaffecter ensuite via le sélecteur
 * d'équipe de la carte base aérienne.
 */
function buildInitialAirbases(duplicateFrom: ScenarioDefinition | null, teams: BuilderTeam[], nextClientId: ClientIdGenerator): BuilderAirbase[] {
  return (duplicateFrom?.airbases ?? []).map((a) => {
    const team = teams.find((t) => t.name === a.teamName) ?? teams[0];
    return { clientId: nextClientId("airbase"), key: a.key, name: a.name, lat: String(a.lat), lng: String(a.lng), teamClientId: team?.clientId ?? "" };
  });
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
  const [airbasesState, setAirbasesState] = useState<BuilderAirbase[]>(() => buildInitialAirbases(duplicateFrom, teams, nextClientId));
  const [squadronsState, setSquadronsState] = useState<BuilderSquadron[]>(() => buildInitialSquadrons(duplicateFrom, nextClientId));
  const [objectivesByTeamName, setObjectivesByTeamName] = useState<Record<string, string>>(() => buildInitialObjectives(duplicateFrom));

  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Assistants de création guidée (Phase 3, retour utilisateur 2026-08-15)
  // — coexistent avec les boutons/glisser-déposer déjà en place.
  const [addContainerModalOpen, setAddContainerModalOpen] = useState(false);
  const [unitWizardFor, setUnitWizardFor] = useState<{ teamClientId: string; fleetClientId: string } | null>(null);
  const [aircraftWizardFor, setAircraftWizardFor] = useState<
    { teamClientId: string; target: { kind: "airbase"; airbaseKey: string } | { kind: "carrier"; carrierUnitName: string } } | null
  >(null);

  // Mise en page 3 colonnes façon arbitre (Phase 4, retour utilisateur
  // 2026-08-15) — rail gauche collapsible comme ArbiterDashboard.tsx, infos
  // de scénario déportées dans une modal à onglets plutôt qu'une colonne
  // toujours visible (voir ScenarioMetaModal.tsx).
  const [leftOpen, setLeftOpen] = useState(true);
  const [metaTab, setMetaTab] = useState<ScenarioMetaTab | null>(null);

  // Placement interactif sur carte (Phase 5, retour utilisateur
  // 2026-08-14) : même pattern que la repositionnement côté arbitre
  // (ArbiterDashboard.tsx) — sélection → clic carte → brouillon → clic
  // "Appliquer" pour committer, mais ici RIEN n'est envoyé au serveur tant
  // que "Enregistrer le scénario" (plus bas) n'a pas été cliqué : la
  // position "appliquée" ne fait que mettre à jour l'état local du
  // formulaire.
  const [selection, setSelection] = useState<
    | { kind: "unit"; teamClientId: string; fleetClientId: string; unitClientId: string }
    | { kind: "airbase"; clientId: string }
    | { kind: "fleet"; teamClientId: string; fleetClientId: string }
    | null
  >(null);
  const [draftPosition, setDraftPosition] = useState<LatLng | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const gameMapRef = useRef<GameMapHandle>(null);

  const selectedUnit =
    selection?.kind === "unit"
      ? (allUnits(teams).find((u) => u.clientId === selection.unitClientId) ?? null)
      : null;
  const selectedAirbase = selection?.kind === "airbase" ? (airbasesState.find((a) => a.clientId === selection.clientId) ?? null) : null;
  const selectedFleet =
    selection?.kind === "fleet"
      ? (teams.find((t) => t.clientId === selection.teamClientId)?.fleets.find((f) => f.clientId === selection.fleetClientId) ?? null)
      : null;

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
  /** Positionnement de groupe (Phase 5, retour utilisateur 2026-08-15) — bouton 🎯 en plus du glisser-déposer (chantier précédent), même mécanisme clic-carte que pour une unité/base seule. */
  function selectFleetForPlacement(teamClientId: string, fleetClientId: string) {
    setSelection((prev) => (prev?.kind === "fleet" && prev.fleetClientId === fleetClientId ? null : { kind: "fleet", teamClientId, fleetClientId }));
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
   * Repositionne TOUTE une task force en un geste (Phase 2, retour
   * utilisateur 2026-08-15) — translate ses unités déjà positionnées
   * (offset centroïde→dépose, formation relative conservée, même calcul
   * que la reposition de flotte côté arbitre — ArbiterDashboard.tsx,
   * selectFleet/fleetDraftOffset) si au moins une a une position "réelle"
   * (voir le repli "toutes au même point" ci-dessous), sinon génère une
   * formation neuve (formation.ts, placeholder générique assumé). Appelée
   * aussi bien par le glisser-déposer (handleMapDrop) que par le bouton 🎯
   * de groupe (Phase 5, applyDraftPosition) — factorisée pour ne pas
   * dupliquer ce calcul.
   */
  function applyGroupPositionToFleet(prev: BuilderTeam[], teamClientId: string, fleetClientId: string, drop: LatLng): BuilderTeam[] {
    return prev.map((t) => {
      if (t.clientId !== teamClientId) return t;
      return {
        ...t,
        fleets: t.fleets.map((f) => {
          if (f.clientId !== fleetClientId) return f;
          const positioned = f.units.filter((u) => u.lat.trim() && u.lng.trim());
          // Une unité fraîchement ajoutée depuis la bibliothèque hérite du
          // centre carte par défaut (voir handleAddUnitFromLibrary) — elle a
          // donc toujours une position "non vide" sans jamais avoir été
          // réellement placée. Si toutes les unités déjà "positionnées"
          // partagent EXACTEMENT le même point, ce n'est jamais une vraie
          // formation à préserver par translation (elle resterait empilée
          // au même endroit) : mieux vaut générer une formation neuve,
          // comme si aucune n'était positionnée.
          const distinctPositions = new Set(positioned.map((u) => `${u.lat},${u.lng}`));
          if (positioned.length > 0 && distinctPositions.size > 1) {
            const centroid = {
              lat: positioned.reduce((s, u) => s + Number(u.lat), 0) / positioned.length,
              lng: positioned.reduce((s, u) => s + Number(u.lng), 0) / positioned.length,
            };
            const dLat = drop.lat - centroid.lat;
            const dLng = drop.lng - centroid.lng;
            return {
              ...f,
              units: f.units.map((u) => (u.lat.trim() && u.lng.trim() ? { ...u, lat: String(Number(u.lat) + dLat), lng: String(Number(u.lng) + dLng) } : u)),
            };
          }
          const positions = applyFormationAtCenter(drop, f.units.length);
          return { ...f, units: f.units.map((u, i) => ({ ...u, lat: String(positions[i].lat), lng: String(positions[i].lng) })) };
        }),
      };
    });
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
      const base = airbasesState.find((a) => a.clientId === payload.airbaseClientId);
      setAirbasesState((prev) => prev.map((a) => (a.clientId === payload.airbaseClientId ? { ...a, lat: String(drop.lat), lng: String(drop.lng) } : a)));
      if (base) repositionAirbaseAircraft(base.key, drop);
      return;
    }
    if (payload.kind === "fleet") {
      setTeams((prev) => applyGroupPositionToFleetWithCarriers(prev, payload.teamClientId, payload.fleetClientId, drop));
    }
  }

  /** "une base aérienne avec tous ses avions" (retour utilisateur 2026-08-15, Phase 5) — factorisé, appelé par le glisser-déposer ET le bouton 🎯 de groupe (applyDraftPosition). */
  function repositionAirbaseAircraft(airbaseKey: string, drop: LatLng) {
    const attached = aircraftForAirbase(teams, airbaseKey);
    if (attached.length === 0) return;
    const positions = applyFormationAtCenter(drop, attached.length);
    setTeams((prev) =>
      attached.reduce(
        (acc, lu, i) =>
          acc.map((t) =>
            t.clientId === lu.teamClientId
              ? {
                  ...t,
                  fleets: t.fleets.map((f) =>
                    f.clientId === lu.fleetClientId
                      ? { ...f, units: f.units.map((u) => (u.clientId === lu.unit.clientId ? { ...u, lat: String(positions[i].lat), lng: String(positions[i].lng) } : u)) }
                      : f
                  ),
                }
              : t
          ),
        prev
      )
    );
  }

  /**
   * "un porte-avions [...] référence mobile, la position suit le navire"
   * (Constats du plan, Phase 4) — même principe que
   * `repositionAirbaseAircraft`, mais un porte-avions se déplace comme
   * n'importe quel navire (seul via 🎯, ou en groupe avec toute sa task
   * force) : contrairement à une base aérienne, il n'a pas son propre
   * déclencheur de repositionnement dédié, ce correctif le rattache aux
   * DEUX chemins de déplacement de navire existants (voir
   * `applyGroupPositionToFleetWithCarriers`/`applyDraftPosition`). Version
   * PURE (prend et rend `teams`) pour pouvoir s'enchaîner après un
   * déplacement de groupe déjà calculé.
   */
  function applyCarrierAircraftFollow(teamsIn: BuilderTeam[], carrierUnitName: string, newPos: LatLng): BuilderTeam[] {
    const attached = aircraftForCarrier(teamsIn, carrierUnitName);
    if (attached.length === 0) return teamsIn;
    const positions = applyFormationAtCenter(newPos, attached.length);
    return attached.reduce(
      (acc, lu, i) =>
        acc.map((t) =>
          t.clientId === lu.teamClientId
            ? {
                ...t,
                fleets: t.fleets.map((f) =>
                  f.clientId === lu.fleetClientId
                    ? { ...f, units: f.units.map((u) => (u.clientId === lu.unit.clientId ? { ...u, lat: String(positions[i].lat), lng: String(positions[i].lng) } : u)) }
                    : f
                ),
              }
            : t
        ),
      teamsIn
    );
  }

  /** `applyGroupPositionToFleet` puis fait suivre l'escadrille de chaque porte-avions de la flotte à sa position finale — sinon un porte-avions déplacé en groupe (drag ⚓ ou 🎯 de task force) laisse ses avions sur place. */
  function applyGroupPositionToFleetWithCarriers(prev: BuilderTeam[], teamClientId: string, fleetClientId: string, drop: LatLng): BuilderTeam[] {
    const next = applyGroupPositionToFleet(prev, teamClientId, fleetClientId, drop);
    const fleet = next.find((t) => t.clientId === teamClientId)?.fleets.find((f) => f.clientId === fleetClientId);
    if (!fleet) return next;
    return fleet.units.reduce((acc, u) => {
      if (!u.lat.trim() || !u.lng.trim()) return acc;
      const info = resolveClassInfo(u.classRef, libraryClasses);
      if (info?.iconKey !== "carrier") return acc;
      return applyCarrierAircraftFollow(acc, u.name, { lat: Number(u.lat), lng: Number(u.lng) });
    }, next);
  }

  function applyDraftPosition() {
    if (!draftPosition || !selection) return;
    if (selection.kind === "unit") {
      const { teamClientId, fleetClientId, unitClientId } = selection;
      setTeams((prev) => {
        const next = prev.map((t) =>
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
        );
        // Un porte-avions déplacé seul (pas en groupe) fait aussi suivre son escadrille — même principe qu'une base aérienne.
        const movedUnit = next.find((t) => t.clientId === teamClientId)?.fleets.find((f) => f.clientId === fleetClientId)?.units.find((u) => u.clientId === unitClientId);
        if (movedUnit && resolveClassInfo(movedUnit.classRef, libraryClasses)?.iconKey === "carrier") {
          return applyCarrierAircraftFollow(next, movedUnit.name, draftPosition);
        }
        return next;
      });
    } else if (selection.kind === "airbase") {
      const { clientId } = selection;
      const base = airbasesState.find((a) => a.clientId === clientId);
      setAirbasesState((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, lat: String(draftPosition.lat), lng: String(draftPosition.lng) } : a)));
      // "une base aérienne avec tous ses avions" (retour utilisateur 2026-08-15, Phase 5).
      if (base) repositionAirbaseAircraft(base.key, draftPosition);
    } else {
      // "fleet" — bouton 🎯 de groupe (Phase 5, retour utilisateur 2026-08-15), même calcul que le glisser-déposer + suivi des porte-avions.
      const { teamClientId, fleetClientId } = selection;
      setTeams((prev) => applyGroupPositionToFleetWithCarriers(prev, teamClientId, fleetClientId, draftPosition));
    }
    setDraftPosition(null);
  }

  function updateName(value: string) {
    setName(value);
    if (!keyTouched) setKey(slugify(value));
  }

  function buildUnitFromLibraryClass(libClass: LibraryClassOption, baseRef: BaseRef): BuilderUnit {
    return {
      clientId: nextClientId("unit"),
      name: libClass.name,
      pennant: "",
      headingDeg: "",
      historicalNote: "",
      lat: String(mapCenterLat),
      lng: String(mapCenterLng),
      classRef: { kind: "library", libraryClassId: libClass.id, libraryKey: libClass.key, name: libClass.name, category: libClass.category },
      baseRef,
    };
  }

  function handleAddUnitFromLibrary(libClass: LibraryClassOption, teamClientId: string, fleetClientId: string) {
    const newUnit = buildUnitFromLibraryClass(libClass, { kind: "none" });
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId
          ? { ...t, fleets: t.fleets.map((f) => (f.clientId === fleetClientId ? { ...f, units: [...f.units, newUnit] } : f)) }
          : t
      )
    );
  }

  /**
   * Task force technique "Aviation", une par équipe, créée à la volée et
   * masquée de la liste visible (retour utilisateur 2026-08-15, troisième
   * chantier, Phase 4 — voir BuilderFleet.kind, types.ts) : porte les
   * avions rattachés directement à une base aérienne/un porte-avions, sans
   * demander à l'utilisateur "dans quelle task force ?" — il ne pense
   * qu'en "quelle base". `teams` (état déjà à jour au moment du clic, pas
   * de risque de lecture obsolète pour un seul appel synchrone) plutôt que
   * `setTeams((prev) => …)` pour connaître l'id AVANT de poser l'avion
   * dedans dans la foulée.
   */
  function ensureAviationFleet(teamClientId: string): string {
    const existing = teams.find((t) => t.clientId === teamClientId)?.fleets.find((f) => f.kind === "aviation");
    if (existing) return existing.clientId;
    const clientId = nextClientId("fleet");
    setTeams((prev) =>
      prev.map((t) => (t.clientId === teamClientId ? { ...t, fleets: [...t.fleets, { clientId, name: "Aviation", units: [], kind: "aviation" as const }] } : t))
    );
    return clientId;
  }

  /**
   * Ajoute un ou plusieurs avions de la même classe à une base/un
   * porte-avions (Phase 4, étendu Phase 6, retour utilisateur
   * 2026-08-15) : quantité 1 (par défaut) = comportement inchangé,
   * quantité > 1 = crée EN PLUS une escadrille (voir §4.1.1.1 Amirauté
   * 2013, déjà cité au chantier précédent — les avions groupés hors
   * reconnaissance/attaque isolée forment une escadrille), chaque avion
   * rattaché à elle plutôt que directement à la base/au porte-avions.
   */
  function addAircraftToBase(libClass: LibraryClassOption, teamClientId: string, target: { kind: "airbase"; key: string } | { kind: "carrier"; unitName: string }, quantity: number) {
    const fleetClientId = ensureAviationFleet(teamClientId);
    const directBaseRef: BaseRef = target.kind === "airbase" ? { kind: "airbase", key: target.key } : { kind: "carrier", unitName: target.unitName };
    let unitBaseRef: BaseRef = directBaseRef;
    if (quantity > 1) {
      const squadronKey = `escadrille-${squadronsState.length + 1}`;
      setSquadronsState((prev) => [...prev, { clientId: nextClientId("squadron"), key: squadronKey, name: `Escadrille ${libClass.name}`, baseRef: directBaseRef }]);
      unitBaseRef = { kind: "squadron", key: squadronKey };
    }
    const newUnits = Array.from({ length: Math.max(1, quantity) }, () => buildUnitFromLibraryClass(libClass, unitBaseRef));
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId ? { ...t, fleets: t.fleets.map((f) => (f.clientId === fleetClientId ? { ...f, units: [...f.units, ...newUnits] } : f)) } : t
      )
    );
  }

  /** Avion(s) ajouté(s) directement à une base aérienne (Phase 4/6, retour utilisateur 2026-08-15) — glisser-déposer ou assistant "+ Avion". */
  function handleAddAircraftToAirbase(libClass: LibraryClassOption, teamClientId: string, airbaseKey: string, quantity = 1) {
    addAircraftToBase(libClass, teamClientId, { kind: "airbase", key: airbaseKey }, quantity);
  }

  /** Avion(s) ajouté(s) directement à un porte-avions (Phase 4/6, retour utilisateur 2026-08-15) — glisser-déposer sur le navire ou assistant "+ Avion". */
  function handleAddAircraftToCarrier(libClass: LibraryClassOption, teamClientId: string, carrierUnitName: string, quantity = 1) {
    addAircraftToBase(libClass, teamClientId, { kind: "carrier", unitName: carrierUnitName }, quantity);
  }

/**
   * Assistant "+" (Phase 3, retour utilisateur 2026-08-15) — résout la
   * cible d'un nouveau conteneur (task force/base/station) vers un
   * `teamClientId`, créant l'équipe à la volée si besoin (avec sa
   * "Task Force 1" par défaut, comme `addTeam` dans TeamsBoard.tsx).
   * `nextClientId` est synchrone : l'id de la nouvelle équipe est connu
   * immédiatement, pas besoin d'attendre le prochain rendu pour l'utiliser.
   */
  function ensureTeamForTarget(target: { teamClientId: string } | { newTeamName: string; nation: string }): string {
    if ("teamClientId" in target) return target.teamClientId;
    const clientId = nextClientId("team");
    const colorHex = NATIONS.find((n) => n.value === target.nation)?.colorHex ?? "#94a3b8";
    setTeams((prev) => [
      ...prev,
      { clientId, name: target.newTeamName, colorHex, nation: target.nation, fleets: [{ clientId: nextClientId("fleet"), name: "Task Force 1", units: [] }] },
    ]);
    return clientId;
  }

  function handleCreateFleetContainer(target: { teamClientId: string } | { newTeamName: string; nation: string }) {
    if ("teamClientId" in target) {
      setTeams((prev) =>
        prev.map((t) =>
          t.clientId === target.teamClientId
            ? { ...t, fleets: [...t.fleets, { clientId: nextClientId("fleet"), name: `Task Force ${t.fleets.length + 1}`, units: [] }] }
            : t
        )
      );
      return;
    }
    ensureTeamForTarget(target); // la nouvelle équipe a déjà sa "Task Force 1", rien de plus à faire.
  }

  /** `target` (retour utilisateur 2026-08-15, troisième chantier) — une base aérienne appartient désormais à une équipe, voir BuilderAirbase.teamClientId. */
  function handleAddAirbase(target: { teamClientId: string } | { newTeamName: string; nation: string }) {
    const teamClientId = ensureTeamForTarget(target);
    setAirbasesState((prev) => [...prev, { clientId: nextClientId("airbase"), key: `base-${prev.length + 1}`, name: "", lat: String(mapCenterLat), lng: String(mapCenterLng), teamClientId }]);
  }

  /**
   * Station d'écoute (retour utilisateur 2026-08-15, troisième chantier) —
   * pas de nouveau concept de schéma : une task force `kind:"station"`
   * contenant au plus une unité passive (voir BuilderFleet.kind, types.ts).
   */
  function handleAddStation(target: { teamClientId: string } | { newTeamName: string; nation: string }) {
    const teamClientId = ensureTeamForTarget(target);
    setTeams((prev) =>
      prev.map((t) =>
        t.clientId === teamClientId ? { ...t, fleets: [...t.fleets, { clientId: nextClientId("fleet"), name: "Station d'écoute", units: [], kind: "station" as const }] } : t
      )
    );
  }
  function handleUpdateAirbase(clientId: string, patch: Partial<BuilderAirbase>) {
    setAirbasesState((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, ...patch } : a)));
  }
  /** Détache (unités et escadrilles qui la référençaient retombent à "Aucune") plutôt que de bloquer — champ optionnel côté schéma. */
  function handleRemoveAirbase(clientId: string) {
    const removed = airbasesState.find((a) => a.clientId === clientId);
    setAirbasesState((prev) => prev.filter((a) => a.clientId !== clientId));
    if (!removed) return;
    setTeams((prev) => detachAircraftFromBase(prev, (baseRef) => baseRef.kind === "airbase" && baseRef.key === removed.key));
    setSquadronsState((prev) => prev.map((s) => (s.baseRef.kind === "airbase" && s.baseRef.key === removed.key ? { ...s, baseRef: { kind: "none" } } : s)));
    setSelection((prev) => (prev?.kind === "airbase" && prev.clientId === clientId ? null : prev));
  }

  /**
   * Détache les avions référençant `matches` (base/porte-avions/escadrille
   * supprimé) — `baseRef` retombe à "none". Une task force "Aviation"
   * cachée (Phase 4) qui se retrouve avec un avion ainsi orphelin repasse
   * en "normal" (Phase 5, retour utilisateur 2026-08-15) : sinon
   * l'utilisateur ne pourrait jamais la retrouver dans l'arbre pour gérer
   * cet avion désormais sans base — mieux vaut la révéler que la laisser
   * invisible avec du contenu orphelin.
   */
  function detachAircraftFromBase(teams: BuilderTeam[], matches: (baseRef: BaseRef) => boolean): BuilderTeam[] {
    return teams.map((t) => ({
      ...t,
      fleets: t.fleets.map((f) => {
        const units = f.units.map((u) => (matches(u.baseRef) ? { ...u, baseRef: { kind: "none" as const } } : u));
        const gotOrphaned = f.kind === "aviation" && units.some((u, i) => u.baseRef.kind === "none" && f.units[i].baseRef.kind !== "none");
        return { ...f, units, kind: gotOrphaned ? "normal" : f.kind };
      }),
    }));
  }

  /** Glisser-déposer d'un avion déjà en flotte vers une base aérienne (Phase 6, retour utilisateur 2026-08-14) — voir AirbasesPanel.tsx, dragDrop.ts. */
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

  /**
   * Renommer/supprimer une escadrille (Phase 6, retour utilisateur
   * 2026-08-15) — plus de création manuelle d'escadrille vide ni de
   * panneau `SquadronsPanel` séparé : une escadrille naît toujours d'un
   * ajout groupé (voir `addAircraftToBase`), et se gère ensuite depuis
   * l'arborescence (dépliant sa base/son porte-avions, TeamsBoard.tsx).
   */
  function handleUpdateSquadron(clientId: string, patch: Partial<BuilderSquadron>) {
    setSquadronsState((prev) => prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)));
  }
  function handleRemoveSquadron(clientId: string) {
    const removed = squadronsState.find((s) => s.clientId === clientId);
    setSquadronsState((prev) => prev.filter((s) => s.clientId !== clientId));
    if (!removed) return;
    setTeams((prev) => detachAircraftFromBase(prev, (baseRef) => baseRef.kind === "squadron" && baseRef.key === removed.key));
  }

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
          nation: t.nation,
          fleets: t.fleets.map((f) => ({ name: f.name, units: f.units.map(mapUnit) })),
        })
      ),
      airbases:
        airbasesState.length > 0
          ? airbasesState.map((a) => ({
              key: a.key,
              name: a.name,
              lat: Number(a.lat) || 0,
              lng: Number(a.lng) || 0,
              teamName: teams.find((t) => t.clientId === a.teamClientId)?.name,
            }))
          : undefined,
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
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">{duplicateFrom ? `Dupliquer « ${duplicateFrom.name} »` : "Créer un scénario"}</h1>
          <p className="text-xs text-slate-500">{name || "Sans nom"}{key && ` — ${key}`}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMetaTab("info")}
            className="rounded-md px-3 py-1.5 text-slate-300 hover:bg-slate-900"
          >
            Infos générales
          </button>
          <button
            type="button"
            onClick={() => setMetaTab("weather")}
            className="rounded-md px-3 py-1.5 text-slate-300 hover:bg-slate-900"
          >
            Météo
          </button>
          <button
            type="button"
            onClick={() => setMetaTab("objectives")}
            className="rounded-md px-3 py-1.5 text-slate-300 hover:bg-slate-900"
          >
            Objectifs
          </button>
          <Link href="/create" className="ml-1 flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-900">
            ← Retour
          </Link>
          <button
            onClick={save}
            disabled={!definition || isPending}
            className="ml-1 rounded-md bg-brass-600 px-4 py-1.5 font-medium hover:bg-brass-500 disabled:opacity-50"
          >
            {isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </nav>
      </header>

      {(validationIssues.length > 0 || saveError) && (
        <div className="border-b border-red-900 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">
          {saveError ?? `${validationIssues.length} problème(s) avant enregistrement — ${validationIssues[0]}${validationIssues.length > 1 ? ` (+${validationIssues.length - 1} autre(s), voir Infos générales/Météo/Objectifs)` : ""}`}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className={`shrink-0 overflow-y-auto border-r border-slate-800 transition-all ${leftOpen ? "w-80 space-y-4 p-3" : "w-0 p-0"}`}>
          {leftOpen && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Task forces &amp; bases</h2>
                <button onClick={() => setLeftOpen(false)} className="text-slate-600 hover:text-slate-400" title="Replier">
                  ◂
                </button>
              </div>
              <TeamsBoard
                teams={teams}
                setTeams={setTeams}
                airbases={airbasesState}
                squadrons={squadronsState}
                nextClientId={nextClientId}
                selectedUnitClientId={selection?.kind === "unit" ? selection.unitClientId : null}
                onSelectUnitForPlacement={selectUnitForPlacement}
                selectedFleetClientId={selection?.kind === "fleet" ? selection.fleetClientId : null}
                onSelectFleetForPlacement={selectFleetForPlacement}
                libraryClasses={libraryClasses}
                onAddUnitFromLibrary={handleAddUnitFromLibrary}
                onOpenAddContainer={() => setAddContainerModalOpen(true)}
                onOpenUnitWizard={(teamClientId, fleetClientId) => setUnitWizardFor({ teamClientId, fleetClientId })}
                onAddAirbaseForTeam={(teamClientId) => handleAddAirbase({ teamClientId })}
                onAddStationForTeam={(teamClientId) => handleAddStation({ teamClientId })}
                onUpdateAirbase={handleUpdateAirbase}
                onRemoveAirbase={handleRemoveAirbase}
                selectedAirbaseClientId={selection?.kind === "airbase" ? selection.clientId : null}
                onSelectAirbaseForPlacement={selectAirbaseForPlacement}
                onAssignAircraftToAirbase={(teamClientId, fleetClientId, unitClientId, airbaseKey) =>
                  handleAssignUnitBaseRef(teamClientId, fleetClientId, unitClientId, { kind: "airbase", key: airbaseKey })
                }
                onAddAircraftToAirbase={handleAddAircraftToAirbase}
                onOpenAircraftWizard={(teamClientId, airbaseKey) => setAircraftWizardFor({ teamClientId, target: { kind: "airbase", airbaseKey } })}
                onAddAircraftToCarrier={handleAddAircraftToCarrier}
                onOpenAircraftWizardForCarrier={(teamClientId, carrierUnitName) => setAircraftWizardFor({ teamClientId, target: { kind: "carrier", carrierUnitName } })}
                onUpdateSquadron={handleUpdateSquadron}
                onRemoveSquadron={handleRemoveSquadron}
              />
            </>
          )}
        </aside>
        {!leftOpen && (
          <button onClick={() => setLeftOpen(true)} className="w-5 shrink-0 border-r border-slate-800 text-slate-600 hover:bg-slate-900 hover:text-slate-400" title="Déplier les task forces">
            ▸
          </button>
        )}

        <main className="relative flex-1" onDragOver={allowDrop} onDrop={handleMapDrop}>
          <GameMap
            ref={gameMapRef}
            center={{ lat: mapCenterLat, lng: mapCenterLng }}
            zoom={mapDefaultZoom}
            sources={previewSources}
            fitToPoints={previewPoints}
            shipMarkers={shipMarkers}
            shipMarkersMinZoom={0}
            onClick={handleMapClick}
            className="h-full w-full"
          />

          <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-md border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-[11px] text-slate-400">
            Glissez ⚓/✈ une task force/base depuis le rail, ou cliquez son 🎯, puis cliquez la carte pour la positionner.
          </div>

          {(selectedUnit || selectedAirbase || selectedFleet) && (
            <div className="absolute bottom-4 left-4 max-w-xs rounded-md border border-slate-700 bg-slate-950/90 p-3 text-xs shadow-lg">
              <p className="font-medium text-brass-300">
                {selectedUnit
                  ? `Unité : ${selectedUnit.name}`
                  : selectedAirbase
                    ? `Base : ${selectedAirbase.name || selectedAirbase.key}`
                    : selectedFleet
                      ? `Task force : ${selectedFleet.name} (${selectedFleet.units.length} unité(s))`
                      : null}
              </p>
              <p className="mt-1 text-slate-500">Cliquez la carte pour choisir sa position.</p>
              {draftPosition && (
                <p className="mt-1 text-orange-400">
                  → {draftPosition.lat.toFixed(4)}, {draftPosition.lng.toFixed(4)}
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
          )}
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4">
          <LibraryBrowserPanel
            classes={libraryClasses}
            teams={teams}
            airbases={airbasesState}
            onAddUnit={handleAddUnitFromLibrary}
            onAddAircraftToAirbase={handleAddAircraftToAirbase}
            onAddAircraftToCarrier={handleAddAircraftToCarrier}
          />
        </aside>
      </div>

      {metaTab && (
        <ScenarioMetaModal
          initialTab={metaTab}
          onClose={() => setMetaTab(null)}
          validationIssues={validationIssues}
          name={name}
          updateName={updateName}
          keyValue={key}
          onKeyChange={(v) => {
            setKey(slugify(v));
            setKeyTouched(true);
          }}
          description={description}
          setDescription={setDescription}
          briefing={briefing}
          setBriefing={setBriefing}
          dateLabel={dateLabel}
          setDateLabel={setDateLabel}
          source={source}
          setSource={setSource}
          mapCenterLat={mapCenterLat}
          setMapCenterLat={setMapCenterLat}
          mapCenterLng={mapCenterLng}
          setMapCenterLng={setMapCenterLng}
          mapDefaultZoom={mapDefaultZoom}
          setMapDefaultZoom={setMapDefaultZoom}
          defaultTurnMinutes={defaultTurnMinutes}
          setDefaultTurnMinutes={setDefaultTurnMinutes}
          tacticalRoundMinutes={tacticalRoundMinutes}
          setTacticalRoundMinutes={setTacticalRoundMinutes}
          visibilityNm={visibilityNm}
          setVisibilityNm={setVisibilityNm}
          seaState={seaState}
          setSeaState={setSeaState}
          daylight={daylight}
          setDaylight={setDaylight}
          precipitation={precipitation}
          setPrecipitation={setPrecipitation}
          windKnots={windKnots}
          setWindKnots={setWindKnots}
          weatherNotes={weatherNotes}
          setWeatherNotes={setWeatherNotes}
          teams={teams}
          objectivesByTeamName={objectivesByTeamName}
          onChangeObjectiveText={(teamName, text) => setObjectivesByTeamName((prev) => ({ ...prev, [teamName]: text }))}
        />
      )}

      {addContainerModalOpen && (
        <AddContainerModal
          teams={teams}
          onClose={() => setAddContainerModalOpen(false)}
          onCreateFleet={handleCreateFleetContainer}
          onCreateAirbase={handleAddAirbase}
          onCreateStation={handleAddStation}
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
              nation={team.nation}
              onClose={() => setUnitWizardFor(null)}
              onPick={(libClass) => handleAddUnitFromLibrary(libClass, unitWizardFor.teamClientId, unitWizardFor.fleetClientId)}
            />
          );
        })()}

      {aircraftWizardFor &&
        (() => {
          const team = teams.find((t) => t.clientId === aircraftWizardFor.teamClientId);
          if (!team) return null;
          const { target } = aircraftWizardFor;
          if (target.kind === "airbase") {
            const airbase = airbasesState.find((a) => a.key === target.airbaseKey && a.teamClientId === aircraftWizardFor.teamClientId);
            if (!airbase) return null;
            return (
              <AddAircraftWizardModal
                targetLabel={`${team.name} / ${airbase.name || airbase.key}`}
                libraryClasses={libraryClasses}
                nation={team.nation}
                onClose={() => setAircraftWizardFor(null)}
                onPick={(libClass, quantity) => handleAddAircraftToAirbase(libClass, aircraftWizardFor.teamClientId, target.airbaseKey, quantity)}
              />
            );
          }
          return (
            <AddAircraftWizardModal
              targetLabel={`${team.name} / ${target.carrierUnitName}`}
              libraryClasses={libraryClasses}
              nation={team.nation}
              onClose={() => setAircraftWizardFor(null)}
              onPick={(libClass, quantity) => handleAddAircraftToCarrier(libClass, aircraftWizardFor.teamClientId, target.carrierUnitName, quantity)}
            />
          );
        })()}
    </div>
  );
}
