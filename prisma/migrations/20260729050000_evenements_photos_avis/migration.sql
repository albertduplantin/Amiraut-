-- CreateEnum
CREATE TYPE "TypeEvenement" AS ENUM ('DESINSCRIPTION_SEJOUR', 'DESINSCRIPTION_JEU');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "afficherDansListeParticipants" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Evenement" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "TypeEvenement" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evenement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "legende" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvisJeu" (
    "id" TEXT NOT NULL,
    "jeuId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" INTEGER NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvisJeu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvisJeu_jeuId_userId_key" ON "AvisJeu"("jeuId", "userId");

-- AddForeignKey
ALTER TABLE "Evenement" ADD CONSTRAINT "Evenement_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evenement" ADD CONSTRAINT "Evenement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvisJeu" ADD CONSTRAINT "AvisJeu_jeuId_fkey" FOREIGN KEY ("jeuId") REFERENCES "Jeu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvisJeu" ADD CONSTRAINT "AvisJeu_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

