#!/usr/bin/env python3
"""Bundle the news corpus + analysis into static JSON for the newsapp (news.electionsbg.com).

Reads three layers under news/data (see .zcode/skills/analyze-news-article/SKILL.md for
the full schemas):

  * corpus        — news/data/<domain>/<file>.json, one article per file
                    (title/url/published/author/topic/keywords/description/content…)
  * analysis      — news/data/analysis/articles/<domain>/<file>.json (LLM rubric per
                    article: quality, summaries, leaning, russia_stance, ai_generated,
                    entities, party_tones, topics, story membership) and
                    news/data/analysis/stories/<id>.json (same-event clusters with
                    per-story aggregates)
  * reference     — news/topics.json (26 categories / 103 subcategories) and
                    news/data/bg_news_sites.csv (outlet rank/tier/type/scope)

and writes the app-facing bundles consumed by the standalone newsapp's data client
(newsapp/app/data.ts; the app itself is built by vite.config.news.ts):

  stats.json                corpus/analysis totals + per-category usage counts
  outlets.json              one entry per CSV outlet (+ any data-only domains), with
                            a `retired` flag and reason for outlets removed from the
                            registry — their articles stay, but the app must not
                            present them as live sources, and two asked not to be
                            crawled at all
                            article/analysis counts and leaning/russia/ai distributions
  taxonomy.json             categories/subcategories with bg/en labels + usage counts
  stories.json              all story clusters: canonical titles, summaries, aggregates,
                            members joined to corpus headlines, computed blindspot flag
  latest.json               the N most recent articles corpus-wide (compact + analysis)
  articles/<domain>.json    compact per-outlet article list; analyzed articles carry the
                            full analysis block so /article/:domain/:id is a single fetch

Stdlib only, mirroring the other news/scripts tools. Article bodies are deliberately NOT
bundled — the app shows excerpts/summaries and links out to the source (ground.news model),
keeping the whole bundle set ~5 MB and free of republication concerns.

Run:  python3 news/scripts/build_app_data.py [--data-dir news/data] [--out news/app-data]
      [--latest 600] [--quiet] [--json]
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import re
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
LEANING_LABELS = {
    "strong_conservative",
    "conservative",
    "neutral",
    "progressive",
    "strong_progressive",
    "not_applicable",
}
LEFT_WING = {"progressive", "strong_progressive"}
RIGHT_WING = {"conservative", "strong_conservative"}
RUSSIA_LABELS = {
    "strong_pro_russia",
    "pro_russia",
    "neutral",
    "anti_russia",
    "strong_anti_russia",
    "not_applicable",
}
AI_VERDICTS = {"likely_human", "unclear", "likely_ai"}
QUALITY_VERDICTS = {
    "ok",
    "paywall_shell",
    "client_render_shell",
    "too_short",
    "not_bulgarian",
    "non_article",
}
# Per-outlet CONDUCT, always as counts beside their denominators.
#
# ⚠️ Three measures were planned; two are shipped. Republication is NOT
# derivable from this corpus at all (see the block comment in
# save_articles.py), and the edit rate has a denominator of 2.7% today — so
# each number travels with the population it was computed over, and the app
# refuses to render a rate whose base is too small. A conduct meter drawn from
# two records is the same lie as a spectrum bar drawn from two articles.
EMPTY_CONDUCT = {
    "articles": 0,
    "with_author": 0,
    "updated_known": 0,
    "edited_after_publication": 0,
}


# The ordinal position of each label on its axis, for the topic-spread measure.
#
# ⚠️ ORDINAL, not categorical. „strong_progressive vs progressive" is a near
# miss; „strong_progressive vs strong_conservative" is a real disagreement,
# and a categorical measure (entropy, Simpson) scores those the same. Spread
# on a -2..+2 scale respects the order the scale was designed with — the same
# argument the plan makes for ordinal-weighted Cohen's κ in T4.3.
#
# ⚠️ `not_applicable` HAS NO POSITION and is excluded, not mapped to 0. It is
# the majority verdict, and folding it into the centre would drag every
# topic's spread toward zero and make the whole measure read "the media
# agree" — which is the opposite of what it would mean.
AXIS_POSITIONS = {
    "leaning": {
        "strong_progressive": -2, "progressive": -1, "neutral": 0,
        "conservative": 1, "strong_conservative": 2,
    },
    "russia_stance": {
        "strong_pro_russia": -2, "pro_russia": -1, "neutral": 0,
        "anti_russia": 1, "strong_anti_russia": 2,
    },
}

# Positioned articles a topic needs before its spread is published.
#
# ⚠️ Measured 2026-08-26, NO topic clears this — the best is foreign-policy
# with 15 positioned on the Russia axis and 4 on the political one. The screen
# therefore ships with the measure defined and every topic reported as short,
# which is the honest state: a "most divisive topics" ranking computed over
# n=4 would be decoration with a number attached.
TOPIC_MIN_POSITIONED = 20


def axis_spread(counts: dict, axis: str) -> dict:
    """Population standard deviation of an axis's positioned verdicts.

    Returns the spread, the sample it was computed over, and whether that
    sample clears the floor — never a bare number. A consumer that cannot see
    `n` cannot tell 1.4 over four articles from 1.4 over four hundred.

    `counts` maps a verdict label to how many articles carried it. It tolerates
    None, an empty dict, a count of None or 0, and any label outside
    AXIS_POSITIONS — each of which contributes nothing to `n` rather than
    raising or being scored as a centre position. A NEGATIVE count is the one
    malformed input that cannot be tolerated silently, since it would subtract
    from a sample size, so it raises.

    `axis` must be a key of AXIS_POSITIONS; an unknown axis raises rather than
    returning an empty result, because "this axis has no positions" and "you
    asked for an axis that does not exist" are different answers and only the
    second is a bug in the caller.

    Computed FROM THE COUNTS rather than by expanding them into one value per
    article: the sums of x and x^2 are all a population variance needs, and a
    single topic can carry thousands of articles.
    """
    positions = AXIS_POSITIONS[axis]
    n = 0
    total = 0
    total_sq = 0
    for label, count in (counts or {}).items():
        if label not in positions:
            continue  # not_applicable, or a label this build does not know
        c = int(count or 0)
        if c < 0:
            raise ValueError(
                f"axis_spread: negative count {c} for {axis} label {label!r} — "
                "a sample size cannot be reduced by a verdict")
        if not c:
            continue
        pos = positions[label]
        n += c
        total += pos * c
        total_sq += pos * pos * c
    if n < 2:
        # ⚠️ A single article has a standard deviation of exactly 0.0, which
        # renders as "total agreement" about a topic one person wrote about.
        return {"spread": None, "n": n, "enough": False}
    mean = total / n
    var = total_sq / n - mean * mean
    return {
        # max(var, 0) guards catastrophic cancellation: the sum-of-squares
        # form can land a hair below zero when the variance is genuinely 0,
        # and a negative ** 0.5 is a COMPLEX number in Python — which would
        # ship as a crash (or as "(0.0+0j)") rather than the 0.0 it means.
        "spread": round(max(var, 0.0) ** 0.5, 2),
        "n": n,
        "enough": n >= TOPIC_MIN_POSITIONED,
    }

LOGO_COLUMN_PREFIX = "logo_url"
# Whether the outlet's CDN serves an image to OUR referer, from
# probe_hotlink.py. `false` lets a card skip straight to the logo tile instead
# of re-requesting a photo the outlet has said it will not serve us — a 403 is
# a policy signal, and re-asking on every card is both pointless and rude.
HOTLINK_COLUMN_PREFIX = "hotlink_ok"

# Ownership. Four dated registry columns, ALL HAND-ENTERED — see the block
# comment in outlets.json's builder for why none of it may be inferred.
OWNER_COLUMN_PREFIXES = ("owner", "owner_category", "owner_source",
                         "owner_checked")

# Ground News publishes eight ownership categories and they are a reasonable
# starting vocabulary, so this is theirs. It is NOT obviously the right
# partition for Bulgarian media and should be revisited against real
# structures before the column is filled in bulk.
OWNER_CATEGORIES = frozenset({
    "media_conglomerate", "private_equity", "individual", "government",
    "telecom", "corporation", "independent", "other",
})

# The shape newsapp/app/data.ts declares for Story.entities / Story.aggregates.
# Both are dereferenced unguarded by StoryScreen and StoryCard, so every story
# must carry every key even when the analysis layer produced none.
EMPTY_STORY_ENTITIES = {"people": [], "parties": [], "institutions": [],
                        "companies": [], "places": []}
EMPTY_STORY_AGGREGATES = {"article_count": 0, "outlet_count": 0,
                          "by_leaning": {}, "by_russia_stance": {},
                          "by_domain": {}}

# CSV column headers carry a data-vintage suffix (_aug2026); match by prefix so a new
# vintage only changes the suffix, not this script.
CSV_COLUMN_PREFIXES = (
    "rank",
    "tier",
    "domain",
    "outlet",
    "type",
    "scope",
    "similarweb_visits",
    # ⚠️ logo_url is deliberately NOT here. colmap folds every vintage onto one
    # logical name and the row comprehension resolves the duplicate by COLUMN
    # ORDER — last wins, including a last that is blank, which is exactly what
    # a re-mint produces. The logo family is read separately, through
    # pick_dated_column, and adding it back here would be dead config at best.
)


def norm_domain(raw) -> str:
    """A registry domain, normalised the SAME way on every read path.

    Two readers normalising differently is how one outlet becomes two rows —
    one live, one retired — and the app then shows a retired source as active
    beside itself."""
    return (raw or "").strip().lower().removeprefix("www.")


def pick_dated_column(row: dict, prefix: str) -> str | None:
    """The value of a dated column family, LAST NON-EMPTY wins.

    THE ONE DEFINITION for both registries. Two things it has to get right,
    and the first cut got both wrong in different files:

    ⚠️ Vintages ACCUMULATE. resolve_outlet_logos.py appends `logo_url_<new>`
    beside the old one rather than renaming, and it starts the new column
    EMPTY, filling only the outlets it could reach. A plain last-wins then
    takes the blank cell for every outlet the new pass failed on (Cloudflare,
    bot_refused) and overwrites a perfectly good logo with None. Skipping
    empties makes a re-mint additive: a newly resolved value wins, a gap keeps
    what we had.

    ⚠️ The match is `== prefix` or `prefix + "_<vintage>"`, never a bare
    startswith, and the VINTAGE MUST BE A SINGLE TOKEN. Both halves are load-
    bearing and each was got wrong once:

      - a bare startswith matches `logo_urls_backup`, which the retired reader
        published as an outlet's mark;
      - `prefix + "_"` alone matches a SIBLING FIELD. `owner` matches
        `owner_category_aug2026`, `owner_source_aug2026` and
        `owner_checked_aug2026`, so last-non-empty returned the check DATE as
        the owner's NAME — a fabricated claim about who owns a newsroom,
        produced by a prefix rule.

    Requiring the remainder to carry no further underscore separates
    `owner_aug2026` (vintage) from `owner_category_aug2026` (sibling), and
    still admits `logo_url_aug2026` and `similarweb_visits_jul2026`, whose
    underscores are inside the PREFIX rather than after it."""
    best = None
    for key, value in row.items():
        if not key:
            continue
        raw = key.strip().lower()
        if raw != prefix:
            if not raw.startswith(prefix + "_"):
                continue
            if "_" in raw[len(prefix) + 1:]:
                continue
        got = (value or "").strip()
        if got:
            best = got
    return best


def tri_state(raw) -> bool | None:
    """`yes`/`no` from a registry cell, and None for anything else.

    ⚠️ None means NEVER PROBED and is not the same as False. Collapsing them
    would make an outlet we have not asked look like one that refused, and
    only a refusal justifies suppressing the request."""
    got = (raw or "").strip().lower()
    if got in ("yes", "true", "1"):
        return True
    if got in ("no", "false", "0"):
        return False
    return None


def owner_block(meta: dict) -> dict | None:
    """The ownership claim for one outlet, or None when nothing is recorded.

    Returns None rather than a dict of nulls: a block that exists with empty
    fields renders as "ownership: unknown", which is a statement. Absent means
    nobody has looked yet, and the app must be able to tell those apart.

    An unrecognised category is dropped and REPORTED rather than published —
    a free-text value in a controlled column would become a facet nobody can
    filter on, and a typo would silently split an owner in two."""
    name = (meta.get("owner") or "").strip()
    if not name:
        return None
    category = (meta.get("owner_category") or "").strip().lower() or None
    if category and category not in OWNER_CATEGORIES:
        print(f"  ! unknown owner_category {category!r} for "
              f"{meta.get('domain')} — dropped; use one of "
              f"{sorted(OWNER_CATEGORIES)}", file=sys.stderr)
        category = None
    source = (meta.get("owner_source") or "").strip() or None
    checked = (meta.get("owner_checked") or "").strip() or None
    # ⚠️ REFUSED without both, rather than published with nulls. This
    # function's own docstring and the outlets.json comment both say `checked`
    # is part of the CLAIM — and then the first cut returned a full block with
    # `source: None, checked: None`, which renders as a present-tense,
    # unsourced, undated assertion about who owns a named newsroom. Nothing
    # else in the pipeline can catch that: the row looks complete.
    if not source or not checked:
        print(f"  ! owner recorded for {meta.get('domain')} without "
              f"{'a source' if not source else 'a checked date'} — REFUSED. "
              f"An ownership claim publishes both or neither.", file=sys.stderr)
        return None
    return {
        "name": name,
        "category": category,
        "source": source,
        "checked": checked,
    }


# The skill name the changelog entry is filed under. `save-news-articles` is
# the skill an operator actually runs; this script is the last step of it, and
# is the only step that knows the corpus totals worth reporting.
CHANGELOG_SKILL = "save-news-articles"
CHANGELOG_SOURCE = "Български новинарски корпус"
# Named so a test can shorten it. Generous: `tsx` compiles the CLI on
# first run, and a cold node start on a loaded machine is seconds.
STAMP_TIMEOUT_SECONDS = 180


def stamp_data_change(summary: str, repo: Path) -> dict:
    """Append one row to data/data-changes.json via the repo's own CLI.

    ⚠️ Shells out rather than writing the file. `scripts/lib/data-changes.ts`
    is the ONE writer — it owns the schema, the per-skill link table and the
    no-op guard that keeps bootstrap runs off the public page. A second
    implementation here, in a different language, is how two writers come to
    disagree about a format neither of them owns.

    Never fatal: the bundle is already written and correct by this point, and
    a missing `npx` (or a repo checked out without node_modules) must not fail
    a data build.
    """
    cli = repo / "scripts" / "append-data-change.ts"
    if not cli.exists():
        return {"stamped": False, "reason": "append-data-change.ts not found"}
    # ⚠️ node_modules/.bin/tsx directly, NOT `npx tsx`. `npx` is a wrapper that
    # spawns node, which spawns tsx — a three-deep tree — and killing the
    # direct child on timeout leaves both descendants alive. Measured: after
    # the timeout fired, the orphans were still running and went on to write
    # data-changes.json, so the caller reported NOT stamped about a row that
    # had been appended. A shallower tree plus a process GROUP kill is what
    # makes the timeout mean something.
    runner = repo / "node_modules" / ".bin" / "tsx"
    if not runner.exists():
        return {"stamped": False, "reason": "node_modules/.bin/tsx not found "
                                            "— run npm install"}
    argv = [str(runner), str(cli), CHANGELOG_SKILL,
            "--summary", summary, "--source", CHANGELOG_SOURCE]
    try:
        # The summary reaches the CLI as one argv element and never touches a
        # shell — no shell=True anywhere on this path.
        proc = subprocess.Popen(
            argv, cwd=str(repo), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, start_new_session=True)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"stamped": False, "reason": f"{type(exc).__name__}: {exc}"}
    try:
        stdout, stderr = proc.communicate(timeout=STAMP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        terminate_tree(proc)
        proc.communicate()
        return {"stamped": False,
                "reason": f"timed out after {STAMP_TIMEOUT_SECONDS}s"}
    if proc.returncode != 0:
        return {"stamped": False, "reason": (stderr or "").strip()[-200:]}
    out = (stdout or "").strip()
    # The CLI prints "· skipped …" when its own no-op guard fires. Reported
    # rather than swallowed: "nothing changed" and "the stamp failed" are
    # different states and a caller must be able to tell them apart.
    return {"stamped": not out.startswith("·"), "detail": out[-200:]}


def terminate_tree(proc) -> str:
    """SIGKILL a timed-out child AND its descendants. Returns what it did.

    ⚠️ The whole point is the DESCENDANTS. A JS runner is not one process —
    measured on the first cut, `npx tsx <file>` is three deep, and killing the
    direct child left both grandchildren alive: they went on to write
    data-changes.json while the caller reported the stamp as failed. Only a
    process-GROUP kill reaches them, which is why the child is launched with
    start_new_session.

    ⚠️ And only ever kill a group we CREATED. Demonstrated the hard way while
    mutation-testing this: with start_new_session removed the child shares OUR
    group, and killpg then takes down the caller — the build, the test runner,
    whatever launched it. One syscall turns a catastrophic failure into a
    leaked child."""
    try:
        group = os.getpgid(proc.pid)
    except OSError:
        proc.kill()
        return "kill:no-group"
    if group == os.getpgid(0):
        proc.kill()
        return "kill:own-group"
    try:
        os.killpg(group, signal.SIGKILL)
        return "killpg"
    except OSError:
        proc.kill()
        return "kill:killpg-failed"


def bg_plural(n: int, one: str, many: str) -> str:
    """`n` with its Bulgarian noun form.

    Bulgarian has no "1 статии". The summary is read by a person on a public
    page, and a corpus that has just been rebuilt down to one article is
    exactly when somebody is looking at it."""
    return f"{n} {one if abs(n) == 1 else many}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))


# Record keys the shared feed does NOT carry. Named once so the omission is a
# decision with a reason rather than a field somebody forgot; the per-domain
# bundle keeps them, and the article page reads that.
FEED_OMIT = frozenset({"section_path", "image_alt", "first_seen"})

# The gzip ceiling for latest.json. Not a guess: measured 2026-08-26 at 600
# records, 174.7 KB gzip BEFORE the metadata fields and 183 KB after, and the
# corpus grows ~1-2 KB per day. Past this the answer is to PAGINATE the feed,
# never to raise the number — every page in the app downloads this file before
# it can paint.
#
# ⚠️ Measured at gzip -9 while a CDN typically serves -6, so the real wire size
# is a few percent HIGHER than what this check sees. That is the safe
# direction (the check trips slightly late rather than early), but do not read
# a figure here as the bytes a reader downloads.
#
# ⚠️ FEED_OMIT buys only ~1.5 KB. The expensive unconsumed field is `keywords`
# at ~17 KB gzip — no screen renders it today. Drop that before widening this.
FEED_GZIP_BUDGET_BYTES = 220 * 1024


def excerpt_of(article: dict, limit: int = 480) -> str:
    text = (article.get("description") or "").strip()
    if not text:
        text = re.sub(r"\s+", " ", (article.get("content") or "")).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + "…"


def load_story_index(data_dir: Path) -> dict[str, str]:
    """url -> resolved story_id from analysis/index.json.

    The `story` block inside an analysis record is the raw LLM decision (null
    story_id for every new_story), so resolved membership lives only in the index
    that analyze_articles.py maintains — this is the authoritative join."""
    idx_path = data_dir / "analysis" / "index.json"
    try:
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        url: entry.get("story_id")
        for url, entry in (idx.get("articles") or {}).items()
        if entry.get("story_id")
    }


def load_analysis(data_dir: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return (by_url, by_article_id) maps of analysis records."""
    by_url: dict[str, dict] = {}
    by_article_id: dict[str, dict] = {}
    base = data_dir / "analysis" / "articles"
    if not base.is_dir():
        return by_url, by_article_id
    for domain_dir in sorted(base.iterdir()):
        if not domain_dir.is_dir():
            continue
        for fp in sorted(domain_dir.glob("*.json")):
            try:
                rec = json.loads(fp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"  ! skipping unreadable analysis {fp}: {exc}", file=sys.stderr)
                continue
            if rec.get("url"):
                by_url[rec["url"]] = rec
            by_article_id[f'{rec.get("domain")}/{fp.stem}'] = rec
    return by_url, by_article_id


