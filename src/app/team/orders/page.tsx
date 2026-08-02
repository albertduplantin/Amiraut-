import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { OrdersClient } from "./OrdersClient";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session || session.role !== "PLAYER" || !session.teamId) {
    redirect("/");
  }

  const turn = await prisma.turn.findFirst({
    where: { scenarioId: session.scenarioId, status: "PENDING_ORDERS" },
    orderBy: { number: "desc" },
    include: { weather: true },
  });

  if (!turn || !turn.weatherId) {
    redirect("/team/waiting");
  }

  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } });

  const units = await prisma.unit.findMany({
    where: {
      scenarioId: session.scenarioId,
      status: "ACTIVE",
      fleet: {
        teamId: session.teamId,
        ...(session.fleetIds ? { id: { in: session.fleetIds } } : {}),
      },
    },
    include: {
      unitClass: {
        select: {
          name: true,
          nation: true,
          maxSpeedKnots: true,
          iconKey: true,
          category: true,
          sensors: true,
          detectability: true,
          historicalNote: true,
          profileImageUrl: true,
        },
      },
      fleet: { select: { name: true } },
      pendingFleet: { select: { name: true } },
      orders: {
        where: { turnId: turn.id },
        include: { waypoints: { orderBy: { sequence: "asc" } } },
      },
    },
    orderBy: [{ fleet: { name: "asc" } }, { name: "asc" }],
  });

  const teamFleets = await prisma.fleet.findMany({
    where: {
      teamId: session.teamId,
      ...(session.fleetIds ? { id: { in: session.fleetIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const [teamUnitCount, teamOrderCount, allActiveUnitCount, allOrderCount] = await Promise.all([
    prisma.unit.count({ where: { scenarioId: session.scenarioId, status: "ACTIVE", fleet: { teamId: session.teamId } } }),
    prisma.unitOrder.count({
      where: { turnId: turn.id, unit: { fleet: { teamId: session.teamId } } },
    }),
    prisma.unit.count({ where: { scenarioId: session.scenarioId, status: "ACTIVE" } }),
    prisma.unitOrder.count({ where: { turnId: turn.id } }),
  ]);

  return (
    <OrdersClient
      turnId={turn.id}
      turnNumber={turn.number}
      turnDurationMinutes={turn.durationMinutes}
      weather={
        turn.weather
          ? {
              visibilityNm: turn.weather.visibilityNm,
              seaState: turn.weather.seaState,
              daylight: turn.weather.daylight,
              precipitation: turn.weather.precipitation,
            }
          : null
      }
      mapCenter={{ lat: scenario.mapCenterLat, lng: scenario.mapCenterLng }}
      mapZoom={scenario.mapDefaultZoom}
      teamProgress={{ submitted: teamOrderCount, total: teamUnitCount }}
      globalProgress={{ submitted: allOrderCount, total: allActiveUnitCount }}
      teamFleets={teamFleets}
      units={units.map((u) => ({
        id: u.id,
        name: u.name,
        pennant: u.pennant,
        fleetId: u.fleetId,
        fleetName: u.fleet.name,
        pendingFleetName: u.pendingFleet?.name ?? null,
        className: u.unitClass.name,
        nation: u.unitClass.nation,
        category: u.unitClass.category,
        maxSpeedKnots: u.unitClass.maxSpeedKnots,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sensors: u.unitClass.sensors as any,
        detectability: u.unitClass.detectability,
        historicalNote: u.historicalNote ?? u.unitClass.historicalNote,
        profileImageUrl: u.unitClass.profileImageUrl,
        currentLat: u.currentLat,
        currentLng: u.currentLng,
        existingOrder:
          u.orders.length > 0
            ? {
                speedKnots: u.orders[0].speedKnots,
                waypoints: u.orders[0].waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
              }
            : null,
      }))}
    />
  );
}
