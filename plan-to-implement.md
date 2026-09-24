# Plan: make the lip-reading flow match `~/Desktop/tmp/lipreader`

## Goals

Replace every part of the prediction path (video in, sentence out) with the
reference desktop app's code, inside the existing Expo + FastAPI product.
Everything that is not lip reading stays as it is: routes, Clerk auth, voice
settings, admin panel, Supabase, the glass UI. One layout change: the Talk
screen must not fill the whole browser window on desktop.

## Explicit requirements

1. The English flow (record → read → correct → speak) and the Hebrew phrase
   flow (enrol → match → confirm) behave exactly as in the reference repo.
2. Keep the app structure, authentication, voice settings, admin panel, UI.
3. Talk screen is not full screen on desktop.
4. Open a pull request when finished.

## Inferred requirements (what "exactly like the repo" means, file by file)

### English reading

- **E1 Word options, not beam n-best.** The model returns the transcript plus
  per-word top-3 alternatives with CTC probabilities (reference
  `pipelines/model.py`). Beam size 40 as in the reference config (ours is 10).
- **E2 The clip is read as recorded.** OpenCV reads the uploaded file
  (orientation-aware), Mediapipe finds the face and crops the mouth. No ffmpeg
  re-decode to 640 px, no server-side face zoom, no fps resampling. The app
  uploads the full 1280×720 camera frame (the reference's webcam size) instead
  of the face-following 800 px crop, and sends the recording's duration so the
  server knows the real frame rate (reference: `frames / elapsed`).
- **E3 One direct Anthropic call.** `claude-sonnet-5`, adaptive thinking, low
  effort, 4096 tokens, system prompt from `build_system_prompt(mappings, notes)`,
  user message `Correct this:\n<word options>`. Same clean-up: last non-empty
  line, strip a leading `Corrected:`, add a full stop. The LangChain agent and
  the unused conversation-history argument go away.
- **E4 Refusals.** No face → "No face seen - record again", nothing kept. No
  words read → "(nothing read)" shown, the corrector is not called.
- **E5 Learning mode** (reference `L`): the patient says a sentence, the app
  shows what the model read and what the corrector made of it, the clinician
  confirms or fixes the sentence, and the pair is saved as an example for this
  speaker. Examples are appended to the corrector's prompt on every later run.
- **E6 Patient notes** (reference `N`): up to nine short notes about the
  patient, typed or dictated, appended to the prompt so the corrector can pick
  the word that fits the person (the reference's horse breeder / beekeeper
  rule). Dictation uses the browser's own speech recognition, which the app
  already has for "Heard"; Whisper is not portable. Hebrew notes are sent as
  they are (the reference translated them only because its OpenCV window could
  not draw Hebrew).
- **E7 Where examples and notes live.** On the device, next to the other local
  settings, and sent with every `/api/execute_lips` request. This mirrors the
  reference (one installation = one patient), keeps clinical notes off the
  server, and needs no new tables or admin screens.
- **E8 Run log.** Each run stores the model's top-1 reading, the word-options
  string, the corrected sentence, the notes the corrector saw, the clip fps,
  the confirmed truth (learning mode / Hebrew confirmation) and the Hebrew
  ranking, plus the fields we already keep (heard, framing, latency). The
  `nbest` column stops being written.

### Hebrew phrase mode

- **H1 Two signatures.** Each clip becomes (a) the visual encoder's per-frame
  features and (b) eight lip measurements from FaceMesh in a head-fixed frame.
  Trimmed to where the lips move, normalised, matched by DTW on both.
- **H2 Thresholds from the self-test.** Signature weights, scales, the
  confidence limit and the margin come out of a leave-one-take-out test over the
  patient's own takes. Nothing hand-set. Recomputed from the stored takes on
  each request (the reference recomputes on every save).
- **H3 Enrolment verdicts.** A take is refused when there is no face, the lips
  never move, or there is no still moment before and after. A kept take gets a
  verdict the moment it lands: "ok (2/3)", "record a second one and the
  self-test can judge it", or "closer to <other phrase> than to its own takes -
  drop it or record again". Each phrase shows its status (ok / 1 take - less
  reliable / confused with …) and the list shows the self-test line. A phrase's
  last take can be dropped.
- **H4 Runtime.** The best phrase is named with how sure the matcher is
  (בטוח / לא בטוח). When unsure, the existing "Which one?" buttons show the top
  three and the choice is logged as the truth, so real use keeps measuring the
  matcher. When confident the phrase is shown and spoken as today.
- **H5 Storage.** Takes are stored per patient in `phrase_templates` as both
  signatures plus fps. No video is ever kept (project rule), so the reference's
  "rebuild features from the kept clips" has no equivalent here.
- **H6 Seed templates** are removed (the reference has none; no seed file exists).
- **H7 Phrase list.** The reference enrols ten phrases; all ten exist with the
  same ids in our 100-phrase bank. The bank stays as it is; the matcher ranks
  whichever phrases have takes, as the reference does.

### App

- **A1 Talk screen** shows the corrected sentence as now, with the model's raw
  reading under it in the same muted style as "Heard" (the reference shows both
  MODEL and LLM lines). Refusals appear as a toast.
