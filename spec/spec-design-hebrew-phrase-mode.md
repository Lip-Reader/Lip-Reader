---
title: Hebrew phrase mode, language setting and flip camera for Chaplin AI
version: 1.0
date_created: 2026-09-19
owner: Chaplin AI team
tags: [design, app, backend, vsr, hebrew]
---

# Introduction

This specification defines how Chaplin AI gains a Hebrew mode in which the app recognises one phrase
out of a fixed list of 100 Hebrew phrases, tuned to each patient through enrollment, plus a language
setting and a flip-camera control. It implements GitHub issue #11 and the approved plan in
`plan-to-implement.md`. English lip reading must keep its current code path and output.

## 1. Purpose & Scope

Audience: the implementer (Claude Code) and reviewers. Scope: the Expo app (`app/`), the API backend
(`backend/app/main.py`, `db.py`, `tts.py`), the VSR service (`backend/app/vsr_main.py`, `vsr.py`,
new `phrases.py`), shared data under `assets/phrases/`, tests, and deployment notes. Out of scope:
free-text Hebrew recognition, translating the app chrome, medical-device certification.

Assumptions: the Auto-AVSR video model and weights stay as they are; Inworld TTS provides Hebrew
voices (verified: `Oren`, `Yael`); Supabase Postgres is reachable from the API backend and, after
this change, from the VSR service.

## 2. Definitions

- **VSR**: visual speech recognition, reading text from lip movements in video.
- **Auto-AVSR**: the English lip-reading model Chaplin runs (`backend/pipelines/`).
- **Encoder features**: the output of `AVSR.model.encode(video)`: one 768-dimensional vector per
  video frame at 25 frames per second, produced before the English text decoder.
- **Template**: encoder features of one enrollment take of one phrase by one patient, stored as
  bytes.
- **Take**: one recorded clip of a patient mouthing one phrase.
- **Patient key**: a random UUID (version 4) that identifies a patient's templates. Created on the
  device; for signed-in users also stored in `user_settings`.
- **DTW**: dynamic time warping, an alignment that compares two sequences of different lengths.
- **Seed set**: optional speaker-independent templates shipped in `assets/phrases/he_seed.npz`.
- **Candidate**: a phrase returned by matching, with a score (lower is better).
- **RTL**: right-to-left text direction, required for Hebrew.

## 3. Requirements, Constraints & Guidelines

### Language setting
- **REQ-001**: The settings store exposes `language` with values `"en"` (default) and `"he"`.
- **REQ-002**: Guests keep `language` on the device (existing `chaplin_settings` storage key).
  Members also read and write it through `GET|PUT /api/me/settings`.
- **REQ-003**: Settings shows a two-option segmented control "English" / "עברית" with test ids
  `lang-en` and `lang-he`.
- **REQ-004**: Hebrew phrase text renders right-to-left (`writingDirection: "rtl"`,
  `textAlign: "right"`).

### Phrase bank
- **REQ-010**: `assets/phrases/he.json` holds exactly 100 phrases in 10 groups of 10, schema in §4.
- **REQ-011**: Every phrase has a stable `id` (lowercase ASCII, underscores), `group`, `text_m`
  (masculine form), `text_f` (feminine form). Ids are unique.
- **REQ-012**: `GET /api/phrases/{lang}` on the API backend returns the file for `he` and 404
  otherwise.
- **REQ-013**: The settings store exposes `gender` with values `"m"` (default) and `"f"`; Settings
  shows a toggle (test ids `gender-m`, `gender-f`); the chosen form is shown everywhere and sent
  with recognition requests.
- **REQ-014**: Settings (Hebrew) shows a group chip row (test id `group-<id>`), a search input
  (test id `phrase-search`) that searches across all groups, and a phrase list (rows
  `phrase-<id>`) with the enrolled take count badge `n/3`.

### Enrollment
- **REQ-020**: Tapping a phrase row opens an enrollment panel with camera preview, the phrase in
  large RTL text, a Record / Stop button (test ids `enroll-record`, `enroll-stop`), the take
  counter "Take k of 3", and Done (`enroll-done`).
