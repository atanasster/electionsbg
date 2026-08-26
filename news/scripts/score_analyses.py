#!/usr/bin/env python3
"""Score one set of analyses against another, PER FIELD.

⚠️⚠️ NEVER AS ONE NUMBER. „The model agrees 88% of the time" is the least
useful sentence this harness could produce: over the corpus, `leaning` is
`not_applicable` on 90% and `russia_stance` on 94%, so a classifier that
always answers not_applicable scores ~90% and a single headline figure would
call it excellent. The outcome is field-by-field — expect a small model to own
quality, topics and mentions, and leaning/Russia stance either to clear a κ
bar or be escalated.

Per field, and each metric is chosen because the naive one lies:

  quality        accuracy AND per-class recall — accuracy alone is 65% for a
                 model that only ever says „ok", which is 238 of 365 records.
  topics         top-1 on the PRIMARY category only. Secondary topics are
                 optional in the rubric, so scoring the set punishes a model
                 for the rubric's own latitude.
  mentions       precision and recall, reported separately and never as F1 —
                 ⚠️ A WRONG LINK IS WORSE THAN A MISSING ONE. This is the
                 only field where the two errors are not comparable: a
                 missing link costs a reader a click; a wrong one asserts
                 that a named person was in the news when they were not.
  leaning        macro-F1 AND ordinal-weighted Cohen's κ. Macro-F1 stops the
  russia_stance  majority class carrying the score; the ordinal weighting
                 makes conservative-for-strong_conservative a NEAR MISS and
                 progressive-for-conservative a real error, which plain κ
                 scores identically.
  stories        pairwise F1, scored separately because the deterministic
                 prefilter does most of the work — folding it into an overall
                 number would credit the model for the prefilter's recall.

Run:  python3 news/scripts/score_analyses.py --ref A/ --hyp B/
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The ordinal positions the two political axes live on, shared with the
# topic-spread measure so a „near miss" means the same thing in both places.
from build_app_data import AXIS_POSITIONS  # noqa: E402

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])


def load_set(path: Path) -> dict:
    """url → analysis, from a directory of per-article records."""
    out = {}
    for f in sorted(path.glob("*/*.json")) + sorted(path.glob("*.json")):
        try:
            rec = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        url = rec.get("url")
        if url:
            out[url] = rec
    return out


# The sentinel a refusal is scored as. ⚠️ A string that can never collide
# with a real label, so it always counts as a miss and shows up by name in
# the confusion table rather than as a silent absence.
DECLINED = "__declined__"


def counts_table(pairs) -> dict:
    """Confusion counts as {(ref, hyp): n}."""
    return dict(Counter(pairs))


def confusion(pairs) -> dict:
    """The off-diagonal counts, keyed „ref->hyp".

    ⚠️ SORTED ON THE STRINGIFIED KEY. `sorted()` over tuples containing None
    raises TypeError comparing None with a str — and it did so from inside
    the results dict, killing the WHOLE run rather than the one field. 111 of
    365 reference records already carry no primary topic, so this was
    reachable today.
    """
    return {k: n for k, n in sorted(
        ((f"{r}->{h}", n) for (r, h), n in counts_table(pairs).items()
         if r != h))}


def macro_f1(pairs) -> dict:
    """Macro-F1 over the labels PRESENT IN THE REFERENCE.

    ⚠️ Macro, not micro. Micro-F1 on a 90%-majority field is the majority
    class's score wearing an average's name. And the label set comes from the
    REFERENCE — a hypothesis that invents a label is charged to the RECALL of
    the classes it should have chosen instead, not rewarded with a new
    perfect-recall class of its own. (Measured: its precision on the real
    classes stays 1.0, so recall is where the cost lands — the first draft of
    this comment said precision and was wrong.)
    """
    labels = sorted({r for r, _ in pairs})
    per = {}
    for lab in labels:
        tp = sum(1 for r, h in pairs if r == lab and h == lab)
        fp = sum(1 for r, h in pairs if r != lab and h == lab)
        fn = sum(1 for r, h in pairs if r == lab and h != lab)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per[lab] = {"support": tp + fn, "precision": round(prec, 3),
                    "recall": round(rec, 3), "f1": round(f1, 3)}
    return {"macro_f1": round(sum(v["f1"] for v in per.values())
                              / len(per), 3) if per else None,
            "per_label": per}


def weighted_kappa(pairs, axis: str) -> dict:
    """Ordinal-weighted Cohen's κ on a -2..+2 axis.

    ⚠️ ORDINAL. Plain κ scores conservative-for-strong_conservative exactly
    as badly as progressive-for-conservative, and those are not the same
    mistake: the first is a near miss on the same side, the second crosses the
    centre. Quadratic weights make the distance count.

    ⚠️ `not_applicable` HAS NO POSITION and is excluded — it is the majority
    class, and mapping it to 0 would make it a near neighbour of `neutral`,
    turning the commonest confusion in the corpus into a rounding error.
    Excluded rows are COUNTED, so the sample the κ was computed over is
    visible beside it.
    """
    pos = AXIS_POSITIONS[axis]
    usable = [(pos[r], pos[h]) for r, h in pairs if r in pos and h in pos]
    dropped = len(pairs) - len(usable)
    n = len(usable)
    if n < 2:
        return {"kappa": None, "n": n, "excluded": dropped,
                "why": "fewer than two rows carry a position on this axis"}

    levels = sorted(set(pos.values()))
    k = len(levels)
    idx = {v: i for i, v in enumerate(levels)}

    def w(a, b):  # quadratic
        return 1 - ((idx[a] - idx[b]) ** 2) / ((k - 1) ** 2)

    obs = sum(w(r, h) for r, h in usable) / n
    ref_dist = Counter(r for r, _ in usable)
    hyp_dist = Counter(h for _, h in usable)
    exp = sum(w(a, b) * ref_dist[a] * hyp_dist[b] / (n * n)
              for a in levels for b in levels)
    kappa = (obs - exp) / (1 - exp) if exp != 1 else None
    return {"kappa": round(kappa, 3) if kappa is not None else None,
            "observed_agreement": round(obs, 3),
            "expected_agreement": round(exp, 3),
            "n": n, "excluded": dropped,
            "excluded_meaning": "rows where either side said not_applicable, "
                                "which has no position on this axis"}


def score_quality(ref: dict, hyp: dict) -> dict:
    pairs = [((ref[u].get("quality") or {}).get("verdict"),
              (hyp[u].get("quality") or {}).get("verdict"))
             for u in ref if u in hyp]
    # ⚠️ A row with no reference verdict cannot be scored — and `None == None`
    # counted as a HIT, so two sets that both answered nothing reported
    # accuracy 1.0. Excluded and counted, like the axes above.
    unscorable = sum(1 for r, _ in pairs if r is None)
    pairs = [(r, h if h is not None else DECLINED)
             for r, h in pairs if r is not None]
    correct = sum(1 for r, h in pairs if r == h)
    per_class = defaultdict(lambda: {"support": 0, "hit": 0})
    for r, h in pairs:
        per_class[r]["support"] += 1
        per_class[r]["hit"] += int(r == h)
    return {
        "n": len(pairs),
        "no_reference_verdict": unscorable,
        "accuracy": round(correct / len(pairs), 3) if pairs else None,
        # ⚠️ Per-class recall beside it: accuracy alone is 65% for a model
        # that only ever answers „ok", which is 238 of 365 records.
        "recall_by_class": {k: {"support": v["support"],
                                "recall": round(v["hit"] / v["support"], 3)}
                            for k, v in sorted(per_class.items())},
        "confusion": confusion(pairs),
    }


def primary_category(a: dict):
    for t in a.get("topics") or []:
        if t.get("primary"):
            return t.get("category")
    return None


def score_topics(ref: dict, hyp: dict) -> dict:
    pairs = [(primary_category(ref[u]), primary_category(hyp[u]))
             for u in ref if u in hyp]
    scored = [(r, h) for r, h in pairs if r is not None]
    hit = sum(1 for r, h in scored if r == h)
    return {
        "n": len(scored),
        # ⚠️ PRIMARY only. Secondary topics are optional in the rubric, so
        # scoring the set punishes a model for the rubric's own latitude.
        "top1": round(hit / len(scored), 3) if scored else None,
        "no_primary_in_reference": len(pairs) - len(scored),
        "confusion": confusion(scored),
    }


def linked_ids(a: dict) -> set:
    """The (kind, id) pairs an analysis actually links."""
    return {(m.get("kind"), m.get("id")) for m in (a.get("mentions") or [])
            if m.get("id")}


def score_mentions(ref: dict, hyp: dict) -> dict:
    tp = fp = fn = 0
    for u in ref:
        if u not in hyp:
            continue
        r, h = linked_ids(ref[u]), linked_ids(hyp[u])
        tp += len(r & h)
        fp += len(h - r)
        fn += len(r - h)
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    return {
        "true_positives": tp, "false_positives": fp, "false_negatives": fn,
        "precision": round(prec, 3) if prec is not None else None,
        "recall": round(rec, 3) if rec is not None else None,
        # ⚠️ NO F1 HERE, deliberately. F1 treats a wrong link and a missing
        # one as the same size of mistake, and on this field they are not: a
        # missing link costs a reader a click, a wrong one asserts that a
        # named person was in the news when they were not. Reporting a single
        # number would let precision be traded away for recall silently.
        "why_no_f1": ("a wrong link is worse than a missing one, so the two "
                      "errors must not be averaged"),
    }


def score_axis(ref: dict, hyp: dict, field: str) -> dict:
    key = "verdict" if field == "ai_generated" else "label"
    pairs = [((ref[u].get(field) or {}).get(key),
              (hyp[u].get(field) or {}).get(key))
             for u in ref if u in hyp]
    # ⚠️⚠️ A HYPOTHESIS THAT DECLINED TO ANSWER IS WRONG, NOT ABSENT. Dropping
    # those rows made REFUSAL the highest-scoring strategy on every axis: a
    # model returning nothing scored macro-F1 1.000 while one that answered
    # and erred scored 0.334 — and „emits nothing on the hard records" is
    # precisely how a local 12B fails. The row is scored against a sentinel
    # that can never equal a real label, so the refusal costs recall on the
    # class it should have found.
    #
    # A missing REFERENCE label is different: there is no truth to score
    # against, so those rows are excluded and counted.
    unscorable = sum(1 for r, _ in pairs if r is None)
    declined = sum(1 for r, h in pairs if r is not None and h is None)
    pairs = [(r, h if h is not None else DECLINED)
             for r, h in pairs if r is not None]
    out = {"n": len(pairs), "declined_by_hyp": declined,
           "no_reference_label": unscorable, **macro_f1(pairs)}
    if field in AXIS_POSITIONS:
        out["ordinal_kappa"] = weighted_kappa(pairs, field)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True,
                    help="the reference set (the frontier baseline)")
    ap.add_argument("--hyp", required=True, help="the set being scored")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    ref = load_set(Path(args.ref))
    hyp = load_set(Path(args.hyp))
    shared = sorted(set(ref) & set(hyp))
    if not shared:
        # ⚠️ Exit non-zero. Zero overlap produces a table of nulls that reads
        # like „nothing to report" rather than „these two sets are about
        # different articles".
        print(json.dumps({"error": "no_overlap", "ref": len(ref),
                          "hyp": len(hyp)}))
        return 2

    result = {
        "ref": args.ref, "hyp": args.hyp,
        # ⚠️ Counts beside their denominators. „Scored 240" means nothing
        # without „of 365 in the reference, 300 in the hypothesis".
        "ref_records": len(ref), "hyp_records": len(hyp),
        "scored": len(shared),
        "missing_from_hyp": len(set(ref) - set(hyp)),
        "extra_in_hyp": len(set(hyp) - set(ref)),
        "fields": {
            "quality": score_quality(ref, hyp),
            "topics": score_topics(ref, hyp),
            "mentions": score_mentions(ref, hyp),
            "leaning": score_axis(ref, hyp, "leaning"),
            "russia_stance": score_axis(ref, hyp, "russia_stance"),
            "ai_generated": score_axis(ref, hyp, "ai_generated"),
        },
        # ⚠️ Stated in the OUTPUT, not only in this file's docstring — a
        # score read out of a JSON blob months from now must carry the reason
        # there is no single number in it.
        "no_overall_score": (
            "scored per field on purpose: leaning is not_applicable on 90% "
            "of the corpus and russia_stance on 94%, so any single figure is "
            "dominated by the majority class and would call a constant "
            "classifier excellent"),
    }
    print(json.dumps(result, ensure_ascii=False,
                     indent=None if args.json else 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
