#!/usr/bin/env python3
"""Fail closed when a copied news directory lacks runtime/config files."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQUIRED = (
    "run_hourly.sh", "install_cron.sh", "setup.sh", "package.json",
    "standalone/run_hourly.sh", "standalone/upload_to_gcs.py",
    "scripts/run_nightly.sh", "scripts/analyze_local.py",
    "scripts/save_all_direct.sh", "scripts/save_all_browser.sh",
    "scripts/harvest_browser.mjs", "scripts/bin/timeout",
    "prompts/analyze_schema.json", "prompts/analyze_system.md",
    "data/bg_news_sites.csv", "data/gazetteer.json",
    ".env.api", ".env.model", ".env.upload", ".env.pipeline",
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    missing = [rel for rel in REQUIRED if not (ROOT / rel).is_file()]
    result = {"mode": "verify_news_install", "required": len(REQUIRED),
              "missing": missing}
    if missing or not args.quiet:
        print(json.dumps(result, ensure_ascii=False))
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
