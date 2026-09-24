"""End-to-end check for both FastAPI apps (in-process TestClient), PASS/FAIL per stage.

Run:  uv run python backend/tests/e2e_check.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.app import config  # noqa: E402

CAPTURE_SECONDS = 4
FPS = 16


def step(msg: str) -> None:
    print(f"\n=== {msg} ===", flush=True)


def make_clip() -> tuple[str, str]:
    import cv2
    import numpy as np

    path = os.path.join(tempfile.gettempdir(), "chaplin_e2e.mp4")
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 480
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (w, h), True)
        frames = 0
        deadline = time.time() + CAPTURE_SECONDS
        while time.time() < deadline:
            ok, frame = cap.read()
            if not ok:
                break
            writer.write(frame)
            frames += 1
        cap.release()
        writer.release()
        if frames > 0:
            print(f"captured {frames} webcam frames ({w}x{h})")
            return path, "webcam"
    cap.release()

    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (256, 256), True)
    for _ in range(FPS * 2):
        writer.write(np.zeros((256, 256, 3), np.uint8))
    writer.release()
    print("no camera available - using synthetic clip")
    return path, "synthetic"


def main() -> int:
    from fastapi.testclient import TestClient

    from backend.app.main import app
    from backend.app.vsr_main import app as vsr_app

    ok = {"env": False, "team_info": False, "agent_info": False, "architecture": False,
          "settings_public": False, "support": False, "runs": False, "auth_guard": False,
          "execute_lips": False, "speak": False, "db_ping": False,
          "phrases": False, "voices_he": False, "execute_lips_he": False, "enroll_phrase": False,
          "phrase_templates": False}

    step("1/16  Environment")
    print(f"ANTHROPIC_API_KEY: {'set' if config.ANTHROPIC_API_KEY else 'MISSING'}")
    print(f"INWORLD_API_KEY  : {'set' if config.INWORLD_API_KEY else 'MISSING'}")
    print(f"DATABASE_URL     : {'set' if config.DATABASE_URL else 'MISSING'}")
    print(f"CLERK_SECRET_KEY : {'set' if config.CLERK_SECRET_KEY else 'unset (guest-only)'}")
    weights_ok = os.path.isfile(
        os.path.join(config.REPO_ROOT, "benchmarks/LRS3/models/LRS3_V_WER19.1/model.pth")
    )
    print(f"VSR weights      : {'present' if weights_ok else 'MISSING'}")
    ok["env"] = bool(config.ANTHROPIC_API_KEY and config.INWORLD_API_KEY and config.DATABASE_URL and weights_ok)

    client = TestClient(app)

    step("2/16  GET /api/team_info")
    r = client.get("/api/team_info")
    body = r.json() if r.status_code == 200 else {}
    ok["team_info"] = (
        r.status_code == 200
        and body.get("group_batch_order_number") == "1_1"
        and body.get("team_name") == "Chaplin AI"
        and len(body.get("students", [])) == 2
    )
    print(f"status: {r.status_code}  team: {body.get('team_name')!r}  students: {len(body.get('students', []))}")

    step("3/16  GET /api/agent_info")
    r = client.get("/api/agent_info")
    body = r.json() if r.status_code == 200 else {}
    ok["agent_info"] = (
        r.status_code == 200
        and all(k in body for k in ("description", "purpose", "prompt_template", "prompt_examples"))
        and "template" in body["prompt_template"]
        and all(k in body["prompt_examples"][0] for k in ("prompt", "full_response", "steps"))
    )
    print(f"status: {r.status_code}  keys: {sorted(body.keys())}")

    step("4/16  GET /api/model_architecture")
    r = client.get("/api/model_architecture")
    ok["architecture"] = r.status_code == 200 and r.headers.get("content-type", "").startswith("image/png")
    print(f"status: {r.status_code}  content-type: {r.headers.get('content-type')}  bytes: {len(r.content)}")

    step("5/16  GET /api/settings/public")
    t0 = time.time()
    r = client.get("/api/settings/public")
    body = r.json() if r.status_code == 200 else {}
    ok["settings_public"] = (
        r.status_code == 200
        and isinstance(body.get("default_voice_id"), str)
        and isinstance(body.get("lip_reading_enabled"), bool)
    )
    print(f"status: {r.status_code}  latency: {time.time() - t0:.1f}s  body: {body or r.text[:120]}")

    step("6/16  POST /api/support (guest)")
    r = client.post("/api/support", json={"message": "e2e check message"})
    body = r.json() if r.status_code == 200 else {}
    empty = client.post("/api/support", json={"message": "  "}).status_code
    ok["support"] = r.status_code == 200 and isinstance(body.get("id"), int) and empty == 400
    print(f"status: {r.status_code}  id: {body.get('id')}  empty-message -> {empty}")

    step("7/16  POST /api/runs (guest)")
    r = client.post("/api/runs", json={
        "raw": "HELLO WORLD", "corrected": "Hello world.", "latency_ms": 1200,
        "word_options": "HELLO(91%)/FELLOW(5%) WORLD(88%)", "notes": ["Keeps bees"],
        "clip_fps": 29.9, "truth": "Hello world.", "hebrew": None,
    })
    body = r.json() if r.status_code == 200 else {}
    ok["runs"] = r.status_code == 200 and isinstance(body.get("id"), int)
    print(f"status: {r.status_code}  id: {body.get('id')}")

    step("8/16  Auth guards (no token)")
    me = client.get("/api/me/settings")
    adm = client.get("/api/admin/overview")
    expected = 401 if config.CLERK_SECRET_KEY else 503
    ok["auth_guard"] = me.status_code == expected and adm.status_code == expected
    print(f"expected {expected} ({'clerk configured' if config.CLERK_SECRET_KEY else 'auth not configured'})")
    print(f"GET /api/me/settings   -> {me.status_code} {me.json().get('detail')!r}")
    print(f"GET /api/admin/overview -> {adm.status_code} {adm.json().get('detail')!r}")
    if config.CLERK_SECRET_KEY:
        bad = client.get("/api/me/settings", headers={"Authorization": "Bearer not-a-token"})
        ok["auth_guard"] = ok["auth_guard"] and bad.status_code == 401
        print(f"GET /api/me/settings (bogus token) -> {bad.status_code}")

    step("9/16  POST /api/execute_lips (vsr_lip_reader service)")
    vsr_client = TestClient(vsr_app)
    clip_path, kind = make_clip()
    speak_text = "Hello from Chaplin."
    try:
        t0 = time.time()
        with open(clip_path, "rb") as f:
            r = vsr_client.post("/api/execute_lips", files={"file": ("clip.mp4", f, "video/mp4")})
        dt = time.time() - t0
        body = r.json() if r.status_code == 200 else {}
        print(f"status: {r.status_code}  latency: {dt:.1f}s  clip: {kind}")
        if body.get("status") == "ok":
            steps = body.get("steps", [])
            vsr_step = steps[0] if steps else {}
            ok["execute_lips"] = (
                bool(body.get("response"))
                and vsr_step.get("module") == "vsr"
                and {"model", "word_options"} <= set(vsr_step.get("response", {}))
                and all({"module", "prompt", "response"} <= set(s) for s in steps)
            )
            print(f"read     : {vsr_step.get('response', {}).get('model')!r}")
            print(f"options  : {vsr_step.get('response', {}).get('word_options')!r}")
            print(f"response : {body.get('response')!r}")
            print(f"steps    : {[s['module'] for s in steps]}")
            speak_text = body.get("response") or speak_text
        else:
            # no face / nothing read -> the error shape, with its code, is the correct outcome
            shape_ok = (body.get("response") is None and body.get("steps") == []
                        and body.get("error") and body.get("code"))
            ok["execute_lips"] = bool(shape_ok)
            print(f"error    : {body.get('error')!r} code: {body.get('code')!r}"
                  f" (valid error shape - no face/nothing read in clip)")
    finally:
        if os.path.exists(clip_path):
            os.remove(clip_path)

    step("10/16  POST /speak")
    r = client.post("/speak", json={"text": speak_text})
    if r.status_code == 200 and r.json().get("audio"):
        body = r.json()
        ok["speak"] = True
        print(f"status: 200  audio bytes: {len(body['audio']) * 3 // 4}  word timestamps: {len(body.get('tokens', []))}")
    else:
        print(f"status: {r.status_code} {r.text[:200]}")

    step("11/16  GET /api/db_ping")
    t0 = time.time()
    r = client.get("/api/db_ping")
    ok["db_ping"] = r.status_code == 200 and r.json().get("db") == 1
    print(f"status: {r.status_code}  latency: {time.time() - t0:.1f}s")

    step("12/16  GET /api/phrases/he")
    r = client.get("/api/phrases/he")
    body = r.json() if r.status_code == 200 else {}
    ok["phrases"] = r.status_code == 200 and len(body.get("phrases", [])) == 100 and len(body.get("groups", [])) == 10
    print(f"status: {r.status_code}  phrases: {len(body.get('phrases', []))}  groups: {len(body.get('groups', []))}"
          f"  unknown lang -> {client.get('/api/phrases/xx').status_code}")

    step("13/16  GET /voices?lang=he")
    r = client.get("/voices", params={"lang": "he"})
    he = [v["id"] for v in (r.json().get("voices", []) if r.status_code == 200 else [])]
    en = [v["id"] for v in client.get("/voices").json().get("voices", [])]
    ok["voices_he"] = r.status_code == 200 and (not config.INWORLD_API_KEY or bool(he)) and all(v not in en for v in he)
    print(f"status: {r.status_code}  hebrew voices: {he}  english voices: {len(en)}")

    step("14/16  POST /api/execute_lips (language=he)")
    clip_path, kind = make_clip()
    try:
        t0 = time.time()
        with open(clip_path, "rb") as f:
            r = vsr_client.post("/api/execute_lips", files={"file": ("clip.mp4", f, "video/mp4")},
                                data={"language": "he", "patient_key": "e2e-check", "gender": "m"})
        body = r.json() if r.status_code == 200 else {}
        print(f"status: {r.status_code}  latency: {time.time() - t0:.1f}s  clip: {kind}")
        if body.get("status") == "ok":
            ranked = (body.get("hebrew") or {}).get("ranked", [])
            ok["execute_lips_he"] = (
                isinstance(body.get("candidates"), list) and len(body["candidates"]) <= 3
                and isinstance(body.get("confident"), bool)
                and all(len(row) == 4 for row in ranked)
                and [s["module"] for s in body.get("steps", [])] == ["vsr", "match"]
            )
            print(f"response : {body.get('response')!r}  confident: {body.get('confident')}"
                  f"  candidates: {body.get('candidates')}  ranked: {len(ranked)} phrases")
        else:
            ok["execute_lips_he"] = bool(body.get("response") is None and body.get("steps") == []
                                         and body.get("error") and body.get("code"))
            print(f"error    : {body.get('error')!r} code: {body.get('code')!r}"
                  f" (valid error shape - no face, still clip, or nothing enrolled)")

        step("15/16  POST /api/enroll_phrase")
        t0 = time.time()
        with open(clip_path, "rb") as f:
            r = vsr_client.post("/api/enroll_phrase", files={"file": ("clip.mp4", f, "video/mp4")},
                                data={"patient_key": "e2e-check", "phrase_id": "basics_yes"})
        body = r.json() if r.status_code == 200 else {}
        print(f"status: {r.status_code}  latency: {time.time() - t0:.1f}s")
        if body.get("status") == "ok":
            verdict = body.get("verdict") or {}
            ok["enroll_phrase"] = (
                isinstance(body.get("takes"), int) and body.get("phrase_id") == "basics_yes"
                and verdict.get("code") in ("first_take", "ok", "confused")
            )
            print(f"takes    : {body.get('takes')}  frames: {body.get('frames')}  verdict: {verdict}")
        else:
            ok["enroll_phrase"] = bool(body.get("response") is None and body.get("error"))
            print(f"error    : {body.get('error')!r} code: {body.get('code')!r}"
                  f" (valid error shape - no face, still clip, or storage not configured)")
        bad = vsr_client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                              data={"patient_key": "e2e-check", "phrase_id": "nope"}).json()
        ok["enroll_phrase"] = ok["enroll_phrase"] and bad.get("status") == "error"
        print(f"unknown phrase -> {bad.get('error')!r}")
    finally:
        if os.path.exists(clip_path):
            os.remove(clip_path)

    step("16/16  GET/DELETE /api/phrase_templates")
    r = vsr_client.get("/api/phrase_templates", params={"patient_key": "e2e-check"})
    body = r.json() if r.status_code == 200 else {}
    d = vsr_client.delete("/api/phrase_templates", params={"patient_key": "e2e-check"}).json()
    ok["phrase_templates"] = (
        r.status_code == 200 and body.get("status") == "ok" and isinstance(body.get("takes"), dict)
        and isinstance(body.get("status_by_phrase"), dict) and "self_test" in body
        and (d.get("status") == "ok" or not config.DATABASE_URL)
    )
    print(f"status: {r.status_code}  takes: {body.get('takes')}  storage: {body.get('storage')}"
          f"  status by phrase: {body.get('status_by_phrase')}  self-test: {body.get('self_test')}"
          f"  cleanup deleted: {d.get('deleted')}")

    print("\n" + "=" * 44)
    print(" CHAPLIN AI BACKEND E2E")
    print("=" * 44)
    for k, v in ok.items():
        print(f"  {k:16s}: {'PASS' if v else 'FAIL'}")
    allpass = all(ok.values())
    print("=" * 44)
    print(" OVERALL:", "PASS" if allpass else "FAIL")
    return 0 if allpass else 1


if __name__ == "__main__":
    sys.exit(main())
