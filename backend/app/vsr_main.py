"""Chaplin AI vsr_lip_reader service: POST /api/execute_lips (clip -> VSR -> corrector),
and the Hebrew phrase store (enrol, list, drop)."""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import config, corrector, hebrew, phrases, vsr

# force=True: Modal configures logging before we import, which makes a plain
# basicConfig a no-op and silently drops every INFO line the decoder emits.
logging.basicConfig(level=logging.INFO, force=True)
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
    # localhost, plus this project's Vercel domains so preview deployments work
    # without redeploying the service for every new URL.
    allow_origin_regex=r"^https?://localhost(:\d+)?$|^https://(chaplin-ai|lip-reader)[a-z0-9-]*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ok(response: str, steps: list[dict]) -> dict:
    return {"status": "ok", "error": None, "response": response, "steps": steps}


def _err(message: str, code: str | None = None) -> dict:
    return {"status": "error", "error": message, "code": code, "response": None, "steps": []}


def _refused(why: hebrew.BadClip) -> dict:
    """A clip nobody can read, as the app shows it: the message, plus a code so the app
    can say it in the patient's language."""
    log.info("refused clip: %s (%s)", why, why.detail)
    if isinstance(why, hebrew.NoFace):
        code = "no_face"
    else:
        code = "still" if str(why).startswith("nothing moved") else "no_rest"
    return _err(str(why), code)


def _json_list(raw: str | None, item) -> list:
    """A JSON list form field, leniently: bad input means an empty list."""
    try:
        data = json.loads(raw) if raw else []
    except ValueError:
        return []
    return [x for x in data if item(x)] if isinstance(data, list) else []


def _examples(raw: str | None) -> list[dict]:
    return _json_list(raw, lambda m: isinstance(m, dict)
                      and isinstance(m.get("phrase"), str) and isinstance(m.get("model_output"), str))


def _notes(raw: str | None) -> list[str]:
    return _json_list(raw, lambda n: isinstance(n, str) and n.strip())


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
NOT_ENROLLED = "No phrases enrolled yet - teach a few phrases in Settings first"


def _takes(patient_key: str | None) -> hebrew.Takes:
    store = _template_store()
    rows = store.list_phrase_templates(patient_key) if store and patient_key else []
    return hebrew.Takes(rows)


def _read_english(path: str, fps: float, examples: list[dict], notes: list[str]) -> dict:
    transcript, alternatives = vsr.read(path)
    word_options = corrector.format_words(alternatives)
    model = corrector.top1(alternatives, transcript)
    vsr_step = {
        "module": "vsr",
        "prompt": {"input": "<video clip>", "fps": fps},
        "response": {"model": model, "word_options": word_options},
    }
    # a clip with no speech in it gives no words; asking the corrector about nothing
    # only gets "please provide the sentence" back, spoken aloud
    if not word_options.strip():
        return _err("Nothing read - try again", "nothing_read")
    corrected = corrector.correct(word_options, examples, notes)
    correct_step = {
        "module": "correct",
        "prompt": {"system": corrector.build_system_prompt(examples, notes), "input": f"Correct this:\n{word_options}"},
        "response": {"corrected": corrected},
    }
    return _ok(corrected, [vsr_step, correct_step])


def _match_hebrew(path: str, fps: float, patient_key: str | None, gender: str) -> dict:
    takes = _takes(patient_key)
    if takes.thresholds is None:
        return _err(NOT_ENROLLED, "not_enrolled")
    query = hebrew.normalise(*vsr.signatures(path), fps, takes.b_scale)
    ranked = hebrew.rank(query, takes.by_phrase(), takes.thresholds)
    confident = hebrew.decide(ranked, takes.thresholds)
    candidates = [
        {"id": pid, "text": phrases.phrase_text(pid, gender), "score": round(score, 4)}
        for pid, score, _, _ in ranked[: hebrew.TOP_K]
    ]
    steps = [
        {"module": "vsr", "prompt": {"input": "<video clip>", "language": "he", "fps": fps},
         "response": {"frames": int(len(query[0]))}},
        {"module": "match", "prompt": {"takes": len(takes.takes), "thresholds": takes.thresholds},
         "response": {"candidates": candidates, "confident": confident}},
    ]
    return {
        **_ok(candidates[0]["text"], steps),
        "confident": confident,
        "candidates": candidates,
        # the whole ranking, with both distances, so an attempt can be re-scored later
        "hebrew": {"ranked": [[p, round(sc, 4), round(d_a, 4), round(d_b, 4)] for p, sc, d_a, d_b in ranked],
                   "confident": confident},
    }


