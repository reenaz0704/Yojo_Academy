-- CreateTable
CREATE TABLE "career_path_results" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "quiz_version" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB,
    "offensive_pct" INTEGER,
    "defensive_pct" INTEGER,
    "grc_pct" INTEGER,
    "suggested" TEXT,
    "tied_with" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chosen_path" TEXT,
    "chosen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "career_path_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "career_path_results_user_id_created_at_idx" ON "career_path_results"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "career_path_results_chosen_path_idx" ON "career_path_results"("chosen_path");


-- Hand-written rules (career-path quiz, 24 Oct)
ALTER TABLE "career_path_results"
  ADD CONSTRAINT "career_path_pct_range" CHECK (
    ("offensive_pct" IS NULL OR "offensive_pct" BETWEEN 0 AND 100) AND
    ("defensive_pct" IS NULL OR "defensive_pct" BETWEEN 0 AND 100) AND
    ("grc_pct" IS NULL OR "grc_pct" BETWEEN 0 AND 100)),
  ADD CONSTRAINT "career_path_tracks" CHECK (
    ("suggested" IS NULL OR "suggested" IN ('Offensive', 'Defensive', 'GRC')) AND
    ("chosen_path" IS NULL OR "chosen_path" IN ('Offensive', 'Defensive', 'GRC'))),
  -- a skipped row has no answers or scores; a taken row has all of them
  ADD CONSTRAINT "career_path_skip_shape" CHECK (
    ("skipped" AND "answers" IS NULL AND "offensive_pct" IS NULL AND "suggested" IS NULL) OR
    (NOT "skipped" AND "answers" IS NOT NULL AND "offensive_pct" IS NOT NULL AND "defensive_pct" IS NOT NULL AND "grc_pct" IS NOT NULL AND "suggested" IS NOT NULL)),
  ADD CONSTRAINT "career_path_chosen_pair" CHECK (("chosen_path" IS NULL) = ("chosen_at" IS NULL));
