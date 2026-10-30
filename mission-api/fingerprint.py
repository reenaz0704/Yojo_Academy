"""Mission 3 answer checking. The expected set lives only on the server (env-configurable, never sent to clients)."""
import os, re

# Wappalyzer-style names and common spellings -> canonical key
ALIASES = {
    "node.js": "node.js", "nodejs": "node.js", "node": "node.js", "node js": "node.js",
    "html": "html", "html5": "html", "html 5": "html",
    "apache": "apache", "apache http server": "apache", "apache httpd": "apache", "httpd": "apache",
    "express": "express", "express.js": "express", "expressjs": "express",
    "css": "css", "javascript": "javascript", "js": "javascript",
}
MAX_CHARS, MAX_ITEMS, MAX_ITEM_LEN = 200, 20, 40


def expected():
    raw = os.environ.get("MISSION3_EXPECTED", "apache,express,node.js")
    return {ALIASES.get(x.strip().lower(), x.strip().lower()) for x in raw.split(",") if x.strip()}


POLICY = os.environ.get("MISSION3_MATCH", "required")  # required | exact


class BadAnswer(ValueError):
    pass


def normalize(text):
    if len(text) > MAX_CHARS:
        raise BadAnswer("Answer is too long.")
    items = [re.sub(r"\s+", " ", p).strip(" .\t").lower() for p in re.split(r"[,;\n/|]+", text)]
    items = [i for i in items if i]
    if not items:
        raise BadAnswer("Enter at least one technology.")
    if len(items) > MAX_ITEMS or any(len(i) > MAX_ITEM_LEN for i in items):
        raise BadAnswer("Too many or too long entries.")
    return {ALIASES.get(i, i) for i in items}


def check(text):
    """Returns (accepted, message). Never names missing technologies."""
    got, need = normalize(text), expected()
    hit = need & got
    if not hit:
        return False, "No required technologies were recognized."
    if hit != need:
        return False, "Some required technologies are missing."
    if POLICY == "exact" and got - need:
        return False, "Your answer includes technologies that are not part of this solution."
    return True, "Submission accepted."
