#!/usr/bin/env python3
"""Plan T3.2 — review and reclassify the presidential candidate set.

    python3 news/scripts/reclassify_topics.py --freeze             # retrieve + freeze, no model
    python3 news/scripts/reclassify_topics.py --apply <manifest>   # model, topic-only write
    python3 news/scripts/reclassify_topics.py --apply <manifest> --limit 20 --dry-run

⚠️⚠️ THE RETRIEVAL QUERY IS COMMITTED HERE, and the four readings the plan
found ambiguous (360 / 366 / 493 / 299 for an unstated query) are REPORTED
side by side under THIS query, so the „after" is comparable with the
„before" — that is the whole output of this task, a before/after
distribution, and an unstated query makes it uncomparable.

The candidate set is a RETRIEVAL set, not 360 established errors: Йотова or
вицепрезидент alone does not establish election coverage. Discovery runs
over EVERY analysis record, excluded ones included (plan §1.3 / T3.3
integrity rules), so a reviewer can see missed coverage; only `quality.ok`
records carry topics and are reclassified.

⚠️ TOPIC-ONLY, WITH PER-FIELD PROVENANCE. The classifier is asked the full
question (the rubric and grammar are one contract) and ONLY `topics` +
`site_relevant` are taken from its answer; leaning, stance, tones, entities,
summaries and the story decision are left exactly as the record had them —
they do not depend on the taxonomy, and restamping them would present a
re-run as a review. What is written: `topics`, `taxonomy_version` (the
version the TOPICS were classified against) and
`field_provenance.topics` carrying the previous value, the model, the run and
the manifest id.

⚠️ A PRIMARY CROSSING `not-site-relevant` IS REFUSED, NOT WRITTEN. That flag
gates story membership, `story.action` and publication eligibility as a
dependency group; changing it in place would leave a story holding an article
the release says is out of scope (or the reverse). Such records are listed in
the report for the normal analysis path (`analyze_local.py --redo`).

A confirmed-UNCHANGED answer is written too: the record's `taxonomy_version`
moves to the version it was confirmed under and the provenance says so, with
`previous` equal to the current value. `written == changed + unchanged`.

⚠️ NOT WHILE THE HOURLY RUNNER IS LIVE. Every record is sha-pinned at the
freeze and re-checked at WRITE time (a record the runner rewrote mid-run is
reported as failed, never clobbered), but the cleaner rule is the one
`prune_published_versions.py` states: run it between hourly runs.

The frozen manifest under `news/data/analysis/_reclassify/` is GITIGNORED
(it carries 591 titles and content hashes); the committed report names it by
`manifest_path`. `--retry-failed REPORT` re-asks the model for that report's
failed rows and FOLDS the result into the same report (`fold_retry`);
`--retopic-stories REPORT` re-derives story topics and records that too.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

DATA = ROOT / "news" / "data"
ANALYSIS = DATA / "analysis"
FREEZE_DIR = ANALYSIS / "_reclassify"
REPORT_DIR = ROOT / "news" / "evals"
TOPICS = ROOT / "news" / "topics.json"

# ⚠️ THE QUERY. Case-insensitive, over the SOURCE TEXT (title + body) by
# default — the widest reading, because retrieval is recall-first and the
# review decides. `\w*` absorbs Bulgarian inflection; `вицепрезидент` and
# `Йотова` are IN deliberately, and are exactly why the set is candidates,
# not errors.
PRESIDENTIAL_QUERY = re.compile(
    r"президентск\w*\s+(?:избори|кампани\w*|вот)"
    r"|избори\w*\s+за\s+президент"
    r"|кандидат\w*\s+за\s+(?:президент|вицепрезидент)"
    r"|кандидат[-\s]?президентск\w*"
    r"|Дондуков\W{0,3}2"
    r"|вицепрезидент"
    r"|Йотова",
    re.IGNORECASE,
)
# The same pattern with no flag — the „record, case-sensitive" reading.
PRESIDENTIAL_QUERY_CS = re.compile(PRESIDENTIAL_QUERY.pattern)
QUERY_VERSION = 1
TARGET_CATEGORY = "elections-presidential"
NOT_RELEVANT = "not-site-relevant"


def sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def analysis_records():
    """Every analysis record on disk — excluded ones included."""
    root = ANALYSIS / "articles"
    for path in sorted(root.glob("*/*.json")):
        try:
            record = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(record, dict) and record.get("article_path"):
            yield path, record


def source_text(article: dict) -> str:
    return f"{article.get('title') or ''}\n{article.get('content') or ''}"


def readings(record: dict, article: dict | None) -> dict:
    """The four ways the plan's numbers could have been counted, under
    THIS query: a serialized record case-sensitively, the same with
    IGNORECASE, the source text, and the model's own summary."""
    serialized = json.dumps(record, ensure_ascii=False)
    return {
        "record_case_sensitive": bool(PRESIDENTIAL_QUERY_CS.search(serialized)),
        "record_ignorecase": bool(PRESIDENTIAL_QUERY.search(serialized)),
        "source_text": bool(article and PRESIDENTIAL_QUERY.search(source_text(article))),
        "summary_bg": bool(PRESIDENTIAL_QUERY.search(record.get("summary_bg") or "")),
    }


