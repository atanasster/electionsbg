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


def plain(value: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", html.unescape(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def commons_search(term: str, *, limit: int = 8) -> list[dict]:
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
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30, context=context) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as exc:
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
            raw_retry = exc.headers.get("Retry-After", "")
            delay = int(raw_retry) if raw_retry.isdigit() else 2 ** attempt
            time.sleep(min(delay, 30) + random.random())
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt + random.random())
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
    return sorted(candidates, key=lambda item: (item["file_title"] or "", item["source_url"] or ""))


def search_term(analysis: dict, title: str) -> str:
    entities = analysis.get("entities") or {}
    for group in ("people", "places", "institutions"):
        values = entities.get(group) or []
        if values:
            return values[0]
    return " ".join((title or "").split()[:7])


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
    queue = json.loads(args.queue.read_text())
    overrides = json.loads(args.overrides.read_text()) if args.overrides.exists() else {}
    analyses = {}
    for path in args.data_dir.glob("analysis/articles/*/*.json"):
        record = json.loads(path.read_text())
        analyses[(record.get("domain"), record.get("url"))] = record
    output = []
    attempted = 0
    for item in queue["items"]:
        if item["reason"] != "missing_image":
            continue
        analysis = analyses.get((item["domain"], item["article_url"]))
        if not analysis or analysis.get("site_relevant") is not True:
            continue
        if attempted >= args.max_requests:
            break
        term = overrides.get(item["id"], search_term(analysis, item["title"] or ""))
        attempted += 1
        found = commons_search(term)
        time.sleep(0.5)
        if found:
            output.append({"article_id": item["id"], "article_path": item["article_path"],
                           "title": item["title"], "search_term": term,
                           "candidates": found})
        if len(output) >= args.limit:
            break
    args.out.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps({"version": 1, "attempted": attempted, "items": output},
                          ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.out.parent,
                                     delete=False) as handle:
        handle.write(rendered)
        temporary = Path(handle.name)
    os.replace(temporary, args.out)
    print(f"Commons candidate sets: {len(output)} from {attempted} requests → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
