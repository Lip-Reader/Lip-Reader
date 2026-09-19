"""Build the speaker-independent seed set for Hebrew phrase mode.

Put clips under assets/hebrew_clips/<phrase_id>/*.mp4 (or .mov), one phrase per folder,
then run:  uv run python backend/tools/build_phrase_seed.py
Writes assets/phrases/he_seed.npz with one array per take, key "<phrase_id>__<k>".
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app import config, phrases, vsr  # noqa: E402

CLIPS = config.REPO_ROOT / "assets" / "hebrew_clips"
OUT = phrases.PHRASES_DIR / "he_seed.npz"


def main() -> int:
    if not CLIPS.is_dir():
        print(f"no clips folder: {CLIPS}")
        return 1
    known = phrases.phrase_ids()
    arrays: dict[str, np.ndarray] = {}
    vsr.get_model()
    for folder in sorted(p for p in CLIPS.iterdir() if p.is_dir()):
        if folder.name not in known:
            print(f"skip {folder.name}: not a phrase id")
            continue
        for k, clip in enumerate(sorted(f for f in folder.iterdir() if f.suffix.lower() in (".mp4", ".mov", ".webm"))):
            try:
                feats = phrases.downsample(vsr.extract_features(str(clip)))
            except (vsr.NoFaceError, vsr.NoSpeechError) as e:
                print(f"skip {clip}: {e}")
                continue
            arrays[f"{folder.name}__{k}"] = feats.astype(np.float16)
            print(f"{folder.name} take {k}: {feats.shape[0]} frames")
    if not arrays:
        print("no usable clips")
        return 1
    np.savez_compressed(OUT, **arrays)
    print(f"wrote {OUT} ({len(arrays)} takes, {len({k.rsplit('__', 1)[0] for k in arrays})} phrases)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
