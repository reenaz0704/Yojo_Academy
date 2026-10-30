"""Trusted Docker control for the labs. Only fixed, validated config is used; no user input reaches Docker.

Routing model (matches the deployment plan, e.g. info-01-a83f.ctf.yojo.com):
  * every session gets its own container on its own bridge network, with NO published ports;
  * one hardened Traefik proxy publishes the only host port and routes Host(`<slug>-<random>.<LAB_BASE_DOMAIN>`)
    to that session's container using a per-session file in a dedicated routes directory (file provider:
    Traefik never gets the Docker socket);
  * the proxy is attached to each session network only while that session lives; labs share no network with each other and
    their networks are internal (no outbound internet)."""
import ipaddress, logging, os, re, tempfile, time, urllib.request
import docker
from docker.errors import NotFound, DockerException

log = logging.getLogger("mission1.docker")
IMAGES = {"INT-01": "yojo-academy/mission1-lab:1", "REC-01": "yojo-academy/mission2-lab:1", "WEB-01": "yojo-academy/mission3-lab:1", "INFO-01": "yojo-academy/mission4-lab:1", "DOM-01": "yojo-academy/mission5-lab:1", "SUB-01": "yojo-academy/mission6-lab:1", "END-01": "yojo-academy/mission7-lab:1", "DIR-01": "yojo-academy/mission8-lab:1", "IMG-01": "yojo-academy/mission9-lab:1"}  # fixed allow-list; never taken from the client
LABEL = "yojo.mission1"
PROXY_LABEL = "yojo.labproxy"
PROXY_NAME = "yojo-lab-proxy"
HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?(\.[a-z0-9-]{1,40}){1,6}$")


# ---- configuration -------------------------------------------------------------------------
def base_domain():
    """Parent domain of every lab hostname. Dev default ctf.localhost; production e.g. ctf.yojo.com (wildcard DNS)."""
    d = os.environ.get("LAB_BASE_DOMAIN", "ctf.localhost").strip().lower()
    return d if re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,80}[a-z0-9]", d) and "." in d else "ctf.localhost"


def proxy_port():
    p = os.environ.get("LAB_PROXY_PORT", "8088")
    return int(p) if p.isdigit() and 1 <= int(p) <= 65535 else 8088


def url_scheme():
    return "https" if os.environ.get("LAB_URL_SCHEME", "http") == "https" else "http"


def lab_url(host):
    """URL students use. The port is omitted when it is the scheme's default (production)."""
    default = 443 if url_scheme() == "https" else 80
    public = os.environ.get("LAB_PUBLIC_PORT", str(proxy_port()))
    port = int(public) if public.isdigit() else proxy_port()
    return f"{url_scheme()}://{host}" + ("" if port == default else f":{port}") + "/"


def routes_dir():
    d = os.environ.get("LAB_ROUTES_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy-routes")
    os.makedirs(d, exist_ok=True)
    return os.path.abspath(d)


def _extra_bind():
    """Optional second listen address for the PROXY (e.g. a VMware host-only IP so a Kali VM can reach labs). Never all interfaces."""
    raw = os.environ.get("LAB_BIND_HOST", "").strip()
    if not raw or raw == "127.0.0.1":
        return None
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        log.error("LAB_BIND_HOST is not an IP address; ignoring it")
        return None
    if ip.is_unspecified:
        log.error("LAB_BIND_HOST must be a specific address, not all interfaces; ignoring it")
        return None
    return str(ip)


def _proxy_bindings():
    port = proxy_port()
    b = [("127.0.0.1", port)]
    extra = _extra_bind()
    return b + [(extra, port)] if extra else b


class DockerUnavailable(Exception):
    pass


def _client():
    try:
        c = docker.from_env(timeout=10)
        c.ping()
        return c
    except DockerException as e:
        log.error("docker unavailable: %s", e)
        raise DockerUnavailable()


# ---- proxy ---------------------------------------------------------------------------------
def ensure_proxy(c):
    """Start the shared Traefik proxy if it is not running. Hardened: non-root, read-only, no caps, no Docker socket, no dashboard."""
    try:
        cont = c.containers.get(PROXY_NAME)
        cont.reload()
        wanted = {f"{h}:{p}" for h, p in _proxy_bindings()}
        have = {f"{x['HostIp']}:{x['HostPort']}" for x in (cont.attrs["NetworkSettings"]["Ports"].get("8088/tcp") or [])}
        if cont.status == "running" and wanted <= have:
            return cont
        cont.remove(force=True)  # stale or bound differently: recreate
    except NotFound:
        pass
    return c.containers.run(
        os.environ.get("LAB_PROXY_IMAGE", "mirror.gcr.io/library/traefik:v3.6"), name=PROXY_NAME, detach=True,
        command=["--entrypoints.web.address=:8088", "--providers.file.directory=/routes", "--providers.file.watch=true",
                 "--api=false", "--ping=false", "--log.level=WARN", "--accesslog=false"],
        ports={"8088/tcp": _proxy_bindings()}, volumes={routes_dir(): {"bind": "/routes", "mode": "ro"}},
        user="65532:65532", read_only=True, tmpfs={"/tmp": "size=8m"}, cap_drop=["ALL"], security_opt=["no-new-privileges:true"],
        mem_limit="128m", memswap_limit="128m", nano_cpus=int(0.5 * 1e9), pids_limit=128, privileged=False,
        restart_policy={"Name": "unless-stopped"}, labels={PROXY_LABEL: "1"})


