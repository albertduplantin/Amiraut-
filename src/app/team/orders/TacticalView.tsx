"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GameMap, type GameMapHandle, type MapSourceConfig, type ShipMarkerConfig } from "@/components/GameMap";
import {
  budgetCircleFeatureCollection,
  lineFeatureCollection,
  multiLineFeatureCollection,
  multiLineFeatureCollectionColored,
  pointsFeatureCollection,
} from "@/lib/mapData";
import { clampPathToBudget, destinationPoint, pathLengthNm, speedBudgetNm, turnPenaltyNm, bearingDeg, filletPath, type LatLng } from "@/lib/geo";
import { classifySilhouette, DEFAULT_LENGTH_METERS } from "@/lib/shipSilhouettes";
import {
  gunHitChancePercent,
  torpedoHitChancePercent,
  bombHitChancePercent,
  airCombatHitChancePercent,
  strafingHitChancePercent,
  depthChargeHitChancePercent,
  hedgehogHitChancePercent,
  isInGunArc,
  isTorpedoArcClear,
  DEPTH_CHARGES_PER_ATTACK,
  HEDGEHOG_ROUNDS_PER_ATTACK,
  ASDIC_ATTACK_RANGE_M,
  type CombatProfile,
} from "@/lib/combat";
import {
  submitMovementForUnitAction,
  finishMovementPhaseAction,
  submitFireShotAction,
  finishFirePhaseAction,
  sendBattleChatAction,
  fireTorpedoSalvoAction,
} from "./tacticalActions";
import { SunkShipModal, type SunkShipInfo } from "./SunkShipModal";

const NM_TO_M = 1852;

/** Bruits de départ de coup de canon, alternés à chaque tir — voir playGunSound. */
const GUN_SOUND_URLS = [
  "/sounds/guns/gun-01.mp3",
  "/sounds/guns/gun-02.mp3",
  "/sounds/guns/gun-03.mp3",
  "/sounds/guns/gun-04.mp3",
  "/sounds/guns/gun-05.mp3",
];

/** Bruit de lancement de torpille — voir playTorpedoSound. */
const TORPEDO_SOUND_URL = "/sounds/torpedo.wav";

/**
 * Sillage qui s'estompe avec l'âge : une seule teinte claire (écume plutôt
 * que trait sombre), l'opacité et l'épaisseur diminuant à chaque manche de
 * plus en plus ancienne jusqu'à disparaître — TRAIL_STEPS segments maximum.
 */
const TRAIL_COLOR = "#e0f2fe";
const TRAIL_STEPS = 4;

/** Découpe un historique de positions (le plus ancien en premier) en segments consécutifs, du plus récent au plus ancien, opacité/épaisseur dégressives — au plus TRAIL_STEPS segments. */
function buildTrailSegments(trail: LatLng[]): { points: LatLng[]; color: string; opacity: number; width: number }[] {
  const segments: { points: LatLng[]; color: string; opacity: number; width: number }[] = [];
  for (let i = trail.length - 1; i > 0 && segments.length < TRAIL_STEPS; i--) {
    const age = segments.length; // 0 = le plus récent
    const t = age / (TRAIL_STEPS - 1); // 0 (récent) .. 1 (le plus ancien affiché)
    segments.push({
      points: [trail[i - 1], trail[i]],
      color: TRAIL_COLOR,
      opacity: 0.8 - t * 0.65,
      width: 3 - t * 1.6,
    });
  }
  return segments;
}

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
  /** Grenades ASM restantes (escorteurs équipés seulement, null sinon) — voir Unit.depthChargesRemaining. */
  depthChargesRemaining: number | null;
  /** Salves de Hedgehog restantes (escorteurs équipés seulement, null sinon) — voir Unit.hedgehogRoundsRemaining. */
  hedgehogRoundsRemaining: number | null;
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
  /** Maniabilité en combat air-air (avions uniquement) — voir UnitClass.agility. */
  agility: number | null;
  /** A déjà tiré une salve de torpilles cette manche (navires/sous-marins) — voir TacticalTorpedoSalvo. */
  firedTorpedoSalvoThisRound: boolean;
  /** Salves tirées lors de manches précédentes, toujours en transit (ni touché, ni portée dépassée). */
  inTransitTorpedoSalvoCount: number;
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
  agility: number | null;
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
  /** Détail des calculs (précision + tirage de localisation), affiché en repli — à des fins de débogage. */
  debugInfo: string | null;
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
  debugInfo: string | null;
};

type MovementAction = { unitId: string; speedKnots: number | null; movementPath: LatLng[] | null; depthBand: string | null };

type BattleMessage = { id: string; kind: string; authorName: string; body: string; roundNumber: number };

/** Un seul cran par manche (même règle qu'en tour stratégique) — voir tacticalEngine.ts::isAdjacentDepthBand. */
const DEPTH_BAND_ORDER = ["SURFACE", "SHALLOW", "MEDIUM", "DEEP"] as const;
type DepthBandKey = (typeof DEPTH_BAND_ORDER)[number];

/**
 * Pas de vitesse dans le brouillon : elle est déduite de la longueur du
 * trajet, pas choisie séparément. `depthBand` (sous-marins uniquement) :
 * `null` = pas de changement d'immersion choisi cette manche, garde le
 * palier actuel — même convention que l'écran d'ordres stratégique
 * (OrdersClient.tsx), pour que "Effectuer un changement" reste un geste
 * explicite plutôt qu'une valeur par défaut ambiguë.
 */
type MovementDraft = { path: LatLng[]; depthBand: DepthBandKey | null };

const ASSUMED_TARGET_SPEED_RATIO = 0.7;
const TORPEDO_SLOT = "torpedo";
const BOMB_SLOT = "bomb";
const DEPTH_CHARGE_SLOT = "depth_charge";
const HEDGEHOG_SLOT = "hedgehog";
const gunSlot = (index: number) => `gun:${index}`;

