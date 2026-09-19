"""Hebrew phrase mode: phrase list, template bytes, matcher, and both execute_lips branches.

No model weights needed: the feature extractor and templates are stubbed."""

import numpy as np
import pytest

from backend.app import config, phrases
from backend.app.phrases import decide, downsample, dtw_distance, pack, rank, unpack


def seq(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).normal(size=(n, 768)).astype(np.float32)


def warped(a: np.ndarray, seed: int = 9) -> np.ndarray:
    """A slower, noisier rendition of the same sequence."""
    stretched = np.repeat(a, 3, axis=0)[::2]
    return stretched + 0.05 * np.random.default_rng(seed).normal(size=stretched.shape).astype(np.float32)


class TestPhraseFile:
    def test_bank_shape(self):
        bank = phrases.load_phrases("he")
        assert bank["language"] == "he"
        assert len(bank["groups"]) == 10
        assert len(bank["phrases"]) == 100
        per_group = {g["id"]: 0 for g in bank["groups"]}
        for p in bank["phrases"]:
            per_group[p["group"]] += 1
            assert p["text_m"].strip() and p["text_f"].strip()
            assert p["id"] == p["id"].lower() and " " not in p["id"]
        assert set(per_group.values()) == {10}
        assert len(phrases.phrase_ids()) == 100

    def test_gendered_text(self):
        assert phrases.phrase_text("needs_thirsty", "m") == "אני צמא"
        assert phrases.phrase_text("needs_thirsty", "f") == "אני צמאה"
        assert phrases.phrase_text("nope") == "nope"

    def test_unknown_language(self):
        with pytest.raises(FileNotFoundError):
            phrases.load_phrases("xx")


class TestTemplateBytes:
    def test_pack_roundtrip(self):
        a = seq(38, 1)
        blob, n, d = pack(a)
        assert (n, d) == (38, 768) and len(blob) == 38 * 768 * 2
        assert np.allclose(unpack(blob, n, d), a, atol=1e-2)

    def test_downsample_halves_time(self):
        assert downsample(seq(77, 2)).shape == (38, 768)
        assert downsample(seq(1, 2)).shape == (1, 768)


class TestMatcher:
    def test_dtw_identity_and_order(self):
        a, b = seq(38, 1), seq(38, 2)
        assert dtw_distance(a, a) < 1e-6
        assert dtw_distance(a, warped(a)) < dtw_distance(a, b)

    def test_dtw_empty(self):
        assert dtw_distance(seq(0, 1), seq(5, 1)) == float("inf")

    def test_rank_puts_matching_phrase_first_and_is_confident(self):
        target = seq(38, 1)
        templates = {f"other_{i}": [seq(38, 100 + i)] for i in range(20)}
        templates["target"] = [seq(30, 55), target + 0.03 * seq(38, 7)]
        ranked = rank(warped(target), templates)
        assert ranked[0][0] == "target"
        assert [s for _, s in ranked] == sorted(s for _, s in ranked)
        assert decide(ranked)

    def test_not_confident_when_tied_or_far(self):
        assert not decide([])
        assert not decide([("a", phrases.ABS_MAX + 0.01)])
        assert decide([("a", 0.2)])
        assert not decide([("a", 0.30), ("b", 0.31)])
        assert decide([("a", 0.30), ("b", 0.30 * (1 + phrases.MARGIN) + 0.001)])

    def test_merge_and_seed_missing(self):
        merged = phrases.merge_templates({"a": [seq(3, 1)]}, {"a": [seq(4, 2)], "b": [seq(5, 3)]})
        assert {k: len(v) for k, v in merged.items()} == {"a": 2, "b": 1}
        phrases.load_seed.cache_clear()
        assert phrases.load_seed("nope") == {}


