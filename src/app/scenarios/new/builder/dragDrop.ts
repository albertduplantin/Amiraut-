import type { DragEvent } from "react";
import type { UnitCategory } from "./types";

/**
 * Glisser-déposer (Phase 6, retour utilisateur 2026-08-14) — accélérateur
 * superposé au chemin bouton déjà fonctionnel (Phases 3-4), pas un
 * remplacement : HTML5 natif (`draggable`/`dataTransfer`), pas de
 * dépendance ajoutée, voir le plan. Un seul type MIME custom transportant
 * un payload JSON discriminé par `kind`.
 */
const DRAG_MIME = "application/x-amiraute-drag";

export type DragPayload =
  | { kind: "libraryClass"; libraryClassId: string }
  | { kind: "rosterUnit"; teamClientId: string; fleetClientId: string; unitClientId: string; category: UnitCategory }
  // Dépose sur la carte (Phase 2, retour utilisateur 2026-08-15) — task
  // force ou base entière glissée depuis le rail gauche pour la positionner
  // en un geste (formation générique, voir formation.ts), plutôt que de
  // positionner chaque unité une par une via le mécanisme 🎯 existant.
  | { kind: "fleet"; teamClientId: string; fleetClientId: string }
  | { kind: "airbase"; airbaseClientId: string };

export function setDragPayload(e: DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copyMove";
}

/**
 * Lit le payload déposé — uniquement disponible au moment du `drop` (l'API
 * HTML5 ne donne accès à `getData` pendant `dragover`/`dragenter`, d'où
 * l'absence de prévisualisation "cible valide/invalide" pendant le survol :
 * le rejet (ex. classe non-AIRCRAFT déposée sur une base aérienne) ne peut
 * se faire qu'à la dépose elle-même).
 */
export function readDragPayload(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export function allowDrop(e: DragEvent) {
  e.preventDefault();
}
