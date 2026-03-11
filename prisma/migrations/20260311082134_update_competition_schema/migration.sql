/*
  Warnings:

  - Made the column `description` on table `Competition` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "category" TEXT,
ADD COLUMN     "earlyBirdFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "earlyBirdLimit" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "description" SET DEFAULT '-';
