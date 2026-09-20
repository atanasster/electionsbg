#!/usr/bin/env python3
"""Plan §4.6(c) — build the overlay a hot release publishes.

    python3 news/scripts/build_overlay.py --out var/overlay.json

An hourly ("cold") run publishes a full immutable version tree: measured
2026-09-20, **37.2 MB over ~2,100 objects, 96 s of upload** plus 22.6 s of
metadata. A fast ("hot") run publishes ONE object instead — everything the
store holds that the live base does not — and re-points the manifest at
the same `run_id`, so no reader's cache is cleared.

⚠️ IT REBUILDS THE WHOLE TREE AND SUBTRACTS, RATHER THAN COMPUTING THE
DELTA INCREMENTALLY, AND THAT IS A DELIBERATE DEPARTURE FROM WHAT THIS
STEP WAS EXPECTED TO BE. The plan describes `build_overlay.py` as
"store − base, cumulative", and an earlier note in `overlay_merge.py`
asserted that the hot path "cannot" rebuild. That was a prediction, and
the measurement disagrees with it:

    bundles (the whole rebuild)          21–76 s   (§4.2, three runs)
    the upload it replaces               96 s + 22.6 s

So the rebuild is not the cost — the UPLOAD is, and that is what the
overlay removes. Against that, an incremental differ would be a SECOND
implementation of every rule in `build_app_data.py`: which fields a feed
record carries, how a bundle's content stamp is derived, what makes a
story's `related` list change. Nothing could verify it except the full
rebuild it exists to avoid, and the whole of this phase has been finding
defects in exactly that shape. Rebuilding keeps ONE definition of what a
release contains, and `diff_overlay` then cannot disagree with it.

Re-measure before assuming this still holds: at a five-minute cadence a
76 s rebuild is a quarter of the interval, and if `bundles` grows with the
corpus past roughly half of it, the trade changes.

WHAT IT REFUSES, and why each refusal is not a preference:

  1. A local base that is not what the bucket is serving. An overlay is
     published against a specific `run_id`; built against a different tree
     it describes a delta from a release nobody holds, and every reader
     merging it lands somewhere that never existed. Checked by recomputing
     the base's own bundle hash and comparing it to the live manifest's.
  2. A merged home payload that fails `home_health`. The release gate is
     not suspended because a release is small — §6.5 requires the gate to
     run on the MERGED payload, which is what a reader will actually see.
  3. An overlay larger than the tree would have been. That cannot happen
     for a real delta, and if it does the premise is broken.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(ROOT))

import overlay_merge as om  # noqa: E402
from home_health import evaluate_home_payload  # noqa: E402
from news.scripts.app_data_inventory import tree_inventory  # noqa: E402

BUCKET = os.environ.get("NEWS_PUBLIC_BUCKET", "data-electionsbg-com")
PREFIX = os.environ.get("NEWS_PUBLIC_PREFIX", "news/app-data")
BASE_URL = f"https://storage.googleapis.com/{BUCKET}/{PREFIX}"
DEFAULT_LATEST = 150
# The overlay's whole point is that it is small. §4.6's acceptance is
# "2 objects and ≤ 100 KB"; this is the refusal, set well above it so a
# busy hour is not rejected for being busy.
MAX_OVERLAY_BYTES = 2 * 1024 * 1024


class OverlayError(RuntimeError):
    """A refusal. Nothing is written and nothing is published."""


def live_manifest() -> dict:
    """The manifest the bucket is serving, read fresh.

    ⚠️ Never a cached or passed-in copy: the whole overlay is a claim
    about a specific base, so reading a stale pointer produces a delta
    from a release that is no longer live.
    """
    request = urllib.request.Request(f"{BASE_URL}/manifest.json",
                                     headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=60) as response:
        manifest = json.loads(response.read())
    if not isinstance(manifest, dict):
        raise OverlayError("live manifest is not an object")
    return manifest


def read_release(out_dir: Path) -> dict:
    """A built tree as {published path: payload} — what the merge speaks."""
    return {str(path.relative_to(out_dir)):
            json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(out_dir.rglob("*.json"))}


def verify_base(app_data: Path, manifest: dict) -> None:
    """The local base must BE the release the bucket is serving.

    ⚠️ THE ONE CHECK THAT CANNOT BE SKIPPED. Everything downstream is a
    difference FROM this tree, so if it is not the live one the overlay is
    a delta from a release no reader holds — and it fails silently, since
    every path still parses and merges. The bundle hash is the publisher's
    own (`tree_inventory`), so this compares like with like rather than
    re-deriving a second notion of what the tree is.
    """
    bundle = manifest.get("bundle")
    if not isinstance(bundle, dict) or not isinstance(bundle.get("sha256"), str):
        raise OverlayError("live manifest carries no bundle hash")
    local = tree_inventory(app_data)
    if local["sha256"] != bundle["sha256"]:
        raise OverlayError(
            f"{app_data} is not the live release: local bundle "
            f"{local['sha256'][:12]}… against manifest "
            f"{bundle['sha256'][:12]}… (run_id {manifest.get('run_id')!r}). "
            f"Re-run the cold publish, or point --base at the tree that "
            f"was published.")


def build_current(out_dir: Path, latest: int, base: Path) -> None:
    """Rebuild the tree from the store, into a throwaway directory.

    ⚠️ NOT into `news/app-data`. That directory IS the base this overlay
    is measured against, and a hot run that overwrote it would destroy the
    only local copy of the release the bucket is serving — after which
    `verify_base` could never pass again and every later hot run would be
    refused, with the cause several runs upstream.
    """
    result = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "build_app_data.py"),
         "--out", str(out_dir), "--latest", str(latest),
         # ⚠️ Without this every file carries THIS run's timestamp, so
         # every file differs from the base and the overlay carries the
         # whole release. Measured before it existed: 1.84 MB, of which
         # 1.57 MB was three files whose content had not changed at all.
         "--stamp-from", str(base),
         "--quiet", "--json"],
        capture_output=True, text=True, cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT)})
    if result.returncode != 0:
        raise OverlayError(
            f"bundles failed, so there is nothing to publish:\n{result.stderr}")


def gate_merged_home(base: dict, overlay: dict) -> dict:
    """`home_health` on the MERGED payload — what a reader will see.

    ⚠️ THE GATE IS NOT SUSPENDED BECAUSE A RELEASE IS SMALL. A hot release
    replaces the home payload wholesale, so it can put the front page into
    exactly the states the gate exists to refuse — stale anchors, too few
    stories, an outlet taking the page — and it can do so between two
    hourly runs that both passed. Evaluated on the merge rather than on
    the overlay's own `home`, because the merge is what is served.
    """
    merged = om.apply_overlay(base, overlay)
    home = merged.get("home.json")
    if not isinstance(home, dict):
        raise OverlayError("merged release has no home payload")
    try:
        health = evaluate_home_payload(home)
    except ValueError as error:
        # ⚠️ A payload the gate cannot even READ is a refusal, not a
        # crash. Letting the ValueError out gives a traceback that looks
        # like a bug in the builder, and — worse — it is a different
        # failure class from "the gate said no", so an operator wiring
        # this into the hourly transaction would have to handle two.
        raise OverlayError(f"home_health cannot read the merged payload: "
                           f"{error}") from error
    if health.get("ready") is not True:
        raise OverlayError(
            f"home_health refuses the merged payload: "
            f"{json.dumps(health, ensure_ascii=False)}")
    return health


def next_seq(manifest: dict) -> int:
    """One past the live overlay's, or 1 when the base has none.

    The sequence is per BASE: a cold release resets it, because its tree
    already contains everything the overlays before it carried.
    """
    pointer = manifest.get("overlay")
    if not isinstance(pointer, dict):
        return 1
    seq = pointer.get("seq")
    return seq + 1 if isinstance(seq, int) and seq >= 1 else 1


def build(app_data: Path, out: Path, *, latest: int,
          keep_tree: Path | None = None, seq: int | None = None) -> dict:
    manifest = live_manifest()
    run_id = manifest.get("run_id")
    if not isinstance(run_id, str):
        raise OverlayError("live manifest carries no run_id")
    verify_base(app_data, manifest)

    started = time.monotonic()
    work = Path(tempfile.mkdtemp(prefix="news_overlay_"))
    try:
        build_current(work, latest, app_data)
        seconds = round(time.monotonic() - started, 1)
        base = read_release(app_data)
        full = read_release(work)
        overlay = om.diff_overlay(
            base, full, seq=seq or next_seq(manifest), base_run_id=run_id,
            generated_at=datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            latest_limit=latest)
        health = gate_merged_home(base, overlay)

        payload = (json.dumps(overlay, ensure_ascii=False,
                              separators=(",", ":")) + "\n").encode("utf-8")
        if len(payload) > MAX_OVERLAY_BYTES:
            raise OverlayError(
                f"overlay is {len(payload) / 1024:.0f} KB, over the "
                f"{MAX_OVERLAY_BYTES / 1024:.0f} KB ceiling — a delta this "
                f"large means the premise is wrong, so publish a cold "
                f"release instead")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(payload)
        if keep_tree is not None:
            # ⚠️ AN UNGUARDED rmtree HERE CAN DELETE THE BASE, which is
            # the exact catastrophe `build_current` refuses to risk two
            # functions above: `--keep-tree news/app-data` would remove
            # the only local copy of the live release, and every later hot
            # run would be refused with the cause several runs upstream.
            # An inspection flag is not worth a destructive default.
            if keep_tree.resolve() == app_data.resolve():
                raise OverlayError(
                    "--keep-tree may not be the base tree: it would delete "
                    "the only local copy of the live release")
            if keep_tree.exists():
                raise OverlayError(
                    f"--keep-tree {keep_tree} already exists; remove it "
                    f"yourself rather than having a debug flag delete it")
            shutil.copytree(work, keep_tree)
        return {
            "mode": "news_overlay_build",
            "base_run_id": run_id,
            "seq": overlay["seq"],
            "path": str(out),
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "bundles_seconds": seconds,
            "changed": {
                "article_domains": len(overlay["articles"]),
                "story_details": len(overlay["story_details"]),
                "replaced_paths": len(overlay["replaced_paths"]),
                "removed_story_ids": len(overlay["removed_story_ids"]),
                "removed_domains": len(overlay["removed_domains"]),
            },
            "home_health": health,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", type=Path,
                        default=ROOT / "news" / "app-data",
                        help="the tree the live release was published from")
    parser.add_argument("--out", type=Path,
                        default=ROOT / "news" / "var" / "overlay.json")
    parser.add_argument("--latest", type=int, default=DEFAULT_LATEST,
                        help="must match the cold build's --latest")
    parser.add_argument("--seq", type=int,
                        help="override the sequence. ⚠️ The recovery for a "
                             "hot run that uploaded its overlay and then "
                             "failed before the manifest: the sequence is "
                             "derived from the MANIFEST, which that run "
                             "never advanced, so a plain retry recomputes "
                             "the same seq and collides with its own "
                             "orphan (the object is create-only)")
    parser.add_argument("--keep-tree", type=Path,
                        help="keep the rebuilt tree here (for inspection); "
                             "it is NOT the base and must not replace it")
    args = parser.parse_args(argv)
    try:
        if args.seq is not None and args.seq < 1:
            parser.error("--seq must be at least 1")
        summary = build(args.base, args.out, latest=args.latest,
                        keep_tree=args.keep_tree, seq=args.seq)
    except OverlayError as error:
        print(json.dumps({"mode": "news_overlay_build", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
