# Student Academy, LMS, courses and Admin LMS: inventory (Phase 1 audit, 22 Oct 2026)

**What exists.** The Student Academy is a static prototype: `academy.html` (Cyber Command, Intel, Cyber Arsenal, shell),
`academy-lms.js` (Training Grid), `course-ui.js` (course cards and detail), `academy-game.js` / `academy-story.js`
(visual effects, the Orbi mascot tour and its canned answers), `academy-mission1.js` (Missions 1 to 9 front end).
Data comes from the browser: `localStorage.yojo_demo_db_v1` (the student's `stats`, `notifs`, `scrolls`, `portfolio`,
`lms`), `trainer-data.js` (`YojoCourses` catalog and access, `YojoBridge` student ↔ trainer demo "server") and
`admin-data.js` (`AdminAPI`, the admin console's simulated server). The only real service is `mission-api/`
(Python FastAPI + SQLite + Docker labs on port 8100), which owns Missions 1 to 9: lessons, quiz grading, lab
sessions, answer checks and its own XP ledger.

**Screenshot reference.** Only one screenshot was attached (the "You missed your streak" pop-up). Every other
component below is taken from the HTML/JS source, which matches the section names in the request.

**Status words used later** (completion matrix): Implemented and tested · Implemented, not fully tested · Blocked
(missing source, credentials or infrastructure) · Needs a product decision · Not applicable.

## Rules given by the owner (22 Oct)

| Rule | Exact behaviour to implement |
|---|---|
| Streak day | A day counts only when the student earns XP from a lab or a daily patch (the existing pop-up text). Day boundaries in Asia/Kolkata. |
| Streak grace and break | The streak survives up to 48 hours after the last qualifying activity. After that, the next visit gets a pending "streak broken" decision (the existing pop-up): **Keep** = deduct 10% of the student's current total XP, `Math.round` half-up to a whole number (1,650 → −165 → 1,485), written to the XP ledger, streak continues; **Reset** = XP unchanged, streak 0. One decision per break, idempotent, decided only by the server. |
| Lab hints | Max 3 hints per lab attempt; hint 1 −5%, hint 2 −10%, hint 3 −15% (cumulative −30%), whole numbers. Default base: the lab's XP reward (the reward paid at completion is reduced). Alternative reading (5% of the student's total XP) is a setting; **open decision**. Hints are revealed only by the server and charged once each. |
| XP | Append-only ledger (award, penalty, correction; reason; source event; unique per source). Totals are derived. |

## Shell (all Academy pages)

| Component | Today (mock source) | Backend data | API | Admin LMS control | Auth | Tests |
|---|---|---|---|---|---|---|
| Header XP and streak chips | `me.stats.xp`, `me.stats.streak` | XP ledger sum, streak state | `GET /student/dashboard` (header block) | XP corrections | student session | values equal ledger sum |
| Bell, notifications, mark read | `defaultNotifs()` 5 hard-coded items (quiz moved, fee reminder…) | `notifications` | `GET /student/notifications`, `POST /student/notifications/:id/read`, `POST …/read-all` | admin/trainer broadcasts | own rows only | IDOR test |
| Avatar menu: name, ID, plan, My resume, Log out | demo profile | `users`, `student_profiles`, entitlements | `GET /me` (exists) | Student Management | session | |
| Gate "finish the 18-question questionnaire" | `me.category` in localStorage | onboarding result | `GET /student/onboarding`, `POST /student/onboarding/quiz` | — | session | answer keys never sent |
| Orbi mascot and chat | canned regex answers in `academy-story.js` | **no assistant service exists** | `POST /student/assistant` → 503 `ASSISTANT_NOT_CONFIGURED` | — | session | honest unavailable |

## Cyber Command (`#/academy/dashboard`, `missions`, `leaderboard`, `lore-vault`)

