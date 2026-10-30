"""Mission 5 answer handling. The verified expiration date lives only on the server.

Precedence: admin override stored in the DB (m_config) > MISSION5_EXPECTED_DATE env > built-in default.
The default was verified on 2026-10-21 against Verisign's .com registry RDAP (expiration 2028-12-18T15:20:03Z),
GoDaddy's registrar RDAP (2028-12-18T10:20:03Z) and `whois`. Re-check it with verify_domain.py."""
import datetime as dt, os, re
import db

DOMAIN = "yojosolutions.com"
DEFAULT = "2028-12-18"
KEY = "m5_expected_date"
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


class BadDate(ValueError):
    pass


def _mk(y, m, d):
    try:
        return dt.date(int(y), int(m), int(d))
    except ValueError:
        return None


def parse(text):
    """Return a date, or raise BadDate. Ambiguous numeric dates are refused rather than guessed."""
    s = re.sub(r"\s+", " ", (text or "").strip())
    if not s or len(s) > 40:
        raise BadDate("Enter the expiration date, for example 2030-01-31.")
    # RDAP-style timestamp: 2028-12-18T15:20:03Z or 2028-12-18 15:20:03 -> the date as written
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?", s, re.I)
    if m:
        d = _mk(*m.groups())
        if d:
            return d
        raise BadDate("That is not a valid calendar date.")
    # numeric: YYYY-MM-DD, DD-MM-YYYY, MM-DD-YYYY with - / . separators
    m = re.fullmatch(r"(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})", s)
    if m:
        a, b, c = m.groups()
        found = set()
        if len(a) == 4 and len(c) <= 2:
            found.add(_mk(a, b, c))
        elif len(c) == 4 and len(a) <= 2:
            found.update({_mk(c, b, a), _mk(c, a, b)})  # DD-MM-YYYY and MM-DD-YYYY
        found.discard(None)
        if len(found) == 1:
            return found.pop()
        if len(found) > 1:
            raise BadDate("That date could be read two ways. Write it as YYYY-MM-DD.")
        raise BadDate("That is not a valid calendar date.")
    # words: 18 December 2028, December 18, 2028, 18 Dec 2028
    m = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}),? (\d{4})", s, re.I) or None
    if m:
        d, mon, y = m.groups()
    else:
        m2 = re.fullmatch(r"([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})", s, re.I)
        if not m2:
            raise BadDate("Use a full date such as 2030-01-31. Partial dates are not accepted.")
        mon, d, y = m2.groups()
    mi = MONTHS.get(mon[:3].lower())
    if not mi or not any(full.startswith(mon.lower()) for full in ("january february march april may june july august september october november december".split())):
        raise BadDate("I could not read that month.")
    out = _mk(y, mi, d)
    if not out:
        raise BadDate("That is not a valid calendar date.")
    return out


def expected():
    """The configured, verified date, or None when nothing is configured."""
    try:
        with db.tx() as c:
            r = c.execute("SELECT value FROM m_config WHERE key=?", (KEY,)).fetchone()
        raw = r[0] if r else os.environ.get("MISSION5_EXPECTED_DATE", DEFAULT)
        return dt.date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def source():
    with db.tx() as c:
        if c.execute("SELECT 1 FROM m_config WHERE key=?", (KEY,)).fetchone():
            return "admin"
    return "env" if "MISSION5_EXPECTED_DATE" in os.environ else "default"


def set_expected(date_text):
    d = parse(date_text)
    with db.tx() as c:
        c.execute("INSERT INTO m_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (KEY, d.isoformat()))
    return d
