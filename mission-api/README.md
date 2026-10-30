# Missions 1 and 2 API (Introduction to Cybersecurity, Reconnaissance Fundamentals)

FastAPI + SQLite service that owns Mission 1 XP, quiz grading and Docker lab sessions.
The Academy front end (`academy-mission1.js`) calls it; the browser never talks to Docker.

## Run

```bash
cd mission-api
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
docker build -t yojo-academy/mission1-lab:1 lab          # Mission 1 lab image (needs Docker running)
docker build -t yojo-academy/mission2-lab:1 lab2         # Mission 2 recon target image
docker build -t yojo-academy/mission9-lab:1 lab9         # Mission 9 target (YOJO Shopping, EXIF flag; python+Pillow)
docker build -t yojo-academy/mission8-lab:1 lab8         # Mission 8 target (Yojo Shopping, hidden /s3r3ct)
docker build -t yojo-academy/mission7-lab:1 lab7         # Mission 7 target (Yojo Fruits, 8 crawlable pages)
docker build -t yojo-academy/mission6-lab:1 lab6         # Mission 6 target (Yojo Corp site + training feed, nginx)
docker build -t yojo-academy/mission5-lab:1 lab5         # Mission 5 briefing page (nginx, static)
docker build -t yojo-academy/mission4-lab:1 lab4         # Mission 4 target (Yojo Corp, nginx)
docker build -t yojo-academy/mission3-lab:1 lab3         # Mission 3 target (Apache + Express); pulls httpd:2.4-alpine, node:20-alpine and express from npm once
MISSION_API_SECRET=$(openssl rand -hex 32) .venv/bin/uvicorn main:app --port 8100
# in the project root, in another shell:
python3 -m http.server 8000   # then open http://localhost:8000/academy.html#/academy/missions
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MISSION_API_SECRET` | random per start | Signs bearer tokens. Set it so tokens survive restarts. |
| `MISSION_SERVICE_SECRET` | unset | Shared secret for the Academy API link (24 Oct). The Academy signs each request for one of its users: `X-Academy-User` (user id), `X-Academy-Ts` (unix seconds, valid 120 s) and `X-Academy-Sig` = HMAC-SHA256(secret, `<user>|<ts>|<METHOD>|<path>`). Unset = the link is off. |
| `MISSION_INTERNAL_ONLY` | unset | `1` switches off `/api/mN/auth` (the email-token sign-in, which trusted any email) and refuses bearer tokens, so only the Academy can act for a user. Use it whenever the Academy API is in front. |
| `MISSION_DB` | `mission-api/mission.db` | SQLite path |
| `MISSION_IDLE_MINUTES` | 30 | Idle lab sessions are removed after this |
| `MISSION_ALLOWED_ORIGINS` | `http://localhost:8000,http://127.0.0.1:8000` | CORS |
| `MISSION3_XP` | 50 | Mission 3 reward (paid once on the first accepted solution) |
| `MISSION4_XP` | 50 | Mission 4 reward (paid once) |
| `MISSION4_FLAG_DIGITS` | 6 | Digits in the random number of each session's flag (4-12) |
| `MISSION5_XP` | 50 | Mission 5 reward (paid once) |
| `MISSION5_EXPECTED_DATE` | built-in `2028-12-18` | Verified expiration date (YYYY-MM-DD). Set to an empty string to disable the mission's answer (submissions then fail with a clear 503). |
| `MISSION_ADMIN_TOKEN` | unset | Enables the admin route that updates the Mission 5 answer; the route does not exist when unset |
| `MISSION6_XP` | 50 | Mission 6 reward (paid once) |
| `ACADEMY_BASE` | `http://localhost:8000/academy.html` | Academy URL the lab's Submit Solution button points to |
| `MISSION6_TARGET_DOMAIN` | `yojocorp.test` | Target shown to students. Must end in `.test` or be listed in `MISSION6_AUTHORIZED_DOMAINS`, otherwise the default is used |
| `MISSION6_AUTHORIZED_DOMAINS` | unset | Comma list of real domains you own or are authorized to use |
| `MISSION6_SUBDOMAINS` | `www,mail,api,dev,staging,vpn,portal,cdn,blog,shop` | Labels in the controlled dataset. The expected answer is the number of unique valid labels (10 by default) |
| `MISSION8_XP` | 50 | Mission 8 reward (paid once) |
| `MISSION9_XP` | 50 | Mission 9 reward (paid once) |
| `MISSION3_EXPECTED` | `apache,express,node.js` | Expected technologies, server side only |
| `MISSION3_MATCH` | `required` | `required` = all expected present, extras allowed; `exact` = no extras |
| `LAB_BASE_DOMAIN` | `ctf.localhost` | Parent domain of every lab hostname. Production: `ctf.yojo.com` |
| `LAB_HOST_RANDOM_HEX` | 4 | Hex characters in the random part (`info-01-a83f`); 4-16 |
| `LAB_PROXY_PORT` | 8088 | Host port the lab proxy listens on |
| `LAB_PUBLIC_PORT` | = proxy port | Port shown in student URLs (omitted when it is 80/443, e.g. behind a TLS load balancer) |
| `LAB_URL_SCHEME` | `http` | `https` in production |
| `LAB_BIND_HOST` | unset (loopback only) | Extra address the PROXY also listens on, e.g. `172.16.117.1` for a Kali VM. A specific IP only; `0.0.0.0` is refused |
| `LAB_ROUTES_DIR` | `mission-api/proxy-routes` | Where per-session route files are written (mounted read-only into the proxy) |
| `LAB_PROXY_IMAGE` | `mirror.gcr.io/library/traefik:v3.6` | Proxy image |
| `LAB_PROXY_RELOAD` | `watch` (`restart` on Windows) | How the proxy notices route files. Docker Desktop on Windows does not pass file-change events from a Windows folder into the container, so `restart` restarts the proxy after each route change (running labs lose their connection for about a second). Development only; production uses `watch`. |
| `window.YOJO_M1_API` (browser) | `http://<host>:8100` | API base URL |

