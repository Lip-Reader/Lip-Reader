"""Clerk session-JWT verification and role checks as FastAPI dependencies."""
from __future__ import annotations

import logging
import time

from clerk_backend_api import Clerk
from clerk_backend_api.security.types import TokenVerificationError, VerifyTokenOptions
from clerk_backend_api.security.verifytoken import verify_token
from fastapi import Depends, HTTPException, Request

from . import config

log = logging.getLogger("chaplin.auth")

_CACHE_TTL = 60
_users: dict[str, tuple[float, dict]] = {}
_clerk: Clerk | None = None


def _sdk() -> Clerk:
    global _clerk
    if _clerk is None:
        _clerk = Clerk(bearer_auth=config.CLERK_SECRET_KEY)
    return _clerk


def _user_out(u) -> dict:
    emails = {e.id: e.email_address for e in u.email_addresses}
    return {
        "id": u.id,
        "email": emails.get(u.primary_email_address_id) or next(iter(emails.values()), None),
        "name": " ".join(p for p in (u.first_name, u.last_name) if p) or None,
        "role": (u.public_metadata or {}).get("role"),
        "created_at": u.created_at,
        "last_sign_in_at": u.last_sign_in_at,
    }


def _clerk_user(user_id: str) -> dict:
    hit = _users.get(user_id)
    if hit and time.time() - hit[0] < _CACHE_TTL:
        return hit[1]
    try:
        info = _user_out(_sdk().users.get(user_id=user_id))
    except Exception as e:  # noqa: BLE001
        log.exception("clerk user lookup failed")
        raise HTTPException(status_code=503, detail=f"auth unavailable: {e}")
    _users[user_id] = (time.time(), info)
    return info


def optional_user(request: Request) -> dict | None:
    header = request.headers.get("authorization", "")
    if not config.CLERK_SECRET_KEY or not header.startswith("Bearer "):
        return None
    try:
        payload = verify_token(header[7:], VerifyTokenOptions(secret_key=config.CLERK_SECRET_KEY))
    except TokenVerificationError as e:
        log.info("token rejected: %s", e.reason.name)
        raise HTTPException(status_code=401, detail="unauthorized")
    user = _clerk_user(payload["sub"])
    return {"id": user["id"], "email": user["email"]}


def require_user(user: dict | None = Depends(optional_user)) -> dict:
    if not config.CLERK_SECRET_KEY:
        raise HTTPException(status_code=503, detail="auth not configured")
    if user is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    if _clerk_user(user["id"])["role"] != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    return user


def list_users(limit: int = 100) -> list[dict]:
    users = _sdk().users.list(request={"limit": limit, "order_by": "-created_at"})
    return [_user_out(u) for u in users]


def count_users() -> int:
    return _sdk().users.count().total_count
