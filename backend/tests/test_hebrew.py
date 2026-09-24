"""Hebrew phrase mode: the matcher, the self-test the thresholds come from, and the take store.

No model weights and no camera: the visual encoder is stubbed with synthetic (T, 768)
sequences, so the whole file runs in about a second."""

import numpy as np
import pytest

from backend.app import hebrew
from backend.app.hebrew import (Takes, active_spans, decide, distances, dtw, leave_one_out,
                                lip_vector, normalise, pack, rank, scored, thresholds_for,
                                thresholds_from, unpack)

FPS = 30.0
SEQ_LEN = 40  # frames of synthetic encoder output; long enough to tell phrases apart
REST = np.array([0.05, 0.4, 0.01, 0.05, 0.05, 0.1, 0.0, 0.0], np.float32)  # lips at rest


def seq(n, seed):
    return np.random.default_rng(seed).normal(size=(n, 768)).astype(np.float32)


def warped(a, seed=9):
    """A slower, noisier rendition of the same sequence. The tempo varies with the seed, as it
    does between a patient's takes; DTW is there to absorb exactly that."""
    stretched = np.repeat(a, 3 + seed % 2, axis=0)[seed % 3::2]
    return stretched + 0.05 * np.random.default_rng(seed).normal(size=stretched.shape).astype(np.float32)


def geometry(base, n, seed):
    """A synthetic (T, 8) lip trace: still, then a burst of mouthing, then still again.

    The burst is shaped by `base`, smoothed into a slow wiggle, so two phrases look as
    different on the lips as they do to the encoder - which is the whole point of B."""
    rng = np.random.default_rng(seed)
    b = np.tile(REST, (n, 1))
    lo, hi = n // 4, n - n // 4
    curve = np.convolve(np.asarray(base)[:, 0], np.ones(9) / 9, mode="same")
    move = np.interp(np.linspace(0, 1, hi - lo), np.linspace(0, 1, len(curve)), curve)
    move = 0.2 * (move - move.min()) / (np.ptp(move) + 1e-9)
    b[lo:hi, 0] += move
    b[lo:hi, 2] += move * 0.1
    # a still mouth still jitters, but well under the movement: the patient is told to start
    # and end still, and a take that does not is refused
    return b + 0.0005 * rng.normal(size=b.shape).astype(np.float32)


def take(base, seed):
    """One enrolment take of a phrase: both signatures, as signatures() would hand them over."""
    a = warped(base, seed)
    return a, geometry(base, len(a), seed)


def normed(base, seed, b_scale=None):
    a, b = take(base, seed)
    return normalise(a, b, FPS, np.ones(8, np.float32) if b_scale is None else b_scale)


def face(open_mm=0.02, scale=1.0, roll=0.0, yaw=0.0):
    """A synthetic FaceMesh result: 478 points, only the ones lip_vector reads placed
    meaningfully. Built face-on, then scaled, rolled and yawed to order.

    FaceMesh's own convention: x right, y down, and z smaller the closer to the camera, so
    the nose tip and the lips sit at negative z."""
    p = np.zeros((478, 3), np.float32)
    p[33], p[263] = (-0.06, 0.0, 0.0), (0.06, 0.0, 0.0)      # eye corners
    p[1] = (0.0, 0.07, -0.04)                                 # nose tip, nearest the camera
    p[13], p[14] = (0.0, 0.11 - open_mm, -0.02), (0.0, 0.11 + open_mm, -0.02)  # inner lips
    p[0], p[17] = (0.0, 0.095, -0.02), (0.0, 0.13, -0.02)     # outer lips
    p[78], p[308] = (-0.025, 0.11, -0.015), (0.025, 0.11, -0.015)  # inner corners
    for i, idx in enumerate(hebrew.INNER_RING):               # the rest of the inner ring
        if not p[idx].any():
            t = 2 * np.pi * i / len(hebrew.INNER_RING)
            p[idx] = (0.025 * np.cos(t), 0.11 + open_mm * np.sin(t), -0.02)
    cr, sr = np.cos(roll), np.sin(roll)
    cy, sy = np.cos(yaw), np.sin(yaw)
    return p @ np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]], np.float32).T \
             @ np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], np.float32).T * scale


