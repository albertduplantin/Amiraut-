-- CreateTable
CREATE TABLE "JeuWaitlist" (
    "id" TEXT NOT NULL,
    "jeuId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JeuWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JeuWaitlist_jeuId_userId_key" ON "JeuWaitlist"("jeuId", "userId");

-- AddForeignKey
ALTER TABLE "JeuWaitlist" ADD CONSTRAINT "JeuWaitlist_jeuId_fkey" FOREIGN KEY ("jeuId") REFERENCES "Jeu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JeuWaitlist" ADD CONSTRAINT "JeuWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

