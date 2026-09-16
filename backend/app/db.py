"""Supabase Postgres store: per-user settings, app settings, support, audit, runs.

Serverless-friendly: one cached connection per process (Supabase session
pooler), reopened on failure; schema is created lazily once per process.
"""
from __future__ import annotations

import logging
import threading

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from . import config

log = logging.getLogger("chaplin.db")

_DDL = """
CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    voice_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_messages (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    email TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runs (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    raw TEXT NOT NULL,
    corrected TEXT NOT NULL,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

APP_SETTINGS_DEFAULTS = {"default_voice_id": "Brian", "lip_reading_enabled": True}

_lock = threading.Lock()
_conn: psycopg.Connection | None = None
_schema_ready = False


def _connect() -> psycopg.Connection:
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL not configured")
    return psycopg.connect(
        config.DATABASE_URL,
        autocommit=True,
        row_factory=dict_row,
        connect_timeout=10,
        # pooler-safe (no server-side prepared statements) + dead-peer detection
        prepare_threshold=None,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=3,
    )


def _get_conn() -> psycopg.Connection:
    global _conn, _schema_ready
    with _lock:
        if _conn is None or _conn.closed:
            _conn = _connect()
        if not _schema_ready:
            _conn.execute(_DDL)
            _schema_ready = True
        return _conn


def _run(fn):
    """Run ``fn(conn)``, reconnecting once if the cached connection went stale.

    Retries on any psycopg error class (OperationalError, InterfaceError, ...):
    a frozen/thawed serverless instance can surface a dead socket as either.
    """
    global _conn
    try:
        return fn(_get_conn())
    except psycopg.Error:
        with _lock:
            if _conn is not None:
                try:
                    _conn.close()
                except Exception:  # noqa: BLE001
                    pass
                _conn = None
        return fn(_get_conn())


def ping() -> bool:
    return _run(lambda c: c.execute("SELECT 1").fetchone()) is not None


# --- user settings ---------------------------------------------------------

def get_user_settings(user_id: str) -> dict:
    row = _run(lambda c: c.execute(
        "SELECT voice_id FROM user_settings WHERE user_id = %s", (user_id,),
    ).fetchone())
    return {"voice_id": row["voice_id"] if row else None}


def put_user_settings(user_id: str, voice_id: str) -> dict:
    row = _run(lambda c: c.execute(
        "INSERT INTO user_settings (user_id, voice_id) VALUES (%s, %s) "
        "ON CONFLICT (user_id) DO UPDATE SET voice_id = EXCLUDED.voice_id, updated_at = now() "
        "RETURNING voice_id",
        (user_id, voice_id),
    ).fetchone())
    return {"voice_id": row["voice_id"]}


def list_user_settings() -> dict[str, str | None]:
    rows = _run(lambda c: c.execute("SELECT user_id, voice_id FROM user_settings").fetchall())
    return {r["user_id"]: r["voice_id"] for r in rows}


def count_user_settings() -> int:
    return _run(lambda c: c.execute("SELECT count(*) AS n FROM user_settings").fetchone())["n"]


# --- app settings ----------------------------------------------------------

def get_app_settings() -> dict:
    rows = _run(lambda c: c.execute("SELECT key, value FROM app_settings").fetchall())
    return {**APP_SETTINGS_DEFAULTS, **{r["key"]: r["value"] for r in rows}}


def patch_app_settings(patch: dict) -> dict:
    def op(c: psycopg.Connection):
        for key, value in patch.items():
            c.execute(
                "INSERT INTO app_settings (key, value) VALUES (%s, %s) "
                "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
                (key, Json(value)),
            )

    _run(op)
    return get_app_settings()


# --- support ---------------------------------------------------------------

def add_support(user_id: str | None, email: str | None, message: str) -> int:
    return _run(lambda c: c.execute(
        "INSERT INTO support_messages (user_id, email, message) VALUES (%s, %s, %s) RETURNING id",
        (user_id, email, message),
    ).fetchone())["id"]


def list_support() -> list[dict]:
    return _run(lambda c: c.execute(
        "SELECT id, user_id, email, message, status, created_at "
        "FROM support_messages ORDER BY id DESC"
    ).fetchall())


def set_support_status(id: int, status: str) -> dict | None:
    return _run(lambda c: c.execute(
        "UPDATE support_messages SET status = %s WHERE id = %s RETURNING id, status",
        (status, id),
    ).fetchone())


def count_support_open() -> int:
    return _run(lambda c: c.execute(
        "SELECT count(*) AS n FROM support_messages WHERE status = 'open'"
    ).fetchone())["n"]


# --- audit -----------------------------------------------------------------

def add_audit(actor: str, action: str, detail: dict | None = None) -> None:
    _run(lambda c: c.execute(
        "INSERT INTO audit_log (actor, action, detail) VALUES (%s, %s, %s)",
        (actor, action, Json(detail) if detail is not None else None),
    ))


def list_audit(limit: int = 100) -> list[dict]:
    return _run(lambda c: c.execute(
        "SELECT id, actor, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT %s",
        (limit,),
    ).fetchall())


# --- runs ------------------------------------------------------------------

def add_run(user_id: str | None, raw: str, corrected: str, latency_ms: int | None) -> int:
    return _run(lambda c: c.execute(
        "INSERT INTO runs (user_id, raw, corrected, latency_ms) VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, raw, corrected, latency_ms),
    ).fetchone())["id"]


def list_runs(limit: int = 100) -> list[dict]:
    return _run(lambda c: c.execute(
        "SELECT id, user_id, raw, corrected, latency_ms, created_at "
        "FROM runs ORDER BY id DESC LIMIT %s",
        (limit,),
    ).fetchall())


def count_runs_24h() -> int:
    return _run(lambda c: c.execute(
        "SELECT count(*) AS n FROM runs WHERE created_at > now() - interval '24 hours'"
    ).fetchone())["n"]
