import type { LatLng } from "@/lib/geo";

/**
 * Formation de placement au dépôt d'une task force sur la carte (retour
 * utilisateur 2026-08-15) — PLACEHOLDER générique volontairement simple
 * (ligne de front, écartement fixe) : la vraie doctrine par marine
 * (écartement/dispositif Royal Navy vs Kriegsmarine vs US Navy, cercle de
 * screening ASM, etc.) est un chantier de recherche historique séparé,
 * différé — même logique que le calcul de combat par escadrille du
 * chantier précédent (voir Squadron, prisma/schema.prisma). Le mécanisme de
 * positionnement fin par unité (🎯 clic-carte, déjà construit) reste
 * disponible ensuite pour corriger un navire mal placé (ex: sur la terre).
 */

const SPACING_DEG = 0.03; // ~3.3km à l'équateur — écartement d'escorte plausible, sans prétention doctrinale.

/** Décalages (lat/lng) relatifs au centre, une ligne de front est-ouest centrée sur 0. */
export function computeFormationOffsets(count: number, centerLat: number): { dLat: number; dLng: number }[] {
  if (count <= 1) return [{ dLat: 0, dLng: 0 }];
  // Ajuste l'écartement en longitude par cos(latitude) pour une distance
  // réelle à peu près constante quelle que soit la latitude du scénario
  // (un degré de longitude vaut ~60nm à l'équateur, ~16nm à 74°N).
  const lngSpacing = SPACING_DEG / Math.max(0.15, Math.cos((centerLat * Math.PI) / 180));
  return Array.from({ length: count }, (_, i) => ({
    dLat: 0,
    dLng: (i - (count - 1) / 2) * lngSpacing,
  }));
}

/** Positions absolues d'une formation générique centrée sur `center`. */
export function applyFormationAtCenter(center: LatLng, count: number): LatLng[] {
  return computeFormationOffsets(count, center.lat).map((o) => ({ lat: center.lat + o.dLat, lng: center.lng + o.dLng }));
}
