"""The VSR model transcribes a real test clip (needs weights + a local .mov)."""

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
