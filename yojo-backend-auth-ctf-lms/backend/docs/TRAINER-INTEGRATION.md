# Trainer portal: frontend-to-backend integration (26 Oct 2026)

Status of every section of `trainer.html` (live mode, `trainer.js` + `trainer-live.js`) against the owner's
"Trainer LMS Backend Integration" brief. All routes are under `/api/v1`, need a staff session with the trainer role
(`401` without a session, `403` for other roles) and are scoped on the server to batches the trainer leads or
co-leads (`batches.trainer_id` or `co_trainer_ids`). An ID outside that scope answers `404`, the same as an unknown ID,
so IDs cannot be probed (tested: `test/trainer-desk.e2e-spec.ts`).

Legend: **Live** = real data and working actions, tested. **Honest gap** = shown as not available, with the reason.

## Integration matrix

| # | Section | UI elements | API | Status |
|---|---|---|---|---|
| 1 | Dashboard | Greeting, average index ring, tiles (sessions today, attendance to mark, papers to grade, students to check on), Today list, To-do list, Students to check on, bell | `GET /trainer/dashboard`, `GET /trainer/batches/:id/overview`, `GET /trainer/sessions`, `GET /me/notifications` | **Live.** Every number is computed from records on each load (nothing stored twice). To-do items link to the record: attendance to mark, leave requests, submissions to grade, booking requests, placement reviews, unread messages, mentoring outcomes to record (new), requests waiting on the admin (new). Risk list shows the reason with the real figure, e.g. "Attendance 50% (needs 75%)". Index = attendance 20 %, quiz 40 %, labs 40 % (setting `policy.piWeights`, OI-42). |
| 2 | My Batches | Batch cards, roster with sort and filter, flags | `GET /trainer/batches`, `GET /trainer/batches/:id/overview` | **Live.** Only own batches; flags with reasons; counts from enrolments. |
| 3 | Students | Search list; student 360 with tabs Overview, Attendance, Labs, Assessments, Mentoring, Remarks, Placement; Escalate; Ask admin to contact guardian; Message student; Nudge | `GET /trainer/students/:id`, `POST /trainer/students/:id/remarks`, `PATCH /trainer/remarks/:id`, `POST /trainer/students/:id/requests`, `POST /trainer/labs/nudge`, `POST /trainer/conversations` | **Live (new).** Remarks are shared with the student's trainers and admins; private notes only with the author and admins; never deleted, edits keep the earlier text. Escalation and guardian-contact requests notify every active Platform Admin; the admin resolves them in Student Reports and the trainer is notified. Fees, payments, guardian details, other batches, flags and answers are never returned. |
| 4 | Classes | Upcoming / ongoing / past sessions, create, edit, cancel, join link, room | `GET/POST /trainer/sessions`, `PATCH /trainer/sessions/:id` | **Live.** End must be after start; a batch cannot have two sessions at the same time (`TIME_CLASH`); a past session cannot be changed. **Honest gap:** no live-class provider is connected; the join link is a URL the trainer pastes. |
| 5 | Attendance | Roster, P/L/A/E marks, 7-day correction with reason, history, leave requests | `GET/PUT /trainer/sessions/:id/attendance`, `GET /trainer/leave-requests`, `POST /trainer/leave-requests/:id/decide` | **Live.** One row per student and session (primary key), changes after the first mark need a reason and are kept in `attendance_history`. |
| 6 | Content | Courses of my batches, modules, lessons, FAQs; add, edit, delete with a reason | `GET /trainer/courses`, `GET /trainer/courses/:id`, module/lesson/FAQ routes | **Live.** Every edit or delete needs a reason from a list plus a comment (required for Other), stored in the audit log and shown to admins (OI-48). Publishing, price and free/paid stay admin-only (tested: `403` on `/admin/courses`). **Honest gap:** lesson file upload needs object storage (OI-45). |
| 7 | Assessments | List, New assessment (new), question editor (new), submissions, grading with history, publish / close / release, extensions (new), report (new) | `GET/POST /trainer/assessments`, `GET /trainer/assessments/:id`, `POST .../questions`, `DELETE /trainer/questions/:id`, `GET .../submissions`, `POST /trainer/attempts/:id/grade`, `POST .../extensions`, `GET .../report` | **Live.** Created as a draft for a course or batch the trainer teaches; questions (single, multiple, short text) can change only until the first student starts; answer keys are never sent to students; a changed grade needs a reason. **Honest gap:** file submissions need object storage. |
| 8 | Lab Monitor | Batch filter, student × lab grid with steps done, stuck alerts, Nudge | `GET /trainer/labs?batchId=`, `POST /trainer/labs/nudge` | **Live (new).** From the Academy's own lab records (steps done, tries, hints used, last activity); "stuck" = open lab with no progress for 3 days or 5+ tries on an unfinished step. A nudge is an in-app notification, once per student, lab and day. Flags, answers and hint texts are never returned. Live container status stays inside the lab service (the browser never reaches it). |
| 9 | Mentoring | Session requests (approve / new time / decline), open slots, mock-interview results, outcomes (new), placement reviews | `GET /trainer/session-requests`, `POST .../decide`, slots, `POST .../mock-result`, `POST /trainer/session-requests/:id/outcome`, placement review routes | **Live.** Outcome and follow-up can be recorded after the session starts; it marks the session completed; trainer and admin only. |
| 10 | Messages | Inbox, thread, reply, unread counts, New message (new) | `GET /trainer/conversations`, `GET /trainer/conversations/:id` (marks read), `POST .../messages`, `POST /trainer/conversations` | **Live.** A trainer can now start a message to a student of their batches. Opening a thread marks it read in the database. **Honest gap:** batch announcements are sent by a Platform Admin; email delivery needs a mail provider (OI-01), so messages are in-app only. |
| 11 | My Feedback | Average, distribution, comments with session context, rating filter, paging | `GET /trainer/feedback` | **Live (new).** Students rate a class they attended (present or late) or a completed mentoring session, any time after it ends, one rating per session that they can change (Training Grid → My Handler → Rate your sessions; owner decision OI-60). Trainers see ratings without names and cannot edit or delete them; admins see names for moderation (`GET /admin/trainers/:id/feedback`). |

