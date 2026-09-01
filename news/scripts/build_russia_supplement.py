#!/usr/bin/env python3
"""Mint the Russia-direction supplement for the Tier 0 human agreement gate.

⚠️ WHY THIS EXISTS, so nobody later reads it as a prevalence sample. The frozen
50-row sample was stratified by hidden v1 PARTY label, one party pair per
article. That makes it excellent for party tone and for leaning direction and
structurally thin for Russia: on v1's reading of those same 50 articles, 38 are
`not_applicable`, so `russia_stance.direction` — which scores only the rows both
adjudicators judged applicable — lands at n≈12 against the scorer's floor of 20.
No amount of adjudicator agreement fixes that; it is a property of the sample.

⚠️⚠️ THE PARTY REQUIREMENT IS WHAT HAD TO GO, AND KEEPING IT WOULD HAVE LOOKED
LIKE IT WORKED. Measured over the 1,687 `ok` records: only **11** unused
articles carry BOTH a v1 Russia position and a party pair, against **168** with
a Russia position and no party constraint. A supplement built the obvious way —
same row shape as the main sample — therefore caps the pooled direction n at 23
and would have been discovered to be too thin only after two passes of human
reading. So supplement rows carry `party_surface: null` and ask **only**
`russia_stance`.

That restriction is the design, not a shortcut. A supplement row physically
cannot contribute to another axis, because no other answer is stored — so
"which measure does this row feed" can never be got wrong downstream.

Selection is deliberately NOT prevalence-shaped. It targets five rows per v1
Russia position, including both strong endpoints, because a quadratic weighted
kappa measures whether two readings agree about DISTANCE and needs ordinal
spread to mean anything. The emitted report says so, and the scorer reports
`n_prevalence` beside `n_supplement` so the enriched stratum can never be read
as "this is how often Bulgarian coverage takes a Russia position".

    python3 news/scripts/build_russia_supplement.py --write
    python3 news/scripts/build_russia_supplement.py --check
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from editorial_treatment_baseline import (  # noqa: E402
    agreement_pass, canonical_sha, write_json,
)
from score_editorial_treatment_agreement import AXES, ROOT, file_sha  # noqa: E402

EVAL_DIR = ROOT / "news" / "evals" / "editorial_treatment_v2"
BASELINE = EVAL_DIR / "baseline-2026-09-01.json"
MAIN_SAMPLE = EVAL_DIR / "human-agreement-sample-2026-09-01.json"
SNAPSHOT = "2026-09-01"
SAMPLE_NAME = "editorial-treatment-v2-russia-direction-supplement"
PER_POSITION = 5
SALT = "editorial-treatment-v2-russia-supplement"


def out_paths(snapshot: str) -> dict[str, Path]:
    return {
        "assignments": EVAL_DIR / f"russia-supplement-{snapshot}.json",
        "A": EVAL_DIR / "russia-supplement-pass-a.template.json",
        "B": EVAL_DIR / "russia-supplement-pass-b.template.json",
    }


def v1_russia(analysis_path: Path) -> str | None:
    doc = json.loads(analysis_path.read_text(encoding="utf-8"))
    record = doc.get("analysis") or doc
    value = record.get("russia_stance")
    return value.get("label") if isinstance(value, dict) else value


def select(baseline: dict, used: set[str]) -> list[dict]:
    """Five rows per v1 Russia position, deterministic, blinded in the output."""

    buckets: dict[str, list[dict]] = {label: [] for label in
                                      AXES["russia_stance"]["scale"]}
    for manifest in baseline["analysis_manifest"]:
        if manifest.get("quality") != "ok" or not manifest.get("article_sha256"):
            continue
        if manifest["article_path"] in used:
            continue
        label = v1_russia(ROOT / manifest["analysis_path"])
        if label not in buckets:
            continue
        buckets[label].append({
            "assignment_id": canonical_sha({
                "salt": SALT, "article": manifest["article_sha256"]})[:20],
            "article_path": manifest["article_path"],
            "article_sha256": manifest["article_sha256"],
            "party_surface": None,
        })
    selected, shortfall = [], {}
    for label in AXES["russia_stance"]["scale"]:
        rows = sorted(buckets[label], key=lambda row: canonical_sha({
            "salt": SALT, "assignment": row["assignment_id"]}))
        take = rows[:PER_POSITION]
        if len(take) < PER_POSITION:
            shortfall[label] = {"wanted": PER_POSITION, "available": len(take)}
        selected.extend(take)
    if shortfall:
        print(f"note: thin v1 positions, taking all available: {shortfall}",
              file=sys.stderr)
    selected.sort(key=lambda row: row["assignment_id"])
    return selected


def build(snapshot: str) -> dict[str, dict]:
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    main = json.loads(MAIN_SAMPLE.read_text(encoding="utf-8"))
    used = {row["article_path"] for row in main["assignments"]}
    rows = select(baseline, used)
    if len(rows) < 15:
        raise SystemExit(f"only {len(rows)} supplement rows; too thin to help")
    assignments = {
        "sample": SAMPLE_NAME,
        "snapshot_date": snapshot,
        "analysis_manifest_sha256": baseline["analysis_manifest_sha256"],
        "main_sample_assignments_sha256": main["assignments_sha256"],
        "scored_axes": ["russia_stance"],
        "pools_into": {"russia_stance": ["direction"]},
        "selection": {
            "method": "deterministic stratification by hidden v1 russia_stance; "
                      f"target {PER_POSITION} per ordinal position",
            "basis": "ENRICHED for ordinal spread — NOT a prevalence sample. "
                     "It carries no claim about how often Bulgarian coverage "
                     "takes a Russia position.",
            "party_surface": "null by design — only 11 unused articles carry "
                             "both a v1 Russia position and a party pair, "
                             "against 168 with no party constraint, so "
                             "requiring one caps pooled direction n at 23.",
            "real_judgments": len(rows),
            "blinded_order": True,
            "old_labels_exposed": False,
        },
        "assignments_sha256": canonical_sha(rows),
        "assignments": rows,
    }
    passes = {pass_id: agreement_pass(rows, pass_id) for pass_id in ("A", "B")}
    for pass_id, doc in passes.items():
        doc["sample"] = SAMPLE_NAME
        doc["scored_axes"] = ["russia_stance"]
        doc["rows_sha256"] = canonical_sha(doc["rows"])
    return {"assignments": assignments, **passes}


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--snapshot", default=SNAPSHOT)
    args = parser.parse_args()

    built = build(args.snapshot)
    paths = out_paths(args.snapshot)
    if args.write:
        for key, path in paths.items():
            write_json(path, built[key])
        counts = Counter()
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
        by_article = {m["article_path"]: m for m in baseline["analysis_manifest"]}
        for row in built["assignments"]["assignments"]:
            counts[v1_russia(ROOT / by_article[row["article_path"]]["analysis_path"])] += 1
        print(json.dumps({
            "ok": True,
            "rows": len(built["assignments"]["assignments"]),
            "hidden_v1_spread": dict(sorted(counts.items())),
            "written": {key: str(path) for key, path in paths.items()},
        }, ensure_ascii=False, indent=2))
        return 0

    errors = []
    for key, path in paths.items():
        if not path.exists():
            errors.append(f"missing {path.name}")
            continue
        stored = json.loads(path.read_text(encoding="utf-8"))
        if key == "assignments":
            if canonical_sha(stored["assignments"]) != stored["assignments_sha256"]:
                errors.append("supplement assignment hash mismatch")
            for row in stored["assignments"]:
                article = ROOT / row["article_path"]
                if not article.exists() or file_sha(article) != row["article_sha256"]:
                    errors.append(f"article moved: {row['article_path']}")
        else:
            if canonical_sha(stored["rows"]) != stored["rows_sha256"]:
                errors.append(f"pass {key} row hash mismatch")
            if stored.get("adjudicator") or stored.get("completed_at"):
                errors.append(f"pass {key} template is not pending")
    if paths["A"].exists() and paths["B"].exists():
        a = json.loads(paths["A"].read_text(encoding="utf-8"))
        b = json.loads(paths["B"].read_text(encoding="utf-8"))
        if a["order_sha256"] == b["order_sha256"]:
            errors.append("pass A and B share an order; B is not reshuffled")
    print(json.dumps({"ok": not errors, "errors": errors}, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
