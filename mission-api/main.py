"""Mission 1 API: lesson completion, quiz grading, XP ledger and Docker lab sessions.

Identity: the Academy front end is a localStorage demo with no server login, so /api/m1/auth issues a signed,
expiring bearer token for the email the Academy session claims. Every other route derives the user from that
token only. Replace _issue_token's trust with a real IdP when the Academy gets one.
"""
import base64, hashlib, hmac, logging, os, re, secrets, threading, time, datetime as dt
from fastapi import APIRouter, FastAPI, Header, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import db, quiz, docker_lab, fingerprint, domaindate, subdomains

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mission1")
SECRET = (os.environ.get("MISSION_API_SECRET") or secrets.token_hex(32)).encode()
TOKEN_TTL = 12 * 3600
# Server-to-server link with the Academy API (24 Oct): the Academy owns identity and signs each request for one of
# its users. MISSION_INTERNAL_ONLY=1 switches off the old email-token sign-in, so only the Academy can act for a user.
SERVICE_SECRET = os.environ.get("MISSION_SERVICE_SECRET", "").encode()
INTERNAL_ONLY = os.environ.get("MISSION_INTERNAL_ONLY", "") == "1"
SERVICE_SKEW = 120  # seconds a signed request stays valid
ACADEMY_USER_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
IDLE_MINUTES = int(os.environ.get("MISSION_IDLE_MINUTES", "30"))
ORIGINS = os.environ.get("MISSION_ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",")
MISSIONS = {  # slug -> config. Mission ids and XP rules are server-side constants.
    "m1": {"id": "INT-01", "labslug": "intro-01", "title": "Introduction to Cybersecurity", "difficulty": "Beginner", "minutes": "20-30", "lesson_xp": 20, "per_q": 10},
    "m3": {"id": "WEB-01", "labslug": "web-01", "kind": "practical", "title": "Web Technology Fingerprinting", "difficulty": "Beginner", "minutes": "15-25"},
    "m4": {"id": "INFO-01", "labslug": "info-01", "kind": "practical", "check": "flag", "title": "Information Gathering", "difficulty": "Beginner", "minutes": "20-30"},
    "m5": {"id": "DOM-01", "labslug": "dom-01", "kind": "practical", "check": "date", "title": "Domain Expiration Intelligence", "difficulty": "Beginner", "minutes": "20-30"},
    "m6": {"id": "SUB-01", "labslug": "sub-01", "kind": "practical", "check": "count", "title": "Subdomain Enumeration", "difficulty": "Beginner", "minutes": "20-30"},
    "m7": {"id": "END-01", "labslug": "end-01", "kind": "practical", "check": "count", "noun": "endpoints", "title": "Endpoint Discovery", "difficulty": "Beginner", "minutes": "20-30"},
    "m8": {"id": "DIR-01", "labslug": "dir-01", "kind": "practical", "check": "flag", "flagprefix": "YOJO_directory_bruteforcing_", "wrongflaghint": "Open the hidden directory again and check its flag.", "title": "Hidden Directory Discovery", "difficulty": "Beginner", "minutes": "20-30"},
    "m9": {"id": "IMG-01", "labslug": "img-01", "kind": "practical", "check": "flag", "flagprefix": "YOJO_image_metadata_", "wrongflaghint": "Check the image metadata again with ExifTool.", "title": "Image Metadata Analysis", "difficulty": "Beginner", "minutes": "20-30"},
    "m2": {"id": "REC-01", "labslug": "recon-01", "title": "Reconnaissance Fundamentals", "difficulty": "Beginner", "minutes": "20-30", "lesson_xp": 20, "per_q": 5},
}
FLAG_DIGITS = min(12, max(4, int(os.environ.get("MISSION4_FLAG_DIGITS", "6"))))
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}$")

app = FastAPI(title="Yojo Academy Mission 1")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])
db.init()


def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.isoformat(timespec="seconds")


def _sign(p):
    return hmac.new(SECRET, p.encode(), hashlib.sha256).hexdigest()


def _issue_token(email):
    p = f"{email}|{int(time.time()) + TOKEN_TTL}"
    return base64.urlsafe_b64encode(f"{p}|{_sign(p)}".encode()).decode()


