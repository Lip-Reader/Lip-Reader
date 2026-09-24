"""Chaplin AI API backend. Lip reading is served separately by vsr_main.py."""
from __future__ import annotations

import base64
import logging

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import admin, config, db, meta, phrases, tts
from .auth import optional_user, require_user

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chaplin.api")


app = FastAPI(title="Chaplin AI", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=r"^https?://localhost(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(admin.router)

ARCHITECTURE_PNG = config.REPO_ROOT / "assets" / "architecture.png"
SPA_DIST = config.REPO_ROOT / "app" / "dist"


def _db(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001
        log.exception("db failed")
        raise HTTPException(status_code=503, detail=f"db unavailable: {e}")


# --- workshop API ---------------------------------------------------------

@app.get("/api/team_info")
def team_info():
    return meta.TEAM_INFO


@app.get("/api/agent_info")
def agent_info():
    return meta.AGENT_INFO


@app.get("/api/model_architecture")
def model_architecture():
    if not ARCHITECTURE_PNG.is_file():
        raise HTTPException(status_code=404, detail="architecture.png not found")
    return FileResponse(ARCHITECTURE_PNG, media_type="image/png")


# --- settings / support / runs (Supabase Postgres) -------------------------

@app.get("/api/settings/public")
def settings_public():
    return _db(db.get_app_settings)


class SettingsBody(BaseModel):
    voice_id: str | None = None
    language: str | None = None
    gender: str | None = None
    patient_key: str | None = None


@app.get("/api/me/settings")
def me_settings(user: dict = Depends(require_user)):
    return _db(db.get_user_settings, user["id"])


@app.put("/api/me/settings")
def me_settings_put(body: SettingsBody, user: dict = Depends(require_user)):
    if body.language is not None and body.language not in ("en", "he"):
        raise HTTPException(status_code=400, detail="language must be 'en' or 'he'")
    if body.gender is not None and body.gender not in ("m", "f"):
        raise HTTPException(status_code=400, detail="gender must be 'm' or 'f'")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="nothing to update")
    return _db(db.put_user_settings, user["id"], patch)


@app.get("/api/phrases/{lang}")
def phrases_list(lang: str):
    try:
        return phrases.load_phrases(lang)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"no phrase list for language {lang!r}")


class SupportBody(BaseModel):
    message: str


@app.post("/api/support")
def support(body: SupportBody, user: dict | None = Depends(optional_user)):
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="message is required")
    user = user or {}
    return {"id": _db(db.add_support, user.get("id"), user.get("email"), text[:4000])}


class RunBody(BaseModel):
    """One recording, like a line of the reference app's runs.jsonl."""
    raw: str                        # the model's own reading (top-1), or the best phrase id
    corrected: str
    latency_ms: int | None = None
    # how the speaker was framed: frame size, face size, rough distance, picture quality
    framing: dict | None = None
    # what the browser's speech recognition heard, to compare with the lip reading
    heard: str | None = None
    # the per-word options the corrector saw, so a bad run can be diagnosed later
    word_options: str | None = None
    # the notes about the patient the corrector was given
    notes: list[str] | None = None
    clip_fps: float | None = None
    # what was actually said, when the clinician or the patient confirmed it
    truth: str | None = None
    # Hebrew mode: the whole ranking and whether the matcher was sure
    hebrew: dict | None = None


@app.post("/api/runs")
def runs(body: RunBody, user: dict | None = Depends(optional_user)):
    user_id = (user or {}).get("id")
    if body.framing:
        log.info("framing %s", body.framing)
    return {"id": _db(db.add_run, user_id, body.raw, body.corrected, body.latency_ms,
                      body.framing, body.heard, body.word_options, body.notes,
                      body.clip_fps, body.truth, body.hebrew)}


@app.get("/api/db_ping")
def db_ping():
    """Keep-alive: a scheduled job hits this so the Supabase project never pauses."""
    try:
        db.ping()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"db unreachable: {e}")
    return {"status": "ok", "db": 1}


# --- supporting endpoints (unchanged contracts) ----------------------------

class SpeakBody(BaseModel):
    text: str
    voice_id: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "vsr_available": False}


@app.get("/voices")
def voices(lang: str = "en"):
    return {"voices": tts.list_voices(lang)}


@app.post("/speak")
def speak(body: SpeakBody):
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    voice_id = body.voice_id or config.DEFAULT_VOICE_ID
    try:
        audio, tokens = tts.synthesize_with_timestamps(text, voice_id)
    except Exception as e:  # noqa: BLE001
        log.exception("speak failed")
        raise HTTPException(status_code=500, detail=f"tts failed: {e}")
    return {"audio": base64.b64encode(audio).decode(), "mime": "audio/mpeg", "tokens": tokens}


@app.post("/voice/enroll")
def voice_enroll(file: UploadFile = File(...)):
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty voice sample")
    sample_path = config.VOICE_STORAGE_DIR / "local.mp4"
    try:
        sample_path.write_bytes(data)
        voice_id = tts.enroll_voice(data, display_name="voice-local")
    except Exception as e:  # noqa: BLE001
        log.exception("voice enroll failed")
        raise HTTPException(status_code=500, detail=f"voice enroll failed: {e}")
    return {"voice_id": voice_id, "voice_source": "uploaded"}


class SelectVoiceBody(BaseModel):
    voice_id: str


@app.post("/voice/select")
def voice_select(body: SelectVoiceBody):
    if not tts.is_valid_voice(body.voice_id):
        raise HTTPException(status_code=400, detail="unknown voice")
    return {"voice_id": body.voice_id, "voice_source": "preset"}


# Mounted last so the explicit routes above win.
if SPA_DIST.is_dir():
    app.mount("/", StaticFiles(directory=SPA_DIST, html=True), name="spa")
else:
    @app.get("/")
    def root():
        return {"detail": "SPA not built - run `npx expo export -p web` in app/ (dev server: npx expo start --web)"}
