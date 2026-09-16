---
title: Mobile-first Expo app with Clerk authentication and admin panel
version: 1.0
date_created: 2026-09-16
owner: Chaplin AI (Adam Sion)
tags: [architecture, app, auth, admin, design]
---

# Introduction

This specification defines the rebuild of the Chaplin AI frontend as a single Expo application (iOS, Android, web), the addition of optional Clerk authentication, per-user settings persistence, a Clerk-role-gated admin panel, and the backend changes that support them. The lip-reading request path is preserved exactly.

## 1. Purpose & Scope

Audience: the implementing agent and reviewers. Scope: `app/` (rewritten), `backend/app/` (main.py, db.py, new auth.py, new admin routes), root config (`vercel.json`, `.claude/launch.json`, `.env.example`), docs (`CLAUDE.md`, `README.md`, new `DESIGN.md`), `backend/e2e_check.py`. Out of scope: `backend/pipelines`, `backend/espnet`, `backend/app/vsr.py`, `backend/app/vsr_main.py` request handling, `backend/app/agent/`, `modal_app.py` (except the secret name list), `tests/`.

Assumptions: Clerk application `app_3JPfuFFqgKP2jqlhPHnB63F0LFX` exists; the user supplies `CLERK_SECRET_KEY` in `.env`; the Modal VSR service stays deployed as is.

## 2. Definitions

- **VSR**: Visual Speech Recognition, the Auto-AVSR lip-reading model served by `vsr_main.py` on Modal.
- **Corrector**: the single-pass LLM call in `backend/app/agent/agent.py` (`run_agent`).
- **Guest**: a visitor who tapped **Try now** and is not signed in.
- **Member**: a signed-in Clerk user.
- **Admin**: a Member whose Clerk `public_metadata` contains `"role": "admin"`.
- **Settings**: per-user preferences. Currently one field: `voice_id` (string).
- **Glass**: the frosted-glass visual style defined in `DESIGN.md`.
- **Talk flow**: record clip → `POST /api/execute_lips` → sentence → `POST /speak` → audio with word timestamps.

## 3. Requirements, Constraints & Guidelines

### App structure
- **REQ-001**: `app/` is one Expo project using Expo Router (file-based routes under `app/app/`), TypeScript, targeting `ios`, `android`, `web`.
- **REQ-002**: Folder layout:
  ```
  app/
    app/                 routes: _layout.tsx, index.tsx (landing), talk.tsx, settings.tsx, admin.tsx
    src/ui/              glass primitives + theme tokens (GlassPanel, GlassButton, Screen, Icon, theme.ts)
    src/features/talk/   TalkScreen.tsx, useRecorder.web.ts, useRecorder.native.ts, useSpeaker.ts
    src/features/settings/ SettingsScreen.tsx, VoicePicker.tsx, useSettings.ts, settingsStore.ts
    src/features/landing/ LandingScreen.tsx
    src/features/admin/  AdminPanel.tsx, sections/{Overview,Users,Settings,Support,Logs,Info}.tsx, ui.tsx
    src/lib/             api.ts, auth.ts (Clerk helpers + useIsAdmin), storage.ts (platform kv)
    DESIGN.md
  ```
- **REQ-003**: Platform-specific code exists only as `.web.ts(x)` / `.native.ts(x)` pairs for the recorder, the key-value storage and the Clerk token cache. Everything else is shared.
- **REQ-004**: The Vite toolchain (`vite.config.ts`, `index.html`, `postcss.config.js`, `tailwind.config.js`, `src/main.tsx`, `src/App.tsx`, `src/components/*`, `src/lib/chat.ts`, `chatContext.tsx`, `presets.ts`) is deleted. Tailwind is not used; styling is React Native `StyleSheet` with theme tokens.
- **REQ-005**: Web export command is `npx expo export -p web` producing `app/dist`. `vercel.json` `buildCommand` becomes `cd app && npm ci && npx expo export -p web`; `outputDirectory` stays `app/dist`; rewrites unchanged. `.claude/launch.json` `chaplin-web` runs `npx expo start --web --port 5173` (from `app/`, `runtimeArgs` with `--prefix` is not valid for expo; use `"cwd": "app"` if supported, else `npm --prefix app run web`).
- **REQ-006**: PWA metadata (icons, manifest, theme color `#6938ef` replaced by the new accent) is kept via `app.json` `web` config and `public/` assets.

