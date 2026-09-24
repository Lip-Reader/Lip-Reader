"""Hebrew closed-set phrase mode: the take store, the matcher and the self-test.

No Hebrew lip-reading model exists, so the patient mouths each phrase a few times in learn
mode and the app stores what each one looks like. A clip is matched by dynamic time warping
over the visual encoder's per-frame features, so mouthing faster or slower than at enrolment
still matches. Every threshold comes out of a leave-one-take-out self-test over the enrolled
takes; none of them is hand-set.

The takes come from the database, one `Takes` per patient, and the screens live in the app."""

import logging

import numpy as np
from scipy.spatial.distance import cdist

from .vsr import BadClip, NoFace  # noqa: F401

log = logging.getLogger("chaplin.hebrew")

TARGET_HZ = 15       # lip movement needs no more; halves the DTW work on a 30 fps clip
BAND = 0.3           # Sakoe-Chiba band, as a fraction of the longer sequence
TAKES_WANTED = 3     # recommended per phrase; one is allowed and flagged less reliable
TOP_K = 3
WRONG_COST = 3       # the stated policy: one confident wrong phrase costs three missed ones
# The three ways to weigh the signatures. The self-test picks one; the eval reports all three.
SIGNATURES = (("A   encoder features", (1.0, 0.0)), ("B   lip geometry", (0.0, 1.0)),
              ("A+B both", (1.0, 1.0)))
# The lips are moving when their speed (lip_speed) is above STILL, an absolute floor in
# eye-distance units. Measured on the first ten real takes: resting jitter 0.003-0.009, speech
# 0.042-0.065. The earlier relative threshold (a fraction of the take's own peak) collapsed under
# the jitter on a quiet take and refused it as "never still"; an absolute floor also lets the
# recording screen judge each frame as it comes, which a relative one cannot.
STILL = 0.02
SMOOTH_S, MERGE_S = 0.1, 0.5   # speed is smoothed over this; gaps shorter than this are one span
TOO_FAR, EDGE = 120, 0.2       # eyes closer than this in px: mouth too small to read; the nose
                               # must sit inside the middle 60% of the frame

# FaceMesh landmarks. The inner lip ring is FACEMESH_LIPS' 20-point cycle through 13 and 14.
EYES, NOSE = (33, 263), 1
INNER_TOP, INNER_LOW, INNER_L, INNER_R, OUTER_TOP, OUTER_LOW = 13, 14, 78, 308, 0, 17
INNER_RING = (13, 82, 81, 80, 191, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312)


class StillClip(BadClip):
    """Nothing to measure: the mouth never moved, or never rested."""


def by_phrase(takes):
    """{phrase: [take, ...]}, in enrolment order."""
    out = {}
    for t in takes:
        out.setdefault(t["phrase"], []).append(t)
    return out


# --- the two signatures -----------------------------------------------------

def lip_vector(p):
    """The 8 lip numbers for one frame of FaceMesh points, in a frame fixed to the head.

    x runs across the eyes, z out of the face and y down it, so turning or tilting the head
    turns the frame with it and the numbers do not move. Everything is divided by the distance
    between the eyes, so moving closer to the camera does not move them either."""
    across = p[EYES[1]] - p[EYES[0]]
    scale = float(np.linalg.norm(across))
    x = across / scale
    down = p[NOSE] - (p[EYES[0]] + p[EYES[1]]) / 2
    z = -np.cross(x, down)
    z /= np.linalg.norm(z)
    local = (p - (p[EYES[0]] + p[EYES[1]]) / 2) @ np.stack([x, np.cross(x, z), z]).T / scale

    centre = (local[INNER_TOP] + local[INNER_LOW]) / 2
    corners = local[[INNER_L, INNER_R]]
    ring = local[list(INNER_RING)]
    return np.array([
        np.linalg.norm(local[INNER_TOP] - local[INNER_LOW]),   # opening
        np.linalg.norm(local[INNER_L] - local[INNER_R]),       # width
        0.5 * abs(np.dot(ring[:, 0], np.roll(ring[:, 1], -1))  # inner-lip area (shoelace)
                  - np.dot(ring[:, 1], np.roll(ring[:, 0], -1))),
        np.linalg.norm(local[OUTER_TOP] - local[INNER_TOP]),   # upper lip
        np.linalg.norm(local[OUTER_LOW] - local[INNER_LOW]),   # lower lip
        np.linalg.norm(local[OUTER_TOP] - local[OUTER_LOW]),   # outer opening
        centre[1] - corners[:, 1].mean(),                      # corner lift (y runs downwards)
        centre[2],                                             # protrusion, out of the face
    ], dtype=np.float32)


