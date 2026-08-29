#!/usr/bin/env python3
"""Build one copyable news acquisition/analyze/upload directory."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])

RUNTIME_SCRIPTS = (
    "news/scripts/analyze_articles.py",
    "news/scripts/analyze_local.py",
    "news/scripts/build_app_data.py",
    "news/scripts/build_gazetteer.py",
    "news/scripts/build_mention_index.py",
    "news/scripts/build_prompts.py",
    "news/scripts/fetch_latest_articles.py",
    "news/scripts/harvest_browser.mjs",
    "news/scripts/llm_client.py",
    "news/scripts/resolve_mentions.py",
    "news/scripts/review_routing.py",
    "news/scripts/run_nightly.sh",
    "news/scripts/save_all_browser.sh",
    "news/scripts/save_all_direct.sh",
    "news/scripts/save_articles.py",
    "news/scripts/bin/timeout",
)
SEED_FILES = (
    "news/topics.json",
    "news/config/image_rights_policy.json",
    "news/data/bg_news_sites.csv",
    "news/data/common_words.json",
    "news/data/entity_link_overrides.json",
    "news/data/gazetteer.json",
    "news/data/institution_aliases.json",
    "news/data/retired_sites.csv",
    "data/canonical_parties.json",
)
STANDALONE_MAP = {
    "news/standalone/README.md": "README.md",
    "news/standalone/config.env.example": "config.env.example",
    "news/standalone/install_cron.sh": "install_cron.sh",
    "news/standalone/package.json": "package.json",
    "news/standalone/run_hourly.sh": "run_hourly.sh",
    "news/standalone/setup.sh": "setup.sh",
    "news/standalone/upload_to_gcs.py": "upload_to_gcs.py",
    "news/standalone/verify_bundle.py": "verify_bundle.py",
}
STATE_DIRS = frozenset({"analysis", "_state", "_rejected", "_quarantine"})
EXECUTABLES = frozenset({
    "install_cron.sh", "run_hourly.sh", "setup.sh", "upload_to_gcs.py",
    "verify_bundle.py", *RUNTIME_SCRIPTS,
})


def copy_file(source_rel: str, destination_rel: str, out: Path,
              immutable: set[str], *, mutable_seed: bool = False) -> None:
    source = ROOT / source_rel
    if not source.is_file():
        raise FileNotFoundError(source)
    destination = out / destination_rel
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    if destination_rel in EXECUTABLES:
        destination.chmod(destination.stat().st_mode | stat.S_IXUSR)
    if not mutable_seed:
        immutable.add(destination_rel)


def include_state(out: Path) -> int:
    source_root = ROOT / "news" / "data"
    copied = 0
    for source in sorted(source_root.iterdir()):
        if not source.is_dir():
            continue
        if source.name not in STATE_DIRS and "." not in source.name:
            continue
        destination = out / "news" / "data" / source.name
        shutil.copytree(source, destination, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(".DS_Store", "__pycache__"))
        copied += sum(path.is_file() for path in destination.rglob("*"))
    return copied


def build(out: Path, with_state: bool) -> dict:
    if out.exists():
        raise FileExistsError(f"output already exists: {out}")
    out.mkdir(parents=True)
    immutable: set[str] = set()
    for rel in RUNTIME_SCRIPTS + SEED_FILES:
        copy_file(rel, rel, out, immutable,
                  mutable_seed=rel == "news/data/common_words.json")
    for source in sorted((ROOT / "news" / "prompts").iterdir()):
        if source.is_file():
            rel = str(source.relative_to(ROOT))
            copy_file(rel, rel, out, immutable)
    for source, destination in STANDALONE_MAP.items():
        copy_file(source, destination, out, immutable)
    for rel in ("news/app-data", "data/news/mentions", "var/reports"):
        (out / rel).mkdir(parents=True, exist_ok=True)
    state_files = include_state(out) if with_state else 0
    hashes = {
        rel: hashlib.sha256((out / rel).read_bytes()).hexdigest()
        for rel in sorted(immutable)
    }
    manifest = {
        "version": 1,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "state_included": with_state,
        "state_files": state_files,
        "mutable_seeds": ["news/data/common_words.json"],
        "files": hashes,
    }
    (out / "bundle-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--include-state", action="store_true",
                    help="seed corpus, analyses, retry/quarantine state; skips caches/evals")
    args = ap.parse_args()
    out = args.out if args.out.is_absolute() else ROOT / args.out
    try:
        result = build(out, args.include_state)
    except (OSError, ValueError) as exc:
        print(json.dumps({"mode": "build_news_standalone", "error": str(exc)}))
        return 2
    print(json.dumps({
        "mode": "build_news_standalone", "output": str(out),
        "immutable_files": len(result["files"]),
        "state_included": result["state_included"],
        "state_files": result["state_files"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