| Component | Mock today | Backend data / rule | API | Admin control |
|---|---|---|---|---|
| Welcome panel: name, agent ID, faction/path, rank, plan, XP to next rank | `RANKS` table in page; plan from `stats.plan` | rank table (config), plan from entitlements (`plan:paid`), path from onboarding | `GET /student/dashboard` | rank thresholds (settings) |
| Tiles: Total XP, Win streak, Free ops cleared "/ 15", Campaigns won | `stats.*`; "15" hard-coded; campaigns = 1 if paid | ledger, streak, completed missions / published free missions, completed courses | dashboard | — |
| World Breach Map (cities secured/breached) | `academy-game.js` derives from `stats.cleared` | city = mission group; secured when its missions are completed (server records) | `GET /student/missions` (cities block) | mission ↔ city mapping |
| Active operation | first entry of `stats.progress` | latest open mission attempt | dashboard | — |
| Daily patches (learn 40, lab 60, read 20 XP; claim button) | `questState()` flags set by page events | daily task definitions + verified events (lesson completed, lab cleared, blog read); claim once per IST day | `GET /student/daily`, `POST /student/daily/:key/claim` | task XP (settings) |
| Weekly field ops (3 labs 150, 5-day streak 100, 10 patches 80) | progress partly fabricated (`+4` added to patches) | weekly definitions, progress from records, auto-award once per IST week | dashboard | ops config |
| Streak, last 28 days, longest, freezes | `days[]` generated by formula | `streak_days` (one row per qualifying IST day), streak state | dashboard | — |
| Missed-streak pop-up | client computes and deducts | server pending decision + keep/reset | `GET /student/streak`, `POST /student/streak/decision` | — |
| Power levels Offensive/Defensive/GRC | onboarding quiz scores in localStorage | onboarding result scores (versioned rules) | dashboard | — |
| Weekly league (Gold/Bronze, rank) | `PEERS` 9 fake learners | weekly XP from ledger, divisions config | `GET /student/leaderboard?tab=week\|all\|college` | league config, hide/moderate |
| Trophy case (12 badges) | conditions computed in page | achievement definitions + awards (unique) | `GET /student/achievements` | definitions |
| Recent victories | `stats.cleared` | latest mission completions with XP | dashboard | — |
| Campaigns in the Cyber Arsenal | `YojoCourses.forStudent` | course catalog + access | `GET /student/courses` | courses |
| Missions grid: filters, search, Deploy/Resume/Replay | `MISSIONS` (empty) + `academy-mission1.js` cards | mission catalog; attempts; rewards | `GET /student/missions`, `POST /student/missions/:code/attempts`, hints, submit | mission admin |
| "Clear objective (demo) +XP" button | awards XP from the client | **removed in live mode**: XP only from verified completion | — | — |
| Missions 1–9 (lessons, quiz, Docker lab, flags) | `mission-api` with its own XP ledger and **unverified email bearer tokens** | lab provider boundary; XP must move to the Nest ledger | provider adapter (server to server) | lab health | 
| Leaderboard: week/all/college, podium, "show me" | `PEERS` | ledger aggregates; display name only; opt-out | `GET /student/leaderboard`, `PATCH /me {showOnBoard}` (exists) | moderation |
| Intel feed, search, top blogs, read, like, comment | `SCROLLS` 8 fake posts with fake likes/views | `blogs`, `blog_reactions`, `blog_comments`, `blog_views` | `GET /intel/blogs`, `GET /intel/blogs/:slug`, reactions, comments | moderation queue |
| Write a blog / My blogs ("checked by an admin") | `me.scrolls` | blog drafts → review → published | `POST /student/blogs`, `PATCH`, `POST …/submit`, `GET /student/blogs` | approve/reject with feedback |

## Training Grid (`#/lms/*`, `academy-lms.js`)

