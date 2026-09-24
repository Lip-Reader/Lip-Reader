"""The corrector: one Claude call that turns the model's word options into a sentence.

The prompt, the request and the clean-up are the reference desktop app's (chaplin.py).
Examples from this speaker (learning mode) and the clinician's notes about the patient
come with each request from the device; nothing about the patient is kept here.
"""
from __future__ import annotations

import logging

import anthropic

from . import config

log = logging.getLogger("chaplin.corrector")

LLM_SYSTEM_PROMPT_BASE = (
    "You correct lip-reading output. Each word has a confidence %; "
    "low-confidence words may be visually confused (e.g. BACK/BAD, FINE/MINE).\n\n"
    "Context: The speaker is a tracheostomy patient communicating with medical staff.\n\n"
    "Rules:\n"
    "- Fix low-confidence words using sentence context\n"
    "- High-confidence words are usually correct\n"
    "- Use proper capitalization and punctuation\n"
    "- Output ONLY the corrected sentence or sentences, all on one line\n"
    "- The speaker may say more than one sentence; keep every one of them\n"
    "- NEVER explain your reasoning, NEVER add commentary\n"
    "- Your entire response must be just the sentence or sentences, nothing before or after"
)


def build_system_prompt(mappings=None, notes=None):
    """Build system prompt, optionally appending learned speaker patterns and the
    clinician's notes about the patient."""
    lines = [LLM_SYSTEM_PROMPT_BASE]
    if mappings:
        lines.append("\n\nExamples from this speaker: what the lip reader produced, and what they "
                     "actually said (confirmed by their clinician). Their mouth is misread in "
                     "consistent ways, so use these to recognise the same sentence, and the same "
                     "word confusions, when they come up again.")
        for m in mappings:
            lines.append(f"Input: {m['model_output']}\nOutput: {m['phrase']}")
    if notes:
        lines.append("\n\nAbout the speaker (notes from their clinician). Use them to pick between "
                     "the listed options for a word: when a lower-percentage option fits the speaker's "
                     "life and the sentence, prefer it (a horse breeder saying BEAR(55%)/MARE(30%) "
                     "said mare; a beekeeper saying SELL THE MONEY(58%)/HONEY(35%) said honey). "
                     "The one hard rule: never insert a word from the notes that is not among the "
                     "options. Notes say he plays the bass; input says GUITAR(100%) -> output says "
                     "guitar, not bass guitar.")
        lines += [f"- {n}" for n in notes]
    return "\n".join(lines)


def format_words(alternatives):
    """Format word alternatives into a string for the LLM."""
    if not alternatives:
        return ""
    parts = []
    for alts in alternatives:
        if len(alts) == 1:
            parts.append(f"{alts[0][0]}({alts[0][1]*100:.0f}%)")
        else:
            opts = "/".join(f"{w}({p*100:.0f}%)" for w, p in alts)
            parts.append(opts)
    return " ".join(parts)


def top1(alternatives, transcript=""):
    """The model's own reading: the first option of every word, or the beam transcript
    when there are no word options."""
    return " ".join(a[0][0] for a in alternatives) if alternatives else transcript


_client = None


def _anthropic():
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def correct(raw, mappings=None, notes=None):
    """One call to the corrector: the sentence it settles on, and nothing else."""
    prompt = build_system_prompt(mappings, notes)
    # Sonnet 5 with light thinking, so it reasons privately instead of in the answer.
    # Measured on two real readings: about 2s a call, and no worse than Opus 5 (3s, or
    # 6-15s thinking hard). Fable 5.1 is out: its safety filter refuses pain sentences.
    response = _anthropic().messages.create(
        model=config.LLM_MODEL,
        max_tokens=4096,
        thinking={'type': 'adaptive'},
        output_config={'effort': 'low'},
        system=prompt,
        messages=[
            {'role': 'user', 'content': f"Correct this:\n{raw}"},
        ],
    )
    return clean(next((b.text for b in response.content if b.type == 'text'), ''))


def clean(text):
    """What the corrector said, reduced to the sentence it settled on: the last non-empty
    line (the model sometimes thinks out loud around a first attempt, and all of it would be
    shown and spoken), without a "Corrected:" label, ending in a full stop."""
    corrected = text.strip()
    lines = [ln.strip() for ln in corrected.splitlines() if ln.strip()]
    if len(lines) > 1:
        log.warning("LLM reasoning discarded: %s", " / ".join(lines[:-1])[:200])
        corrected = lines[-1]
    if corrected.startswith("Corrected:"):
        corrected = corrected[len("Corrected:"):].strip()
    log.info("LLM corrected: %s", corrected)
    if corrected and corrected[-1] not in '.?!':
        corrected += '.'
    return corrected
