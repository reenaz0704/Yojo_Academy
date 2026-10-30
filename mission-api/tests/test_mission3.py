import os, re, tempfile, threading, datetime as dt
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t3.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
os.environ["MISSION3_XP"] = "50"
import pytest
from fastapi.testclient import TestClient
import labutil, main, docker_lab, db, fingerprint, quiz

client = TestClient(main.app)
P = "/api/m3"
GOOD = "Apache, Express, Node.js"


def login(email):
    t = client.post(f"{P}/auth", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def fake_docker(monkeypatch):
    live, seen = set(), []

    def start(sid, eh, m="INT-01", code="", env=None, host=""):
        live.add(sid)
        seen.append((m, env))
        return (f"c-{sid}", f"n-{sid}", 49997)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live, seen


def start(h):
    return client.post(f"{P}/session/start", headers=h).json()


def submit(h, sid, ans):
    return client.post(f"{P}/submit", headers=h, json={"session_id": sid, "answer": ans})


# ---- workflow ----
def test_start_creates_session_with_target_url_and_return_link(fake_docker):
    live, seen = fake_docker
    h = login("w1@x.io")
    s = start(h)
    assert s["status"] == "active" and re.fullmatch(r"http://web-01-[0-9a-f]{4}\.ctf\.localhost:8088/", s["url"]) and s["session_id"] in live
    assert seen[0][0] == "WEB-01"
    # returning to the Academy: the same session is still there and can be used without a restart
    cur = client.get(f"{P}/session/current", headers=h).json()
    assert cur["session_id"] == s["session_id"] and cur["status"] == "active"
    assert start(h)["session_id"] == s["session_id"]
    assert submit(h, s["session_id"], GOOD).json()["accepted"]


def test_mission_details_never_include_expected_answer():
    body = client.get(f"{P}/mission", headers=login("d@x.io")).text.lower()
    for word in ("node", "apache", "express", "expected", "answer"):
        assert word not in body


# ---- validation ----
@pytest.mark.parametrize("ans", ["Apache, Express, Node.js", "apache,express,node.js", "  NODE.JS ,  express ,   apache  ", "nodejs; expressjs; Apache HTTP Server", "Apache\nExpress\nNode.js"])
def test_accepts_formatting_variations(fake_docker, ans):
    h = login(f"fmt{abs(hash(ans))}@x.io")
    assert submit(h, start(h)["session_id"], ans).json()["accepted"] is True


@pytest.mark.parametrize("ans", ["Apache, Express, Node", "Apache HTTP Server, Express, Node.js", "apache httpd, express.js, node js"])
def test_requested_aliases(fake_docker, ans):
    h = login(f"al{abs(hash(ans))}@x.io")
    assert submit(h, start(h)["session_id"], ans).json()["accepted"] is True


def test_extra_technologies_allowed_under_required_policy(fake_docker):
    h = login("extra@x.io")
    assert submit(h, start(h)["session_id"], "Apache, Express, Node.js, HTML").json()["accepted"]


@pytest.mark.parametrize("ans,msg", [("Apache, Express", "Some required"), ("Node.js", "Some required"), ("HTML, Apache", "Some required"), ("PHP, WordPress, jQuery", "No required")])
def test_incomplete_or_unrelated_rejected_without_naming_missing(fake_docker, ans, msg):
    h = login(f"bad{abs(hash(ans))}@x.io")
    r = submit(h, start(h)["session_id"], ans).json()
    assert r["accepted"] is False and msg in r["message"] and r["awarded"] == 0
    assert "apache" not in r["message"].lower() and "node" not in r["message"].lower()


@pytest.mark.parametrize("ans", ["", "   ", ",,,", "x" * 600, ", ".join(f"t{i}" for i in range(25)), "a" * 41])
def test_malformed_or_oversized_rejected(fake_docker, ans):
    h = login("mal@x.io")
    assert submit(h, start(h)["session_id"], ans).status_code in (422,)


def test_exact_policy(fake_docker, monkeypatch):
    monkeypatch.setattr(fingerprint, "POLICY", "exact")
    h = login("exact@x.io")
    assert submit(h, start(h)["session_id"], "Apache, Express, Node.js, PHP").json()["accepted"] is False


def test_expected_set_is_server_config(monkeypatch):
    monkeypatch.setenv("MISSION3_EXPECTED", "php,mysql")
    assert fingerprint.check("PHP, MySQL")[0] and not fingerprint.check("Apache, Express, Node.js")[0]


# ---- XP ----
def test_reward_once_and_other_missions_untouched(fake_docker):
    h = login("xp@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    sid = start(h)["session_id"]
    wrong = submit(h, sid, "PHP").json()
    assert wrong["awarded"] == 0 and not wrong["progress"]["completed"]
    r = submit(h, sid, GOOD).json()
    assert r["awarded"] == 50 and r["progress"]["completed"] and r["progress"]["xp"] == 50
    r2 = submit(h, sid, GOOD).json()
    assert r2["accepted"] and r2["awarded"] == 0 and r2["already_completed"] and r2["progress"]["xp"] == 50
    assert client.get("/api/m1/progress", headers=h).json()["xp"] == 20


def test_concurrent_submissions_award_once(fake_docker):
    h = login("race3@x.io")
    sid = start(h)["session_id"]
    out = []

    def go():
        out.append(submit(h, sid, GOOD).json()["awarded"])
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(out) == 50


def test_configured_reward_is_capped_at_config():
    assert db.MAX_XP["WEB-01"] == 50


# ---- session security ----
def test_auth_and_ownership(fake_docker):
    a, b = login("oa@x.io"), login("ob@x.io")
    sid = start(a)["session_id"]
    assert client.post(f"{P}/session/start").status_code == 401
    assert client.post(f"{P}/submit", json={"session_id": sid, "answer": GOOD}).status_code == 401
    assert submit(b, sid, GOOD).status_code == 404
    assert client.get(f"{P}/session/{sid}", headers=b).status_code == 404
    assert client.post(f"{P}/session/stop", headers=b, json={"session_id": sid}).status_code == 404
    assert client.get(f"{P}/progress", headers=b).json()["xp"] == 0


def test_other_mission_sessions_cannot_submit(fake_docker):
    h = login("cross@x.io")
    s2 = client.post("/api/m2/session/start", headers=h).json()["session_id"]
    assert submit(h, s2, GOOD).status_code == 404
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 0


def test_expired_and_stopped_sessions_rejected(fake_docker):
    h = login("exp@x.io")
    s = start(h)["session_id"]
    with db.tx() as c:
        c.execute("UPDATE m_sessions SET expires=? WHERE id=?", ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)).isoformat(timespec="seconds"), s))
    r = submit(h, s, GOOD)
    assert r.status_code == 410 and "progress" in r.json()["detail"]
    main.reap()
    assert submit(h, s, GOOD).status_code == 410  # now marked expired
    s2 = start(h)["session_id"]
    client.post(f"{P}/session/stop", headers=h, json={"session_id": s2})
    assert submit(h, s2, GOOD).status_code == 409