_GAZ: list = []


def gazetteer():
    """The gazetteer, loaded once, or None.

    ⚠️ ABSENT IS TOLERATED. A checkout that has never run build_gazetteer.py
    must still build a site — it simply builds one with no entity links,
    which is what it had before. Refusing here would make an optional
    enrichment a hard build dependency.
    """
    if not _GAZ:
        try:
            import resolve_mentions as rm
            # ⚠️ REPO-relative, not from the `--data-dir` flag: the loader
            # is a module-level helper and the flag is a local in main(). The
            # test harness sets DATA_BG_ROOT, which REPO already honours, so
            # a fixture root gets its own gazetteer rather than the real one.
            path = REPO / "news" / "data" / "gazetteer.json"
            _GAZ.append(rm.Gazetteer.load(path) if path.exists() else None)
        except Exception:  # noqa: BLE001
            _GAZ.append(None)
    return _GAZ[0]


def links_for(entities: dict) -> dict:
    """name → main-site link, for the entity strings that earned one."""
    gaz = gazetteer()
    if gaz is None or not entities:
        return {}
    import resolve_mentions as rm
    return rm.entity_links(entities, gaz)


# ── Names the article never wrote ─────────────────────────────────────────
# ⚠️ A VALIDATOR IS NOT RETROACTIVE. `analyze_articles` refuses an altered
# person name at save time now, but three records written before it carry
# one — „Антон Славев" where the article says „Антон Славчев", „Кая Каллас"
# where it says „Кая Калас". Publishing those is a claim about somebody who
# may not exist: „Антон Славев" matches nobody in the identity layer.
#
# ⚠️ WITHHELD, NEVER CORRECTED. The near-token is what the SEARCH found, not
# what the model meant; rewriting „Славев" to „Славчев" would be the graded
# guess this project refuses everywhere else. Dropping the name loses one
# chip; inventing one publishes a person.
#
# The rule itself is `analyze_articles.altered_person_names` and lives only
# there — a second copy here is how a pipeline comes to refuse a record at
# save time and publish it anyway.
_WITHHELD: dict = {"names": 0, "records": 0, "prose": 0}


