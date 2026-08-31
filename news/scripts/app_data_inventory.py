#!/usr/bin/env python3
"""Canonical inventory for one immutable news app-data tree."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


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
