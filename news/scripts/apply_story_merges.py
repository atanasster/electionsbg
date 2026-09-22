#!/usr/bin/env python3
"""Apply ACCEPTED story merges from the editorial review queue.

`home_event_dedupe.py` detects same-event story pairs and writes them to
`news/review/story_merge_queue.json` as proposals. It deliberately does not
act on them: it only suppresses duplicate CARDS on the home page and leaves
canonical story membership alone. `analyze_local.py` never merges either --
its `same_story` branch fires only for an article that already has a story,
so every new article becomes a singleton.

Nothing consumed the accepted end of that queue, so proposals accumulated and
no story ever gained a second outlet. Measured 2026-09-02 across six days of
the corpus: 0, 0, 1, 0, 1, 0 multi-outlet stories, against 90 queued
proposals -- on a site whose entire premise is comparing how outlets cover the
same event. This script is the missing consumer.

⚠️ IT ACTS ONLY ON `accepted`. `pending` is the default state of a machine
proposal that nobody has read; applying those would make the review step
decorative and would merge on the strength of the heuristic alone. A wrong
merge is the one operation here that loses information -- two separate events
become one story and the members' original grouping is not recoverable from
the merged file -- which is why every layer of this pipeline defers it to a
human. Accepting is that human's act; this only carries it out.

⚠️ IT MERGES `candidate` INTO `keeper`, which is the pair the queue's own
identity is built from (`_proposal_id` and the rejected-pair check both key on
keeper+candidate). `matched` is EVIDENCE PROVENANCE, not a third party to the
merge: it names whichever story in the connected component supplied the
strongest direct edge to the candidate. When `matched` is not the keeper the
merge is transitive -- A~B and B~C accepted means A, B and C become one story
-- so the dry run prints that explicitly rather than letting it happen
silently.

Idempotent: a candidate whose story file is already gone has been applied, and
is reported and skipped. The queue's own schema admits only
pending/accepted/rejected (`REVIEW_STATUSES`), and `build_story_merge_queue`
RAISES on an unknown status, so nothing here stamps "applied" on an item;
the record of an application is the keeper's `merge_history` and the
retired-stories registry.

⚠️ PLAN T2.2 — WHAT AN APPLIED MERGE OWES THE READER AND THE REVIEWER:

- A REJECTED PAIR BLOCKS THE MERGE, DIRECTLY AND TRANSITIVELY, TO ANY DEPTH.
  The queue's `rejected` items are a human saying „these are two events".
  Merging candidate C into keeper K is refused when (K, C) is rejected — and
  also when any story ever folded INTO K (its `merge_history`, walked through
  every nested `candidate_merge_history`) was rejected against C or against
  any story ever folded into C, because A~B accepted and B~C accepted must
  not smuggle in an A/C a human refused. Refusal code: `rejected_pair`.
- A TRANSITIVE MERGE IS VALIDATED AGAINST THE EVENT ANCHOR. When `matched`
  is not the keeper, the human accepted C≈B, not C≈K; the candidate is
  re-read against the KEEPER (its frozen canonical title, entities, topic —
  `analyze_articles.story_rule_view`, the pipeline's own view) under the
  strict rule, then the review rule, and a pair that passes neither is
  refused with code `anchor_mismatch` rather than chained in — the drift a
  chain of pairwise merges otherwise accumulates. `--allow-anchor-miss`
  overrides, and the output says so. A DIRECT merge is the pair the human
  accepted and is not second-guessed.
- THE RETIRED ID IS A REDIRECT, NEVER A 404, AND THE REDIRECT FOLLOWS THE
  KEEPER. The candidate's id was published; `news/config/retired_stories.json`
  gets `{reason: merged, target: keeper}` (plan T1.5's registry — the
  uploader REFUSES a public release that drops a published story id not
  listed there, so an apply that did not write it would block the next
  publish). When a keeper is itself merged later, every entry pointing at it
  is re-pointed at the new keeper, because `build_app_data` refuses a
  registry whose target is not published.
- THE MERGE IS REVERSIBLE. The keeper records `merge_history` — which story,
  when, under which proposal, its member urls, BOTH titles and summaries,
  the topics it brought, its own nested history, the evidence and the
  decision — and `--split <id> --apply` restores that story from the record
  (searched through the nested histories, so a story folded through a chain
  is still recoverable), moves its members back, re-points the index, lifts
  the retirement and marks the proposal `rejected` so the pair is not
  re-proposed.
- THE DECISION IS RECORDED. `--decide <proposal-id> --status
  accepted|rejected --by <reviewer> [--note …]` stamps `decision` (reviewer,
  when, note, the evidence's rule version, the proposing channel) on the
  queue item and mirrors the status onto the article-channel sidecar item it
  came from; a rebuild preserves it. A decision on an item the queue no
  longer proposes (`active: false`) needs `--force`; `rejected` on a merge
  that was already applied is refused — the reversal is `--split`.
- IT DOES NOT RUN BESIDE THE PIPELINE. `--apply` and `--split --apply` take
  the pipeline's own `news/data/_nightly/pipeline.lock` (mkdir) and refuse
  when it is held: the index is a read-modify-write shared with
  `analyze_local --save`, and a lost update there points articles at deleted
  story files. Within a run the index and the registry are written after
  EVERY merge, and the registry entry is written BEFORE the candidate's file
  is deleted, so an interrupted run leaves a consistent corpus.
- NOTHING DOWNSTREAM IS RECOMPUTED HERE. Aggregates, tones, search, the
  feed, case pages and prerenders are all DERIVED by `build_app_data` /
  `build:news` from the index and the story files, so the output carries
  `needs_rebuild: true` and the next build carries the correction everywhere.
- `NEWS_AUTO_MERGE=0` is the only kill switch for the AUTOMATIC join; this
  script applies human decisions and has no switch of its own.

⚠️ THE 85 MERGES APPLIED BEFORE T2.2 (2026-09-02 → 2026-09-21) carry no
`merge_history` and no registry entry: they are neither reversible nor
redirected by this script. A known limitation, stated rather than implied
away.

Run:  python3 news/scripts/apply_story_merges.py            # dry run
      python3 news/scripts/apply_story_merges.py --apply
      python3 news/scripts/apply_story_merges.py --decide story-merge-… --status accepted --by "Име" --note "…"
      python3 news/scripts/apply_story_merges.py --split 20260902-cand --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import analyze_articles as aa  # noqa: E402
from home_event_dedupe import (  # noqa: E402
    REVIEW_STATUSES, STRICT_RULE_VERSION, rejected_story_pairs, same_event_evidence,
    write_story_merge_queue,
)

REPO_ROOT = aa.REPO_ROOT
QUEUE_PATH = os.path.join(REPO_ROOT, "news", "review", "story_merge_queue.json")
RETIRED_PATH = os.path.join(REPO_ROOT, "news", "config", "retired_stories.json")
SIDECAR_PATH = aa.JOIN_PROPOSALS_PATH
LOCK_DIR = os.path.join(REPO_ROOT, "news", "data", "_nightly", "pipeline.lock")
RETIRED_REASONS = ("withdrawn", "merged", "error")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RETIRED_NOTE = ("Тази история беше обединена с друга, отразяваща същото събитие, "
                "след редакционен преглед.")


# ------------------------------------------------------------- registries ---

def load_queue(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        queue = json.load(handle)
    if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
        raise ValueError(f"{path} is not a story merge queue")
    return queue


def load_retired(path: str = RETIRED_PATH) -> dict:
    """The T1.5 registry, validated the way the build validates it — an
    apply must fail BEFORE it writes, not at the next build."""
    doc = aa.load_json_if_exists(path)
    if doc is None:
        return {"version": 1, "retired": {}}
    if not isinstance(doc, dict) or doc.get("version") != 1 or not isinstance(doc.get("retired"), dict):
        raise ValueError(f"{path} is not a retired-stories registry")
    for sid, entry in doc["retired"].items():
        if not isinstance(entry, dict) or entry.get("reason") not in RETIRED_REASONS:
            raise ValueError(f"{path}: {sid} needs a reason in {RETIRED_REASONS}")
        if (not DATE_RE.match(str(entry.get("on", ""))) or not isinstance(entry.get("note"), str)
                or not entry["note"].strip()):
            raise ValueError(f"{path}: {sid} needs an ISO `on` date and a note")
        if entry["reason"] == "merged" and not isinstance(entry.get("target"), str):
            raise ValueError(f"{path}: {sid} is merged but names no target")
    return doc


def write_retired(path: str, doc: dict) -> None:
    aa.write_json_atomic(path, {**doc, "retired": dict(sorted(doc["retired"].items()))})


def live_target(retired: dict, story_id: str) -> str | None:
    """Follow `merged` redirects to the keeper that still exists."""
    seen = set()
    current = story_id
    while current in retired["retired"] and retired["retired"][current].get("reason") == "merged":
        if current in seen:
            return None
        seen.add(current)
        current = retired["retired"][current].get("target")
    return current if current and aa.load_story(current) is not None else None


# ------------------------------------------------------------ the guards ---

def _walk_history(records: list, out: set) -> None:
    for record in records or []:
        if not isinstance(record, dict):
            continue
        if record.get("from"):
            out.add(record["from"])
        _walk_history(record.get("candidate_merge_history") or [], out)


def folded_ids(story: dict | None) -> set:
    """A story's id plus every id ever merged INTO it, to any depth — the set
    a rejected pair must be checked against, so a chain cannot smuggle in a
    pair a human refused."""
    if not story:
        return set()
    out = {story.get("id")}
    _walk_history(story.get("merge_history") or [], out)
    return out


def rejected_between(left: dict | None, right: dict | None, rejected: set) -> list:
    return sorted(f"{a}~{b}" for a in folded_ids(left) for b in folded_ids(right)
                  if frozenset((a, b)) in rejected)


def anchor_check(candidate: dict, keeper: dict) -> str:
    """How the candidate reads against the KEEPER as anchor: strict, review,
    or none — the pipeline's own rule over the pipeline's own story view."""
    left, right = aa.story_rule_view(candidate), aa.story_rule_view(keeper)
    if same_event_evidence(left, right) is not None:
        return "strict"
    if same_event_evidence(left, right, mode="review") is not None:
        return "review"
    return "none"


def analysis_for(url: str, article_path: str, index: dict) -> dict | None:
    """The analysis record behind one story member."""
    rel = (index.get("articles", {}).get(url) or {}).get("path")
    full = (os.path.join(REPO_ROOT, rel) if rel
            else aa.analysis_path_for(article_path))
    record = aa.load_json_if_exists(full)
    return record if isinstance(record, dict) else None


def recompute_and_save(story: dict, index: dict) -> None:
    analyses = {}
    for member in story.get("members", []):
        record = analysis_for(member.get("url"), member.get("article_path"), index)
        if record is not None:
            analyses[member["url"]] = record
    aa.recompute_story(story, analyses)
    aa.save_story(story)
    index.setdefault("stories", {})[story["id"]] = aa.index_story_entry(story)


def merge_topics(keeper: list, candidate: list) -> tuple:
    """Union the two topic lists; only the keeper may hold `primary`.
    Returns (merged, added) so a split can take the added ones back out."""
    merged = [dict(topic) for topic in keeper if isinstance(topic, dict)]
    seen = {(t.get("category"), t.get("subcategory")) for t in merged}
    added = []
    for topic in candidate:
        if not isinstance(topic, dict):
            continue
        key = (topic.get("category"), topic.get("subcategory"))
        if key in seen:
            continue
        seen.add(key)
        merged.append({**topic, "primary": False})
        added.append({**topic, "primary": False})
    return merged, added


# ---------------------------------------------------------------- merges ---

def plan_one(item: dict, index: dict, rejected: set | None = None,
             allow_anchor_miss: bool = False) -> dict:
    """Decide what an accepted proposal would do, without touching disk."""
    rejected = rejected or set()
    keeper_id = ((item.get("keeper") or {}).get("id"))
    candidate_id = ((item.get("candidate") or {}).get("id"))
    matched_id = ((item.get("matched") or {}).get("id"))
    row = {
        "proposal": item.get("id"),
        "keeper": keeper_id,
        "candidate": candidate_id,
        "matched": matched_id,
        "transitive": bool(matched_id and matched_id != keeper_id),
    }
    if not isinstance(keeper_id, str) or not isinstance(candidate_id, str):
        return {**row, "action": "refused", "code": "missing_ids", "reason": "missing story ids"}
    if keeper_id == candidate_id:
        return {**row, "action": "refused", "code": "self_merge", "reason": "keeper is the candidate"}
    keeper = aa.load_story(keeper_id)
    candidate = aa.load_story(candidate_id)
    if candidate is None:
        # The only benign absence: this merge already happened.
        return {**row, "action": "already_applied",
                "reason": "candidate story no longer exists"}
    if keeper is None:
        return {**row, "action": "refused", "code": "keeper_missing",
                "reason": f"keeper story {keeper_id} not found"}
    blocked = rejected_between(keeper, candidate, rejected)
    if blocked:
        return {**row, "action": "refused", "code": "rejected_pair",
                "reason": f"a human rejected this pair (directly or through a folded story): {blocked}"}
    anchor = anchor_check(candidate, keeper) if row["transitive"] else "direct"
    row["anchor_check"] = anchor
    if anchor == "none" and not allow_anchor_miss:
        return {**row, "action": "refused", "code": "anchor_mismatch",
                "reason": "transitive merge: the candidate matches neither rule against the keeper "
                          "(the event anchor) — pass --allow-anchor-miss to chain it anyway"}
    moving = [m for m in candidate.get("members", [])
              if m.get("url") not in {n.get("url") for n in keeper.get("members", [])}]
    return {**row, "action": "merge", "members_moved": len(moving),
            "outlets_after": sorted(
                {m.get("domain") for m in keeper.get("members", []) + moving
                 if m.get("domain")})}


def apply_one(row: dict, index: dict, retired: dict, retired_path: str,
              item: dict | None = None, now: str | None = None) -> dict:
    """Carry out one planned merge — reversibly, with the retired id
    redirected, and with the registry written BEFORE the candidate's file
    is deleted."""
    now = now or aa.now_iso()
    keeper = aa.load_story(row["keeper"])
    candidate = aa.load_story(row["candidate"])
    keeper_urls = {m.get("url") for m in keeper.get("members", [])}
    moved = [m for m in candidate.get("members", []) if m.get("url") not in keeper_urls]

    # Fold the candidate's metadata into the keeper — members, topics,
    # related ids — and record everything a split needs to undo each.
    keeper["members"] = keeper.get("members", []) + moved
    keeper["topics"], topics_added = merge_topics(keeper.get("topics") or [],
                                                  candidate.get("topics") or [])
    folded = folded_ids(keeper) | folded_ids(candidate)
    related = [r for r in (keeper.get("related_story_ids") or [])
               + (candidate.get("related_story_ids") or []) if r not in folded]
    keeper["related_story_ids"] = sorted(dict.fromkeys(related))
    keeper.setdefault("merge_history", []).append({
        "from": row["candidate"], "on": now, "proposal": row["proposal"],
        "members": [m.get("url") for m in moved],
        "candidate_title_bg": candidate.get("canonical_title_bg"),
        "candidate_title_en": candidate.get("canonical_title_en"),
        "candidate_summary_bg": candidate.get("summary_bg"),
        "candidate_summary_en": candidate.get("summary_en"),
        "candidate_created_at": candidate.get("created_at"),
        "candidate_topics": candidate.get("topics") or [],
        "candidate_related_story_ids": candidate.get("related_story_ids") or [],
        "candidate_merge_history": candidate.get("merge_history") or [],
        "topics_added": topics_added,
        "evidence": (item or {}).get("evidence"),
        "decision": (item or {}).get("decision"),
        "anchor_check": row.get("anchor_check"),
    })

    # The redirect, and every redirect that pointed at the candidate, now
    # point at the keeper — written before anything is deleted.
    for entry in retired["retired"].values():
        if entry.get("reason") == "merged" and entry.get("target") == row["candidate"]:
            entry["target"] = row["keeper"]
    retired["retired"][row["candidate"]] = {
        "reason": "merged", "on": now[:10], "target": row["keeper"], "note": RETIRED_NOTE,
    }
    write_retired(retired_path, retired)

    recompute_and_save(keeper, index)
    # Membership lives ONLY in the index -- the article records carry no
    # story_id (build_app_data resolves it via analysis/index.json), so this
    # is the write that actually moves the articles.
    for member in candidate.get("members", []):
        entry = index.get("articles", {}).get(member.get("url"))
        if isinstance(entry, dict):
            entry["story_id"] = row["keeper"]
    index.get("stories", {}).pop(row["candidate"], None)
    index["updated_at"] = now
    aa.write_json_atomic(aa.INDEX_PATH, index)
    aa.delete_story(row["candidate"])
    return {**row, "applied": True,
            "members_after": len(keeper.get("members", [])),
            "outlet_count": (keeper.get("aggregates") or {}).get("outlet_count")}


# ---------------------------------------------------------------- splits ---

def _find_record(records: list, candidate_id: str):
    """(record, its parent list) for the merge record of `candidate_id`,
    searched through the nested histories."""
    for record in records or []:
        if not isinstance(record, dict):
            continue
        if record.get("from") == candidate_id:
            return record, records
        found = _find_record(record.get("candidate_merge_history") or [], candidate_id)
        if found:
            return found
    return None


def plan_split(candidate_id: str, retired: dict) -> dict:
    """What `--split` would do, without touching disk."""
    entry = retired["retired"].get(candidate_id)
    if not entry or entry.get("reason") != "merged":
        return {"action": "refused", "candidate": candidate_id, "code": "not_merged",
                "reason": "retired_stories.json has no merged entry for this id"}
    keeper_id = live_target(retired, candidate_id)
    keeper = aa.load_story(keeper_id) if keeper_id else None
    if keeper is None:
        return {"action": "refused", "candidate": candidate_id, "code": "keeper_missing",
                "reason": f"the redirect chain from {candidate_id} reaches no live story"}
    found = _find_record(keeper.get("merge_history") or [], candidate_id)
    if not found:
        return {"action": "refused", "candidate": candidate_id, "keeper": keeper_id, "code": "no_record",
                "reason": "the keeper carries no merge_history for this id — not reversible from disk"}
    if aa.load_story(candidate_id) is not None:
        return {"action": "refused", "candidate": candidate_id, "code": "exists",
                "reason": "a story with this id already exists"}
    record, parent = found
    return {"action": "split", "candidate": candidate_id, "keeper": keeper_id,
            "members_restored": len(record.get("members") or []), "proposal": record.get("proposal"),
            "_keeper": keeper, "_record": record, "_parent": parent}


def apply_split(plan: dict, index: dict, retired: dict, retired_path: str,
                queue: dict, now: str) -> dict:
    keeper, record, parent = plan["_keeper"], plan["_record"], plan["_parent"]
    candidate_id, keeper_id = plan["candidate"], plan["keeper"]
    urls = set(record.get("members") or [])
    back = [m for m in keeper.get("members", []) if m.get("url") in urls]
    keeper["members"] = [m for m in keeper.get("members", []) if m.get("url") not in urls]
    parent.remove(record)
    added = {(t.get("category"), t.get("subcategory")) for t in record.get("topics_added") or []}
    keeper["topics"] = [t for t in keeper.get("topics") or []
                        if (t.get("category"), t.get("subcategory")) not in added or t.get("primary")]
    keeper.setdefault("split_history", []).append(
        {"restored": candidate_id, "on": now, "members": sorted(urls)})
    restored = {
        "id": candidate_id,
        "canonical_title_bg": record.get("candidate_title_bg") or keeper.get("canonical_title_bg"),
        "canonical_title_en": record.get("candidate_title_en") or keeper.get("canonical_title_en"),
        "summary_bg": record.get("candidate_summary_bg") or keeper.get("summary_bg"),
        "summary_en": record.get("candidate_summary_en") or keeper.get("summary_en"),
        "created_at": record.get("candidate_created_at") or record.get("on") or now,
        "updated_at": now,
        "topics": record.get("candidate_topics") or keeper.get("topics") or [],
        "related_story_ids": record.get("candidate_related_story_ids") or [],
        "members": back, "entities": {}, "aggregates": {},
        "merge_history": record.get("candidate_merge_history") or [],
    }
    # The registry first: the id is about to be published again, and a build
    # in between must never see it both retired and served.
    retired["retired"].pop(candidate_id, None)
    for entry in retired["retired"].values():
        if entry.get("reason") == "merged" and entry.get("target") == candidate_id:
            entry["target"] = keeper_id
    write_retired(retired_path, retired)
    recompute_and_save(restored, index)
    recompute_and_save(keeper, index)
    for url in urls:
        entry = index.get("articles", {}).get(url)
        if isinstance(entry, dict):
            entry["story_id"] = candidate_id
    index["updated_at"] = now
    aa.write_json_atomic(aa.INDEX_PATH, index)
    # The pair is not re-proposed: the human said they are two events.
    for item in queue.get("items", []):
        if isinstance(item, dict) and item.get("id") == record.get("proposal"):
            item["status"] = "rejected"
            item["decision"] = {"by": "split", "on": now, "note": f"split {candidate_id} back out of {keeper_id}",
                                "rule_version": (item.get("evidence") or {}).get("rule_version") or STRICT_RULE_VERSION,
                                "source": item.get("source", "home_briefing")}
    return {k: v for k, v in plan.items() if not k.startswith("_")}


# -------------------------------------------------------------- decisions ---

def decide(queue: dict, proposal_id: str, status: str, by: str, note: str | None,
           now: str, force: bool = False) -> dict:
    if status not in REVIEW_STATUSES:
        raise ValueError(f"status must be one of {sorted(REVIEW_STATUSES)}")
    if not by.strip():
        raise ValueError("--by must name the reviewer")
    for item in queue.get("items", []):
        if not (isinstance(item, dict) and item.get("id") == proposal_id):
            continue
        candidate_id = (item.get("candidate") or {}).get("id")
        applied = bool(candidate_id) and aa.load_story(candidate_id) is None
        if applied and status == "rejected":
            raise ValueError(f"{proposal_id} was already applied ({candidate_id} is merged) — "
                             "reverse it with --split, a rejection cannot")
        if not item.get("active") and not force:
            raise ValueError(f"{proposal_id} is no longer proposed by the pipeline (active: false) — "
                             "pass --force to decide it on stale evidence")
        item["status"] = status
        item["decision"] = {"by": by.strip(), "on": now, "note": note or None,
                            "rule_version": (item.get("evidence") or {}).get("rule_version") or STRICT_RULE_VERSION,
                            "source": item.get("source", "home_briefing"),
                            "active_when_decided": bool(item.get("active")),
                            "already_applied": applied}
        return item
    raise ValueError(f"no proposal {proposal_id} in the queue")


def mirror_decision_to_sidecar(item: dict, path: str = SIDECAR_PATH) -> bool:
    """An article-channel decision goes back onto the sidecar item it came
    from, so the sidecar stops re-proposing it and can retire it."""
    sidecar_id = (item.get("evidence") or {}).get("sidecar_id")
    if not sidecar_id:
        return False
    try:
        doc = aa.load_json_if_exists(path)
    except json.JSONDecodeError:
        return False
    if not isinstance(doc, dict) or not isinstance(doc.get("items"), list):
        return False
    hit = False
    for row in doc["items"]:
        if isinstance(row, dict) and row.get("id") == sidecar_id:
            row["status"] = item["status"]
            row["decision"] = item.get("decision")
            hit = True
    if hit:
        aa.write_json_atomic(path, doc)
    return hit


# ------------------------------------------------------------------ lock ---

class PipelineLock:
    """The pipeline's own mkdir lock; refuses rather than waits."""

    def __init__(self, lock_dir: str):
        self.lock_dir = lock_dir
        self.held = False

    def __enter__(self):
        os.makedirs(os.path.dirname(self.lock_dir), exist_ok=True)
        try:
            os.mkdir(self.lock_dir)
        except FileExistsError:
            raise RuntimeError(f"the pipeline lock {self.lock_dir} is held — "
                               "an analyze/save run is in flight; retry when it finishes") from None
        with open(os.path.join(self.lock_dir, "pid"), "w") as fh:
            fh.write(str(os.getpid()))
        self.held = True
        return self

    def __exit__(self, *exc):
        if self.held:
            try:
                os.remove(os.path.join(self.lock_dir, "pid"))
            except OSError:
                pass
            try:
                os.rmdir(self.lock_dir)
            except OSError:
                pass


