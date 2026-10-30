# Public website: page-to-backend inventory (Phase 1 audit, 22 Oct 2026)

Source audited: the static prototype in `Yojo academy\` (no framework, no build step). The public website is one
single-page file, `index.html`, with hash routes. Related public pages: `login.html` (sign-up / login, also opened as a
pop-up from `index.html`), `ctf-register.html`, `ctf-login.html`, `ctf-dashboard.html`. The student portal
(`academy.html`), trainer console (`trainer.html`) and admin console (`admin.html`) are not public, but `academy.html`
submits one record type into the same Enquiries inbox, so it is listed too.

**Classifications:** S = static content, R = public data read, F = form submission, A = authenticated action,
E = external link or integration, N = navigation only, U = unclear, fake or needs a business decision.

**Status after this phase** is in the [completion matrix](#feature-completion-matrix) at the end.

## Routes found in `index.html`

`#home`, `#training`, `#courses`, `#course/<slug>`, `#mentorship`, `#internships`, `#placements`, `#ctf`, `#contact`,
plus aliases `#plans` (→ training, scrolls to Plans), `#blog` / `#vault` (→ home, scrolls to the Lore Vault). There is
no About, Events, Careers, Pricing or Newsletter page. "About YOJO Solutions" is a section of the home page.

## Header, navigation, footer and floating elements

| Page / section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin LMS destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Header + mobile menu | Home, Training, Internships ▸ Mentorship, Placements, Contact Us | none | N | none | none | none | none | Each link shows its page |
| Header "CTF" | Opens CTF pop-up (Register / Log in / look around) | none | N | none (links to the CTF pages, already wired to `/ctf/*`) | none | none | none | Pop-up opens; links work |
| Header "Login / Sign up" | Opens `login.html` in a pop-up | none | A | Existing `/auth/*` (wired in stage 3) | `users` | Total Users | Existing auth | Pop-up sign-up end to end (done in Part 1) |
| Footer Terms / Privacy / Refund / Placement Terms | Opens a modal | none | **U** | none. All four links open the same "Placement assurance terms (Provisional)" text; there is no Terms, Privacy or Refund text | none | none | Legal texts missing (OI-08) | Needs the legal texts first |
| Footer social links (LinkedIn, Instagram, YouTube), WhatsApp button | Opens external site | none | E | none | none | none | `rel="noopener"` present | Links open in a new tab |
| CYRA chat bot (floating) | Type a question, get a canned answer | free text (never sent) | S | none: answers are keyword matches in the page; nothing leaves the browser | none | none | No data collected | Answers appear; no network call |
| Contact copy buttons | Copy phone / email | none | S | none | none | none | none | Clipboard toast |

## Home (`#home`)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Hero CTAs | "Start a free lab", "Sign up free" → sign-up pop-up; "Book free counselling" → `#contact`; "Explore the labs" → `#training` | none | N / A | Existing `/auth/*` | `users` | Total Users | Existing | Buttons go to the right place |
| Hero live counters "Threats blocked 12,480", "Learners in range 318" | none | none | **U (fake)** | none. The numbers are made up and increase at random every 1.4 s | none | none | Misleading | Decision: remove, or feed from a real metric |
| Stats band "100% placement assurance, 1:1 mentor, 2-6 mo internship, 200+ hiring partners" | none | none | **U (unverified)** | none | none | none | Claims need owner/legal sign-off (placements page labels 200+ as "sample") | Decision needed |
| Track cards (8 tracks) | Click → Training page, scrolls to that course | none | S + N | none (hard-coded `TRACKS`) | none | none | none | Click scrolls to the card |
| Mentor cards ("Your squad leaders", 3 of 6) | "Meet all mentors" → `#mentorship` | none | S → **R (proposed)** | `GET /public/content?kind=mentor` | `public_content` | Website content (admin API) | Published items only | Draft mentor hidden; published shown |
| Mentor stats (e.g. 42 / 4.9 / 120+) and three "Mentor name" placeholders | none | none | **U (unverified)** | as above; the stats and placeholders need real data | | | Do not publish invented ratings | Decision needed |
| "Placed with the best" marquee | none | none | S | none (industry categories, not company names) | none | none | none | n/a |
| Student success stories (16 quotes with names, roles, cities) | none | none | S → **R (proposed)** | `GET /public/content?kind=testimonial` | `public_content` | Website content | Only verified, consented testimonials should be published | Decision: are the 16 quotes real and consented? |
| About YOJO Solutions, vision, mission, core areas, learning approach, certifications strip | none | none | S | none (static copy; changes rarely, kept in HTML) | none | none | none | n/a |
| CTF teaser "Enter the arena" | → `#ctf` | none | N | none | none | none | none | Link works |
| Free tier banner | "Sign up free" / "Explore the labs" | none | N / A | Existing `/auth/*` | | | | |
| Lore Vault (6 student write-ups, search, category tabs, article modal "Mentor approved") | Read post, filter, search (client side) | search text | S → **R (proposed)** | `GET /public/content?kind=post` | `public_content` | Website content | Body stored as plain text and escaped on render (no stored HTML) | Draft post hidden; search still works |
| Course catalog teaser (`#cxHome`) | View course, "Explore All Courses" | none | R (demo) | Today: `YojoCourses` in `trainer-data.js` (browser demo data shared with the LMS) | (future LMS `courses`) | Courses module (demo) | | **Blocked**: course data has no server model yet (LMS milestone) |

