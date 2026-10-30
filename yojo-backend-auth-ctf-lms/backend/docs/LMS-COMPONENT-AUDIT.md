# LMS component audit (29 Oct 2026)

Every section and component of the original prototype (the `OneDrive\Documents\Mascot character` copy, served on 127.0.0.1:5501, and the earliest backups) was checked against the current live version of the three portals, running with the backend on this computer.

**Status key**

- **Live**: present and working with real data from the server.
- **Restored**: missing or still on demo data before this audit; rebuilt or connected to the server today.
- **Partial**: present, but part of the original component is not there yet (see notes).
- **Demo (labelled)**: still sample data, kept on purpose and clearly marked on screen. It waits for a provider.
- **Missing**: in the original, not in the live version. It needs a backend or a decision (see notes).

Checks covered three things: the code, the API routes behind each screen, and the browser, signed in as Riya and Neha (students), Vikram (trainer) and Priya (Platform Admin).

## Summary

| Portal | Live | Restored today | Partial | Demo (labelled) | Missing |
|---|---|---|---|---|---|
| Student Academy | 24 | 2 | 2 | 0 | 0 |
| Trainer console | 23 | 4 | 7 | 0 | 4 |
| Admin console | 19 | 5 | 8 | 5 | 3 |

**What was missing and is now restored**

1. **Admin → Student Management**: the list and the student record (Profile, Progress, Labs, Audit) ran on sample data in live mode. Both now come from the server. Filters use the real batches.
2. **Admin → System Settings**: ran on sample data. All server sections (plans, XP, AI caps, promos, maintenance, policy, auth, gamification, placement) are now editable. Each save is versioned and audited. Policy, plans and auth ask for an authenticator code.
3. **Admin → Notifications → Holiday calendar**: was absent in live mode. It is back, saved on the server, and students see it on the Ops Calendar.
4. **Admin → Dashboard search**: searched sample users. It now searches real students by name, email or user ID.
5. **Trainer → Messages → Post to batch and Announcement history**: the original had them, the live version did not. They are rebuilt with a new API: the trainer's own batches only, audited, and students are notified.
6. **Student → My Handler → Trainer announcements**: rebuilt and fed by the trainer's posts.
7. **Trainer → Content**: course builder (owner, 29 Oct), course files and folder uploads with type checks, cover image, and attaching files to lessons. Students open lesson files.
8. **Trainer sidebar**: the stale "Demo data. No backend is connected" note now says "Live data".
9. **Clear labels on what is still sample data**:
   - Admin Dashboard paid-access queue and alerts
   - Finance + Dues
   - CTF Registrations

## Student Academy (academy.html)

| Section | Component | In original | Current status | Notes |
|---|---|---|---|---|
| Sign-in and onboarding | Login popup, Yes/No, email-first sign-up, details locked | Yes | Live | 29 Oct |
| Sign-in and onboarding | Access portal with audio | Yes | Live | Restored 29 Oct; 4.44 s, sound and skip buttons |
| Sign-in and onboarding | Career quiz or skip, team choice (once) | Yes | Live | |
| SOC Console · Dashboard | Welcome hero, rank, XP | Yes | Live | |
| SOC Console · Dashboard | Active operation, daily patches, weekly field ops | Yes | Live | |
| SOC Console · Dashboard | Streak (28 days), power levels, weekly league | Yes | Live | |
| SOC Console · Dashboard | Trophy case, recent victories, campaigns | Yes | Live | |
| Incident Response · Missions | Mission list, practice missions, hints | Yes | Live | Lab environments: practice labs only until the lab provider is linked |
| Hunter Rankings | Leaderboard | Yes | Live | |
| Intel | Feed, top blogs, comments, my blogs, submit for review | Yes | Live | Reviewed in Admin → Intel Review |
| Career | Career page, quiz, choose or change path | Yes | Live | |
| Cyber Arsenal (courses) | Catalogue, my courses, course page, lessons | Yes | Live | |
| Cyber Arsenal (courses) | Lesson files (video, PDF, slides, lab files) | Yes | Restored | 29 Oct: from trainer uploads, access checked per file |
| Cyber Arsenal (courses) | Plans (free / paid) | Yes | Partial | Shown; buying needs the payment provider (OI-58) |
| Training Grid | Deployment Record (attendance by course, sessions, leave) | Yes | Live | |
| Training Grid | Ops Calendar | Yes | Live | Includes admin holidays |
| Training Grid | My Handler: trainer card, slots, bookings, messages, ratings | Yes | Live | |
| Training Grid | My Handler: trainer announcements | Yes | Restored | 29 Oct |
| Training Grid | My Handler: recent feedback on graded work | Yes | Partial | Grades and trainer feedback show in Incoming Challenges, not on this page |
| Training Grid | This Week | Yes | Live | |
| Training Grid | Campaigns (courses learning and pending) | Yes | Live | |
| Training Grid | Incoming Challenges (assessments) | Yes | Live | |
| Training Grid | Placement Mission (resume, portfolio, mocks, milestones) | Yes | Live | |
| Training Grid | My Resume | New | Live | 29 Oct |
| Header | Bell notifications, profile, settings, logout | Yes | Live | |
| Header | Orbi assistant | Yes | Live | Answers need the AI provider; shows its honest state |
| Streak | Keep or reset decision | Yes | Live | |
| Certificates | My certificates and public verify | Yes | Live | PDF files need storage (OI-45) |

