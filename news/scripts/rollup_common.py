#!/usr/bin/env python3
"""Helpers shared by the party (T4.2) and person (T4.4) rollups.

Both modules answer the same question about a different subject — „how much
coverage is there, over what window, and what is left out" — so the parts
where one of them already carries the scar tissue live here rather than being
re-derived by the other."""
from __future__ import annotations

from datetime import datetime, timezone

# How many article rows an archive page carries. Both rollups paginate: the
# largest party shipped 147 KB unbounded and the first person shard 99 KB, and
# both grow with the CORPUS rather than with the number of subjects.
ARCHIVE_PAGE_SIZE = 50


def published_key(row: dict):
    """⚠️ Order on the INSTANT, not the string: the corpus carries both
    `+00:00` and `Z` offsets, which string-sort against each other wrongly. A
    row with no date sorts as the oldest and is counted as `undated`."""
    value = row.get("published")
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return (0, datetime.min.replace(tzinfo=timezone.utc))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (1, parsed)


def extend_window(entry: dict, published) -> None:
    """Widen `first_published`/`last_published` by INSTANT, counting a row
    with no date as `undated` rather than silently leaving it outside a window
    the page presents as covering everything."""
    if not published:
        entry["undated"] = entry.get("undated", 0) + 1
        return
    key = published_key({"published": published})
    for field, better in (("first_published", lambda a, b: a < b),
                          ("last_published", lambda a, b: a > b)):
        current = entry.get(field)
        if not current or better(key, published_key({"published": current})):
            entry[field] = published


def page_of(rows: list, page: int, page_size: int = ARCHIVE_PAGE_SIZE):
    """`(page, total_pages, window)` — the page clamped into range, so an
    out-of-range request serves a real page rather than an empty one."""
    total_pages = max(1, -(-len(rows) // page_size))
    page = min(max(page, 1), total_pages)
    return page, total_pages, rows[(page - 1) * page_size: page * page_size]
