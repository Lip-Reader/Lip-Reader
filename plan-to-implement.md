# Plan: Hebrew phrase mode, language setting, flip camera (issue #11)

## Goals
1. A Hebrew-speaking ventilated patient can pick "Hebrew" in Settings, teach the app how they mouth
   phrases from a fixed list of 100, and then have the app recognise one phrase per clip, speak it,
   and ask (top-3 buttons) when unsure.
2. A flip-camera button on the Talk screen (front / back), on web and native.
3. English lip reading keeps exactly the same code path, output and accuracy.

## Context found
- No Hebrew lip-reading model or data exists; the issue's approach is a closed phrase list matched
  against per-patient templates built from the visual encoder Chaplin already runs (Auto-AVSR).
- The encoder is reachable today: `AVSR.model.encode(video)` in `backend/pipelines/model.py` returns
  one 768-d vector per frame at 25 fps, before the English text decoder.
- Inworld has two Hebrew voices (Oren, Yael), so Hebrew speech works through the existing `/speak`.
- The VSR service (Modal) has no database access today; `chaplin-secrets` holds only
  `ANTHROPIC_API_KEY`. Templates need a store, so the VSR service gets `DATABASE_URL`.
- Notion holds nothing for this project (the workspace is for a different product).
- No face clips exist on disk: `assets/test_videos/ground_truth.json` names four English `.mov`
  files that are gitignored and not present, and `assets/sravi_test_videos` has only ground truth.

## Explicit requirements (from issue #11 and the request)
- R1 Language setting `en | he` next to `voice_id`, in local storage and `user_settings`; segmented
  control in Settings; Hebrew shows the phrase list section; Hebrew text renders right-to-left.
- R2 `assets/phrases/he.json`: 100 phrases, 10 groups x 10, each with `id`, `text_m`, `text_f`,
  `category`; shown grouped and searchable in Settings; patient gender toggle picks the form.
- R3 Enrollment "Teach my phrases": 3 takes per phrase, progress per phrase and group, skippable;
  only encoder features leave the device (video deleted after extraction); stored in a new
  `phrase_templates` table keyed by patient; guests work without sign-in.
- R4 `POST /api/execute_lips` gains `language` (+ patient key). Hebrew: same face crop and encoder,
  match against the patient's templates (plus seed set if present), return top-3 with scores and a
  confident flag; confident -> speak, otherwise the Talk screen shows three tappable candidates.
  Runs are logged as text only.
- R5 Flip-camera icon button, fixed top-right on Talk, `testID="flip-camera-button"`;
  `recorder.types.ts` gains `facing` + `flip()`; web `facingMode`, native `CameraView facing`;
  disabled while recording; choice remembered.
- R6 Hebrew voices in the picker when language is Hebrew (Inworld has them).
- R7 Tests: matcher unit tests; e2e_check stages for Hebrew and enrollment; typecheck; Playwright for
  language toggle, enrollment round-trip, flip button, and unchanged guest/admin flows; English
  transcripts unchanged; Hebrew latency no worse than English.
- R8 Out of scope: free-text Hebrew, translating the app UI, certification.

## Inferred requirements
- I1 English invariance is structural: `language` defaults to `en` and the existing code runs
  untouched; the Hebrew branch is a separate module (`backend/app/phrases.py`).
- I2 Patient key: a random UUID created on the device on first use (`chaplin_patient` in storage).
  Members also get it stored in `user_settings.patient_key` so it follows them across devices. The
  VSR service trusts the key (it is unguessable, and templates are features only, never video).
- I3 Template size must stay small: encoder output downsampled x2 in time, stored as float16 bytes
  (about 60 KB per 3-second take, 18 MB for a fully enrolled patient).
- I4 Matching: dynamic time warping over per-frame cosine distance with a Sakoe-Chiba band,
  normalised by path length; a phrase's score is the best of its takes. Confident when the best
  score is under an absolute threshold and the runner-up is at least a margin worse. Thresholds are
  constants in `phrases.py`, to be tuned when Hebrew clips exist.
- I5 Seed templates: optional `assets/phrases/he_seed.npz` built by
  `backend/tools/build_phrase_seed.py` from `assets/hebrew_clips/<phrase_id>/*.mp4`. If absent,
  only enrolled phrases are candidates and Settings says so.
- I6 The phrase list is served by the API backend (`GET /api/phrases/he`) from the single JSON in
  `assets/`, so app and both services share one source without a Metro config change.
- I7 `PUT /api/me/settings` accepts partial bodies (`voice_id`, `language`, `patient_key`), and the
  existing voice-only call keeps working.
- I8 Talk screen in Hebrew: after Stop, confident -> the phrase shows (RTL) with Speak; not confident
  -> three candidate buttons plus "None of these"; picking one shows it with Speak. Runs log the
  chosen phrase and the candidate ids.