## Training (`#training`), Course catalog (`#courses`), Course detail (`#course/<slug>`)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Course grid with category tabs, labs overview, tools | Filter (client side), open course | none | R (demo) | as above | future `courses` | Courses (demo) | | Blocked (LMS milestone) |
| Course detail actions | Free course: "Start Learning" → `login.html` / LMS. Paid course: "Enroll Now" → `#contact`, "View Plans" → `#plans` | none | N | none. Enrolment is not taken on the public page; the contact form records the request | | | Paid access stays server-side (`plan:paid` entitlement) | Buttons go to the right place |
| Plans: Free ₹0, Career programme "₹— / on request" | "Create free account", "Talk to a counsellor" | none | S + N | none. No price is published; payments not in scope (OI-21) | | | Never trust a client price | n/a |
| "Create free account", "Talk to a counsellor" | | | A / N | Existing `/auth/*`; `#contact` | | | | |

## Mentorship (`#mentorship`)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Mentor grid with track tabs | Filter (client side) | none | S → R (proposed) | `GET /public/content?kind=mentor` | `public_content` | Website content | | as above |
| **"Book a 30-minute mentor call" form** | Submit | name\*, phone\*, interested path (5 options), preferred date/time, consent\* | **F** | `POST /public/submissions` with `type: "mentorship_session"` | `public_submissions` | Admin → Enquiries | DTO allow-list, honeypot, per-IP rate limit, CSRF pre-session token, consent version recorded | Submit → reference shown → appears in Enquiries → assign → status → note → history |
| Today | Saved only in the visitor's browser (`localStorage.yojo_enquiries`) and shows "Request received. A counsellor will confirm by email." | | **fake success** | | | | | |

## Internships (`#internships`)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Programmes, open squads ("3 seats left" etc.), internship loop | none | none | S | none. Seat counts are hard-coded and unverified | | | | Decision: seat counts |
| **"Apply for the next intake" form** | Submit | name\*, email\*, preferred squad (5 options), why this squad | **F** | `POST /public/submissions` with `type: "internship_application"` | `public_submissions` | Enquiries | as above. The form has **no consent box**; a consent box like the other two forms is needed (default adopted, see D1) | as above |
| Today | Browser only, "Application received. We will be in touch soon." | | **fake success** | | | | | |
| CV upload | none: the form has no file field | | n/a | Uploads not built (no form needs one) | | | | n/a |

## Placements (`#placements`)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| "100% Assurance\*", "200+ Hiring partners (sample)" | none | none | **U** | none | | | Claims need sign-off | Decision |
| **Job Hunter** (resume drop / "Use a sample resume") | Pick a file, see matched jobs | PDF/DOCX file | **U (fake)** | none. The file never leaves the browser; the stages and the three jobs ("Sample Co. A/B/C") are animations. The page says "Your resume is used only for this search and deleted after 24 hours", which describes a service that does not exist | | | Do not build uploads for this until a job source and data policy exist | Decision: label it a demo, or specify a real job-matching service |
| Placement support steps | none | none | S | none | | | | n/a |

