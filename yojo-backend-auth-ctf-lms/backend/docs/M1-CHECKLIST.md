# Milestone 1 checklist: requirement → code → test

Test results below were produced by real runs on 22 Oct 2026 (Node 22.22, PostgreSQL 16.15, Redis 7) in the build
environment: `format:check`, `lint`, `typecheck`, `build` all exit 0; **198 unit tests** (8 suites) and **68 e2e tests**
(5 suites, real PostgreSQL + Redis) pass. Full test names: `npm test -- --verbose`, `npm run test:e2e -- --verbose`.

Legend: ✅ done and tested · 🟡 done, partly tested or depends on a later milestone · ⛔ blocked (see OPEN-ITEMS.md)

## Task requirements (Step 1 brief)

| Requirement | Status | Code | Tests |
|---|---|---|---|
| Project structure, strict TS, lint/format/typecheck scripts | ✅ | `package.json`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc` | CI-equivalent runs above |
| Validated configuration, fail fast, no secret values printed | ✅ | `src/config/config.schema.ts` | `config.schema.spec.ts` (AC-ENV-02) |
| Centralised errors (problem+json, `needs`) | ✅ | `src/common/errors/*` | `security.e2e-spec.ts` › validation and error format |
| Request validation, unknown fields rejected | ✅ | `src/common/http/validation.ts`, DTOs in `src/identity/dto` | `security.e2e-spec.ts` › mass assignment |
| API versioning `/api/v1` | ✅ | `src/bootstrap.ts` | every e2e test |
| Swagger / OpenAPI | ✅ | `src/openapi.ts`, `/api/docs`, `npm run openapi` (43 paths) | manual run: `/api/docs` 200 |
| Prisma migrations: accounts, roles, permissions, settings, audit; constraints, indexes | ✅ | `prisma/schema.prisma`, `prisma/migrations/20261022050235_foundation` | `prisma migrate diff` (no drift), `security.e2e` triggers |
| Safe, idempotent seeding | ✅ | `prisma/seed.ts`, `scripts/bootstrap-admin.ts` | `rbac.e2e` › table equals matrix; seed re-run |
| Student registration (OTP, consents, parental, domain) | ✅ | `src/identity/student-auth.service.ts` | `auth-student.e2e-spec.ts` (14 tests) |
| Admin-provisioned staff accounts (invites, access requests) | ✅ | `src/identity/staff-admin.service.ts`, `staff-auth.service.ts` | `auth-staff.e2e-spec.ts` |
| Login / logout, argon2id | ✅ | `password.service.ts`, `staff-auth.service.ts`, `account.service.ts` | `password.service.spec.ts`, `auth-staff.e2e` |
| Account lifecycle (invited → active, suspended, lock) | ✅ | `staff-auth.service.ts`, `staff-admin.service.ts`, `login.service.ts` | `auth-staff.e2e` lock, `rbac.e2e` suspension |
| Password recovery | ✅ | `staff-auth.service.ts` forgot/reset | `auth-staff.e2e` forgot/reset |
| Sessions: expiry, revocation, device list | ✅ | `session.service.ts`, `account.service.ts` | `acceptance.e2e` idle expiry, `auth-student.e2e` logout-all |
| Guards, decorators, RBAC, no self-elevation | ✅ | `src/common/guards/*`, `src/common/decorators/auth.decorators.ts`, `src/access/*` | `policy.guard.spec.ts` (all 128 matrix cells), `rbac.e2e-spec.ts` |
| Rate limiting | ✅ | `rate-limit.service.ts`, `rate-limit.guard.ts` | `security.e2e` › rate limits, `auth-student.e2e` resend |
| Settings with validation, versions, history | ✅ | `src/settings/*` | `settings.schemas.spec.ts`, `security.e2e` › settings |
| Audit logging, no secrets, not modifiable | ✅ | `src/audit/*`, migration triggers | `security.e2e` › audit + sensitive data |
| Health checks | ✅ | `src/health/*` | `security.e2e` › health |
| Structured logs with request IDs | ✅ | `src/app.module.ts` (pino, redaction, traceId) | `acceptance.e2e` › AC-OPS-01 log scan |
| Docker Compose | ✅ (not run here: no Docker in this environment) | `docker-compose.yml`, `Dockerfile` | — |
| Credentials not available → continue behind interfaces | 🟡 | mail port, Google verifier | ⛔ OI-01, OI-02 |

## Milestone 1 exit criteria (spec §28.2)

| Criterion | Status | Evidence |
|---|---|---|
| AC-AUTH-01 student sign-up, OTP never logged/returned, 3 wrong codes burn, resend <30 s → 429 | ✅ | `auth-student.e2e` (burn, resend, consents), `security.e2e` OTP only HMAC, `acceptance.e2e` log scan |
| AC-AUTH-02 staff blocked from non-onboarding endpoints until password, TOTP, policies done | ✅ | `auth-staff.e2e` › onboarding session |
| AC-AUTH-03 every matrix row × sub-role gives Y, R or 403 | 🟡 | Guard level for all 32 keys × 4 roles (`policy.guard.spec.ts`); endpoint level for the M1 endpoints (staff, settings, audit, mfa.reset). Other rows get endpoint tests as their modules land. |
| AC-AUTH-04 trainer scope 404 and no phone/email/guardian/fee fields | 🟡 | Projection helper + unit test; trainer student endpoints arrive in M2 |
| AC-AUTH-05 staff idle 30 min; revocation immediate | ✅ | `acceptance.e2e` idle expiry; revocation tests in `rbac.e2e` and `auth-staff.e2e` (sessions are in shared Redis, so all instances see it) |
| AC-AUTH-06 step-up actions → 428 needs mfa without step-up, succeed with it | ✅ for M1 actions | password change, role change, MFA reset, policy/plans/auth settings (`auth-staff.e2e`, `rbac.e2e`, `security.e2e`); other listed actions belong to later modules |
| AC-AUTH-07 password reset revokes all sessions; MFA reset needs two different Platform admins; audited | ✅ | `auth-staff.e2e` forgot/reset, `rbac.e2e` dual control |
| AC-AUTH-08 UPDATE/DELETE on audit_log fails; verifier detects a modified row | ✅ | `security.e2e` › audit |
| AC-AUTH-09 same content and timing (p95 within 50 ms) for existing and unknown accounts | ✅ | `acceptance.e2e` (staff login, password forgot, OTP send) |
| AC-AUTH-10 staff 403 on student routes; students 403 on trainer/admin | ✅ | `acceptance.e2e`, `rbac.e2e` |
| AC-ENV-01 environments from code | ⛔ | OI-05 |
| AC-ENV-02 refuses to start on bad config | ✅ | `config.schema.spec.ts` |
| AC-ENV-03 gated production deploys, rollback | ⛔ | OI-04 |
| AC-ENV-04 no production secret readable from dev/staging | ⛔ | OI-03 |
| AC-SEC-01 CI blocks on dependency/secret findings | 🟡 | workflow written (`ci/backend-ci.yml` (copy into `.github/workflows/` of the repository)), not run (OI-04); `npm audit --omit=dev`: 0 high, 2 moderate (see OPEN-ITEMS) |
| AC-OPS-01 request ID and trace ID in logs; no secrets in logs | ✅ | `acceptance.e2e` › log scan of a real server process |
| AC-OPS-04 zero-downtime migrations in the pipeline | ⛔ | needs pipeline (OI-04); migration is additive-only and applied with `migrate deploy` |

## Endpoint ↔ guard summary

| Endpoint group | Session | Role | Permission (min) | Reason | Step-up |
|---|---|---|---|---|---|
| `auth/student/*`, `auth/signup`, `auth/google` | public | – | – | – | – |
| `auth/staff/login`, `totp`, `invite/accept`, `mfa-reenrol`, `access-request`, `password/forgot`, `password/reset` | public | – | – | – | – (reset needs TOTP in body) |
| `auth/staff/onboarding`, `mfa-setup`, `mfa-confirm`, `policy` | onboarding or full | admin, trainer | – | – | – |
| `auth/staff/profile` | onboarding or full | trainer | – | – | – |
| `auth/step-up` | full | admin, trainer | – | – | code in body |
| `auth/password` | full | admin, trainer | – | – | fresh |
| `auth/logout`, `logout-all` | any | any | – | – | – |
| `auth/sessions`, `me`, `me/missing-fields` | full | any (missing-fields: student) | – | – | – |
| `admin/staff`, `invites`, `requests`, `decide` | full | admin | staff (Y) | decline: yes | – |
| `admin/staff/:id/status` | full | admin | staff (Y) | yes | – |
| `admin/staff/:id/role` | full | admin | staff (Y) | yes | fresh |
| `admin/staff/:id/mfa-reset`, `admin/dual-control/*` | full | admin | mfa.reset (Y) | yes (start) | fresh |
| `admin/settings/*` | full | admin | settings (R) + per-section role list | – | fresh for policy, plans, auth |
| `admin/audit` | full | admin | audit.view (R: own rows only) | – | – |
| `admin/audit/verify` | full | admin | audit.view (Y) | – | – |
| `trainer/audit` | full | trainer | – | – | – |
| `public/status`, `health/*` | public | – | – | – | – |
