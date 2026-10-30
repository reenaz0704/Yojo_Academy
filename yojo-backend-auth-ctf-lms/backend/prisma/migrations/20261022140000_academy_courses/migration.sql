-- Student Academy, slice (b): courses, modules, lessons, FAQs, lesson progress, certificates, and the course a
-- batch runs (batches.course_id). Generated with `prisma migrate diff` plus the hand-written rules below. Additive.

CREATE SEQUENCE IF NOT EXISTS certificate_code_seq START 1001;

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('draft', 'published', 'unpublished', 'archived');

-- CreateEnum
CREATE TYPE "CourseAccess" AS ENUM ('free', 'paid');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('video', 'document', 'slides', 'concept', 'quiz', 'lab', 'live_class', 'resource');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "LessonCompletion" AS ENUM ('manual', 'quiz_pass', 'lab_cleared');

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "course_id" UUID;

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "overview" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT '',
    "duration" TEXT NOT NULL DEFAULT '',
    "format" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "access" "CourseAccess" NOT NULL DEFAULT 'paid',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prerequisites" TEXT NOT NULL DEFAULT '',
    "prerequisite_course_id" UUID,
    "audience" TEXT NOT NULL DEFAULT '',
    "labs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certificate" TEXT,
    "image_url" TEXT,
    "price_paise" INTEGER,
    "status" "CourseStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "LessonType" NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "completion" "LessonCompletion" NOT NULL DEFAULT 'manual',
    "ref_code" TEXT,
    "content_url" TEXT,
    "body" TEXT,
    "file_key" TEXT,
    "file_name" TEXT,
    "file_size_mb" DECIMAL(8,2),
    "downloadable" BOOLEAN NOT NULL DEFAULT false,
    "duration_min" INTEGER,
    "release_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_faqs" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "course_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_access_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("user_id","lesson_id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT ('YJ-CERT-'::text || (nextval('certificate_code_seq'::regclass))::text),
    "user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_status_category_idx" ON "courses"("status", "category");

-- CreateIndex
CREATE INDEX "course_modules_course_id_sort_order_idx" ON "course_modules"("course_id", "sort_order");

-- CreateIndex
CREATE INDEX "lessons_course_id_status_idx" ON "lessons"("course_id", "status");

-- CreateIndex
CREATE INDEX "lessons_module_id_sort_order_idx" ON "lessons"("module_id", "sort_order");

-- CreateIndex
CREATE INDEX "course_faqs_course_id_sort_order_idx" ON "course_faqs"("course_id", "sort_order");

-- CreateIndex
CREATE INDEX "lesson_progress_user_id_course_id_idx" ON "lesson_progress"("user_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_code_key" ON "certificates"("code");

-- CreateIndex
CREATE INDEX "certificates_user_id_idx" ON "certificates"("user_id");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_faqs" ADD CONSTRAINT "course_faqs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
ALTER TABLE "courses" ADD CONSTRAINT courses_slug_chk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$');
ALTER TABLE "courses" ADD CONSTRAINT courses_code_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,23}$');
ALTER TABLE "courses" ADD CONSTRAINT courses_price_chk CHECK (price_paise IS NULL OR price_paise >= 0);
ALTER TABLE "courses" ADD CONSTRAINT courses_published_at_chk CHECK (status <> 'published' OR published_at IS NOT NULL);
ALTER TABLE "courses" ADD CONSTRAINT courses_prereq_chk CHECK (prerequisite_course_id IS NULL OR prerequisite_course_id <> id);
ALTER TABLE "lessons" ADD CONSTRAINT lessons_completion_chk CHECK (completion = 'manual' OR ref_code IS NOT NULL);
ALTER TABLE "lessons" ADD CONSTRAINT lessons_url_chk CHECK (content_url IS NULL OR content_url ~ '^https://');
ALTER TABLE "lesson_progress" ADD CONSTRAINT lesson_progress_order_chk CHECK (completed_at IS NULL OR completed_at >= started_at);
ALTER TABLE "certificates" ADD CONSTRAINT certificates_revoke_chk CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL));
-- One valid certificate per student and course; a revoked one can be reissued.
CREATE UNIQUE INDEX certificates_one_active ON "certificates" (user_id, course_id) WHERE revoked_at IS NULL;
