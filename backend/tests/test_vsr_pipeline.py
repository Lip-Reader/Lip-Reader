"""The VSR model transcribes a real test clip (needs weights + a local .mov).

English regression: ``assets/test_videos/golden_raw.json`` (made with
``backend/tools/make_english_golden.py`` on the unchanged pipeline) pins the raw
transcription of every clip, so any drift in the English path fails here."""

import json
import os

import pytest

from backend.app import config, vsr

VIDEO_DIR = config.REPO_ROOT / "assets" / "test_videos"


@pytest.mark.skipif(not os.path.isfile(config.VSR_CONFIG), reason="Auto-AVSR config not found")
def test_pipeline_returns_transcription():
    gt_path = VIDEO_DIR / "ground_truth.json"
    if not gt_path.is_file():
        pytest.skip("test videos not found")
    fname = next(iter(json.loads(gt_path.read_text())))
    video = VIDEO_DIR / fname
    if not video.is_file():
        pytest.skip(f"test video not found: {fname}")

    vsr.get_model(device="cpu")
    transcript = vsr.transcribe_clip(str(video))
    assert isinstance(transcript, str) and transcript.strip()


def _clips():
    gt_path = VIDEO_DIR / "ground_truth.json"
    if not gt_path.is_file():
        return []
    return [VIDEO_DIR / f for f in json.loads(gt_path.read_text()) if (VIDEO_DIR / f).is_file()]


@pytest.mark.skipif(not os.path.isfile(config.VSR_CONFIG), reason="Auto-AVSR config not found")
def test_extract_features_shape():
    clips = _clips()
    if not clips:
        pytest.skip("test videos not found")
    vsr.get_model(device="cpu")
    feats = vsr.extract_features(str(clips[0]))
    assert feats.ndim == 2 and feats.shape[1] == 768 and feats.shape[0] > 0
    assert feats.dtype == "float32"


@pytest.mark.skipif(not os.path.isfile(config.VSR_CONFIG), reason="Auto-AVSR config not found")
def test_english_transcription_matches_golden():
    golden_path = VIDEO_DIR / "golden_raw.json"
    if not golden_path.is_file():
        pytest.skip("golden_raw.json not found (run backend/tools/make_english_golden.py)")
    golden = json.loads(golden_path.read_text())
    clips = [c for c in _clips() if c.name in golden]
    if not clips:
        pytest.skip("no clips with a golden transcription")
    vsr.get_model(device="cpu")
    for clip in clips:
        assert vsr.transcribe_clip(str(clip)) == golden[clip.name], clip.name
