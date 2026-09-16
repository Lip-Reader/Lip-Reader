"""End-to-end tests using recorded video clips with ground truth transcripts.

Runs each clip through Auto-AVSR InferencePipeline -> Claude free-form correction,
then compares corrected text to ground truth using word-level F1.

Designed for pytest-xdist: each video is a separate parametrized test item,
distributed across workers. Use `pytest -n 4` for parallel execution.
"""

import os
import sys
import json
import asyncio
import pytest
import anthropic
from dotenv import load_dotenv

load_dotenv()

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, _REPO_ROOT)
sys.path.insert(0, os.path.join(_REPO_ROOT, "backend"))  # vendored pipelines/espnet

CONFIG_PATH = os.path.join(_REPO_ROOT, "assets", "configs", "LRS3_V_WER19.1.ini")
SRAVI_DIR = os.path.join(_REPO_ROOT, "assets", "sravi_test_videos")

HAS_CONFIG = os.path.isfile(CONFIG_PATH)
HAS_SRAVI = os.path.isdir(SRAVI_DIR)

MIN_OVERLAP = 0.9


def _load_all_test_cases():
    """Walk SRAVI subdirs, load each ground_truth.json, return (label, path, expected) triples."""
    cases = []
    if not os.path.isdir(SRAVI_DIR):
        return cases
    for category in sorted(os.listdir(SRAVI_DIR)):
        cat_dir = os.path.join(SRAVI_DIR, category)
        gt_path = os.path.join(cat_dir, "ground_truth.json")
        if not os.path.isfile(gt_path):
            continue
        with open(gt_path) as f:
            gt = json.load(f)
        for fname, expected in gt.items():
            video_path = os.path.join(cat_dir, fname)
            cases.append(pytest.param(video_path, expected, id=f"{category}/{fname}"))
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


@pytest.fixture(scope="session")
def pipeline():
    from pipelines.pipeline import InferencePipeline
    return InferencePipeline(CONFIG_PATH, detector="mediapipe", face_track=True, device="cpu")


@pytest.fixture(scope="session")
def llm_client():
    return anthropic.Anthropic()


skip_reason = (
    "Auto-AVSR config not found" if not HAS_CONFIG
    else "SRAVI test videos not found" if not HAS_SRAVI
    else None
)


@pytest.mark.skipif(skip_reason is not None, reason=skip_reason or "")
@pytest.mark.parametrize("video_path,expected", ALL_CASES)
def test_video(video_path, expected, pipeline, llm_client, results_collector):
    """Test a single video through the full pipeline."""
    from backend.app.agent.prompts import SYSTEM_PROMPT as LLM_SYSTEM_PROMPT

    if not os.path.isfile(video_path):
        pytest.skip(f"Video not found: {video_path}")

    raw_top1 = pipeline(video_path)

    response = llm_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=LLM_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Transcription:\n\n{raw_top1}"}],
    )
    corrected = response.content[0].text.strip()

    raw_overlap = word_overlap_ratio(raw_top1, expected)
    corrected_overlap = word_overlap_ratio(corrected, expected)
    change_rate = llm_change_rate(raw_top1, corrected)
    improvement = corrected_overlap - raw_overlap

    label = video_path.split("sravi_test_videos/")[-1] if "sravi_test_videos/" in video_path else video_path
    print(
        f"\n[{label}]"
        f"\n  Expected:      {expected}"
        f"\n  Raw top-1:     {raw_top1}"
        f"\n  LLM corrected: {corrected}"
        f"\n  ---"
        f"\n  Raw overlap:       {raw_overlap:.0%}"
        f"\n  Corrected overlap: {corrected_overlap:.0%}"
        f"\n  LLM improvement:   {improvement:+.0%}"
        f"\n  LLM changed:       {change_rate:.0%} of words"
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
