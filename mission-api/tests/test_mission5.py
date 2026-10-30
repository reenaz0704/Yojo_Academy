import os, re, tempfile, threading, urllib.request
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t5.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
os.environ["MISSION_ADMIN_TOKEN"] = "admin-test-token"
os.environ.pop("MISSION5_EXPECTED_DATE", None)
import datetime as dt
import pytest
from fastapi.testclient import TestClient
import labutil, main, docker_lab, db, domaindate

client = TestClient(main.app)
P = "/api/m5"
RIGHT = "2028-12-18"  # verified against Verisign + GoDaddy RDAP on 2026-10-21


def login(email):
    t = client.post(f"{P}/auth", json={"email": email}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def fake_docker(monkeypatch):
    live, seen = set(), []

    def start(sid, eh, m="INT-01", code="", env=None, host=""):
        live.add(sid)
        seen.append(m)
        return (f"c-{sid}", f"n-{sid}", 49995)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live, seen


@pytest.fixture(autouse=True)
def reset_config():
    with db.tx() as c:
        c.execute("DELETE FROM m_config")
    yield


def start(h):
    return client.post(f"{P}/session/start", headers=h).json()


def submit(h, sid, ans):
    return client.post(f"{P}/submit", headers=h, json={"session_id": sid, "answer": ans})


# ---- date parsing ----
@pytest.mark.parametrize("text", ["2028-12-18", " 2028-12-18 ", "18-12-2028", "18/12/2028", "18.12.2028", "12/18/2028", "2028-12-18T15:20:03Z", "2028-12-18 10:20:03",
                                  "18 December 2028", "December 18, 2028", "Dec 18 2028", "18th Dec 2028"])
def test_accepted_formats(text):
    assert domaindate.parse(text) == dt.date(2028, 12, 18)


@pytest.mark.parametrize("text", ["", "   ", "2028", "2028-12", "12-2028", "approx 2028", "05-06-2028", "31-02-2028", "2028-13-01", "Smarch 4 2028", "x" * 50, "18-12-28"])
def test_rejected_formats(text):
    with pytest.raises(domaindate.BadDate):
        domaindate.parse(text)


# ---- answer checking and XP ----
def test_start_uses_mission5_image(fake_docker):
    live, seen = fake_docker
    s = start(login("a5@x.io"))
    assert seen == ["DOM-01"] and s["status"] == "active" and "DOM-01" in docker_lab.IMAGES


def test_correct_date_in_any_valid_format_pays_50_once(fake_docker):
    h = login("ok5@x.io")
    sid = start(h)["session_id"]
    r = submit(h, sid, "18-12-2028").json()
    assert r["accepted"] and r["awarded"] == 50 and r["progress"]["completed"] and r["progress"]["xp"] == 50
    for again in (RIGHT, "December 18, 2028"):
        r2 = submit(h, sid, again).json()
        assert r2["accepted"] and r2["awarded"] == 0 and r2["already_completed"] and r2["progress"]["xp"] == 50
    assert client.get(f"{P}/progress", headers=login("ok5@x.io")).json()["completed"] is True  # new login still sees it


@pytest.mark.parametrize("ans", ["2025-12-18", "2028-12-17", "2029-12-18", "2028-11-18", "2026-01-09"])
def test_wrong_dates_get_nothing_and_do_not_leak(fake_docker, ans):
    h = login(f"bad5{ans}@x.io")
    sid = start(h)["session_id"]
    res = submit(h, sid, ans)
    r = res.json()
    assert r["accepted"] is False and r["awarded"] == 0 and not r["progress"]["completed"] and r["progress"]["xp"] == 0
    assert "2028" not in res.text and "12-18" not in res.text


def test_ambiguous_partial_and_garbage_are_422_without_attempt_credit(fake_docker):
    h = login("fmt5@x.io")
    sid = start(h)["session_id"]
    for a in ("05-06-2028", "2028", "soon", "x" * 50):
        assert submit(h, sid, a).status_code == 422
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 0


def test_concurrent_submissions_award_once(fake_docker):
    h = login("race5@x.io")
    sid = start(h)["session_id"]
    out = []

    def go():
        out.append(submit(h, sid, RIGHT).json()["awarded"])
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(out) == 50


def test_expected_date_never_in_any_api_response(fake_docker):
    h = login("leak5@x.io")
    s = start(h)
    bodies = [str(s), client.get(f"{P}/mission", headers=h).text, client.get(f"{P}/progress", headers=h).text,
              client.get(f"{P}/session/current", headers=h).text, submit(h, s["session_id"], "2020-01-01").text]
    assert all("2028" not in b and "12-18" not in b for b in bodies)


# ---- authorization and sessions ----
def test_auth_ownership_and_cross_mission(fake_docker):
    a, b = login("oa5@x.io"), login("ob5@x.io")
    sid = start(a)["session_id"]
    assert client.post(f"{P}/submit", json={"session_id": sid, "answer": RIGHT}).status_code == 401
    assert submit(b, sid, RIGHT).status_code == 404
    assert client.get(f"{P}/session/{sid}", headers=b).status_code == 404
    m4 = client.post("/api/m4/session/start", headers=a).json()["session_id"]
    assert submit(a, m4, RIGHT).status_code == 404
    assert client.get(f"{P}/progress", headers=b).json()["xp"] == 0


def test_expired_stopped_and_docker_down(fake_docker, monkeypatch):
    h = login("exp5@x.io")
    s = start(h)
    with db.tx() as c:
        c.execute("UPDATE m_sessions SET expires=? WHERE id=?", ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)).isoformat(timespec="seconds"), s["session_id"]))
    assert submit(h, s["session_id"], RIGHT).status_code == 410
    s2 = start(h)
    client.post(f"{P}/session/stop", headers=h, json={"session_id": s2["session_id"]})
    assert submit(h, s2["session_id"], RIGHT).status_code == 409

    def boom(*a, **k):
        raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    assert client.post(f"{P}/session/start", headers=login("down5@x.io")).status_code == 503


