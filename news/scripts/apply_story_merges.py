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
is reported and skipped. Nothing is written to the queue, deliberately -- its
schema admits only pending/accepted/rejected (`REVIEW_STATUSES`), and
`build_story_merge_queue` RAISES on an unknown status, so stamping "applied"
would break the next bundle build.

Run:  python3 news/scripts/apply_story_merges.py            # dry run
      python3 news/scripts/apply_story_merges.py --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import analyze_articles as aa  # noqa: E402

REPO_ROOT = aa.REPO_ROOT
QUEUE_PATH = os.path.join(REPO_ROOT, "news", "review", "story_merge_queue.json")


def load_queue(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        queue = json.load(handle)
    if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
        raise ValueError(f"{path} is not a story merge queue")
    return queue


def analysis_for(url: str, article_path: str, index: dict) -> dict | None:
    """The analysis record behind one story member."""
    rel = (index.get("articles", {}).get(url) or {}).get("path")
    full = (os.path.join(REPO_ROOT, rel) if rel
            else aa.analysis_path_for(article_path))
    record = aa.load_json_if_exists(full)
    return record if isinstance(record, dict) else None


def merge_topics(keeper: list, candidate: list) -> list:
    """Union the two topic lists; only the keeper may hold `primary`."""
    merged = [dict(topic) for topic in keeper if isinstance(topic, dict)]
    seen = {(t.get("category"), t.get("subcategory")) for t in merged}
    for topic in candidate:
        if not isinstance(topic, dict):
            continue
        key = (topic.get("category"), topic.get("subcategory"))
        if key in seen:
            continue
        seen.add(key)
        merged.append({**topic, "primary": False})
    return merged


def plan_one(item: dict, index: dict) -> dict:
    """Decide what an accepted proposal would do, without touching disk."""
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
        return {**row, "action": "refused", "reason": "missing story ids"}
    if keeper_id == candidate_id:
        return {**row, "action": "refused", "reason": "keeper is the candidate"}
    keeper = aa.load_story(keeper_id)
    candidate = aa.load_story(candidate_id)
    if candidate is None:
        # The only benign absence: this merge already happened.
        return {**row, "action": "already_applied",
                "reason": "candidate story no longer exists"}
    if keeper is None:
        return {**row, "action": "refused",
                "reason": f"keeper story {keeper_id} not found"}
    moving = [m for m in candidate.get("members", [])
              if m.get("url") not in {n.get("url") for n in keeper.get("members", [])}]
    return {**row, "action": "merge", "members_moved": len(moving),
            "outlets_after": sorted(
                {m.get("domain") for m in keeper.get("members", []) + moving
                 if m.get("domain")})}


def apply_one(row: dict, index: dict) -> dict:
    """Carry out one planned merge."""
    keeper = aa.load_story(row["keeper"])
    candidate = aa.load_story(row["candidate"])
    keeper_urls = {m.get("url") for m in keeper.get("members", [])}
    keeper["members"] = keeper.get("members", []) + [
        m for m in candidate.get("members", []) if m.get("url") not in keeper_urls
    ]
    keeper["topics"] = merge_topics(keeper.get("topics") or [],
                                    candidate.get("topics") or [])
    related = [r for r in (keeper.get("related_story_ids") or [])
               + (candidate.get("related_story_ids") or [])
               if r not in {row["keeper"], row["candidate"]}]
    keeper["related_story_ids"] = sorted(dict.fromkeys(related))

    analyses = {}
    for member in keeper["members"]:
        record = analysis_for(member.get("url"), member.get("article_path"), index)
        if record is not None:
            analyses[member["url"]] = record
    aa.recompute_story(keeper, analyses)
    aa.save_story(keeper)

    # Membership lives ONLY in the index -- the article records carry no
    # story_id (build_app_data resolves it via analysis/index.json), so this
    # is the write that actually moves the articles.
    for member in candidate.get("members", []):
        entry = index.get("articles", {}).get(member.get("url"))
        if isinstance(entry, dict):
            entry["story_id"] = row["keeper"]
    index.get("stories", {}).pop(row["candidate"], None)
    index.setdefault("stories", {})[row["keeper"]] = aa.index_story_entry(keeper)
    aa.delete_story(row["candidate"])
    aa.prune_related_ids(row["candidate"], index)
    return {**row, "applied": True,
            "members_after": len(keeper.get("members", [])),
            "outlet_count": (keeper.get("aggregates") or {}).get("outlet_count")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queue", default=QUEUE_PATH)
    ap.add_argument("--apply", action="store_true",
                    help="write; without it the run only reports")
    ap.add_argument("--limit", type=int, default=0,
                    help="apply at most N merges (0 = no limit)")
    args = ap.parse_args()
    if args.limit < 0:
        ap.error("--limit must be non-negative")

    try:
        queue = load_queue(args.queue)
    except (OSError, ValueError) as exc:
        print(json.dumps({"mode": "news_story_merge", "error": str(exc)}))
        return 2

    index = aa.load_index()
    accepted = [i for i in queue["items"]
                if isinstance(i, dict) and i.get("status") == "accepted"]
    rows = [plan_one(item, index) for item in accepted]
    merges = [r for r in rows if r["action"] == "merge"]
    if args.limit:
        merges = merges[:args.limit]

    applied = []
    if args.apply:
        for row in merges:
            # Re-plan: an earlier merge in this run can absorb a later
            # candidate, and acting on the stale plan would resurrect it.
            fresh = plan_one({"id": row["proposal"],
                              "keeper": {"id": row["keeper"]},
                              "candidate": {"id": row["candidate"]},
                              "matched": {"id": row["matched"]}}, index)
            if fresh["action"] != "merge":
                applied.append(fresh)
                continue
            applied.append(apply_one(fresh, index))
        index["updated_at"] = aa.now_iso()
        aa.write_json_atomic(aa.INDEX_PATH, index)

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
            "refused": sum(r["action"] == "refused" for r in rows),
            "transitive": sum(r["transitive"] for r in merges),
        },
        "merges": applied if args.apply else merges,
        "refused": [r for r in rows if r["action"] == "refused"],
    }, ensure_ascii=False))
    return 1 if any(r["action"] == "refused" for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
