-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "UnitCategory" AS ENUM ('SURFACE_SHIP', 'SUBMARINE', 'AIRCRAFT');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('ACTIVE', 'DAMAGED', 'SUNK', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('ARBITER', 'PLAYER');

-- CreateEnum
CREATE TYPE "TurnStatus" AS ENUM ('PENDING_ORDERS', 'RESOLVING', 'PENDING_ARBITER_REVIEW', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "Daylight" AS ENUM ('DAY', 'TWILIGHT', 'NIGHT', 'POLAR_NIGHT', 'POLAR_DAY');

-- CreateEnum
CREATE TYPE "Precipitation" AS ENUM ('NONE', 'RAIN', 'SNOW', 'FOG');

-- CreateEnum
CREATE TYPE "SensorType" AS ENUM ('RADAR', 'VISUAL', 'HYDROPHONE', 'SONAR', 'OTHER');

-- CreateEnum
CREATE TYPE "ArbiterStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED', 'ADDED_MANUALLY');

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mapCenterLat" DOUBLE PRECISION NOT NULL,
    "mapCenterLng" DOUBLE PRECISION NOT NULL,
    "mapDefaultZoom" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "defaultTurnMinutes" INTEGER NOT NULL,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL DEFAULT '#3388ff',

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitClass" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nation" TEXT NOT NULL,
    "category" "UnitCategory" NOT NULL,
    "maxSpeedKnots" DOUBLE PRECISION NOT NULL,
    "sensors" JSONB NOT NULL,
    "detectability" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "iconKey" TEXT NOT NULL,
    "enduranceMinutes" INTEGER,
    "weaponSystems" JSONB,

    CONSTRAINT "UnitClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,
    "unitClassId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pennant" TEXT,
    "status" "UnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "healthMax" INTEGER,
    "healthCurrent" INTEGER,
    "currentLat" DOUBLE PRECISION NOT NULL,
    "currentLng" DOUBLE PRECISION NOT NULL,
    "currentHeadingDeg" DOUBLE PRECISION,
    "lastResolvedTurn" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "teamId" TEXT,
    "scopeAllFleetsInTeam" BOOLEAN NOT NULL DEFAULT true,
    "displayName" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantFleetScope" (
    "participantId" TEXT NOT NULL,
    "fleetId" TEXT NOT NULL,

    CONSTRAINT "ParticipantFleetScope_pkey" PRIMARY KEY ("participantId","fleetId")
);

-- CreateTable
CREATE TABLE "Turn" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "TurnStatus" NOT NULL DEFAULT 'PENDING_ORDERS',
    "gameStartAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "weatherId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Turn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weather" (
    "id" TEXT NOT NULL,
    "visibilityNm" DOUBLE PRECISION NOT NULL,
    "seaState" INTEGER NOT NULL,
    "daylight" "Daylight" NOT NULL,
    "precipitation" "Precipitation" NOT NULL DEFAULT 'NONE',
    "windKnots" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "Weather_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOrder" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "speedKnots" DOUBLE PRECISION NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waypoint" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Waypoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionEvent" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "observerUnitId" TEXT NOT NULL,
    "targetUnitId" TEXT NOT NULL,
    "method" "SensorType" NOT NULL,
    "cpaDistanceNm" DOUBLE PRECISION NOT NULL,
    "cpaMinutesIntoTurn" DOUBLE PRECISION NOT NULL,
    "observerLatAtCpa" DOUBLE PRECISION NOT NULL,
    "observerLngAtCpa" DOUBLE PRECISION NOT NULL,
    "targetLatAtCpa" DOUBLE PRECISION NOT NULL,
    "targetLngAtCpa" DOUBLE PRECISION NOT NULL,
    "systemProposed" BOOLEAN NOT NULL DEFAULT true,
    "arbiterStatus" "ArbiterStatus" NOT NULL DEFAULT 'PROPOSED',
    "arbiterNote" TEXT,
    "decidedById" TEXT,

    CONSTRAINT "DetectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownUnits" JSONB NOT NULL,
    "contacts" JSONB NOT NULL,
    "narrative" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_scenarioId_name_key" ON "Team"("scenarioId", "name");

-- CreateIndex
CREATE INDEX "Unit_scenarioId_fleetId_idx" ON "Unit"("scenarioId", "fleetId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_token_key" ON "Participant"("token");

-- CreateIndex
CREATE INDEX "Participant_scenarioId_idx" ON "Participant"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_weatherId_key" ON "Turn"("weatherId");

-- CreateIndex
CREATE UNIQUE INDEX "Turn_scenarioId_number_key" ON "Turn"("scenarioId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOrder_turnId_unitId_key" ON "UnitOrder"("turnId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Waypoint_orderId_sequence_key" ON "Waypoint"("orderId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "DetectionEvent_turnId_observerUnitId_targetUnitId_key" ON "DetectionEvent"("turnId", "observerUnitId", "targetUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_turnId_teamId_key" ON "Report"("turnId", "teamId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_unitClassId_fkey" FOREIGN KEY ("unitClassId") REFERENCES "UnitClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantFleetScope" ADD CONSTRAINT "ParticipantFleetScope_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantFleetScope" ADD CONSTRAINT "ParticipantFleetScope_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turn" ADD CONSTRAINT "Turn_weatherId_fkey" FOREIGN KEY ("weatherId") REFERENCES "Weather"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOrder" ADD CONSTRAINT "UnitOrder_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOrder" ADD CONSTRAINT "UnitOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOrder" ADD CONSTRAINT "UnitOrder_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waypoint" ADD CONSTRAINT "Waypoint_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "UnitOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionEvent" ADD CONSTRAINT "DetectionEvent_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionEvent" ADD CONSTRAINT "DetectionEvent_observerUnitId_fkey" FOREIGN KEY ("observerUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionEvent" ADD CONSTRAINT "DetectionEvent_targetUnitId_fkey" FOREIGN KEY ("targetUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