- **REQ-021**: Each stopped take is sent to `POST /api/enroll_phrase` (VSR service) with
  `patient_key` and `phrase_id`. On success the badge updates from the returned take count.
- **REQ-022**: Enrollment is skippable: any phrase with zero takes still shows in the list and is
  simply not a recognition candidate unless a seed template exists for it.
- **REQ-023**: The VSR service stores encoder features only; the uploaded clip is deleted after
  extraction (same `finally` pattern as `execute_lips`).
- **REQ-024**: At most 5 takes per phrase per patient are kept; enrolling a 6th deletes the oldest.
- **REQ-025**: `GET /api/phrase_templates?patient_key=` returns take counts per phrase and the
  list of phrase ids covered by the seed set. `DELETE /api/phrase_templates?patient_key=&phrase_id=`
  removes takes for one phrase (or all when `phrase_id` is omitted).

### Recognition
- **REQ-030**: `POST /api/execute_lips` accepts form fields `language` (default `"en"`),
  `patient_key` (optional) and `gender` (default `"m"`).
- **REQ-031**: When `language` is `"en"` or missing, the handler runs exactly the existing code
  (decode, `vsr.transcribe_clip`, `run_agent`) and returns the existing response shape.
- **REQ-032**: When `language` is `"he"`, the handler decodes the clip, extracts encoder features,
  loads the patient's templates plus the seed set, ranks all candidate phrases with DTW, and
  returns `response` (best phrase text in the requested gender form), `confident`, `candidates`
  (top 3) and `steps` (a `vsr` step and a `match` step). No LLM call is made.
- **REQ-033**: Confidence rule: `confident` is true when the best score is at most `ABS_MAX` and
  either there is one candidate, or `(second - best) / best >= MARGIN`. `ABS_MAX` and `MARGIN` are
  module constants in `backend/app/phrases.py` (initial values 0.6 and 0.15).
- **REQ-034**: If no templates and no seed exist for the patient, the handler returns the error
  shape with message "No Hebrew phrases are enrolled yet. Teach a few phrases in Settings first."
- **REQ-035**: The Talk screen in Hebrew mode: on a confident result show the phrase (RTL) with
  Speak, as in English. On a non-confident result show up to three candidate buttons (test ids
  `candidate-0`, `candidate-1`, `candidate-2`) and "None of these" (`candidate-none`). Tapping a
  candidate shows it with Speak; "None of these" returns to idle.
- **REQ-036**: Runs are logged through the existing `POST /api/runs` with `raw` = the candidate ids
  and scores as text and `corrected` = the shown phrase.

### Flip camera
- **REQ-040**: `Recorder` (`recorder.types.ts`) gains `facing: "front" | "back"` and
  `flip: () => void`.
- **REQ-041**: Talk shows an `IconButton` (`camera-reverse-outline`, label "Flip camera", test id
  `flip-camera-button`) inside `FixedControls` on the right side; when the admin button is also
  present both sit on the right. The button is disabled while `phase === "recording"`.
- **REQ-042**: Web: flipping stops the current stream and calls `getUserMedia` again with
  `facingMode: "user"` (front) or `"environment"` (back), using non-exact constraints so a device
  without a second camera keeps working. The preview is mirrored only when facing front.
- **REQ-043**: Native: `CameraView` receives `facing={facing}`.
- **REQ-044**: The choice is stored under storage key `chaplin_camera` and restored on load.

### Voices
- **REQ-050**: `tts.list_voices()` returns voices of all languages with a `lang` field (for example
  `EN_US`, `HE_IL`); `GET /voices?lang=en` (default `en`) returns only voices whose `lang` starts
  with the requested code, so the English list is unchanged.
- **REQ-051**: The voice picker requests voices for the current language. When the language is
  Hebrew and the chosen voice is not in the Hebrew list, the picker selects the first Hebrew voice
  matching the patient gender (`Oren` for `m`, `Yael` for `f`) and saves it. English behaviour is
  unchanged.

### Settings API
- **REQ-060**: `GET /api/me/settings` returns `{voice_id, language, gender, patient_key}`.
- **REQ-061**: `PUT /api/me/settings` accepts a partial body with any of `voice_id`, `language`,
  `gender`, `patient_key`; unspecified fields keep their stored value; `language` must be `en` or
  `he`, `gender` must be `m` or `f` (400 otherwise). A body with only `voice_id` behaves as today.
