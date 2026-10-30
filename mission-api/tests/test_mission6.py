import json, os, tempfile, urllib.error, threading, urllib.request, datetime as dt
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t6.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
for k in ("MISSION6_TARGET_DOMAIN", "MISSION6_SUBDOMAINS", "MISSION6_AUTHORIZED_DOMAINS"):
    os.environ.pop(k, None)
import pytest
from fastapi.testclient import TestClient
import labutil, main, docker_lab, db, subdomains

client = TestClient(main.app)
P = "/api/m6"


def login(email):
    t = client.post(f"{P}/auth", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def fake_docker(monkeypatch):
    live, seen = set(), []

    def start(sid, eh, m="INT-01", code="", env=None, host=""):
        live.add(sid)
        seen.append((m, env))
        return (f"c-{sid}", f"n-{sid}", 49994)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live, seen


def start(h):
    return client.post(f"{P}/session/start", headers=h).json()


def submit(h, sid, ans):
    return client.post(f"{P}/submit", headers=h, json={"session_id": sid, "answer": ans})


# ---- controlled dataset ----
def test_dataset_is_ten_unique_and_domain_is_a_training_name():
    assert subdomains.expected_count() == 10 and len(set(subdomains.labels())) == 10
    assert subdomains.domain().endswith(".test")


def test_expected_count_follows_the_dataset_and_duplicates_are_ignored(monkeypatch):
    monkeypatch.setenv("MISSION6_SUBDOMAINS", "a,b,b,C,c, ,bad_label,x.y")
    assert subdomains.labels() == ["a", "b", "c"] and subdomains.expected_count() == 3


def test_unauthorized_domain_is_refused(monkeypatch):
    monkeypatch.setenv("MISSION6_TARGET_DOMAIN", "example.com")
    assert subdomains.domain() == subdomains.DEFAULT_DOMAIN
    monkeypatch.setenv("MISSION6_AUTHORIZED_DOMAINS", "example.com")
    assert subdomains.domain() == "example.com"


def test_start_launches_mission6_lab_with_target_and_dataset(fake_docker):
    live, seen = fake_docker
    s = start(login("a6@x.io"))
    assert s["status"] == "active" and seen[0][0] == "SUB-01" and "SUB-01" in docker_lab.IMAGES
    env = seen[0][1]
    assert env["TARGET_DOMAIN"] == "yojocorp.test" and len(env["SUBDOMAINS"].split(",")) == 10


def test_mission_shows_target_but_not_the_count(fake_docker):
    h = login("view6@x.io")
    r = client.get(f"{P}/mission", headers=h)
    body = r.json()
    assert body["target_domain"] == "yojocorp.test" and body["simulated"] is True
    t = r.text + str(start(h)) + client.get(f"{P}/progress", headers=h).text
    assert "expected" not in t.lower() and "staging" not in t  # no dataset leaks through the API


# ---- validation and XP ----
def test_ten_pays_50_once_with_whitespace(fake_docker):
    h = login("ok6@x.io")
    sid = start(h)["session_id"]
    r = submit(h, sid, "  10 \n").json()
    assert r["accepted"] and r["awarded"] == 50 and r["progress"]["completed"] and r["progress"]["xp"] == 50
    r2 = submit(h, sid, "10").json()
    assert r2["accepted"] and r2["awarded"] == 0 and r2["already_completed"] and r2["progress"]["xp"] == 50
    assert client.get(f"{P}/progress", headers=login("ok6@x.io")).json()["completed"]  # persists for a new login


@pytest.mark.parametrize("ans", ["0", "1", "9", "11", "100", "9999"])
def test_wrong_numbers_get_nothing_and_do_not_leak(fake_docker, ans):
    h = login(f"bad6{ans}@x.io")
    res = submit(h, start(h)["session_id"], ans)
    r = res.json()
    assert r["accepted"] is False and r["awarded"] == 0 and not r["progress"]["completed"] and r["progress"]["xp"] == 0
    assert "10" not in r["message"]


@pytest.mark.parametrize("ans", ["", "   ", "-10", "10.0", "10.5", "ten", "1e1", "0x0A", "+10", "10 subdomains", "١٠", "12345"])
def test_malformed_answers_rejected(fake_docker, ans):
    h = login("mal6@x.io")
    sid = start(h)["session_id"]
    assert submit(h, sid, ans).status_code == 422
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 0


def test_opening_the_lab_or_clicking_submit_alone_pays_nothing(fake_docker):
    h = login("open6@x.io")
    start(h)
    assert client.get(f"{P}/progress", headers=h).json() == {"completed": False, "completed_at": None, "xp": 0, "max_xp": 50, "attempts": 0}


def test_concurrent_submissions_award_once(fake_docker):
    h = login("race6@x.io")
    sid = start(h)["session_id"]
    out = []

    def go():
        out.append(submit(h, sid, "10").json()["awarded"])
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(out) == 50


# ---- sessions / access ----
def test_isolation_auth_and_cross_mission(fake_docker):
    a, b = login("oa6@x.io"), login("ob6@x.io")
    sid = start(a)["session_id"]
    assert client.post(f"{P}/submit", json={"session_id": sid, "answer": "10"}).status_code == 401
    assert submit(b, sid, "10").status_code == 404
    assert client.get(f"{P}/session/{sid}", headers=b).status_code == 404
    assert client.post(f"{P}/session/stop", headers=b, json={"session_id": sid}).status_code == 404
    other = client.post("/api/m5/session/start", headers=a).json()["session_id"]
    assert submit(a, other, "10").status_code == 404
    assert client.get(f"{P}/progress", headers=b).json()["xp"] == 0


def test_expired_stopped_and_docker_down(fake_docker, monkeypatch):
    h = login("exp6@x.io")
    s = start(h)
    with db.tx() as c:
        c.execute("UPDATE m_sessions SET expires=? WHERE id=?", ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)).isoformat(timespec="seconds"), s["session_id"]))
    assert submit(h, s["session_id"], "10").status_code == 410
    s2 = start(h)
    client.post(f"{P}/session/stop", headers=h, json={"session_id": s2["session_id"]})
    assert submit(h, s2["session_id"], "10").status_code == 409

    def boom(*a, **k):
        raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    h2 = login("down6@x.io")
    assert client.post(f"{P}/session/start", headers=h2).status_code == 503
    assert client.get(f"{P}/progress", headers=h2).json()["completed"] is False


