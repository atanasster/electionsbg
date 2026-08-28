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
                    It is also the repair for an index that has drifted
                    from the disk: an entry whose analysis is gone is
                    pruned (reported as dropped_orphan_articles) and one
                    whose path went stale is repointed at the file that is
                    actually there (stale_article_path).

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
from pathlib import Path

# resolve_mentions is a sibling module, and this script is run by path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from review_routing import record_review  # noqa: E402

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
PARTY_TONES_VERSION = 2
PARTY_TONE_EVIDENCE_GATE_VERSION = 1
PARTY_TONE_RAW_KEYS = frozenset({"party", "tone", "confidence", "evidence"})
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

# ⚠️ `form_kind` is in the schema and NOT in MODEL_MAY_SET, so an analyst
# cannot promote a two-part match to a full-name one. It records how strong
# the matched surface is as evidence — see FORM_KINDS in build_gazetteer.py:
# 99.1% of person links rest on a two-part name, and relabelling one as
# `full_name` would launder the weakest evidence this tier admits into the
# strongest.
MENTION_KEYS = frozenset({"kind", "surface", "basis", "id", "role",
                          "candidates", "form_kind"})
MENTION_FORM_KINDS = ("full_name", "two_part", "surname", "name", "coref")

# ⚠️⚠️ THE MODEL MAY NOT MINT AN IDENTITY. The dictionary pass
# (resolve_mentions.py) runs first, off the gazetteer, and every id and basis
# in a saved record must be one IT produced. An analyst — a skill, or the
# local LLM the standalone runner drives — may:
#
#   • set `role` (subject / source / mention), which a dictionary cannot know
#   • ADD mentions the dictionary missed, at `not_in_gazetteer` with no id
#   • DROP mentions it judges spurious
#
# and may not change an `id`, promote a `basis`, or invent one. The reason is
# the whole of Tier 2: „Иванов" is 1,554 public figures, a model asked to
# identify one will happily oblige, and a wrong link is shape-identical to a
# right one. The gazetteer's refusals are the product; a model that can
# overrule them makes them decorative.
#
# Enforced in validate_analysis() by RE-RUNNING the resolver over the same
# article and comparing. That costs ~6 ms per record and is the only check
# that cannot be satisfied by a well-formed lie.
MODEL_MAY_SET = frozenset({"role"})

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
_OUTLET_NAMES_CACHE = None


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


def outlet_names():
    """Folded publisher names from the source registry.

    This is deliberately derived from the same registry the pipeline uses to
    identify publishers. A hand-maintained deny-list would turn today's
    OFFNews correction into another one-off and miss the next cited outlet.
    """
    global _OUTLET_NAMES_CACHE
    if _OUTLET_NAMES_CACHE is not None:
        return _OUTLET_NAMES_CACHE
    names = set()
    path = os.path.join(DATA_DIR, "bg_news_sites.csv")
    try:
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                name = " ".join((row.get("outlet") or "").split())
                if name:
                    names.add(name.casefold())
    except (OSError, csv.Error):
        pass
    _OUTLET_NAMES_CACHE = frozenset(names)
    return _OUTLET_NAMES_CACHE


# A publisher following one of these phrases is evidence attribution, not a
# corporate subject. The check below requires EVERY occurrence to have this
# shape, so a story about a media sale that also cites the outlet once remains
# valid.
SOURCE_ATTRIBUTION_TAIL = re.compile(
    r"(?:съобщава|съобщи|според|пише|предаде|цитира|по информация на)\s*$",
    re.IGNORECASE,
)


def company_outlets_used_only_as_sources(entities: dict, rec: dict) -> list[str]:
    """Known outlets wrongly placed in companies when only cited as sources."""
    text = "\n".join(str(rec.get(k) or "")
                     for k in ("title", "description", "content"))
    bad = []
    known = outlet_names()
    for raw in (entities or {}).get("companies") or []:
        name = " ".join(str(raw).split())
        if not name or name.casefold() not in known:
            continue
        hits = list(re.finditer(re.escape(name), text, re.IGNORECASE))
        if hits and all(SOURCE_ATTRIBUTION_TAIL.search(
                text[max(0, hit.start() - 80):hit.start()]) for hit in hits):
            bad.append(name)
    return bad


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


