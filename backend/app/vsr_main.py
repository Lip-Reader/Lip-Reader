"""Chaplin AI vsr_lip_reader service: POST /api/execute_lips (clip -> VSR -> agent)."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import config, phrases, vsr
from .agent import run_agent

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chaplin.vsr_api")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # warm the VSR model at startup so the first clip doesn't pay the load time
    if not config.DISABLE_VSR:
        threading.Thread(target=vsr.get_model, daemon=True).start()
    yield


app = FastAPI(title="Chaplin AI - VSR lip reader", version="2.0.0", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=r"^https?://localhost(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


FRAME_SIZE = 640  # longest side after downscale; face detection cost scales with pixels
MODEL_FPS = 25    # what the VSR model was trained on


def _decode_clip(src: str) -> "np.ndarray":
    """Decode a browser clip straight into (T, H, W, 3) RGB frames at 25 fps, downscaled
    and letterboxed to FRAME_SIZE x FRAME_SIZE: one ffmpeg pass, no re-encode, no second file."""
    import numpy as np

    vf = (
        f"fps={MODEL_FPS},"
        f"scale={FRAME_SIZE}:{FRAME_SIZE}:force_original_aspect_ratio=decrease,"
        f"pad={FRAME_SIZE}:{FRAME_SIZE}:(ow-iw)/2:(oh-ih)/2"
    )
    try:
        proc = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", src, "-vf", vf, "-an",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True, timeout=60,
        )
        n = len(proc.stdout) // (FRAME_SIZE * FRAME_SIZE * 3)
        if proc.returncode == 0 and n > 0:
            return np.frombuffer(proc.stdout, np.uint8)[: n * FRAME_SIZE * FRAME_SIZE * 3].reshape(
                n, FRAME_SIZE, FRAME_SIZE, 3
            )
        log.warning("ffmpeg decode failed, falling back to OpenCV: %s", proc.stderr.decode(errors="replace"))
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("ffmpeg unavailable, falling back to OpenCV: %s", e)
    import cv2
    from pipelines.video_io import read_video_frames

    frames = read_video_frames(src)
    if len(frames) and max(frames.shape[1:3]) > FRAME_SIZE:
        k = FRAME_SIZE / max(frames.shape[1:3])
        size = (int(frames.shape[2] * k) // 2 * 2, int(frames.shape[1] * k) // 2 * 2)
        frames = np.stack([cv2.resize(f, size, interpolation=cv2.INTER_AREA) for f in frames])
    return frames


def _ok(response: str, steps: list[dict]) -> dict:
    return {"status": "ok", "error": None, "response": response, "steps": steps}


def _err(message: str) -> dict:
    return {"status": "error", "error": message, "response": None, "steps": []}


def _parse_conversation(raw: str | None) -> list[dict]:
    """Lenient parse of the optional JSON conversation field; bad input -> no history."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(data, list):
        return []
    return [
        {"role": m["role"], "content": m["content"]}
        for m in data
        if isinstance(m, dict)
        and m.get("role") in ("self", "other")
        and isinstance(m.get("content"), str)
    ]


@app.get("/health")
def health():
    return {"status": "ok", "vsr_available": not config.DISABLE_VSR}


def _save_upload(file: UploadFile) -> str:
    suffix = ".webm" if (file.content_type or "").endswith("webm") or (
        file.filename or ""
    ).endswith(".webm") else ".mp4"
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(file.file.read())
    return path


def _template_store():
    """db module if template storage is configured, else None (the VSR service may run without a database)."""
    if not config.DATABASE_URL:
        return None
    from . import db
    return db


NO_STORE = "Template storage is not configured."
NO_TEMPLATES = "No Hebrew phrases are enrolled yet. Teach a few phrases in Settings first."


def _patient_templates(patient_key: str | None) -> dict:
    store = _template_store()
    if not store or not patient_key:
        return {}
    out: dict[str, list] = {}
    for row in store.list_phrase_templates(patient_key):
        out.setdefault(row["phrase_id"], []).append(
            phrases.unpack(bytes(row["features"]), row["frames"], row["dim"])
        )
    return out


