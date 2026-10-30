# Login, sign-up, CTF and Admin LMS (stage 2)

All routes are under `/api/v1`. Sessions are cookies (`ys`/`yc`, or `__Host-` names over HTTPS); every POST/PATCH sends `X-CSRF-Token` (call `GET /auth/csrf` first). Errors are `application/problem+json` with `code`, `message`, `field`, `needs`.

## A. Students — "Are you a Yojo student?"

**YES** (existing Yojo learner, never creates an account)
1. `POST /auth/student/otp` `{ identifier: "<Yojo email or student ID>", gate: "yojo" }` → 202 `{ challengeId }`. Code goes to the email on file. Unknown ID: same 202, no email.
2. `POST /auth/student/verify` `{ challengeId, code, gate: "yojo" }` → `{ next: "done" }` + session, or 403 `YOJO_ACCOUNT_NOT_FOUND` (show recovery / support links from `details`).
3. Google: `POST /auth/google` `{ idToken, gate: "yojo" }` works only for `origin=yojo` accounts.

**NO** (new learner) — "Log in here" for returning learners uses the same two calls.
1. `POST /auth/student/otp` `{ email, gate: "open" }`
2. `POST /auth/student/verify` `{ challengeId, code }` → `{ next: "signup", signupTicket }` (or `done` if the account exists)
3. `POST /auth/signup` `{ signupTicket, name, institutionId | institutionName, city?, dob?, consents: { terms, privacy, aup, marketing?, parental? }, guardian? }` → 201 + session. Under 18 needs `parental` + `guardian`. Starts on the `free` plan.
4. Onboarding: `GET /me/missing-fields`, `PATCH /me`.

Paid content: `GET /me/entitlements` (display only). Server routes use `@RequireEntitlement('plan:paid')`; `GET /learn/paid/access` is the example (403 `ENTITLEMENT_REQUIRED`).

## B. CTF (separate journey)

Register: `POST /ctf/register/otp {email}` → `POST /ctf/register { challengeId, code, username, password, consents:{ ctf_rules:true, ctf_contact }, institution?, city?, level?, phone? }` → 201 + CTF session, `linked: true` when an existing student was linked.
Login: `POST /ctf/login { username, password, next? }` → `{ next:"otp", challengeId, emailHint }` → `POST /ctf/login/otp` → `{ next:"done", redirect }` or `{ next:"totp", ticket }` → `POST /ctf/login/totp { ticket, code | recoveryCode }`.
Then: `GET /ctf/me`, `POST /ctf/mfa/setup`, `POST /ctf/mfa/confirm`, `POST /ctf/password/forgot`, `POST /ctf/password/reset` (link `ctf-login.html#ctf-reset=TOKEN`).

## C. Trainers (invite only)

`POST /admin/staff/invites { email, role:"trainer", capability, batchIds? }` → invite email → `/auth/invite/accept` → MFA → policy → profile. Batch scope applies on acceptance.
`GET /trainer/batches`, `GET /trainer/batches/:id`, `GET /trainer/batches/:id/students` (trainer projection; other batches 404).

## D. Admins (invite only, single Platform Admin role)

Staff: `/admin/staff*` (unchanged, `adminRole` must be `platform`).
Admin LMS:
- `GET /admin/users?view=&q=&sort=&cursor=&limit=` — views `all students free paid ctf trainers admins pending_verification pending_onboarding invited suspended`; sorts `created_desc created_asc name_asc last_login_desc`.
- `GET /admin/users/:id`, `GET /admin/total-users` (distinct people)
- `PATCH /admin/users/:id/status {status, reason}` (step-up window), `POST /admin/users/:id/sessions/revoke {reason}`
- `POST /admin/students {email, name, studentNumber?, institutionId|institutionName, reason}`
- `POST /admin/students/:id/entitlements {key, endsAt?, reason}` and `.../:entitlementId/revoke {reason}` — both need `X-Step-Up-Code`
- `GET|POST /admin/batches`, `PATCH /admin/batches/:id`, `POST /admin/students/:id/enrolments {batchId}`

## Frontend

`frontend-integration/yojo-api.js` wraps every call above (`YojoAPI.student.sendOtp(...)`, `YojoAPI.ctf.login(...)`, `YojoAPI.admin.users({view:'paid'})`). A copy sits next to the pages in the `Yojo academy` folder (keep the two in sync).

Wired pages (22 Oct, stage 3). Each page keeps its browser-only demo as a fallback when `YojoAPI.available()` is false:

| Page | Live file | What talks to the API |
|---|---|---|
| `login.html` | `login-live.js` (loaded before the page script; the page's boot waits for `YojoLiveReady`) | YES/NO gate, student OTP login, sign-up (form → OTP → `/auth/signup` → `PATCH /me` for the resume fields), missing-fields onboarding, staff password → TOTP (or recovery code), `#invite=` / `#reset=` / `#mfa-reenrol=` links, MFA set-up with QR code, recovery codes, policy, trainer profile, request access, forgot password, logout |
| `ctf-register.html`, `ctf-login.html`, `ctf-dashboard.html` | live branch at the end of `ctf-auth.js` | register (form → email OTP → `/ctf/register`) and optional authenticator with QR; login username/password → OTP → TOTP; forgot/reset (`#ctf-reset=`); My CTF from `/ctf/me`; logout |
| `index.html` (public site) | `site-live.js` (+ a small content hook at the end of the page script) | Mentorship, Internship and Contact forms → `POST /public/submissions`; "Remind me" → `POST /public/events/:slug/reminders`; `#unsubscribe=` links; published FAQ, testimonials, mentors and posts. See `docs/PUBLIC-INVENTORY.md` |
| `academy.html` | enrol handler | "Enroll Now" → `POST /public/submissions` (`course_enrolment`) with the student session |
| `admin.html`, `admin-ctf.html` | `admin-live.js` (loads `admin.js` after the check) | signed-in admin from `GET /me`; Total Users, dashboard user tiles, staff list, trainer invites, and the Enquiries inbox (`/admin/submissions*`, page in `admin.js`). Every other admin module still runs on demo data |

Local run: API on `http://localhost:3000` (`npm run start:dev`, `CORS_DISABLED=false`, `PUBLIC_APP_URL=http://localhost:8000`), pages on `http://localhost:8000` (`npm run pages`, serves only the site files). Use `localhost` for both, not `127.0.0.1`, so the `SameSite=Lax` cookies are sent. The QR code uses qrcodejs 1.0.0 from cdnjs; if it cannot load, the setup key is shown instead.

Not wired yet: the 18-question quiz (kept in the browser, per student email), `academy.html` and `trainer.html` (still demo data), Google sign-in (needs `GOOGLE_CLIENT_ID`).
