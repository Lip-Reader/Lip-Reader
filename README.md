# Chaplin AI

Chaplin AI helps non-vocal, ventilated patients communicate. The user taps **Talk**,
silently mouths a sentence to the camera, and Chaplin lip-reads it, corrects it with
a single LLM call, shows one clean line of text, and — on **Speak** — voices it back
in the user's chosen voice.

The app is one Expo project (iOS, Android, web) with a frosted-glass design
([app/DESIGN.md](app/DESIGN.md)). Anyone can **Try now** as a guest; signing in with
Clerk keeps the chosen voice in sync across devices. Users whose Clerk public
metadata is `{ "role": "admin" }` get an admin panel (overview, users, logs & audit,
settings, support, info).

```
camera clip ─▶ vsr (Auto-AVSR) ─▶ correct ─▶ sentence ─▶ Speak (Inworld TTS)
```

## Architecture (monorepo)

| Path        | What it is                                                                 |
|-------------|----------------------------------------------------------------------------|
| `app/`      | Expo app (Expo Router, React Native + react-native-web). Routes in `app/app/`, features in `app/src/features/`, glass UI kit in `app/src/ui/`. Web export deployed on Vercel. |
| `backend/app/main.py` | API backend (FastAPI): voices/TTS, settings, support, run log, admin API, workshop metadata. Vercel Python function via `api/index.py`. |
| `backend/app/vsr_main.py` | vsr_lip_reader service: `POST /api/execute_lips` (clip → VSR → corrector). Runs on Modal (`modal_app.py`). |
| `backend/app/agent/` | Single-pass corrector agent (LangChain `create_agent`). |
| `backend/app/auth.py` · `admin.py` · `db.py` | Clerk JWT verification + admin role check, admin router, Supabase Postgres store. |
| `backend/pipelines/`, `backend/espnet/` | Vendored VSR internals (upstream, not rewritten). |
| `assets/`   | VSR config, test-video ground truths, `architecture.png`. |
| `backend/tests/`, `app/e2e/` | Backend pytest suite + `e2e_check.py`; Playwright flows for the app. |

**Privacy:** uploaded clips are processed in a temp file and deleted immediately
after inference. Video is never persisted; only text leaves the device (run text
and feedback are stored in Postgres).

### API endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/execute_lips` (VSR service) | – | mp4/webm clip → `{ status, error, response, steps }`; steps start with `vsr` |
| `POST /speak` · `GET /voices` · `POST /voice/select` · `POST /voice/enroll` | – | TTS with word timestamps, voice catalog / selection / cloning |
| `GET /api/settings/public` | – | `{ default_voice_id, lip_reading_enabled }` |
| `GET|PUT /api/me/settings` | member | `{ voice_id }` |
| `POST /api/support` · `POST /api/runs` | optional | feedback message · lip-read run log (text only) |
| `GET /api/admin/overview|users|settings|support|audit|runs`, `PATCH /api/admin/settings|support/{id}` | admin | admin panel data; mutations write `audit_log` |
| `GET /api/team_info` · `/api/agent_info` · `/api/model_architecture` | – | workshop metadata |
| `GET /api/db_ping` · `GET /health` | – | keep-alive `SELECT 1` (5-min scheduled job) · liveness |

Auth is a Clerk session JWT in `Authorization: Bearer …`. Admin = Clerk user with
public metadata `{ "role": "admin" }` (set in the Clerk dashboard).

## Prerequisites

- Python deps via **uv**; Node 20+ for the app.
- VSR weights under `benchmarks/LRS3/` (see `assets/configs/LRS3_V_WER19.1.ini`) —
  only needed to run the VSR service locally.
- Secrets in `.env` (gitignored, copy `.env.example`): `ANTHROPIC_API_KEY`,
  `DATABASE_URL`, `CLERK_SECRET_KEY`, `INWORLD_API_KEY`, optional `INWORLD_VOICE_ID`.
- `app/.env.local`: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (leave unset for a
  guest-only build).

## Run it

```bash
./dev-up.sh   # API backend :8000, VSR service :8001 (needs weights), web app :5173
```

Or by hand:

```bash
uv sync
uv run uvicorn backend.app.main:app --port 8000        # API backend
uv run uvicorn backend.app.vsr_main:app --port 8001    # VSR service (needs weights)
cd app && npm install && npm run web                    # http://localhost:5173
```

`npm run ios` / `npm run android` start the native app (Clerk's native module
needs a development build: `npx expo run:ios`).

## Verify

```bash
uv run python backend/tests/e2e_check.py    # every backend stage, PASS/FAIL
uv run --extra test pytest backend/tests -v -s  # agent tests + clip eval (needs weights/clips)
cd app && npm run typecheck && npm run e2e  # types (web + native), Playwright flows
cd app && npm run shots                     # screenshots → app/screenshots/
```

## Deploy

- **Vercel**: builds `app/dist` with `npx expo export -p web` and serves the API from
  `api/index.py`. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `DATABASE_URL`, `ANTHROPIC_API_KEY`, `INWORLD_API_KEY` in the project settings.
- **Modal**: `uv run modal deploy modal_app.py` (VSR service; unchanged).
