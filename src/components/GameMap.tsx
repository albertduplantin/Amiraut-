"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Map as MapLibreMap, Marker, LngLatBounds, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng } from "@/lib/geo";
import { buildSilhouetteElement, type SilhouetteKey, type UnitVisualStatus } from "@/lib/shipSilhouettes";

export type MapSourceConfig = {
  id: string;
  data: GeoJSON.FeatureCollection;
  kind: "points" | "line";
  color?: string;
  /** Si vrai, utilise la propriété `color` de chaque feature au lieu de `color`. */
  colorByFeature?: boolean;
  radius?: number;
  width?: number;
  dashed?: boolean;
  showLabels?: boolean;
  /**
   * Si défini, le cercle (et son label) s'estompe progressivement à
   * l'approche de ce niveau de zoom pour disparaître au-delà — utile pour la
   * couche de position "brute" une fois que la silhouette du navire prend le
   * relais (évite d'afficher les deux superposés).
   */
  fadeAboveZoom?: number;
};

export type GameMapHandle = {
  /** Faux si le point tombe sur une couche terrestre du fond de carte. */
  isWaterPoint: (p: LatLng) => boolean;
  /** Échantillonne le segment [a,b] ; faux si un point échantillonné est sur terre. */
  isWaterSegment: (a: LatLng, b: LatLng, steps?: number) => boolean;
};

export type ShipMarkerConfig = {
  id: string;
  lat: number;
  lng: number;
  headingDeg: number;
  color: string;
  silhouette: SilhouetteKey;
  /** Longueur hors-tout réelle en mètres, pour un rendu à l'échelle du zoom. */
  lengthMeters: number;
  label?: string;
  /** Épave fumante (SUNK) / fumée (DAMAGED) superposées à la silhouette. */
  status?: UnitVisualStatus;
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
  /**
   * Silhouettes vues de dessus, affichées à la place des points simples une
   * fois zoomé suffisamment (voir `shipMarkersMinZoom`). Orientées selon
   * `headingDeg` (0 = nord).
   */
  shipMarkers?: ShipMarkerConfig[];
  /** Niveau de zoom à partir duquel les silhouettes remplacent les points. */
  shipMarkersMinZoom?: number;
  /**
   * Si fourni, un clic direct sur une silhouette de navire appelle ce
   * handler avec son id au lieu de laisser le clic traverser vers la carte
   * (dessin de trajet) : rend les navires sélectionnables à la souris.
   */
  onShipMarkerClick?: (id: string) => void;
};

type ShipMarkerEntry = {
  marker: Marker;
  el: HTMLDivElement;
  signature: string;
  lat: number;
  lng: number;
  lengthMeters: number;
};

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * Couches du style dont la présence à un point indique la terre ferme.
 * Volontairement conservateur : "park"/"park_outline" sont exclus car ils
 * peuvent longer une côte (jardins, réserves littorales) et provoquer de
 * faux positifs très près du rivage sans être une vraie barrière terrestre.
 */
const LAND_LAYERS = [
  "landcover_wood",
  "landcover_grass",
  "landuse_residential",
  "landuse_pitch",
  "landuse_track",
  "landuse_cemetery",
  "landuse_hospital",
  "landuse_school",
  "building",
  "building-3d",
  "aeroway_fill",
  "aeroway_runway",
  "aeroway_taxiway",
];

/**
 * `map.isStyleLoaded()`/l'événement `load` attendent le rendu complet des
 * tuiles visibles, ce qui peut ne jamais se produire dans certains contextes
 * de rendu (GPU logiciel/headless). `style.load` (déclenché dès que le style
 * et ses sources/couches de base sont enregistrés) est le signal fiable dont
 * on a besoin pour pouvoir ajouter nos propres sources/couches par-dessus.
 */
function onceStyleReady(map: MapLibreMap, callback: () => void): () => void {
  const style = map.getStyle();
  if (style && style.layers && style.layers.length > 0) {
    callback();
    return () => {};
  }
  const handler = () => callback();
  map.once("style.load", handler);
  return () => map.off("style.load", handler);
}

