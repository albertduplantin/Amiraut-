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

let smokeIdCounter = 0;

/**
 * Panache de fumée superposé au-dessus de la silhouette (position absolue,
 * hors flux : ne modifie donc pas la boîte englobante que MapLibre utilise
 * pour ancrer le marqueur sur ses coordonnées réelles). `dense` = navire
 * coulé (fumée noire épaisse), sinon navire endommagé (fumée plus légère).
 *
 * Rendu par dégradés radiaux + flou gaussien (plutôt que des ronds nets) pour
 * un aspect vaporeux : la base du panache est sombre et dense, il s'éclaircit
 * et se disperse en montant, comme un vrai panache de fumée.
 */
function buildSmokeOverlay(heightPx: number, dense: boolean): string {
  const scale = heightPx / 42;
  const w = Math.round(30 * scale);
  const h = Math.round(38 * scale);
  const id = `smoke${smokeIdCounter++}`;
  const baseColor = dense ? "#151b26" : "#94a3b8";
  const lightColor = dense ? "#57657a" : "#e2e8f0";
  const opacity = dense ? 0.88 : 0.55;

  return `
    <svg width="${w}" height="${h}" viewBox="0 0 30 38" style="position:absolute;left:50%;top:0;transform:translate(-50%,-90%);pointer-events:none;overflow:visible;">
      <defs>
        <filter id="${id}b" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.7" />
        </filter>
        <radialGradient id="${id}g1">
          <stop offset="0%" stop-color="${baseColor}" stop-opacity="${opacity}" />
          <stop offset="100%" stop-color="${baseColor}" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="${id}g2">
          <stop offset="0%" stop-color="${lightColor}" stop-opacity="${opacity * 0.7}" />
          <stop offset="100%" stop-color="${lightColor}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g class="smoke-plume" filter="url(#${id}b)" style="animation: smoke-rise ${dense ? 5 : 6.5}s ease-in-out infinite; transform-origin: 15px 30px;">
        <ellipse cx="15" cy="31" rx="7" ry="6" fill="url(#${id}g1)" />
        <ellipse cx="10.5" cy="22" rx="6" ry="5.2" fill="url(#${id}g1)" />
        <ellipse cx="19.5" cy="18" rx="5.4" ry="4.8" fill="url(#${id}g1)" />
        <ellipse cx="12.5" cy="10" rx="4.6" ry="4" fill="url(#${id}g2)" />
        <ellipse cx="20" cy="6.5" rx="3.6" ry="3.2" fill="url(#${id}g2)" />
      </g>
    </svg>
  `;
}

/**
 * Vecteur vitesse : un trait avec pointe de flèche partant de l'étrave,
 * dans l'axe du navire (la rotation du marqueur entier fait déjà le
 * travail d'orientation — pas besoin de recalculer un cap ici). Longueur
 * normalisée par rapport à une vitesse de référence (typiquement la
 * vitesse max du navire) plutôt qu'à une distance réelle : donne un repère
 * visuel immédiat ("je vais vite/lentement") sans prétendre à une échelle
 * de navigation précise. En pointillés et plus pâle pour un cap/vitesse
 * *estimé* (contact ennemi, déduit du déplacement entre deux relevés) —
 * une donnée de brouillard de guerre, pas une certitude.
 */
function buildVectorOverlay(heightPx: number, speedRatio: number, color: string, estimated: boolean): string {
  if (speedRatio <= 0.02) return "";
  const scale = heightPx / 42;
  // Une vitesse à la référence (ratio 1) étend le vecteur d'à peu près la
  // longueur du navire lui-même — repère lisible sans déborder la carte.
  const lengthUnits = Math.min(1, speedRatio) * 40;
  const w = Math.round(16 * scale);
  const h = Math.round((lengthUnits + 8) * scale);
  const opacity = estimated ? 0.55 : 0.9;
  const dash = estimated ? ' stroke-dasharray="3,2.5"' : "";
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 16 ${lengthUnits + 8}" style="position:absolute;left:50%;bottom:100%;transform:translate(-50%,2px);pointer-events:none;overflow:visible;opacity:${opacity};">
      <line x1="8" y1="${lengthUnits + 6}" x2="8" y2="6" stroke="${color}" stroke-width="1.6" stroke-linecap="round"${dash} />
      <path d="M8 0 L12 8 L8 6 L4 8 Z" fill="${color}" />
    </svg>
  `;
}

/**
 * Sillage : léger panache blanc s'évasant depuis la poupe, uniquement si le
 * navire est en mouvement. Taille fixe (pas liée à la vitesse, contrairement
 * au vecteur) — un effet d'ambiance qui se lit surtout une fois zoomé, la
 * silhouette entière (dont ce panache fait partie) étant redimensionnée au
 * zoom par `applyShipMarkerLayout`.
 */
function buildWakeOverlay(heightPx: number): string {
  const scale = heightPx / 42;
  const w = Math.round(20 * scale);
  const h = Math.round(16 * scale);
  return `
    <svg width="${w}" height="${h}" viewBox="0 0 20 16" style="position:absolute;left:50%;top:100%;transform:translate(-50%,-3px);pointer-events:none;overflow:visible;opacity:0.5;">
      <path d="M10 0 L4 14 M10 0 L16 14" stroke="#e2e8f0" stroke-width="1.2" stroke-linecap="round" fill="none" />
    </svg>
  `;
}

export function buildSilhouetteElement(params: {
  silhouette: SilhouetteKey;
  color: string;
  heightPx?: number;
  label?: string;
  status?: UnitVisualStatus;
  /** Vitesse actuelle (nds), pour le vecteur et le sillage ; absent/0 = aucun des deux affiché. */
  speedKnots?: number;
  /** Vitesse de référence (typiquement la vitesse max du navire) normalisant la longueur du vecteur. */
  referenceSpeedKnots?: number;
  /** Cap/vitesse estimés plutôt que certains (contact ennemi) : vecteur en pointillés, plus pâle. */
  vectorEstimated?: boolean;
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
  // Pas de `position` ici : MapLibre applique déjà `position: absolute` via sa
  // propre classe `.maplibregl-marker` (nécessaire pour que le marqueur se
  // positionne par transform ET pour qu'il se redimensionne à son contenu —
  // un style inline l'écraserait et ferait déborder l'élément à toute la
  // largeur de la carte, créant des zones de survol/clic qui se chevauchent
  // entre navires proches). `position: absolute` reste un contexte de
  // positionnement valable pour l'overlay de fumée ci-dessous.
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
    ${
      !isSunk && params.speedKnots
        ? buildVectorOverlay(heightPx, params.speedKnots / (params.referenceSpeedKnots || params.speedKnots || 1), params.color, params.vectorEstimated ?? false)
        : ""
    }
    ${!isSunk && params.speedKnots && params.speedKnots > 0.5 ? buildWakeOverlay(heightPx) : ""}
  `;
  return wrapper;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