from analyze_articles import primary_of  # noqa: E402  (the one selector)


def distribution(rows: list) -> dict:
    """Primary (category/subcategory) counts, plus category-only counts."""
    pairs = Counter()
    categories = Counter()
    for topics in rows:
        cat, sub = primary_of(topics)
        pairs[f"{cat}/{sub}"] += 1
        categories[str(cat)] += 1
    return {"by_pair": dict(sorted(pairs.items())),
            "by_category": dict(sorted(categories.items()))}


def freeze(limit: int | None = None) -> dict:
    """Retrieve over every record and freeze the candidate set."""
    taxonomy = read_json(TOPICS)
    candidates = []
    counts = Counter()
    scanned = 0
    for path, record in analysis_records():
        scanned += 1
        article = None
        article_path = ROOT / record["article_path"]
        if article_path.exists():
            try:
                article = read_json(article_path)
            except (OSError, json.JSONDecodeError):
                article = None
        seen = readings(record, article)
        for key, hit in seen.items():
            counts[key] += int(hit)
        if not seen["source_text"]:
            continue
        candidates.append({
            "analysis_path": str(path.relative_to(ROOT)),
            "article_path": record["article_path"],
            "url": record.get("url"),
            "domain": record.get("domain"),
            "published": record.get("published"),
            "title": (article or {}).get("title"),
            "content_sha256": sha256_text(source_text(article)) if article else None,
            "analysis_sha256": sha256_text(json.dumps(record, ensure_ascii=False,
                                                       sort_keys=True)),
            "quality": (record.get("quality") or {}).get("verdict"),
            "site_relevant": record.get("site_relevant"),
            "taxonomy_version": record.get("taxonomy_version"),
            "topics": record.get("topics") or [],
            "readings": seen,
        })
    if limit:
        candidates = candidates[:limit]
    stamp = time.strftime("%Y-%m-%dT%H%M%SZ", time.gmtime())
    manifest = {
        "version": 1,
        "task": "T3.2",
        "frozen_at": stamp,
        "query": {"version": QUERY_VERSION, "pattern": PRESIDENTIAL_QUERY.pattern,
                  "flags": "IGNORECASE", "surface": "source_text"},
        "taxonomy_version": taxonomy.get("version"),
        "records_scanned": scanned,
        "readings": dict(counts),
        "candidates": len(candidates),
        "reclassifiable": sum(1 for c in candidates if c["quality"] == "ok"),
        "before": distribution([c["topics"] for c in candidates if c["quality"] == "ok"]),
        "rows": candidates,
    }
    return manifest


# ---------------------------------------------------------------------------
# the write — pure, so it can be tested without a model
# ---------------------------------------------------------------------------

def taxonomy_pairs(taxonomy: dict) -> set:
    return {(c["id"], s["id"]) for c in taxonomy["categories"]
            for s in c.get("subcategories") or []}


def validate_topics(topics, taxonomy: dict) -> list:
    pairs = taxonomy_pairs(taxonomy)
    categories = {c["id"] for c in taxonomy["categories"]}
    errors = []
    if not isinstance(topics, list) or not topics:
        return ["topics must be a non-empty list"]
    primaries = 0
    for topic in topics:
        if not isinstance(topic, dict):
            errors.append("topic is not an object")
            continue
        cat, sub = topic.get("category"), topic.get("subcategory")
        if cat not in categories:
            errors.append(f"unknown category {cat!r}")
        elif sub is not None and (cat, sub) not in pairs:
            errors.append(f"{sub!r} not under {cat!r}")
        primaries += 1 if topic.get("primary") else 0
    if primaries != 1:
        errors.append(f"exactly one primary topic required, got {primaries}")
    return errors


