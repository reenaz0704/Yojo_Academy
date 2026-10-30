-- Student Academy, slice (a): XP ledger, student activity, streaks (48 h grace, keep/reset decision),
-- achievements and the weekly league. Generated with `prisma migrate diff` plus the hand-written rules below.
-- Additive only.

-- CreateEnum
CREATE TYPE "XpKind" AS ENUM ('award', 'penalty', 'correction');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('lesson_completed', 'lab_completed', 'blog_read', 'quiz_passed');

-- CreateEnum
CREATE TYPE "StreakDecision" AS ENUM ('keep', 'reset');

-- CreateEnum
CREATE TYPE "LeagueDivision" AS ENUM ('bronze', 'silver', 'gold', 'platinum', 'diamond');

-- CreateTable
CREATE TABLE "xp_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" "XpKind" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "qualifies" BOOLEAN NOT NULL DEFAULT false,
    "actor_id" UUID,
    "week_start" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_activity" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "category" TEXT,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "day" DATE NOT NULL,
    "week_start" DATE NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streak_state" (
    "user_id" UUID NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "longest" INTEGER NOT NULL DEFAULT 0,
    "last_qualified_day" DATE,
    "last_qualified_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "streak_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "streak_days" (
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "streak_days_pkey" PRIMARY KEY ("user_id","day")
);

-- CreateTable
CREATE TABLE "streak_breaks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "streak_length" INTEGER NOT NULL,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "StreakDecision",
    "xp_cost" INTEGER,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "streak_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "rule_kind" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "rule_arg" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","code")
);

-- CreateTable
CREATE TABLE "league_memberships" (
    "user_id" UUID NOT NULL,
    "division" "LeagueDivision" NOT NULL DEFAULT 'bronze',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_memberships_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "league_results" (
    "week_start" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "division" "LeagueDivision" NOT NULL,
    "rank" INTEGER NOT NULL,
    "week_xp" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_results_pkey" PRIMARY KEY ("week_start","user_id")
);

-- CreateTable
CREATE TABLE "onboarding_results" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rules_version" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "offensive" INTEGER NOT NULL,
    "defensive" INTEGER NOT NULL,
    "grc" INTEGER NOT NULL,
    "primary" TEXT NOT NULL,
    "secondary" TEXT NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "confidence" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "xp_ledger_user_id_created_at_idx" ON "xp_ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "xp_ledger_week_start_user_id_idx" ON "xp_ledger"("week_start", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "xp_ledger_user_id_source_key" ON "xp_ledger"("user_id", "source");

-- CreateIndex
CREATE INDEX "student_activity_user_id_day_idx" ON "student_activity"("user_id", "day");

-- CreateIndex
CREATE INDEX "student_activity_user_id_kind_idx" ON "student_activity"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "student_activity_user_id_kind_ref_id_day_key" ON "student_activity"("user_id", "kind", "ref_id", "day");

-- CreateIndex
CREATE INDEX "streak_breaks_user_id_detected_at_idx" ON "streak_breaks"("user_id", "detected_at");

-- CreateIndex
CREATE INDEX "league_results_user_id_idx" ON "league_results"("user_id");

-- CreateIndex
CREATE INDEX "onboarding_results_user_id_created_at_idx" ON "onboarding_results"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_activity" ADD CONSTRAINT "student_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_state" ADD CONSTRAINT "streak_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_code_fkey" FOREIGN KEY ("code") REFERENCES "achievements"("code") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
-- Awards are positive, penalties negative; corrections may go either way but never zero.
ALTER TABLE "xp_ledger" ADD CONSTRAINT xp_ledger_sign_chk CHECK (
  delta <> 0 AND (kind <> 'award' OR delta > 0) AND (kind <> 'penalty' OR delta < 0));
ALTER TABLE "xp_ledger" ADD CONSTRAINT xp_ledger_reason_chk CHECK (char_length(reason) BETWEEN 3 AND 300);
-- The ledger is history: no edits, no deletes (fix mistakes with a correction row).
CREATE TRIGGER xp_ledger_append_only BEFORE UPDATE OR DELETE ON "xp_ledger" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
ALTER TABLE "streak_state" ADD CONSTRAINT streak_state_values_chk CHECK (current >= 0 AND longest >= current);
ALTER TABLE "streak_breaks" ADD CONSTRAINT streak_breaks_decided_chk CHECK ((decision IS NULL) = (decided_at IS NULL));
ALTER TABLE "streak_breaks" ADD CONSTRAINT streak_breaks_cost_chk CHECK (xp_cost IS NULL OR xp_cost >= 0);
-- At most one undecided break per student, so the pop-up is answered exactly once.
CREATE UNIQUE INDEX streak_breaks_one_open ON "streak_breaks" (user_id) WHERE decided_at IS NULL;
ALTER TABLE "league_results" ADD CONSTRAINT league_results_outcome_chk CHECK (outcome IN ('promoted', 'stayed', 'demoted'));
