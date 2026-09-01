#!/usr/bin/env python3
"""Build the trusted, all-public-article feedback task registry."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import (  # noqa: E402
    canonical_sha256,
    content_sha256,
)
from news.scripts.build_feedback_targets import validate_registry  # noqa: E402
from news.scripts.sync_eval_tasks import (  # noqa: E402
    SyncError,
    atomic_write,
    load_public_articles,
    read_json,
    text,
    timestamp,
)

MANIFEST_KIND = "news-feedback-task-sync"


def task_revision(content_hash: str, analysis_hash: str | None,
                  target_registry_hash: str) -> int:
    digest = canonical_sha256({
        "contract": "article-feedback-v1",
        "content_sha256": content_hash,
        "analysis_sha256": analysis_hash,
        "target_registry_sha256": target_registry_hash,
    }).removeprefix("sha256:")
    return int(digest[:12], 16) + 1


def make_task(root: Path, public_revision: str, target_registry_hash: str,
              key: str,
              public: dict[str, Any]) -> dict[str, Any]:
    domain, article_id = key.split("/", 1)
    article_path = root / "news" / "data" / domain / f"{article_id}.json"
    try:
        article = read_json(article_path) if article_path.is_file() else {}
    except SyncError:
        article = {}
    body = article.get("content")
    content_hash = (content_sha256(body) if isinstance(body, str) and body else
                    canonical_sha256({
                        "contract": "public-article-record-v1",
                        "article_key": key,
                        "record": public,
                    }))
    public_analysis = public.get("analysis")
    analysis_hash = (canonical_sha256(public_analysis)
                     if isinstance(public_analysis, dict) else None)
    title = public.get("title")
    if not isinstance(title, str) or not title or len(title) > 500:
        title = "Публична статия"
    return {
        "schema_version": 1,
        "contract": "article-feedback-v1",
        "article_key": key,
        "domain": domain,
        "article_id": article_id,
        "url": f"https://news.electionsbg.com/article/{domain}/{article_id}",
        "title": title,
        "content_sha256": content_hash,
        "analysis_sha256": analysis_hash,
        "target_registry_sha256": target_registry_hash,
        "public_data_revision": public_revision,
        "accepts_public_feedback": True,
        "revision": task_revision(content_hash, analysis_hash,
                                  target_registry_hash),
        "updated_at": public_revision,
    }


def build(root: Path, app_data: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    revision, public_articles = load_public_articles(app_data)
    target_registry = validate_registry(
        read_json(app_data / "feedback-targets.json"))
    target_registry_hash = text(
        target_registry.get("targets_sha256"), "feedback target registry hash")
    if timestamp(target_registry.get("generated_at"),
                 "feedback target registry revision") != revision:
        raise SyncError("feedback target registry revision does not match app-data")
    tasks = []
    for key in sorted(public_articles):
        tasks.append(make_task(root, revision, target_registry_hash,
                               key, public_articles[key]))
    if not tasks:
        raise SyncError("no public articles are eligible for feedback")
    tasks.sort(key=lambda item: item["article_key"].encode("utf-8"))
    source_articles = [
        {
            "article_key": task["article_key"],
            "analysis_sha256": task["analysis_sha256"],
        }
        for task in tasks
    ]
    manifest = {
        "schema_version": 1,
        "manifest_kind": MANIFEST_KIND,
        "generated_at": revision,
        "public_data_revision": revision,
        "task_count": len(tasks),
        "source_articles_sha256": canonical_sha256(source_articles),
        "tasks_sha256": canonical_sha256(tasks),
        "tasks": tasks,
    }
    report = {
        "schema_version": 1,
        "mode": "news_feedback_task_sync",
        "generated_at": revision,
        "public_articles_scanned": len(public_articles),
        "task_count": len(tasks),
        "excluded_count": 0,
        "excluded": [],
        "tasks_sha256": manifest["tasks_sha256"],
    }
    return manifest, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path,
                        default=Path(os.environ.get("DATA_BG_ROOT", ROOT)))
    parser.add_argument("--app-data", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    app_data = (args.app_data or root / "news" / "app-data").resolve()
    out = (args.out or root / "news" / "data" / "evals" /
           "feedback-tasks" / "current.json").resolve()
    try:
        manifest, report = build(root, app_data)
        report["dry_run"] = not args.write
        if args.write:
            atomic_write(out, manifest, 0o600)
            if args.report:
                atomic_write(args.report.resolve(), report, 0o600)
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, SyncError, ValueError, TypeError) as exc:
        print(json.dumps({"error": "feedback_task_build_failed",
                          "message": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
