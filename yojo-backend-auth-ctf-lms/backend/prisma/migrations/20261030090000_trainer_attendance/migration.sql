-- CreateEnum
CREATE TYPE "TrainerAttendanceStatus" AS ENUM ('present', 'absent', 'leave', 'half_day');

-- CreateTable
CREATE TABLE "trainer_attendance" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "status" "TrainerAttendanceStatus" NOT NULL,
    "note" TEXT,
    "marked_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trainer_attendance_day_idx" ON "trainer_attendance"("day");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_attendance_trainer_id_day_key" ON "trainer_attendance"("trainer_id", "day");

