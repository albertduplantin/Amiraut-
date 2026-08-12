/**
 * Récits de tir et calcul du risque de se trahir en ouvrant le feu.
 *
 * Deux objectifs distincts :
 *  - donner au joueur un compte rendu vivant après chaque coup, plutôt
 *    qu'une ligne de chiffres ;
 *  - lui dire AVANT de tirer ce que son tir va coûter en discrétion, parce
 *    qu'ouvrir le feu se voit : le feu de bouche d'une grosse pièce était
 *    visible à des milles par nuit noire (c'est ainsi que plusieurs
 *    engagements nocturnes de 1943 ont commencé), et une torpille à vapeur
 *    laisse un sillage de bulles qui remonte jusqu'au tireur.
 */

import type { WeaponType } from "@/generated/prisma/client";
import type { HitChanceBreakdown, LocalizedDamageDebug } from "@/lib/combat";

// ── Risque de révélation ────────────────────────────────────

export type RevealAssessment = {
  /** Rayon (nm) dans lequel le tir trahit la position du tireur à la manche suivante. */
  revealRadiusNm: number;
  /** Formulation courte affichée au joueur avant le tir. */
  label: string;
  /** Pourquoi, en une phrase. */
  reason: string;
  severity: "none" | "low" | "medium" | "high";
};

/**
 * Un feu de bouche porte beaucoup plus loin de nuit que de jour : de jour
 * la lueur se noie dans la lumière ambiante, seule la fumée trahit ; de
 * nuit elle illumine l'horizon.
 */
function muzzleFlashRadiusNm(calibreMm: number, isNight: boolean): number {
  const base = calibreMm >= 280 ? 14 : calibreMm >= 150 ? 9 : 5;
  return isNight ? base : base * 0.45;
}

export function assessFiringReveal(params: {
  weaponType: WeaponType;
  calibreMm?: number | null;
  torpedoWakeVisible?: boolean;
  isNight: boolean;
}): RevealAssessment {
  switch (params.weaponType) {
    case "GUN": {
      const radius = muzzleFlashRadiusNm(params.calibreMm ?? 120, params.isNight);
      return {
        revealRadiusNm: radius,
        label: `Position révélée jusqu'à ~${radius.toFixed(0)} nm`,
        reason: params.isNight
          ? "Le feu de bouche illumine l'horizon : de nuit, tout bâtiment dans ce rayon vous situe."
          : "La fumée et la lueur des départs vous désignent à courte distance.",
        severity: radius >= 10 ? "high" : radius >= 5 ? "medium" : "low",
      };
    }
    case "TORPEDO": {
      if (params.torpedoWakeVisible) {
        return {
          revealRadiusNm: 4,
          label: "Sillage remontant jusqu'à vous (~4 nm)",
          reason: "La torpille à vapeur laisse une traînée de bulles : la cible peut en remonter l'origine.",
          severity: "medium",
        };
      }
      return {
        revealRadiusNm: 0,
        label: "Aucune trace",
        reason: "La torpille électrique ne laisse pas de sillage : votre position reste inconnue.",
        severity: "none",
      };
    }
    case "DEPTH_CHARGE":
      return {
        revealRadiusNm: 6,
        label: "Explosions entendues loin (~6 nm)",
        reason: "Les grenades s'entendent à grande distance sous l'eau et signalent une chasse en cours.",
        severity: "medium",
      };
    default:
      return { revealRadiusNm: 0, label: "Aucune trace", reason: "", severity: "none" };
  }
}

// ── Récit du coup ───────────────────────────────────────────

function pick(list: string[], rng: () => number): string {
  return list[Math.floor(rng() * list.length)] ?? list[0];
}

export type NarrativeInput = {
  attackerName: string;
  targetName: string;
  weaponType: WeaponType;
  hit: boolean;
  hits: number;
  damagePoints: number;
  /** Part du potentiel total de la cible retirée par ce coup (0-1). */
  damageRatio: number;
  targetSunk: boolean;
  rangeNm: number;
  rng?: () => number;
};