# ⚠️⚠️ A PERSON'S NAME MUST BE COPIED, NOT PARAPHRASED, and the model does
# not always. Measured over the corpus: „Антон Славев" was published where
# the article said „Антон Славчев" — a person who does not exist, while
# „Антон Славчев" is in the identity layer with declarations — and „Кая
# Каллас" twice where the text said „Калас". Three of 344 name tokens.
#
# A published name that is one letter from a real one is worse than a missing
# one: it is a claim about a named individual that no register can confirm,
# and it silently costs the link that would have made it checkable.
#
# ⚠️ THE RULE IS „ABSENT BUT NEARLY PRESENT", not „absent". A model composing
# „Росен Желязков" from a text that says only „Желязков" is inferring, which
# is legitimate and common; a model writing „Славев" where the text says
# „Славчев" is altering. The near-miss is what separates them.
#
# ⚠️ PEOPLE ONLY. On institutions and places the same rule fires on Bulgarian
# INFLECTION — „Съвет" against „съвета", „Софийска" against „софийската",
# „Русия" against „руският" — 53 hits, essentially all false. Personal names
# do not take the definite article in running text, which is why the people
# arm measured 0 false positives on 344 tokens and the others cannot be
# switched on without a morphological analyser.
NAME_EDIT_DISTANCE = 2
NAME_MIN_TOKEN_CHARS = 4
# Below this, a two-edit window covers most of the word — see
# altered_names_in_prose.
NAME_LONG_TOKEN_CHARS = 6


def _edit_distance(a: str, b: str, cap: int = NAME_EDIT_DISTANCE) -> int:
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1,
                           prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def altered_names_in_prose(entities: dict, texts, prose: str) -> list:
    """(the article's spelling, the prose's spelling) for each altered name.

    ⚠️⚠️ THIS EXISTS BECAUSE THE ENTITY CHECK GOES BLIND THE MOMENT THE
    ENTITIES ARE FIXED. `altered_person_names` finds names in
    `entities.people` the article does not use, and the prose arm was scoped
    to the tokens it proved — so once a re-analysis corrected the entity
    block, a summary still carrying „Каллас" was examined by nothing and
    shipped. Measured: story 20260822-ed7347ac published that sentence with
    `entities.people` reading „Кая Калас", i.e. the record disagreed with
    itself and every check passed.

    So this anchors the other way round: for each token of a name we BELIEVE
    (the entities, which the article corroborates), find a near-miss of it in
    the prose that the article never writes. „Калас" is believed, „Каллас" is
    one letter away and absent from the article — an alteration, whatever the
    entity block says.

    ⚠️ ANCHORED ON PERSON NAMES, never a free scan of the prose. A Bulgarian
    summary is full of inflected common words, and „is this word in the
    article" over all of them is the false-positive problem that keeps
    institutions and places out of this rule entirely.
    """
    people = (entities or {}).get("people") or []
    if not people or not (prose or "").strip():
        return []
    try:
        import resolve_mentions as rm
    except Exception:  # noqa: BLE001
        return []
    present = set()
    for rec in texts:
        if not isinstance(rec, dict):
            continue
        for key in ("title", "description", "content"):
            for t in rm.TOKEN_RE.findall(str(rec.get(key) or "")):
                present.add(rm.fold(t))
    if not present:
        return []
    believed = {rm.fold(t) for name in people if isinstance(name, str)
                for t in rm.TOKEN_RE.findall(name)
                if len(rm.fold(t)) >= NAME_MIN_TOKEN_CHARS
                and rm.fold(t) in present}
    if not believed:
        return []
    out, seen = [], set()
    for tok in rm.TOKEN_RE.findall(prose):
        folded = rm.fold(tok)
        if len(folded) < NAME_MIN_TOKEN_CHARS or folded in present:
            continue
        if folded in seen:
            continue
        # ⚠️ A NAME IN BULGARIAN PROSE IS CAPITALISED, and without this the
        # rule fires on ordinary words: measured over the whole corpus, 3 of
        # 4 hits were „пред" (a preposition, 2 edits from „пеев") and „бива"
        # (a verb, 2 edits from „иван"). Entity names need no such test —
        # they are names by construction; loose prose does.
        if not tok[:1].isupper():
            continue
        # ⚠️ AND THE WINDOW NARROWS WITH LENGTH. Two edits on a four-letter
        # token is most of the word, which is how a preposition came within
        # range of a surname at all. „Каллас"/„Калас" is one edit and
        # survives either way.
        limit = NAME_EDIT_DISTANCE if len(folded) >= NAME_LONG_TOKEN_CHARS else 1
        near = sorted((b for b in believed
                       if 0 < _edit_distance(folded, b) <= limit),
                      key=lambda b: _edit_distance(folded, b))
        if near:
            seen.add(folded)
            # The article's own spelling comes from the believed token, which
            # is by construction a token the article writes.
            out.append((near[0], tok))
    return out


