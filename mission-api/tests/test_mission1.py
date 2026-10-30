import os, tempfile, threading
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
import pytest
from fastapi.testclient import TestClient
import labutil, main, quiz, docker_lab

client = TestClient(main.app)
KEY = [q["answer"] for q in quiz.QUESTIONS]


def login(email):
    t = client.post("/api/m1/auth", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def wrong():
    return [(a + 1) % 4 for a in KEY]


def test_quiz_shape_and_no_key_leak():
    assert len(quiz.QUESTIONS) == 8
    assert all(len(q["options"]) == 4 and 0 <= q["answer"] < 4 for q in quiz.QUESTIONS)
    body = client.get("/api/m1/mission", headers=login("a@x.io")).text
    assert "answer" not in body and "why" not in body


def test_auth_required():
    assert client.get("/api/m1/progress").status_code == 401
    assert client.get("/api/m1/progress", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_lesson_xp_once():
    h = login("lesson@x.io")
    assert client.post("/api/m1/lesson/complete", headers=h).json()["awarded"] == 20
    for _ in range(3):
        r = client.post("/api/m1/lesson/complete", headers=h).json()
        assert r["awarded"] == 0 and r["progress"]["xp"] == 20


def test_quiz_full_marks_then_replay_no_xp():
    h = login("quiz@x.io")
    r = client.post("/api/m1/quiz/submit", headers=h, json={"answers": KEY}).json()
    assert r["score"] == 8 and r["awarded"] == 80 and r["scored_attempt"]
    r2 = client.post("/api/m1/quiz/submit", headers=h, json={"answers": KEY}).json()
    assert r2["awarded"] == 0 and not r2["scored_attempt"] and r2["progress"]["xp"] == 80


def test_wrong_answers_no_xp_and_first_attempt_is_final():
    h = login("wrong@x.io")
    r = client.post("/api/m1/quiz/submit", headers=h, json={"answers": wrong()}).json()
    assert r["score"] == 0 and r["awarded"] == 0
    r = client.post("/api/m1/quiz/submit", headers=h, json={"answers": KEY}).json()
    assert r["awarded"] == 0 and r["progress"]["xp"] == 0 and r["progress"]["best_score"] == 8


def test_total_capped_at_100_and_completion():
    h = login("total@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    r = client.post("/api/m1/quiz/submit", headers=h, json={"answers": KEY}).json()
    assert r["progress"]["xp"] == 100 and r["progress"]["completed"]  # lesson + quiz complete the mission


def test_client_cannot_inject_score_or_bad_input():
    h = login("inject@x.io")
    r = client.post("/api/m1/quiz/submit", headers=h, json={"answers": wrong(), "score": 8, "xp": 999})
    assert r.json()["score"] == 0 and r.json()["awarded"] == 0
    assert client.post("/api/m1/quiz/submit", headers=h, json={"answers": [0] * 7}).status_code == 422
    assert client.post("/api/m1/quiz/submit", headers=h, json={"answers": [9] * 8}).status_code == 422


def test_concurrent_replay_single_award():
    h = login("race@x.io")
    out = []
    def go():
        c = TestClient(main.app)
        out.append(c.post("/api/m1/quiz/submit", headers=h, json={"answers": KEY}).json()["awarded"])
        out.append(c.post("/api/m1/lesson/complete", headers=h).json()["awarded"])
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert sum(out) == 100


def test_free_and_paid_identical_access():
    for e in ("free@x.io", "paid@x.io"):
        assert client.get("/api/m1/mission", headers=login(e)).status_code == 200


# ---- sessions: Docker is faked so ownership/lifecycle logic is tested without a daemon ----
@pytest.fixture
def fake_docker(monkeypatch):
    live = set()
    monkeypatch.setattr(docker_lab, "start", lambda sid, eh, m="INT-01", code="", env=None, host="": (live.add(sid), (f"c-{sid}", f"n-{sid}", 49999))[1])
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live


def test_session_lifecycle_and_ownership(fake_docker):
    a, b = login("sa@x.io"), login("sb@x.io")
    s = client.post("/api/m1/session/start", headers=a).json()
    assert s["status"] == "active" and s["url"].startswith("http://intro-01-") and s["url"].endswith(".ctf.localhost:8088/")
    assert client.post("/api/m1/session/start", headers=a).json()["session_id"] == s["session_id"]  # one per user
    assert client.get(f"/api/m1/session/{s['session_id']}", headers=b).status_code == 404
    assert client.post("/api/m1/session/stop", headers=b, json={"session_id": s["session_id"]}).status_code == 404
    assert s["session_id"] in fake_docker
    assert client.post("/api/m1/session/stop", headers=a, json={"session_id": s["session_id"]}).json()["status"] == "stopped"
    assert s["session_id"] not in fake_docker
    assert client.post("/api/m1/session/stop", headers=a, json={"session_id": "zz"}).status_code == 422


def test_docker_down_keeps_lesson_and_quiz(monkeypatch):
    def boom(*a): raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    h = login("down@x.io")
    assert client.post("/api/m1/session/start", headers=h).status_code == 503
    assert client.post("/api/m1/lesson/complete", headers=h).json()["awarded"] == 20


def test_progress_survives_session_cleanup(fake_docker):
    h = login("keep@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    s = client.post("/api/m1/session/start", headers=h).json()
    client.post("/api/m1/session/stop", headers=h, json={"session_id": s["session_id"]})
    main.reap()
    assert client.get("/api/m1/progress", headers=h).json()["xp"] == 20


@pytest.mark.docker
def test_real_container_hardening():
    import docker, urllib.request
    sid = "abcdef012345"
    try:
        h = labutil.host(sid)
        name, net, _ = docker_lab.start(sid, "t", "INT-01", "abc123def456", host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        c = docker.from_env().containers.get(name)
        hc = c.attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and hc["Memory"] == 64 * 1024 * 1024
        assert hc["CapDrop"] == ["ALL"] and hc["PidsLimit"] == 64
        assert c.attrs["Config"]["User"] == "101:101"
        assert not any("docker.sock" in (m.get("Source") or "") for m in c.attrs["Mounts"])
        assert not hc["PortBindings"]  # no published ports: reachable only through the proxy
        assert b"Briefing Console" in labutil.get(h, f"/").read()
        assert labutil.get(h, f"/lab/code.txt").read().strip() == b"abc123def456"
    finally:
        docker_lab.stop(sid)
    assert not docker_lab.is_running(sid)
