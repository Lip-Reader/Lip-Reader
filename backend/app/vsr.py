"""VSR inference on top of the vendored Auto-AVSR pipeline (backend/pipelines/)."""
from __future__ import annotations

import logging
import threading

from . import config
from .config import REPO_ROOT  # noqa: F401  (ensures sys.path bootstrap ran)

log = logging.getLogger("chaplin.vsr")

_model = None
_model_lock = threading.Lock()


def _get_device():
    import torch

    if torch.cuda.is_available():
        return torch.device("cuda:0")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def get_model(device=None):
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                import torch
                from pipelines.pipeline import InferencePipeline

                device = torch.device(device) if device else _get_device()
                log.info("Loading VSR model on %s ...", device)
                _model = InferencePipeline(
                    config.VSR_CONFIG,
                    device=device,
                    detector=config.VSR_DETECTOR,
                    face_track=True,
                )
                log.info("VSR model loaded.")
    return _model


def move_model_to_device(device=None):
    """Move an already-loaded model (e.g. restored from a CPU-only snapshot) to the accelerator."""
    import torch

    model = get_model()
    device = torch.device(device) if device else _get_device()
    with _model_lock:
        model.model.model.to(device)
        model.model.beam_search.to(device)
        model.model.device = device
    log.info("VSR model on %s.", device)


def transcribe_clip(video) -> str:
    """`video` is a path or a (T, H, W, 3) RGB uint8 array.
    Returns the raw all-caps transcription; raises NoFaceError/NoSpeechError."""
    model = get_model()
    if not isinstance(video, str) and len(video) == 0:
        raise NoFaceError("empty clip")
    try:
        text = model(video)
    except AssertionError as e:  # mediapipe: no face found
        raise NoFaceError(str(e)) from e
    text = (text or "").strip()
    if not text:
        raise NoSpeechError("empty transcription")
    return text


class NoFaceError(Exception):
    pass


class NoSpeechError(Exception):
    pass
