-- CreateEnum
CREATE TYPE "TypeCovoiturage" AS ENUM ('PROPOSE', 'RECHERCHE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "colocataireSouhaite" TEXT,
ADD COLUMN     "contactUrgenceNom" TEXT,
ADD COLUMN     "contactUrgenceTelephone" TEXT,
ADD COLUMN     "regimeAlimentaire" TEXT;

-- AlterTable
ALTER TABLE "Jeu" ADD COLUMN     "proposeParId" TEXT;

-- CreateTable
CREATE TABLE "CovoiturageAnnonce" (
    "id" TEXT NOT NULL,
    "sejourId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TypeCovoiturage" NOT NULL,
    "lieu" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CovoiturageAnnonce_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Jeu" ADD CONSTRAINT "Jeu_proposeParId_fkey" FOREIGN KEY ("proposeParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovoiturageAnnonce" ADD CONSTRAINT "CovoiturageAnnonce_sejourId_fkey" FOREIGN KEY ("sejourId") REFERENCES "Sejour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovoiturageAnnonce" ADD CONSTRAINT "CovoiturageAnnonce_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