## CTF (`#ctf`) and CTF pages

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Live event card "Yojo Winter CTF", countdown | "Log in to join" (auth pop-up), "Try warm-up board" | none | R (proposed) + N | `GET /public/events` (live/registration CTF events). The countdown today is fake (19 h from the first visit) | `ctf_events` | Events (admin API) | | Live event shows real dates when set |
| **Upcoming events "Web Breakers Sprint 18 Jan", "Blue Team Hunt 08 Feb" → "Remind me"** | Ask for a reminder | today none; needed: email + consent | **F** | `POST /public/events/:slug/reminders` (email, consent) and tokenised `POST /public/subscriptions/unsubscribe` | `ctf_events` (listed events) + `public_subscriptions` (kind `event_reminder`) | Enquiries → Reminders count per event | Honeypot, rate limit, one per email and event, unsubscribe token stored as a hash | Remind → stored once → duplicate says "already on the list" → unsubscribe works |
| Today | Button turns into "Reminder set" and a toast says "We would email you…"; nothing is stored | | **fake success** | | | | | |
| Past event "Monsoon CTF, 142 teams (sample)" | none | none | S (sample) | none | | | | Decision |
| Warm-up board (4 challenges), scoreboard | Submit a flag, see score | flag text | S (client game) | none. Flags and answers are in the page; scores stay in the browser. The real CTF platform is the separate `mission-api` (OI-07, OI-29) | | | Not a scored event; fine as a demo | n/a |
| Rules of engagement | none | none | S | none | | | | n/a |
| Register / Log in / My CTF | Register, log in, MFA | see `AUTH-JOURNEYS.md` | A | Existing `/ctf/*` (**wired and tested in Part 1**) | `users`, `ctf_registrations` | Total Users (CTF) | Existing | Done |

## Contact (`#contact`)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Phone, email, address, map (stylised canvas) | Copy, read | none | S | none | | | Public business contacts only | n/a |
| **"Book free counselling" form** | Submit | name\*, phone\*, email\*, topic (Career counselling, Course and batch details, Internships, Corporate training, CTF partnership), message, consent\* | **F** | `POST /public/submissions` with `type: "contact"` and `topic` | `public_submissions` | Enquiries | as above | as above |
| Today | Browser only; the success text even says "Message saved in this prototype. Nothing was sent." | | **fake success** | | | | | |
| FAQ (4 questions) | Expand | none | S → R (proposed) | `GET /public/content?kind=faq` | `public_content` | Website content | | Published FAQ replaces the static list |

## Student LMS (`academy.html`, signed-in students)

| Section | User action | Inputs | Class | Backend operation / endpoint | Entity | Admin destination | Security | Acceptance test |
|---|---|---|---|---|---|---|---|---|
| Course card "Request enrolment" | Ask to join a paid course | course (from the page), the student's own name/email/phone | **A** | `POST /public/submissions` with `type: "course_enrolment"` while signed in; the server takes name and email from the session, never from the body | `public_submissions.user_id` → `users` | Enquiries | Signed-in student only; one open request per student and course | Request twice → second answers "already requested" |
| "Request paid access" | Ask for paid plan | none | A | Payments milestone (OI-21); not in this phase | | Approvals (demo) | | Blocked |

## Admin LMS (`admin.html`) today

`Enquiries` page (`#/admin/enquiries`) lists `localStorage.yojo_enquiries`: filter by form, statuses New / Contacted /
Closed, CSV export, with a "Backend needed" note. No assignment, notes, history or metrics. Permission key
`enquiries` already exists in the access matrix (Platform Admin = full).

## Hard-coded content and fake success messages (summary)

Fake success (nothing reaches a server): Mentorship form, Internship form, Contact form, event "Remind me", Job Hunter
"scan", academy "Request enrolment" (browser only). Invented or unverified numbers: hero live counters, 100% placement
assurance, 200+ hiring partners, mentor session/rating/mentee counts, internship seat counts, "142 teams (sample)",
CTF countdown. Placeholder content: three mentors named "Mentor name". Legal links: Terms, Privacy and Refund open the
placement-terms text.

## Decisions taken as defaults (change any of them and the code follows)

| ID | Decision | Default adopted |
|---|---|---|
| D1 | The internship form has no consent box | Add one, worded like the other forms. It is required. |
| D2 | "Remind me" needs an email address | A small prompt asks for the email and consent. The reminder is stored once per email and event, and an unsubscribe link is issued. The two listed events are seeded as listed events with the dates shown (18 Jan 2027, 08 Feb 2027). **The year is assumed; confirm it.** |
| D3 | Newsletter | Removed by the owner on 24 Oct (OI-37): no newsletter is planned. Only event reminders remain. |
| D4 | Courses source of truth | Unchanged for now (demo `YojoCourses`). The course catalog API belongs to the LMS milestone, which owns courses, modules and lessons. |
| D5 | Content (FAQ, testimonials, mentors, blog posts) | A managed `public_content` table with draft / published states. Nothing is seeded, so the site keeps its current text until an admin publishes items. The page then shows the published items instead. Unverified quotes, ratings and counters are **not** copied into the database. |
| D6 | Job Hunter, hero counters, legal links | No code change without the owner's approval. They are listed here as open issues. |
| D7 | Duplicate handling | Same type + same email (or phone) + same topic within 10 minutes returns the first submission's reference (`duplicate: true`) instead of a new record. Later repeats are new, legitimate enquiries. An `Idempotency-Key` header (browser retries) returns the same answer for 24 h. |
| D8 | Who can manage enquiries | Platform Admin (permission `enquiries`). Trainers, students and visitors get 403. Content uses a new permission `website.content`. |

