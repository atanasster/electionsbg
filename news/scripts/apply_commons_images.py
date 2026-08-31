#!/usr/bin/env python3
"""Apply visually reviewed Commons selections to their exact article records."""

import argparse
import json
import os
import tempfile
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    from .commons_rights import (
        canonical_licence_url,
        commons_thumbnail_url,
        is_https_host,
    )
except ImportError:  # direct script execution
    from commons_rights import canonical_licence_url, commons_thumbnail_url, is_https_host


def desired_rights(selection: dict) -> dict:
    licence = selection["licence_name"]
    return {
        "status": "public_domain" if licence in {"CC0", "Public domain"} else "cc",
        "creator": selection["creator"].strip(),
        "credit_text": selection["credit_text"].strip(),
        "credit_url": selection["source_url"],
        "licence_name": licence,
        "licence_url": canonical_licence_url(licence),
        "source_url": selection["source_url"],
        "checked_at": selection["reviewed_at"],
        "display_home": True,
    }


def apply(selections_path: Path, root: Path) -> list[Path]:
    data = json.loads(selections_path.read_text(encoding="utf-8"))
    replacements = []
    corpus = root.resolve()
    seen_ids, seen_paths, seen_urls = set(), set(), set()
    for selection in data.get("selections", []):
        relative = selection["article_path"].split("news/data/", 1)[-1]
        path = (root / relative).resolve()
        if corpus not in path.parents:
            raise ValueError(f"selection escapes corpus: {path}")
        expected_id = f"{path.parent.name}/{path.stem}"
        if selection.get("article_id") != expected_id:
            raise ValueError(f"selection article_id mismatch: {path}")
        for value, seen, label in (
            (selection["article_id"], seen_ids, "article_id"),
            (str(path), seen_paths, "article_path"),
            (selection["article_url"], seen_urls, "article_url"),
        ):
            if value in seen:
                raise ValueError(f"duplicate selection {label}: {value}")
            seen.add(value)
        article = json.loads(path.read_text(encoding="utf-8"))
        if (article.get("url") != selection["article_url"]
                or article.get("domain") != path.parent.name):
            raise ValueError(f"selection URL mismatch: {path}")
        canonical = canonical_licence_url(selection["licence_name"])
        if not canonical or selection["licence_url"].rstrip("/") != canonical.rstrip("/"):
            raise ValueError(f"unsupported Commons licence: {selection['licence_name']}")
        for key in ("image_url", "source_url", "licence_url", "creator", "credit_text",
                    "file_title", "reviewed_at", "relationship_to_article"):
            if not isinstance(selection.get(key), str) or not selection[key].strip():
                raise ValueError(f"selection missing {key}: {path}")
        date.fromisoformat(selection["reviewed_at"])
        if not is_https_host(selection["image_url"], "upload.wikimedia.org"):
            raise ValueError(f"selection image_url is not Wikimedia upload HTTPS: {path}")
        display_image = commons_thumbnail_url(selection["image_url"])
        if not is_https_host(selection["source_url"], "commons.wikimedia.org"):
            raise ValueError(f"selection source_url is not Commons HTTPS: {path}")
        source_title = unquote(urlparse(selection["source_url"]).path.rsplit("/", 1)[-1])
        if source_title.replace("_", " ") != selection["file_title"].replace("_", " "):
            raise ValueError(f"selection file/source mismatch: {path}")
        wanted = desired_rights(selection)
        accepted_images = {selection["image_url"], display_image}
        # One repair release emitted WebP derivatives without MediaWiki's
        # required `.png` output suffix. Accept only that exact same-file URL
        # so replay can migrate it; unrelated reviewed images still fail.
        if display_image.endswith(".webp.png"):
            accepted_images.add(display_image[:-4])
        current = article.get("image_rights")
        if isinstance(current, dict) and current.get("status") in {"blocked", "unknown"}:
            raise ValueError(f"refusing to overwrite {current['status']} decision: {path}")
        if current:
            comparable = dict(current)
            # Permit a one-time schema enrichment for the same reviewed image,
            # but never a different image, authority, creator or review date.
            immutable = ("creator", "licence_name", "source_url", "checked_at")
            if article.get("image") not in accepted_images or any(
                comparable.get(key) != wanted.get(key) for key in immutable
            ):
                raise ValueError(f"refusing to supersede existing rights: {path}")
        article["image"] = display_image
        article["image_alt"] = f"Илюстрация: {selection['subject']}"
        article["image_rights"] = wanted
        replacements.append((path, json.dumps(article, ensure_ascii=False) + "\n"))
    changed = []
    for path, rendered in replacements:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         delete=False) as handle:
            handle.write(rendered)
            temporary = Path(handle.name)
        os.replace(temporary, path)
        changed.append(path)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selections", type=Path,
                        default=Path("news/config/commons_image_selections.json"))
    parser.add_argument("--data-dir", type=Path, default=Path("news/data"))
    args = parser.parse_args()
    changed = apply(args.selections, args.data_dir)
    print(f"Commons images applied: {len(changed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
