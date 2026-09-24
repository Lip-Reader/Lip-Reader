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
| `backend/app/vsr_main.py` | vsr_lip_reader service: `POST /api/execute_lips` (clip → VSR word options → corrector; Hebrew: clip → two signatures → phrase match) and the Hebrew enrollment endpoints. Runs on Modal (`modal_app.py`). |
| `backend/app/corrector.py` | The corrector: one Claude call over the model's word options, with the speaker's confirmed examples and the clinician's notes in the prompt. |
| `backend/app/hebrew.py` · `phrases.py` · `assets/phrases/he.json` | Hebrew phrase mode: the two signatures, the matcher, the self-test the thresholds come from, and the 100-phrase list. |
| `backend/app/auth.py` · `admin.py` · `db.py` | Clerk JWT verification + admin role check, admin router, Supabase Postgres store. |
| `backend/pipelines/`, `backend/espnet/` | Vendored VSR internals (upstream, not rewritten). |
| `assets/`   | VSR config, test-video ground truths, `architecture.png`, Hebrew phrase list (`phrases/he.json`). |
| `backend/tests/`, `app/e2e/` | Backend pytest suite + `e2e_check.py`; Playwright flows for the app. |

**Privacy:** uploaded clips are processed in a temp file and deleted immediately
after inference. Video is never persisted; only text leaves the device (run text
and feedback are stored in Postgres).

### API endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/execute_lips` (VSR service) | – | mp4/webm clip → `{ status, error, response, steps }`; the `vsr` step carries the model's reading and its word options, `correct` the sentence. Optional `duration_ms`, `examples`, `notes`. Form field `language=he` (+ `patient_key`, `gender`) switches to phrase matching and adds `confident`, `candidates` (top 3) and `hebrew` (the whole ranking). Refusals carry a `code` (`no_face`, `nothing_read`, `still`, `no_rest`, `not_enrolled`) |
| `POST /api/enroll_phrase` · `GET|DELETE /api/phrase_templates` (VSR service) | – | Hebrew enrollment: one take → both signatures stored per `patient_key` (never video), with a verdict · standing per phrase and the self-test / reset, or `last=1` to drop a phrase's newest take |
| `GET /api/phrases/he` | – | the Hebrew phrase list (10 groups × 10, masculine and feminine forms) |
| `POST /speak` · `GET /voices?lang=en` · `POST /voice/select` · `POST /voice/enroll` | – | TTS with word timestamps, voice catalog per language (`he` → Inworld's Hebrew voices) / selection / cloning |
| `GET /api/settings/public` | – | `{ default_voice_id, lip_reading_enabled }` |
| `GET|PUT /api/me/settings` | member | `{ voice_id, language, gender, patient_key }` (PUT accepts any subset) |
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
uv run --extra test pytest backend/tests -v -s  # matcher, corrector and service tests; clip eval needs weights/clips
uv run python backend/tests/hebrew_eval.py --patient <patient_key>  # how Hebrew mode is doing for one patient
cd app && npm run typecheck && npm run e2e  # types (web + native), Playwright flows
cd app && npm run shots                     # screenshots → app/screenshots/
```

## Deploy

- **Vercel**: builds `app/dist` with `npx expo export -p web` and serves the API from
  `api/index.py`. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `DATABASE_URL`, `ANTHROPIC_API_KEY`, `INWORLD_API_KEY` in the project settings.
- **Modal**: `uv run modal deploy modal_app.py` (VSR service). The `chaplin-secrets`
  secret needs `ANTHROPIC_API_KEY` and `DATABASE_URL` (Hebrew phrase templates live in
  the same Postgres; without it enrollment reports "Template storage is not configured").

## Hebrew phrase mode

Hebrew has no lip-reading model, so Hebrew works from a fixed list of 100 phrases that
each patient teaches the app: pick Hebrew in Settings, open a phrase, mouth it three
times. A take is measured two ways on the VSR service: by the lip-reading network's
per-frame features (the same Auto-AVSR encoder, stopped before the English text decoder)
and by eight lip measurements FaceMesh gives (opening, width, area, lip thicknesses,
corner lift, protrusion) taken in a frame fixed to the head, so turning or leaning does
not move them. Both are trimmed to where the lips move and stored under a random patient
key; the clip is deleted. A clip with no movement, no still moment before and after, or
no face in it is refused and nothing is kept. How much each measurement counts, and how
sure the app has to be before it names a phrase, come out of a leave-one-take-out test
over the enrolment itself - nothing is hand-set - and the phrase list shows what that
test makes of every phrase. On Talk, the clip is compared with every enrolled phrase by
dynamic time warping; a clear winner is spoken, otherwise the three best matches are shown
to tap, and the tap is logged as what was really said so real use keeps measuring the
matcher (`backend/tests/hebrew_eval.py`). Accuracy on clips is measured by
`backend/tests/test_phrase_eval.py` on clips under `assets/hebrew_clips/<patient>/<phrase_id>/`.
English is untouched: without `language=he` the service runs the English path, and
`backend/tools/make_english_golden.py` pins its transcriptions for the regression test.

When Hebrew is selected, every button and on-screen text in the app (Talk, Settings, the voice
picker) switches to Hebrew via `app/src/lib/i18n.ts`; phrase content itself is Hebrew regardless
of the toggle. The Talk screen also gets a Reset button (visible once a sentence or candidates are
shown) that clears the result and returns to idle, and the phrase-enrollment panel in Settings is
a full-size camera view with a back arrow to return to the phrase list.
