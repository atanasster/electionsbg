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

def _public_location() -> tuple[str, str]:
    """(bucket, prefix) — from the hourly config's NEWS_PUBLIC_GCS_URI when
    the runner sets it, else the explicit pair, else production."""
    uri = os.environ.get("NEWS_PUBLIC_GCS_URI", "")
    match = re.fullmatch(r"gs://([^/]+)/(.+?)/?", uri)
    if match:
        return match.group(1), match.group(2)
    return (os.environ.get("NEWS_PUBLIC_BUCKET", "data-electionsbg-com"),
            os.environ.get("NEWS_PUBLIC_PREFIX", "news/app-data"))


BUCKET, PREFIX = _public_location()
BASE_URL = f"https://storage.googleapis.com/{BUCKET}/{PREFIX}"
RUN_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{6}Z-\d+$")

# ⚠️ THE RETENTION POLICY, DERIVED RATHER THAN PICKED (plan T1.5). A reader
# is exposed to a pruned tree only while they still hold a manifest that
# names it. The client (newsapp/app/data.ts) re-reads the manifest every
# PUBLICATION_POLL_MS = 60 s, retries a failed read after 15 s, and a hidden
# tab catches up on `visibilitychange` — so the longest a live tab keeps an
# old `run_id` is one poll plus one retry. Nothing else references a run:
# story URLs resolve through the CURRENT manifest, the browse's depth memory
# is keyed by query, and the mentions rsync (stale-while-revalidate 3600 s)
# lives outside `versions/`. Two releases would therefore suffice for readers;
# the rest of K is ROLLBACK room, at the hourly cadence.
#
# Storage at steady state: K × ~37.2 MB (measured 2026-09-20) — against the
# unbounded 26.8 GB/month this replaces.
PUBLISH_CADENCE_SECONDS = 3600
READER_EXPOSURE_SECONDS = 60 + 15         # PUBLICATION_POLL_MS + FAILED_MANIFEST_RETRY_MS
CACHE_GRACE_SECONDS = 3600                # the widest public max-age outside versions/
ROLLBACK_RELEASES = 6                     # hourly releases an operator may roll back to
RELEASE_BYTES_ESTIMATE = 37.2 * 1024 * 1024
# The live release, the one every reader may still hold, and the rollback
# room — ONE derivation, so the two numbers cannot drift apart.
DEFAULT_KEEP = ROLLBACK_RELEASES + 2


def retention_policy(keep: int = DEFAULT_KEEP) -> dict:
    """What `keep` buys, stated in the units the decision was made in.

    `covers_readers` is the property that must never be false: the trees
    kept span longer than a reader can hold a manifest plus the cache grace.
    At the hourly cadence that puts the floor at K = 3 (`MIN_KEEP`), and the
    CLI refuses anything below it; the default keeps six releases more.
    """
    span = (keep - 1) * PUBLISH_CADENCE_SECONDS
    required = READER_EXPOSURE_SECONDS + CACHE_GRACE_SECONDS
    return {
        "keep": keep,
        "cadence_seconds": PUBLISH_CADENCE_SECONDS,
        "retained_span_seconds": span,
        "reader_exposure_seconds": READER_EXPOSURE_SECONDS,
        "cache_grace_seconds": CACHE_GRACE_SECONDS,
        "required_span_seconds": required,
        "covers_readers": span >= required,
        "rollback_releases": keep - 2,
        "storage_bytes_estimate": int(keep * RELEASE_BYTES_ESTIMATE),
    }


# The smallest K whose retained span covers a reader — derived, not typed.
MIN_KEEP = next(k for k in range(2, 100)
                if retention_policy(k)["covers_readers"])


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
    if args.keep < MIN_KEEP:
        policy = retention_policy(args.keep)
        ap.error(f"--keep must be at least {MIN_KEEP}: {args.keep} retains "
                 f"{policy['retained_span_seconds']} s of releases at a "
                 f"{PUBLISH_CADENCE_SECONDS} s cadence, under the "
                 f"{policy['required_span_seconds']} s a reader may still "
                 "hold a manifest for")

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
              f"{len(deletable)} trees "
              f"(~{len(deletable) * RELEASE_BYTES_ESTIMATE / 1024 / 1024:.0f} MB).")
        return 0

    # Re-read the manifest immediately before deleting: a publish may have
    # landed during the listing above, which would make an older plan stale.
    if live_run_id() != live:
        raise SystemExit("a publish landed while planning — re-run")
    # ⚠️ COUNTED BY EXIT CODE, not by plan entry. This runs unattended now
    # (run_hourly.sh) and its last line is what the run report shows; a
    # tree that survived a failed `rm` is re-planned next hour, but a report
    # that says „deleted 3" about 3 failures is how a permissions problem
    # stays invisible for a month.
    failed = []
    for run_id in deletable:
        target = f"gs://{BUCKET}/{PREFIX}/versions/{run_id}/**"
        print(f"deleting {run_id} …")
        proc = subprocess.run(["gsutil", "-m", "rm", "-r", target],
                              check=False, timeout=900)
        if proc.returncode != 0:
            failed.append(run_id)
    print(f"\ndeleted {len(deletable) - len(failed)} trees, "
          f"failed {len(failed)}" + (f": {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