export const GameMap = forwardRef<GameMapHandle, GameMapProps>(function GameMap(
  { center, zoom = 5, sources, onClick, className, fitToPoints, flyToPoint, shipMarkers, shipMarkersMinZoom = 7, onShipMarkerClick },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onClickRef = useRef(onClick);
  const onShipMarkerClickRef = useRef(onShipMarkerClick);
  const fitToPointsRef = useRef(fitToPoints);
  const isFirstFlyRef = useRef(true);
  const lastFlownToRef = useRef<LatLng | null>(null);
  const shipMarkersRef = useRef(new Map<string, ShipMarkerEntry>());

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    onShipMarkerClickRef.current = onShipMarkerClick;
  }, [onShipMarkerClick]);

  useEffect(() => {
    fitToPointsRef.current = fitToPoints;
  }, [fitToPoints]);

  const shipMarkersMinZoomRef = useRef(shipMarkersMinZoom);
  useEffect(() => {
    shipMarkersMinZoomRef.current = shipMarkersMinZoom;
    applyShipMarkerLayout(mapRef.current, shipMarkersRef.current, shipMarkersMinZoom);
  }, [shipMarkersMinZoom]);

  useImperativeHandle(
    ref,
    () => ({
      isWaterPoint: (p: LatLng) => {
        const map = mapRef.current;
        if (!map) return true;
        const px = map.project([p.lng, p.lat]);
        const land = map.queryRenderedFeatures([px.x, px.y], { layers: LAND_LAYERS });
        return land.length === 0;
      },
      isWaterSegment: (a: LatLng, b: LatLng, steps = 6) => {
        const map = mapRef.current;
        if (!map) return true;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const p = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
          const px = map.project([p.lng, p.lat]);
          const land = map.queryRenderedFeatures([px.x, px.y], { layers: LAND_LAYERS });
          if (land.length > 0) return false;
        }
        return true;
      },
    }),
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;
    // Référence stable (jamais réassignée, seulement mutée) : la capturer ici
    // évite l'avertissement react-hooks sur la lecture de `.current` dans le
    // nettoyage, tout en reflétant correctement son contenu au démontage.
    const markers = shipMarkersRef.current;

    // Turbopack ne résout pas le chunk worker de maplibre-gl automatiquement ;
    // sans ceci, aucune couche vectorielle (tuiles de base ET nos propres
    // sources GeoJSON) ne se construit, seul le fond raster s'affiche.
    setWorkerUrl("/maplibre-gl-worker.mjs");

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

    map.on("zoom", () => {
      applyShipMarkerLayout(map, shipMarkersRef.current, shipMarkersMinZoomRef.current);
    });

    const cancel = onceStyleReady(map, () => {
      const points = fitToPointsRef.current;
      if (points && points.length > 0) {
        fitMapToPoints(map, points);
      }
    });

    return () => {
      cancel();
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    return onceStyleReady(map, () => {
      for (const source of sources) applyLayer(map, source);
    });
  }, [sources]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = shipMarkersRef.current;
    const incoming = shipMarkers ?? [];
    const incomingIds = new Set(incoming.map((m) => m.id));

    for (const [id, entry] of existing) {
      if (!incomingIds.has(id)) {
        entry.marker.remove();
        existing.delete(id);
      }
    }

    for (const config of incoming) {
      const signature = `${config.silhouette}|${config.color}|${config.label ?? ""}|${config.status ?? ""}`;
      const current = existing.get(config.id);
      if (!current) {
        const el = buildSilhouetteElement(config);
        attachShipMarkerClick(el, config.id, onShipMarkerClickRef);
        const marker = new Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" })
          .setLngLat([config.lng, config.lat])
          .setRotation(config.headingDeg)
          .addTo(map);
        existing.set(config.id, { marker, el, signature, lat: config.lat, lng: config.lng, lengthMeters: config.lengthMeters });
        continue;
      }
      if (current.signature !== signature) {
        current.marker.remove();
        const el = buildSilhouetteElement(config);
        attachShipMarkerClick(el, config.id, onShipMarkerClickRef);
        const marker = new Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" })
          .setLngLat([config.lng, config.lat])
          .setRotation(config.headingDeg)
          .addTo(map);
        existing.set(config.id, { marker, el, signature, lat: config.lat, lng: config.lng, lengthMeters: config.lengthMeters });
      } else {
        current.marker.setLngLat([config.lng, config.lat]).setRotation(config.headingDeg);
        current.lat = config.lat;
        current.lng = config.lng;
        current.lengthMeters = config.lengthMeters;
      }
    }

    applyShipMarkerLayout(map, existing, shipMarkersMinZoomRef.current);
  }, [shipMarkers]);

  useEffect(() => {
    // Ne pas voler vers la sélection par défaut au montage : ça écraserait fitToPoints.
    // Seuls les changements de sélection ultérieurs déclenchent le survol.
    if (isFirstFlyRef.current) {
      isFirstFlyRef.current = false;
      lastFlownToRef.current = flyToPoint ?? null;
      return;
    }
    const map = mapRef.current;
    if (!map || !flyToPoint) return;
    // Comparaison par valeur : un nouveau rendu avec les mêmes coordonnées
    // (référence d'objet différente mais point identique) ne doit pas
    // redéclencher un survol de la carte.
    const last = lastFlownToRef.current;
    if (last && last.lat === flyToPoint.lat && last.lng === flyToPoint.lng) return;
    lastFlownToRef.current = flyToPoint;
    return onceStyleReady(map, () => {
      map.flyTo({ center: [flyToPoint.lng, flyToPoint.lat], zoom: Math.max(map.getZoom(), 6), speed: 1.4 });
    });
  }, [flyToPoint]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
});