def test_free_paid_and_other_missions_untouched(fake_docker):
    h = login("keep5@x.io")
    client.post("/api/m1/lesson/complete", headers=h)
    sid = start(h)["session_id"]
    submit(h, sid, RIGHT)
    assert client.get("/api/m1/progress", headers=h).json()["xp"] == 20
    for e in ("free5@x.io", "paid5@x.io"):
        assert client.get(f"{P}/mission", headers=login(e)).status_code == 200
    for n in (1, 2, 3, 4):
        assert client.get(f"/api/m{n}/mission", headers=h).status_code == 200


# ---- configuration of the verified answer ----
def test_unconfigured_answer_is_a_clear_error_not_a_guess(fake_docker, monkeypatch):
    monkeypatch.setenv("MISSION5_EXPECTED_DATE", "")
    h = login("cfg5@x.io")
    sid = start(h)["session_id"]
    r = submit(h, sid, RIGHT)
    assert r.status_code == 503 and "not been configured" in r.json()["detail"]
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 0


def test_env_and_admin_override_precedence(fake_docker, monkeypatch):
    monkeypatch.setenv("MISSION5_EXPECTED_DATE", "2031-05-06")
    assert domaindate.expected() == dt.date(2031, 5, 6) and domaindate.source() == "env"
    adm = {"X-Admin-Token": "admin-test-token"}
    r = client.post(f"{P}/admin/expected-date", headers=adm, json={"date": "2029-01-02"})
    assert r.status_code == 200 and "2029" not in r.text
    assert domaindate.expected() == dt.date(2029, 1, 2) and domaindate.source() == "admin"
    st = client.get(f"{P}/admin/expected-date", headers=adm)
    assert st.json() == {"configured": True, "source": "admin"} and "2029" not in st.text
    h = login("ovr5@x.io")
    sid = start(h)["session_id"]
    assert submit(h, sid, "2029-01-02").json()["accepted"] and not submit(login("ovr5b@x.io"), start(login("ovr5b@x.io"))["session_id"], RIGHT).json()["accepted"]


def test_admin_route_requires_token_and_valid_date(monkeypatch):
    assert client.post(f"{P}/admin/expected-date", json={"date": RIGHT}).status_code == 404
    assert client.post(f"{P}/admin/expected-date", headers={"X-Admin-Token": "wrong"}, json={"date": RIGHT}).status_code == 404
    assert client.post(f"{P}/admin/expected-date", headers={"X-Admin-Token": "admin-test-token"}, json={"date": "2030-05"}).status_code == 422
    # a normal student token is not an admin token
    assert client.post(f"{P}/admin/expected-date", headers=login("stu5@x.io"), json={"date": RIGHT}).status_code == 404
    monkeypatch.delenv("MISSION_ADMIN_TOKEN")
    assert client.post(f"{P}/admin/expected-date", headers={"X-Admin-Token": ""}, json={"date": RIGHT}).status_code == 404  # disabled when unset


def test_default_matches_the_verified_record():
    assert domaindate.DEFAULT == "2028-12-18" and domaindate.expected() == dt.date(2028, 12, 18)


@pytest.mark.docker
def test_real_lab_page_content_and_hardening():
    import docker
    sid = "abcdef012366"
    try:
        h = labutil.host(sid)
        name, net, _ = docker_lab.start(sid, "t", "DOM-01", "", host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        c = docker.from_env().containers.get(name)
        hc = c.attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and hc["CapDrop"] == ["ALL"] and c.attrs["Config"]["User"] == "101:101"
        html = labutil.get(h, f"/").read().decode()
        assert "yojosolutions.com" in html and "https://www.yojosolutions.com/" in html
        assert "domainnamewire.com/2011/05/16/google-acquires-chromebook-com-and-chromebooks-com-domain-names/" in html
        assert "lookup.icann.org" in html and "rdap.org" in html and "whois" in html
        assert "2028" not in html and "12-18" not in html and "December 18" not in html  # the answer is not on the page
        assert "Registry Expiry Date" in html  # tells students what to look for
    finally:
        docker_lab.stop(sid)
    assert not docker_lab.is_running(sid)
