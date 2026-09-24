"""VSR inference on top of the vendored Auto-AVSR pipeline (backend/pipelines/).

A clip is read the way the reference desktop app reads its webcam recording: OpenCV
decodes the file as it is, Mediapipe finds the face and crops the mouth, and the model
gives the transcript plus per-word alternatives. Nothing is re-encoded or rescaled first.
"""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager

from . import config
from .config import REPO_ROOT  # noqa: F401  (ensures sys.path bootstrap ran)

log = logging.getLogger("chaplin.vsr")

_model = None
_model_lock = threading.Lock()


class BadClip(Exception):
    """A clip that cannot be used. The message is the whole of what the screen shows, so the
    enrolment and runtime screens both just print it and let the patient record again; the
    detail is for the log, so a refusal can always be explained afterwards."""

    def __init__(self, message, detail=""):
        super().__init__(message)
        self.detail = detail


class NoFace(BadClip):
    """No face found, so there is no mouth to read."""

    def __init__(self, detail=""):
        super().__init__("No face seen - record again", detail)


@contextmanager
def refusing_no_face():
    """Turn "there is nobody in this clip" into a refusal the screens can show. The face
    detector and the crop step both report it by asserting, which would otherwise stop the app.
    Every path that reads a clip goes through this, Hebrew and English alike."""
    try:
        yield
    except AssertionError as why:
        raise NoFace(str(why)) from why


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
    model.init_landmarks_detector()  # deferred past the CPU snapshot; safe now
    log.info("VSR model on %s.", device)


def read(path: str) -> tuple[str, list]:
    """The transcript and the per-word alternatives ([(word, probability), ...] per word)
    of one clip. Raises NoFace when nobody is in it."""
    with refusing_no_face():
        return get_model()(path)


def signatures(path: str):
    """Both signatures for one clip: (T, 768) visual encoder features from the same 96x96
    aligned mouth crop the lip reader uses, and (T, 8) lip geometry from FaceMesh."""
    from pipelines.video_io import read_video_frames

    from .hebrew import lip_geometry

    model = get_model()
    with refusing_no_face():
        landmarks = model.process_landmarks(path, None)
        data = model.dataloader.load_data(path, landmarks)
        a = model.model.encode_features(data).detach().cpu().float().numpy()
        b = lip_geometry(read_video_frames(path))
    # outside the guard: a frame-count mismatch is our own bug, and should stay loud
    assert len(a) == len(b), f"encoder gave {len(a)} frames, FaceMesh {len(b)}"
    return a, b


def clip_fps(path: str, duration_ms: float | None) -> float:
    """The rate the clip was really recorded at: its frames over the time the app says the
    recording ran, since a browser clip's header cannot be trusted. For an uploaded file,
    with no recording time, the header is all there is."""
    import cv2

    cap = cv2.VideoCapture(path)
    try:
        if duration_ms and duration_ms > 0:
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if frames <= 0:  # some containers do not say; count instead
                frames = sum(1 for _ in iter(lambda: cap.read()[0], False))
            return round(frames / (duration_ms / 1000), 1)
        return round(cap.get(cv2.CAP_PROP_FPS), 1)
    finally:
        cap.release()
