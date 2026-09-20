#!/usr/bin/env python3
"""Plan §4.6(e) — keep the last K published version trees, delete the rest.

    python3 news/scripts/prune_published_versions.py            # DRY RUN
    python3 news/scripts/prune_published_versions.py --apply

There is no lifecycle rule on this bucket (§0.1 R5) and nothing has ever
deleted a release, so storage grows without bound — measured 2026-09-20,
**37.2 MB per release, 0.89 GB/day, 26.8 GB/month** at hourly cadence.

⚠️ THIS DELETES PUBLISHED OBJECTS, AND A WRONG DELETION IS AN OUTAGE, not a
tidy-up: a reader holding a manifest that points at a tree which no longer
exists gets 404s for every file of the release it is reading. So the rules
below are refusals, not preferences, and the default is a dry run.

  1. NEVER the tree the live manifest points at. Read fresh from the bucket
     immediately before deleting, never from a cached or passed-in value.
  2. NEVER a tree newer than the live one. A publish in flight writes its
     tree BEFORE it CASes the manifest, so the newest tree is routinely one
     the manifest has not adopted yet — deleting it races the publisher and
     destroys the release it is about to announce.
  3. Keep at least K (default 8), so a rollback has somewhere to go.
  4. Only `\\d{4}-\\d{2}-\\d{2}T\\d{6}Z-\\d+` trees: the bucket also holds
     hand-made `deploy-*` and `release-*` trees that predate this pipeline
     and that nobody here is entitled to remove.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

BUCKET = os.environ.get("NEWS_PUBLIC_BUCKET", "data-electionsbg-com")
PREFIX = os.environ.get("NEWS_PUBLIC_PREFIX", "news/app-data")
BASE_URL = f"https://storage.googleapis.com/{BUCKET}/{PREFIX}"
RUN_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{6}Z-\d+$")
DEFAULT_KEEP = 8


def live_run_id():
    """The run id the CURRENT manifest points at, read fresh.

    Raises rather than returning None: a prune that cannot establish what is
    live must not proceed on an assumption.
    """
    req = urllib.request.Request(f"{BASE_URL}/manifest.json",
                                 headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        manifest = json.loads(resp.read())
    run_id = manifest.get("run_id")
    data_base = manifest.get("data_base")
    if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
        raise SystemExit(f"manifest run_id is not a pipeline run: {run_id!r}")
    # The manifest's own internal agreement, checked before anything is
    # deleted on the strength of it.
    if data_base != f"versions/{run_id}":
        raise SystemExit(
            f"manifest disagrees with itself: data_base={data_base!r} "
            f"run_id={run_id!r} — refusing to prune")
    return run_id


def list_versions():
    out = subprocess.run(
        ["gsutil", "ls", f"gs://{BUCKET}/{PREFIX}/versions/"],
        capture_output=True, text=True, timeout=600)
    ids = [line.rstrip("/").rsplit("/", 1)[-1]
           for line in out.stdout.splitlines() if line.strip()]
    return sorted(i for i in ids if RUN_ID_RE.match(i)), len(ids)


def plan(versions, live, keep):
    """(kept, deletable) — the refusals applied, in order."""
    if live not in versions:
        raise SystemExit(
            f"the live run {live} has no version tree — refusing to prune")
    # Rule 2: nothing at or after the live one, whatever K says. The ids sort
    # chronologically, so this is a slice.
    live_index = versions.index(live)
    older = versions[:live_index]
    newer_or_live = versions[live_index:]
    # Rule 3: keep K in total, counting the live one and anything newer.
    room = max(0, keep - len(newer_or_live))
    kept = older[-room:] if room else []
    deletable = older[:len(older) - len(kept)]
    return kept + newer_or_live, deletable


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=DEFAULT_KEEP)
    ap.add_argument("--apply", action="store_true",
                    help="actually delete (default is a dry run)")
    args = ap.parse_args(argv)
    if args.keep < 2:
        ap.error("--keep must be at least 2: one live release and one to "
                 "roll back to")

    live = live_run_id()
    versions, total_trees = list_versions()
    print(f"bucket:    gs://{BUCKET}/{PREFIX}/versions/")
    print(f"trees:     {total_trees} total, {len(versions)} from this pipeline")
    print(f"live:      {live}")
    kept, deletable = plan(versions, live, args.keep)
    print(f"keep:      {len(kept)} (K={args.keep})")
    print(f"delete:    {len(deletable)}")
    for run_id in deletable:
        print(f"   - {run_id}")
    if not deletable:
        print("\nnothing to prune")
        return 0
    # Stated rather than assumed, so the operator sees the refusals held.
    assert live not in deletable, "live release in the delete set"
    assert all(v < live for v in deletable), "a newer tree in the delete set"

    if not args.apply:
        print(f"\nDRY RUN — nothing deleted. Re-run with --apply to remove "
              f"{len(deletable)} trees (~{len(deletable) * 37.2:.0f} MB).")
        return 0

    # Re-read the manifest immediately before deleting: a publish may have
    # landed during the listing above, which would make an older plan stale.
    if live_run_id() != live:
        raise SystemExit("a publish landed while planning — re-run")
    for run_id in deletable:
        target = f"gs://{BUCKET}/{PREFIX}/versions/{run_id}/**"
        print(f"deleting {run_id} …")
        subprocess.run(["gsutil", "-m", "rm", "-r", target],
                       check=False, timeout=900)
    print(f"\ndeleted {len(deletable)} trees")
    return 0


if __name__ == "__main__":
    sys.exit(main())
