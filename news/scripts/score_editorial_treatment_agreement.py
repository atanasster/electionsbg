#!/usr/bin/env python3
"""Score the Tier 0 human agreement gate for editorial-treatment v2.

The sample file remains pending until two independent human passes are added.
For the solo fallback, both passes may name the same adjudicator only when
their ISO timestamps are at least seven days apart. A model annotation is
never accepted as a kappa denominator.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
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

ORDERS = {
    "leaning": [
        "strong_progressive", "progressive", "neutral", "conservative",
        "strong_conservative", "not_applicable",
    ],
    "russia_stance": [
        "strong_pro_russia", "pro_russia", "neutral", "anti_russia",
        "strong_anti_russia", "not_applicable",
    ],
    "party_tone": [
        "strong_unfavorable", "unfavorable", "neutral", "favorable",
        "strong_favorable",
    ],
}
GATE = 0.80
MIN_ROWS = 50


def canonical_sha(value) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def weighted_kappa(left: list[str], right: list[str],
                   order: list[str]) -> float | None:
    """Quadratic weighted kappa, or ``None`` when diversity is insufficient."""

    if len(left) != len(right) or not left:
        raise ValueError("kappa inputs must be non-empty and equal length")
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


def score(assignments_doc: dict, pass_a: dict, pass_b: dict) -> dict:
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

    axes = {}
    insufficient = False
    for axis, order in ORDERS.items():
        value = weighted_kappa(
            [decisions_a[key][axis] for key in sorted(assignments)],
            [decisions_b[key][axis] for key in sorted(assignments)],
            order,
        )
        if value is None:
            insufficient = True
        axes[axis] = {
            "weighted_kappa": None if value is None else round(value, 6),
            "minimum": GATE,
            "passed": value is not None and value >= GATE,
            "n": len(assignments),
            "labels_a": dict(sorted(Counter(
                decisions_a[key][axis] for key in assignments).items())),
            "labels_b": dict(sorted(Counter(
                decisions_b[key][axis] for key in assignments).items())),
        }
    passed = all(item["passed"] for item in axes.values())
    return {
        "status": ("passed" if passed else
                   "insufficient_label_diversity" if insufficient else
                   "failed_rubric_agreement"),
        "passed": passed,
        "method": method,
        "adjudicators": sorted({name_a, name_b}),
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
    result = score(assignments, pass_a, pass_b)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
