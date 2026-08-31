#!/usr/bin/env python3
"""Build and optionally publish the anonymous news-evaluation task queue.

The public queue is a projection of articles that already exist in the freshly
built app-data tree. Full article text is read only to derive the content hash;
it is never written to the queue or Firestore manifest.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import (  # noqa: E402
    analysis_sha256,
    canonical_json,
    canonical_sha256,
    content_sha256,
)

SCHEMA_VERSION = 1
RUBRIC_VERSION = "news-article-evaluation-v1"
MAX_TASKS = 200
LEANING = {
    "strong_progressive", "progressive", "neutral", "conservative",
    "strong_conservative", "not_applicable",
}
RUSSIA = {
    "strong_pro_russia", "pro_russia", "neutral", "anti_russia",
    "strong_anti_russia", "not_applicable",
}
PARTY_TONES = {"favorable", "unfavorable", "neutral", "mixed"}
SHA256 = "sha256:"


class SyncError(ValueError):
    """A stable operator-facing task-sync error."""


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise SyncError(f"{path} must contain an object")
    return value


def exact_keys(value: dict[str, Any], allowed: set[str], label: str) -> None:
    extra = sorted(set(value) - allowed)
    if extra:
        raise SyncError(f"{label} has unexpected fields: {', '.join(extra)}")


def text(value: Any, label: str, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise SyncError(f"{label} must be a bounded non-empty string")
    return value


def optional_text(value: Any, label: str, maximum: int = 500) -> str | None:
    return None if value is None else text(value, label, maximum)


def sha256(value: Any, label: str) -> str:
    result = text(value, label, 71)
    suffix = result.removeprefix(SHA256)
    if (not result.startswith(SHA256) or len(suffix) != 64 or
            any(character not in "0123456789abcdef" for character in suffix)):
        raise SyncError(f"{label} is not a SHA-256 value")
    return result


def article_key(value: Any) -> str:
    key = text(value, "article_key", 509)
    parts = key.split("/")
    if len(parts) != 2 or not all(parts) or ".." in key or "\\" in key:
        raise SyncError(f"invalid article_key: {key}")
    return key


def timestamp(value: Any, label: str) -> str:
    raw = text(value, label, 80)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SyncError(f"{label} is not an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise SyncError(f"{label} must include a timezone")
    utc = parsed.astimezone(timezone.utc)
    return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def optional_timestamp(value: Any, label: str) -> str | None:
    return None if value is None else timestamp(value, label)


def load_selection(path: Path) -> tuple[str, str, list[str]]:
    value = read_json(path)
    exact_keys(value, {
        "schema_version", "dataset_id", "purpose", "source_kind",
        "answer_visibility", "public_eligible", "article_keys",
    }, f"selection {path}")
    if value.get("schema_version") != SCHEMA_VERSION:
        raise SyncError(f"selection {path} has an unsupported schema")
    dataset_id = text(value.get("dataset_id"), "dataset_id", 128)
    purpose = text(value.get("purpose"), "purpose", 300)
    if value.get("source_kind") != "community_sample":
        raise SyncError(f"selection {dataset_id} is not a community sample")
    if value.get("answer_visibility") != "model_hidden_until_submit":
        raise SyncError(f"selection {dataset_id} has unsafe answer visibility")
    if value.get("public_eligible") is not True:
        raise SyncError(f"selection {dataset_id} is not public eligible")
    if "gold" in dataset_id.casefold() or "sealed" in dataset_id.casefold():
        raise SyncError(f"selection {dataset_id} looks sealed/gold and is refused")
    raw_keys = value.get("article_keys")
    if not isinstance(raw_keys, list) or not raw_keys:
        raise SyncError(f"selection {dataset_id} must name article_keys")
    keys = [article_key(item) for item in raw_keys]
    if len(set(keys)) != len(keys):
        raise SyncError(f"selection {dataset_id} contains duplicate article keys")
    return dataset_id, purpose, keys


def load_public_articles(app_data: Path) -> tuple[str, dict[str, dict[str, Any]]]:
    articles_dir = app_data / "articles"
    if not articles_dir.is_dir():
        raise SyncError(f"public articles directory is missing: {articles_dir}")
    rows: dict[str, dict[str, Any]] = {}
    revisions: set[str] = set()
    for path in sorted(articles_dir.glob("*.json")):
        bundle = read_json(path)
        domain = bundle.get("domain")
        records = bundle.get("articles")
        generated_at = bundle.get("generated_at")
        if not isinstance(domain, str) or not isinstance(records, list):
            # `articles/gold.json` is a historical utility bundle, not a domain.
            continue
        revisions.add(timestamp(generated_at, f"{path}.generated_at"))
        for record in records:
            if not isinstance(record, dict):
                raise SyncError(f"{path} contains a non-object article")
            ident = text(record.get("id"), f"{path}.article.id", 255)
            key = f"{domain}/{ident}"
            if key in rows:
                raise SyncError(f"public app-data contains duplicate {key}")
            rows[key] = record
    if not rows or len(revisions) != 1:
        raise SyncError("public app-data is empty or spans multiple revisions")
    return next(iter(revisions)), rows


def sealed_article_keys(root: Path,
                        public_articles: dict[str, dict[str, Any]]) -> set[str]:
    """Load private benchmark membership without projecting that membership."""
    gold_dir = root / "news" / "data" / "gold"
    sources = sorted(gold_dir.glob("*.json")) if gold_dir.is_dir() else []
    if not sources:
        raise SyncError("authoritative sealed/gold artifacts are missing")
    by_url = {
        record.get("url"): key
        for key, record in public_articles.items()
        if isinstance(record.get("url"), str)
    }
    excluded: set[str] = set()
    visited: set[Path] = set()

    def load(path: Path) -> None:
        resolved = path.resolve()
        if resolved in visited:
            return
        if not resolved.is_relative_to(root.resolve()):
            raise SyncError("sealed/gold artifact reference escapes the repository")
        visited.add(resolved)
        value = read_json(resolved)
        articles = value.get("articles")
        if articles is not None:
            if not isinstance(articles, list):
                raise SyncError(f"sealed/gold articles must be an array: {resolved}")
            for item in articles:
                if not isinstance(item, dict):
                    raise SyncError(f"sealed/gold article must be an object: {resolved}")
                raw_path = item.get("path")
                if isinstance(raw_path, str):
                    parts = Path(raw_path).parts
                    if len(parts) == 4 and parts[:2] == ("news", "data"):
                        excluded.add(article_key(f"{parts[2]}/{Path(parts[3]).stem}"))
                        continue
                domain = item.get("domain")
                ident = item.get("article_id") or item.get("id")
                if isinstance(domain, str) and isinstance(ident, str):
                    excluded.add(article_key(f"{domain}/{ident}"))
                    continue
                url_key = by_url.get(item.get("url"))
                if url_key:
                    excluded.add(url_key)
        records = value.get("records")
        if records is not None:
            if not isinstance(records, dict):
                raise SyncError(f"sealed/gold records must be an object: {resolved}")
            excluded.update(by_url[url] for url in records if url in by_url)
        referenced = value.get("base_gold_selection")
        if isinstance(referenced, str):
            load(root / referenced)
        selection = value.get("selection")
        if isinstance(selection, dict) and isinstance(selection.get("file"), str):
            load(root / selection["file"])

    for source in sources:
        load(source)
    if not excluded:
        raise SyncError("authoritative sealed/gold artifacts contain no usable membership")
    return excluded


def model_labels(analysis: dict[str, Any]) -> dict[str, Any]:
    leaning = analysis.get("leaning")
    russia = analysis.get("russia_stance")
    if not isinstance(leaning, dict) or leaning.get("label") not in LEANING:
        raise SyncError("analysis has an invalid leaning label")
    if not isinstance(russia, dict) or russia.get("label") not in RUSSIA:
        raise SyncError("analysis has an invalid Russia-stance label")
    raw_parties = analysis.get("party_tones")
    if not isinstance(raw_parties, list) or len(raw_parties) > 30:
        raise SyncError("analysis has invalid party tones")
    parties = []
    seen: set[str] = set()
    for raw in raw_parties:
        if not isinstance(raw, dict):
            raise SyncError("analysis party tone must be an object")
        party = text(raw.get("party"), "party", 160)
        party_id = raw.get("party_id")
        if party_id is not None:
            party_id = text(party_id, "party_id", 160)
        tone = raw.get("tone")
        if tone not in PARTY_TONES:
            raise SyncError(f"analysis has invalid tone for {party}")
        identity = f"id:{party_id}" if party_id else f"surface:{party.casefold()}"
        if identity in seen:
            raise SyncError(f"analysis has duplicate party tone {identity}")
        seen.add(identity)
        parties.append({"party": party, "party_id": party_id, "tone": tone})
    parties.sort(key=lambda item: canonical_json(item))
    return {
        "leaning": leaning["label"],
        "russia_stance": russia["label"],
        "party_tones": parties,
    }


def primary_topic(analysis: dict[str, Any]) -> str | None:
    for topic in analysis.get("topics") or []:
        if isinstance(topic, dict) and topic.get("primary") is True:
            category = topic.get("category")
            return category if isinstance(category, str) and category else None
    return None


def review_reasons(root: Path, analysis: dict[str, Any]) -> dict[str, str]:
    scripts = root / "news" / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    from review_routing import record_review  # noqa: PLC0415

    enriched = dict(analysis)
    relative = analysis.get("article_path")
    if isinstance(relative, str):
        article_path = root / relative
        if article_path.is_file():
            enriched["_article"] = read_json(article_path)
    result = record_review(enriched)
    if not isinstance(result, dict):
        raise SyncError("review router returned a non-object")
    return {str(key): str(value) for key, value in sorted(result.items())}


def task_revision(content_hash: str, analysis_hash: str,
                  labels: dict[str, Any]) -> int:
    digest = canonical_sha256({
        "rubric_version": RUBRIC_VERSION,
        "content_sha256": content_hash,
        "analysis_sha256": analysis_hash,
        "model_labels": labels,
    }).removeprefix("sha256:")
    return int(digest[:12], 16) + 1


def make_task(root: Path, public_revision: str, key: str,
              public: dict[str, Any], dataset_ids: list[str],
              reasons: dict[str, str], generated_at: str) -> dict[str, Any]:
    domain, ident = key.split("/", 1)
    article_path = root / "news" / "data" / domain / f"{ident}.json"
    analysis_path = (root / "news" / "data" / "analysis" / "articles" /
                     domain / f"{ident}.json")
    article = read_json(article_path)
    analysis = read_json(analysis_path)
    content = article.get("content")
    if not isinstance(content, str) or not content:
        raise SyncError(f"{key} has no local article content")
    if analysis.get("article_path") != str(article_path.relative_to(root)):
        raise SyncError(f"{key} analysis points at another article")
    local_labels = model_labels(analysis)
    public_analysis = public.get("analysis")
    if not isinstance(public_analysis, dict):
        raise SyncError(f"{key} has no public analysis")
    public_labels = model_labels(public_analysis)
    if (public_labels["leaning"] != local_labels["leaning"] or
            public_labels["russia_stance"] != local_labels["russia_stance"]):
        raise SyncError(f"{key} public and local model labels differ")
    local_party_ids = {
        (item["party"], item["tone"]): item["party_id"]
        for item in local_labels["party_tones"]
    }
    if len(local_party_ids) != len(local_labels["party_tones"]):
        raise SyncError(f"{key} has ambiguous local party labels")
    for item in public_labels["party_tones"]:
        identity = (item["party"], item["tone"])
        if identity not in local_party_ids:
            raise SyncError(f"{key} public party labels differ from local analysis")
        if (item["party_id"] is not None and
                item["party_id"] != local_party_ids[identity]):
            raise SyncError(f"{key} public party identity differs from local analysis")
    labels = {
        **public_labels,
        "party_tones": [{
            **item,
            "party_id": local_party_ids.get((item["party"], item["tone"])),
        } for item in public_labels["party_tones"]],
    }
    content_hash = content_sha256(content)
    analysis_hash = analysis_sha256(analysis)
    title = text(public.get("title"), f"{key}.title", 500)
    url = text(public.get("url"), f"{key}.url", 2048)
    if not url.startswith("https://"):
        raise SyncError(f"{key}.url must be HTTPS")
    story = optional_text(public.get("story_id"), f"{key}.story_id", 160)
    topic = optional_text(primary_topic(analysis), f"{key}.primary_topic", 128)
    model = optional_text(analysis.get("model"), f"{key}.model", 160)
    raw_prompt_hashes = analysis.get("prompt_hashes") or {}
    if not isinstance(raw_prompt_hashes, dict) or len(raw_prompt_hashes) > 20:
        raise SyncError(f"{key}.prompt_hashes must be a bounded object")
    prompt_hashes = {
        text(name, f"{key} prompt hash name", 128): sha256(
            value, f"{key}.prompt_hashes.{name}")
        for name, value in sorted(raw_prompt_hashes.items())
    }
    if len(reasons) > 10:
        raise SyncError(f"{key}.review_reasons is too large")
    bounded_reasons = {
        text(name, f"{key} review field", 64): text(
            value, f"{key}.review_reasons.{name}", 600)
        for name, value in sorted(reasons.items())
    }
    revision = task_revision(content_hash, analysis_hash, labels)
    return {
        "schema_version": 1,
        "rubric_version": RUBRIC_VERSION,
        "article_key": key,
        "domain": domain,
        "article_id": ident,
        "url": url,
        "title": title,
        "published": optional_timestamp(public.get("published"), f"{key}.published"),
        "story_id": story,
        "primary_topic": topic,
        "outlet": text(domain, f"{key}.outlet", 160),
        "content_sha256": content_hash,
        "public_data_revision": public_revision,
        "analysis_sha256": analysis_hash,
        "model": model,
        "analyzed_at": optional_timestamp(
            analysis.get("analyzed_at"), f"{key}.analyzed_at"),
        "prompt_hashes": prompt_hashes,
        "model_labels": labels,
        "review_reasons": bounded_reasons,
        "dataset_ids": sorted(dataset_ids),
        "accepts_public_evals": True,
        "revision": revision,
        "updated_at": generated_at,
    }


def build(root: Path, app_data: Path, selections: list[Path],
          include_review: bool, review_limit: int) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if review_limit < 0:
        raise SyncError("review_limit must be >= 0")
    public_revision, public_articles = load_public_articles(app_data)
    generated = public_revision
    sealed = sealed_article_keys(root, public_articles)
    selected: dict[str, set[str]] = {}
    purposes: dict[str, str] = {}
    for path in selections:
        dataset_id, purpose, keys = load_selection(path)
        if dataset_id in purposes:
            raise SyncError(f"duplicate dataset_id: {dataset_id}")
        purposes[dataset_id] = purpose
        for key in keys:
            if key in sealed:
                raise SyncError(
                    f"selection {dataset_id} overlaps sealed/gold membership")
            selected.setdefault(key, set()).add(dataset_id)

    routed: dict[str, dict[str, str]] = {}
    if include_review:
        for key in sorted(public_articles):
            if key in sealed:
                continue
            domain, ident = key.split("/", 1)
            analysis_path = (root / "news" / "data" / "analysis" /
                             "articles" / domain / f"{ident}.json")
            if not analysis_path.is_file():
                continue
            reasons = review_reasons(root, read_json(analysis_path))
            if reasons:
                routed[key] = reasons
        ranked = sorted(
            routed,
            key=lambda key: (-len(routed[key]), canonical_sha256(key), key),
        )
        if review_limit:
            ranked = ranked[:review_limit]
        for key in ranked:
            selected.setdefault(key, set())
        routed = {key: routed[key] for key in ranked}

    if not selected:
        raise SyncError("no task sources selected; pass --selection or --include-review-reasons")
    if len(selected) > MAX_TASKS:
        raise SyncError(f"task count {len(selected)} exceeds the {MAX_TASKS} safety cap")
    missing_public = sorted(set(selected) - set(public_articles))
    if missing_public:
        raise SyncError("selected articles are not in public app-data: " + ", ".join(missing_public))

    tasks = []
    failures = []
    for key in sorted(selected):
        try:
            tasks.append(make_task(
                root, public_revision, key, public_articles[key],
                sorted(selected[key]), routed.get(key, {}), generated,
            ))
        except SyncError as exc:
            failures.append({"article_key": key, "error": str(exc)})
    if failures:
        raise SyncError("task build failed: " + canonical_json(failures))
    tasks.sort(key=lambda item: item["article_key"].encode("utf-8"))
    tasks_hash = canonical_sha256(tasks)
    public_tasks = [{
        "article_key": task["article_key"],
        "domain": task["domain"],
        "article_id": task["article_id"],
        "url": task["url"],
        "title": task["title"],
        "published": task["published"],
        "story_id": task["story_id"],
        "primary_topic": task["primary_topic"],
        "outlet": task["outlet"],
        "content_sha256": task["content_sha256"],
        "analysis_sha256": task["analysis_sha256"],
        "model_labels": task["model_labels"],
        "review_fields": sorted(task["review_reasons"]),
        "dataset_ids": task["dataset_ids"],
        "task_revision": task["revision"],
    } for task in tasks]
    queue = {
        "schema_version": 1,
        "generated_at": generated,
        "public_data_revision": public_revision,
        "rubric_version": RUBRIC_VERSION,
        "task_count": len(public_tasks),
        "tasks_sha256": canonical_sha256(public_tasks),
        "tasks": public_tasks,
    }
    queue_hash = canonical_sha256(queue)
    manifest = {
        "schema_version": 1,
        "manifest_kind": "news-eval-task-sync",
        "generated_at": generated,
        "public_data_revision": public_revision,
        "rubric_version": RUBRIC_VERSION,
        "task_count": len(tasks),
        "tasks_sha256": tasks_hash,
        "queue_sha256": queue_hash,
        "tasks": tasks,
    }
    by_reason = Counter(field for task in tasks for field in task["review_reasons"])
    report = {
        "schema_version": 1,
        "mode": "news_eval_task_sync",
        "generated_at": generated,
        "public_data_revision": public_revision,
        "public_articles_scanned": len(public_articles),
        "task_count": len(tasks),
        "dataset_count": len(purposes),
        "by_dataset": dict(sorted(Counter(
            dataset for task in tasks for dataset in task["dataset_ids"]
        ).items())),
        "by_review_field": dict(sorted(by_reason.items())),
        "tasks_sha256": tasks_hash,
        "queue_sha256": queue_hash,
    }
    return manifest, queue, report


def atomic_write(path: Path, value: dict[str, Any], mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, mode)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def write_outputs(queue_out: Path, queue: dict[str, Any], manifest_out: Path,
                  manifest: dict[str, Any]) -> None:
    """Write the public payload first; the private manifest is the commit marker."""
    atomic_write(queue_out, queue, 0o644)
    atomic_write(manifest_out, manifest, 0o600)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(os.environ.get("DATA_BG_ROOT", ROOT)))
    parser.add_argument("--app-data", type=Path)
    parser.add_argument("--selection", type=Path, action="append", default=[])
    parser.add_argument("--include-review-reasons", action="store_true")
    parser.add_argument("--review-limit", type=int, default=50)
    parser.add_argument("--manifest-out", type=Path)
    parser.add_argument("--queue-out", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = args.root.resolve()
    app_data = (args.app_data or root / "news" / "app-data").resolve()
    manifest_out = (args.manifest_out or root / "news" / "data" / "evals" /
                    "tasks" / "current.json").resolve()
    queue_out = (args.queue_out or app_data / "evals" / "queue.json").resolve()
    try:
        manifest, queue, report = build(
            root, app_data, [path.resolve() for path in args.selection],
            args.include_review_reasons, args.review_limit,
        )
        report["dry_run"] = not args.write
        if args.write:
            write_outputs(queue_out, queue, manifest_out, manifest)
            if args.report:
                atomic_write(args.report.resolve(), report, 0o600)
        print(canonical_json(report))
        return 0
    except (SyncError, OSError, TypeError, json.JSONDecodeError) as exc:
        print(canonical_json({"error": "eval_task_sync_failed", "message": str(exc)}),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
