#!/usr/bin/env python3
"""Validate the adjudicated party-tone reference package before a benchmark."""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from score_analyses import load_set, party_items  # noqa: E402

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
MIN_ARTICLES = 80
MIN_INDEPENDENT_PAIRS = 50


def valid_v2_party_contract(row: dict) -> bool:
    parties = ((row.get("entities") or {}).get("parties") or [])
    raw_tones = row.get("party_tones") or []
    tones = party_items(row)
    return (row.get("party_tones_version") == 2 and
            set(parties) == {item.get("party") for item in raw_tones
                             if isinstance(item, dict)} and
            len(tones) == len(raw_tones))


def load_supplement(path: Path) -> dict:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable_supplement:{exc}") from exc
    articles = doc.get("articles")
    if doc.get("version") != 1 or not isinstance(articles, list):
        raise ValueError("invalid_supplement_shape")
    if len(articles) < MIN_ARTICLES:
        raise ValueError("supplement_below_minimum")
    return doc


def validate(supplement_path: Path, primary_dir: Path,
             independent_dir: Path | None = None) -> dict:
    supplement = load_supplement(supplement_path)
    selected = {}
    for item in supplement["articles"]:
        path = item.get("path")
        url = item.get("url")
        expected_hash = item.get("content_sha256")
        if not isinstance(path, str) or not isinstance(url, str) or \
                not isinstance(expected_hash, str):
            raise ValueError("supplement_missing_url_path_or_content_hash")
        try:
            article = json.loads((ROOT / path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"supplement_article_unreadable:{path}") from exc
        actual = hashlib.sha256((article.get("content") or "").encode()).hexdigest()
        if article.get("url") != url or actual != expected_hash:
            raise ValueError(f"supplement_article_changed:{path}")
        selected[url] = item
    primary = load_set(primary_dir)
    missing = sorted(set(selected) - set(primary))
    if missing:
        raise ValueError(f"primary_missing_selected_articles:{len(missing)}")
    invalid = []
    primary_pairs = set()
    for url in selected:
        row = primary[url]
        if row.get("party_tones_version") != 2:
            invalid.append(url)
            continue
        tones = party_items(row)
        # A selected ambiguous alias can correctly adjudicate to no party at
        # all. v2's contract is exact coverage, not "every candidate must
        # become a party claim"; otherwise the diagnostic set biases labels
        # toward false positives and makes refusal impossible to score.
        if not valid_v2_party_contract(row):
            invalid.append(url)
            continue
        primary_pairs.update((url, party) for party in tones)
    if invalid:
        raise ValueError(f"primary_missing_v2_party_labels:{len(invalid)}")
    result = {"selected_articles": len(selected),
              "primary_party_pairs": len(primary_pairs),
              "primary_complete": True}
    if independent_dir is not None:
        independent = load_set(independent_dir)
        pairs = {(url, party) for url in selected if url in independent
                 for party in party_items(independent[url])}
        overlap = pairs & primary_pairs
        result["independent_party_pairs"] = len(overlap)
        result["independent_party_pair_minimum"] = MIN_INDEPENDENT_PAIRS
        result["independent_minimum_met"] = len(overlap) >= MIN_INDEPENDENT_PAIRS
        if not result["independent_minimum_met"]:
            raise ValueError("independent_party_pairs_below_minimum")
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--supplement", required=True)
    ap.add_argument("--primary", required=True)
    ap.add_argument("--independent", default=None)
    args = ap.parse_args()
    try:
        print(json.dumps(validate(Path(args.supplement), Path(args.primary),
                                  Path(args.independent) if args.independent else None),
                         ensure_ascii=False))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
