-- CreateTable
CREATE TABLE "mission_objectives" (
    "id" UUID NOT NULL,
    "mission_code" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "xp" INTEGER NOT NULL DEFAULT 0,
    "per_correct_xp" INTEGER NOT NULL DEFAULT 0,
    "answer_format" TEXT,
    "answer_hash" TEXT,
    "answer_salt" TEXT,
    "placeholder" TEXT,
    "quiz" JSONB,
    "quiz_key" JSONB,

    CONSTRAINT "mission_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_progress" (
    "user_id" UUID NOT NULL,
    "mission_code" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "max_score" INTEGER,
    "xp_awarded" INTEGER,
    "completed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "objective_progress_pkey" PRIMARY KEY ("user_id","mission_code","n")
);

-- CreateIndex
CREATE UNIQUE INDEX "mission_objectives_mission_code_n_key" ON "mission_objectives"("mission_code", "n");

-- AddForeignKey
ALTER TABLE "mission_objectives" ADD CONSTRAINT "mission_objectives_mission_code_fkey" FOREIGN KEY ("mission_code") REFERENCES "missions"("code") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written rules (lab objectives, 24 Oct)
ALTER TABLE "mission_objectives"
  ADD CONSTRAINT "mission_objective_kind" CHECK ("kind" IN ('read', 'quiz', 'answer', 'lab_answer')),
  ADD CONSTRAINT "mission_objective_n" CHECK ("n" BETWEEN 1 AND 20),
  ADD CONSTRAINT "mission_objective_xp" CHECK ("xp" >= 0 AND "per_correct_xp" >= 0),
  ADD CONSTRAINT "mission_objective_format" CHECK (
    ("kind" IN ('answer', 'lab_answer') AND "answer_format" IN ('text', 'set', 'date', 'count', 'session_flag')) OR
    ("kind" NOT IN ('answer', 'lab_answer') AND "answer_format" IS NULL)),
  -- an answer step keeps a salted hash unless the lab service checks it per session
  ADD CONSTRAINT "mission_objective_answer" CHECK (
    "kind" NOT IN ('answer', 'lab_answer') OR "answer_format" = 'session_flag' OR ("answer_hash" IS NOT NULL AND "answer_salt" IS NOT NULL)),
  ADD CONSTRAINT "mission_objective_quiz" CHECK ("kind" <> 'quiz' OR ("quiz" IS NOT NULL AND "quiz_key" IS NOT NULL));
ALTER TABLE "objective_progress"
  ADD CONSTRAINT "objective_progress_score" CHECK ("score" IS NULL OR ("score" >= 0 AND ("max_score" IS NULL OR "score" <= "max_score"))),
  ADD CONSTRAINT "objective_progress_tries" CHECK ("tries" >= 0);
