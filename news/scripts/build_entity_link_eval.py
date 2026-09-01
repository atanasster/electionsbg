#!/usr/bin/env python3
"""Build a blinded entity/link benchmark-v2 adjudication manifest."""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
sys.path.insert(0, str(ROOT))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_gold_set as gold  # noqa: E402
import resolve_mentions as rm  # noqa: E402
from news.eval_contract.canonical import canonical_json, canonical_sha256  # noqa: E402

NEWS_DATA = ROOT / "news" / "data"
DEFAULT_OUT = NEWS_DATA / "gold" / "entity_link_supplement_v2.json"
DEFAULT_AUDIT_OUT = (NEWS_DATA / "evals" / "entity-link-benchmark" /
                     "sampling-audit-v2.json")
DEFAULT_TARGET_REGISTRY = ROOT / "news" / "app-data" / "feedback-targets.json"
MIN_SIZE = 100
MAX_DATE_BUCKET_SHARE = 0.50

TARGET_SHARE = {
    "linked_person": 0.20,
    "linked_party": 0.15,
    "linked_institution": 0.15,
    "company_candidate": 0.10,
    "linked_settlement": 0.15,
    "ambiguous_refusal": 0.15,
    "sector_context": 0.10,
}
SECTOR_RE = re.compile(
    r"(?i)\b(образовани|училищ|здравеопаз|болниц|енергет|транспорт|"
    r"земедел|култур|отбран|правосъд|социалн|администраци)\w*", re.UNICODE)


def grounding_sha256(article: dict) -> str:
    return canonical_sha256({key: article.get(key) for key in
                             ("url", "title", "description", "content")})


def rank_key(entry: dict, seed: str) -> str:
    return hashlib.sha256(f"{seed}:{entry['url']}".encode()).hexdigest()


def date_bucket(value) -> str:
    value = str(value or "")
    return value[:7] if re.fullmatch(r"\d{4}-\d{2}.*", value) else "undated"


def sampling_signals(body: str, entities: dict, links: dict,
                     mentions: list[dict]) -> set[str]:
    """Private stratum signals. They never enter the adjudicator manifest."""
    signals = set()
    buckets = {"people": "person", "parties": "party",
               "institutions": "institution", "companies": "company",
               "places": "settlement"}
    for bucket, kind in buckets.items():
        for surface in entities.get(bucket) or []:
            if isinstance(links.get(surface), dict):
                signals.add(f"linked_{kind}")
            if kind == "company":
                signals.add("company_candidate")
    if any(not mention.get("id") and mention.get("candidates")
           for mention in mentions):
        signals.add("ambiguous_refusal")
    if SECTOR_RE.search(body):
        signals.add("sector_context")
    return signals & set(TARGET_SHARE)


def select(entries: list[dict], size: int,
           seed: str) -> tuple[list[dict], dict, dict]:
    pools = defaultdict(list)
    prevalence = Counter()
    for entry in entries:
        signals = set(entry["sampling_signals"])
        prevalence.update(signals)
        for signal in signals:
            pools[signal].append(entry)
    selected, used = [], set()
    by_date = Counter()
    date_cap = max(1, int(size * MAX_DATE_BUCKET_SHARE))
    report = {}
    for cell, share in TARGET_SHARE.items():
        want = round(size * share)
        take = []
        for entry in sorted(pools[cell], key=lambda row: rank_key(row, seed + cell)):
            bucket = entry["date_bucket"]
            if entry["path"] in used or by_date[bucket] >= date_cap:
                continue
            take.append(entry)
            used.add(entry["path"])
            by_date[bucket] += 1
            if len(take) == want:
                break
        report[cell] = {"target": want, "available": len(pools[cell]),
                        "taken": len(take),
                        "signal_prevalence": prevalence[cell]}
        if len(take) != want:
            raise ValueError(f"entity_link_cell_underfilled:{cell}:{len(take)}/{want}")
        selected.extend({**entry, "drawn_for": cell} for entry in take)
    if len(selected) != size or len({entry["path"] for entry in selected}) != size:
        raise ValueError("entity_link_selection_size_or_uniqueness_failure")
    return selected, report, dict(sorted(by_date.items()))