def _article_text(rel: str) -> dict:
    """One corpus article, or {} — a missing file must not refuse a name."""
    try:
        return json.loads((REPO / rel).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def altered_names(entities: dict, texts: list) -> list:
    """[(name, our token, the article's token)] — the rule lives elsewhere."""
    if not entities:
        return []
    try:
        import analyze_articles as aa
        return aa.altered_person_names(entities, texts)
    except Exception:  # noqa: BLE001
        return []


def verified_entities(entities: dict, bad: list) -> dict:
    """`entities` with any altered person name removed."""
    names = {n for n, _, _ in bad}
    if not names:
        return entities
    _WITHHELD["names"] += len(names)
    _WITHHELD["records"] += 1
    people = [n for n in (entities.get("people") or []) if n not in names]
    return {**entities, "people": people}


# ⚠️ A CODE, NOT PROSE. The reason travels to the app so the reader sees a
# stated refusal instead of an unexplained gap — but the WORDING belongs to
# the app, beside every other Bulgarian string it renders. A sentence written
# here would be the one piece of UI copy living in the pipeline.
WITHHELD_ALTERED_NAME = "altered_name"


def verified_prose(rec: dict, fields: tuple, bad: list) -> dict:
    """The prose fields that do NOT repeat an altered name.

    ⚠️ WITHHOLDING THE CHIP IS NOT ENOUGH — the summary is what the reader
    actually reads. All five affected records repeat the altered surname in
    `summary_bg`, so dropping it from `entities` alone left „ИД-председателят
    на КПКОНПИ Антон Славев е получил…" as the story's lead paragraph.

    ⚠️ PER FIELD, not per record, and that is the point: in every one of the
    five the ENGLISH summary has the name RIGHT („Anton Slavchev"), so the
    slip is Bulgarian-side. Withholding the pair would delete a correct
    sentence to punish a wrong one. `SummaryPair` already renders „Липсва
    резюме на български." in the gap.
    """
    if not bad:
        return {}
    try:
        import resolve_mentions as rm
    except Exception:  # noqa: BLE001
        return {}
    toks = {rm.fold(t) for _, t, _ in bad}
    out, why = {}, {}
    for f in fields:
        v = rec.get(f)
        if not v:
            out[f] = v
            continue
        if toks & {rm.fold(t) for t in rm.TOKEN_RE.findall(str(v))}:
            _WITHHELD["prose"] += 1
            out[f] = None
            why[f] = WITHHELD_ALTERED_NAME
        else:
            out[f] = v
    # ⚠️ Under a key no prose field can collide with, and ABSENT when nothing
    # was withheld — an empty map would make „we published everything" and
    # „we checked nothing" the same value.
    if why:
        out["_withheld"] = why
    return out


def compact_analysis(rec: dict, article: dict) -> dict:
    """Keep everything the article page renders; drop bookkeeping (paths, timestamps)."""
    bad = altered_names(rec.get("entities"), [article])
    ents = verified_entities(rec.get("entities"), bad)
    prose = verified_prose(rec, ("summary_bg", "summary_en"), bad)
    return {
        "summary_bg": prose.get("summary_bg", rec.get("summary_bg")),
        "summary_en": prose.get("summary_en", rec.get("summary_en")),
        **({"withheld": prose["_withheld"]} if prose.get("_withheld") else {}),
        "leaning": rec.get("leaning"),
        "russia_stance": rec.get("russia_stance"),
        "ai_generated": rec.get("ai_generated"),
        "entities": ents,
        # ⚠️ A SIDECAR keyed by the name as written, never a rewrite of
        # `entities` itself — that block is a dict of plain strings the story
        # clustering iterates, and putting objects in it breaks every
        # aggregate (see the MENTION_KINDS note in analyze_articles.py). A
        # name that did not resolve is simply absent, so a renderer cannot
        # turn a null into a dead link.
        **({"entity_links": links} if (links := links_for(ents))
           else {}),
        # ⚠️ The resolved, linkable SIBLING of `entities` — not a replacement.
        # `entities` stays a dict of plain strings because story clustering
        # iterates it (see the MENTION_KINDS block in analyze_articles.py).
        #
        # ⚠️ ABSENT means "this record predates mentions", which is every one
        # of the 365 analyses on disk today; an empty list would mean "this
        # article mentions nobody". The key is therefore OMITTED rather than
        # defaulted, so no consumer can count a silence as a zero.
        **({"mentions": rec["mentions"]} if rec.get("mentions") is not None
           else {}),
        "party_tones": rec.get("party_tones"),
        "topics": rec.get("topics"),
        "quality": rec.get("quality"),
        "site_relevant": rec.get("site_relevant"),
        "model": rec.get("model"),
        "analyzed_at": rec.get("analyzed_at"),
    }


def attach_scoop_lag(members: list[dict]) -> None:
    """Stamp each member with how far behind the cluster's first sighting it is.

    ⚠️ Keyed on `first_seen` (our `fetched_at`), NOT on `published`, and the
    difference is the whole point. A publication timestamp is set by the
    outlet: 13% of the corpus has none at all, and the rest is trivially
    back-dated — so "who broke it" measured on `published` is a claim about
    whose CMS says what, not about who was first. `first_seen` is ours, is
    always present, and its bias is knowable (a source we sweep less often
    looks later than it was).

    ⚠️⚠️ `first_here` IS A RACE RESULT, SO IT NEEDS A RACE. Two conditions
    have to hold before it can be true, and the first cut checked neither:

      - at least TWO DISTINCT OUTLETS. A single-outlet cluster has no
        competitor, so "first to report" is not a weak claim, it is a
        meaningless one. Measured on the real corpus before this guard: 72 of
        74 single-member stories published `first_here: true`.
      - a DISTINGUISHABLE lead. If every member sits inside SCOOP_TIE_HOURS
        the instrument cannot separate them, and flagging all of them says
        nothing while looking like a finding — 9 of 12 multi-member stories
        flagged every member, mean 89.1%.

    When neither holds, `scoop_decidable` is False and no member is flagged.
    The LAG is still reported, because "everyone within the hour" is a true
    and useful description; only the winner's rosette is withheld.

    `scoop_lag_hours` is None where we cannot tell, which a consumer must
    render as "unknown" and never as zero.
    """
    stamped = [(m, parse_iso_utc(m.get("first_seen"))) for m in members]
    times = [t for _, t in stamped if t is not None]
    # ⚠️ min() over parsed datetimes, never over the raw strings. A
    # lexicographic min across mixed UTC offsets picks the wrong baseline and
    # then hands a NEGATIVE lag to the outlet that actually was first, and 0.0
    # ("was first") to one that was not. Every fetched_at is +00:00 today —
    # this is what keeps that from being load-bearing.
    base = min(times) if times else None
    domains = {m.get("domain") for m, t in stamped if t is not None}
    for m, got in stamped:
        if base is None or got is None:
            m["scoop_lag_hours"] = None
            m["first_here"] = False
            m["scoop_decidable"] = False
            continue
        m["scoop_lag_hours"] = round((got - base).total_seconds() / 3600.0, 2)
    spread = (max(times) - base).total_seconds() / 3600.0 if times else 0.0
    decidable = len(domains) >= 2 and spread > SCOOP_TIE_HOURS
    for m, got in stamped:
        if got is None:
            continue
        m["scoop_decidable"] = decidable
        m["first_here"] = bool(
            decidable and m["scoop_lag_hours"] <= SCOOP_TIE_HOURS)


# Below this, two sightings are the same sweep as far as this instrument can
# tell. Deliberately generous: the sweep is sequential over ~60 domains, so
# minutes of spread between two outlets is our scheduling, not their newsroom.
SCOOP_TIE_HOURS = 1.0


def parse_iso_utc(value):
    """An ISO timestamp as an aware datetime, or None. Never raises."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def blindspot_of(members: list[dict]) -> dict | None:
    """Ground.news-style blindspot: a story with ≥2 leaning-labeled members where one
    political wing is entirely absent. Returns {"side": <missing wing>} or None. Neutral
    and not_applicable members carry no wing signal and never trigger a blindspot."""
    labelled = [m for m in members if m.get("leaning") in LEFT_WING | RIGHT_WING]
    if len(labelled) < 2:
        return None
    has_left = any(m["leaning"] in LEFT_WING for m in labelled)
    has_right = any(m["leaning"] in RIGHT_WING for m in labelled)
    if has_left and not has_right:
        return {"side": "right"}
    if has_right and not has_left:
        return {"side": "left"}
    return None


def rank_of(meta: dict) -> int:
    """CSV sort key; non-numeric ranks (future vintages: n/a, 100+, –) sort last."""
    raw = str(meta.get("rank") or "")
    return int(raw) if raw.isdigit() else 10**9


def parse_visits(raw: str | None) -> int | None:
    """'18.3M'/'940K'/'123' -> visit count, so consumers never parse suffixes."""
    if not raw:
        return None
    m = re.fullmatch(r"([\d.]+)\s*([KMB]?)", raw.strip(), flags=re.IGNORECASE)
    if not m:
        return None
    mult = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[m.group(2).upper()]
    try:
        return int(float(m.group(1)) * mult)
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, default=REPO / "news" / "data")
    ap.add_argument("--out", type=Path, default=REPO / "news" / "app-data")
    ap.add_argument("--latest", type=int, default=600)
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument(
        "--stamp", action="store_true",
        help="append a row to data/data-changes.json, the site-wide feed "
             "behind /data/updates. Off by default: a rebuild is not an "
             "ingest, and stamping every local rebuild would fill a public "
             "page with entries nobody acted on.")
    ap.add_argument(
        "--json",
        action="store_true",
        help="print the summary as one JSON object on stdout (orchestration contract "
        "shared with fetch_latest_articles.py / save_articles.py / analyze_articles.py)",
    )
    args = ap.parse_args()

    data_dir: Path = args.data_dir
    out_dir: Path = args.out
    generated_at = now_iso()
    verbose = not args.quiet

    # ---- reference data -----------------------------------------------------------
    try:
        taxonomy_doc = json.loads((REPO / "news" / "topics.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"fatal: cannot read {REPO / 'news' / 'topics.json'}: {exc}", file=sys.stderr)
        return 1
    categories = taxonomy_doc.get("categories", [])

    outlets_csv: dict[str, dict] = {}
    csv_path = data_dir / "bg_news_sites.csv"
    if csv_path.exists():
        with csv_path.open(encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            # Map suffixed headers (rank_aug2026…) back to their logical names.
            colmap = {}
            for raw in reader.fieldnames or []:
                for prefix in CSV_COLUMN_PREFIXES:
                    if raw == prefix or raw.startswith(prefix + "_"):
                        colmap[raw] = prefix
                        break
            for row in reader:
                item = {colmap.get(k, k): (v or None) for k, v in row.items() if colmap.get(k)}
                # ⚠️ The comprehension above resolves a duplicated logical name
                # by COLUMN ORDER — last wins, INCLUDING a last that is blank.
                # Logo vintages accumulate rather than being renamed, and a
                # re-mint starts the new column empty, so plain last-wins
                # overwrites every good logo the new pass could not re-resolve.
                # Re-read that one family through the shared rule.
                item[LOGO_COLUMN_PREFIX] = pick_dated_column(
                    row, LOGO_COLUMN_PREFIX)
                for prefix in OWNER_COLUMN_PREFIXES:
                    item[prefix] = pick_dated_column(row, prefix)
                item[HOTLINK_COLUMN_PREFIX] = pick_dated_column(
                    row, HOTLINK_COLUMN_PREFIX)
                # ⚠️ Normalised on BOTH sides, identically. The retired
                # reader strips its domain and this one did not, so a row with
                # stray whitespace or a capital published the SAME outlet
                # twice — once live, once retired — a duplicate the old
                # domain_names-only loop could not produce.
                domain = norm_domain(item.get("domain"))
                if domain:
                    item["domain"] = domain
                    outlets_csv[domain] = item

    # Outlets removed from the registry. Their articles were collected in good
    # faith and stay in the bundle — deleting real reporting because the source
    # later declined to be crawled would be the wrong correction — but the app
    # must not present a retired outlet as a live source, and two of these
    # asked not to be crawled at all.
    retired: dict[str, dict] = {}
    retired_path = data_dir / "retired_sites.csv"
    if retired_path.exists():
        try:
            with retired_path.open(encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    domain = norm_domain(row.get("domain"))
                    if domain:
                        retired[domain] = {
                            "reason": (row.get("reason") or "").strip() or None,
                            "retired_on": (row.get("retired_on") or "").strip() or None,
                            # ⚠️ The outlet's NAME, type and scope. Without
                            # them a retired row renders as a bare domain
                            # wherever it is listed — "btvnovinite.bg" where
                            # "bTV Новините" belongs — and the retired_sites
                            # CSV has carried all three from the start.
                            "outlet": (row.get("outlet") or "").strip() or None,
                            "type": (row.get("type") or "").strip() or None,
                            "scope": (row.get("scope") or "").strip() or None,
                            # Dated column, through the SAME rule the live
                            # registry uses — a retired outlet still renders
                            # its own mark rather than a monogram. Two
                            # hand-written matchers is how `logo_urls_backup`
                            # got published as somebody's logo.
                            "logo_url": pick_dated_column(
                                row, LOGO_COLUMN_PREFIX),
                            # ⚠️ Read here too, or the tri-state collapses
                            # false -> null for every retired outlet. It did:
                            # novavarna.net is `no` in the CSV and was `null`
                            # in the artifact — and it is the outlet retired
                            # for bot_refused, with image-bearing articles
                            # still in the feed.
                            "hotlink_ok": pick_dated_column(
                                row, HOTLINK_COLUMN_PREFIX),
                        }
        except (OSError, csv.Error, UnicodeDecodeError):
            pass

    # ---- corpus + analysis --------------------------------------------------------
    conduct_by_domain: dict[str, dict[str, int]] = {}
    topic_axes: dict[str, dict] = {}
    analysis_by_url, analysis_by_id = load_analysis(data_dir)
    story_index = load_story_index(data_dir)
    domain_names = sorted(
        d.name
        for d in data_dir.iterdir()
        if d.is_dir() and not d.name.startswith("_") and d.name != "analysis"
    )

    articles_by_domain: dict[str, list[dict]] = {}
    all_latest: list[dict] = []
    leaning_by_domain: dict[str, dict[str, int]] = {}
    russia_by_domain: dict[str, dict[str, int]] = {}
    ai_by_domain: dict[str, dict[str, int]] = {}
    analyzed_by_domain: dict[str, int] = {d: 0 for d in domain_names}
    topic_article_counts: dict[tuple[str, str | None], int] = {}

    for domain in domain_names:
        records: list[dict] = []
        for fp in sorted((data_dir / domain).glob("*.json")):
            try:
                art = json.loads(fp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                print(f"  ! skipping unreadable article {fp}: {exc}", file=sys.stderr)
                continue
            analysis = analysis_by_url.get(art.get("url")) or analysis_by_id.get(
                f"{domain}/{fp.stem}"
            )
            rec = {
                "id": fp.stem,
                "domain": domain,
                "title": art.get("title"),
                "url": art.get("url"),
                "published": art.get("published"),
                "author": art.get("author"),
                "topic": art.get("topic"),
                "keywords": art.get("keywords"),
                "excerpt": excerpt_of(art),
                "content_chars": art.get("content_chars"),
                # `excerpt` IS the outlet's own og:description where there is
                # one (99% of records), falling back to the head of the body.
                # There is no separate "description" field to add — the
                # importer has always carried it; only the name changes here.
                "image": art.get("image"),
                "image_alt": art.get("image_alt"),
                "canonical": art.get("canonical"),
                "language": art.get("language"),
                "section_path": art.get("section_path"),
                "updated": art.get("updated"),
                # When WE first saw it. The scoop measure keys on this rather
                # than on `published`, which the outlet controls and 13% of
                # the corpus lacks entirely.
                "first_seen": art.get("fetched_at"),
                "story_id": None,
            }
            if analysis:
                # Resolved story membership comes from the index (the decision block
                # carries story_id only for same_story attachments).
                rec["story_id"] = story_index.get(art.get("url")) or (
                    analysis.get("story") or {}
                ).get("story_id")
                rec["analysis"] = compact_analysis(analysis, art)
                analyzed_by_domain[domain] = analyzed_by_domain.get(domain, 0) + 1
                lean = (analysis.get("leaning") or {}).get("label")
                stance = (analysis.get("russia_stance") or {}).get("label")
                ai = (analysis.get("ai_generated") or {}).get("verdict")
                if lean in LEANING_LABELS:
                    bucket = leaning_by_domain.setdefault(domain, {})
                    bucket[lean] = bucket.get(lean, 0) + 1
                if stance in RUSSIA_LABELS:
                    bucket = russia_by_domain.setdefault(domain, {})
                    bucket[stance] = bucket.get(stance, 0) + 1
                if ai in AI_VERDICTS:
                    bucket = ai_by_domain.setdefault(domain, {})
                    bucket[ai] = bucket.get(ai, 0) + 1
                for t in analysis.get("topics") or []:
                    key = (t.get("category"), t.get("subcategory"))
                    topic_article_counts[key] = topic_article_counts.get(key, 0) + 1
                # Per-CATEGORY distributions, from the PRIMARY topic only. An
                # article tagged with three topics is one article about its
                # primary subject; counting it into all three would let one
                # piece move three topics' spread at once.
                primary = next((t for t in (analysis.get("topics") or [])
                                if t.get("primary")), None)
                if primary and primary.get("category"):
                    cat = topic_axes.setdefault(
                        primary["category"],
                        {"articles": 0, "outlets": set(),
                         "leaning": {}, "russia_stance": {}})
                    cat["articles"] += 1
                    cat["outlets"].add(domain)
                    # ⚠️ VALIDATED, like the per-domain buckets above. A bare
                    # truthiness test ships a model's out-of-vocabulary label
                    # into taxonomy.json: the client counts it as positioned
                    # (it is not not_applicable) while axis_spread ignores it,
                    # so the bar and the sample size disagree about the same
                    # distribution, and the payload violates its own TS type.
                    if lean in LEANING_LABELS:
                        cat["leaning"][lean] = cat["leaning"].get(lean, 0) + 1
                    if stance in RUSSIA_LABELS:
                        cat["russia_stance"][stance] = (
                            cat["russia_stance"].get(stance, 0) + 1)
            # ⚠️ COUNTED WITH THEIR DENOMINATORS, never as a bare rate.
            # `updated` is present on 2.7% of the corpus today — only
            # re-extracted domains carry it, and only ~47% of those pages
            # publish a dateModified at all — so an "edit rate" computed
            # against `articles` would be a near-zero number that looks like a
            # finding. The denominator travels with the numerator and the app
            # decides whether it is enough.
            conduct = conduct_by_domain.setdefault(domain, dict(EMPTY_CONDUCT))
            conduct["articles"] += 1
            if art.get("author"):
                conduct["with_author"] += 1
            if art.get("updated"):
                conduct["updated_known"] += 1
                if art.get("published") and art["updated"] != art["published"]:
                    conduct["edited_after_publication"] += 1
            records.append(rec)
            all_latest.append(rec)
        # Newest first; undated records sort last ("" < any ISO date under reverse).
        records.sort(key=lambda r: r.get("published") or "", reverse=True)
        articles_by_domain[domain] = records

    # ---- per-domain bundles --------------------------------------------------------
    for domain, records in articles_by_domain.items():
        write_json(
            out_dir / "articles" / f"{domain}.json",
            {
                "domain": domain,
                "outlet": (outlets_csv.get(domain) or {}).get("outlet") or domain,
                "generated_at": generated_at,
                "articles": records,
            },
        )
    # A renamed/removed corpus domain would otherwise leave its stale bundle behind
    # (the out dir is gitignored, so nothing would surface it).
    articles_out = out_dir / "articles"
    if articles_out.is_dir():
        for fp in articles_out.glob("*.json"):
            if fp.stem not in articles_by_domain:
                fp.unlink()

    # ---- latest.json ----------------------------------------------------------------
    # ⚠️ EVERY page in the app downloads this file, so what goes in it is a
    # budget decision, not a completeness one. Measured 2026-08-26 before the
    # metadata fields landed: 763 KB raw / 179 KB gzip for 600 records, and
    # carrying all of them raw takes it to 955 KB (+25%). `section_path` and
    # `image_alt` are read on the ARTICLE page only, which already loads the
    # per-domain bundle, so they are dropped here — the fields that survive
    # are the ones a card actually renders.
    latest = [
        {k: v for k, v in r.items() if k not in FEED_OMIT}
        for r in all_latest if r.get("published")
    ]
    latest.sort(key=lambda r: r["published"], reverse=True)
    latest_path = out_dir / "latest.json"
    write_json(
        latest_path,
        {"generated_at": generated_at, "articles": latest[: args.latest]},
    )
    # ⚠️ CHECKED, not merely documented. A budget nothing enforces is a
    # comment, and this one guards the file every page downloads before it can
    # paint — the failure mode is a slow app, which nobody bisects to a JSON
    # field. Warns rather than aborts: the bundle is still correct and a build
    # that refuses to finish over a size is worse than one that says so.
    feed_gzip = len(gzip.compress(latest_path.read_bytes(), 9))
    if feed_gzip > FEED_GZIP_BUDGET_BYTES:
        print(f"  ! latest.json is {feed_gzip / 1024:.0f} KB gzipped, over the "
              f"{FEED_GZIP_BUDGET_BYTES / 1024:.0f} KB budget. PAGINATE the "
              f"feed or drop a field from it — do not raise the budget: every "
              f"page in the app downloads this file.", file=sys.stderr)

    # ---- stories.json ----------------------------------------------------------------
    stories_dir = data_dir / "analysis" / "stories"
    stories = []
    story_topic_counts: dict[str, int] = {}
    if stories_dir.is_dir():
        corpus_records = {(r["domain"], r["id"]): r for r in all_latest}
        for fp in sorted(stories_dir.glob("*.json")):
            try:
                st = json.loads(fp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            members = []
            for m in st.get("members") or []:
                article_id = Path(m["article_path"]).stem if m.get("article_path") else None
                title = None
                # Every member's corpus file was parsed moments ago — resolve from
                # memory; only re-read the disk for members whose file vanished.
                rec = corpus_records.get((m.get("domain"), article_id))
                if rec:
                    title = rec.get("title")
                elif m.get("article_path"):
                    try:
                        title = json.loads(
                            (REPO / m["article_path"]).read_text(encoding="utf-8")
                        ).get("title")
                    except (OSError, json.JSONDecodeError):
                        pass
                members.append(
                    {
                        "domain": m.get("domain"),
                        "article_id": article_id,
                        "url": m.get("url"),
                        "title": title,
                        "published": m.get("published"),
                        "leaning": m.get("leaning"),
                        "russia_stance": m.get("russia_stance"),
                        # When WE first saw it, which is what the scoop
                        # measure below keys on — see attach_scoop_lag.
                        "first_seen": (corpus_records.get(
                            (m.get("domain"), article_id)) or {}).get(
                                "first_seen"),
                    }
                )
            members.sort(key=lambda m: m.get("published") or "")
            attach_scoop_lag(members)
            primary = next(
                (t for t in st.get("topics") or [] if t.get("primary")),
                (st.get("topics") or [{}])[0] if st.get("topics") else None,
            )
            if primary:
                story_topic_counts[primary.get("category", "?")] = (
                    story_topic_counts.get(primary.get("category", "?"), 0) + 1
                )
            # ⚠️ Against EVERY member, not the first: a name one member
            # writes is a name the story may carry.
            st_texts = [_article_text(m["article_path"])
                        for m in (st.get("members") or [])
                        if m.get("article_path")]
            st_bad = altered_names(st.get("entities"), st_texts)
            st_prose = verified_prose(
                st, ("summary_bg", "summary_en",
                     "canonical_title_bg", "canonical_title_en"), st_bad)
            stories.append(
                {
                    "id": st.get("id"),
                    "title_bg": st_prose.get("canonical_title_bg",
                                             st.get("canonical_title_bg")),
                    "title_en": st_prose.get("canonical_title_en",
                                             st.get("canonical_title_en")),
                    "summary_bg": st_prose.get("summary_bg",
                                               st.get("summary_bg")),
                    "summary_en": st_prose.get("summary_en",
                                               st.get("summary_en")),
                    **({"withheld": st_prose["_withheld"]}
                       if st_prose.get("_withheld") else {}),
                    "first_published": st.get("first_published"),
                    "last_published": st.get("last_published"),
                    "topics": st.get("topics") or [],
                    "related_story_ids": st.get("related_story_ids") or [],
                    # ⚠️ Filled to the SHAPE the app's type promises, not
                    # left as whatever the story file happens to carry.
                    # `or {}` satisfies neither declaration, and StoryScreen
                    # dereferences `.entities.people` and
                    # `.aggregates.by_domain` with no guard — so a story
                    # written before a bucket existed, or by a partial run,
                    # is a blank page rather than a missing chip.
                    "entities": (ents := verified_entities(
                        {**EMPTY_STORY_ENTITIES,
                         **(st.get("entities") or {})}, st_bad)),
                    **({"entity_links": slinks}
                       if (slinks := links_for(ents)) else {}),
                    "aggregates": {**EMPTY_STORY_AGGREGATES,
                                   **(st.get("aggregates") or {})},
                    "blindspot": blindspot_of(members),
                    "members": members,
                }
            )
    stories.sort(key=lambda s: s.get("last_published") or "", reverse=True)
    write_json(out_dir / "stories.json", {"generated_at": generated_at, "stories": stories})

    # ---- taxonomy.json (with usage counts) -------------------------------------------
    def count_for(cat_id: str, sub_id: str | None) -> int:
        return topic_article_counts.get((cat_id, sub_id), 0)

    def axes_block(cat: dict | None) -> dict:
        """The distributions and their spread, with the sample each was
        computed over.

        ⚠️ Never a bare number: a consumer that cannot see `n` cannot tell a
        spread of 1.4 over four articles from one over four hundred, and today
        NO topic clears the floor.

        A category nobody wrote about gets the SAME KEYS with zeros rather than
        missing ones — "nobody took a position" and "this field is not in the
        payload" render differently, and only the first is true.
        """
        cat = cat or {}
        return {
            # ⚠️ Articles whose PRIMARY topic is this one, which is a
            # different number from article_count and can be 0 while that is 7:
            # „Управление и кабинет" is tagged on seven articles and is the
            # main subject of none. Without this the screen says „нито една
            # статия не заема позиция" about a topic nobody has actually
            # written about — the wrong fact, stated confidently.
            "primary_count": cat.get("articles", 0),
            "outlet_count": len(cat.get("outlets") or ()),
            "leaning": cat.get("leaning", {}),
            "russia_stance": cat.get("russia_stance", {}),
            "spread": {
                axis: axis_spread(cat.get(axis, {}), axis)
                for axis in AXIS_POSITIONS
            },
        }

    taxonomy_out = {
        "version": taxonomy_doc.get("version"),
        "generated_at": generated_at,
        "categories": [
            {
                "id": c["id"],
                "label": c["label"],
                "route": c.get("route"),
                "article_count": count_for(c["id"], None)
                + sum(count_for(c["id"], s["id"]) for s in c.get("subcategories") or []),
                "story_count": story_topic_counts.get(c["id"], 0),
                **axes_block(topic_axes.get(c["id"])),
                "subcategories": [
                    {
                        "id": s["id"],
                        "label": s["label"],
                        # ⚠️ Present only where the main site has a page that
                        # IS this subcategory — most carry none, and that is
                        # a refusal rather than an omission: a chip pointing
                        # at an adjacent page is worse than a chip that is
                        # not a link. test_topic_routes.py checks every route
                        # here against src/routes.tsx, since a route renamed
                        # in the other half of the repo leaves this committed
                        # file green for ever.
                        "route": s.get("route"),
                        "article_count": count_for(c["id"], s["id"]),
                    }
                    for s in c.get("subcategories") or []
                ],
            }
            for c in categories
        ],
    }
    write_json(out_dir / "taxonomy.json", taxonomy_out)

    # ---- outlets.json -----------------------------------------------------------------
    outlets = []
    seen = set()
    for domain, meta in sorted(outlets_csv.items(), key=lambda kv: rank_of(kv[1])):
        seen.add(domain)
        outlets.append(
            {
                "domain": domain,
                "outlet": meta.get("outlet") or domain,
                "logo": meta.get(LOGO_COLUMN_PREFIX) or None,
                # ⚠️ ALWAYS HAND-ENTERED, NEVER INFERRED — and the reason is
                # not caution, it is that the inference would be wrong.
                # The Commerce Registry gives the REGISTERED owner, which in
                # Bulgarian media is routinely a holding company or an
                # offshore vehicle rather than the person in control. So this
                # publishes what a named register said on a stated date, with
                # the source beside it, and is never captioned as beneficial
                # ownership. `checked` is part of the claim, not metadata:
                # without it the row asserts a present-tense fact about an
                # organisation on the strength of an undated lookup.
                "owner": owner_block(meta),
                # Tri-state on purpose: true / false / null-never-probed. A
                # bool would collapse "we asked and they said no" into "we
                # never asked", and only the first justifies suppressing the
                # request.
                "hotlink_ok": tri_state(meta.get(HOTLINK_COLUMN_PREFIX)),
                "retired": False,
                "retired_reason": None,
                "retired_on": None,
                "rank": rank_of(meta) if rank_of(meta) != 10**9 else None,
                "tier": meta.get("tier"),
                "type": meta.get("type"),
                "scope": meta.get("scope"),
                "visits": parse_visits(meta.get("similarweb_visits")),
                "article_count": len(articles_by_domain.get(domain, [])),
                "analyzed_count": analyzed_by_domain.get(domain, 0),
                "leaning": leaning_by_domain.get(domain, {}),
                "russia_stance": russia_by_domain.get(domain, {}),
                "ai_generated": ai_by_domain.get(domain, {}),
                "conduct": conduct_by_domain.get(domain, EMPTY_CONDUCT),
            }
        )
    # ⚠️ Retired outlets with NO stored articles must be here too. Nine of the
    # eleven retirements produced nothing before they were retired — four are
    # behind an interactive CAPTCHA we will not solve — so enumerating only
    # `domain_names` made 9 of 11 invisible to the app, and both the outlets
    # directory ("retired outlets stay visible, with their reason") and the
    # methodology page ("what this corpus does not cover") became unable to
    # state a fact the registry records.
    for domain in sorted(set(domain_names) | set(retired)):
        if domain in seen:
            # ⚠️ In BOTH registries. The live row wins (it is the one a sweep
            # actually reads), so the outlet publishes as retired=False — and
            # if the retirement was `bot_refused`, the app then presents an
            # outlet that asked not to be crawled as a live source. Reported
            # rather than resolved here: which registry is right is a decision
            # for whoever edits them.
            if domain in retired:
                print(f"  ! {domain} is in BOTH bg_news_sites.csv and "
                      f"retired_sites.csv (retired: "
                      f"{retired[domain].get('reason')}). The live row wins "
                      f"and it will publish as ACTIVE — remove it from one.",
                      file=sys.stderr)
            continue
        gone = retired.get(domain)
        outlets.append(
            {
                "domain": domain,
                "outlet": (gone or {}).get("outlet") or domain,
                # Explicitly null rather than absent. A retired outlet may
                # still have a resolved mark (retired_sites.csv carries the
                # column too) and the app falls back to a monogram either way
                # — but a MISSING key reads as `undefined`, which is a
                # different bug from "we have no logo".
                "logo": (gone or {}).get(LOGO_COLUMN_PREFIX) or None,
                "owner": None,
                "hotlink_ok": tri_state(
                    (gone or {}).get(HOTLINK_COLUMN_PREFIX)),
                # A retired outlet's articles stay — they were collected in
                # good faith — but the app must not present it as a live
                # source, and two of these asked not to be crawled at all.
                "retired": bool(gone),
                "retired_reason": (gone or {}).get("reason"),
                "retired_on": (gone or {}).get("retired_on"),
                "rank": None,
                "tier": None,
                "type": (gone or {}).get("type"),
                "scope": (gone or {}).get("scope"),
                "visits": None,
                "article_count": len(articles_by_domain.get(domain, [])),
                "analyzed_count": analyzed_by_domain.get(domain, 0),
                "leaning": leaning_by_domain.get(domain, {}),
                "russia_stance": russia_by_domain.get(domain, {}),
                "ai_generated": ai_by_domain.get(domain, {}),
                "conduct": conduct_by_domain.get(domain, EMPTY_CONDUCT),
            }
        )
    write_json(out_dir / "outlets.json", {"generated_at": generated_at, "outlets": outlets})

    # ---- stats.json --------------------------------------------------------------------
    published_dates = [r["published"] for r in all_latest if r.get("published")]
    total_articles = len(all_latest)
    analyzed_total = sum(analyzed_by_domain.values())
    write_json(
        out_dir / "stats.json",
        {
            "generated_at": generated_at,
            "taxonomy_version": taxonomy_doc.get("version"),
            "total_articles": total_articles,
            "analyzed_articles": analyzed_total,
            "analyzed_pct": round(100 * analyzed_total / total_articles, 1) if total_articles else 0,
            "stories": len(stories),
            "domains": len(domain_names),
            "outlets_catalogued": len(outlets_csv),
            "first_published": min(published_dates) if published_dates else None,
            "last_published": max(published_dates) if published_dates else None,
            "articles_by_domain": {d: len(r) for d, r in sorted(articles_by_domain.items())},
        },
    )

    if args.stamp:
        # The summary a reader sees. Deliberately the corpus totals rather
        # than the file counts: "how much did we collect and how much of it is
        # judged" is the question /data/updates answers for every other
        # source, and analysed-vs-collected is the number this corpus most
        # needs stated in public.
        pct = round(100 * analyzed_total / max(total_articles, 1), 1)
        summary = (
            f"Новинарският корпус преизчислен — "
            f"{bg_plural(total_articles, 'статия', 'статии')} от "
            f"{bg_plural(len(domain_names), 'издание', 'издания')}, "
            f"{bg_plural(analyzed_total, 'анализирана', 'анализирани')} "
            f"({pct}%), "
            f"{bg_plural(len(stories), 'история', 'истории')}")
        stamp = stamp_data_change(summary, REPO)
        if verbose:
            print(f"  data-changes: "
                  f"{'stamped' if stamp.get('stamped') else 'NOT stamped'}"
                  f" — {stamp.get('detail') or stamp.get('reason')}",
                  file=sys.stderr)

    total_files = len(list(out_dir.rglob("*.json")))
    total_bytes = sum(p.stat().st_size for p in out_dir.rglob("*.json"))
    summary = {
        "out": str(out_dir),
        "total_articles": total_articles,
        "analyzed_articles": analyzed_total,
        "analyzed_pct": round(100 * analyzed_total / max(total_articles, 1), 1),
        "stories": len(stories),
        "outlets": len(outlets),
        "files": total_files,
        "bytes": total_bytes,
        # ⚠️ REPORTED, never silent. These are person names an article does
        # not contain, dropped from what we publish — a quiet withholding is
        # indistinguishable from a model that stopped naming anyone.
        "withheld_person_names": _WITHHELD["names"],
        "withheld_from_records": _WITHHELD["records"],
        "withheld_prose_fields": _WITHHELD["prose"],
        "generated_at": generated_at,
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    elif verbose:
        print(
            f"news app-data → {out_dir}: {total_articles} articles "
            f"({analyzed_total} analyzed, {summary['analyzed_pct']}%), "
            f"{len(stories)} stories, {len(outlets)} outlets, "
            f"{total_files} files, {total_bytes / 1_048_576:.1f} MB"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
