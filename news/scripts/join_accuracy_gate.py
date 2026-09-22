#!/usr/bin/env python3
"""Plan T2.3 — the auto-join accuracy gate, and the cluster-shape monitor
that must never become a target.

⚠️⚠️ THE GATE IS UNMET AND SAYS SO. It consumes `news/evals/
join_adjudications.json` — human labels over pairs drawn from a FROZEN
universe (T2.0) — and that file holds ZERO pairs: the public evaluation
surface has never received a submission and nobody has adjudicated a
pair. Every threshold below is therefore evaluated against n = 0 and
reported as unmet with the reason `no adjudicated pairs`, and the process
EXITS NON-ZERO under `--enforce`. This script builds the gate and the
arithmetic so that the day a person writes pairs the answer is computed
rather than argued; it does not fill the file, and a frontier model may
not fill it either.

What it computes, over the adjudicated TEST pairs only (development pairs,
straddling pairs, `unclear` labels, pairs from another manifest, unknown
stories and duplicates are excluded before anything is counted, and each
exclusion is counted):

- THE STRICT RULE (the auto-join candidate): pairwise precision and recall
  with the Wilson 95% lower bound and an EVENT-bootstrap interval
  (resampling the human's event ids, because pairs inside one event are
  dependent and a pair-level interval is too narrow). A pair against the
  article's OWN pipeline story is scored from the manifest — the pipeline
  joined it under the strict rule, so a `different` label there is a false
  positive of the live rule, not a nothing.
- CANDIDATE-RETRIEVAL RECALL under the UNION ranking (T2.1): the share of
  labelled same-event pairs retrieval surfaced at all. Labelled pairs
  OUTSIDE the retrieved set count against it — accepted pairs alone cannot
  measure recall.
- CLUSTER PURITY over the labelled events, reported for clusters with at
  least two labelled members (a one-member cluster is pure by construction).
- HARD-NEGATIVE and EXPLICIT-REJECT VIOLATIONS: one is a failed gate,
  whatever the precision. An explicit reject is a queue decision over a
  STORY pair, so the adjudicated (article, story) is mapped through the
  article's own story before it is looked up.
- NON-EVENT FALSE MATCHES, reported explicitly.
- ONE BAND PER REVIEW RELAXATION, as a PROMOTION CANDIDATE: the population
  it would actually auto-join is the pairs whose relaxation set is EXACTLY
  that band (`sole`); the wider `any` population is reported beside it.
  A band is promotable only when its sole population clears the same
  support, precision and violation floors AND its recall gain over the
  strict rule is non-negative globally and on the local-news stratum —
  „recall improves over the baseline without loss on local news", where the
  baseline is the strict rule measured on the SAME labelled pairs.

The auto-join gate (plan T2.3): ≥ 300 accepted (`same_event`) test pairs
spanning ≥ 50 events, observed precision ≥ 0.99, Wilson 95% lower bound
≥ 0.97, zero hard-negative or explicit-reject violations. A band with
insufficient support is `promotable: false` and stays review-only.

⚠️ THE TWO IN-REPO PRIORS ARE FOLDED IN, NOT CLEARED. The strict rule's
audited record is 85 of 90 proposals accepted, 0 refused (2026-09-02);
at n = 90 the Wilson lower bound of 85/90 is 0.876, which does not reach
0.97, so that record does NOT clear the gate the plan proposes — this
report computes and prints that rather than letting the number read as if
it does. And the committed gold set (`news/data/gold/gold_set.json`) is
READ, not restated: it under-filled its own person cell, so the support
floors here may not be attainable from the existing sampler.

⚠️ THE SHAPE MONITOR NEVER REQUIRES A LOWER SINGLETON SHARE OR A LARGER
MAXIMUM CLUSTER. Merging unrelated reports satisfies both. It reports the
singleton share, the multi-outlet comparison share, the largest cluster,
the review backlog, and first-seen versus published lag (from the
build-side `first_seen` field, which the public payloads omit — so this is
a build-side report, never a reader-facing one). Nothing in it is a
threshold.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

import analyze_articles as aa  # noqa: E402
import freeze_event_universe as feu  # noqa: E402
from home_event_dedupe import RELAXATION_KINDS  # noqa: E402

REPORT_DIR = ROOT / "news" / "evals"
ADJUDICATIONS_PATH = REPORT_DIR / "join_adjudications.json"
GOLD_SET_PATH = ROOT / "news" / "data" / "gold" / "gold_set.json"
LABELS = ("same_event", "different", "unclear")

# The auto-join gate, as the plan states it.
GATE = {
    "min_accepted_test_pairs": 300,
    "min_events": 50,
    "min_precision": 0.99,
    "min_precision_lower_bound": 0.97,
    "max_violations": 0,
}
PRIOR_2026_09_02 = {"accepted": 85, "proposals": 90, "refused": 0}
BOOTSTRAP_ROUNDS = 1000
BOOTSTRAP_SEED = "naiasno-join-gate-v1"
BOOTSTRAP_MIN_EFFECTIVE = 0.95


# ------------------------------------------------------------- statistics ---

def wilson_lower(successes: int, n: int, z: float = 1.959964) -> float | None:
    """Wilson score interval, lower bound, at 95%."""
    if n <= 0:
        return None
    p = successes / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (centre - margin) / denom)


def precision_of(tp: int, fp: int) -> dict:
    return {"tp": tp, "fp": fp, "precision": (tp / (tp + fp)) if tp + fp else None,
            "precision_lower_95": wilson_lower(tp, tp + fp)}


def recall_of(pairs: list, predicate) -> float | None:
    accepted = [p for p in pairs if p["label"] == "same_event"]
    return (sum(1 for p in accepted if predicate(p)) / len(accepted)) if accepted else None


def event_bootstrap(pairs: list, predicate, rounds: int = BOOTSTRAP_ROUNDS,
                    seed: str = BOOTSTRAP_SEED) -> dict | None:
    """Precision resampled over EVENTS (the article's event id), because the
    pairs inside one event are not independent. Reports the EFFECTIVE
    rounds — a resample with no predicted join is dropped, and an interval
    over too few survivors is withheld rather than biased upward."""
    by_event: dict = defaultdict(list)
    for p in pairs:
        by_event[p["event_id"]].append(p)
    events = sorted(by_event)
    if not events:
        return None
    rng = random.Random(hashlib.sha256(seed.encode()).hexdigest())
    values = []
    for _ in range(rounds):
        sample = [by_event[e] for e in (rng.choice(events) for _ in events)]
        tp = fp = 0
        for group in sample:
            for p in group:
                if predicate(p):
                    tp += p["label"] == "same_event"
                    fp += p["label"] == "different"
        if tp + fp:
            values.append(tp / (tp + fp))
    out = {"events": len(events), "rounds": rounds, "effective_rounds": len(values)}
    if len(values) < BOOTSTRAP_MIN_EFFECTIVE * rounds:
        return {**out, "precision_p2_5": None, "precision_p97_5": None,
                "reason": "too few resamples held a predicted join — interval withheld"}
    values.sort()
    return {**out, "precision_p2_5": values[int(0.025 * (len(values) - 1))],
            "precision_p97_5": values[int(0.975 * (len(values) - 1))]}


# ----------------------------------------------------------- adjudication ---

def load_adjudications(path: Path) -> dict:
    """Validated. A malformed label file is a refusal, not a zero."""
    if not path.exists():
        return {"version": 1, "pairs": []}
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or doc.get("version") != 1 or not isinstance(doc.get("pairs"), list):
        raise ValueError(f"{path}: expected {{version: 1, pairs: []}}")
    seen = set()
    for i, p in enumerate(doc["pairs"]):
        for key in ("article_id", "story_id", "manifest_sha256", "label", "by", "on", "event_id"):
            if not p.get(key):
                raise ValueError(f"{path}: pair #{i} lacks {key}")
        if p["label"] not in LABELS:
            raise ValueError(f"{path}: pair #{i} label must be one of {LABELS}")
        if not isinstance(p.get("hard_negative", False), bool):
            raise ValueError(f"{path}: pair #{i} hard_negative must be a boolean")
        if p.get("hard_negative") and p["label"] != "different":
            raise ValueError(f"{path}: pair #{i} is hard_negative but not labelled different")
        key = (p["article_id"], p["story_id"], p["manifest_sha256"])
        if key in seen:
            raise ValueError(f"{path}: pair #{i} duplicates an earlier adjudication of {key[:2]}")
        seen.add(key)
    return doc


def is_violation(p: dict) -> bool:
    return p["label"] == "different" and (bool(p.get("hard_negative")) or p["explicit_reject"])


def join_pairs(manifest: dict, adjudications: list, rejected_story_pairs: set,
               review_pairs: dict, union_retrieved: set | None) -> tuple:
    """Adjudicated TEST pairs, joined to what the frozen universe and the
    counterfactual know about them. Returns (usable pairs, exclusions)."""
    sha = manifest.get("_sha256")
    articles = manifest.get("articles") or []
    split_of = {a["id"]: a["split"] for a in articles}
    own_story = {a["id"]: (a.get("analysis") or {}).get("story_id") for a in articles}
    own_action = {a["id"]: (a.get("analysis") or {}).get("story_action") for a in articles}
    story_split = feu.story_split_of(articles)
    stamped = {(p["article_id"], p["story_id"]): p.get("adjudicable_split")
               for p in manifest.get("candidate_pairs") or []}
    retrieved = union_retrieved if union_retrieved is not None else set(stamped)
    local_ids = {a["id"] for a in articles if "local_news" in (a.get("strata") or [])}
    usable, excluded = [], Counter()
    for p in adjudications:
        if p["manifest_sha256"] != sha:
            excluded["other_manifest"] += 1
            continue
        if p["article_id"] not in split_of:
            excluded["unknown_article"] += 1
            continue
        if split_of[p["article_id"]] != "test":
            excluded["not_test"] += 1
            continue
        if p["story_id"] not in story_split:
            excluded["unknown_story"] += 1
            continue
        key = (p["article_id"], p["story_id"])
        straddling = feu.straddles("test", story_split[p["story_id"]])
        if key in stamped and (stamped[key] == "excluded") != straddling:
            raise ValueError(f"the manifest stamps {key} adjudicable_split={stamped[key]!r} but the "
                             f"straddle rule says {straddling} — the two rules drifted")
        if straddling:
            excluded["straddles"] += 1
            continue
        if p["label"] == "unclear":
            excluded["unclear"] += 1
            continue
        own = own_story.get(p["article_id"])
        is_own = own == p["story_id"]
        rv = review_pairs.get(key) or {}
        if is_own:
            # The pipeline put the article HERE, under the strict rule
            # (every join in the frozen window is `same_event_evidence`).
            strict = own_action.get(p["article_id"]) == "same_story"
            basis = "own_story"
        else:
            strict = bool(rv.get("strict_would_join"))
            basis = "counterfactual"
        usable.append({
            **p,
            "retrieved": is_own or key in retrieved,
            "strict_would_join": strict,
            "strict_basis": basis,
            "relaxations": rv.get("relaxations") or [],
            "review_proposes": bool(rv),
            "explicit_reject": bool(own) and frozenset((own, p["story_id"])) in rejected_story_pairs,
            "local_news": p["article_id"] in local_ids,
        })
    return usable, dict(excluded)


def _local_precision(pairs: list, joins) -> float | None:
    local = [p for p in pairs if p["local_news"] and joins(p)]
    tp = sum(1 for p in local if p["label"] == "same_event")
    fp = sum(1 for p in local if p["label"] == "different")
    return (tp / (tp + fp)) if tp + fp else None


def _band_metrics(pairs: list, joins, strict_recall: float | None,
                  strict_local_recall: float | None, strict_local_precision: float | None) -> dict:
    """A band is scored as strict ∪ band — the rule a promotion would run —
    so its recall can never fall below the strict rule's by construction;
    what CAN fall on the local-news stratum is precision (a relaxation that
    joins two councils), which is the loss „without loss on local news"
    has to mean for a superset rule. Both are checked; the recall check is
    the tautology kept as a guard against a future non-superset band."""
    tp = sum(1 for p in pairs if joins(p) and p["label"] == "same_event")
    fp = sum(1 for p in pairs if joins(p) and p["label"] == "different")
    pr = precision_of(tp, fp)
    events = len({p["event_id"] for p in pairs if joins(p) and p["label"] == "same_event"})
    violations = sum(1 for p in pairs if joins(p) and is_violation(p))
    recall = recall_of(pairs, joins)
    local_recall = recall_of([p for p in pairs if p["local_news"]], joins)
    local_precision = _local_precision(pairs, joins)
    reasons = []
    if tp < GATE["min_accepted_test_pairs"]:
        reasons.append(f"accepted test pairs {tp} < {GATE['min_accepted_test_pairs']}")
    if events < GATE["min_events"]:
        reasons.append(f"events {events} < {GATE['min_events']}")
    if pr["precision"] is None or pr["precision"] < GATE["min_precision"]:
        reasons.append(f"precision {pr['precision']} < {GATE['min_precision']}")
    if (pr["precision_lower_95"] or 0) < GATE["min_precision_lower_bound"]:
        reasons.append(f"precision lower bound {pr['precision_lower_95']} < {GATE['min_precision_lower_bound']}")
    if violations > GATE["max_violations"]:
        reasons.append(f"{violations} hard-negative / explicit-reject violations")
    if strict_recall is not None and (recall is None or recall < strict_recall):
        reasons.append(f"recall {recall} below the strict rule's {strict_recall}")
    if strict_local_recall is not None and (local_recall is None or local_recall < strict_local_recall):
        reasons.append(f"local-news recall {local_recall} below the strict rule's {strict_local_recall}")
    if strict_local_precision is not None and local_precision is not None and local_precision < strict_local_precision:
        reasons.append(f"local-news precision {local_precision} below the strict rule's {strict_local_precision}")
    return {**pr, "events": events, "violations": violations, "recall": recall,
            "local_news_recall": local_recall, "local_news_precision": local_precision,
            "promotable": not reasons, "reasons": reasons or None}


def evaluate_gate(pairs: list) -> dict:
    """The gate arithmetic over usable adjudicated test pairs."""
    accepted = [p for p in pairs if p["label"] == "same_event"]
    events = {p["event_id"] for p in accepted}
    strict = lambda p: p["strict_would_join"]  # noqa: E731
    tp = sum(1 for p in pairs if strict(p) and p["label"] == "same_event")
    fp = sum(1 for p in pairs if strict(p) and p["label"] == "different")
    strict_pr = precision_of(tp, fp)
    strict_recall = recall_of(pairs, strict)
    local = [p for p in pairs if p["local_news"]]
    strict_local_recall = recall_of(local, strict)
    strict_local_precision = _local_precision(pairs, strict)
    violations = [p for p in pairs if strict(p) and is_violation(p)]
    non_event_false = [p for p in pairs if strict(p) and p["label"] == "different"]
    retrieval_recall = (sum(1 for p in accepted if p["retrieved"]) / len(accepted)) if accepted else None
    never_proposed = sum(1 for p in accepted if not p["review_proposes"] and p["strict_basis"] != "own_story")
    bands = {}
    for kind in RELAXATION_KINDS:
        sole = lambda p, k=kind: strict(p) or p["relaxations"] == [k]  # noqa: E731
        any_ = lambda p, k=kind: strict(p) or k in p["relaxations"]  # noqa: E731
        bands[kind] = {
            "sole": _band_metrics(pairs, sole, strict_recall, strict_local_recall, strict_local_precision),
            "any": _band_metrics(pairs, any_, strict_recall, strict_local_recall, strict_local_precision),
        }
        bands[kind]["promotable"] = bands[kind]["sole"]["promotable"]
        bands[kind]["reason"] = (None if bands[kind]["promotable"]
                                 else "; ".join(bands[kind]["sole"]["reasons"] or ["insufficient support — review-only"]))
    reasons = []
    if not pairs:
        reasons.append("no adjudicated pairs")
    if len(accepted) < GATE["min_accepted_test_pairs"]:
        reasons.append(f"accepted test pairs {len(accepted)} < {GATE['min_accepted_test_pairs']}")
    if len(events) < GATE["min_events"]:
        reasons.append(f"events {len(events)} < {GATE['min_events']}")
    if strict_pr["precision"] is None or strict_pr["precision"] < GATE["min_precision"]:
        reasons.append(f"precision {strict_pr['precision']} < {GATE['min_precision']}")
    if (strict_pr["precision_lower_95"] or 0) < GATE["min_precision_lower_bound"]:
        reasons.append(f"precision lower bound {strict_pr['precision_lower_95']} < {GATE['min_precision_lower_bound']}")
    if len(violations) > GATE["max_violations"]:
        reasons.append(f"{len(violations)} hard-negative / explicit-reject violations")
    return {
        "thresholds": GATE,
        "usable_test_pairs": len(pairs),
        "accepted_test_pairs": len(accepted),
        "events": len(events),
        "strict_rule": {**strict_pr, "recall": strict_recall,
                        "basis_counts": dict(Counter(p["strict_basis"] for p in pairs)),
                        "event_bootstrap": event_bootstrap(pairs, strict)},
        "candidate_retrieval_recall": retrieval_recall,
        "same_event_pairs_the_review_rule_never_proposed": never_proposed,
        "cluster_purity": cluster_purity(pairs),
        "local_news": {"accepted_pairs": sum(1 for p in local if p["label"] == "same_event"),
                       "recall": strict_local_recall, "precision": strict_local_precision},
        "violations": [{"article_id": p["article_id"], "story_id": p["story_id"],
                        "hard_negative": bool(p.get("hard_negative")), "explicit_reject": p["explicit_reject"]}
                       for p in violations],
        "non_event_false_matches": len(non_event_false),
        "bands": bands,
        "met": not reasons,
        "reasons": reasons,
    }


def cluster_purity(pairs: list) -> dict | None:
    """Per predicted cluster (the story the strict rule joins the article
    to), the share of labelled members whose ARTICLE event is the cluster's
    majority event — over clusters with ≥ 2 labelled members, because a
    one-member cluster is pure by construction and a purity of 1.0 over
    singletons would read as a finding."""
    clusters: dict = defaultdict(list)
    for p in pairs:
        if p["strict_would_join"]:
            clusters[p["story_id"]].append(p["event_id"])
    if not clusters:
        return None
    multi = {sid: ev for sid, ev in clusters.items() if len(ev) >= 2}
    pure = sum(Counter(ev).most_common(1)[0][1] for ev in multi.values())
    total = sum(len(ev) for ev in multi.values())
    return {"clusters": len(clusters), "clusters_with_2plus_labelled": len(multi),
            "labelled_members_in_those": total, "purity": (pure / total) if total else None}


# ---------------------------------------------------------- shape monitor ---

def cluster_shape(stories: list, queue: dict | None, articles_by_url: dict | None = None) -> dict:
    """Report, never require. Singleton share, multi-outlet comparison
    share, the largest cluster, the review backlog, and first-seen vs
    published lag from the build-side field the public payloads omit."""
    stories = [s for s in stories if isinstance(s, dict)]
    n = len(stories)
    sizes = [len(s.get("members") or []) for s in stories]
    outlets = [len({m.get("domain") for m in s.get("members") or [] if m.get("domain")}) for s in stories]
    lags = []
    for s in stories:
        for m in s.get("members") or []:
            # The member carries the build-side `first_seen` itself
            # (stories.json is the build's file; the public payload strips
            # it); the manifest is the fallback.
            art = m if m.get("first_seen") else (articles_by_url or {}).get(m.get("url"))
            if not art:
                continue
            try:
                pub = datetime.fromisoformat(art.get("published") or "")
                seen = datetime.fromisoformat(art.get("first_seen") or "")
                if pub.tzinfo and seen.tzinfo:
                    lags.append((seen - pub).total_seconds() / 3600)
            except ValueError:
                continue
    lags.sort()
    pending = sum(1 for i in (queue or {}).get("items") or []
                  if isinstance(i, dict) and i.get("active") and i.get("status") == "pending")
    return {
        "stories": n,
        "singleton_share": (sum(1 for z in sizes if z == 1) / n) if n else None,
        "multi_outlet_comparison_share": (sum(1 for o in outlets if o >= 2) / n) if n else None,
        "max_cluster_size": max(sizes, default=0),
        "largest_stories": sorted(({"id": s.get("id"), "members": len(s.get("members") or []),
                                    "outlets": len({m.get("domain") for m in s.get("members") or []})}
                                   for s in stories), key=lambda r: -r["members"])[:5],
        "review_backlog_pending": pending,
        "first_seen_minus_published_hours": {
            "members_measured": len(lags),
            "median": lags[len(lags) // 2] if lags else None,
            "p90": lags[int(0.9 * (len(lags) - 1))] if lags else None,
            "backfill_share_over_24h": (sum(1 for l in lags if l > 24) / len(lags)) if lags else None,
        },
        "basis": "build-side; first_seen is omitted from the public payloads. No figure here is a target: a lower singleton share or a larger maximum is also what merging unrelated reports produces.",
    }


# ------------------------------------------------------------------ main ---

def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def latest_manifest() -> Path | None:
    stamps = sorted((ROOT / "news" / "data" / "analysis" / "_universe").glob("*/universe.json"))
    return stamps[-1] if stamps else None


def gold_shortfall(path: Path = GOLD_SET_PATH) -> dict:
    try:
        g = read_json(path)
        return {"requested_size": g.get("requested_size"), "actual_size": g.get("actual_size"),
                "shortfall": g.get("shortfall"),
                "note": "the existing gold sampler under-filled its own cells; the support floors here may not be attainable from it — budget new annotation"}
    except (OSError, ValueError):
        return {"note": f"{path} unreadable — the gold set's shortfall could not be read"}


def rejected_story_pairs_of(queue: dict | None) -> set:
    out = set()
    for item in (queue or {}).get("items") or []:
        if isinstance(item, dict) and item.get("status") == "rejected":
            left, right = (item.get("keeper") or {}).get("id"), (item.get("candidate") or {}).get("id")
            if left and right:
                out.add(frozenset((left, right)))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, default=None)
    ap.add_argument("--adjudications", type=Path, default=ADJUDICATIONS_PATH)
    ap.add_argument("--join-report", type=Path, default=None,
                    help="a join_channels_*.json for the same manifest (default: newest matching by generated_at)")
    ap.add_argument("--stories", type=Path, default=ROOT / "news" / "app-data" / "stories.json")
    ap.add_argument("--queue", type=Path, default=ROOT / "news" / "review" / "story_merge_queue.json")
    ap.add_argument("--enforce", action="store_true", help="exit 1 unless the gate is met")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    manifest_path = args.manifest or latest_manifest()
    if manifest_path is None or not manifest_path.exists():
        return aa.emit(1, error="no_frozen_universe", message="run news:universe:freeze first")
    try:
        manifest = read_json(manifest_path)
        manifest["_sha256"] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        adjudications = load_adjudications(args.adjudications)
    except (OSError, ValueError) as exc:
        return aa.emit(1, error="gate_refused", message=str(exc))
    join_report = args.join_report
    if join_report is None:
        matches = list(REPORT_DIR.glob(f"join_channels_*_{manifest['_sha256'][:8]}.json"))
        matches.sort(key=lambda p: (read_json(p).get("generated_at") or "", p.name))
        join_report = matches[-1] if matches else None
    review_pairs: dict = {}
    union_retrieved = None
    host_share_old = None
    if join_report and join_report.exists():
        jr = read_json(join_report)
        for p in jr.get("review_pairs") or []:
            review_pairs[(p["article_id"], p["story_id"])] = p
        if jr.get("union_candidates") is not None:
            union_retrieved = {tuple(k) for k in jr["union_candidates"]}
        host_share_old = ((jr.get("retrieval_of_the_known_host") or {}).get("old") or {}).get("share")
    queue = read_json(args.queue) if args.queue.exists() else None
    try:
        usable, excluded = join_pairs(manifest, adjudications["pairs"], rejected_story_pairs_of(queue),
                                      review_pairs, union_retrieved)
    except ValueError as exc:
        return aa.emit(1, error="gate_refused", message=str(exc))
    gate = evaluate_gate(usable)
    stories = (read_json(args.stories).get("stories") or []) if args.stories.exists() else []
    articles_by_url = {a["url"]: {"published": a.get("published"), "first_seen": a.get("first_seen")}
                       for a in manifest.get("articles") or []}
    prior_lb = wilson_lower(PRIOR_2026_09_02["accepted"], PRIOR_2026_09_02["proposals"])
    status = ("UNMET — 0 adjudicated pairs; nothing here is a measured accuracy" if not usable
              else ("MET" if gate["met"] else "UNMET"))
    report = {
        "version": 2,
        "generated_at": aa.now_iso(),
        "met": gate["met"],
        "n_usable": len(usable),
        "status": status,
        "basis": {
            "strict_rule": "own-story pairs from the manifest's pipeline join (story_action == same_story); other pairs from the T2.1 counterfactual's strict_would_join over the union ranking",
            "candidate_retrieval_recall": "union-v1 candidates persisted by the counterfactual" if union_retrieved is not None else "the manifest's composite-v0 candidate pairs (no union list in the join report)",
            "recall_baseline": "the strict rule measured on the same adjudicated pairs — a band's recall gain is judged against it; the old ranking's host-retrieval share is a PRIOR, not a baseline",
            "labels": "human adjudications only; 0 on the committed file",
        },
        "manifest": {"path": str(manifest_path.relative_to(ROOT)) if manifest_path.is_relative_to(ROOT) else str(manifest_path),
                     "sha256": manifest["_sha256"], "window": manifest.get("window")},
        "join_report": str(join_report.relative_to(ROOT)) if join_report and join_report.is_relative_to(ROOT) else (str(join_report) if join_report else None),
        "adjudications": {"path": str(args.adjudications.relative_to(ROOT)) if args.adjudications.is_relative_to(ROOT) else str(args.adjudications),
                          "total": len(adjudications["pairs"]), "excluded": excluded, "usable_test": len(usable)},
        "gate": gate,
        "priors": {
            "strict_rule_2026_09_02": {**PRIOR_2026_09_02, "precision": PRIOR_2026_09_02["accepted"] / PRIOR_2026_09_02["proposals"],
                                       "precision_lower_95": prior_lb,
                                       "clears_gate": prior_lb is not None and prior_lb >= GATE["min_precision_lower_bound"],
                                       "note": "an audited record, not an adjudicated held-out set; at n = 90 its lower bound cannot reach 0.97"},
            "host_retrieval_share_old": {"share": host_share_old,
                                         "note": "share of the pipeline's own joins whose host the retired ranking retrieved (T2.1) — a retrieval share over live joins, NOT a pairwise recall"},
            "gold_set": gold_shortfall(),
        },
        "cluster_shape": cluster_shape(stories, queue, articles_by_url),
    }
    out = REPORT_DIR / f"join_accuracy_{(manifest.get('window') or {}).get('until')}_{manifest['_sha256'][:8]}.json"
    if out.exists() and not args.force:
        return aa.emit(1, error="report_exists", message=f"{out} exists — pass --force")
    aa.write_json_atomic(str(out), report)
    code = 0 if (gate["met"] or not args.enforce) else 1
    return aa.emit(code, ok=True, met=gate["met"], n_usable=len(usable), report=str(out), status=status,
                   gate={k: gate[k] for k in ("met", "reasons", "accepted_test_pairs", "events")},
                   priors=report["priors"]["strict_rule_2026_09_02"],
                   cluster_shape={k: v for k, v in report["cluster_shape"].items() if k != "largest_stories"})


if __name__ == "__main__":
    sys.exit(main())
