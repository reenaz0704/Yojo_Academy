-- Extensions (citext and pgcrypto are trusted extensions; the database owner can create them)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('student', 'trainer', 'admin', 'participant');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('platform', 'payment', 'content', 'support');

-- CreateEnum
CREATE TYPE "Capability" AS ENUM ('trainer', 'trainer_mentor');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending_verification', 'invited', 'active', 'locked', 'suspended', 'deletion_requested', 'deleted');

-- CreateEnum
CREATE TYPE "UserOrigin" AS ENUM ('yojo', 'signup', 'ctf', 'staff');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('google', 'password', 'ctf_password');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('terms', 'privacy', 'aup', 'marketing', 'parental', 'staff_policy', 'code_of_conduct', 'analytics', 'ctf_rules', 'ctf_contact');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'declined');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('Y', 'R');

-- CreateEnum
CREATE TYPE "DualControlKind" AS ENUM ('mfa_reset', 'offline_payment', 'payment_override', 'broadcast');

-- CreateEnum
CREATE TYPE "DualControlStatus" AS ENUM ('awaiting_second_admin', 'confirmed', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('success', 'denied', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "admin_role" "AdminRole",
    "capability" "Capability",
    "status" "UserStatus" NOT NULL,
    "origin" "UserOrigin" NOT NULL,
    "display_name" TEXT,
    "password_hash" TEXT,
    "password_history" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "password_changed_at" TIMESTAMPTZ(6),
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'totp',
    "secret_enc" BYTEA NOT NULL,
    "key_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_hash" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email_domain" CITEXT,
    "is_yojo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "user_id" UUID NOT NULL,
    "name" TEXT,
    "dob" DATE,
    "city" TEXT,
    "institution_id" UUID,
    "edu_level" TEXT,
    "stream" TEXT,
    "grad_year" SMALLINT,
    "cgpa" DECIMAL(4,2),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objective" TEXT,
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "display_name" TEXT,
    "show_on_board" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT,
    "title" TEXT,
    "speciality" TEXT,
    "experience" TEXT,
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "linkedin_url" TEXT,
    "availability" JSONB,
    "is_public_mentor" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "admin_role" "AdminRole",
    "capability" "Capability",
    "batch_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_access_requests" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "role" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_purposes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_purposes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "admin_role" "AdminRole" NOT NULL,
    "permission" TEXT NOT NULL,
    "level" "PermissionLevel" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_log" (
    "id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "by_id" UUID,
    "version" INTEGER NOT NULL,
    "diff" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "seq" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_role" TEXT,
    "admin_role" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "row_hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "route" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dual_control_actions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "DualControlKind" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requested_by" UUID NOT NULL,
    "second_admin" UUID,
    "status" "DualControlStatus" NOT NULL DEFAULT 'awaiting_second_admin',
    "reason" TEXT NOT NULL,
    "decision_note" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dual_control_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_subject_key" ON "auth_identities"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_user_id_type_key" ON "mfa_factors"("user_id", "type");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_hash_key" ON "user_sessions"("session_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "student_profiles_institution_id_idx" ON "student_profiles"("institution_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_student_id_key" ON "guardians"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");

-- CreateIndex
CREATE INDEX "consents_user_id_kind_accepted_at_idx" ON "consents"("user_id", "kind", "accepted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "staff_invites_token_hash_key" ON "staff_invites"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invites_email_idx" ON "staff_invites"("email");

-- CreateIndex
CREATE INDEX "staff_access_requests_status_created_at_idx" ON "staff_access_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "support_purposes_admin_id_student_id_expires_at_idx" ON "support_purposes"("admin_id", "student_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_admin_role_permission_key" ON "role_permissions"("admin_role", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "settings_section_key" ON "settings"("section");

-- CreateIndex
CREATE INDEX "settings_log_section_created_at_idx" ON "settings_log"("section", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_id_key" ON "audit_log"("id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_at_idx" ON "audit_log"("actor_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_action_at_idx" ON "audit_log"("action", "at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_route_key_key" ON "idempotency_keys"("user_id", "route", "key");

-- CreateIndex
CREATE UNIQUE INDEX "dual_control_actions_code_key" ON "dual_control_actions"("code");

-- CreateIndex
CREATE INDEX "dual_control_actions_status_kind_idx" ON "dual_control_actions"("status", "kind");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (spec v2.0 ch. 7) that Prisma cannot express
-- ---------------------------------------------------------------------------

-- Human user codes U-NNNNN (U-20001 upward so pilot codes look like the prototype's U-20417)
CREATE SEQUENCE user_code_seq START 20001;
ALTER TABLE "users" ALTER COLUMN "code" SET DEFAULT ('U-' || nextval('user_code_seq')::text);
CREATE SEQUENCE dual_control_code_seq START 1;

-- Role shape: admins have exactly one sub-role, trainers exactly one capability
ALTER TABLE "users" ADD CONSTRAINT users_admin_role_chk CHECK ((role = 'admin') = (admin_role IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT users_capability_chk CHECK ((role = 'trainer') = (capability IS NOT NULL));
ALTER TABLE "users" ADD CONSTRAINT users_failed_logins_chk CHECK (failed_logins >= 0);

ALTER TABLE "student_profiles" ADD CONSTRAINT student_cgpa_chk CHECK (cgpa IS NULL OR (cgpa >= 0 AND cgpa <= 10));
ALTER TABLE "staff_profiles" ADD CONSTRAINT staff_linkedin_https_chk CHECK (linkedin_url IS NULL OR linkedin_url LIKE 'https://%');
CREATE UNIQUE INDEX institutions_email_domain_key ON "institutions" (email_domain) WHERE email_domain IS NOT NULL;
CREATE INDEX recovery_codes_unused_idx ON "recovery_codes" (user_id) WHERE used_at IS NULL;
CREATE INDEX staff_invites_open_idx ON "staff_invites" (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX outbox_unpublished_idx ON "outbox_events" (occurred_at) WHERE published_at IS NULL;
ALTER TABLE "dual_control_actions" ADD CONSTRAINT dual_control_two_people_chk CHECK (second_admin IS NULL OR second_admin <> requested_by);
ALTER TABLE "dual_control_actions" ALTER COLUMN "code" SET DEFAULT ('DC-' || nextval('dual_control_code_seq')::text);

-- Append-only tables: the application may INSERT and SELECT, never UPDATE or DELETE.
-- A DPDP erasure job may redact rows only inside a transaction that sets yojo.allow_redaction = 'on'.
CREATE OR REPLACE FUNCTION yojo_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('yojo.allow_redaction', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'table % is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
CREATE TRIGGER settings_log_append_only BEFORE UPDATE OR DELETE ON "settings_log" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON "consents" FOR EACH ROW EXECUTE FUNCTION yojo_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION yojo_append_only();