def altered_person_names(entities: dict, texts) -> list:
    """(name, our token, the article's token) for every altered person name.

    ⚠️ THE ONE PLACE THE RULE LIVES. `check_person_names` renders these as
    validator errors and `build_app_data` withholds the names — a second
    implementation of "is this name in the article" would let the pipeline
    refuse a record at save time and publish it anyway.

    `texts` is an ITERABLE of article records, not one, because a story is
    verified against every member: a name one member writes is a name the
    story may carry, and checking only the first would refuse it.

    See the block comment above for why this is people-only and why the test
    is „absent but nearly present" rather than „absent".
    """
    people = (entities or {}).get("people") or []
    if not people:
        return []
    try:
        import resolve_mentions as rm
    except Exception:  # noqa: BLE001
        return []
    # ⚠️ folded → the ORIGINAL spelling, so a caller can quote the article
    # rather than our lowercase comparison key. „it writes 'славчев'" sends a
    # reader looking for a word the article does not contain.
    present: dict = {}
    for rec in texts:
        if not isinstance(rec, dict):
            continue
        for key in ("title", "description", "content"):
            for t in rm.TOKEN_RE.findall(str(rec.get(key) or "")):
                present.setdefault(rm.fold(t), t)
    if not present:
        # ⚠️ NO TEXT IS NOT EVIDENCE OF A BAD NAME. A record whose article is
        # gone cannot be checked, and refusing every name on it would delete
        # a story's whole cast on a missing file.
        return []
    out = []
    for name in people:
        if not isinstance(name, str):
            continue
        for token in rm.TOKEN_RE.findall(name):
            folded = rm.fold(token)
            if len(folded) < NAME_MIN_TOKEN_CHARS or folded in present:
                continue
            near = sorted(
                (t for t in present
                 if len(t) >= NAME_MIN_TOKEN_CHARS
                 and 0 < _edit_distance(folded, t) <= NAME_EDIT_DISTANCE),
                key=lambda t: _edit_distance(folded, t))
            if near:
                out.append((name, token, present[near[0]]))
    return out


# The prose fields a fabricated name must not reach either.
#
# ⚠️ THE CHIP IS NOT WHERE THE HARM IS. All five affected records repeated
# the altered surname in `summary_bg` — „ИД-председателят на КПКОНПИ Антон
# Славев е получил…" is the story's LEAD PARAGRAPH, read by everyone, while
# the entity chip is a word in a sidebar. A validator that refuses the chip
# and passes the sentence has refused the quieter half.
#
# ⚠️ SCOPED TO TOKENS THE NAME CHECK ALREADY PROVED ALTERED, never a fresh
# scan of the prose. A summary is Bulgarian prose full of inflected common
# words, so a general „is this word in the article" sweep over it has the
# same false-positive problem that keeps institutions and places out of the
# rule entirely (53 hits, essentially all inflection). This adds no new
# judgement — it asks only whether a token already ruled bad leaked onward.
PROSE_FIELDS = ("summary_bg", "summary_en")


def check_person_names(entities: dict, rec: dict, analysis: dict = None) -> list:
    """Refuse a person name the article did not spell that way."""
    bad = altered_person_names(entities, [rec])
    errs = [
        f"entities.people: {name!r} contains {token!r}, which the article "
        f"does not use — it writes {wrote!r}. Copy a person's name exactly "
        "as the article spells it; a name one letter off is a claim about "
        "somebody who may not exist."
        for name, token, wrote in bad
    ]
    if isinstance(analysis, dict):
        import resolve_mentions as rm
        want = {rm.fold(t) for _, t, _ in bad}
        for field in PROSE_FIELDS:
            v = analysis.get(field)
            if not v:
                continue
            leaked = want & {rm.fold(t) for t in rm.TOKEN_RE.findall(str(v))}
            # ⚠️ THE SECOND ARM RUNS EVEN WHEN `bad` IS EMPTY, and that is the
            # whole point — a corrected entity block used to switch the prose
            # check off, so a summary still carrying the altered spelling was
            # examined by nothing. See altered_names_in_prose.
            for wrote, used in altered_names_in_prose(entities, [rec], str(v)):
                leaked.add(rm.fold(used))
            if leaked:
                errs.append(
                    f"{field}: repeats a name the article does not use "
                    f"({sorted(leaked)}). Fix the name everywhere it appears, "
                    "not only in entities.people.")
    return errs


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
        if m.get("form_kind") is not None \
                and m["form_kind"] not in MENTION_FORM_KINDS:
            errs.append(f"{at}.form_kind must be one of "
                        f"{sorted(MENTION_FORM_KINDS)} or absent")
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