/**
 * Les silhouettes sont créées avec `pointer-events: none` (pour laisser le
 * clic de dessin de trajet traverser jusqu'à la carte) : ici on les rend
 * cliquables et on empêche ce clic de aussi déclencher un point de trajet
 * sous le navire.
 */
function attachShipMarkerClick(el: HTMLDivElement, id: string, handlerRef: { current: ((id: string) => void) | undefined }) {
  el.style.pointerEvents = "auto";
  el.style.cursor = "pointer";
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    handlerRef.current?.(id);
  });
}

function fitMapToPoints(map: MapLibreMap, points: LatLng[]) {
  const bounds = points.reduce(
    (acc, p) => acc.extend([p.lng, p.lat]),
    new LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat])
  );
  map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
}

/** Sous ce seuil, la silhouette à l'échelle serait de toute façon illisible (quelques dixièmes de pixel). */
const MIN_SILHOUETTE_HEIGHT_PX = 10;
/** Rapport hauteur/largeur des silhouettes (viewBox "0 0 24 48", voir shipSilhouettes.ts). */
const SILHOUETTE_ASPECT = 24 / 48;

/** Longueur en pixels écran d'un segment de `lengthMeters` partant de (lat,lng) vers le nord, dans la vue actuelle. */
function metersToScreenPx(map: MapLibreMap, lat: number, lng: number, lengthMeters: number): number {
  const p1 = map.project([lng, lat]);
  const p2 = map.project([lng, lat + lengthMeters / 111320]);
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Affiche/masque les silhouettes selon le seuil de zoom, et dimensionne
 * chacune à sa taille réelle à l'échelle de la carte (avec un plancher
 * lisible : en dessous, un navire de quelques dizaines de mètres serait
 * de toute façon un pixel invisible à ce zoom).
 */
function applyShipMarkerLayout(map: MapLibreMap | null, markers: Map<string, ShipMarkerEntry>, minZoom: number) {
  if (!map) return;
  const visible = map.getZoom() >= minZoom;
  for (const entry of markers.values()) {
    entry.el.style.display = visible ? "flex" : "none";
    if (!visible) continue;
    const heightPx = Math.max(MIN_SILHOUETTE_HEIGHT_PX, metersToScreenPx(map, entry.lat, entry.lng, entry.lengthMeters));
    const widthPx = heightPx * SILHOUETTE_ASPECT;
    const svg = entry.el.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", String(widthPx));
      svg.setAttribute("height", String(heightPx));
    }
  }
}

function applyLayer(map: MapLibreMap, config: MapSourceConfig) {
  const existing = map.getSource(config.id) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(config.data);
    return;
  }

  map.addSource(config.id, { type: "geojson", data: config.data });
  const colorExpr = config.colorByFeature ? (["get", "color"] as unknown as string) : (config.color ?? "#22d3ee");

  if (config.kind === "line") {
    map.addLayer({
      id: `${config.id}-line`,
      type: "line",
      source: config.id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": colorExpr,
        "line-width": config.width ?? 2,
        ...(config.dashed ? { "line-dasharray": [2, 2] } : {}),
      },
    });
    return;
  }

  // S'estompe juste avant `fadeAboveZoom` pour disparaître complètement une
  // fois ce zoom atteint (typiquement le seuil où la silhouette du navire
  // prend le relais) : évite d'avoir les deux superposés.
  const fadeExpr = config.fadeAboveZoom
    ? (["interpolate", ["linear"], ["zoom"], config.fadeAboveZoom - 0.5, 1, config.fadeAboveZoom, 0] as unknown as number)
    : 1;

  map.addLayer({
    id: `${config.id}-circle`,
    type: "circle",
    source: config.id,
    paint: {
      "circle-color": colorExpr,
      "circle-radius": config.radius ?? 6,
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 1.5,
      "circle-opacity": fadeExpr,
      "circle-stroke-opacity": fadeExpr,
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
        "text-opacity": fadeExpr,
        "text-halo-width": 1,
      },
    });
  }
}