## New database objects (migration `20261026120000_trainer_desk`)

| Table / column | Purpose | Integrity |
|---|---|---|
| `student_remarks` | Remarks and private notes | FK to users; text 3–2000 chars (check); edits append to `history`; optimistic update (no silent overwrite) |
| `student_staff_requests` | Escalations and guardian-contact requests | FK to users; code `SR-n`; reason 5–1000 chars; one open request per trainer, student and kind |
| `trainer_feedback` | Student ratings of trainers | rating 1–5 (check); exactly one of session or mentoring session (check); one per student and session (a new rating replaces the old one, audited) |
| `session_requests.outcome`, `follow_up`, `outcome_at` | Mentoring outcome | set only by the session's trainer after the start |

## Tests

`test/trainer-desk.e2e-spec.ts` (9 tests): unauthenticated `401`, student `403`, trainer A → trainer B's student `404`
on every route (IDOR), co-trainer access, admin-only pricing `403`, remark visibility and history, request
notification and resolution, Lab Monitor scope and no answer data, one nudge a day, trainer-started message,
feedback rules (attended only, one changeable rating, no time limit, anonymous to trainers), mentoring outcome, flag reasons with figures.
Existing suites cover sessions, attendance, assessments, content, mentoring and messages.

## Provider dependencies and decisions still open

| Needs | Affects | Item |
|---|---|---|
| Mail provider | Email copies of notifications | OI-01 |
| Object storage | Lesson files, file submissions | OI-45 |
| Live-class provider | Join links (pasted today) | not in the brief's scope; decide if wanted |

## Verify locally

1. `npx prisma migrate deploy` (never `migrate reset`).
2. Start the API (`npm run start:dev`) and the pages server; sign in as a trainer on `login.html`.
3. Walk the 11 sections; every page loads from the API (no demo values in live mode).
