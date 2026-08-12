import type { Daylight, Precipitation, SensorType } from "@/generated/prisma/client";

export type WeatherConditions = {
  visibilityNm: number;
  seaState: number; // 0-9, échelle Beaufort approximative
  daylight: Daylight;
  precipitation: Precipitation;
};

const DAYLIGHT_VISUAL_MULTIPLIER: Record<Daylight, number> = {
  DAY: 1,
  POLAR_DAY: 1,
  TWILIGHT: 0.6,
  NIGHT: 0.25,
  POLAR_NIGHT: 0.1,
};

const PRECIPITATION_VISUAL_MULTIPLIER: Record<Precipitation, number> = {
  NONE: 1,
  RAIN: 0.7,
  SNOW: 0.5,
  FOG: 0.2,
};

const PRECIPITATION_RADAR_MULTIPLIER: Record<Precipitation, number> = {
  NONE: 1,
  RAIN: 0.95,
  SNOW: 0.9,
  FOG: 1, // le radar n'est pas gêné par le brouillard
};

/**
 * Portée effective d'un capteur, compte tenu de la météo et de la
 * détectabilité de la cible. `baseRangeNm` vient de `UnitClass.sensors`.
 */
export function effectiveSensorRangeNm(
  sensorType: SensorType,
  baseRangeNm: number,
  weather: WeatherConditions,
  targetDetectability: number,
  observerSpeedKnots = 0
): number {
  switch (sensorType) {
    case "VISUAL": {
      const range = Math.min(baseRangeNm, weather.visibilityNm);
      return (
        range *
        DAYLIGHT_VISUAL_MULTIPLIER[weather.daylight] *
        PRECIPITATION_VISUAL_MULTIPLIER[weather.precipitation] *
        targetDetectability
      );
    }
    case "RADAR": {
      const seaClutterMultiplier = weather.seaState >= 6 ? 0.9 : 1;
      return (
        baseRangeNm *
        PRECIPITATION_RADAR_MULTIPLIER[weather.precipitation] *
        seaClutterMultiplier *
        targetDetectability
      );
    }
    case "HF_DF":
      // Goniométrie radio : la portée dépend de la sensibilité de
      // l'équipement d'écoute, pas de la météo ni du profil de la cible
      // (contrairement au visuel/radar/hydrophone). Voir Signal et
      // resolveTurnDetections pour le déclenchement.
      return baseRangeNm;
    case "HYDROPHONE":
    case "SONAR": {
      const seaStateMultiplier = clamp(1 - weather.seaState * 0.08, 0.2, 1);
      // Le bruit propre de l'écouteur masque le signal à grande vitesse : les
      // hydrophones allemands perdaient l'essentiel de leur portée au-delà de
      // 15 nds (uboat.net/articles/id/52). Ne s'applique qu'à l'écoute, pas
      // au radar/visuel.
      const selfNoiseMultiplier = clamp(1 / (1 + observerSpeedKnots / 3), 0.05, 1);
      return baseRangeNm * seaStateMultiplier * selfNoiseMultiplier * targetDetectability;
    }
    default:
      return baseRangeNm * targetDetectability;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
