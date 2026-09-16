"""Supabase Postgres chat store, mirroring sigma-agent-server's
chat_memory / chat_messages tables (header + ordered messages).

Serverless-friendly: one cached connection per process (Supabase session
pooler), reopened on failure; schema is created lazily once per process.
"""
from __future__ import annotations

import json
import logging
import threading

import psycopg
from psycopg.rows import dict_row

from . import config

log = logging.getLogger("chaplin.db")

_DDL = """
CREATE TABLE IF NOT EXISTS chat_memory (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description VARCHAR(256),
    sequence_number BIGSERIAL,
    is_preset BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE chat_memory ADD COLUMN IF NOT EXISTS is_preset BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL
        REFERENCES chat_memory (conversation_id) ON DELETE CASCADE,
    type VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    steps JSONB
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
    ON chat_messages (conversation_id);

-- Preset demo conversations (is_preset = TRUE -> protected from delete/append).
-- The description IS the noisy sentence to correct; each preset carries one
-- other-person message. Presets 1-2 need that context to resolve correctly;
-- presets 3-6 are correctable from the sentence alone. Self-healing: rows are
-- upserted and stale preset messages replaced, so editing this seed list is
-- enough to change the presets everywhere.
INSERT INTO chat_memory (conversation_id, description, is_preset) VALUES
    ('00000000-0000-0000-0000-000000000001', 'LEGNOP JALES', TRUE),
    ('00000000-0000-0000-0000-000000000002', 'WHERES MY BILL', TRUE),
    ('00000000-0000-0000-0000-000000000003', 'IM SO EXCITED TO ME YOU TODAY', TRUE),
    ('00000000-0000-0000-0000-000000000004', 'PLEASE BRING ME A GLASS OF WHAT ER', TRUE),
    ('00000000-0000-0000-0000-000000000005', 'I FILL A LOT OF PAIN IN MY BAG', TRUE),
    ('00000000-0000-0000-0000-000000000006', 'I WOULD LIKE TO SEA MY FAMILY TO MORROW', TRUE)
ON CONFLICT (conversation_id)
    DO UPDATE SET description = EXCLUDED.description, is_preset = TRUE;
DELETE FROM chat_messages
WHERE conversation_id IN (SELECT conversation_id FROM chat_memory WHERE is_preset)
  AND (conversation_id::text, content) NOT IN (VALUES
    ('00000000-0000-0000-0000-000000000001', 'Who is your favorite NBA player?'),
    ('00000000-0000-0000-0000-000000000002', 'The nurse has your evening medication ready.'),
    ('00000000-0000-0000-0000-000000000003', 'Good morning! The new doctor will visit you soon.'),
    ('00000000-0000-0000-0000-000000000004', 'Lunch is almost ready for you.'),
    ('00000000-0000-0000-0000-000000000005', 'How are you feeling after the surgery?'),
    ('00000000-0000-0000-0000-000000000006', 'Visiting hours are from ten to noon.')
);
INSERT INTO chat_messages (conversation_id, type, content)
SELECT v.cid::uuid, 'OTHER', v.msg FROM (VALUES
    ('00000000-0000-0000-0000-000000000001', 'Who is your favorite NBA player?'),
    ('00000000-0000-0000-0000-000000000002', 'The nurse has your evening medication ready.'),
    ('00000000-0000-0000-0000-000000000003', 'Good morning! The new doctor will visit you soon.'),
    ('00000000-0000-0000-0000-000000000004', 'Lunch is almost ready for you.'),
    ('00000000-0000-0000-0000-000000000005', 'How are you feeling after the surgery?'),
    ('00000000-0000-0000-0000-000000000006', 'Visiting hours are from ten to noon.')
) AS v(cid, msg)
WHERE NOT EXISTS (
    SELECT 1 FROM chat_messages m
    WHERE m.conversation_id = v.cid::uuid AND m.content = v.msg
);
"""

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


# --- repository (sigma-agent-server shape) ---------------------------------

def ping() -> bool:
    return _run(lambda c: c.execute("SELECT 1").fetchone()) is not None


def create_conversation(title: str) -> dict:
    row = _run(lambda c: c.execute(
        "INSERT INTO chat_memory (description) VALUES (%s) "
        "RETURNING conversation_id, description, sequence_number, is_preset",
        (title,),
    ).fetchone())
    return _conv_out(row)


def list_conversations() -> list[dict]:
    # presets first in seed order, then user chats newest-first
    rows = _run(lambda c: c.execute(
        "SELECT conversation_id, description, sequence_number, is_preset "
        "FROM chat_memory ORDER BY is_preset DESC, "
        "CASE WHEN is_preset THEN sequence_number END ASC, sequence_number DESC"
    ).fetchall())
    return [_conv_out(r) for r in rows]


def is_preset(conversation_id: str) -> bool | None:
    """True/False for an existing conversation, None when it doesn't exist."""
    row = _run(lambda c: c.execute(
        "SELECT is_preset FROM chat_memory WHERE conversation_id = %s",
        (conversation_id,),
    ).fetchone())
    return None if row is None else bool(row["is_preset"])


def get_messages(conversation_id: str) -> list[dict]:
    rows = _run(lambda c: c.execute(
        "SELECT id, type, content, steps FROM chat_messages "
        "WHERE conversation_id = %s ORDER BY id ASC",
        (conversation_id,),
    ).fetchall())
    return [_msg_out(r) for r in rows]


def append_message(conversation_id: str, role: str, content: str,
                   steps: list | None = None) -> dict | None:
    def op(c: psycopg.Connection):
        row = c.execute(
            "INSERT INTO chat_messages (conversation_id, type, content, steps) "
            "SELECT %s, %s, %s, %s WHERE EXISTS "
            "(SELECT 1 FROM chat_memory WHERE conversation_id = %s AND NOT is_preset) "
            "RETURNING id, type, content, steps",
            (conversation_id, role.upper(), content,
             json.dumps(steps) if steps else None, conversation_id),
        ).fetchone()
        if row is not None:
            # provisional title from the first message (sigma pattern)
            c.execute(
                "UPDATE chat_memory SET description = %s "
                "WHERE conversation_id = %s AND description = 'New chat' "
                "AND (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = %s) = 1",
                (_provisional_title(content), conversation_id, conversation_id),
            )
        return row

    row = _run(op)
    return _msg_out(row) if row else None


def delete_conversation(conversation_id: str) -> bool:
    # chat_messages cascade via the FK; presets are protected
    return _run(lambda c: c.execute(
        "DELETE FROM chat_memory WHERE conversation_id = %s AND NOT is_preset "
        "RETURNING conversation_id",
        (conversation_id,),
    ).fetchone()) is not None


def _provisional_title(content: str) -> str:
    words = " ".join(content.strip().split()[:4])
    return (words[:40] + "…" if len(words) > 40 else words) or "New chat"


def _conv_out(row: dict) -> dict:
    return {
        "id": str(row["conversation_id"]),
        "title": row["description"] or "New chat",
        "seq": row["sequence_number"],
        "is_preset": bool(row["is_preset"]),
    }


def _msg_out(row: dict) -> dict:
    out = {"id": row["id"], "role": row["type"].lower(), "content": row["content"]}
    if row.get("steps"):
        out["steps"] = row["steps"]
    return out