| Section | Mock today | Backend data / rule | API | Admin / trainer control |
|---|---|---|---|---|
| Premium lock on most sections | `isPaid()` from `stats.plan` | entitlement `plan:paid` or active enrolment | all LMS endpoints return 403 `ENTITLEMENT_REQUIRED` where needed | entitlements |
| Deployment Record: %, present/absent, weekly bars, by course, threshold 75 | **attendance generated by a hash of the date**; `LMS_REQUIRED = 75` | `class_sessions` + `attendance` (present, absent, late, excused); % = (present+late)/(eligible held sessions), excused excluded | `GET /student/attendance?from&to` | sessions, marking, corrections (trainer of the batch, admin) |
| Ops Calendar (month/week/day, filters, agenda) | generated timetable `sessionsOn()`, `LMS_HOLIDAYS` | sessions, assessments due, bookings, holidays | `GET /student/calendar?from&to` | calendar admin |
| This Week (list/week, join links, next session) | generated | sessions of the student's batches; join link only for enrolled students | `GET /student/schedule?week` | sessions |
| My Handler: trainer card, mentor, availability, slots, book, messages, leave, announcements, grades | `LMS_TRAINER`, `LMS_MENTOR` constants, `YojoBridge` demo | batch trainer profile (`staff_profiles`), availability slots, `session_requests`, `conversations`/`messages`, `leave_requests` | `GET /student/trainer`, `GET/POST /student/session-requests`, `POST …/:id/cancel`, `GET/POST /student/messages`, `GET/POST /student/leave-requests` | trainer approves/rejects; admin oversight |
| Campaigns (enrolled courses, progress, pending modules) | `LMS_ENROLLED` 4 fake courses | enrolments + lesson progress | `GET /student/learning` | — |
| Courses pending / queue | `LMS_QUEUE` 5 fake | catalog + pending reasons (payment, approval, batch, prerequisite) | `GET /student/courses?view=pending` | enrolment approval |
| Incoming Challenges (pending/due soon/submitted/completed; quiz, lab, assignment, practical, exam) | `LMS_ASSESS` 7 fake, due dates relative to today | `assessments`, `questions`, `attempts`, `submissions`, grades | `GET /student/assessments`, attempts, submit, results | trainer authoring, grading, release |
| Placement Mission (overall %, resume, mocks, internship prep, portfolio) | hard-coded 75/40, "Applications open 1 Nov", 3 fake projects | readiness from records with configured weights (**open decision**) | `GET /student/placement`, `GET/PUT /student/resume`, portfolio CRUD, mock-interview requests | reviews, milestones config |
| Resume view and download | page modal, "PDF download comes with the backend build" | profile + projects; PDF generation **not built** (no PDF service decided) | `GET /student/resume` | trainer review |

## Cyber Arsenal (`#/courses`, `course-ui.js`, `YojoCourses` in `trainer-data.js`)

| Component | Mock today | Backend | API | Admin / trainer control |
|---|---|---|---|---|
| Catalog, categories, filter groups (featured, trending, beginner, hands-on, free, paid, recent), search | `YojoCourses.list()` (13 demo courses) | `courses` (+ modules, lessons, FAQs); trending = most new enrolments in 30 days (documented), recent = published in last 30 days | `GET /courses?category&filter&q&cursor`, `GET /courses/:slug` | course CRUD, publish, archive |
| Course detail: outcomes, syllabus, lessons, preview lessons, labs, certificate, FAQs, price | demo record | published fields only | as above | |
| Access state (enrolled / free / locked) and "Enroll Now" / "View Plans" / "Request paid access" | `entitlement()` in demo: free course open to all; paid course only via a batch running it | same rule on the server: free = open; paid = active enrolment in a batch whose `courseId` is the course; `plan:paid` alone does not open a course | `GET /student/courses`, enrolment request (exists: `course_enrolment` submission) | batches, enrolments |
| My courses: progress %, completed/pending modules, next lesson | demo progress | `lesson_progress` | `GET /student/courses/:id/progress` | — |
| Lesson open / Mark as complete | demo; any lesson can be marked complete | lesson access check; completion rules (quiz/lab lessons need their verified result) | `GET /student/courses/:id/lessons/:lessonId`, `POST /student/lessons/:id/complete` | lesson completion rules |
| Certificates | admin demo module | eligibility = all required lessons done + passing assessments; issued by admin; verification code | `GET /student/certificates`, `GET /certificates/:code/verify`, admin issue/revoke | admin |
| Lesson files and videos | file names only | private object storage **not configured** | signed URL boundary returns 503 `STORAGE_NOT_CONFIGURED` | upload |

## Admin LMS (`admin.html`, `admin-data.js`) and Trainer LMS (`trainer.html`, `trainer.js`)

