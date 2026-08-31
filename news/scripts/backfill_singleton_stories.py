#!/usr/bin/env python3
"""Give existing publishable, unclustered analyses safe singleton stories.

This is a one-time/recovery projection for records written before
analyze_local.py made singleton creation the default. It deliberately never
chooses `same_story`: joining two reports is an editorial judgment, while a
one-member story is reversible and loses no information.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
DATA = ROOT / "news" / "data"
ANALYZE = ROOT / "news" / "scripts" / "analyze_articles.py"


def singleton_record(analysis: dict, article: dict,
                     existing_story_id: str | None) -> dict | None:
    if existing_story_id:
        return None
    action = (analysis.get("story") or {}).get("action")
    # Legacy analyses can predate the explicit {"action": "none"} shape.
    # With no indexed membership they are just as safely detached as a newer
    # record that spells out `none`; only an explicit different action blocks
    # the recovery projection.
    if action not in {None, "none"}:
        return None
    if ((analysis.get("quality") or {}).get("verdict") != "ok"
            or analysis.get("site_relevant") is not True):
        return None
    title_bg = str(article.get("title") or analysis.get("summary_bg") or "").strip()
    title_en = str(analysis.get("summary_en") or title_bg).strip()
    summary_bg = str(analysis.get("summary_bg") or "").strip()
    summary_en = str(analysis.get("summary_en") or "").strip()
    if not all((title_bg, title_en, summary_bg, summary_en)):
        return None
    record = copy.deepcopy(analysis)
    # These are stamped by analyze_articles.py after validation. Feeding them
    # back as analyst claims is correctly rejected, so a projection/re-save
    # must return to the raw boundary first.
    for key in ("review", "party_tones_version",
                "party_tone_evidence_gate_version"):
        record.pop(key, None)
    for tone in record.get("party_tones") or []:
        if isinstance(tone, dict):
            tone.pop("party_id", None)
            tone.pop("evidence_grounded", None)
    record["story"] = {
        "action": "new_story",
        "canonical_title_bg": title_bg,
        "canonical_title_en": title_en,
        "summary_bg": summary_bg,
        "summary_en": summary_en,
        "related_story_ids": [],
    }
    return record


def load_candidates(limit: int) -> tuple[list[dict], list[dict]]:
    index = json.loads((DATA / "analysis" / "index.json").read_text(encoding="utf-8"))
    candidates, skipped = [], []
    for path in sorted((DATA / "analysis" / "articles").glob("*/*.json")):
        analysis = json.loads(path.read_text(encoding="utf-8"))
        raw = analysis.get("article_path")
        if not isinstance(raw, str) or not raw.startswith("news/data/"):
            skipped.append({"analysis": str(path), "reason": "invalid_article_path"})
            continue
        article_path = (ROOT / raw).resolve()
        if DATA.resolve() not in article_path.parents or not article_path.is_file():
            skipped.append({"analysis": str(path), "reason": "article_missing"})
            continue
        article = json.loads(article_path.read_text(encoding="utf-8"))
        if (article.get("url") != analysis.get("url")
                or article.get("domain") != analysis.get("domain")):
            skipped.append({"analysis": str(path), "reason": "identity_mismatch"})
            continue
        story_id = (index.get("articles", {}).get(analysis.get("url")) or {}).get(
            "story_id")
        record = singleton_record(analysis, article, story_id)
        if record is not None:
            candidates.append(record)
            if limit and len(candidates) >= limit:
                break
    return candidates, skipped


def save_batch(records: list[dict]) -> dict:
    proc = subprocess.run(
        [sys.executable, str(ANALYZE), "--save-batch", "-"],
        cwd=ROOT, text=True, capture_output=True,
        input=json.dumps(records, ensure_ascii=False),
        env={**os.environ, "DATA_BG_ROOT": str(ROOT)}, check=False,
    )
    try:
        result = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        result = {"error": "non_json_output", "stdout": proc.stdout[:300]}
    if proc.returncode != 0:
        raise RuntimeError(json.dumps({
            "exit": proc.returncode, "result": result,
            "stderr": proc.stderr[:500],
        }, ensure_ascii=False))
    return result


def run_backfill(records: list[dict], skipped: list[dict], *, batch_size: int,
                 dry_run: bool, save=save_batch) -> dict:
    summary = {
        "mode": "backfill_singleton_stories",
        "candidates": len(records),
        "saved": 0,
        "stories_created": 0,
        "skipped_invalid": skipped,
        "dry_run": dry_run,
    }
    if dry_run:
        return summary
    for start in range(0, len(records), batch_size):
        batch = records[start:start + batch_size]
        result = save(batch)
        saved = result.get("saved") or []
        stories = result.get("stories_created") or []
        if len(saved) != len(batch) or len(stories) != len(batch):
            raise RuntimeError(json.dumps({
                "error": "incomplete_backfill_batch",
                "expected": len(batch),
                "saved": len(saved),
                "stories_created": len(stories),
                "result": result,
            }, ensure_ascii=False))
        summary["saved"] += len(saved)
        summary["stories_created"] += len(stories)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0,
                        help="maximum records; 0 means all")
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.limit < 0 or args.batch_size < 1:
        parser.error("--limit must be non-negative and --batch-size positive")

    records, skipped = load_candidates(args.limit)
    summary = run_backfill(records, skipped, batch_size=args.batch_size,
                           dry_run=args.dry_run)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