function weaponSlotsForShip(ship: OwnUnit): string[] {
  const guns = ship.combatProfile?.guns ?? [];
  const slots = guns.map((_, i) => gunSlot(i));
  // Torpille d'AVION seulement ici : les torpilles de navire/sous-marin se
  // tirent désormais en phase de mouvement (voir la section "Torpilles" du
  // panneau de mouvement, plus bas) — une torpille met plusieurs minutes à
  // atteindre sa cible, la cible doit donc pouvoir esquiver en changeant de
  // cap après le lancement, ce qu'une résolution en phase de tir ne permet
  // jamais. Recherche 2026-08-14 (Paul Bois + Amirauté 2013 de F. Marlière).
  const hasTorpedoes =
    ship.category === "AIRCRAFT" &&
    ship.combatProfile?.torpedoTubes &&
    (ship.torpedoesRemaining == null || ship.torpedoesRemaining > 0);
  if (hasTorpedoes) slots.push(TORPEDO_SLOT);
  // Une seule passe de bombardement par engagement (pas de décompte de
  // munitions comme les torpilles) — reflète un avion qui largue toute sa
  // charge d'un coup plutôt que de garder des bombes en réserve.
  if (ship.combatProfile?.bombs) slots.push(BOMB_SLOT);
  // ASM : un escorteur équipé (depthChargesRemaining/hedgehogRoundsRemaining
  // non nul) garde la pièce dans sa liste même à sec — le bouton se
  // désactive plutôt que de disparaître, comme les torpilles.
  if (ship.depthChargesRemaining != null) slots.push(DEPTH_CHARGE_SLOT);
  if (ship.hedgehogRoundsRemaining != null) slots.push(HEDGEHOG_SLOT);
  return slots;
}

/** Pièces encore utilisables (hors avaries) — sert à compter "X/Y tiré" et à passer au navire suivant sans buter sur une pièce détruite. */
function activeWeaponSlotsForShip(ship: OwnUnit): string[] {
  return weaponSlotsForShip(ship).filter((s) => !ship.disabledWeaponSlots.includes(s));
}

