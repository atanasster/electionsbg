#!/usr/bin/env python3
"""Build the balanced party-tone diagnostic supplement.

The output contains candidate articles and sampling signals, never sentiment
labels. It is intentionally balanced for diagnosis and must not be presented
as the prevalence of party coverage in the news corpus.
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_gold_set as gold  # noqa: E402
import resolve_mentions as rm  # noqa: E402

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
NEWS_DATA = ROOT / "news" / "data"
DEFAULT_OUT = NEWS_DATA / "gold" / "party_tone_supplement_v1.json"
MIN_SIZE = 80
MAX_DATE_BUCKET_SHARE = 0.50

# These are selection signals, not judgments. They ensure the adjudicators see
# hard discourse shapes instead of eighty easy press-release mentions.
ATTACK_RE = re.compile(
    r"(?i)(обвини|нападна|критикува|лъж[ае]|скандал|провал|корупц|"
    r"предател|безобраз|винов|атакува)", re.UNICODE)
QUOTE_RE = re.compile(r"[„“\"].{8,}?[“”\"]", re.DOTALL)
COALITION_RE = re.compile(
    r"(?i)(коалици|обединени|съюз|партньор|управляващото мнозинство)", re.UNICODE)

TARGET_SHARE = {
    "ambiguous_alias": 0.10,
    "multi_party": 0.25,
    "quoted_attack": 0.20,
    "coalition": 0.15,
    "single_party": 0.30,
}


def rank_key(entry: dict, seed: str) -> str:
    value = entry.get("url") or entry["path"]
    return hashlib.sha256(f"{seed}:{value}".encode()).hexdigest()


def party_mentions(mentions: list[dict]) -> list[dict]:
    return [m for m in mentions if m.get("kind") == "party"]


def sampling_signals(body: str, parties: list[dict]) -> set[str]:
    resolved = {m.get("id") for m in parties if m.get("id")}
    out = set()
    if any(not m.get("id") and m.get("candidates") for m in parties):
        out.add("ambiguous_alias")
    if len(resolved) >= 2:
        out.add("multi_party")
    elif len(resolved) == 1:
        out.add("single_party")
    if ATTACK_RE.search(body) and QUOTE_RE.search(body):
        out.add("quoted_attack")
    if COALITION_RE.search(body):
        out.add("coalition")
    return out


def primary_cell(signals: set[str]) -> str | None:
    for name in TARGET_SHARE:
        if name in signals:
            return name
    return None


def date_bucket(value) -> str:
    """Publication month, with undated records visible rather than guessed."""
    value = str(value or "")
    return value[:7] if re.fullmatch(r"\d{4}-\d{2}.*", value) else "undated"


def select(entries: list[dict], size: int, seed: str) -> tuple[list[dict], dict, dict]:
    pools = defaultdict(list)
    prevalence = Counter()
    for entry in entries:
        signals = set(entry["sampling_signals"])
        prevalence.update(signals)
        cell = primary_cell(signals)
        if cell:
            pools[cell].append(entry)

    selected = []
    used = set()
    by_date = Counter()
    date_cap = max(1, int(size * MAX_DATE_BUCKET_SHARE))
    report = {}
    for cell, share in TARGET_SHARE.items():
        want = round(size * share)
        pool = sorted(pools[cell], key=lambda e: rank_key(e, seed))
        take = []
        for entry in pool:
            bucket = entry["date_bucket"]
            if entry["path"] in used or by_date[bucket] >= date_cap:
                continue
            take.append(entry)
            by_date[bucket] += 1
            if len(take) == want:
                break
        selected.extend({**e, "drawn_for": cell} for e in take)
        used.update(e["path"] for e in take)
        report[cell] = {"target": want, "available": len(pool),
                        "taken": len(take),
                        "signal_prevalence": prevalence[cell]}

    # A short rare cell is visible in the report, but need not shrink the
    # entire diagnostic set. Top up from other party-bearing articles while
    # retaining `drawn_for=top_up`; this does not pretend the quota was met.
    if len(selected) < size:
        rest = sorted((e for e in entries if e["path"] not in used and
                       by_date[e["date_bucket"]] < date_cap),
                      key=lambda e: rank_key(e, seed + ":top-up"))
        for entry in rest[:size - len(selected)]:
            selected.append({**entry, "drawn_for": "top_up"})
            by_date[entry["date_bucket"]] += 1
    return selected, report, dict(sorted(by_date.items()))


def scan(news_data: Path, gazetteer: rm.Gazetteer) -> tuple[list[dict], int]:
    entries = []
    scanned = 0
    for domain_dir in sorted(news_data.iterdir()):
        if not gold.is_corpus_dir(domain_dir):
            continue
        for path in sorted(domain_dir.glob("*.json")):
            try:
                rec = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            scanned += 1
            body = rm.article_text(rec)
            mentions = party_mentions(rm.dedupe(rm.resolve(body, gazetteer)))
            signals = sampling_signals(body, mentions)
            if not mentions or not signals:
                continue
            entries.append({
                "path": f"news/data/{domain_dir.name}/{path.name}",
                "domain": domain_dir.name,
                "url": rec.get("url"),
                "title": rec.get("title"),
                "published": rec.get("published"),
                "date_bucket": date_bucket(rec.get("published")),
                "content_sha256": hashlib.sha256(
                    (rec.get("content") or "").encode("utf-8")).hexdigest(),
                "party_candidates": [{k: m.get(k) for k in
                                      ("surface", "id", "basis", "candidates")
                                      if m.get(k) is not None} for m in mentions],
                "sampling_signals": sorted(signals),
            })
    return entries, scanned


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=MIN_SIZE)
    ap.add_argument("--seed", default="naiasno-party-tone-v1")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if args.size < MIN_SIZE:
        print(json.dumps({"error": "size_below_minimum", "minimum": MIN_SIZE}))
        return 2
    gaz_path = NEWS_DATA / "gazetteer.json"
    if not gaz_path.exists():
        print(json.dumps({"error": "missing_gazetteer", "path": str(gaz_path)}))
        return 2
    entries, scanned = scan(NEWS_DATA, rm.Gazetteer.load(gaz_path))
    chosen, cells, dates = select(entries, args.size, args.seed)
    if len(chosen) < args.size:
        print(json.dumps({"error": "insufficient_party_articles",
                          "requested": args.size, "available": len(chosen)}))
        return 2
    doc = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seed": args.seed,
        "requested_size": args.size,
        "actual_size": len(chosen),
        "corpus_scanned": scanned,
        "party_candidates_available": len(entries),
        "purpose": "intentionally balanced party-tone diagnostic supplement",
        "not_corpus_prevalence": True,
        "sampling_signals_are_not_labels": True,
        "required_adjudication": {
            "primary": "all selected articles",
            "independent_second_adjudicator_party_pairs_minimum": 50,
        },
        "cells": cells,
        "date_buckets": dates,
        "date_bucket_cap": date_cap if (date_cap := max(1, int(args.size * MAX_DATE_BUCKET_SHARE))) else 0,
        "articles": chosen,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    summary = {"out": str(out), "size": len(chosen), "scanned": scanned,
               "candidates": len(entries),
               "outlets": len({e["domain"] for e in chosen}),
               "cells": {k: v["taken"] for k, v in cells.items()},
               "date_buckets": dates}
    print(json.dumps(summary, ensure_ascii=False,
                     indent=None if args.json else 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
