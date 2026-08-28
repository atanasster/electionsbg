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
import re
import unicodedata
import hashlib

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


def apply_reference_revision(reference: dict, revision_path: Path) -> dict:
    """Apply a checked party-only overlay without rewriting frozen gold files."""
    try:
        revision = json.loads(revision_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable_reference_revision: {exc}") from exc
    records = revision.get("records")
    if revision.get("version") != 2 or not isinstance(records, dict):
        raise ValueError("invalid_reference_revision_shape")
    # This binds the correction overlay to the unchanged selection, rather
    # than silently applying it after a new draw has replaced the baseline.
    baseline = revision.get("base_gold_selection")
    if not isinstance(baseline, str) or not baseline.startswith("news/data/"):
        raise ValueError("reference_revision_missing_base_path")
    gold_path = ROOT / baseline
    if not gold_path.exists():
        raise ValueError("reference_revision_missing_base_selection")
    actual = hashlib.sha256(gold_path.read_bytes()).hexdigest()
    if actual != revision.get("base_gold_selection_sha256"):
        raise ValueError("reference_revision_base_hash_mismatch")
    out = {url: dict(row) for url, row in reference.items()}
    for url, patch in records.items():
        if url not in out:
            raise ValueError(f"reference_revision_unknown_url:{url}")
        parties = patch.get("entities_parties")
        tones = patch.get("party_tones")
        if not isinstance(parties, list) or not isinstance(tones, list):
            raise ValueError(f"reference_revision_bad_party_shape:{url}")
        party_set = set(parties)
        tone_set = {item.get("party") for item in tones if isinstance(item, dict)}
        if party_set != tone_set or len(tone_set) != len(tones):
            raise ValueError(f"reference_revision_party_coverage:{url}")
        if any(item.get("tone") not in PARTY_TONES or
               not isinstance(item.get("confidence"), (int, float)) or
               isinstance(item.get("confidence"), bool) or
               not isinstance(item.get("evidence"), str) or not item["evidence"].strip()
               for item in tones):
            raise ValueError(f"reference_revision_invalid_tone:{url}")
        patched = dict(out[url])
        patched["entities"] = {**(patched.get("entities") or {}),
                               "parties": parties}
        patched["party_tones"] = tones
        patched["party_tones_version"] = 2
        out[url] = patched
    return out


# The sentinel a refusal is scored as. ⚠️ A string that can never collide
# with a real label, so it always counts as a miss and shows up by name in
# the confusion table rather than as a silent absence.
DECLINED = "__declined__"
PARTY_TONES = ("favorable", "unfavorable", "neutral", "mixed")
PARTY_RELEASE_GATES = {
    "pair_precision": 0.95,
    "pair_recall": 0.90,
    "tone_macro_f1": 0.80,
    "per_tone_recall": 0.70,
    "wrong_canonical_links": 0,
    "unsupported_evidence": 0,
    "valid_schema_before_retry": 0.99,
    "valid_schema_after_review": 1.0,
}


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


def normalize_party(value) -> str:
    """Stable fallback key when an adjudicator has not assigned an ID."""
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"[^\w]+", "", value, flags=re.UNICODE)


def party_items(a: dict) -> dict:
    """Normalized display name → item; identity is scored separately.

    The analyzer rejects duplicates. The scorer still has to survive an old
    or hand-adjudicated file, so last-write-wins is explicit and duplicates
    are reported separately by score_party_tones().
    """
    return {normalize_party(item.get("party")): item
            for item in (a.get("party_tones") or [])
            if normalize_party(item.get("party"))}


