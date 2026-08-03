import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PositionsClient } from "./PositionsClient";

export default async function PositionsPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const [scenario, units] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.unit.findMany({
      where: { scenarioId: session.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } },
      include: {
        unitClass: { select: { name: true, category: true, lengthMeters: true } },
        fleet: { select: { id: true, name: true, team: { select: { name: true, colorHex: true } } } },
      },
      orderBy: [{ fleet: { team: { name: "asc" } } }, { fleet: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  return (
    <PositionsClient
      mapCenter={{ lat: scenario.mapCenterLat, lng: scenario.mapCenterLng }}
      mapZoom={scenario.mapDefaultZoom}
      units={units.map((u) => ({
        id: u.id,
        name: u.name,
        className: u.unitClass.name,
        category: u.unitClass.category,
        lengthMeters: u.unitClass.lengthMeters,
        teamName: u.fleet.team.name,
        teamColor: u.fleet.team.colorHex,
        fleetId: u.fleet.id,
        fleetName: u.fleet.name,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        currentHeadingDeg: u.currentHeadingDeg,
      }))}
    />
  );
}
