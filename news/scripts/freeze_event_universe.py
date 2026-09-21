#!/usr/bin/env python3
"""Plan T2.0 — freeze the labelling universe BEFORE the clustering rule
changes, and recount it.

⚠️⚠️ NO NUMBER ABOUT CLUSTERING IS QUOTABLE UNTIL ITS UNIVERSE IS WRITTEN
DOWN. The plan's own „92 raw articles, ~109 stories" could not be reproduced
from any single reading (91 / ~113 / 161 vs 273 depending on which file was
searched), because a two-day raw subset and a wider analysed subset were
being compared as one population. This script fixes the population first:
every article in a window, pinned by content hash; every analysis record
pinned by its canonical hash, model, prompt hashes and taxonomy version;
the PUBLICATION GATE (`quality.verdict` + `site_relevant`, §1.3) frozen as
a per-record boolean, because a metric over all analyses and one over the
publishable subset differ by ~40% for reasons that are not clustering.

⚠️ IT LABELS NOTHING. The output is the frame a human adjudicates over —
article records, copy groups, event units, a dev/test split and the
candidate PAIRS to label — with every `label` NULL. A frontier model is a
comparison baseline, never the ground truth, and there is no adjudicated
test set until a person writes one (T2.3's gate stays unmet, and says so).

⚠️ THE SPLIT KEEPS COPIES AND KNOWN STORY MEMBERS TOGETHER — and nothing
more, which is stated rather than over-claimed. A wire story reprinted by
three outlets is one unit; the members of one story are one unit; a unit is
assigned to dev or test by the day of its EARLIEST article, so no KNOWN
same-story pair and no copy pair straddles the split. A CANDIDATE pair (an
article against a story it does not belong to) can straddle, and on a
boundary that falls on a busy day most of the test side's candidates point
at the previous day's stories — measured on the first freeze, 2,788 of
13,852 pairs, 47% of the strong cross-outlet test pairs. Every pair is
therefore stamped `straddles`, and a straddling pair is EXCLUDED from the
adjudicable test set (`adjudicable_split = "excluded"`) rather than counted
as a test answer whose other half sits in development. Unioning candidate
edges into the units would not fix it — it would collapse the graph.

⚠️ THE BASELINE IS REPRODUCED IN BOTH ARMS, WITH ITS CONDITIONS STATED.
`auto_merge_host`'s header recorded (2026-09-02) that „67% of articles had
a strong cross-outlet candidate sitting in the prefilter" while the join
stage produced 0/0/1/0/1/0 multi-outlet stories. That measurement never
wrote down what „strong" meant, and it fed `candidate_stories` the ANALYSIS
side (canonical title + summary), not the raw article. So this script runs
the SAME function twice per article — once with the analysis-side inputs
(the original's conditions) and once with the raw title + body — over the
frozen story index restricted to stories that had a member before the
article was published, and publishes both arms. §15.2's story/action table
is recounted the same way, over the frozen set.

⚠️ FAILS CLOSED, on purpose, on the shapes that would let a later gate pass
vacuously: an empty window, a window with no publishable article, an empty
named stratum (Петрохан, presidential, local, foreign, same-person PAIRS),
a missing `analysis/index.json` (a `new_story` record does not carry its
story id — only the index does), a window whose last day is still being
ingested (refused unless `--allow-open-day`, and then RECORDED), a stamp
directory that already holds a manifest, and a committed report that would
be overwritten (refused unless `--force`).

Outputs: the full manifest (gitignored, under `news/data/analysis/_universe/
<stamp>/`) and a committed summary in `news/evals/` carrying the counts, the
split, the strata, the baselines, the definitions and the manifest's sha256,
so the number and the population it was measured over travel together.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

import analyze_articles as aa  # noqa: E402
import cases as case_registry  # noqa: E402
from news.eval_contract.canonical import analysis_sha256, content_sha256  # noqa: E402

DATA = ROOT / "news" / "data"
ANALYSIS = DATA / "analysis"
FREEZE_DIR = ANALYSIS / "_universe"
REPORT_DIR = ROOT / "news" / "evals"
CASES_PATH = ROOT / "news" / "config" / "cases.json"

UNIVERSE_VERSION = 2
DEFAULT_WINDOW_DAYS = 14
DEFAULT_TEST_SHARE = 0.3
# Copies: the same text under two mastheads. Exact hash first; then a
# shingle Jaccard over the normalised body, high enough that two reports of
# one event written independently do not fold (measured on the corpus: the
# Кандев/Дарик wire ran on segabg.com and lupa.bg at 0.93; two independent
# reports of the same briefing sit under 0.5).
COPY_JACCARD = 0.8
SHINGLE = 5
MIN_SHARED_SHINGLES = 3   # the inverted-index prefilter: pairs sharing fewer cannot reach COPY_JACCARD on real text
BOILERPLATE_POSTING = 200  # a shingle in this many articles is a masthead footer, not a copy signal
# „Strong cross-outlet candidate": the definition the 2026-09-02 figure never
# wrote down, stated here so the reproduced number carries its conditions.
STRONG_MIN_SHARED_TITLE_TOKENS = 2   # score contribution 6 of the ≥3 bar
ARTICLE_STRATA = ("petrohan", "presidential", "local_news", "foreign")
FOREIGN_CATEGORY = "foreign-policy"
LOCAL_CATEGORY = "local-news"
PRESIDENTIAL_CATEGORY = "elections-presidential"
CANDIDATE_ARMS = ("analysis_side", "raw")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def article_id(domain: str, path: Path) -> str:
    return f"{domain}/{path.stem}"


def norm_words(text: str) -> list:
    # The pipeline's own tokeniser, so a copy is folded over the same
    # alphabet the clustering rule reads.
    return [t.lower() for t in aa.TOKEN_RE.findall(text or "")]


def shingles(text: str, k: int = SHINGLE) -> set:
    words = norm_words(text)
    if len(words) < k:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i:i + k]) for i in range(len(words) - k + 1)}


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


class UnionFind:
    def __init__(self):
        self.parent: dict = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # Deterministic root: the smaller key wins.
            if rb < ra:
                ra, rb = rb, ra
            self.parent[rb] = ra


# ------------------------------------------------------------- the corpus ---

def primary_topic(analysis: dict) -> tuple:
    for t in analysis.get("topics") or []:
        if isinstance(t, dict) and t.get("primary"):
            return (t.get("category"), t.get("subcategory"))
    return (None, None)


def publishable(analysis: dict | None) -> bool:
    """The publication gate, frozen as ONE boolean: `quality.verdict == ok`
    AND `site_relevant is True` (§1.3). Everything downstream of the stories
    inherits it, so a clustering metric is computed over THIS subset unless
    it says otherwise."""
    if not analysis:
        return False
    return ((analysis.get("quality") or {}).get("verdict") == "ok"
            and analysis.get("site_relevant") is True)


def load_articles(data_dir: Path, since: date, until: date) -> list:
    """Every corpus article with a `published` day inside [since, until]."""
    out = []
    for domain_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        if not aa.is_corpus_domain(domain_dir.name):
            continue
        for path in sorted(domain_dir.glob("*.json")):
            try:
                art = read_json(path)
            except (OSError, ValueError):
                continue
            if not isinstance(art, dict) or not art.get("url"):
                continue
            pub = (art.get("published") or "")[:10]
            if not pub:
                continue
            try:
                day = date.fromisoformat(pub)
            except ValueError:
                continue
            if not (since <= day <= until):
                continue
            out.append({
                "id": article_id(domain_dir.name, path),
                "article_path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
                "url": art["url"],
                "domain": art.get("domain") or domain_dir.name,
                "published": art.get("published"),
                "first_seen": art.get("first_seen"),
                "title": art.get("title") or "",
                "content_sha256": content_sha256(art.get("content") or ""),
                "content_chars": len(art.get("content") or ""),
                "_content": art.get("content") or "",
            })
    return out


def load_analyses(analysis_dir: Path) -> dict:
    """url → analysis record, every one on disk (excluded ones included)."""
    out = {}
    for path in sorted((analysis_dir / "articles").glob("*/*.json")):
        try:
            rec = read_json(path)
        except (OSError, ValueError):
            continue
        if isinstance(rec, dict) and rec.get("url"):
            out[rec["url"]] = rec
    return out


def freeze_analysis(rec: dict | None, index_entry: dict | None = None) -> dict | None:
    """⚠️ THE STORY ID LIVES IN TWO PLACES AND ONLY ONE IS COMPLETE. A
    `same_story` record carries `story.story_id`; a `new_story` record does
    NOT — the id it opened is recorded only in `index.json.articles[url]`.
    Reading the record alone leaves 2,057 of 2,353 publishable articles
    storyless and the recount reports 225 stories where there are ~2,100
    (measured on the first cut of this script)."""
    if not rec:
        return None
    story = rec.get("story") or {}
    category, subcategory = primary_topic(rec)
    story_id = story.get("story_id") or (index_entry or {}).get("story_id")
    return {
        "analysis_sha256": analysis_sha256(rec),
        "analyzed_at": rec.get("analyzed_at"),
        "model": rec.get("model"),
        "taxonomy_version": rec.get("taxonomy_version"),
        "prompt_hashes": rec.get("prompt_hashes") or {},
        "quality_verdict": (rec.get("quality") or {}).get("verdict"),
        "site_relevant": rec.get("site_relevant"),
        "publishable": publishable(rec),
        "primary_category": category,
        "primary_subcategory": subcategory,
        "story_action": story.get("action"),
        "story_id": story_id,
        "merge_by": (story.get("merge_basis") or {}).get("by"),
        # The analysis-side inputs `auto_merge_host` fed `candidate_stories`
        # — kept so the baseline can be reproduced under the ORIGINAL
        # conditions, not only the raw ones.
        "canonical_title_bg": story.get("canonical_title_bg") or "",
        "summary_bg": rec.get("summary_bg") or "",
        "people": sorted({str(p) for p in (rec.get("entities") or {}).get("people") or []
                          if isinstance(p, str)}),
    }


# ------------------------------------------------------------- the strata ---

def article_strata(analysis: dict | None, case_hits: set) -> list:
    out = []
    if "petrohan" in case_hits:
        out.append("petrohan")
    category = (analysis or {}).get("primary_category")
    if category == PRESIDENTIAL_CATEGORY:
        out.append("presidential")
    if category == LOCAL_CATEGORY:
        out.append("local_news")
    if category == FOREIGN_CATEGORY:
        out.append("foreign")
    return out


def same_person_pair(pair: dict, article_people: set) -> bool:
    """The „unrelated same-person events" stratum lives on PAIRS, where the
    question is asked: a candidate whose retrieval evidence includes a
    person the article names, with WEAK title overlap — shared participant,
    different words, i.e. exactly the pair a person-keyed join gets wrong
    and a human has to call. (An article-level flag over „named in more
    than one story" marks 44% of the window — every recurring politician —
    and cannot separate distinct developments from one event the pipeline
    split.)"""
    if pair["strong"]:
        return False
    return any(hit in article_people for hit in pair["entity_hits"])


# -------------------------------------------------------- copies and units ---

def copy_groups(articles: list) -> dict:
    """id → copy-group root. Exact content hash, then shingle Jaccard ≥
    COPY_JACCARD over the normalised body — compared only for pairs the
    inverted index says share ≥ MIN_SHARED_SHINGLES, so the sweep is
    proportional to real overlap rather than n²."""
    uf = UnionFind()
    by_hash: dict = defaultdict(list)
    for a in articles:
        uf.find(a["id"])
        by_hash[a["content_sha256"]].append(a["id"])
    for ids in by_hash.values():
        for other in ids[1:]:
            uf.union(ids[0], other)
    sh = {a["id"]: shingles(a["_content"]) for a in articles if a["content_chars"] >= 200}
    postings: dict = defaultdict(list)
    for aid in sorted(sh):
        for s in sh[aid]:
            postings[s].append(aid)
    shared: Counter = Counter()
    for ids in postings.values():
        if len(ids) < 2 or len(ids) > BOILERPLATE_POSTING:
            continue
        for i, left in enumerate(ids):
            for right in ids[i + 1:]:
                shared[(left, right)] += 1
    for (left, right), n in sorted(shared.items()):
        if n < MIN_SHARED_SHINGLES or uf.find(left) == uf.find(right):
            continue
        if jaccard(sh[left], sh[right]) >= COPY_JACCARD:
            uf.union(left, right)
    return {a["id"]: uf.find(a["id"]) for a in articles}


def event_units(articles: list, copies: dict) -> dict:
    """id → unit root: copies ∪ same-story membership. A KNOWN pair can
    never straddle the split; a candidate pair can, and is stamped."""
    uf = UnionFind()
    for a in articles:
        uf.find(a["id"])
        uf.union(a["id"], copies[a["id"]])
    by_story: dict = defaultdict(list)
    for a in articles:
        sid = (a.get("analysis") or {}).get("story_id")
        if sid:
            by_story[sid].append(a["id"])
    for ids in by_story.values():
        for other in ids[1:]:
            uf.union(ids[0], other)
    return {a["id"]: uf.find(a["id"]) for a in articles}


def split_by_time(articles: list, units: dict, test_share: float) -> tuple:
    """Assign every UNIT to dev or test by the day of its earliest article,
    with the boundary chosen so the test share over units is closest to the
    requested one. Returns (id → split, boundary_day, units_by_earliest_day)."""
    earliest: dict = {}
    for a in articles:
        day = (a.get("published") or "")[:10]
        u = units[a["id"]]
        if u not in earliest or day < earliest[u]:
            earliest[u] = day
    if not earliest:
        return {}, None, {}
    by_day = dict(sorted(Counter(earliest.values()).items()))
    best_day, best_gap = max(by_day), None
    for boundary in by_day:
        share = sum(1 for d in earliest.values() if d >= boundary) / len(earliest)
        gap = abs(share - test_share)
        if best_gap is None or gap < best_gap:
            best_day, best_gap = boundary, gap
    assignment = {a["id"]: ("test" if earliest[units[a["id"]]] >= best_day else "dev")
                  for a in articles}
    return assignment, best_day, by_day


# ------------------------------------------------------------ the baseline ---

def story_members(story_dir: Path, sid: str) -> list:
    try:
        st = read_json(story_dir / f"{sid}.json")
    except (OSError, ValueError):
        return []
    return [m for m in st.get("members") or [] if isinstance(m, dict)]


def candidate_baseline(articles: list, index: dict, story_dir: Path,
                       max_candidates: int) -> tuple:
    """Re-run `candidate_stories` for every PUBLISHABLE article, in BOTH
    input arms, against the frozen story index restricted to stories that
    had a member published BEFORE it (the population the article actually
    competed against at analysis time, approximated from the frozen state).
    `cross_outlet` is judged over the SAME members-before-article subset, not
    the story's later membership. Returns the candidate pairs (every one
    unlabelled) and the per-arm baseline."""
    story_ids = {a["analysis"]["story_id"] for a in articles
                 if a.get("analysis") and a["analysis"].get("story_id")}
    idx = {sid: e for sid, e in (index.get("stories") or {}).items() if sid in story_ids}
    members = {sid: story_members(story_dir, sid) for sid in story_ids}
    first_of = {sid: min((m.get("published") or "" for m in ms), default="") for sid, ms in members.items()}
    copy_of = {a["id"]: a["copy_group"] for a in articles}
    story_copy_groups: dict = defaultdict(set)
    by_url = {a["url"]: a for a in articles}
    for sid, ms in members.items():
        for m in ms:
            twin = by_url.get(m.get("url"))
            if twin:
                story_copy_groups[sid].add(copy_of[twin["id"]])
    own_story = Counter(a["analysis"]["story_id"] for a in articles
                        if a.get("analysis") and a["analysis"].get("story_id"))
    pairs = []
    tally = {arm: Counter() for arm in CANDIDATE_ARMS}
    considered = singleton = 0
    for a in articles:
        an = a.get("analysis")
        if not an or not an.get("publishable"):
            continue
        considered += 1
        own = an.get("story_id")
        is_singleton = own_story.get(own, 0) <= 1
        singleton += is_singleton
        pub = a.get("published") or ""
        visible = {sid: e for sid, e in idx.items() if sid != own and (first_of.get(sid) or "") < pub}
        inputs = {
            "analysis_side": {"title": an["canonical_title_bg"] or an["summary_bg"],
                              "description": an["summary_bg"], "keywords": "",
                              "content": an["summary_bg"], "published": a.get("published")},
            "raw": {"title": a["title"], "description": "", "keywords": "",
                    "content": a["_content"], "published": a.get("published")},
        }
        for arm in CANDIDATE_ARMS:
            strong_cross = strong_cross_no_twin = False
            for c in aa.candidate_stories({"stories": visible}, inputs[arm], limit=max_candidates):
                sid = c["story_id"]
                before = [m for m in members.get(sid, []) if (m.get("published") or "") < pub]
                cross = a["domain"] not in {m.get("domain") for m in before}
                strong = len(c["shared_title_tokens"]) >= STRONG_MIN_SHARED_TITLE_TOKENS
                copy_twin = copy_of[a["id"]] in story_copy_groups.get(sid, set())
                strong_cross |= strong and cross
                strong_cross_no_twin |= strong and cross and not copy_twin
                pairs.append({
                    "arm": arm, "article_id": a["id"], "story_id": sid,
                    "score": c["score"], "shared_title_tokens": c["shared_title_tokens"],
                    "entity_hits": c["entity_hits"], "strong": strong, "cross_outlet": cross,
                    "copy_twin": copy_twin, "label": None,
                })
            t = tally[arm]
            t["with_strong_cross"] += strong_cross
            t["singletons_with_strong_cross"] += strong_cross and is_singleton
            t["with_strong_cross_excluding_copy_twins"] += strong_cross_no_twin
    baseline = {"publishable_articles": considered, "singleton_articles": singleton, "arms": {}}
    for arm in CANDIDATE_ARMS:
        t = tally[arm]
        baseline["arms"][arm] = {
            "with_strong_cross_outlet_candidate": t["with_strong_cross"],
            "with_strong_cross_outlet_candidate_share": (t["with_strong_cross"] / considered) if considered else None,
            "singletons_with_strong_cross_outlet_candidate": t["singletons_with_strong_cross"],
            "with_strong_cross_outlet_candidate_excluding_copy_twins": t["with_strong_cross_excluding_copy_twins"],
        }
    baseline["prior_2026_09_02"] = {
        "share": 0.67, "arm": "analysis_side",
        "note": "auto_merge_host header; fed canonical_title_bg + summary_bg; its 'strong' was never defined - compare direction, not digits",
    }
    return pairs, baseline


def stamp_straddles(pairs: list, articles: list) -> dict:
    """A candidate pair straddles when the article and the candidate story's
    members sit in different splits. Stories are units, so a story has ONE
    split. A straddling pair is excluded from the adjudicable test set."""
    split_of = {a["id"]: a["split"] for a in articles}
    story_split: dict = {}
    for a in articles:
        sid = (a.get("analysis") or {}).get("story_id")
        if sid:
            story_split.setdefault(sid, a["split"])
    counts: Counter = Counter()
    for p in pairs:
        article_split = split_of[p["article_id"]]
        p["straddles"] = article_split != story_split.get(p["story_id"], article_split)
        p["adjudicable_split"] = "excluded" if p["straddles"] else article_split
        counts["straddling_pairs"] += p["straddles"]
        counts["straddling_strong_cross_outlet_pairs"] += p["straddles"] and p["strong"] and p["cross_outlet"]
        counts[f"adjudicable_{p['adjudicable_split']}"] += 1
    return dict(sorted(counts.items()))


# -------------------------------------------------------------- the recount ---

def recount(frozen: list, copies: dict) -> dict:
    analysed = [a for a in frozen if a.get("analysis")]
    pub = [a for a in analysed if a["analysis"]["publishable"]]
    actions = Counter(a["analysis"]["story_action"] for a in analysed)
    merge_by = Counter(a["analysis"]["merge_by"] for a in analysed
                       if a["analysis"]["story_action"] == "same_story")
    members: dict = defaultdict(list)
    for a in pub:
        if a["analysis"]["story_id"]:
            members[a["analysis"]["story_id"]].append(a)
    outlets_per_story = {sid: len({m["domain"] for m in ms}) for sid, ms in members.items()}
    stories_per_copy_group: dict = defaultdict(set)
    for a in pub:
        if a["analysis"]["story_id"]:
            stories_per_copy_group[copies[a["id"]]].add(a["analysis"]["story_id"])
    return {
        "raw_articles": len(frozen),
        "analysed": len(analysed),
        "quality_ok": sum(1 for a in analysed if a["analysis"]["quality_verdict"] == "ok"),
        "site_relevant": sum(1 for a in analysed if a["analysis"]["site_relevant"] is True),
        "publishable": len(pub),
        "story_action": dict(sorted(actions.items(), key=lambda kv: str(kv[0]))),
        "same_story_by": dict(sorted(merge_by.items(), key=lambda kv: str(kv[0]))),
        "stories": len(members),
        "singleton_stories": sum(1 for ms in members.values() if len(ms) == 1),
        "single_outlet_stories": sum(1 for n in outlets_per_story.values() if n == 1),
        "multi_outlet_stories": sum(1 for n in outlets_per_story.values() if n > 1),
        "max_story_size": max((len(ms) for ms in members.values()), default=0),
        # The same text under two mastheads filed as two stories — one
        # clustering failure the frozen set measures for free.
        "copy_groups_split_across_stories": sum(1 for s in stories_per_copy_group.values() if len(s) > 1),
    }


# --------------------------------------------------------------- the freeze ---

def build_universe(*, data_dir: Path, analysis_dir: Path, since: date, until: date,
                   test_share: float, cases_path: Path, generated_at: str,
                   max_candidates: int = aa.MAX_CANDIDATES, open_day: bool = False) -> dict:
    articles = load_articles(data_dir, since, until)
    if not articles:
        raise ValueError(f"no articles published in [{since}, {until}] — nothing to freeze")
    index_path = analysis_dir / "index.json"
    if not index_path.exists():
        raise ValueError(f"{index_path} is missing — a new_story record carries no story id; only the index does")
    index = read_json(index_path)
    index_articles = index.get("articles") or {}
    analyses = load_analyses(analysis_dir)
    matcher = case_registry.CaseMatcher(case_registry.load_cases(cases_path))
    for a in articles:
        a["analysis"] = freeze_analysis(analyses.get(a["url"]), index_articles.get(a["url"]))
        a["cases"] = sorted(matcher.match({"url": a["url"], "title": a["title"],
                                           "content": a["_content"]}))
        a["strata"] = article_strata(a["analysis"], set(a["cases"]))
    copies = copy_groups(articles)
    units = event_units(articles, copies)
    split, boundary, units_by_day = split_by_time(articles, units, test_share)
    for a in articles:
        a["copy_group"] = copies[a["id"]]
        a["unit"] = units[a["id"]]
        a["split"] = split[a["id"]]
    counts = recount(articles, copies)
    if counts["publishable"] == 0:
        raise ValueError("no publishable article in the window — an empty frame passes every gate vacuously")
    pairs, baseline = candidate_baseline(articles, index, analysis_dir / "stories", max_candidates)
    straddle = stamp_straddles(pairs, articles)
    people_of = {a["id"]: set((a.get("analysis") or {}).get("people") or []) for a in articles}
    for p in pairs:
        p["same_person"] = same_person_pair(p, people_of[p["article_id"]])
    strata = {
        "raw": {s: sum(1 for a in articles if s in a["strata"]) for s in ARTICLE_STRATA},
        "publishable": {s: sum(1 for a in articles if s in a["strata"]
                               and (a.get("analysis") or {}).get("publishable"))
                        for s in ARTICLE_STRATA},
        "pairs": {"same_person": sum(1 for p in pairs if p["same_person"]),
                  "same_person_adjudicable_test": sum(1 for p in pairs if p["same_person"]
                                                      and p["adjudicable_split"] == "test")},
    }
    empty = [s for s, n in strata["publishable"].items() if n == 0]
    if strata["pairs"]["same_person"] == 0:
        empty.append("same_person (pairs)")
    if empty:
        raise ValueError(f"the plan's named strata are empty in this window: {empty} — widen the window rather than freeze a frame that cannot test them")
    for a in articles:
        del a["_content"]
    n_units = len({a["unit"] for a in articles})
    test_units = len({a["unit"] for a in articles if a["split"] == "test"})
    return {
        "version": UNIVERSE_VERSION,
        "generated_at": generated_at,
        "window": {"since": since.isoformat(), "until": until.isoformat(), "open_day": open_day},
        "gate": "quality.verdict == 'ok' AND site_relevant is True (§1.3)",
        "definitions": {
            "copy": f"same content_sha256, or shingle({SHINGLE}) Jaccard >= {COPY_JACCARD} over the pipeline-tokenised body",
            "unit": "copies ∪ same-story membership; assigned whole to one split by its earliest article's day — so no KNOWN same-story pair or copy straddles; a CANDIDATE pair can, is stamped `straddles`, and is then excluded from the adjudicable test set",
            "split": f"test = units whose earliest day >= boundary, boundary chosen so the unit test share is closest to {test_share}",
            "strong_candidate": f">= {STRONG_MIN_SHARED_TITLE_TOKENS} shared title tokens with the candidate story",
            "cross_outlet": "the article's domain is not among the candidate story's members published BEFORE the article",
            "candidate_population": "candidate_stories() over the frozen index restricted to stories with a member published before the article, excluding its own story",
            "candidate_arms": {"analysis_side": "canonical_title_bg + summary_bg (auto_merge_host's inputs, the 2026-09-02 conditions)",
                               "raw": "raw article title + full body"},
            "strata_basis": "article strata counted over the raw window AND the publishable subset; same_person is a PAIR stratum (weak title overlap, a person the article names among the entity hits)",
            "labels": "NULL throughout — this is the frame, not the adjudication",
        },
        "counts": counts,
        "split": {
            "boundary_day": boundary,
            "requested_unit_test_share": test_share,
            "unit_test_share": (test_units / n_units) if n_units else None,
            "units": {"dev": n_units - test_units, "test": test_units},
            "units_by_earliest_day": units_by_day,
            "articles": dict(Counter(a["split"] for a in articles)),
            "copy_groups_multi": sum(1 for n in Counter(copies.values()).values() if n > 1),
            **straddle,
        },
        "strata": strata,
        "baseline": baseline,
        "adjudication": {
            "candidate_pairs": len(pairs),
            "candidate_pairs_by_arm": dict(Counter(p["arm"] for p in pairs)),
            "adjudicable_test_pairs": straddle.get("adjudicable_test", 0),
            "known_same_story_multi_member_stories": sum(1 for n in Counter(
                a["analysis"]["story_id"] for a in articles
                if a.get("analysis") and a["analysis"]["publishable"] and a["analysis"]["story_id"]).values() if n > 1),
            "labelled": 0,
            "note": "No adjudicated pair exists. T2.3's gate (>=300 accepted test pairs over >=50 events) is UNMET and cannot be met from this file alone.",
        },
        "articles": articles,
        "candidate_pairs": pairs,
    }


def write_freeze(universe: dict, stamp: str, freeze_dir: Path = FREEZE_DIR) -> tuple:
    out_dir = freeze_dir / stamp
    path = out_dir / "universe.json"
    if path.exists():
        raise ValueError(f"stamp already frozen: {path} — a frozen universe is never overwritten; pick a new --stamp")
    out_dir.mkdir(parents=True, exist_ok=True)
    aa.write_json_atomic(str(path), universe)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return path, digest


def summary_of(universe: dict, manifest_path: Path, digest: str) -> dict:
    return {k: v for k, v in universe.items() if k not in ("articles", "candidate_pairs")} | {
        "manifest": {"path": str(manifest_path.relative_to(ROOT)) if manifest_path.is_relative_to(ROOT) else str(manifest_path),
                     "sha256": digest,
                     "articles": len(universe["articles"]),
                     "candidate_pairs": len(universe["candidate_pairs"])},
    }


def report_path(until: date, days: int, report_dir: Path = REPORT_DIR) -> Path:
    return report_dir / f"event_universe_{until.isoformat()}_{days}d.json"


def main(argv=None, *, now: datetime | None = None, freeze_dir: Path = FREEZE_DIR,
         report_dir: Path = REPORT_DIR, cases_path: Path = CASES_PATH) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        epilog="Writes the gitignored manifest news/data/analysis/_universe/<stamp>/universe.json "
               "and the COMMITTED summary news/evals/event_universe_<until>_<days>d.json.")
    ap.add_argument("--data-dir", type=Path, default=DATA)
    ap.add_argument("--until", type=date.fromisoformat, default=None,
                    help="last published day (inclusive); default = yesterday UTC. Today is refused "
                         "unless --allow-open-day, because the day is still being ingested")
    ap.add_argument("--days", type=int, default=DEFAULT_WINDOW_DAYS)
    ap.add_argument("--test-share", type=float, default=DEFAULT_TEST_SHARE)
    ap.add_argument("--stamp", default=None,
                    help="manifest directory name; refused if it already holds a manifest")
    ap.add_argument("--allow-open-day", action="store_true",
                    help="freeze a window whose last day is not over; recorded as window.open_day")
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing committed summary for the same window")
    args = ap.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    until = args.until or (now.date() - timedelta(days=1))
    since = until - timedelta(days=args.days - 1)
    open_day = until >= now.date()
    if open_day and not args.allow_open_day:
        return aa.emit(1, error="universe_refused",
                       message=f"window ends {until}, which is not over (now {now.date()} UTC) — pass --allow-open-day to freeze it anyway")
    report = report_path(until, args.days, report_dir)
    if report.exists() and not args.force:
        return aa.emit(1, error="universe_refused",
                       message=f"{report} exists and its figures may already be quoted — pass --force to overwrite")
    generated_at = aa.now_iso()
    stamp = args.stamp or generated_at[:19].replace(":", "").replace("-", "")
    try:
        universe = build_universe(
            data_dir=args.data_dir, analysis_dir=args.data_dir / "analysis",
            since=since, until=until, test_share=args.test_share,
            cases_path=cases_path, generated_at=generated_at, open_day=open_day)
        path, digest = write_freeze(universe, stamp, freeze_dir)
    except ValueError as exc:
        return aa.emit(1, error="universe_refused", message=str(exc))
    summary = summary_of(universe, path, digest)
    aa.write_json_atomic(str(report), summary)
    return aa.emit(0, ok=True, manifest=str(path), report=str(report),
                   counts=summary["counts"], strata=summary["strata"],
                   baseline=summary["baseline"], split=summary["split"])


if __name__ == "__main__":
    sys.exit(main())