### Design
- **DES-001**: `app/DESIGN.md` contains: the visual prompt verbatim (positive, negative, parameters), the token table (colors, radii, blur, shadows, type scale), component rules (GlassPanel, GlassButton primary/ghost/danger, fixed icon buttons), motion rules (landing entrance, button press, word reveal), responsive rules (breakpoints 0/640/1024, max content width 480 on Talk/Settings, 1100 on Admin), and the negative list as hard rules.
- **DES-002**: Palette: background gradient from `#EEF2FF` via `#F5F0FF` to `#E0F2FE`; accent `#7C6CF6`; secondary `#60A5FA`; text `#1E1B4B`; muted `#6B6A8A`; glass fill `rgba(255,255,255,0.55)`, border `rgba(255,255,255,0.75)`, blur 24; shadows soft only (`0 8 28 rgba(99,91,255,0.14)`). Danger `#F87171`, success `#34D399`. No dark theme.
- **DES-003**: Blur uses `expo-blur` `BlurView` (`tint="light"`, `intensity` 40–70). On web `BlurView` renders `backdrop-filter`; a fallback fill is always painted underneath so the panel reads correctly if blur is unsupported.
- **DES-004**: Landing animates once on mount: logo glow pulse, headline fade-up, three feature lines staggered word reveal, two blobs drifting. Uses `react-native-reanimated`. Total entrance under 2.5 s. Respects `prefers-reduced-motion` on web (skip motion).

### Routes and screens
- **REQ-010**: `/` Landing: logo, title "Chaplin AI", one-line tagline "A communication agent for non-vocal, ventilated patients.", three feature lines (reads your lips / corrects the transcription / speaks it aloud), buttons **Try now** (→ `/talk` as Guest) and **Log in** (Clerk sign-in → `/talk`). Signed-in visitors see **Continue** instead of both.
- **REQ-011**: `/talk` Talk: camera preview full-screen (front camera, un-mirrored display), bottom controls per phase: idle → **Talk**; recording → **Stop** + "Listening · m:ss"; thinking → spinner; review → **Speak** + **Talk**; speaking → **Stop**. Sentence shown centered over a dimmed camera during review/speaking with word-by-word highlight driven by audio time. Fixed top-left settings icon button (44×44 glass circle). Fixed top-right admin icon button only for Admins. No other controls.
- **REQ-012**: Camera starts automatically on `/talk` mount. If permission is denied, a glass panel says "Camera access is required." with a **Retry** button.
- **REQ-013**: `/settings`: header with back; section **Voice** (preset list with search + **Record my voice** tab, same behavior as the old Onboarding: `GET /voices`, `POST /voice/select`, `POST /voice/enroll`); section **Account**: Guest sees "Sign in to sync your settings" + **Sign in**; Member sees email + **Sign out**; section **Feedback**: text box + **Send** (→ `POST /api/support`). Saving a voice writes to the settings store immediately.
- **REQ-014**: `/admin`: gated. Not signed in → locked panel with **Sign in**. Signed in, not admin → "This page is for admins only." Admin → panel with left rail (desktop ≥ 1024) or top segmented tabs (below 1024). Sections: Overview, Users, Settings, Support, Logs & audit, Info. Back button returns to `/talk`.

### Settings store
- **REQ-020**: `useSettings()` returns `{ voiceId, setVoiceId, ready }`. Guest: reads/writes local storage (`localStorage` on web, `expo-secure-store` or AsyncStorage on native) under key `chaplin_settings`. Member: reads `GET /api/me/settings` on sign-in, writes `PUT /api/me/settings`; local storage is also updated as a cache. On first sign-in, if the server has no row and local has a voice, the local voice is pushed to the server.
- **REQ-021**: Default voice id is `"Brian"` when nothing is stored.