## Trainer console (trainer.html)

| Section | Component | In original | Current status | Notes |
|---|---|---|---|---|
| Dashboard | Welcome, today, to do, students to check on | Yes | Live | |
| My Batches | Batch list and overview | Yes | Live | |
| Students | List and 360 profile (index, flags, sessions, labs, assessments) | Yes | Live | |
| Students | Remarks and notes, placement readiness, requests to admin | Yes | Live | |
| Students | Learning progress per course | Yes | Partial | Shown in the course Students page, not on the profile |
| Classes | Schedule, create and edit sessions | Yes | Live | |
| Attendance | Lecture register, marking, corrections with reason | Yes | Live | |
| Attendance | Leave requests | Yes | Live | |
| Attendance | Concepts covered per lecture | Yes | Partial | Session topic only |
| Attendance | Absence clearance queue | Yes | Missing | No backend for clearing an absence after the fact; needs a decision (who approves, effect on %) |
| Content | Course builder list, tabs, cards | Yes | Live | 29 Oct |
| Content | Create course (title, track, level, duration, description, outcomes, batches) | Yes | Live | 29 Oct |
| Content | Cover image | Yes | Restored | 29 Oct |
| Content | Modules, lessons, FAQs | Yes | Live | |
| Content | File and folder uploads by type of content | New | Live | 29 Oct; virus scan pending (OI-45) |
| Content | Manage: publish, request unpublish, details, batches, co-editors | Yes | Live | 29 Oct |
| Content | Change requests (approval after publishing) | New | Live | 29 Oct |
| Content | Enrolled students | Yes | Live | |
| Content | Publish readiness checklist | Yes | Partial | The server refuses an empty course; no checklist view |
| Content | Edit history with compare and restore | Yes | Missing | Version number only; needs content snapshots (decision: how many versions to keep) |
| Content | Catalog listing (format, audience, prerequisites, labs, certificate) | Yes | Partial | Admin can edit them; the trainer cannot yet |
| Content | Lesson settings (preview, required, completion rule, release date) | Yes | Partial | Type, status, length, link, text and file only |
| Assessments | List, create, questions, release, extensions, report | Yes | Live | |
| Assessments | Submissions and grading with feedback | Yes | Live | |
| Assessments | Upcoming deadlines card | Yes | Missing | Small; dates are in the list |
| Lab Monitor | Progress, stuck rule, nudges | Yes | Live | |
| Mentoring | Requests, sessions, slots, outcomes, mock results | Yes | Live | |
| Mentoring | Placement reviews (resume, portfolio, milestones) | Yes | Live | |
| Mentoring | Weekly availability template | Yes | Partial | Slots one by one |
| Messages | Inbox, reply, new message | Yes | Live | |
| Messages | Post to batch | Yes | Restored | 29 Oct |
| Messages | Announcement history | Yes | Restored | 29 Oct |
| My Feedback | Average, by rating, comments | Yes | Live | Anonymous to the trainer |
| My Feedback | Rating trend by month | Yes | Missing | Data exists; chart not built |
| Profile | Profile details | Yes | Live | |
| Profile | Sign-in security (sessions, MFA) | Yes | Partial | Password reset from the login page; no session list here |
| Header | Bell, sign out | Yes | Live | |
| Sidebar | Live data note | Yes | Restored | Said "Demo data" before |

