"""Admin API: every route requires a Clerk user with public_metadata.role == "admin"."""
from __future__ import annotations

import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import auth, config, db

log = logging.getLogger("chaplin.admin")

router = APIRouter(prefix="/api/admin", dependencies=[Depends(auth.require_admin)])


def _db(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001
        log.exception("db failed")
        raise HTTPException(status_code=503, detail=f"db unavailable: {e}")


def _actor(admin: dict) -> str:
    return admin["email"] or admin["id"]


def _vsr_ok() -> bool:
    try:
        return httpx.get(f"{config.VSR_API_BASE}/health", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


@router.get("/overview")
def overview():
    counts = {"settings_rows": 0, "support_open": 0, "runs_24h": 0}
    db_ok = True
    try:
        counts = {
            "settings_rows": db.count_user_settings(),
            "support_open": db.count_support_open(),
            "runs_24h": db.count_runs_24h(),
        }
    except Exception:  # noqa: BLE001
        log.exception("overview counts failed")
        db_ok = False
    return {"users": auth.count_users(), **counts, "api_ok": True, "vsr_ok": _vsr_ok(), "db_ok": db_ok}


@router.get("/users")
def users():
    voices = _db(db.list_user_settings)
    return {"users": [{**u, "voice_id": voices.get(u["id"])} for u in auth.list_users()]}


class SettingsPatch(BaseModel):
    default_voice_id: str | None = None
    lip_reading_enabled: bool | None = None


@router.get("/settings")
def settings():
    return {"settings": _db(db.get_app_settings)}


@router.patch("/settings")
def settings_patch(body: SettingsPatch, admin: dict = Depends(auth.require_admin)):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="empty patch")
    out = _db(db.patch_app_settings, patch)
    _db(db.add_audit, _actor(admin), "settings.patch", patch)
    return {"settings": out}


@router.get("/support")
def support():
    return {"messages": _db(db.list_support)}


class SupportPatch(BaseModel):
    status: Literal["open", "closed"]


@router.patch("/support/{id}")
def support_patch(id: int, body: SupportPatch, admin: dict = Depends(auth.require_admin)):
    row = _db(db.set_support_status, id, body.status)
    if row is None:
        raise HTTPException(status_code=404, detail="support message not found")
    _db(db.add_audit, _actor(admin), "support.status", {"id": id, "status": body.status})
    return row


@router.get("/audit")
def audit(limit: int = 100):
    return {"entries": _db(db.list_audit, min(limit, 500))}


@router.get("/runs")
def runs(limit: int = 100):
    return {"runs": _db(db.list_runs, min(limit, 500))}