def _service_identity(request, uid, ts, sig):
    """HMAC-SHA256(MISSION_SERVICE_SECRET, "<user>|<unix ts>|<METHOD>|<path>") from the Academy API."""
    if not SERVICE_SECRET or not ACADEMY_USER_RE.match(uid or "") or not (ts or "").isdigit():
        raise HTTPException(401, "Sign in again to continue.")
    if abs(time.time() - int(ts)) > SERVICE_SKEW:
        raise HTTPException(401, "Sign in again to continue.")
    want = hmac.new(SERVICE_SECRET, f"{uid}|{ts}|{request.method}|{request.url.path}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, sig or ""):
        raise HTTPException(401, "Sign in again to continue.")
    return f"academy:{uid}"  # the Academy user id is the identity; no email is trusted


def user(request: Request, authorization: str = Header(default=""), x_academy_user: str = Header(default=""),
         x_academy_ts: str = Header(default=""), x_academy_sig: str = Header(default="")):
    if x_academy_sig:
        return _service_identity(request, x_academy_user, x_academy_ts, x_academy_sig)
    if INTERNAL_ONLY:
        raise HTTPException(401, "Sign in through the Academy.")
    try:
        raw = base64.urlsafe_b64decode(authorization.removeprefix("Bearer ").encode()).decode()
        email, exp, sig = raw.rsplit("|", 2)
        if hmac.compare_digest(sig, _sign(f"{email}|{exp}")) and int(exp) > time.time():
            return email
    except Exception:
        pass
    raise HTTPException(401, "Sign in again to continue.")


class AuthIn(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field(default="", max_length=80)


class QuizIn(BaseModel):
    answers: list[int] = Field(min_length=1, max_length=20)


class SessionIn(BaseModel):
    session_id: str = Field(pattern=r"^[0-9a-f]{12}$")


class SubmitIn(SessionIn):
    answer: str = Field(max_length=500)


class AdminDateIn(BaseModel):
    date: str = Field(max_length=40)


class LabIn(SessionIn):
    code: str = Field(min_length=4, max_length=64)


def progress(c, email, M):
    mid = M["id"]
    p = c.execute("SELECT * FROM m_progress WHERE email=? AND mission=?", (email, mid)).fetchone()
    xp = db.mission_xp(c, email, mid)
    scored = c.execute("SELECT score FROM m_attempts WHERE email=? AND mission=? AND scored=1", (email, mid)).fetchone()
    return {"lesson_completed": bool(p and p["lesson_done_at"]), "quiz_scored": scored is not None,
            "first_score": scored["score"] if scored else None, "best_score": p["best_score"] if p else 0,
            "lab_completed": bool(p and p["lab_done_at"]),
            "xp": xp, "max_xp": db.MAX_XP[mid], "lesson_xp": M["lesson_xp"], "per_question_xp": M["per_q"],
            "completed": bool(p and p["completed_at"])}


def practical_progress(c, email, M):
    p = c.execute("SELECT completed_at FROM m_progress WHERE email=? AND mission=?", (email, M["id"])).fetchone()
    n = c.execute("SELECT COUNT(*) FROM m_submissions WHERE email=? AND mission=?", (email, M["id"])).fetchone()[0]
    return {"completed": bool(p and p["completed_at"]), "completed_at": p["completed_at"] if p else None, "xp": db.mission_xp(c, email, M["id"]),
            "max_xp": db.MAX_XP[M["id"]], "attempts": n}


def maybe_complete(c, email, M):
    p = progress(c, email, M)
    if p["lesson_completed"] and p["quiz_scored"]:
        c.execute("UPDATE m_progress SET completed_at=COALESCE(completed_at, ?) WHERE email=? AND mission=?", (iso(now()), email, M["id"]))


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/api/m1/auth")
@app.post("/api/m2/auth")
@app.post("/api/m3/auth")
@app.post("/api/m4/auth")
@app.post("/api/m5/auth")
@app.post("/api/m6/auth")
@app.post("/api/m7/auth")
@app.post("/api/m8/auth")
@app.post("/api/m9/auth")
def auth(b: AuthIn):
    if INTERNAL_ONLY:  # the email-token sign-in trusted any email; the Academy link replaces it
        raise HTTPException(404, "Not found.")
    email = b.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Invalid email.")
    with db.tx() as c:
        c.execute("INSERT OR IGNORE INTO users(email,name) VALUES(?,?)", (email, b.name.strip()))
    return {"token": _issue_token(email)}


HOST_HEX = min(16, max(4, int(os.environ.get("LAB_HOST_RANDOM_HEX", "4")) // 2 * 2))  # e.g. 4 -> info-01-a83f


MISSION7_EXPECTED = 8  # verified: katana v1.8.0 -u <lab> -silent prints 8 unique URLs (homepage included), every run


def new_lab_host(slug, sid):
    """Unique per-session hostname, e.g. info-01-a83f.ctf.yojo.com. Uniqueness is enforced by a DB index; we retry on collision."""
    for _ in range(20):
        h = f"{slug}-{secrets.token_hex(HOST_HEX // 2)}.{docker_lab.base_domain()}"
        with db.tx() as c:
            if not c.execute("SELECT 1 FROM m_sessions WHERE lab_host=?", (h,)).fetchone():
                c.execute("UPDATE m_sessions SET lab_host=? WHERE id=?", (h, sid))  # reserve it for this session now
                return h
    return f"{slug}-{secrets.token_hex(4)}.{docker_lab.base_domain()}"


def make_flag(prefix="YOJO_information_disclose_"):
    """Fresh per-session flag. Only its SHA-256 is stored; the plain value goes to the container once."""
    return f"{prefix}{secrets.randbelow(9 * 10 ** (FLAG_DIGITS - 1)) + 10 ** (FLAG_DIGITS - 1)}"


def _row(c, sid):
    return c.execute("SELECT * FROM m_sessions WHERE id=?", (sid,)).fetchone()


def _view(r):
    return {"session_id": r["id"], "status": r["status"], "url": docker_lab.lab_url(r["lab_host"]) if r["status"] == "active" and r["lab_host"] else None,
            "host": r["lab_host"] if r["status"] == "active" else None,
            "created": r["created"], "started": r["started"], "stopped": r["stopped"], "expires": r["expires"]}


def _fail(sid):
    with db.tx() as c:
        c.execute("UPDATE m_sessions SET status='failed', stopped=? WHERE id=?", (iso(now()), sid))


def build(slug):
    M = MISSIONS[slug]
    mid = M["id"]
    r = APIRouter(prefix=f"/api/{slug}")

    def owned(c, sid, email):
        row = _row(c, sid)
        if not row or row["email"] != email or row["mission"] != mid:  # same answer for missing/foreign: no existence leak
            raise HTTPException(404, "Session not found.")
        return row

    def learn_routes():
        @r.get("/mission")
        def mission(email: str = Depends(user)):
            with db.tx() as c:
                c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                prog = progress(c, email, M)
            return {"id": mid, "title": M["title"], "difficulty": M["difficulty"], "minutes": M["minutes"],
                    "max_xp": db.MAX_XP[mid], "questions": quiz.public_questions(mid), "progress": prog}

        @r.get("/progress")
        def get_progress(email: str = Depends(user)):
            with db.tx() as c:
                c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                return progress(c, email, M)

        @r.post("/lesson/complete")
        def lesson_complete(email: str = Depends(user)):
            with db.tx() as c:
                c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                c.execute("UPDATE m_progress SET lesson_done_at=COALESCE(lesson_done_at, ?) WHERE email=? AND mission=?", (iso(now()), email, mid))
                awarded = db.ledger_award(c, email, mid, "lesson", M["lesson_xp"])
                maybe_complete(c, email, M)
                return {"awarded": awarded, "already_rewarded": awarded == 0, "progress": progress(c, email, M)}

        @r.post("/quiz/submit")
        def quiz_submit(b: QuizIn, email: str = Depends(user)):
            n = len(quiz.QUIZZES[mid])
            if len(b.answers) != n or any(a < 0 or a > 3 for a in b.answers):
                raise HTTPException(422, f"Send exactly {n} answers, each an option from 0 to 3.")
            correct, review = quiz.grade(b.answers, mid)
            with db.tx() as c:
                c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                # the first attempt is the scored one; the unique reward key makes concurrent replays safe
                first = c.execute("SELECT 1 FROM m_attempts WHERE email=? AND mission=? AND scored=1", (email, mid)).fetchone() is None
                c.execute("INSERT INTO m_attempts(email,mission,score,scored) VALUES(?,?,?,?)", (email, mid, correct, int(first)))
                c.execute("UPDATE m_progress SET last_score=?, best_score=MAX(best_score, ?) WHERE email=? AND mission=?", (correct, correct, email, mid))
                awarded = db.ledger_award(c, email, mid, "quiz", correct * M["per_q"]) if first else 0
                maybe_complete(c, email, M)
                return {"score": correct, "total": n, "scored_attempt": first, "awarded": awarded,
                        "review": review, "progress": progress(c, email, M)}


    def practical_routes():
        @r.get("/mission")
        def mission(email: str = Depends(user)):
            with db.tx() as c:
                c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                prog = practical_progress(c, email, M)
            extra = {"target_domain": subdomains.domain(), "simulated": True} if mid == "SUB-01" else {}
            return {"id": mid, "title": M["title"], "difficulty": M["difficulty"], "minutes": M["minutes"], "max_xp": db.MAX_XP[mid], "progress": prog, **extra}

        @r.get("/progress")
        def get_progress(email: str = Depends(user)):
            with db.tx() as c:
                return practical_progress(c, email, M)

        @r.post("/submit")
        def submit(b: SubmitIn, email: str = Depends(user)):
            flag_mode = M.get("check") == "flag"
            if flag_mode:
                answer = b.answer.strip()  # only harmless whitespace is normalised; no partial matches
                if not answer or len(answer) > 100:
                    raise HTTPException(422, "Enter the flag you found.")
            elif M.get("check") == "count":
                text = b.answer.strip()
                if not re.fullmatch(r"[0-9]{1,4}", text):
                    raise HTTPException(422, "Enter the count as a whole number, for example 7. Negative numbers, decimals and text are not accepted.")
                expected = subdomains.expected_count() if mid == "SUB-01" else MISSION7_EXPECTED
                noun = M.get("noun", "subdomains")
                accepted = int(text) == expected
                message = f"Correct! That is the number of unique {noun} discovered." if accepted else f"That is not the number of unique {noun}. Run the tool again and count each one once."
            elif M.get("check") == "date":
                exp = domaindate.expected()
                if exp is None:
                    raise HTTPException(503, "This mission's answer has not been configured yet. Please let an administrator know.")
                try:
                    accepted = domaindate.parse(b.answer) == exp
                except domaindate.BadDate as e:
                    raise HTTPException(422, str(e))
                message = "Correct! That matches the verified expiration date." if accepted else "That is not the expiration date. Re-read the registration record and check you used the expiration field."
            else:
                try:
                    accepted, message = fingerprint.check(b.answer)
                except fingerprint.BadAnswer as e:
                    raise HTTPException(422, str(e))
            with db.tx() as c:
                row = owned(c, b.session_id, email)  # also proves the session is this user's and this mission's
                if row["status"] == "expired" or (row["status"] == "active" and row["expires"] < iso(now())):
                    raise HTTPException(410, "Your lab session expired. Start a new lab session, your progress and earned XP are kept.")
                if row["status"] != "active":
                    raise HTTPException(409, "Start the lab to submit a solution.")
                recent = c.execute("SELECT COUNT(*) FROM m_submissions WHERE email=? AND mission=? AND created > datetime('now','-1 hour')", (email, mid)).fetchone()[0]
                if recent >= 30:
                    raise HTTPException(429, "Too many submissions. Wait a while and try again.")
                if flag_mode:  # the flag belongs to THIS user's session: compare against its stored hash
                    accepted = bool(row["lab_code_hash"]) and hmac.compare_digest(hashlib.sha256(answer.encode()).hexdigest(), row["lab_code_hash"])
                    message = "Correct! Flag accepted." if accepted else ("That flag is not correct. " + M.get("wrongflaghint", "Look again and retry."))
                c.execute("INSERT INTO m_submissions(email,session_id,mission,answer,accepted) VALUES(?,?,?,?,?)", (email, b.session_id, mid, b.answer.strip()[:200], int(accepted)))
                awarded, was_done = 0, False
                if accepted:
                    c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                    was_done = c.execute("SELECT completed_at FROM m_progress WHERE email=? AND mission=?", (email, mid)).fetchone()[0] is not None
                    c.execute("UPDATE m_progress SET completed_at=COALESCE(completed_at, ?) WHERE email=? AND mission=?", (iso(now()), email, mid))
                    awarded = db.ledger_award(c, email, mid, "solve", db.MAX_XP[mid])
                return {"accepted": accepted, "message": message, "awarded": awarded, "already_completed": accepted and was_done and awarded == 0,
                        "progress": practical_progress(c, email, M)}

    def admin_routes():
        """Authorized update of the verified answer: needs MISSION_ADMIN_TOKEN (route is disabled when it is unset)."""
        def guard(token):
            want = os.environ.get("MISSION_ADMIN_TOKEN", "")
            if not want or not hmac.compare_digest(token or "", want):
                raise HTTPException(404, "Not found.")

        @r.post("/admin/expected-date")
        def set_date(b: AdminDateIn, x_admin_token: str = Header(default="")):
            guard(x_admin_token)
            try:
                d = domaindate.set_expected(b.date)
            except domaindate.BadDate as e:
                raise HTTPException(422, str(e))
            return {"configured": True, "source": "admin"}

        @r.get("/admin/expected-date")
        def get_date(x_admin_token: str = Header(default="")):
            guard(x_admin_token)
            return {"configured": domaindate.expected() is not None, "source": domaindate.source()}  # never returns the date

    if M.get("check") == "date":
        admin_routes()
    if M.get("kind") == "practical":
        practical_routes()
    else:
        learn_routes()

    @r.post("/session/start")
    def session_start(email: str = Depends(user)):
        sid = secrets.token_hex(6)
        with db.tx() as c:
            live = c.execute("SELECT * FROM m_sessions WHERE email=? AND mission=? AND status IN ('starting','active','stopping')", (email, mid)).fetchone()
            if live:
                if live["status"] == "active" and not docker_lab.is_running(live["id"]):
                    c.execute("UPDATE m_sessions SET status='expired', stopped=? WHERE id=?", (iso(now()), live["id"]))
                elif live["status"] == "active":
                    return _view(live)
                else:
                    raise HTTPException(409, "A session is already changing state. Try again in a moment.")
            c.execute("INSERT INTO m_sessions(id,email,mission,status,created,expires,last_seen) VALUES(?,?,?,'starting',?,?,?)",
                      (sid, email, mid, iso(now()), iso(now() + dt.timedelta(minutes=IDLE_MINUTES)), iso(now())))
        ehash = hashlib.sha256(email.encode()).hexdigest()[:16]
        host = new_lab_host(M["labslug"], sid)
        code = make_flag(M.get("flagprefix", "YOJO_information_disclose_")) if M.get("check") == "flag" else secrets.token_hex(6)  # per-session secret, placed inside the container only
        try:
            name, net, host_ = docker_lab.start(sid, ehash, mid, code, subdomains.lab_env() if mid == "SUB-01" else None, host)
        except docker_lab.DockerUnavailable:
            _fail(sid)
            raise HTTPException(503, "The lab service is unavailable right now. You can still read the lesson and take the quiz.")
        except Exception:
            _fail(sid)
            raise HTTPException(502, "The lab could not be started. Please try again.")
        with db.tx() as c:
            c.execute("UPDATE m_sessions SET status='active', container=?, network=?, lab_host=?, started=?, lab_code_hash=? WHERE id=?",
                      (name, net, host, iso(now()), hashlib.sha256(code.encode()).hexdigest(), sid))
            return _view(_row(c, sid))

    if M.get("kind") != "practical":
        @r.post("/lab/verify")
        def lab_verify(b: LabIn, email: str = Depends(user)):
            """Lab completion is decided here: the code must be the one placed in this user's own container."""
            with db.tx() as c:
                row = owned(c, b.session_id, email)
                if row["status"] == "failed" or not row["lab_code_hash"]:
                    raise HTTPException(409, "Start the lab and find the checkpoint code first.")
                if (row["lab_tries"] or 0) >= 10:
                    raise HTTPException(429, "Too many attempts for this session. Start a new session to try again.")
                c.execute("UPDATE m_sessions SET lab_tries=COALESCE(lab_tries,0)+1 WHERE id=?", (row["id"],))
                ok = hmac.compare_digest(hashlib.sha256(b.code.strip().lower().encode()).hexdigest(), row["lab_code_hash"])
                if ok:
                    c.execute("INSERT OR IGNORE INTO m_progress(email,mission) VALUES(?,?)", (email, mid))
                    c.execute("UPDATE m_progress SET lab_done_at=COALESCE(lab_done_at, ?) WHERE email=? AND mission=?", (iso(now()), email, mid))
                    maybe_complete(c, email, M)
                return {"verified": ok, "progress": progress(c, email, M)}


    @r.get("/session/current")
    def session_current(email: str = Depends(user)):
        with db.tx() as c:
            row = c.execute("SELECT * FROM m_sessions WHERE email=? AND mission=? ORDER BY created DESC LIMIT 1", (email, mid)).fetchone()
            if row and row["status"] == "active":
                c.execute("UPDATE m_sessions SET last_seen=?, expires=? WHERE id=?", (iso(now()), iso(now() + dt.timedelta(minutes=IDLE_MINUTES)), row["id"]))
            return _view(row) if row else {"status": "none"}

    @r.get("/session/{sid}")
    def session_get(sid: str, email: str = Depends(user)):
        with db.tx() as c:
            return _view(owned(c, sid, email))

    @r.post("/session/stop")
    def session_stop(b: SessionIn, email: str = Depends(user)):
        with db.tx() as c:
            row = owned(c, b.session_id, email)
            if row["status"] not in ("active", "starting"):
                return _view(row)
            c.execute("UPDATE m_sessions SET status='stopping' WHERE id=?", (row["id"],))
        try:
            docker_lab.stop(b.session_id)
        except docker_lab.DockerUnavailable:
            with db.tx() as c:
                c.execute("UPDATE m_sessions SET status='active' WHERE id=?", (b.session_id,))
            raise HTTPException(503, "The lab service is unavailable right now. Try stopping again shortly.")
        with db.tx() as c:
            c.execute("UPDATE m_sessions SET status='stopped', stopped=? WHERE id=?", (iso(now()), b.session_id))
            return _view(_row(c, b.session_id))

    return r


for _slug in MISSIONS:
    app.include_router(build(_slug))


def reap():
    """Expire idle sessions and remove orphaned containers."""
    try:
        with db.tx() as c:
            rows = c.execute("SELECT id FROM m_sessions WHERE status='active' AND expires < ?", (iso(now()),)).fetchall()
        for r in rows:
            docker_lab.stop(r["id"])
            with db.tx() as c:
                c.execute("UPDATE m_sessions SET status='expired', stopped=? WHERE id=?", (iso(now()), r["id"]))
        with db.tx() as c:
            active = {x["id"] for x in c.execute("SELECT id FROM m_sessions WHERE status IN ('starting','active')")}
        for sid in docker_lab.live_session_ids():
            if sid and sid not in active:
                docker_lab.stop(sid)
        docker_lab.prune_routes(active)
    except docker_lab.DockerUnavailable:
        pass
    except Exception:
        log.exception("reaper error")


def _loop():
    while True:
        time.sleep(30)
        reap()


@app.on_event("startup")
def _start():
    with db.tx() as c:  # sessions left mid-flight by a crash can never finish
        c.execute("UPDATE m_sessions SET status='failed' WHERE status IN ('starting','stopping')")
        # sessions from the old port-published model have no hostname and cannot be routed: expire them (the reaper removes their containers)
        c.execute("UPDATE m_sessions SET status='expired', stopped=? WHERE status='active' AND lab_host IS NULL", (iso(now()),))
    threading.Thread(target=_loop, daemon=True).start()