@app.post("/api/execute_lips")
def execute_lips(
    file: UploadFile = File(...),
    language: str = Form("en"),
    patient_key: str | None = Form(None),
    gender: str = Form("m"),
    duration_ms: float | None = Form(None),
    examples: str | None = Form(None),
    notes: str | None = Form(None),
):
    if config.DISABLE_VSR:
        return _err("Lip-reading is not available on this deployment (the VSR model is too large for serverless).")
    path = _save_upload(file)
    try:
        fps = vsr.clip_fps(path, duration_ms)
        if language == "he":
            return _match_hebrew(path, fps, patient_key, gender)
        return _read_english(path, fps, _examples(examples), _notes(notes))
    except hebrew.BadClip as why:
        return _refused(why)
    except Exception as e:  # noqa: BLE001
        log.exception("execute_lips failed")
        return _err(f"lip-reading failed: {e}")
    finally:
        # privacy: never persist video
        if os.path.exists(path):
            os.remove(path)


@app.post("/api/enroll_phrase")
def enroll_phrase(
    file: UploadFile = File(...),
    patient_key: str = Form(...),
    phrase_id: str = Form(...),
    duration_ms: float | None = Form(None),
):
    if config.DISABLE_VSR:
        return _err("Lip-reading is not available on this deployment.")
    store = _template_store()
    if not store:
        return _err(NO_STORE)
    if phrase_id not in phrases.phrase_ids():
        return _err(f"Unknown phrase: {phrase_id}")
    path = _save_upload(file)
    try:
        fps = vsr.clip_fps(path, duration_ms)
        a, b = vsr.signatures(path)
        lo, hi, _ = hebrew.trim(b, fps)  # a clip with no phrase in it raises before anything is written
        blob, n, d = hebrew.pack(a)
        geometry, _, _ = hebrew.pack(b)
        key = store.add_phrase_template(patient_key, phrase_id, blob, n, d, geometry, fps)
        log.info("take %s: the phrase is frames %d-%d of %d", key, lo, hi, n)
        takes = _takes(patient_key)
        return {"status": "ok", "error": None, "phrase_id": phrase_id, "takes": takes.count(phrase_id),
                "frames": n, "verdict": takes.verdict(str(key))}
    except hebrew.BadClip as why:
        return _refused(why)
    except Exception as e:  # noqa: BLE001
        log.exception("enroll_phrase failed")
        return _err(f"enrollment failed: {e}")
    finally:
        if os.path.exists(path):
            os.remove(path)


@app.get("/api/phrase_templates")
def phrase_templates(patient_key: str):
    """How the patient's phrases stand: takes per phrase, what the self-test makes of each,
    and the self-test's own tally."""
    store = _template_store()
    if not store:
        return {"status": "ok", "error": None, "takes": {}, "status_by_phrase": {}, "self_test": None, "storage": False}
    try:
        takes = _takes(patient_key)
    except Exception as e:  # noqa: BLE001
        log.exception("phrase_templates failed")
        return _err(f"template storage unavailable: {e}")
    counts = {pid: len(ts) for pid, ts in hebrew.by_phrase(takes.takes).items()}
    return {"status": "ok", "error": None, "takes": counts,
            "status_by_phrase": {pid: takes.status(pid) for pid in counts},
            "self_test": takes.self_test, "storage": True}


@app.delete("/api/phrase_templates")
def phrase_templates_delete(patient_key: str, phrase_id: str | None = None, last: bool = False):
    store = _template_store()
    if not store:
        return _err(NO_STORE)
    try:
        if last and phrase_id:
            deleted = int(store.delete_last_phrase_take(patient_key, phrase_id))
            return {"status": "ok", "error": None, "deleted": deleted,
                    "takes": _takes(patient_key).count(phrase_id)}
        return {"status": "ok", "error": None, "deleted": store.delete_phrase_templates(patient_key, phrase_id)}
    except Exception as e:  # noqa: BLE001
        log.exception("phrase_templates delete failed")
        return _err(f"template storage unavailable: {e}")