/** Brouillon initial d'un navire : reprend le trajet (et l'immersion choisie) déjà validés cette manche (rechargement de page en cours de phase) si présents, sinon aucun trajet/changement. */
function initialDraftFor(savedThisRound: MovementAction | undefined): MovementDraft {
  return { path: savedThisRound?.movementPath ?? [], depthBand: (savedThisRound?.depthBand as DepthBandKey | null | undefined) ?? null };
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
  /** Sillage estompé (jusqu'à 4 points, donc 3 segments) des dernières manches — navires propres, positions certaines. */
  ownTrailByUnit: Record<string, LatLng[]>;
  /** Même principe pour les contacts ennemis, mais uniquement leurs positions relevées (jamais leur position réelle non détectée). */
  enemyTrailByTarget: Record<string, LatLng[]>;
  /** Salves de torpilles propres encore en transit (jamais celles de l'adversaire — brouillard de guerre) : trace dessinée sur la carte, voir la section "sources" ci-dessous. */
  ownInTransitSalvoes: { id: string; firedByUnitId: string; origin: LatLng; current: LatLng; headingDeg: number; speedKnots: number }[];
  battleLog: LogEntry[];
  messages: BattleMessage[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chatBody, setChatBody] = useState("");
  const gameMapRef = useRef<GameMapHandle>(null);
  const lastGunSoundIndexRef = useRef<number | null>(null);

  /** Joue un bruit de canon au hasard parmi GUN_SOUND_URLS, sans rejouer deux fois de suite le même. */
  function playGunSound() {
    if (GUN_SOUND_URLS.length === 0) return;
    let index = Math.floor(Math.random() * GUN_SOUND_URLS.length);
    if (GUN_SOUND_URLS.length > 1 && index === lastGunSoundIndexRef.current) {
      index = (index + 1) % GUN_SOUND_URLS.length;
    }
    lastGunSoundIndexRef.current = index;
    const audio = new Audio(GUN_SOUND_URLS[index]);
    audio.volume = 0.6;
    // Les navigateurs peuvent refuser la lecture (politique d'autoplay) : un
    // tir sans son n'est pas bloquant, on ignore silencieusement l'échec.
    audio.play().catch(() => {});
  }

  /** Joue le bruit de lancement de torpille. */
  function playTorpedoSound() {
    const audio = new Audio(TORPEDO_SOUND_URL);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  }

  const livingOwnUnits = props.ownUnits.filter((u) => u.status !== "SUNK");
  const liveContacts = props.contacts.filter((c) => c.status !== "SUNK");

  // Fenêtre surgissante "navire coulé" : détecte les transitions vers SUNK
  // d'un relevé de props au suivant (navire propre coulé par l'adversaire,
  // ou contact ennemi dont on apprend qu'il a coulé) plutôt que de dépendre
  // d'un champ spécifique dans le résultat de tir — couvre les deux sens
  // uniformément, y compris quand ce n'est pas nous qui avons tiré le coup
  // fatal. Ajustement de state pendant le rendu (comparaison à un relevé
  // précédent mémorisé), pas dans un effect : évite un aller-retour de
  // rendu supplémentaire pour une simple dérivation de props.
  const [prevStatusMap, setPrevStatusMap] = useState<Map<string, string> | null>(null);
  const [sunkQueue, setSunkQueue] = useState<SunkShipInfo[]>([]);
  const currentStatusMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of props.ownUnits) m.set(u.id, u.status);
    for (const c of props.contacts) m.set(`contact:${c.targetUnitId}`, c.status);
    return m;
  }, [props.ownUnits, props.contacts]);
  if (currentStatusMap !== prevStatusMap) {
    if (prevStatusMap) {
      const newlySunk: SunkShipInfo[] = [];
      for (const u of props.ownUnits) {
        if (prevStatusMap.get(u.id) && prevStatusMap.get(u.id) !== "SUNK" && u.status === "SUNK") {
          newlySunk.push({ id: u.id, name: u.name, className: u.className, profileImageUrl: u.profileImageUrl, own: true });
        }
      }
      for (const c of props.contacts) {
        const key = `contact:${c.targetUnitId}`;
        if (prevStatusMap.get(key) && prevStatusMap.get(key) !== "SUNK" && c.status === "SUNK") {
          newlySunk.push({ id: c.targetUnitId, name: c.name, className: c.className, profileImageUrl: c.profileImageUrl, own: false });
        }
      }
      if (newlySunk.length > 0) setSunkQueue((prev) => [...prev, ...newlySunk]);
    }
    setPrevStatusMap(currentStatusMap);
  }

  const [selectedShipId, setSelectedShipId] = useState<string | null>(livingOwnUnits[0]?.id ?? null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedWeaponSlot, setSelectedWeaponSlot] = useState<string | null>(null);
  const [selectedTorpedoTypeId, setSelectedTorpedoTypeId] = useState<string | null>(null);
  const [pickingTarget, setPickingTarget] = useState(false);
  /** Vise une salve de torpilles (navire/sous-marin) : le prochain clic sur la carte fixe le cap plutôt que d'ajouter un point de trajet. */
  const [torpedoAiming, setTorpedoAiming] = useState(false);
  const [torpedoAimPoint, setTorpedoAimPoint] = useState<LatLng | null>(null);
  const [torpedoSpread, setTorpedoSpread] = useState<"NARROW" | "STANDARD" | "WIDE">("STANDARD");
  const [torpedoSalvoTypeId, setTorpedoSalvoTypeId] = useState<string | null>(null);
  const [torpedoSalvoResult, setTorpedoSalvoResult] = useState<string | null>(null);
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
    for (const u of props.ownUnits) init[u.id] = initialDraftFor(savedMovementByUnit[u.id]);
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
      for (const u of props.ownUnits) init[u.id] = initialDraftFor(savedMovementByUnit[u.id]);
      return init;
    });
    setTorpedoAiming(false);
    setTorpedoAimPoint(null);
    setTorpedoSalvoResult(null);
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
  // geo.ts) DÉTERMINE la vitesse (pas l'inverse) : pas de curseur, la
  // vitesse est déduite de ce que le joueur trace. Doit tomber entre
  // minBudgetNm et maxBudgetNm (accélération ET décélération plafonnées,
  // aucune des deux n'est instantanée).
  const minBudgetNm = selectedShip ? speedBudgetNm(minSpeed, props.roundMinutes) : 0;
  const maxBudgetNm = selectedShip ? speedBudgetNm(maxSpeed, props.roundMinutes) : 0;
  const fullPath = selectedShip && draft ? [{ lat: selectedShip.currentLat, lng: selectedShip.currentLng }, ...draft.path] : [];
  const straightNm = selectedShip && draft ? pathLengthNm(fullPath) : 0;
  const turnNm = selectedShip && draft ? turnPenaltyNm(fullPath, selectedShip.turningRadiusM / NM_TO_M) : 0;
  const usedNm = straightNm + turnNm;
  const impliedSpeedKnots = usedNm / (props.roundMinutes / 60);
  // Gouvernail bloqué : cap et vitesse forcés côté serveur (pleine vitesse
  // disponible) — rien à valider côté client, il n'y a plus de trajet à juger.
  const isPathValid = selectedShip?.rudderJammed || (impliedSpeedKnots >= minSpeed - 0.05 && impliedSpeedKnots <= maxSpeed + 0.05);
  const remainingNm = Math.max(0, maxBudgetNm - usedNm);
  const shortfallNm = Math.max(0, minBudgetNm - usedNm);

  function clearDraftPath() {
    if (!selectedShip) return;
    setMovementDrafts((prev) => ({ ...prev, [selectedShip.id]: { ...prev[selectedShip.id], path: [] } }));
  }

  /** Choix d'immersion pour la manche en cours (sous-marins) — voir MovementDraft.depthBand. */
  function setDraftDepthBand(band: DepthBandKey) {
    if (!selectedShip) return;
    setMovementDrafts((prev) => ({ ...prev, [selectedShip.id]: { ...prev[selectedShip.id], depthBand: band } }));
  }

  function handleMapClick(pos: LatLng) {
    if (torpedoAiming) {
      setTorpedoAimPoint(pos);
      return;
    }
    if (!isMovementPhase || !selectedShip || !draft) return;
    if (selectedShip.rudderJammed) {
      setError("Gouvernail bloqué : le navire poursuit tout droit à pleine vitesse disponible, rien à tracer.");
      return;
    }
    const start = { lat: selectedShip.currentLat, lng: selectedShip.currentLng };
    const previous = draft.path[draft.path.length - 1] ?? start;
    // Cadenassé à la distance maximale atteignable cette manche (le trait ne
    // peut de toute façon pas impliquer plus vite que ça) — pas de budget
    // choisi séparément puisque la vitesse est déduite du trait lui-même.
    const clamped = clampPathToBudget([start, ...draft.path, pos], maxBudgetNm);
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
      if (torpedoAiming) {
        const target = liveContacts.find((c) => c.targetUnitId === targetId);
        if (target) setTorpedoAimPoint({ lat: target.lat, lng: target.lng });
        return;
      }
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
        path: movementDrafts[shipId]?.path ?? [],
        depthBand: movementDrafts[shipId]?.depthBand ?? undefined,
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

  /** Tire la salve visée — indépendant du mouvement du navire (voir fireTorpedoSalvo côté serveur : le cap est déduit du point visé, l'origine reste la position du navire au début de la manche). */
  function fireSalvo() {
    if (!selectedShip || !torpedoAimPoint) return;
    const shipId = selectedShip.id;
    setError(null);
    setTorpedoSalvoResult(null);
    startTransition(async () => {
      const result = await fireTorpedoSalvoAction({
        engagementId: props.engagementId,
        unitId: shipId,
        aimLat: torpedoAimPoint.lat,
        aimLng: torpedoAimPoint.lng,
        spread: torpedoSpread,
        torpedoTypeId: torpedoSalvoTypeId ?? undefined,
        targetUnitId: selectedTargetId ?? undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTorpedoAiming(false);
      setTorpedoAimPoint(null);
      setTorpedoSalvoResult(`Salve tirée, cap ${Math.round(result.headingDeg)}° — elle avancera au fil des prochaines manches.`);
      router.refresh();
    });
  }

  /**
   * Après un tir réussi : passe à la prochaine pièce non tirée du même
   * navire (cible conservée). Quand c'était sa dernière arme — souvent le
   * cas dès le premier tir pour un navire n'ayant qu'une seule batterie de
   * torpilles — on reste sur son panneau plutôt que de sauter aussitôt vers
   * un autre navire : sinon le résultat (« ✓ tiré », jet, narration)
   * s'affiche bien sous la ligne de l'arme, mais personne ne le voit avant
   * d'être déjà passé à autre chose. Le joueur choisit lui-même le navire
   * suivant dans la liste, à son rythme.
   */
  function advanceAfterShot(ship: OwnUnit, firedSlot: string) {
    const remainingSlots = activeWeaponSlotsForShip(ship).filter((s) => s !== firedSlot && !firedBySlot[`${ship.id}|${s}`]);
    if (remainingSlots.length > 0) {
      setSelectedWeaponSlot(remainingSlots[0]);
      return;
    }
    setSelectedWeaponSlot(null);
    setSelectedTargetId(null);
  }

  function validateShot() {
    if (!selectedShip || !selectedTarget || !selectedWeaponSlot) return;
    const weaponType =
      selectedWeaponSlot === TORPEDO_SLOT
        ? "TORPEDO"
        : selectedWeaponSlot === BOMB_SLOT
          ? "BOMB"
          : selectedWeaponSlot === DEPTH_CHARGE_SLOT
            ? "DEPTH_CHARGE"
            : selectedWeaponSlot === HEDGEHOG_SLOT
              ? "HEDGEHOG"
              : "GUN";
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
      // Pas encore de bruit de bombe (aucun fichier fourni) : silencieux
      // pour ce type d'arme plutôt que de rejouer le son torpille par erreur.
      if (weaponType === "GUN") playGunSound();
      else if (weaponType === "TORPEDO") playTorpedoSound();
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
          debugInfo: result.result.debugInfo,
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
      // submitTacticalMovementForUnit) — à pleine vitesse disponible.
      const previewPath = selectedShip.rudderJammed
        ? [start, destinationPoint(start, selectedShip.headingDeg ?? 0, maxBudgetNm)]
        : filletPath([start, ...draft.path], selectedShip.turningRadiusM / NM_TO_M);
      list.push({ id: "draft-path", kind: "line", data: lineFeatureCollection(previewPath), color: isPathValid ? "#facc15" : "#f87171", width: 3 });
      if (!selectedShip.rudderJammed) {
        // Deux anneaux-repères autour de la position actuelle : le trajet
        // doit s'étendre entre les deux (à vol d'oiseau, la manœuvre en
        // coûte un peu plus) — l'extérieur borne la vitesse max
        // atteignable cette manche, l'intérieur la vitesse min (la
        // décélération n'est pas plus instantanée que l'accélération).
        list.push({
          id: "budget-ring-max",
          kind: "line",
          data: budgetCircleFeatureCollection(start, maxBudgetNm),
          color: "#facc15",
          width: 1,
          dashed: true,
        });
        if (minBudgetNm > 0.01) {
          list.push({
            id: "budget-ring-min",
            kind: "line",
            data: budgetCircleFeatureCollection(start, minBudgetNm),
            color: "#f87171",
            width: 1,
            dashed: true,
          });
        }
      }
    }

    const trailSegments: { points: LatLng[]; color: string }[] = [];
    for (const u of livingOwnUnits) {
      const trail = props.ownTrailByUnit[u.id];
      if (trail && trail.length > 0) trailSegments.push(...buildTrailSegments([...trail, { lat: u.currentLat, lng: u.currentLng }]));
    }
    for (const c of liveContacts) {
      const trail = props.enemyTrailByTarget[c.targetUnitId];
      if (trail && trail.length > 0) trailSegments.push(...buildTrailSegments([...trail, { lat: c.lat, lng: c.lng }]));
    }
    if (trailSegments.length > 0) {
      list.push({
        id: "unit-trails",
        kind: "line",
        data: multiLineFeatureCollectionColored(trailSegments),
        colorByFeature: true,
        opacityByFeature: true,
        widthByFeature: true,
      });
    }

    // Salves de torpilles propres en transit : trace de l'origine (calculée
    // par géométrie inverse — une salve va toujours en ligne droite, voir
    // page.tsx) jusqu'à sa position courante, qui avance manche après
    // manche à chaque résolution. Jamais les salves adverses — brouillard
    // de guerre, aucun mécanisme de révélation de sillage ennemi.
    if (props.ownInTransitSalvoes.length > 0) {
      list.push({
        id: "torpedo-salvo-traces",
        kind: "line",
        data: multiLineFeatureCollection(props.ownInTransitSalvoes.map((s) => [s.origin, s.current])),
        color: "#67e8f9",
        width: 2,
      });
      list.push({
        id: "torpedo-salvo-heads",
        kind: "points",
        data: pointsFeatureCollection(props.ownInTransitSalvoes.map((s) => ({ lat: s.current.lat, lng: s.current.lng, properties: {} }))),
        color: "#67e8f9",
        radius: 4,
      });
      // Extension pointillée montrant la distance que la salve parcourra
      // encore ce tour-ci — même convention visuelle que la projection de
      // trajectoire ennemie (enemy-projection) plus bas.
      list.push({
        id: "torpedo-salvo-projection",
        kind: "line",
        data: multiLineFeatureCollection(
          props.ownInTransitSalvoes.map((s) => [s.current, destinationPoint(s.current, s.headingDeg, speedBudgetNm(s.speedKnots, props.roundMinutes))])
        ),
        color: "#67e8f9",
        width: 1,
        dashed: true,
      });
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
    minBudgetNm,
    maxBudgetNm,
    isPathValid,
    showEnemyProjection,
    props.roundMinutes,
    props.ownTrailByUnit,
    props.enemyTrailByTarget,
    props.ownInTransitSalvoes,
  ]);

  // Épaves : un navire coulé reste affiché à sa dernière position (croix
  // rouge + fumée noire, voir shipSilhouettes.ts) plutôt que de disparaître
  // — d'où props.ownUnits/props.contacts ici (non filtrés), alors que le
  // reste de l'interface (listes cliquables, sélection) continue d'utiliser
  // livingOwnUnits/liveContacts, une épave n'étant plus manœuvrable ni ciblable.
  const shipMarkers = useMemo<ShipMarkerConfig[]>(() => {
    const own = props.ownUnits.map((u) => {
      const silhouette = classifySilhouette(u.category, u.className);
      const damageRatio = u.healthMax && u.healthMax > 0 ? 1 - (u.healthCurrent ?? u.healthMax) / u.healthMax : 0;
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
        damageRatio,
      };
    });
    const enemies = props.contacts.map((c) => {
      const silhouette = classifySilhouette(c.category, c.className);
      // Brouillard de guerre : on ne connaît pas les PV exacts d'un contact
      // ennemi, seulement son statut (ACTIF/ENDOMMAGÉ/COULÉ) — valeur
      // représentative plutôt que la vraie proportion, juste pour graduer
      // le panache visuellement sans révéler son potentiel réel.
      const damageRatio = c.status === "SUNK" ? 1 : c.status === "DAMAGED" ? 0.45 : 0;
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
        damageRatio,
      };
    });
    return [...own, ...enemies];
  }, [props.ownUnits, props.contacts, selectedShipId, selectedTargetId]);

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
                  {describeDamage(hoveredOwn).length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-red-400">
                      {describeDamage(hoveredOwn).map((line, i) => (
                        <li key={i}>⚠ {line}</li>
                      ))}
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

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 text-sm">
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
          <div className="p-4">
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
                minBudgetNm={minBudgetNm}
                maxBudgetNm={maxBudgetNm}
                straightNm={straightNm}
                turnNm={turnNm}
                shortfallNm={shortfallNm}
                remainingNm={remainingNm}
                roundMinutes={props.roundMinutes}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                impliedSpeedKnots={impliedSpeedKnots}
                isPathValid={isPathValid}
                positioned={isShipPositioned(selectedShip.id)}
                isPending={isPending}
                onClear={clearDraftPath}
                onSave={saveShipMovement}
                draftDepthBand={draft?.depthBand ?? null}
                onDepthBandChange={setDraftDepthBand}
                torpedoAiming={torpedoAiming}
                setTorpedoAiming={setTorpedoAiming}
                torpedoAimPoint={torpedoAimPoint}
                torpedoSpread={torpedoSpread}
                setTorpedoSpread={setTorpedoSpread}
                torpedoSalvoTypeId={torpedoSalvoTypeId}
                setTorpedoSalvoTypeId={setTorpedoSalvoTypeId}
                torpedoSalvoResult={torpedoSalvoResult}
                onFireSalvo={fireSalvo}
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
                      <DebugDetails text={a.debugInfo} />
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
          </div>
        </aside>
      </div>

      {sunkQueue.length > 0 && (
        <SunkShipModal ship={sunkQueue[0]} onClose={() => setSunkQueue((prev) => prev.slice(1))} />
      )}
    </div>
  );
}

