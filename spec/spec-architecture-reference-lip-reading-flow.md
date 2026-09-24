---
title: Reference lip-reading flow inside the Chaplin AI app
version: 1.0
date_created: 2026-09-24
owner: Adam Sion
tags: [architecture, backend, app, vsr, hebrew, corrector]
---

# Introduction

This specification describes how the prediction path of Chaplin AI (camera clip
in, spoken sentence out) is replaced by the code and behaviour of the reference
desktop application at `/Users/adams/Desktop/tmp/lipreader` ("the reference").
Everything outside the prediction path (routing, Clerk authentication, voice
settings, admin panel, Supabase tables other than those named here, the glass
UI kit) is unchanged. One layout requirement is added: the Talk screen does not
fill the browser window on desktop.

## 1. Purpose & Scope

Audience: the implementer (a generative AI agent) and reviewers. The document is
self-contained; the reference files it derives from are named so behaviour can
be checked against them.

In scope: `backend/pipelines/model.py`, `backend/app/vsr.py`,
`backend/app/vsr_main.py`, `backend/app/corrector.py` (new),
`backend/app/hebrew.py` (new), `backend/app/phrases.py`, `backend/app/db.py`,
`backend/app/main.py` (`/api/runs`), `backend/app/admin.py` (runs listing),
`backend/app/meta.py`, dependency manifests, `modal_app.py`, the Expo app under
`app/src` (api client, recorder, Talk screen, Settings, PhraseBank, i18n,
theme), tests under `backend/tests` and `app/e2e`, and the docs that describe
the flow (`CLAUDE.md`, `app/DESIGN.md`, `README.md`).

Out of scope: TTS, voice enrolment, sign-in, admin sections other than the runs
table, the native recorder beyond reporting the clip duration.

## 2. Definitions

- **VSR**: visual speech recognition, the Auto-AVSR model that reads lips.
- **Word options**: the reference's per-word alternatives string, for example
  `I(91%)/HOW(1%)/HI(0%) HOW(100%)/OUT(0%)/WHAT(0%)`. Each word position lists up
  to three candidate words with the CTC probability as a rounded percentage;
  a multi-token word has a single option with its minimum token probability.
- **Model top-1**: the first option of every word position joined by spaces,
  for example `I HOW YOU DAY`. When there are no alternatives, the beam
  transcript.
- **Corrector**: one Claude call that turns word options into a sentence.
- **Learned examples** (reference "learning mode", `learned_mappings.json`):
  pairs `{phrase, model_output}` where `model_output` is the word-options string
  the model produced and `phrase` is what the speaker actually said, confirmed
  by a clinician.
- **Patient notes** (reference "notes mode"): up to nine short free-text notes
  about the patient, appended to the corrector prompt.
- **Signature A**: the VSR visual encoder's per-frame features, shape (T, 768).
- **Signature B**: eight lip measurements per frame from Mediapipe FaceMesh in
  a head-fixed frame, shape (T, 8).
- **Take**: one enrolment recording of one Hebrew phrase, stored as both
  signatures plus the clip's frame rate.
- **DTW**: dynamic time warping, the alignment distance used by the matcher.
- **Self-test**: leave-one-take-out evaluation over a patient's own takes; its
  outcome sets the thresholds and signature weights.
- **Thresholds**: `{w_a, w_b, scale_a, scale_b, abs_max, margin}` as produced by
  the reference `hebrew.thresholds_from`.
- **BadClip**: a clip that cannot be used. Subclasses: `NoFace` (no face in any
  frame) and `StillClip` (lips never moved, or no still moment before/after).
- **patient_key**: device-generated UUID that keys a patient's takes.

## 3. Requirements, Constraints & Guidelines

### VSR core

- **REQ-001**: `backend/pipelines/model.py` is the reference `pipelines/model.py`
  (CTC per-word alternatives, `encode_features`), keeping the `encoding="utf-8"`
  fix when reading the token file. `AVSR.infer(data)` returns
  `(transcription: str, alternatives: list[list[tuple[str, float]]])`.
