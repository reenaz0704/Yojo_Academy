# Yojo Cyber Academy backend: Milestone 1 (Foundation)

NestJS 11 + TypeScript (strict) API that implements Milestone 1 of the *Yojo Backend Specification v2.0*
(chapter 28): identity and sign-in for students and staff, sessions, MFA, recovery, RBAC with the admin access
matrix, typed settings, the hash-chained audit log, health checks, structured logs and the job worker skeleton.

Later milestones (courses, labs, CTF, AI, payments, notifications…) are **not** in this step.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22, NestJS 11 (Express), TypeScript 5.9 strict |
| Database | PostgreSQL 16 via Prisma 6 (migrations in `prisma/migrations`, hand SQL for CHECKs, partial indexes, append-only triggers) |
| Sessions, OTP, rate limits | Redis 7 (opaque server-side sessions, sliding-window limits) |
| Jobs | BullMQ worker (`src/worker.ts`) |
| Passwords | argon2id (64 MiB, t=3) |
| MFA | RFC 6238 TOTP, secrets AES-256-GCM encrypted, 10 argon2-hashed recovery codes |
| Validation | class-validator DTOs (unknown fields rejected) + zod for env and settings |
| Errors | `application/problem+json` with `code`, `message`, `field`, `needs`, `requestId` |
| Logs | pino JSON with request IDs; cookies, tokens, passwords and codes redacted |
| API docs | Swagger UI at `/api/docs` (only when `SWAGGER_ENABLED=true`; refused in production) |

## Layout

```
src/
  main.ts, bootstrap.ts      HTTP app (prefix /api/v1, headers, cookies, validation, Swagger)
  worker.ts                  BullMQ worker: audit chain verify 02:00 IST, session/dual-control expiry, outbox relay
  app.module.ts              modules, pino logger, global guards in order
  config/                    zod env schema (fails fast, prints names only), .env loader for local runs
  common/
    errors/                  AppError + ProblemFilter (problem+json, Prisma P2002 → 409, no stack leaks)
    guards/                  session, rate-limit, maintenance, CSRF, policy (permission → reason → step-up)
    decorators/              @Public @Roles @RequirePermission @StepUp @RequireReason @AllowOnboarding @RateLimit
    crypto/ text/ http/      tokens, HMAC, AES-GCM, payment-secret detection, redaction, validation pipe
  access/                    admin access matrix (single source), PolicyService, trainer data projection
  identity/                  student OTP + sign-up, staff password + TOTP, invites, onboarding, recovery,
                             sessions, step-up, /me, staff admin, dual-control MFA reset, mail port (dev adapter)
  settings/                  typed sections with zod, If-Match versions, settings_log, public status
  audit/                     append-only hash-chained audit log, verify(), audit endpoints
  jobs/                      outbox service, maintenance jobs
  health/                    /health/live and /health/ready (DB, Redis, migrations)
  lms/                       Admin LMS users, students, batches; trainer batch rosters
  public-site/               website forms inbox, events and reminders, subscriptions, managed content
  academy/                   Student Academy: XP ledger, streaks, patches, league, onboarding quiz, courses and
                             lessons, Training Grid (sessions, attendance, bookings, leave, messages), assessments,
                             missions and hints, Intel blogs, placement, notifications, Orbi boundary, trainer and
                             admin dashboards, trainer course editing
prisma/                      schema.prisma, migrations, seed.ts (role_permissions + default settings)
scripts/                     bootstrap-admin.ts (first Platform Admin invite), export-openapi.ts, dev-pages-server.js,
                             dev-qa-staff.ts (local only: QA trainer/admin for browser checks)
test/                        e2e suites (real PostgreSQL + Redis): student, staff, RBAC, security
docs/                        OPEN-ITEMS.md, M1-CHECKLIST.md, TEST-RESULTS.md, PUBLIC-INVENTORY.md, ACADEMY-INVENTORY.md
ci/                          GitHub Actions workflow (not run yet; no repository/CI)
```

## Run it locally

Requirements: Node.js 22+, Docker (for PostgreSQL and Redis) or your own PostgreSQL 16 and Redis 7.