def test_docker_down_never_completes(monkeypatch):
    def boom(*a, **k):
        raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    h = login("down3@x.io")
    assert client.post(f"{P}/session/start", headers=h).status_code == 503
    assert client.get(f"{P}/progress", headers=h).json()["completed"] is False


def test_session_stop_cleans_up(fake_docker):
    live, _ = fake_docker
    h = login("stop3@x.io")
    sid = start(h)["session_id"]
    assert client.post(f"{P}/session/stop", headers=h, json={"session_id": sid}).json()["status"] == "stopped"
    assert sid not in live


def test_free_and_paid_same_access():
    for e in ("free3@x.io", "paid3@x.io"):
        assert client.get(f"{P}/mission", headers=login(e)).status_code == 200


def test_missions_1_and_2_still_served():
    h = login("reg@x.io")
    assert len(client.get("/api/m1/mission", headers=h).json()["questions"]) == 8
    assert len(client.get("/api/m2/mission", headers=h).json()["questions"]) == 6


@pytest.mark.docker
def test_real_target_fingerprint_and_hardening():
    import docker, urllib.request
    sid = "abcdef012377"
    try:
        h = labutil.host(sid)
        name, net, _ = docker_lab.start(sid, "t", "WEB-01", "", None, host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        c = docker.from_env().containers.get(name)
        hc = c.attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and hc["CapDrop"] == ["ALL"] and c.attrs["Config"]["User"] == "101:101"
        assert not any("docker.sock" in (m.get("Source") or "") for m in c.attrs["Mounts"])
        r = labutil.get(h, f"/")
        assert r.headers["Server"].startswith("Apache") and r.headers["X-Powered-By"] == "Express"
        body = r.read().decode()
        assert "Yojo Coffee" in body
        assert "<!doctype html>" in body.lower() and "<nav" in body and "<header" in body and "<footer" in body
        low = body.lower()
        for word in ("lab", "training", "mission", "academy", "wappalyzer", "flag", "hint", "ctf", "challenge"):
            assert word not in low.replace("label", "").replace("available", ""), word
        for page in ("coffee.html", "about.html", "visit.html", "css/site.css", "js/site.js", "img/logo.svg"):
            assert labutil.get(h, f"/{page}").status == 200
        # the Wappalyzer rules for Express, Apache and Node.js, applied to the real response headers
        import re
        assert re.search(r"^Express(?:$|,)", r.headers["X-Powered-By"])
        assert re.search(r"(?:Apache(?:$|/([\d.]+)|[^/-])|(?:^|\b)HTTPD)", r.headers["Server"])
    finally:
        docker_lab.stop(sid)
    assert not docker_lab.is_running(sid)
