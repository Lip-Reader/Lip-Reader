# CLAUDE.md — Chaplin AI

Guidance for Claude Code in this repo. See [PRD.md](PRD.md) for the product.

**Chaplin AI** helps non-vocal, ventilated patients communicate: it lip-reads them
and speaks the result back in a representative voice. It began as a fork of the
`chaplin` repo (a lip-reading model + LLM corrector) and is evolving into an
**agent** whose job is *reliable* communication — when unsure it asks rather than
asserting a wrong sentence.

## Architecture (high level)
```
webcam ─▶ short mp4 clip ─▶ vsr (Auto-AVSR lip-reading)
                                        │
                                        ▼
                  single-pass corrector agent: correct (sees chat history)
                                        │
                                        ▼
                on-screen text + steps trace  +  optional TTS voice clone
```
- Conversations (second character): chats persist in Supabase Postgres
  (`backend/app/db.py`, sigma-agent-server-style `chat_memory`/`chat_messages`
  + last-10 window) behind `/api/chats`; `app/src/lib/chat.ts` is the API
  client. `/api/execute` and `/api/execute_lips` take an optional
  `conversation` history that the `correct` call always sees. `GET /api/db_ping`
  (SELECT 1) is hit every 5 min by `.github/workflows/db-keepalive.yml` so the
  free-tier DB never pauses. Six demo presets (noisy sentence as title + one
  other-message) are seeded by the DDL in `db.py` with `is_preset = TRUE` —
  delete/append return 403; the Run Agent modal offers "Demo presets" (2 need
  context, 4 don't) vs "Free text" (optional chat) modes.
- Three services:
  1. **SPA** (`app/`) — static, on Vercel.
  2. **API backend** (`backend/app/main.py`, FastAPI) — `/api/team_info`,
     `/api/agent_info`, `/api/model_architecture`, `POST /api/execute`, TTS/voices.
     No VSR/torch. On Vercel as a Python function (`api/index.py`, deps from
     root `requirements.txt`; `.vercelignore` hides pyproject/uv.lock + VSR code).
  3. **vsr_lip_reader service** (`backend/app/vsr_main.py`, FastAPI) —
     `POST /api/execute_lips` + `/health` only (VSR → agent, GPU). On Modal
     (`modal_app.py`), local dev port 8001 (launch config `chaplin-vsr`).
- Agent: `backend/app/agent/` — `agent.py` (LangChain `create_agent`, single
  `correct` call, ChatAnthropic), `prompts.py` (the corrector's system prompt).
- React SPA: `app/`. The browser owns the camera (getUserMedia/MediaRecorder).
  "Run Agent" panel = text entry to the agent; About modal explains the system.
- VSR model: `backend/pipelines/`
- Vendored model internals: `backend/espnet/` — treat as upstream, avoid editing
- Assets (brand, VSR config, test-video ground truths, architecture.png): `assets/`
- Eval / checks: `tests/`, `backend/e2e_check.py`

## How to work here
- **Scan the relevant files and plan before any large refactor.** For multi-file or
  architectural changes, read the affected code and write a short plan (use plan mode
  or a planning skill), then implement once it's clear.
- **Make the simplest change that works.** Smallest diff, readable code, no speculative abstractions.
- **For agent/LLM work, follow current LangChain / LangGraph docs and 2026 SOTA
  practices** (graph orchestration, native tool-calling, structured outputs). Check the
  official docs rather than relying on memory. Ground the agent in the VSR per-word confidence.
- **After each big refactor, verify all system flows work end to end** before finishing:
  ```powershell
  uv run python backend/e2e_check.py          # all /api/* + clip → /api/execute_lips → /speak, PASS/FAIL per stage
  uv run --extra test pytest tests/ -v -s     # eval suite (word-overlap F1)
  ```
  Report real results; if a flow can't be run here (no camera/API key/weights), say so.

## Conventions
- Windows + **PowerShell** syntax (`$env:VAR`, `$null`). Package manager: **uv**.
- Secrets in `.env` (gitignored): `ANTHROPIC_API_KEY`, `DATABASE_URL` (Supabase
  session pooler), optional `INWORLD_API_KEY` / `INWORLD_VOICE_ID`. Never commit secrets.
- Model weights under `benchmarks/LRS3/` and temp `webcam*.mp4` clips are not in git.
- Privacy: video stays local and is deleted after inference; only text leaves the device.
