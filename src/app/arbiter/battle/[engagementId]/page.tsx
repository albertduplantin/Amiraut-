import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ArbiterBattleClient } from "./ArbiterBattleClient";

export default async function ArbiterBattlePage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const engagement = await prisma.tacticalEngagement.findUnique({
    where: { id: engagementId },
    include: {
      participants: {
        include: { unit: { include: { unitClass: true } }, team: { select: { name: true, colorHex: true } } },
      },
    },
  });
  if (!engagement) redirect("/arbiter");

  const actions = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement!.roundNumber },
    include: { unit: { select: { name: true } }, targetUnit: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const submissions = await prisma.tacticalSubmission.findMany({
    where: {
      engagementId,
      roundNumber: engagement!.roundNumber,
      phase: engagement!.status === "AWAITING_MOVEMENT" ? "MOVEMENT" : "FIRE",
    },
  });
  const messages = await prisma.tacticalMessage.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" } });
  const teams = await prisma.team.findMany({
    where: { id: { in: Array.from(new Set(engagement!.participants.map((p) => p.teamId))) } },
    select: { id: true, name: true },
  });

  return (
    <ArbiterBattleClient
      engagementId={engagementId}
      status={engagement!.status}
      roundNumber={engagement!.roundNumber}
      roundMinutes={engagement!.roundMinutes}
      arbiterPaused={engagement!.arbiterPaused}
      endReason={engagement!.endReason}
      teams={teams}
      submittedTeamIds={submissions.map((s) => s.teamId)}
      participants={engagement!.participants.map((p) => ({
        unitId: p.unitId,
        teamId: p.teamId,
        teamName: p.team.name,
        teamColor: p.team.colorHex,
        name: p.unit.name,
        className: p.unit.unitClass.name,
        status: p.unit.status,
        healthCurrent: p.unit.healthCurrent,
        healthMax: p.unit.healthMax,
        depthBand: p.unit.depthBand,
      }))}
      actions={actions.map((a) => ({
        unitName: a.unit.name,
        targetName: a.targetUnit?.name ?? null,
        phase: a.phase,
        weaponType: a.weaponType,
        resolved: a.resolved,
        hit: a.hit,
        narrative: a.narrative,
      }))}
      messages={messages.map((m) => ({ id: m.id, kind: m.kind, authorName: m.authorName, body: m.body, roundNumber: m.roundNumber }))}
    />
  );
}
