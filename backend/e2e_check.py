"""End-to-end check for both FastAPI apps (in-process TestClient), PASS/FAIL per stage.

Run:  uv run python backend/e2e_check.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.app import config  # noqa: E402

CAPTURE_SECONDS = 4
FPS = 16
EXECUTE_PROMPT = "IM SO EXCITED TO ME YOU TODAY"


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

    ok = {"env": False, "team_info": False, "agent_info": False,
          "architecture": False, "execute": False, "execute_conv": False,
          "execute_lips": False, "speak": False, "chat_store": False}

    step("1/9  Environment")
    print(f"ANTHROPIC_API_KEY: {'set' if config.ANTHROPIC_API_KEY else 'MISSING'}")
    print(f"INWORLD_API_KEY  : {'set' if config.INWORLD_API_KEY else 'MISSING'}")
    weights_ok = os.path.isfile(
        os.path.join(config.REPO_ROOT, "benchmarks/LRS3/models/LRS3_V_WER19.1/model.pth")
    )
    print(f"VSR weights      : {'present' if weights_ok else 'MISSING'}")
    ok["env"] = bool(config.ANTHROPIC_API_KEY and config.INWORLD_API_KEY and weights_ok)

    client = TestClient(app)

    step("2/9  GET /api/team_info")
    r = client.get("/api/team_info")
    body = r.json() if r.status_code == 200 else {}
    ok["team_info"] = (
        r.status_code == 200
        and body.get("group_batch_order_number") == "1_1"
        and body.get("team_name") == "Chaplin AI"
        and len(body.get("students", [])) == 2
    )
    print(f"status: {r.status_code}  team: {body.get('team_name')!r}  students: {len(body.get('students', []))}")

    step("3/9  GET /api/agent_info")
    r = client.get("/api/agent_info")
    body = r.json() if r.status_code == 200 else {}
    ok["agent_info"] = (
        r.status_code == 200
        and all(k in body for k in ("description", "purpose", "prompt_template", "prompt_examples"))
        and "template" in body["prompt_template"]
        and all(k in body["prompt_examples"][0] for k in ("prompt", "full_response", "steps"))
    )
    print(f"status: {r.status_code}  keys: {sorted(body.keys())}")

    step("4/9  GET /api/model_architecture")
    r = client.get("/api/model_architecture")
    ok["architecture"] = r.status_code == 200 and r.headers.get("content-type", "").startswith("image/png")
    print(f"status: {r.status_code}  content-type: {r.headers.get('content-type')}  bytes: {len(r.content)}")

    step("5/9  POST /api/execute")
    t0 = time.time()
    r = client.post("/api/execute", json={"prompt": EXECUTE_PROMPT})
    dt = time.time() - t0
    body = r.json() if r.status_code == 200 else {}
    steps_ok = (
        body.get("steps")
        and all({"module", "prompt", "response"} <= set(s) for s in body["steps"])
        and {s["module"] for s in body["steps"]} <= {"correct"}
    )
    ok["execute"] = r.status_code == 200 and body.get("status") == "ok" and bool(body.get("response")) and bool(steps_ok)
    print(f"status: {r.status_code}  latency: {dt:.1f}s")
    print(f"prompt   : {EXECUTE_PROMPT!r}")
    print(f"response : {body.get('response')!r}")
    print(f"steps    : {[s['module'] for s in body.get('steps', [])]}")
    r = client.post("/api/execute", json={"prompt": ""})
    err = r.json()
    if not (err.get("status") == "error" and err.get("response") is None and err.get("steps") == []):
        ok["execute"] = False
        print("ERROR-shape check failed:", err)

    step("6/9  POST /api/execute (with conversation - contextual correction)")
    conversation = [
        {"role": "other", "content": "The nurse has your evening medication ready."},
        {"role": "self", "content": "Thank you, I was waiting for it."},
    ]
    t0 = time.time()
    r = client.post("/api/execute", json={"prompt": "WHERES MY BILL", "conversation": conversation})
    dt = time.time() - t0
    body = r.json() if r.status_code == 200 else {}
    modules = [s["module"] for s in body.get("steps", [])]
    ok["execute_conv"] = (
        r.status_code == 200
        and body.get("status") == "ok"
        and modules == ["correct"]
        and "pill" in (body.get("response") or "").lower()
    )
    print(f"status: {r.status_code}  latency: {dt:.1f}s")
    print("prompt   : 'WHERES MY BILL'  context: nurse/medication")
    print(f"response : {body.get('response')!r}")
    print(f"steps    : {modules}")

    step("7/9  POST /api/execute_lips (vsr_lip_reader service)")
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
            ok["execute_lips"] = (
                bool(body.get("response"))
                and steps and steps[0]["module"] == "vsr"
                and all({"module", "prompt", "response"} <= set(s) for s in steps)
            )
            print(f"response : {body.get('response')!r}")
            print(f"steps    : {[s['module'] for s in steps]}")
            speak_text = body.get("response") or speak_text
        else:
            # no face / no speech -> the error shape is the correct outcome
            shape_ok = body.get("response") is None and body.get("steps") == [] and body.get("error")
            ok["execute_lips"] = bool(shape_ok)
            print(f"error    : {body.get('error')!r} (valid error shape - no face/speech in clip)")
    finally:
        if os.path.exists(clip_path):
            os.remove(clip_path)

    step("8/9  POST /speak")
    r = client.post("/speak", json={"text": speak_text})
    if r.status_code == 200 and r.json().get("audio"):
        body = r.json()
        ok["speak"] = True
        print(f"status: 200  audio bytes: {len(body['audio']) * 3 // 4}  word timestamps: {len(body.get('tokens', []))}")
    else:
        print(f"status: {r.status_code} {r.text[:200]}")

    step("9/9  Chat store (Supabase /api/chats + /api/db_ping)")
    try:
        t0 = time.time()
        r = client.get("/api/db_ping")
        ping_ok = r.status_code == 200 and r.json().get("db") == 1
        print(f"db_ping  : {r.status_code}  latency: {time.time() - t0:.1f}s")
        chat = client.post("/api/chats", json={}).json()
        client.post(f"/api/chats/{chat['id']}/messages",
                    json={"role": "other", "content": "e2e check message"})
        msgs = client.get(f"/api/chats/{chat['id']}/messages").json()["messages"]
        conversations = client.get("/api/chats").json()["conversations"]
        listed = any(c["id"] == chat["id"] for c in conversations)
        deleted = client.delete(f"/api/chats/{chat['id']}").status_code == 200
        presets = [c for c in conversations if c["is_preset"]]
        preset_guard = (
            len(presets) == 6
            and client.delete(f"/api/chats/{presets[0]['id']}").status_code == 403
            and client.post(f"/api/chats/{presets[0]['id']}/messages",
                            json={"role": "self", "content": "x"}).status_code == 403
        )
        ok["chat_store"] = bool(ping_ok and len(msgs) == 1 and listed and deleted and preset_guard)
        print(f"create/append/list/delete: {bool(len(msgs) == 1 and listed and deleted)}")
        print(f"presets seeded + protected (6, no delete/append): {preset_guard}")
    except Exception as e:  # noqa: BLE001
        print(f"chat store check failed: {e}")

    print("\n" + "=" * 44)
    print(" CHAPLIN AI BACKEND E2E")
    print("=" * 44)
    for k, v in ok.items():
        print(f"  {k:13s}: {'PASS' if v else 'FAIL'}")
    allpass = all(ok.values())
    print("=" * 44)
    print(" OVERALL:", "PASS" if allpass else "FAIL")
    return 0 if allpass else 1


if __name__ == "__main__":
    sys.exit(main())
