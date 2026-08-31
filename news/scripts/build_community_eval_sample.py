#!/usr/bin/env python3
"""Build a reproducible, non-gold public community-evaluation sample."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import canonical_sha256, content_sha256  # noqa: E402
from news.scripts.sync_eval_tasks import (
    SyncError,
    load_public_articles,
    make_task,
    model_labels,
    primary_topic,
    sealed_article_keys,
)  # noqa: E402
DEFAULT_SELECTION = ROOT / "news/evals/community/community-pilot-v1.selection.json"
DEFAULT_MANIFEST = ROOT / "news/evals/community/community-pilot-v1.manifest.json"
DEFAULT_DATASET_ID = "community-pilot-v1"
DEFAULT_SEED = "community-pilot-v1-20260901"
DEFAULT_SIZE = 120
MAX_SIZE = 200
CELL_SHARES = {
    "multi_party": 0.20,
    "single_party": 0.20,
    "russia_applicable": 0.20,
    "strong_leaning": 0.15,
    "political_other": 0.15,
    "general": 0.10,
}
DRAW_ORDER = (
    "strong_leaning", "multi_party", "single_party", "russia_applicable",
    "political_other", "general",
)
TOP_UP_ORDER = {
    cell: index for index, cell in enumerate(DRAW_ORDER)
}


class SampleError(ValueError):
    """The requested public sample cannot be reproduced safely."""


def rank(seed: str, article_key: str, suffix: str = "") -> str:
    return hashlib.sha256(
        f"{seed}\0{suffix}\0{article_key}".encode("utf-8")
    ).hexdigest()


def month(value: Any) -> str:
    raw = value if isinstance(value, str) else ""
    return raw[:7] if len(raw) >= 7 and raw[4:5] == "-" else "undated"


def sampling_cell(labels: dict[str, Any], analysis: dict[str, Any]) -> str:
    parties = labels["party_tones"]
    entities = analysis.get("entities")
    entity_parties = entities.get("parties") if isinstance(entities, dict) else []
    party_surfaces = {
        value.strip().casefold()
        for value in entity_parties or []
        if isinstance(value, str) and value.strip()
    }
    party_count = max(len(parties), len(party_surfaces))
    if party_count >= 2:
        return "multi_party"
    if party_count == 1:
        return "single_party"
    if labels["russia_stance"] != "not_applicable":
        return "russia_applicable"
    if labels["leaning"] in {"strong_progressive", "strong_conservative"}:
        return "strong_leaning"
    if labels["leaning"] != "not_applicable":
        return "political_other"
    return "general"


def allocate(size: int) -> dict[str, int]:
    exact = {cell: size * share for cell, share in CELL_SHARES.items()}
    quotas = {cell: math.floor(value) for cell, value in exact.items()}
    remaining = size - sum(quotas.values())
    order = sorted(exact, key=lambda cell: (-(exact[cell] - quotas[cell]), cell))
    for cell in order[:remaining]:
        quotas[cell] += 1
    return quotas


def feasible_cap(
    rows: list[dict[str, Any]], field: str, size: int, target_share: float
) -> int:
    """Smallest cap at or above the target that can still fill the sample."""
    counts = Counter(row[field] for row in rows)
    cap = max(1, math.ceil(size * target_share))
    while cap < size and sum(min(count, cap) for count in counts.values()) < size:
        cap += 1
    return cap


def _eligible_rows(
    root: Path,
    public: dict[str, dict[str, Any]],
    sealed: set[str],
    public_revision: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    rows: list[dict[str, Any]] = []
    excluded = Counter()
    revision_time = datetime.fromisoformat(
        public_revision.replace("Z", "+00:00")
    ).astimezone(timezone.utc)
    for key in sorted(public):
        record = public[key]
        if key in sealed:
            excluded["sealed_or_benchmark"] += 1
            continue
        analysis = record.get("analysis")
        if not isinstance(analysis, dict):
            excluded["missing_analysis"] += 1
            continue
        review = analysis.get("human_review")
        if isinstance(review, dict) and review.get("status") == "accepted":
            excluded["already_adjudicated"] += 1
            continue
        published = record.get("published")
        future_published = False
        if published is not None:
            if not isinstance(published, str) or not published:
                excluded["invalid_published_timestamp"] += 1
                continue
            try:
                published_time = datetime.fromisoformat(
                    published.replace("Z", "+00:00")
                )
                if published_time.tzinfo is None:
                    excluded["invalid_published_timestamp"] += 1
                    continue
                future_published = (
                    published_time.astimezone(timezone.utc)
                    > revision_time + timedelta(days=1)
                )
            except ValueError:
                excluded["invalid_published_timestamp"] += 1
                continue
        if not future_published and re.match(r"^\d{8}(?:-|$)", key.split("/", 1)[1]):
            try:
                filename_day = datetime.strptime(
                    key.split("/", 1)[1][:8], "%Y%m%d"
                ).replace(tzinfo=timezone.utc)
                future_published = filename_day > revision_time + timedelta(days=1)
            except ValueError:
                pass
        if future_published:
            excluded["future_published"] += 1
            continue
        try:
            labels = model_labels(analysis)
        except SyncError as exc:
            raise SampleError(f"public article {key} has invalid model labels: {exc}") from exc
        domain, article_id = key.split("/", 1)
        article_path = root / "news/data" / domain / f"{article_id}.json"
        try:
            article = json.loads(article_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SampleError(f"cannot read local article for {key}: {exc}") from exc
        body = article.get("content") if isinstance(article, dict) else None
        if not isinstance(body, str) or not body:
            excluded["missing_content"] += 1
            continue
        try:
            task = make_task(
                root, public_revision, key, record, [], {}, public_revision
            )
        except SyncError:
            excluded["task_contract_ineligible"] += 1
            continue
        story_id = record.get("story_id")
        group_id = story_id if isinstance(story_id, str) and story_id else key
        outlet = record.get("outlet")
        rows.append({
            "article_key": key,
            "cell": sampling_cell(task["model_labels"], analysis),
            "group_id": group_id,
            "outlet": outlet if isinstance(outlet, str) and outlet else domain,
            "topic": primary_topic(analysis) or "unclassified",
            "month": month(record.get("published")),
            "content_sha256": content_sha256(body),
        })
    return rows, dict(sorted(excluded.items()))


def select(
    rows: list[dict[str, Any]],
    size: int,
    seed: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not 1 <= size <= MAX_SIZE:
        raise SampleError(f"size must be between 1 and {MAX_SIZE}")
    if len(rows) < size:
        raise SampleError(f"requested {size} articles from only {len(rows)} eligible")
    outlet_cap = feasible_cap(rows, "outlet", size, 0.10)
    month_cap = feasible_cap(rows, "month", size, 0.25)
    quotas = allocate(size)
    pools: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        pools[row["cell"]].append(row)
    for cell in pools:
        pools[cell].sort(key=lambda row: rank(seed, row["article_key"], cell))

    chosen: list[dict[str, Any]] = []
    used_keys: set[str] = set()
    used_groups: set[str] = set()
    outlet_counts: Counter[str] = Counter()
    month_counts: Counter[str] = Counter()

    def take(
        row: dict[str, Any], *, enforce_outlet: bool = True, enforce_month: bool = True
    ) -> bool:
        if (row["article_key"] in used_keys or row["group_id"] in used_groups
                or (enforce_outlet and outlet_counts[row["outlet"]] >= outlet_cap)
                or (enforce_month and month_counts[row["month"]] >= month_cap)):
            return False
        chosen.append(row)
        used_keys.add(row["article_key"])
        used_groups.add(row["group_id"])
        outlet_counts[row["outlet"]] += 1
        month_counts[row["month"]] += 1
        return True

    selected_by_cell = Counter()
    for cell in DRAW_ORDER:
        for row in pools.get(cell, []):
            if take(row):
                selected_by_cell[cell] += 1
            if selected_by_cell[cell] == quotas[cell]:
                break

    remainder = sorted(
        (row for row in rows if row["article_key"] not in used_keys),
        key=lambda row: (
            TOP_UP_ORDER[row["cell"]],
            rank(seed, row["article_key"], "top-up"),
        ),
    )
    for row in remainder:
        if len(chosen) == size:
            break
        if take(row):
            selected_by_cell[row["cell"]] += 1
    relaxed_month = 0
    if len(chosen) < size:
        remainder = sorted(
            (row for row in rows if row["article_key"] not in used_keys),
            key=lambda row: (
                TOP_UP_ORDER[row["cell"]],
                rank(seed, row["article_key"], "relax-month"),
            ),
        )
        for row in remainder:
            if len(chosen) == size:
                break
            if take(row, enforce_month=False):
                selected_by_cell[row["cell"]] += 1
                relaxed_month += 1
    relaxed_outlet = 0
    if len(chosen) < size:
        remainder = sorted(
            (row for row in rows if row["article_key"] not in used_keys),
            key=lambda row: (
                TOP_UP_ORDER[row["cell"]],
                rank(seed, row["article_key"], "relax-outlet-month"),
            ),
        )
        for row in remainder:
            if len(chosen) == size:
                break
            if take(row, enforce_outlet=False, enforce_month=False):
                selected_by_cell[row["cell"]] += 1
                relaxed_outlet += 1
    if len(chosen) != size:
        raise SampleError(
            f"diversity caps allow only {len(chosen)} of {size} requested articles"
        )
    chosen.sort(key=lambda row: row["article_key"].encode("utf-8"))
    report = {
        "outlet_cap": outlet_cap,
        "month_cap": month_cap,
        "selected_after_month_cap_relaxation": relaxed_month,
        "selected_after_outlet_cap_relaxation": relaxed_outlet,
        "realized_max_outlet_count": max(outlet_counts.values(), default=0),
        "realized_max_month_count": max(month_counts.values(), default=0),
        "unique_groups": len(used_groups),
        "cells": {
            cell: {
                "eligible": len(pools.get(cell, [])),
                "target": quotas[cell],
                "selected": selected_by_cell[cell],
            }
            for cell in CELL_SHARES
        },
        "outlets": dict(sorted(outlet_counts.items())),
        "topics": dict(sorted(Counter(row["topic"] for row in chosen).items())),
        "months": dict(sorted(month_counts.items())),
    }
    return chosen, report


def build(
    root: Path,
    app_data: Path,
    *,
    size: int,
    seed: str,
    dataset_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if (not dataset_id or len(dataset_id) > 128
            or "gold" in dataset_id.casefold() or "sealed" in dataset_id.casefold()):
        raise SampleError("dataset_id must be bounded and explicitly non-gold")
    public_revision, public = load_public_articles(app_data)
    sealed = sealed_article_keys(root, public)
    rows, excluded = _eligible_rows(root, public, sealed, public_revision)
    chosen, distribution = select(rows, size, seed)
    keys = [row["article_key"] for row in chosen]
    selection = {
        "schema_version": 1,
        "dataset_id": dataset_id,
        "purpose": (
            "Public anonymous evaluator quality-control sample; deterministic model-output "
            "strata are sampling signals, never reference labels or accuracy truth."
        ),
        "source_kind": "community_sample",
        "answer_visibility": "model_hidden_until_submit",
        "public_eligible": True,
        "article_keys": keys,
    }
    manifest = {
        "schema_version": 1,
        "manifest_kind": "news-community-sample",
        "dataset_id": dataset_id,
        "source_public_data_revision": public_revision,
        "seed": seed,
        "requested_size": size,
        "selected_size": len(keys),
        "selection_sha256": canonical_sha256(selection),
        "article_keys_sha256": canonical_sha256(keys),
        "selection_policy": {
            "sampling_signals_are_not_labels": True,
            "sealed_and_benchmark_membership_excluded": True,
            "one_article_per_story_or_article_group": True,
            "published_more_than_24h_after_source_revision_excluded": True,
            "outlet_target_share_cap": 0.10,
            "month_target_share_cap": 0.25,
            "caps_are_targets_with_explicit_reported_relaxation": True,
        },
        "excluded": excluded,
        "distribution": distribution,
        "records": [{
            "article_key": row["article_key"],
            "group_id": row["group_id"],
            "content_sha256": row["content_sha256"],
        } for row in chosen],
    }
    return selection, manifest


def atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--app-data", type=Path)
    parser.add_argument("--size", type=int, default=DEFAULT_SIZE)
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--dataset-id", default=DEFAULT_DATASET_ID)
    parser.add_argument("--selection-out", type=Path, default=DEFAULT_SELECTION)
    parser.add_argument("--manifest-out", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    app_data = (args.app_data or root / "news/app-data").resolve()
    selection_out = args.selection_out.resolve()
    manifest_out = args.manifest_out.resolve()
    try:
        selection, manifest = build(
            root, app_data, size=args.size, seed=args.seed, dataset_id=args.dataset_id
        )
        expected = {
            selection_out: json.dumps(selection, ensure_ascii=False, indent=2) + "\n",
            manifest_out: json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        }
        if args.check:
            stale = [str(path) for path, payload in expected.items()
                     if not path.is_file() or path.read_text(encoding="utf-8") != payload]
            if stale:
                print(json.dumps({"error": "stale_community_sample", "paths": stale}))
                return 1
        else:
            atomic_write(selection_out, selection)
            atomic_write(manifest_out, manifest)
        print(json.dumps({
            "mode": "news_community_sample",
            "status": "checked" if args.check else "written",
            "dataset_id": args.dataset_id,
            "selected": len(selection["article_keys"]),
            "selection_sha256": manifest["selection_sha256"],
        }))
        return 0
    except (SampleError, SyncError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": "community_sample_failed", "message": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
