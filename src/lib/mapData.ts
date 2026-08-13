import circle from "@turf/circle";
import type { LatLng } from "@/lib/geo";

export function pointsFeatureCollection<T extends Record<string, unknown>>(
  items: (LatLng & { properties?: T })[]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [item.lng, item.lat] },
      properties: item.properties ?? {},
    })),
  };
}

export function lineFeatureCollection(points: LatLng[]): GeoJSON.FeatureCollection {
  if (points.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
        properties: {},
      },
    ],
  };
}

export function multiLineFeatureCollection(paths: LatLng[][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: paths
      .filter((p) => p.length >= 2)
      .map((path) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: path.map((p) => [p.lng, p.lat]) },
        properties: {},
      })),
  };
}

/** Palette de couleurs distinctes pour les tracés persistants par unité (hors jaune/orange/bleu, réservés). */
const UNIT_TRACK_PALETTE = [
  "#22c55e", // vert
  "#a855f7", // violet
  "#ec4899", // rose
  "#14b8a6", // sarcelle
  "#f43f5e", // rouge rosé
  "#84cc16", // citron vert
  "#06b6d4", // cyan
  "#818cf8", // indigo
  "#fb7185", // corail
  "#4ade80", // vert clair
  "#c084fc", // mauve
  "#2dd4bf", // turquoise
];

/** Couleur stable (persiste entre rendus/rechargements) dérivée de l'identifiant. */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % UNIT_TRACK_PALETTE.length;
  return UNIT_TRACK_PALETTE[index];
}

export function multiLineFeatureCollectionColored(
  paths: { points: LatLng[]; color: string; opacity?: number; width?: number }[]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: paths
      .filter((p) => p.points.length >= 2)
      .map((p) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: p.points.map((pt) => [pt.lng, pt.lat]) },
        properties: { color: p.color, opacity: p.opacity ?? 1, width: p.width ?? 3 },
      })),
  };
}

export function budgetCircleFeatureCollection(center: LatLng, radiusNm: number): GeoJSON.FeatureCollection {
  if (radiusNm <= 0) return { type: "FeatureCollection", features: [] };
  const feature = circle([center.lng, center.lat], radiusNm, { units: "nauticalmiles", steps: 64 });
  return { type: "FeatureCollection", features: [feature] };
}
