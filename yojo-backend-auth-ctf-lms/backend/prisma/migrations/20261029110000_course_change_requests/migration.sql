-- CreateEnum
CREATE TYPE "CourseChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "course_change_requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "reason_code" TEXT NOT NULL,
    "reason_note" TEXT,
    "status" "CourseChangeStatus" NOT NULL DEFAULT 'pending',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_change_requests_code_key" ON "course_change_requests"("code");

-- CreateIndex
CREATE INDEX "course_change_requests_status_created_at_idx" ON "course_change_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "course_change_requests_course_id_status_idx" ON "course_change_requests"("course_id", "status");

-- AddForeignKey
ALTER TABLE "course_change_requests" ADD CONSTRAINT "course_change_requests_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

