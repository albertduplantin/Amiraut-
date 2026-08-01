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

export function budgetCircleFeatureCollection(center: LatLng, radiusNm: number): GeoJSON.FeatureCollection {
  if (radiusNm <= 0) return { type: "FeatureCollection", features: [] };
  const feature = circle([center.lng, center.lat], radiusNm, { units: "nauticalmiles", steps: 64 });
  return { type: "FeatureCollection", features: [feature] };
}
