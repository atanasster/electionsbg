#!/usr/bin/env python3
"""Plan T2.1 — the counterfactual over the FROZEN universe: what the union
retrieval and the review-mode rule would have surfaced, measured against
the pipeline's own joins.

⚠️⚠️ THIS IS CONSISTENCY, NOT ACCURACY. The only labels that exist are the
pipeline's own decisions (`same_story` records stamped by the strict rule),
so „recall of the known host" asks whether a rule would have FOUND the
story the pipeline put the article in — a stricter rule that disagrees
with a wrong join scores lower here and is not wrong. No adjudicated pair
exists (T2.0's manifest carries 0 labels); T2.3's gate stays unmet and
nothing in this report may be read as precision.

What it measures, over the publishable articles of a frozen manifest whose
analysis record is UNCHANGED since the freeze (a drifted record is counted
and skipped — the freeze pinned a hash for exactly this):

- RETRIEVAL: for every article the pipeline joined (`same_story`), whether
  its host story is among the candidates under the OLD title-dominated
  ranking (the retired function, replayed VERBATIM) and under the UNION
  ranking (plan T2.1), both against the stories that had a member before
  the article.
- JOIN, strict: how many articles have a candidate OTHER THAN THEIR OWN
  STORY that the STRICT rule accepts under each ranking — the additional
  reach of the join stage with retrieval widened and the rule untouched.
- JOIN, review: how many pairs the REVIEW rule proposes, by the relaxation
  it needed (`topic:category`, `topic:none`, `places:disjoint`,
  `numbers:disjoint`, `lede`), split by the frozen dev/test assignment
  with straddling pairs kept apart — the volumes a reviewer would face.
- COPY TWINS: for every copy group the pipeline filed under more than one
  story, whether the later copy's retrieval reaches the earlier copy's
  story, and whether the strict and the review rule then ACCEPT it — the
  same text under two mastheads is the one pair no rule should miss, and
  measured on the first run the strict rule refused all 58 it reached.

Every figure carries the manifest's sha256 and window, and the ranking /
rule versions it was measured with.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

import analyze_articles as aa  # noqa: E402
import freeze_event_universe as feu  # noqa: E402
from home_event_dedupe import RELAXATION_KINDS, REVIEW_RULE_VERSION, same_event_evidence  # noqa: E402
from news.eval_contract.canonical import analysis_sha256  # noqa: E402

REPORT_DIR = ROOT / "news" / "evals"
RETRIEVAL_VERSION = aa.CANDIDATE_RETRIEVAL_VERSION
RELAXATIONS = RELAXATION_KINDS


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


# ⚠️ THE RETIRED RANKING, VERBATIM — not reproduced from the union output.
# A reproduction sorted ties by story id where the retired function sorted
# stably over index insertion order, and composite scores are small
# integers, so ties straddle rank six often enough that the reproduced
# "old top-six" was not the set the pipeline actually saw. This is the
# function as committed at b89a542f53 (`composite-v0`), with its module
# globals qualified; it is frozen here the way the T2.0 gate pins other
# rules, and `test_evaluate_join_channels` asserts it against the union
# function's composite on shared inputs.
RETRIEVAL_OLD_VERSION = "composite-v0 (verbatim replay of the retired candidate_stories, b89a542f53)"


def candidate_stories_v0(index: dict, article: dict, limit: int = aa.MAX_CANDIDATES):
    art_tokens = aa.tokens(" ".join([
        article.get("title") or "",
        article.get("description") or "",
        article.get("keywords") or "",
    ]))
    art_haystack = " ".join([
        (article.get("title") or "").lower(),
        (article.get("description") or "").lower(),
        (article.get("keywords") or "").lower(),
        (article.get("content") or "").lower(),
    ])
    pub = aa.parse_iso((article.get("published") or "")[:10]) if article.get("published") else None
    scored = []
    for sid, entry in index.get("stories", {}).items():
        st_tokens = aa.tokens((entry.get("title_bg") or "") + " " + (entry.get("title_en") or ""))
        shared = sorted(art_tokens & st_tokens)
        ent_hits = []
        ent_points = 0
        for k, weight in aa.ENTITY_BUCKET_WEIGHTS.items():
            for name in entry.get("entities", {}).get(k, []):
                if name.lower() in aa.GENERIC_ENTITY_NAMES:
                    continue
                if aa.entity_in_text(name, art_haystack):
                    ent_hits.append(name)
                    ent_points += weight
        ent_points = min(ent_points, aa.ENTITY_CONTRIBUTION_CAP)
        date_score = 0
        if pub is not None:
            first = aa.parse_iso((entry.get("first_published") or "")[:10])
            last = aa.parse_iso((entry.get("last_published") or "")[:10])
            if first is not None and last is not None:
                if first <= pub <= last:
                    date_score = 2
                elif min(abs((pub - first).days), abs((pub - last).days)) <= 7:
                    date_score = 1
        score = 3 * len(shared) + ent_points + date_score
        if score >= aa.MIN_CANDIDATE_SCORE:
            scored.append({
                "story_id": sid,
                "title_bg": entry.get("title_bg"),
                "title_en": entry.get("title_en"),
                "member_count": entry.get("member_count"),
                "first_published": entry.get("first_published"),
                "last_published": entry.get("last_published"),
                "topics": entry.get("topics"),
                "score": score,
                "shared_title_tokens": shared,
                "entity_hits": ent_hits,
            })
    scored.sort(key=lambda c: -c["score"])
    return scored[:limit]


# --------------------------------------------------------------- validation ---


def old_ranking(index: dict, article: dict, limit: int) -> list:
    return candidate_stories_v0(index, article, limit)


# The probe and the rule views are the PIPELINE'S OWN (`analysis_probe`,
# `story_rule_view`), imported rather than restated — a harness rebuilding
# them by hand is how a counterfactual drifts from what it claims to measure.
story_view = aa.story_rule_view


def probe_of(rec: dict) -> tuple:
    return aa.analysis_probe(rec)


def evaluate(manifest: dict, data_dir: Path, max_candidates: int = aa.MAX_CANDIDATES) -> dict:
    analysis_dir = data_dir / "analysis"
    articles = [a for a in manifest.get("articles") or []
                if a.get("analysis") and a["analysis"].get("publishable")]
    if not articles:
        raise ValueError("the manifest holds no publishable article — nothing to evaluate")
    index = read_json(analysis_dir / "index.json")
    split_of = {a["id"]: a["split"] for a in manifest["articles"]}
    story_split: dict = {}
    for a in manifest["articles"]:
        sid = (a.get("analysis") or {}).get("story_id")
        if sid:
            story_split.setdefault(sid, a["split"])
    story_ids = {a["analysis"]["story_id"] for a in articles if a["analysis"].get("story_id")}
    idx = {sid: e for sid, e in (index.get("stories") or {}).items() if sid in story_ids}
    stories = {sid: feu.read_json(analysis_dir / "stories" / f"{sid}.json")
               for sid in story_ids if (analysis_dir / "stories" / f"{sid}.json").exists()}
    first_of = {sid: min((m.get("published") or "" for m in st.get("members") or []), default="")
                for sid, st in stories.items()}
    analyses = feu.load_analyses(analysis_dir)

    drifted = 0
    no_headline = 0
    joined_total = 0
    retrieval = {"old": Counter(), "union": Counter()}
    strict_reach = {"old": 0, "union": 0}
    review_pairs: list = []
    channels_of_hit: Counter = Counter()
    copy_twins = {"groups": 0, "later_copy_reaches_twin_story": {"old": 0, "union": 0},
                  "strict_rule_accepts_twin": 0, "review_rule_accepts_twin": 0,
                  "review_relaxations_on_twins": Counter(), "twin_refused_by_both": 0}
    by_copy: dict = defaultdict(list)
    for a in articles:
        rec = analyses.get(a["url"])
        if not rec or analysis_sha256(rec) != a["analysis"]["analysis_sha256"]:
            drifted += 1
            continue
        own = a["analysis"]["story_id"]
        pub = a.get("published") or ""
        visible = {sid: e for sid, e in idx.items() if sid != own and (first_of.get(sid) or "") < pub}
        probe, incoming = probe_of(rec)
        if probe is None:
            no_headline += 1
            continue
        rankings = {"old": old_ranking({"stories": visible}, probe, max_candidates),
                    "union": aa.candidate_stories({"stories": visible}, probe, limit=max_candidates)}
        is_joined = a["analysis"]["story_action"] == "same_story" and own
        if is_joined:
            joined_total += 1
            # The host was retrieved against the population that EXCLUDES the
            # article's own story above, so re-run with it visible.
            host_visible = {sid: e for sid, e in idx.items() if (first_of.get(sid) or "") < pub}
            for name in rankings:
                ranked = (old_ranking({"stories": host_visible}, probe, max_candidates) if name == "old"
                          else aa.candidate_stories({"stories": host_visible}, probe, limit=max_candidates))
                if any(c["story_id"] == own for c in ranked):
                    retrieval[name]["host_retrieved"] += 1
                    if name == "union":
                        hit = next(c for c in ranked if c["story_id"] == own)
                        for ch in hit["channels"]:
                            channels_of_hit[ch] += 1
        for name, ranked in rankings.items():
            if any(same_event_evidence(incoming, story_view(stories[c["story_id"]])) is not None
                   for c in ranked if c["story_id"] in stories):
                strict_reach[name] += 1
        for c in rankings["union"]:
            if c["story_id"] not in stories:
                continue
            ev = same_event_evidence(incoming, story_view(stories[c["story_id"]]), mode="review")
            if ev is None:
                continue
            article_split = split_of[a["id"]]
            straddles = article_split != story_split.get(c["story_id"], article_split)
            review_pairs.append({
                "article_id": a["id"], "story_id": c["story_id"],
                "relaxations": ev["relaxations"], "channels": c["channels"],
                "split": "excluded" if straddles else article_split,
                "strict_would_join": not ev["relaxations"],
                # The shipped channel runs only for `new_story` articles; a
                # proposal over a `same_story` article is the review rule
                # second-guessing a pipeline join, reported apart.
                "story_action": a["analysis"]["story_action"],
            })
        by_copy[a["copy_group"]].append(a)
    for group, members in by_copy.items():
        sids = {m["analysis"]["story_id"] for m in members if m["analysis"].get("story_id")}
        if len(sids) < 2:
            continue
        copy_twins["groups"] += 1
        members.sort(key=lambda m: m.get("published") or "")
        later = members[-1]
        earlier_sids = {m["analysis"]["story_id"] for m in members[:-1]} - {later["analysis"]["story_id"]}
        rec = analyses.get(later["url"])
        if not rec:
            continue
        pub = later.get("published") or ""
        visible = {sid: e for sid, e in idx.items()
                   if sid != later["analysis"]["story_id"] and (first_of.get(sid) or "") < pub}
        probe, later_incoming = probe_of(rec)
        if probe is None:
            continue
        for name, ranked in (("old", old_ranking({"stories": visible}, probe, max_candidates)),
                             ("union", aa.candidate_stories({"stories": visible}, probe, limit=max_candidates))):
            if any(c["story_id"] in earlier_sids for c in ranked):
                copy_twins["later_copy_reaches_twin_story"][name] += 1
                if name != "union":
                    continue
                twins = [stories[c["story_id"]] for c in ranked
                         if c["story_id"] in earlier_sids and c["story_id"] in stories]
                strict = any(same_event_evidence(later_incoming, story_view(t)) is not None for t in twins)
                reviews = [ev for t in twins
                           if (ev := same_event_evidence(later_incoming, story_view(t), mode="review"))]
                copy_twins["strict_rule_accepts_twin"] += strict
                copy_twins["review_rule_accepts_twin"] += bool(reviews)
                copy_twins["twin_refused_by_both"] += not strict and not reviews
                for ev in reviews[:1]:
                    for r in ev["relaxations"]:
                        copy_twins["review_relaxations_on_twins"][r] += 1
    copy_twins["review_relaxations_on_twins"] = dict(sorted(copy_twins["review_relaxations_on_twins"].items()))
    considered = len(articles) - drifted - no_headline
    if considered == 0:
        raise ValueError("every record drifted since the freeze (or carries no headline) — re-freeze before evaluating")
    if joined_total == 0:
        raise ValueError("no pipeline join in the window — retrieval recall of the known host is undefined")
    proposals = {
        "pairs": len(review_pairs),
        "pairs_the_shipped_channel_would_emit": sum(1 for p in review_pairs if p["story_action"] == "new_story"),
        "by_story_action": dict(Counter(p["story_action"] for p in review_pairs)),
        "strict_would_join_pairs": sum(1 for p in review_pairs if p["strict_would_join"]),
        "by_relaxation": {r: sum(1 for p in review_pairs if r in p["relaxations"]) for r in RELAXATIONS},
        "by_split": dict(Counter(p["split"] for p in review_pairs)),
        "by_relaxation_adjudicable_test": {
            r: sum(1 for p in review_pairs if r in p["relaxations"] and p["split"] == "test") for r in RELAXATIONS},
        "articles_with_a_proposal": len({p["article_id"] for p in review_pairs}),
    }
    return {
        "version": 1,
        "basis": "pipeline consistency over the frozen universe — NOT accuracy; 0 adjudicated labels",
        "manifest": {"path": manifest.get("_path"), "sha256": manifest.get("_sha256"),
                     "window": manifest.get("window")},
        "versions": {"retrieval": RETRIEVAL_VERSION, "retrieval_old": RETRIEVAL_OLD_VERSION,
                     "review_rule": REVIEW_RULE_VERSION, "max_candidates": max_candidates},
        "population": {"publishable": len(articles), "drifted_since_freeze": drifted,
                       "no_headline": no_headline, "evaluated": considered,
                       "pipeline_joined": joined_total},
        "retrieval_of_the_known_host": {
            name: {"retrieved": retrieval[name]["host_retrieved"],
                   "share": (retrieval[name]["host_retrieved"] / joined_total) if joined_total else None}
            for name in ("old", "union")},
        "union_hit_channels": dict(sorted(channels_of_hit.items())),
        # ⚠️ BEYOND THE PIPELINE'S OWN JOINS: the article's own story is
        # excluded from its population, so this counts the ADDITIONAL joins
        # the strict rule would make with retrieval widened and the rule
        # untouched — not the 179 it already made.
        "strict_rule_reach_beyond_own_story": {
            name: {"articles_with_an_accepted_candidate": n,
                   "share": (n / considered) if considered else None}
            for name, n in strict_reach.items()},
        "review_proposals": proposals,
        "copy_twins": copy_twins,
        "adjudication": {"labelled": 0,
                         "note": "No pair here is adjudicated; the review volumes are what a reviewer would face, not a precision."},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--manifest", type=Path, default=None,
                    help="a frozen universe.json; default = the newest under news/data/analysis/_universe")
    ap.add_argument("--data-dir", type=Path, default=feu.DATA)
    ap.add_argument("--force", action="store_true", help="overwrite an existing report")
    args = ap.parse_args(argv)
    manifest_path = args.manifest
    if manifest_path is None:
        stamps = sorted(p for p in feu.FREEZE_DIR.glob("*/universe.json"))
        if not stamps:
            return aa.emit(1, error="no_frozen_universe", message="run news:universe:freeze first")
        manifest_path = stamps[-1]
    try:
        manifest = read_json(manifest_path)
    except (OSError, json.JSONDecodeError) as exc:
        return aa.emit(1, error="manifest_unreadable", message=f"{manifest_path}: {exc}")
    manifest["_path"] = str(manifest_path.relative_to(ROOT)) if manifest_path.is_relative_to(ROOT) else str(manifest_path)
    manifest["_sha256"] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    window = manifest.get("window") or {}
    report = REPORT_DIR / f"join_channels_{window.get('until')}_{manifest['_sha256'][:8]}.json"
    if report.exists() and not args.force:
        return aa.emit(1, error="report_exists", message=f"{report} exists — pass --force to overwrite")
    try:
        result = evaluate(manifest, args.data_dir)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        return aa.emit(1, error="evaluation_refused", message=str(exc))
    result["generated_at"] = aa.now_iso()
    aa.write_json_atomic(str(report), result)
    return aa.emit(0, ok=True, report=str(report), **{k: v for k, v in result.items()
                                                       if k not in ("version", "basis", "manifest")})


if __name__ == "__main__":
    sys.exit(main())
