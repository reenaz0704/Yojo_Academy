# External services, connections and credentials (26 Oct 2026)

What Yojo must obtain before going live, mapped to the settings the code already reads. Nothing here is stored in the
repository; production values go into a secrets manager, never into files or chat.

## A. Accounts and providers Yojo must get (blocked items)

| # | Service | What to get | Setting(s) in the code | Unblocks |
|---|---|---|---|---|
| 1 | **Transactional email** (e.g. Amazon SES, SendGrid, Postmark, Zoho ZeptoMail) | Account + API key; a verified sending domain with SPF, DKIM and DMARC DNS records; a from-address | `MAIL_DRIVER` (new adapter), `MAIL_FROM` | Sign-in codes, staff invites, password resets, notification emails in production (OI-01) |
| 2 | **Google sign-in** | Google Cloud project, OAuth consent screen, a Web OAuth client ID with the site's origins | `GOOGLE_CLIENT_ID` | "Continue with Google" (OI-02) |
| 3 | **Cloud hosting** (AWS, Azure or GCP) | Account for the API, the background worker, managed PostgreSQL 16, managed Redis, and a Docker host for the labs | `DATABASE_URL`, `REDIS_URL`, `REDIS_QUEUE_URL` | Running the platform outside this laptop (OI-03, OI-05) |
| 4 | **Secrets manager / KMS** (part of the cloud account) | A key store for the secrets in section B | all secret settings | Safe key storage and rotation (OI-03) |
| 5 | **Domain, DNS and TLS certificates** | The live site domain; a wildcard DNS record and certificate for lab hosts (e.g. `*.ctf.yojo.com`) | `PUBLIC_APP_URL`, `LAB_BASE_DOMAIN`, `LAB_URL_SCHEME` | Public site, links in emails, live labs over HTTPS (OI-57) |
| 6 | **Object storage** (S3, Azure Blob or GCS) | A private bucket + access key; malware scanning for uploads | new storage adapter | Lesson files, file submissions, resume and certificate PDFs (OI-45) |
| 7 | **PDF rendering** | A hosted service or a self-hosted renderer | new adapter | Certificate and report PDFs (OI-45) |
| 8 | **Payment gateway** (e.g. Razorpay, Stripe) | Merchant account, API keys, webhook signing secret; prices and plans | new adapter | Paid plans and the payment approval queue (OI-21, OI-58) |
| 9 | **AI assistant provider** | API key + a data policy (no logging of personal data in prompts) | new adapter | Free chat with Orbi (OI-46) |
| 10 | **Code repository and CI** (e.g. GitHub) | Organisation + private repository, CI secrets, a container registry | CI pipeline in `ci/backend-ci.yml` | Automated tests, builds and deploys (OI-04) |

## B. Secrets Yojo generates itself (no vendor)

New random values for production, kept only in the secrets manager. The laptop already has development values; never reuse them.

| Setting | What it is |
|---|---|
| `FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID` | Encrypts sensitive database fields; the ID allows rotation |
| `OTP_HMAC_SECRET` | Protects sign-in codes |
| `MISSION_SERVICE_SECRET` | Shared between the Academy API and the lab service (signs every lab request); the same value on both sides |
| `MISSION_ADMIN_TOKEN` | Lab service admin access (server only) |
| Database and Redis passwords | Inside `DATABASE_URL` / `REDIS_URL` |

## C. Connections between our own services

| From → to | How | Settings |
|---|---|---|
| Website pages → Academy API | HTTPS, session cookie + CSRF token | `PUBLIC_APP_URL`, `SESSION_COOKIE_SECURE`, `TRUST_PROXY_HOPS` |
| Academy API → PostgreSQL | TLS connection | `DATABASE_URL` |
| Academy API and worker → Redis | Sessions, rate limits, job queue | `REDIS_URL`, `REDIS_QUEUE_URL` |
| Academy API → lab service (mission-api) | Server-to-server, every request signed | `LAB_PROVIDER_URL`, `MISSION_SERVICE_SECRET`, `MISSION_INTERNAL_ONLY=1` |
| Lab service → Docker and the lab proxy | Docker engine on the lab host, Traefik proxy | `LAB_PROXY_*`, `LAB_ROUTES_DIR`, `LAB_BIND_HOST` |
| Worker → email provider | Outbox, then the mail adapter | item A1 |

## D. Inputs (not credentials) still needed

- `ENQUIRY_NOTIFY_EMAIL`: the inbox for website enquiries.
- Legal texts and their versions (OI-08, OI-34).
- Retention periods for enquiries and records (OI-35).
- Optional, only if wanted: a live-class provider (Zoom, Meet or Teams API) instead of pasted links; SMS or WhatsApp for notifications; a page-usage analytics service (OI-55).
