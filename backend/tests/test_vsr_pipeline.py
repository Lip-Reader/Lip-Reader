"""The VSR model on a real test clip (needs the weights and a local .mov).

English regression: ``assets/test_videos/golden_raw.json`` (made with
``backend/tools/make_english_golden.py`` on the unchanged pipeline) pins the raw
transcription of every clip, so any drift in the English path fails here."""

import json
import os

import pytest

from backend.app import config, vsr

VIDEO_DIR = config.REPO_ROOT / "assets" / "test_videos"

needs_weights = pytest.mark.skipif(not os.path.isfile(config.VSR_CONFIG),
                                   reason="Auto-AVSR config not found")


def _clips():
    gt_path = VIDEO_DIR / "ground_truth.json"
    if not gt_path.is_file():
        return []
    return [VIDEO_DIR / f for f in json.loads(gt_path.read_text()) if (VIDEO_DIR / f).is_file()]


@needs_weights
def test_read_gives_a_transcript_and_word_alternatives():
    clips = _clips()
    if not clips:
        pytest.skip("test videos not found")
    vsr.get_model(device="cpu")
    transcript, alternatives = vsr.read(str(clips[0]))
    assert isinstance(transcript, str) and transcript.strip()
    assert isinstance(alternatives, list) and alternatives
    for word_alts in alternatives:
        assert len(word_alts) >= 1
        word, prob = word_alts[0]
        assert isinstance(word, str)
        assert 0.0 <= prob <= 1.0


@needs_weights
def test_both_signatures_have_the_same_length():
    clips = _clips()
    if not clips:
        pytest.skip("test videos not found")
    vsr.get_model(device="cpu")
    a, b = vsr.signatures(str(clips[0]))
    assert a.ndim == 2 and a.shape[1] == 768 and a.shape[0] > 0 and a.dtype == "float32"
    assert b.ndim == 2 and b.shape[1] == 8
    assert len(a) == len(b)


@needs_weights
def test_the_ctc_head_gives_a_probability_per_token():
    """Where the per-word alternatives come from: the CTC head's frame-by-frame
    distribution over the vocabulary."""
    import torch
    from pipelines.pipeline import InferencePipeline

    pipe = InferencePipeline(config.VSR_CONFIG, detector=config.VSR_DETECTOR,
                             face_track=False, device="cpu")
    frames, encoder_dim = 20, pipe.model.model.ctc.ctc_lo.in_features
    with torch.no_grad():
        log_probs = pipe.model.model.ctc.log_softmax(torch.randn(frames, encoder_dim).unsqueeze(0))
    assert log_probs.shape == (1, frames, pipe.model.odim)
    assert torch.allclose(log_probs.exp().squeeze(0).sum(dim=-1), torch.ones(frames), atol=1e-4)


@needs_weights
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
        assert vsr.read(str(clip))[0] == golden[clip.name], clip.name
