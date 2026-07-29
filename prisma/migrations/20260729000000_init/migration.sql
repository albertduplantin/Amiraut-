-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "TypeRepas" AS ENUM ('DEJEUNER', 'DINER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PARTICIPANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sejour" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3) NOT NULL,
    "prixNuitCts" INTEGER NOT NULL DEFAULT 0,
    "prixRepasCts" INTEGER NOT NULL DEFAULT 0,
    "infosPratiques" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sejour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Edito" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Edito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammeItem" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heure" TEXT,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProgrammeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jeu" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "debut" TIMESTAMP(3) NOT NULL,
    "dureeMinutes" INTEGER NOT NULL DEFAULT 60,
    "placesMax" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "Jeu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InscriptionJeu" (
    "id" TEXT NOT NULL,
    "jeuId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InscriptionJeu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationNuit" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationNuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationRepas" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "TypeRepas" NOT NULL,

    CONSTRAINT "ReservationRepas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InscriptionJeu_jeuId_userId_key" ON "InscriptionJeu"("jeuId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationNuit_sejourId_userId_date_key" ON "ReservationNuit"("sejourId", "userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationRepas_sejourId_userId_date_type_key" ON "ReservationRepas"("sejourId", "userId", "date", "type");

-- AddForeignKey
ALTER TABLE "Edito" ADD CONSTRAINT "Edito_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeItem" ADD CONSTRAINT "ProgrammeItem_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jeu" ADD CONSTRAINT "Jeu_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscriptionJeu" ADD CONSTRAINT "InscriptionJeu_jeuId_fkey" FOREIGN KEY ("jeuId") REFERENCES "Jeu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InscriptionJeu" ADD CONSTRAINT "InscriptionJeu_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationNuit" ADD CONSTRAINT "ReservationNuit_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationNuit" ADD CONSTRAINT "ReservationNuit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationRepas" ADD CONSTRAINT "ReservationRepas_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationRepas" ADD CONSTRAINT "ReservationRepas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

