import type { SilhouetteKey } from "@/lib/shipSilhouettes";
import type { UnitCategory } from "./types";

/**
 * Taxonomie fine des types de bâtiments/avions (retour utilisateur
 * 2026-08-15, deuxième chantier constructeur) — remplace les 6 options
 * génériques d'`iconKey` ("Icône carte") par une liste utile pour filtrer/
 * choisir dans l'assistant guidé (Phase 3) : "cliquer sur une task force →
 * choisir le type de bâtiment → la liste se déploie". Porte aussi le rendu
 * de la silhouette sur la carte (voir shipSilhouettes.ts,
 * SHIP_TYPE_HINT_TO_SILHOUETTE), mais reste un champ libre côté schéma
 * (`iconKey: String`, aucune migration Prisma) — voir le plan.
 */
export type ShipTypeKey = "battleship" | "heavy-cruiser" | "light-cruiser" | "carrier" | "destroyer" | "escort" | "cargo";
export type AircraftTypeKey = "fighter" | "bomber" | "patrol" | "torpedo-bomber";

export const SHIP_TYPES: { key: ShipTypeKey; label: string }[] = [
  { key: "battleship", label: "Cuirassé" },
  { key: "heavy-cruiser", label: "Croiseur lourd" },
  { key: "light-cruiser", label: "Croiseur léger" },
  { key: "carrier", label: "Porte-avions" },
  { key: "destroyer", label: "Destroyer" },
  { key: "escort", label: "Torpilleur / escorteur" },
  { key: "cargo", label: "Cargo / marchand" },
];

export const AIRCRAFT_TYPES: { key: AircraftTypeKey; label: string }[] = [
  { key: "fighter", label: "Chasseur" },
  { key: "bomber", label: "Bombardier" },
  { key: "patrol", label: "Patrouille maritime / reconnaissance" },
  { key: "torpedo-bomber", label: "Torpilleur aérien" },
];

const SHIP_TYPE_LABEL = new Map(SHIP_TYPES.map((t) => [t.key as string, t.label]));
const AIRCRAFT_TYPE_LABEL = new Map(AIRCRAFT_TYPES.map((t) => [t.key as string, t.label]));

/** Libellé lisible pour un `iconKey` donné, selon la catégorie de la classe — replis raisonnables si la valeur n'est pas reconnue. */
export function typeLabel(category: UnitCategory, iconKey: string): string {
  if (category === "SUBMARINE") return "Sous-marin";
  if (category === "AIRCRAFT") return AIRCRAFT_TYPE_LABEL.get(iconKey) ?? "Avion";
  return SHIP_TYPE_LABEL.get(iconKey) ?? "Navire";
}

export const SHIP_TYPE_TO_SILHOUETTE: Record<ShipTypeKey, SilhouetteKey> = {
  battleship: "battleship",
  "heavy-cruiser": "cruiser",
  "light-cruiser": "cruiser",
  carrier: "carrier",
  destroyer: "destroyer",
  escort: "destroyer",
  cargo: "cargo",
};
