"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  LngLatBounds,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { distanceNm, type LatLng } from "@/lib/geo";
import { buildSilhouetteElement, type SilhouetteKey, type UnitVisualStatus } from "@/lib/shipSilhouettes";

export type MapSourceConfig = {
  id: string;
  data: GeoJSON.FeatureCollection;
  kind: "points" | "line";
  color?: string;
  /** Si vrai, utilise la propriété `color` de chaque feature au lieu de `color`. */
  colorByFeature?: boolean;
  /** Si vrai, utilise la propriété `opacity` de chaque feature (ligne uniquement) — ex: sillage qui s'estompe. */
  opacityByFeature?: boolean;
  /** Si vrai, utilise la propriété `width` de chaque feature (ligne uniquement). */
  widthByFeature?: boolean;
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
  /** Vitesse actuelle (nds) : affiche un vecteur devant l'étrave et un sillage. Absent/0 = aucun des deux. */
  speedKnots?: number;
  /** Vitesse de référence (typiquement la vitesse max) normalisant la longueur du vecteur. */
  referenceSpeedKnots?: number;
  /** Cap/vitesse estimés (contact ennemi, pas une donnée certaine) : vecteur en pointillés, plus pâle. */
  vectorEstimated?: boolean;
  /** Part du potentiel max déjà perdue (0-1) : gradue l'intensité du panache de fumée. Absent/0 = pas de fumée (sauf coulé). */
  damageRatio?: number;
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
  /**
   * Survol d'une silhouette de navire : appelé avec son id et la position
   * écran du curseur à l'entrée/déplacement, puis avec `null` à la sortie —
   * au parent d'afficher une infobulle positionnée à ces coordonnées.
   */
  onShipMarkerHover?: (id: string | null, clientPos: { x: number; y: number } | null) => void;
  /**
   * Affiche une barre d'échelle (en milles nautiques, recalculée à chaque
   * zoom) et un outil de mesure de distance activable par le joueur.
   */
  showScaleAndRuler?: boolean;
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
  {
    center,
    zoom = 5,
    sources,
    onClick,
    className,
    fitToPoints,
    flyToPoint,
    shipMarkers,
    shipMarkersMinZoom = 7,
    onShipMarkerClick,
    onShipMarkerHover,
    showScaleAndRuler = false,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onClickRef = useRef(onClick);
  const onShipMarkerClickRef = useRef(onShipMarkerClick);
  const onShipMarkerHoverRef = useRef(onShipMarkerHover);
  const fitToPointsRef = useRef(fitToPoints);
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<LatLng[]>([]);
  const rulerActiveRef = useRef(false);
  const isFirstFlyRef = useRef(true);
  const lastFlownToRef = useRef<LatLng | null>(null);
  const shipMarkersRef = useRef(new Map<string, ShipMarkerEntry>());
  const appliedSourceIdsRef = useRef(new Set<string>());

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    onShipMarkerClickRef.current = onShipMarkerClick;
  }, [onShipMarkerClick]);

  useEffect(() => {
    onShipMarkerHoverRef.current = onShipMarkerHover;
  }, [onShipMarkerHover]);

  useEffect(() => {
    rulerActiveRef.current = rulerActive;
  }, [rulerActive]);

  // Tracé de la règle de mesure : segments cumulés + jalons cliqués.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showScaleAndRuler) return;
    return onceStyleReady(map, () => {
      applyLayer(map, {
        id: "ruler-line",
        kind: "line",
        data:
          rulerPoints.length >= 2
            ? {
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: rulerPoints.map((p) => [p.lng, p.lat]) },
                    properties: {},
                  },
                ],
              }
            : { type: "FeatureCollection", features: [] },
        color: "#facc15",
        width: 2,
        dashed: true,
      });
      applyLayer(map, {
        id: "ruler-points",
        kind: "points",
        data: {
          type: "FeatureCollection",
          features: rulerPoints.map((p, i) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
            properties: { name: i === 0 ? "" : `${cumulativeNm(rulerPoints, i).toFixed(1)} nm` },
          })),
        },
        color: "#facc15",
        radius: 4,
        showLabels: true,
      });
    });
  }, [rulerPoints, showScaleAndRuler]);

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
      const point = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      // En mode mesure, le clic sert à jalonner la règle et ne doit pas
      // aussi poser un waypoint de trajet.
      if (rulerActiveRef.current) {
        setRulerPoints((prev) => [...prev, point]);
        return;
      }
      onClickRef.current?.(point);
    });

    if (showScaleAndRuler) {
      map.addControl(new ScaleControl({ unit: "nautical", maxWidth: 140 }), "bottom-left");
    }

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
      const incomingIds = new Set(sources.map((s) => s.id));
      // Une source qui a disparu de la liste (ex: le tracé de mouvement une
      // fois passé en phase de tir) doit être retirée de la carte — sans
      // ça, la dernière donnée appliquée reste affichée indéfiniment, même
      // après que le composant ait cessé de la fournir.
      for (const id of appliedSourceIdsRef.current) {
        if (!incomingIds.has(id)) removeLayerAndSource(map, id);
      }
      for (const source of sources) applyLayer(map, source);
      appliedSourceIdsRef.current = incomingIds;
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
      const signature = `${config.silhouette}|${config.color}|${config.label ?? ""}|${config.status ?? ""}|${Math.round((config.speedKnots ?? 0) * 2)}|${config.vectorEstimated ?? false}|${Math.round((config.damageRatio ?? 0) * 20)}`;
      const current = existing.get(config.id);
      if (!current) {
        const el = buildSilhouetteElement(config);
        attachShipMarkerInteractions(el, config.id, onShipMarkerClickRef, onShipMarkerHoverRef);
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
        attachShipMarkerInteractions(el, config.id, onShipMarkerClickRef, onShipMarkerHoverRef);
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

  const rulerTotalNm = cumulativeNm(rulerPoints, rulerPoints.length - 1);

  if (!showScaleAndRuler) {
    return <div ref={containerRef} className={className ?? "h-full w-full"} />;
  }

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        <button
          onClick={() => {
            setRulerActive((active) => !active);
            if (rulerActive) setRulerPoints([]);
          }}
          className={`rounded-md border px-2 py-1 text-xs shadow-lg transition ${
            rulerActive
              ? "border-yellow-400 bg-yellow-500/90 text-slate-900"
              : "border-slate-600 bg-slate-900/90 text-slate-200 hover:bg-slate-800"
          }`}
          title="Mesurer une distance : cliquez des points successifs sur la carte"
        >
          📏 {rulerActive ? "Mesure active" : "Mesurer"}
        </button>

        {rulerActive && (
          <div className="rounded-md border border-slate-600 bg-slate-900/90 px-2 py-1 text-right text-xs text-slate-200 shadow-lg">
            {rulerPoints.length < 2 ? (
              <span className="text-slate-400">Cliquez deux points ou plus</span>
            ) : (
              <>
                <div className="font-medium">{rulerTotalNm.toFixed(1)} nm</div>
                <div className="text-slate-400">{(rulerTotalNm * 1.852).toFixed(1)} km</div>
              </>
            )}
            {rulerPoints.length > 0 && (
              <button onClick={() => setRulerPoints([])} className="mt-1 text-[10px] text-slate-400 underline hover:text-slate-200">
                effacer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** Distance cumulée le long de la règle, du premier jalon jusqu'à l'indice donné. */
function cumulativeNm(points: LatLng[], upToIndex: number): number {
  let total = 0;
  for (let i = 1; i <= upToIndex && i < points.length; i++) {
    total += distanceNm(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Les silhouettes sont créées avec `pointer-events: none` (pour laisser le
 * clic de dessin de trajet traverser jusqu'à la carte) : ici on les rend
 * cliquables et on empêche ce clic de aussi déclencher un point de trajet
 * sous le navire.
 */
function attachShipMarkerInteractions(
  el: HTMLDivElement,
  id: string,
  clickHandlerRef: { current: ((id: string) => void) | undefined },
  hoverHandlerRef: { current: ((id: string | null, clientPos: { x: number; y: number } | null) => void) | undefined }
) {
  el.style.pointerEvents = "auto";
  el.style.cursor = "pointer";
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    clickHandlerRef.current?.(id);
  });
  el.addEventListener("mouseenter", (ev) => {
    hoverHandlerRef.current?.(id, { x: ev.clientX, y: ev.clientY });
  });
  el.addEventListener("mousemove", (ev) => {
    hoverHandlerRef.current?.(id, { x: ev.clientX, y: ev.clientY });
  });
  el.addEventListener("mouseleave", () => {
    hoverHandlerRef.current?.(null, null);
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

/** Retire une source GeoJSON et toutes les couches qu'`applyLayer` a pu y attacher (ligne, cercle, étiquette). */
function removeLayerAndSource(map: MapLibreMap, id: string) {
  for (const layerId of [`${id}-line`, `${id}-circle`, `${id}-label`]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource(id)) map.removeSource(id);
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
    const opacityExpr = config.opacityByFeature ? (["get", "opacity"] as unknown as number) : 1;
    const widthExpr = config.widthByFeature ? (["get", "width"] as unknown as number) : (config.width ?? 2);
    map.addLayer({
      id: `${config.id}-line`,
      type: "line",
      source: config.id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": colorExpr,
        "line-width": widthExpr,
        "line-opacity": opacityExpr,
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