def face_mesh():
    """One FaceMesh, set up the same way wherever a face is read."""
    import mediapipe as mp

    return mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True,
                                           min_detection_confidence=0.5)


def face_points(mesh, frame):
    """The 478 face points of an RGB frame in pixels, or None when there is no face. FaceMesh
    gives x and y as fractions of width and height, and z on x's scale."""
    found = mesh.process(frame).multi_face_landmarks
    if not found:
        return None
    h, w = frame.shape[:2]
    return np.array([[m.x * w, m.y * h, m.z * w] for m in found[0].landmark])


def lip_geometry(frames):
    """(T, 8) lip numbers for a clip. A frame with no face copies the one before it, and the
    leading frames copy the first face found; a clip with no face at all is refused."""
    out, last = [], None
    with face_mesh() as mesh:
        for frame in frames:
            p = face_points(mesh, frame)
            if p is not None:
                last = lip_vector(p)
            out.append(last)
    first = next((i for i, v in enumerate(out) if v is not None), None)
    if first is None:
        raise NoFace("FaceMesh found no face in any frame")
    return np.array([v if v is not None else out[first] for v in out], dtype=np.float32)


def lip_speed(b):
    """How fast the lips are changing from one frame to the next: opening, width and area
    summed. In eye-distance units, so the same number at any distance from the camera."""
    return np.abs(np.diff(np.asarray(b)[:, :3], axis=0)).sum(axis=1)


def active_spans(b, fps):
    """The stretches where the mouth is moving, as (start, end) frames: lip speed, smoothed,
    above the STILL floor."""
    speed = lip_speed(b)
    if len(speed) == 0:
        return []
    window = max(1, min(round(fps * SMOOTH_S), len(speed)))  # never smooth away a short clip
    speed = np.convolve(speed, np.ones(window) / window, mode="same")
    moving = (speed > STILL).astype(np.int8)
    edges = np.diff(np.concatenate([[0], moving, [0]]))
    spans = [[int(a), int(z) + 1] for a, z in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1))]
    merged = spans[:1]
    for span in spans[1:]:  # a gap shorter than MERGE_S is a pause inside one phrase
        if span[0] - merged[-1][1] < round(fps * MERGE_S):
            merged[-1][1] = span[1]
        else:
            merged.append(span)
    return [(a, min(z, len(b))) for a, z in merged]


# --- matching ---------------------------------------------------------------

def _unit(x):
    return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-8)


def trim(b, fps):
    """Where the phrase starts and ends, and the resting mouth either side of it."""
    spans = active_spans(b, fps)
    if not spans:
        raise StillClip("nothing moved - record again, mouthing the phrase clearly",
                        f"peak lip speed {lip_speed(b).max():.4f} never above {STILL}")
    lo, hi = spans[0][0], spans[-1][1]
    still = np.concatenate([b[:lo], b[hi:]])
    if len(still) == 0:
        raise StillClip("no still moment before or after - hold still a moment before and after",
                        f"moving in frames {lo}-{hi} of {len(b)}, floor {STILL}")
    return lo, hi, np.median(still, axis=0)


def normalise(a, b, fps, b_scale):
    """Ready one clip for matching. Both signatures are trimmed to the phrase itself and
    downsampled to ~15 Hz, which is as fast as lips move.

    A: whatever is constant within the take - skin, beard, lip colour, glasses, steady light -
    sits in the mean frame, so subtracting it leaves the movement. B: subtracting the resting
    mouth leaves the movement too, and dividing by each number's spread over every enrolled
    frame puts the eight of them on one scale."""
    lo, hi, rest = trim(b, fps)
    step = max(1, round(fps / TARGET_HZ))
    window = np.asarray(a, dtype=np.float32)[lo:hi]
    return (_unit(window - window.mean(axis=0, keepdims=True))[::step],
            ((np.asarray(b, dtype=np.float32)[lo:hi] - rest) / b_scale)[::step])


