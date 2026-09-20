# Chaplin AI — English free-speech test script

Purpose: measure what free-speech lip-reading actually delivers, so the client
conversation rests on numbers instead of impressions. We know short phrases score
92% word overlap on the SRAVI set. We don't know the shape of the curve, where it
breaks, or whether the LLM corrector earns its place.

## How to record

- **One sentence per file.** Pause ~1s before and after — the model is known to
  drop opening words ("Hi how are you" → "How are you").
- **Mouth it silently, at normal speed.** No exaggerating, no slowing down.
- **2 reps of everything** (Block F is the exception). Two catches instability
  without doubling your filming time.
- **Sit close enough to fill the frame with your face.** This is the one setting that
  matters — see FINDINGS.md. The same phrases at laptop distance score 46%, and at
  arm's length or nearer, 90%. Resolution above 640 wide and lighting/contrast turned
  out not to matter; distance does.
- **Mount the camera, don't hold it.** Handheld jitter is 4–28% of a face-width per
  frame versus under 2% mounted, and the model reads that as mouth movement.
- Same distance and setup for every block except where a block says otherwise, so the
  only variable is what you said.
- **Keep a ground truth file.** Easiest: name each file with the sentence. Otherwise
  a `ground_truth.json` per folder, `{"filename.mov": "what you said"}` — same shape
  as `assets/sravi_test_videos/*/ground_truth.json`, so it plugs into the existing
  eval directly.

Suggested: `assets/freespeech_test/<block>/…`

---

## Block A — the length ladder  ·  20 sentences  ·  **the headline result**

Short utterances failed in earlier tests, long ones did well. This turns that
impression into a curve, and the curve is what tells you whether free speech is
viable for real patients — who mostly speak in short bursts.

**2–3 words**
1. I'm cold
2. My back hurts
3. Call the nurse
4. Not right now

**4–5 words**
5. Can you help me please
6. I need to sit up
7. The light is too bright
8. When is the doctor coming

**6–8 words**
9. Could you bring me a glass of water
10. I would like to see my daughter today
11. My throat is hurting more than yesterday
12. Please tell me what the test results said

**10–14 words**
13. I have been feeling much better today but my throat still hurts
14. Could you please ask the doctor to come and see me this afternoon
15. I want to know what happened to me and how long I was asleep
16. The pain in my chest is worse when I try to take a deep breath

**20–30 words**
17. I have been lying here since this morning and nobody has told me anything about the operation or when I am going to be allowed to go home
18. Please call my wife and tell her that I am doing much better today and that she does not need to come in tonight if she is tired
19. The nurse said the doctor would come around lunchtime but it is now late afternoon and I still have not seen anyone who can answer my questions
20. I remember feeling dizzy in the kitchen and then waking up here with a tube in my throat and I still do not understand exactly what happened

---

## Block B — real ICU speech  ·  12 sentences

Things a patient would actually need to say that no fixed phrase list contains.
This is the honest product question: does free speech buy anything a 40-phrase
list doesn't?

1. My left arm feels numb
2. Can you move the pillow a little higher
3. I think the tube is slipping
4. The mask is too tight on my face
5. I need the bathroom urgently
6. Something is beeping and it is worrying me
7. Can you turn me onto my other side
8. I did not sleep at all last night
9. My mouth is very dry
10. Please do not leave me alone right now
11. I want to talk to my daughter before the surgery
12. Is my family still in the waiting room

---

## Block C — homophene stress test  ·  10 sentences

Pairs the lips cannot distinguish (p/b/m, f/v, t/d). Only context can save these,
so this block measures the **corrector** specifically, not the model.

1. I need my pills
2. I need my bills
3. Can you turn up the fan
4. Can you turn up the van
5. My back is sore
6. My pack is sore
7. Bring me the pan
8. Bring me the ban
9. It is time for my medicine
10. It is time for my bedicine *(deliberate nonsense — the corrector should fix it)*

Record 1–8 as matched pairs, close together, same conditions. If the raw output is
identical within a pair, that's the homophene problem measured directly.

---

## Block D — known hard content  ·  6 sentences

Numbers, names and rare words are the classic failure modes and they matter
clinically.

1. My room number is three fourteen
2. Please call doctor Levi
3. I take metformin twice a day
4. My date of birth is the ninth of June
5. The pain is about a seven out of ten
6. I am allergic to penicillin

---

## Block E — silent vs voiced  ·  3 sentences, both ways  ·  3 reps each

Open question nobody has measured: the model was trained on people speaking
**aloud**, but the product asks patients to mouth **silently**.

1. Could you bring me a glass of water
2. My throat is hurting more than yesterday
3. I need the bathroom urgently

Record each silently, then aloud. Separate folders: `silent/`, `voiced/`.
If silent is much worse, that's a finding that affects every number we have.

---

## Block F — consistency  ·  1 sentence × 8 reps

Just this, eight times, same conditions:

> **Could you please ask the doctor to come and see me this afternoon**

Tells us how much the output varies run to run, which sets the floor on every
other measurement in this script.

---

## Totals

~110 clips. If you're short on time: **Block A and Block C**. A gives the length
curve, C tells you whether the corrector is worth keeping — the two open questions
that actually change decisions.