def _recognise_phrase(frames, patient_key: str | None, gender: str) -> dict:
    feats = phrases.downsample(vsr.extract_features(frames))
    own = _patient_templates(patient_key)
    seed = phrases.load_seed()
    templates = phrases.merge_templates(own, seed)
    if not templates:
        return _err(NO_TEMPLATES)
    ranked = phrases.rank(feats, templates)
    confident = phrases.decide(ranked)
    candidates = [
        {"id": pid, "text": phrases.phrase_text(pid, gender), "score": round(score, 4)}
        for pid, score in ranked[: phrases.TOP_K]
    ]
    steps = [
        {"module": "vsr", "prompt": {"input": "<video clip>", "language": "he"},
         "response": {"frames": int(feats.shape[0]), "dim": int(feats.shape[1])}},
        {"module": "match", "prompt": {"templates": sum(len(t) for t in own.values()),
                                       "seed": sum(len(t) for t in seed.values())},
         "response": {"candidates": candidates, "confident": confident}},
    ]
    return {**_ok(candidates[0]["text"], steps), "confident": confident, "candidates": candidates}


@app.post("/api/execute_lips")
def execute_lips(
    file: UploadFile = File(...),
    conversation: str | None = Form(None),
    language: str = Form("en"),
    patient_key: str | None = Form(None),
    gender: str = Form("m"),
):
    if config.DISABLE_VSR:
        return _err("Lip-reading is not available on this deployment (the VSR model is too large for serverless).")
    path = _save_upload(file)
    try:
        frames = _decode_clip(path)
        if language == "he":
            try:
                return _recognise_phrase(frames, patient_key, gender)
            except vsr.NoFaceError:
                return _err("No face detected in the clip. Please try again.")
            except vsr.NoSpeechError:
                return _err("Didn't catch any speech in the clip. Please try again.")
        try:
            raw = vsr.transcribe_clip(frames)
        except vsr.NoFaceError:
            return _err("No face detected in the clip. Please try again.")
        except vsr.NoSpeechError:
            return _err("Didn't catch any speech in the clip. Please try again.")
        vsr_step = {
            "module": "vsr",
            "prompt": {"input": "<video clip>"},
            "response": {"raw_transcription": raw},
        }
        result = run_agent(raw, _parse_conversation(conversation))
        return _ok(result["response"], [vsr_step, *result["steps"]])
    except Exception as e:  # noqa: BLE001
        log.exception("execute_lips failed")
        return _err(f"lip-reading failed: {e}")
    finally:
        # privacy: never persist video
        if os.path.exists(path):
            os.remove(path)


@app.post("/api/enroll_phrase")
def enroll_phrase(file: UploadFile = File(...), patient_key: str = Form(...), phrase_id: str = Form(...)):
    if config.DISABLE_VSR:
        return _err("Lip-reading is not available on this deployment.")
    store = _template_store()
    if not store:
        return _err(NO_STORE)
    if phrase_id not in phrases.phrase_ids():
        return _err(f"Unknown phrase: {phrase_id}")
    path = _save_upload(file)
    try:
        feats = phrases.downsample(vsr.extract_features(_decode_clip(path)))
        blob, n, d = phrases.pack(feats)
        takes = store.add_phrase_template(patient_key, phrase_id, blob, n, d, phrases.MAX_TAKES)
        return {"status": "ok", "error": None, "phrase_id": phrase_id, "takes": takes, "frames": n}
    except vsr.NoFaceError:
        return _err("No face detected in the clip. Please try again.")
    except vsr.NoSpeechError:
        return _err("Didn't catch any speech in the clip. Please try again.")
    except Exception as e:  # noqa: BLE001
        log.exception("enroll_phrase failed")
        return _err(f"enrollment failed: {e}")
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.get("/api/phrase_templates")
def phrase_templates(patient_key: str):
    seed_phrases = sorted(phrases.load_seed().keys())
    store = _template_store()
    if not store:
        return {"status": "ok", "error": None, "takes": {}, "seed_phrases": seed_phrases, "storage": False}
    try:
        takes = store.count_phrase_takes(patient_key)
    except Exception as e:  # noqa: BLE001
        log.exception("phrase_templates failed")
        return _err(f"template storage unavailable: {e}")
    return {"status": "ok", "error": None, "takes": takes, "seed_phrases": seed_phrases, "storage": True}


@app.delete("/api/phrase_templates")
def phrase_templates_delete(patient_key: str, phrase_id: str | None = None):
    store = _template_store()
    if not store:
        return _err(NO_STORE)
    try:
        return {"status": "ok", "error": None, "deleted": store.delete_phrase_templates(patient_key, phrase_id)}
    except Exception as e:  # noqa: BLE001
        log.exception("phrase_templates delete failed")
        return _err(f"template storage unavailable: {e}")
