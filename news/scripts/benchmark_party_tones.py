#!/usr/bin/env python3
"""Compare party-tone model runs on one frozen reference set.

Accuracy, completion, latency, tokens and cost are adjacent fields, never a
weighted leaderboard. A candidate is eligible only when every release gate
passes; among eligible candidates callers may choose the cheapest/fastest.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from score_analyses import (load_set, party_release_gate_results,  # noqa: E402
                            score_party_tones, source_articles)
from validate_party_tone_reference import validate  # noqa: E402

SECOND_ADJUDICATOR_MIN_PAIRS = 50


def parse_candidate(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("candidate must be MODEL=ANALYSIS_DIR")
    name, path = value.split("=", 1)
    if not name or not path:
        raise argparse.ArgumentTypeError("candidate must be MODEL=ANALYSIS_DIR")
    return name, Path(path)


def load_run_metadata(path: Path) -> dict:
    """Read optional benchmark metadata emitted beside a model run."""
    meta = path / "run.json"
    if not meta.exists():
        return {}
    try:
        value = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"metadata_error": "unreadable_run_json"}
    return value if isinstance(value, dict) else {"metadata_error": "not_object"}


def benchmark(reference: dict, candidates: list[tuple[str, Path]]) -> list[dict]:
    rows = []
    for name, path in candidates:
        analyses = load_set(path)
        metrics = score_party_tones(reference, analyses,
                                    source_articles(reference, analyses))
        meta = load_run_metadata(path)
        completion = {
            "before_retry": meta.get("valid_schema_before_retry"),
            "after_review": meta.get("valid_schema_after_review"),
        }
        rows.append({
            "model": name,
            "analysis_dir": str(path),
            "reference_records": len(reference),
            "hypothesis_records": len(analyses),
            "party_tones": metrics,
            "release_gates": party_release_gate_results(metrics, completion),
            "operations": {
                "end_to_end_seconds": meta.get("end_to_end_seconds"),
                "latency_ms": meta.get("latency_ms"),
                "prompt_tokens": meta.get("prompt_tokens"),
                "completion_tokens": meta.get("completion_tokens"),
                "retries": meta.get("retries"),
                "refusals": meta.get("refusals"),
                "cost_usd": meta.get("cost_usd"),
            },
        })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--candidate", action="append", type=parse_candidate,
                    required=True, metavar="MODEL=DIR")
    ap.add_argument("--second-adjudicator", default=None,
                    help="independent adjudicator directory")
    ap.add_argument("--supplement", default=None,
                    help="selected supplement with immutable article hashes")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    reference = load_set(Path(args.ref))
    if not reference:
        print(json.dumps({"error": "empty_reference"}))
        return 2
    if args.supplement:
        try:
            reference_package = validate(
                Path(args.supplement), Path(args.ref),
                Path(args.second_adjudicator) if args.second_adjudicator else None)
        except ValueError as exc:
            print(json.dumps({"error": str(exc)}))
            return 2
    else:
        reference_package = {"validated": False,
                             "why": "--supplement is required for a release evaluation"}
    doc = {
        "reference": args.ref,
        "models": benchmark(reference, args.candidate),
        "no_overall_model_score": True,
        "selection_rule": (
            "eligible only when every party-tone gate passes; then compare "
            "cost and latency without trading accuracy away"),
        "reference_package": reference_package,
    }
    if args.second_adjudicator:
        second = load_set(Path(args.second_adjudicator))
        agreement = score_party_tones(reference, second,
                                     source_articles(reference, second))
        pairs = agreement["tones"]["n"]
        doc["independent_adjudication"] = {
            "directory": args.second_adjudicator,
            "party_pairs": pairs,
            "minimum_party_pairs": SECOND_ADJUDICATOR_MIN_PAIRS,
            "minimum_met": pairs >= SECOND_ADJUDICATOR_MIN_PAIRS,
            "agreement": agreement,
        }
    else:
        doc["independent_adjudication"] = {
            "party_pairs": 0,
            "minimum_party_pairs": SECOND_ADJUDICATOR_MIN_PAIRS,
            "minimum_met": False,
            "missing": True,
        }
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
