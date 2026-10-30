-- Trainer desk (owner, 26 Oct): remarks, escalation / guardian-contact requests, trainer feedback, mentoring outcomes.
CREATE SEQUENCE IF NOT EXISTS staff_request_code_seq START 1001;

-- CreateEnum
CREATE TYPE "RemarkKind" AS ENUM ('remark', 'private_note');

-- CreateEnum
CREATE TYPE "StaffRequestKind" AS ENUM ('escalation', 'guardian_contact');

-- CreateEnum
CREATE TYPE "StaffRequestStatus" AS ENUM ('open', 'resolved');

-- AlterTable
ALTER TABLE "session_requests" ADD COLUMN     "follow_up" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outcome_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "student_remarks" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "kind" "RemarkKind" NOT NULL,
    "text" TEXT NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_remarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_staff_requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT ('SR-'::text || (nextval('staff_request_code_seq'::regclass))::text),
    "student_id" UUID NOT NULL,
    "raised_by" UUID NOT NULL,
    "kind" "StaffRequestKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "StaffRequestStatus" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_staff_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_feedback" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "session_id" UUID,
    "session_request_id" UUID,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_remarks_student_id_created_at_idx" ON "student_remarks"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "student_remarks_author_id_idx" ON "student_remarks"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_staff_requests_code_key" ON "student_staff_requests"("code");

-- CreateIndex
CREATE INDEX "student_staff_requests_status_created_at_idx" ON "student_staff_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "student_staff_requests_student_id_idx" ON "student_staff_requests"("student_id");

-- CreateIndex
CREATE INDEX "trainer_feedback_trainer_id_created_at_idx" ON "trainer_feedback"("trainer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_feedback_student_id_session_id_key" ON "trainer_feedback"("student_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_feedback_student_id_session_request_id_key" ON "trainer_feedback"("student_id", "session_request_id");

-- AddForeignKey
ALTER TABLE "student_remarks" ADD CONSTRAINT "student_remarks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_remarks" ADD CONSTRAINT "student_remarks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_staff_requests" ADD CONSTRAINT "student_staff_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_staff_requests" ADD CONSTRAINT "student_staff_requests_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_feedback" ADD CONSTRAINT "trainer_feedback_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_feedback" ADD CONSTRAINT "trainer_feedback_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_feedback" ADD CONSTRAINT "trainer_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_feedback" ADD CONSTRAINT "trainer_feedback_session_request_id_fkey" FOREIGN KEY ("session_request_id") REFERENCES "session_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity rules the schema language cannot express.
ALTER TABLE "trainer_feedback" ADD CONSTRAINT trainer_feedback_rating_chk CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "trainer_feedback" ADD CONSTRAINT trainer_feedback_target_chk CHECK (num_nonnulls(session_id, session_request_id) = 1);
ALTER TABLE "trainer_feedback" ADD CONSTRAINT trainer_feedback_comment_len_chk CHECK (comment IS NULL OR char_length(comment) <= 1000);
ALTER TABLE "student_remarks" ADD CONSTRAINT student_remarks_text_len_chk CHECK (char_length(text) BETWEEN 3 AND 2000);
ALTER TABLE "student_staff_requests" ADD CONSTRAINT student_staff_requests_reason_len_chk CHECK (char_length(reason) BETWEEN 5 AND 1000);
