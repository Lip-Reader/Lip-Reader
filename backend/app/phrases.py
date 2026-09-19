"""Hebrew phrase mode: the fixed phrase list, template packing and the matcher.

A template is the visual encoder output of one enrollment take (one 768-d vector per
frame). Recognition ranks every candidate phrase by dynamic time warping over per-frame
cosine distance, so a patient may mouth faster or slower than during enrollment.
"""
from __future__ import annotations

import functools
import json

import numpy as np

from . import config

PHRASES_DIR = config.REPO_ROOT / "assets" / "phrases"
ABS_MAX = 0.6       # best score must be at most this to count as confident
MARGIN = 0.15       # runner-up must be at least this much (relative) worse
MAX_TAKES = 5       # per phrase per patient; the oldest is dropped beyond this
TOP_K = 3
BAND = 0.3          # Sakoe-Chiba band as a fraction of the longer sequence


@functools.lru_cache(maxsize=None)
def load_phrases(lang: str = "he") -> dict:
    path = PHRASES_DIR / f"{lang}.json"
    if not path.is_file():
        raise FileNotFoundError(f"no phrase list for language {lang!r}")
    return json.loads(path.read_text(encoding="utf-8"))


def phrase_text(phrase_id: str, gender: str = "m", lang: str = "he") -> str:
    key = "text_f" if gender == "f" else "text_m"
    for p in load_phrases(lang)["phrases"]:
        if p["id"] == phrase_id:
            return p[key]
    return phrase_id


def phrase_ids(lang: str = "he") -> set[str]:
    return {p["id"] for p in load_phrases(lang)["phrases"]}


# --- template bytes ---------------------------------------------------------

def pack(feats: np.ndarray) -> tuple[bytes, int, int]:
    a = np.ascontiguousarray(feats, dtype="<f2")
    return a.tobytes(), int(a.shape[0]), int(a.shape[1])


def unpack(blob: bytes, frames: int, dim: int) -> np.ndarray:
    return np.frombuffer(blob, dtype="<f2").reshape(frames, dim).astype(np.float32)


def downsample(feats: np.ndarray) -> np.ndarray:
    """Average every two consecutive frames (25 -> 12.5 frames per second)."""
    feats = np.asarray(feats, dtype=np.float32)
    n = len(feats) // 2 * 2
    if n == 0:
        return feats
    return feats[:n].reshape(-1, 2, feats.shape[1]).mean(axis=1)


# --- matching ---------------------------------------------------------------

def _unit(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-8)


def dtw_distance(a: np.ndarray, b: np.ndarray, band: float = BAND) -> float:
    """Path-normalised DTW over per-frame cosine distance, constrained to a band."""
    a, b = _unit(a), _unit(b)
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return float("inf")
    cost = 1.0 - a @ b.T
    w = max(3, int(band * max(n, m)), abs(n - m))
    inf = float("inf")
    prev = np.full(m + 1, inf)
    prev[0] = 0.0
    for i in range(1, n + 1):
        cur = np.full(m + 1, inf)
        lo, hi = max(1, i - w), min(m, i + w)
        row = cost[i - 1]
        for j in range(lo, hi + 1):
            cur[j] = row[j - 1] + min(prev[j - 1], prev[j], cur[j - 1])
        prev = cur
    return float(prev[m] / (n + m))


def rank(query: np.ndarray, templates: dict[str, list[np.ndarray]]) -> list[tuple[str, float]]:
    """Score every phrase by its best take; ascending (lower is better)."""
    scores = []
    for phrase_id, takes in templates.items():
        if not takes:
            continue
        scores.append((phrase_id, min(dtw_distance(query, t) for t in takes)))
    scores.sort(key=lambda s: s[1])
    return scores


def decide(ranked: list[tuple[str, float]]) -> bool:
    if not ranked:
        return False
    best = ranked[0][1]
    if best > ABS_MAX:
        return False
    if len(ranked) == 1:
        return True
    second = ranked[1][1]
    return (second - best) / max(best, 1e-6) >= MARGIN


def merge_templates(*sources: dict[str, list[np.ndarray]]) -> dict[str, list[np.ndarray]]:
    out: dict[str, list[np.ndarray]] = {}
    for src in sources:
        for pid, takes in src.items():
            out.setdefault(pid, []).extend(takes)
    return out


# --- seed set ---------------------------------------------------------------

@functools.lru_cache(maxsize=None)
def load_seed(lang: str = "he") -> dict[str, list[np.ndarray]]:
    """Speaker-independent templates shipped in assets/phrases/<lang>_seed.npz, if any."""
    path = PHRASES_DIR / f"{lang}_seed.npz"
    if not path.is_file():
        return {}
    out: dict[str, list[np.ndarray]] = {}
    with np.load(path) as data:
        for key in data.files:
            pid = key.rsplit("__", 1)[0]
            out.setdefault(pid, []).append(np.asarray(data[key], dtype=np.float32))
    return out
