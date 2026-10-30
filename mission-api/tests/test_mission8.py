import os, re, tempfile, threading, urllib.request, subprocess
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t8.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
import pytest
from fastapi.testclient import TestClient
import labutil, main, docker_lab, db

client = TestClient(main.app)
P = "/api/m8"
FLAG_RE = re.compile(r"^YOJO_directory_bruteforcing_\d{6}$")
FLAGS = {}


def login(e):
    return {"Authorization": "Bearer " + client.post(f"{P}/auth", json={"email": e}).json()["token"]}


@pytest.fixture
def fake_docker(monkeypatch):
    live = set()
    def start(sid, eh, m="x", code="", env=None, host=""):
        live.add(sid); FLAGS[sid] = code
        return (f"c-{sid}", f"n-{sid}", host)
    monkeypatch.setattr(docker_lab, "start", start)
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live


def start(h):
    return client.post(f"{P}/session/start", headers=h).json()


def submit(h, sid, f):
    return client.post(f"{P}/submit", headers=h, json={"session_id": sid, "answer": f})


def test_flag_format_and_host(fake_docker):
    s = start(login("a8@x.io"))
    assert s["host"].startswith("dir-01-") and FLAG_RE.match(FLAGS[s["session_id"]])


def test_correct_flag_awards_50_once_and_persists(fake_docker):
    h = login("ok8@x.io")
    s = start(h); sid, flag = s["session_id"], FLAGS[s["session_id"]]
    r = submit(h, sid, f"  {flag}\n").json()
    assert r["accepted"] and r["awarded"] == 50 and r["progress"]["xp"] == 50
    r2 = submit(h, sid, flag).json()
    assert r2["accepted"] and r2["awarded"] == 0 and r2["already_completed"]
    assert client.get(f"{P}/progress", headers=login("ok8@x.io")).json()["completed"]


@pytest.mark.parametrize("mut", [lambda f: f.upper(), lambda f: f[:-1], lambda f: f+"0", lambda f: f.split("_")[-1], lambda f: "YOJO_directory_bruteforcing_583921", lambda f: "nope"])
def test_wrong_or_partial_flags_nothing(fake_docker, mut):
    h = login(f"w8{id(mut)}@x.io")
    s = start(h)
    r = submit(h, s["session_id"], mut(FLAGS[s["session_id"]])).json()
    assert not r["accepted"] and r["awarded"] == 0 and r["progress"]["xp"] == 0


def test_bad_input_422(fake_docker):
    h = login("b8@x.io"); sid = start(h)["session_id"]
    for a in ("", "   ", "x"*101):
        assert submit(h, sid, a).status_code == 422


def test_concurrent_once(fake_docker):
    h = login("c8@x.io"); s = start(h); flag = FLAGS[s["session_id"]]
    out = []
    ts = [threading.Thread(target=lambda: out.append(submit(h, s["session_id"], flag).json()["awarded"])) for _ in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert sum(out) == 50


def test_isolation_and_no_leak(fake_docker):
    a, b = login("ia8@x.io"), login("ib8@x.io")
    sa, sb = start(a), start(b)
    assert submit(b, sb["session_id"], FLAGS[sa["session_id"]]).json()["accepted"] is False
    assert submit(b, sa["session_id"], FLAGS[sa["session_id"]]).status_code == 404
    assert client.post(f"{P}/submit", json={"session_id": sa["session_id"], "answer": "x"}).status_code == 401
    flag = FLAGS[sa["session_id"]]
    body = str(sa) + client.get(f"{P}/mission", headers=a).text + client.get(f"{P}/progress", headers=a).text + client.get(f"{P}/session/current", headers=a).text
    assert flag not in body and flag.split("_")[-1] not in body


def test_docker_down(monkeypatch):
    monkeypatch.setattr(docker_lab, "start", lambda *a, **k: (_ for _ in ()).throw(docker_lab.DockerUnavailable()))
    assert client.post(f"{P}/session/start", headers=login("d8@x.io")).status_code == 503


@pytest.mark.docker
def test_real_lab_hidden_dir_and_wordlist():
    sid = "abcdef018888"
    flag = main.make_flag("YOJO_directory_bruteforcing_")
    h = labutil.host(sid, "dir-01")
    try:
        name, net, _ = docker_lab.start(sid, "t", "DIR-01", flag, None, host=h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        import docker
        hc = docker.from_env().containers.get(name).attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and not hc["PortBindings"]
        get = lambda p: labutil.get(h, p)
        home = get("/").read().decode()
        assert "s3r3ct" not in home and "Yojo Shopping" in home  # hidden dir not linked
        assert get("/s3r3ct/flag.txt").read().decode().strip() == flag
        wl = get("/tools/wordlist.txt").read().decode().split()
        assert "s3r3ct" in wl  # discoverable via enumeration
        # enumerate with the wordlist from a throwaway container, like a student would
        found = []
        for w in wl:
            try:
                if labutil.get(h, f"/{w}/").status == 200:
                    found.append(w)
            except urllib.error.HTTPError:
                pass
        assert found == ["s3r3ct"]
        with pytest.raises(urllib.error.HTTPError):
            get("/private/")  # decoy 404
    finally:
        docker_lab.stop(sid)
