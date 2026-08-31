#!/usr/bin/env python3
"""Measure the reviewed-image launch gate against analyzed story coverage."""

import argparse
import hashlib
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    from .build_app_data import image_rights_block, validate_display_image
    from .build_image_rights_queue import build_queue
    from .commons_rights import commons_thumbnail_url
except ImportError:
    from build_app_data import image_rights_block, validate_display_image
    from build_image_rights_queue import build_queue
    from commons_rights import commons_thumbnail_url

MIN_CURRENT = 24
MIN_COMPARISONS = 8
WINDOW_DAYS = 30


def measure(data_dir: Path, selections_path: Path, queue_path: Path,
            *, as_of: date) -> dict:
    selections = json.loads(selections_path.read_text())["selections"]
    queue = json.loads(queue_path.read_text())
    index = json.loads((data_dir / "analysis" / "index.json").read_text())
    by_url = index.get("articles") or {}
    cutoff = datetime.combine(as_of - timedelta(days=WINDOW_DAYS - 1), datetime.min.time(),
                              tzinfo=timezone.utc)
    upper = datetime.combine(as_of + timedelta(days=1), datetime.min.time(),
                             tzinfo=timezone.utc)
    current = []
    story_ids = set()
    missing = []
    seen_ids, seen_paths, seen_urls = set(), set(), set()
    invalid = []
    for selection in selections:
        identity = (selection["article_id"], selection["article_path"],
                    selection["article_url"])
        if any(value in seen for value, seen in zip(
            identity, (seen_ids, seen_paths, seen_urls), strict=True
        )):
            invalid.append(f"duplicate:{selection['article_id']}")
            continue
        seen_ids.add(identity[0]); seen_paths.add(identity[1]); seen_urls.add(identity[2])
        raw = data_dir / selection["article_path"].split("news/data/", 1)[-1]
        if not raw.exists():
            missing.append(selection["article_id"])
            continue
        article = json.loads(raw.read_text())
        expected_id = f"{raw.parent.name}/{raw.stem}"
        if (selection["article_id"] != expected_id
                or selection["article_url"] != article.get("url")):
            invalid.append(f"identity:{selection['article_id']}")
            continue
        try:
            rights = image_rights_block(article.get("image_rights"),
                                        article=selection["article_id"])
            expected_image = commons_thumbnail_url(selection.get("image_url") or "")
            if rights:
                validate_display_image(
                    article.get("image"), rights, article=selection["article_id"]
                )
        except ValueError as exc:
            invalid.append(f"rights:{selection['article_id']}:{exc}")
            continue
        if (not rights or not rights["display_home"]
                or article.get("image") != expected_image
                or rights["source_url"] != selection.get("source_url")):
            invalid.append(f"selection-mismatch:{selection['article_id']}")
            continue
        expected_rights = {
            "status": ("public_domain" if selection.get("licence_name") == "CC0"
                       else "cc"),
            "creator": selection.get("creator"),
            "credit_text": selection.get("credit_text"),
            "credit_url": selection.get("source_url"),
            "licence_name": selection.get("licence_name"),
            "licence_url": selection.get("licence_url"),
            "source_url": selection.get("source_url"),
            "checked_at": selection.get("reviewed_at"),
        }
        if any(rights.get(key) != value for key, value in expected_rights.items()):
            invalid.append(f"attribution-mismatch:{selection['article_id']}")
            continue
        try:
            published = datetime.fromisoformat(article["published"])
        except (KeyError, TypeError, ValueError):
            invalid.append(f"published:{selection['article_id']}")
            continue
        if published.tzinfo is None:
            invalid.append(f"published-timezone:{selection['article_id']}")
            continue
        published = published.astimezone(timezone.utc)
        if cutoff <= published < upper:
            current.append(selection["article_id"])
            story_id = (by_url.get(selection["article_url"]) or {}).get("story_id")
            if story_id:
                story_ids.add(story_id)
    story_domains = {}
    for entry in by_url.values():
        story_id = entry.get("story_id")
        domain = entry.get("domain")
        if story_id and domain:
            story_domains.setdefault(story_id, set()).add(domain)
    comparisons = sorted(story_id for story_id in story_ids
                         if len(story_domains.get(story_id, set())) >= 2)
    rebuilt_queue = build_queue(data_dir)
    queue_current = rebuilt_queue == queue
    checks = {
        "current_items": len(current) >= MIN_CURRENT,
        "comparison_stories": len(comparisons) >= MIN_COMPARISONS,
        "no_invalid_selected_rights": not invalid,
        "all_selections_resolve": not missing,
        "queue_matches_corpus": queue_current,
    }
    return {
        "version": 1, "as_of": as_of.isoformat(), "window_days": WINDOW_DAYS,
        "thresholds": {"current_items": MIN_CURRENT,
                       "comparison_stories": MIN_COMPARISONS,
                       "unknown_or_invalid_rights": 0},
        "measured": {"reviewed_selections": len(selections),
                     "current_items": len(current),
                     "comparison_stories": len(comparisons),
                     "invalid_selected_records": invalid,
                     "unresolved_selections": missing},
        "qualifying_article_ids": sorted(current),
        "comparison_story_ids": comparisons,
        "input_sha256": {
            "selections": hashlib.sha256(selections_path.read_bytes()).hexdigest(),
            "queue": hashlib.sha256(queue_path.read_bytes()).hexdigest(),
            "analysis_index": hashlib.sha256(
                (data_dir / "analysis" / "index.json").read_bytes()).hexdigest(),
        },
        "checks": checks,
        "launch_ready": all(checks.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("news/data"))
    parser.add_argument("--selections", type=Path,
                        default=Path("news/config/commons_image_selections.json"))
    parser.add_argument("--queue", type=Path,
                        default=Path("news/review/image_rights_queue.json"))
    parser.add_argument("--out", type=Path,
                        default=Path("news/review/image_coverage.json"))
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today())
    parser.add_argument("--enforce", action="store_true")
    args = parser.parse_args()
    report = measure(args.data_dir, args.selections, args.queue, as_of=args.as_of)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report["measured"], ensure_ascii=False))
    return 1 if args.enforce and not report["launch_ready"] else 0


if __name__ == "__main__":
    sys.exit(main())