class TestLipGeometry:
    def test_opening_grows_with_the_mouth(self):
        shut, ajar, wide = (lip_vector(face(o)) for o in (0.005, 0.02, 0.04))
        assert shut[0] < ajar[0] < wide[0]
        assert shut[2] < ajar[2] < wide[2]          # the inner-lip area grows with it
        assert len(shut) == 8

    def test_scale_and_roll_change_nothing(self):
        base = lip_vector(face())
        assert np.allclose(lip_vector(face(scale=2.0)), base, atol=1e-5)
        assert np.allclose(lip_vector(face(roll=0.4)), base, atol=1e-5)
        assert np.allclose(lip_vector(face(scale=0.5, roll=-0.9)), base, atol=1e-5)

    def test_a_turned_head_still_reads_the_same_mouth(self):
        assert np.allclose(lip_vector(face(yaw=0.3)), lip_vector(face()), atol=1e-5)

    def test_protrusion_and_lift_have_the_sign_they_claim(self):
        forward = face()
        forward[[13, 14, 0, 17, 78, 308]] -= (0.0, 0.0, 0.03)    # lips pushed toward the camera
        assert lip_vector(forward)[7] > lip_vector(face())[7]
        smiling = face()
        smiling[[78, 308]] -= (0.0, 0.02, 0.0)                   # corners raised
        assert lip_vector(smiling)[6] > lip_vector(face())[6]


class FacelessMesh:
    """A FaceMesh that never sees anybody, used as lip_geometry uses the real one."""

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def process(self, frame):
        from types import SimpleNamespace

        return SimpleNamespace(multi_face_landmarks=None)


class TestNoFace:
    def test_both_refusals_share_one_handler(self):
        assert issubclass(hebrew.NoFace, hebrew.BadClip)
        assert issubclass(hebrew.StillClip, hebrew.BadClip)

    def test_a_clip_with_no_face_in_any_frame_is_refused(self, monkeypatch):
        monkeypatch.setattr(hebrew, "face_mesh", FacelessMesh)
        with pytest.raises(hebrew.NoFace, match="No face seen"):
            hebrew.lip_geometry([np.zeros((720, 1280, 3), np.uint8)] * 5)


class TestActiveSpans:
    def _trace(self, bursts, n=120):
        b = np.tile(REST, (n, 1))
        for lo, hi in bursts:
            b[lo:hi, 0] += np.sin(np.linspace(0, 2 * np.pi, hi - lo)) * 0.2
        return b

    def test_three_bursts_are_three_spans(self):
        spans = active_spans(self._trace([(10, 25), (50, 65), (90, 105)]), FPS)
        assert len(spans) == 3
        assert spans[0][0] >= 8 and spans[-1][1] <= 110

    def test_a_short_gap_is_one_span(self):
        # 4 frames apart at 30 fps is 0.13 s, well inside the half-second merge
        assert len(active_spans(self._trace([(30, 45), (49, 64)]), FPS)) == 1

    def test_a_still_clip_has_no_spans(self):
        assert active_spans(self._trace([]), FPS) == []
        assert active_spans(np.zeros((1, 8), np.float32), FPS) == []

    def test_trim_needs_movement_and_stillness(self):
        with pytest.raises(hebrew.StillClip):
            hebrew.trim(self._trace([]), FPS)
        with pytest.raises(hebrew.StillClip):
            hebrew.trim(self._trace([(0, 120)]), FPS)
        lo, hi, rest = hebrew.trim(self._trace([(40, 80)]), FPS)
        assert 30 <= lo < hi <= 90
        assert rest[0] == pytest.approx(0.05, abs=0.01)   # the resting mouth, not the moving one

    def test_normalise_trims_and_downsamples(self):
        a, b = take(seq(SEQ_LEN, 1), 3)
        na, nb = normalise(a, b, FPS, np.ones(8, np.float32))
        assert len(na) == len(nb)
        assert 0 < len(na) < len(a) / 2          # trimmed, then halved to ~15 Hz
        assert abs(np.linalg.norm(na[0]) - 1) < 1e-3


