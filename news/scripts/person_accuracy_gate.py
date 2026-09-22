#!/usr/bin/env python3
"""Plan T4.5 — the person-treatment release gate.

⚠️⚠️ THE GATE IS UNMET AND SAYS SO. It consumes
`news/evals/person_adjudications.json` — human labels over (article, person)
pairs — and that file holds ZERO pairs: the public evaluation surface has
never received a submission and nobody has adjudicated a pair. Every
threshold below is therefore evaluated against n = 0 and reported as unmet
with the reason `no adjudicated pairs`, and the process EXITS NON-ZERO under
`--enforce`. This script builds the gate and the arithmetic so that the day a
person writes pairs the answer is COMPUTED rather than argued; it does not
fill the file, and a frontier model may not fill it either.

⚠️ THE EXISTING GOLD SET CANNOT SUPPLY THIS, and the plan says so in
advance: `news/data/gold/gold_set.json` reports
`shortfall: {person_linked: {wanted: 40, got: 30}}` — it could not fill a
40-article person cell under its own selection method. 200 pairs with ≥30 per
tone is NEW annotation. `sample_person_pairs.py` draws the candidates; it
writes no labels.

What it computes, over the adjudicated TEST pairs only (development pairs,
`unclear` labels, stale pairs whose rubric or identity version has moved, and
duplicates are excluded before anything is counted, and each exclusion is
counted):

- PAIR DETECTION — precision and recall of „this article carries an
  assessable treatment of this person", with the Wilson 95% lower bound and
  an ARTICLE-bootstrap interval (resampling articles, because pairs inside
  one article are dependent and a pair-level interval is too narrow).
- TONE — macro-F1 across the four tones and the per-tone recall, the minimum
  of which is the floor. ⚠️ A hypothesis that DECLINED to answer is scored as
  wrong, not dropped: the same rule `score_analyses.score_axis` documents,
  because dropping refusals makes silence the highest-scoring strategy.
  `not_assessed` and `insufficient_text` are real answers on BOTH sides and
  are scored as themselves — read from the pipeline's assessment STATUS,
  because the producer is validated never to emit a tone beside a
  non-assessed status, so reading `tone` alone scored a correctly abstaining
  pipeline at 0.0 recall on ~half the corpus.
- WRONG CANONICAL TARGETS — a tone attached to the wrong person. One fails
  the gate outright, whatever the precision.
- UNSUPPORTED EVIDENCE — a published directional tone whose cited spans the
  human says do not support it. One fails the gate.
- SUPPORT — ≥200 test pairs and ≥30 per tone, plus coverage of all five
  strata. ⚠️ Support is part of the gate, not a footnote: without it a
  three-pair sample at 1.000 precision „passes", which is the vacuous pass
  the plan forbids. Insufficient support is REVIEW-ONLY, never a pass.
- INTER-ANNOTATOR AGREEMENT — Cohen's κ over the pairs two annotators both
  labelled, and it is PART OF THE SUPPORT GATE (≥40 doubly-annotated pairs,
  κ ≥ 0.60): a gate computed from labels nobody checked against another
  human is a measurement of one person. A third `adjudicated: true` row
  resolves a disagreement, which is what the contract promises — without it
  the answer would be whichever row appears first in file order.
- RESOLVED-TARGET COVERAGE — the share of adjudicated pairs whose person the
  pipeline resolved at all, so „accurate on what it answered" cannot read as
  „accurate".
- PREVALENCE vs HARD CASES, reported SEPARATELY and never pooled.
- DISTRIBUTION SHIFT — the neutral and unfavourable shares before and after,
  from the pipeline's own published corpus, so a change that makes the gate
  easier by relabelling everything neutral is visible.

⚠️ THE ZEROS ARE RELEASE BLOCKERS ON THE SAMPLE, NOT CLAIMS OF ZERO
POPULATION ERROR. „0 wrong canonical targets in 200 adjudicated pairs" is
what the sample can support; the 95% upper bound on the true rate at n = 200
with 0 observed is **1.88%** on the Wilson interval this report prints (the
rule-of-three approximation would say ~1.5%; the tighter number is the one
that under-states the uncertainty, so the report prints Wilson), and it is
printed so the zero cannot be quoted as perfection.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from score_analyses import (  # noqa: E402
    PERSON_RELEASE_GATES, PERSON_STRATA, PERSON_SUPPORT_FLOORS, PERSON_TONES,
    macro_f1,
)

ADJUDICATIONS = HERE.parent / "evals" / "person_adjudications.json"
APP_DATA = HERE.parent / "app-data"
# T4.3's rubric. A pair judged under another one is stale by definition.
CURRENT_RUBRIC = "person-treatment-v1"


def published_identity_versions(app_data: Path) -> dict:
    """The identity version each active person is published under, read from
    the corpus rather than a flag so the check cannot be omitted."""
    index = app_data / "news_persons.json"
    if not index.exists():
        return {}
    try:
        payload = json.loads(index.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {p.get("news_person_id"): p.get("identity_version")
            for p in (payload.get("persons") or [])
            if p.get("news_person_id") and p.get("identity_version")}

# A hypothesis that answered nothing is scored against a sentinel that can
# never equal a real label — never dropped.
DECLINED = "__declined__"
# ⚠️ `not_assessed` and `insufficient_text` are DIFFERENT pipeline answers —
# „read it all, found no framing of this person" vs „only a prefix was read"
# — and T4.4's accounting counts them apart. Collapsing them into one
# sentinel makes the gate unable to tell them apart AND unmeetable: the
# producer is validated never to emit a tone beside a non-assessed status,
# so a correctly abstaining pipeline scored 0.0 recall on every pair the
# human labelled `not_assessed`, which is ~50% of the live corpus.
PIPELINE_STATUS_ANSWERS = ("not_assessed", "insufficient_text")
SCORED_TONES = PERSON_TONES + PIPELINE_STATUS_ANSWERS


def wilson(successes: int, total: int, z: float = 1.96):
    """(lower, upper) of the Wilson interval; (None, None) at n = 0."""
    if total <= 0:
        return (None, None)
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = (z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
            / denom)
    return (round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4))


def bootstrap_ci(units: list, statistic, *, rounds: int = 2000, seed: int = 7):
    """Percentile interval resampling whole ARTICLES, not pairs.

    ⚠️ IT REPORTS ITS CONDITIONS. A resample in which the statistic is
    undefined (no positives drawn) is discarded, so the percentile is taken
    over a CONDITIONED set — „the interval given the statistic was defined" —
    which narrows it in the direction that flatters the gate. The discarded
    count, the rounds and the seed ride in the result, and when most rounds
    were undefined it returns no interval at all rather than a flattering
    one."""
    base = {"rounds": rounds, "seed": seed, "undefined_rounds": rounds,
            "low": None, "high": None}
    if len(units) < 2:
        return {**base, "why": "fewer than two articles"}
    rng = random.Random(seed)
    draws = []
    for _ in range(rounds):
        sample = [units[rng.randrange(len(units))] for _ in units]
        value = statistic([row for unit in sample for row in unit])
        if value is not None:
            draws.append(value)
    base["undefined_rounds"] = rounds - len(draws)
    if len(draws) < rounds * 0.5:
        return {**base,
                "why": "the statistic was undefined in most resamples"}
    draws.sort()
    return {**base,
            "low": round(draws[int(0.025 * len(draws))], 4),
            "high": round(draws[min(len(draws) - 1, int(0.975 * len(draws)))], 4)}


def cohen_kappa(pairs) -> dict:
    """Agreement between two annotators over the labels they both gave."""
    if not pairs:
        return {"n": 0, "kappa": None, "observed_agreement": None}
    n = len(pairs)
    observed = sum(1 for a, b in pairs if a == b) / n
    a_counts = Counter(a for a, _ in pairs)
    b_counts = Counter(b for _, b in pairs)
    expected = sum(a_counts[k] * b_counts[k] for k in set(a_counts) | set(b_counts)) / (n * n)
    kappa = None if expected >= 1 else round((observed - expected) / (1 - expected), 4)
    return {"n": n, "kappa": kappa, "observed_agreement": round(observed, 4)}


def load(path: Path) -> dict:
    if not path.exists():
        return {"version": 0, "pairs": [], "missing_file": str(path)}
    return json.loads(path.read_text(encoding="utf-8"))


def pair_key(row: dict):
    """⚠️ THE SURFACE IS PART OF THE IDENTITY. For an UNRESOLVED mention
    `news_person_id` is None, so a key without the surface makes every
    unresolved person in one article the same pair — measured on the real
    250-candidate draw, 233 distinct keys, i.e. 17 candidates (6.8%) silently
    dropped, concentrated in exactly the population a recall floor is about,
    and fed to Cohen's κ as cross-person „agreement"."""
    return (row.get("article_id"), row.get("surface"),
            row.get("news_person_id"),
            row.get("rubric_version"), row.get("identity_version"))