- I9 Modal image adds `psycopg[binary]`; deploy notes tell the operator to add `DATABASE_URL` to
  `chaplin-secrets`. Without it, enrollment returns a clear error and Hebrew recognition still
  works with the seed set if present.
- I10 Mirror the preview only for the front camera (back camera must not be mirrored).

## Implementation phases
1. **Data and shared contract.** `assets/phrases/he.json` (100 phrases), `backend/app/phrases.py`
   (load list, feature packing, DTW matcher, confidence), `db.py` (`language` + `patient_key`
   columns, `phrase_templates` table and functions), `GET /api/phrases/{lang}` on the API backend,
   partial `PUT /api/me/settings`.
2. **VSR service.** `vsr.py`: `extract_features(video)` using the same loader and `model.encode`.
   `vsr_main.py`: `language` + `patient_key` on `execute_lips`; `POST /api/enroll_phrase`;
   `GET/DELETE /api/phrase_templates`. Modal image + secret notes. Seed builder script.
3. **App: settings and language.** `settingsStore`: `language`, `patientKey`, `gender`, sync rules.
   Settings screen: language segmented control, Hebrew phrase section (grouped, searchable, RTL,
   enrolled badges), enrollment panel (camera, phrase, 3 takes, progress), Hebrew voices in picker.
   `api.ts`: new calls and `executeLips(clip, {language, patientKey})`.
4. **App: Talk screen.** Flip-camera button and recorder `facing`/`flip()` on web and native;
   Hebrew result handling (confident / candidates / none); run logging.
5. **Tests and checks.** `backend/tests/test_phrases.py`; English golden test in
   `test_vsr_pipeline.py` (runs when `assets/test_videos/*.mov` exist); `e2e_check.py` stages;
   Playwright specs + mocks; `npm run typecheck`; `npm run shots` for the new screens.
6. **Docs.** CLAUDE.md architecture lines, README/PRD notes on Hebrew mode and the Modal secret.

## Acceptance criteria
- Settings shows English / Hebrew; choosing Hebrew shows 100 phrases in 10 groups, searchable, RTL,
  with a gender toggle, each phrase showing takes enrolled (0/3 .. 3/3), and the choice survives
  reload (guest: local only, no `/api/me/settings` call).
- Enrollment stores features only; `phrase_templates` rows have bytes, never video; the temp clip is
  removed after extraction.
- `POST /api/execute_lips` with `language=en` returns exactly today's shape and text; with
  `language=he` returns `candidates` (top-3 with scores), `confident`, and `response` = best phrase.
- Talk in Hebrew: confident -> phrase + Speak; otherwise three candidate buttons; tapping one shows it
  and Speak works with a Hebrew voice.
- Flip button visible top-right, toggles front/back on web (facingMode) and native (facing), is
  disabled while recording, and the choice is remembered after reload.
- All existing Playwright, pytest and typecheck runs stay green; `e2e_check.py` reports PASS for
  every stage that has the needed keys.
- English golden test: raw transcription of each `assets/test_videos` clip is identical before and
  after the change (asserted against the transcription produced by the unchanged main checkout).

## Testing plan
- Unit (no weights): phrase file integrity; feature pack/unpack; DTW on synthetic sequences
  (time-warped + noisy copies rank first and are confident; equidistant candidates are not
  confident; single-template edge case).
- Model (weights, CPU): feature extraction returns (T/2, 768) float16 for a face clip; English
  golden transcription unchanged (needs the four `.mov` files placed in `assets/test_videos`).
- Service: `e2e_check.py` stages for phrases list, Hebrew execute_lips, enroll_phrase.
- App: typecheck (web + native); Playwright guest spec (language toggle, phrase list, enrollment
  round-trip with mocked endpoints, flip camera, Hebrew talk flow) and unchanged existing specs;
  screenshots of Settings (Hebrew) and Talk (candidates).
- Playwright runs outside the sandbox (fake camera hangs inside it).

## Risks / assumptions
- Hebrew accuracy (80 % top-1, 90 % top-3) cannot be measured in this session: no Hebrew clips
  exist. I ship the eval harness (`backend/tests/test_phrase_eval.py`, driven by
  `assets/hebrew_clips/<patient>/<phrase_id>/*.mp4`) and the seed builder; numbers come once
  clips are recorded.
- English regression evidence needs the four gitignored `.mov` clips in `assets/test_videos`. If
  they are not available, the evidence is the untouched code path plus the pipeline test on any
  face clip the user provides.
- The encoder is English-trained; its features may separate Hebrew phrases less well than a
  Hebrew-tuned encoder would. The matcher is isolated so the feature source can change later.
- The phrase list was written by me (a nurse or speech therapist should review it); ids are stable
  so wording edits do not break templates.
- Modal deploy needs `DATABASE_URL` added to `chaplin-secrets` by the operator; I will not change
  Modal secrets without confirmation.
