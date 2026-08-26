#!/usr/bin/env python3
"""analyze_articles.py — the deterministic half of the analyze-news-article skill.

The qualitative half is the LLM following .zcode/skills/analyze-news-article:
it reads a corpus article and writes an analysis record. This script does
everything deterministic around that:

  queue        --next <domain|all> [--limit N]
                    Corpus articles not yet analyzed, newest first per
                    domain, domains in alphabetical order until the limit
                    is filled. Short records (content_chars < 400) are
                    flagged suspect_too_short for the quality gate.
  work item    --candidates <article-path>
                    The article's core fields plus the top candidate stories
                    (prefilter: title-token overlap, case-insensitive entity
                    mentions over title+description+keywords+content with
                    word boundaries, weighted by entity type and capped,
                    date proximity) for the LLM's same_story/new_story
                    decision. Empty candidate list on the first run — that
                    is normal.
  save         --save-analysis <file.json|->     (one analysis object)
               --save-batch <file.json|->        (an array of them)
                    Validates the record against the schema AND the taxonomy
                    in news/topics.json, writes
                    news/data/analysis/articles/<domain>/<same-filename>.json,
                    creates or attaches the story, recomputes story
                    aggregates, updates news/data/analysis/index.json.
                    The index is flushed after EVERY record, so an aborted
                    batch leaves at most the last record unindexed; a
                    re-analysis that moves an article to another story
                    detaches it from the old one (an emptied story is
                    deleted, and surviving stories drop references to it).
                    In a batch, one bad record does not sink the rest.
  stats        --stats
                    Coverage (analyzed vs corpus per domain), leaning and
                    russia-stance distributions, story sizes.
  recovery     --rebuild
                    The analysis records on disk are the source of truth:
                    the mode scans news/data/analysis/articles/ and the
                    story files themselves, regenerating the index and all
                    aggregates. It recovers from a lost or corrupt index
                    and deletes story files nothing points to anymore.

Storage layout (all under news/data/, which is deliberately untracked):

  news/data/analysis/articles/<domain>/<corpus-filename>.json   one per article
  news/data/analysis/stories/<story-id>.json                    one per story
  news/data/analysis/index.json                                 lookup only

Story ids are <YYYYMMDD|nodate>-<8 hex of md5(date|canonical_title_bg|url)>,
with a -2, -3… suffix on the rare collision.

Stdout is exactly ONE JSON object on every path, including errors; exit codes
carry the semantics (same convention as fetch_latest_articles.py):

  0  success, or "nothing to do" (empty queue, no candidates, ...)
  2  the named article/domain does not exist in the corpus
  3  schema/taxonomy validation failed, or bad CLI usage (details inside
     the JSON object — argparse failures are captured too)
  4  internal/IO error, malformed index/story file (run --rebuild),
     or interrupted

One writer at a time: like the corpus saver, concurrent invocations appending
to the same index will corrupt it — run sequentially. DATA_BG_ROOT overrides
the repository root (used by the test suite).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

REPO_ROOT = os.environ.get("DATA_BG_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(REPO_ROOT, "news", "data")
ANALYSIS_DIR = os.path.join(DATA_DIR, "analysis")
ARTICLES_DIR = os.path.join(ANALYSIS_DIR, "articles")
STORIES_DIR = os.path.join(ANALYSIS_DIR, "stories")
INDEX_PATH = os.path.join(ANALYSIS_DIR, "index.json")
TOPICS_PATH = os.path.join(REPO_ROOT, "news", "topics.json")

QUALITY_VERDICTS = {"ok", "paywall_shell", "client_render_shell", "too_short", "not_bulgarian", "non_article"}
QUALITY_KEYS = {"verdict", "notes"}
LEANING_LABELS = {"strong_conservative", "conservative", "neutral", "progressive", "strong_progressive", "not_applicable"}
RUSSIA_LABELS = {"strong_pro_russia", "pro_russia", "neutral", "anti_russia", "strong_anti_russia", "not_applicable"}
AI_VERDICTS = {"likely_human", "unclear", "likely_ai"}
TONE_LABELS = {"favorable", "unfavorable", "neutral", "mixed"}
STORY_ACTIONS = {"new_story", "same_story", "none"}
ENTITY_BUCKETS = ("people", "parties", "institutions", "companies", "places")

# ─── mentions ────────────────────────────────────────────────────────────────
#
# ⚠️⚠️ `mentions` IS A SIBLING OF `entities`, NEVER A REPLACEMENT FOR IT, AND
# NEVER A SIXTH BUCKET INSIDE IT. Merging them breaks two things at once:
#
#   1. `validate_analysis` requires every `entities.<bucket>` value to be a
#      non-empty STRING and rejects any key outside ENTITY_BUCKETS. Objects
#      under `entities`, or a bucket named "mentions", fails EVERY record in
#      the corpus on re-validation.
#   2. `entities` is load-bearing for story CLUSTERING, not for display.
#      `candidate_stories()` iterates `entry["entities"][k]` and calls
#      `name.lower()` and `entity_in_text(name, haystack)`. A dict there
#      raises AttributeError and the clustering that produces every story
#      stops working.
#
# A later step may DERIVE `entities` from `mentions` for the scorer — but only
# by projecting the surface strings back out, never by changing what the
# scorer reads. The same warning is repeated at the `entities` validator.
#
# `kind` is SINGULAR and is not ENTITY_BUCKETS: a mention is one thing, and
# reusing the plural bucket names would invite a `mentions` → `entities`
# merge by making the two look interchangeable.
MENTION_KINDS = ("person", "party", "institution", "company", "place")

# How the mention came to carry (or not carry) an id.
#
# ⚠️⚠️ THERE IS DELIBERATELY NO VALUE MEANING "RESOLVED BY PICKING THE
# HIGHEST-RANKED CANDIDATE", and one must never be added. Measured over the
# corpus: 17 names tested against the identity layer matched ZERO exactly, and
# every one matched ambiguously when folded to first+last — Пеевски 2
# candidates, Борисов 7, Радев 15, Цветан Василев 21. Corpus-wide 19.2% of
# first+last keys are shared. Rank-picking is right for Пеевски and wrong for
# Цветан Василев, and the two are INDISTINGUISHABLE in the output — which is
# exactly the `aop_expert` rule one dataset over: refuse rather than grade.
#
#   gazetteer_exact    a hand-verified roster entry matched a surface form
#   coref_resolved     a short form resolved to a LONGER FORM IN THE SAME
#                      DOCUMENT („Пеевски" in ¶4 after „Делян Пеевски" in ¶1).
#                      ⚠️ Within the document only — never against the roster,
#                      which is the rank-picking above wearing a different hat.
#   ambiguous_refused  matched more than one roster entry. KEPT and COUNTED,
#                      so "we found no link" is never read as "nobody was
#                      mentioned".
#   not_in_gazetteer   NO IDENTITY COULD BE ESTABLISHED. Two shapes reach it
#                      and both are honest: the surface is unknown to the
#                      roster (the queue for roster review), or exactly one
#                      entry claims it and that entry refuses to resolve —
#                      „Александър Александров" is on the roster and shares
#                      his full name with 10 other public figures we cannot
#                      enumerate. `ambiguous_refused` is reserved for the case
#                      where the candidates can actually be NAMED, since
#                      „ambiguous" is a claim about a set and the set is the
#                      evidence..
MENTION_BASES = ("gazetteer_exact", "coref_resolved",
                 "ambiguous_refused", "not_in_gazetteer")

# Only the first two may carry an id; the last two must not. Enforced by the
# validator, because a refused mention that shipped an id would be a named
# individual linked to a person page on the strength of a shared surname.
MENTION_BASES_WITH_ID = frozenset({"gazetteer_exact", "coref_resolved"})

# What the entity is DOING in the story, which is what decides whether a link
# is worth rendering. „subject" is what the piece is about; „source" is quoted
# or cited; „mention" is passing. A passing mention of Борисов in a paragraph
# about something else is not a reason to put the article on his page.
MENTION_ROLES = ("subject", "source", "mention")

MENTION_KEYS = frozenset({"kind", "surface", "basis", "id", "role", "candidates"})

STOPWORDS = set(
    """на за от с без до из по и или че със в към при след преди над под обаче също само още все
    тези този тази това онзи онази както който която които ако когато защото може има няма беше ще
    са е да не как какво кой каква защо новина новини видео фото статия прочети още тук пълния
    най повече между срещу някои всички толкова днес вчера съобщи заяви каза обяви предупреди
    посочи коментира призова отбеляза допълни разказа
    the a an of in on for to and with after before over new says said from at by is are was were
    bta""".split()
)

MIN_CONTENT_CHARS = 400  # below this, --next marks suspect_too_short
MAX_CANDIDATES = 6
MIN_CANDIDATE_SCORE = 3  # date proximity alone (max 2) never surfaces a candidate
ENTITY_CAP = 50  # per bucket when merging into a story
INDEX_ENTITY_PREVIEW = 20  # index entries stay small; story files keep ENTITY_CAP

# Entity-channel weights: a person/party name is strong same-event evidence;
# an institution/company mention is weaker; a place is weakest. Without this,
# one generic place ("Япония") + a same-day date cleared the bar and surfaced
# topically unrelated stories (measured on the pilot index).
ENTITY_BUCKET_WEIGHTS = {"people": 2, "parties": 2, "institutions": 1, "companies": 1, "places": 1}
ENTITY_CONTRIBUTION_CAP = 3  # max weighted points, so entity mentions alone can't crowd the top-6
# Names too generic to mean "same event" at all — skipped by the entity
# channel (title tokens still carry topical similarity). Compared lowercased.
GENERIC_ENTITY_NAMES = {
    "сащ", "русия", "българия", "европа", "европейски съюз", "ес", "украйна",
    "народно събрание", "софия", "бта", "дпа", "тасс", "рейтерс", "франс прес",
    "германия", "италия", "франция", "великобритания", "гърция", "румъния",
    "сърбия", "турция", "полша", "унгария", "северна македония", "молдова",
    "китай", "япония", "израел", "иран",
    "рим", "париж", "лондон", "берлин", "брюксел", "вашингтон", "москва", "киев",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit(code: int, **payload) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return code


def write_json_atomic(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def load_json_if_exists(path: str):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def parse_iso(value):
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------- taxonomy ---

def load_taxonomy():
    """Load news/topics.json and enforce its own contract (unique ids, labels,
    keywords, integer version). This doubles as the taxonomy validator: a bad
    taxonomy file fails every save, loudly."""
    with open(TOPICS_PATH, encoding="utf-8") as fh:
        tax = json.load(fh)
    problems = []
    version = tax.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        problems.append("taxonomy: version must be an integer")
    cats = {}
    subcats = set()
    for cat in tax.get("categories", []):
        cid = cat.get("id")
        if not isinstance(cid, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", cid):
            problems.append(f"bad category id: {cid!r}")
            continue
        if cid in cats:
            problems.append(f"duplicate category id: {cid}")
        for lang in ("bg", "en"):
            if not str(cat.get("label", {}).get(lang, "")).strip():
                problems.append(f"category {cid}: empty {lang} label")
        if not cat.get("keywords"):
            problems.append(f"category {cid}: no keywords")
        subs = {}
        for sub in cat.get("subcategories", []):
            sid = sub.get("id")
            if not isinstance(sid, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", sid):
                problems.append(f"category {cid}: bad subcategory id: {sid!r}")
                continue
            if sid in subcats:
                problems.append(f"subcategory id used twice: {sid}")
            subcats.add(sid)
            if not str(sub.get("label", {}).get("bg", "")).strip() or not str(sub.get("label", {}).get("en", "")).strip():
                problems.append(f"{cid}/{sid}: empty label")
            if not sub.get("keywords"):
                problems.append(f"{cid}/{sid}: no keywords")
            subs[sid] = sub
        cats[cid] = {**cat, "subcategories_map": subs}
    if problems:
        raise ValueError("taxonomy problems: " + "; ".join(problems))
    return tax, cats


# ------------------------------------------------------------------ corpus ---

# Where an outlet with no registry row sorts. High rather than low, so an
# unranked domain is judged AFTER the ranked ones on a tie rather than
# displacing the national broadcasters.
DEFAULT_OUTLET_RANK = 999


def queue_sort_key(rec, today=None):
    """(tier, day, basis) — where this record sits in the newest-first queue.

    TWO tiers, not three, and that is the whole point:

      1  orderable — by its publication day when it has one ("published"),
                     otherwise by the day WE fetched it ("fetched_at")
      0  a FUTURE publication day — its date tells us nothing

    ⚠️ Undated records INTERLEAVE with dated ones; they do not form a lower
    tier. 563 of 4,346 records carry no publish date and EIGHT outlets are
    100% undated — including offnews.bg at registry rank 16. Sorting them
    below every dated record put their first position at 3,423 of 3,981, so
    under any nightly budget they would never be analysed: exactly the
    starvation this ordering was written to cure, reproduced on a different
    axis and hitting eight outlets instead of one.

    `fetched_at` is when WE saw the article, not when it was published. For a
    source swept nightly the two are within a day, which is what makes it a
    usable proxy; for a backfill it is not, and a re-fetched 2007 article
    would sort as today's news. That is the accepted cost, and it is
    REPORTED — every queue item carries `order_basis`, so a reader can see
    which of the two a position rests on.

    Tier 0 is last because a future publication day would otherwise lead a
    newest-first queue for as long as it stayed in the future and be
    re-offered every night ahead of real news. The corpus holds three
    (capital.bg conference listings dated to 2026-10-13) from before the saver
    began refusing them.

    Days are UTC, matching the stored `published`, which is always +00:00."""
    today = today or now_iso()[:10]
    day = day_prefix(rec.get("published"))
    if day:
        if day > today:
            return (0, "", "future_published")
        return (1, day, "published")
    return (1, day_prefix(rec.get("fetched_at")) or "", "fetched_at")


def day_prefix(value):
    """The YYYY-MM-DD of an ISO timestamp, or "" when there is not one.

    Shape only — it says nothing about whether the day is usable, which is
    queue_sort_key's job. Written three times with three different answers
    before this existed."""
    if not isinstance(value, str) or len(value) < 10:
        return ""
    day = value[:10]
    if not (day[:4].isdigit() and day[4:5] == "-" and day[5:7].isdigit()
            and day[7:8] == "-" and day[8:10].isdigit()):
        return ""
    return day


_RANK_CACHE = None


def outlet_ranks():
    """domain -> rank from the site registry, for the queue's tiebreak.

    Cached for the process. A missing or unparseable registry yields an empty
    map, which makes every outlet equally ranked — the queue then orders
    purely by publish date, which is still the right primary key."""
    global _RANK_CACHE
    if _RANK_CACHE is not None:
        return _RANK_CACHE
    ranks = {}
    path = os.path.join(DATA_DIR, "bg_news_sites.csv")
    try:
        with open(path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            # Matched by PREFIX like every other registry column: the vintaged
            # ones are renamed on refresh, and a bare "rank" hard-codes an
            # assumption the rest of this pipeline does not make.
            col = next((h for h in (reader.fieldnames or [])
                        if h == "rank" or h.startswith("rank_")), None)
            if col:
                for row in reader:
                    domain = row.get("domain")
                    raw = (row.get(col) or "").strip()
                    if not domain or not raw:
                        continue
                    # ASCII digits only: str.isdigit() is True for "²", which
                    # int() then rejects with an uncaught ValueError.
                    digits = "".join(ch for ch in raw if ch in "0123456789")
                    if digits:
                        ranks[domain] = int(digits)
    except (OSError, csv.Error):
        pass
    _RANK_CACHE = ranks   # cached even when empty, so a missing registry is
    return _RANK_CACHE    # not re-read once per call


def corpus_domains():
    """Domain directories under news/data — everything except the analysis
    tree, browser scratch, hidden dirs and plain files."""
    out = []
    for name in sorted(os.listdir(DATA_DIR)):
        full = os.path.join(DATA_DIR, name)
        if name in ("analysis",) or name.startswith("_") or name.startswith(".") or not os.path.isdir(full):
            continue
        out.append(name)
    return out


def corpus_files(domain: str):
    d = os.path.join(DATA_DIR, domain)
    if not os.path.isdir(d):
        return None
    return sorted(f for f in os.listdir(d) if f.endswith(".json"))


def rel_corpus_path(domain: str, fname: str) -> str:
    return os.path.relpath(os.path.join(DATA_DIR, domain, fname), REPO_ROOT)


def load_corpus_article(path: str):
    """Accept repo-relative, absolute, or news/data-relative paths; return
    (rel_path, record) or raise FileNotFoundError."""
    cand = path if os.path.isabs(path) else os.path.join(REPO_ROOT, path)
    cand = os.path.normpath(cand)
    if not os.path.isfile(cand):
        cand2 = os.path.join(DATA_DIR, path)
        if os.path.isfile(cand2):
            cand = os.path.normpath(cand2)
        else:
            raise FileNotFoundError(path)
    with open(cand, encoding="utf-8") as fh:
        rec = json.load(fh)
    return os.path.relpath(cand, REPO_ROOT), rec


def analysis_path_for(rel_corpus: str) -> str:
    rel = os.path.relpath(rel_corpus, "news/data")
    return os.path.join(ANALYSIS_DIR, "articles", rel)


# ------------------------------------------------------------------- index ---

def load_index():
    index = load_json_if_exists(INDEX_PATH)
    if index is None:
        return {"version": 1, "updated_at": now_iso(), "stories": {}, "articles": {}}
    shape_problems(index)
    return index


def shape_problems(index) -> None:
    if not isinstance(index, dict):
        raise ValueError("index.json is not a JSON object — run --rebuild")
    for key in ("stories", "articles"):
        section = index.get(key)
        if not isinstance(section, dict) or not all(isinstance(v, dict) for v in section.values()):
            raise ValueError(f"index.json '{key}' section is malformed — run --rebuild")


def load_story(story_id: str):
    st = load_json_if_exists(os.path.join(STORIES_DIR, story_id + ".json"))
    if st is not None and (not isinstance(st, dict) or not isinstance(st.get("members", []), list)
                           or not all(isinstance(m, dict) and isinstance(m.get("url"), str) for m in st["members"])):
        raise ValueError(f"story file {story_id}.json is malformed — run --rebuild")
    return st


def story_relpath(story_id: str) -> str:
    return os.path.relpath(os.path.join(STORIES_DIR, story_id + ".json"), REPO_ROOT)


def save_story(story: dict) -> None:
    write_json_atomic(os.path.join(STORIES_DIR, story["id"] + ".json"), story)


def delete_story(story_id: str) -> None:
    p = os.path.join(STORIES_DIR, story_id + ".json")
    if os.path.isfile(p):
        os.remove(p)


def prune_related_ids(deleted_id: str, index: dict) -> None:
    """Drop references to a deleted story from every surviving story."""
    for sid in list(index.get("stories", {})):
        if sid == deleted_id:
            continue
        st = load_story(sid)
        if st and deleted_id in st.get("related_story_ids", []):
            st["related_story_ids"] = [r for r in st["related_story_ids"] if r != deleted_id]
            save_story(st)


def index_story_entry(story: dict) -> dict:
    return {
        "title_bg": story["canonical_title_bg"],
        "title_en": story["canonical_title_en"],
        "first_published": story.get("first_published"),
        "last_published": story.get("last_published"),
        "member_count": len(story.get("members", [])),
        "topics": story.get("topics", []),
        "entities": {k: v[:INDEX_ENTITY_PREVIEW] for k, v in story.get("entities", {}).items()},
        "path": story_relpath(story["id"]),
    }


def date_sort_key(iso: str):
    return parse_iso(iso) or iso


def recompute_story(story: dict, analyses: dict) -> dict:
    """Recompute date range, merged entities and aggregates from member
    analyses (keyed by url). Members whose analysis vanished are dropped."""
    members = []
    for m in story.get("members", []):
        a = analyses.get(m["url"])
        if a is None:
            continue
        members.append(member_from(m, a))
    story["members"] = members
    pubs = [m["published"] for m in members if m.get("published")]
    story["first_published"] = min(pubs, key=date_sort_key) if pubs else None
    story["last_published"] = max(pubs, key=date_sort_key) if pubs else None
    entities = {k: [] for k in ENTITY_BUCKETS}
    for m in members:
        a = analyses[m["url"]]
        for k in ENTITY_BUCKETS:
            if len(entities[k]) >= ENTITY_CAP:
                break
            for name in a.get("entities", {}).get(k, []):
                if len(entities[k]) >= ENTITY_CAP:
                    break
                if name not in entities[k]:
                    entities[k].append(name)
    story["entities"] = entities
    by_leaning, by_russia, by_domain = {}, {}, {}
    for m in members:
        by_leaning[m["leaning"]] = by_leaning.get(m["leaning"], 0) + 1
        by_russia[m["russia_stance"]] = by_russia.get(m["russia_stance"], 0) + 1
        by_domain[m["domain"]] = by_domain.get(m["domain"], 0) + 1
    story["aggregates"] = {
        "article_count": len(members),
        "outlet_count": len(by_domain),
        "by_leaning": by_leaning,
        "by_russia_stance": by_russia,
        "by_domain": by_domain,
    }
    story["updated_at"] = now_iso()
    return story


def member_from(existing: dict, analysis: dict) -> dict:
    return {
        "domain": analysis["domain"],
        "article_path": analysis["article_path"],
        "url": analysis["url"],
        "published": analysis.get("published"),
        "leaning": analysis["leaning"]["label"],
        "russia_stance": analysis["russia_stance"]["label"],
        "added_at": existing.get("added_at", now_iso()),
    }


# --------------------------------------------------------------- story ids ---

def make_story_id(published: str | None, title_bg: str, url: str) -> str:
    date = (published or "")[:10].replace("-", "") or "nodate"
    digest = hashlib.md5(f"{date}|{title_bg}|{url}".encode("utf-8")).hexdigest()[:8]
    return f"{date}-{digest}"


def unique_story_id(base: str) -> str:
    sid, n = base, 1
    while load_story(sid) is not None:
        n += 1
        sid = f"{base}-{n}"
    return sid


# ------------------------------------------------------------- tokenizing ---

TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+", re.UNICODE)


def tokens(text: str) -> set:
    return {t.lower() for t in TOKEN_RE.findall(text or "") if len(t) >= 3 and t.lower() not in STOPWORDS}


def entity_in_text(name: str, haystack: str) -> bool:
    """Case-insensitive whole-word match so 'ДАНС' hits 'данс' but 'Иван'
    still misses 'Иванов'. Lowers its own haystack — callers pass raw text."""
    hay = haystack.lower()
    nl = name.lower()
    return nl in hay and re.search(
        r"(?<![0-9А-Яа-яЁёA-Za-z])" + re.escape(nl) + r"(?![0-9А-Яа-яЁёA-Za-z])",
        hay) is not None


def candidate_stories(index: dict, article: dict, limit: int = MAX_CANDIDATES):
    art_tokens = tokens(" ".join([
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
    pub = parse_iso((article.get("published") or "")[:10]) if article.get("published") else None
    scored = []
    for sid, entry in index.get("stories", {}).items():
        st_tokens = tokens((entry.get("title_bg") or "") + " " + (entry.get("title_en") or ""))
        shared = sorted(art_tokens & st_tokens)
        ent_hits = []
        ent_points = 0
        for k, weight in ENTITY_BUCKET_WEIGHTS.items():
            for name in entry.get("entities", {}).get(k, []):
                if name.lower() in GENERIC_ENTITY_NAMES:
                    continue
                if entity_in_text(name, art_haystack):
                    ent_hits.append(name)
                    ent_points += weight
        ent_points = min(ent_points, ENTITY_CONTRIBUTION_CAP)
        date_score = 0
        if pub is not None:
            first = parse_iso((entry.get("first_published") or "")[:10])
            last = parse_iso((entry.get("last_published") or "")[:10])
            if first is not None and last is not None:
                if first <= pub <= last:
                    date_score = 2
                elif min(abs((pub - first).days), abs((pub - last).days)) <= 7:
                    date_score = 1
        score = 3 * len(shared) + ent_points + date_score
        if score >= MIN_CANDIDATE_SCORE:
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

def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_mentions(mentions) -> list:
    """Validate the `mentions` sibling block.

    ⚠️ SEPARATE from the `entities` validator on purpose — see the
    MENTION_KINDS block. `entities` is a dict of string lists that story
    clustering iterates; this is a list of objects that the UI links from.
    One validator covering both would be the merge those comments forbid.

    The rule that matters is the last one: a mention whose basis is a REFUSAL
    may not carry an id. That is the whole `aop_expert` discipline in one
    assertion — the failure it prevents is naming a specific individual as the
    subject of a story on the strength of a shared surname, which no later
    gate can catch because a wrong link is shape-identical to a right one.
    """
    errs = []
    if not isinstance(mentions, list):
        return ["mentions: must be a list (omit the key entirely if none)"]
    for i, m in enumerate(mentions):
        at = f"mentions[{i}]"
        if not isinstance(m, dict):
            errs.append(f"{at}: must be an object")
            continue
        unknown = sorted(set(m) - MENTION_KEYS)
        if unknown:
            errs.append(f"{at}: unknown keys {unknown} (use {sorted(MENTION_KEYS)})")
        if m.get("kind") not in MENTION_KINDS:
            errs.append(f"{at}.kind must be one of {sorted(MENTION_KINDS)}")
        surface = m.get("surface")
        if not isinstance(surface, str) or not surface.strip():
            errs.append(f"{at}.surface: must be the non-empty string AS WRITTEN "
                        "in the article")
        basis = m.get("basis")
        if basis not in MENTION_BASES:
            errs.append(f"{at}.basis must be one of {sorted(MENTION_BASES)}")
        if m.get("role") not in MENTION_ROLES:
            errs.append(f"{at}.role must be one of {sorted(MENTION_ROLES)}")
        ident = m.get("id")
        # ⚠️ Two INDEPENDENT questions, deliberately not chained. As one
        # if/elif the shape check short-circuits the refusal check, so a
        # `not_in_gazetteer` mention carrying id=123 was reported only as a
        # malformed id — the record is still rejected, but the message never
        # names the rule this module exists for, and a regression in the
        # refusal branch would be invisible whenever the id was also junk.
        if ident is not None and (not isinstance(ident, str) or not ident.strip()):
            errs.append(f"{at}.id: must be a non-empty string or null")
        # ⚠️ The DEFAULT DIRECTION is a refusal: a basis added to
        # MENTION_BASES but not to MENTION_BASES_WITH_ID may not carry an id.
        # Written the other way round, a new basis would silently be allowed
        # to name an individual.
        if basis in MENTION_BASES_WITH_ID and not ident:
            errs.append(f"{at}.id: required when basis is {basis!r} — a "
                        "resolution with nothing to link to is not a resolution")
        elif basis in MENTION_BASES and basis not in MENTION_BASES_WITH_ID and ident:
            # ⚠️ THE assertion this validator exists for.
            errs.append(f"{at}.id: must be null when basis is {basis!r} — "
                        "a refused match may not name an individual")
        cands = m.get("candidates")
        if cands is not None and (not isinstance(cands, list) or not all(
                isinstance(c, str) and c.strip() for c in cands)):
            errs.append(f"{at}.candidates: must be a list of non-empty strings")
        elif basis == "ambiguous_refused" and len(cands or ()) < 2:
            # ⚠️ REQUIRED on this basis, not merely validated when present.
            # Gated on `is not None`, omitting the key passed while `[]` and
            # `["one"]` were both rejected — so the rule was bypassable by
            # leaving it out, which is what a generator does by default.
            # „ambiguous" is a claim about a set, and the set is the evidence.
            errs.append(f"{at}.candidates: {basis!r} requires at least two — "
                        "one candidate is not an ambiguity, and none is not "
                        "evidence of one")
    return errs


def validate_analysis(a: dict, tax, cats: dict, index: dict) -> list:
    errs = []
    if not isinstance(a, dict):
        return ["analysis is not a JSON object"]

    def check_str(key: str, where: str = ""):
        val = a.get(key)
        if not isinstance(val, str) or not val.strip():
            errs.append(f"{where}{key}: must be a non-empty string")

    if not is_num(a.get("taxonomy_version")) or a["taxonomy_version"] != tax.get("version"):
        errs.append(f"taxonomy_version must be {tax.get('version')} (current news/topics.json)")
    for k in ("article_path", "url", "domain", "model", "summary_bg", "summary_en"):
        check_str(k)
    analyzed_at = a.get("analyzed_at")
    if not isinstance(analyzed_at, str) or parse_iso(analyzed_at) is None:
        errs.append("analyzed_at: must be an ISO 8601 timestamp")
    if errs:
        return errs  # cannot continue validating without the basics

    try:
        rel, rec = load_corpus_article(a["article_path"])
    except FileNotFoundError:
        return [f"article_path not in corpus: {a['article_path']}"]
    if rec.get("url") != a["url"]:
        errs.append(f"url mismatch: analysis says {a['url']!r}, corpus says {rec.get('url')!r}")
    if rec.get("domain") != a["domain"]:
        errs.append(f"domain mismatch: analysis says {a['domain']!r}, corpus says {rec.get('domain')!r}")
    a["article_path"] = rel
    a["published"] = rec.get("published")

    quality = a.get("quality")
    if not isinstance(quality, dict) or quality.get("verdict") not in QUALITY_VERDICTS:
        errs.append(f"quality.verdict must be one of {sorted(QUALITY_VERDICTS)}")
        quality = None
    elif set(quality) - QUALITY_KEYS:
        errs.append(f"quality: unknown keys {sorted(set(quality) - QUALITY_KEYS)} (only verdict, notes)")
    for field, allowed in (("leaning", LEANING_LABELS), ("russia_stance", RUSSIA_LABELS)):
        block = a.get(field)
        if not isinstance(block, dict):
            errs.append(f"{field}: missing block")
            continue
        if block.get("label") not in allowed:
            errs.append(f"{field}.label must be one of {sorted(allowed)}")
        if not is_num(block.get("confidence")) or not 0.0 <= block["confidence"] <= 1.0:
            errs.append(f"{field}.confidence must be a number in [0,1]")
        if not isinstance(block.get("evidence"), str) or not block["evidence"].strip():
            errs.append(f"{field}.evidence: required (quote or concrete paraphrase)")
    ai = a.get("ai_generated")
    if not isinstance(ai, dict) or ai.get("verdict") not in AI_VERDICTS:
        errs.append(f"ai_generated.verdict must be one of {sorted(AI_VERDICTS)}")
    elif not is_num(ai.get("confidence")) or not 0.0 <= ai["confidence"] <= 1.0:
        errs.append("ai_generated.confidence must be a number in [0,1]")
    elif not isinstance(ai.get("signals"), list) or not all(isinstance(s, str) for s in ai["signals"]):
        errs.append("ai_generated.signals must be a list of strings")

    # ⚠️ STRINGS, and it stays that way — see the MENTION_KINDS block above.
    # `entities` feeds story clustering (candidate_stories calls .lower() on
    # each value); `mentions` below is the resolved, linkable sibling. They are
    # validated separately on purpose and must never be merged.
    ent = a.get("entities")
    if not isinstance(ent, dict):
        errs.append("entities: missing block")
    else:
        for k in ENTITY_BUCKETS:
            if not isinstance(ent.get(k), list) or not all(isinstance(x, str) and x.strip() for x in ent[k]):
                errs.append(f"entities.{k}: must be a list of non-empty strings")
        for k in ent:
            if k not in ENTITY_BUCKETS:
                errs.append(f"entities.{k}: unknown bucket (use {ENTITY_BUCKETS})")

    # ⚠️ OPTIONAL, and absent is not empty. Every one of the 365 analyses on
    # disk predates this block; treating a missing `mentions` as "this article
    # mentions nobody" would publish that claim about the whole corpus. A
    # record either carries the block or is silent about mentions, and only
    # the first can be counted.
    if "mentions" in a:
        errs.extend(validate_mentions(a["mentions"]))

    tones = a.get("party_tones")
    if not isinstance(tones, list):
        errs.append("party_tones: must be a list")
    else:
        for t in tones:
            if not isinstance(t, dict) or not isinstance(t.get("party"), str) or not t["party"].strip() \
                    or t.get("tone") not in TONE_LABELS:
                errs.append(f"party_tones entry must be {{party: str, tone in {sorted(TONE_LABELS)}}}: {t!r}")

    topics = a.get("topics")
    primary_cats = []
    if not isinstance(topics, list):
        errs.append("topics: must be a list")
    else:
        for t in topics:
            if not isinstance(t, dict):
                errs.append(f"topics entry must be an object: {t!r}")
                continue
            if not isinstance(t.get("primary"), bool):
                errs.append("topics entry: primary must be true or false")
                continue
            cid, sid = t.get("category"), t.get("subcategory")
            if not isinstance(cid, str) or not cid:
                errs.append(f"topics.category must be a non-empty string: {cid!r}")
                continue
            if cid not in cats:
                errs.append(f"topics.category {cid!r} not in taxonomy")
                continue
            if sid is not None and (not isinstance(sid, str) or sid not in cats[cid]["subcategories_map"]):
                errs.append(f"topics.subcategory {sid!r} not under category {cid!r}")
            if t["primary"]:
                primary_cats.append((cid, sid))

    sr = a.get("site_relevant")
    if not isinstance(sr, bool):
        errs.append("site_relevant: must be true/false")
    if len(primary_cats) > 1:
        errs.append("topics: at most one primary pair allowed")
    if len(primary_cats) == 1 and isinstance(sr, bool):
        cid = primary_cats[0][0]
        if sr != (cid != "not-site-relevant"):
            errs.append("site_relevant must be false exactly when the primary category is not-site-relevant")

    verdict = quality.get("verdict") if quality else None
    if verdict == "ok" and len(primary_cats) != 1:
        errs.append("quality ok requires exactly one primary topic pair")

    story = a.get("story")
    if not isinstance(story, dict) or story.get("action") not in STORY_ACTIONS:
        errs.append(f"story.action must be one of {sorted(STORY_ACTIONS)}")
    else:
        action = story["action"]
        if verdict != "ok" and action != "none":
            errs.append("story.action must be 'none' unless quality.verdict is ok")
        if sr is False and action != "none":
            errs.append("story.action must be 'none' for site_relevant: false articles (filler never joins stories)")
        if action == "same_story":
            sid = story.get("story_id")
            if not isinstance(sid, str) or not sid:
                errs.append("story.story_id required for same_story")
            elif sid not in index.get("stories", {}):
                errs.append(f"story.story_id {sid!r} not found in index")
        if action == "new_story":
            for k in ("canonical_title_bg", "canonical_title_en", "summary_bg", "summary_en"):
                if not isinstance(story.get(k), str) or not story[k].strip():
                    errs.append(f"story.{k} required for new_story")
        rel_ids = story.get("related_story_ids", [])
        if not isinstance(rel_ids, list):
            errs.append("story.related_story_ids must be a list")
        else:
            for rid in rel_ids:
                if not isinstance(rid, str):
                    errs.append(f"story.related_story_ids entries must be strings: {rid!r}")
                elif rid not in index.get("stories", {}):
                    errs.append(f"story.related_story_ids: {rid!r} not found in index")
    return errs


# ------------------------------------------------------------------ saving ---

def scan_stories_for_url(url: str, index: dict):
    """Fallback when the index has no entry for the url: find the story whose
    member list still contains it (crash window, manual edits)."""
    if url in index.get("articles", {}):
        return index["articles"][url].get("story_id")
    if not os.path.isdir(STORIES_DIR):
        return None
    for fname in os.listdir(STORIES_DIR):
        if not fname.endswith(".json"):
            continue
        st = load_story(fname[:-5])
        if st and any(m["url"] == url for m in st.get("members", [])):
            return st["id"]
    return None


def save_one(a: dict, tax, cats: dict, index: dict, stats: dict) -> list:
    errs = validate_analysis(a, tax, cats, index)
    if errs:
        return errs

    rel = a["article_path"]
    art_path = analysis_path_for(rel)

    prev_story_id = scan_stories_for_url(a["url"], index)

    # load sibling analyses of affected stories for recomputation
    affected = {prev_story_id} if prev_story_id else set()
    if a["story"]["action"] == "same_story":
        affected.add(a["story"]["story_id"])
    story_analyses = {}
    for sid in {s for s in affected if s}:
        st = load_story(sid)
        if not st:
            continue
        for m in st.get("members", []):
            if m["url"] == a["url"]:
                continue
            p = index.get("articles", {}).get(m["url"], {}).get("path")
            p_full = os.path.join(REPO_ROOT, p) if p else analysis_path_for(m["article_path"])
            sibling = load_json_if_exists(p_full)
            if sibling is not None:
                story_analyses[m["url"]] = sibling
    story_analyses[a["url"]] = a

    # resolve the target story
    action = a["story"]["action"]
    target_id = None
    if action == "new_story":
        base = make_story_id(a.get("published"), a["story"]["canonical_title_bg"], a["url"])
        target_id = unique_story_id(base)
        story = {
            "id": target_id,
            "canonical_title_bg": a["story"]["canonical_title_bg"].strip(),
            "canonical_title_en": a["story"]["canonical_title_en"].strip(),
            "summary_bg": a["story"]["summary_bg"].strip(),
            "summary_en": a["story"]["summary_en"].strip(),
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "topics": [t for t in a.get("topics", []) if t.get("primary")],
            "related_story_ids": [r for r in a["story"].get("related_story_ids", []) if isinstance(r, str)],
            "members": [],
            "entities": {k: [] for k in ENTITY_BUCKETS},
            "aggregates": {},
        }
        stats["stories_created"].append(target_id)
    elif action == "same_story":
        target_id = a["story"]["story_id"]
        story = load_story(target_id)
        if story is None:
            return [f"story {target_id!r} disappeared mid-save"]
        stats["stories_updated"].append(target_id)
    else:  # none
        story = None

    # detach from a previous, now-different story
    if prev_story_id and prev_story_id != target_id:
        old = load_story(prev_story_id)
        if old:
            old["members"] = [m for m in old.get("members", []) if m["url"] != a["url"]]
            if not old["members"]:
                delete_story(old["id"])
                index["stories"].pop(old["id"], None)
                stats["stories_deleted"].append(old["id"])
                prune_related_ids(old["id"], index)
            else:
                old_analyses = {u: d for u, d in story_analyses.items() if u != a["url"]}
                recompute_story(old, old_analyses)
                save_story(old)
                index["stories"][old["id"]] = index_story_entry(old)

    # write the analysis record
    write_json_atomic(art_path, a)
    stats["saved"].append(rel)

    # attach / update membership
    if story is not None:
        if action == "same_story":
            # the detach/prune above may have rewritten the target story file
            story = load_story(target_id) or story
        existing_member = next((m for m in story.get("members", []) if m["url"] == a["url"]), None)
        member = member_from(existing_member or {}, a)
        story["members"] = [m for m in story.get("members", []) if m["url"] != a["url"]] + [member]
        story = recompute_story(story, story_analyses)
        save_story(story)
        index["stories"][target_id] = index_story_entry(story)

    index["articles"][a["url"]] = {
        "path": os.path.relpath(art_path, REPO_ROOT),
        "story_id": target_id,
        "domain": a["domain"],
        "analyzed_at": a["analyzed_at"],
    }
    return []


def cmd_save(args) -> int:
    try:
        tax, cats = load_taxonomy()
    except (OSError, ValueError, json.JSONDecodeError) as e:
        return emit(3, error="taxonomy_load_failed", detail=str(e))
    index = load_index()
    if args.save_analysis == "-" or args.save_batch == "-":
        raw = sys.stdin.read()
    else:
        with open(args.save_analysis or args.save_batch, encoding="utf-8") as fh:
            raw = fh.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        return emit(3, error="invalid_json", detail=str(e))
    records = payload if args.save_batch else [payload]
    if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
        return emit(3, error="expected object (or array of objects)", got=type(payload).__name__)

    stats = {"saved": [], "failed": [], "stories_created": [], "stories_updated": [], "stories_deleted": []}
    for a in records:
        try:
            errs = save_one(a, tax, cats, index, stats)
        except Exception as e:  # per-record failure must not lose the batch
            errs = [f"unexpected error: {type(e).__name__}: {e}"]
        if errs:
            stats["failed"].append({"article_path": a.get("article_path"), "url": a.get("url"), "errors": errs})
        # flush after every record: a crash loses at most the record in flight
        index["updated_at"] = now_iso()
        write_json_atomic(INDEX_PATH, index)

    return emit(0 if not stats["failed"] else 3, mode="save_batch" if args.save_batch else "save_analysis", **stats)


# ------------------------------------------------------------------- queue ---

def cmd_next(args) -> int:
    if args.limit < 1:
        return emit(3, error="bad_limit", detail="--limit must be >= 1")
    all_domains = corpus_domains()
    domains = all_domains if args.next_domain == "all" else [args.next_domain]
    if args.next_domain != "all" and args.next_domain not in all_domains:
        return emit(2, error="unknown_domain", domain=args.next_domain,
                    hint="choose from the dirs in news/data/ or 'all'")
    index = load_index()
    analyzed_urls = set(index.get("articles", {}))
    ranks = outlet_ranks()
    # Slim tuples, not whole records: holding every unanalysed record measured
    # 44 MB at 3,978 articles, which is ~7.8 GB at the 700k a year of nightly
    # accumulation reaches. Only the fields the queue reports are kept.
    candidates = []
    corpus_total = 0
    unreadable = []
    today = now_iso()[:10]
    for domain in domains:
        files = corpus_files(domain) or []
        corpus_total += len(files)
        rank = ranks.get(domain, DEFAULT_OUTLET_RANK)
        for f in files:
            try:
                with open(os.path.join(DATA_DIR, domain, f),
                          encoding="utf-8") as fh:
                    rec = json.load(fh)
            except (OSError, json.JSONDecodeError) as e:
                # Named, not silently skipped: an unreadable record is an
                # article that will never be analysed, and this is the only
                # place that can say so.
                unreadable.append({"path": rel_corpus_path(domain, f),
                                   "detail": f"{type(e).__name__}: {e}"})
                continue
            if rec.get("url") in analyzed_urls:
                continue
            tier, day, basis = queue_sort_key(rec, today)
            candidates.append((
                tier, day, -rank,
                rec.get("published") or rec.get("fetched_at") or "",
                domain, f, rec.get("title"), rec.get("published"),
                rec.get("content_chars"), rec.get("author"), ranks.get(domain),
                basis,
            ))

    # ⚠️ GLOBAL, newest-first. The queue used to fill domain-by-domain with
    # the domains in ALPHABETICAL order, so under a fixed nightly budget
    # 24chasa.bg and bgdnes.bg were analysed every night and vesti.bg never
    # was — the corpus would have been judged in alphabetical order for ever.
    #
    # Three keys, and the DAY granularity of the first is deliberate: the
    # outlet rank is the tiebreak WITHIN a day, so the significant outlets are
    # judged first when the budget runs out, while a big outlet's week-old
    # piece never outranks today's news from a small one. Ordering by the full
    # timestamp first would make rank almost never apply, since two articles
    # rarely share a second. The timestamp is the last key, ordering within
    # one outlet's day.
    candidates.sort(reverse=True)

    queue = [{
        "path": rel_corpus_path(domain, f),
        "domain": domain,
        # Reported as the SORTED value, not as null: an unranked outlet is
        # ordered at DEFAULT_OUTLET_RANK, and printing null while sorting 999
        # makes the queue's own order unexplainable from its output.
        "outlet_rank": rank if rank is not None else DEFAULT_OUTLET_RANK,
        "outlet_ranked": rank is not None,
        "order_tier": tier,
        "order_basis": basis,
        "title": title,
        "published": published,
        "content_chars": chars,
        "author": author,
        "suspect_too_short": (chars or 0) < MIN_CONTENT_CHARS,
    } for (tier, _day, _nrank, _stamp, domain, f, title, published, chars,
           author, rank, basis) in candidates[:args.limit]]

    # ⚠️ Scoped to what this call actually looked at. Reporting the WHOLE
    # corpus's analysed count beside a single domain's rows produced
    # `unanalyzed: 0` next to `returned: 2`.
    result = {
        "domain_filter": args.next_domain, "limit": args.limit,
        "order": ("UTC day desc — the publication day, or the fetched_at day "
                  "when undated — then outlet rank asc, then time desc. A "
                  "FUTURE publication day sorts last (tier 0)."),
        "queue": queue,
        "counts": {"corpus": corpus_total, "analyzed": corpus_total - len(candidates),
                   "unanalyzed": len(candidates), "returned": len(queue)},
    }
    if unreadable:
        result["unreadable"] = unreadable
    return emit(0, **result)


# -------------------------------------------------------------- work item ---

def cmd_candidates(args) -> int:
    try:
        rel, rec = load_corpus_article(args.candidates)
    except FileNotFoundError:
        return emit(2, error="article_not_found", path=args.candidates,
                    hint="pass a path under news/data/<domain>/")
    index = load_index()
    return emit(0,
                article={
                    "path": rel, "domain": rec.get("domain"), "url": rec.get("url"),
                    "title": rec.get("title"), "published": rec.get("published"),
                    "author": rec.get("author"), "topic": rec.get("topic"),
                    "keywords": rec.get("keywords"), "description": rec.get("description"),
                    "site_name": rec.get("site_name"), "content_chars": rec.get("content_chars"),
                    "content_preview": (rec.get("content") or "")[:400],
                    "suspect_too_short": (rec.get("content_chars") or 0) < MIN_CONTENT_CHARS,
                    "already_analyzed": rec.get("url") in index.get("articles", {}),
                },
                candidates=candidate_stories(index, rec),
                taxonomy={"path": os.path.relpath(TOPICS_PATH, REPO_ROOT)},
                note="Read the full article at 'path' before analyzing; candidates are a prefilter, the same_story/new_story call is yours.")


# ------------------------------------------------------------------- stats ---

def cmd_stats(_args) -> int:
    index = load_index()
    per_domain, leaning, russia, quality, ai = {}, {}, {}, {}, {}
    analyzed = 0
    invalid = 0
    for url, entry in index.get("articles", {}).items():
        p = os.path.join(REPO_ROOT, entry.get("path", ""))
        a = load_json_if_exists(p)
        if a is None:
            continue
        analyzed += 1
        d = a.get("domain", entry.get("domain", "?"))
        row = per_domain.setdefault(d, {"corpus": 0, "analyzed": 0})
        row["analyzed"] += 1
        qv = a.get("quality", {}).get("verdict", "?")
        quality[qv] = quality.get(qv, 0) + 1
        av = a.get("ai_generated", {}).get("verdict", "?")
        ai[av] = ai.get(av, 0) + 1
        if qv != "ok":
            continue
        lean = a.get("leaning", {}).get("label")
        rus = a.get("russia_stance", {}).get("label")
        if not lean or not rus:
            invalid += 1
            continue
        leaning[lean] = leaning.get(lean, 0) + 1
        russia[rus] = russia.get(rus, 0) + 1
    for domain in corpus_domains():
        row = per_domain.setdefault(domain, {"corpus": 0, "analyzed": 0})
        row["corpus"] = len(corpus_files(domain) or [])
    corpus_total = sum(r["corpus"] for r in per_domain.values())
    stories = []
    for sid, entry in sorted(index.get("stories", {}).items(), key=lambda kv: -kv[1].get("member_count", 0)):
        stories.append({"story_id": sid, "title_bg": entry.get("title_bg"), "members": entry.get("member_count")})
    return emit(0, corpus_total=corpus_total, analyzed_total=analyzed, invalid_records=invalid,
                coverage=per_domain, leaning_distribution=leaning, russia_distribution=russia,
                quality_verdicts=quality, ai_verdicts=ai, story_count=len(index.get("stories", {})),
                top_stories=stories[:5])


# ------------------------------------------------------------------ rebuild ---

def scan_analyses_on_disk():
    analyses = {}
    if not os.path.isdir(ARTICLES_DIR):
        return analyses
    for domain in sorted(os.listdir(ARTICLES_DIR)):
        d = os.path.join(ARTICLES_DIR, domain)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".json"):
                continue
            a = load_json_if_exists(os.path.join(d, f))
            if isinstance(a, dict) and isinstance(a.get("url"), str):
                analyses[a["url"]] = a
    return analyses


def scan_story_files():
    stories = {}
    if not os.path.isdir(STORIES_DIR):
        return stories
    for fname in sorted(os.listdir(STORIES_DIR)):
        if not fname.endswith(".json"):
            continue
        st = load_story(fname[:-5])
        if st:
            stories[st["id"]] = st
    return stories


def cmd_rebuild(_args) -> int:
    old_index = load_index()
    old_stories = scan_story_files()

    analyses = scan_analyses_on_disk()
    # pass 1: which story does each ok analysis belong to?
    membership = {}  # url -> story_id
    for url, a in sorted(analyses.items()):
        if a.get("quality", {}).get("verdict") != "ok":
            continue
        story = a.get("story", {})
        if story.get("action") == "same_story" and isinstance(story.get("story_id"), str):
            membership[url] = story["story_id"]
        elif story.get("action") == "new_story":
            membership[url] = make_story_id(a.get("published"), story.get("canonical_title_bg", ""),
                                            url)

    # pass 2: (re)build the stories, keeping titles/summaries/added_at from
    # any existing story file — with the deterministic id first, else the
    # same_story id, else the id of the story whose members list the url
    id_aliases = {}
    for sid, st in old_stories.items():
        for m in st.get("members", []):
            id_aliases.setdefault(m["url"], sid)
    stories = {}
    for url, sid in membership.items():
        real_id = sid if sid in old_stories else id_aliases.get(url, sid)
        membership[url] = real_id
    for url in sorted(membership, key=lambda u: analyses[u].get("analyzed_at", "")):
        sid = membership[url]
        a = analyses[url]
        st = stories.get(sid)
        if st is None:
            prev_story = old_stories.get(sid)
            if prev_story:
                st = {k: prev_story.get(k) for k in (
                    "id", "canonical_title_bg", "canonical_title_en", "summary_bg", "summary_en",
                    "created_at", "topics", "related_story_ids")}
                st.setdefault("members", [])
            else:
                first = a.get("story", {})
                st = {
                    "id": sid,
                    "canonical_title_bg": first.get("canonical_title_bg") or sid,
                    "canonical_title_en": first.get("canonical_title_en") or sid,
                    "summary_bg": first.get("summary_bg") or "",
                    "summary_en": first.get("summary_en") or "",
                    "created_at": now_iso(),
                    "topics": [t for t in a.get("topics", []) if isinstance(t, dict) and t.get("primary")],
                    "related_story_ids": [r for r in first.get("related_story_ids", []) if isinstance(r, str)],
                }
                st.setdefault("members", [])
            stories[sid] = st
        prev_member = next((m for m in st.get("members", []) if m["url"] == url), None)
        if prev_member is None and old_stories.get(sid):
            prev_member = next((m for m in old_stories[sid].get("members", []) if m["url"] == url), None)
        st["members"] = [m for m in st.get("members", []) if m["url"] != url] + [member_from(prev_member or {}, a)]

    dropped = sorted(set(old_stories) - set(stories))
    for sid in dropped:
        delete_story(sid)

    live_ids = set(stories)
    for sid, st in stories.items():
        member_analyses = {m["url"]: analyses[m["url"]] for m in st["members"] if m["url"] in analyses}
        st["related_story_ids"] = [r for r in st.get("related_story_ids", []) if r in live_ids]
        recompute_story(st, member_analyses)
        save_story(st)

    index = {
        "version": 1,
        "updated_at": now_iso(),
        "stories": {sid: index_story_entry(st) for sid, st in stories.items()},
        "articles": {},
    }
    for url, a in analyses.items():
        index["articles"][url] = {
            "path": os.path.relpath(analysis_path_for(a["article_path"]), REPO_ROOT),
            "story_id": membership.get(url),
            "domain": a.get("domain"),
            "analyzed_at": a.get("analyzed_at"),
        }
    write_json_atomic(INDEX_PATH, index)
    return emit(0, analyses=len(analyses), stories=len(stories),
                dropped_orphan_stories=dropped)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 exit_on_error=False)
    modes = ap.add_mutually_exclusive_group(required=True)
    modes.add_argument("--next", dest="next_domain", metavar="DOMAIN|all", help="queue of unanalyzed corpus articles")
    modes.add_argument("--candidates", metavar="ARTICLE", help="work item: article + candidate stories")
    modes.add_argument("--save-analysis", metavar="FILE|-", help="persist one analysis record")
    modes.add_argument("--save-batch", metavar="FILE|-", help="persist an array of analysis records")
    modes.add_argument("--stats", action="store_true", help="coverage and distribution report")
    modes.add_argument("--rebuild", action="store_true", help="regenerate index and story aggregates from disk")
    ap.add_argument("--limit", type=int, default=10, help="queue size (default 10, minimum 1)")

    try:
        args = ap.parse_args()
        if args.next_domain:
            return cmd_next(args)
        if args.candidates:
            return cmd_candidates(args)
        if args.save_analysis or args.save_batch:
            return cmd_save(args)
        if args.stats:
            return cmd_stats(args)
        if args.rebuild:
            return cmd_rebuild(args)
    except argparse.ArgumentError as e:
        return emit(3, error="bad_arguments", detail=str(e))
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as e:
        return emit(4, error="internal", detail=f"{type(e).__name__}: {e}")
    except Exception as e:  # the stdout contract holds on every path
        return emit(4, error="internal", detail=f"{type(e).__name__}: {e}")
    return emit(3, error="no_mode_selected")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(emit(4, error="interrupted"))