## Test

Stop the dev API first when running the Docker tests: its cleanup job removes labelled containers it does not know about, which can race with a test container.

```bash
.venv/bin/python -m pytest -q        # includes a real-container hardening test if Docker is up
```

## Mission 7 · Endpoint Discovery (`/api/m7/*`, id END-01)

Real crawling, no simulation. Start lab gives the student a "Yojo Fruits" site at their own hostname (`end-01-xxxx.<base>`). They run real Katana from their own terminal: `katana -u <lab URL> -silent`.
- **Counting rule:** every unique URL Katana prints, **homepage included**. The site is static: a homepage plus 7 pages, all linked from one menu, inline CSS, no images, scripts, forms or external links, so nothing else can be discovered. That makes 8.
- **Verified:** Katana v1.8.0 (official release, SHA-256 checked, kept in `tools/katana/` for tests only) printed exactly these 8 URLs in repeated runs, both on the lab network and through the student's hostname via the proxy. `tests/test_mission7.py` runs it 3 times and checks identical results, exactly 8, all in scope. The answer `8` is a server constant (`MISSION7_EXPECTED`).
- **Answer:** whole number only (same rules as Mission 6); 50 XP once (`MISSION7_XP`).

## Mission 8 · Hidden Directory Discovery (`/api/m8/*`, id DIR-01)

Reuses Mission 4's per-session flag mechanism with a different prefix. Start lab serves a "Yojo Shopping" site at the student's hostname. The homepage does not link `/s3r3ct`; a wordlist at `<lab>/tools/wordlist.txt` contains `s3r3ct` among decoys that 404.
- **Flow:** the student runs a directory enumeration tool (gobuster/feroxbuster) with that wordlist against their lab URL, finds `/s3r3ct/` (HTTP 200), reads `/s3r3ct/flag.txt`, and submits it.
- **Flag:** `YOJO_directory_bruteforcing_<6 digits>`, generated per session, written into `/s3r3ct/flag.txt` and the directory's index by the container entrypoint (from `LAB_CODE`, then the variable is dropped). Only the SHA-256 is stored; submit compares the trimmed input to the hash for the caller's own session (exact match). Never in any API response. 50 XP once (`MISSION8_XP`).
- **Verified:** real enumeration with the served wordlist against a live student hostname found only `/s3r3ct`; decoys like `/private/` return 404. `tests/test_mission8.py` checks the hidden dir is unlinked, the flag is served, enumeration finds exactly `s3r3ct`, and flags are session-scoped.