/** Compte rendu d'un tir, en une à deux phrases, pour l'affichage aux joueurs. */
export function describeShot(input: NarrativeInput): string {
  const rng = input.rng ?? Math.random;
  const { attackerName, targetName, rangeNm } = input;

  if (input.targetSunk) {
    return pick(
      [
        `${targetName} encaisse le coup de grâce, se couche sur le flanc et disparaît. Il n'y aura pas grand monde à repêcher.`,
        `Une détonation sourde, puis plus rien : ${targetName} se brise et s'enfonce par l'avant.`,
        `${targetName} explose dans une gerbe de flammes — quand la fumée retombe, la mer est vide.`,
        `Touché à mort, ${targetName} chavire lentement sous les yeux de l'équipage de ${attackerName}.`,
      ],
      rng
    );
  }

  if (!input.hit) {
    if (input.weaponType === "TORPEDO") {
      return pick(
        [
          `Les torpilles de ${attackerName} filent dans le vide : ${targetName} a changé de cap au bon moment.`,
          `Rien. Les sillages passent derrière ${targetName} — l'estimation de vitesse était trop courte.`,
          `Longue attente à bord de ${attackerName}… puis rien du tout. Torpilles perdues.`,
        ],
        rng
      );
    }
    if (input.weaponType === "DEPTH_CHARGE") {
      return pick(
        [
          `Les grenades secouent la mer derrière ${targetName}, sans plus. Le contact reste bon.`,
          `Rien ne remonte à la surface : ${targetName} était plus profond qu'estimé.`,
        ],
        rng
      );
    }
    return pick(
      [
        `Salve courte : les gerbes montent devant ${targetName} sans l'encadrer.`,
        `${attackerName} tire long — les colonnes d'eau retombent au-delà de ${targetName}.`,
        `La salve encadre ${targetName} à ${rangeNm.toFixed(1)} nm, mais rien ne porte. La correction est en cours.`,
        `Le roulis gâche la solution de tir de ${attackerName} : toute la salve part à côté.`,
      ],
      rng
    );
  }

  const plural = input.hits > 1;
  const heavy = input.damageRatio >= 0.25;
  const light = input.damageRatio < 0.08;

  if (input.weaponType === "TORPEDO") {
    return heavy
      ? pick(
          [
            `Une colonne d'eau monte le long de ${targetName} : la torpille a ouvert la coque sous la flottaison, l'envahissement est massif.`,
            `Coup au but sous la ceinture — ${targetName} prend immédiatement de la gîte et ralentit.`,
          ],
          rng
        )
      : pick(
          [
            `La torpille frappe l'avant de ${targetName}. Dégâts contenus, mais la cloison travaille.`,
            `Impact confirmé sur ${targetName} : gerbe blanche, puis un panache de fumée noire.`,
          ],
          rng
        );
  }

  if (input.weaponType === "DEPTH_CHARGE") {
    return heavy
      ? `Les grenades éclatent au bon réglage : une nappe de mazout et des débris remontent au-dessus de ${targetName}.`
      : `Une salve encadre ${targetName} — des bulles remontent, la coque a souffert.`;
  }

  if (heavy) {
    return pick(
      [
        `${plural ? `${input.hits} impacts` : "Un impact"} de plein fouet sur ${targetName} : une tourelle est réduite au silence et un incendie prend à l'arrière.`,
        `${targetName} est éventré au milieu — la vitesse chute, le navire sort de la ligne.`,
        `Coup terrible sur ${targetName} : la passerelle est balayée, le bâtiment embarde.`,
      ],
      rng
    );
  }
  if (light) {
    return pick(
      [
        `Un obus ricoche sur le blindage de ${targetName} sans le percer — plus de bruit que de mal.`,
        `Éraflure sur ${targetName} : quelques éclats, aucun organe vital touché.`,
      ],
      rng
    );
  }
  return pick(
    [
      `${plural ? `${input.hits} coups au but` : "Coup au but"} sur ${targetName} ! Un incendie s'allume sur sa plage arrière.`,
      `${attackerName} encadre enfin : ${plural ? `${input.hits} obus portent` : "un obus porte"}, ${targetName} crache une fumée épaisse.`,
      `Touché — ${targetName} continue sur son erre, mais quelque chose brûle à bord.`,
    ],
    rng
  );
}

// ── Dégâts localisés ────────────────────────────────────────
//
// Phrase factuelle ajoutée après le récit aléatoire habituel quand un coup a
// réellement handicapé un système (voir combat.ts, rollLocalizedDamage) —
// contrairement au récit aléatoire, celle-ci correspond toujours à un effet
// mécanique réel appliqué au navire.

export type LocalizedEffectStored =
  | { type: "WEAPON_DISABLED"; slot: string }
  | { type: "ENGINE"; speedReductionRatio: number }
  | { type: "RUDDER" }
  | { type: "FIRE_CONTROL" }
  | { type: "MAGAZINE" };

/** Récit dédié pour un coup qui atteint un magasin (cas Hood, 24 mai 1941) — remplace le récit aléatoire habituel plutôt que de s'y ajouter. */
export function describeMagazineHit(attackerName: string, targetName: string): string {
  return `Un coup plongeant perce le pont blindé de ${targetName} et gagne un magasin : l'explosion casse le navire en deux, presque instantanément. À bord de ${attackerName}, personne ne s'attendait à un résultat aussi brutal.`;
}