### Authentication
- **AUTH-001**: Clerk via `@clerk/clerk-expo` with `ClerkProvider` in `app/app/_layout.tsx`, `tokenCache` from `@clerk/clerk-expo/token-cache` on native and default cookie storage on web. Publishable key from `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- **AUTH-002**: If the publishable key is missing, the app still runs: **Log in** is hidden, Guest mode only, admin route shows "Sign-in is not configured in this build."
- **AUTH-003**: Sign-in / sign-up UI: on web use Clerk's prebuilt `SignIn`/`SignUp` components rendered inside a glass panel at `/sign-in`; on native use the same route with Clerk Expo `useSignIn`/`useSignUp` email-code flow (minimal form).
- **AUTH-004**: `useIsAdmin()` = `user?.publicMetadata?.role === "admin"`.
- **AUTH-005**: Every authenticated API call sends `Authorization: Bearer <getToken()>`.
- **SEC-001**: The backend verifies Clerk session JWTs with the Clerk backend SDK (`clerk-backend-api`, `authenticate_request` or JWKS verification) using `CLERK_SECRET_KEY`. Admin routes additionally fetch the user and require `public_metadata.role == "admin"`; the result is cached per user id for 60 s.
- **SEC-002**: `CLERK_SECRET_KEY` is never sent to the client, never logged, never committed. `.env.example` lists `CLERK_SECRET_KEY=` and `app/.env.example` lists `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=`.
- **SEC-003**: CORS unchanged (configured origins + localhost regex). `Authorization` header allowed (already `allow_headers=["*"]`).

### Backend API
- **API-001**: Removed: `POST /api/execute`, all `/api/chats*` routes, `db.py` chat functions and the chat DDL. `run_agent` signature unchanged.
- **API-002**: Kept unchanged: `GET /api/team_info`, `GET /api/agent_info`, `GET /api/model_architecture`, `GET /health`, `GET /voices`, `POST /speak`, `POST /voice/enroll`, `POST /voice/select`, `GET /api/db_ping`, and on the VSR service `POST /api/execute_lips` + `GET /health`.
- **API-003**: New (Member): `GET /api/me/settings` → `{ voice_id: string | null }`; `PUT /api/me/settings` body `{ voice_id: string }` → same shape. `POST /api/support` body `{ message: string }` (Guest allowed; `user_id` null for guests) → `{ id }`.
- **API-004**: New (Admin, prefix `/api/admin`, all `require_admin`):
  - `GET /overview` → `{ users: n, settings_rows: n, support_open: n, runs_24h: n, api_ok: true, vsr_ok: bool, db_ok: bool }` (`vsr_ok` from `GET {VSR}/health` with 3 s timeout).
  - `GET /users` → `{ users: [{ id, email, name, role, created_at, last_sign_in_at, voice_id }] }` (Clerk user list, limit 100, joined with `user_settings`).
  - `GET /settings` → `{ settings: { default_voice_id: string, lip_reading_enabled: bool } }`; `PATCH /settings` body partial → same. Mutations write an audit row.
  - `GET /support` → `{ messages: [{ id, user_id, email, message, status, created_at }] }`; `PATCH /support/{id}` body `{ status: "open" | "closed" }`. Audit row on mutation.
  - `GET /audit?limit=100` → `{ entries: [{ id, actor, action, detail, created_at }] }`.
  - `GET /runs?limit=100` → `{ runs: [{ id, user_id, raw, corrected, latency_ms, created_at }] }`.
- **API-005**: Run logging: the VSR service does not have DB access on Modal today; instead the client posts `POST /api/runs` `{ raw, corrected, latency_ms }` after a successful lip-read (fire-and-forget, Guest allowed, `user_id` null for guests). Text only, never video.
- **API-006**: `lip_reading_enabled=false` makes `/api/runs` still accept, and the client shows "Lip reading is paused by the admin." on `/talk` when `GET /api/settings/public` returns `{ lip_reading_enabled: false, default_voice_id }`. `GET /api/settings/public` is unauthenticated.
- **API-007**: Error shape for auth failures: `401 {"detail": "unauthorized"}`, `403 {"detail": "forbidden"}`.

### Database (Supabase Postgres, `db.py`)
- **DAT-001**: DDL (idempotent, executed once per process like today):
  ```sql
  CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, voice_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS support_messages (id BIGSERIAL PRIMARY KEY, user_id TEXT, email TEXT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, detail JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS runs (id BIGSERIAL PRIMARY KEY, user_id TEXT, raw TEXT NOT NULL, corrected TEXT NOT NULL, latency_ms INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ```
  Existing `chat_memory`/`chat_messages` tables are not dropped.
- **DAT-002**: Connection handling (cached connection, reopen on failure, `_run`) is reused as is.

### Talk flow constraints
- **CON-001**: The web recorder logic (`getUserMedia` constraints, MIME picking, `MediaRecorder`, blob assembly) is moved verbatim from `app/src/lib/useRecorder.ts`; `executeLips` and `speak` from `app/src/lib/api.ts` keep the same request bodies and base URL rules (`EXPO_PUBLIC_API_BASE`, `EXPO_PUBLIC_VSR_API_BASE`, same defaults).
- **CON-002**: No request is added between **Stop** and the upload to `/api/execute_lips`. Run logging happens after the sentence is displayed.
- **CON-003**: `warmBackend()` (health pings) fires on app start.
- **CON-004**: Native recorder uses `expo-camera` `CameraView.recordAsync({ maxDuration: 60 })`, uploads the resulting mp4 file via `FormData` with `{ uri, name: "clip.mp4", type: "video/mp4" }`.

### Admin panel
- **ADM-001**: Layout mirrors Startix `AdminPanel.tsx`: rail with product name + "admin" pill + back link, sections grouped ("Monitor": Overview, Users, Logs & audit; "Admin": Settings, Support, Info). Content column max width 1100, cards with 14 px radius.
- **ADM-002**: Overview: six stat cards from `/api/admin/overview` + a health row (API, VSR, DB) with green/red dots.
- **ADM-003**: Users: table (email, name, role badge, voice, created, last sign-in). Search box filters client-side.
- **ADM-004**: Settings: default voice select (from `/voices`), lip reading on/off switch, **Save**. Shows "Saved" toast.
- **ADM-005**: Support: list with status pill, **Close**/**Reopen** buttons.
- **ADM-006**: Logs & audit: two tabs, Audit (actor, action, detail JSON, time) and Runs (raw → corrected, latency, time). **Refresh** button.
- **ADM-007**: Info: the former AboutModal content: description, architecture image (`/api/model_architecture`), how the input works, team info (`/api/team_info`), agent info (`/api/agent_info`, prompt template + examples), endpoint list with API/VSR base URLs.

### Code quality
- **GUD-001**: No code comments except ones that prevent a real mistake (e.g. the un-mirroring transform, privacy delete). Target: fewer than 10 comments in `app/src` and the new backend files combined.
- **GUD-002**: No dead exports, no unused deps. `npx tsc --noEmit` passes in `app/`.
- **GUD-003**: Docs: `CLAUDE.md` architecture section rewritten (three services, routes, auth, admin, settings store, dev commands); `README.md` endpoints table and run instructions updated; `e2e_check.py` stages: env, team_info, agent_info, architecture, settings_public, support (POST), execute_lips, speak, db_ping.

## 4. Interfaces & Data Contracts

| Method & path | Auth | Request | Response |
|---|---|---|---|
| GET `/api/settings/public` | none | – | `{ default_voice_id, lip_reading_enabled }` |
| GET `/api/me/settings` | Member | – | `{ voice_id }` |
| PUT `/api/me/settings` | Member | `{ voice_id }` | `{ voice_id }` |
| POST `/api/support` | optional | `{ message }` | `{ id }` |
| POST `/api/runs` | optional | `{ raw, corrected, latency_ms }` | `{ id }` |
| GET `/api/admin/overview` | Admin | – | see API-004 |
| GET `/api/admin/users` | Admin | – | `{ users: [...] }` |
| GET/PATCH `/api/admin/settings` | Admin | `{ default_voice_id?, lip_reading_enabled? }` | `{ settings }` |
| GET `/api/admin/support`, PATCH `/api/admin/support/{id}` | Admin | `{ status }` | `{ messages }` / `{ id, status }` |
| GET `/api/admin/audit` | Admin | `?limit` | `{ entries }` |
| GET `/api/admin/runs` | Admin | `?limit` | `{ runs }` |

Client env: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_BASE` (dev default `http://localhost:8000`, prod `""`), `EXPO_PUBLIC_VSR_API_BASE` (dev `http://localhost:8001`, prod Modal URL).

Backend env: existing + `CLERK_SECRET_KEY`.

## 5. Acceptance Criteria

- **AC-001**: Given a fresh browser at 375 px width, when `/` loads, then the landing renders with **Try now** and **Log in** and the entrance animation completes without layout overflow.
- **AC-002**: Given a Guest on `/talk`, when they tap Talk, mouth a sentence, tap Stop, then a sentence appears and **Speak** plays audio with word highlighting; the only network calls between Stop and the sentence are one `POST /api/execute_lips`.
- **AC-003**: Given a Guest who picks a voice in Settings, when the page reloads, then the same voice is selected and no `/api/me/settings` call is made.
- **AC-004**: Given a Member who picks a voice, when they sign in on another browser, then the same voice is selected via `GET /api/me/settings`.
- **AC-005**: Given a signed-out visitor, when they open `/admin`, then a locked panel with **Sign in** appears and no `/api/admin/*` call is made.
- **AC-006**: Given a Member without the admin role, when they open `/admin`, then "This page is for admins only." appears and no admin icon is shown on `/talk`.
- **AC-007**: Given an Admin, when they open `/admin`, then all six sections load with data from the API and the Settings save writes an audit row visible in Logs & audit.
- **AC-008**: `POST /api/execute` returns 404; the words "Run Agent" do not appear in `app/src`.
- **AC-009**: `npx expo export -p web` succeeds; `npx tsc --noEmit` passes; `uv run python backend/e2e_check.py` passes for all stages runnable locally; `uv run --extra test pytest tests/ -v -s` passes.
- **AC-010**: Screenshots exist for landing, talk, settings, admin at mobile (375) and desktop (1280) widths.

## 6. Test Automation Strategy

- **Test Levels**: backend integration (`e2e_check.py` with TestClient), Python unit (existing pytest), web end-to-end (Playwright against `expo start --web`).
- **Frameworks**: pytest, FastAPI TestClient, Playwright (Chromium, fake media stream flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`).
- **Test Data Management**: Playwright routes mock `/api/execute_lips`, `/speak`, `/voices`, `/api/admin/*`; Clerk is mocked by setting `window.__clerk_test_role` only in test builds is NOT allowed — instead gate tests run with the publishable key unset (Guest path) and admin sections are tested with a mocked `fetch` and a test-only `EXPO_PUBLIC_FORCE_ADMIN=1` flag that is read only when `__DEV__` is true.
- **CI/CD Integration**: none added (out of scope); commands documented in `CLAUDE.md`.
- **Coverage Requirements**: every user-facing flow in AC-001..AC-008 has one Playwright test.
- **Performance Testing**: one real lip-read against the deployed Modal service, latency compared with the current main branch (same clip), difference within noise.

## 7. Rationale & Context

- Single Expo app instead of a monorepo: three screens do not justify packages; Expo Router already gives web + native from one tree.
- Run logging from the client rather than the VSR service: the Modal container has no `DATABASE_URL` and adding psycopg there would slow cold starts; the client already holds the text.
- Chat store removed: it only served the Run Agent demo, which is removed.
- Admin role from Clerk public metadata: same approach as Startix; no role table needed.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: Clerk – authentication (session JWT verification, user list, public metadata).
- **EXT-002**: Supabase Postgres – settings, support, audit, runs.
- **EXT-003**: Modal VSR service – `POST /api/execute_lips` (unchanged).
- **EXT-004**: Inworld TTS – voices and speech (unchanged).
- **EXT-005**: Anthropic API – corrector (unchanged).

### Technology Platform Dependencies
- **PLT-001**: Node ≥ 20, Expo SDK current stable, React Native + react-native-web, expo-router, expo-camera, expo-blur, react-native-reanimated, react-native-safe-area-context, `@clerk/clerk-expo`.
- **PLT-002**: Python ≥ 3.10, FastAPI, psycopg, `clerk-backend-api`, httpx.
- **PLT-003**: Vercel static hosting + Python function for the API; Modal for VSR.

### Compliance Dependencies
- **COM-001**: Privacy: video never leaves the device except the single upload, which is deleted after inference (unchanged). Only text is stored in `runs`.

## 9. Examples & Edge Cases

```ts
// settings store resolution
const voiceId = member ? (server.voice_id ?? local.voice_id ?? "Brian") : (local.voice_id ?? "Brian");
```

```json
// GET /api/admin/overview
{ "users": 12, "settings_rows": 7, "support_open": 2, "runs_24h": 31, "api_ok": true, "vsr_ok": true, "db_ok": true }
```

Edge cases:
- Publishable key missing → Guest-only build (AUTH-002).
- Clerk token expired mid-session → 401 → client refreshes token once and retries, then falls back to local settings.
- VSR health fails → Talk shows "The lip-reading service is unavailable right now." on Stop (existing behavior, without the Run Agent hint).
- `lip_reading_enabled=false` → banner on Talk, Talk button disabled.
- Camera denied on native → same Retry panel; on web `NotAllowedError` mapped to the same message.

## 10. Validation Criteria

All acceptance criteria AC-001..AC-010 pass; `git grep -n "Run Agent\|/api/execute\b\|presets\|chat_memory" -- app backend/app` returns nothing except `db.py` if it references old tables in a comment (it must not); comment count under GUD-001.

## 11. Related Specifications / Further Reading

- `plan-to-implement.md`
- https://docs.expo.dev/router/introduction/
- https://clerk.com/docs/expo/getting-started/quickstart
- https://clerk.com/docs/reference/backend-api
- https://docs.expo.dev/versions/latest/sdk/camera/
- https://docs.expo.dev/versions/latest/sdk/blur-view/
