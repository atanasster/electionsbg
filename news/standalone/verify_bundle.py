#!/usr/bin/env python3
"""Verify immutable code/assets after copying the standalone bundle."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parent)
DIGEST = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_FILES = frozenset({
    "run_hourly.sh",
    "upload_to_gcs.py",
    "news/scripts/run_nightly.sh",
    "news/scripts/analyze_local.py",
    "news/scripts/save_all_direct.sh",
    "news/scripts/save_all_browser.sh",
    "news/scripts/bin/timeout",
    "news/prompts/analyze_schema.json",
    "news/data/bg_news_sites.csv",
    "news/data/gazetteer.json",
})
REQUIRED_MUTABLE_SEEDS = frozenset({"news/data/common_words.json"})


def manifest_errors(manifest: object) -> list[dict]:
    errors: list[dict] = []
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        return [{"manifest": "unsupported_or_missing_version"}]
    files = manifest.get("files")
    mutable = manifest.get("mutable_seeds")
    if not isinstance(files, dict) or not files:
        errors.append({"manifest": "files_must_be_non_empty_object"})
        files = {}
    if not isinstance(mutable, list) or not all(isinstance(v, str) for v in mutable):
        errors.append({"manifest": "mutable_seeds_must_be_string_array"})
        mutable = []
    missing = sorted(REQUIRED_FILES - set(files))
    if missing:
        errors.append({"manifest": "required_files_missing", "paths": missing})
    missing_mutable = sorted(REQUIRED_MUTABLE_SEEDS - set(mutable))
    if missing_mutable:
        errors.append({"manifest": "mutable_seeds_missing", "paths": missing_mutable})
    for rel, digest in files.items():
        if (not isinstance(rel, str) or not rel or "\\" in rel
                or Path(rel).is_absolute() or ".." in Path(rel).parts
                or not isinstance(digest, str) or not DIGEST.fullmatch(digest)):
            errors.append({"manifest": "invalid_file_entry", "path": rel})
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    manifest_path = ROOT / "bundle-manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"mode": "verify_bundle", "error": str(exc)}))
        return 2
    failures = manifest_errors(manifest)
    files = manifest.get("files") if isinstance(manifest, dict) else {}
    files = files if isinstance(files, dict) else {}
    root = ROOT.resolve()
    for rel, expected in files.items():
        if not isinstance(rel, str) or not isinstance(expected, str):
            continue
        path = ROOT / rel
        try:
            contained = path.resolve().is_relative_to(root)
        except OSError:
            contained = False
        actual = (hashlib.sha256(path.read_bytes()).hexdigest()
                  if contained and path.is_file() else None)
        if actual != expected:
            failures.append({"path": rel, "expected": expected,
                             "actual": actual})
    for rel in REQUIRED_MUTABLE_SEEDS:
        if not (ROOT / rel).is_file():
            failures.append({"path": rel, "error": "mutable_seed_missing"})
    result = {"mode": "verify_bundle", "files": len(files),
              "failures": failures}
    if failures or not args.quiet:
        print(json.dumps(result, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