def _resolver():
    """The dictionary pass, or None when the gazetteer is absent.

    ⚠️ Imported LAZILY and tolerated as missing. A checkout without
    news/data/gazetteer.json must still be able to save analyses — the
    provenance check then cannot run, and says so rather than rejecting the
    whole corpus.
    """
    try:
        import resolve_mentions as rm
        gaz_path = Path(DATA_DIR).parent / "data" / "gazetteer.json"
        if not gaz_path.exists():
            gaz_path = rm.GAZETTEER
        if not gaz_path.exists():
            return None
        return rm, rm.Gazetteer.load(gaz_path)
    except Exception:  # noqa: BLE001
        return None


_RESOLVER_CACHE: list = []
# Set when a record's mentions could not be checked against the gazetteer.
MENTIONS_UNVERIFIED: list = []
PARTY_IDS_UNVERIFIED: list = []
# These translated labels recur in many countries. Surface equality cannot
# tell a Bulgarian party from Portugal's PSD or Germany's SPD, so deterministic
# identity must refuse the link even when the local gazetteer has one claim.
GENERIC_PARTY_IDENTITY_LABELS = frozenset({
    "демократическа партия", "социалдемократическа партия",
    "социалистическа партия", "комунистическа партия", "зелена партия",
    "либерална партия", "консервативна партия", "републиканска партия",
    "народна партия",
})


def _party_claims(name: str):
    """Return unique gazetteer claims for one party label, or None offline."""
    got = _RESOLVER_CACHE[0] if _RESOLVER_CACHE else _resolver()
    if not _RESOLVER_CACHE:
        _RESOLVER_CACHE.append(got)
    if got is None:
        PARTY_IDS_UNVERIFIED.append(True)
        return None
    rm, gaz = got
    key = rm.fold(" ".join(rm.TOKEN_RE.findall(name or "")))
    unique = {}
    for claim in gaz.by_surface.get(key, []):
        if claim.get("kind") != "party":
            continue
        identity = (claim.get("id"), claim.get("anchor_for"),
                    claim.get("canonical"), bool(claim.get("resolvable")))
        unique[identity] = claim
    return list(unique.values())


def party_id_for_name(name: str) -> str | None:
    """Resolve only a uniquely claimed, explicitly resolvable party surface."""
    folded_name = " ".join(str(name or "").casefold().split()).strip('"„”')
    if folded_name in GENERIC_PARTY_IDENTITY_LABELS:
        return None
    claims = _party_claims(name)
    if claims is None or len(claims) != 1:
        return None
    claim = claims[0]
    ident = claim.get("id")
    return str(ident) if claim.get("resolvable") and ident else None


def enrich_party_tones(analysis: dict) -> None:
    """Stamp deterministic identity and the assessed-schema version."""
    analysis["party_tones"] = [
        {**tone, "party_id": party_id_for_name(tone["party"])}
        for tone in analysis.get("party_tones") or []
    ]
    analysis["party_tones_version"] = PARTY_TONES_VERSION


def gate_party_tone_evidence(analysis: dict, rec: dict) -> None:
    """Stamp the deterministic evidence decision without deleting history.

    A failed gate withholds only the sentiment assertion at publication time.
    The underlying party/person/institution mention remains a separate fact
    and can still power reciprocal backlinks.
    """
    for tone in analysis.get("party_tones") or []:
        tone["evidence_grounded"] = party_tone_evidence_grounded(
            str(tone.get("evidence") or ""), rec)
    analysis["party_tone_evidence_gate_version"] = (
        PARTY_TONE_EVIDENCE_GATE_VERSION)


def party_tone_evidence_grounded(evidence: str, rec: dict) -> bool:
    """Quote-safe grounding signal; paraphrases route to review.

    Gate v1 deliberately requires a normalized contiguous substring. Token
    overlap loses order and can approve a meaning reversed by one omitted
    negation ("получи" versus "не получи").
    """
    try:
        import resolve_mentions as rm
    except Exception:  # noqa: BLE001
        return False
    article = rm.fold(rm.article_text(rec))
    folded = rm.fold(evidence or "").strip()
    if not folded:
        return False
    return folded in article


