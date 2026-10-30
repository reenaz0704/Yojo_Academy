-- Student Academy, slice (g): Placement Mission: resume (with version snapshots), portfolio projects, mock interview
-- results, internship-preparation milestones. Generated with `prisma migrate diff` plus the rules below. Additive.

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('not_submitted', 'submitted', 'changes_requested', 'approved');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('submitted', 'done', 'changes_requested');

-- CreateTable
CREATE TABLE "resumes" (
    "user_id" UUID NOT NULL,
    "headline" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'not_submitted',
    "feedback" TEXT,
    "reviewer_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "resume_versions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repo_url" TEXT,
    "demo_url" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReviewStatus" NOT NULL DEFAULT 'not_submitted',
    "feedback" TEXT,
    "reviewer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_interview_results" (
    "request_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "interviewer_id" UUID NOT NULL,
    "technical" INTEGER NOT NULL,
    "communication" INTEGER NOT NULL,
    "problem_solving" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "feedback" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_interview_results_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "placement_milestones" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "due_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "placement_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_milestones" (
    "user_id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'submitted',
    "evidence_url" TEXT,
    "note" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_milestones_pkey" PRIMARY KEY ("user_id","milestone_id")
);

-- CreateIndex
CREATE INDEX "resume_versions_user_id_created_at_idx" ON "resume_versions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "portfolio_projects_user_id_idx" ON "portfolio_projects"("user_id");

-- CreateIndex
CREATE INDEX "mock_interview_results_student_id_idx" ON "mock_interview_results"("student_id");

-- AddForeignKey
ALTER TABLE "student_milestones" ADD CONSTRAINT "student_milestones_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "placement_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
ALTER TABLE "portfolio_projects" ADD CONSTRAINT portfolio_urls_chk CHECK (
  (repo_url IS NULL OR repo_url ~ '^https?://') AND (demo_url IS NULL OR demo_url ~ '^https?://'));
ALTER TABLE "portfolio_projects" ADD CONSTRAINT portfolio_title_chk CHECK (char_length(title) BETWEEN 2 AND 120);
ALTER TABLE "mock_interview_results" ADD CONSTRAINT mock_scores_chk CHECK (
  technical BETWEEN 1 AND 5 AND communication BETWEEN 1 AND 5 AND problem_solving BETWEEN 1 AND 5);
ALTER TABLE "student_milestones" ADD CONSTRAINT student_milestones_url_chk CHECK (evidence_url IS NULL OR evidence_url ~ '^https?://');
CREATE TRIGGER resume_versions_append_only BEFORE UPDATE OR DELETE ON "resume_versions" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
