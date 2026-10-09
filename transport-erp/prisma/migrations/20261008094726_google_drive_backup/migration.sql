-- AlterTable
ALTER TABLE "backup_records" ADD COLUMN     "driveDbFileId" TEXT,
ADD COLUMN     "driveError" TEXT,
ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "driveUploadedAt" TIMESTAMP(3);
