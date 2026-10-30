"""SQLite persistence. All XP is written through ledger_award(), which is idempotent per (user, source)."""
import os, sqlite3, threading, contextlib

DB_PATH = os.environ.get("MISSION_DB", os.path.join(os.path.dirname(__file__), "mission.db"))
_lock = threading.Lock()
MAX_XP = {"INT-01": 100, "REC-01": 50, "WEB-01": int(os.environ.get("MISSION3_XP", "50")), "INFO-01": int(os.environ.get("MISSION4_XP", "50")), "DOM-01": int(os.environ.get("MISSION5_XP", "50")), "SUB-01": int(os.environ.get("MISSION6_XP", "50")), "END-01": int(os.environ.get("MISSION7_XP", "50")), "DIR-01": int(os.environ.get("MISSION8_XP", "50")), "IMG-01": int(os.environ.get("MISSION9_XP", "50"))}  # Mission 3 reward is configurable
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, name TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS m_progress(email TEXT NOT NULL, mission TEXT NOT NULL, lesson_done_at TEXT, best_score INTEGER DEFAULT 0, last_score INTEGER, completed_at TEXT, lab_done_at TEXT, PRIMARY KEY(email, mission));
CREATE TABLE IF NOT EXISTS m_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, mission TEXT NOT NULL, score INTEGER NOT NULL, scored INTEGER NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS m_submissions(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, mission TEXT NOT NULL, session_id TEXT NOT NULL, answer TEXT NOT NULL, accepted INTEGER NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS m_config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS xp_ledger(email TEXT NOT NULL, mission TEXT NOT NULL, source TEXT NOT NULL, xp INTEGER NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(email, mission, source));
CREATE TABLE IF NOT EXISTS m_sessions(id TEXT PRIMARY KEY, email TEXT NOT NULL, mission TEXT NOT NULL, container TEXT, network TEXT, port INTEGER, status TEXT NOT NULL,
  created TEXT, started TEXT, stopped TEXT, expires TEXT, last_seen TEXT, error TEXT, lab_code_hash TEXT, lab_tries INTEGER DEFAULT 0, lab_host TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_session ON m_sessions(email, mission) WHERE status IN ('starting','active','stopping');
"""


def connect():
    c = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init():
    with contextlib.closing(connect()) as c:
        c.executescript(SCHEMA)
        _migrate_mission1(c)
        _add_col(c, 'm_progress', 'lab_done_at', 'TEXT')
        _add_col(c, 'm_sessions', 'lab_code_hash', 'TEXT')
        _add_col(c, 'm_sessions', 'lab_tries', 'INTEGER DEFAULT 0')
        _add_col(c, 'm_sessions', 'lab_host', 'TEXT')
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS lab_host_unique ON m_sessions(lab_host) WHERE lab_host IS NOT NULL")


def _add_col(c, table, col, decl):
    if col not in {r[1] for r in c.execute(f'PRAGMA table_info({table})')}:
        c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {decl}')


def _migrate_mission1(c):
    """Copy rows from the original Mission 1 tables (once) into the multi-mission tables."""
    old = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "m1_progress" in old:
        c.execute("INSERT OR IGNORE INTO m_progress(email,mission,lesson_done_at,best_score,last_score,completed_at) SELECT email,'INT-01',lesson_done_at,best_score,last_score,completed_at FROM m1_progress")
        c.execute("ALTER TABLE m1_progress RENAME TO m1_progress_migrated")
    if "m1_attempts" in old:
        c.execute("INSERT INTO m_attempts(email,mission,score,scored,created) SELECT email,'INT-01',score,scored,created FROM m1_attempts")
        c.execute("ALTER TABLE m1_attempts RENAME TO m1_attempts_migrated")
    if "m1_sessions" in old:
        c.execute("DROP INDEX IF EXISTS one_live_session")
        c.execute("INSERT OR IGNORE INTO m_sessions(id,email,mission,container,network,port,status,created,started,stopped,expires,last_seen,error) SELECT id,email,'INT-01',container,network,port,status,created,started,stopped,expires,last_seen,error FROM m1_sessions")
        c.execute("ALTER TABLE m1_sessions RENAME TO m1_sessions_migrated")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_live_session ON m_sessions(email, mission) WHERE status IN ('starting','active','stopping')")


@contextlib.contextmanager
def tx():
    """Write transaction: BEGIN IMMEDIATE serialises concurrent writers."""
    c = connect()
    try:
        c.execute("BEGIN IMMEDIATE")
        yield c
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK") if c.in_transaction else None
        raise
    finally:
        c.close()


def ledger_award(c, email, mission, source, xp):
    """Insert a reward once. Returns xp actually granted (0 if already rewarded or over the mission cap)."""
    total = mission_xp(c, email, mission)
    xp = max(0, min(xp, MAX_XP[mission] - total))
    if xp == 0:
        return 0
    cur = c.execute("INSERT OR IGNORE INTO xp_ledger(email,mission,source,xp) VALUES(?,?,?,?)", (email, mission, source, xp))
    return xp if cur.rowcount else 0


def mission_xp(c, email, mission):
    return c.execute("SELECT COALESCE(SUM(xp),0) FROM xp_ledger WHERE email=? AND mission=?", (email, mission)).fetchone()[0]
