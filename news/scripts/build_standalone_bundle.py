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
    "news/scripts/apply_commons_images.py",
    "news/scripts/app_data_inventory.py",
    "news/scripts/analyze_articles.py",
    "news/scripts/analyze_local.py",
    "news/scripts/build_app_data.py",
    "news/scripts/build_feedback_improvement_dataset.py",
    "news/scripts/build_feedback_targets.py",
    "news/scripts/build_feedback_tasks.py",
    "news/scripts/build_gazetteer.py",
    "news/scripts/build_image_rights_queue.py",
    "news/scripts/build_mention_index.py",
    "news/scripts/build_prompts.py",
    "news/scripts/commons_rights.py",
    "news/scripts/effective_analysis.py",
    "news/scripts/effective_feedback.py",
    "news/scripts/eval_runtime.py",
    "news/scripts/fetch_latest_articles.py",
    "news/scripts/harvest_browser.mjs",
    "news/scripts/llm_client.py",
    "news/scripts/home_event_dedupe.py",
    "news/scripts/home_health.py",
    "news/scripts/resolve_mentions.py",
    "news/scripts/review_routing.py",
    "news/scripts/propose_eval_corrections.py",
    "news/scripts/run_nightly.sh",
    "news/scripts/save_all_browser.sh",
    "news/scripts/save_all_direct.sh",
    "news/scripts/save_articles.py",
    "news/scripts/source_commons_images.py",
    "news/scripts/sync_eval_tasks.py",
    "news/scripts/bin/timeout",
)
SEED_FILES = (
    "news/topics.json",
    "news/config/commons_image_selections.json",
    "news/config/commons_search_overrides.json",
    "news/config/image_rights_policy.json",
    "news/data/bg_news_sites.csv",
    "news/data/common_words.json",
    "news/data/entity_link_overrides.json",
    "news/data/gazetteer.json",
    "news/data/institution_aliases.json",
    "news/data/retired_sites.csv",
    "data/canonical_parties.json",
    "src/screens/governance/sectorRegistry.ts",
    "src/locales/bg/translation.json",
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
MUTABLE_SEEDS = frozenset({
    "news/data/common_words.json",
    "news/config/commons_image_selections.json",
    "news/config/commons_search_overrides.json",
})
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


def include_state(out: Path, source: Path | None = None) -> int:
    source = source or ROOT
    source_root = source / "news" / "data"
    copied = 0
    for data_source in sorted(source_root.iterdir()):
        if not data_source.is_dir():
            continue
        if data_source.name not in STATE_DIRS and "." not in data_source.name:
            continue
        destination = out / "news" / "data" / data_source.name
        shutil.copytree(data_source, destination, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(".DS_Store", "__pycache__"))
        copied += sum(path.is_file() for path in destination.rglob("*"))
    caches = (
        source / "news" / "review" / "commons_candidates.json",
        source / "news" / "review" / "story_merge_queue.json",
    )
    for cache in caches:
        if not cache.is_file():
            continue
        value = json.loads(cache.read_text(encoding="utf-8"))
        if cache.name == "story_merge_queue.json":
            valid = (
                isinstance(value, dict)
                and value.get("version") == 1
                and isinstance(value.get("items"), list)
            )
        else:
            valid = (
                isinstance(value, dict)
                and value.get("version") in {1, 2}
                and isinstance(value.get("items"), list)
                and (value.get("version") != 2
                     or isinstance(value.get("search_cache"), dict))
            )
        if not valid:
            raise ValueError(f"invalid review cache: {cache}")
        target = out / "news" / "review" / cache.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cache, target)
        copied += 1
    return copied


def build(out: Path, with_state: bool) -> dict:
    if out.exists():
        raise FileExistsError(f"output already exists: {out}")
    out.mkdir(parents=True)
    immutable: set[str] = set()
    for rel in RUNTIME_SCRIPTS + SEED_FILES:
        copy_file(rel, rel, out, immutable,
                  mutable_seed=rel in MUTABLE_SEEDS)
    for source in sorted((ROOT / "news" / "prompts").iterdir()):
        if source.is_file():
            rel = str(source.relative_to(ROOT))
            copy_file(rel, rel, out, immutable)
    for source in sorted((ROOT / "news" / "eval_contract").rglob("*")):
        if source.is_file() and "__pycache__" not in source.parts:
            rel = str(source.relative_to(ROOT))
            copy_file(rel, rel, out, immutable)
    operator_files = [
        ROOT / "news-functions" / name
        for name in ("package.json", "package-lock.json", "tsconfig.json")
    ]
    operator_files.extend(
        path for directory in ("src", "scripts")
        for path in sorted((ROOT / "news-functions" / directory).rglob("*"))
        if (path.is_file()
            and "eval-contract" not in path.relative_to(
                ROOT / "news-functions").parts)
    )
    for source in operator_files:
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
        "mutable_seeds": sorted(MUTABLE_SEEDS),
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