def partition(rows: list, *, rubric_version: str | None,
              identity_versions: dict | None) -> dict:
    """Split the file into what is scorable and what is not, counting each
    exclusion rather than dropping it silently."""
    excluded = Counter()
    scorable, agreement_rows = [], defaultdict(list)
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            excluded["malformed"] += 1
            continue
        if row.get("split") != "test":
            excluded["development"] += 1
            continue
        tone = row.get("tone")
        if tone == "unclear":
            excluded["unclear"] += 1
            continue
        if tone not in SCORED_TONES:
            excluded["unknown_label"] += 1
            continue
        if rubric_version and row.get("rubric_version") != rubric_version:
            # ⚠️ A correction INVALIDATES a pair; it never transfers a label
            # to a text judged under a different rubric.
            excluded["stale_rubric"] += 1
            continue
        if (identity_versions
                and row.get("news_person_id") in identity_versions
                and row.get("identity_version")
                != identity_versions[row["news_person_id"]]):
            excluded["stale_identity"] += 1
            continue
        # ⚠️ AN UNADJUDICATED BLOCKER FIELD IS NOT A CLEAN ANSWER. Both
        # release blockers are counted as „is it True" / „is it False", so a
        # None — which is exactly what the sampler emits — would read as „not
        # wrong" and „supported", and 200 pairs whose blockers nobody looked
        # at would report MET. Excluding them makes the support floor the
        # backstop: the sample drops below 200 and becomes review-only.
        missing = [name for name in
                   ("human_assessable", "evidence_supports",
                    "wrong_canonical_target")
                   if row.get(name) is None]
        if missing:
            excluded[f"unlabelled_{missing[0]}"] += 1
            continue
        key = pair_key(row)
        agreement_rows[key].append(row)
        if key in seen:
            # A second annotator is agreement data, not a second pair; the
            # SAME annotator twice is a duplicate, and both are counted.
            if any(prior.get("annotator") == row.get("annotator")
                   for prior in agreement_rows[key][:-1]):
                excluded["duplicate_pair"] += 1
            continue
        seen.add(key)
        scorable.append(row)
    # ⚠️ AN ADJUDICATING ROW WINS, which is what the contract promises: „a
    # disagreement is resolved by a third `adjudicated: true` row rather than
    # by averaging". Without this the answer is whichever row appears FIRST
    # IN FILE ORDER, and the documented mechanism does nothing.
    by_key_index = {pair_key(row): i for i, row in enumerate(scorable)}
    for key, rows_for_key in agreement_rows.items():
        verdict = next((r for r in rows_for_key if r.get("adjudicated")), None)
        if verdict is not None and key in by_key_index:
            scorable[by_key_index[key]] = verdict
    return {"scorable": scorable, "excluded": dict(excluded),
            "by_key": agreement_rows}