REFUSAL_KINDS = ("invalid_topics", "self_disagreement", "crosses_boundary")


def apply_topics(record: dict, new_topics: list, new_site_relevant,
                 taxonomy: dict, *, model: str, manifest_id: str,
                 now: str) -> tuple[dict | None, dict | None]:
    """(updated record, None) or (None, {"kind", "detail"}). Never mutates
    `record`. The refusal KIND is what routes the row (a refusal is a
    decision, not a failure to ask); the detail is for a person."""
    errors = validate_topics(new_topics, taxonomy)
    if errors:
        return None, {"kind": "invalid_topics", "detail": "; ".join(errors)}
    old_primary = primary_of(record.get("topics"))[0]
    new_primary = primary_of(new_topics)[0]
    # ⚠️ The dependency group: `site_relevant` must agree with the primary
    # BOTH before and after, and the boundary may not be crossed here.
    if (new_primary == NOT_RELEVANT) != (not new_site_relevant):
        return None, {"kind": "self_disagreement",
                      "detail": "answer disagrees with itself about site_relevant"}
    if (old_primary == NOT_RELEVANT) != (new_primary == NOT_RELEVANT):
        return None, {"kind": "crosses_boundary",
                      "detail": ("crosses not-site-relevant: story membership, "
                                 "story.action and publication eligibility must be "
                                 "re-decided together — use analyze_local.py --redo")}
    updated = dict(record)
    updated["topics"] = new_topics
    updated["taxonomy_version"] = taxonomy["version"]
    provenance = dict(record.get("field_provenance") or {})
    provenance["topics"] = {
        "reclassified_at": now,
        "taxonomy_version": taxonomy["version"],
        "model": model,
        "manifest": manifest_id,
        "basis": "topic-only reclassification (plan T3.2); every other field kept",
        "previous": {"topics": record.get("topics") or [],
                     "taxonomy_version": record.get("taxonomy_version")},
    }
    updated["field_provenance"] = provenance
    return updated, None


# ---------------------------------------------------------------------------
# the stories — a story's topic is DERIVED from its members, and nothing
# re-derived it before this
# ---------------------------------------------------------------------------

def story_topics_from_members(member_topics: list) -> list:
    """The story's primary topic: the PLURALITY of its members' primaries,
    ties broken by member order (the first member is what created the story
    and what `analyze_articles` copied onto it at creation).

    ⚠️ THIS IS WHERE THE RECLASSIFICATION REACHES A READER. A story's
    `topics` is stamped ONCE, from the first member, and never recomputed —
    so 356 re-topiced articles moved zero stories (measured: taxonomy.json
    reported 350 presidential ARTICLES beside 2 presidential STORIES, and
    the filter index, the home chips and the browse all read the story).
    """
    order: list = []
    counts: dict = {}
    for topics in member_topics:
        cat, sub = primary_of(topics)
        if cat is None:
            continue
        key = (cat, sub)
        if key not in counts:
            order.append(key)
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return []
    best = max(order, key=lambda k: (counts[k], -order.index(k)))
    return [{"category": best[0], "subcategory": best[1], "primary": True}]