Admin modules: Dashboard, Student Management, Total Users (live), CTF Registrations, Enquiries (live), Attendance,
Performance, Finance + Dues, Analytics, Insight Engine, Notifications, Student Reports, Certificates, System Settings.
Trainer modules: Dashboard, My Batches, Students, Classes, Attendance, Content (courses, modules, lessons),
Assessments, Lab Monitor, Mentoring, Messages, My Feedback. Course, lab and assessment authoring is in the trainer
console by design ("managed by trainers"); admins see and override. All of these read demo data today.

## Backend gaps found in the existing code

| Gap | Effect |
|---|---|
| `batches` has no course link | Course access by batch (the demo rule) needs `batches.course_id`. |
| No XP, streak, mission, course, lesson, assessment, attendance, blog, notification or placement tables | All of this is new. |
| `mission-api` issues bearer tokens for any email without verification | A student can act as anyone in the mission service. It must sit behind the Nest session (server-to-server) before it is exposed. Not changed without the owner's go-ahead. |
| No object storage, PDF, push or assistant provider | Uploads, resume PDF and Orbi stay behind honest "not configured" boundaries. |

## Build order (each slice tested before the next)

(a) XP ledger, streak with grace and keep/reset, daily patches, weekly ops, achievements, league →
(b) courses, modules, lessons, FAQs, enrolment access and pending reasons, progress, certificates →
(c) sessions, attendance, calendar, schedule, trainer profile, booking, leave, messaging →
(d) assessments, quizzes, submissions, grading →
(e) missions and labs with hints and an honest provider boundary →
(f) Intel blogs with moderation → (g) placement, resume, portfolio, readiness →
(h) notifications and the Orbi boundary → (i) Admin/Trainer LMS APIs and screens → (j) Academy page wiring.

The completion matrix is added at the end of this file as slices land.

## Completion matrix (24 Oct 2026)

"Tested" means an e2e suite in `test/` exercises it against real PostgreSQL and Redis (all 26 suites, 377 tests pass on 24 Oct; see the
final report for counts). "Browser-checked" means it was driven once in a browser against the local API with QA
accounts; that is not an automated test. Open items are in `docs/OPEN-ITEMS.md` (OI-41 onwards).

