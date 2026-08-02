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

export function buildSilhouetteElement(params: {
  silhouette: SilhouetteKey;
  color: string;
  heightPx?: number;
  label?: string;
}): HTMLDivElement {
  const heightPx = params.heightPx ?? 42;
  const widthPx = Math.round((heightPx * 24) / 48);

  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.pointerEvents = "none";

  wrapper.innerHTML = `
    <svg width="${widthPx}" height="${heightPx}" viewBox="0 0 24 48" fill="${params.color}" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round">
      ${SILHOUETTE_PATHS[params.silhouette]}
    </svg>
    ${
      params.label
        ? `<span style="margin-top:2px;font-size:10px;line-height:1;color:#e2e8f0;text-shadow:0 0 3px #0f172a,0 0 3px #0f172a;white-space:nowrap;">${escapeHtml(
            params.label
          )}</span>`
        : ""
    }
  `;
  return wrapper;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