```bash
cd backend
cp .env.example .env              # then replace the two REPLACE_WITH_… values (commands are in the file)
docker compose up -d              # PostgreSQL 16 + Redis 7 on 127.0.0.1
npm ci
npx prisma generate
npm run db:migrate                # prisma migrate deploy (non-destructive)
npm run db:seed                   # access matrix + default settings (idempotent)
npm run db:bootstrap-admin -- you@yojosolutions.com   # prints the first Platform Admin invite link once
npm run start:dev                 # http://localhost:3000/api/v1 , docs at http://localhost:3000/api/docs
npm run start:worker              # after `npm run build`; runs scheduled jobs
```

Emails are not sent yet (no provider credentials). With `MAIL_DRIVER=dev` each email (OTP, invite link, reset link)
is written as a JSON file into `.dev-mail/`. To finish the first admin's sign-up: open the invite link token with
`POST /api/v1/auth/invite/accept`, then `mfa-setup`, `mfa-confirm` (authenticator app), and `policy`.

Calling the API by hand: every POST/PUT/PATCH/DELETE needs `X-CSRF-Token`. Get it from `GET /api/v1/auth/csrf`
(it also sets the matching cookie), then after sign-in use the `csrfToken` returned by the sign-in response.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` / `npm start` | compile to `dist/` and run the API |
| `npm run start:dev` | run from source with reload |
| `npm run start:worker` | run the job worker from `dist/` |
| `npm run typecheck` / `lint` / `format:check` | static checks |
| `npm test` | unit tests (no services needed) |
| `npm run test:e2e` | e2e tests against PostgreSQL DB `yojo_test` and Redis DB 15 (see below) |
| `npm run db:migrate` / `db:seed` / `db:bootstrap-admin` | database setup |
| `npm run openapi` | writes `openapi.json` |
| `npm run pages` | serves the HTML pages on http://localhost:8000 (site files only, never `.env` or source) |

### e2e tests

The e2e suite needs a PostgreSQL database whose name ends in `_test` and Redis DB 15; it refuses anything else.
Defaults: `postgresql://yojo:yojo_local_dev@127.0.0.1:5432/yojo_test` and `redis://127.0.0.1:6379/15`
(override with `TEST_DATABASE_URL`, `TEST_REDIS_URL`). Docker Compose creates `yojo_test` on first start;
with your own PostgreSQL run `createdb yojo_test` once.
Global setup applies migrations with `migrate deploy` (non-destructive), seeds, and clears Redis DB 15.
With the Docker database published on another port (for example 5433 when a local PostgreSQL holds 5432):
`TEST_DATABASE_URL=postgresql://yojo:yojo_local_dev@127.0.0.1:5433/yojo_test?schema=public npm run test:e2e`.

## Environment variables

