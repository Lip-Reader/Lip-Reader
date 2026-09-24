"""Hebrew phrase-mode accuracy on recorded clips (leave-one-take-out).

Layout: assets/hebrew_clips/<patient>/<phrase_id>/*.mp4 (or .mov, .webm). Every clip becomes
a take, exactly as enrolment would store it; the self-test then holds each take out in turn
and ranks it against the rest, which is the same measurement the app shows the patient.
Prints top-1 and top-3; asserts the issue's targets (80 % top-1, 90 % top-3) only when
PHRASE_EVAL_STRICT=1.
"""

import os

import pytest

from backend.app import config, hebrew, vsr

CLIPS = config.REPO_ROOT / "assets" / "hebrew_clips"
STRICT = os.getenv("PHRASE_EVAL_STRICT") == "1"


def _patients():
    if not CLIPS.is_dir():
        return []
    out = []
    for patient in sorted(p for p in CLIPS.iterdir() if p.is_dir()):
        takes = {}
        for folder in sorted(f for f in patient.iterdir() if f.is_dir()):
            clips = sorted(c for c in folder.iterdir() if c.suffix.lower() in (".mp4", ".mov", ".webm"))
            if clips:
                takes[folder.name] = clips
        if takes:
            out.append(pytest.param(patient.name, takes, id=patient.name))
    return out


def _rows(clips_by_phrase):
    """Every clip read into a phrase_templates row, both signatures packed."""
    rows = []
    for phrase_id, clips in clips_by_phrase.items():
        for clip in clips:
            a, b = vsr.signatures(str(clip))
            blob_a, frames, dim = hebrew.pack(a)
            blob_b, _, _ = hebrew.pack(b)
            rows.append({"id": len(rows) + 1, "phrase_id": phrase_id,
                         "fps": vsr.clip_fps(str(clip), None), "features": blob_a,
                         "frames": frames, "dim": dim, "geometry": blob_b})
    return rows


@pytest.mark.skipif(not os.path.isfile(config.VSR_CONFIG), reason="Auto-AVSR config not found")
@pytest.mark.parametrize("patient,takes", _patients() or [pytest.param("none", {}, id="no-clips")])
def test_leave_one_take_out(patient, takes):
    if not takes:
        pytest.skip(f"no Hebrew clips under {CLIPS}")
    vsr.get_model(device="cpu")
    enrolled = hebrew.Takes(_rows(takes))
    if enrolled.thresholds is None:
        pytest.skip(f"[{patient}] no phrase has two takes yet")
    summary = hebrew.summarise(enrolled.rows, enrolled.thresholds)
    total = summary["n"]
    print(f"\n[{patient}] takes: {total}  top-1: {summary['top1'] / total:.0%}"
          f"  top-3: {summary['top3'] / total:.0%}"
          f"  confident wrong: {summary['confident_wrong']}")
    for truth, gots in sorted(summary["confused"].items()):
        for got, times in sorted(gots.items(), key=lambda g: -g[1]):
            print(f"  {truth} -> {got}  x{times}")
    if STRICT:
        assert summary["top1"] / total >= 0.8 and summary["top3"] / total >= 0.9