/** Phrase ajoutée au récit du coup pour les autres dégâts localisés (tourelle, machines, gouvernail, télépointage). */
export function describeLocalizedEffect(effect: LocalizedEffectStored, targetName: string): string {
  switch (effect.type) {
    case "WEAPON_DISABLED":
      return `Une pièce de ${targetName} est réduite au silence — elle ne tirera plus ce combat.`;
    case "ENGINE":
      return `La salle des machines de ${targetName} encaisse le choc : sa vitesse maximale chute durablement.`;
    case "RUDDER":
      return `Le gouvernail de ${targetName} se bloque — il ne peut plus manœuvrer, cap maintenu.`;
    case "FIRE_CONTROL":
      return `Le télépointage de ${targetName} est balayé : sa précision va en souffrir.`;
    default:
      return "";
  }
}

// ── Trace de calcul (débogage) ──────────────────────────────
//
// Détail des facteurs qui composent la chance de toucher et, le cas
// échéant, le tirage de localisation des dégâts — affiché aux joueurs à des
// fins de transparence, pas une règle du livret original (nos formules sont
// une approximation inspirée de ses exemples chiffrés, voir combat.ts).

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Détail lisible du calcul de précision d'un tir (canon ou torpille). */
export function describeHitChanceDebug(b: HitChanceBreakdown): string {
  const parts = [
    `précision de base ${pct(b.baseAccuracy)}`,
    `× facteur portée ${b.rangeFactor.toFixed(2)} (${pct(b.rangeRatio)} de la portée max)`,
    `× facteur taille cible ${b.sizeFactor.toFixed(2)}`,
    `× facteur vitesse cible ${b.speedFactor.toFixed(2)}`,
  ];
  if (b.accuracyMultiplier !== 1) parts.push(`× malus télépointage ${b.accuracyMultiplier.toFixed(2)}`);
  return `${parts.join(" ")} = ${b.finalPercent.toFixed(1)}%`;
}

/** Détail lisible du tirage de localisation des dégâts (ou de son absence). */
export function describeLocalizedRollDebug(d: LocalizedDamageDebug): string {
  const ratio = `${pct(d.damageRatio)} du potentiel max de la cible en un coup`;
  if (d.belowThreshold) {
    return `Localisation : ${ratio} < seuil ${pct(d.threshold)} → pas de jet de localisation, dégâts de coque seulement.`;
  }
  if (!d.table || d.roll === null || d.rollTotal === null) {
    return `Localisation : ${ratio} ≥ seuil ${pct(d.threshold)}, mais pas de table pour ce type d'arme.`;
  }
  const tableLabel = d.table.map((t) => `${localizedTypeLabel(t.type)} ${t.weight}`).join(", ");
  return `Localisation : ${ratio} ≥ seuil ${pct(d.threshold)} → tirage sur la table ${d.weaponType} (${tableLabel}) : ${d.roll.toFixed(1)}/${d.rollTotal}.`;
}

function localizedTypeLabel(type: string): string {
  switch (type) {
    case "MAGAZINE":
      return "Magasin";
    case "TURRET":
      return "Tourelle";
    case "ENGINE":
      return "Machines";
    case "RUDDER":
      return "Gouvernail";
    case "FIRE_CONTROL":
      return "Télépointage";
    case "NONE":
      return "Rien";
    default:
      return type;
  }
}

/** Compte rendu de la phase de mouvement (nouveaux contacts, contacts perdus). */
export function describeContactChange(params: {
  newContacts: { name: string; method: string; distanceNm: number }[];
  lostContacts: string[];
}): string[] {
  const lines: string[] = [];
  for (const c of params.newContacts) {
    const method = formatMethod(c.method);
    lines.push(
      c.method === "HYDROPHONE" || c.method === "SONAR"
        ? `Nouveau contact ${method} à ${c.distanceNm.toFixed(1)} nm : ${c.name}. L'écoute est formelle.`
        : `Contact ${method} établi sur ${c.name} à ${c.distanceNm.toFixed(1)} nm.`
    );
  }
  for (const name of params.lostContacts) {
    lines.push(`Contact perdu avec ${name}.`);
  }
  return lines;
}

function formatMethod(method: string) {
  switch (method) {
    case "RADAR":
      return "radar";
    case "VISUAL":
      return "visuel";
    case "HYDROPHONE":
      return "hydrophone";
    case "SONAR":
      return "asdic";
    default:
      return method.toLowerCase();
  }
}
