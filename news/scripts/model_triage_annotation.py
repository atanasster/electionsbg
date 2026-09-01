#!/usr/bin/env python3
"""Model triage annotation for the Tier 0 human agreement gate.

⚠️⚠️ THIS IS NOT A PASS AND CAN NEVER BECOME ONE. The plan's Tier 0 fallback
list admits a model "only as a triage signal that surfaces disagreements for a
human, never as a κ denominator", because a model applying this rubric shares
its text with the system under test. The artifact is stamped
`annotator_kind: "model"` and `pass_id: "TRIAGE"`, so
`score_editorial_treatment_agreement.py` refuses it twice over — once on the
pass id, once on the annotator kind. Do not "fix" either stamp.

What it is FOR: after both human passes are sealed and scored, a measure that
missed 0.80 leaves you asking which rows moved and why. Comparing each human
pass against a third, independent-of-neither reading narrows that fast. It says
nothing about whether the model is right.

⚠️ THE SEAL IS ENFORCED HERE, NOT PROMISED. `--report` refuses to print
anything until pass B is sealed, because a human who has seen this file cannot
then produce an unanchored pass B — and the blind between A and B is the entire
content of the `one_human_two_blinded_passes` method. A promise not to look is
not a control; a refusal is.

    python3 news/scripts/model_triage_annotation.py --build
    python3 news/scripts/model_triage_annotation.py --report   # after pass B
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from score_editorial_treatment_agreement import (  # noqa: E402
    AXES, ORDERS, ROOT, canonical_sha, score_axis,
)

EVAL_DIR = ROOT / "news" / "evals" / "editorial_treatment_v2"
WORK_DIR = ROOT / "news" / "var" / "adjudication"
SAMPLE = EVAL_DIR / "human-agreement-sample-2026-09-01.json"
TRIAGE = WORK_DIR / "model-triage-annotation.json"


def build(chunk_glob: str, model: str, method: str) -> dict:
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    wanted = {row["assignment_id"] for row in sample["assignments"]}
    merged: dict[str, dict] = {}
    files = sorted(glob.glob(chunk_glob))
    if not files:
        raise SystemExit(f"no label chunks matched {chunk_glob}")
    for path in files:
        for key, value in json.loads(Path(path).read_text(encoding="utf-8")).items():
            if key in merged:
                raise SystemExit(f"duplicate assignment {key} across chunks")
            merged[key] = value

    missing = sorted(wanted - set(merged))
    extra = sorted(set(merged) - wanted)
    if missing or extra:
        raise SystemExit(f"assignment mismatch — missing {missing}, extra {extra}")
    for key, value in merged.items():
        for axis in AXES:
            if value.get(axis) not in ORDERS[axis]:
                raise SystemExit(f"{key}: invalid {axis}={value.get(axis)!r}")

    rows = [{
        "assignment_id": row["assignment_id"],
        "article_path": row["article_path"],
        "article_sha256": row["article_sha256"],
        "party_surface": row["party_surface"],
        "decision": {axis: merged[row["assignment_id"]][axis] for axis in AXES},
        "note": merged[row["assignment_id"]].get("note", ""),
    } for row in sorted(sample["assignments"],
                        key=lambda item: item["assignment_id"])]

    doc = {
        "annotation": "editorial-treatment-v2-model-triage",
        "pass_id": "TRIAGE",
        "annotator_kind": "model",
        "is_kappa_denominator": False,
        "refusal": "A model shares this rubric's text with the system under "
                   "test, so it is not an independent annotator. Usable only to "
                   "surface disagreements for a human to adjudicate.",
        "model": model,
        "production_method": method,
        "assignments_sha256": sample["assignments_sha256"],
        "produced_at": datetime.now(timezone.utc).isoformat(),
        "sealed_until": "pass B is sealed; --report refuses before then",
        "rows_sha256": canonical_sha([
            {k: v for k, v in row.items() if k != "note"} for row in rows]),
        "rows": rows,
    }
    return doc


def _sealed(path: Path) -> tuple[dict | None, str | None]:
    if not path.exists():
        return None, f"{path.name} does not exist"
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not doc.get("completed_at") or not doc.get("adjudicator"):
        return None, f"{path.name} is not finalized"
    if any(row.get("decision") is None for row in doc.get("rows") or []):
        return None, f"{path.name} has undecided rows"
    if canonical_sha(doc["rows"]) != doc.get("rows_sha256"):
        return None, f"{path.name} is unsealed or its rows changed"
    return doc, None


def report(triage_path: Path, pass_a: Path, pass_b: Path) -> dict:
    triage = json.loads(triage_path.read_text(encoding="utf-8"))
    doc_b, why_b = _sealed(pass_b)
    if why_b:
        return {"status": "withheld", "passed": False, "reason": (
            f"pass B is not sealed ({why_b}). This file stays closed until it "
            "is: a human who has read the triage cannot then produce an "
            "unanchored pass B, and that blind is the whole content of the "
            "one_human_two_blinded_passes method.")}
    doc_a, why_a = _sealed(pass_a)
    if why_a:
        return {"status": "withheld", "passed": False, "reason": why_a}

    model = {row["assignment_id"]: row["decision"] for row in triage["rows"]}
    out = {"status": "released", "model": triage.get("model"),
           "production_method": triage.get("production_method"),
           "is_kappa_denominator": False,
           "caveat": triage["refusal"], "axes": {}}
    for axis in AXES:
        keys = sorted(model)
        human_a = {r["assignment_id"]: r["decision"][axis] for r in doc_a["rows"]}
        human_b = {r["assignment_id"]: r["decision"][axis] for r in doc_b["rows"]}
        vs_a = score_axis(axis, [human_a[k] for k in keys],
                          [model[k][axis] for k in keys], 1, min_n=0,
                          min_minority=0)
        vs_b = score_axis(axis, [human_b[k] for k in keys],
                          [model[k][axis] for k in keys], 2, min_n=0,
                          min_minority=0)
        disputed = [k for k in keys
                    if len({human_a[k], human_b[k], model[k][axis]}) > 1]
        out["axes"][axis] = {
            "human_a_vs_model": vs_a["measures"],
            "human_b_vs_model": vs_b["measures"],
            "rows_where_all_three_do_not_agree": len(disputed),
            "model_labels": dict(sorted(Counter(
                model[k][axis] for k in keys).items())),
            "disputed_assignment_ids": disputed,
        }
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--build", action="store_true")
    mode.add_argument("--report", action="store_true")
    parser.add_argument("--chunks", default=None,
                        help="glob of per-worker label files, for --build")
    parser.add_argument("--model", default="claude-opus-5")
    parser.add_argument("--production-method",
                        default="5 parallel workers, 10 articles each, sharing "
                                "one verbatim rubric (plan §3.1-3.6). Workers "
                                "saw title and body only — no outlet, no URL, "
                                "no v1 analysis, no human pass.")
    parser.add_argument("--triage", default=str(TRIAGE))
    parser.add_argument("--pass-a", default=str(WORK_DIR / "pass-a.json"))
    parser.add_argument("--pass-b", default=str(WORK_DIR / "pass-b.json"))
    args = parser.parse_args()

    if args.build:
        if not args.chunks:
            raise SystemExit("--build needs --chunks")
        doc = build(args.chunks, args.model, args.production_method)
        path = Path(args.triage)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print(json.dumps({"ok": True, "rows": len(doc["rows"]),
                          "annotator_kind": doc["annotator_kind"],
                          "pass_id": doc["pass_id"],
                          "rows_sha256": doc["rows_sha256"],
                          "path": str(path),
                          "note": "labels deliberately not printed"}, indent=2))
        return 0

    result = report(Path(args.triage), Path(args.pass_a), Path(args.pass_b))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "released" else 1


if __name__ == "__main__":
    sys.exit(main())
