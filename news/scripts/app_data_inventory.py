#!/usr/bin/env python3
"""Canonical inventory for one immutable news app-data tree."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any


# ⚠️ FILES UNDER `stories/` THAT ARE NOT ONE STORY'S DETAIL. Both live beside
# the ~3,000 `stories/<id>.json` files and both match the detail pattern by
# name, so every walker of `stories/` — the overlay differ, the uploader's
# continuity gate — must go through `is_story_detail_path` or it will read one
# as a story (KeyError on `payload["story"]`, which `retired.json` raised on
# its first build) or report it as a „dropped" story on every publish. They
# are carried WHOLE in an overlay's `replaced_paths`; the client
# (`newsapp/app/overlayMerge.ts`) names the same two.
WHOLE_STORY_FILES = frozenset({"stories/filter-index.json",
                               "stories/retired.json"})
_STORY_PAGE = re.compile(r"^stories/(?:index|ranked)-\d+\.json$")
# ⚠️ A SHARD IS A WHOLE FILE, NOT A STORY. `filter-index-1` matches
# `STORY_ID_SAFE`, so without this it reaches the story-detail arm and
# resolves to a story no release holds — the exact trap the named-file rule
# beside `by-url.json` already documents, one file family over.
_FILTER_SHARD = re.compile(r"^stories/filter-index-\d+\.json$")


def is_filter_index_path(path: str) -> bool:
    """The manifest or one of its shards — carried whole by the overlay."""
    return path == "stories/filter-index.json" or bool(_FILTER_SHARD.match(path))


def is_story_detail_path(path: str) -> bool:
    """Is this `stories/<id>.json` ONE story's detail file? The one rule."""
    # The filter-index family is decided ONCE, by `is_filter_index_path` —
    # `path not in WHOLE_STORY_FILES and not _FILTER_SHARD.match(path)` is
    # the same rule spelled twice, and two copies of it drift by hand.
    return (path.startswith("stories/")
            and path.endswith(".json")
            and not is_filter_index_path(path)
            and path != "stories/retired.json"
            and path != "stories/by-url.json"
            and not _STORY_PAGE.match(path))


def tree_inventory(root: Path) -> dict[str, Any]:
    """Hash every JSON file in path order and reject mixed-content trees."""
    files: list[dict[str, Any]] = []
    total_bytes = 0
    digest = hashlib.sha256()
    paths = sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.name != ".DS_Store"
    )
    unexpected = [
        path.relative_to(root).as_posix()
        for path in paths
        if path.suffix != ".json"
    ]
    if unexpected:
        raise ValueError(
            f"app-data snapshot contains non-JSON files: {unexpected[:3]}"
        )
    for path in paths:
        relative = path.relative_to(root).as_posix()
        body = path.read_bytes()
        file_digest = hashlib.sha256(body).hexdigest()
        files.append({
            "path": relative,
            "bytes": len(body),
            "sha256": file_digest,
        })
        total_bytes += len(body)
        digest.update(f"{relative}\0{len(body)}\0{file_digest}\n".encode())
    if not files:
        raise ValueError("app-data snapshot contains no JSON files")
    return {
        "sha256": digest.hexdigest(),
        "files": len(files),
        "bytes": total_bytes,
        "inventory": files,
    }