# ------------------------------------------------------------------ main ---

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", default=QUEUE_PATH)
    ap.add_argument("--apply", action="store_true",
                    help="write; without it the run only reports")
    ap.add_argument("--limit", type=int, default=0,
                    help="apply at most N merges (0 = no limit)")
    ap.add_argument("--retired", default=RETIRED_PATH)
    ap.add_argument("--sidecar", default=SIDECAR_PATH)
    ap.add_argument("--lock-dir", default=LOCK_DIR)
    ap.add_argument("--allow-anchor-miss", action="store_true",
                    help="chain a transitive merge whose candidate matches neither rule against the keeper")
    ap.add_argument("--decide", metavar="PROPOSAL_ID", help="record a reviewer's decision on one proposal")
    ap.add_argument("--status", choices=sorted(REVIEW_STATUSES))
    ap.add_argument("--by", help="the reviewer, for --decide")
    ap.add_argument("--note", default=None)
    ap.add_argument("--force", action="store_true",
                    help="with --decide: decide an item the pipeline no longer proposes")
    ap.add_argument("--split", metavar="STORY_ID",
                    help="reverse an applied merge: restore this retired story from the keeper's merge_history")
    args = ap.parse_args()
    if args.limit < 0:
        ap.error("--limit must be non-negative")
    if args.decide and not (args.status and args.by):
        ap.error("--decide needs --status and --by")

    try:
        queue = load_queue(args.queue)
        retired = load_retired(args.retired)
    except (OSError, ValueError) as exc:
        print(json.dumps({"mode": "news_story_merge", "error": str(exc)}))
        return 2
    now = aa.now_iso()

    if args.decide:
        try:
            item = decide(queue, args.decide, args.status, args.by, args.note, now, args.force)
        except ValueError as exc:
            print(json.dumps({"mode": "news_story_merge_decide", "error": str(exc)}))
            return 2
        write_story_merge_queue(Path(args.queue), queue)
        mirrored = mirror_decision_to_sidecar(item, args.sidecar)
        print(json.dumps({"mode": "news_story_merge_decide", "proposal": item["id"],
                          "status": item["status"], "decision": item["decision"],
                          "active": bool(item.get("active")), "sidecar_mirrored": mirrored},
                         ensure_ascii=False))
        return 0

    if args.split:
        plan = plan_split(args.split, retired)
        if plan["action"] == "split" and args.apply:
            try:
                with PipelineLock(args.lock_dir):
                    index = aa.load_index()
                    result = apply_split(plan, index, retired, args.retired, queue, now)
                    write_story_merge_queue(Path(args.queue), queue)
            except RuntimeError as exc:
                print(json.dumps({"mode": "news_story_split", "error": str(exc)}))
                return 2
        else:
            result = {k: v for k, v in plan.items() if not k.startswith("_")}
        print(json.dumps({"mode": "news_story_split", "dry_run": not args.apply,
                          "needs_rebuild": bool(args.apply and result["action"] == "split"), **result},
                         ensure_ascii=False))
        return 0 if result["action"] == "split" else 1

    rejected = rejected_story_pairs(queue)
    accepted = [i for i in queue["items"]
                if isinstance(i, dict) and i.get("status") == "accepted"]
    by_proposal = {i.get("id"): i for i in accepted}

    def plan_all(index):
        return [plan_one(item, index, rejected, args.allow_anchor_miss) for item in accepted]

    applied: list = []
    if args.apply:
        try:
            with PipelineLock(args.lock_dir):
                index = aa.load_index()
                rows = plan_all(index)
                merges = [r for r in rows if r["action"] == "merge"]
                if args.limit:
                    merges = merges[:args.limit]
                deleted = []
                for row in merges:
                    # Re-plan: an earlier merge in this run can absorb a later
                    # candidate, and acting on the stale plan would resurrect it.
                    fresh = plan_one({"id": row["proposal"],
                                      "keeper": {"id": row["keeper"]},
                                      "candidate": {"id": row["candidate"]},
                                      "matched": {"id": row["matched"]}}, index, rejected,
                                     args.allow_anchor_miss)
                    if fresh["action"] != "merge":
                        applied.append(fresh)
                        continue
                    applied.append(apply_one(fresh, index, retired, args.retired,
                                             by_proposal.get(row["proposal"]), now))
                    deleted.append(row["candidate"])
                # One sweep for dangling related ids, not one per merge.
                for sid in deleted:
                    aa.prune_related_ids(sid, index)
        except RuntimeError as exc:
            print(json.dumps({"mode": "news_story_merge", "error": str(exc)}))
            return 2
        reported = applied
    else:
        index = aa.load_index()
        rows = plan_all(index)
        merges = [r for r in rows if r["action"] == "merge"]
        if args.limit:
            merges = merges[:args.limit]
        reported = merges

    # Refused at plan time (rows) and, on apply, at re-plan time too — the
    # exit code and the count cover both, so the dry run and the apply agree.
    refused = [r for r in rows if r["action"] == "refused"] + [
        r for r in applied if r["action"] == "refused"]
    print(json.dumps({
        "mode": "news_story_merge",
        "queue": os.path.relpath(args.queue, REPO_ROOT),
        "dry_run": not args.apply,
        "counts": {
            "items": len(queue["items"]),
            "accepted": len(accepted),
            "pending": sum(i.get("status") == "pending" for i in queue["items"]
                           if isinstance(i, dict)),
            "merges_planned": len(merges),
            "already_applied": sum(r["action"] == "already_applied" for r in rows),
            "refused": len(refused),
            "transitive": sum(r["transitive"] for r in merges),
        },
        "merges": reported,
        "refused": refused,
        # Everything downstream is derived: the next build carries it.
        "needs_rebuild": bool(args.apply and any(r.get("applied") for r in applied)),
        "allow_anchor_miss": args.allow_anchor_miss,
    }, ensure_ascii=False))
    return 1 if refused else 0


if __name__ == "__main__":
    sys.exit(main())
