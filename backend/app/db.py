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
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS patient_key TEXT;
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
    framing JSONB,
    nbest JSONB,
    heard TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS framing JSONB;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS nbest JSONB;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS heard TEXT;
CREATE TABLE IF NOT EXISTS phrase_templates (
    id BIGSERIAL PRIMARY KEY,
    patient_key TEXT NOT NULL,
    phrase_id TEXT NOT NULL,
    frames INTEGER NOT NULL,
    dim INTEGER NOT NULL,
    features BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phrase_templates_patient ON phrase_templates (patient_key, phrase_id);
"""

USER_SETTING_FIELDS = ("voice_id", "language", "gender", "patient_key")

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
        "SELECT voice_id, language, gender, patient_key FROM user_settings WHERE user_id = %s",
        (user_id,),
    ).fetchone())
    return {k: (row[k] if row else None) for k in USER_SETTING_FIELDS}


def put_user_settings(user_id: str, patch: dict) -> dict:
    """Upsert the given fields; fields not in ``patch`` keep their stored value."""
    values = {k: patch.get(k) for k in USER_SETTING_FIELDS}
    row = _run(lambda c: c.execute(
        "INSERT INTO user_settings (user_id, voice_id, language, gender, patient_key) "
        "VALUES (%(user_id)s, %(voice_id)s, %(language)s, %(gender)s, %(patient_key)s) "
        "ON CONFLICT (user_id) DO UPDATE SET "
        "voice_id = COALESCE(EXCLUDED.voice_id, user_settings.voice_id), "
        "language = COALESCE(EXCLUDED.language, user_settings.language), "
        "gender = COALESCE(EXCLUDED.gender, user_settings.gender), "
        "patient_key = COALESCE(EXCLUDED.patient_key, user_settings.patient_key), "
        "updated_at = now() "
        "RETURNING voice_id, language, gender, patient_key",
        {"user_id": user_id, **values},
    ).fetchone())
    return {k: row[k] for k in USER_SETTING_FIELDS}


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

def add_run(user_id: str | None, raw: str, corrected: str, latency_ms: int | None,
            framing: dict | None = None, nbest: list | None = None,
            heard: str | None = None) -> int:
    return _run(lambda c: c.execute(
        "INSERT INTO runs (user_id, raw, corrected, latency_ms, framing, nbest, heard) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (user_id, raw, corrected, latency_ms,
         Json(framing) if framing else None, Json(nbest) if nbest else None, heard or None),
    ).fetchone())["id"]


def list_runs(limit: int = 100) -> list[dict]:
    return _run(lambda c: c.execute(
        "SELECT id, user_id, raw, corrected, latency_ms, framing, nbest, heard, created_at "
        "FROM runs ORDER BY id DESC LIMIT %s",
        (limit,),
    ).fetchall())


def count_runs_24h() -> int:
    return _run(lambda c: c.execute(
        "SELECT count(*) AS n FROM runs WHERE created_at > now() - interval '24 hours'"
    ).fetchone())["n"]


# --- phrase templates (Hebrew phrase mode; features only, never video) --------

def add_phrase_template(patient_key: str, phrase_id: str, features: bytes, frames: int, dim: int,
                        max_takes: int) -> int:
    """Store one take and return the number of takes kept for this phrase."""
    def op(c: psycopg.Connection):
        c.execute(
            "INSERT INTO phrase_templates (patient_key, phrase_id, frames, dim, features) "
            "VALUES (%s, %s, %s, %s, %s)",
            (patient_key, phrase_id, frames, dim, features),
        )
        c.execute(
            "DELETE FROM phrase_templates WHERE patient_key = %s AND phrase_id = %s AND id NOT IN ("
            "SELECT id FROM phrase_templates WHERE patient_key = %s AND phrase_id = %s "
            "ORDER BY id DESC LIMIT %s)",
            (patient_key, phrase_id, patient_key, phrase_id, max_takes),
        )
        return c.execute(
            "SELECT count(*) AS n FROM phrase_templates WHERE patient_key = %s AND phrase_id = %s",
            (patient_key, phrase_id),
        ).fetchone()["n"]

    return _run(op)


def list_phrase_templates(patient_key: str) -> list[dict]:
    return _run(lambda c: c.execute(
        "SELECT phrase_id, frames, dim, features FROM phrase_templates "
        "WHERE patient_key = %s ORDER BY id",
        (patient_key,),
    ).fetchall())


def count_phrase_takes(patient_key: str) -> dict[str, int]:
    rows = _run(lambda c: c.execute(
        "SELECT phrase_id, count(*) AS n FROM phrase_templates WHERE patient_key = %s GROUP BY phrase_id",
        (patient_key,),
    ).fetchall())
    return {r["phrase_id"]: r["n"] for r in rows}


def delete_phrase_templates(patient_key: str, phrase_id: str | None = None) -> int:
    if phrase_id is None:
        cur = _run(lambda c: c.execute(
            "DELETE FROM phrase_templates WHERE patient_key = %s", (patient_key,)))
    else:
        cur = _run(lambda c: c.execute(
            "DELETE FROM phrase_templates WHERE patient_key = %s AND phrase_id = %s",
            (patient_key, phrase_id)))
    return cur.rowcount