def scan(news_data: Path, gazetteer: rm.Gazetteer) -> tuple[list[dict], int]:
    entries, scanned = [], 0
    for domain_dir in sorted(news_data.iterdir()):
        if not gold.is_corpus_dir(domain_dir):
            continue
        for path in sorted(domain_dir.glob("*.json")):
            try:
                article = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            scanned += 1
            url = article.get("url")
            if not isinstance(url, str) or not url:
                continue
            analysis_path = (news_data / "analysis" / "articles" /
                             domain_dir.name / path.name)
            try:
                analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            entities = analysis.get("entities") or {}
            if not isinstance(entities, dict):
                continue
            body = rm.article_text(article)
            mentions = rm.dedupe(rm.resolve(body, gazetteer))
            links = rm.entity_links(entities, gazetteer, context_text=body)
            signals = sampling_signals(body, entities, links, mentions)
            if not signals:
                continue
            entries.append({
                "path": f"news/data/{domain_dir.name}/{path.name}",
                "domain": domain_dir.name,
                "url": url,
                "published": article.get("published"),
                "date_bucket": date_bucket(article.get("published")),
                "grounding_sha256": grounding_sha256(article),
                "sampling_signals": sorted(signals),
            })
    return entries, scanned


def _target_registry(path: Path) -> dict:
    document = json.loads(path.read_text(encoding="utf-8"))
    targets = document.get("targets")
    if document.get("version") != 1 or not isinstance(targets, list) or \
            document.get("target_count") != len(targets) or \
            document.get("targets_sha256") != canonical_sha256(targets):
        raise ValueError("entity_link_target_registry_invalid")
    return document


def build_manifest(selected: list[dict], *, seed: str, generated_at: str,
                   registry_hash: str) -> tuple[dict, str]:
    selection_binding = [{"path": item["path"], "url": item["url"],
                          "grounding_sha256": item["grounding_sha256"]}
                         for item in sorted(selected, key=lambda row: row["url"])]
    blinded_run_id = canonical_sha256({"seed": seed,
                                       "target_registry_sha256": registry_hash,
                                       "articles": selection_binding})
    articles = [{
        "blind_id": canonical_sha256({"blinded_run_id": blinded_run_id,
                                      "url": item["url"]}),
        "path": item["path"],
        "url": item["url"],
        "grounding_sha256": item["grounding_sha256"],
    } for item in selection_binding]
    return ({
        "schema_version": 1,
        "benchmark": "news-entity-links-v2",
        "version": 2,
        "generated_at": generated_at,
        "seed": seed,
        "blinded_run_id": blinded_run_id,
        "target_registry_sha256": registry_hash,
        "requested_size": len(articles),
        "actual_size": len(articles),
        "articles": articles,
    }, blinded_run_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, default=MIN_SIZE)
    parser.add_argument("--seed", default="naiasno-entity-link-v2")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--audit-out", default=str(DEFAULT_AUDIT_OUT))
    parser.add_argument("--target-registry", default=str(DEFAULT_TARGET_REGISTRY))
    args = parser.parse_args()
    if args.size != MIN_SIZE:
        print(json.dumps({"error": "entity_link_v2_size_must_equal_fixed_cell_total",
                          "required": MIN_SIZE}))
        return 2
    try:
        registry = _target_registry(Path(args.target_registry))
        gazetteer_path = NEWS_DATA / "gazetteer.json"
        if not gazetteer_path.exists():
            raise ValueError("missing_gazetteer")
        entries, scanned = scan(NEWS_DATA, rm.Gazetteer.load(gazetteer_path))
        chosen, cells, dates = select(entries, args.size, args.seed)
        generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        manifest, blinded_run_id = build_manifest(
            chosen, seed=args.seed, generated_at=generated_at,
            registry_hash=registry["targets_sha256"])
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(manifest) + "\n", encoding="utf-8")
    audit = {
        "schema_version": 1,
        "audit_kind": "news-entity-links-v2-private-sampling",
        "blinded_run_id": blinded_run_id,
        "target_registry_sha256": registry["targets_sha256"],
        "generated_at": generated_at,
        "corpus_scanned": scanned,
        "cells": cells,
        "date_buckets": dates,
        "articles": [{"blind_id": next(
            row["blind_id"] for row in manifest["articles"]
            if row["url"] == item["url"]),
            "path": item["path"], "drawn_for": item["drawn_for"],
            "sampling_signals": item["sampling_signals"]}
            for item in chosen],
    }
    audit_output = Path(args.audit_out)
    audit_output.parent.mkdir(parents=True, exist_ok=True)
    audit_output.write_text(canonical_json(audit) + "\n", encoding="utf-8")
    os.chmod(audit_output, 0o600)
    print(json.dumps({"out": str(output), "sampling_audit": str(audit_output),
                      "size": len(chosen), "scanned": scanned,
                      "outlets": len({item["domain"] for item in chosen}),
                      "cells": {key: value["taken"]
                                for key, value in cells.items()}},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
