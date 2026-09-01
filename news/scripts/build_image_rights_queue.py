#!/usr/bin/env python3
"""Build the deterministic human-review queue for analyzed article images.

The queue is editorial work, never publication authority. Missing and unknown
rights are actionable; blocked or already decided records stay out. Publication
remains fail closed independently in ArticleCard and build_app_data.py.
"""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_app_data import image_rights_block  # noqa: E402


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected an object")
    return value


def queue_entry(analysis_path: Path, data_dir: Path,
                article_by_url: dict[tuple[str, str], list[tuple[Path, dict]]]
                ) -> tuple[dict | None, str | None]:
    analysis = load_json(analysis_path)
    raw_path = analysis.get("article_path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError(f"{analysis_path}: missing article_path")
    marker = "news/data/"
    relative = raw_path.split(marker, 1)[-1] if marker in raw_path else raw_path
    root = data_dir.resolve()
    candidate = (data_dir / relative).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"{analysis_path}: article_path escapes the data directory")
    article_path = candidate
    article = load_json(article_path) if article_path.exists() else None
    expected_url = analysis.get("url")
    expected_domain = analysis.get("domain")
    identity_matches = (
        article is not None
        and article.get("url") == expected_url
        and article.get("domain") == expected_domain
    )
    if not identity_matches:
        matches = article_by_url.get((expected_domain, expected_url), [])
        if len(matches) != 1:
            paths = ", ".join(str(path) for path, _ in matches) or "none"
            raise ValueError(
                f"{analysis_path}: article identity has {len(matches)} matches: {paths}"
            )
        article_path, article = matches[0]
        raw_path = f"news/data/{article_path.relative_to(root)}"
    rights = article.get("image_rights")
    image = article.get("image")
    if rights is None:
        reason = "missing_image" if not image else "missing_review"
    else:
        try:
            reviewed = image_rights_block(
                rights, article=raw_path, domain=article_path.parent.name
            )
        except ValueError:
            reason = "invalid_review"
        else:
            status = reviewed["status"]
            if status == "unknown":
                reason = "unknown_rights"
            else:
                return None, analysis.get("analyzed_at")
    if rights is None and image:
        reason = "missing_review"
    entry = {
        "id": f'{article.get("domain")}/{article_path.stem}',
        "domain": article.get("domain"),
        "title": article.get("title"),
        "published": article.get("published"),
        "analyzed_at": analysis.get("analyzed_at"),
        "article_url": article.get("url"),
        "article_path": raw_path,
        "image_url": image,
        "reason": reason,
        "current_status": rights.get("status") if isinstance(rights, dict) else None,
    }
    return entry, analysis.get("analyzed_at")


def build_queue(data_dir: Path) -> dict:
    analysis_root = data_dir / "analysis" / "articles"
    article_by_url = {}
    for path in sorted(data_dir.glob("*/*.json")):
        article = load_json(path)
        if isinstance(article.get("url"), str):
            key = (article.get("domain"), article["url"])
            article_by_url.setdefault(key, []).append((path.resolve(), article))
    entries = []
    analyzed_times = []
    if analysis_root.is_dir():
        for path in sorted(analysis_root.glob("*/*.json")):
            entry, analyzed_at = queue_entry(path, data_dir, article_by_url)
            if analyzed_at:
                try:
                    parsed = datetime.fromisoformat(analyzed_at)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{path}: invalid analyzed_at") from exc
                if parsed.tzinfo is None:
                    raise ValueError(f"{path}: analyzed_at must include a timezone")
                analyzed_times.append(parsed)
            if entry:
                entries.append(entry)
    entries.sort(key=lambda row: (row.get("published") or "", row["id"]), reverse=True)
    reasons = ("missing_image", "missing_review", "unknown_rights", "invalid_review")
    counts = {reason: 0 for reason in reasons}
    for entry in entries:
        counts[entry["reason"]] += 1
    source_updated_at = (
        max(analyzed_times).astimezone(timezone.utc).isoformat()
        if analyzed_times else None
    )
    return {
        "version": 1,
        "source_updated_at": source_updated_at,
        "policy": "news/config/image_rights_policy.json",
        "publication_default": "deny",
        "counts": {"total": len(entries), **counts},
        "items": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("news/data"))
    parser.add_argument("--out", type=Path,
                        default=Path("news/review/image_rights_queue.json"))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    queue = build_queue(args.data_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(queue, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=args.out.parent, delete=False
    ) as handle:
        handle.write(rendered)
        temp_path = Path(handle.name)
    try:
        os.replace(temp_path, args.out)
    finally:
        temp_path.unlink(missing_ok=True)
    if args.json:
        print(json.dumps(queue["counts"], ensure_ascii=False))
    else:
        print(f'image-rights review queue: {queue["counts"]["total"]} → {args.out}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