@pytest.mark.skipif(not config.ANTHROPIC_API_KEY, reason="vsr_main imports the corrector agent (needs ANTHROPIC_API_KEY)")
class TestExecuteLipsBranches:
    @pytest.fixture
    def client(self, monkeypatch):
        from fastapi.testclient import TestClient

        from backend.app import vsr, vsr_main

        monkeypatch.setattr(vsr_main.config, "DISABLE_VSR", False)
        monkeypatch.setattr(vsr_main, "_decode_clip", lambda path: np.zeros((4, 8, 8, 3), np.uint8))
        self.target = seq(38, 1)
        monkeypatch.setattr(vsr, "extract_features", lambda frames: np.repeat(warped(self.target), 2, axis=0))
        monkeypatch.setattr(vsr, "transcribe_clip", lambda frames: "I NEED MY BEDICINE NOW")
        monkeypatch.setattr(vsr_main, "run_agent", lambda raw, conv: {
            "response": "I need my medicine now.",
            "steps": [{"module": "correct", "prompt": {}, "response": {"corrected": "I need my medicine now."}}],
        })
        monkeypatch.setattr(phrases, "load_seed", lambda lang="he": {})
        self.templates = {
            "pain_hurts": [self.target + 0.03 * seq(38, 7)],
            "needs_thirsty": [seq(38, 200)],
            "basics_yes": [seq(20, 201)],
        }
        monkeypatch.setattr(vsr_main, "_patient_templates", lambda key: self.templates if key == "k1" else {})
        return TestClient(vsr_main.app)

    def post(self, client, **data):
        return client.post("/api/execute_lips", files={"file": ("clip.mp4", b"x", "video/mp4")}, data=data).json()

    def test_english_shape_is_unchanged(self, client):
        body = self.post(client)
        assert set(body) == {"status", "error", "response", "steps"}
        assert body["response"] == "I need my medicine now."
        assert [s["module"] for s in body["steps"]] == ["vsr", "correct"]
        assert body["steps"][0]["response"] == {"raw_transcription": "I NEED MY BEDICINE NOW"}
        assert self.post(client, language="en") == body

    def test_hebrew_returns_ranked_candidates(self, client):
        body = self.post(client, language="he", patient_key="k1", gender="f")
        assert body["status"] == "ok"
        assert [c["id"] for c in body["candidates"]][0] == "pain_hurts"
        assert len(body["candidates"]) == 3
        assert body["response"] == "כואב לי"
        assert body["confident"] is True
        assert [s["module"] for s in body["steps"]] == ["vsr", "match"]
        assert body["steps"][1]["prompt"] == {"templates": 3, "seed": 0}

    def test_hebrew_gender_form(self, client):
        self.templates["needs_thirsty"] = [self.target + 0.03 * seq(38, 8)]
        del self.templates["pain_hurts"]
        body = self.post(client, language="he", patient_key="k1", gender="f")
        assert body["response"] == "אני צמאה"

    def test_hebrew_without_templates(self, client):
        body = self.post(client, language="he", patient_key="nobody")
        assert body["status"] == "error" and body["error"] == vsr_main_msg()
        assert body["response"] is None and body["steps"] == []

    def test_enroll_without_storage(self, client, monkeypatch):
        from backend.app import vsr_main

        monkeypatch.setattr(vsr_main.config, "DATABASE_URL", None)
        r = client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                        data={"patient_key": "k1", "phrase_id": "pain_hurts"}).json()
        assert r["status"] == "error" and r["error"] == vsr_main.NO_STORE
        r = client.get("/api/phrase_templates", params={"patient_key": "k1"}).json()
        assert r == {"status": "ok", "error": None, "takes": {}, "seed_phrases": [], "storage": False}

    def test_enroll_rejects_unknown_phrase(self, client, monkeypatch):
        from backend.app import vsr_main

        monkeypatch.setattr(vsr_main.config, "DATABASE_URL", "postgres://x")
        r = client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                        data={"patient_key": "k1", "phrase_id": "nope"}).json()
        assert r["status"] == "error" and "Unknown phrase" in r["error"]

    def test_enroll_stores_features(self, client, monkeypatch):
        from backend.app import vsr_main

        saved = {}

        class Store:
            def add_phrase_template(self, key, pid, blob, n, d, max_takes):
                saved.update(key=key, pid=pid, n=n, d=d, size=len(blob), max_takes=max_takes)
                return 1

        monkeypatch.setattr(vsr_main, "_template_store", lambda: Store())
        r = client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                        data={"patient_key": "k1", "phrase_id": "pain_hurts"}).json()
        assert r == {"status": "ok", "error": None, "phrase_id": "pain_hurts", "takes": 1, "frames": saved["n"]}
        assert saved["d"] == 768 and saved["size"] == saved["n"] * 768 * 2 and saved["max_takes"] == phrases.MAX_TAKES


def vsr_main_msg():
    from backend.app import vsr_main

    return vsr_main.NO_TEMPLATES
