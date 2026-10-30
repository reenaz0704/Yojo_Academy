import os, re, tempfile, threading, urllib.request
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t4.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
import pytest
from fastapi.testclient import TestClient
import labutil, main, docker_lab, db

client = TestClient(main.app)
P = "/api/m4"
FLAG_RE = re.compile(r"^YOJO_information_disclose_\d{6}$")
FLAGS = {}


def login(email):
    t = client.post(f"{P}/auth", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def fake_docker(monkeypatch):
    live, seen = set(), []

    def start(sid, eh, m="INT-01", code="", env=None, host=""):
        live.add(sid)
        seen.append(m)
        FLAGS[sid] = code
        return (f"c-{sid}", f"n-{sid}", 49996)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live, seen


def start(h, path=P):
    return client.post(f"{path}/session/start", headers=h).json()


def submit(h, sid, flag):
    return client.post(f"{P}/submit", headers=h, json={"session_id": sid, "answer": flag})


def test_start_provisions_unique_flag_per_session(fake_docker):
    live, seen = fake_docker
    a, b = login("a4@x.io"), login("b4@x.io")
    sa, sb = start(a), start(b)
    assert seen == ["INFO-01", "INFO-01"] and sa["status"] == "active" and sa["url"].startswith("http://info-01-")
    assert FLAG_RE.match(FLAGS[sa["session_id"]]) and FLAG_RE.match(FLAGS[sb["session_id"]])
    assert FLAGS[sa["session_id"]] != FLAGS[sb["session_id"]]
    assert FLAGS[sa["session_id"]] != "YOJO_information_disclose_483921"


def test_flag_never_in_api_responses_or_db(fake_docker):
    h = login("leak4@x.io")
    s = start(h)
    flag = FLAGS[s["session_id"]]
    bodies = [str(s), client.get(f"{P}/mission", headers=h).text, client.get(f"{P}/progress", headers=h).text,
              client.get(f"{P}/session/current", headers=h).text, client.get(f"{P}/session/{s['session_id']}", headers=h).text,
              submit(h, s["session_id"], "YOJO_information_disclose_000000").text]
    assert all(flag not in b and flag.split("_")[-1] not in b for b in bodies)
    with db.tx() as c:
        rows = str([tuple(r) for r in c.execute("SELECT * FROM m_sessions WHERE id=?", (s["session_id"],))])
    assert flag not in rows  # only the hash is stored


def test_correct_flag_awards_50_once(fake_docker):
    h = login("ok4@x.io")
    s = start(h)
    sid, flag = s["session_id"], FLAGS[s["session_id"]]
    r = submit(h, sid, f"  {flag}\n").json()  # surrounding whitespace is harmless
    assert r["accepted"] and r["awarded"] == 50 and r["progress"]["completed"] and r["progress"]["xp"] == 50
    r2 = submit(h, sid, flag).json()
    assert r2["accepted"] and r2["awarded"] == 0 and r2["already_completed"] and r2["progress"]["xp"] == 50
    assert client.get(f"{P}/progress", headers=h).json()["completed"] is True  # persisted


@pytest.mark.parametrize("make", [lambda f: f.upper(), lambda f: f[:-1], lambda f: f + "0", lambda f: f.split("_")[-1], lambda f: "YOJO_information_disclose_483921", lambda f: "x"])
def test_wrong_or_partial_flags_get_nothing(fake_docker, make):
    h = login(f"bad4{id(make)}@x.io")
    s = start(h)
    r = submit(h, s["session_id"], make(FLAGS[s["session_id"]])).json()
    assert r["accepted"] is False and r["awarded"] == 0 and not r["progress"]["completed"] and r["progress"]["xp"] == 0


def test_bad_input_rejected(fake_docker):
    h = login("in4@x.io")
    sid = start(h)["session_id"]
    for a in ("", "   ", "x" * 101):
        assert submit(h, sid, a).status_code == 422


def test_concurrent_submissions_award_once(fake_docker):
    h = login("race4@x.io")
    s = start(h)
    out = []

    def go():
        out.append(submit(h, s["session_id"], FLAGS[s["session_id"]]).json()["awarded"])
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(out) == 50


def test_other_users_flag_and_session_are_useless(fake_docker):
    a, b = login("iso_a@x.io"), login("iso_b@x.io")
    sa, sb = start(a), start(b)
    # B submits A's flag in B's own session, and tries A's session id
    assert submit(b, sb["session_id"], FLAGS[sa["session_id"]]).json()["accepted"] is False
    assert submit(b, sa["session_id"], FLAGS[sa["session_id"]]).status_code == 404
    assert client.get(f"{P}/progress", headers=b).json()["xp"] == 0


def test_auth_required_and_cross_mission_sessions_rejected(fake_docker):
    h = login("auth4@x.io")
    s = start(h)
    assert client.post(f"{P}/session/start").status_code == 401
    assert client.post(f"{P}/submit", json={"session_id": s["session_id"], "answer": "x"}).status_code == 401
    m3 = start(h, "/api/m3")
    assert submit(h, m3["session_id"], FLAGS[s["session_id"]]).status_code == 404  # Mission 3 session cannot claim Mission 4


def test_expired_stopped_and_docker_down(fake_docker, monkeypatch):
    import datetime as dt
    h = login("exp4@x.io")
    s = start(h)
    with db.tx() as c:
        c.execute("UPDATE m_sessions SET expires=? WHERE id=?", ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)).isoformat(timespec="seconds"), s["session_id"]))
    assert submit(h, s["session_id"], FLAGS[s["session_id"]]).status_code == 410
    s2 = start(h)
    client.post(f"{P}/session/stop", headers=h, json={"session_id": s2["session_id"]})
    assert submit(h, s2["session_id"], FLAGS[s2["session_id"]]).status_code == 409

    def boom(*a, **k):
        raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    h2 = login("down4@x.io")
    assert client.post(f"{P}/session/start", headers=h2).status_code == 503
    assert client.get(f"{P}/progress", headers=h2).json()["completed"] is False