def detection(rows: list) -> dict:
    """„Did the pipeline carry an assessable treatment of this person?\""""
    tp = sum(1 for r in rows if r.get("human_assessable") and r.get("pipeline_assessed"))
    fp = sum(1 for r in rows if not r.get("human_assessable") and r.get("pipeline_assessed"))
    fn = sum(1 for r in rows if r.get("human_assessable") and not r.get("pipeline_assessed"))
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    by_article = defaultdict(list)
    for r in rows:
        by_article[r.get("article_id")].append(r)
    units = list(by_article.values())

    def prec(sample):
        t = sum(1 for r in sample if r.get("human_assessable") and r.get("pipeline_assessed"))
        f = sum(1 for r in sample if not r.get("human_assessable") and r.get("pipeline_assessed"))
        return t / (t + f) if (t + f) else None

    def rec(sample):
        t = sum(1 for r in sample if r.get("human_assessable") and r.get("pipeline_assessed"))
        f = sum(1 for r in sample if r.get("human_assessable") and not r.get("pipeline_assessed"))
        return t / (t + f) if (t + f) else None

    return {
        "tp": tp, "fp": fp, "fn": fn,
        "articles": len(units),
        "precision": None if precision is None else round(precision, 4),
        "recall": None if recall is None else round(recall, 4),
        "precision_wilson95": wilson(tp, tp + fp),
        "recall_wilson95": wilson(tp, tp + fn),
        "precision_bootstrap95": bootstrap_ci(units, prec),
        "recall_bootstrap95": bootstrap_ci(units, rec),
    }


