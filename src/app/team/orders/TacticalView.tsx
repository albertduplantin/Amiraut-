"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import { budgetCircleFeatureCollection, lineFeatureCollection, multiLineFeatureCollection, pointsFeatureCollection } from "@/lib/mapData";
import { clampPathToBudget, destinationPoint, pathLengthNm, speedBudgetNm, turnPenaltyNm, bearingDeg, type LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import {
  gunHitChancePercent,
  torpedoHitChancePercent,
  isInGunArc,
  isTorpedoArcClear,
  type CombatProfile,
} from "@/lib/combat";
import {
  submitMovementForUnitAction,
  finishMovementPhaseAction,
  submitFireShotAction,
  finishFirePhaseAction,
  sendBattleChatAction,
} from "./tacticalActions";

const NM_TO_M = 1852;

type OwnUnit = {
  id: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  combatProfile: CombatProfile | null;
  maxSpeedKnots: number;
  healthCurrent: number | null;
  healthMax: number | null;
  status: string;
  currentLat: number;
  currentLng: number;
  headingDeg: number | null;
  depthBand: string;
  lastSpeedKnots: number;
  turningRadiusM: number;
  accelerationKnotsPerMin: number;
  torpedoesRemaining: number | null;
  /** Pièces détruites (ex: "gun:1", "torpedo") — voir Unit.disabledWeaponSlots. */
  disabledWeaponSlots: string[];
  /** Vitesse max réduite par une avarie de machines (null = pas de plafond). */
  speedCapKnots: number | null;
  /** Gouvernail bloqué : ne peut plus manœuvrer, cap maintenu. */
  rudderJammed: boolean;
  /** Télépointage endommagé : pénalité de précision sur ses propres tirs. */
  fireControlDamaged: boolean;
  /** Silhouette de profil réelle, si renseignée pour cette classe (voir UnitClass.profileImageUrl). */
  profileImageUrl: string | null;
};

type Contact = {
  targetUnitId: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  beamMeters: number | null;
  maxSpeedKnots: number;
  distanceNm: number;
  bearingDeg: number;
  lat: number;
  lng: number;
  status: string;
  estimatedHeadingDeg: number | null;
  estimatedSpeedKnots: number | null;
  profileImageUrl: string | null;
};

/** Un tir par pièce : `weaponSlot` distingue "gun:0"/"gun:1"/... et "torpedo" — un navire peut faire tirer chacune séparément la même manche. */
type FireAction = {
  unitId: string;
  weaponSlot: string;
  targetUnitId: string | null;
  weaponType: string | null;
  hit: boolean | null;
  hits: number | null;
  damagePoints: number | null;
  hitChancePercent: number | null;
  /** Tirage au sort (0-100) : touché si en-dessous de `hitChancePercent`. */
  hitRoll: number | null;
  narrative: string | null;
};

type LogEntry = {
  roundNumber: number;
  targetUnitId: string | null;
  hit: boolean | null;
  hits: number | null;
  damagePoints: number | null;
  hitChancePercent: number | null;
  hitRoll: number | null;
  narrative: string | null;
};

type MovementAction = { unitId: string; speedKnots: number | null; movementPath: LatLng[] | null };

type BattleMessage = { id: string; kind: string; authorName: string; body: string; roundNumber: number };

type MovementDraft = { speedKnots: number; path: LatLng[] };

const ASSUMED_TARGET_SPEED_RATIO = 0.7;
const TORPEDO_SLOT = "torpedo";
const gunSlot = (index: number) => `gun:${index}`;

function weaponSlotsForShip(ship: OwnUnit): string[] {
  const guns = ship.combatProfile?.guns ?? [];
  const slots = guns.map((_, i) => gunSlot(i));
  const hasTorpedoes = ship.combatProfile?.torpedoTubes && (ship.torpedoesRemaining == null || ship.torpedoesRemaining > 0);
  if (hasTorpedoes) slots.push(TORPEDO_SLOT);
  return slots;
}

/** Pièces encore utilisables (hors avaries) — sert à compter "X/Y tiré" et à passer au navire suivant sans buter sur une pièce détruite. */
function activeWeaponSlotsForShip(ship: OwnUnit): string[] {
  return weaponSlotsForShip(ship).filter((s) => !ship.disabledWeaponSlots.includes(s));
}

/** Brouillon initial d'un navire : reprend ce qu'il a déjà validé cette manche (rechargement de page en cours de phase) si présent, sinon sa dernière vitesse connue et aucun trajet. */
function initialDraftFor(ship: OwnUnit, savedThisRound: MovementAction | undefined): MovementDraft {
  if (savedThisRound) {
    return { speedKnots: savedThisRound.speedKnots ?? ship.lastSpeedKnots, path: savedThisRound.movementPath ?? [] };
  }
  return { speedKnots: ship.lastSpeedKnots, path: [] };
}

export function TacticalView(props: {
  engagementId: string;
  status: string;
  roundNumber: number;
  roundMinutes: number;
  turnNumber: number;
  arbiterPaused: boolean;
  endReason: string | null;
  teamId: string;
  teams: { id: string; name: string }[];
  mapCenter: LatLng;
  mapZoom: number;
  submittedTeamIds: string[];
  ownUnits: OwnUnit[];
  contacts: Contact[];
  ownFireActionsThisRound: FireAction[];
  ownMovementActionsThisRound: MovementAction[];
  battleLog: LogEntry[];
  messages: BattleMessage[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chatBody, setChatBody] = useState("");
  const gameMapRef = useRef<GameMapHandle>(null);

  const livingOwnUnits = props.ownUnits.filter((u) => u.status !== "SUNK");
  const liveContacts = props.contacts.filter((c) => c.status !== "SUNK");

  const [selectedShipId, setSelectedShipId] = useState<string | null>(livingOwnUnits[0]?.id ?? null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedWeaponSlot, setSelectedWeaponSlot] = useState<string | null>(null);
  const [selectedTorpedoTypeId, setSelectedTorpedoTypeId] = useState<string | null>(null);
  const [pickingTarget, setPickingTarget] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Bascule joueur : projection en pointillé de la position future des contacts ennemis s'ils gardent cap/vitesse (phase de mouvement uniquement). */
  const [showEnemyProjection, setShowEnemyProjection] = useState(false);
  const [freshResults, setFreshResults] = useState<Record<string, FireAction>>({});
  /** Navires dont le mouvement vient d'être validé cette manche (retour instantané, avant que `router.refresh()` mette props.ownMovementActionsThisRound à jour). */
  const [freshSavedUnitIds, setFreshSavedUnitIds] = useState<Set<string>>(new Set());

  const savedMovementByUnit = useMemo(() => {
    const map: Record<string, MovementAction> = {};
    for (const a of props.ownMovementActionsThisRound) map[a.unitId] = a;
    return map;
  }, [props.ownMovementActionsThisRound]);

  const [movementDrafts, setMovementDrafts] = useState<Record<string, MovementDraft>>(() => {
    const init: Record<string, MovementDraft> = {};
    for (const u of props.ownUnits) init[u.id] = initialDraftFor(u, savedMovementByUnit[u.id]);
    return init;
  });

  // Le brouillon de mouvement et le cache local des tirs/validations
  // fraîchement soumis ne doivent survivre que le temps de LA manche où
  // ils ont été saisis — sans ça, l'état du navigateur reste figé sur la
  // manche précédente (vitesse redescendue à sa valeur de premier
  // chargement, navires marqués "déjà tiré"/"déjà positionné" à tort).
  // Ajusté pendant le rendu — même pattern que le reset de sélection
  // ci-dessous.
  const [roundKey, setRoundKey] = useState<number>(props.roundNumber);
  if (roundKey !== props.roundNumber) {
    setRoundKey(props.roundNumber);
    setFreshResults({});
    setFreshSavedUnitIds(new Set());
    setMovementDrafts(() => {
      const init: Record<string, MovementDraft> = {};
      for (const u of props.ownUnits) init[u.id] = initialDraftFor(u, savedMovementByUnit[u.id]);
      return init;
    });
  }

  const hasSubmittedThisPhase = props.submittedTeamIds.includes(props.teamId);
  const isMovementPhase = props.status === "AWAITING_MOVEMENT";

  /** Clé `unitId|weaponSlot` → résultat de tir, fusion des données serveur (manche en cours) et du cache local (juste validé, avant le prochain rafraîchissement). */
  const firedBySlot = useMemo(() => {
    const map: Record<string, FireAction> = {};
    for (const a of props.ownFireActionsThisRound) map[`${a.unitId}|${a.weaponSlot}`] = a;
    for (const [key, a] of Object.entries(freshResults)) map[key] = a;
    return map;
  }, [props.ownFireActionsThisRound, freshResults]);

  const unfiredShips = useMemo(
    () =>
      livingOwnUnits.filter((u) => {
        const slots = activeWeaponSlotsForShip(u);
        return slots.length > 0 && slots.some((s) => !firedBySlot[`${u.id}|${s}`]);
      }),
    [livingOwnUnits, firedBySlot]
  );

  const isShipPositioned = (unitId: string) => !!savedMovementByUnit[unitId] || freshSavedUnitIds.has(unitId);
  const unpositionedShips = useMemo(
    () => livingOwnUnits.filter((u) => !isShipPositioned(u.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [livingOwnUnits, savedMovementByUnit, freshSavedUnitIds]
  );

  // Rafraîchit automatiquement tant que le combat est en cours — pas
  // seulement en attente de l'autre camp : un coéquipier sur la même
  // équipe (plusieurs joueurs par camp) ou une intervention de l'arbitre
  // doivent aussi apparaître sans recharger manuellement.
  useEffect(() => {
    if (props.status === "RESOLVED") return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [props.status, router]);

  // Réinitialise la sélection de cible/arme quand on change de navire ou de
  // phase — ajusté pendant le rendu plutôt que dans un effet (pattern
  // recommandé par React pour "reset state on prop change").
  const [resetKey, setResetKey] = useState<string>(`${selectedShipId}|${isMovementPhase}`);
  const currentResetKey = `${selectedShipId}|${isMovementPhase}`;
  if (resetKey !== currentResetKey) {
    setResetKey(currentResetKey);
    setSelectedTargetId(null);
    setSelectedWeaponSlot(null);
    setPickingTarget(false);
  }

  const selectedShip = livingOwnUnits.find((u) => u.id === selectedShipId) ?? null;
  const selectedTarget = liveContacts.find((c) => c.targetUnitId === selectedTargetId) ?? null;

  const draft = selectedShip ? movementDrafts[selectedShip.id] : null;

  // Une avarie de machines (voir Unit.speedCapKnots, cas Scharnhorst au cap
  // Nord) plafonne la vitesse en dessous du maximum théorique de la classe.
  const effectiveMaxSpeedKnots = selectedShip
    ? selectedShip.speedCapKnots != null
      ? Math.min(selectedShip.maxSpeedKnots, selectedShip.speedCapKnots)
      : selectedShip.maxSpeedKnots
    : 0;

  // Accélération : la vitesse atteignable cette manche est plafonnée par
  // rapport à la vitesse précédente (recherche historique, voir prisma/seed.ts).
  const minSpeed = selectedShip ? Math.max(0, selectedShip.lastSpeedKnots - selectedShip.accelerationKnotsPerMin * props.roundMinutes) : 0;
  const maxSpeed = selectedShip
    ? Math.min(effectiveMaxSpeedKnots, selectedShip.lastSpeedKnots + selectedShip.accelerationKnotsPerMin * props.roundMinutes)
    : 0;

  // Budget de distance : la longueur du trajet PLUS la pénalité de virage
  // (arc de cercle équivalent au rayon de virage réel du navire — voir
  // geo.ts) compte contre le budget de la manche.
  const budgetNm = selectedShip && draft ? speedBudgetNm(draft.speedKnots, props.roundMinutes) : 0;
  const fullPath = selectedShip && draft ? [{ lat: selectedShip.currentLat, lng: selectedShip.currentLng }, ...draft.path] : [];
  const straightNm = selectedShip && draft ? pathLengthNm(fullPath) : 0;
  const turnNm = selectedShip && draft ? turnPenaltyNm(fullPath, selectedShip.turningRadiusM / NM_TO_M) : 0;
  const usedNm = straightNm + turnNm;
  const remainingNm = Math.max(0, budgetNm - usedNm);
  const lastPoint = useMemo(
    () =>
      selectedShip && draft
        ? (draft.path[draft.path.length - 1] ?? { lat: selectedShip.currentLat, lng: selectedShip.currentLng })
        : null,
    [selectedShip, draft]
  );

  function updateDraftSpeed(speedKnots: number) {
    if (!selectedShip) return;
    setMovementDrafts((prev) => {
      const budget = speedBudgetNm(speedKnots, props.roundMinutes);
      const clamped = clampPathToBudget([{ lat: selectedShip.currentLat, lng: selectedShip.currentLng }, ...prev[selectedShip.id].path], budget);
      return { ...prev, [selectedShip.id]: { speedKnots, path: clamped.slice(1) } };
    });
  }

  function clearDraftPath() {
    if (!selectedShip) return;
    setMovementDrafts((prev) => ({ ...prev, [selectedShip.id]: { ...prev[selectedShip.id], path: [] } }));
  }

  function handleMapClick(pos: LatLng) {
    if (!isMovementPhase || !selectedShip || !draft) return;
    if (selectedShip.rudderJammed) {
      setError("Gouvernail bloqué : la trajectoire ne peut plus être modifiée, seule la vitesse est réglable.");
      return;
    }
    const start = { lat: selectedShip.currentLat, lng: selectedShip.currentLng };
    const previous = draft.path[draft.path.length - 1] ?? start;
    const budget = speedBudgetNm(draft.speedKnots, props.roundMinutes);
    const clamped = clampPathToBudget([start, ...draft.path, pos], budget);
    const newPoint = clamped[clamped.length - 1];
    if (gameMapRef.current && !gameMapRef.current.isWaterSegment(previous, newPoint)) {
      setError("Trajet impossible : il traverserait la terre.");
      return;
    }
    setError(null);
    setMovementDrafts((prev) => ({ ...prev, [selectedShip.id]: { ...prev[selectedShip.id], path: clamped.slice(1) } }));
  }

  function handleMarkerClick(markerId: string) {
    if (markerId.startsWith("own-")) {
      setSelectedShipId(markerId.slice(4));
    } else if (markerId.startsWith("contact-")) {
      const targetId = markerId.slice(8);
      if (pickingTarget) {
        setSelectedTargetId(targetId);
        setPickingTarget(false);
      } else if (!isMovementPhase) {
        setSelectedTargetId(targetId);
      }
    }
  }

  function handleMarkerHover(id: string | null, pos: { x: number; y: number } | null) {
    setHover(id && pos ? { id, x: pos.x, y: pos.y } : null);
  }

  /** Valide le mouvement du navire sélectionné — rappelable pour changer d'avis tant que la phase n'est pas terminée. */
  function saveShipMovement() {
    if (!selectedShip) return;
    const shipId = selectedShip.id;
    setError(null);
    startTransition(async () => {
      const result = await submitMovementForUnitAction({
        engagementId: props.engagementId,
        unitId: shipId,
        speedKnots: movementDrafts[shipId]?.speedKnots ?? 0,
        path: movementDrafts[shipId]?.path ?? [],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFreshSavedUnitIds((prev) => new Set(prev).add(shipId));
      router.refresh();
    });
  }

  function finishMovement() {
    setError(null);
    startTransition(async () => {
      const result = await finishMovementPhaseAction({ engagementId: props.engagementId });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  /** Après un tir réussi : passe à la prochaine pièce non tirée du même navire (cible conservée), sinon au prochain navire n'ayant pas fini de tirer — le joueur reste libre d'en choisir un autre à tout moment. */
  function advanceAfterShot(ship: OwnUnit, firedSlot: string) {
    const remainingSlots = activeWeaponSlotsForShip(ship).filter((s) => s !== firedSlot && !firedBySlot[`${ship.id}|${s}`]);
    if (remainingSlots.length > 0) {
      setSelectedWeaponSlot(remainingSlots[0]);
      return;
    }
    const nextShip = unfiredShips.find((u) => u.id !== ship.id);
    if (nextShip) setSelectedShipId(nextShip.id);
    else {
      setSelectedWeaponSlot(null);
      setSelectedTargetId(null);
    }
  }

  function validateShot() {
    if (!selectedShip || !selectedTarget || !selectedWeaponSlot) return;
    const weaponType = selectedWeaponSlot === TORPEDO_SLOT ? "TORPEDO" : "GUN";
    setError(null);
    startTransition(async () => {
      const result = await submitFireShotAction({
        engagementId: props.engagementId,
        unitId: selectedShip.id,
        targetUnitId: selectedTarget.targetUnitId,
        weaponType,
        weaponSlot: selectedWeaponSlot,
        torpedoTypeId: weaponType === "TORPEDO" ? (selectedTorpedoTypeId ?? undefined) : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFreshResults((prev) => ({
        ...prev,
        [`${selectedShip.id}|${selectedWeaponSlot}`]: {
          unitId: selectedShip.id,
          weaponSlot: selectedWeaponSlot,
          targetUnitId: selectedTarget.targetUnitId,
          weaponType,
          hit: result.result.hit,
          hits: result.result.hits,
          damagePoints: result.result.damagePoints,
          hitChancePercent: result.result.hitChancePercent,
          hitRoll: result.result.hitRoll,
          narrative: result.result.narrative,
        },
      }));
      advanceAfterShot(selectedShip, selectedWeaponSlot);
      router.refresh();
    });
  }

  function finishFiring() {
    setError(null);
    startTransition(async () => {
      const result = await finishFirePhaseAction({ engagementId: props.engagementId });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function sendChat() {
    if (!chatBody.trim()) return;
    startTransition(async () => {
      await sendBattleChatAction({ engagementId: props.engagementId, body: chatBody });
      setChatBody("");
      router.refresh();
    });
  }

  const sources = useMemo<MapSourceConfig[]>(() => {
    const list: MapSourceConfig[] = [
      {
        id: "own-units",
        kind: "points",
        data: pointsFeatureCollection(livingOwnUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng, properties: { name: u.name } }))),
        color: "#38bdf8",
        radius: 5,
        showLabels: true,
        fadeAboveZoom: 8,
      },
      {
        id: "contacts",
        kind: "points",
        data: pointsFeatureCollection(liveContacts.map((c) => ({ lat: c.lat, lng: c.lng, properties: { name: c.className } }))),
        color: "#f97316",
        radius: 5,
        showLabels: true,
        fadeAboveZoom: 8,
      },
    ];

    if (selectedShip) {
      list.push({
        id: "highlight",
        kind: "points",
        data: pointsFeatureCollection([{ lat: selectedShip.currentLat, lng: selectedShip.currentLng, properties: {} }]),
        color: "#facc15",
        radius: 10,
      });
    }
    if (selectedTarget) {
      list.push({
        id: "highlight-target",
        kind: "points",
        data: pointsFeatureCollection([{ lat: selectedTarget.lat, lng: selectedTarget.lng, properties: {} }]),
        color: "#fbbf24",
        radius: 10,
      });
    }

    if (isMovementPhase && selectedShip && draft) {
      const start = { lat: selectedShip.currentLat, lng: selectedShip.currentLng };
      // Gouvernail bloqué : le trajet n'est plus dessiné par le joueur, on
      // prévisualise la ligne droite forcée que le serveur imposera (voir
      // submitTacticalMovementForUnit).
      const previewPath = selectedShip.rudderJammed
        ? [start, destinationPoint(start, selectedShip.headingDeg ?? 0, budgetNm)]
        : [start, ...draft.path];
      list.push({ id: "draft-path", kind: "line", data: lineFeatureCollection(previewPath), color: "#facc15", width: 3 });
      if (lastPoint && !selectedShip.rudderJammed) {
        list.push({
          id: "budget-ring",
          kind: "line",
          data: budgetCircleFeatureCollection(lastPoint, remainingNm),
          color: "#facc15",
          width: 1,
          dashed: true,
        });
      }
    }

    if (isMovementPhase && showEnemyProjection) {
      const projections = liveContacts
        .filter((c) => c.estimatedHeadingDeg != null && c.estimatedSpeedKnots != null)
        .map((c) => {
          const travelNm = speedBudgetNm(c.estimatedSpeedKnots!, props.roundMinutes);
          return [{ lat: c.lat, lng: c.lng }, destinationPoint({ lat: c.lat, lng: c.lng }, c.estimatedHeadingDeg!, travelNm)];
        });
      if (projections.length > 0) {
        list.push({ id: "enemy-projection", kind: "line", data: multiLineFeatureCollection(projections), color: "#f97316", width: 2, dashed: true });
      }
    }

    return list;
  }, [
    livingOwnUnits,
    liveContacts,
    selectedShip,
    selectedTarget,
    isMovementPhase,
    draft,
    lastPoint,
    remainingNm,
    budgetNm,
    showEnemyProjection,
    props.roundMinutes,
  ]);

  const shipMarkers = useMemo<ShipMarkerConfig[]>(() => {
    const own = livingOwnUnits.map((u) => {
      const silhouette = classifySilhouette(u.category, u.className);
      return {
        id: `own-${u.id}`,
        lat: u.currentLat,
        lng: u.currentLng,
        headingDeg: u.headingDeg ?? 0,
        color: u.id === selectedShipId ? "#facc15" : "#38bdf8",
        silhouette,
        lengthMeters: u.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
        status: u.status as "ACTIVE" | "DAMAGED" | "SUNK",
        speedKnots: u.lastSpeedKnots,
        referenceSpeedKnots: u.maxSpeedKnots,
      };
    });
    const enemies = liveContacts.map((c) => {
      const silhouette = classifySilhouette(c.category, c.className);
      return {
        id: `contact-${c.targetUnitId}`,
        lat: c.lat,
        lng: c.lng,
        headingDeg: c.estimatedHeadingDeg ?? 0,
        color: c.targetUnitId === selectedTargetId ? "#fbbf24" : "#f97316",
        silhouette,
        lengthMeters: c.lengthMeters ?? DEFAULT_LENGTH_METERS[silhouette],
        status: c.status as "ACTIVE" | "DAMAGED" | "SUNK",
        speedKnots: c.estimatedSpeedKnots ?? undefined,
        referenceSpeedKnots: c.maxSpeedKnots,
        vectorEstimated: true,
      };
    });
    return [...own, ...enemies];
  }, [livingOwnUnits, liveContacts, selectedShipId, selectedTargetId]);

  const fitPoints = [
    ...props.ownUnits.map((u) => ({ lat: u.currentLat, lng: u.currentLng })),
    ...props.contacts.map((c) => ({ lat: c.lat, lng: c.lng })),
  ];

  const hoveredOwn = hover?.id.startsWith("own-") ? livingOwnUnits.find((u) => u.id === hover.id.slice(4)) : null;
  const hoveredContact = hover?.id.startsWith("contact-") ? liveContacts.find((c) => c.targetUnitId === hover.id.slice(8)) : null;

  if (props.status === "RESOLVED") {
    return (
      <div className="chart-room-bg flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-slate-100">
        <h1 className="font-display text-2xl text-brass-300">Combat terminé</h1>
        <p className="text-slate-400">{formatEndReason(props.endReason)}</p>
        <button onClick={() => router.refresh()} className="rounded-md bg-brass-600 px-4 py-2 font-medium hover:bg-brass-500">
          Continuer
        </button>
      </div>
    );
  }

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">
            Tour {props.turnNumber} — Combat rapproché
            <span className="ml-2 text-xs font-normal text-slate-500">
              manche {props.roundNumber} · {formatDuration(props.roundMinutes)}
            </span>
          </h1>
          {props.arbiterPaused && <p className="text-xs text-amber-400">⏸ suspendu par l&apos;arbitre</p>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {props.teams.map((t) => (
            <span
              key={t.id}
              className={`rounded px-2 py-1 ${
                props.submittedTeamIds.includes(t.id) ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-800 text-slate-400"
              }`}
            >
              {t.name} {props.submittedTeamIds.includes(t.id) ? "✓ prêt" : "…"}
            </span>
          ))}
        </div>
      </header>

      <div
        className={`flex items-center gap-2 border-b px-4 py-2 text-sm font-medium ${
          isMovementPhase ? "border-sky-800 bg-sky-950/40 text-sky-200" : "border-red-800 bg-red-950/40 text-red-200"
        }`}
      >
        {isMovementPhase ? (
          <>
            <span className="text-base">🧭</span>
            <span>PHASE DE MOUVEMENT — tracez le trajet de chaque navire (cap et vitesse), puis validez.</span>
          </>
        ) : (
          <>
            <span className="text-base">🎯</span>
            <span>PHASE DE TIR — sélectionnez un navire, une arme, une cible, puis tirez. Chaque pièce peut tirer une fois.</span>
          </>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-800 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-400">Mes unités</h2>
          <ul className="mb-4 space-y-1">
            {livingOwnUnits.map((u) => {
              const slots = activeWeaponSlotsForShip(u);
              const firedCount = slots.filter((s) => firedBySlot[`${u.id}|${s}`]).length;
              return (
                <li key={u.id}>
                  <button
                    onClick={() => setSelectedShipId(u.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                      u.id === selectedShipId ? "bg-brass-900/50 ring-1 ring-brass-500" : "hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {u.name}
                        {u.status === "DAMAGED" && <span className="ml-1 text-amber-400">⚠</span>}
                        {(u.rudderJammed || u.speedCapKnots != null || u.fireControlDamaged || u.disabledWeaponSlots.length > 0) && (
                          <span className="ml-1 text-red-400" title="Avaries localisées">
                            🔧
                          </span>
                        )}
                      </span>
                      {!isMovementPhase && slots.length > 0 && (
                        <span className={firedCount === slots.length ? "text-emerald-400" : "text-slate-500"}>
                          {firedCount}/{slots.length} tiré
                        </span>
                      )}
                      {isMovementPhase &&
                        (isShipPositioned(u.id) ? (
                          <span className="text-emerald-400">✓ validé</span>
                        ) : (
                          (movementDrafts[u.id]?.path.length ?? 0) > 0 && <span className="text-slate-500">➜ brouillon</span>
                        ))}
                    </div>
                    <div className="text-slate-500">{u.className}</div>
                  </button>
                </li>
              );
            })}
          </ul>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-400">Contacts</h2>
          {liveContacts.length === 0 ? (
            <p className="text-xs text-slate-600">Aucun.</p>
          ) : (
            <ul className="space-y-1">
              {liveContacts.map((c) => (
                <li key={c.targetUnitId}>
                  <button
                    onClick={() => {
                      if (pickingTarget || !isMovementPhase) {
                        setSelectedTargetId(c.targetUnitId);
                        setPickingTarget(false);
                      }
                    }}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                      c.targetUnitId === selectedTargetId ? "bg-orange-950/60 ring-1 ring-orange-500" : "hover:bg-slate-900"
                    }`}
                  >
                    <div className="font-medium text-orange-200">{c.className}</div>
                    <div className="text-slate-500">
                      {c.distanceNm.toFixed(1)}nm, gis. {Math.round(c.bearingDeg)}°
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="relative flex-1">
          <GameMap
            ref={gameMapRef}
            center={props.mapCenter}
            zoom={props.mapZoom}
            sources={sources}
            onClick={handleMapClick}
            fitToPoints={fitPoints}
            shipMarkers={shipMarkers}
            onShipMarkerClick={handleMarkerClick}
            onShipMarkerHover={handleMarkerHover}
            shipMarkersMinZoom={0}
            showScaleAndRuler
            className="h-full w-full"
          />
          {isMovementPhase && liveContacts.length > 0 && (
            <button
              onClick={() => setShowEnemyProjection((v) => !v)}
              className={`absolute left-2 top-2 z-10 rounded-md border px-2 py-1 text-xs shadow-lg transition ${
                showEnemyProjection
                  ? "border-orange-400 bg-orange-500/90 text-slate-900"
                  : "border-slate-600 bg-slate-900/90 text-slate-200 hover:bg-slate-800"
              }`}
              title="Projette la position future des contacts ennemis s'ils gardent leur cap et leur vitesse actuels"
            >
              🧭 {showEnemyProjection ? "Projection active" : "Projeter les ennemis"}
            </button>
          )}
          {hover && (hoveredOwn || hoveredContact) && (
            <div
              className="pointer-events-none fixed z-20 max-w-xs rounded-md border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl"
              style={{ left: hover.x + 14, top: hover.y + 14 }}
            >
              {hoveredOwn && (
                <>
                  {hoveredOwn.profileImageUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- source externe (silhouette de profil), pas un asset local optimisable par next/image. */}
                      <img src={hoveredOwn.profileImageUrl} alt={hoveredOwn.className} className="mb-0.5 max-h-16 w-full object-contain" />
                      <div className="mb-1 text-right text-[9px] text-slate-600">silhouette : shipbucket.com (CC BY-NC 4.0)</div>
                    </>
                  )}
                  <div className="font-semibold text-sky-300">{hoveredOwn.name}</div>
                  <div className="text-slate-400">{hoveredOwn.className}</div>
                  {hoveredOwn.healthMax != null && (
                    <div className="mt-1 text-slate-300">
                      État : {hoveredOwn.status === "DAMAGED" ? "endommagé" : "actif"} — {Math.round(hoveredOwn.healthCurrent ?? 0)}/
                      {Math.round(hoveredOwn.healthMax)} pts
                    </div>
                  )}
                  <div className="text-slate-500">
                    Cap {Math.round(hoveredOwn.headingDeg ?? 0)}° · {hoveredOwn.lastSpeedKnots} nds (max {hoveredOwn.maxSpeedKnots})
                  </div>
                  {(hoveredOwn.disabledWeaponSlots.length > 0 || hoveredOwn.speedCapKnots != null || hoveredOwn.rudderJammed || hoveredOwn.fireControlDamaged) && (
                    <ul className="mt-1 space-y-0.5 text-red-400">
                      {hoveredOwn.disabledWeaponSlots.length > 0 && <li>✗ {hoveredOwn.disabledWeaponSlots.length} pièce(s) hors service</li>}
                      {hoveredOwn.speedCapKnots != null && <li>🔧 Vitesse max réduite à {Math.round(hoveredOwn.speedCapKnots)} nds</li>}
                      {hoveredOwn.rudderJammed && <li>⚠ Gouvernail bloqué</li>}
                      {hoveredOwn.fireControlDamaged && <li>⚠ Télépointage endommagé</li>}
                    </ul>
                  )}
                </>
              )}
              {hoveredContact && (
                <>
                  {hoveredContact.profileImageUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- source externe (silhouette de profil), pas un asset local optimisable par next/image. */}
                      <img src={hoveredContact.profileImageUrl} alt={hoveredContact.className} className="mb-0.5 max-h-16 w-full object-contain" />
                      <div className="mb-1 text-right text-[9px] text-slate-600">silhouette : shipbucket.com (CC BY-NC 4.0)</div>
                    </>
                  )}
                  <div className="font-semibold text-orange-300">{hoveredContact.className}</div>
                  <div className="text-slate-400">
                    {hoveredContact.distanceNm.toFixed(1)}nm, gis. {Math.round(hoveredContact.bearingDeg)}°
                  </div>
                  <div className="mt-1 text-slate-300">État (estimé) : {formatEnemyStatus(hoveredContact.status)}</div>
                  {hoveredContact.estimatedSpeedKnots != null && (
                    <div className="text-slate-500">
                      Cap/vitesse estimés : {Math.round(hoveredContact.estimatedHeadingDeg ?? 0)}° · ~{hoveredContact.estimatedSpeedKnots.toFixed(0)} nds
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 p-4 text-sm">
          {hasSubmittedThisPhase ? (
            <div className="mb-4 rounded-md border border-emerald-800 bg-emerald-950/20 p-4">
              <p className="text-emerald-300">Ordres soumis. En attente de l&apos;autre camp…</p>
              <p className="mt-1 text-xs text-slate-500">Cette page se rafraîchit toute seule.</p>
            </div>
          ) : props.arbiterPaused ? (
            <p className="rounded-md border border-amber-800 bg-amber-950/30 p-4 text-amber-200">
              L&apos;arbitre a suspendu le combat.
            </p>
          ) : selectedShip ? (
            isMovementPhase ? (
              <MovementDashboard
                ship={selectedShip}
                draft={draft!}
                budgetNm={budgetNm}
                straightNm={straightNm}
                turnNm={turnNm}
                remainingNm={remainingNm}
                roundMinutes={props.roundMinutes}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                positioned={isShipPositioned(selectedShip.id)}
                isPending={isPending}
                onSpeedChange={updateDraftSpeed}
                onClear={clearDraftPath}
                onSave={saveShipMovement}
              />
            ) : (
              <FireDashboard
                ship={selectedShip}
                target={selectedTarget}
                firedBySlot={firedBySlot}
                pickingTarget={pickingTarget}
                selectedWeaponSlot={selectedWeaponSlot}
                setSelectedWeaponSlot={setSelectedWeaponSlot}
                selectedTorpedoTypeId={selectedTorpedoTypeId}
                setSelectedTorpedoTypeId={setSelectedTorpedoTypeId}
                onStartPicking={() => setPickingTarget(true)}
                onValidate={validateShot}
                isPending={isPending}
              />
            )
          ) : (
            <p className="text-sm text-slate-500">Sélectionnez une unité.</p>
          )}

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          {!hasSubmittedThisPhase && !props.arbiterPaused && isMovementPhase && (
            <>
              {unpositionedShips.length > 0 && (
                <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                  {unpositionedShips.length === 1
                    ? `${unpositionedShips[0].name} n'a pas encore été positionné.`
                    : `${unpositionedShips.length} navires n'ont pas encore été positionnés : ${unpositionedShips.map((u) => u.name).join(", ")}.`}{" "}
                  Un navire non positionné garde sa position.
                </p>
              )}
              <button
                onClick={finishMovement}
                disabled={isPending}
                className="mt-3 w-full rounded-md bg-brass-600 px-3 py-2 font-medium hover:bg-brass-500 disabled:opacity-50"
              >
                {isPending ? "Envoi…" : "Terminer la phase de mouvement"}
              </button>
            </>
          )}
          {!hasSubmittedThisPhase && !props.arbiterPaused && !isMovementPhase && (
            <>
              {unfiredShips.length > 0 && (
                <p className="mt-3 rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                  {unfiredShips.length === 1
                    ? `${unfiredShips[0].name} n'a pas fini de tirer.`
                    : `${unfiredShips.length} navires n'ont pas fini de tirer : ${unfiredShips.map((u) => u.name).join(", ")}.`}{" "}
                  Vous pouvez garder le feu volontairement.
                </p>
              )}
              <button
                onClick={finishFiring}
                disabled={isPending}
                className="mt-3 w-full rounded-md bg-red-800 px-3 py-2 font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "Envoi…" : "Mettre fin à la phase de tir"}
              </button>
            </>
          )}

          {props.battleLog.length > 0 && (
            <div className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Journal de combat</h2>
              <ul className="space-y-2">
                {props.battleLog
                  .filter((a) => a.narrative)
                  .map((a, i) => (
                    <li key={i} className={`rounded-md px-3 py-2 text-xs ${a.hit ? "bg-red-950/40" : "bg-slate-800/60"}`}>
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">Manche {a.roundNumber}</div>
                      {a.narrative}
                      {a.hitRoll !== null && a.hitChancePercent !== null && (
                        <div className="mt-1 text-slate-500">
                          Jet : {a.hitRoll.toFixed(1)} (seuil {a.hitChancePercent.toFixed(0)}%)
                        </div>
                      )}
                      {a.hit && (
                        <div className="mt-1 text-slate-400">
                          {a.hits} impact{(a.hits ?? 0) > 1 ? "s" : ""} · {a.damagePoints?.toFixed(1)} pts
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Communications</h2>
            <div className="mb-2 max-h-32 space-y-1 overflow-y-auto text-xs">
              {props.messages.length === 0 && <p className="text-slate-600">Aucun message.</p>}
              {props.messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded px-2 py-1 ${
                    m.kind === "ARBITER_EVENT" ? "bg-orange-950/40 text-orange-200" : m.kind === "SYSTEM" ? "bg-slate-800/60 text-slate-400" : "bg-slate-800 text-slate-200"
                  }`}
                >
                  <span className="font-medium">{m.authorName}</span> (T{m.roundNumber}) : {m.body}
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={chatBody}
                onChange={(e) => setChatBody(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Message…"
                className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
              <button onClick={sendChat} className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
                Envoyer
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MovementDashboard({
  ship,
  draft,
  budgetNm,
  straightNm,
  turnNm,
  remainingNm,
  roundMinutes,
  minSpeed,
  maxSpeed,
  positioned,
  isPending,
  onSpeedChange,
  onClear,
  onSave,
}: {
  ship: OwnUnit;
  draft: MovementDraft;
  budgetNm: number;
  straightNm: number;
  turnNm: number;
  remainingNm: number;
  roundMinutes: number;
  minSpeed: number;
  maxSpeed: number;
  positioned: boolean;
  isPending: boolean;
  onSpeedChange: (speed: number) => void;
  onClear: () => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 font-semibold">
          {ship.name}
          {positioned && <span className="text-xs font-normal text-emerald-400">✓ validé</span>}
        </h2>
        <p className="text-xs text-slate-500">{ship.className}</p>
      </div>
      <HealthBar unit={ship} />
      {ship.rudderJammed && (
        <p className="rounded-md border border-red-800 bg-red-950/30 px-2 py-1 text-xs text-red-300">
          ⚠ Gouvernail bloqué — cap maintenu au {Math.round(ship.headingDeg ?? 0)}°, seule la vitesse est réglable.
        </p>
      )}
      <label className="block text-xs">
        Vitesse : {draft.speedKnots} nds (dernière manche {ship.lastSpeedKnots} nds)
        <input
          type="range"
          min={Math.round(minSpeed)}
          max={Math.round(maxSpeed)}
          value={draft.speedKnots}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="mt-1 w-full"
        />
        <div className="mt-0.5 text-[11px] text-slate-500">
          Atteignable cette manche : {Math.round(minSpeed)}-{Math.round(maxSpeed)} nds (accélération max {ship.accelerationKnotsPerMin.toFixed(1)}
          nds/min, max navire {ship.maxSpeedKnots} nds{ship.speedCapKnots != null ? `, réduit à ${Math.round(ship.speedCapKnots)} nds par avarie` : ""})
        </div>
      </label>
      <div className="rounded-md bg-slate-900 p-3 text-xs">
        <div>Budget cette manche : {budgetNm.toFixed(2)} nm ({formatDuration(roundMinutes)})</div>
        <div>Trajet : {straightNm.toFixed(2)} nm</div>
        {turnNm > 0.01 && <div>Manœuvre (virages) : {turnNm.toFixed(2)} nm</div>}
        <div>Restant : {remainingNm.toFixed(2)} nm</div>
      </div>
      {!ship.rudderJammed && <p className="text-xs text-slate-500">Cliquez sur la carte pour tracer le trajet de cette manche.</p>}
      <div className="flex gap-2">
        {!ship.rudderJammed && (
          <button onClick={onClear} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
            Effacer le trajet
          </button>
        )}
        <button
          onClick={onSave}
          disabled={isPending}
          className="flex-1 rounded-md bg-brass-600 px-3 py-1.5 text-xs font-medium hover:bg-brass-500 disabled:opacity-50"
        >
          {isPending ? "Envoi…" : positioned ? "Revalider ce navire" : "Valider le mouvement de ce navire"}
        </button>
      </div>
    </div>
  );
}

function FireDashboard({
  ship,
  target,
  firedBySlot,
  pickingTarget,
  selectedWeaponSlot,
  setSelectedWeaponSlot,
  selectedTorpedoTypeId,
  setSelectedTorpedoTypeId,
  onStartPicking,
  onValidate,
  isPending,
}: {
  ship: OwnUnit;
  target: Contact | null;
  firedBySlot: Record<string, FireAction>;
  pickingTarget: boolean;
  selectedWeaponSlot: string | null;
  setSelectedWeaponSlot: (slot: string | null) => void;
  selectedTorpedoTypeId: string | null;
  setSelectedTorpedoTypeId: (id: string | null) => void;
  onStartPicking: () => void;
  onValidate: () => void;
  isPending: boolean;
}) {
  const relativeBearing = useMemo(() => {
    if (!target) return null;
    return bearingDeg({ lat: ship.currentLat, lng: ship.currentLng }, { lat: target.lat, lng: target.lng }) - (ship.headingDeg ?? 0);
  }, [ship, target]);

  const rangeM = target ? target.distanceNm * NM_TO_M : null;
  const allGuns = useMemo(() => ship.combatProfile?.guns ?? [], [ship.combatProfile]);
  const torpedoTypes = ship.combatProfile?.torpedoTypes ?? null;
  const torpedoBattery = ship.combatProfile?.torpedoTubes ?? null;
  const torpedoInArc = torpedoBattery && relativeBearing !== null ? isTorpedoArcClear(torpedoBattery, relativeBearing) : null;
  const torpedoInRange = torpedoBattery && rangeM !== null ? rangeM <= torpedoBattery.rangeM : null;
  const outOfTorpedoes = ship.torpedoesRemaining != null && ship.torpedoesRemaining <= 0;
  const torpedoFired = !!firedBySlot[`${ship.id}|${TORPEDO_SLOT}`];

  const estimate = useMemo(() => {
    if (!target || rangeM === null || !selectedWeaponSlot) return null;
    const targetLengthM = target.lengthMeters ?? 100;
    const targetBeamM = target.beamMeters ?? 12;
    const assumedSpeed = target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO;

    if (selectedWeaponSlot === TORPEDO_SLOT && torpedoBattery) {
      if (torpedoInRange === false || torpedoInArc === false) return null;
      const type = torpedoTypes?.find((t) => t.id === selectedTorpedoTypeId);
      return torpedoHitChancePercent({
        rangeM,
        maxRangeM: type?.rangeM ?? torpedoBattery.rangeM,
        torpedoSpeedKnots: type?.speedKnots ?? torpedoBattery.speedKnots,
        targetLengthM,
        targetBeamM,
        targetSpeedKnots: assumedSpeed,
        angleOfAttackDeg: 45,
      });
    }
    const gunIndex = selectedWeaponSlot.startsWith("gun:") ? Number(selectedWeaponSlot.slice(4)) : null;
    const battery = gunIndex !== null ? allGuns[gunIndex] : undefined;
    if (battery) {
      const inRange = battery.rangeM >= rangeM;
      const inArc = isInGunArc(battery.arc, relativeBearing ?? 0);
      if (!inRange || !inArc) return null; // hors de portée/arc : pas la peine d'afficher un chiffre trompeur
      return gunHitChancePercent({
        calibreMm: battery.calibreMm,
        rangeM,
        maxRangeM: battery.rangeM,
        targetLengthM,
        targetBeamM,
        targetSpeedKnots: assumedSpeed,
      });
    }
    return null;
  }, [target, rangeM, selectedWeaponSlot, allGuns, torpedoBattery, torpedoTypes, selectedTorpedoTypeId, torpedoInRange, torpedoInArc, relativeBearing]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center font-semibold">
          <StepBadge n={1} state="done" />
          {ship.name}
        </h2>
        <p className="pl-5 text-xs text-slate-500">{ship.className} — navire tireur</p>
      </div>
      <HealthBar unit={ship} />
      {ship.category === "SUBMARINE" && <p className="text-xs text-slate-500">Immersion : {formatDepthBand(ship.depthBand)}</p>}
      {ship.fireControlDamaged && (
        <p className="rounded-md border border-red-800 bg-red-950/30 px-2 py-1 text-xs text-red-300">
          ⚠ Télépointage endommagé — précision réduite sur tous les tirs.
        </p>
      )}

      <div>
        <h3 className="mb-1 flex items-center text-xs font-semibold text-slate-300">
          <StepBadge n={2} state={selectedWeaponSlot ? "done" : "active"} />
          Choisissez une arme
        </h3>
        <ul className="space-y-1">
          {allGuns.map((g, i) => {
            const slot = gunSlot(i);
            const fired = firedBySlot[`${ship.id}|${slot}`];
            const usable = target ? g.rangeM >= rangeM! && isInGunArc(g.arc, relativeBearing ?? 0) : true;
            if (ship.disabledWeaponSlots.includes(slot)) {
              return (
                <li key={i} className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>
                      Canon {g.calibreMm}mm ×{g.count} ({formatArc(g.arc)})
                    </span>
                    <span className="text-red-500">✗ hors service</span>
                  </div>
                </li>
              );
            }
            if (fired) {
              return (
                <li key={i} className={`rounded-md border px-2 py-1.5 text-xs ${fired.hit ? "border-red-800 bg-red-950/30" : "border-slate-700 bg-slate-900"}`}>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>
                      Canon {g.calibreMm}mm ×{g.count} ({formatArc(g.arc)})
                    </span>
                    <span className="text-emerald-400">✓ tiré</span>
                  </div>
                  {fired.hitRoll !== null && fired.hitChancePercent !== null && (
                    <div className="mt-1 text-slate-500">
                      Jet : {fired.hitRoll.toFixed(1)} (seuil {fired.hitChancePercent.toFixed(0)}%)
                    </div>
                  )}
                  {fired.narrative && <div className="mt-1 text-slate-300">{fired.narrative}</div>}
                </li>
              );
            }
            return (
              <li key={i}>
                <button
                  onClick={() => setSelectedWeaponSlot(slot)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                    selectedWeaponSlot === slot
                      ? "bg-brass-900/50 ring-1 ring-brass-500"
                      : usable
                        ? "border border-slate-700 hover:bg-slate-800"
                        : "cursor-not-allowed border border-slate-800 opacity-40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>
                      Canon {g.calibreMm}mm ×{g.count} ({formatArc(g.arc)})
                    </span>
                    <span className="text-slate-500">{g.roundsPerMinute} c/min</span>
                  </div>
                  {target && !usable && (
                    <div className="text-[11px] text-amber-400">{rangeM !== null && g.rangeM < rangeM ? "hors de portée" : "hors arc de tir"}</div>
                  )}
                </button>
              </li>
            );
          })}
          {torpedoBattery && ship.disabledWeaponSlots.includes(TORPEDO_SLOT) && (
            <li className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <span>Torpilles ({formatArc(torpedoBattery.arc ?? "BROADSIDE")})</span>
                <span className="text-red-500">✗ hors service</span>
              </div>
            </li>
          )}
          {torpedoBattery && !ship.disabledWeaponSlots.includes(TORPEDO_SLOT) && torpedoFired && (
            <li className={`rounded-md border px-2 py-1.5 text-xs ${firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.hit ? "border-red-800 bg-red-950/30" : "border-slate-700 bg-slate-900"}`}>
              <div className="flex items-center justify-between text-slate-400">
                <span>Torpilles ({formatArc(torpedoBattery.arc ?? "BROADSIDE")})</span>
                <span className="text-emerald-400">✓ tiré</span>
              </div>
              {firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.hitRoll !== null && firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.hitChancePercent !== null && (
                <div className="mt-1 text-slate-500">
                  Jet : {firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.hitRoll?.toFixed(1)} (seuil{" "}
                  {firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.hitChancePercent?.toFixed(0)}%)
                </div>
              )}
              {firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.narrative && (
                <div className="mt-1 text-slate-300">{firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.narrative}</div>
              )}
            </li>
          )}
          {torpedoBattery && !ship.disabledWeaponSlots.includes(TORPEDO_SLOT) && !torpedoFired && (
            <li>
              <button
                onClick={() => setSelectedWeaponSlot(TORPEDO_SLOT)}
                disabled={outOfTorpedoes}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                  selectedWeaponSlot === TORPEDO_SLOT
                    ? "bg-brass-900/50 ring-1 ring-brass-500"
                    : outOfTorpedoes
                      ? "cursor-not-allowed opacity-40"
                      : "border border-slate-700 hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Torpilles ({formatArc(torpedoBattery.arc ?? "BROADSIDE")})</span>
                  {ship.torpedoesRemaining != null && <span className="text-slate-500">{ship.torpedoesRemaining} restantes</span>}
                </div>
                {target && !outOfTorpedoes && torpedoInRange === false && <div className="text-[11px] text-amber-400">hors de portée</div>}
                {target && !outOfTorpedoes && torpedoInRange !== false && torpedoInArc === false && (
                  <div className="text-[11px] text-amber-400">hors arc de tir</div>
                )}
              </button>
            </li>
          )}
          {allGuns.length === 0 && !torpedoBattery && <li className="text-xs text-slate-600">Aucune arme.</li>}
        </ul>
      </div>

      {selectedWeaponSlot === TORPEDO_SLOT && torpedoTypes && torpedoTypes.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-400">Type de torpille</div>
          {torpedoTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTorpedoTypeId(t.id)}
              className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                selectedTorpedoTypeId === t.id ? "bg-brass-900/50 ring-1 ring-brass-500" : "border border-slate-700 hover:bg-slate-800"
              }`}
            >
              {t.label} — {t.speedKnots}nds, {(t.rangeM / 1000).toFixed(1)}km, {t.wakeVisible ? "sillage visible" : "sans sillage"}
            </button>
          ))}
        </div>
      )}

      <div className={selectedWeaponSlot === null ? "pointer-events-none opacity-40" : ""}>
        <h3 className="mb-1 flex items-center text-xs font-semibold text-slate-300">
          <StepBadge n={3} state={target ? "done" : selectedWeaponSlot !== null ? "active" : "upcoming"} />
          Choisissez une cible
        </h3>
        {!target ? (
          <button
            onClick={onStartPicking}
            disabled={selectedWeaponSlot === null}
            className={`w-full rounded-md px-3 py-2 text-sm font-medium transition ${
              pickingTarget ? "bg-orange-800 hover:bg-orange-700" : "bg-slate-700 hover:bg-slate-600"
            }`}
          >
            {pickingTarget ? "Cliquez une cible sur la carte ou dans la liste…" : "Sélectionner une cible"}
          </button>
        ) : (
          <div className="rounded-md bg-slate-950/60 p-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                Cible : {target.className} — {target.distanceNm.toFixed(1)}nm, gis. {Math.round(target.bearingDeg)}°
              </div>
              <button onClick={onStartPicking} className="text-slate-400 underline hover:text-slate-200">
                changer
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={!target || selectedWeaponSlot === null ? "pointer-events-none opacity-40" : ""}>
        <h3 className="mb-1 flex items-center text-xs font-semibold text-slate-300">
          <StepBadge n={4} state={target && selectedWeaponSlot !== null ? "active" : "upcoming"} />
          Tirez
        </h3>
        {target && selectedWeaponSlot !== null && (
          <div className="rounded-md bg-slate-950/60 p-2 text-xs">
            {estimate !== null ? <div>Chance de toucher : ~{estimate.toFixed(0)}%</div> : <div className="text-amber-400">Ce tir n&apos;est pas possible.</div>}
            <button
              onClick={onValidate}
              disabled={estimate === null || isPending}
              className="mt-2 w-full rounded-md bg-red-800 px-2 py-1.5 text-sm font-medium hover:bg-red-700 disabled:opacity-40"
            >
              {isPending ? "Envoi…" : "Tirer !"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Puce numérotée du guide pas-à-pas (tireur → arme → cible → tir) : verte une fois franchie, dorée pour l'étape en cours, grise pour ce qui n'est pas encore accessible. */
function StepBadge({ n, state }: { n: number; state: "done" | "active" | "upcoming" }) {
  return (
    <span
      className={`mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
        state === "done" ? "bg-emerald-600 text-white" : state === "active" ? "bg-brass-500 text-slate-900" : "bg-slate-700 text-slate-500"
      }`}
    >
      {state === "done" ? "✓" : n}
    </span>
  );
}

function HealthBar({ unit }: { unit: OwnUnit }) {
  const ratio = unit.healthMax && unit.healthMax > 0 ? Math.max(0, Math.min(1, (unit.healthCurrent ?? 0) / unit.healthMax)) : null;
  if (ratio === null) return null;
  return (
    <div className="rounded-md bg-slate-900 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className={unit.status === "DAMAGED" ? "text-amber-400" : "text-slate-400"}>
          {unit.status === "DAMAGED" ? "Endommagé" : "État"}
        </span>
        <span className="text-slate-500">
          {Math.round(unit.healthCurrent ?? 0)} / {Math.round(unit.healthMax ?? 0)} pts
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${ratio < 0.6 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function formatArc(arc: string) {
  switch (arc) {
    case "FORWARD":
      return "avant";
    case "AFT":
      return "arrière";
    case "ALL_ROUND":
      return "tout azimut";
    case "BROADSIDE":
      return "travers";
    default:
      return arc;
  }
}

function formatDuration(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
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

function formatEnemyStatus(status: string) {
  switch (status) {
    case "DAMAGED":
      return "endommagé";
    case "SUNK":
      return "coulé";
    default:
      return "actif";
  }
}

function formatEndReason(reason: string | null) {
  switch (reason) {
    case "ALL_ENEMIES_SUNK":
      return "L'adversaire a été anéanti ou s'est retiré.";
    case "CONTACT_LOST":
      return "Le contact a été rompu.";
    case "OUT_OF_AMMUNITION":
      return "Plus aucun camp n'a de quoi tirer.";
    case "ARBITER_ENDED":
      return "L'arbitre a mis fin au combat.";
    case "DISENGAGED":
      return "Rupture de contact volontaire.";
    default:
      return "Combat terminé.";
  }
}
