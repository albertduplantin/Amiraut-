"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, LngLatBounds, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng } from "@/lib/geo";

export type MapSourceConfig = {
  id: string;
  data: GeoJSON.FeatureCollection;
  kind: "points" | "line";
  color?: string;
  radius?: number;
  width?: number;
  dashed?: boolean;
  showLabels?: boolean;
};

type GameMapProps = {
  center: { lat: number; lng: number };
  zoom?: number;
  sources: MapSourceConfig[];
  onClick?: (pos: { lat: number; lng: number }) => void;
  className?: string;
  /** Cadre la vue sur ces points une fois, au premier chargement du style. */
  fitToPoints?: LatLng[];
  /** Recentre la carte en douceur sur ce point à chaque changement (ex: sélection d'unité). */
  flyToPoint?: LatLng | null;
};

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function GameMap({ center, zoom = 5, sources, onClick, className, fitToPoints, flyToPoint }: GameMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onClickRef = useRef(onClick);
  const fitToPointsRef = useRef(fitToPoints);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    fitToPointsRef.current = fitToPoints;
  }, [fitToPoints]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [center.lng, center.lat],
      zoom,
    });
    mapRef.current = map;

    map.on("click", (e: MapMouseEvent) => {
      onClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.once("load", () => {
      const points = fitToPointsRef.current;
      if (points && points.length > 0) {
        fitMapToPoints(map, points);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      for (const source of sources) applyLayer(map, source);
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [sources]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToPoint) return;

    const fly = () => map.flyTo({ center: [flyToPoint.lng, flyToPoint.lat], zoom: Math.max(map.getZoom(), 6), speed: 1.4 });
    if (map.isStyleLoaded()) fly();
    else map.once("load", fly);
  }, [flyToPoint]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
}

function fitMapToPoints(map: MapLibreMap, points: LatLng[]) {
  const bounds = points.reduce(
    (acc, p) => acc.extend([p.lng, p.lat]),
    new LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat])
  );
  map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
}

function applyLayer(map: MapLibreMap, config: MapSourceConfig) {
  const existing = map.getSource(config.id) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(config.data);
    return;
  }

  map.addSource(config.id, { type: "geojson", data: config.data });

  if (config.kind === "line") {
    map.addLayer({
      id: `${config.id}-line`,
      type: "line",
      source: config.id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": config.color ?? "#22d3ee",
        "line-width": config.width ?? 2,
        ...(config.dashed ? { "line-dasharray": [2, 2] } : {}),
      },
    });
    return;
  }

  map.addLayer({
    id: `${config.id}-circle`,
    type: "circle",
    source: config.id,
    paint: {
      "circle-color": config.color ?? "#22d3ee",
      "circle-radius": config.radius ?? 6,
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 1.5,
    },
  });

  if (config.showLabels) {
    map.addLayer({
      id: `${config.id}-label`,
      type: "symbol",
      source: config.id,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#e2e8f0",
        "text-halo-color": "#0f172a",
        "text-halo-width": 1,
      },
    });
  }
}
