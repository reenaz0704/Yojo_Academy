"""Mission 6 configuration. The expected count is derived from the very dataset the lab is given, so lab and answer cannot drift apart."""
import logging, os, re

log = logging.getLogger("mission6")
DEFAULT_DOMAIN = "yojocorp.test"
DEFAULT_LABELS = "www,mail,api,dev,staging,vpn,portal,cdn,blog,shop"
LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$")


def domain():
    """Only reserved training names (.test) or domains explicitly listed in MISSION6_AUTHORIZED_DOMAINS are allowed."""
    d = os.environ.get("MISSION6_TARGET_DOMAIN", DEFAULT_DOMAIN).strip().lower()
    allowed = {x.strip().lower() for x in os.environ.get("MISSION6_AUTHORIZED_DOMAINS", "").split(",") if x.strip()}
    if re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,60}[a-z0-9]", d) and (d.endswith(".test") or d in allowed):
        return d
    log.error("MISSION6_TARGET_DOMAIN is not a training (.test) or explicitly authorized domain; using the default")
    return DEFAULT_DOMAIN


def labels():
    raw = os.environ.get("MISSION6_SUBDOMAINS", DEFAULT_LABELS)
    out = []
    for x in raw.split(","):
        x = x.strip().lower()
        if LABEL.match(x) and x not in out:
            out.append(x)
    return out


def expected_count():
    return len(labels())


def academy_url():
    """Where the lab site's Submit Solution button leads (the Mission 6 page in the Academy)."""
    base = os.environ.get("ACADEMY_BASE", "http://localhost:8000/academy.html")
    if not re.fullmatch(r"https?://[A-Za-z0-9.:\-]{1,80}(/[A-Za-z0-9._/\-]{0,80})?", base):
        base = "http://localhost:8000/academy.html"
    return base + "#/academy/mission/subdomains"


def lab_env():
    return {"TARGET_DOMAIN": domain(), "SUBDOMAINS": ",".join(labels()), "ACADEMY_URL": academy_url()}
