-- CreateTable
CREATE TABLE "TeamEmails" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "status" TEXT DEFAULT 'first_time',
    "welcomeSent" BOOLEAN NOT NULL DEFAULT false,
    "verificationSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamEmails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamEmails_teamId_idx" ON "TeamEmails"("teamId");

-- AddForeignKey
ALTER TABLE "TeamEmails" ADD CONSTRAINT "TeamEmails_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
