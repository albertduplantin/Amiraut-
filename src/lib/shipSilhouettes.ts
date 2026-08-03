/**
 * Silhouettes génériques vues de dessus, utilisées quand aucune image
 * spécifique au type de navire n'est disponible (voir UnitClass.planImageUrl
 * pour une image dédiée future). Un jeu volontairement réduit de formes
 * (cargo, destroyer, croiseur, cuirassé, sous-marin, avion) suffit à
 * distinguer les unités au zoom élevé sans dépendre d'assets externes.
 *
 * Chaque tracé utilise un viewBox "0 0 24 48" avec la proue en haut
 * (y=0) : une rotation de 0° correspond donc à un cap au nord (0°), ce
 * qui permet de passer directement `currentHeadingDeg` en rotation CSS.
 */

export type SilhouetteKey = "cargo" | "destroyer" | "cruiser" | "battleship" | "submarine" | "aircraft";

const KEYWORD_RULES: [RegExp, SilhouetteKey][] = [
  [/cuirass|battleship|battlecruiser/i, "battleship"],
  [/croiseur|cruiser/i, "cruiser"],
  [/destroyer|torpilleur/i, "destroyer"],
  [/sous-marin|submarine|u-boot|u-boat/i, "submarine"],
  [/cargo|liberty|merchant|marchand/i, "cargo"],
  [/avion|aircraft|aéronef/i, "aircraft"],
];

/** Longueur générique de repli (m), utilisée seulement si UnitClass.lengthMeters n'est pas renseigné. */
export const DEFAULT_LENGTH_METERS: Record<SilhouetteKey, number> = {
  cargo: 135,
  destroyer: 110,
  cruiser: 180,
  battleship: 230,
  submarine: 67,
  aircraft: 12,
};

export function classifySilhouette(category: string, className: string): SilhouetteKey {
  if (category === "SUBMARINE") return "submarine";
  if (category === "AIRCRAFT") return "aircraft";
  for (const [pattern, key] of KEYWORD_RULES) {
    if (pattern.test(className)) return key;
  }
  return "cargo";
}

// Un seul rectangle "passerelle" par silhouette (plutôt que plusieurs petits
// éléments type tourelles/hublots) : au rendu sur la carte ces navires font
// ~35-45px de haut, où plusieurs petites formes se brouillent en un flou
// indistinct. La largeur et la longueur de la coque restent le principal
// signal visuel entre destroyer/croiseur/cuirassé.
export const SILHOUETTE_PATHS: Record<SilhouetteKey, string> = {
  cargo: `
    <path d="M12 1 L19 11 L19 39 Q19 45 12 47 Q5 45 5 39 L5 11 Z" />
    <rect x="8" y="19" width="8" height="11" />
  `,
  destroyer: `
    <path d="M12 1 L15.5 9 L15.5 40 L12 47 L8.5 40 L8.5 9 Z" />
    <rect x="9.5" y="20" width="5" height="8" />
  `,
  cruiser: `
    <path d="M12 1 L18 10 L18 39 L12 47 L6 39 L6 10 Z" />
    <rect x="8" y="18" width="8" height="11" />
  `,
  battleship: `
    <path d="M12 0 L21 12 L21 37 L12 48 L3 37 L3 12 Z" />
    <rect x="6" y="16" width="12" height="15" />
  `,
  submarine: `
    <ellipse cx="12" cy="24" rx="5" ry="23" />
    <rect x="9" y="17" width="6" height="10" />
  `,
  aircraft: `
    <path d="M12 0 L14 10 L23 20 L23 23 L14 20 L14 32 L19 36 L19 38 L14 37 L12 48 L10 37 L5 38 L5 36 L10 32 L10 20 L1 23 L1 20 L10 10 Z" />
  `,
};

export type UnitVisualStatus = "ACTIVE" | "DAMAGED" | "SUNK";

/**
 * Panache de fumée superposé au-dessus de la silhouette (position absolue,
 * hors flux : ne modifie donc pas la boîte englobante que MapLibre utilise
 * pour ancrer le marqueur sur ses coordonnées réelles). `dense` = navire
 * coulé (fumée noire épaisse), sinon navire endommagé (fumée plus légère).
 */
function buildSmokeOverlay(heightPx: number, dense: boolean): string {
  const scale = heightPx / 42;
  const w = Math.round(24 * scale);
  const h = Math.round(20 * scale);
  const opacity = dense ? 0.8 : 0.5;
  const color = dense ? "#1e293b" : "#94a3b8";
  const puffs = dense
    ? `<circle cx="12" cy="16" r="7" /><circle cx="6" cy="10" r="5" /><circle cx="18" cy="9" r="5.5" /><circle cx="11" cy="4" r="4" />`
    : `<circle cx="12" cy="14" r="5" /><circle cx="7" cy="9" r="3.5" /><circle cx="17" cy="8" r="3.5" />`;
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 24 20" style="position:absolute;left:50%;top:0;transform:translate(-50%,-85%);pointer-events:none;opacity:${opacity};">
      <g fill="${color}">${puffs}</g>
    </svg>
  `;
}

export function buildSilhouetteElement(params: {
  silhouette: SilhouetteKey;
  color: string;
  heightPx?: number;
  label?: string;
  status?: UnitVisualStatus;
}): HTMLDivElement {
  const heightPx = params.heightPx ?? 42;
  const widthPx = Math.round((heightPx * 24) / 48);
  const isSunk = params.status === "SUNK";
  const isDamaged = params.status === "DAMAGED";
  // Épave : coque grisée/assombrie (plus la couleur d'équipe, qui n'a plus de
  // sens pour un navire hors de combat) et croix rouge marquant la perte.
  const hullColor = isSunk ? "#475569" : params.color;
  const hullOpacity = isSunk ? 0.6 : 1;

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.pointerEvents = "none";

  wrapper.innerHTML = `
    <svg width="${widthPx}" height="${heightPx}" viewBox="0 0 24 48" fill="${hullColor}" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round" style="opacity:${hullOpacity}">
      ${SILHOUETTE_PATHS[params.silhouette]}
      ${isSunk ? '<path d="M5 18 L19 34 M19 18 L5 34" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" />' : ""}
    </svg>
    ${
      params.label
        ? `<span style="margin-top:2px;font-size:10px;line-height:1;color:#e2e8f0;text-shadow:0 0 3px #0f172a,0 0 3px #0f172a;white-space:nowrap;">${escapeHtml(
            params.label
          )}</span>`
        : ""
    }
    ${isSunk || isDamaged ? buildSmokeOverlay(heightPx, isSunk) : ""}
  `;
  return wrapper;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
