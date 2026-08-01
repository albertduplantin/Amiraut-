"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
};

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function GameMap({ center, zoom = 5, sources, onClick, className }: GameMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onClickRef = useRef(onClick);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

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

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
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
