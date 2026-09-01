#!/usr/bin/env python3
"""Score the Tier 0 human agreement gate for editorial-treatment v2.

The sample file remains pending until two independent human passes are added.
For the solo fallback, both passes may name the same adjudicator only when
their ISO timestamps are at least seven days apart. A model annotation is
never accepted as a kappa denominator.

⚠️⚠️ `not_applicable` IS NOT A POSITION ON THE ORDINAL SCALE, AND SCORING IT AS
ONE MADE THE GATE'S VERDICT DEPEND ON AN ARRAY INDEX. Until 2026-09-01 both
scalar axes were scored with one quadratic weighted kappa over a six-item list
whose last entry was `not_applicable` — so an applicability disagreement cost
one step against `strong_anti_russia` and five against `strong_pro_russia`, and
the SAME disagreement scored anywhere from 0.71 to 0.99 depending only on which
direction it happened to land in. Measured on a realistic pass pair shaped like
the checked-in sample (38 `not_applicable`, 12 positioned): moving
`not_applicable` from the end of the list to the front, with the annotations
untouched, took the identical data from 0.7146 (FAIL) to 0.8030 (PASS).

So each axis carrying the off-scale category is now scored as TWO measurements:

  applicability  does the axis apply at all — binary, unweighted Cohen kappa
                 over every row. This is where a §3.5 B4 regression
                 (`neutral` read as `not_applicable`) shows up, loudly, on its
                 own axis instead of being averaged into the direction score.
  direction      quadratic weighted kappa over the five ordinal positions,
                 computed ONLY on rows both adjudicators judged applicable.

Both must clear the gate for the axis to pass; `party_tone` has no off-scale
category and is a single direction measurement over all rows.

Two derived consequences, both deliberate:

- `direction` n is smaller than the row count and is REPORTED, never hidden.
  Below `--min-n` the axis is `low_precision` and does not pass — a kappa point
  estimate on a handful of rows must not render as a green tick. This is the
  plan's own Tier 2 rule ("withheld — insufficient n" is a first-class result)
  applied at Tier 0.
- `applicability` is scored on the count of the RARER class, not on 50 rows.
  Below `--min-minority-n` it is `low_precision`, because Cohen kappa on a 48/2
  marginal is dominated by one or two cells — see `_minority_n`.
- an unscorable `applicability` because NO row was `not_applicable` is
  `not_exercised`, not a failure: the category never arose, and the axis
  reduces to its direction measurement. An unscorable one because EVERY row
  was `not_applicable` leaves direction at n=0 and blocks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SAMPLE = (ROOT / "news" / "evals" / "editorial_treatment_v2" /
                  "human-agreement-sample-2026-09-01.json")
DEFAULT_PASS_A = (ROOT / "news" / "evals" / "editorial_treatment_v2" /
                  "human-agreement-pass-a.template.json")
DEFAULT_PASS_B = (ROOT / "news" / "evals" / "editorial_treatment_v2" /
                  "human-agreement-pass-b.template.json")

# `scale` is ordinal and quadratic-weighted; `off_scale` is nominal and is
# never given an index on it. Do not merge them back into one list.
AXES = {
    "leaning": {
        "scale": ["strong_progressive", "progressive", "neutral",
                  "conservative", "strong_conservative"],
        "off_scale": "not_applicable",
    },
    "russia_stance": {
        "scale": ["strong_pro_russia", "pro_russia", "neutral",
                  "anti_russia", "strong_anti_russia"],
        "off_scale": "not_applicable",
    },
    "party_tone": {
        "scale": ["strong_unfavorable", "unfavorable", "neutral",
                  "favorable", "strong_favorable"],
        "off_scale": None,
    },
}

# Accepted decision vocabulary per axis. Derived so the validator and the
# scorer cannot disagree about what a legal label is.
ORDERS = {
    axis: spec["scale"] + ([spec["off_scale"]] if spec["off_scale"] else [])
    for axis, spec in AXES.items()
}

GATE = 0.80
MIN_ROWS = 50
MIN_DIRECTION_N = 20
MIN_MINORITY_N = 5
BOOTSTRAP_SAMPLES = 2000


def canonical_sha(value) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def weighted_kappa(left: list[str], right: list[str],
                   order: list[str]) -> float | None:
    """Quadratic weighted kappa, or ``None`` when diversity is insufficient.

    With a two-item ``order`` the quadratic weights collapse to 0/1, so this is
    exactly unweighted Cohen kappa — which is what the applicability measure
    wants, and why it is not a second implementation.
    """

    if len(left) != len(right):
        raise ValueError("kappa inputs must be equal length")
    if not left:
        return None
    index = {label: i for i, label in enumerate(order)}
    if any(value not in index for value in left + right):
        unknown = sorted({value for value in left + right if value not in index})
        raise ValueError(f"unknown labels: {unknown}")
    size = len(order)
    observed = [[0.0] * size for _ in range(size)]
    left_counts = [0.0] * size
    right_counts = [0.0] * size
    for a, b in zip(left, right):
        i, j = index[a], index[b]
        observed[i][j] += 1.0
        left_counts[i] += 1.0
        right_counts[j] += 1.0
    denominator = max(1, size - 1) ** 2
    weighted_observed = weighted_expected = 0.0
    total = float(len(left))
    for i in range(size):
        for j in range(size):
            weight = ((i - j) ** 2) / denominator
            weighted_observed += weight * observed[i][j] / total
            weighted_expected += weight * (left_counts[i] * right_counts[j]) / (total * total)
    if math.isclose(weighted_expected, 0.0):
        return None
    return 1.0 - weighted_observed / weighted_expected


def bootstrap_interval(left: list[str], right: list[str], order: list[str],
                       seed: int) -> list[float] | None:
    """Deterministic percentile interval, so the report is reproducible.

    The point estimate is what the gate reads; this exists so an n of 11 cannot
    be read with the confidence of an n of 50. Degenerate resamples (every draw
    identical, so kappa is undefined) are skipped rather than counted as 1.0.
    """

    if len(left) < 2:
        return None
    rng = random.Random(seed)
    size = len(left)
    values = []
    for _ in range(BOOTSTRAP_SAMPLES):
        picks = [rng.randrange(size) for _ in range(size)]
        value = weighted_kappa([left[i] for i in picks],
                               [right[i] for i in picks], order)
        if value is not None:
            values.append(value)
    if len(values) < BOOTSTRAP_SAMPLES // 10:
        return None
    values.sort()
    low = values[int(0.025 * (len(values) - 1))]
    high = values[int(0.975 * (len(values) - 1))]
    return [round(low, 4), round(high, 4)]


def _minority_n(left: list[str], right: list[str]) -> int:
    """Instances of the rarer class, taken from the more conservative rater.

    ⚠️ THE KAPPA PARADOX IS WHY THIS EXISTS, and it bites hardest exactly where
    the gate is most tempting to trust. Measured on a dry run over the frozen
    sample: `leaning` applicability came back kappa 0.6479 — a FAIL — off THREE
    disagreements, because only 2 of 50 rows are `not_applicable`, so expected
    agreement is ~0.96 and each cell moves kappa enormously. Its bootstrap
    interval was the full [0.0, 1.0]. Blocking a cutover on that number would
    be blocking it on noise; passing it would be worse.
    """

    counts_left, counts_right = Counter(left), Counter(right)
    labels = set(counts_left) | set(counts_right)
    if len(labels) < 2:
        return 0
    return min(min(counts_left.get(label, 0), counts_right.get(label, 0))
               for label in labels)


def _measure(left: list[str], right: list[str], order: list[str],
             seed: int, minimum: float, min_n: int,
             min_minority: int = 0) -> dict:
    value = weighted_kappa(left, right, order)
    n = len(left)
    minority = _minority_n(left, right)
    if value is None:
        status = "unscorable_constant" if n else "unscorable_empty"
    elif n < min_n or (min_minority and minority < min_minority):
        status = "low_precision"
    elif value >= minimum:
        status = "passed"
    else:
        status = "failed"
    return {
        "weighted_kappa": None if value is None else round(value, 6),
        "ci95": (None if value is None
                 else bootstrap_interval(left, right, order, seed)),
        "n": n,
        "min_n": min_n,
        "minority_n": minority,
        "min_minority_n": min_minority,
        "minimum": minimum,
        "status": status,
        "passed": status == "passed",
        "labels_a": dict(sorted(Counter(left).items())),
        "labels_b": dict(sorted(Counter(right).items())),
    }


def score_axis(axis: str, left: list[str], right: list[str], seed: int,
               min_n: int = MIN_DIRECTION_N,
               min_minority: int = MIN_MINORITY_N) -> dict:
    """Score one axis, keeping the off-scale category off the ordinal scale."""

    spec = AXES[axis]
    scale, off = spec["scale"], spec["off_scale"]
    measures = {}
    if off is not None:
        binary = ["not_applicable", "applicable"]
        measures["applicability"] = _measure(
            [off if v == off else "applicable" for v in left],
            [off if v == off else "applicable" for v in right],
            binary, seed, GATE, 0, min_minority,
        )
        if measures["applicability"]["status"] == "unscorable_constant":
            # The category never arose on either pass; the axis reduces to
            # direction. Distinguished from "everyone said not_applicable",
            # which leaves direction empty and blocks below.
            if off not in left and off not in right:
                measures["applicability"]["status"] = "not_exercised"
                measures["applicability"]["passed"] = True
        keep = [i for i in range(len(left))
                if left[i] != off and right[i] != off]
    else:
        keep = list(range(len(left)))
    measures["direction"] = _measure(
        [left[i] for i in keep], [right[i] for i in keep],
        scale, seed + 1, GATE, min_n,
    )
    passed = all(item["passed"] for item in measures.values())
    if passed:
        status = "passed"
    elif any(item["status"].startswith("unscorable")
             for item in measures.values()):
        status = "insufficient_label_diversity"
    elif any(item["status"] == "low_precision" for item in measures.values()):
        status = "low_precision"
    else:
        status = "failed"
    return {"passed": passed, "status": status, "measures": measures}


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("timestamp must include a timezone")
    return parsed


def _assignment_index(assignments: dict, errors: list[str]) -> dict[str, dict]:
    rows = assignments.get("assignments") or []
    if len(rows) < MIN_ROWS:
        errors.append(f"sample has {len(rows)} rows; {MIN_ROWS} required")
    if canonical_sha(rows) != assignments.get("assignments_sha256"):
        errors.append("immutable assignment hash mismatch")
    index = {row.get("assignment_id"): row for row in rows}
    if None in index or len(index) != len(rows):
        errors.append("assignment ids are missing or duplicated")
    return index


def _validate_pass(assignments: dict[str, dict], assignment_hash: str,
                   doc: dict, expected_id: str) -> tuple[list[dict], list[str], bool]:
    errors = []
    pending = False
    rows = doc.get("rows") or []
    if doc.get("pass_id") != expected_id:
        errors.append(f"pass {expected_id} id mismatch")
    if doc.get("assignments_sha256") != assignment_hash:
        errors.append(f"pass {expected_id} assignment hash mismatch")
    ids = [row.get("assignment_id") for row in rows]
    if canonical_sha(ids) != doc.get("order_sha256"):
        errors.append(f"pass {expected_id} order hash mismatch")
    if canonical_sha(rows) != doc.get("rows_sha256"):
        errors.append(f"pass {expected_id} is unsealed or its row hash changed")
    if set(ids) != set(assignments) or len(ids) != len(assignments):
        errors.append(f"pass {expected_id} assignment membership mismatch")
    for index, row in enumerate(rows):
        source = assignments.get(row.get("assignment_id"))
        if source:
            for field in ("article_path", "article_sha256", "party_surface"):
                if row.get(field) != source.get(field):
                    errors.append(
                        f"pass {expected_id} row {index + 1} changed immutable {field}"
                    )
            article_path = ROOT / source["article_path"]
            if (not article_path.exists()
                    or file_sha(article_path) != source["article_sha256"]):
                errors.append(
                    f"pass {expected_id} row {index + 1} article hash moved"
                )
        decision = row.get("decision")
        if decision is None:
            pending = True
            continue
        for axis, order in ORDERS.items():
            if decision.get(axis) not in order:
                errors.append(
                    f"pass {expected_id} row {index + 1}: invalid {axis}"
                )
    if doc.get("annotator_kind") != "human":
        errors.append(f"pass {expected_id} is not a human annotation")
    if not doc.get("adjudicator") or not doc.get("completed_at"):
        pending = True
    else:
        try:
            _parse_timestamp(doc["completed_at"])
        except (TypeError, ValueError) as exc:
            errors.append(f"pass {expected_id} has invalid completed_at: {exc}")
    return rows, errors, pending


def score(assignments_doc: dict, pass_a: dict, pass_b: dict,
          min_n: int = MIN_DIRECTION_N,
          min_minority: int = MIN_MINORITY_N) -> dict:
    errors: list[str] = []
    assignments = _assignment_index(assignments_doc, errors)
    assignment_hash = assignments_doc.get("assignments_sha256")
    rows_a, errors_a, pending_a = _validate_pass(
        assignments, assignment_hash, pass_a, "A"
    )
    rows_b, errors_b, pending_b = _validate_pass(
        assignments, assignment_hash, pass_b, "B"
    )
    errors.extend(errors_a + errors_b)
    if errors:
        return {"status": "invalid", "passed": False,
                "errors": errors, "axes": {}}
    if pending_a or pending_b:
        return {"status": "blocked_pending_humans", "passed": False,
                "errors": ["both sealed human passes must be complete"], "axes": {}}

    name_a, name_b = pass_a["adjudicator"], pass_b["adjudicator"]
    time_a = _parse_timestamp(pass_a["completed_at"])
    time_b = _parse_timestamp(pass_b["completed_at"])
    if name_a == name_b:
        if (time_b - time_a).total_seconds() < 7 * 24 * 60 * 60:
            return {"status": "invalid", "passed": False,
                    "errors": ["solo fallback passes must be at least seven days apart"],
                    "axes": {}}
        method = "one_human_two_blinded_passes"
    else:
        method = "two_human_adjudicators"

    decisions_a = {row["assignment_id"]: row["decision"] for row in rows_a}
    decisions_b = {row["assignment_id"]: row["decision"] for row in rows_b}
    keys = sorted(assignments)
    # Bind the bootstrap seed to the frozen assignments so the interval is
    # reproducible and cannot be reshaped by re-running the scorer.
    seed = int((assignment_hash or "0")[:8], 16)

    axes = {
        axis: score_axis(axis,
                         [decisions_a[key][axis] for key in keys],
                         [decisions_b[key][axis] for key in keys],
                         seed, min_n, min_minority)
        for axis in AXES
    }
    passed = all(item["passed"] for item in axes.values())
    if passed:
        status = "passed"
    elif any(item["status"] == "insufficient_label_diversity"
             for item in axes.values()):
        status = "insufficient_label_diversity"
    elif any(item["status"] == "low_precision" for item in axes.values()):
        status = "withheld_insufficient_n"
    else:
        status = "failed_rubric_agreement"
    return {
        "status": status,
        "passed": passed,
        "method": method,
        "adjudicators": sorted({name_a, name_b}),
        "rows": len(keys),
        "errors": [],
        "axes": axes,
    }


def seal_pass(path: Path) -> None:
    """Seal mutable human decisions without changing immutable assignments."""

    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["rows_sha256"] = canonical_sha(doc.get("rows") or [])
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assignments", default=str(DEFAULT_SAMPLE))
    parser.add_argument("--pass-a", default=str(DEFAULT_PASS_A))
    parser.add_argument("--pass-b", default=str(DEFAULT_PASS_B))
    parser.add_argument("--min-n", type=int, default=MIN_DIRECTION_N,
                        help="direction rows below which an axis is reported "
                             "low_precision instead of passing")
    parser.add_argument("--min-minority-n", type=int, default=MIN_MINORITY_N,
                        help="instances of the rarer applicability class below "
                             "which that measure is low_precision, not failed")
    parser.add_argument("--seal-pass", default=None,
                        help="recompute rows_sha256 after a human completes one pass")
    args = parser.parse_args()
    if args.seal_pass:
        seal_pass(Path(args.seal_pass))
        print(json.dumps({"ok": True, "sealed": args.seal_pass}, indent=2))
        return 0
    assignments = json.loads(Path(args.assignments).read_text(encoding="utf-8"))
    pass_a = json.loads(Path(args.pass_a).read_text(encoding="utf-8"))
    pass_b = json.loads(Path(args.pass_b).read_text(encoding="utf-8"))
    result = score(assignments, pass_a, pass_b, args.min_n, args.min_minority_n)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
