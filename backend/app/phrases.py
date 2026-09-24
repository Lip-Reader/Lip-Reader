"""The Hebrew phrase list (assets/phrases/he.json): ids, groups and gendered text.

Matching lives in hebrew.py; this module only knows what the phrases say.
"""
from __future__ import annotations

import functools
import json

from . import config

PHRASES_DIR = config.REPO_ROOT / "assets" / "phrases"


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
