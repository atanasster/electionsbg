#!/usr/bin/env python3
"""Upload private news history and hot derived JSON to isolated GCS prefixes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.scripts.app_data_inventory import (  # noqa: E402
    is_story_detail_path, tree_inventory)

GS_URI = re.compile(r"^gs://([^/]+)(?:/(.+?))?/?$")
EXPECTED_STAGES = (
    "acquire_direct", "acquire_browser", "probe_model", "check_prompts",
    "common_words", "analyze", "image_rights_queue", "image_candidates",
    "review_queue", "mention_index", "eval_export", "bundles",
    "eval_task_build", "home_health",
)
ARCHIVE_EXCLUDE = (
    # `_perf` is the shared perf log (news/scripts/perf_log.py): archiving it
    # would re-upload a growing file on every release and inflate the very
    # per-publish bytes it exists to measure (plan §0.5 N2).
    r"(^|/)(_browser|_html|_nightly|_perf|evals|gold)(/|$)|"
    r"(^|/)\.DS_Store$|(^|/)_summaries.*\.jsonl$"
)
IMMUTABLE_PUBLIC_CACHE = "Cache-Control:public,max-age=31536000,immutable"
MUTABLE_PUBLIC_CACHE_VALUE = "public,max-age=300,stale-while-revalidate=3600"
MUTABLE_PUBLIC_CACHE = f"Cache-Control:{MUTABLE_PUBLIC_CACHE_VALUE}"
MANIFEST_CACHE = "Cache-Control:no-cache,max-age=0,must-revalidate"
PRIVATE_CACHE = "Cache-Control:private,no-store"
PUBLICATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
ISO_INSTANT = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
MANIFEST_SOURCE = "<generated-publication-manifest>"
GENERATION_SOURCE = "<remote-generation>"


def uri(name: str, *, delete_scope: bool) -> str:
    value = (os.environ.get(name) or "").rstrip("/")
    match = GS_URI.fullmatch(value)
    if not match:
        raise ValueError(f"{name} must be a gs://bucket/prefix URI")
    if delete_scope and not match.group(2):
        raise ValueError(
            f"{name} needs a non-empty prefix because its rsync deletes "
            "unmatched destination objects")
    prefix = match.group(2)
    if prefix and any(part in ("", ".", "..") for part in prefix.split("/")):
        raise ValueError(f"{name} contains an unsafe or empty path segment")
    return value


def load_report(
    path: Path | None,
    expected_run_id: str | None = None,
    *,
    allow_dry_run: bool = False,
) -> tuple[bool, str]:
    if path is None:
        return False, "archive_only"
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return False, f"unreadable_pipeline_report: {exc}"
    if not isinstance(report, dict):
        return False, "invalid_pipeline_report: root must be an object"
    if (not isinstance(report.get("run_id"), str)
            or not PUBLICATION_ID.fullmatch(report["run_id"])):
        return False, "invalid_pipeline_report: unsafe or missing run_id"
    if expected_run_id is not None and report.get("run_id") != expected_run_id:
        return False, "invalid_pipeline_report: run_id mismatch"
    rows = report.get("stages")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        return False, "invalid_pipeline_report: stages must be an object array"
    names = [row.get("stage") for row in rows]
    if (names != list(EXPECTED_STAGES)
            or report.get("stages_run") != len(EXPECTED_STAGES)):
        return False, "invalid_pipeline_report: incomplete or reordered stages"
    if any(not isinstance(row.get("exit"), int) for row in rows):
        return False, "invalid_pipeline_report: stage exits must be integers"
    stages = dict(zip(names, rows))
    failed_all = [name for name, row in stages.items() if row["exit"] != 0]
    if (report.get("failed_stages") != failed_all
            or report.get("stages_ok") != len(rows) - len(failed_all)):
        return False, "invalid_pipeline_report: summary does not match stages"
    failed = [name for name in (
        "mention_index", "eval_export", "bundles", "eval_task_build", "home_health")
              if stages[name]["exit"] != 0]
    if failed:
        return False, f"public_not_ready: failed={failed}"
    if allow_dry_run and all(
        isinstance(row.get("result"), dict)
        and row["result"].get("skipped") == "dry_run"
        for row in rows
    ):
        return True, "ready_dry_run"
    health = stages["home_health"].get("result")
    if not (
        isinstance(health, dict)
        and health.get("mode") == "home_health"
        and health.get("ready") is True
        and health.get("declared_selected_payload_matches") is True
        and health.get("eligibility_counts_verified") is False
        and isinstance(health.get("health"), dict)
        and health["health"].get("ready") is True
    ):
        return False, "public_not_ready: invalid home_health verdict"
    return True, "ready"


def public_upload_enabled() -> bool:
    value = os.environ.get("NEWS_ENABLE_PUBLIC_UPLOAD", "0")
    if value not in ("0", "1"):
        raise ValueError("NEWS_ENABLE_PUBLIC_UPLOAD must be 0 or 1")
    return value == "1"


def expected_publication_inventory(stages: dict[str, dict]) -> dict:
    """Choose the last stage that can mutate the public app-data tree."""
    bundle_result = stages["bundles"].get("result")
    task_build_result = stages["eval_task_build"].get("result")
    if (isinstance(task_build_result, dict)
            and task_build_result.get("exit") == 0):
        inventory = task_build_result.get("publication_inventory")
        if not isinstance(inventory, dict):
            raise ValueError(
                "successful eval task build omitted the final app-data inventory")
        if set(inventory) != {"generated_at", "sha256", "files", "bytes"}:
            raise ValueError(
                "successful eval task build returned a malformed final inventory")
        parse_aware_instant(inventory["generated_at"], "task inventory generated_at")
        if (type(inventory["files"]) is not int or inventory["files"] < 1
                or type(inventory["bytes"]) is not int or inventory["bytes"] < 0
                or not isinstance(inventory["sha256"], str)
                or re.fullmatch(r"[a-f0-9]{64}", inventory["sha256"]) is None):
            raise ValueError(
                "successful eval task build returned a malformed final inventory")
        return inventory
    if not isinstance(bundle_result, dict):
        raise ValueError("bundle stage omitted its app-data inventory")
    return bundle_result


def parse_aware_instant(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not ISO_INSTANT.fullmatch(value):
        raise ValueError(f"{label} must be a timezone-aware ISO instant")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be a timezone-aware ISO instant") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{label} must be a timezone-aware ISO instant")
    return parsed.astimezone(timezone.utc)


def materialize_snapshot(source: Path, destination: Path) -> dict:
    before = tree_inventory(source)
    shutil.copytree(source, destination,
                    ignore=shutil.ignore_patterns(".DS_Store"))
    snapshot = tree_inventory(destination)
    after = tree_inventory(source)
    if before != snapshot or after != snapshot:
        raise ValueError("app-data changed while its publication snapshot was made")
    return snapshot


def publication_manifest(
    publication_id: str,
    app_data: Path,
    expected_bundle: dict | None = None,
    expected_health: dict | None = None,
) -> dict:
    if not PUBLICATION_ID.fullmatch(publication_id):
        raise ValueError("pipeline run_id is not safe for a version path")
    try:
        home = json.loads((app_data / "home.json").read_text(encoding="utf-8"))
        stats = json.loads((app_data / "stats.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot build publication manifest: {exc}") from exc
    health = home.get("home_health") if isinstance(home, dict) else None
    generated_at = home.get("generated_at") if isinstance(home, dict) else None
    parse_aware_instant(generated_at, "home generated_at")
    if not isinstance(stats, dict) or stats.get("generated_at") != generated_at:
        raise ValueError(
            "cannot build publication manifest: stats generation does not match home")
    def provenance_hash(key: str, label: str) -> str | None:
        if key not in stats:
            raise ValueError(
                f"cannot build publication manifest: {label} provenance is missing")
        value = stats[key]
        if value is None:
            return None
        if isinstance(value, str) and value.startswith("sha256:"):
            value = value.removeprefix("sha256:")
        if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
            raise ValueError(
                f"cannot build publication manifest: invalid {label} hash")
        return value

    accepted_hash = provenance_hash(
        "accepted_snapshot_records_sha256", "accepted snapshot")
    has_feedback_provenance = "accepted_feedback_records_sha256" in stats
    feedback_hash = (provenance_hash(
        "accepted_feedback_records_sha256", "accepted feedback")
        if has_feedback_provenance else None)
    if not isinstance(health, dict) or health.get("ready") is not True:
        raise ValueError("cannot build publication manifest: home health is not ready")
    bundle = tree_inventory(app_data)
    if expected_bundle is not None and (
        expected_bundle.get("generated_at") != generated_at
        or expected_bundle.get("files") != bundle["files"]
        or expected_bundle.get("bytes") != bundle["bytes"]
        or (expected_bundle.get("sha256") is not None
            and expected_bundle.get("sha256") != bundle["sha256"])
    ):
        raise ValueError("app-data snapshot does not match the pipeline bundle result")
    if expected_health is not None and expected_health != health:
        raise ValueError("app-data home health does not match the pipeline gate")
    manifest = {
        "version": 3 if has_feedback_provenance else 2,
        "run_id": publication_id,
        "generated_at": generated_at,
        "data_base": f"versions/{publication_id}",
        "home_health_ready": True,
        "accepted_snapshot_records_sha256": accepted_hash,
        "bundle": bundle,
    }
    if has_feedback_provenance:
        manifest["accepted_feedback_records_sha256"] = feedback_hash
    return manifest


def commands(
    public_ready: bool,
    public_enabled: bool,
    publication: dict | None = None,
    app_data: Path | None = None,
) -> list[dict]:
    archive = uri("NEWS_ARCHIVE_GCS_URI", delete_scope=False)
    mentions_source = Path(os.environ.get("NEWS_MENTIONS_DIR") or
                           ROOT / "data" / "news" / "mentions")
    scopes = [{
        "name": "archive",
        "source": ROOT / "news" / "data",
        "destination": archive,
        "argv": ["gsutil", "-m", "-h", PRIVATE_CACHE, "rsync", "-r",
                 "-x", ARCHIVE_EXCLUDE, str(ROOT / "news" / "data"), archive],
        "deletes_remote": False,
    }]
    if public_ready and public_enabled:
        public = uri("NEWS_PUBLIC_GCS_URI", delete_scope=True)
        mentions = uri("NEWS_MENTIONS_GCS_URI", delete_scope=True)
        if not isinstance(publication, dict):
            raise ValueError("public publication manifest is required")
        publication_id = publication.get("run_id")
        data_base = publication.get("data_base")
        if (not isinstance(publication_id, str)
                or not PUBLICATION_ID.fullmatch(publication_id)
                or data_base != f"versions/{publication_id}"):
            raise ValueError("public publication manifest has an unsafe version path")
        version_destination = f"{public}/{data_base}"
        app_data = app_data or ROOT / "news" / "app-data"
        scopes += [
            {
                "name": "public_app_data_version",
                "source": app_data,
                "destination": version_destination,
                "argv": ["gsutil", "-m", "-h", IMMUTABLE_PUBLIC_CACHE,
                         "-h", "x-goog-if-generation-match:0", "cp",
                         # -z, not -j: STORED gzip (Content-Encoding: gzip),
                         # ~4.5x smaller for every reader of every release;
                         # -j only compressed the upload and left `identity`
                         # at rest (plan §0.3 V1). The manifest's bytes/sha256
                         # describe the UNCOMPRESSED file, which is what the
                         # client verifies since T1.5 (`verifyPublished` in
                         # newsapp/app/data.ts — every listed payload, and
                         # the overlay against its pointer). `-z json` matches by EXTENSION —
                         # every published file is .json (the client's
                         # inventory rule enforces it).
                         "-r", "-z", "json", f"{app_data}/*",
                         version_destination],
                "deletes_remote": False,
            },
            {
                # ⚠️ `cp -z` APPENDS `no-transform` to Cache-Control
                # (gsutil copy_helper.py), and no-transform switches off
                # GCS decompressive transcoding — so a client that does not
                # send Accept-Encoding: gzip (curl, urllib) would receive raw
                # gzip bytes and fail the manifest's sha256. Reset the policy
                # on the whole version BEFORE the manifest can point at it;
                # a failure here blocks the manifest like any other scope.
                "name": "public_app_data_version_meta",
                "source": app_data,
                "destination": f"{version_destination}/**",
                "argv": ["gsutil", "-m", "setmeta", "-h",
                         IMMUTABLE_PUBLIC_CACHE, f"{version_destination}/**"],
                "deletes_remote": False,
            },
            {
                "name": "public_mentions",
                "source": mentions_source,
                "destination": mentions,
                # ⚠️ `gcloud storage`, NOT `gsutil`. This is the one scope
                # that combines rsync (which must checksum every candidate
                # against the object already there) with -j/gzip, and gsutil
                # takes a pure-Python CRC path for that comparison whenever
                # crcmod's C extension is absent. That path is Python 2 code:
                # it dies on `module 'sys' has no attribute 'maxint'`.
                #
                # The other two transfer scopes are unaffected and stay on
                # gsutil — `archive` rsyncs without -j, and
                # `public_app_data_version` uses cp, which compares nothing.
                #
                # ⚠️ It failed as a LIE, not as an error. gsutil -m abandons
                # queued work on the first failure and reports only the ops it
                # had already started: measured 2026-09-02, it announced
                # "1 files/objects could not be copied" and left 58 mention
                # files unpublished, exiting non-zero with a count 58x too
                # small. Believing that number is what makes this look like a
                # single flaky file instead of a broken scope.
                "argv": ["gcloud", "storage", "rsync",
                         str(mentions_source), mentions,
                         "--recursive",
                         "--delete-unmatched-destination-objects",
                         "--gzip-in-flight=json",
                         f"--cache-control={MUTABLE_PUBLIC_CACHE_VALUE}"],
                "deletes_remote": True,
            },
            {
                # This pointer is the commit record. It is deliberately last:
                # readers keep using the previous complete version unless every
                # preceding transfer succeeds.
                "name": "public_app_data_manifest",
                "source": MANIFEST_SOURCE,
                "destination": f"{public}/manifest.json",
                "argv": ["gsutil", "-h", MANIFEST_CACHE, "-h",
                         f"x-goog-if-generation-match:{GENERATION_SOURCE}", "cp",
                         MANIFEST_SOURCE, f"{public}/manifest.json"],
                "content": json.dumps(publication, ensure_ascii=False,
                                      separators=(",", ":")) + "\n",
                "deletes_remote": False,
            },
        ]
    return scopes


def public_app_data_scopes(scopes: list[dict]) -> list[dict]:
    """Keep the immutable public bundle and its final pointer only.

    This deliberately excludes the private archive and the destructive
    mentions rsync, so an operator can publish the site dataset without
    widening that action to either adjacent data surface.
    """
    names = ("public_app_data_version", "public_app_data_version_meta",
             "public_app_data_manifest")
    selected = [scope for scope in scopes if scope.get("name") in names]
    if [scope.get("name") for scope in selected] != list(names):
        raise ValueError(
            "public app-data-only upload requires a ready, enabled publication")
    if any(scope.get("deletes_remote") is not False for scope in selected):
        raise ValueError("public app-data-only upload may not delete remote objects")
    return selected


def run_scope(scope: dict, dry_run: bool) -> dict:
    source = scope["source"]
    result = {key: scope[key] for key in
              ("name", "destination", "deletes_remote")}
    result["source"] = str(source)
    result["command"] = scope["argv"]
    if dry_run:
        result.update(exit=0, skipped="dry_run")
        return result
    if source == MANIFEST_SOURCE:
        try:
            current, generation = remote_manifest(scope["destination"])
            candidate = json.loads(scope["content"])
            if current is not None and scope.get("hot"):
                # ⚠️ RE-CHECKED AT WRITE TIME, AND THIS IS THE WHOLE RACE.
                # A hot run reads the live manifest, spends ~40 s building,
                # then writes. If a COLD release lands in that window the
                # run_ids no longer match, so the overlay predicate below
                # is skipped entirely — and the only remaining guard
                # compares this run's WALL CLOCK against the cold
                # release's BUILD time, which a hot run wins almost always.
                # The manifest would then be rolled BACKWARDS to the
                # previous release: self-consistent, silent, and costing
                # every reader two full ~2,100-object cache clears.
                if current.get("run_id") != candidate.get("run_id"):
                    result.update(exit=3, error="overlay_base_no_longer_live")
                    return result
            if current is not None:
                current_time = parse_aware_instant(
                    current.get("generated_at"), "remote manifest generated_at")
                candidate_time = parse_aware_instant(
                    candidate.get("generated_at"), "candidate generated_at")
                if current.get("run_id") == candidate.get("run_id"):
                    if current == candidate:
                        result.update(exit=0, skipped="already_active")
                        return result
                    # ⚠️ A SECOND MANIFEST FOR ONE run_id IS EXACTLY WHAT A
                    # HOT RELEASE IS, so the refusal below cannot simply be
                    # dropped — it is what stops a re-run of a cold publish
                    # silently redefining a release readers already hold.
                    # The overlay case is admitted by a NARROW predicate
                    # instead: same release, one more overlay, nothing else
                    # touched. Anything outside that is still refused.
                    advance = overlay_advance(current, candidate)
                    if advance is not None:
                        result.update(exit=3, error=advance)
                        return result
                    # ⚠️ AND IT DOES NOT FALL THROUGH TO THE STALENESS
                    # CHECK. A hot release keeps the base's `generated_at`
                    # by design, so `current_time >= candidate_time` is
                    # true for every legal hot publish and would refuse
                    # all of them. What establishes that this overlay is
                    # newer is its `seq`, which `overlay_advance` has just
                    # required to advance.
                elif current_time >= candidate_time:
                    result.update(exit=3, error="stale_publication_refused")
                    return result
        except (ValueError, RuntimeError) as exc:
            result.update(exit=3, error=str(exc))
            return result
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".json", delete=False
        ) as handle:
            handle.write(scope["content"])
            temporary = Path(handle.name)
        argv = [
            str(temporary) if value == MANIFEST_SOURCE else
            value.replace(GENERATION_SOURCE, str(generation))
            for value in scope["argv"]
        ]
        result["command"] = [
            MANIFEST_SOURCE if value == str(temporary) else value for value in argv
        ]
        try:
            proc = subprocess.run(argv, stdout=sys.stderr, stderr=sys.stderr)
        finally:
            temporary.unlink(missing_ok=True)
        result["exit"] = proc.returncode
        return result
    # ⚠️ A FILE IS A LEGAL SOURCE SINCE THE HOT PATH EXISTS. Every cold
    # scope uploads a TREE, so this asked only whether the source was a
    # directory — and the overlay, which is one object, was refused as a
    # "missing source directory" before a single byte was sent. The check
    # is about the source being THERE, not about its shape.
    if not source.exists():
        result.update(exit=2, error="source_missing")
        return result
    proc = subprocess.run(scope["argv"], stdout=sys.stderr, stderr=sys.stderr)
    result["exit"] = proc.returncode
    return result


# Everything a hot release may NOT change about the live manifest. The
# complement — `generated_at` and `overlay` — is the whole of a hot
# release: same tree, same run_id, one more small object beside it.
# ⚠️ `generated_at` IS IN HERE, so a hot release changes EXACTLY ONE
# field: `overlay`. It looks like the obvious thing for a new publish to
# move, and moving it is wrong — `generated_at` is THE RELEASE REVISION.
# `publication_manifest` takes it from `home.json`, and four consumers
# compare something against it (`sync_eval_tasks`, the feedback operator,
# the prerender, `build_feedback_tasks`). A hot release that re-stamped it
# with its own wall clock would make the manifest disagree with the tree
# it points at — the same defect that cost two hours of publication and
# then stalled the feedback sync for hours more, reintroduced from the
# other side. The overlay's own recency is its `seq`, which must strictly
# advance; it does not need a second clock.
HOT_INVARIANT = ("version", "run_id", "data_base", "home_health_ready",
                 "generated_at", "bundle",
                 "accepted_snapshot_records_sha256",
                 "accepted_feedback_records_sha256")


STORY_DETAIL_PATH = re.compile(r"^stories/([A-Za-z0-9_-]{1,120})\.json$")


def story_ids_of(manifest: dict | None) -> set[str]:
    """The story ids a manifest's inventory serves — the reader's bookmarks.

    ⚠️ `is_story_detail_path` is the ONE rule for which `stories/` files are
    a story (news/scripts/overlay_merge.py); the whole-corpus index, the
    by-url map, the paged families and the retired registry all match the
    detail pattern by name and would otherwise report a „dropped" story on
    every publish.
    """
    bundle = (manifest or {}).get("bundle") if isinstance(manifest, dict) else None
    rows = bundle.get("inventory") if isinstance(bundle, dict) else None
    ids: set[str] = set()
    for row in rows or []:
        path = row.get("path") if isinstance(row, dict) else None
        if not isinstance(path, str) or not is_story_detail_path(path):
            continue
        match = STORY_DETAIL_PATH.match(path)
        if match:
            ids.add(match.group(1))
    return ids


def story_continuity(live: dict | None, candidate: dict,
                     retired: set[str]) -> dict:
    """Which of the LIVE release's story ids the candidate would stop serving.

    ⚠️ AN OLD BOOKMARKED STORY URL STAYS VALID (plan T1.5). A story id, once
    published, is served by every later release unless the human-owned
    registry (`news/config/retired_stories.json`, shipped as
    `stories/retired.json`) says why it is not. A drop the registry does not
    account for is a 404 on a link somebody saved, and the public publish
    REFUSES it — measured over 57 hourly runs on 2026-09-21 the story count
    fell once (1,087 → 1,062 on 2026-09-02, a corpus rebuild), so this is a
    rare refusal, and the escape hatch for a deliberate rebuild is
    `NEWS_ALLOW_STORY_DROPS=1`, which records the drop in the upload result
    rather than hiding it.

    The archive half of the upload is untouched by this either way.
    """
    if not isinstance(live, dict):
        return {"checked": False, "reason": "no_live_manifest",
                "dropped": [], "retired": [], "unaccounted": []}
    before = story_ids_of(live)
    after = story_ids_of(candidate)
    dropped = sorted(before - after)
    accounted = [i for i in dropped if i in retired]
    unaccounted = [i for i in dropped if i not in retired]
    return {"checked": True, "live_run_id": live.get("run_id"),
            "live_stories": len(before), "candidate_stories": len(after),
            "dropped": dropped, "retired": accounted,
            "unaccounted": unaccounted}


def retired_story_ids(app_data: Path) -> set[str]:
    """The ids `stories/retired.json` in the SNAPSHOT accounts for."""
    path = app_data / "stories" / "retired.json"
    if not path.is_file():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("retired") if isinstance(payload, dict) else None
    return set(entries) if isinstance(entries, dict) else set()


def overlay_advance(current: dict, candidate: dict) -> str | None:
    """None when `candidate` is a legal hot release over `current`.

    Otherwise the reason to refuse, as a stable string.

    ⚠️ THIS IS THE ONLY DOOR THROUGH THE "one manifest per run_id" RULE,
    so it is written as a whitelist of what may move rather than a
    blacklist of what may not. A release is immutable once readers hold
    it; the ONE thing a hot publish adds is a pointer to an extra object
    that did not exist before, and every other field describes the tree
    itself, which has not changed and cannot.

    ⚠️ AND THE SEQUENCE MUST STRICTLY ADVANCE. Overlays are cumulative,
    not a chain — a reader merges the base plus the LATEST one — so going
    backwards, or republishing a seq, points readers at an older view of
    the same release with no way to tell. The object itself is written
    create-only, so a repeated seq also collides on upload; this refuses
    it earlier and with a reason.
    """
    # ⚠️ A SENTINEL, NOT `.get()`. `accepted_feedback_records_sha256` is
    # ABSENT on a v2 manifest and NULL on a v3 one, and `.get()` returns
    # None for both — so a candidate that had dropped the key would pass a
    # field-by-field comparison while the CLIENT rejects the whole
    # manifest for it (`validAcceptedFeedbackHash` in data.ts), leaving
    # every cold reader with no data at all.
    missing = object()
    for field in HOT_INVARIANT:
        if current.get(field, missing) != candidate.get(field, missing):
            return f"publication_id_already_used:{field}"
    pointer = candidate.get("overlay")
    if not isinstance(pointer, dict):
        return "publication_id_already_used"
    live = current.get("overlay")
    live_seq = live.get("seq") if isinstance(live, dict) else 0
    if not isinstance(live_seq, int):
        return "overlay_live_pointer_malformed"
    if not isinstance(pointer.get("seq"), int) or pointer["seq"] <= live_seq:
        return "overlay_sequence_did_not_advance"
    return None


def overlay_pointer(overlay: dict, payload: bytes, seq: int) -> dict:
    """The manifest's description of an overlay object.

    `bytes`/`sha256` describe the UNCOMPRESSED file, the same convention
    the bundle inventory uses — the object is stored gzip (`-z json`) and
    these describe the decoded body.

    ⚠️ VERIFIED BY THE CLIENT SINCE T1.5 (2026-09-21): `resolveOverlay` in
    newsapp/app/data.ts reads the object's bytes, checks `bytes` then
    `sha256` against this pointer, and DROPS an overlay that disagrees —
    the reader stays on the base, one hot release behind, and the mismatch
    is logged as an error. Before that these fields were a record an
    operator could check by hand and nothing else.
    """
    return {
        "seq": seq,
        "path": f"overlays/{seq}.json",
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "base_generated_at": overlay.get("release_generated_at"),
    }


def overlay_commands(overlay_path: Path, live: dict, generated_at: str
                     ) -> tuple[list[dict], dict]:
    """The two scopes of a hot release: the overlay object, then the pointer.

    ⚠️ TWO OBJECTS, AND THE ORDER IS THE COMMIT. The overlay is written
    first and create-only; the manifest is last, as on the cold path, so a
    reader only ever learns about an object that is already there.

    ⚠️ A FAILURE BETWEEN THEM WEDGES THE HOT PATH UNTIL THE NEXT COLD
    RELEASE, and an earlier draft of this claimed the opposite ("the next
    hot run simply supersedes it"). It does not: `next_seq` in
    `build_overlay.py` derives the sequence from the MANIFEST, which the
    failed run never advanced — so a retry computes the same seq, and its
    upload 412s against its own orphan. The recovery is
    `build_overlay.py --seq <n+1>`, which is why that flag exists.
    """
    payload = overlay_path.read_bytes()
    overlay = json.loads(payload)
    if not isinstance(overlay, dict):
        raise ValueError("overlay is not an object")
    base_run_id = overlay.get("base_run_id")
    if base_run_id != live.get("run_id"):
        # ⚠️ The overlay is a delta FROM a specific release. Published over
        # a different one it merges cleanly and lands every reader on a
        # view that never existed, so this is a refusal rather than a
        # rebuild-and-hope.
        raise ValueError(
            f"overlay was built against {base_run_id!r} but the live "
            f"release is {live.get('run_id')!r} — rebuild it")
    seq = overlay.get("seq")
    if not isinstance(seq, int) or seq < 1:
        raise ValueError("overlay carries no usable seq")
    if generated_at != live.get("generated_at"):
        # Stated rather than silently ignored: the caller passes a clock,
        # and a hot release deliberately does not use it.
        generated_at = live.get("generated_at")
    data_base = live.get("data_base")
    if data_base != f"versions/{live.get('run_id')}":
        # The cold path validates this before it publishes; re-checked here
        # because it decides WHERE the overlay object lands, and a bare
        # subscript would raise a KeyError out of the JSON error contract.
        raise ValueError("live manifest has an unsafe version path")
    public = uri("NEWS_PUBLIC_GCS_URI", delete_scope=True)
    destination = f"{public}/{data_base}/overlays/{seq}.json"
    publication = {**live, "generated_at": generated_at,
                   "overlay": overlay_pointer(overlay, payload, seq)}
    refusal = overlay_advance(live, publication)
    if refusal is not None:
        raise ValueError(refusal)
    return [
        {
            "name": "public_app_data_overlay",
            "source": overlay_path,
            "destination": destination,
            "argv": ["gsutil", "-h", IMMUTABLE_PUBLIC_CACHE,
                     # Create-only: an overlay object is immutable, and a
                     # repeated seq must collide rather than overwrite a
                     # view some reader is already merging.
                     "-h", "x-goog-if-generation-match:0",
                     "cp", "-z", "json", str(overlay_path), destination],
            "deletes_remote": False,
        },
        {
            "name": "public_app_data_manifest",
            "source": MANIFEST_SOURCE,
            "destination": f"{public}/manifest.json",
            "argv": ["gsutil", "-h", MANIFEST_CACHE, "-h",
                     f"x-goog-if-generation-match:{GENERATION_SOURCE}", "cp",
                     MANIFEST_SOURCE, f"{public}/manifest.json"],
            "content": json.dumps(publication, ensure_ascii=False,
                                  separators=(",", ":")) + "\n",
            "deletes_remote": False,
            # Read at write time by `run_scope`: a hot release may only
            # ever land on the base it was built from.
            "hot": True,
        },
    ], publication


def remote_manifest(destination: str) -> tuple[dict | None, int]:
    stat = subprocess.run(
        ["gsutil", "stat", destination], text=True, capture_output=True)
    output = "\n".join((stat.stdout, stat.stderr))
    if stat.returncode != 0:
        if re.search(r"No URLs matched|matched no objects|Not Found", output,
                     flags=re.IGNORECASE):
            return None, 0
        raise RuntimeError(f"remote manifest stat failed: {output[:300]}")
    match = re.search(r"^\s*Generation:\s*(\d+)\s*$", output,
                      flags=re.MULTILINE)
    if not match:
        raise RuntimeError("remote manifest stat did not return a generation")
    generation = int(match.group(1))
    read = subprocess.run(
        ["gsutil", "cat", destination], text=True, capture_output=True)
    if read.returncode != 0:
        detail = "\n".join((read.stdout, read.stderr))
        raise RuntimeError(f"remote manifest read failed: {detail[:300]}")
    try:
        payload = json.loads(read.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("remote manifest is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("remote manifest root is not an object")
    return payload, generation


def execute_scopes(scopes: list[dict], dry_run: bool) -> list[dict]:
    results = []
    failed_scope = None
    for scope in scopes:
        if failed_scope is not None:
            results.append({
                "name": scope["name"],
                "source": str(scope["source"]),
                "destination": scope["destination"],
                "deletes_remote": scope["deletes_remote"],
                "command": scope["argv"],
                "exit": None,
                "skipped": f"previous_scope_failed:{failed_scope}",
            })
            continue
        started = time.monotonic()
        result = run_scope(scope, dry_run)
        # Wall seconds per scope: the per-release upload cost the plan's
        # Phase 4 baseline reads from the perf log.
        result["seconds"] = round(time.monotonic() - started, 2)
        results.append(result)
        if result["exit"] != 0 and not dry_run:
            failed_scope = scope["name"]
    return results


def same_or_nested_scope(first: str, second: str) -> bool:
    first_match = GS_URI.fullmatch(first)
    second_match = GS_URI.fullmatch(second)
    if first_match.group(1) != second_match.group(1):
        return False
    first_parts = tuple((first_match.group(2) or "").split("/"))
    second_parts = tuple((second_match.group(2) or "").split("/"))
    shorter = min(len(first_parts), len(second_parts))
    return first_parts[:shorter] == second_parts[:shorter]


def versioning_enabled(output: str) -> bool:
    return bool(re.search(r"\bEnabled\b", output, re.IGNORECASE))


def check_archive_versioning(archive_uri: str) -> tuple[bool, str]:
    match = GS_URI.fullmatch(archive_uri)
    bucket = f"gs://{match.group(1)}"
    proc = subprocess.run(
        ["gsutil", "versioning", "get", bucket],
        text=True, capture_output=True)
    output = "\n".join((proc.stdout, proc.stderr)).strip()
    if proc.returncode != 0:
        return False, f"versioning check failed: {output[:300]}"
    if not versioning_enabled(output):
        return False, f"object versioning is not enabled on {bucket}"
    return True, "enabled"


def publish_overlay(overlay_path: Path, dry_run: bool) -> int:
    """The hot path, end to end.

    ⚠️ IT READS THE LIVE MANIFEST RATHER THAN BEING TOLD WHAT IS LIVE.
    The overlay names the base it was built from, and the only way to know
    that is still the release readers hold is to ask the bucket at the
    moment of publishing. A value passed in, or read minutes earlier, is a
    claim about the past.
    """
    if not public_upload_enabled():
        print(json.dumps({"mode": "news_gcs_overlay",
                          "error": "public_upload_disabled"}))
        return 2
    try:
        public = uri("NEWS_PUBLIC_GCS_URI", delete_scope=True)
        live, _generation = remote_manifest(f"{public}/manifest.json")
        if live is None:
            raise ValueError("no live manifest to overlay")
        scopes, publication = overlay_commands(
            overlay_path, live,
            datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"))
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
        # ⚠️ One contract, not two. A caller wiring this into the hourly
        # transaction reads stdout as JSON; a traceback from an unreadable
        # overlay file or a malformed one is a different failure shape it
        # would have to handle separately.
        print(json.dumps({"mode": "news_gcs_overlay", "error": str(exc)},
                         ensure_ascii=False))
        return 2
    results = execute_scopes(scopes, dry_run)
    failed = [row for row in results if row.get("exit") not in (0, None)]
    print(json.dumps({
        "mode": "news_gcs_overlay",
        "dry_run": dry_run,
        "run_id": publication["run_id"],
        "seq": publication["overlay"]["seq"],
        "bytes": publication["overlay"]["bytes"],
        "scopes": results,
    }, ensure_ascii=False))
    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", type=Path)
    ap.add_argument("--expected-run-id")
    ap.add_argument("--archive-only", action="store_true")
    ap.add_argument("--public-app-data-only", action="store_true")
    # ⚠️ A HOT RELEASE, and it is deliberately not a mode of the cold
    # path. It publishes TWO objects — the overlay and the manifest —
    # against the run_id that is ALREADY live, so it takes no report, no
    # bundle and no app-data tree: there is nothing to rebuild and nothing
    # to compare, and the release it points at has already passed every
    # gate. What it must not do is touch the archive or the mentions
    # rsync, which is why this is its own scope list rather than a filter
    # over the cold one.
    ap.add_argument("--overlay", type=Path,
                    help="publish this overlay against the live release "
                         "(news/scripts/build_overlay.py writes it)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--pipeline-exit", type=int, default=0,
                    help="the pipeline's exit code; non-zero refuses the "
                         "PUBLIC publish while still archiving")
    args = ap.parse_args()
    if args.report and args.archive_only:
        ap.error("choose --report or --archive-only")
    if args.overlay and (args.report or args.archive_only
                         or args.public_app_data_only):
        ap.error("--overlay is a release of its own and takes no other mode")
    if args.overlay and not args.overlay.is_file():
        ap.error(f"--overlay {args.overlay} does not exist")
    if args.public_app_data_only and (args.archive_only or not args.report):
        ap.error("--public-app-data-only requires --report and excludes --archive-only")
    if args.expected_run_id and not args.report:
        ap.error("--expected-run-id requires --report")
    if args.overlay:
        return publish_overlay(args.overlay, args.dry_run)
    public_ready, reason = load_report(
        None if args.archive_only else args.report,
        args.expected_run_id,
        allow_dry_run=args.dry_run,
    )
    # ⚠️ A FAILED PIPELINE MUST NOT MOVE READERS ONTO ITS RELEASE. The report
    # can be complete and every gate green while a stage aborted — measured
    # 2026-09-02, `analyze` exited 2 on its canary (the model server ignored
    # the schema) and the run still advanced the manifest, because the
    # uploader was never told the pipeline had failed. That publish happened
    # to be harmless, republishing an unchanged corpus; a stage that fails
    # PART-WAY through writing is the case this exists for.
    #
    # It refuses the PUBLIC half only. The archive is a private durable
    # backup, and a failed run is exactly when its raw data is most worth
    # keeping — blocking that would destroy evidence rather than protect
    # anyone.
    if args.pipeline_exit:
        public_ready, reason = False, f"pipeline_failed:{args.pipeline_exit}"
    snapshot_temp = None
    continuity = None
    try:
        public_enabled = public_upload_enabled()
        publication = None
        app_data_source = None
        if public_ready and public_enabled:
            report = json.loads(args.report.read_text(encoding="utf-8"))
            publication_id = args.expected_run_id or report.get("run_id")
            stages = {row["stage"]: row for row in report["stages"]}
            expected_inventory = expected_publication_inventory(stages)
            health_result = stages["home_health"].get("result")
            expected_health = (health_result.get("health")
                               if isinstance(health_result, dict) else None)
            if args.dry_run and not (ROOT / "news/app-data/home.json").is_file():
                publication = {
                    "version": 3,
                    "run_id": publication_id,
                    "generated_at": report.get("generated_at") or "dry-run",
                    "data_base": f"versions/{publication_id}",
                    "home_health_ready": True,
                    "accepted_snapshot_records_sha256": None,
                    "accepted_feedback_records_sha256": None,
                    "bundle": {"sha256": "0" * 64, "files": 0,
                               "bytes": 0, "inventory": []},
                }
            else:
                app_data_source = ROOT / "news/app-data"
                if not args.dry_run:
                    snapshot_temp = tempfile.TemporaryDirectory(
                        prefix=f"news-publication-{publication_id}-")
                    snapshot = Path(snapshot_temp.name) / "app-data"
                    materialize_snapshot(app_data_source, snapshot)
                    app_data_source = snapshot
                publication = publication_manifest(
                    publication_id, app_data_source,
                    (expected_inventory if isinstance(expected_inventory, dict) else {})
                    if not args.dry_run else None,
                    expected_health if not args.dry_run else None)
        if publication is not None and not args.dry_run:
            public = uri("NEWS_PUBLIC_GCS_URI", delete_scope=True)
            try:
                live, _generation = remote_manifest(f"{public}/manifest.json")
            except RuntimeError as exc:
                # ⚠️ Refuse the PUBLIC half only. An unreadable live manifest
                # is not evidence about the candidate, and the archive is
                # still worth keeping — the same shape as a failed pipeline,
                # never an abort that skips every scope.
                public_ready = False
                reason = f"story_continuity:live_manifest_unreadable:{exc}"[:200]
                publication, app_data_source = None, None
                continuity = {"checked": False,
                              "reason": "live_manifest_unreadable",
                              "dropped": [], "retired": [], "unaccounted": []}
            else:
                continuity = story_continuity(
                    live, publication, retired_story_ids(app_data_source))
                if (continuity["unaccounted"]
                        and os.environ.get("NEWS_ALLOW_STORY_DROPS") != "1"):
                    # Refuse the PUBLIC half only, like a failed pipeline: the
                    # archive is still worth keeping, and the reader keeps
                    # the release that still serves every bookmark.
                    public_ready = False
                    reason = f"story_continuity:{len(continuity['unaccounted'])}"
                    publication, app_data_source = None, None
        scopes = commands(
            public_ready, public_enabled, publication, app_data_source)
        if args.public_app_data_only:
            scopes = public_app_data_scopes(scopes)
    except ValueError as exc:
        print(json.dumps({"mode": "news_gcs_upload", "error": str(exc)}))
        return 2
    if not args.dry_run and any("REPLACE_ME" in scope["destination"]
                                for scope in scopes):
        print(json.dumps({"mode": "news_gcs_upload",
                          "error": "GCS destination contains REPLACE_ME"}))
        return 2
    # Derived from the scopes rather than hard-coded, so a scope that switches
    # tools cannot leave the preflight checking for the wrong binary.
    missing = sorted({scope["argv"][0] for scope in scopes
                      if shutil.which(scope["argv"][0]) is None})
    if not args.dry_run and missing:
        print(json.dumps({"mode": "news_gcs_upload",
                          "error": "missing_upload_binaries",
                          "binaries": missing}))
        return 2
    destinations = [scope["destination"] for scope in scopes]
    if len(destinations) != len(set(destinations)):
        print(json.dumps({"mode": "news_gcs_upload",
                          "error": "GCS destinations must be distinct"}))
        return 2
    archive_bucket = (None if args.public_app_data_only else
                      GS_URI.fullmatch(destinations[0]).group(1))
    try:
        configured_public = [
            uri(name, delete_scope=True) for name in
            ("NEWS_PUBLIC_GCS_URI", "NEWS_MENTIONS_GCS_URI")
            if os.environ.get(name)
        ]
    except ValueError as exc:
        print(json.dumps({"mode": "news_gcs_upload", "error": str(exc)}))
        return 2
    public_buckets = {GS_URI.fullmatch(value).group(1)
                      for value in configured_public}
    if archive_bucket is not None and archive_bucket in public_buckets:
        print(json.dumps({
            "mode": "news_gcs_upload",
            "error": "archive must use a different private bucket",
        }))
        return 2
    if len(configured_public) == 2 and same_or_nested_scope(*configured_public):
        print(json.dumps({
            "mode": "news_gcs_upload",
            "error": "public rsync delete scopes must be disjoint",
        }))
        return 2
    if (not args.public_app_data_only and not args.dry_run
            and os.environ.get("NEWS_REQUIRE_ARCHIVE_VERSIONING", "1") != "0"):
        enabled, detail = check_archive_versioning(destinations[0])
        if not enabled:
            print(json.dumps({"mode": "news_gcs_upload",
                              "error": detail}))
            return 2
    results = execute_scopes(scopes, args.dry_run)
    if snapshot_temp is not None:
        snapshot_temp.cleanup()
    failed = [row["name"] for row in results
              if isinstance(row["exit"], int) and row["exit"] != 0]
    output = {
        "mode": "news_gcs_upload",
        "public_ready": public_ready,
        "public_enabled": public_enabled,
        "public_reason": reason,
        "story_continuity": continuity,
        "scopes": results,
        "failed_scopes": failed,
    }
    print(json.dumps(output, ensure_ascii=False))
    return 1 if failed or (args.report is not None and not public_ready) else 0


if __name__ == "__main__":
    raise SystemExit(main())
