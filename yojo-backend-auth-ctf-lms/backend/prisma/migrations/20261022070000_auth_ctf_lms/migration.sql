-- Code sequences for human-readable ids
CREATE SEQUENCE IF NOT EXISTS subscription_code_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS ctf_registration_code_seq START 1001;

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('payment', 'manual');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('planned', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "EnrolmentStatus" AS ENUM ('active', 'paused', 'completed', 'withdrawn');

-- CreateEnum
CREATE TYPE "CtfEventStatus" AS ENUM ('draft', 'registration', 'live', 'frozen', 'ended');

-- CreateEnum
CREATE TYPE "CtfRegistrationStatus" AS ENUM ('registered', 'approved', 'waitlisted', 'withdrawn', 'disqualified');

-- AlterTable
ALTER TABLE "auth_identities" ADD COLUMN     "secret_hash" TEXT;

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "institution_name" TEXT,
ADD COLUMN     "student_number" CITEXT;

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_paise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "features" JSONB NOT NULL DEFAULT '{}',
    "grants" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT ('SUB-'::text || (nextval('subscription_code_seq'::regclass))::text),
    "student_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "source" "EntitlementSource" NOT NULL,
    "granted_by" UUID,
    "reason" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trainer_id" UUID,
    "co_trainer_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "mode" TEXT NOT NULL DEFAULT 'online',
    "start_date" DATE,
    "end_date" DATE,
    "status" "BatchStatus" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrolments" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "status" "EnrolmentStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ctf_events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "freeze_at" TIMESTAMPTZ(6),
    "status" "CtfEventStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ctf_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ctf_registrations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL DEFAULT ('CR-'::text || (nextval('ctf_registration_code_seq'::regclass))::text),
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "username" CITEXT NOT NULL,
    "phone" TEXT,
    "institution" TEXT,
    "city" TEXT,
    "level" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'solo',
    "team_name" TEXT,
    "status" "CtfRegistrationStatus" NOT NULL DEFAULT 'registered',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ctf_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_code_key" ON "subscriptions"("code");

-- CreateIndex
CREATE INDEX "subscriptions_student_id_status_idx" ON "subscriptions"("student_id", "status");

-- CreateIndex
CREATE INDEX "entitlements_student_id_key_idx" ON "entitlements"("student_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "batches_code_key" ON "batches"("code");

-- CreateIndex
CREATE INDEX "batches_trainer_id_idx" ON "batches"("trainer_id");

-- CreateIndex
CREATE INDEX "enrolments_batch_id_status_idx" ON "enrolments"("batch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrolments_student_id_batch_id_key" ON "enrolments"("student_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "ctf_events_slug_key" ON "ctf_events"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ctf_registrations_code_key" ON "ctf_registrations"("code");

-- CreateIndex
CREATE INDEX "ctf_registrations_user_id_idx" ON "ctf_registrations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ctf_registrations_event_id_user_id_key" ON "ctf_registrations"("event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ctf_registrations_event_id_username_key" ON "ctf_registrations"("event_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_student_number_key" ON "student_profiles"("student_number");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ctf_registrations" ADD CONSTRAINT "ctf_registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ctf_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ctf_registrations" ADD CONSTRAINT "ctf_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Single admin role: only Platform Admin may exist (enum values kept for history)
ALTER TABLE "users" ADD CONSTRAINT users_admin_role_platform_chk CHECK (admin_role IS NULL OR admin_role = 'platform');
ALTER TABLE "staff_invites" ADD CONSTRAINT staff_invites_admin_role_platform_chk CHECK (admin_role IS NULL OR admin_role = 'platform');
DELETE FROM "role_permissions" WHERE admin_role <> 'platform';

-- One active free/paid subscription per student at a time
CREATE UNIQUE INDEX subscriptions_one_active ON "subscriptions"("student_id") WHERE status = 'active';
-- One live entitlement per key per student
CREATE UNIQUE INDEX entitlements_one_live ON "entitlements"("student_id","key") WHERE revoked_at IS NULL;
