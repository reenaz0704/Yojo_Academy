"""Academy API link (24 Oct): requests signed by the Academy for one of its users are accepted, everything else is
refused, and MISSION_INTERNAL_ONLY switches off the old email-token sign-in. Matches the Academy's contract test
(backend/test/academy-lab-link.e2e-spec.ts)."""
import hashlib, hmac, os, re, tempfile, time
os.environ.setdefault("MISSION_DB", os.path.join(tempfile.mkdtemp(), "tlink.db"))
os.environ.setdefault("MISSION_API_SECRET", "test-secret")
import pytest
from fastapi.testclient import TestClient
import main, docker_lab

SECRET = b"test-mission-service-secret-0123456789abcdef"
USER = "3f2b8c1e-1d2a-4c5b-9e8f-0a1b2c3d4e5f"
OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
client = TestClient(main.app)


def signed(method, path, user=USER, ts=None, secret=SECRET):
    ts = str(int(time.time()) if ts is None else ts)
    sig = hmac.new(secret, f"{user}|{ts}|{method}|{path}".encode(), hashlib.sha256).hexdigest()
    return {"X-Academy-User": user, "X-Academy-Ts": ts, "X-Academy-Sig": sig}


@pytest.fixture(autouse=True)
def link(monkeypatch):
    monkeypatch.setattr(main, "SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main, "INTERNAL_ONLY", True)
    live, flags = set(), {}

    def start(sid, eh, m="INT-01", code="", env=None, host=""):
        live.add(sid)
        flags[sid] = code
        return (f"c-{sid}", f"n-{sid}", 49996)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    monkeypatch.setattr(docker_lab, "wait_ready", lambda *a, **k: True, raising=False)
    return flags


def test_signed_request_is_the_academy_user():
    r = client.get("/api/m4/session/current", headers=signed("GET", "/api/m4/session/current"))
    assert r.status_code == 200 and r.json() == {"status": "none"}


def test_unsigned_tampered_expired_and_email_tokens_are_refused():
    assert client.get("/api/m4/session/current").status_code == 401
    h = signed("GET", "/api/m4/session/current")
    h["X-Academy-User"] = OTHER  # signature was made for USER
    assert client.get("/api/m4/session/current", headers=h).status_code == 401
    assert client.get("/api/m4/session/current", headers=signed("GET", "/api/m4/session/current", ts=int(time.time()) - 600)).status_code == 401
    assert client.get("/api/m4/session/current", headers=signed("GET", "/api/m4/session/current", secret=b"wrong-secret-wrong-secret-wrong!!")).status_code == 401
    assert client.get("/api/m4/session/current", headers=signed("GET", "/api/m8/session/current")).status_code == 401  # bound to the path
    assert client.post("/api/m4/auth", json={"email": "someone@example.com"}).status_code == 404
    assert client.get("/api/m4/session/current", headers={"Authorization": "Bearer anything"}).status_code == 401


def test_flag_is_checked_for_the_signed_users_own_session(link):
    s = client.post("/api/m4/session/start", headers=signed("POST", "/api/m4/session/start")).json()
    assert s["status"] == "active"
    flag = link[s["session_id"]]
    assert re.fullmatch(r"YOJO_information_disclose_\d{6}", flag)
    # another Academy user cannot use this session
    other = client.post("/api/m4/submit", json={"session_id": s["session_id"], "answer": flag}, headers=signed("POST", "/api/m4/submit", user=OTHER))
    assert other.status_code == 404
    ok = client.post("/api/m4/submit", json={"session_id": s["session_id"], "answer": flag}, headers=signed("POST", "/api/m4/submit"))
    assert ok.status_code == 200 and ok.json()["accepted"] is True
