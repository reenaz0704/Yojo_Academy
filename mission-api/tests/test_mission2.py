import os, tempfile, threading
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t2.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
import pytest
from fastapi.testclient import TestClient
import labutil, main, quiz, docker_lab, db

client = TestClient(main.app)
KEY = [q["answer"] for q in quiz.REC01]
CODES = {}
P = "/api/m2"


def login(email):
    t = client.post(f"{P}/auth", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def wrong():
    return [(a + 1) % 4 for a in KEY]


def test_six_questions_four_options_one_answer():
    assert len(quiz.REC01) == 6
    assert all(len(q["options"]) == 4 and 0 <= q["answer"] < 4 and q["why"] for q in quiz.REC01)


def test_no_answer_key_before_grading_and_auth_required():
    body = client.get(f"{P}/mission", headers=login("a2@x.io")).text
    assert "answer" not in body and "why" not in body
    assert client.get(f"{P}/progress").status_code == 401


def test_lesson_20_once():
    h = login("l2@x.io")
    assert client.post(f"{P}/lesson/complete", headers=h).json()["awarded"] == 20
    assert client.post(f"{P}/lesson/complete", headers=h).json()["awarded"] == 0


def test_quiz_5_per_correct_30_max_total_50():
    h = login("q2@x.io")
    r = client.post(f"{P}/quiz/submit", headers=h, json={"answers": KEY}).json()
    assert r["score"] == 6 and r["awarded"] == 30
    assert client.post(f"{P}/quiz/submit", headers=h, json={"answers": KEY}).json()["awarded"] == 0
    p = client.post(f"{P}/lesson/complete", headers=h).json()["progress"]
    assert p["xp"] == 50 and p["max_xp"] == 50 and p["completed"]  # lesson + quiz complete the mission


def test_partial_and_wrong():
    h = login("p2@x.io")
    ans = list(KEY)
    ans[0] = (ans[0] + 1) % 4
    ans[1] = (ans[1] + 1) % 4
    r = client.post(f"{P}/quiz/submit", headers=h, json={"answers": ans}).json()
    assert r["score"] == 4 and r["awarded"] == 20
    h2 = login("w2@x.io")
    assert client.post(f"{P}/quiz/submit", headers=h2, json={"answers": wrong()}).json()["awarded"] == 0


def test_input_validation():
    h = login("v2@x.io")
    assert client.post(f"{P}/quiz/submit", headers=h, json={"answers": [0] * 8}).status_code == 422  # Mission 1's length
    assert client.post(f"{P}/quiz/submit", headers=h, json={"answers": [7] * 6}).status_code == 422
    r = client.post(f"{P}/quiz/submit", headers=h, json={"answers": wrong(), "score": 6, "xp": 500}).json()
    assert r["score"] == 0 and r["awarded"] == 0


def test_concurrent_replay_single_award():
    h = login("r2@x.io")
    out = []

    def go():
        c = TestClient(main.app)
        out.append(c.post(f"{P}/quiz/submit", headers=h, json={"answers": KEY}).json()["awarded"])
        out.append(c.post(f"{P}/lesson/complete", headers=h).json()["awarded"])
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(out) == 50


def test_missions_do_not_touch_each_other():
    h = login("both@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    client.post("/api/m1/quiz/submit", headers=h, json={"answers": [q["answer"] for q in quiz.INT01]})
    client.post(f"{P}/lesson/complete", headers=h)
    assert client.get("/api/m1/progress", headers=h).json()["xp"] == 100
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 20


def test_free_and_paid_same_access():
    for e in ("free2@x.io", "paid2@x.io"):
        assert client.get(f"{P}/mission", headers=login(e)).status_code == 200


@pytest.fixture
def fake_docker(monkeypatch):
    live, seen = set(), []

    def start(sid, eh, m="INT-01", code="", env=None, host=""):
        live.add(sid)
        seen.append(m)
        CODES[sid] = code
        return (f"c-{sid}", f"n-{sid}", 49998)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live, seen


def test_session_lifecycle_ownership_and_mission_isolation(fake_docker):
    live, seen = fake_docker
    a, b = login("sa2@x.io"), login("sb2@x.io")
    s = client.post(f"{P}/session/start", headers=a).json()
    assert s["status"] == "active" and seen == ["REC-01"]
    assert client.post(f"{P}/session/start", headers=a).json()["session_id"] == s["session_id"]
    assert client.get(f"{P}/session/{s['session_id']}", headers=b).status_code == 404
    assert client.post(f"{P}/session/stop", headers=b, json={"session_id": s["session_id"]}).status_code == 404
    # a Mission 1 route cannot see or stop a Mission 2 session either
    assert client.post("/api/m1/session/stop", headers=a, json={"session_id": s["session_id"]}).status_code == 404
    # the same user can run a Mission 1 lab alongside
    s1 = client.post("/api/m1/session/start", headers=a).json()
    assert s1["session_id"] != s["session_id"]
    assert client.post(f"{P}/session/stop", headers=a, json={"session_id": s["session_id"]}).json()["status"] == "stopped"
    assert s["session_id"] not in live and s1["session_id"] in live


def test_docker_down_keeps_progress(monkeypatch):
    def boom(*a, **k):
        raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    h = login("down2@x.io")
    assert client.post(f"{P}/session/start", headers=h).status_code == 503
    assert client.post(f"{P}/lesson/complete", headers=h).json()["awarded"] == 20
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 20


def test_no_client_controlled_target_or_command():
    # session start takes no body; stop takes only a strict 12-hex id; images are a fixed allow-list
    h = login("inj2@x.io")
    assert client.post(f"{P}/session/stop", headers=h, json={"session_id": "x; rm -rf /"}).status_code == 422
    assert set(docker_lab.IMAGES) == {"INT-01", "REC-01", "WEB-01", "INFO-01", "DOM-01", "SUB-01", "END-01", "DIR-01", "IMG-01"}


def test_migration_from_original_tables(tmp_path, monkeypatch):
    import sqlite3
    path = str(tmp_path / "old.db")
    c = sqlite3.connect(path)
    c.executescript("CREATE TABLE m1_progress(email TEXT PRIMARY KEY, lesson_done_at TEXT, best_score INTEGER DEFAULT 0, last_score INTEGER, completed_at TEXT);"
                    "INSERT INTO m1_progress VALUES('old@x.io','2026-01-01',5,5,NULL);"
                    "CREATE TABLE m1_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, score INTEGER NOT NULL, scored INTEGER NOT NULL, created TEXT);"
                    "INSERT INTO m1_attempts(email,score,scored) VALUES('old@x.io',5,1);"
                    "CREATE TABLE m1_sessions(id TEXT PRIMARY KEY, email TEXT NOT NULL, container TEXT, network TEXT, port INTEGER, status TEXT NOT NULL, created TEXT, started TEXT, stopped TEXT, expires TEXT, last_seen TEXT, error TEXT);")
    c.commit()
    c.close()
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init()
    db.init()  # idempotent
    with db.tx() as c2:
        assert c2.execute("SELECT best_score FROM m_progress WHERE email='old@x.io' AND mission='INT-01'").fetchone()[0] == 5
        assert c2.execute("SELECT COUNT(*) FROM m_attempts WHERE mission='INT-01'").fetchone()[0] == 1


@pytest.mark.docker
def test_real_recon_lab_container():
    import docker, urllib.request
    sid = "abcdef012399"
    try:
        h = labutil.host(sid)
        name, net, _ = docker_lab.start(sid, "t", "REC-01", "feedfacecafe", host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        hc = docker.from_env().containers.get(name).attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and hc["CapDrop"] == ["ALL"] and hc["Memory"] == 64 * 1024 * 1024
        r = labutil.get(h, f"/")
        assert r.headers["X-Lab-Target"] == "yojo-recon-lab"
        assert labutil.get(h, f"/lab/code.txt").read().strip() == b"feedfacecafe"
        assert b"IN SCOPE" in labutil.get(h, f"/scope.txt").read()
    finally:
        docker_lab.stop(sid)
    assert not docker_lab.is_running(sid)


def test_lab_no_longer_gates_completion():
    h = login("nolab@x.io")
    client.post(f"{P}/lesson/complete", headers=h)
    p = client.post(f"{P}/quiz/submit", headers=h, json={"answers": KEY}).json()["progress"]
    assert p["completed"] and p["xp"] == 50 and not p["lab_completed"]


def test_lab_code_is_per_mission_and_attempts_are_limited(fake_docker):
    h = login("lab_c@x.io")
    s2 = client.post(f"{P}/session/start", headers=h).json()
    # a Mission 2 code does not complete Mission 1's lab
    assert client.post("/api/m1/lab/verify", headers=h, json={"session_id": s2["session_id"], "code": CODES[s2["session_id"]]}).status_code == 404
    for _ in range(10):
        client.post(f"{P}/lab/verify", headers=h, json={"session_id": s2["session_id"], "code": "wrongwrong"})
    assert client.post(f"{P}/lab/verify", headers=h, json={"session_id": s2["session_id"], "code": CODES[s2["session_id"]]}).status_code == 429


def test_lab_progress_survives_stop_and_docker_down(fake_docker):
    h = login("lab_d@x.io")
    s = client.post(f"{P}/session/start", headers=h).json()
    client.post(f"{P}/lab/verify", headers=h, json={"session_id": s["session_id"], "code": CODES[s["session_id"]]})
    client.post(f"{P}/session/stop", headers=h, json={"session_id": s["session_id"]})
    main.reap()
    assert client.get(f"{P}/progress", headers=h).json()["lab_completed"] is True


def test_lab_hosts_are_unique_per_session_and_follow_the_plan(monkeypatch):
    import re
    monkeypatch.delenv("LAB_BASE_DOMAIN", raising=False)
    c = TestClient(main.app)
    seen = set()
    for i in range(6):
        t = c.post("/api/m4/auth", json={"email": f"host{i}@x.io"}).json()["token"]
        monkeypatch.setattr(docker_lab, "start", lambda sid, eh, m="x", code="", env=None, host="": (f"c-{sid}", f"n-{sid}", host))
        monkeypatch.setattr(docker_lab, "is_running", lambda sid: True)
        s = c.post("/api/m4/session/start", headers={"Authorization": f"Bearer {t}"}).json()
        assert re.fullmatch(r"info-01-[0-9a-f]{4}\.ctf\.localhost", s["host"]) and s["url"] == f"http://{s['host']}:8088/"
        seen.add(s["host"])
    assert len(seen) == 6  # never shared between students


def test_lab_url_and_domain_configuration(monkeypatch):
    for k in ("LAB_BASE_DOMAIN", "LAB_PROXY_PORT", "LAB_PUBLIC_PORT", "LAB_URL_SCHEME"):
        monkeypatch.delenv(k, raising=False)
    assert docker_lab.lab_url("info-01-a83f.ctf.localhost") == "http://info-01-a83f.ctf.localhost:8088/"
    monkeypatch.setenv("LAB_BASE_DOMAIN", "ctf.yojo.com")
    monkeypatch.setenv("LAB_URL_SCHEME", "https")
    monkeypatch.setenv("LAB_PUBLIC_PORT", "443")
    assert docker_lab.base_domain() == "ctf.yojo.com" and docker_lab.lab_url("info-01-a83f.ctf.yojo.com") == "https://info-01-a83f.ctf.yojo.com/"
    monkeypatch.setenv("LAB_BASE_DOMAIN", "bad domain; rm -rf")
    assert docker_lab.base_domain() == "ctf.localhost"


def test_proxy_bindings_are_opt_in_and_safe(monkeypatch):
    monkeypatch.delenv("LAB_BIND_HOST", raising=False)
    assert docker_lab._proxy_bindings() == [("127.0.0.1", 8088)]
    for bad in ("0.0.0.0", "::", "not-an-ip"):
        monkeypatch.setenv("LAB_BIND_HOST", bad)
        assert docker_lab._proxy_bindings() == [("127.0.0.1", 8088)]
    monkeypatch.setenv("LAB_BIND_HOST", "172.16.117.1")
    assert docker_lab._proxy_bindings() == [("127.0.0.1", 8088), ("172.16.117.1", 8088)]


def test_route_files_are_atomic_scoped_and_pruned(tmp_path, monkeypatch):
    monkeypatch.setenv("LAB_ROUTES_DIR", str(tmp_path))
    docker_lab._write_route("aaaaaaaaaaaa", "info-01-a83f.ctf.localhost", "yojo-m1-aaaaaaaaaaaa")
    body = (tmp_path / "aaaaaaaaaaaa.yml").read_text()
    assert "Host(`info-01-a83f.ctf.localhost`)" in body and "http://yojo-m1-aaaaaaaaaaaa:8080" in body
    assert not list(tmp_path.glob("*.tmp"))
    docker_lab._write_route("bbbbbbbbbbbb", "info-01-b921.ctf.localhost", "yojo-m1-bbbbbbbbbbbb")
    docker_lab.prune_routes({"aaaaaaaaaaaa"})
    assert [f.name for f in tmp_path.iterdir()] == ["aaaaaaaaaaaa.yml"]
    docker_lab._remove_route("aaaaaaaaaaaa")
    assert list(tmp_path.iterdir()) == []


def test_invalid_lab_host_is_refused_before_touching_docker():
    for bad in ("", "x", "a b.ctf.localhost", "a;b.ctf.localhost", "A.ctf.localhost`)||Host(`x"):
        with pytest.raises(ValueError):
            docker_lab.start("abcdef012345", "t", "INT-01", "", None, bad)