def _reload_mode():
    """How Traefik notices route files. 'watch' (Linux/macOS, production): its file watcher. 'restart' (default on
    Windows): Docker Desktop does not pass file-change events from a Windows folder into the container, so the proxy is
    restarted after each change; running labs lose their connection for about a second. Development only."""
    m = os.environ.get("LAB_PROXY_RELOAD", "restart" if os.name == "nt" else "watch")
    return m if m in ("watch", "restart") else "watch"


def _reload_proxy():
    if _reload_mode() != "restart":
        return
    try:
        _client().containers.get(PROXY_NAME).restart(timeout=2)
    except Exception:
        log.exception("proxy restart failed")


def _route_path(session_id):
    return os.path.join(routes_dir(), f"{session_id}.yml")


def _write_route(session_id, host, container_name):
    body = (f"http:\n  routers:\n    r-{session_id}:\n      rule: \"Host(`{host}`)\"\n      entryPoints: [web]\n      service: s-{session_id}\n"
            f"  services:\n    s-{session_id}:\n      loadBalancer:\n        servers:\n          - url: \"http://{container_name}:8080\"\n")
    fd, tmp = tempfile.mkstemp(dir=routes_dir(), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        f.write(body)
    os.chmod(tmp, 0o644)
    os.replace(tmp, _route_path(session_id))  # atomic: Traefik never sees half a file
    _reload_proxy()


def _remove_route(session_id):
    try:
        os.remove(_route_path(session_id))
    except FileNotFoundError:
        return
    _reload_proxy()


def _route_ready(host, timeout):
    """End-to-end check through the proxy: the lab's /healthz must answer for this hostname."""
    req_url = f"http://127.0.0.1:{proxy_port()}/healthz"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(req_url, headers={"Host": host})
            if urllib.request.urlopen(req, timeout=2).status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


# ---- labs ----------------------------------------------------------------------------------
LIMITS = {"WEB-01": {"mem": "192m", "cpus": 0.5, "pids": 128}, "IMG-01": {"mem": "192m", "cpus": 0.5, "pids": 128}}  # Apache + Node need more than the static labs
DEFAULT_LIMITS = {"mem": "64m", "cpus": 0.25, "pids": 64}


def start(session_id, email_hash, mission="INT-01", lab_code="", extra_env=None, host="", health_timeout=40):
    """Run one hardened container on its own network and route `host` to it. Returns (container_name, network_name, host)."""
    if not HOST_RE.match(host or ""):
        raise ValueError("invalid lab host")
    lim = LIMITS.get(mission, DEFAULT_LIMITS)
    c = _client()
    name, net = f"yojo-m1-{session_id}", f"yojo-m1-net-{session_id}"
    try:
        proxy = ensure_proxy(c)
        # one private network per session: only this lab and the proxy are on it, and "internal" means no route to the internet
        network = c.networks.create(net, driver="bridge", internal=True, labels={LABEL: "1"})
        cont = c.containers.run(
            IMAGES[mission], name=name, detach=True, network=net, user="101:101",
            environment={"LAB_CODE": lab_code, **(extra_env or {})}, privileged=False, read_only=True,
            tmpfs={"/tmp": "size=8m", "/usr/share/nginx/html/lab": "size=64k,uid=101,gid=101,mode=755"},
            mem_limit=lim["mem"], memswap_limit=lim["mem"], nano_cpus=int(lim["cpus"] * 1e9), pids_limit=lim["pids"],
            cap_drop=["ALL"], security_opt=["no-new-privileges:true"], restart_policy={"Name": "no"},
            labels={LABEL: "1", "yojo.session": session_id, "yojo.mission": mission, "yojo.user": email_hash})  # note: no published ports
        network.connect(proxy)  # the proxy joins this session's network only
        deadline = time.time() + health_timeout
        while time.time() < deadline:
            cont.reload()
            state = cont.attrs["State"]
            if state.get("Health", {}).get("Status") == "healthy":
                break
            if state.get("Status") in ("exited", "dead"):
                raise RuntimeError("container exited during start")
            time.sleep(0.5)
        else:
            raise RuntimeError("container did not become healthy")
        _write_route(session_id, host, name)
        if not _route_ready(host, 20):
            raise RuntimeError("proxy route did not become ready")
        return name, net, host
    except Exception:
        log.exception("start failed for session %s", session_id)
        _cleanup(c, session_id, name, net)
        raise


def _cleanup(c, session_id, name, net):
    _remove_route(session_id)
    try:
        c.containers.get(name).remove(force=True)
    except NotFound:
        pass
    except Exception:
        log.exception("remove container %s", name)
    try:
        network = c.networks.get(net)
        try:
            network.disconnect(PROXY_NAME, force=True)
        except Exception:
            pass
        network.remove()
    except NotFound:
        pass
    except Exception:
        log.exception("remove network %s", net)


def stop(session_id):
    c = _client()
    _cleanup(c, session_id, f"yojo-m1-{session_id}", f"yojo-m1-net-{session_id}")


def is_running(session_id):
    try:
        return _client().containers.get(f"yojo-m1-{session_id}").status == "running"
    except NotFound:
        return False
    except DockerUnavailable:
        return True  # unknown: do not mark expired just because docker is briefly unreachable


def live_session_ids():
    c = _client()
    return [x.labels.get("yojo.session") for x in c.containers.list(all=True, filters={"label": LABEL})]


def prune_routes(active_ids):
    """Delete route files whose session is no longer active (crash leftovers)."""
    for f in os.listdir(routes_dir()):
        if f.endswith(".yml") and f[:-4] not in active_ids:
            _remove_route(f[:-4])