## Admin console (admin.html)

| Section | Component | In original | Current status | Notes |
|---|---|---|---|---|
| Dashboard | Control room header, clock, MFA chip | Yes | Live | |
| Dashboard | User search | Yes | Restored | 29 Oct; real students |
| Dashboard | Total, free, paid tiles | Yes | Live | |
| Dashboard | Pending approvals tile and paid-access approval queue | Yes | Demo (labelled) | Owner, 24 Oct: stays demo until the payment provider (OI-58) |
| Dashboard | Needs your attention | Yes | Demo (labelled) | Real pending work is in the bell and the queues below |
| Dashboard | Operational overview | Yes | Partial | Users live; other bars labelled as samples |
| Student Management | Student list with filters | Yes | Restored | 29 Oct |
| Student Management | Student record: Profile, Progress, Labs, Audit | Yes | Restored | 29 Oct |
| Student Management | Edit details (institution, city, mode, note) | Yes | Missing | No admin profile-edit API yet; shown read-only |
| Student Management | Payments tab | Yes | Demo (labelled) | Hidden in live mode until the payment provider |
| Student Management | Staff accounts and trainer invites | Yes | Live | |
| Total Users | Breakdown and list | Yes | Live | |
| CTF Registrations | Registration list, confirm, cancel | Yes | Demo (labelled) | Admin CTF API not built yet; counts are in Total Users |
| Enquiries | Submissions, notes, history, status | Yes | Live | |
| Attendance | Register by batch, export | Yes | Live | |
| Attendance | Correction history | Yes | Partial | Corrections need a reason and are audited; no history table here |
| Attendance | Trainer attendance (on duty, marks) | Yes | Missing | No backend; needs a decision |
| Performance | Students and index | Yes | Live | |
| Performance | How the index is made, attendance trend | Yes | Partial | Weights are in Settings → Policy; no trend chart |
| Courses | List, create, details, modules, lessons, FAQs, batches | Yes | Live | |
| Courses | Trainer changes (who, when, why) | New | Live | |
| Courses | Change requests (approve or reject) | New | Live | 29 Oct |
| Courses | Publish readiness, version history | Yes | Partial | Server check on publish; version number and change log only |
| Labs | Missions, hints, answers, completions | Yes | Live | |
| Labs | Environment settings | Yes | Partial | Needs the lab provider |
| Assessments | List, create, questions, submissions, report | Yes | Live | |
| Assessments | Shared question bank | Yes | Missing | Questions belong to one assessment |
| Intel Review | Queue, decisions, history, counts | New | Live | 29 Oct |
| Finance + Dues | Fees, payments, dues, reminders, second-admin | Yes | Demo (labelled) | Owner, 24 Oct: needs the payment provider (OI-58) |
| Analytics | Career paths, quiz, learning, labs, assessments, batches | Yes | Live | |
| Analytics | Payments and dues | Yes | Partial | Needs the payment provider |
| Insight Engine | Rules and matches | Yes | Live | |
| Notifications | Broadcast to students | Yes | Live | |
| Notifications | Holiday calendar | Yes | Restored | 29 Oct |
| Notifications | Wish templates, delivery log, scheduled sends, recall | Yes | Partial | Need the messaging providers (OI-01) |
| Student Reports | Per-student report, requests from trainers | Yes | Live | |
| Student Reports | Report builder and archive | Yes | Partial | Per-student report and CSV exports only |
| Certificates | List, issue, revoke, verify | Yes | Live | |
| System Settings | All sections, change history | Yes | Restored | 29 Oct; versioned, audited, authenticator for policy, plans, auth |
| Header | Bell, sign out, role chip | Yes | Live | |

## How to check it yourself

1. Start the backend (VS Code task "Academy API") and open the pages from Live Server or `localhost:8000`.
2. Sign in from the login popup with the demo accounts on the sign-in page (students Riya and Neha, trainer Vikram, admin Priya).
3. Screens marked **Demo (labelled)** show a red "Demo" chip and a note saying what they wait for.
