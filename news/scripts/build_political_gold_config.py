#!/usr/bin/env python3
"""Freeze a reproducible 100-article political slice of the adjudicated gold.

Political means the human reference assigned a real leaning label rather than
`not_applicable`, with quality=ok and site_relevant=true. Selection is
proportional by primary taxonomy category and deterministic within each cell.
Source and reference hashes travel in the config so a later benchmark cannot
quietly run on edited inputs under the old set name.
"""

import argparse
import hashlib
import json
import math
import os
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
REFERENCE = ROOT / "news/data/gold/reference"
DEFAULT_OUT = ROOT / "news/evals/openrouter_political_100_20260829.json"
MODELS = [
    "z-ai/glm-5.3-flash",
    "upstage/solar-pro4",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "nvidia/nemotron-3-super-120b-a12b:free",
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def primary_category(record: dict) -> str | None:
    for topic in record.get("topics") or []:
        if isinstance(topic, dict) and topic.get("primary"):
            return topic.get("category")
    return None


def eligible(reference: dict) -> bool:
    return (
        (reference.get("quality") or {}).get("verdict") == "ok"
        and reference.get("site_relevant") is True
        and (reference.get("leaning") or {}).get("label")
        not in (None, "not_applicable")
        and primary_category(reference) is not None
    )


def allocate(counts: dict[str, int], size: int) -> dict[str, int]:
    """Largest-remainder proportional allocation, capped by cell size."""
    total = sum(counts.values())
    if size > total:
        raise ValueError(f"requested {size} from only {total} eligible records")
    exact = {key: counts[key] * size / total for key in counts}
    out = {key: min(counts[key], math.floor(exact[key])) for key in counts}
    remaining = size - sum(out.values())
    order = sorted(counts, key=lambda key: (-(exact[key] - out[key]), key))
    for key in order:
        if not remaining:
            break
        if out[key] < counts[key]:
            out[key] += 1
            remaining -= 1
    if remaining:
        raise ValueError(f"could not allocate {remaining} records")
    return out


def select(rows: list[dict], size: int, seed: str) -> list[dict]:
    groups = defaultdict(list)
    for row in rows:
        groups[row["category"]].append(row)
    quotas = allocate({key: len(value) for key, value in groups.items()}, size)
    picked = []
    for category in sorted(groups):
        ranked = sorted(groups[category], key=lambda row: hashlib.sha256(
            f"{seed}\0{row['article_path']}".encode("utf-8")).hexdigest())
        picked.extend(ranked[:quotas[category]])
    return sorted(picked, key=lambda row: row["article_path"])


def build(size: int, seed: str) -> dict:
    rows = []
    for ref_path in sorted(REFERENCE.rglob("*.json")):
        reference = json.loads(ref_path.read_text(encoding="utf-8"))
        if not eligible(reference):
            continue
        rel = ref_path.relative_to(REFERENCE)
        article_path = ROOT / "news/data" / rel
        if not article_path.exists():
            raise FileNotFoundError(f"source article missing for {ref_path}")
        rows.append({
            "article_path": str(article_path.relative_to(ROOT)),
            "reference_path": str(ref_path.relative_to(ROOT)),
            "category": primary_category(reference),
            "article_sha256": digest(article_path),
            "reference_sha256": digest(ref_path),
            "party_tone_pairs": len(reference.get("party_tones") or []),
        })
    picked = select(rows, size, seed)
    identity = json.dumps(picked, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":")).encode("utf-8")
    return {
        "version": 1,
        "purpose": "100-article political gate from completed human-adjudicated gold",
        "selection": {
            "seed": seed,
            "criteria": "quality=ok; site_relevant=true; leaning!=not_applicable",
            "eligible": len(rows),
            "selected": len(picked),
            "selection_sha256": hashlib.sha256(identity).hexdigest(),
            "categories": dict(sorted(Counter(
                row["category"] for row in picked).items())),
            "party_tone_labeled_articles": sum(
                row["party_tone_pairs"] > 0 for row in picked),
            "party_tone_pairs": sum(row["party_tone_pairs"] for row in picked),
        },
        "reference_dir": "news/data/gold/reference",
        "reference_kind": "human_adjudicated_gold",
        "score_mentions": True,
        "models": MODELS,
        "articles": [row["article_path"] for row in picked],
        "article_hashes": {row["article_path"]: row["article_sha256"]
                           for row in picked},
        "reference_hashes": {row["reference_path"]: row["reference_sha256"]
                             for row in picked},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=100)
    ap.add_argument("--seed", default="political-gold-v1-20260829")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    value = build(args.size, args.seed)
    rendered = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    out = args.out if args.out.is_absolute() else ROOT / args.out
    if args.check:
        if not out.exists() or out.read_text(encoding="utf-8") != rendered:
            print(json.dumps({"error": "stale_political_gold_config",
                              "path": str(out)}))
            return 1
        print(json.dumps({"status": "ok", **value["selection"]}))
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(rendered, encoding="utf-8")
    print(json.dumps({"written": str(out), **value["selection"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
