import distance from "@turf/distance";
import bearing from "@turf/bearing";
import destination from "@turf/destination";
import { point } from "@turf/helpers";

export type LatLng = { lat: number; lng: number };

function toPoint(p: LatLng) {
  return point([p.lng, p.lat]);
}

export function distanceNm(a: LatLng, b: LatLng): number {
  return distance(toPoint(a), toPoint(b), { units: "nauticalmiles" });
}

export function bearingDeg(from: LatLng, to: LatLng): number {
  return bearing(toPoint(from), toPoint(to));
}

export function destinationPoint(from: LatLng, bearingDegrees: number, distanceNauticalMiles: number): LatLng {
  const feature = destination(toPoint(from), distanceNauticalMiles, bearingDegrees, {
    units: "nauticalmiles",
  });
  const [lng, lat] = feature.geometry.coordinates;
  return { lat, lng };
}

/** Somme des distances entre points consécutifs d'un chemin. */
export function pathLengthNm(points: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distanceNm(points[i], points[i + 1]);
  }
  return total;
}

/**
 * Distance maximale parcourable pendant `durationMinutes` à `speedKnots`.
 */
export function speedBudgetNm(speedKnots: number, durationMinutes: number): number {
  return speedKnots * (durationMinutes / 60);
}

/**
 * Si le chemin dépasse le budget, ramène le dernier point au point le plus loin
 * atteignable sur le cap du dernier segment. Ne modifie pas les segments déjà
 * dans le budget.
 */
export function clampPathToBudget(points: LatLng[], budgetNm: number): LatLng[] {
  if (points.length < 2) return points;

  const clamped: LatLng[] = [points[0]];
  let usedNm = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = clamped[clamped.length - 1];
    const segmentNm = distanceNm(prev, points[i]);

    if (usedNm + segmentNm <= budgetNm) {
      clamped.push(points[i]);
      usedNm += segmentNm;
      continue;
    }

    const remainingNm = Math.max(0, budgetNm - usedNm);
    if (remainingNm > 0) {
      const brg = bearingDeg(prev, points[i]);
      clamped.push(destinationPoint(prev, brg, remainingNm));
      usedNm = budgetNm;
    }
    break;
  }

  return clamped;
}

/** Écart angulaire absolu entre deux caps (0-180°). */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Pénalité de distance (nm) représentant le rayon de virage réel du
 * navire : le tracé reste des segments droits à l'écran (simplification
 * volontaire, pas de rendu de courbes), mais chaque changement de cap à un
 * waypoint intérieur coûte la longueur de l'arc de cercle qu'un navire de
 * ce rayon de virage devrait réellement parcourir pour effectuer ce virage
 * — retranchée du budget de distance de la manche. Un virage à 180° avec
 * un grand rayon de virage coûte donc nettement plus qu'un léger
 * infléchissement de cap.
 */
export function turnPenaltyNm(points: LatLng[], turningRadiusNm: number): number {
  if (turningRadiusNm <= 0 || points.length < 3) return 0;
  let penalty = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const incoming = bearingDeg(points[i - 1], points[i]);
    const outgoing = bearingDeg(points[i], points[i + 1]);
    const turnDeg = angleDiff(incoming, outgoing);
    penalty += ((turnDeg * Math.PI) / 180) * turningRadiusNm;
  }
  return penalty;
}

type TimedTrack = {
  /** Position au temps `minutes` (bornée aux deux extrémités du chemin). */
  positionAt(minutesIntoTurn: number): LatLng;
  totalDurationMinutes: number;
};

/**
 * Construit une trajectoire paramétrée par le temps à partir d'un chemin de
 * waypoints parcouru à vitesse constante. Le premier point est la position de
 * départ (position actuelle de l'unité), pas un waypoint dessiné par le joueur.
 */
export function buildTimedTrack(points: LatLng[], speedKnots: number): TimedTrack {
  if (points.length === 0 || speedKnots <= 0) {
    const stationary = points[0] ?? { lat: 0, lng: 0 };
    return { positionAt: () => stationary, totalDurationMinutes: 0 };
  }

  const segments: { from: LatLng; to: LatLng; startMinute: number; durationMinutes: number }[] = [];
  let elapsedMinutes = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const segmentNm = distanceNm(points[i], points[i + 1]);
    const durationMinutes = (segmentNm / speedKnots) * 60;
    segments.push({ from: points[i], to: points[i + 1], startMinute: elapsedMinutes, durationMinutes });
    elapsedMinutes += durationMinutes;
  }

  const totalDurationMinutes = elapsedMinutes;

  function positionAt(minutesIntoTurn: number): LatLng {
    if (segments.length === 0) return points[0];
    if (minutesIntoTurn <= 0) return points[0];
    if (minutesIntoTurn >= totalDurationMinutes) return points[points.length - 1];

    const segment = segments.find(
      (s) => minutesIntoTurn >= s.startMinute && minutesIntoTurn <= s.startMinute + s.durationMinutes
    );
    if (!segment) return points[points.length - 1];
    if (segment.durationMinutes === 0) return segment.to;

    const fraction = (minutesIntoTurn - segment.startMinute) / segment.durationMinutes;
    const brg = bearingDeg(segment.from, segment.to);
    const segmentNm = distanceNm(segment.from, segment.to);
    return destinationPoint(segment.from, brg, segmentNm * fraction);
  }

  return { positionAt, totalDurationMinutes };
}
