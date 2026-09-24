"""The Hebrew phrase list, and both branches of /api/execute_lips.

No model weights: the lip reader, the corrector and the take store are all stubbed, so the
service is exercised for its shapes and its refusals rather than for what it reads."""

import numpy as np
import pytest

from backend.app import hebrew, phrases
from backend.tests.test_hebrew import FPS, REST, seq, take

SEQ_LEN = 40

ALTERNATIVES = [[("I", 1.0)], [("NEED", 0.9), ("KNEAD", 0.1)], [("MY", 1.0)],
                [("BEDICINE", 0.6), ("MEDICINE", 0.35)], [("NOW", 1.0)]]
TRANSCRIPT = "I NEED MY BEDICINE NOW"
WORD_OPTIONS = "I(100%) NEED(90%)/KNEAD(10%) MY(100%) BEDICINE(60%)/MEDICINE(35%) NOW(100%)"
CORRECTED = "I need my medicine now."


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


def rows_for(enrolled, seed=30):
    """Enrolment takes as the phrase_templates table holds them: both signatures packed,
    ids from 1 up. enrolled: {phrase_id: (base sequence, how many takes)}."""
    rows = []
    for k, (phrase_id, (base, n)) in enumerate(enrolled.items()):
        for i in range(n):
            a, b = take(base, seed + k * 10 + i)
            blob_a, frames, dim = hebrew.pack(a)
            blob_b, _, _ = hebrew.pack(b)
            rows.append({"id": len(rows) + 1, "phrase_id": phrase_id, "fps": FPS,
                         "features": blob_a, "frames": frames, "dim": dim, "geometry": blob_b})
    return rows