def pipeline_answer(row: dict) -> str:
    """The pipeline's answer as a scorable label. A real status is itself; a
    row that answered NOTHING gets the sentinel, which can never equal a
    human label — the `score_axis` rule, so silence never scores well."""
    if row.get("pipeline_tone"):
        return row["pipeline_tone"]
    status = row.get("pipeline_status")
    if status in PIPELINE_STATUS_ANSWERS:
        return status
    return DECLINED


def tones(rows: list) -> dict:
    scored = [r for r in rows if r.get("tone") in SCORED_TONES]
    declined = sum(1 for r in scored if pipeline_answer(r) is DECLINED
                   or pipeline_answer(r) == DECLINED)
    pairs = [(r["tone"], pipeline_answer(r)) for r in scored]
    out = {"n": len(pairs), "declined_by_pipeline": declined, **macro_f1(pairs)}
    out["per_tone_n"] = dict(Counter(r["tone"] for r in scored))
    return out


def gate(metrics: dict, support: dict, *, n: int) -> dict:
    per_tone = (metrics.get("tones") or {}).get("per_label") or {}
    worst = min(per_tone.items(), key=lambda kv: kv[1].get("recall", 0),
                default=(None, {}))
    checks = {
        "pair_precision": (metrics.get("detection") or {}).get("precision"),
        "pair_recall": (metrics.get("detection") or {}).get("recall"),
        "tone_macro_f1": (metrics.get("tones") or {}).get("macro_f1"),
        "per_tone_recall": min(
            (v.get("recall", 0) for v in per_tone.values()), default=None),
        "wrong_canonical_targets": metrics.get("wrong_canonical_targets"),
        "unsupported_evidence": metrics.get("unsupported_evidence"),
    }
    detail = {}
    for name, threshold in PERSON_RELEASE_GATES.items():
        value = checks.get(name)
        minimum = name not in {"wrong_canonical_targets", "unsupported_evidence"}
        # ⚠️ FAILS CLOSED, AND A ZERO OVER AN EMPTY SAMPLE IS NOT A PASS.
        # „0 wrong targets" counted over 0 pairs is the vacuous pass this
        # whole file exists to refuse, and printing it as `ok` beside four
        # unmet floors is how it would get quoted.
        passed = (n > 0 and value is not None
                  and (value >= threshold if minimum else value <= threshold))
        detail[name] = {"value": value,
                        "minimum" if minimum else "maximum": threshold,
                        "passed": passed}
        if name == "per_tone_recall" and worst[0]:
            # An operator reading „per_tone_recall 0.0" cannot otherwise
            # tell `mixed` on 30 pairs from `not_assessed` on 1.
            detail[name]["worst_label"] = worst[0]
            detail[name]["support"] = worst[1].get("support")
    # ⚠️ SUPPORT IS A GATE. Without it, 3 pairs at 1.000 would „pass".
    met = all(v["passed"] for v in detail.values()) and support["passed"]
    return {"passed": met, "checks": detail, "support": support}