- **REQ-062**: The patient key is created on the device on first use and stored in
  `chaplin_settings`. On first sign-in, a local key is pushed to the server when the server has
  none; otherwise the server key replaces the local one.

### Constraints
- **CON-001**: No video is persisted anywhere; only features and text.
- **CON-002**: The English path in `execute_lips`, `vsr.transcribe_clip`, the agent and the
  pipeline files under `backend/pipelines/` are not modified except to add the feature-extraction
  method next to `infer` (no change to `infer` itself).
- **CON-003**: Template bytes are float16 little-endian, shape `(frames, 768)`, after averaging
  every two consecutive encoder frames (12.5 frames per second).
- **CON-004**: The VSR service imports `db.py` lazily and works without `DATABASE_URL`: enrollment
  and template listing then return the error shape "Template storage is not configured"; Hebrew
  recognition still works with the seed set alone.
- **CON-005**: The Modal image adds `psycopg[binary]`; the `chaplin-secrets` secret carries
  `DATABASE_URL` (operator action, approved by the user).
- **CON-006**: Design rules from `app/DESIGN.md` apply: glass panels, one emoji per section title,
  lists capped at about 330 px with internal scroll, at most three controls on Talk besides the
  fixed icons.

### Guidelines
- **GUD-001**: Plain-language copy in the UI; Hebrew strings for phrase content only.
- **GUD-002**: Smallest diff; no new abstractions beyond `phrases.py` and the Settings phrase
  components.

## 4. Interfaces & Data Contracts

### 4.1 Phrase file `assets/phrases/he.json`

```json
{
  "language": "he",
  "version": 1,
  "groups": [{ "id": "basics", "title": "בסיסי" }],
  "phrases": [
    { "id": "basics_yes", "group": "basics", "text_m": "כן", "text_f": "כן" }
  ]
}
```

