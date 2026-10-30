"""Helpers for the real-container tests: talk to a lab the way a browser does, through the shared proxy using the lab hostname."""
import urllib.request
import docker_lab


def host(sid, slug="test-01"):
    return f"{slug}-{sid[-4:]}.{docker_lab.base_domain()}"


def get(h, path="/", timeout=8):
    req = urllib.request.Request(f"http://127.0.0.1:{docker_lab.proxy_port()}{path}", headers={"Host": h})
    return urllib.request.urlopen(req, timeout=timeout)
