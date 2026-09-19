"""Hebrew phrase-mode accuracy on recorded clips (leave-one-take-out).

Layout: assets/hebrew_clips/<patient>/<phrase_id>/*.mp4 (or .mov). For every take, the
other takes of that patient (plus the seed set) are the templates and the held-out take
must rank its own phrase first (top-1) or in the first three (top-3). Prints both rates;
asserts the issue's targets (80 % top-1, 90 % top-3) only when PHRASE_EVAL_STRICT=1.
"""

import os

import pytest

from backend.app import config, phrases, vsr

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


@pytest.mark.skipif(not os.path.isfile(config.VSR_CONFIG), reason="Auto-AVSR config not found")
@pytest.mark.parametrize("patient,takes", _patients() or [pytest.param("none", {}, id="no-clips")])
def test_leave_one_take_out(patient, takes):
    if not takes:
        pytest.skip(f"no Hebrew clips under {CLIPS}")
    vsr.get_model(device="cpu")
    feats = {pid: [phrases.downsample(vsr.extract_features(str(c))) for c in clips] for pid, clips in takes.items()}
    seed = phrases.load_seed()
    top1 = top3 = total = 0
    for pid, seqs in feats.items():
        for i, query in enumerate(seqs):
            own = {p: [s for j, s in enumerate(ss) if not (p == pid and j == i)] for p, ss in feats.items()}
            ranked = phrases.rank(query, phrases.merge_templates(own, seed))
            ids = [r[0] for r in ranked]
            total += 1
            top1 += ids[:1] == [pid]
            top3 += pid in ids[:3]
    print(f"\n[{patient}] takes: {total}  top-1: {top1 / total:.0%}  top-3: {top3 / total:.0%}")
    if STRICT:
        assert top1 / total >= 0.8 and top3 / total >= 0.9
