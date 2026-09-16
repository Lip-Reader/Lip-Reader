# CLAUDE.md — Chaplin AI

Guidance for Claude Code in this repo. See [PRD.md](PRD.md) for the product and
[app/DESIGN.md](app/DESIGN.md) for the visual system.

**Chaplin AI** helps non-vocal, ventilated patients communicate: it lip-reads them
and speaks the result back in a representative voice. It began as a fork of the
`chaplin` repo (a lip-reading model + LLM corrector) and is evolving into an
**agent** whose job is *reliable* communication.

## Architecture (high level)
```
camera ─▶ short clip ─▶ POST /api/execute_lips (vsr_lip_reader, Modal GPU)
                              │  vsr (Auto-AVSR) ─▶ correct (single LLM call)
                              ▼
                sentence on screen ─▶ Speak ─▶ POST /speak (Inworld TTS)
```
- Three services:
  1. **App** (`app/`) — one Expo app (Expo Router, React Native + react-native-web)
     for iOS, Android and web. The web export (`npx expo export -p web` → `app/dist`)
     is hosted on Vercel. The device owns the camera; only text leaves it.
  2. **API backend** (`backend/app/main.py`, FastAPI, no torch) — voices/TTS,
     settings, support, run log, admin API, workshop metadata. On Vercel as a
     Python function (`api/index.py`, deps from root `requirements.txt`).
  3. **vsr_lip_reader** (`backend/app/vsr_main.py`) — `POST /api/execute_lips` +
     `/health` only (clip → VSR → corrector). On Modal (`modal_app.py`), local
     dev port 8001 (launch config `chaplin-vsr`). Unchanged by the app rewrite.
- **Auth**: Clerk (`@clerk/expo` in the app, `clerk-backend-api` in
  `backend/app/auth.py`). Guests can use everything; signing in only syncs
  settings across devices. **Admin** = Clerk user with public metadata
  `{ "role": "admin" }` (checked server-side in `auth.require_admin`, cached 60 s).
  Missing publishable key → guest-only build; missing `CLERK_SECRET_KEY` →
  authenticated routes return 503.
- **Settings store** (`app/src/features/settings/settingsStore.tsx`): guests keep
  `{ voice_id }` on the device (localStorage / SecureStore); members read/write
  `GET|PUT /api/me/settings`, with the local copy as cache. First sign-in pushes a
  local choice to the server.
- **Database** (Supabase Postgres, `backend/app/db.py`): `user_settings`,
  `app_settings` (`default_voice_id`, `lip_reading_enabled`), `support_messages`,
  `audit_log`, `runs` (text only, never video). `GET /api/db_ping` is hit every
  5 min by `.github/workflows/db-keepalive.yml` so the free tier never pauses.
- **Screens** (`app/app/*.tsx` routes → `app/src/features/*`):
  `/` landing (Try now / Log in), `/talk` full-screen camera with Talk/Stop/Speak,
  a fixed Settings icon (top-left) and, for admins, an Admin icon (top-right);
  `/settings` voice picker + account + feedback; `/sign-in` (Clerk `SignIn` on
  web, email-code flow on native); `/admin` left rail (≥1024 px) or top tabs with
  Overview, Users, Logs & audit, Settings, Support, Info.
- Platform splits live only in `recorder.web.tsx` / `recorder.native.tsx`
  (MediaRecorder vs expo-camera), `speaker.web.ts` / `speaker.native.ts`
  (HTMLAudioElement vs expo-audio), `storage.*.ts` and `SignInScreen.*.tsx`.
  `tsconfig.json` resolves `.web`, `tsconfig.native.json` resolves `.native`.
- Agent: `backend/app/agent/` — `agent.py` (LangChain `create_agent`, single
  `correct` call, ChatAnthropic), `prompts.py`. `run_agent(raw, conversation)`
  keeps its optional history argument for the eval suite.
- VSR model: `backend/pipelines/`; vendored `backend/espnet/` — treat as upstream.
- Assets (brand, VSR config, test-video ground truths, architecture.png): `assets/`
- Eval / checks: `tests/` (pytest), `backend/e2e_check.py`, `app/e2e/` (Playwright).

## How to work here
- **Scan the relevant files and plan before any large refactor.**
- **Make the simplest change that works.** Smallest diff, no speculative
  abstractions, no code comments unless they prevent a real mistake.
- **For agent/LLM work, follow current LangChain / LangGraph docs.**
- **For Clerk work, check the installed `@clerk/expo` types** (`node_modules/@clerk/expo`);
  the CLI-installed skills under `~/.agents/skills/clerk-*` describe the current API.
- **After each big change, verify end to end** and report real results:
  ```bash
  uv run python backend/e2e_check.py           # every /api/* stage, PASS/FAIL
  uv run --extra test pytest tests/ -v -s      # eval suite (needs ANTHROPIC_API_KEY)
  cd app && npm run typecheck                  # web + native type check
  cd app && npm run e2e                        # Playwright (guest + admin flows)
  cd app && npm run shots                      # screenshots → app/screenshots/
  ```
  Playwright needs a real camera sandbox: run it outside the Claude sandbox
  (fake media devices hang inside it). `npm run e2e` starts two Expo web servers
  (5173 guest build, 5174 with `EXPO_PUBLIC_FORCE_ADMIN=1`, dev-only flag).
- Local dev: `.claude/launch.json` has `chaplin-web` (Expo web on 5173),
  `chaplin-api` (8000) and `chaplin-vsr` (8001).

## Conventions
- Package managers: **uv** (Python) and **npm** in `app/`. Use `npx expo install`
  for Expo packages so versions stay SDK-compatible.
- Secrets in `.env` (gitignored): `ANTHROPIC_API_KEY`, `DATABASE_URL`,
  `CLERK_SECRET_KEY`, optional `INWORLD_API_KEY` / `INWORLD_VOICE_ID`,
  `VSR_API_BASE`. App: `app/.env.local` with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
  (Vercel needs the same variable). Never commit secrets; never print env files.
- Model weights under `benchmarks/LRS3/` and temp clips are not in git.
- Privacy: video stays on the device and is deleted after inference; only text is
  stored (`runs`, `support_messages`).