class TestExecuteLipsBranches:
    @pytest.fixture
    def client(self, monkeypatch):
        from fastapi.testclient import TestClient

        from backend.app import vsr, vsr_main

        monkeypatch.setattr(vsr_main.config, "DISABLE_VSR", False)
        monkeypatch.setattr(vsr, "clip_fps", lambda path, duration_ms: 30.0)
        monkeypatch.setattr(vsr, "read", lambda path: (TRANSCRIPT, ALTERNATIVES))

        self.corrector_saw = {}

        def fake_correct(raw, mappings=None, notes=None):
            self.corrector_saw.update(raw=raw, mappings=mappings, notes=notes)
            return CORRECTED

        monkeypatch.setattr(vsr_main.corrector, "correct", fake_correct)

        # the patient's takes, and the clip they are about to record: the query is another
        # rendition of pain_hurts, so the matcher should put that phrase first
        self.bases = {"pain_hurts": seq(SEQ_LEN, 21), "needs_thirsty": seq(SEQ_LEN, 22),
                      "basics_yes": seq(SEQ_LEN, 23)}
        self.rows = rows_for({"pain_hurts": (self.bases["pain_hurts"], 2),
                              "needs_thirsty": (self.bases["needs_thirsty"], 2),
                              "basics_yes": (self.bases["basics_yes"], 1)})
        self.query = take(self.bases["pain_hurts"], 99)
        monkeypatch.setattr(vsr, "signatures", lambda path: self.query)
        self.real_takes = vsr_main._takes
        monkeypatch.setattr(vsr_main, "_takes", lambda key: hebrew.Takes(self.rows if key == "k1" else []))
        return TestClient(vsr_main.app)

    def post(self, client, **data):
        return client.post("/api/execute_lips",
                           files={"file": ("clip.mp4", b"x", "video/mp4")}, data=data).json()

    def test_english_shape(self, client):
        body = self.post(client)
        assert set(body) == {"status", "error", "response", "steps"}
        assert body["response"] == CORRECTED
        assert [s["module"] for s in body["steps"]] == ["vsr", "correct"]
        assert body["steps"][0]["response"] == {"model": TRANSCRIPT, "word_options": WORD_OPTIONS}
        assert body["steps"][0]["prompt"]["fps"] == 30.0
        assert self.corrector_saw["raw"] == WORD_OPTIONS
        assert self.post(client, language="en") == body

    def test_examples_and_notes_reach_the_corrector(self, client):
        self.post(client, examples='[{"phrase":"x","model_output":"y"}]', notes='["keeps bees"]')
        assert self.corrector_saw["mappings"] == [{"phrase": "x", "model_output": "y"}]
        assert self.corrector_saw["notes"] == ["keeps bees"]

    def test_malformed_examples_and_notes_are_dropped(self, client):
        self.post(client, examples="not json", notes="{}")
        assert self.corrector_saw["mappings"] == [] and self.corrector_saw["notes"] == []

    def test_nothing_read_never_reaches_the_corrector(self, client, monkeypatch):
        from backend.app import vsr

        monkeypatch.setattr(vsr, "read", lambda path: ("", []))
        body = self.post(client)
        assert body["status"] == "error" and body["code"] == "nothing_read"
        assert body["response"] is None and body["steps"] == []
        assert self.corrector_saw == {}

    def test_no_face_is_refused(self, client, monkeypatch):
        from backend.app import vsr

        def no_face(path):
            raise vsr.NoFace("x")

        monkeypatch.setattr(vsr, "read", no_face)
        body = self.post(client)
        assert body["status"] == "error" and body["code"] == "no_face"
        assert body["error"] == "No face seen - record again"

    def test_hebrew_returns_ranked_candidates(self, client):
        body = self.post(client, language="he", patient_key="k1", gender="m")
        assert body["status"] == "ok"
        assert body["candidates"][0]["id"] == "pain_hurts"
        assert 0 < len(body["candidates"]) <= hebrew.TOP_K
        assert all(len(row) == 4 for row in body["hebrew"]["ranked"])
        assert isinstance(body["confident"], bool)
        assert body["hebrew"]["confident"] is body["confident"]
        assert [s["module"] for s in body["steps"]] == ["vsr", "match"]

    def test_hebrew_gender_form(self, client):
        self.query = take(self.bases["needs_thirsty"], 98)
        body = self.post(client, language="he", patient_key="k1", gender="f")
        assert body["candidates"][0]["id"] == "needs_thirsty"
        assert body["response"] == "אני צמאה"

    def test_hebrew_without_enrolled_phrases(self, client):
        body = self.post(client, language="he", patient_key="nobody")
        assert body["status"] == "error" and body["code"] == "not_enrolled"
        assert body["response"] is None and body["steps"] == []

    def test_a_still_clip_is_refused(self, client):
        a, b = self.query
        self.query = (a, np.tile(REST, (len(b), 1)).astype(np.float32))
        body = self.post(client, language="he", patient_key="k1")
        assert body["status"] == "error" and body["code"] == "still"

    def test_enroll_without_storage(self, client, monkeypatch):
        from backend.app import vsr_main

        monkeypatch.setattr(vsr_main.config, "DATABASE_URL", None)
        r = client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                        data={"patient_key": "k1", "phrase_id": "pain_hurts"}).json()
        assert r["status"] == "error" and r["error"] == vsr_main.NO_STORE
        r = client.get("/api/phrase_templates", params={"patient_key": "k1"}).json()
        assert r == {"status": "ok", "error": None, "takes": {}, "status_by_phrase": {},
                     "self_test": None, "storage": False}

    def test_enroll_rejects_unknown_phrase(self, client, monkeypatch):
        from backend.app import vsr_main

        monkeypatch.setattr(vsr_main.config, "DATABASE_URL", "postgres://x")
        r = client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                        data={"patient_key": "k1", "phrase_id": "nope"}).json()
        assert r["status"] == "error" and "Unknown phrase" in r["error"]

    def test_enroll_stores_both_signatures_and_says_how_it_went(self, client, monkeypatch):
        from backend.app import vsr_main

        saved = {}
        rows = self.rows
        rows[0]["id"] = 7   # the take just recorded, as the store hands it back

        class Store:
            def add_phrase_template(self, key, pid, blob, n, d, geometry, fps):
                saved.update(key=key, pid=pid, n=n, d=d, fps=fps,
                             features=len(blob), geometry=len(geometry))
                return 7

            def list_phrase_templates(self, key):
                return rows

        monkeypatch.setattr(vsr_main, "_template_store", lambda: Store())
        monkeypatch.setattr(vsr_main, "_takes", self.real_takes)
        r = client.post("/api/enroll_phrase", files={"file": ("clip.mp4", b"x", "video/mp4")},
                        data={"patient_key": "k1", "phrase_id": "pain_hurts"}).json()
        assert r["status"] == "ok" and r["phrase_id"] == "pain_hurts" and r["takes"] == 2
        assert saved["d"] == 768 and saved["fps"] == 30.0
        assert saved["features"] == saved["n"] * 768 * 2
        assert saved["geometry"] == saved["n"] * 8 * 2
        assert r["frames"] == saved["n"]
        assert r["verdict"]["code"] in {"first_take", "ok", "confused"}

    def test_dropping_the_last_take(self, client, monkeypatch):
        from backend.app import vsr_main

        rows = self.rows

        class Store:
            def delete_last_phrase_take(self, key, pid):
                newest = max([r for r in rows if r["phrase_id"] == pid], key=lambda r: r["id"])
                rows.remove(newest)
                return True

            def list_phrase_templates(self, key):
                return rows

        monkeypatch.setattr(vsr_main, "_template_store", lambda: Store())
        monkeypatch.setattr(vsr_main, "_takes", self.real_takes)
        r = client.delete("/api/phrase_templates",
                          params={"patient_key": "k1", "phrase_id": "needs_thirsty", "last": 1}).json()
        assert r["status"] == "ok" and r["deleted"] == 1 and r["takes"] == 1