## Mission 9 . Image Metadata Analysis (`/api/m9/*`, id IMG-01)

Per-session flag again, hidden in image metadata. Start lab serves a "YOJO Shopping" store (python http server, Pillow) at the student's hostname with 10 product images (`product-01.jpg` .. `product-10.jpg`). On startup the container generates the images; exactly one, chosen at random, carries the flag in its JPEG `Comment` field (via `LAB_CODE`). No flag, filename hint or EXIF wording appears on the page.
- **Flow:** the student downloads the images and runs real ExifTool from their own terminal (pre-installed on Kali): `exiftool -Comment -ImageDescription *.jpg`. One image's Comment holds `YOJO_image_metadata_<6 digits>`.
- **Validation:** same as Missions 4/8 - only the SHA-256 is stored, compared to the caller's own session, exact match after trimming. Never in any API response. 50 XP once (`MISSION9_XP`).
- **Verified:** real ExifTool (installed in a throwaway container for the test) read the Pillow-written Comment back; on a live student hostname exactly one of 10 downloaded images carried the flag and the homepage leaked nothing. `tests/test_mission9.py` checks 8-12 images, exactly one flag, and no leaks.

## Lab routing: one hostname per student

```
Academy "Start lab" -> backend creates the session -> random hostname <mission>-<hex>.<LAB_BASE_DOMAIN>
                    -> container on its own private network (no published ports, no internet)
                    -> route file Host(`info-01-a83f.<base>`) -> that container, picked up by the shared Traefik proxy
Student 1: info-01-a83f.ctf.yojo.com   Student 2: info-01-b921.ctf.yojo.com   Student 3: info-01-f731.ctf.yojo.com
```

- Mission prefixes: `intro-01`, `recon-01`, `web-01`, `info-01`, `dom-01`, `sub-01`. Hostnames are unique (DB index, retried on collision) and freed when the session ends; an unknown or stopped hostname gets 404.
- The proxy (`yojo-lab-proxy`) is the only thing that publishes a port. It uses Traefik's file provider (no Docker socket), runs non-root with a read-only filesystem, no capabilities and resource limits, and has no dashboard. The backend joins it to a session's network only while that session lives, and checks `/healthz` through the proxy before handing the URL to the student.
- Each lab network is `internal`: a lab cannot reach the internet or any other lab directly.
- **Local development:** `*.ctf.localhost` resolves to 127.0.0.1 in browsers and on macOS, so URLs look like `http://info-01-a83f.ctf.localhost:8088/`.
- **From a VM (e.g. Kali):** inside the VM `localhost` is the VM. Use a wildcard name that points at the Mac's VMware address and let the proxy listen there:
  ```bash
  LAB_BIND_HOST=172.16.117.1 LAB_BASE_DOMAIN=172.16.117.1.nip.io MISSION_API_SECRET=$(openssl rand -hex 32) .venv/bin/uvicorn main:app --port 8100
  ```
  URLs then look like `http://info-01-a83f.172.16.117.1.nip.io:8088/` and work from the Mac and from Kali (nip.io needs DNS access). Your LAN address stays closed.
- **Production (`ctf.yojo.com`):** point wildcard DNS `*.ctf.yojo.com` at the lab server, terminate TLS with a wildcard certificate (on the proxy or a load balancer in front of it), then run with `LAB_BASE_DOMAIN=ctf.yojo.com LAB_URL_SCHEME=https LAB_PUBLIC_PORT=443`. Consider `LAB_HOST_RANDOM_HEX=8` or more: with 4 hex characters a lab hostname can be guessed. That does not let anyone claim another student's XP (Mission 4 flags are tied to the owner's session), but it does let them view another student's target page.

## Missions

| Mission | Routes | XP | Quiz | Lab image |
|---|---|---|---|---|
| INT-01 Introduction to Cybersecurity | `/api/m1/*` | lesson 20 + 10 x 8 = 100 | 8 questions | `mission1-lab` |
| REC-01 Reconnaissance Fundamentals | `/api/m2/*` | lesson 20 + 5 x 6 = 50 | 6 questions | `mission2-lab` |

