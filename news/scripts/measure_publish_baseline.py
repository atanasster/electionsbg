#!/usr/bin/env python3
"""Phase 4.1–4.5 — what the CURRENT publish path actually costs.

    python3 news/scripts/measure_publish_baseline.py
    python3 news/scripts/measure_publish_baseline.py --releases 6

Every later publish design has to beat this, and before today it existed as
one 2026-09-02 data point. Measures, in order:

  4.1 sizes, and WHICH FILES CHANGE between consecutive releases — the
      number that decides whether the overlay (§6.5) and content addressing
      (§7.6 F2) are worth building at all. If most files change every hour,
      an overlay saves nothing.
  4.2 timings per stage and per upload scope, read from the run reports
      already on disk.
  4.3 reader cost, MEASURED: what a cold reader and a warm reader actually
      download, with and without `Accept-Encoding: gzip`.
  4.4 gzip at rest as a figure rather than an estimate.
  4.5 GCS operations and storage added per release — there is no lifecycle
      rule (§0.1 R5), so this accumulates.

⚠️ It reads the published bucket and writes nothing. The per-release
inventories come from `gsutil ls -L`, which returns each object's size and
MD5 without downloading it — so the changed-file diff costs a listing per
release rather than a copy of the corpus.
"""

import argparse
import collections
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("DATA_BG_ROOT") or SCRIPT_DIR.parents[1])
NEWS = REPO_ROOT / "news"

BUCKET = os.environ.get("NEWS_PUBLIC_BUCKET", "data-electionsbg-com")
PREFIX = os.environ.get("NEWS_PUBLIC_PREFIX", "news/app-data")
BASE_URL = f"https://storage.googleapis.com/{BUCKET}/{PREFIX}"
# Only the pipeline's own run ids: the bucket also holds hand-made
# `deploy-*` and `release-*` trees from before the v3 path, and folding
# those into a per-release diff would compare different producers.
RUN_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{6}Z-\d+$")


def gsutil(*args):
    out = subprocess.run(["gsutil", *args], capture_output=True, text=True,
                         timeout=600)
    return out.stdout


def list_versions():
    lines = gsutil("ls", f"gs://{BUCKET}/{PREFIX}/versions/").splitlines()
    ids = [line.rstrip("/").rsplit("/", 1)[-1] for line in lines if line.strip()]
    return sorted(i for i in ids if RUN_ID_RE.match(i))


