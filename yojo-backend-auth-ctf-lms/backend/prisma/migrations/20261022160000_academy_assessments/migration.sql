-- Student Academy, slice (d): assessments, questions (private answer keys), attempts, grade history, extensions.
-- Generated with `prisma migrate diff` plus the hand-written rules below. Additive.

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('quiz', 'assignment', 'lab_challenge', 'practical', 'exam');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'published', 'closed');

-- CreateEnum
CREATE TYPE "SubmissionFormat" AS ENUM ('questions', 'text', 'file', 'lab_result');

-- CreateEnum
CREATE TYPE "ResultsRelease" AS ENUM ('immediate', 'after_due', 'manual');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('single', 'multi', 'short_text');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('in_progress', 'submitted', 'graded', 'returned');

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "batch_id" UUID,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "kind" "AssessmentKind" NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT '',
    "duration_min" INTEGER,
    "opens_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "max_marks" INTEGER NOT NULL,
    "pass_marks" INTEGER NOT NULL,
    "attempts_allowed" INTEGER NOT NULL DEFAULT 1,
    "format" "SubmissionFormat" NOT NULL,
    "auto_grade" BOOLEAN NOT NULL DEFAULT false,
    "rubric" JSONB,
    "allow_late" BOOLEAN NOT NULL DEFAULT false,
    "results_release" "ResultsRelease" NOT NULL DEFAULT 'immediate',
    "released_at" TIMESTAMPTZ(6),
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answer_key" JSONB NOT NULL,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB,
    "text_response" TEXT,
    "lab_ref" TEXT,
    "auto_score" INTEGER,
    "score" INTEGER,
    "feedback" TEXT,
    "rubric_scores" JSONB,
    "graded_by" UUID,
    "graded_at" TIMESTAMPTZ(6),

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_history" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "from_score" INTEGER,
    "to_score" INTEGER NOT NULL,
    "reason" TEXT,
    "actor_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_extensions" (
    "assessment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "granted_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_extensions_pkey" PRIMARY KEY ("assessment_id","student_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessments_code_key" ON "assessments"("code");

-- CreateIndex
CREATE INDEX "assessments_course_id_status_idx" ON "assessments"("course_id", "status");

-- CreateIndex
CREATE INDEX "questions_assessment_id_sort_order_idx" ON "questions"("assessment_id", "sort_order");

-- CreateIndex
CREATE INDEX "attempts_student_id_status_idx" ON "attempts"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_assessment_id_student_id_number_key" ON "attempts"("assessment_id", "student_id", "number");

-- CreateIndex
CREATE INDEX "grade_history_attempt_id_idx" ON "grade_history"("attempt_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_extensions" ADD CONSTRAINT "assessment_extensions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
ALTER TABLE "assessments" ADD CONSTRAINT assessments_marks_chk CHECK (max_marks BETWEEN 1 AND 1000 AND pass_marks BETWEEN 0 AND max_marks);
ALTER TABLE "assessments" ADD CONSTRAINT assessments_attempts_chk CHECK (attempts_allowed BETWEEN 1 AND 20);
ALTER TABLE "assessments" ADD CONSTRAINT assessments_window_chk CHECK (opens_at IS NULL OR due_at IS NULL OR due_at > opens_at);
ALTER TABLE "assessments" ADD CONSTRAINT assessments_code_chk CHECK (code ~ '^[A-Za-z0-9_-]{2,40}$');
ALTER TABLE "questions" ADD CONSTRAINT questions_marks_chk CHECK (marks BETWEEN 0 AND 100);
-- Marks never leave the 0..max range, whoever writes them.
CREATE OR REPLACE FUNCTION yojo_attempt_score_in_range() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mx int;
BEGIN
  IF NEW.score IS NULL AND NEW.auto_score IS NULL THEN RETURN NEW; END IF;
  SELECT max_marks INTO mx FROM assessments WHERE id = NEW.assessment_id;
  IF (NEW.score IS NOT NULL AND (NEW.score < 0 OR NEW.score > mx)) OR (NEW.auto_score IS NOT NULL AND (NEW.auto_score < 0 OR NEW.auto_score > mx)) THEN
    RAISE EXCEPTION 'score out of range for assessment %', NEW.assessment_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attempts_score_in_range BEFORE INSERT OR UPDATE ON "attempts" FOR EACH ROW EXECUTE FUNCTION yojo_attempt_score_in_range();
-- One open attempt per student and assessment.
CREATE UNIQUE INDEX attempts_one_open ON "attempts" (assessment_id, student_id) WHERE status = 'in_progress';
CREATE TRIGGER grade_history_append_only BEFORE UPDATE OR DELETE ON "grade_history" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