def source_articles(*sets: dict) -> dict:
    """Load source records for evidence checks, refusing silent no-op checks."""
    out = {}
    for rows in sets:
        for url, analysis in rows.items():
            rel = analysis.get("article_path")
            if not isinstance(rel, str) or not rel.startswith("news/data/"):
                continue
            try:
                article = json.loads((ROOT / rel).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if article.get("url") == url:
                out[url] = article
    return out


def _calibration_band(confidence) -> str | None:
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return None
    if confidence < 0 or confidence > 1:
        return None
    if confidence < 0.6:
        return "0.00-0.59"
    if confidence < 0.8:
        return "0.60-0.79"
    if confidence < 0.9:
        return "0.80-0.89"
    return "0.90-1.00"


def score_party_tones(ref: dict, hyp: dict, articles: dict | None = None) -> dict:
    """Score party detection and tone without collapsing them into one score."""
    tp = fp = fn = 0
    tone_pairs = []
    calibration = defaultdict(lambda: {"n": 0, "confidence": 0.0,
                                        "correct": 0})
    evidence_missing = evidence_unsupported = evidence_unverifiable = 0
    unresolved_ref = unresolved_hyp = wrong_links = 0
    duplicate_ref = duplicate_hyp = 0
    represented_urls = 0
    for url in ref:
        if url not in hyp:
            continue
        raw_r = ref[url].get("party_tones") or []
        raw_h = hyp[url].get("party_tones") or []
        duplicate_ref += len(raw_r) - len(party_items(ref[url]))
        duplicate_hyp += len(raw_h) - len(party_items(hyp[url]))
        r, h = party_items(ref[url]), party_items(hyp[url])
        represented_urls += int(bool(r))
        rk, hk = set(r), set(h)
        tp += len(rk & hk)
        fp += len(hk - rk)
        fn += len(rk - hk)
        unresolved_ref += sum(1 for item in raw_r if not item.get("party_id"))
        unresolved_hyp += sum(1 for item in raw_h if not item.get("party_id"))
        # Pair detection answers „did it find the named party?"; a nullable
        # reference ID must not turn the same display party into FP+FN. IDs
        # answer the distinct, higher-consequence identity question below.
        for name in rk & hk:
            left, right = r[name].get("party_id"), h[name].get("party_id")
            if left and right and left != right:
                wrong_links += 1

        for key in sorted(rk & hk):
            rt = r[key].get("tone")
            ht = h[key].get("tone") or DECLINED
            tone_pairs.append((rt, ht))
            evidence = h[key].get("evidence")
            if not isinstance(evidence, str) or not evidence.strip():
                evidence_missing += 1
            band = _calibration_band(h[key].get("confidence"))
            if band:
                calibration[band]["n"] += 1
                calibration[band]["confidence"] += h[key]["confidence"]
                calibration[band]["correct"] += int(rt == ht)

        # Evidence is a claim made by EVERY predicted pair, not only a match.
        # A false-positive party with an invented quote must fail the same
        # audit rather than escaping through the detection intersection.
        if articles is None:
            evidence_unverifiable += len(raw_h)
        else:
            article = articles.get(url)
            for item in raw_h:
                evidence = item.get("evidence")
                if not isinstance(evidence, str) or not evidence.strip():
                    continue
                if article is None:
                    evidence_unverifiable += 1
                else:
                    # Shared validator implementation, not a second looser
                    # notion of grounding for the release report.
                    from analyze_articles import party_tone_evidence_grounded
                    if not party_tone_evidence_grounded(evidence, article):
                        evidence_unsupported += 1

    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    cal = {}
    for band in ("0.00-0.59", "0.60-0.79", "0.80-0.89", "0.90-1.00"):
        row = calibration[band]
        accuracy = row["correct"] / row["n"] if row["n"] else None
        mean_conf = row["confidence"] / row["n"] if row["n"] else None
        cal[band] = {
            "n": row["n"],
            "mean_confidence": round(mean_conf, 3) if mean_conf is not None else None,
            "accuracy": round(accuracy, 3) if accuracy is not None else None,
            "absolute_gap": round(abs(mean_conf - accuracy), 3)
            if mean_conf is not None else None,
        }
    tones = macro_f1(tone_pairs)
    return {
        "articles_with_reference_parties": represented_urls,
        "detection": {
            "true_positives": tp, "false_positives": fp,
            "false_negatives": fn,
            "precision": round(precision, 3) if precision is not None else None,
            "recall": round(recall, 3) if recall is not None else None,
        },
        "tones": {"n": len(tone_pairs), **tones,
                  "confusion": confusion(tone_pairs),
                  "declined_by_hyp": sum(1 for _, h in tone_pairs
                                          if h == DECLINED)},
        "calibration": cal,
        "evidence": {"missing": evidence_missing,
                     "unsupported": evidence_unsupported,
                     "unverifiable": evidence_unverifiable,
                     "grounding_method": "analyze_articles.party_tone_evidence_grounded"},
        "identity": {"unresolved_in_reference": unresolved_ref,
                     "unresolved_in_hypothesis": unresolved_hyp,
                     "wrong_canonical_links": wrong_links},
        "malformed_duplicates": {"reference": duplicate_ref,
                                 "hypothesis": duplicate_hyp},
        "no_party_sentiment_accuracy": (
            "detection, tone, calibration, evidence and identity remain separate")
    }


def party_release_gate_results(metrics: dict, completion: dict | None = None) -> dict:
    """Evaluate every release gate; missing evidence fails closed."""
    completion = completion or {}
    detection = metrics.get("detection") or {}
    tones = metrics.get("tones") or {}
    identity = metrics.get("identity") or {}
    evidence = metrics.get("evidence") or {}
    per_tone = tones.get("per_label") or {}
    checks = {
        "pair_precision": detection.get("precision"),
        "pair_recall": detection.get("recall"),
        "tone_macro_f1": tones.get("macro_f1"),
        "per_tone_recall": min(
            (v.get("recall", 0) for v in per_tone.values()), default=None),
        "wrong_canonical_links": identity.get("wrong_canonical_links"),
        "unsupported_evidence": (
            None if evidence.get("unverifiable") else
            (evidence.get("unsupported", 0) + evidence.get("missing", 0))),
        "valid_schema_before_retry": completion.get("before_retry"),
        "valid_schema_after_review": completion.get("after_review"),
    }
    detail = {}
    for name, threshold in PARTY_RELEASE_GATES.items():
        value = checks.get(name)
        minimum = name not in {"wrong_canonical_links", "unsupported_evidence"}
        passed = value is not None and (value >= threshold if minimum
                                        else value <= threshold)
        detail[name] = {"value": value,
                        "minimum" if minimum else "maximum": threshold,
                        "passed": passed}
    return {"passed": all(v["passed"] for v in detail.values()),
            "checks": detail}


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
    ap.add_argument("--ref-revision", default=None,
                    help="party-only reference overlay bound to the frozen draw")
    ap.add_argument("--hyp", required=True, help="the set being scored")
    ap.add_argument("--valid-schema-before-retry", type=float, default=None)
    ap.add_argument("--valid-schema-after-review", type=float, default=None)
    ap.add_argument("--require-party-gates", action="store_true",
                    help="exit 3 unless every party-tone release gate passes")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    ref = load_set(Path(args.ref))
    if args.ref_revision:
        try:
            ref = apply_reference_revision(ref, Path(args.ref_revision))
        except ValueError as exc:
            print(json.dumps({"error": str(exc)}))
            return 2
    hyp = load_set(Path(args.hyp))
    shared = sorted(set(ref) & set(hyp))
    if not shared:
        # ⚠️ Exit non-zero. Zero overlap produces a table of nulls that reads
        # like „nothing to report" rather than „these two sets are about
        # different articles".
        print(json.dumps({"error": "no_overlap", "ref": len(ref),
                          "hyp": len(hyp)}))
        return 2

    articles = source_articles(ref, hyp)
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
            "party_tones": score_party_tones(ref, hyp, articles),
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
    completion = {"before_retry": args.valid_schema_before_retry,
                  "after_review": args.valid_schema_after_review}
    result["party_tone_release_gates"] = party_release_gate_results(
        result["fields"]["party_tones"], completion)
    print(json.dumps(result, ensure_ascii=False,
                     indent=None if args.json else 1))
    return 3 if (args.require_party_gates and
                 not result["party_tone_release_gates"]["passed"]) else 0


if __name__ == "__main__":
    sys.exit(main())
