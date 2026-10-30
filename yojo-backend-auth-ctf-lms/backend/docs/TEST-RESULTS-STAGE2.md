# Test results — auth, CTF and Admin LMS stage (22 Oct 2026, run in the build container)

| Check | Result |
|---|---|
| prettier --check | clean |
| eslint | clean |
| tsc (app + tests) / nest build | clean |
| Unit tests | 199 passed / 199 (8 suites) |
| E2E tests (real Postgres 16 + Redis) | 86 passed / 86 (6 suites; new `test/journeys.e2e-spec.ts` = 22) |
| Migrations | `20261022070000_auth_ctf_lms`, `20261022070100_default_plan_event` applied with `migrate deploy` to dev and test DBs |

Brief §9 mapping: 1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 16 → `journeys.e2e-spec.ts`; 3 also `auth-student`; 4 → `auth-student` (Google invalid token + Yojo-origin rule; real Google verification needs a client ID — not verified); 8 → `auth-staff`, `rbac`, `journeys`; 15 → `security` + secret checks in `journeys` (API only; front-end bundle not checked, pages not in this session); 17 → all e2e suites run against the real HTTP API.

Not verified: real email delivery, Google sign-in against Google, the HTML pages calling the API in a browser, deployment.