def retopic_stories(analysis_paths: set, *, dry_run: bool) -> dict:
    """Re-derive `topics` for every story holding a reclassified article."""
    import analyze_articles as aa  # noqa: E402
    index = aa.load_index()
    by_url = {}
    touched_stories = set()
    for url, entry in index["articles"].items():
        by_url[url] = entry
        if entry.get("path") in analysis_paths and entry.get("story_id"):
            touched_stories.add(entry["story_id"])
    moved, kept, missing = [], [], []
    before_counts, after_counts = Counter(), Counter()
    for story_id in sorted(touched_stories):
        story = aa.load_story(story_id)
        if story is None:
            missing.append(story_id)
            continue
        member_topics = []
        members = story.get("members") or []
        for member in members:
            entry = by_url.get(member.get("url"))
            if not entry:
                continue
            try:
                record = read_json(ROOT / entry["path"])
            except (OSError, json.JSONDecodeError):
                continue
            member_topics.append(record.get("topics") or [])
        derived = story_topics_from_members(member_topics)
        current = story.get("topics") or []
        before_counts[str(primary_of(current)[0])] += 1
        if not derived or primary_of(derived) == primary_of(current):
            kept.append(story_id)
            after_counts[str(primary_of(current)[0])] += 1
            continue
        after_counts[str(primary_of(derived)[0])] += 1
        # ⚠️ `members_total` beside the voters: a member whose url is not in
        # the index, or whose record will not parse, does not vote, and a
        # plurality over a minority of members must be visible.
        moved.append({"story_id": story_id, "before": primary_of(current),
                      "after": primary_of(derived), "members": len(member_topics),
                      "members_total": len(members)})
        if not dry_run:
            story["topics"] = derived
            story["updated_at"] = aa.now_iso()
            aa.save_story(story)
            if story_id in index["stories"]:
                index["stories"][story_id]["topics"] = derived
    if moved and not dry_run:
        index["updated_at"] = aa.now_iso()
        aa.write_json_atomic(aa.INDEX_PATH, index)
    return {"stories_touched": len(touched_stories), "moved": moved,
            "kept": len(kept), "missing": missing,
            "before_by_category": dict(sorted(before_counts.items())),
            "after_by_category": dict(sorted(after_counts.items()))}


# ---------------------------------------------------------------------------
# the model half
# ---------------------------------------------------------------------------

def classify(row: dict, assets: dict, model: str, max_tokens: int,
             taxonomy_version: int, mentions: list) -> dict:
    import analyze_local as al  # noqa: E402  (imports llm_client)
    item = {"path": row["article_path"], "domain": row["domain"],
            "mentions": mentions}
    return al.analyze_one(item, assets, model, max_tokens, taxonomy_version)