function MovementDashboard({
  ship,
  minBudgetNm,
  maxBudgetNm,
  straightNm,
  turnNm,
  shortfallNm,
  remainingNm,
  roundMinutes,
  minSpeed,
  maxSpeed,
  impliedSpeedKnots,
  isPathValid,
  positioned,
  isPending,
  onClear,
  onSave,
  draftDepthBand,
  onDepthBandChange,
  torpedoAiming,
  setTorpedoAiming,
  torpedoAimPoint,
  torpedoSpread,
  setTorpedoSpread,
  torpedoSalvoTypeId,
  setTorpedoSalvoTypeId,
  torpedoSalvoResult,
  onFireSalvo,
}: {
  ship: OwnUnit;
  minBudgetNm: number;
  maxBudgetNm: number;
  straightNm: number;
  turnNm: number;
  shortfallNm: number;
  remainingNm: number;
  roundMinutes: number;
  minSpeed: number;
  maxSpeed: number;
  impliedSpeedKnots: number;
  isPathValid: boolean;
  positioned: boolean;
  isPending: boolean;
  onClear: () => void;
  onSave: () => void;
  draftDepthBand: DepthBandKey | null;
  onDepthBandChange: (band: DepthBandKey) => void;
  torpedoAiming: boolean;
  setTorpedoAiming: (v: boolean) => void;
  torpedoAimPoint: LatLng | null;
  torpedoSpread: "NARROW" | "STANDARD" | "WIDE";
  setTorpedoSpread: (v: "NARROW" | "STANDARD" | "WIDE") => void;
  torpedoSalvoTypeId: string | null;
  setTorpedoSalvoTypeId: (v: string | null) => void;
  torpedoSalvoResult: string | null;
  onFireSalvo: () => void;
}) {
  const torpedoBattery = ship.combatProfile?.torpedoTubes ?? null;
  const torpedoTypes = ship.combatProfile?.torpedoTypes ?? null;
  const outOfTorpedoes = ship.torpedoesRemaining != null && ship.torpedoesRemaining < (torpedoBattery?.count ?? 1);
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
      <DamageReport ship={ship} />
      {ship.category === "SUBMARINE" && (
        <TacticalDepthBandControl currentDepthBand={ship.depthBand as DepthBandKey} draftDepthBand={draftDepthBand} onChange={onDepthBandChange} />
      )}
      {ship.rudderJammed ? (
        <p className="rounded-md border border-red-800 bg-red-950/30 px-2 py-1 text-xs text-red-300">
          ⚠ Gouvernail bloqué — le navire poursuit tout droit au cap {Math.round(ship.headingDeg ?? 0)}° à pleine vitesse disponible (
          {Math.round(maxSpeed)} nds). Rien à tracer, juste à valider.
        </p>
      ) : (
        <>
          <div className="rounded-md bg-slate-900 p-3 text-xs">
            <div className="mb-1 flex items-center justify-between text-sm font-medium text-slate-200">
              <span>Vitesse déduite du trajet</span>
              <span className={isPathValid ? "text-emerald-400" : "text-red-400"}>{Math.round(impliedSpeedKnots)} nds</span>
            </div>
            <div className="text-slate-500">
              Atteignable cette manche : {Math.round(minSpeed)}-{Math.round(maxSpeed)} nds (accélération/décélération max{" "}
              {ship.accelerationKnotsPerMin.toFixed(1)} nds/min depuis {ship.lastSpeedKnots} nds, max navire {ship.maxSpeedKnots} nds
              {ship.speedCapKnots != null ? `, réduit à ${Math.round(ship.speedCapKnots)} nds par avarie` : ""})
            </div>
          </div>
          <div className="rounded-md bg-slate-900 p-3 text-xs">
            <div>
              Trajet : {straightNm.toFixed(2)} nm{turnNm > 0.01 ? ` + ${turnNm.toFixed(2)} nm de manœuvre` : ""}
            </div>
            <div>
              Doit être entre {minBudgetNm.toFixed(2)} et {maxBudgetNm.toFixed(2)} nm ({formatDuration(roundMinutes)})
            </div>
            {!isPathValid && shortfallNm > 0 && (
              <div className="mt-1 text-red-400">⚠ Trop court de {shortfallNm.toFixed(2)} nm — ce navire ne peut pas ralentir plus vite.</div>
            )}
            {!isPathValid && shortfallNm === 0 && <div className="mt-1 text-red-400">⚠ Trop long de {(-remainingNm).toFixed(2)} nm — trop rapide pour ce tour-ci.</div>}
          </div>
          <p className="text-xs text-slate-500">Cliquez sur la carte pour tracer le trajet de cette manche — sa longueur détermine la vitesse.</p>
        </>
      )}
      <div className="flex gap-2">
        {!ship.rudderJammed && (
          <button onClick={onClear} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
            Effacer le trajet
          </button>
        )}
        <button
          onClick={onSave}
          disabled={isPending || !isPathValid}
          className="flex-1 rounded-md bg-brass-600 px-3 py-1.5 text-xs font-medium hover:bg-brass-500 disabled:opacity-50"
        >
          {isPending ? "Envoi…" : positioned ? "Revalider ce navire" : "Valider le mouvement de ce navire"}
        </button>
      </div>

      {torpedoBattery && (
        <div className="space-y-2 rounded-md border border-slate-700 bg-slate-900 p-3">
          <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>Torpilles</span>
            {ship.torpedoesRemaining != null && <span className="font-normal normal-case text-slate-500">{ship.torpedoesRemaining} restantes</span>}
          </h3>
          <p className="text-[11px] text-slate-500">
            Vise un cap, pas un point d&apos;impact — la salve met plusieurs minutes à arriver et peut être esquivée si la cible change de cap
            entre-temps.
          </p>
          {ship.firedTorpedoSalvoThisRound ? (
            <p className="text-xs text-emerald-400">✓ Salve tirée cette manche.</p>
          ) : (
            <>
              {torpedoTypes && torpedoTypes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {torpedoTypes.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTorpedoSalvoTypeId(t.id)}
                      className={`rounded-md px-2 py-1 text-[11px] transition ${
                        torpedoSalvoTypeId === t.id ? "bg-brass-900/50 ring-1 ring-brass-500" : "border border-slate-700 hover:bg-slate-800"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-1">
                {(["NARROW", "STANDARD", "WIDE"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setTorpedoSpread(s)}
                    className={`flex-1 rounded-md px-2 py-1 text-[11px] transition ${
                      torpedoSpread === s ? "bg-brass-900/50 ring-1 ring-brass-500" : "border border-slate-700 hover:bg-slate-800"
                    }`}
                    title={
                      s === "NARROW"
                        ? "Étroite : plus précise si elle porte, mais croise moins facilement la route de la cible."
                        : s === "WIDE"
                          ? "Large : croise plus facilement la route de la cible, mais dilue les chances qu'un coup y porte."
                          : "Standard : compromis."
                    }
                  >
                    {s === "NARROW" ? "Étroite" : s === "WIDE" ? "Large" : "Standard"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setTorpedoAiming(!torpedoAiming)}
                disabled={outOfTorpedoes}
                className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  torpedoAiming
                    ? "bg-orange-800 hover:bg-orange-700"
                    : outOfTorpedoes
                      ? "cursor-not-allowed border border-slate-800 opacity-40"
                      : "border border-slate-700 hover:bg-slate-800"
                }`}
              >
                {outOfTorpedoes ? "Plus assez de torpilles" : torpedoAiming ? "Cliquez la carte pour viser…" : "Viser sur la carte"}
              </button>
              {torpedoAimPoint && (
                <div className="text-[11px] text-slate-500">
                  Point visé : {torpedoAimPoint.lat.toFixed(3)}, {torpedoAimPoint.lng.toFixed(3)}
                </div>
              )}
              <button
                onClick={onFireSalvo}
                disabled={!torpedoAimPoint || outOfTorpedoes}
                className="w-full rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-40"
              >
                Tirer la salve
              </button>
            </>
          )}
          {torpedoSalvoResult && <p className="text-xs text-emerald-400">{torpedoSalvoResult}</p>}
          {ship.inTransitTorpedoSalvoCount > 0 && (
            <p className="text-[11px] text-amber-400">
              {ship.inTransitTorpedoSalvoCount} salve{ship.inTransitTorpedoSalvoCount > 1 ? "s" : ""} déjà en transit, en attente d&apos;interception.
            </p>
          )}
        </div>
      )}
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
  const bombLoadout = ship.combatProfile?.bombs ?? null;
  const bombFired = !!firedBySlot[`${ship.id}|${BOMB_SLOT}`];
  const hasDepthCharges = ship.depthChargesRemaining != null;
  const outOfDepthCharges = ship.depthChargesRemaining != null && ship.depthChargesRemaining < DEPTH_CHARGES_PER_ATTACK;
  const depthChargeFired = !!firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`];
  const hasHedgehog = ship.hedgehogRoundsRemaining != null;
  const outOfHedgehog = ship.hedgehogRoundsRemaining != null && ship.hedgehogRoundsRemaining < HEDGEHOG_ROUNDS_PER_ATTACK;
  const hedgehogFired = !!firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`];

  const estimate = useMemo(() => {
    if (!target || rangeM === null || !selectedWeaponSlot) return null;
    const targetLengthM = target.lengthMeters ?? 100;
    const targetBeamM = target.beamMeters ?? 12;
    const assumedSpeed = target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO;
    const targetIsAircraft = target.category === "AIRCRAFT";

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
    if (selectedWeaponSlot === BOMB_SLOT && bombLoadout) {
      return bombHitChancePercent({
        method: bombLoadout.method,
        targetLengthM,
        targetBeamM,
        targetSpeedKnots: assumedSpeed,
      });
    }
    if (selectedWeaponSlot === DEPTH_CHARGE_SLOT || selectedWeaponSlot === HEDGEHOG_SLOT) {
      if (target.category !== "SUBMARINE") return null;
      const calc = selectedWeaponSlot === DEPTH_CHARGE_SLOT ? depthChargeHitChancePercent : hedgehogHitChancePercent;
      // Palier réel non connu côté client (brouillard de guerre) : estimation à un palier moyen, comme l'hypothèse de vitesse ennemie ci-dessus — le vrai calcul serveur connaît le palier réel.
      return calc({ rangeM, maxRangeM: ASDIC_ATTACK_RANGE_M, targetDepthBand: "MEDIUM" });
    }
    const gunIndex = selectedWeaponSlot.startsWith("gun:") ? Number(selectedWeaponSlot.slice(4)) : null;
    const battery = gunIndex !== null ? allGuns[gunIndex] : undefined;
    if (battery && targetIsAircraft) {
      // Combat air-air : pas de notion de portée/arc à cette échelle (voir
      // combat.ts) — chance calculée sur la maniabilité relative des deux
      // appareils.
      return airCombatHitChancePercent({
        attackerAgility: ship.agility ?? 0.5,
        defenderAgility: target.agility ?? 0.5,
        defenderHasDefensiveGuns: false, // repli optimiste côté estimation client : le vrai calcul (serveur) connaît l'armement réel de la cible.
      });
    }
    if (battery && ship.category === "AIRCRAFT" && !targetIsAircraft) {
      // Mitraillage/roquettes air → navire : pas de notion de portée/arc à
      // cette échelle non plus (voir resolveStrafingEngagement, combat.ts) —
      // très précis, mais capé côté serveur à des dégâts superficiels contre
      // un bâtiment de tonnage significatif.
      return strafingHitChancePercent({});
    }
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
  }, [target, rangeM, selectedWeaponSlot, allGuns, torpedoBattery, torpedoTypes, selectedTorpedoTypeId, torpedoInRange, torpedoInArc, relativeBearing, bombLoadout, ship.agility, ship.category]);

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
      <DamageReport ship={ship} />
      {ship.category === "SUBMARINE" && <p className="text-xs text-slate-500">Immersion : {formatDepthBand(ship.depthBand)}</p>}

      <div>
        <h3 className="mb-1 flex items-center text-xs font-semibold text-slate-300">
          <StepBadge n={2} state={selectedWeaponSlot ? "done" : "active"} />
          Choisissez une arme
        </h3>
        <ul className="space-y-1">
          {allGuns.map((g, i) => {
            const slot = gunSlot(i);
            const fired = firedBySlot[`${ship.id}|${slot}`];
            // Combat air-air et mitraillage/roquettes air → navire : pas de portée/arc gradués à cette échelle (voir combat.ts) — toujours utilisable dès que la cible est détectée.
            const usable =
              !target || target.category === "AIRCRAFT" || ship.category === "AIRCRAFT" || (g.rangeM >= rangeM! && isInGunArc(g.arc, relativeBearing ?? 0));
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
                  <DebugDetails text={fired.debugInfo} />
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
              <DebugDetails text={firedBySlot[`${ship.id}|${TORPEDO_SLOT}`]?.debugInfo ?? null} />
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
          {bombLoadout && ship.disabledWeaponSlots.includes(BOMB_SLOT) && (
            <li className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-600">
              <div className="flex items-center justify-between">
                <span>Bombes ×{bombLoadout.count} ({formatBombMethod(bombLoadout.method)})</span>
                <span className="text-red-500">✗ hors service</span>
              </div>
            </li>
          )}
          {bombLoadout && !ship.disabledWeaponSlots.includes(BOMB_SLOT) && bombFired && (
            <li className={`rounded-md border px-2 py-1.5 text-xs ${firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.hit ? "border-red-800 bg-red-950/30" : "border-slate-700 bg-slate-900"}`}>
              <div className="flex items-center justify-between text-slate-400">
                <span>Bombes ×{bombLoadout.count} ({formatBombMethod(bombLoadout.method)})</span>
                <span className="text-emerald-400">✓ larguées</span>
              </div>
              {firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.hitRoll !== null && firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.hitChancePercent !== null && (
                <div className="mt-1 text-slate-500">
                  Jet : {firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.hitRoll?.toFixed(1)} (seuil{" "}
                  {firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.hitChancePercent?.toFixed(0)}%)
                </div>
              )}
              {firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.narrative && (
                <div className="mt-1 text-slate-300">{firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.narrative}</div>
              )}
              <DebugDetails text={firedBySlot[`${ship.id}|${BOMB_SLOT}`]?.debugInfo ?? null} />
            </li>
          )}
          {bombLoadout && !ship.disabledWeaponSlots.includes(BOMB_SLOT) && !bombFired && (
            <li>
              <button
                onClick={() => setSelectedWeaponSlot(BOMB_SLOT)}
                disabled={!!target && target.category !== "SURFACE_SHIP"}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                  selectedWeaponSlot === BOMB_SLOT
                    ? "bg-brass-900/50 ring-1 ring-brass-500"
                    : target && target.category !== "SURFACE_SHIP"
                      ? "cursor-not-allowed opacity-40"
                      : "border border-slate-700 hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Bombes ×{bombLoadout.count} ({formatBombMethod(bombLoadout.method)})</span>
                </div>
                {target && target.category !== "SURFACE_SHIP" && <div className="text-[11px] text-amber-400">ne vise qu&apos;un navire de surface</div>}
              </button>
            </li>
          )}
          {hasDepthCharges && depthChargeFired && (
            <li className={`rounded-md border px-2 py-1.5 text-xs ${firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.hit ? "border-red-800 bg-red-950/30" : "border-slate-700 bg-slate-900"}`}>
              <div className="flex items-center justify-between text-slate-400">
                <span>Grenades ASM</span>
                <span className="text-emerald-400">✓ larguées</span>
              </div>
              {firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.hitRoll !== null && firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.hitChancePercent !== null && (
                <div className="mt-1 text-slate-500">
                  Jet : {firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.hitRoll?.toFixed(1)} (seuil{" "}
                  {firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.hitChancePercent?.toFixed(0)}%)
                </div>
              )}
              {firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.narrative && (
                <div className="mt-1 text-slate-300">{firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.narrative}</div>
              )}
              <DebugDetails text={firedBySlot[`${ship.id}|${DEPTH_CHARGE_SLOT}`]?.debugInfo ?? null} />
            </li>
          )}
          {hasDepthCharges && !depthChargeFired && (
            <li>
              <button
                onClick={() => setSelectedWeaponSlot(DEPTH_CHARGE_SLOT)}
                disabled={outOfDepthCharges}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                  selectedWeaponSlot === DEPTH_CHARGE_SLOT
                    ? "bg-brass-900/50 ring-1 ring-brass-500"
                    : outOfDepthCharges
                      ? "cursor-not-allowed opacity-40"
                      : "border border-slate-700 hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Grenades ASM</span>
                  <span className="text-slate-500">{ship.depthChargesRemaining} restantes</span>
                </div>
                {target && target.category !== "SUBMARINE" && <div className="text-[11px] text-amber-400">ne vise qu&apos;un sous-marin immergé</div>}
                {!target && <div className="text-[11px] text-slate-500">rompt le contact ASDIC une manche, à l&apos;inverse du Hedgehog</div>}
              </button>
            </li>
          )}
          {hasHedgehog && hedgehogFired && (
            <li className={`rounded-md border px-2 py-1.5 text-xs ${firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.hit ? "border-red-800 bg-red-950/30" : "border-slate-700 bg-slate-900"}`}>
              <div className="flex items-center justify-between text-slate-400">
                <span>Hedgehog</span>
                <span className="text-emerald-400">✓ tiré</span>
              </div>
              {firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.hitRoll !== null && firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.hitChancePercent !== null && (
                <div className="mt-1 text-slate-500">
                  Jet : {firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.hitRoll?.toFixed(1)} (seuil{" "}
                  {firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.hitChancePercent?.toFixed(0)}%)
                </div>
              )}
              {firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.narrative && (
                <div className="mt-1 text-slate-300">{firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.narrative}</div>
              )}
              <DebugDetails text={firedBySlot[`${ship.id}|${HEDGEHOG_SLOT}`]?.debugInfo ?? null} />
            </li>
          )}
          {hasHedgehog && !hedgehogFired && (
            <li>
              <button
                onClick={() => setSelectedWeaponSlot(HEDGEHOG_SLOT)}
                disabled={outOfHedgehog}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                  selectedWeaponSlot === HEDGEHOG_SLOT
                    ? "bg-brass-900/50 ring-1 ring-brass-500"
                    : outOfHedgehog
                      ? "cursor-not-allowed opacity-40"
                      : "border border-slate-700 hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>Hedgehog</span>
                  <span className="text-slate-500">{ship.hedgehogRoundsRemaining} salve{(ship.hedgehogRoundsRemaining ?? 0) > 1 ? "s" : ""}</span>
                </div>
                {target && target.category !== "SUBMARINE" && <div className="text-[11px] text-amber-400">ne vise qu&apos;un sous-marin immergé</div>}
                {!target && <div className="text-[11px] text-slate-500">ne rompt jamais le contact ASDIC</div>}
              </button>
            </li>
          )}
          {allGuns.length === 0 && !torpedoBattery && !bombLoadout && !hasDepthCharges && !hasHedgehog && (
            <li className="text-xs text-slate-600">Aucune arme.</li>
          )}
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

/** Détail des calculs d'un tir, replié par défaut — à des fins de débogage/transparence (voir tacticalNarrative.ts). */
function DebugDetails({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <details className="mt-1 text-[11px] text-slate-600">
      <summary className="cursor-pointer select-none hover:text-slate-400">🔧 détails du calcul</summary>
      <p className="mt-0.5 text-slate-500">{text}</p>
    </details>
  );
}

/** Avaries localisées du navire sélectionné, en plus de la barre de PV — utilisé dans les deux fiches (mouvement et tir). */
function DamageReport({ ship }: { ship: OwnUnit }) {
  const lines = describeDamage(ship);
  if (lines.length === 0) return null;
  return (
    <div className="rounded-md border border-red-800 bg-red-950/30 p-2 text-xs text-red-300">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400">Avaries localisées</div>
      <ul className="space-y-0.5">
        {lines.map((line, i) => (
          <li key={i}>⚠ {line}</li>
        ))}
      </ul>
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

/** Libellé de la méthode de largage — voir combat.ts, BombLoadout.method. */
function formatBombMethod(method: string) {
  switch (method) {
    case "DIVE":
      return "piqué";
    case "SKIP":
      return "basse altitude/ricochet";
    default:
      return "horizontal";
  }
}

/** Nom lisible d'une pièce à partir de son weaponSlot (ex: "gun:0" -> "tourelle avant"), pour désigner une avarie sans jargon technique. */
function weaponLabel(ship: OwnUnit, slot: string): string {
  if (slot === TORPEDO_SLOT) return "tubes lance-torpilles";
  const index = Number(slot.slice(4));
  const gun = ship.combatProfile?.guns?.[index];
  if (!gun) return slot;
  return `batterie ${formatArc(gun.arc)} (${gun.calibreMm}mm)`;
}

/** Avaries localisées d'un navire, en phrases lisibles — utilisé par la fiche navire ET l'infobulle de survol, une seule source de vérité pour la terminologie. */
function describeDamage(ship: OwnUnit): string[] {
  const lines: string[] = [];
  for (const slot of ship.disabledWeaponSlots) lines.push(`Batterie inopérante : ${weaponLabel(ship, slot)} détruite`);
  if (ship.speedCapKnots != null) lines.push(`Salle des machines touchée : vitesse max réduite à ${Math.round(ship.speedCapKnots)} nds`);
  if (ship.rudderJammed) lines.push("Gouvernail bloqué : cap maintenu, impossible de manœuvrer");
  if (ship.fireControlDamaged) lines.push("Télépointage endommagé : précision réduite sur tous les tirs");
  return lines;
}

function formatDuration(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

/**
 * Changement d'immersion en manche tactique (retour utilisateur
 * 2026-08-14) : même principe que DepthBandControl côté ordres
 * stratégiques (OrdersClient.tsx) — un seul cran par manche, boutons hors
 * portée d'un cran désactivés plutôt que cachés sans explication.
 */
function TacticalDepthBandControl({
  currentDepthBand,
  draftDepthBand,
  onChange,
}: {
  currentDepthBand: DepthBandKey;
  draftDepthBand: DepthBandKey | null;
  onChange: (band: DepthBandKey) => void;
}) {
  const selected = draftDepthBand ?? currentDepthBand;
  const currentIndex = DEPTH_BAND_ORDER.indexOf(currentDepthBand);

  return (
    <div className="rounded-md bg-slate-900 p-2 text-xs">
      <div className="mb-1 font-semibold text-slate-400">Immersion (1 palier par manche)</div>
      <div className="flex gap-1">
        {DEPTH_BAND_ORDER.map((band, i) => {
          const adjacent = Math.abs(i - currentIndex) <= 1;
          return (
            <button
              key={band}
              disabled={!adjacent}
              onClick={() => onChange(band)}
              title={formatDepthBand(band)}
              className={`flex-1 rounded-md px-1.5 py-1 text-center transition ${
                selected === band
                  ? "bg-brass-900/50 ring-1 ring-brass-500"
                  : adjacent
                    ? "hover:bg-slate-800"
                    : "cursor-not-allowed opacity-30"
              }`}
            >
              {formatDepthBand(band)}
            </button>
          );
        })}
      </div>
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
