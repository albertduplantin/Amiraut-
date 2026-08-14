import "server-only";
import { prisma } from "@/lib/prisma";
import { endEngagement } from "@/lib/tacticalEngine";

/**
 * Fin de partie — voir /report pour le document présenté aux joueurs et
 * OverviewPanel (arbiter/ArbiterDashboard.tsx) pour le bouton qui déclenche
 * ceci. Deux responsabilités séparées à dessein : `endGame` ferme la partie
 * (état en base, plus aucune mutation possible ensuite — voir les gardes
 * dans team/orders, team/waiting, arbiter), `buildGameEndReport` se contente
 * de LIRE cet état déjà figé pour composer le document. Rien n'est persisté
 * à part le statut/la date de clôture : le rapport est recalculé à chaque
 * consultation, toujours cohérent avec la base (aucun risque de rapport
 * périmé), et ne coûte rien tant que personne ne le consulte.
 */

/**
 * Clôt la partie : plus aucun ordre, tir ou action arbitre n'est accepté
 * ensuite (voir les gardes `assertScenarioActive`-like ajoutées aux points
 * d'entrée joueur/arbitre). Termine aussi tout combat tactique encore ouvert
 * plutôt que de le laisser en suspens indéfiniment (c'est la "libération de
 * ressources" concrète ici : plus de manche tactique à relancer, plus de
 * rafraîchissement automatique côté client qui tourne pour rien sur un
 * combat mort).
 */
export async function endGame(scenarioId: string): Promise<void> {
  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: scenarioId } });
  if (scenario.status === "COMPLETED") return; // idempotent : déjà terminée, rien à refaire.

  const openEngagements = await prisma.tacticalEngagement.findMany({
    where: { scenarioId, status: { not: "RESOLVED" } },
    select: { id: true },
  });
  for (const e of openEngagements) {
    await endEngagement(e.id, "ARBITER_ENDED");
  }

  await prisma.scenario.update({
    where: { id: scenarioId },
    data: { status: "COMPLETED", endedAt: new Date() },
  });
}

export type GameEndUnitEntry = {
  id: string;
  name: string;
  className: string;
  category: string;
  status: string;
};

export type GameEndTeamSummary = {
  teamName: string;
  colorHex: string;
  units: GameEndUnitEntry[];
  sunkCount: number;
  damagedCount: number;
  activeCount: number;
  withdrawnCount: number;
};

export type GameEndTimelineEntry = {
  turnNumber: number;
  /** Date "en jeu" reconstituée (Turn.gameStartAt + décalage de la manche tactique), pas l'horodatage réel du clic du joueur. */
  gameDate: Date;
  attackerName: string;
  attackerTeam: string;
  targetName: string;
  targetTeam: string;
  weaponType: string;
  narrative: string;
  fatal: boolean;
};

export type GameEndReport = {
  scenarioName: string;
  description: string | null;
  createdAt: Date;
  endedAt: Date;
  turnsPlayed: number;
  engagementsCount: number;
  teams: GameEndTeamSummary[];
  timeline: GameEndTimelineEntry[];
};

function unitStatusLabel(status: string): string {
  switch (status) {
    case "SUNK":
      return "Perdu corps et biens";
    case "DAMAGED":
      return "Endommagé, rentré au port";
    case "WITHDRAWN":
      return "Retiré du théâtre d'opérations";
    default:
      return "Rentré indemne";
  }
}

function weaponTypeLabel(w: string | null): string {
  switch (w) {
    case "GUN":
      return "artillerie";
    case "TORPEDO":
      return "torpille";
    case "DEPTH_CHARGE":
      return "grenades ASM";
    case "HEDGEHOG":
      return "Hedgehog";
    case "BOMB":
      return "bombardement aérien";
    default:
      return "action";
  }
}

/**
 * Compose le compte rendu de fin d'opération. Ne filtre PAS par équipe — à
 * la différence des rapports de renseignement en cours de partie (Report,
 * strictement cloisonnés par le brouillard de guerre), ce document est
 * volontairement le même pour tout le monde : la partie est terminée, le
 * moment est à la vérité complète des deux bords, pas à maintenir le secret
 * plus longtemps.
 */
export async function buildGameEndReport(scenarioId: string): Promise<GameEndReport> {
  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: scenarioId } });

  const teams = await prisma.team.findMany({
    where: { scenarioId },
    include: {
      fleets: {
        include: {
          units: {
            include: { unitClass: { select: { name: true, category: true } } },
            orderBy: { name: "asc" },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const teamSummaries: GameEndTeamSummary[] = teams.map((t) => {
    const units = t.fleets.flatMap((f) => f.units);
    const entries: GameEndUnitEntry[] = units.map((u) => ({
      id: u.id,
      name: u.name,
      className: u.unitClass.name,
      category: u.unitClass.category,
      status: u.status,
    }));
    return {
      teamName: t.name,
      colorHex: t.colorHex,
      units: entries,
      sunkCount: entries.filter((e) => e.status === "SUNK").length,
      damagedCount: entries.filter((e) => e.status === "DAMAGED").length,
      activeCount: entries.filter((e) => e.status === "ACTIVE").length,
      withdrawnCount: entries.filter((e) => e.status === "WITHDRAWN").length,
    };
  });

  const turnsPlayed = await prisma.turn.count({ where: { scenarioId, status: "PUBLISHED" } });

  const engagements = await prisma.tacticalEngagement.findMany({
    where: { scenarioId },
    select: { id: true },
  });

  // Unité → équipe, pour retrouver le camp d'un tireur/d'une cible sans
  // reproduire toute la chaîne unit→fleet→team dans chaque ligne de tir.
  const teamNameByUnitId = new Map<string, string>();
  for (const t of teams) {
    for (const f of t.fleets) {
      for (const u of f.units) teamNameByUnitId.set(u.id, t.name);
    }
  }

  const hits = await prisma.tacticalAction.findMany({
    where: { engagementId: { in: engagements.map((e) => e.id) }, phase: "FIRE", hit: true },
    include: {
      unit: { select: { name: true } },
      targetUnit: { select: { name: true } },
      engagement: { select: { roundMinutes: true, turn: { select: { number: true, gameStartAt: true } } } },
    },
  });

  const timeline: GameEndTimelineEntry[] = hits
    .filter((h) => h.targetUnit) // une cible peut avoir été retirée de la sélection Prisma si null (air-air sans cible connue, garde-fou)
    .map((h) => ({
      turnNumber: h.engagement.turn.number,
      gameDate: new Date(h.engagement.turn.gameStartAt.getTime() + (h.roundNumber - 1) * h.engagement.roundMinutes * 60_000),
      attackerName: h.unit.name,
      attackerTeam: teamNameByUnitId.get(h.unitId) ?? "?",
      targetName: h.targetUnit!.name,
      targetTeam: teamNameByUnitId.get(h.targetUnitId!) ?? "?",
      weaponType: weaponTypeLabel(h.weaponType),
      narrative: h.narrative ?? "",
      fatal: h.targetSunk ?? false,
    }))
    .sort((a, b) => a.gameDate.getTime() - b.gameDate.getTime());

  return {
    scenarioName: scenario.name,
    description: scenario.description,
    createdAt: scenario.createdAt,
    endedAt: scenario.endedAt ?? new Date(),
    turnsPlayed,
    engagementsCount: engagements.length,
    teams: teamSummaries,
    timeline,
  };
}

export { unitStatusLabel };