def test_xp_isolated_from_other_missions_and_free_paid(fake_docker):
    h = login("keep4@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    s = start(h)
    submit(h, s["session_id"], FLAGS[s["session_id"]])
    assert client.get("/api/m1/progress", headers=h).json()["xp"] == 20
    for e in ("free4@x.io", "paid4@x.io"):
        assert client.get(f"{P}/mission", headers=login(e)).status_code == 200
    assert db.MAX_XP["INFO-01"] == 50


def test_missions_1_to_3_still_served():
    h = login("reg4@x.io")
    assert client.get("/api/m1/mission", headers=h).status_code == 200
    assert client.get("/api/m2/mission", headers=h).status_code == 200
    assert client.get("/api/m3/mission", headers=h).status_code == 200


@pytest.mark.docker
def test_real_target_flag_in_source_only():
    import docker
    sid = "abcdef012355"
    flag = main.make_flag()
    assert FLAG_RE.match(flag)
    try:
        h = labutil.host(sid)
        name, net, _ = docker_lab.start(sid, "t", "INFO-01", flag, host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        c = docker.from_env().containers.get(name)
        hc = c.attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and hc["CapDrop"] == ["ALL"] and c.attrs["Config"]["User"] == "101:101"
        assert not any("docker.sock" in (m.get("Source") or "") for m in c.attrs["Mounts"])
        get = lambda p: labutil.get(h, f"{p}")
        html = get("/").read().decode()
        assert re.search(rf"<!--[^>]*{flag}[^>]*-->", html)  # discoverable via View Source, inside an HTML comment
        visible = re.sub(r"<!--.*?-->", "", html, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", visible)
        assert flag not in visible and "disclose" not in text.lower()  # not in rendered content or attributes
        for w in ("lab", "training", "mission", "academy", "hint", "ctf", "challenge", "flag"):
            assert w not in re.sub(r"label|available", "", text.lower()), w
        assert "<nav" in html and "<header" in html and "<footer" in html and "Yojo Corp" in html
        for p in ("/services.html", "/about.html", "/careers.html", "/contact.html", "/css/site.css", "/js/site.js", "/img/logo.svg"):
            assert get(p).status == 200
            if p.endswith(".html"):
                assert flag not in get(p).read().decode()
        assert flag not in str(dict(get("/").headers)) and flag not in c.logs().decode()
    finally:
        docker_lab.stop(sid)
    assert not docker_lab.is_running(sid)