def check_mention_provenance(mentions: list, rec: dict) -> list:
    """Refuse any mention whose IDENTITY the analyst changed.

    ⚠️ THE ONE CHECK A WELL-FORMED LIE CANNOT PASS. `validate_mentions` above
    proves a mention is SHAPED right — a refused basis carries no id, an
    ambiguity names two candidates. It cannot prove the id is the one the
    gazetteer produced, because a fabricated id is shaped exactly like a real
    one. So the dictionary pass is re-run over the same article and the two
    are compared.

    The analyst may set `role`, drop a mention, or add one at
    `not_in_gazetteer` with no id. It may not promote a basis or attach an id
    the gazetteer refused.
    """
    got = _RESOLVER_CACHE[0] if _RESOLVER_CACHE else _resolver()
    if not _RESOLVER_CACHE:
        _RESOLVER_CACHE.append(got)
    if got is None:
        # ⚠️ RECORDED, not silently skipped. Without a gazetteer this check
        # cannot run — and a save that quietly accepted every id would look
        # exactly like one that verified them. The flag rides out on the
        # save-batch result so an operator can see the guard was off.
        MENTIONS_UNVERIFIED.append(True)
        return []
    rm, gaz = got
    # ⚠️ KEYED ON THE TOKEN JOIN, not on the raw folded surface. resolve()
    # slices between token boundaries, so a surface opening a quote it never
    # closes — „Агенция „Пътна инфраструктура", 49 live mentions across 27
    # distinct surfaces — ships unbalanced. An analyst that tidies it up then
    # fails to match ANY truth entry, is accused of minting an identity, and
    # loses the whole record at exit 3. Comparing on tokens makes the two
    # spellings equal; verified over the full corpus, it produces zero
    # collisions between entries with different ids, so it cannot weaken the
    # guard.
    def key_of(kind, surface):
        return (kind, rm.fold(" ".join(rm.TOKEN_RE.findall(str(surface or "")))))

    truth = {}
    for m in rm.dedupe(rm.resolve(rm.article_text(rec), gaz)):
        truth[key_of(m["kind"], m["surface"])] = m

    errs = []
    for i, m in enumerate(mentions):
        at = f"mentions[{i}]"
        ref = truth.get(key_of(m.get("kind"), m.get("surface")))
        if ref is None:
            # Not something the dictionary found. Allowed — the analyst can
            # see names a gazetteer never will — but it may claim nothing
            # about them beyond their existence.
            if m.get("id") or m.get("basis") != "not_in_gazetteer":
                errs.append(
                    f"{at}: {m.get('surface')!r} was not produced by the "
                    "dictionary pass, so it may only be recorded as "
                    "not_in_gazetteer with a null id — an analyst may not "
                    "mint an identity")
            elif m.get("candidates"):
                # ⚠️ „ambiguous between X and Y" about a name the dictionary
                # never saw is a fabricated claim about named individuals.
                errs.append(
                    f"{at}.candidates: {m.get('surface')!r} was not produced "
                    "by the dictionary pass, so no candidates for it can "
                    "have come from the gazetteer")
            continue
        # ⚠️⚠️ EVERY FIELD BUT `role`, and comparing only id+basis was a live
        # hole: `candidates` is free text that no check touched, so a record
        # could be saved at exit 0 asserting an article's „Пеевски" was
        # ambiguous between Бойко Борисов and Цветан Василев — two names the
        # dictionary never proposed, about real people. The whitelist is
        # inverted deliberately: a field ADDED to the mention schema is
        # verified by default rather than silently unguarded.
        for field in sorted(MENTION_KEYS - MODEL_MAY_SET):
            if field == "surface":
                continue  # it is the key; a spelling difference is allowed
            if field not in m:
                # ⚠️ FILLED, not rejected. These fields are OURS — the
                # analyst is not asked to produce `form_kind` or
                # `candidates`, and refusing a record for omitting one would
                # make every new field a breaking change for every analyst.
                # Only a value it SET differently is a claim we must refuse.
                if ref.get(field) is not None:
                    m[field] = ref[field]
                continue
            if m.get(field) != ref.get(field):
                errs.append(
                    f"{at}.{field}: {m.get(field)!r} does not match the "
                    f"dictionary pass ({ref.get(field)!r}) for "
                    f"{m.get('surface')!r} — an analyst may set "
                    f"{sorted(MODEL_MAY_SET)} only")
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

    if isinstance(a.get("entities"), dict):
        errs.extend(check_person_names(a["entities"], rec, a))

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
        if isinstance(ent.get("companies"), list):
            for outlet in company_outlets_used_only_as_sources(ent, rec):
                errs.append(
                    f"entities.companies: {outlet!r} is a registered news "
                    "outlet used only in source-attribution phrases; a cited "
                    "publisher is a source, not a company central to the story")

    # ⚠️ OPTIONAL, and absent is not empty. Every one of the 365 analyses on
    # disk predates this block; treating a missing `mentions` as "this article
    # mentions nobody" would publish that claim about the whole corpus. A
    # record either carries the block or is silent about mentions, and only
    # the first can be counted.
    if "mentions" in a:
        errs.extend(validate_mentions(a["mentions"]))
        if not errs:
            errs.extend(check_mention_provenance(a["mentions"], rec))

    # ⚠️⚠️ THE ESCAPE HATCH, COMPUTED HERE AND NOT ACCEPTED FROM THE ANALYST.
    # A model that could set its own `review` field would set it to nothing —
    # not from malice, but because a model asked „do you need checking?"
    # answers the way it answers everything else. The rule is a pure function
    # of (label, confidence) in review_routing.py, so it is the same for a
    # frontier model, a 12B and a human, and it is applied AFTER validation so
    # a rejected record never reaches it.
    if "review" in a:
        errs.append("review: computed at save time — an analyst may not set "
                    "whether its own output needs checking")

    if "party_tones_version" in a:
        errs.append("party_tones_version: computed at save time — an analyst "
                    "may not claim that its own output passed v2 enrichment")
    if "party_tone_evidence_gate_version" in a:
        errs.append("party_tone_evidence_gate_version: computed at save time — "
                    "an analyst may not claim that its own evidence passed")

    tones = a.get("party_tones")
    if not isinstance(tones, list):
        errs.append("party_tones: must be a list")
    else:
        tone_names = []
        for i, t in enumerate(tones):
            at = f"party_tones[{i}]"
            if not isinstance(t, dict):
                errs.append(f"{at}: must be an object")
                continue
            unknown = sorted(set(t) - PARTY_TONE_RAW_KEYS)
            if unknown:
                errs.append(f"{at}: unknown keys {unknown}; party_id is "
                            "computed after validation")
            party = t.get("party")
            if not isinstance(party, str) or not party.strip():
                errs.append(f"{at}.party: must be a non-empty string")
            else:
                tone_names.append(party)
            if t.get("tone") not in TONE_LABELS:
                errs.append(f"{at}.tone must be one of {sorted(TONE_LABELS)}")
            confidence = t.get("confidence")
            if not is_num(confidence) or not 0 <= confidence <= 1:
                errs.append(f"{at}.confidence must be a number in [0,1]")
            evidence = t.get("evidence")
            if not isinstance(evidence, str) or not evidence.strip():
                errs.append(f"{at}.evidence: required (quote or concrete paraphrase)")
            elif len(evidence.split()) < 4:
                errs.append(f"{at}.evidence: must explain the article's treatment, "
                            "not merely repeat a label")
            if (t.get("tone") == "neutral" and isinstance(evidence, str)
                    and isinstance(party, str)):
                try:
                    import resolve_mentions as rm
                    discarded = {
                        *rm.TOKEN_RE.findall(rm.fold(party)),
                        "neutral", "неутрален", "неутрална", "неутрално",
                        "партия", "партията", "представен", "представена",
                        "представено", "днес",
                    }
                    content = [
                        token for token in rm.TOKEN_RE.findall(rm.fold(evidence))
                        if len(token) >= 4 and token not in discarded
                        and token not in STOPWORDS
                    ]
                    if len(content) < 3:
                        errs.append(f"{at}.evidence: neutral must explain the "
                                    "factual or balanced treatment")
                except Exception:  # noqa: BLE001
                    pass
            if t.get("tone") == "mixed" and isinstance(evidence, str):
                markers = (" но ", " докато ", " същевременно ",
                           "от една страна", ";", ". ")
                padded = f" {evidence.casefold()} "
                if not any(marker in padded for marker in markers):
                    errs.append(f"{at}.evidence: mixed requires both directions")
        if len(tone_names) != len(set(tone_names)):
            errs.append("party_tones: duplicate party entries are not allowed")

        party_entities = ent.get("parties") if isinstance(ent, dict) else None
        if isinstance(party_entities, list):
            if len(party_entities) != len(set(party_entities)):
                errs.append("entities.parties: duplicate entries are not allowed")
            publishable = (quality is not None
                           and quality.get("verdict") == "ok"
                           and a.get("site_relevant") is True)
            if publishable:
                missing = sorted(set(party_entities) - set(tone_names))
                extra = sorted(set(tone_names) - set(party_entities))
                if missing:
                    errs.append(f"party_tones: missing assessments for {missing}")
                if extra:
                    errs.append(f"party_tones: parties not in entities.parties {extra}")
            elif party_entities or tone_names:
                errs.append("non-publishable analyses must have empty "
                            "entities.parties and party_tones")

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

    try:
        _, review_article = load_corpus_article(a["article_path"])
    except FileNotFoundError:  # validation already proved it; defensive only
        review_article = {}

    # Identity, evidence grounding, and their versions are pipeline facts,
    # never model claims. Keep a failed tone for audit/history; public bundle
    # generation filters it independently from the mention/backlink layer.
    enrich_party_tones(a)
    gate_party_tone_evidence(a, review_article)

    # ⚠️ STAMPED AFTER VALIDATION, so a rejected record never carries one, and
    # computed here rather than accepted from the analyst — a model asked „do
    # you need checking?" answers the way it answers everything else. The rule
    # is a pure function of (label, confidence); see review_routing.py for why
    # a bare confidence threshold routes exactly backwards.
    review = record_review({**a, "_article": review_article})
    if review:
        a["review"] = review
    else:
        a.pop("review", None)

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

    if MENTIONS_UNVERIFIED:
        # ⚠️ VISIBLE. Without a gazetteer the provenance check cannot run, and
        # a save that quietly accepted every id looks identical to one that
        # verified them — so the fact rides out with the result rather than
        # being inferable only from a file's absence.
        stats["mentions_unverified"] = (
            "no gazetteer — mention ids were NOT checked against the "
            "dictionary pass; run news/scripts/build_gazetteer.py")
    if PARTY_IDS_UNVERIFIED:
        stats["party_ids_unverified"] = (
            "no gazetteer — party tone identities were left unresolved; "
            "run news/scripts/build_gazetteer.py")
    return emit(0 if not stats["failed"] else 3, mode="save_batch" if args.save_batch else "save_analysis", **stats)


