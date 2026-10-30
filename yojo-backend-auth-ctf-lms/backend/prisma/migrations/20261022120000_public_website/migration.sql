-- Public website backend: enquiries inbox, subscriptions (event reminders, newsletter), managed website content.
-- Generated with `prisma migrate diff` from the previous state, plus the hand-written sequence, CHECKs and
-- append-only triggers below (Prisma cannot express them). Additive only: no existing column changes.

CREATE SEQUENCE IF NOT EXISTS public_submission_ref_seq START 1001;

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('contact', 'mentorship_session', 'internship_application', 'course_enrolment');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('new', 'reviewing', 'assigned', 'in_progress', 'waiting_for_user', 'resolved', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "PublicSubscriptionKind" AS ENUM ('newsletter', 'event_reminder');

-- CreateEnum
CREATE TYPE "PublicSubscriptionStatus" AS ENUM ('active', 'unsubscribed');

-- CreateEnum
CREATE TYPE "PublicContentKind" AS ENUM ('faq', 'testimonial', 'mentor', 'post');

-- CreateEnum
CREATE TYPE "PublicContentStatus" AS ENUM ('draft', 'published', 'archived');

-- AlterTable
ALTER TABLE "ctf_events" ADD COLUMN     "duration_hours" INTEGER,
ADD COLUMN     "format" TEXT,
ADD COLUMN     "listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "public_submissions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL DEFAULT ('ENQ-'::text || (nextval('public_submission_ref_seq'::regclass))::text),
    "type" "SubmissionType" NOT NULL,
    "topic" TEXT,
    "name" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "message" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "source_page" TEXT,
    "user_id" UUID,
    "consent_kind" TEXT,
    "consent_version" TEXT,
    "consent_at" TIMESTAMPTZ(6),
    "status" "SubmissionStatus" NOT NULL DEFAULT 'new',
    "assignee_id" UUID,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_response_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "public_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_notes" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_events" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" TEXT NOT NULL,
    "from_status" "SubmissionStatus",
    "to_status" "SubmissionStatus",
    "assignee_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_subscriptions" (
    "id" UUID NOT NULL,
    "kind" "PublicSubscriptionKind" NOT NULL,
    "email" CITEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "event_id" UUID,
    "status" "PublicSubscriptionStatus" NOT NULL DEFAULT 'active',
    "consent_version" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribe_hash" TEXT NOT NULL,
    "unsubscribed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_content" (
    "id" UUID NOT NULL,
    "kind" "PublicContentKind" NOT NULL,
    "slug" CITEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "PublicContentStatus" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_submissions_reference_key" ON "public_submissions"("reference");

-- CreateIndex
CREATE INDEX "public_submissions_status_created_at_idx" ON "public_submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "public_submissions_type_created_at_idx" ON "public_submissions"("type", "created_at");

-- CreateIndex
CREATE INDEX "public_submissions_assignee_id_status_idx" ON "public_submissions"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "public_submissions_dedupe_key_created_at_idx" ON "public_submissions"("dedupe_key", "created_at");

-- CreateIndex
CREATE INDEX "public_submissions_user_id_idx" ON "public_submissions"("user_id");

-- CreateIndex
CREATE INDEX "submission_notes_submission_id_created_at_idx" ON "submission_notes"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "submission_events_submission_id_at_idx" ON "submission_events"("submission_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "public_subscriptions_unsubscribe_hash_key" ON "public_subscriptions"("unsubscribe_hash");

-- CreateIndex
CREATE INDEX "public_subscriptions_event_id_status_idx" ON "public_subscriptions"("event_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "public_subscriptions_kind_email_scope_key" ON "public_subscriptions"("kind", "email", "scope");

-- CreateIndex
CREATE INDEX "public_content_kind_status_sort_order_idx" ON "public_content"("kind", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "public_content_kind_slug_key" ON "public_content"("kind", "slug");

-- AddForeignKey
ALTER TABLE "public_submissions" ADD CONSTRAINT "public_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_submissions" ADD CONSTRAINT "public_submissions_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_notes" ADD CONSTRAINT "submission_notes_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_subscriptions" ADD CONSTRAINT "public_subscriptions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ctf_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Constraints Prisma cannot express ──
ALTER TABLE "public_submissions" ADD CONSTRAINT public_submissions_name_len_chk CHECK (char_length(name) BETWEEN 2 AND 100);
ALTER TABLE "public_submissions" ADD CONSTRAINT public_submissions_message_len_chk CHECK (message IS NULL OR char_length(message) <= 2000);
ALTER TABLE "public_submissions" ADD CONSTRAINT public_submissions_topic_len_chk CHECK (topic IS NULL OR char_length(topic) <= 150);
ALTER TABLE "public_submissions" ADD CONSTRAINT public_submissions_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL);
-- Anonymous forms must carry a recorded consent; the signed-in course request is tied to the account instead.
ALTER TABLE "public_submissions" ADD CONSTRAINT public_submissions_consent_chk CHECK (
  (type = 'course_enrolment' AND user_id IS NOT NULL) OR (consent_version IS NOT NULL AND consent_at IS NOT NULL));
ALTER TABLE "submission_notes" ADD CONSTRAINT submission_notes_body_len_chk CHECK (char_length(body) BETWEEN 1 AND 2000);
ALTER TABLE "public_subscriptions" ADD CONSTRAINT public_subscriptions_scope_chk CHECK (
  (kind = 'event_reminder' AND event_id IS NOT NULL AND scope = event_id::text) OR (kind = 'newsletter' AND event_id IS NULL AND scope = ''));
ALTER TABLE "public_content" ADD CONSTRAINT public_content_slug_chk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$');
ALTER TABLE "public_content" ADD CONSTRAINT public_content_title_len_chk CHECK (char_length(title) BETWEEN 1 AND 200);
ALTER TABLE "public_content" ADD CONSTRAINT public_content_body_len_chk CHECK (char_length(body) <= 20000);
ALTER TABLE "public_content" ADD CONSTRAINT public_content_published_at_chk CHECK (status <> 'published' OR published_at IS NOT NULL);
ALTER TABLE "ctf_events" ADD CONSTRAINT ctf_events_duration_chk CHECK (duration_hours IS NULL OR duration_hours BETWEEN 1 AND 720);

-- History and internal notes are written once (no edits). Deletes stay possible for a future erasure job.
CREATE TRIGGER submission_events_append_only BEFORE UPDATE ON "submission_events" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
CREATE TRIGGER submission_notes_append_only BEFORE UPDATE ON "submission_notes" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
