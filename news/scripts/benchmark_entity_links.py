#!/usr/bin/env python3
"""Benchmark extracted entities and canonical links on reference v2."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from score_analyses import (entity_link_release_gate_results,  # noqa: E402
                            score_entity_links, source_articles)
from validate_entity_link_reference import load_supplement, validate  # noqa: E402


def parse_candidate(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("candidate must be MODEL=ANALYSIS_DIR")
    name, path = value.split("=", 1)
    if not name or not path:
        raise argparse.ArgumentTypeError("candidate must be MODEL=ANALYSIS_DIR")
    return name, Path(path)


def _reference_as_hypothesis(rows: dict) -> dict:
    """Project independent v2 labels into the analyzer mention shape."""
    return {url: {
        "url": url,
        "mentions": [{
            "kind": item["kind"],
            "surface": item["surface"],
            "id": item["target_id"],
        } for item in row.get("entity_links", [])],
    } for url, row in rows.items()}


def load_run_metadata(path: Path) -> dict:
    try:
        value = json.loads((path / "run.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError):
        return {"metadata_error": "unreadable_run_json"}
    return value if isinstance(value, dict) else {"metadata_error": "not_object"}


def load_strict_set(path: Path, *, allow_extra_without_url: bool = False) -> dict:
    """Fail on unreadable or duplicate candidate/reference records."""
    rows = {}
    files = sorted(path.glob("*/*.json")) + sorted(path.glob("*.json"))
    for file in files:
        if file.name in {"run.json", "_manifest.json"}:
            continue
        try:
            row = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"unreadable_benchmark_record:{file}") from exc
        url = row.get("url") if isinstance(row, dict) else None
        if not isinstance(url, str) or not url:
            if allow_extra_without_url:
                continue
            raise ValueError(f"benchmark_record_missing_url:{file}")
        if url in rows:
            raise ValueError(f"duplicate_benchmark_url:{url}")
        rows[url] = row
    return rows


def benchmark(reference: dict,
              candidates: list[tuple[str, Path]]) -> list[dict]:
    rows = []
    for name, path in candidates:
        hypothesis = load_strict_set(path)
        metrics = score_entity_links(reference, hypothesis,
                                     source_articles(reference, hypothesis))
        metadata = load_run_metadata(path)
        rows.append({
            "model": name,
            "analysis_dir": str(path),
            "reference_records": len(reference),
            "hypothesis_records": len(hypothesis),
            "entity_links_v2": metrics,
            "release_gates": entity_link_release_gate_results(metrics),
            "operations": {
                "end_to_end_seconds": metadata.get("end_to_end_seconds"),
                "latency_ms": metadata.get("latency_ms"),
                "prompt_tokens": metadata.get("prompt_tokens"),
                "completion_tokens": metadata.get("completion_tokens"),
                "retries": metadata.get("retries"),
                "refusals": metadata.get("refusals"),
                "cost_usd": metadata.get("cost_usd"),
            },
        })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--supplement", required=True)
    parser.add_argument("--original-primary", required=True)
    parser.add_argument("--primary", required=True)
    parser.add_argument("--independent", required=True)
    parser.add_argument("--reconciliation", required=True)
    parser.add_argument("--target-registry")
    parser.add_argument("--candidate", action="append", required=True,
                        type=parse_candidate, metavar="MODEL=DIR")
    parser.add_argument("--out")
    args = parser.parse_args()
    try:
        package = validate(
            Path(args.supplement), Path(args.primary), Path(args.independent),
            Path(args.reconciliation),
            Path(args.target_registry) if args.target_registry else None,
            Path(args.original_primary))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    selected_urls = {item["url"] for item in
                     load_supplement(Path(args.supplement))["articles"]}
    primary = {url: row for url, row in
               load_strict_set(Path(args.primary)).items()
               if url in selected_urls}
    independent = {
        url: row for url, row in load_strict_set(Path(args.independent)).items()
        if url in selected_urls}
    agreement = score_entity_links(primary,
                                   _reference_as_hypothesis(independent))
    try:
        models = benchmark(primary, args.candidate)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    ineligible = [row["model"] for row in models
                  if not row["release_gates"]["passed"]]
    document = {
        "benchmark": "news-entity-links-v2",
        "reference_package": package,
        "independent_adjudication": {
            "directory": args.independent,
            "agreement": agreement,
            "gates": entity_link_release_gate_results(agreement),
        },
        "models": models,
        "ineligible_models": ineligible,
        "no_overall_model_score": True,
        "selection_rule": (
            "a candidate must pass every extraction/link safety gate; cost and "
            "latency are compared only among eligible candidates"),
    }
    text = json.dumps(document, ensure_ascii=False, indent=1)
    if args.out:
        output = Path(args.out)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 3 if ineligible else 0


if __name__ == "__main__":
    sys.exit(main())
