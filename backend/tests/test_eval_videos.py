"""Eval suite: recorded clips with ground-truth transcripts.

Each clip goes through the real product path (VSR model -> word options -> corrector)
and the corrected text is scored against the ground truth with word-level F1.
Needs the VSR weights and the (gitignored) .mov clips under assets/sravi_test_videos.
Each clip is one parametrized test item, so `pytest -n 4` runs them in parallel.
"""

import json
import os

import pytest

from backend.app import config, corrector, vsr

SRAVI_DIR = config.REPO_ROOT / "assets" / "sravi_test_videos"
MIN_OVERLAP = 0.9


def _load_all_test_cases():
    cases = []
    if not SRAVI_DIR.is_dir():
        return cases
    for category in sorted(os.listdir(SRAVI_DIR)):
        gt_path = SRAVI_DIR / category / "ground_truth.json"
        if not gt_path.is_file():
            continue
        for fname, expected in json.loads(gt_path.read_text()).items():
            cases.append(pytest.param(SRAVI_DIR / category / fname, expected, id=f"{category}/{fname}"))
    return cases


ALL_CASES = _load_all_test_cases()


_CONTRACTIONS = {
    "i'm": "i am", "don't": "do not", "can't": "cannot", "won't": "will not",
    "isn't": "is not", "aren't": "are not", "wasn't": "was not",
    "weren't": "were not", "hasn't": "has not", "haven't": "have not",
    "didn't": "did not", "doesn't": "does not", "couldn't": "could not",
    "shouldn't": "should not", "wouldn't": "would not", "it's": "it is",
    "that's": "that is", "what's": "what is", "there's": "there is",
    "here's": "here is", "he's": "he is", "she's": "she is",
    "let's": "let us", "who's": "who is", "you're": "you are",
    "they're": "they are", "we're": "we are", "i've": "i have",
    "you've": "you have", "we've": "we have", "they've": "they have",
    "i'll": "i will", "you'll": "you will", "he'll": "he will",
    "she'll": "she will", "we'll": "we will", "they'll": "they will",
    "i'd": "i would", "you'd": "you would", "he'd": "he would",
    "she'd": "she would", "we'd": "we would", "they'd": "they would",
}


def _clean_words(text):
    text = text.lower().replace(",", "").replace(".", "").replace("!", "") \
               .replace("?", "").replace("-", " ")
    for contraction, expanded in _CONTRACTIONS.items():
        text = text.replace(contraction, expanded)
    return text.replace("'", "").split()


def word_overlap_ratio(predicted, expected):
    """Word-level F1: penalizes both missing and extra words."""
    pred_words = _clean_words(predicted)
    exp_words = _clean_words(expected)
    if not exp_words and not pred_words:
        return 1.0
    if not exp_words or not pred_words:
        return 0.0
    common = sum(1 for w in exp_words if w in pred_words)
    precision = common / len(pred_words)
    recall = common / len(exp_words)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def llm_change_rate(raw_top1, corrected):
    """Fraction of raw top-1 words that the LLM replaced."""
    raw = _clean_words(raw_top1)
    cor = _clean_words(corrected)
    if not raw:
        return 0.0
    changed = sum(1 for w in raw if w not in cor)
    return changed / len(raw)


skip_reason = (
    "Auto-AVSR config not found" if not os.path.isfile(config.VSR_CONFIG)
    else "SRAVI test videos not found" if not SRAVI_DIR.is_dir()
    else None
)


@pytest.mark.skipif(skip_reason is not None, reason=skip_reason or "")
@pytest.mark.parametrize("video_path,expected", ALL_CASES)
def test_video(video_path, expected, results_collector):
    if not video_path.is_file():
        pytest.skip(f"Video not found: {video_path}")

    vsr.get_model(device="cpu")
    transcript, alternatives = vsr.read(str(video_path))
    raw_top1 = corrector.top1(alternatives, transcript)
    corrected = corrector.correct(corrector.format_words(alternatives))

    raw_overlap = word_overlap_ratio(raw_top1, expected)
    corrected_overlap = word_overlap_ratio(corrected, expected)
    label = str(video_path.relative_to(SRAVI_DIR))
    print(
        f"\n[{label}]"
        f"\n  Expected:      {expected}"
        f"\n  Raw top-1:     {raw_top1}"
        f"\n  LLM corrected: {corrected}"
        f"\n  ---"
        f"\n  Raw overlap:       {raw_overlap:.0%}"
        f"\n  Corrected overlap: {corrected_overlap:.0%}"
        f"\n  LLM improvement:   {corrected_overlap - raw_overlap:+.0%}"
        f"\n  LLM changed:       {llm_change_rate(raw_top1, corrected):.0%} of words"
    )

    results_collector.append({
        "label": label,
        "raw_overlap": raw_overlap,
        "corrected_overlap": corrected_overlap,
    })

    assert corrected_overlap >= MIN_OVERLAP, (
        f"Overlap {corrected_overlap:.0%} < {MIN_OVERLAP:.0%}\n"
        f"  Expected: {expected}\n  Got: {corrected}"
    )
