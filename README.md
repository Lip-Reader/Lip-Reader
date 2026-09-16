# Chaplin AI

Chaplin AI helps non-vocal, ventilated patients communicate. The user taps **Talk**,
silently mouths a sentence to the camera, and Chaplin lip-reads it, corrects it with
a single LLM call, shows one clean line of text, and — on **Speak** — voices it back
in the user's chosen voice. A **Run Agent** panel also accepts plain text input
(presets or free text), so the agent can be exercised without a camera.

A **Chat** lets the user hold a conversation with a second character: messages from
the other person are typed in, predictions become the user's own messages, and the
last 10 messages are passed to the corrector as short-term memory, so it can pick a
visually similar word when one fits the conversation better (e.g. "Where's my bill?"
→ "Where's my pill?" after a nurse mentioned medication). Chats persist in Supabase
Postgres (sigma-style `chat_memory` + `chat_messages` tables) behind `/api/chats`; a
scheduled job pings `/api/db_ping` every 5 minutes so the free-tier database never
pauses.

```
webcam clip ─▶ vsr (Auto-AVSR) ─▶ correct ─▶ response + steps ─▶ GUI / TTS
                                      ▲
                                      └── chat history (last 10)
```

## Architecture (monorepo)

| Path        | What it is                                                                 |
|-------------|----------------------------------------------------------------------------|
| `backend/`  | FastAPI service (`backend/app/`) + vendored VSR internals (`backend/pipelines/`, `backend/espnet/` — upstream, not rewritten). |
| `backend/app/agent/` | Single-pass corrector agent (LangChain `create_agent`): `agent.py`, `prompts.py`. |
| `app/`      | React + TypeScript + Vite SPA. The browser owns the camera; the built SPA is served by the backend at `/`. |
| `assets/`   | Brand images, VSR config, test-video ground truths, presentation, `architecture.png`. |
| `tests/`    | Eval suite (word-overlap F1) for the full clip → agent path. |

**Privacy:** uploaded clips are processed in a temp file and deleted in a `finally`
block immediately after inference. Video is never persisted; only text leaves the
device (chat text is stored in the Supabase chat store).

### API endpoints (no auth)

| Method & path                | Purpose                                                            |
|------------------------------|--------------------------------------------------------------------|
| `GET  /api/team_info`        | student details                                                    |
| `GET  /api/agent_info`       | agent description, purpose, prompt template + real examples        |
| `GET  /api/model_architecture` | architecture diagram (PNG)                                       |
| `POST /api/execute`          | `{ prompt, conversation? }` → `{ status, error, response, steps }` (text → agent) |
| `POST /api/execute_lips`     | mp4/webm clip (+ optional `conversation` form field) → same shape (VSR → agent); steps start with `vsr` |
| `POST /speak`                | `{ text, voice_id }` → audio + word timestamps (Inworld TTS)       |
| `GET  /voices` · `POST /voice/select` · `POST /voice/enroll` | voice catalog / selection / cloning |
| `GET/POST /api/chats` · `DELETE /api/chats/{id}` · `GET/POST /api/chats/{id}/messages` | Supabase-backed chat store (conversations + messages) |
| `GET  /api/db_ping`          | keep-alive `SELECT 1` (hit by a 5-min scheduled job)               |
| `GET  /health`               | liveness                                                           |

`steps` lists every model call in order as `{ module, prompt, response }`, with
module names (`vsr`, `correct`) matching `assets/architecture.png`.
`conversation` is an optional `[{ "role": "self"|"other", "content": "..." }]`
history window (the client sends the active chat's last 10 messages).

## Prerequisites

- Python deps via **uv**; Node 18+ for the SPA.
- VSR weights under `benchmarks/LRS3/` (see paths in `assets/configs/LRS3_V_WER19.1.ini`).
- Secrets in `.env` (gitignored) — copy `.env.example`:
  `ANTHROPIC_API_KEY`, `INWORLD_API_KEY`, optional `INWORLD_VOICE_ID`.

## Run it

```powershell
uv sync
cd app; npm install; npm run build; cd ..   # build the SPA once
uv run uvicorn backend.app.main:app --port 8000
```

Open `http://localhost:8000` — the GUI is served at the root URL. The VSR model
warms up in the background at startup.

For frontend development with hot reload:

```powershell
cd app
npm run dev              # http://localhost:5173 (talks to the backend on :8000)
```

## Brand assets

Logos live in `assets/brand/`; the app's served copies (favicon, app icons) live
in `app/public/`.

## Verification

```powershell
# Backend end-to-end: all /api/* endpoints + clip -> /api/execute_lips -> /speak.
uv run python backend/e2e_check.py

# Eval suite (word-overlap F1) — needs SRAVI test videos present:
uv run --extra test pytest tests/ -v -s
```