See `.env.example` for safe examples. Required: `DATABASE_URL`, `REDIS_URL`, `FIELD_ENCRYPTION_KEY`
(32 bytes base64), `OTP_HMAC_SECRET` (≥32 chars). Everything else has a default. Production refuses
`MAIL_DRIVER=dev`, `SESSION_COOKIE_SECURE=false` and `SWAGGER_ENABLED=true`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV`, `APP_ENV` | development, local | |
| `PORT`, `LOG_LEVEL` | 3000, info | |
| `DATABASE_URL` | required | PostgreSQL 16 |
| `REDIS_URL`, `REDIS_QUEUE_URL` | required, optional | queue Redis defaults to `REDIS_URL` |
| `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID` | required, local-1 | AES-256-GCM for MFA secrets; KMS in production |
| `OTP_HMAC_SECRET` | required | HMAC for OTP codes |
| `PUBLIC_APP_URL` | http://localhost:8000 | base of emailed links |
| `STAFF_EMAIL_DOMAINS` | yojosolutions.com | comma list [PROVISIONAL] |
| `SESSION_COOKIE_SECURE` | true | false only for plain-HTTP local runs (cookie names `ys`/`yc` instead of `__Host-ys`/`__Host-yc`) |
| `TRUST_PROXY_HOPS` | 1 | NGINX in front |
| `SWAGGER_ENABLED`, `CORS_DISABLED` | false, true | same-origin API (ADR-06) |
| `MAIL_DRIVER`, `MAIL_FROM`, `DEV_MAIL_DIR` | dev, …, .dev-mail | `disabled` drops mail; a real provider comes with credentials |
| `GOOGLE_CLIENT_ID` | unset | Google sign-in answers 503 until set |
| `ENQUIRY_NOTIFY_EMAIL` | unset | team inbox for a short alert per new website enquiry (reference and form only) |
| `SESSION_IDLE/ABSOLUTE_STUDENT_MIN`, `…_STAFF_MIN` | 7 d / 30 d, 30 min / 12 h | [PROVISIONAL] |

## Endpoints (all under `/api/v1`)

| Area | Endpoints |
|---|---|
| CSRF and status | `GET auth/csrf`, `GET public/status`, `GET health/live`, `GET health/ready` |
| Students | `POST auth/student/otp`, `POST auth/student/verify`, `POST auth/signup`, `POST auth/google` |
| Staff sign-in | `POST auth/staff/login`, `POST auth/staff/totp`, `POST auth/invite/accept`, `POST auth/staff/mfa-reenrol`, `POST auth/staff/access-request` |
| Staff onboarding | `GET auth/staff/onboarding`, `POST auth/staff/mfa-setup`, `POST auth/staff/mfa-confirm`, `POST auth/staff/policy`, `POST auth/staff/profile` |
| Account | `POST auth/step-up`, `POST auth/password`, `POST auth/password/forgot`, `POST auth/password/reset`, `POST auth/logout`, `POST auth/logout-all`, `GET auth/sessions`, `DELETE auth/sessions/:id`, `GET/PATCH me`, `GET me/missing-fields` |
| Staff admin | `GET admin/staff`, `POST admin/staff/invites`, `GET admin/staff/requests`, `POST admin/staff/requests/:id/decide`, `PATCH admin/staff/:id/status`, `PATCH admin/staff/:id/role`, `POST admin/staff/:id/mfa-reset`, `GET admin/dual-control`, `POST admin/dual-control/:id/decide` |
| Settings | `GET admin/settings`, `GET/PUT admin/settings/:section`, `GET admin/settings/:section/history` |
| Audit | `GET admin/audit`, `GET admin/audit/verify`, `GET trainer/audit` |
| Public website | `POST public/submissions` (Idempotency-Key optional), `GET public/events`, `POST public/events/:slug/reminders`, `POST public/newsletter/subscriptions`, `POST public/subscriptions/unsubscribe`, `GET public/content?kind=faq\|testimonial\|mentor\|post` |
| Enquiries inbox | `GET admin/submissions` (type, status, assignee, q, from, to, sort, cursor), `GET admin/submissions/metrics`, `GET admin/submissions/export`, `GET admin/submissions/:id`, `POST …/:id/assign`, `POST …/:id/status`, `POST …/:id/notes`, `POST …/:id/contact-attempts` |
| Website content and events | `GET/POST admin/content`, `PATCH admin/content/:id`, `POST admin/content/:id/publish\|unpublish\|archive`, `GET/POST admin/events`, `PATCH admin/events/:id`, `GET admin/events/:id/reminders` |

| Student Academy | `GET student/dashboard`, `GET/POST student/onboarding(/quiz)`, `GET student/streak`, `POST student/streak/decision`, `GET student/daily`, `POST student/daily/:key/claim`, `GET student/weekly-ops`, `GET student/achievements`, `GET student/leaderboard?tab=week\|all\|college`, `GET student/xp` |
| Career path | `GET student/career-quiz` (status, questions without the track mapping), `POST student/career-quiz` (15 option ids → percentages and suggestion), `POST student/career-path` (choose or skip) |
| Courses | `GET courses`, `GET courses/:slug`, `GET certificates/:code/verify` (public); `GET student/courses(/:slug)`, `GET student/lessons/:id`, `POST student/lessons/:id/complete`, `GET student/course-progress/:courseId`, `GET student/certificates` |
| Training Grid | `GET student/attendance\|calendar\|schedule\|trainer`, `POST student/session-requests` (+ `/:id/cancel`, `/:id/respond`), `POST student/leave-requests` (+ `/:id/withdraw`), `GET/POST student/conversations`, `GET student/conversations/:id`, `POST …/:id/messages` |
| Assessments | `GET student/assessments(/:id)`, `POST student/assessments/:id/attempts`, `POST student/attempts/:id/submit`, `GET student/results` |
| Missions | `GET student/missions(/:code)`, `GET student/cities`, `POST student/missions/:code/attempts\|hints\|submit\|abandon` |
| Intel | `GET intel/blogs(/top\|/:slug)`, `PUT/DELETE intel/blogs/:id/reaction`, `POST intel/blogs/:id/comments`, `POST intel/reports`, `GET/POST student/blogs`, `PATCH/DELETE student/blogs/:id`, `POST student/blogs/:id/submit` |
| Placement | `GET student/placement(/skill-gaps)`, `GET/PUT student/resume`, `POST student/resume/submit`, `GET/POST student/portfolio`, `PATCH/DELETE student/portfolio/:id`, `POST student/portfolio/:id/submit`, `POST student/milestones/:id/submit` |
| Notifications and Orbi | `GET me/notifications`, `POST me/notifications/:id/read`, `POST me/notifications/read-all`, `GET/PUT me/notifications/preferences`, `GET student/assistant`, `POST student/assistant/messages` (503 until a provider exists) |
| Trainer LMS | `GET trainer/dashboard`, `GET trainer/batches(/:id(/students\|/overview))`, `GET/POST trainer/sessions`, `PATCH trainer/sessions/:id`, `GET/PUT trainer/sessions/:id/attendance`, slots, session requests, leave, conversations, assessments (create, questions, publish, release, submissions, grade, extensions), placement reviews, `GET trainer/courses(/:id)` and module/lesson/FAQ edits for own batches' courses |
| Admin LMS (Academy) | `GET admin/lms/analytics`, `GET admin/lms/insights` (rule-based), `GET admin/student-reports` (q, path, quiz, batchId), `GET admin/student-reports/:id`, `GET admin/certificates` (q, status, courseId), `GET admin/lms/dashboard`, `GET admin/lms/batches/:id/overview`, courses/modules/lessons/FAQs/certificates, sessions/attendance/holidays, assessments, missions and hints, blog moderation, placement milestones and reports, XP corrections, league close, `POST admin/notifications/broadcast` |

The full list with request and response shapes is in `openapi.json` (`npm run openapi`).

Lab environments come from the Python lab service in `../../mission-api`. Set `LAB_PROVIDER_URL` (its address) and
`MISSION_SERVICE_SECRET` (32+ characters, the same value in mission-api) and run mission-api with
`MISSION_INTERNAL_ONLY=1`; without both settings the Academy reports "Lab environment offline" and still checks the
answers it can (lesson, quiz, date, counts, technology lists).

Public website details (forms, lifecycle, duplicate rule, abuse controls, content rules) are in `docs/PUBLIC-INVENTORY.md`.
Student Academy rules, the feature matrix and open decisions are in `docs/ACADEMY-INVENTORY.md` and `docs/OPEN-ITEMS.md`
(OI-41 onwards). The pages `academy.html`, `trainer.html` and `admin.html` switch to live data through `academy-live.js`,
`trainer-live.js` and `admin-live.js` when the API answers; without it they keep their demo data.

Website emails (acknowledgement, team alert, assignment) are sent by the worker from the outbox: run `npm run build` then
`npm run start:worker` next to the API, otherwise they wait in `outbox_events`.

## Security rules enforced in this milestone

- Deny by default: every route needs a session unless `@Public`; `@Roles` limits route groups; onboarding
  sessions reach only first-login routes.
- Admin permissions come from `role_permissions`, seeded from one constant; a test checks the table equals it.
- No self-elevation: staff role and status cannot be changed on yourself; only Platform Admin manages staff;
  MFA reset needs a second, different Platform Admin (dual control).
- Step-up: role change, password change, MFA reset, and policy/plans/auth settings need a fresh TOTP code
  (`X-Step-Up-Code`); reasons (5–500 characters) are required where the spec marks R.
- Sessions: 256-bit opaque cookie, stored as SHA-256 in Redis, new ID at sign-in, after step-up and after onboarding;
  revoked on logout, password change/reset, suspension, role change and MFA reset.
- Audit: append-only (database triggers refuse UPDATE/DELETE/TRUNCATE), hash-chained, verified daily.
- Nothing secret is logged or audited: OTP codes are kept as HMAC only, passwords as argon2id, tokens as SHA-256.

## Troubleshooting

- `Invalid configuration: - FIELD_ENCRYPTION_KEY …`: the app names the bad variables (never values). Generate keys with the commands in `.env.example`.
- `/health/ready` says `migrations: down`: run `npm run db:migrate`.
- `403 CSRF_INVALID`: call `GET /api/v1/auth/csrf` first and send its token in `X-CSRF-Token`.
- Cookies not kept on `http://localhost`: set `SESSION_COOKIE_SECURE=false` locally (the `__Host-` cookies need HTTPS).
- `503 GOOGLE_NOT_CONFIGURED`: expected until a Google client ID exists.
