"""What Hebrew phrase mode actually does for one patient, measured.

    uv run python backend/tests/hebrew_eval.py --patient <patient_key>

Two measurements. The self-test: every enrolled take held out in turn and ranked against the
rest, giving top-1, top-3, the pairs that get confused, the thresholds read off that, and how
those thresholds would have behaved. Then the held-out one: every run whose truth was
confirmed, so real use doubles as the evaluation.

The reference desktop app could re-extract its kept clips; this one cannot, because no video
is ever stored. Everything here is measured from the signatures in phrase_templates and from
the rankings kept with each run.

Both signatures are measured, and so is the combination: A is the visual encoder's per-frame
features, B is the lip geometry FaceMesh gives, A+B is the two added on the scales the
self-test derives. The app itself uses whichever of the three the self-test picked."""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.app import db, hebrew  # noqa: E402
from backend.app.hebrew import SIGNATURES, tally  # noqa: E402

TARGETS = {"top1": 0.80, "top3": 0.95, "confident_wrong": 0.05}
METRICS = (("top-1", "top1"), ("top-3", "top3"), ("confident right", "confident_right"),
           ("confident wrong", "confident_wrong"), ("unsure", "unsure"))


def rate(part, whole):
    return f"{part}/{whole} ({part / whole:.0%})" if whole else f"{part}/0"


def report(t):
    """One tally: the five measurements, each against its target when it has one, then what
    was mistaken for what."""
    for name, key in METRICS:
        line = f"  {name:<16}{rate(t[key], t['n'])}"
        if key in TARGETS and t["n"]:
            want, got = TARGETS[key], t[key] / t["n"]
            met = got <= want if key == "confident_wrong" else got >= want
            line += f"   target {want:.0%} {'MET' if met else 'MISSED'}"
        print(line)
    for truth, gots in sorted(t["confused"].items()):
        for got, times in sorted(gots.items(), key=lambda g: -g[1]):
            print(f"  {truth} -> {got}  x{times}")


def per_signature(takes, attempts_under):
    """One line per weighting - A, B, A+B - each with the thresholds its own weighting would
    give, marking the one the app uses. attempts_under(th) yields (truth, ranked, confident)."""
    in_use = (takes.thresholds["w_a"], takes.thresholds["w_b"])
    for name, weights in SIGNATURES:
        th = hebrew.thresholds_for(takes.rows, weights)
        t = tally(attempts_under(th))
        print(f"    {name:<20} top-1 {rate(t['top1'], t['n'])}   top-3 {rate(t['top3'], t['n'])}"
              f"   confident wrong {t['confident_wrong']}/{t['n']}"
              f"{' <- in use' if weights == in_use else ''}")


def report_self_test(takes):
    groups = hebrew.by_phrase(takes.takes)
    print(f"\nSELF-TEST  {len(takes.takes)} takes of {len(groups)} phrases")
    thin = [p for p, ts in groups.items() if len(ts) < 2]
    if thin:
        print(f"  only one take, so held out they are distractors only: {', '.join(sorted(thin))}")
    if not takes.loo:
        print("  nothing to measure yet: no phrase has two takes")
        return
    report(takes.loo)
    print("\n  per signature, leave-one-take-out:")
    per_signature(takes, lambda th: hebrew.outcomes(takes.rows, th))
    th = takes.thresholds
    print(f"  thresholds: weights a={th['w_a']:.0f} b={th['w_b']:.0f}  scale_a {th['scale_a']:.4f}  "
          f"scale_b {th['scale_b']:.4f}  abs_max {th['abs_max']:.3f}  margin {th['margin']:.3f}")


def report_held_out(takes):
    """Every runtime attempt whose truth was confirmed: first as it was shown at the time,
    then re-scored per signature against the takes as they are now, so a new take shows up
    here too."""
    rows = [r for r in db.list_runs(1000) if r.get("hebrew") and r.get("truth")]
    print(f"\nHELD OUT  {len(rows)} attempts with the phrase confirmed")
    if not rows:
        return
    report(tally((r["truth"], r["hebrew"]["ranked"], r["hebrew"]["confident"]) for r in rows))
    if not takes.rows:
        return

    def rescored(th):  # the stored d_a and d_b let every weighting be tried on the same attempts
        for r in rows:
            ranked = hebrew.scored({p: (d_a, d_b) for p, _, d_a, d_b in r["hebrew"]["ranked"]}, th)
            yield r["truth"], ranked, hebrew.decide(ranked, th)

    print("  re-scored per signature, with today's thresholds:")
    per_signature(takes, rescored)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patient", required=True, help="the device's patient_key")
    patient = parser.parse_args().patient

    takes = hebrew.Takes(db.list_phrase_templates(patient))
    if not takes.takes:
        print(f"Nothing enrolled for {patient}: teach a few phrases in Settings first.")
        return
    report_self_test(takes)
    report_held_out(takes)


if __name__ == "__main__":
    main()
