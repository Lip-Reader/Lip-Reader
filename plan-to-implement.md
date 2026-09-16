# Plan: mobile-first Expo app, Clerk auth, admin panel

## Goals
1. One Expo (React Native + react-native-web) app that runs on iOS, Android and web from a single codebase, mobile-first and responsive on every screen size.
2. Glassmorphism design system captured in `DESIGN.md` (pastel blues/purples, frosted panels, soft light, iOS 26 liquid-glass feel).
3. Three user screens only: Landing → Talk (camera SPA) → Settings. Optional Clerk sign-in; guests keep settings locally.
4. Admin panel (Clerk `publicMetadata.role === "admin"`) with Overview, Users, Settings, Support, Logs & audit, Info.
5. Lip-reading flow unchanged in latency and accuracy. Codebase simplified (KISS, no comments except critical ones).

## Explicit requirements
- Expo + React Native, shared code, industry-standard folder structure.
- `DESIGN.md` with the given prompt (positive, negative, parameters).
- Landing page: beautiful, minimal, clean "wow" animations, **Log in** and **Try now** (guest, local settings only).
- Clerk auth (app `app_3JPfuFFqgKP2jqlhPHnB63F0LFX`), works on web and native. Signed-in users' settings (voice) saved in DB.
- Remove: Run Agent panel, `POST /api/execute`, the old homepage text screen, the camera on/off switch.
- Talk screen = camera full-screen + Talk button + one small fixed settings icon (top-left). Nothing else.
- Admin users see one extra fixed button that opens the admin panel.
- Admin panel layout like Startix (left rail + sections). Sections: Overview, Users, Settings, Support, Logs & audit, Info (the current Info modal content moves here and is no longer public).
- Update `CLAUDE.md`; attach screenshots of the new pages at the end.

## Inferred requirements
- Guest vs signed-in: same Settings screen; storage backend switches (local storage / `/api/me/settings`).
- The Chat panel, chat store (`chat_memory`/`chat_messages`), demo presets and `app/src/lib/presets.ts` only existed for Run Agent → removed. `run_agent` keeps its optional `conversation` argument (agent tests still use it) but no client sends it.
- Workshop endpoints (`/api/team_info`, `/api/agent_info`, `/api/model_architecture`) stay; the admin Info section renders them.
- Backend needs Clerk JWT verification: `GET/PUT /api/me/settings` (any signed-in user) and `/api/admin/*` (admin role). Role is read from Clerk `public_metadata` via the Clerk backend SDK.
- `GET /api/db_ping` keepalive stays (DB now holds `user_settings`, `app_settings`, `audit_log`, `support_messages`).
- Vercel builds the Expo web export (`npx expo export -p web` → `app/dist`); rewrites unchanged.
- `e2e_check.py` drops the `/api/execute` stages and checks the new endpoints instead.

## Decisions (recommendation, not a survey)
- **Single Expo app, not a monorepo.** `app/` becomes one Expo Router project with `.web.ts`/`.native.ts` splits only where the platform differs (camera recording, secure storage). A packages/ monorepo like Startix is over-engineering for three screens.
- **Vite is replaced**, not kept alongside. Two web toolchains is the opposite of KISS.
- **Admin sections are thin.** Overview = health + counts; Users = Clerk users + their saved voice; Settings = global defaults (default voice) + feature flag `lipReading`; Support = messages users send from the Settings screen; Logs & audit = admin mutations + recent lip-read runs (text only, never video); Info = old About content.

## Implementation phases
1. **Scaffold Expo app** in `app/` (Expo Router, TypeScript, expo-blur, expo-camera, react-native-reanimated, Clerk Expo SDK). Delete Vite files. `DESIGN.md` + `src/ui` glass primitives + theme tokens. Vercel/launch config updated.
2. **Talk flow port**: `useRecorder.web.ts` (getUserMedia/MediaRecorder, unchanged logic) + `useRecorder.native.ts` (expo-camera). `executeLips` / `speak` API client unchanged. Talk screen: camera, Talk/Stop/Speak, word-reveal, settings icon, admin icon.
3. **Landing + Settings**: animated landing (Log in / Try now); Settings = voice picker (existing preset/record tabs) + account block (Clerk sign-in/out) + "Send feedback". Settings store: local for guests, `/api/me/settings` when signed in.
4. **Clerk**: CLI install → `clerk auth login` (interactive, user) → `clerk init --app app_3JPfuFFqgKP2jqlhPHnB63F0LFX` → keys in `.env` / `app/.env`. Backend `auth.py` (JWT verify + admin check).
5. **Backend cleanup + admin API**: remove `/api/execute` and chat routes; DB tables rewritten; `/api/me/settings`, `/api/admin/{overview,users,settings,support,audit}`; audit rows on mutations; lip-read runs logged (text only).
6. **Admin panel UI**: left rail (drawer on mobile) + six sections.
7. **Docs + verification**: `CLAUDE.md`, `README.md`, `e2e_check.py`, Playwright flows, screenshots.

## Acceptance criteria
- `npx expo start --web` and `npx expo export -p web` succeed; app renders on 375px, 768px, 1280px widths.
- Landing → Try now → Talk works with no account; voice choice persists after reload.
- Landing → Log in → Talk works; voice choice persists across devices (DB).
- Talk: record → sentence on screen → Speak plays audio with word reveal. Same request path (`POST /api/execute_lips` on Modal) and same clip normalization; no added round-trips before the upload.
- Non-admins never see the admin button; `/admin` shows a locked state. Admin sees all six sections; each loads real data.
- `/api/execute` returns 404; Run Agent, Chat, presets, camera toggle and public Info button are gone.
- `uv run python backend/e2e_check.py` passes for every stage runnable here; `uv run --extra test pytest tests/ -v -s` passes.
- No code comments except critical ones.

## Testing plan
- Playwright (web): landing buttons, guest talk flow (camera stubbed with a fake media stream + mocked `/api/execute_lips`), settings persistence, admin gate (signed-out, non-admin, admin with mocked Clerk session), admin sections render.
- Backend: `e2e_check.py` + pytest; manual curl of `/api/admin/*` with a real Clerk token.
- Real lip-read run through the deployed Modal VSR service to confirm latency and accuracy unchanged.
- Screenshots: landing, talk, settings, admin (mobile + desktop).

## Risks / assumptions
- Clerk login is interactive; I will pause at `clerk auth login` for you. If the CLI cannot scaffold Expo it falls back to the Expo quickstart docs (expected).
- Needed from you: `CLERK_SECRET_KEY` for the backend (`.env`, Vercel env) and the publishable key (the CLI writes it). Never printed or committed.
- Native (iOS/Android) recording uses expo-camera and can be verified only in the iOS Simulator (camera is a stub there); web is the primary verified target.
- Removing the chat store deletes the Supabase chat tables' usage (rows left in place, not dropped).
- react-native-web + expo-blur gives real `backdrop-filter` on web; native blur is BlurView.