Both share one set of tables (`m_progress`, `m_attempts`, `m_sessions`, `xp_ledger`) keyed by mission id. Existing Mission 1 rows from the original `m1_*` tables are copied across automatically on first start (the old tables are renamed `*_migrated`, not dropped).
The Mission 2 lab is a harmless nginx page with a `/scope.txt`, `robots.txt`, `security.txt` and a few response headers to observe. The front end shows fixed example commands (`curl -I`, `nmap -sT -p <port> 127.0.0.1`) limited to that session's own port. The browser never sends a target or command to the API.

## Mission 3 · Web Technology Fingerprinting (`/api/m3/*`, id WEB-01)

Practical mission, no lesson or quiz. Flow: Start (card or mission page) -> API starts the target container -> browser is sent to the session hostname, e.g. `http://web-01-a83f.ctf.localhost:8088/` -> student inspects it with Wappalyzer -> returns with the browser Back button -> the mission page finds the still-active session -> `POST /api/m3/submit {session_id, answer}`.
- The target is real Apache httpd (`Server: Apache`) reverse-proxying a real Express app on Node.js (`X-Powered-By: Express`) serving a multi-page coffee-roaster website (Yojo Coffee Roasters) with no training labels, so it looks like an ordinary production site. It deliberately loads no third-party libraries, fonts or analytics, so the fingerprint stays Apache + Express + Node.js + HTML5. Expected answer: Apache, Express, Node.js. Order is not enforced (the UI hint asks for alphabetical order); extras such as HTML are tolerated under the default `required` policy. Common spellings (`nodejs`, `html5`, `Apache HTTP Server`) are normalised on the server.
- Wappalyzer setup: install the Wappalyzer extension from the Chrome, Edge or Firefox store, pin it, open the target, click the icon. If it does not report anything, allow it on the site in the extension permissions. Fallback (labelled as an alternative in the UI): `curl -I <target>` and view source.
- Submit checks: auth, session owned by the caller, session belongs to WEB-01, session active and not expired (410 if expired, 409 if stopped), answer size limits (422), 30 submissions per hour. Feedback never names missing technologies. XP is awarded once through the shared ledger.

## Mission 4 · Information Gathering (`/api/m4/*`, id INFO-01)

Same practical flow as Mission 3 (start session, redirect to the target, return, submit), but the answer is a flag. On Start the API generates `YOJO_information_disclose_<random number>` for that session, stores only its SHA-256 and passes the value once to the container (`LAB_CODE`). The container's entrypoint writes it into an HTML comment in the home page of the "Yojo Corp" site (visible only in View Source), then unsets the variable. Submit compares the trimmed input to the hash for the caller's own session: exact match only, so another user's flag or a sample flag is rejected. 50 XP paid once through the ledger; 30 submissions per hour; expired (410) and stopped (409) sessions are refused.

## Mission 5 · Domain Expiration Intelligence (`/api/m5/*`, id DOM-01)

Target domain `yojosolutions.com`. The briefing page (`lab5/`, static nginx, started per session like the other labs) explains the scenario, why expiry matters, how to read WHOIS/RDAP, links to ICANN Lookup, rdap.org and Verisign RDAP, a `whois`/`curl` fallback, and the optional Domain Name Wire article (described accurately: Google appears to have acquired Chromebook.com/Chromebooks.com; one had earlier expired and been re-registered; nothing about YOJO Solutions). The answer is not on the page.
- **Verified answer:** `2028-12-18`. Checked on 2026-10-21 against Verisign's .com registry RDAP (`expiration` 2028-12-18T15:20:03Z), GoDaddy's registrar RDAP (`registrar expiration` 2028-12-18T10:20:03Z) and `whois` (Registry Expiry Date 2028-12-18T15:20:03Z). It is stored server-side only. Precedence: admin override in the DB > `MISSION5_EXPECTED_DATE` > built-in default.
- **Keeping it current:** `python verify_domain.py` compares the live RDAP record (registry and registrar) with the configured date; `--apply` stores the live date as an admin override. Or `POST /api/m5/admin/expected-date` with header `X-Admin-Token: $MISSION_ADMIN_TOKEN` and `{"date": "YYYY-MM-DD"}`. The Academy never calls RDAP at submit time, so students are unaffected if a lookup service is down.
- **Date handling:** accepted: `YYYY-MM-DD`, RDAP timestamps (`2028-12-18T15:20:03Z`, date part used), `DD-MM-YYYY`, `MM-DD-YYYY`, `/` or `.` separators, `18 December 2028`, `Dec 18, 2028`. A numeric date that could be read two ways (e.g. `05-06-2028`) is refused with a message instead of guessed; partial dates and invalid dates return 422 and use no attempt budget. Wrong answers say nothing about the real date.

