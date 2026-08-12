import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { bearingDeg } from "@/lib/geo";
import { BattleClient } from "./BattleClient";

export default async function BattlePage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  const engagement = await prisma.tacticalEngagement.findUnique({
    where: { id: engagementId },
    include: {
      participants: { select: { unitId: true, teamId: true } },
    },
  });
  if (!engagement || !engagement.participants.some((p) => p.teamId === session.teamId)) {
    redirect("/team/orders");
  }

  const ownUnits = await prisma.unit.findMany({
    where: { id: { in: engagement.participants.filter((p) => p.teamId === session.teamId).map((p) => p.unitId) } },
    include: { unitClass: true },
    orderBy: { name: "asc" },
  });

  const enemyUnitIds = engagement.participants.filter((p) => p.teamId !== session.teamId).map((p) => p.unitId);
  const enemyUnits = await prisma.unit.findMany({
    where: { id: { in: enemyUnitIds } },
    select: { id: true, currentLat: true, currentLng: true, status: true },
  });
  const enemyById = new Map(enemyUnits.map((u) => [u.id, u]));

  const contacts = await prisma.tacticalContact.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, observerTeamId: session.teamId },
    include: {
      targetUnit: { include: { unitClass: true } },
    },
  });
  // Un même ennemi peut être vu par plusieurs de nos unités : on garde le
  // meilleur relevé (distance la plus courte).
  const bestContactByTarget = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    const existing = bestContactByTarget.get(c.targetUnitId);
    if (!existing || c.distanceNm < existing.distanceNm) bestContactByTarget.set(c.targetUnitId, c);
  }

  const ownActions = await prisma.tacticalAction.findMany({
    where: { engagementId, roundNumber: engagement.roundNumber, teamId: session.teamId },
  });
  // Journal persistant de tous les tirs résolus, toutes manches confondues :
  // sans ça, un résultat n'était visible que le temps d'un clignement entre
  // la soumission et le passage à la manche suivante.
  const battleLog = await prisma.tacticalAction.findMany({
    where: { engagementId, phase: "FIRE", resolved: true, teamId: session.teamId },
    orderBy: [{ roundNumber: "desc" }, { createdAt: "desc" }],
    take: 30,
  });
  const messages = await prisma.tacticalMessage.findMany({
    where: { engagementId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const submissions = await prisma.tacticalSubmission.findMany({
    where: {
      engagementId,
      roundNumber: engagement.roundNumber,
      phase: engagement.status === "AWAITING_MOVEMENT" ? "MOVEMENT" : "FIRE",
    },
  });
  const teamsInEngagement = Array.from(new Set(engagement.participants.map((p) => p.teamId)));
  const teams = await prisma.team.findMany({ where: { id: { in: teamsInEngagement } }, select: { id: true, name: true } });

  return (
    <BattleClient
      engagementId={engagementId}
      status={engagement.status}
      roundNumber={engagement.roundNumber}
      roundMinutes={engagement.roundMinutes}
      syncMode={engagement.syncMode}
      arbiterPaused={engagement.arbiterPaused}
      endReason={engagement.endReason}
      teamId={session.teamId}
      teams={teams}
      submittedTeamIds={submissions.map((s) => s.teamId)}
      ownUnits={ownUnits.map((u) => ({
        id: u.id,
        name: u.name,
        className: u.unitClass.name,
        category: u.unitClass.category,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        combatProfile: u.unitClass.combatProfile as any,
        maxSpeedKnots: u.unitClass.maxSpeedKnots,
        healthCurrent: u.healthCurrent,
        healthMax: u.healthMax,
        status: u.status,
        headingDeg: u.currentHeadingDeg,
        depthBand: u.depthBand,
        batteryChargePercent: u.batteryChargePercent,
        oxygenHoursRemaining: u.oxygenHoursRemaining,
        oxygenEnduranceHours: u.unitClass.oxygenEnduranceHours,
        torpedoesRemaining: u.torpedoesRemaining,
      }))}
      contacts={Array.from(bestContactByTarget.values()).map((c) => {
        const observer = ownUnits.find((u) => u.id === c.observerUnitId);
        const enemy = enemyById.get(c.targetUnitId);
        const relBearing =
          observer && enemy
            ? bearingDeg({ lat: observer.currentLat, lng: observer.currentLng }, { lat: enemy.currentLat, lng: enemy.currentLng })
            : 0;
        return {
          targetUnitId: c.targetUnitId,
          name: c.targetUnit.name,
          className: c.targetUnit.unitClass.name,
          category: c.targetUnit.unitClass.category,
          lengthMeters: c.targetUnit.unitClass.lengthMeters,
          beamMeters: c.targetUnit.unitClass.beamMeters,
          maxSpeedKnots: c.targetUnit.unitClass.maxSpeedKnots,
          method: c.method,
          distanceNm: c.distanceNm,
          bearingDeg: ((relBearing % 360) + 360) % 360,
          status: enemy?.status ?? "ACTIVE",
        };
      })}
      battleLog={battleLog.map((a) => ({
        roundNumber: a.roundNumber,
        unitId: a.unitId,
        targetUnitId: a.targetUnitId,
        weaponType: a.weaponType,
        hit: a.hit,
        hits: a.hits,
        damagePoints: a.damagePoints,
        targetSunk: a.targetSunk,
        narrative: a.narrative,
      }))}
      ownActions={ownActions.map((a) => ({
        unitId: a.unitId,
        phase: a.phase,
        headingDeg: a.headingDeg,
        speedKnots: a.speedKnots,
        depthBand: a.depthBand,
        targetUnitId: a.targetUnitId,
        weaponType: a.weaponType,
        torpedoTypeId: a.torpedoTypeId,
        resolved: a.resolved,
        hit: a.hit,
        hits: a.hits,
        damagePoints: a.damagePoints,
        targetSunk: a.targetSunk,
        narrative: a.narrative,
      }))}
      messages={messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        authorName: m.authorName,
        body: m.body,
        roundNumber: m.roundNumber,
        teamId: m.teamId,
      }))}
    />
  );
}