- **A2 Desktop layout.** At 1024 px and wider the Talk screen sits in a centred
  480 px-wide rounded frame (height capped at about 860 px) on the glass
  background instead of filling the viewport. Phone and tablet are unchanged.
- **A3 Settings** gains two sections in English mode: "Teach Chaplin" (learning
  mode, with the saved examples and a way to delete one) and "About the
  patient" (notes: add, edit, delete, dictate). Both use the existing glass
  components and `t(language, key)` strings.
- **A4 Phrase bank** shows the per-phrase status, the self-test line, the verdict
  after each take and a "drop last take" action.
- **A5 Recorder** uploads the full frame (E2) and reports the clip duration. The
  quality pill and framing numbers stay (they are measurement only).

### Not ported, on purpose

- The reference's on-screen lip guide during enrolment ("Lips: still / moving")
  needs FaceMesh in the browser; the existing quality pill already covers no
  face, too far and cut off.
- Whisper dictation, the macOS file dialog, the OpenCV window, `runs.jsonl`,
  `context_test/replay.py` (a manual script over `runs.jsonl`).

## Implementation phases

1. **VSR core.** Bring over the reference `pipelines/model.py` (word
   alternatives, `encode_features`), beam size 40, and rewrite `vsr.py` to
   `read(path) -> (transcript, alternatives)` and `signatures(path)`. Delete the
   ffmpeg decode and face-zoom code.
2. **Corrector.** New `backend/app/corrector.py`: prompt builder, word-options
   formatter, the one Anthropic call, clean-up. Remove `backend/app/agent/` and
   the LangChain dependencies; point `meta.py` at the new prompt.
3. **Hebrew matcher and store.** New `backend/app/hebrew.py` with the reference
   matching core (signatures, trim, normalise, DTW, thresholds, self-test,
   verdicts) on top of a DB-backed take store. Migrate `phrase_templates`
   (add geometry and fps columns; old rows are dropped since they lack them).
4. **VSR service endpoints.** `execute_lips` (English and Hebrew branches,
   examples/notes/duration fields), `enroll_phrase` (verdict), `phrase_templates`
   (status + self-test), drop-last-take. `/api/runs` gains the new fields.
5. **App.** `api.ts` types and calls; recorder; Talk screen; Settings sections
   and local store for examples and notes; PhraseBank statuses; desktop frame;
   i18n strings.
6. **Tests and checks.** Port the reference tests (`test_hebrew.py` synthetic
   suite, CTC/format tests, SRAVI clip eval) onto the new modules; rewrite the
   execute_lips branch tests and the corrector tests; update `e2e_check.py` and
   the Playwright mocks. Port `hebrew_eval.py` as a per-patient script over the
   database. Docs: CLAUDE.md, DESIGN.md, PRD where the flow is described.
7. **PR.**

## Acceptance criteria

- `POST /api/execute_lips` (English) returns the corrected sentence, and its
  `vsr` step carries the model top-1 and the word-options string in the
  reference format `WORD(92%)/ALT(5%)/ALT2(3%)`.
- The corrector request is a single `claude-sonnet-5` call with the reference
  system prompt, learned examples and notes appended when present.
- A clip with no face is refused with the reference message; a clip with no
  words shows "(nothing read)" and makes no LLM call.
- Hebrew: enrolling a take returns takes-so-far and a verdict; a still clip or a
  clip with no rest is refused; `phrase_templates` returns per-phrase status and
  the self-test tally; a confident match returns one phrase, an unsure match
  returns three candidates; the confirmed choice is logged as truth.
- Learning mode saves an example that appears in the next run's prompt; notes
  appear in the prompt; both survive a reload on the same device.
- Talk screen at ≥1024 px renders inside a centred frame; at phone width it is
  unchanged.
- `npm run typecheck`, `pytest backend/tests` (fast suites), `e2e_check.py`
  and the Playwright suite pass; results reported as they are.

## Testing plan

- Unit (no weights): `test_hebrew.py` port, corrector prompt/format/clean-up
  tests, execute_lips branch tests with the model stubbed.
- With weights (local): `test_vsr_pipeline.py` on the test clips; SRAVI eval
  through the new path.
- Live: `uv run python backend/tests/e2e_check.py`; Playwright `npm run e2e`
  (outside the sandbox) with updated mocks; a manual recording through the web
  app against the local VSR service.

## Risks and assumptions

- Mediapipe's legacy FaceMesh (`mp.solutions.face_mesh`) is used for lip
  geometry; it exists in the pinned 0.10.21 and runs on CPU, adding roughly a
  second per five-second clip on Modal.
- Browser WebM clips have a variable frame rate; the server trusts
  `frames / duration` from the app, not the file header (same as the reference).
- Uploads grow from an 800 px crop to the full 720p frame (a few MB per clip).
- Existing Hebrew takes cannot be migrated (no lip geometry stored); patients
  re-enrol. Existing runs keep their columns; `nbest` is left in place, unused.
- `claude-sonnet-5` with adaptive thinking is what the reference measured; the
  model id stays configurable through `LLM_MODEL`.
- The Vercel API backend keeps `anthropic` in `requirements.txt` only for the
  prompt module import; LangChain packages are dropped everywhere.