| Feature | Status | Evidence / reason |
|---|---|---|
| XP ledger (append-only, unique per source, corrections with reason) | Implemented and tested | `academy-gamification` |
| Streak: IST days, lab/patch only, 48 h grace, keep (−10 % of total XP, `Math.round`) or reset, idempotent decision | Implemented and tested | `academy-gamification`; pop-up browser-checked (200 → 180 XP on Keep) |
| Daily patches and weekly ops | Implemented and tested | `academy-gamification`; claim browser-checked (+40 XP) |
| Trophies (12 rules) | Implemented and tested | `academy-gamification` |
| Weekly league and leaderboards (week, all-time, college, hide-me) | Implemented and tested | `academy-gamification` (close-week called directly) |
| League close job (Monday 00:05 IST in the worker) | Implemented, not fully tested | Same code as the tested `closeWeek`; the scheduler itself is not run in tests |
| Onboarding quiz (18 questions, 3 skips, scoring) | Implemented and tested | `academy-gamification`. Replaced for new students by the career-path quiz (24 Oct); older results still count as the path until a student chooses one. |
| Courses, modules, lessons, FAQs, access and pending reasons, progress | Implemented and tested | `academy-courses`; student pages browser-checked |
| Trainer edits course content (own batches only; publish, price, access admin-only) | Implemented and tested | `academy-trainer-courses`; trainer Content page browser-checked |
| Certificates: issue, revoke, public verify | Implemented and tested | `academy-courses` |
| Certificate PDF and lesson file downloads | Blocked | No PDF service and no object storage (OI-45) |
| Training Grid: sessions, attendance (7-day edit window, reasons, history), calendar, schedule, join links | Implemented and tested | `academy-grid`; trainer marking and student view browser-checked |
| Bookings, leave, messages | Implemented and tested | `academy-grid`; leave request browser-checked |
| Assessments: quizzes, text and lab-result answers, grading, release, extensions, grade history | Implemented and tested | `academy-assessments` |
| Quiz question authoring screen in the trainer console | Needs a product decision | The API exists (`POST /trainer/assessments/:id/questions`); the console lists, publishes, releases and grades but has no question editor yet. Decide whether trainers author quizzes there or admins do. |
| Missions catalog, World Breach Map, hints (3 max; 5/10/15 %, base = lab reward) | Implemented and tested | `academy-missions` |
| Labs INT-01, REC-01, DOM-01 (lesson, quiz, date) on the Academy server | Implemented and tested | `academy-labs`; played in the browser (INT-01 +100 XP, DOM-01 with a hint 48 XP) |
| Labs WEB-01, SUB-01, END-01: answers checked on the Academy server | Implemented and tested | `academy-labs`; their live target needs the lab service (OI-57) |
| Live lab environments and per-session flags (INFO-01, DIR-01, IMG-01) | Implemented and tested | `academy-lab-link` (Academy side, stand-in service) and mission-api `tests/test_academy_link.py` + 9 real-container tests; all 6 live labs played in the browser with real containers (OI-57) |
| Missions page and lab page (cards, steps, quiz, answers, hints with cost shown first) | Implemented, not fully tested | Browser-checked; no automated UI tests |
| In-browser practice labs in live mode | Not applicable | With the lab service linked every lab is server-verified; the "Demo — XP not saved" practice cards show only if the lab service is offline. |
| Intel blogs: drafts, flag filter, review, reactions, comments, reports, views, top list | Implemented and tested | `academy-intel`; Academy pages wired |
| Placement: readiness, resume, portfolio, milestones, mock interviews | Implemented and tested | `academy-placement`; resume save browser-checked |
| Notifications: bell, read, preferences, email for important ones, producers, admin broadcast | Implemented and tested | `academy-notifications`. Real email delivery is Blocked by OI-01 (dev mail files only). |
| Broadcast above the policy limit (second admin) | Needs a product decision | Refused today with `NEEDS_SECOND_ADMIN` (OI-47) |
| Orbi assistant | Blocked | No assistant provider; the API answers `ASSISTANT_NOT_CONFIGURED` (OI-46) |
| Trainer and admin dashboards, batch overview, performance index, flags | Implemented and tested | `academy-insights`; index rules are provisional (OI-42) |
| Academy page wiring (`academy-live.js`) | Implemented, not fully tested | Every Academy section reads and writes the server when signed in; demo mode unchanged without the API. Browser-checked, no automated UI tests. |
| Trainer console wiring (`trainer-live.js`) | Implemented, not fully tested | All 11 modules live except My Feedback. Browser-checked. |
| Admin console: Attendance, Performance, Notifications, Enquiries, users, staff | Implemented, not fully tested | Browser-checked |
| Admin console: Finance and dues | Blocked | Payments milestone (no payment provider) |
| Admin console: Courses, Labs (missions, hashed answers, hints), Assessments (questions, grading, release) | Implemented, not fully tested | Live screens over the tested course, mission and assessment APIs (`academy-courses`, `academy-missions`, `academy-assessments`). Browser-checked: course save, mission create + answer + hint, quiz create + question + publish. |
| Admin console: Analytics (definitions per figure) | Implemented and tested | `academy-admin-analytics`; screen browser-checked |
| Admin console: Insight Engine, rule-based (10 fixed rules, records listed) | Implemented and tested | `academy-admin-analytics`; no AI feed and no page telemetry (OI-55) |
| Admin console: Student reports (list with career-quiz filters, full report, audited) | Implemented and tested | `academy-career-quiz`; screen browser-checked |
| Admin console: Certificates register (issue on eligibility, filter, revoke, verify) | Implemented and tested | `academy-admin-analytics`; issue browser-checked |
| Career-path quiz (15 scenarios, %, suggestion, chosen path, skip, 30-day retake) | Implemented and tested | `academy-career-quiz` (7 tests); student flow browser-checked (27/40/33, chose GRC). Wording needs Yojo's review (OI-52). |
| Trainer "My Feedback" (student ratings) | Needs a product decision | No feedback collection exists; decide whether students rate sessions |
| Remarks, escalations, guardian contact requests (trainer Student 360) | Needs a product decision | Not built; the demo had them |
| Payments, paid-plan purchase | Not applicable | Out of scope for this stage; "Request paid access" sends an enquiry to the Admin LMS inbox |