def support_of(rows: list, agreement: dict | None = None) -> dict:
    per_tone = Counter(r.get("tone") for r in rows)
    strata = Counter()
    for row in rows:
        for name in row.get("strata") or []:
            strata[name] += 1
    tone_floor = PERSON_SUPPORT_FLOORS["pairs_per_tone"]
    short_tones = {t: per_tone.get(t, 0) for t in PERSON_TONES
                   if per_tone.get(t, 0) < tone_floor}
    uncovered = [s for s in PERSON_STRATA if not strata.get(s)]
    agreement = agreement or {"n": 0, "kappa": None}
    kappa_floor = PERSON_SUPPORT_FLOORS["min_kappa"]
    double_floor = PERSON_SUPPORT_FLOORS["doubly_annotated_pairs"]
    agreement_ok = (agreement.get("n", 0) >= double_floor
                    and agreement.get("kappa") is not None
                    and agreement["kappa"] >= kappa_floor)
    return {
        "adjudicated_pairs": len(rows),
        "pairs_floor": PERSON_SUPPORT_FLOORS["adjudicated_pairs"],
        "doubly_annotated_pairs": agreement.get("n", 0),
        "doubly_annotated_floor": double_floor,
        "kappa": agreement.get("kappa"),
        "kappa_floor": kappa_floor,
        "agreement_passed": agreement_ok,
        "per_tone": dict(per_tone),
        "per_tone_floor": tone_floor,
        "tones_below_floor": short_tones,
        "strata": dict(strata),
        "strata_uncovered": uncovered,
        "passed": (len(rows) >= PERSON_SUPPORT_FLOORS["adjudicated_pairs"]
                   and not short_tones and not uncovered and agreement_ok),
    }


def zero_upper_bound(n: int):
    """What „0 errors" can actually support at this n — printed so the zero
    is never quoted as perfection."""
    if n <= 0:
        return None
    return wilson(0, n)[1]


def prevalence_split(rows: list) -> dict:
    """The balanced hard-case set measures hard cases and says nothing about
    prevalence, so the two never pool."""
    out = {}
    for name in ("natural", "hard_case"):
        subset = [r for r in rows if (r.get("sample") or "natural") == name]
        out[name] = {"n": len(subset),
                     "tones": dict(Counter(r.get("tone") for r in subset))}
    return out