def apply(manifest_path: Path, *, limit: int | None, workers: int,
          dry_run: bool, model: str | None, max_tokens: int,
          only: set | None = None) -> dict:
    manifest = read_json(manifest_path)
    taxonomy = read_json(TOPICS)
    if manifest.get("taxonomy_version") != taxonomy.get("version"):
        raise SystemExit(f"manifest was frozen under taxonomy v{manifest.get('taxonomy_version')}, "
                         f"news/topics.json is v{taxonomy.get('version')} — re-freeze")
    rows = [r for r in manifest["rows"] if r["quality"] == "ok"]
    if only is not None:
        rows = [r for r in rows if r["analysis_path"] in only]
    if not rows:
        raise SystemExit("nothing to reclassify: the manifest holds no quality.ok candidate")
    if limit:
        rows = rows[:limit]
    import llm_client  # noqa: E402
    llm_client.load_env_files(root=ROOT)
    import analyze_local as al  # noqa: E402
    assets = al.load_prompt_assets()
    taxonomy_version = json.loads(assets["taxonomy"]).get("version")
    # ⚠️ The version the MODEL is told must be the version the RECORD is
    # stamped with; a stale prompt asset would classify against v1 labels
    # and stamp v2, with every pair still validating.
    if taxonomy_version != taxonomy.get("version"):
        raise SystemExit(f"prompt asset taxonomy_compact.json is v{taxonomy_version}, "
                         f"news/topics.json is v{taxonomy.get('version')} — run build_prompts.py")
    model = model or os.environ.get("NEWS_LLM_MODEL") or "local-model"
    now = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    manifest_id = manifest["frozen_at"]

    # Refuse to touch a record that moved since the freeze.
    stale = []
    live = {}
    for row in rows:
        path = ROOT / row["analysis_path"]
        record = read_json(path)
        if sha256_text(json.dumps(record, ensure_ascii=False, sort_keys=True)) != row["analysis_sha256"]:
            stale.append(row["analysis_path"])
        live[row["analysis_path"]] = record
    if stale:
        raise SystemExit(f"{len(stale)} record(s) changed since the freeze — re-freeze: {stale[:3]}")

    outcome = {"changed": [], "unchanged": [], "refused": [], "failed": []}
    written = 0
    import analyze_articles as aa  # noqa: E402

    def work(row):
        record = live[row["analysis_path"]]
        mentions = record.get("mentions") or []
        answer = classify(row, assets, model, max_tokens, taxonomy_version, mentions)
        if answer.get("kind") != "record":
            return row, None, f"{answer.get('kind')}: {answer.get('detail') or answer.get('error_kind')}"
        new = answer["record"]
        updated, refusal = apply_topics(record, new.get("topics"), new.get("site_relevant"),
                                        taxonomy, model=new.get("model") or model,
                                        manifest_id=manifest_id, now=now)
        return row, updated, refusal

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, row) for row in rows]
        for future in as_completed(futures):
            row, updated, refusal = future.result()
            entry = {"analysis_path": row["analysis_path"], "title": row["title"],
                     "before": primary_of(row["topics"])}
            if updated is None:
                if isinstance(refusal, dict) and refusal.get("kind") in REFUSAL_KINDS:
                    outcome["refused"].append({**entry, "kind": refusal["kind"],
                                               "reason": refusal["detail"]})
                else:
                    outcome["failed"].append({**entry, "reason": str(refusal)})
                continue
            entry["after"] = primary_of(updated["topics"])
            entry["topics_after"] = updated["topics"]
            bucket = ("unchanged" if entry["after"] == entry["before"]
                      and updated["topics"] == (live[row["analysis_path"]].get("topics") or [])
                      else "changed")
            if not dry_run:
                path = ROOT / row["analysis_path"]
                # ⚠️ RE-CHECKED AT WRITE TIME, not only at the preflight: the
                # model pass takes minutes and the hourly runner writes the
                # same files. A record that moved is reported, never clobbered.
                on_disk = read_json(path)
                if sha256_text(json.dumps(on_disk, ensure_ascii=False, sort_keys=True)) != row["analysis_sha256"]:
                    outcome["failed"].append({**entry, "reason": "changed on disk during the run — re-freeze"})
                    continue
                aa.write_json_atomic(str(path), updated)
                written += 1
            outcome[bucket].append(entry)

    for bucket in outcome.values():
        bucket.sort(key=lambda e: e["analysis_path"])
    # ⚠️ TWO KINDS OF „changed": a moved PRIMARY is the reclassification the
    # task is about; a changed secondary list on an unmoved primary is not,
    # and folding them together would overstate the move by a third.
    primary_changed = sum(1 for e in outcome["changed"] if e["after"] != e["before"])
    after_topics = [e["topics_after"] for e in outcome["changed"] + outcome["unchanged"]]
    report = {
        "version": 1,
        "task": "T3.2",
        "manifest": manifest_id,
        "manifest_path": str(manifest_path.relative_to(ROOT)) if manifest_path.is_relative_to(ROOT) else str(manifest_path),
        "applied_at": now,
        "dry_run": dry_run,
        "model": model,
        "taxonomy_version": taxonomy_version,
        "query": manifest["query"],
        "readings": manifest["readings"],
        "records_scanned": manifest["records_scanned"],
        "candidates": manifest["candidates"],
        "reclassifiable": len(rows),
        "written": written,
        "before": distribution([r["topics"] for r in rows]),
        "after": distribution(after_topics),
        "counts": {**{k: len(v) for k, v in outcome.items()},
                   "primary_changed": primary_changed,
                   "secondaries_only": len(outcome["changed"]) - primary_changed},
        "changed": outcome["changed"],
        # Every unchanged row, primary only (the secondaries did not move by
        # definition) — so `after` is re-derivable from the rows.
        "unchanged": [{k: v for k, v in e.items() if k != "topics_after"}
                      for e in outcome["unchanged"]],
        "refused": outcome["refused"],
        "failed": outcome["failed"],
        "spot_check": {
            "changed": [{"title": e["title"], "before": e["before"], "after": e["after"]}
                        for e in outcome["changed"][:10]],
            "unchanged": [{"title": e["title"], "primary": e["before"]}
                          for e in outcome["unchanged"][:10]],
        },
    }
    return report