## Feature completion matrix

State on 22 Oct 2026, local environment: Windows 11, Node 24.4.1, PostgreSQL 16 and Redis 7 in Docker, API on
http://localhost:3000, pages on http://localhost:8000. "e2e" = `test/public-site.e2e-spec.ts` against `yojo_test`
(all 101 e2e tests pass, 15 of them for this stage; 208 unit tests pass). "Browser" = checked by hand in the
desktop app's browser against the running API.

| Feature | Backend | Frontend wired | e2e | Browser | Status |
|---|---|---|---|---|---|
| Contact form → Enquiries | `POST /public/submissions` (`contact`) | `site-live.js` | yes | yes (ENQ-1001) | **Implemented, tested** |
| Mentorship "Book a mentor call" | `mentorship_session` | `site-live.js` | yes | yes (ENQ-1002) | **Implemented, tested** |
| Internship application (+ consent box, D1) | `internship_application` | `site-live.js`, consent box added | yes | yes (ENQ-1003; blocked without consent) | **Implemented, tested** |
| Academy "Enroll Now" request | `course_enrolment` (student session) | `academy.html` | yes | API call from the academy page with a real student session (ENQ-1004, duplicate detected). The button itself shows only for paid-plan students, which are demo data, so it was not clicked | **Implemented**, button not clicked |
| Spam trap, rate limits, CSRF, size limit, allow-listed fields, duplicates, Idempotency-Key | yes | trap field + idempotency key added by `site-live.js` | yes | partly (success paths) | **Implemented, tested** |
| Admin LMS Enquiries: list, filters, search, paging, metrics, detail, assign, status, notes, contact attempts, history, CSV export | `/admin/submissions*` | `admin.js` live page | yes | yes (assign → in progress → note → attempt → resolve with reason) | **Implemented, tested** (CSV export tested by e2e only) |
| Authorisation (visitor 401, student 403, trainer 403, admin 200) | `enquiries` permission | n/a | yes | n/a | **Tested** |
| Status lifecycle on the server | `SUBMISSION_TRANSITIONS`, compare-and-set | buttons show only allowed moves | yes | yes | **Tested** |
| Notifications (ack, team alert, assignee) | outbox → worker → mail port | n/a | yes (dev mail adapter) | no | **Implemented; real delivery blocked** (no mail provider, OI-01/OI-36) |
| CTF "Remind me" + unsubscribe | `/public/events*`, `/public/subscriptions/unsubscribe` | `site-live.js` (email prompt, unsubscribe link) | yes | yes (reminder stored, emailed link unsubscribed) | **Implemented, tested** (dates: OI-30) |
| Newsletter | removed (OI-37) | none | n/a | n/a | **Removed** by the owner, 24 Oct |
| FAQ, testimonials, mentors, blog posts (managed content) | `/public/content`, `/admin/content*` | `site-live.js` + hook in index.html | yes | yes (FAQ, post, mentor published then archived; HTML in content shown as text) | **Implemented, tested**; nothing published yet (OI-33). No admin screen yet; managed through the API (Swagger at /api/docs) |
| Website events admin | `/admin/events*` | no admin screen | partly (list, reminders) | n/a | **API only** |
| Course catalog on the public site | none | demo data | n/a | n/a | **Blocked**: LMS milestone (OI-38) |
| Job Hunter | none | demo | n/a | n/a | **Blocked**: decision (OI-32) |
| Hero counters, placement claims, seat counts | none | unchanged | n/a | n/a | **Blocked**: decision (OI-31) |
| Footer legal links | none | unchanged | n/a | n/a | **Blocked**: legal texts (OI-34) |
| CYRA chat bot, CTF warm-up board, copy buttons, navigation | none needed | unchanged | n/a | n/a | **Not applicable** (client-only) |
| Uploads (CVs) | not built | n/a | n/a | n/a | **Not applicable**: no form asks for a file |

The demo fallback when the API is not running was not re-tested in the browser in this stage.