class TestMatcher:
    def test_dtw_identity_and_order(self):
        base = seq(SEQ_LEN, 1)
        a, b = normed(base, 3), normed(seq(SEQ_LEN, 2), 4)
        assert distances(a, a) == (pytest.approx(0, abs=1e-6), pytest.approx(0, abs=1e-6))
        assert distances(a, normed(base, 5))[0] < distances(a, b)[0]

    def test_dtw_empty(self):
        assert dtw(np.zeros((0, 5))) == float("inf")

    def test_normalise_downsamples_to_target_hz(self):
        a = seq(120, 1)
        b, ones = geometry(a, 120, 1), np.ones(8, np.float32)
        for fps, step in ((30.0, 2), (15.0, 1)):
            lo, hi, _ = hebrew.trim(b, fps)     # the trim moves with fps, so read it per rate
            assert len(normalise(a, b, fps, ones)[0]) == len(range(lo, hi, step))

    def test_rank_puts_the_right_phrase_first_and_is_confident(self):
        target = seq(SEQ_LEN, 1)
        takes = {f"other_{i}": [normed(seq(SEQ_LEN, 100 + i), 200 + i)] for i in range(9)}
        takes["target"] = [normed(target, 7), normed(target, 8)]
        query = normed(target, 9)
        # scaled the way the self-test would: a right answer lands near 1
        th = {"w_a": 1.0, "w_b": 0.0, "scale_b": 1.0, "abs_max": 1.2, "margin": 0.15,
              "scale_a": min(distances(query, t)[0] for t in takes["target"])}
        ranked = rank(query, takes, th)
        assert ranked[0][0] == "target"
        assert [r[1] for r in ranked] == sorted(r[1] for r in ranked)
        assert len(ranked[0]) == 4      # phrase, score, d_a, d_b
        assert decide(ranked, th)

    def test_score_adds_the_two_signatures_on_their_own_scales(self):
        # "near" is much the better match on the features, "even" only fair on both
        candidates = {"near": (0.1, 12.0), "even": (0.3, 4.0)}
        both = {"w_a": 1.0, "w_b": 1.0, "scale_a": 0.2, "scale_b": 4.0}
        a_only = dict(both, w_b=0.0)
        assert [p for p, *_ in scored(candidates, a_only)] == ["near", "even"]
        assert [p for p, *_ in scored(candidates, both)] == ["even", "near"]
        assert scored(candidates, both)[0][1] == pytest.approx(0.3 / 0.2 + 4.0 / 4.0)

    def test_not_confident_when_far_or_tied(self):
        t = {"abs_max": 1.2, "margin": 0.15}
        assert not decide([], t)
        assert not decide([("a", 1.3, 0.1, 0.1)], t)
        assert decide([("a", 0.9, 0.1, 0.1)], t)
        assert not decide([("a", 0.90, 0.1, 0.1), ("b", 0.93, 0.1, 0.1)], t)
        assert decide([("a", 0.90, 0.1, 0.1), ("b", 1.10, 0.1, 0.1)], t)


def enrolled(bases, per_phrase=3):
    """takes/norm as the store holds them, for a dict of phrase -> base sequence."""
    takes, norm = [], {}
    for n, (phrase, base) in enumerate(bases.items()):
        for i in range(per_phrase):
            key = f"{phrase}-{i}"
            takes.append({"phrase": phrase, "key": key, "fps": FPS})
            norm[key] = normed(base, 400 + n * 10 + i)
    return takes, norm


