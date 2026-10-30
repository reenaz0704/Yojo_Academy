-- Student Academy, slice (e): World Breach Map cities, missions (server-side answers), attempts and hints.
-- Generated with `prisma migrate diff` plus the hand-written rules below. Additive.

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('draft', 'published', 'retired');

-- CreateEnum
CREATE TYPE "MissionAttemptStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateTable
CREATE TABLE "cities" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "missions" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'Beginner',
    "est_minutes" TEXT NOT NULL DEFAULT '',
    "xp_reward" INTEGER NOT NULL,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city_code" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'native',
    "provider_slug" TEXT,
    "flag_hash" TEXT,
    "flag_salt" TEXT,
    "max_submissions" INTEGER NOT NULL DEFAULT 20,
    "status" "MissionStatus" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "mission_hints" (
    "mission_code" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "mission_hints_pkey" PRIMARY KEY ("mission_code","n")
);

-- CreateTable
CREATE TABLE "mission_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mission_code" TEXT NOT NULL,
    "status" "MissionAttemptStatus" NOT NULL DEFAULT 'active',
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "xp_awarded" INTEGER,

    CONSTRAINT "mission_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hint_uses" (
    "user_id" UUID NOT NULL,
    "mission_code" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "pct" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "xp_cost" INTEGER,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hint_uses_pkey" PRIMARY KEY ("user_id","mission_code","n")
);

-- CreateIndex
CREATE INDEX "missions_status_category_idx" ON "missions"("status", "category");

-- CreateIndex
CREATE INDEX "mission_attempts_user_id_mission_code_idx" ON "mission_attempts"("user_id", "mission_code");

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_city_code_fkey" FOREIGN KEY ("city_code") REFERENCES "cities"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_hints" ADD CONSTRAINT "mission_hints_mission_code_fkey" FOREIGN KEY ("mission_code") REFERENCES "missions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_attempts" ADD CONSTRAINT "mission_attempts_mission_code_fkey" FOREIGN KEY ("mission_code") REFERENCES "missions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
ALTER TABLE "missions" ADD CONSTRAINT missions_code_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$');
ALTER TABLE "missions" ADD CONSTRAINT missions_xp_chk CHECK (xp_reward BETWEEN 0 AND 10000);
ALTER TABLE "missions" ADD CONSTRAINT missions_provider_chk CHECK (provider IN ('native', 'mission-api'));
ALTER TABLE "missions" ADD CONSTRAINT missions_flag_chk CHECK ((flag_hash IS NULL) = (flag_salt IS NULL));
ALTER TABLE "mission_hints" ADD CONSTRAINT mission_hints_n_chk CHECK (n BETWEEN 1 AND 3);
ALTER TABLE "hint_uses" ADD CONSTRAINT hint_uses_n_chk CHECK (n BETWEEN 1 AND 3 AND pct BETWEEN 0 AND 100);
ALTER TABLE "mission_attempts" ADD CONSTRAINT mission_attempts_done_chk CHECK ((status = 'completed') = (completed_at IS NOT NULL));
-- One active attempt per student and mission.
CREATE UNIQUE INDEX mission_attempts_one_active ON "mission_attempts" (user_id, mission_code) WHERE status = 'active';
-- Hint charges are history.
CREATE TRIGGER hint_uses_append_only BEFORE UPDATE OR DELETE ON "hint_uses" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