def published_distribution(app_data: Path) -> dict:
    """The pipeline's own published tone shares — the drift baseline. A gate
    made easier by relabelling everything neutral must be visible.

    ⚠️ ONE FOLD PER IDENTITY, PAGE 1 ONLY. T4.4 paginates a person shard and
    writes the WHOLE-identity accounting onto every page, so summing the
    shards counts a 3-page identity three times — measured, `assessed: 52`
    against a true 26 on a single identity with two pages. The shares only
    looked right because its two pages are identical."""
    person_dir = app_data / "person"
    if not person_dir.exists():
        return {"available": False, "reason": "no published person shards"}
    by_person: dict = {}
    read = unreadable = 0
    for shard in sorted(person_dir.glob("*.json")):
        try:
            payload = json.loads(shard.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            # Counted, never silently skipped: an unreadable shard
            # understates the baseline it is claimed to have been read from.
            unreadable += 1
            continue
        read += 1
        if int(payload.get("page") or 1) != 1:
            continue
        by_person[payload.get("news_person_id") or shard.stem] = (
            payload.get("counts") or {})
    counts: Counter = Counter()
    for per_person in by_person.values():
        for tone, n in per_person.items():
            counts[tone] += int(n or 0)
    total = sum(counts.values())
    return {"available": True, "assessed": total,
            "identities": len(by_person),
            "shards_read": read, "shards_unreadable": unreadable,
            "counts": dict(counts),
            "shares": {k: round(v / total, 4) for k, v in counts.items()}
            if total else {}}


def build_report(path: Path = ADJUDICATIONS, *, rubric_version: str | None = None,
                 identity_versions: dict | None = None,
                 app_data: Path = APP_DATA) -> dict:
    raw = load(path)
    rows = raw.get("pairs") or []
    part = partition(rows, rubric_version=rubric_version,
                     identity_versions=identity_versions)
    scorable = part["scorable"]
    metrics = {
        "detection": detection(scorable),
        "tones": tones(scorable),
        "wrong_canonical_targets": sum(
            1 for r in scorable if r.get("wrong_canonical_target")),
        "unsupported_evidence": sum(
            1 for r in scorable if r.get("evidence_supports") is False),
        # Not gated in v1, but counted: `subject_role` is what T4.4's M is
        # defined over, so a human disagreeing with the pipeline's role is
        # stating the thing that would move the denominator.
        "role_mismatches": sum(
            1 for r in scorable
            if r.get("subject_role") and r.get("pipeline_subject_role")
            and r["subject_role"] != r["pipeline_subject_role"]),
    }
    agreement_pairs = []
    for rows_for_key in part["by_key"].values():
        by_annotator = {}
        for row in rows_for_key:
            by_annotator.setdefault(row.get("annotator"), row)
        if len(by_annotator) >= 2:
            first, second = list(by_annotator.values())[:2]
            agreement_pairs.append((first.get("tone"), second.get("tone")))
    agreement = cohen_kappa(agreement_pairs)
    support = support_of(scorable, agreement)
    resolved = sum(1 for r in scorable if r.get("pipeline_resolved"))
    report = {
        "version": 1,
        "source": str(path),
        "adjudicated_pairs_in_file": len(rows),
        "excluded": part["excluded"],
        "metrics": metrics,
        "gate": gate(metrics, support, n=len(scorable)),
        "inter_annotator": agreement,
        "resolved_target_coverage": {
            "resolved": resolved, "of": len(scorable),
            "share": round(resolved / len(scorable), 4) if scorable else None},
        "zero_claims": {
            "note": ("a zero here is a release blocker on the SAMPLE, never a "
                     "claim of zero population error"),
            "upper_bound_95_at_this_n": zero_upper_bound(len(scorable))},
        "prevalence": prevalence_split(scorable),
        "published_distribution": published_distribution(app_data),
    }
    usable = bool(scorable)
    report["status"] = (
        "UNMET — 0 adjudicated pairs; nothing here is a measured accuracy"
        if not usable else ("MET" if report["gate"]["passed"] else "UNMET"))
    report["review_only"] = not report["gate"]["passed"]
    report["reason"] = (
        "no adjudicated pairs" if not usable
        else ("insufficient support" if not support["passed"]
              else None if report["gate"]["passed"] else "a floor is unmet"))
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--adjudications", type=Path, default=ADJUDICATIONS)
    ap.add_argument("--app-data", type=Path, default=APP_DATA)
    # ⚠️ DEFAULTS ON. With the filter off, 200 pairs judged under a
    # superseded rubric reported MET with `excluded: {}` — a protection
    # present in the code, described in the plan, and inactive in the one
    # command an operator is told to run.
    ap.add_argument("--rubric-version", default=CURRENT_RUBRIC,
                    help="exclude pairs judged under a different rubric "
                         "(pass '' to disable, which is not advised)")
    ap.add_argument("--identity-versions", type=Path, default=None,
                    help="JSON {news_person_id: identity_version}; pairs "
                         "judged under a superseded identity are excluded "
                         "and counted. Defaults to the published index.")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--enforce", action="store_true",
                    help="exit non-zero unless every floor is met")
    args = ap.parse_args(argv)
    identity_versions = (
        json.loads(args.identity_versions.read_text(encoding="utf-8"))
        if args.identity_versions else published_identity_versions(args.app_data))
    report = build_report(args.adjudications,
                          rubric_version=args.rubric_version or None,
                          identity_versions=identity_versions,
                          app_data=args.app_data)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"person treatment gate: {report['status']}")
        if report["reason"]:
            print(f"  reason: {report['reason']}")
        support = report["gate"]["support"]
        print(f"  adjudicated test pairs: {support['adjudicated_pairs']}"
              f" (floor {support['pairs_floor']})")
        if support["tones_below_floor"]:
            print(f"  tones below the {support['per_tone_floor']}-pair floor: "
                  f"{support['tones_below_floor']}")
        if support["strata_uncovered"]:
            print(f"  strata with no pairs: {', '.join(support['strata_uncovered'])}")
        for name, row in report["gate"]["checks"].items():
            bound = row.get("minimum", row.get("maximum"))
            print(f"  {'ok ' if row['passed'] else 'UNMET'} {name}: "
                  f"{row['value']} (floor {bound})")
        if report["excluded"]:
            print(f"  excluded: {report['excluded']}")
    if args.enforce and not report["gate"]["passed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