def fold_retry(previous: dict, retry: dict) -> dict:
    """Fold a `--retry-failed` pass into the report it retried — pure.

    The retried rows leave `failed`; each lands in changed / unchanged /
    refused / failed by what the retry decided; `counts`, `after`, `written`
    and the spot-check are recomputed from the rows; the pass is appended to
    `retries`. `before`, `reclassifiable` and the query are the first pass's
    and do not move."""
    retried = {f["analysis_path"] for f in retry["changed"] + retry["unchanged"]
               + retry["refused"] + retry["failed"]}
    out = dict(previous)
    out["failed"] = [f for f in previous["failed"] if f["analysis_path"] not in retried]
    for bucket in ("changed", "unchanged", "refused", "failed"):
        out[bucket] = sorted(out.get(bucket, []) + retry[bucket], key=lambda e: e["analysis_path"])
    out["written"] = previous["written"] + retry["written"]
    primary_changed = sum(1 for e in out["changed"] if e["after"] != e["before"])
    out["counts"] = {"changed": len(out["changed"]), "unchanged": len(out["unchanged"]),
                     "refused": len(out["refused"]), "failed": len(out["failed"]),
                     "primary_changed": primary_changed,
                     "secondaries_only": len(out["changed"]) - primary_changed}
    after_rows = ([e["topics_after"] for e in out["changed"]]
                  + [[{"category": e["before"][0], "subcategory": e["before"][1], "primary": True}]
                     for e in out["unchanged"]])
    out["after"] = distribution(after_rows)
    out["spot_check"] = {
        "changed": [{"title": e["title"], "before": e["before"], "after": e["after"]}
                    for e in out["changed"] if e["after"] != e["before"]][:10],
        "unchanged": [{"title": e["title"], "primary": e["before"]} for e in out["unchanged"][:10]],
    }
    out["retries"] = list(previous.get("retries") or []) + [{
        "applied_at": retry["applied_at"], "rows": len(retried),
        "changed": len(retry["changed"]), "unchanged": len(retry["unchanged"]),
        "refused": len(retry["refused"]), "failed": len(retry["failed"]),
        "basis": "--retry-failed on the previous pass's failed rows"}]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--freeze", action="store_true",
                      help="retrieve the candidate set and freeze it (no model)")
    mode.add_argument("--apply", metavar="MANIFEST", type=Path,
                      help="reclassify the frozen set (writes topics unless --dry-run)")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int,
                    default=int(os.environ.get("NEWS_LLM_WORKERS", "4")))
    ap.add_argument("--dry-run", action="store_true",
                    help="with --apply: ask the model, write nothing")
    ap.add_argument("--model")
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--report-out", type=Path,
                    help="with --apply: where to write the before/after report")
    mode.add_argument("--retopic-stories", metavar="REPORT", type=Path,
                      help="re-derive story topics for every story holding an "
                           "article the report reclassified (writes unless --dry-run)")
    ap.add_argument("--retry-failed", metavar="REPORT", type=Path,
                    help="with --apply: only the rows a previous report listed as "
                         "failed (a model that answered unparseable JSON)")
    args = ap.parse_args(argv)
    if args.retry_failed and args.apply is None:
        ap.error("--retry-failed requires --apply")
    if args.retry_failed and args.report_out:
        ap.error("--retry-failed folds into the report it retries; --report-out is not allowed with it")
    if args.retry_failed and args.limit:
        ap.error("--limit would truncate the retry set silently; retry every failed row")

    if args.freeze:
        manifest = freeze(args.limit)
        out = FREEZE_DIR / manifest["frozen_at"] / "candidates.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n",
                       encoding="utf-8")
        summary = {k: v for k, v in manifest.items() if k != "rows"}
        summary["manifest"] = str(out.relative_to(ROOT))
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return 0

    if args.retopic_stories:
        previous = read_json(args.retopic_stories)
        paths = {e["analysis_path"] for e in previous.get("changed") or []}
        if not paths:
            raise SystemExit("nothing to retopic: the report lists no changed row")
        result = retopic_stories(paths, dry_run=args.dry_run)
        if not args.dry_run:
            previous["stories"] = {"retopiced_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
                                   **result}
            args.retopic_stories.write_text(json.dumps(previous, ensure_ascii=False, indent=1) + "\n",
                                            encoding="utf-8")
        print(json.dumps({**result, "moved": len(result["moved"]),
                          "moved_sample": result["moved"][:10]}, ensure_ascii=False, indent=1))
        return 0

    only = None
    if args.retry_failed:
        previous = read_json(args.retry_failed)
        only = {f["analysis_path"] for f in previous.get("failed") or []}
        if not only:
            raise SystemExit("nothing to retry: the report lists no failed row")
    report = apply(args.apply, limit=args.limit, workers=args.workers,
                   dry_run=args.dry_run, model=args.model, max_tokens=args.max_tokens,
                   only=only)
    if args.retry_failed and not args.dry_run:
        report = fold_retry(previous, report)
        args.retry_failed.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                                     encoding="utf-8")
    if args.report_out:
        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                                   encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items()
                      if k not in ("changed", "unchanged", "refused", "failed")},
                     ensure_ascii=False, indent=1))
    return 1 if report["counts"]["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