def test_lab_start_failure_is_graceful(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("container did not become healthy")
    monkeypatch.setattr(docker_lab, "start", fail)
    r = client.post(f"{P}/session/start", headers=login("fail6@x.io"))
    assert r.status_code == 502 and "healthy" not in r.text


def test_free_paid_and_earlier_missions_untouched(fake_docker):
    h = login("keep6@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    submit(h, start(h)["session_id"], "10")
    assert client.get("/api/m1/progress", headers=h).json()["xp"] == 20
    for e in ("free6@x.io", "paid6@x.io"):
        assert client.get(f"{P}/mission", headers=login(e)).status_code == 200
    for n in (1, 2, 3, 4, 5):
        assert client.get(f"/api/m{n}/mission", headers=h).status_code == 200
    assert db.MAX_XP["SUB-01"] == 50


def test_academy_url_is_validated(monkeypatch):
    assert subdomains.academy_url() == "http://localhost:8000/academy.html#/academy/mission/subdomains"
    monkeypatch.setenv("ACADEMY_BASE", "http://x.test/a b\"><script>")
    assert subdomains.academy_url() == "http://localhost:8000/academy.html#/academy/mission/subdomains"
    assert subdomains.lab_env()["ACADEMY_URL"].endswith("#/academy/mission/subdomains")


@pytest.mark.docker
def test_real_lab_site_submit_button_feed_and_helper():
    import docker, subprocess
    sid = "abcdef012344"
    env = subdomains.lab_env()
    try:
        h = labutil.host(sid)
        name, net, _ = docker_lab.start(sid, "t", "SUB-01", "", env, host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        c = docker.from_env().containers.get(name)
        hc = c.attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and hc["CapDrop"] == ["ALL"] and c.attrs["Config"]["User"] == "101:101"
        assert not any("docker.sock" in (m.get("Source") or "") for m in c.attrs["Mounts"])
        assert not hc["PortBindings"]
        get = lambda p: labutil.get(h, p)
        home = get("/").read().decode()
        assert "Yojo Corp" in home and "<nav" in home and "<footer" in home
        assert f'<a class="submit" href="{env["ACADEMY_URL"]}">Submit Solution</a>' in home  # button beside the brand, leads to the Academy page
        assert home.index('class="brand"') < home.index('class="submit"') < home.index("<nav")
        for p in ("/services.html", "/about.html", "/careers.html", "/contact.html"):
            assert "Submit Solution" in get(p).read().decode()
        assert "__ACADEMY_URL__" not in home and "__FLAG__" not in home and "terminal" not in home.lower()
        # the controlled feed: exactly 10 unique subdomains, only for the target
        feed = get(f"/feed/{env['TARGET_DOMAIN']}.txt").read().decode().split()
        assert len(feed) == 10 and len(set(feed)) == 10 and all(x.endswith("." + env["TARGET_DOMAIN"]) for x in feed)
        with pytest.raises(urllib.error.HTTPError):
            get("/feed/example.com.txt")
        # run the helper exactly as a student would, in their own shell
        public = f"{h}:{docker_lab.proxy_port()}"  # what a browser sends as Host
        script = labutil.get(public, "/tools/subfinder.sh").read().decode()
        assert f'LAB="http://{public}"' in script and "__LAB__" not in script
        run = lambda *a: subprocess.run(["sh", "-c", script, "subfinder-lab", *a], capture_output=True, text=True, timeout=20)
        assert run("-d", "x;id", "-silent").returncode == 2
        import socket
        try:
            socket.gethostbyname(h)
            resolvable = True
        except OSError:
            resolvable = False  # this machine does not resolve *.localhost names: skip running the helper end to end
        if resolvable:
            r = run("-d", env["TARGET_DOMAIN"], "-silent")
            assert r.returncode == 0 and len(r.stdout.split()) == 10 and "[SIM]" in r.stderr
            assert run("-d", "example.com", "-silent").returncode == 3
        assert get("/").headers.get("X-Content-Type-Options") == "nosniff"
    finally:
        docker_lab.stop(sid)
    assert not docker_lab.is_running(sid)