def dtw(cost, band=BAND):
    """Path-normalised DTW over a per-frame cost matrix, inside a Sakoe-Chiba band."""
    n, m = cost.shape
    if n == 0 or m == 0:
        return float("inf")
    w = max(3, int(band * max(n, m)), abs(n - m))
    prev = np.full(m + 1, np.inf)
    prev[0] = 0.0
    for i in range(1, n + 1):
        cur = np.full(m + 1, np.inf)
        lo, hi = max(1, i - w), min(m, i + w)
        row = cost[i - 1]
        for j in range(lo, hi + 1):
            cur[j] = row[j - 1] + min(prev[j - 1], prev[j], cur[j - 1])
        prev = cur
    return float(prev[m] / (n + m))


def distances(q, t):
    """How unlike two normalised clips are, by each signature: cosine cost for A, plain
    distance for B. One DTW serves both; only the cost matrix differs."""
    return dtw(1.0 - q[0] @ t[0].T), dtw(cdist(q[1], t[1]))


def scored(per_phrase, th):
    """Rank the candidates for one clip: [(phrase, score, d_a, d_b)], best first."""
    out = [(p, th["w_a"] * d_a / th["scale_a"] + th["w_b"] * d_b / th["scale_b"], d_a, d_b)
           for p, (d_a, d_b) in per_phrase.items()]
    out.sort(key=lambda r: r[1])
    return out


def closest(q, takes):
    """{phrase: (d_a, d_b)} against its closest take - for A and for B separately, since a take
    can be the better match on the lips and another on the features."""
    out = {}
    for phrase_id, enrolled in takes.items():
        if enrolled:
            pairs = [distances(q, t) for t in enrolled]
            out[phrase_id] = (min(d_a for d_a, _ in pairs), min(d_b for _, d_b in pairs))
    return out


def rank(q, takes, th):
    """Every phrase scored against one clip, best first. takes: {phrase: [normalised]}."""
    return scored(closest(q, takes), th)


def gap(ranked):
    """How far the winner is ahead of the runner-up, relative to its own score."""
    return (ranked[1][1] - ranked[0][1]) / max(ranked[0][1], 1e-6) if len(ranked) > 1 else float("inf")


def decide(ranked, thresholds):
    """Confident when the best score is low enough and clearly ahead of the runner-up."""
    return bool(ranked) and ranked[0][1] <= thresholds["abs_max"] and gap(ranked) >= thresholds["margin"]


# --- the self-test the thresholds come from ---------------------------------

def leave_one_out(takes, norm):
    """Hold each take out and measure it against the rest. A take whose phrase has no other take
    is a distractor only: held out it could never be right, and counting it would say the
    self-test failed when all it lacks is a second take.

    Returns [(phrase, key, {phrase: (d_a, d_b)})]."""
    groups, rows = by_phrase(takes), []
    for t in takes:
        if len(groups[t["phrase"]]) < 2:
            continue
        against = {p: [norm[o["key"]] for o in ts if o["key"] != t["key"]] for p, ts in groups.items()}
        rows.append((t["phrase"], t["key"], closest(norm[t["key"]], against)))
    return rows


def outcomes(rows, th):
    """Each held-out take scored and decided under th: (truth, ranked, confident), for tally()."""
    for phrase, _, d in rows:
        ranked = scored(d, th)
        yield phrase, ranked, decide(ranked, th)


def tally(attempts):
    """What a set of attempts adds up to: top-1, top-3, what was mistaken for what, and how the
    confidence call went. attempts: (truth, ranked, confident), ranked best first. The one
    counting for the self-test, the weight search and the eval script's real attempts."""
    out = {"n": 0, "top1": 0, "top3": 0, "confused": {},
           "confident_right": 0, "confident_wrong": 0, "unsure": 0}
    for truth, ranked, confident in attempts:
        best = ranked[0][0]
        out["n"] += 1
        if best == truth:
            out["top1"] += 1
        else:
            got = out["confused"].setdefault(truth, {})
            got[best] = got.get(best, 0) + 1
        out["top3"] += truth in [r[0] for r in ranked[:TOP_K]]
        if confident:
            out["confident_right" if best == truth else "confident_wrong"] += 1
        else:
            out["unsure"] += 1
    return out


def summarise(rows, th):
    """The self-test's tally, or {} while there is nothing to test."""
    return tally(outcomes(rows, th)) if rows else {}