## Mission 6 · Subdomain Enumeration (`/api/m6/*`, id SUB-01)

Start opens the mission page; Start lab launches a per-session container (`lab6/`, nginx, non-root, read-only, 64 MB) and redirects to its page: the **Yojo Corp** company website (home, services, about, careers, contact) with a **Submit Solution** button beside the logo on every page. The button links to the Mission 6 page in the Academy (`ACADEMY_BASE`, default `http://localhost:8000/academy.html`); the answer itself is entered and checked there, so no credentials ever reach the lab origin.
- **Student's own terminal:** the Academy page shows the commands with the session's real URL: `curl -fsS <lab>/tools/subfinder.sh -o subfinder-lab.sh`, then `sh subfinder-lab.sh -d yojocorp.test -silent`. The helper is a 20-line readable POSIX script that makes one request to the lab's feed (`/feed/<domain>.txt`); it is generated with the lab's own address (sanitised Host header) and refuses any other domain.
- **Why a controlled simulation:** live Subfinder cannot give a guaranteed 10. Checked: real Subfinder v2.17.0 run passively on yojosolutions.com returns just `www.yojosolutions.com`, and a `.test` name has no public data at all. So the target is `yojocorp.test` (reserved, never public), the feed holds a fixed dataset supplied by the backend at start, and the helper prints a `[SIM]` notice. It is labelled as a simulation everywhere.
- **Dataset and answer:** configured with `MISSION6_SUBDOMAINS` (default `www,mail,api,dev,staging,vpn,portal,cdn,blog,shop`) and `MISSION6_TARGET_DOMAIN` (must end in `.test` or be in `MISSION6_AUTHORIZED_DOMAINS`). The expected answer is the number of unique valid labels, so lab and answer cannot disagree (10 by default). Never returned by any API.
- **Answer:** `[0-9]{1,4}` after trimming (empty, negative, decimal, text and non-ASCII digits get 422); 50 XP once through the ledger.

## Lab target naming convention

Every lab target website is a believable fictional business branded "Yojo ...": Yojo Coffee (Mission 3), Yojo Corp (Mission 4), then Yojo Bank, Yojo Shopping, Yojo Fruits for later missions. They look like ordinary production sites: no "lab", "training" or hint text on the page.

## Behaviour

- The lab was removed from the Academy UI: a mission is `completed` when the lesson and a scored quiz attempt are done. The lab/session API routes and images remain in the backend but are no longer called by the front end. Previously: a mission was `completed` only when the lesson, quiz and lab were all done. On Start the API generates a random one-time code, passes it to that container (env var, written to a tmpfs file `/lab/code.txt` by the image entrypoint) and stores only its SHA-256. `POST /api/mN/lab/verify` checks the learner's code against the hash for their own session (max 10 tries per session). XP totals are unchanged; the lab gates completion.

- XP: lesson 20, quiz 10 per correct answer, hard cap 100. Rewards are rows in `xp_ledger` with a unique key per (user, mission, source), written inside `BEGIN IMMEDIATE` transactions, so replays and concurrent requests cannot double-pay.
- Quiz: the answer key never leaves the server. The first submission is the scored attempt; later ones are practice (0 XP).
- Lab: one container per user, non-root, read-only rootfs, all capabilities dropped, no-new-privileges, 64 MB / 0.25 CPU / 64 PIDs, own bridge network (ICC off), published on 127.0.0.1 only, healthcheck, idle reaper. The Docker socket is used only by the API process.

## Known limitations

- With the Academy link (`MISSION_SERVICE_SECRET` + `MISSION_INTERNAL_ONLY=1`) identity comes from the Academy API; the limitation below applies only to the stand-alone demo mode.

- The Academy login is a localStorage demo, so `/api/m1/auth` trusts the email the Academy session claims and then issues a signed token. Swap in a real identity check when the Academy has server-side login.
- Lab egress is not blocked (internal Docker networks cannot publish ports). The page needs no network; add an egress firewall for production.
