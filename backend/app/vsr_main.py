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

from . import config, vsr
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


@app.post("/api/execute_lips")
def execute_lips(file: UploadFile = File(...), conversation: str | None = Form(None)):
    if config.DISABLE_VSR:
        return _err("Lip-reading is not available on this deployment (the VSR model is too large for serverless).")
    suffix = ".webm" if (file.content_type or "").endswith("webm") or (
        file.filename or ""
    ).endswith(".webm") else ".mp4"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(file.file.read())
        frames = _decode_clip(path)
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