### 4.2 API backend

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/phrases/{lang}` | | the phrase file; 404 for unknown lang |
| GET | `/api/me/settings` | auth | `{voice_id, language, gender, patient_key}` (nulls when unset) |
| PUT | `/api/me/settings` | auth, `{voice_id?, language?, gender?, patient_key?}` | same as GET |
| GET | `/voices?lang=en` | | `{voices:[{id,name,description,gender,lang}]}` |

### 4.3 VSR service

`POST /api/execute_lips` multipart: `file`, `conversation?`, `language?`, `patient_key?`, `gender?`.

Hebrew success response:

```json
{
  "status": "ok",
  "error": null,
  "response": "כואב לי",
  "confident": false,
  "candidates": [
    { "id": "pain_hurts", "text": "כואב לי", "score": 0.31 },
    { "id": "pain_head", "text": "כואב לי הראש", "score": 0.34 },
    { "id": "needs_thirsty", "text": "אני צמא", "score": 0.52 }
  ],
  "steps": [
    { "module": "vsr", "prompt": { "input": "<video clip>", "language": "he" }, "response": { "frames": 38, "dim": 768 } },
    { "module": "match", "prompt": { "templates": 27, "seed": 0 }, "response": { "candidates": [] , "confident": false } }
  ]
}
```

`POST /api/enroll_phrase` multipart: `file`, `patient_key`, `phrase_id` ->
`{"status":"ok","error":null,"phrase_id":"pain_hurts","takes":2}` or the error shape.

`GET /api/phrase_templates?patient_key=K` ->
`{"status":"ok","takes":{"pain_hurts":2},"seed_phrases":["basics_yes"]}`.

`DELETE /api/phrase_templates?patient_key=K&phrase_id=P` -> `{"status":"ok","deleted":2}`.

Error shape (all VSR endpoints): `{"status":"error","error":"<message>","response":null,"steps":[]}`.

### 4.4 Database

```sql
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS patient_key TEXT;
CREATE TABLE IF NOT EXISTS phrase_templates (
    id BIGSERIAL PRIMARY KEY,
    patient_key TEXT NOT NULL,
    phrase_id TEXT NOT NULL,
    frames INTEGER NOT NULL,
    dim INTEGER NOT NULL,
    features BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phrase_templates_patient ON phrase_templates (patient_key, phrase_id);
```

### 4.5 `backend/app/phrases.py`

```python
load_phrases(lang="he") -> dict            # parsed JSON, cached
phrase_text(phrase_id, gender) -> str
pack(feats: np.ndarray) -> tuple[bytes, int, int]   # float16 LE, (frames, dim)
unpack(blob: bytes, frames: int, dim: int) -> np.ndarray
downsample(feats: np.ndarray) -> np.ndarray         # mean of frame pairs
dtw_distance(a, b) -> float                         # cosine distance, band, path-normalised
rank(query, templates: dict[str, list[np.ndarray]]) -> list[tuple[str, float]]  # ascending
decide(ranked) -> bool                              # confidence rule REQ-033
load_seed() -> dict[str, list[np.ndarray]]          # {} when the file is absent
```

`backend/tools/build_phrase_seed.py` walks `assets/hebrew_clips/<phrase_id>/*.mp4` (or `.mov`),
extracts features with `vsr.extract_features`, and writes `assets/phrases/he_seed.npz` with one
array per take under the key `<phrase_id>__<k>`.

### 4.6 App

`Recorder`: `{ ready, error, facing, flip, start, stop, retry }`.
`Settings`: `{ voiceId, language, gender, patientKey, ready, setVoiceId, setLanguage, setGender }`.
`executeLips(clip, opts?: { language?: "en"|"he"; patientKey?: string; gender?: "m"|"f" })`
returns `{ response, steps, raw, confident?, candidates? }`.
`getPhrases(lang)`, `getPhraseTemplates(patientKey)`, `enrollPhrase(clip, patientKey, phraseId)`.

## 5. Acceptance Criteria

- **AC-001**: Given a guest, when they pick Hebrew in Settings and reload, then Hebrew stays
  selected and no `/api/me/settings` request was made.
- **AC-002**: Given Hebrew is selected, when Settings renders, then 10 group chips, a search box and
  phrase rows with `n/3` badges are visible, and the phrase text is right-aligned.
- **AC-003**: Given the search box holds "כאב", when the list updates, then only phrases whose
  text contains it are shown, from any group.
- **AC-004**: Given the enrollment panel for a phrase, when Record then Stop is pressed, then one
  `POST /api/enroll_phrase` request with `patient_key` and `phrase_id` is sent and the badge shows
  the returned count.
- **AC-005**: Given `language=en` (or absent), when `POST /api/execute_lips` runs, then the response
  has exactly the keys `status, error, response, steps` and the same text as before this change.
- **AC-006**: Given `language=he` with templates, when a clip is posted, then `candidates` has at
  most 3 items sorted by ascending score, `response` equals the first candidate's text, and
  `confident` follows REQ-033.
- **AC-007**: Given a non-confident Hebrew result, when Talk shows it, then three candidate buttons
  and "None of these" are visible; tapping a candidate shows the sentence and Speak.
- **AC-008**: Given the Talk screen, when the flip button is tapped on web, then `getUserMedia` is
  called with `facingMode: "environment"`, the preview is not mirrored, the button label reads
  "Flip camera", and after reload the back camera is still selected.
- **AC-009**: Given recording is in progress, then the flip button is disabled.
- **AC-010**: Given Hebrew is selected, when the voice picker loads, then only Hebrew voices are
  listed and one is selected; given English, the list and behaviour are unchanged.
- **AC-011**: Given `assets/test_videos/*.mov` and `golden_raw.json` exist, when the golden test
  runs, then each raw transcription equals the stored golden string.
- **AC-012**: `npm run typecheck`, `npm run e2e`, `uv run --extra test pytest backend/tests` (tests
  that have their prerequisites) and `uv run python backend/tests/e2e_check.py` pass.

## 6. Test Automation Strategy

- **Unit (pytest, no weights)**: `backend/tests/test_phrases.py` covers phrase-file integrity
  (100 phrases, 10 groups x 10, unique ids, both forms non-empty), pack/unpack round trip,
  downsample shape, DTW properties (identity distance 0, warped copy close, unrelated far), `rank`
  ordering, `decide` on confident / tied / single-candidate inputs, and the `execute_lips` Hebrew
  branch with a stubbed feature extractor and stubbed templates (FastAPI `TestClient`).
- **Model (pytest, weights)**: `test_vsr_pipeline.py` adds feature extraction shape and the English
  golden comparison; skipped when clips are absent.
- **Eval harness**: `backend/tests/test_phrase_eval.py` runs leave-one-take-out accuracy over
  `assets/hebrew_clips/<patient>/<phrase_id>/*.mp4`; prints top-1 and top-3; asserts the 80/90
  targets only when `PHRASE_EVAL_STRICT=1`.
- **Service**: `e2e_check.py` adds stages `phrases`, `execute_lips_he`, `enroll_phrase`.
- **App**: Playwright `guest.spec.ts` gains language toggle, phrase list and search, enrollment
  round-trip, Hebrew candidates flow and flip camera; `mocks.ts` gains the new routes; existing
  tests unchanged. Run outside the Claude sandbox.
- **Type checks**: `npm run typecheck` (web and native configs).
- **Screenshots**: `npm run shots` extended with Settings (Hebrew) and Talk (candidates).

## 7. Rationale & Context

A closed phrase list is the only approach that can reach bedside quality in weeks without Hebrew
lip-video data (SRAVI reached 86% on a few dozen phrases). Reusing the Auto-AVSR encoder avoids a new
model and keeps the English path intact. DTW handles patients mouthing faster or slower than during
enrollment. Storing features instead of video keeps the privacy promise. A device-generated patient
key lets guests enroll without accounts and keeps Clerk out of the VSR service.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: Supabase Postgres, now reached by both the API backend and the VSR service.

### Third-Party Services
- **SVC-001**: Inworld TTS with Hebrew voices (`Oren`, `Yael`) through the existing `/speak`.
- **SVC-002**: Modal, hosting the VSR service; needs `DATABASE_URL` in `chaplin-secrets`.

### Infrastructure Dependencies
- **INF-001**: Auto-AVSR weights under `benchmarks/LRS3/` for feature extraction.

### Data Dependencies
- **DAT-001**: `assets/phrases/he.json` (in git). Optional `assets/phrases/he_seed.npz` and
  `assets/hebrew_clips/` (gitignored) for the seed set and evaluation.

### Technology Platform Dependencies
- **PLT-001**: Expo SDK 57 app; FastAPI backends on Python 3.12; numpy for the matcher.

### Compliance Dependencies
- **COM-001**: Privacy: only text and features leave the device; no video is stored.

## 9. Examples & Edge Cases

```text
Edge: patient has templates for 3 phrases only -> only those 3 (plus seed) are candidates;
      candidates may have fewer than 3 items; with 1 candidate, confident iff score <= ABS_MAX.
Edge: DATABASE_URL missing on the VSR service -> enroll returns error shape
      "Template storage is not configured"; execute_lips(he) uses seed only or returns
      the "No Hebrew phrases are enrolled yet" error.
Edge: clip without a face -> same "No face detected" error as English.
Edge: language=he but patient_key missing -> treated as a patient with no templates.
Edge: flip on a laptop with one camera -> getUserMedia with facingMode "environment" (ideal)
      returns the same camera; facing state still toggles and mirror follows it.
Edge: switching language to Hebrew with an English voice selected -> picker saves Oren/Yael.
Edge: PUT /api/me/settings {"voice_id": "Ashley"} -> language/gender/patient_key unchanged.
```

## 10. Validation Criteria

- All REQ items map to code and to at least one test listed in §6.
- The English `execute_lips` branch diff is limited to reading the new form fields and branching.
- `git diff` of `backend/pipelines/` shows only an added feature-extraction method.
- Playwright, pytest, typecheck and `e2e_check.py` results are reported verbatim.

## 11. Related Specifications / Further Reading

- `plan-to-implement.md` (approved plan)
- GitHub issue #11
- `PRD.md`, `app/DESIGN.md`, `CLAUDE.md`
