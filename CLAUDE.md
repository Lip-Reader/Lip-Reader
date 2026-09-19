# CLAUDE.md — Chaplin AI

Chaplin AI lets non-vocal, ventilated patients talk: the app records a short
camera clip, a VSR model lip-reads it, one LLM call corrects the text, and TTS
speaks it. Product: [PRD.md](PRD.md). Visual system: [app/DESIGN.md](app/DESIGN.md).

## Rules (MUST follow)
1. **Plan before implementing.** For large or ambiguous work, ask before coding.
2. **Think before coding.** State assumptions; present competing interpretations
   instead of picking one silently; say when a simpler approach exists; push back.
3. **Simplicity first.** Minimum code for the ask: no extra features, no
   single-use abstractions, no speculative flexibility, no impossible-case error
   handling. If 200 lines could be 50, rewrite it.
4. **Surgical changes.** Touch only what the request needs. Don't reformat or
   "improve" adjacent code; match existing style; mention unrelated dead code
   instead of deleting it. Remove only orphans your own change created.
5. **Subagents.** Parallelize independent steps of big features; keep dependent
   or same-file work inline.
6. **Model selection.** Most capable model for complex work; lighter models for
   mechanical tasks (renames, formatting, boilerplate).
7. **UI.** Follow [app/DESIGN.md](app/DESIGN.md) when creating or reviewing screens.
8. **Verify end to end after big changes** (commands below) and report real results.
9. **Writing style.** Docs and pages in plain language, no jargon; use industry
   and technical terms only where they are the precise word.

## Layout
```
app/                Expo app (Expo Router; iOS, Android, web). app/app/*.tsx = routes,
                    app/src/features/* = screens, app/src/ui = glass UI kit, app/e2e = Playwright.
backend/app/        FastAPI code. main.py = API backend (TTS, settings, support, runs,
                    admin, workshop metadata); vsr_main.py = VSR service (/api/execute_lips);
                    agent/ = LangChain corrector; auth.py (Clerk), db.py (Supabase), tts.py (Inworld).
backend/pipelines/  Vendored Auto-AVSR inference (mediapipe face crop -> model -> beam search).
backend/espnet/     Vendored ESPnet transformer/beam-search internals used by pipelines/. Upstream: don't edit.
backend/tests/      pytest (agent tests, clip eval) + e2e_check.py (every /api stage, PASS/FAIL).
assets/             VSR config (configs/), test-clip ground truths, architecture.png.
api/index.py        Vercel entry for backend/app/main.py.   modal_app.py: Modal deploy of the VSR service.
```

## How it runs
- **Three services:** the app (Vercel static export), the API backend (Vercel
  Python function, deps in `requirements.txt`, no torch) and the VSR service
  (Modal GPU, `modal_app.py`; local port 8001). The device owns the camera; only
  text leaves it. Video is deleted right after inference.
- **Hebrew phrase mode** (`backend/app/phrases.py`, `assets/phrases/he.json`,
  `app/src/features/settings/PhraseBank.tsx`): no Hebrew VSR model exists, so
  `language=he` on `/api/execute_lips` matches the clip's encoder features
  (`vsr.extract_features`) against per-patient templates (`phrase_templates`, keyed by
  a device-generated `patient_key`) with DTW; unsure results return top-3 `candidates`
  that the Talk screen shows as buttons. English requests never enter this branch.
- **Auth:** Clerk. Guests can use everything; sign-in only syncs
  `{ voice_id, language, gender, patient_key }` via `GET|PUT /api/me/settings`. Admin = Clerk public metadata `{ "role": "admin" }`
  (`auth.require_admin`). No publishable key → guest-only build; no
  `CLERK_SECRET_KEY` → authenticated routes return 503.
- **Database:** Supabase Postgres (`backend/app/db.py`): `user_settings`,
  `app_settings`, `support_messages`, `audit_log`, `runs`, `phrase_templates`
  (text and encoder features only, never video). The VSR service on Modal needs
  `DATABASE_URL` in `chaplin-secrets` for enrollment.
  `.github/workflows/db-keepalive.yml` pings `/api/db_ping` every 5 min.
- **Platform splits** live only in `*.web.tsx` / `*.native.tsx` files
  (recorder incl. the front/back camera `facing`, speaker, storage, SignInScreen).
- **Agent:** `backend/app/agent/agent.py`, single `correct` call via LangChain
  `create_agent`; `run_agent(raw, conversation)` keeps the history argument for evals.

## Commands
```bash
./dev-up.sh                                   # API :8000, VSR :8001, web :5173
uv run python backend/tests/e2e_check.py      # every /api stage, PASS/FAIL
uv run --extra test pytest backend/tests -v -s  # agent tests (ANTHROPIC_API_KEY), clip eval (weights + .mov clips)
cd app && npm run typecheck                   # web + native
cd app && npm run e2e                         # Playwright; run outside the Claude sandbox
cd app && npm run shots                       # screenshots -> app/screenshots/
```
Launch configs: `.claude/launch.json` (`chaplin-web`, `chaplin-api`, `chaplin-vsr`).

## Conventions
- **uv** for Python, **npm** in `app/`; `npx expo install` for Expo packages.
- Secrets in `.env` (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `CLERK_SECRET_KEY`,
  `INWORLD_API_KEY`) and `app/.env.local` (`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`).
  Never commit or print them.
- Model weights (`benchmarks/LRS3/`) and test clips (`.mov`) are gitignored.
- For Clerk, check the installed `@clerk/expo` types; for LangChain, current docs.