def inventory(run_id, content=True):
    """{path: fingerprint} for one published version tree.

    ⚠️ THE FINGERPRINT MUST BE OF THE CONTENT, NOT THE STORED OBJECT, and
    getting that wrong reverses the finding. These objects are stored
    gzipped (`-z json`), and gzip embeds a timestamp — so two releases of a
    BYTE-IDENTICAL file compress to different bytes and carry different
    MD5s. A diff over `gsutil ls -L` hashes therefore reports 100% churn on
    a corpus that never changed, which is exactly the conclusion the overlay
    decision turns on. `content=True` fetches each object with
    `Accept-Encoding: identity`, letting GCS transcode, and hashes what a
    reader would actually receive.

    `content=False` keeps the cheap listing for size-only questions.
    """
    raw = gsutil("ls", "-L", f"gs://{BUCKET}/{PREFIX}/versions/{run_id}/**")
    out, path, size, md5 = {}, None, None, None
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith(f"gs://{BUCKET}/") and stripped.endswith(":"):
            if path:
                out[path] = (size, md5)
            path = stripped[:-1].split(f"/versions/{run_id}/", 1)[-1]
            size, md5 = None, None
        elif stripped.startswith("Content-Length:"):
            size = int(stripped.split(":", 1)[1].strip())
        elif stripped.startswith("Hash (md5):"):
            md5 = stripped.split(":", 1)[1].strip()
    if path:
        out[path] = (size, md5)
    if not content:
        return out
    hashed = {}
    for rel, (size, _md5) in out.items():
        try:
            req = urllib.request.Request(
                f"{BASE_URL}/versions/{run_id}/{rel}",
                headers={"Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read()
            hashed[rel] = (len(body),
                           hashlib.sha256(body).hexdigest())
        except Exception:  # noqa: BLE001 — an unreadable object is reported
            hashed[rel] = (size, None)   # falls back to a size comparison
    return hashed


def record_delta(prev_id, cur_id, paths):
    """The delta an OVERLAY would actually carry: new or changed RECORDS.

    ⚠️ FILE-LEVEL CHURN IS THE WRONG BASIS FOR THE §6.5 DECISION, and using
    it inverts the answer. Every `articles/<domain>.json` is rewritten whole
    when a single article is appended, and every file additionally carries
    the run's `generated_at` — so a file diff reports 100% churn while the
    substance that moved is ~1%. Measured between two consecutive hourly
    releases: 0 of 65 files byte-identical, but 30 of 65 identical once the
    stamp is stripped, and only 105 of 9,104 article records new or changed.
    An overlay carries the 105, not the 65 files.
    """
    new_records = total_records = new_bytes = files_with_delta = 0
    for rel in paths:
        try:
            prev = fetch_json(prev_id, rel)
            cur = fetch_json(cur_id, rel)
        except Exception:  # noqa: BLE001 — an unreadable file is skipped
            continue
        old_list = prev.get("articles") if isinstance(prev, dict) else prev
        new_list = cur.get("articles") if isinstance(cur, dict) else cur
        if not isinstance(old_list, list) or not isinstance(new_list, list):
            continue

        def key(rec):
            return rec.get("url") or rec.get("id") or json.dumps(
                rec, sort_keys=True, ensure_ascii=False)

        old = {key(r): json.dumps(r, sort_keys=True, ensure_ascii=False)
               for r in old_list}
        delta = [r for r in new_list
                 if old.get(key(r)) != json.dumps(r, sort_keys=True,
                                                  ensure_ascii=False)]
        total_records += len(new_list)
        new_records += len(delta)
        files_with_delta += 1 if delta else 0
        new_bytes += len(json.dumps(delta, ensure_ascii=False).encode())
    return {"records": total_records, "changed_records": new_records,
            "changed_share": new_records / total_records if total_records else None,
            "delta_bytes": new_bytes, "files_with_delta": files_with_delta}


def fetch_json(run_id, rel):
    req = urllib.request.Request(f"{BASE_URL}/versions/{run_id}/{rel}",
                                 headers={"Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def changed(prev, cur):
    """Files added, removed or altered between two releases."""
    added = sorted(set(cur) - set(prev))
    removed = sorted(set(prev) - set(cur))
    altered = sorted(p for p in set(cur) & set(prev) if cur[p] != prev[p])
    return added, removed, altered


def fetch(url, gzip_ok):
    req = urllib.request.Request(url, headers={
        "Accept-Encoding": "gzip" if gzip_ok else "identity"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read()
        return {"status": resp.status, "bytes_on_wire": len(body),
                "content_encoding": resp.headers.get("Content-Encoding"),
                "stored_encoding": resp.headers.get(
                    "x-goog-stored-content-encoding"),
                "cache_control": resp.headers.get("Cache-Control")}


def run_timings(limit):
    """4.2 — stage and upload-scope seconds, from the reports on disk."""
    rows = []
    # ⚠️ Only the pipeline's own run reports. The directory also holds
    # hand-made `deploy-*` and `image-cache-*` files, and a bare glob sorted
    # them in beside real runs — printing five rows of `None` seconds that
    # looked like missing instrumentation rather than the wrong files.
    candidates = [p for p in sorted((NEWS / "data" / "_nightly").glob("*.json"))
                  if RUN_ID_RE.match(p.stem)]
    for path in candidates[-limit:]:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        # the key is `stage`, not `name` — `name` is the upload SCOPE's key
        stages = {s.get("stage"): s.get("seconds")
                  for s in report.get("stages") or [] if isinstance(s, dict)}
        upload = NEWS / "var" / "reports" / f"{report.get('run_id')}.upload.json"
        scopes = {}
        if upload.is_file():
            try:
                scopes = {s["name"]: s.get("seconds")
                          for s in json.loads(upload.read_text(
                              encoding="utf-8")).get("scopes") or []}
            except (OSError, json.JSONDecodeError, KeyError, TypeError):
                scopes = {}
        rows.append({"run_id": report.get("run_id"),
                     "bundles": stages.get("bundles"),
                     "home_health": stages.get("home_health"),
                     "scopes": scopes})
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--releases", type=int, default=6,
                    help="consecutive releases to diff (4.1)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)

    versions = list_versions()
    print(f"published version trees (pipeline run ids): {len(versions)}")
    chosen = versions[-args.releases:]
    if len(chosen) < 2:
        print(f"need at least 2 pipeline releases to diff, found "
              f"{len(chosen)} (pattern {RUN_ID_RE.pattern})", file=sys.stderr)
        return 1
    print(f"diffing the last {len(chosen)}: {chosen[0]} … {chosen[-1]}\n")

    inventories = {}
    for run_id in chosen:
        inventories[run_id] = inventory(run_id)
        total = sum(b or 0 for b, _ in inventories[run_id].values())
        print(f"  {run_id}  {len(inventories[run_id]):>3} files  "
              f"{total/1e6:>7.2f} MB")

    print("\n4.1 — what changes between consecutive releases")
    diffs = []
    for prev_id, cur_id in zip(chosen, chosen[1:]):
        prev, cur = inventories[prev_id], inventories[cur_id]
        added, removed, altered = changed(prev, cur)
        moved = added + altered
        moved_bytes = sum(cur[p][0] or 0 for p in moved)
        total_bytes = sum(b or 0 for b, _ in cur.values())
        diffs.append({"from": prev_id, "to": cur_id,
                      "files": len(cur), "added": len(added),
                      "removed": len(removed), "altered": len(altered),
                      "changed_files": len(moved),
                      "changed_share": len(moved) / len(cur) if cur else None,
                      "changed_bytes": moved_bytes,
                      "changed_bytes_share":
                          moved_bytes / total_bytes if total_bytes else None,
                      "changed_paths": moved[:40]})
        print(f"  {cur_id}: {len(moved):>3}/{len(cur)} files changed "
              f"({len(moved)/len(cur):>5.1%})  "
              f"{moved_bytes/1e6:>6.2f} MB of {total_bytes/1e6:.2f} MB "
              f"({moved_bytes/total_bytes:>5.1%})")

    if diffs:
        mean_files = sum(d["changed_share"] for d in diffs) / len(diffs)
        mean_bytes = sum(d["changed_bytes_share"] for d in diffs) / len(diffs)
        print(f"\n  mean: {mean_files:.1%} of files, {mean_bytes:.1%} of bytes "
              f"move per hourly release")
        # ⚠️ THE OVERLAY'S PREMISE, stated as a number rather than assumed.
        # §6.5 is worth building only if a release moves a small part of the
        # corpus; if most of it moves every hour there is nothing to overlay.
        # ⚠️ The verdict is decided on the RECORD delta, never on the file
        # churn printed above — see `record_delta`. Whole-file rewrites plus
        # a universal `generated_at` make the file number 100% while the
        # substance that moved is ~1%.
        article_paths = [p for p in inventories[chosen[-1]]
                         if p.startswith("articles/")]
        rd = record_delta(chosen[-2], chosen[-1], article_paths)
        print(f"\n  record delta (the overlay's real payload): "
              f"{rd['changed_records']}/{rd['records']} records "
              f"({rd['changed_share']:.2%}), {rd['delta_bytes']/1024:.1f} KB "
              f"across {rd['files_with_delta']} files")
        verdict = ("SUPPORTED — the overlay carries ~1% of the records"
                   if (rd["changed_share"] or 1) < 0.10 else
                   "NOT SUPPORTED — most of the corpus moves every release")
        print(f"  overlay premise (§6.5): {verdict}")
        churn = collections.Counter()
        for d in diffs:
            churn.update(d["changed_paths"])
        print("  most-changed paths:",
              ", ".join(f"{p} ({n})" for p, n in churn.most_common(5)))

    print("\n4.2 — stage and upload-scope seconds")
    timings = run_timings(args.releases)
    for row in timings[-args.releases:]:
        scopes = " ".join(f"{k}={v}s" for k, v in (row["scopes"] or {}).items())
        print(f"  {row['run_id']}  bundles={row['bundles']}s "
              f"home_health={row['home_health']}s  {scopes}")

    print("\n4.3/4.4 — reader cost and gzip at rest")
    latest = chosen[-1]
    reader = {}
    for name in ("home.json", "latest.json", "stories.json"):
        url = f"{BASE_URL}/versions/{latest}/{name}"
        try:
            gz = fetch(url, True)
            raw = fetch(url, False)
        except Exception as exc:  # noqa: BLE001 — a probe never fails the run
            print(f"  {name}: {type(exc).__name__}: {exc}")
            continue
        reader[name] = {"gzip": gz, "identity": raw}
        ratio = (raw["bytes_on_wire"] / gz["bytes_on_wire"]
                 if gz["bytes_on_wire"] else None)
        print(f"  {name:14} gzip {gz['bytes_on_wire']:>9,} B   "
              f"identity {raw['bytes_on_wire']:>9,} B   "
              f"{ratio:.1f}x   stored={gz['stored_encoding']}")

    print("\n4.5 — operations and storage per release")
    files_per_release = len(inventories[chosen[-1]])
    bytes_per_release = sum(b or 0 for b, _ in inventories[chosen[-1]].values())
    print(f"  objects written per release: {files_per_release} "
          f"(+1 manifest CAS) = {files_per_release + 1} PUTs")
    print(f"  storage added per release:   {bytes_per_release/1e6:.1f} MB")
    print(f"  at hourly cadence:           "
          f"{bytes_per_release*24/1e9:.2f} GB/day, "
          f"{bytes_per_release*24*30/1e9:.1f} GB/month")
    print(f"  version trees now in the bucket: {len(versions)} "
          f"(no lifecycle rule — §0.1 R5)")

    report = {"generated_at": datetime.now(timezone.utc).isoformat(),
              "bucket": f"gs://{BUCKET}/{PREFIX}",
              "versions_total": len(versions), "diffed": chosen,
              "per_release": {k: {"files": len(v),
                                  "bytes": sum(b or 0 for b, _ in v.values())}
                              for k, v in inventories.items()},
              "diffs": diffs, "timings": timings, "reader": reader,
              "record_delta": rd if diffs else None,
              "files_per_release": files_per_release,
              "bytes_per_release": bytes_per_release}
    out_path = Path(args.out) if args.out else (
        NEWS / "data" / "_perf" /
        f"publish-baseline-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    print(f"\nreport -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
