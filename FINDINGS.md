# Measured findings — Sep 18–19 2026

Everything here was measured in this repo, on real clips. Numbers are word-overlap
F1 against ground truth unless stated.

## Recording distance dominates everything

**The single controllable variable that matters is how much of the frame the face
fills.** Not resolution, not lighting, not contrast. Four takes of the same five
SRAVI phrases, same person, same pipeline:

| take | camera | distance | avg F1 |
|---|---|---|---|
| original (old Mac) | 1620×1080 | close | **90%** |
| take 2 | 1280×720 | far | 29% |
| take 3 | 1920×1080 | far | 46% |
| **take 4** | 1920×1080 | **close** | **90%** |

Take 3 has the highest resolution of all four and scores 46%; take 4 differs only
in distance and recovers the full 90%.

### Things that turned out NOT to matter — each of these was tested

- **Capture resolution above 640 wide.** The server downscales every clip to
  640×640 letterboxed (`FRAME_SIZE` in `vsr_main.py`) before the model sees it.
  Running take 4 through the real production path (`_decode_clip`) versus reading
  the file natively gives **identical scores, 90% both ways**, even though the face
  drops from 253px to 84px. So raising the app's capture resolution above 640×360
  would cost bandwidth and gain nothing. *(An earlier version of this document
  recommended raising it. That was wrong — it was measured on the native path,
  which production never takes.)*
- **Mouth-region contrast.** Take 4 has the *lowest* contrast of any take
  (17.7–24.4 vs 32–40 in the originals) and scores the same 90%. A separate
  lighting test at contrast ~12 also performed fine. The metric does not predict
  accuracy; it rises with harsh shadows and blown highlights too.
- **Framing and pose.** The worst take was better centred, level and straight to
  camera than the best one.

### What does matter

- **Fill the frame with your face.** This is the whole finding. At laptop distance
  you fail; at arm's length or closer you don't.
- **Don't measure face pixels in the source file** — that was the wrong proxy and it
  produced a bogus "≥110px" threshold. A distant 1080p face has few real details to
  survive the downscale; a close 720p face has plenty.
- **Mount the camera.** Handheld phone clips jitter 4–28% of a face-width between
  consecutive frames, versus 0.75–2% mounted. Shake becomes apparent mouth motion the
  model cannot distinguish from speech. Target under ~2%.

QuickTime's default "High" quality caps at 720p (Quality: Maximum lifts it), but per
the above this matters far less than sitting close.

## Face zoom: resolution matters again (Sep 20)

Cropping the face out of the **full-resolution** frames, instead of squashing the
whole frame to 640 first, recovers most of what distance costs — provided the
source has the pixels to recover.

| take | source | plain 640 path | face-zoom path |
|---|---|---|---|
| take 2 | 1280x720, far | 50% | **35%** |
| take 3 | 1920x1080, far | 49% | **85%** |
| take 4 | 1920x1080, close | 93% | 92% |

A far 1080p recording goes from 49% to 85%, close to the 93% of a close-up. At
720p there is not enough detail to recover and the crop makes things worse, so
`_zoom_to_face` is gated on a source height of at least 1080 and never upscales a
crop (upscaling cost take 3 12 points: 85% -> 73%).

**This changes the resolution advice above, for uploaded clips only.** The "above
640 wide gains nothing" result held because the 640 squash happened before the
crop. With the crop first, distance and capture resolution trade off against each
other until the mouth region reaches the model input size (88x88).

The app still records at 640x360, so its own clips never reach the gate and are
unaffected. Only uploaded video benefits today.

Untested: a 4K far clip, which is where the trade-off should pay most.

## Sentence length has a sweet spot (~10–14 words)

| Length | F1 (raw) |
|---|---|
| 2–3 words | poor — "I'm cold" → `I AM KNOWN` |
| **10–14 words** | **89%** (one clip 100%) |
| 20–30 words | 64% |

Too short starves the language model of context; too long and the decode loses the
thread. Earlier belief that "longer is always better" was wrong.

## Openings are systematically weak

Reproducible across takes and sentences — the first few words are dropped or mangled
while the tail survives (matches issue #1). Two attempted fixes **both failed**:

- Frozen first frame prepended (12/25/50 frames): no effect, ±2%.
- Real speech prepended from another clip: **worse** — 80% → 56%, because the model
  transcribes the filler and it bleeds into the sentence.

A prompt hint telling the corrector that openings are unreliable **also did nothing**
(identical output on 7/7 clips; an apparent win on a 3-clip sample was LLM
run-to-run variance).

## The corrector barely earns its place

Model sweep, same 22 SRAVI clips, raw 92% in every case:

| Corrector | After LLM | Pass (≥90%) |
|---|---|---|
| `claude-sonnet-5` | **92%** | 17/22 |
| `claude-opus-4-8` | 92% | 17/22 |
| `claude-sonnet-4-6` | 91% | 17/22 |
| `claude-opus-5` | **89%** | **15/22** |
| `claude-haiku-4-5` | — | rejects the `effort` param (400) |

Best case is **neutral**. More capable models do *worse* — the task rewards
restraint, and a model that reasons harder talks itself into more edits.
Now set to `claude-sonnet-5` (`LLM_MODEL` env var overrides).

History: Sonnet 4.6 (Jun) → Haiku 4.5 (Aug 6, "cut agent latency ~55%") → single-pass
(PR #2). Three latency optimisations; nobody re-measured, because the eval was
pinned to Sonnet 4.6 and had stopped testing production.

## Spurious negation — the dangerous failure

Three separate recordings where the model **inserted a negation that wasn't said**:
"I am doing much better" → "I DON'T THINK I'M DOING MUCH BETTER". Fluent,
confident, and semantically inverted. It **disappeared** when the same sentence was
re-recorded in good conditions — so it is a symptom of starved signal, not a fixed
model property.

## Open bug: no length cap on decoding

`assets/configs/LRS3_V_WER19.1.ini` has `maxlenratio=0.0` — no bound on output
length. One clip produced `IT'S NOT IN MY WAY` ×13 (F1 10%). Setting `maxlenratio`
to ~0.6 would cap output against clip length and kill this failure mode.

## Hebrew / other languages

- **Free-speech Hebrew via the English model: dead.** With the LM off, partial
  phonetics only (*ani tsame* → `ANY TIP`, *ko'ev li* → `GRAVY`), nothing on short
  phrases. An LLM cannot recover Hebrew from that.
- **Spanish model tried as a phonetic front-end** (char-level, 5 vowels like Hebrew):
  *worse*, not better. Its char decoder hallucinates fluent Spanish sentences.
  CTC-only output is nearly pure vowels — which is exactly what the camera can see.
- **Consistency:** a phrase repeated *within one clip* gives an identical reading
  every time. **Across separate takes, variance is large.** Enrolment for phrase
  mode therefore needs multiple takes across sessions, not five reps in one sitting.
- No downloadable lip-reading model exists for Hebrew, Russian or Arabic. English,
  Mandarin, Spanish, Portuguese, French only (Spanish 44.5% WER, French 58.6%).

## Still unmeasured

- **Silent mouthing vs speaking aloud.** The model was trained on voiced speech; the
  product asks patients to mouth silently. Nobody has measured the gap. Block E of
  `recording-script.md`.
- Whether feeding the corrector the **n-best list** (logged since PR #8, not stored)
  turns it from neutral into useful.
