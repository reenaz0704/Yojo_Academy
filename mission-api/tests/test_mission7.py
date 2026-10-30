import os, tempfile, threading, subprocess, shutil
os.environ["MISSION_DB"] = os.path.join(tempfile.mkdtemp(), "t7.db")
os.environ["MISSION_API_SECRET"] = "test-secret"
import pytest
from fastapi.testclient import TestClient
import labutil, main, docker_lab

client = TestClient(main.app)
P = "/api/m7"
KATANA = os.path.join(os.path.dirname(__file__), "..", "tools", "katana", "katana")


def login(e):
    return {"Authorization": "Bearer " + client.post(f"{P}/auth", json={"email": e}).json()["token"]}


@pytest.fixture
def fake_docker(monkeypatch):
    live = set()
    monkeypatch.setattr(docker_lab, "start", lambda sid, eh, m="x", code="", env=None, host="": (live.add(sid), (f"c-{sid}", f"n-{sid}", host))[1])
    monkeypatch.setattr(docker_lab, "stop", lambda sid: live.discard(sid))
    monkeypatch.setattr(docker_lab, "is_running", lambda sid: sid in live)
    return live


def start(h):
    return client.post(f"{P}/session/start", headers=h).json()


def submit(h, sid, a):
    return client.post(f"{P}/submit", headers=h, json={"session_id": sid, "answer": a})


def test_eight_pays_50_once_and_persists(fake_docker):
    h = login("ok7@x.io")
    s = start(h)
    assert s["host"].startswith("end-01-")
    r = submit(h, s["session_id"], " 8 ").json()
    assert r["accepted"] and r["awarded"] == 50 and r["progress"]["xp"] == 50
    assert submit(h, s["session_id"], "8").json()["awarded"] == 0
    assert client.get(f"{P}/progress", headers=login("ok7@x.io")).json()["completed"]


@pytest.mark.parametrize("a", ["7", "9", "0", "16"])
def test_wrong_counts_pay_nothing(fake_docker, a):
    h = login(f"w7{a}@x.io")
    r = submit(h, start(h)["session_id"], a).json()
    assert not r["accepted"] and r["awarded"] == 0 and "8" not in r["message"]


@pytest.mark.parametrize("a", ["", " ", "-8", "8.0", "eight", "+8", "٨"])
def test_malformed_rejected(fake_docker, a):
    h = login("m7@x.io")
    assert submit(h, start(h)["session_id"], a).status_code == 422


def test_concurrent_once(fake_docker):
    h = login("c7@x.io")
    sid = start(h)["session_id"]
    out = []
    ts = [threading.Thread(target=lambda: out.append(submit(h, sid, "8").json()["awarded"])) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(out) == 50


def test_isolation_and_no_answer_leak(fake_docker):
    a, b = login("a7@x.io"), login("b7@x.io")
    sid = start(a)["session_id"]
    assert submit(b, sid, "8").status_code == 404
    assert client.post(f"{P}/submit", json={"session_id": sid, "answer": "8"}).status_code == 401
    other = client.post("/api/m6/session/start", headers=a).json()["session_id"]
    assert submit(a, other, "8").status_code == 404
    body = client.get(f"{P}/mission", headers=a).text + client.get(f"{P}/progress", headers=a).text
    assert "expected" not in body


def test_opening_lab_pays_nothing_and_docker_down(fake_docker, monkeypatch):
    h = login("o7@x.io")
    start(h)
    assert client.get(f"{P}/progress", headers=h).json()["xp"] == 0

    def boom(*a, **k):
        raise docker_lab.DockerUnavailable()
    monkeypatch.setattr(docker_lab, "start", boom)
    assert client.post(f"{P}/session/start", headers=login("d7@x.io")).status_code == 503


@pytest.mark.docker
def test_real_katana_finds_exactly_eight_in_scope():
    if not os.path.exists(KATANA):
        pytest.skip("katana binary not present")
    sid = "abcdef017777"
    h = labutil.host(sid, "end-01")
    try:
        name, net, _ = docker_lab.start(sid, "t", "END-01", "", None, h)
    except docker_lab.DockerUnavailable:
        pytest.skip("docker not available")
    try:
        import docker
        hc = docker.from_env().containers.get(name).attrs["HostConfig"]
        assert not hc["Privileged"] and hc["ReadonlyRootfs"] and not hc["PortBindings"]
        runs = []
        for _ in range(3):  # run the real crawler from a throwaway container on the lab's network
            out = subprocess.run(["docker", "run", "--rm", "--network", net, "-v", f"{os.path.abspath(KATANA)}:/katana:ro", "--entrypoint", "/katana",
                                  "nginx:latest", "-u", f"http://{name}:8080/", "-silent"], capture_output=True, text=True, timeout=120).stdout.split()
            runs.append(sorted(set(out)))
        assert runs[0] == runs[1] == runs[2] and len(runs[0]) == main.MISSION7_EXPECTED == 8
        assert all(u.startswith(f"http://{name}:8080/") for u in runs[0])  # stays in scope
    finally:
        docker_lab.stop(sid)
