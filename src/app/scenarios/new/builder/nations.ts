/**
 * Nationalité de camp (retour utilisateur 2026-08-15, troisième chantier
 * constructeur) : remplace le sélecteur de couleur manuel d'une équipe —
 * choisir un drapeau fixe la nation du camp, qui filtre ensuite la
 * bibliothèque (Phase 7) et pilote automatiquement la couleur d'affichage
 * (silhouettes sur la carte). Six nations, cohérentes avec les valeurs déjà
 * utilisées dans `LibraryUnitClass.nation` ("Royaume-Uni"/"Allemagne" pour
 * les classes existantes).
 */
export type Nation = { value: string; label: string; flag: string; colorHex: string };

export const NATIONS: Nation[] = [
  { value: "Royaume-Uni", label: "Royaume-Uni", flag: "🇬🇧", colorHex: "#3b82f6" },
  { value: "Allemagne", label: "Allemagne", flag: "🇩🇪", colorHex: "#6b7280" },
  { value: "États-Unis", label: "États-Unis", flag: "🇺🇸", colorHex: "#16a34a" },
  { value: "URSS", label: "URSS", flag: "🇷🇺", colorHex: "#dc2626" },
  { value: "Italie", label: "Italie", flag: "🇮🇹", colorHex: "#14b8a6" },
  { value: "Japon", label: "Japon", flag: "🇯🇵", colorHex: "#f97316" },
];

const BY_VALUE = new Map(NATIONS.map((n) => [n.value, n]));

/** Couleur d'affichage associée à une nation — repli neutre si valeur non reconnue (scénario ancien sans nation). */
export function nationColor(nation: string | undefined): string {
  return (nation && BY_VALUE.get(nation)?.colorHex) || "#94a3b8";
}

export function nationFlag(nation: string | undefined): string {
  return (nation && BY_VALUE.get(nation)?.flag) || "🏳";
}
