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

/**
 * Remplace chaque angle intérieur d'un chemin par une courbe arrondie au
 * rayon de virage `radiusNm` plutôt qu'un coin à angle vif — un navire de
 * cette époque ne tourne pas sur place. Purement cosmétique : la distance
 * réelle du trajet (budget, pénalité de virage) reste calculée sur les
 * points d'origine via pathLengthNm/turnPenaltyNm, jamais sur ce résultat —
 * à n'utiliser que pour construire la géométrie affichée sur la carte.
 *
 * Approxime l'arc de cercle par une courbe de Bézier quadratique (point de
 * contrôle au coin d'origine) plutôt qu'un vrai arc : la précision
 * géométrique exacte ne change rien au rendu à l'échelle d'une carte, et
 * évite d'avoir à localiser le centre du cercle en coordonnées géographiques.
 */
export function filletPath(points: LatLng[], radiusNm: number, segments = 8): LatLng[] {
  if (points.length < 3 || radiusNm <= 0) return points;

  const result: LatLng[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];

    const distIn = distanceNm(prev, corner);
    const distOut = distanceNm(corner, next);
    const bearingIn = bearingDeg(prev, corner);
    const bearingOut = bearingDeg(corner, next);
    const turnDeg = angleDiff(bearingIn, bearingOut);

    // Coin quasi droit, ou segments trop courts pour y loger un arc : on le
    // garde tel quel plutôt que de produire une courbe dégénérée.
    if (turnDeg < 2 || distIn < 0.02 || distOut < 0.02) {
      result.push(corner);
      continue;
    }

    const tangent = Math.min(radiusNm * Math.tan((turnDeg * Math.PI) / 360), distIn * 0.49, distOut * 0.49);
    if (tangent < 0.01) {
      result.push(corner);
      continue;
    }

    const arcStart = destinationPoint(corner, (bearingIn + 180) % 360, tangent);
    const arcEnd = destinationPoint(corner, bearingOut, tangent);

    result.push(arcStart);
    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const mt = 1 - t;
      result.push({
        lat: mt * mt * arcStart.lat + 2 * mt * t * corner.lat + t * t * arcEnd.lat,
        lng: mt * mt * arcStart.lng + 2 * mt * t * corner.lng + t * t * arcEnd.lng,
      });
    }
    result.push(arcEnd);
  }
  result.push(points[points.length - 1]);
  return result;
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