# ------------------------------------------------------------------- queue ---

def attach_dictionary_mentions(queue: list) -> None:
    """Stamp each queue item with what resolve_mentions found.

    ⚠️ ABSENT means „not run", never „nobody was mentioned" — the same
    distinction the `mentions` block itself carries. Without a gazetteer the
    key is omitted and `mentions_note` says why, rather than an empty list
    telling an analyst the article names no one.
    """
    got = _resolver()
    if got is None:
        for item in queue:
            item["mentions_note"] = (
                "not run — news/data/gazetteer.json is absent, so no "
                "mentions were resolved. This is NOT 'no one was mentioned'.")
        return
    rm, gaz = got
    for item in queue:
        try:
            with open(os.path.join(DATA_DIR, item["path"].split("/", 2)[-1]),
                      encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        item["mentions"] = rm.dedupe(rm.resolve(rm.article_text(rec), gaz))
        item["mentions_note"] = (
            "resolved from the gazetteer. You may set `role`, drop a "
            "mention, or ADD one at basis 'not_in_gazetteer' with id null. "
            "You may NOT change an id or a basis — a save that does is "
            "rejected.")


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
    # ⚠️ THE DICTIONARY PASS TRAVELS WITH THE QUEUE, and this is what makes
    # the provenance guard workable rather than adversarial. The analyst is
    # handed the resolved mentions instead of being asked to produce them, so
    # its job narrows to what only it can do — the ROLE each entity plays,
    # and names no gazetteer will ever hold. Everything else is already
    # decided, and check_mention_provenance() refuses any change to it.
    attach_dictionary_mentions(queue)

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


def cmd_redo(args) -> int:
    """Queue named corpus articles for RE-analysis, index membership ignored.

    ⚠️ `--next` exists to find work nobody has done; this exists to redo work
    that was done WRONG. They cannot be the same mode: `--next` skips every
    URL in the index by construction, so the records the review queue flags —
    the only ones anybody ever wants to re-run — are exactly the ones it can
    never return.

    ⚠️ IT WRITES NOTHING AND DELETES NOTHING. The old analysis stays on disk
    until `--save` replaces it, so a re-run that fails or is interrupted
    leaves the record at its previous vintage rather than at none. Deleting
    the analysis file to force it back into `--next` was the obvious
    alternative and has the opposite property.
    """
    if not args.redo:
        return emit(2, error="no_targets", hint="pass one or more URLs or "
                    "news/data/<domain>/<file>.json paths")
    by_url, queue, missing = {}, [], []
    index = load_index()
    for domain in corpus_domains():
        for f in corpus_files(domain) or []:
            rel = rel_corpus_path(domain, f)
            try:
                with open(os.path.join(DATA_DIR, domain, f),
                          encoding="utf-8") as fh:
                    rec = json.load(fh)
            except (OSError, json.JSONDecodeError):
                continue
            by_url[rec.get("url")] = (domain, f, rel, rec)
            by_url[rel] = (domain, f, rel, rec)
    ranks = outlet_ranks()
    for target in args.redo:
        hit = by_url.get(target)
        if not hit:
            missing.append(target)
            continue
        domain, _f, rel, rec = hit
        rank = ranks.get(domain)
        # ⚠️⚠️ THE STORY THE ARTICLE IS ALREADY IN, and carrying it is not a
        # convenience. `analyze_local` stamps every record `action: "none"`
        # because clustering is not its job — correct for a NEW article and
        # DESTRUCTIVE for a re-analysis: „none" DETACHES the article, and a
        # story left with no members is deleted outright. Measured on the
        # first real redo: story 20260822-8cccaffb (1 member) was deleted and
        # its /story/ URL 404'd, while 20260822-ed7347ac went 4 members to 2.
        # The analysis tree is gitignored, so there is no git to recover from.
        story_id = (index.get("articles", {}).get(rec.get("url"))
                    or {}).get("story_id")
        queue.append({
            "path": rel, "domain": domain,
            # ⚠️ ABSENT means „this article is in no story", never „we did
            # not look" — a redo of an unclustered article must stay
            # unclustered rather than inventing a cluster for it.
            **({"story_id": story_id} if story_id else {}),
            "outlet_rank": rank if rank is not None else DEFAULT_OUTLET_RANK,
            "outlet_ranked": rank is not None,
            "order_tier": None, "order_basis": "redo",
            "title": rec.get("title"), "published": rec.get("published"),
            "content_chars": rec.get("content_chars"),
            "author": rec.get("author"),
            "suspect_too_short":
                (rec.get("content_chars") or 0) < MIN_CONTENT_CHARS,
        })
    attach_dictionary_mentions(queue)
    result = {"mode": "redo", "queue": queue,
              "counts": {"requested": len(args.redo), "returned": len(queue)}}
    if missing:
        # ⚠️ NAMED, and a non-zero exit. A redo that silently returned fewer
        # records than it was given would read as "those were fine".
        result["missing"] = missing
        return emit(1, **result)
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
    """(url -> analysis record, url -> the repo-relative path it was READ FROM).

    ⚠️ THE SECOND DICT IS WHERE THE FILE ACTUALLY IS — never
    `analysis_path_for(a["article_path"])`. The index's `path` exists so a
    consumer can OPEN the file, while `article_path` is frozen at analysis time
    and names a CORPUS file that can afterwards be re-saved under a different
    content hash or move to a re-keyed domain directory. Derive the index path
    from that field and a --rebuild REPRODUCES a dangling entry instead of
    repairing it, because the record it read is perfectly present on disk —
    scanning the tree is not enough on its own.

    Measured 2026-08-27 on the live corpus: 5 of 368 entries dangled. Three had
    no analysis on disk at all and the scan drops those; the other two are this
    class — novavarna.net (corpus article re-saved under a new hash, so the
    frozen `article_path` names a file the prune of that bot_refused site left
    behind) and svobodnaevropa.bg re-keyed to svobodnatochka.bg.
    """
    analyses, paths = {}, {}
    if not os.path.isdir(ARTICLES_DIR):
        return analyses, paths
    for domain in sorted(os.listdir(ARTICLES_DIR)):
        d = os.path.join(ARTICLES_DIR, domain)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".json"):
                continue
            full = os.path.join(d, f)
            a = load_json_if_exists(full)
            if isinstance(a, dict) and isinstance(a.get("url"), str):
                analyses[a["url"]] = a
                paths[a["url"]] = os.path.relpath(full, REPO_ROOT)
    return analyses, paths


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

    analyses, analysis_paths = scan_analyses_on_disk()
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
            "path": analysis_paths[url],
            "story_id": membership.get(url),
            "domain": a.get("domain"),
            "analyzed_at": a.get("analyzed_at"),
        }
    write_json_atomic(INDEX_PATH, index)

    # What the rebuild reconciled away, reported rather than silently absorbed.
    # `dropped_orphan_articles` is the prune: an index entry whose analysis is
    # no longer on disk simply does not come back, and saying so is the only
    # way an operator can tell "the corpus shrank" from "the scan found
    # nothing". `stale_article_path` is NOT an error — the index now points at
    # the file that exists either way — but it is the drift that used to
    # publish a dangling path, so it stays visible.
    dropped_articles = sorted(set(old_index.get("articles", {})) - set(analyses))
    stale_paths = sorted(
        url for url, a in analyses.items()
        if not (isinstance(a.get("article_path"), str) and a["article_path"]
                and os.path.exists(os.path.join(REPO_ROOT, a["article_path"])))
    )
    return emit(0, analyses=len(analyses), stories=len(stories),
                dropped_orphan_stories=dropped,
                dropped_orphan_articles=dropped_articles,
                stale_article_path=stale_paths)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 exit_on_error=False)
    modes = ap.add_mutually_exclusive_group(required=True)
    modes.add_argument("--next", dest="next_domain", metavar="DOMAIN|all", help="queue of unanalyzed corpus articles")
    modes.add_argument("--redo", nargs="+", metavar="URL|PATH",
                       help="re-queue already-analysed articles by url or "
                            "corpus path (the review queue's targets)")
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
        if args.redo:
            return cmd_redo(args)
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