- **REQ-002**: `assets/configs/LRS3_V_WER19.1.ini` has `beam_size=40`.
- **REQ-003**: `backend/pipelines/pipeline.py` keeps the deferred landmark
  detector construction (`init_landmarks_detector`, needed for the Modal CPU
  snapshot) and otherwise matches the reference: `forward(path)` accepts a file
  path only and returns `self.model.infer(data)` unchanged, i.e. the tuple. The
  frame-array pass-throughs in `pipelines/data/data_module.py` and
  `pipelines/detectors/mediapipe/video_process.py` are removed.
- **REQ-004**: `backend/app/vsr.py` exposes:
  - `get_model(device=None)` and `move_model_to_device()` unchanged.
  - `class BadClip(Exception)` with `.detail`, `class NoFace(BadClip)` whose
    message is `"No face seen - record again"`, and a context manager
    `refusing_no_face()` turning `AssertionError` into `NoFace` (reference
    `hebrew.BadClip`, `NoFace`, `refusing_no_face`).
  - `read(path) -> tuple[str, list]`: `model(path)` inside `refusing_no_face()`.
  - `signatures(path) -> tuple[np.ndarray, np.ndarray]`: reference
    `hebrew.signatures(vsr, path)`, both float32; asserts equal length.
  - `clip_fps(path, duration_ms: float | None) -> float`: frame count divided by
    `duration_ms / 1000` when a duration is given (rounded to 1 decimal, like the
    reference `round(frames / elapsed, 1)`), otherwise OpenCV's `CAP_PROP_FPS`
    rounded to 1 decimal (the reference's behaviour for an opened file).
- **REQ-005**: The ffmpeg decode (`_decode_clip`), the face zoom
  (`_zoom_to_face`) and `transcribe_clip`, `transcribe_clip_nbest`,
  `extract_features`, `NoFaceError`, `NoSpeechError` are removed. No caller
  remains.

### Corrector

- **REQ-010**: New module `backend/app/corrector.py` containing, verbatim from
  the reference `chaplin.py`: `LLM_SYSTEM_PROMPT_BASE`,
  `build_system_prompt(mappings=None, notes=None)` (without file loading; an
  absent `mappings` means no examples), `format_words(alternatives)` (the
  reference `_format_words_for_llm`), and `correct(raw, mappings, notes) -> str`
  reproducing `Chaplin._correct`: `anthropic.Anthropic().messages.create(model=
  config.LLM_MODEL, max_tokens=4096, thinking={"type": "adaptive"},
  output_config={"effort": "low"}, system=build_system_prompt(mappings, notes),
  messages=[{"role": "user", "content": f"Correct this:\n{raw}"}])`, then: take
  the first `text` block, strip, keep only the last non-empty line (logging the
  discarded lines), strip a leading `Corrected:`, append `.` when the last
  character is not one of `.?!`.
- **REQ-011**: `top1(alternatives, transcript)` returns the model top-1 as
  defined in section 2.
- **REQ-012**: `backend/app/agent/` is deleted. `backend/app/meta.py` imports
  `LLM_SYSTEM_PROMPT_BASE` from `corrector` for its examples, and the
  `AGENT_INFO` text and `prompt_examples` describe the word-options input and a
  single `correct` step (the conversation example is removed).
- **REQ-013**: `langchain`, `langgraph`, `langchain-anthropic` are removed from
  `pyproject.toml`, `requirements.txt` and `modal_app.py`. `anthropic` stays.
- **CON-010**: The synchronous Anthropic client is used; the VSR endpoints are
  synchronous `def` routes.

### Hebrew matcher and store

- **REQ-020**: New module `backend/app/hebrew.py` containing, verbatim from the
  reference `hebrew.py` (same names, same constants, same docstrings where they
  still apply): `TARGET_HZ, BAND, TAKES_WANTED, TOP_K, WRONG_COST, SIGNATURES,
  STILL, SMOOTH_S, MERGE_S, EYES, NOSE, INNER_*, OUTER_*, INNER_RING`,
  `StillClip`, `by_phrase`, `lip_vector`, `face_mesh`, `face_points`,
  `lip_geometry`, `lip_speed`, `active_spans`, `trim`, `normalise`, `dtw`,
  `distances`, `scored`, `closest`, `rank`, `gap`, `decide`, `leave_one_out`,
  `outcomes`, `tally`, `summarise`, `thresholds_for`, `thresholds_from`.
  `Guide`, `DIGITS`, `digit`, `label`, `phrase_at`, `shown`, the screens and the
  disk `Store` are not ported. `BadClip`/`NoFace`/`refusing_no_face` live in
  `vsr.py` and are re-exported or imported here.
- **REQ-021**: `hebrew.py` also holds the template bytes helpers `pack(feats)`
  and `unpack(blob, frames, dim)` (moved from `phrases.py`, float16 little
  endian), and a class `Takes` that is the reference `Store` without disk:
  - constructed from the database rows of one patient
    (`Takes(rows)` where each row has `id, phrase_id, fps, features, frames,
    dim, geometry`); `takes` is `[{"phrase", "key": str(id), "fps"}]`,
    `raw` is `{key: (a, b)}`.
  - `_recompute()` sets `b_scale`, `norm`, `rows`, `thresholds`, `loo` exactly
    as the reference.
  - `by_phrase()`, `count(phrase)` as the reference.
  - `verdict(key) -> dict` with `{"code": "first_take" | "ok" | "confused",
    "other": phrase_id | None, "takes": n}` (the reference's three verdict texts).
  - `status(phrase) -> dict | None`: `None` when the phrase has no takes,
    otherwise `{"code": "confused", "other": id}` (most frequent confusion),
    `{"code": "one_take"}` or `{"code": "ok"}`, in the reference's order.
  - `self_test -> dict | None`: `{"n", "top1", "top3"}` from `loo`, or `None`.
- **REQ-022**: `backend/app/phrases.py` keeps only the phrase list:
  `load_phrases`, `phrase_text`, `phrase_ids`, `PHRASES_DIR`. Matching, packing
  and the seed set are removed from it; `assets/phrases/he.json` is unchanged.
- **REQ-023**: `db.py` table `phrase_templates` gains `geometry BYTEA` and
  `fps REAL` (via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Rows with
  `geometry IS NULL` are deleted by the DDL block (they predate signature B and
  cannot be matched). Functions:
  - `add_phrase_template(patient_key, phrase_id, features, frames, dim,
    geometry, fps) -> int` (the new row id; no per-phrase cap).
  - `list_phrase_templates(patient_key) -> list[dict]` with
    `id, phrase_id, frames, dim, features, geometry, fps`, ordered by id.
  - `delete_last_phrase_take(patient_key, phrase_id) -> bool`.
  - `delete_phrase_templates(patient_key, phrase_id=None) -> int` unchanged.
  - `count_phrase_takes` is removed (the counts come from `Takes`).
- **CON-020**: No video is ever stored. Uploaded clips are deleted in a
  `finally` block, as today.
- **CON-021**: Thresholds are recomputed from the patient's stored takes on
  every request that needs them; nothing is cached in the database.

### VSR service endpoints (`backend/app/vsr_main.py`)

- **REQ-030**: `POST /api/execute_lips` form fields: `file` (required),
  `language` (`en` default), `patient_key`, `gender` (`m` default),
  `duration_ms` (float, optional), `examples` (JSON array of
  `{phrase, model_output}`, optional), `notes` (JSON array of strings,
  optional). `conversation` is removed.
- **REQ-031**: English branch: `fps = vsr.clip_fps(path, duration_ms)`;
  `transcript, alts = vsr.read(path)`; `word_options = format_words(alts)`;
  `model = top1(alts, transcript)`. If `word_options` is blank, return the error
  `{"code": "nothing_read", "error": "Nothing read - try again"}` and do not
  call the corrector. Otherwise `corrected = correct(word_options, examples,
  notes)` and return the ok shape of section 4 with steps `vsr` and `correct`.
- **REQ-032**: Hebrew branch (`language == "he"`): `Takes` from the patient's
  rows; if `takes.thresholds is None` return error code `not_enrolled` with
  message `"No phrases enrolled yet - teach a few phrases in Settings first"`.
  Otherwise `query = normalise(*vsr.signatures(path), fps, takes.b_scale)`,
  `ranked = rank(query, takes.by_phrase(), takes.thresholds)`, `confident =
  decide(ranked, takes.thresholds)`, return the ok shape with `response` = the
  gendered text of `ranked[0][0]`, `confident`, `candidates` (top `TOP_K`), and
  `hebrew = {"ranked": [[pid, score, d_a, d_b] rounded to 4 decimals],
  "confident": confident}`.
- **REQ-033**: `BadClip` anywhere in either branch returns the error shape with
  `error` = the exception message and `code` in `{"no_face", "still",
  "no_rest"}` (`NoFace` -> `no_face`; `StillClip` -> `still` when the message
  starts with `"nothing moved"`, else `no_rest`), logged with `.detail`.
- **REQ-034**: `POST /api/enroll_phrase` (`file`, `patient_key`, `phrase_id`,
  `duration_ms` optional): computes `fps` and both signatures, calls
  `hebrew.trim(b, fps)` before writing (a refused clip stores nothing), stores
  the take, rebuilds `Takes` and returns `{"status": "ok", "error": null,
  "phrase_id", "takes": n, "frames": T, "verdict": takes.verdict(key)}`.
  Refusals use REQ-033.
- **REQ-035**: `GET /api/phrase_templates?patient_key=` returns
  `{"status": "ok", "error": null, "storage": bool, "takes": {pid: n},
  "status_by_phrase": {pid: status dict}, "self_test": dict | null}`.
  Without storage: `takes {}`, `status_by_phrase {}`, `self_test null`,
  `storage false`.
- **REQ-036**: `DELETE /api/phrase_templates?patient_key=&phrase_id=&last=1`
  drops the newest take of that phrase and returns `{"status": "ok", "error":
  null, "deleted": 0 | 1, "takes": n}`; without `last` the existing behaviour
  (all takes, or all takes of one phrase) is kept.
- **REQ-037**: `_err(message, code=None)` adds `"code": code` to the error body.
  `_ok(...)` is unchanged.

### Run log (API backend)

- **REQ-040**: `RunBody` gains `word_options: str | None`, `notes: list[str] |
  None`, `clip_fps: float | None`, `truth: str | None`, `hebrew: dict | None`;
  `nbest` is removed from the body. `runs` table gains the matching columns
  (`word_options TEXT, notes JSONB, clip_fps REAL, truth TEXT, hebrew JSONB`).
  The `nbest` column stays in the table, unused.
- **REQ-041**: `db.add_run` and `db.list_runs` carry the new fields;
  `list_runs` also returns `word_options` and `truth`. The admin Runs table
  shows columns `Time, User, Read, Word options, Corrected, Truth, Heard,
  Latency` where `Read` is `raw`.

### App: API client (`app/src/lib/api.ts`)

- **REQ-050**: `ExecuteOptions = { language, patientKey, gender, durationMs?,
  examples?: Example[], notes?: string[] }` where `Example = { phrase: string;
  model_output: string }`. `executeLips` appends `duration_ms` when given, and
  for English appends `examples` and `notes` as JSON strings when non-empty.
- **REQ-051**: `ExecuteResult = { response, steps, raw, wordOptions, clipFps,
  confident?, candidates?, hebrew? }` where `raw` is the `vsr` step's `model`
  (English) or the best candidate id (Hebrew), `wordOptions` the `vsr` step's
  `word_options` (`""` for Hebrew), `clipFps` the `vsr` step's `fps`.
- **REQ-052**: Errors from the service carry the code: `class ApiError extends
  Error { code?: string }`; `executeLips`, `enrollPhrase` and `dropLastTake`
  throw it with `data.code`.
- **REQ-053**: `logRun(token, run: RunLog)` with `RunLog = { raw, corrected,
  latencyMs, framing?, heard?, wordOptions?, notes?, clipFps?, truth?,
  hebrew? }` posting the snake_case body of REQ-040. `nbestOf` is removed.
- **REQ-054**: `getPhraseTemplates` returns the REQ-035 shape (`PhraseTemplates
  = { takes; status_by_phrase; self_test; storage }`); `enrollPhrase(clip,
  patientKey, phraseId, durationMs?)` returns `{ takes, verdict }`;
  `dropLastTake(patientKey, phraseId)` returns `{ takes }`.

### App: recorder

- **REQ-060**: `recorder.web.tsx` records the camera stream directly with
  `MediaRecorder` (no crop canvas, no `captureStream`), requesting
  `width 1280, height 720` ideal and `frameRate 30` ideal. The face detector,
  quality loop, quality pill and `framingRef` stay; `framingRef` no longer has
  `cropSide` and is filled from the detected box at start and last box at stop.
- **REQ-061**: Both recorders expose `durationRef: { current: number }` (ms
  between `start()` and `stop()` resolving); `Recorder` type gains
  `durationRef?`.
- **CON-060**: The recorder never scales or re-encodes frames.

### App: Talk screen

- **REQ-070**: After an English result the sentence is shown as today, and a
  second muted line `"{t(readLabel)}: {raw}"` (test id `read`) shows the model
  top-1 under it, above the existing "Heard" line. After a Hebrew confident
  result the phrase is shown; unsure results use the existing "Which one?"
  buttons.
- **REQ-071**: `processClip` passes `durationMs`, and for English `examples`
  and `notes` from settings. `logRun` receives `wordOptions`, `notes`,
  `clipFps`, `hebrew` (Hebrew only), `heard`, `framing`. Choosing a candidate
  logs `truth: candidate.id` and `corrected: candidate.text`.
- **REQ-072**: Service errors with a code map to i18n toasts:
  `no_face -> noFaceToast`, `nothing_read -> nothingReadToast`,
  `still -> stillClipToast`, `no_rest -> noRestToast`,
  `not_enrolled -> notEnrolledToast`; other known messages are shown as today.
- **REQ-073**: Desktop frame: when `useWindowDimensions().width >= bp.lg`
  (1024) the Talk screen renders `<Background>` full-window with the existing
  Talk root inside a centred `View` of width 480, height
  `min(windowHeight - 48, 860)`, `borderRadius: radius.lg`, `overflow: hidden`,
  the theme shadow and a 1 px `glassBorder`. Below 1024 the layout is unchanged.
  Absolute-positioned children (controls, pills, toast, bottom bar) position
  inside the frame.

### App: Settings

- **REQ-080**: Settings store keeps `examples: Example[]` and `notes: string[]`
  in the local settings record (not synced to the server), with `setExamples`
  and `setNotes`. `useSettings()` exposes them.
- **REQ-081**: New section "Teach Chaplin" (English only, after Language):
  component `TeachPanel` (`app/src/features/settings/TeachPanel.tsx`) with its
  own `RecorderProvider` and `CameraPreview` (as `EnrollPanel` does). Flow:
  Record -> Stop -> shows `Read: <model top-1>` and `Chaplin: <corrected>` ->
  buttons `Yes, that's right` (test id `teach-yes`), `No, fix it`
  (`teach-no`, reveals a `TextInput` prefilled with the corrected sentence and a
  `Save` button `teach-save`), `Skip` (`teach-skip`). Yes/Save append
  `{phrase: truth, model_output: wordOptions}` to `examples` and log the run
  with `truth`; Skip logs the run with `truth: null`. Below: the saved examples
  list (phrase text, delete control `teach-delete-<i>`) and a count line.
  Refusals show the REQ-072 messages inline.
- **REQ-082**: New section "About the patient" (English only): component
  `NotesPanel` (`app/src/features/settings/NotesPanel.tsx`). Lists notes with
  Edit and Delete; `Add note` (disabled at nine notes, `MAX_NOTES = 9`) opens a
  `TextInput` with Save/Cancel; when `canListen()` a microphone button toggles
  dictation through `startListening(language)` and appends the heard text to the
  input at stop. Notes are trimmed and capped at 10000 characters.
- **REQ-083**: i18n keys added to `app/src/lib/i18n.ts` in both languages:
  `readLabel, noFaceToast, nothingReadToast, stillClipToast, noRestToast,
  notEnrolledToast, teachSectionTitle, teachSectionHint, teachRecordLabel,
  teachReadLabel, teachChaplinLabel, teachYesLabel, teachNoLabel,
  teachSkipLabel, teachSaveLabel, teachExamplesLabel, teachDeleteLabel,
  teachEmptyLabel, notesSectionTitle, notesSectionHint, noteAddLabel,
  noteEditLabel, noteDeleteLabel, noteSaveLabel, noteCancelLabel,
  noteDictateLabel, noteStopLabel, notePlaceholder, notesEmptyLabel,
  notesFullLabel`.

### App: PhraseBank

- **REQ-090**: Each phrase row shows `n/3` and, when `status_by_phrase[id]`
  exists, a status text in Hebrew: `ok -> "תקין"`, `one_take -> "הקלטה אחת -
  פחות אמין"`, `confused -> "מתבלבל עם <phrase text>"`. Above the list, when
  `self_test` is present: `"בדיקה עצמית: {top1}/{n} נכון, שלושת הראשונים
  {top3}/{n}"` (test id `phrase-self-test`). The `seed` label is removed.
- **REQ-091**: `EnrollPanel` passes `durationMs`, shows the verdict after each
  take (`first_take -> "הקלטה אחת - הקליטו עוד אחת והבדיקה העצמית תוכל לשפוט"`,
  `ok -> "תקין ({n}/3)"`, `confused -> "קרוב יותר ל<phrase> מאשר להקלטות של
  עצמו - מחקו אותו או הקליטו שוב"`, test id `enroll-verdict`), maps refusal
  codes to Hebrew (`no_face -> "לא נראו פנים - הקליטו שוב"`, `still -> "השפתיים
  לא זזו - הקליטו שוב ובטאו את המשפט בבירור"`, `no_rest -> "אין רגע שקט לפני או
  אחרי - עצרו רגע לפני ואחרי המשפט"`), and offers `מחיקת ההקלטה האחרונה`
  (test id `enroll-drop`) when the phrase has takes, refreshing takes and the
  statuses afterwards.

### Guidelines

- **GUD-001**: Match existing style; touch only the files the requirements
  name; no new abstractions beyond `Takes`, `TeachPanel`, `NotesPanel`.
- **GUD-002**: Reference code is copied as is, including comments, where the
  requirement says "verbatim"; only names that refer to the removed screens are
  dropped.
- **GUD-003**: User-facing strings go through `t(language, key)` except the
  PhraseBank, which is Hebrew-only inline text like the rest of that file.

## 4. Interfaces & Data Contracts

### `POST /api/execute_lips` (English, ok)

```json
{
  "status": "ok", "error": null,
  "response": "Hi, how are you doing today? I would like a glass of water.",
  "steps": [
    {"module": "vsr", "prompt": {"input": "<video clip>", "fps": 29.9},
     "response": {"model": "I HOW YOU DAY I WOULD LIKE A GLASS WAR",
                  "word_options": "I(91%)/HOW(1%)/HI(0%) HOW(100%)/OUT(0%)/WHAT(0%) ..."}},
    {"module": "correct", "prompt": {"system": "<prompt>", "input": "Correct this:\nI(91%)/..."},
     "response": {"corrected": "Hi, how are you doing today? I would like a glass of water."}}
  ]
}
```

### `POST /api/execute_lips` (Hebrew, ok)

```json
{
  "status": "ok", "error": null, "response": "כואב לי מאוד",
  "confident": false,
  "candidates": [{"id": "pain_hurts_a_lot", "text": "כואב לי מאוד", "score": 1.02},
                 {"id": "comfort_cold", "text": "קר לי", "score": 1.09},
                 {"id": "needs_thirsty", "text": "אני צמא", "score": 1.4}],
  "hebrew": {"ranked": [["pain_hurts_a_lot", 1.02, 0.31, 0.9], ["comfort_cold", 1.09, 0.33, 0.95]],
             "confident": false},
  "steps": [
    {"module": "vsr", "prompt": {"input": "<video clip>", "language": "he", "fps": 30.0},
     "response": {"frames": 61}},
    {"module": "match", "prompt": {"takes": 12, "thresholds": {"w_a": 1.0, "w_b": 1.0, "...": 0}},
     "response": {"candidates": ["..."], "confident": false}}
  ]
}
```

### Error shape

```json
{"status": "error", "error": "No face seen - record again", "code": "no_face", "response": null, "steps": []}
```

### `POST /api/enroll_phrase` (ok)

```json
{"status": "ok", "error": null, "phrase_id": "needs_thirsty", "takes": 2, "frames": 58,
 "verdict": {"code": "ok", "other": null, "takes": 2}}
```

### `GET /api/phrase_templates`

```json
{"status": "ok", "error": null, "storage": true,
 "takes": {"needs_thirsty": 2, "comfort_cold": 1},
 "status_by_phrase": {"needs_thirsty": {"code": "ok", "other": null},
                      "comfort_cold": {"code": "one_take", "other": null}},
 "self_test": {"n": 2, "top1": 2, "top3": 2}}
```

### `POST /api/runs` body

```json
{"raw": "I HOW YOU DAY", "corrected": "Hi, how are you today?", "latency_ms": 2100,
 "framing": {}, "heard": null, "word_options": "I(91%)/HOW(1%) ...",
 "notes": ["Keeps bees"], "clip_fps": 29.9, "truth": null, "hebrew": null}
```

### Local settings record (device)

```json
{"voice_id": "Brian", "language": "en", "gender": "m", "patient_key": "uuid", "listen": true,
 "examples": [{"phrase": "Is Pearl eating well?", "model_output": "IS(90%)/... PEARL(40%)/BURL(30%)"}],
 "notes": ["Retired horse breeder; his mare is called Pearl"]}
```

### Corrector system prompt (assembled)

`LLM_SYSTEM_PROMPT_BASE` + (when examples) the reference "Examples from this
speaker" paragraph followed by `Input: <model_output>\nOutput: <phrase>` per
example + (when notes) the reference "About the speaker" paragraph followed by
`- <note>` lines. Joined with `\n`, exactly as `build_system_prompt` in the
reference.

## 5. Acceptance Criteria

- **AC-001**: Given a clip with a face and speech, when posted to
  `/api/execute_lips`, then the `vsr` step has `model` and `word_options` in
  the reference format and `correct` has the sentence ending in `.`, `?` or `!`.
- **AC-002**: Given the corrector returns two lines, when cleaned, then only the
  last line is returned and the discarded line is logged.
- **AC-003**: Given `examples` and `notes` form fields, when the corrector is
  called, then the system prompt contains each example as `Input/Output` lines
  and each note as a `- ` line.
- **AC-004**: Given a clip with no face, when posted, then the response is the
  error shape with `code: "no_face"` and no LLM call is made.
- **AC-005**: Given the model reads nothing, when posted, then the response is
  the error shape with `code: "nothing_read"` and no LLM call is made.
- **AC-006**: Given a patient with two takes of one phrase and one of another,
  when a Hebrew clip is posted, then `hebrew.ranked` has 4-element rows,
  `candidates` has at most 3 entries, `confident` follows `decide`.
- **AC-007**: Given a patient with at most one take per phrase, when a Hebrew
  clip is posted, then `code: "not_enrolled"`.
- **AC-008**: Given an enrolment clip whose lip trace never rises above `STILL`,
  when posted to `/api/enroll_phrase`, then `code: "still"` and nothing is
  stored.
- **AC-009**: Given a stored take, when `DELETE ...&last=1`, then that take is
  removed and `takes` decreases by one.
- **AC-010**: Given the Talk screen at 1280 px width, when rendered, then the
  camera view is inside a 480 px wide frame; at 390 px it fills the viewport.
- **AC-011**: Given a learning-mode confirmation, when saved, then the next
  `/api/execute_lips` request carries that example in `examples`.
- **AC-012**: Given a note added in Settings, when a clip is posted, then the
  request carries it in `notes` and the run log stores it.
- **AC-013**: `cd app && npm run typecheck` passes; the fast pytest suites pass
  without weights; `e2e_check.py` and Playwright report real results.

## 6. Test Automation Strategy

- **Unit (no weights)**: `backend/tests/test_hebrew.py` ports the reference
  `tests/test_hebrew.py` classes `TestLipGeometry, TestNoFace (against
  vsr.signatures), TestActiveSpans, TestMatcher, TestSelfTest` and a `TestTakes`
  replacing `TestStore` (round trip through `pack/unpack`, drop, status,
  verdict). `backend/tests/test_corrector.py`: `format_words`,
  `build_system_prompt` with examples and notes, response clean-up with a
  stubbed client, one live call gated on `ANTHROPIC_API_KEY`.
  `backend/tests/test_phrases.py`: phrase file tests kept; execute_lips branch
  tests rewritten with `vsr.read`, `vsr.signatures`, `vsr.clip_fps`,
  `corrector.correct` and the template store stubbed, covering AC-001,
  AC-004 to AC-009.
- **With weights**: `test_vsr_pipeline.py` (`read` and `signatures` shapes;
  CTC alternatives test from the reference `test_vallr.py`),
  `test_eval_videos.py` through the new path, `test_phrase_eval.py` as a
  leave-one-take-out over clips using `hebrew.Takes`. A per-patient eval script
  `backend/tests/hebrew_eval.py --patient KEY` ports `hebrew_eval.py` over the
  database and `runs` rows.
- **Integration**: `backend/tests/e2e_check.py` stages updated to the new
  shapes (execute_lips en/he, enroll, templates, runs body).
- **End-to-end**: Playwright mocks updated to the new shapes; existing specs
  pass; new checks: the read line appears, `examples`/`notes` reach
  `execute_lips` after teaching and adding a note, desktop frame width.
- **Frameworks**: pytest, FastAPI TestClient, Playwright.

## 7. Rationale & Context

The reference is the product owner's later iteration of the prediction path,
measured on real recordings. Its choices (word options instead of beam n-best,
adaptive-thinking Sonnet 5, no re-encode of the clip, two-signature Hebrew
matching with self-derived thresholds) replace ours wholesale. Examples and
notes stay on the device because the reference keeps them with the
installation, they are clinical text, and the service does not need to persist
them. Nothing-read becomes an error rather than a displayed sentence because the
Talk screen would otherwise offer to speak "(nothing read)". Existing Hebrew
takes are dropped because signature B cannot be recovered without the clip,
which is never stored.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: Supabase Postgres - `runs` and `phrase_templates` tables.

### Third-Party Services
- **SVC-001**: Anthropic Messages API - the corrector call (`claude-sonnet-5`,
  adaptive thinking).
- **SVC-002**: Modal - hosts the VSR service; image needs OpenCV, Mediapipe
  (FaceMesh legacy solution), SciPy, PyTorch, Anthropic SDK, psycopg.

### Infrastructure Dependencies
- **INF-001**: Vercel Python function for the API backend; imports only the
  corrector prompt module, not the model.

### Data Dependencies
- **DAT-001**: Auto-AVSR weights under `benchmarks/LRS3` (gitignored).
- **DAT-002**: `assets/phrases/he.json` phrase list (unchanged).

### Technology Platform Dependencies
- **PLT-001**: Python 3.12 with uv; Expo SDK 57 / React Native web.
- **PLT-002**: Browser `MediaRecorder` and `SpeechRecognition` (Chrome, Safari).

### Compliance Dependencies
- **COM-001**: Video never leaves the device except for inference and is
  deleted afterwards; no clip is stored server-side.

## 9. Examples & Edge Cases

```text
alternatives = [[("HELLO", 0.92), ("FELLOW", 0.05), ("HALLOW", 0.03)], [("NAME", 0.78)]]
format_words(alternatives) == "HELLO(92%)/FELLOW(5%)/HALLOW(3%) NAME(78%)"
format_words([]) == ""
top1(alternatives, "HELLO NAME") == "HELLO NAME"

correct("...") response text "The speaker probably means:\nI need my medicine now"
  -> "I need my medicine now."      (last line kept, full stop added)
response text "Corrected: Where is my pill?" -> "Where is my pill?"

clip_fps(path, duration_ms=5000) with 150 frames -> 30.0
clip_fps(path, None) -> round(CAP_PROP_FPS, 1)

Hebrew: takes {A: 2 takes, B: 1 take} -> leave_one_out rows only for A's takes;
thresholds computed; B is a distractor. takes {A: 1, B: 1} -> thresholds None
-> execute_lips he returns code not_enrolled.

Duplicate example phrases are allowed (the reference appends every confirmation).
A note longer than 10000 characters is cut at 10000.
```

## 10. Validation Criteria

- All acceptance criteria in section 5 hold.
- `grep -r langchain` finds nothing outside `uv.lock` history.
- `backend/app/agent/` no longer exists; `backend/app/corrector.py` and
  `backend/app/hebrew.py` exist and import without weights.
- `uv run --extra test pytest backend/tests -k "hebrew or corrector or phrases"`
  passes without weights or network (live tests skip without the key).
- `cd app && npm run typecheck` passes.
- Docs updated: `CLAUDE.md` (Layout, Hebrew phrase mode, Agent → Corrector,
  examples/notes), `app/DESIGN.md` (Talk desktop frame, Read line, the two new
  Settings sections, phrase statuses), `README.md` (module table, tests line).

## 11. Related Specifications / Further Reading

- `plan-to-implement.md` (the approved plan)
- Reference repository: `/Users/adams/Desktop/tmp/lipreader` (`chaplin.py`,
  `hebrew.py`, `notes.py`, `pipelines/model.py`, `tests/`)
- `CLAUDE.md`, `app/DESIGN.md`, `PRD.md`