class TestSelfTest:
    def test_separable_set_is_all_right_and_sets_usable_thresholds(self):
        takes, norm = enrolled({f"p{i}": seq(SEQ_LEN, 10 + i) for i in range(5)})
        rows = leave_one_out(takes, norm)
        assert len(rows) == 15
        th = thresholds_from(rows)
        summary = hebrew.summarise(rows, th)
        assert summary["top1"] == summary["n"] == 15
        assert summary["confused"] == {}
        assert th["scale_a"] > 0 and th["scale_b"] > 0 and th["abs_max"] > 0
        assert (th["w_a"], th["w_b"]) in {w for _, w in hebrew.SIGNATURES}
        assert summary["confident_wrong"] == 0

    def test_a_tied_pair_shows_up_as_a_confusion(self):
        base = seq(SEQ_LEN, 3)
        takes, norm = enrolled({"twin_a": base, "twin_b": base, "other": seq(SEQ_LEN, 4)})
        rows = leave_one_out(takes, norm)
        summary = hebrew.summarise(rows, thresholds_from(rows))
        assert set(summary["confused"]) & {"twin_a", "twin_b"}
        assert summary["top1"] < summary["n"]

    def test_a_take_without_a_sibling_is_a_distractor_only(self):
        takes, norm = enrolled({"p0": seq(SEQ_LEN, 10), "p1": seq(SEQ_LEN, 11)}, per_phrase=1)
        assert leave_one_out(takes, norm) == []
        assert thresholds_from([]) is None

    def test_margin_pays_three_times_more_for_a_wrong_phrase(self):
        # one row wins by 10%, wrongly; three win by 30%, rightly. A margin that keeps the
        # wrong one costs 3 and gains 3, so the search must settle above it.
        # both signatures say the same thing here, so the weighting cannot be what decides
        rows = ([("a", "k", {"b": (1.0, 1.0), "a": (1.1, 1.1)})]
                + [("a", f"r{i}", {"a": (1.0, 1.0), "b": (1.3, 1.3)}) for i in range(3)])
        th = thresholds_from(rows)
        assert th["margin"] > 0.1
        assert hebrew.summarise(rows, th)["confident_wrong"] == 0
        assert hebrew.summarise(rows, th)["confident_right"] == 3

    def test_the_weights_follow_whichever_signature_separates(self):
        def rows(a_for_own, b_for_own):
            """Six held-out takes of two phrases, with each signature told what to say."""
            return [(p, f"{p}{i}", {p: (a_for_own, b_for_own), q: (1.0, 1.0)})
                    for p, q in (("a", "b"), ("b", "a")) for i in range(3)]

        # A points at the wrong phrase, B at the right one: the search must stop trusting A
        b_wins = rows(a_for_own=1.4, b_for_own=0.2)
        assert thresholds_from(b_wins)["w_b"] == 1.0
        assert hebrew.summarise(b_wins, thresholds_from(b_wins))["top1"] == 6
        assert hebrew.summarise(b_wins, thresholds_for(b_wins, (1.0, 0.0)))["top1"] == 0

        a_wins = rows(a_for_own=0.2, b_for_own=1.4)
        assert thresholds_from(a_wins)["w_a"] == 1.0
        assert hebrew.summarise(a_wins, thresholds_from(a_wins))["top1"] == 6


def rows_for(bases, n=2, seed=30):
    """n takes of each phrase as phrase_templates rows, both signatures packed the way the
    database holds them."""
    rows = []
    for k, (phrase, base) in enumerate(bases.items()):
        for i in range(n):
            a, b = take(base, seed + k * 10 + i)
            blob_a, frames, dim = pack(a)
            blob_b, _, _ = pack(b)
            rows.append({"id": len(rows) + 1, "phrase_id": phrase, "fps": FPS,
                         "features": blob_a, "frames": frames, "dim": dim, "geometry": blob_b})
    return rows


class TestTakes:
    def _rows(self, n=2):
        return rows_for({"pain_hurts_a_lot": seq(SEQ_LEN, 21), "needs_thirsty": seq(SEQ_LEN, 22)}, n)

    def test_rows_become_takes_with_usable_thresholds(self):
        rows = self._rows()
        takes = Takes(rows)
        assert len(takes.takes) == 4 and takes.thresholds is not None
        assert set(takes.by_phrase()) == {"pain_hurts_a_lot", "needs_thirsty"}

    def test_both_signatures_survive_the_round_trip(self):
        rows = self._rows()
        takes = Takes(rows)
        for r in rows:
            a, b = takes.raw[str(r["id"])]
            assert np.allclose(a, unpack(r["features"], r["frames"], r["dim"]), atol=1e-2)
            assert np.allclose(b, unpack(r["geometry"], r["frames"], 8), atol=1e-2)
            assert b.shape[1] == 8

    def test_status_and_verdict(self):
        takes = Takes(self._rows())
        assert takes.status("pain_hurts_a_lot") == {"code": "ok", "other": None}
        assert takes.status("comfort_cold") is None
        key = next(t["key"] for t in takes.takes if t["phrase"] == "pain_hurts_a_lot")
        assert takes.verdict(key)["code"] == "ok"

    def test_dropping_a_take_leaves_one_and_rescores(self):
        rows = self._rows()
        gone = next(r for r in reversed(rows) if r["phrase_id"] == "needs_thirsty")
        takes = Takes([r for r in rows if r is not gone])
        assert takes.count("needs_thirsty") == 1
        assert takes.status("needs_thirsty") == {"code": "one_take", "other": None}
        assert takes.self_test["n"] == 2   # only the phrase that still has two takes

    def test_one_take_each_is_not_enrolled_yet(self):
        takes = Takes(self._rows(n=1))
        assert takes.thresholds is None
        assert takes.self_test is None
