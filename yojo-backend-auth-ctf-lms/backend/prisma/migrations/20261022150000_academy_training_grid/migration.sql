-- Student Academy, slice (c): class sessions, attendance (with append-only history), holidays, trainer slots,
-- session requests, leave requests, conversations and messages, and admin-verified trainer credentials.
-- Generated with `prisma migrate diff` plus the hand-written rules below. Additive.

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('class', 'lab', 'mentor', 'quiz');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'cancelled');

-- CreateEnum
CREATE TYPE "AttendanceMark" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateEnum
CREATE TYPE "SessionRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'proposed', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "credentials_verified_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "course_id" UUID,
    "type" "SessionType" NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "trainer_id" UUID,
    "join_url" TEXT,
    "room" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'scheduled',
    "cancel_reason" TEXT,
    "counts_for_attendance" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "mark" "AttendanceMark" NOT NULL,
    "note" TEXT,
    "marked_by" UUID NOT NULL,
    "marked_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("session_id","student_id")
);

-- CreateTable
CREATE TABLE "attendance_history" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_mark" "AttendanceMark",
    "to_mark" "AttendanceMark" NOT NULL,
    "reason" TEXT,
    "actor_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "day" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "added_by" UUID NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "trainer_slots" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'one_to_one',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_requests" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "slot_id" UUID,
    "purpose" TEXT NOT NULL,
    "note" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "SessionRequestStatus" NOT NULL DEFAULT 'pending',
    "proposed_start" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_day" DATE NOT NULL,
    "to_day" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "reviewer_id" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_sessions_batch_id_starts_at_idx" ON "class_sessions"("batch_id", "starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_trainer_id_starts_at_idx" ON "class_sessions"("trainer_id", "starts_at");

-- CreateIndex
CREATE INDEX "attendance_student_id_idx" ON "attendance"("student_id");

-- CreateIndex
CREATE INDEX "attendance_history_session_id_student_id_idx" ON "attendance_history"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "trainer_slots_trainer_id_starts_at_idx" ON "trainer_slots"("trainer_id", "starts_at");

-- CreateIndex
CREATE INDEX "session_requests_student_id_starts_at_idx" ON "session_requests"("student_id", "starts_at");

-- CreateIndex
CREATE INDEX "session_requests_trainer_id_status_idx" ON "session_requests"("trainer_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_student_id_from_day_idx" ON "leave_requests"("student_id", "from_day");

-- CreateIndex
CREATE INDEX "conversations_student_id_last_message_at_idx" ON "conversations"("student_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_staff_id_last_message_at_idx" ON "conversations"("staff_id", "last_message_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "trainer_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
ALTER TABLE "class_sessions" ADD CONSTRAINT class_sessions_time_chk CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '12 hours');
ALTER TABLE "class_sessions" ADD CONSTRAINT class_sessions_join_chk CHECK (join_url IS NULL OR join_url ~ '^https://');
ALTER TABLE "class_sessions" ADD CONSTRAINT class_sessions_cancel_chk CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL));
CREATE TRIGGER attendance_history_append_only BEFORE UPDATE OR DELETE ON "attendance_history" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
ALTER TABLE "trainer_slots" ADD CONSTRAINT trainer_slots_time_chk CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '3 hours');
ALTER TABLE "session_requests" ADD CONSTRAINT session_requests_time_chk CHECK (ends_at > starts_at);
-- One live booking per slot: no double-booking even with concurrent requests.
CREATE UNIQUE INDEX session_requests_one_per_slot ON "session_requests" (slot_id) WHERE slot_id IS NOT NULL AND status IN ('pending', 'approved', 'proposed');
ALTER TABLE "leave_requests" ADD CONSTRAINT leave_requests_days_chk CHECK (to_day >= from_day AND to_day - from_day <= 30);
ALTER TABLE "leave_requests" ADD CONSTRAINT leave_requests_reason_chk CHECK (char_length(reason) BETWEEN 5 AND 500);
ALTER TABLE "messages" ADD CONSTRAINT messages_body_chk CHECK (char_length(body) BETWEEN 1 AND 4000);
ALTER TABLE "conversations" ADD CONSTRAINT conversations_subject_chk CHECK (char_length(subject) BETWEEN 1 AND 150);
