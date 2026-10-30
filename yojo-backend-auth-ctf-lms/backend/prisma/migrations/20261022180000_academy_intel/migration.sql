-- Student Academy, slice (f): Intel blogs, moderation history, reactions, comments, views, reports.
-- Generated with `prisma migrate diff` plus the hand-written rules below. Additive.

-- CreateEnum
CREATE TYPE "BlogStatus" AS ENUM ('draft', 'in_review', 'changes_requested', 'published', 'rejected', 'unpublished');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('visible', 'hidden');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "blogs" (
    "id" UUID NOT NULL,
    "slug" CITEXT,
    "author_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BlogStatus" NOT NULL DEFAULT 'draft',
    "reading_minutes" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "reviewer_id" UUID,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_events" (
    "id" UUID NOT NULL,
    "blog_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_reactions" (
    "blog_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_reactions_pkey" PRIMARY KEY ("blog_id","user_id")
);

-- CreateTable
CREATE TABLE "blog_comments" (
    "id" UUID NOT NULL,
    "blog_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'visible',
    "hidden_by" UUID,
    "hidden_why" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_views" (
    "blog_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "blog_views_pkey" PRIMARY KEY ("blog_id","user_id","day")
);

-- CreateTable
CREATE TABLE "content_reports" (
    "id" UUID NOT NULL,
    "blog_id" UUID,
    "comment_id" UUID,
    "reporter_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blogs_slug_key" ON "blogs"("slug");

-- CreateIndex
CREATE INDEX "blogs_status_published_at_idx" ON "blogs"("status", "published_at");

-- CreateIndex
CREATE INDEX "blogs_author_id_idx" ON "blogs"("author_id");

-- CreateIndex
CREATE INDEX "blog_events_blog_id_at_idx" ON "blog_events"("blog_id", "at");

-- CreateIndex
CREATE INDEX "blog_comments_blog_id_created_at_idx" ON "blog_comments"("blog_id", "created_at");

-- CreateIndex
CREATE INDEX "content_reports_status_created_at_idx" ON "content_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "blog_events" ADD CONSTRAINT "blog_events_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_reactions" ADD CONSTRAINT "blog_reactions_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_comments" ADD CONSTRAINT "blog_comments_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_views" ADD CONSTRAINT "blog_views_blog_id_fkey" FOREIGN KEY ("blog_id") REFERENCES "blogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Rules Prisma cannot express ──
ALTER TABLE "blogs" ADD CONSTRAINT blogs_title_chk CHECK (char_length(title) BETWEEN 5 AND 150);
ALTER TABLE "blogs" ADD CONSTRAINT blogs_body_chk CHECK (char_length(body) BETWEEN 1 AND 30000);
ALTER TABLE "blogs" ADD CONSTRAINT blogs_published_chk CHECK (status <> 'published' OR (published_at IS NOT NULL AND slug IS NOT NULL));
ALTER TABLE "blog_comments" ADD CONSTRAINT blog_comments_body_chk CHECK (char_length(body) BETWEEN 1 AND 2000);
ALTER TABLE "content_reports" ADD CONSTRAINT content_reports_target_chk CHECK ((blog_id IS NULL) <> (comment_id IS NULL));
CREATE TRIGGER blog_events_append_only BEFORE UPDATE OR DELETE ON "blog_events" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
