#!/usr/bin/env python3
"""Find review candidates on Wikimedia Commons for analyzed news articles.

This never changes article records and never grants display permission. It
records Commons metadata for a human visual/relevance review; a separate
curated overrides file is the only input the backfill applier accepts.
"""

import argparse
import html
import json
import os
import random
import re
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from .commons_rights import LICENCE_URLS, canonical_licence_url
except ImportError:  # direct script execution
    from commons_rights import LICENCE_URLS, canonical_licence_url

API = "https://commons.wikimedia.org/w/api.php"
# An outlet-supplied image without a recorded reuse basis is just as
# unavailable to the home page as no image at all. Search Commons for a
# replacement in both cases; the human selection + apply step remains the
# only authority that can make either one displayable.
COMMONS_REPLACEMENT_REASONS = frozenset({"missing_image", "missing_review"})


def needs_commons_replacement(item: dict) -> bool:
    return item.get("reason") in COMMONS_REPLACEMENT_REASONS


def plain(value: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", html.unescape(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def commons_search(term: str, *, limit: int = 8,
                   attempt_budget: int = 3) -> tuple[list[dict], int]:
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search",
        "gsrnamespace": 6, "gsrsearch": f"filetype:bitmap {term}",
        "gsrlimit": limit, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": 640,
    })
    request = urllib.request.Request(
        f"{API}?{params}", headers={
            "User-Agent": "NaiasnoImageReview/1.0 (https://electionsbg.com; editorial image review)",
            "Accept": "application/json",
        }
    )
    cafile = Path("/etc/ssl/cert.pem")
    context = ssl.create_default_context(cafile=str(cafile) if cafile.exists() else None)
    attempts = 0
    for attempt in range(min(3, attempt_budget)):
        attempts += 1
        try:
            with urllib.request.urlopen(request, timeout=30, context=context) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as exc:
            if (exc.code not in {429, 500, 502, 503, 504}
                    or attempt + 1 >= min(3, attempt_budget)):
                raise
            raw_retry = exc.headers.get("Retry-After", "")
            delay = int(raw_retry) if raw_retry.isdigit() else 2 ** attempt
            time.sleep(min(delay, 30) + random.random())
        except (urllib.error.URLError, TimeoutError):
            if attempt + 1 >= min(3, attempt_budget):
                raise
            time.sleep(2 ** attempt + random.random())
    else:
        return [], 0
    candidates = []
    for page in (payload.get("query", {}).get("pages", {}) or {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        licence = plain((meta.get("LicenseShortName") or {}).get("value"))
        licence_url = plain((meta.get("LicenseUrl") or {}).get("value"))
        canonical = canonical_licence_url(licence)
        if licence not in LICENCE_URLS or not licence_url or not canonical:
            continue
        candidates.append({
            "file_title": page.get("title"),
            "image_url": info.get("url"),
            "thumbnail_url": info.get("thumburl") or info.get("url"),
            "source_url": info.get("descriptionurl"),
            "creator": plain((meta.get("Artist") or {}).get("value")) or None,
            "credit": plain((meta.get("Credit") or {}).get("value")),
            "licence_name": licence,
            "licence_url": canonical,
        })
    return (sorted(candidates, key=lambda item: (
        item["file_title"] or "", item["source_url"] or "")), attempts)


def search_term(analysis: dict, title: str) -> str:
    entities = analysis.get("entities") or {}
    for group in ("people", "places", "institutions"):
        values = entities.get(group) or []
        if values:
            return values[0]
    return " ".join((title or "").split()[:7])


def search_cache_key(term: str) -> str:
    """Collapse equivalent article queries onto one persistent cache key."""
    return re.sub(r"\s+", " ", term).strip().casefold()


def load_search_cache(previous: dict) -> dict[str, dict]:
    """Read v2 query cache, migrating successful v1 article candidates."""
    cache = {}
    raw = previous.get("search_cache")
    if isinstance(raw, dict):
        for key, value in raw.items():
            if (isinstance(key, str) and isinstance(value, dict)
                    and isinstance(value.get("term"), str)
                    and isinstance(value.get("candidates"), list)):
                cache[key] = value
    for item in previous.get("items", []):
        if (not isinstance(item, dict)
                or not isinstance(item.get("search_term"), str)
                or not isinstance(item.get("candidates"), list)):
            continue
        key = search_cache_key(item["search_term"])
        cache.setdefault(key, {
            "term": item["search_term"],
            "candidates": item["candidates"],
        })
    return cache


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("news/data"))
    parser.add_argument("--queue", type=Path,
                        default=Path("news/review/image_rights_queue.json"))
    parser.add_argument("--out", type=Path,
                        default=Path("news/review/commons_candidates.json"))
    parser.add_argument("--limit", type=int, default=24)
    parser.add_argument("--max-requests", type=int, default=80)
    parser.add_argument("--overrides", type=Path,
                        default=Path("news/config/commons_search_overrides.json"))
    args = parser.parse_args()
    if args.limit < 1 or args.max_requests < 0:
        parser.error("--limit must be positive and --max-requests non-negative")
    queue = json.loads(args.queue.read_text())
    overrides = json.loads(args.overrides.read_text()) if args.overrides.exists() else {}
    previous = ({"items": [], "attempted_total": 0}
                if not args.out.exists() else json.loads(args.out.read_text()))
    previous_items = {
        item.get("article_id"): item
        for item in previous.get("items", [])
        if isinstance(item, dict) and isinstance(item.get("article_id"), str)
    }
    search_cache = load_search_cache(previous)
    analyses = {}
    for path in args.data_dir.glob("analysis/articles/*/*.json"):
        record = json.loads(path.read_text())
        analyses[(record.get("domain"), record.get("url"))] = record
    new_items = []
    attempted = 0
    cache_hits = 0
    superseded_ids = set()
    for item in queue["items"]:
        if not needs_commons_replacement(item):
            continue
        analysis = analyses.get((item["domain"], item["article_url"]))
        if not analysis or analysis.get("site_relevant") is not True:
            continue
        term = overrides.get(item["id"], search_term(analysis, item["title"] or ""))
        key = search_cache_key(term)
        old = previous_items.get(item["id"])
        if old and search_cache_key(old.get("search_term") or "") == key:
            continue
        if len(new_items) >= args.limit:
            break
        if key in search_cache:
            found = search_cache[key]["candidates"]
            cache_hits += 1
        else:
            if attempted >= args.max_requests:
                continue
            found, requests = commons_search(
                term, attempt_budget=args.max_requests - attempted)
            attempted += requests
            search_cache[key] = {"term": term, "candidates": found}
            time.sleep(0.5)
        superseded_ids.add(item["id"])
        if found:
            new_items.append({"article_id": item["id"],
                              "article_path": item["article_path"],
                              "title": item["title"], "search_term": term,
                              "candidates": found})
    live_ids = {
        item["id"] for item in queue["items"]
        if needs_commons_replacement(item)
    }
    merged = {
        **{key: value for key, value in previous_items.items()
           if key in live_ids and key not in superseded_ids},
        **{item["article_id"]: item for item in new_items},
    }
    queue_order = {item["id"]: index for index, item in enumerate(queue["items"])}
    output = sorted(merged.values(), key=lambda item: (
        queue_order.get(item["article_id"], len(queue_order)), item["article_id"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps({
        "version": 2,
        "attempted_this_run": attempted,
        "attempted_total": int(previous.get("attempted_total")
                               or previous.get("attempted") or 0) + attempted,
        "new_candidate_sets": len(new_items),
        "cache_hits_this_run": cache_hits,
        "search_cache": search_cache,
        "items": output,
    }, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.out.parent,
                                     delete=False) as handle:
        handle.write(rendered)
        temporary = Path(handle.name)
    os.replace(temporary, args.out)
    print(json.dumps({
        "mode": "commons_image_candidates",
        "attempted": attempted,
        "new_candidate_sets": len(new_items),
        "candidate_sets_total": len(output),
        "cache_hits": cache_hits,
        "cached_queries": len(search_cache),
        "out": str(args.out),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
