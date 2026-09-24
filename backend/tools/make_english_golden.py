"""Pin the raw English transcription of every clip in assets/test_videos.

Run it once on a checkout whose English path is known-good (for example main), then
backend/tests/test_vsr_pipeline.py fails if a later change alters any transcription.

  uv run python backend/tools/make_english_golden.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app import config, vsr  # noqa: E402

VIDEO_DIR = config.REPO_ROOT / "assets" / "test_videos"


def main() -> int:
    gt = VIDEO_DIR / "ground_truth.json"
    clips = [VIDEO_DIR / f for f in json.loads(gt.read_text()) if (VIDEO_DIR / f).is_file()] if gt.is_file() else []
    if not clips:
        print(f"no clips found in {VIDEO_DIR}")
        return 1
    vsr.get_model(device="cpu")
    golden = {c.name: vsr.read(str(c))[0] for c in clips}
    for name, text in golden.items():
        print(f"{name}: {text}")
    (VIDEO_DIR / "golden_raw.json").write_text(json.dumps(golden, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {VIDEO_DIR / 'golden_raw.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
