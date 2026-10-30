# Test and build results (actual runs)

Run on 22 Oct 2026 in the cloud build environment: Node v22.22.0, PostgreSQL 16.15, Redis 7, Prisma 6.19.3.

| Command | Result |
|---|---|
| `npm run format:check` | exit 0, all files formatted |
| `npm run lint` | exit 0, no problems |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` (unit) | 8 suites, 198 tests passed |
| `npm run test:e2e` | 5 suites, 68 tests passed (PostgreSQL `yojo_test`, Redis DB 15) |
| `prisma migrate diff` (test DB vs schema) | empty, no drift |
| `npm audit --omit=dev` | 0 critical, 0 high, 2 moderate (js-yaml via @nestjs/swagger) |
| `node dist/main.js` + `GET /api/v1/health/ready` | 200, database/redis/migrations up |
| `node dist/worker.js` | started, registered 5 job schedulers in BullMQ |
| `npm run openapi` | openapi.json written, 43 paths |
| `npm run db:bootstrap-admin` | invite created on the local dev database |

Not run here: `docker compose` (no Docker in this environment), the GitHub Actions workflow (no repository/CI yet),
anything against Google, an email provider or a cloud account (no credentials).

## e2e test names

```
PASS e2e test/auth-staff.e2e-spec.ts (11.794 s)
    ✓ invites are limited to organisation emails and to a valid role shape
    ✓ admin first login: accept invite, TOTP with recovery codes, policy, then a full session
    ✓ an onboarding session can call only first-login endpoints
    ✓ trainer first login has the extra profile step
    ✓ invite tokens are single use and re-inviting revokes the earlier link
    ✓ weak passwords are refused when accepting an invite
    ✓ unknown email and wrong password give the same answer; no session before TOTP
    ✓ wrong TOTP counts down; the challenge is single use; a code cannot be replayed
    ✓ a recovery code signs in once
    ✓ locks the account after 5 failures; the lock shows only with the right password
    ✓ access request → approve sends an invite; decline needs a reason
    ✓ step-up issues a new session ID and revokes the old one
    ✓ password change needs a fresh code and the current password; other sessions end
    ✓ forgot/reset: always 202, needs TOTP, single-use link, all sessions revoked
    ✓ staff sessions carry the staff idle lifetime (30 min) in Redis
PASS e2e test/acceptance.e2e-spec.ts (8.24 s)
    ✓ AC-AUTH-05: a staff session ends after 30 minutes idle
    ✓ AC-AUTH-10: staff get 403 on student-only routes; students 403 on trainer and admin routes
    ✓ AC-AUTH-09: staff login and password reset answer the same for existing and unknown accounts (content, p95 timing within 50 ms)
    ✓ AC-AUTH-09: OTP send does not depend on whether the account exists
    ✓ logs carry request and trace IDs; codes, passwords, cookies and tokens never appear
PASS e2e test/rbac.e2e-spec.ts
    ✓ role_permissions in the database equals the matrix constant
    ✓ no session → 401 with needs: login
    ✓ students and trainers cannot reach admin routes
    ✓ staff management (staff = Y for Platform only): platform → 200
    ✓ staff management (staff = Y for Platform only): payment → 403
    ✓ staff management (staff = Y for Platform only): content → 403
    ✓ staff management (staff = Y for Platform only): support → 403
    ✓ denied admin calls are written to the audit log
    ✓ settings: each sub-role sees only its sections
    ✓ audit list: Platform sees all, other roles only their own actions
    ✓ a non-Platform admin cannot invite staff (no path to create a more powerful account)
    ✓ nobody can change their own role or status
    ✓ role change needs reason (428), then a fresh code (428), then ends the target’s sessions
    ✓ suspension ends sessions and blocks sign-in
    ✓ MFA reset needs a second, different Platform Admin (dual control)
    ✓ trainer audit route shows only the trainer’s own actions
PASS e2e test/security.e2e-spec.ts
      ✓ refuses unsafe requests without the token, before and after sign-in
      ✓ a pre-session token does not work once a session exists with a different token
      ✓ answers problem+json with field and request ID
      ✓ rejects unknown properties (mass assignment), e.g. role in sign-up or profile
      ✓ unknown routes are 404 problem+json; malformed UUID params are 400
      ✓ sets security headers and no-store on API responses
      ✓ OTP send is limited to 20 per hour per IP with Retry-After
      ✓ OTP send is limited to 5 per hour per email
      ✓ session tokens are stored hashed; MFA secrets encrypted; passwords argon2id
      ✓ no OTP code, password or TOTP code appears in any audit row
      ✓ OTP codes are kept only as an HMAC in Redis
      ✓ the database refuses UPDATE, DELETE and TRUNCATE on audit_log
      ✓ verify() detects an edited row (simulated through the redaction escape hatch) and recovers when restored
      ✓ PUT needs If-Match, validates, versions and records history
      ✓ policy, plans and auth sections need a fresh authenticator code
      ✓ maintenance mode blocks student and public routes but not staff sign-in or status
      ✓ live and ready report database, Redis and migrations
      ✓ maintenance jobs run without errors
PASS e2e test/auth-student.e2e-spec.ts
    ✓ OTP send always answers 202 with the same shape and mails a 6-digit code
    ✓ refuses a resend inside 30 seconds
    ✓ counts wrong codes down and burns the code after 3 tries
    ✓ a verified unknown email gets a sign-up ticket, not a session
    ✓ sign-up requires Terms, Privacy and AUP consent
    ✓ under 18 needs parental consent and guardian details
    ✓ enforces the institution email domain
    ✓ stores versioned consents with IP and user agent, and audits the sign-up
    ✓ returning student signs in with OTP; /me returns the profile without secrets
    ✓ a staff-domain email is sent to the staff sign-in
    ✓ profile update refuses card numbers and CVV in free text
    ✓ Google sign-in answers 503 until a client ID is configured
    ✓ logout ends the session; logout-all ends every device
    ✓ a user can revoke one of their own devices but not someone else’s
```