def thresholds_for(rows, weights):
    """The thresholds one weight setting would give: what each signature's distances have to be
    divided by to be comparable, how close the winner must be, and how far ahead."""
    own = np.array([d[phrase] for phrase, _, d in rows])
    scale_a, scale_b = np.median(own, axis=0) + 1e-9
    th = {"w_a": weights[0], "w_b": weights[1],
          "scale_a": float(scale_a), "scale_b": float(scale_b)}
    ranked = [scored(d, th) for _, _, d in rows]
    th["abs_max"] = float(np.percentile(
        [next(sc for p, sc, *_ in r if p == phrase) for (phrase, _, _), r in zip(rows, ranked)], 95))

    def value(margin):
        """Right-confident minus WRONG_COST x wrong-confident, were this the margin."""
        trial = dict(th, margin=margin)
        return sum(1 if r[0][0] == phrase else -WRONG_COST
                   for (phrase, _, _), r in zip(rows, ranked) if decide(r, trial))

    # ties go to the stricter value: a real attempt is noisier than a held-out enrolment take
    candidates = sorted({0.0} | {gap(r) for r in ranked if len(r) > 1})
    th["margin"] = max(candidates, key=lambda m: (value(m), m))
    return th


def thresholds_from(rows):
    """Read the thresholds off the self-test, the weight of each signature included: whichever
    of A alone, B alone or both gets most held-out takes right. None until a phrase has two."""
    if not rows:
        return None

    def top1(weights):
        return tally(outcomes(rows, thresholds_for(rows, weights)))["top1"]

    # ties go to using both signatures: when they measure the same here, two should travel better
    return thresholds_for(rows, max((w for _, w in SIGNATURES), key=lambda w: (top1(w), sum(w))))


# --- the store --------------------------------------------------------------

def pack(feats) -> tuple[bytes, int, int]:
    a = np.ascontiguousarray(feats, dtype="<f2")
    return a.tobytes(), int(a.shape[0]), int(a.shape[1])


def unpack(blob: bytes, frames: int, dim: int) -> np.ndarray:
    return np.frombuffer(blob, dtype="<f2").reshape(frames, dim).astype(np.float32)


class Takes:
    """One patient's enrolled takes, as they come out of the phrase_templates table: both
    signatures per take, and everything the matcher needs read off them again here, because
    the scales and thresholds move as takes come and go."""

    def __init__(self, rows):
        self.takes = [{"phrase": r["phrase_id"], "key": str(r["id"]), "fps": float(r["fps"])}
                      for r in rows]
        self.raw = {str(r["id"]): (unpack(r["features"], r["frames"], r["dim"]),
                                   unpack(r["geometry"], r["frames"], 8)) for r in rows}
        self._recompute()

    def _recompute(self):
        # each lip number is divided by its spread over every enrolled frame, so all eight
        # weigh the same; that spread moves as takes come and go, so everything is re-read here
        frames = [b for _, b in self.raw.values()]
        self.b_scale = np.concatenate(frames).std(axis=0) + 1e-6 if frames else None
        self.norm = {t["key"]: normalise(*self.raw[t["key"]], t["fps"], self.b_scale)
                     for t in self.takes}
        self.rows = leave_one_out(self.takes, self.norm)
        self.thresholds = thresholds_from(self.rows)
        self.loo = summarise(self.rows, self.thresholds)

    def by_phrase(self):
        """{phrase: [normalised take, ...]}, what the matcher ranks against."""
        return {p: [self.norm[t["key"]] for t in ts] for p, ts in by_phrase(self.takes).items()}

    def count(self, phrase):
        return sum(t["phrase"] == phrase for t in self.takes)

    def verdict(self, key):
        """What the self-test makes of one take, for the screen that just recorded it."""
        take = next(t for t in self.takes if t["key"] == key)
        n = self.count(take["phrase"])
        row = next((r for r in self.rows if r[1] == key), None)
        if row is None:
            return {"code": "first_take", "other": None, "takes": n}
        other = scored(row[2], self.thresholds)[0][0]
        if other == take["phrase"]:
            return {"code": "ok", "other": None, "takes": n}
        return {"code": "confused", "other": other, "takes": n}

    def status(self, phrase):
        """The phrase's line on the enrolment screen: how the takes it has measured, or None
        while it has none."""
        if self.count(phrase) == 0:
            return None
        wrong = self.loo.get("confused", {}).get(phrase)
        if wrong:
            return {"code": "confused", "other": max(wrong, key=wrong.get)}
        if self.count(phrase) == 1:
            return {"code": "one_take", "other": None}
        return {"code": "ok", "other": None}

    @property
    def self_test(self):
        """How the leave-one-take-out test went, or None while there is nothing to test."""
        if not self.loo:
            return None
        return {"n": self.loo["n"], "top1": self.loo["top1"], "top3": self.loo["top3"]}
