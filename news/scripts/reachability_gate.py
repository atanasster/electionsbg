#!/usr/bin/env python3
"""T1.4 — can a reader actually REACH every story we publish?

    python3 news/scripts/reachability_gate.py            # report
    python3 news/scripts/reachability_gate.py --enforce  # non-zero on failure
    python3 news/scripts/reachability_gate.py --json

⚠️⚠️ THE MEASURE THIS REPLACES WAS ARITHMETIC ON TWO DIFFERENT WINDOWS. The
inherited „16 of 676 stories are reachable = 2.4%" divided a HOME-PAGE
selection by a 30-day corpus — two populations chosen by different rules — so
it could not be improved, only restated. `coverage` here is, per query:

    distinct reachable story ids / distinct ELIGIBLE story ids for that query

over ONE pinned snapshot, and it is required to be 100% with SET EQUALITY:
a coverage of 1.0 reached by also serving ids that do not belong is not a
pass, which a ratio alone cannot see.

⚠️ THE DENOMINATOR IS INDEPENDENT OF THE BUILDER'S DERIVATION, NOT OF THE
RULE. `eligible_facets` reads raw `topics` and `members` out of `stories.json`
rather than `story_index_row`'s output, so a bug in how the builder DERIVES a
facet is caught. The rule itself — what a category is, what `UNTOPICED_FACET`
means — is transcribed, so a change to what a facet MEANS has to be made on
both sides and the two would agree on a wrong one. `eligible_facets` and
`UNTOPICED_FACET` here are the two places that mirror
`build_app_data.story_filter_row` / `story_index_row`.

⚠️ AN EMPTY ELIGIBLE SET IS N/A, NEVER 100%. A query matching nothing is
vacuously covered, so a corpus that failed to build would score a perfect
1.000 on every fixture. The run FAILS when nothing was actually checked, and
separately refuses a corpus that has SHRUNK against its committed baseline —
because „every fixture passed" is equally true of a snapshot that lost 99% of
its stories, which is measured and not hypothetical.

Reported separately, and deliberately NOT as reachability: the article funnel
(analysed → quality-ok → site-relevant → attached to a published story).
Articles, analyses and stories are different units; presenting one as a
denominator for another is the defect above in a second costume.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
APP_DATA = ROOT / "news" / "app-data"
BASELINE = ROOT / "news" / "config" / "reachability_baseline.json"

# Mirrors build_app_data.UNTOPICED_FACET. Transcribed rather than imported for
# the reason in the module docstring; see `facet_drift` for what catches a skew.
UNTOPICED_FACET = "?"

ISO_INSTANT = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")

# ⚠️ A DIAGNOSTIC, NOT THE GATE. `answerable` depends on the corpus's facet
# diversity and recency, so a small, entirely sound snapshot legitimately
# produces three while a 99%-shrunk one produces twelve — measured both ways.
# Gating on it fails a quiet week and passes a broken build.
EXPECTED_ANSWERABLE_FIXTURES = 6

# How much of the corpus may disappear between runs before the gate refuses.
# The repo's own pattern for a derived corpus (`mergeFromStage`, kzk_decisions).
MAX_CORPUS_SHRINK = 0.05


def read_json(path: Path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def parse_instant(value) -> float | None:
    if not isinstance(value, str) or not ISO_INSTANT.match(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def eligible_facets(story: dict) -> tuple[list[str], list[str]]:
    """The topics and outlets a story is findable under — from `stories.json`.

    ⚠️ `domains` IS DERIVED FROM `members`, BECAUSE `stories.json` CARRIES NO
    SUCH FIELD. The index rows get one (`build_app_data.story_index_row`,
    `sorted({m["domain"] for m in members})`); the corpus file does not. A
    `story.get("domains") or []` here therefore returns EMPTY for every story,
    every outlet fixture finds nothing eligible, and all of them report N/A —
    a gate that passes by never asking the one question this tier exists for.
    Measured on the first cut: 10 fixtures, 0 of them about an outlet.
    """
    categories = sorted({
        topic.get("category")
        for topic in (story.get("topics") or [])
        if isinstance(topic, dict) and topic.get("category")
    })
    domains = sorted({
        member.get("domain")
        for member in (story.get("members") or [])
        if isinstance(member, dict) and member.get("domain")
    })
    return categories or [UNTOPICED_FACET], domains


def row_facets(row: dict) -> tuple[list[str], list[str]]:
    """The same two facets off an ORDERED INDEX row, which carries them directly."""
    categories = sorted({
        topic.get("category")
        for topic in (row.get("topics") or [])
        if isinstance(topic, dict) and topic.get("category")
    })
    return categories or [UNTOPICED_FACET], sorted(row.get("domains") or [])


def matches(categories, domains, published, query, now: float) -> bool:
    """One predicate, applied identically to every source below.

    ⚠️ A future stamp is refused, and a missing or malformed one is refused
    from a WINDOWED query only — an unwindowed query still reaches it. The
    alternative makes a bad clock at one outlet an invisible deletion.
    """
    days = query.get("days") or 0
    if days > 0:
        if published is None:
            return False
        age = now - published
        if age < 0 or age > days * 86_400:
            return False
    category = query.get("category", "all")
    if category != "all" and category not in categories:
        return False
    domain = query.get("domain", "all")
    if domain != "all" and domain not in domains:
        return False
    return True


def build_fixtures(stories: list) -> list[dict]:
    """Fixtures derived FROM the corpus, never hand-listed.

    ⚠️ A HARD-CODED „elections, 7 days" GOES VACUOUS THE WEEK THAT TOPIC HAS
    NO STORIES, and reports N/A rather than failing. These are chosen from
    what the snapshot actually holds, so the gate keeps measuring something
    as the corpus moves.
    """
    category_counts: dict[str, int] = {}
    domain_counts: dict[str, int] = {}
    for story in stories:
        categories, domains = eligible_facets(story)
        for value in set(categories):
            category_counts[value] = category_counts.get(value, 0) + 1
        for value in set(domains):
            domain_counts[value] = domain_counts.get(value, 0) + 1

    def top(counts: dict, n: int) -> list[str]:
        return [key for key, _ in sorted(counts.items(),
                                         key=lambda kv: (-kv[1], kv[0]))[:n]]

    fixtures = [
        {"name": "everything", "query": {}},
        {"name": "window:1d", "query": {"days": 1}},
        {"name": "window:7d", "query": {"days": 7}},
        {"name": "window:30d", "query": {"days": 30}},
    ]
    for category in top(category_counts, 3):
        fixtures.append({"name": f"category:{category}",
                         "query": {"category": category}})
        fixtures.append({"name": f"category:{category}+30d",
                         "query": {"category": category, "days": 30}})
    for domain in top(domain_counts, 3):
        fixtures.append({"name": f"domain:{domain}",
                         "query": {"domain": domain}})
    return fixtures


def deep_page_fixture(stories: list, page_size: int) -> dict | None:
    """A fixture whose ONLY matches are past page 1 — the plan asks for it by name.

    ⚠️ IT IS THE DEPTH PROBE, NOT THE TRUNCATION PROBE. This gate walks the
    whole corpus itself, so a truncated index fails EVERY fixture — measured,
    a page-1-only walk takes `everything` to 0.047 and all fourteen to FAIL.
    What this fixture alone provides is `first_match_page`: the one figure
    that would move if the builder began emitting a prefix while every set
    still reconciled.

    ⚠️ DEPTH IS GUARANTEED FOR `index` ONLY. The ordering below is
    `build_app_data.story_sort_key`, i.e. the `index` family; `ranked-*` is
    ordered by prominence and a rare outlet can float to its page 1.
    """
    ordered = sorted(
        stories,
        key=lambda s: (s.get("last_published") or "", s.get("id") or ""),
        reverse=True,
    )
    tail = ordered[page_size:]
    head_domains = {
        domain
        for story in ordered[:page_size]
        for domain in eligible_facets(story)[1]
    }
    counts: dict[str, int] = {}
    for story in tail:
        for domain in set(eligible_facets(story)[1]):
            if domain in head_domains:
                continue
            counts[domain] = counts.get(domain, 0) + 1
    if not counts:
        return None
    domain = min(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
    return {"name": f"deep-page:domain:{domain}", "query": {"domain": domain}}


def load_pages(prefix: str) -> tuple[list[tuple[str, int, dict]], int, list[str]]:
    """Every row of one ordered family, ONCE, with the page it was served on.

    ⚠️ THE PAGE NUMBER IS CARRIED, NEVER RECONSTRUCTED. `index // page_size`
    recovers a page only if every preceding page is exactly full — and a short
    non-last page is the signature of a truncated emit, i.e. the very defect
    this gate exists to find, silently under-reporting its own depth figure.

    Read once per family rather than once per fixture: 14 fixtures × 2 orders
    × 22 pages was 616 reads of files the gate had already parsed.
    """
    rows: list[tuple[str, int, dict]] = []
    problems: list[str] = []
    page = 1
    pages = 1
    while page <= pages:
        path = APP_DATA / "stories" / f"{prefix}-{page}.json"
        if not path.is_file():
            break
        try:
            payload = read_json(path)
        except (OSError, json.JSONDecodeError) as exc:
            # ⚠️ A REACHABILITY FAILURE, NOT A TRACEBACK. An unreadable page is
            # a page no reader can reach; crashing exits 1 whatever `--enforce`
            # says, which inverts the report-only mode's contract.
            problems.append(f"{prefix}-{page}.json is not readable JSON: {exc}")
            break
        try:
            pages = int(payload.get("pages") or 1)
        except (TypeError, ValueError):
            problems.append(f"{prefix}-{page}.json has a non-numeric `pages`")
            break
        for row in payload.get("stories") or []:
            if isinstance(row, dict) and isinstance(row.get("id"), str):
                rows.append((row["id"], page, row))
        page += 1
    return rows, page - 1, problems


def filter_index_ids(rows: list, query, now: float) -> list[str]:
    out: list[str] = []
    for row in rows:
        if not isinstance(row, list) or len(row) < 4:
            continue
        story_id, published, categories, domains = row[0], row[1], row[2], row[3]
        if not isinstance(story_id, str):
            continue
        if matches(list(categories or []), list(domains or []),
                   parse_instant(published), query, now):
            out.append(story_id)
    return out


def facet_drift(stories: list, filter_rows: list,
                paged: dict) -> dict:
    """Every row's FACETS against the corpus — fixture-independent.

    ⚠️ THE FIXTURES CAN ONLY PROBE THE FACETS THEY NAME. They cover the top 3
    categories and top 3 outlets; today's corpus has 25 and 44. So a story
    whose row lost a topic or an outlet outside that set is invisible to the
    per-fixture set equality, and `id_drift` below cannot see it either —
    it compares ids only. Measured: losing `fakti.bg` was caught, losing
    `glasove.com` was not.
    """
    want = {
        story["id"]: (eligible_facets(story),
                      story.get("last_published") or "")
        for story in stories
    }
    offenders: dict[str, list[str]] = {}

    def check(where: str, story_id: str, categories, domains, published):
        expected = want.get(story_id)
        if expected is None:
            return
        (exp_categories, exp_domains), exp_published = expected
        if (sorted(categories or []), sorted(domains or []), published or "") != (
                exp_categories, exp_domains, exp_published):
            offenders.setdefault(where, []).append(story_id)

    for row in filter_rows:
        if isinstance(row, list) and len(row) >= 4 and isinstance(row[0], str):
            check("filter-index", row[0], row[2], row[3], row[1])
    for prefix, rows in paged.items():
        for story_id, _page, row in rows:
            categories, domains = row_facets(row)
            check(prefix, story_id, categories, domains,
                  row.get("last_published"))
    return {
        where: {"count": len(ids), "examples": sorted(ids)[:5]}
        for where, ids in offenders.items()
    }


def article_funnel() -> dict:
    """analysed → quality-ok → site-relevant → attached to a published story.

    ⚠️ REPORTED BESIDE REACHABILITY, NEVER AS A RATIO AGAINST IT. These are
    ARTICLES; reachability counts STORIES. The inherited „2,883 eligible vs
    2,876 attached" was quoted as if the seven were reconciled; they are not,
    so the residue is named as `unattached` rather than rounded away.

    ⚠️ THE STAGES ARE CUMULATIVE, AND `site_relevant` HERE IS THE INTERSECTION
    WITH `quality_ok` — which is NOT the same number as „site-relevant
    analyses on disk". Measured 2026-09-21: 3,610 records are site-relevant,
    3,557 of them also quality-ok, and the 53 that are not carry no story id.
    Publishing 3,610 as the funnel's third stage against 3,557 attached would
    invent a 53-article discrepancy out of the staging, so the off-stage count
    is reported separately as `site_relevant_but_not_quality_ok`.

    ⚠️ THE RESIDUE IS CHECKED IN BOTH DIRECTIONS, AND THAT IS WHY THERE ARE
    TWO FIELDS. `unattached` counts articles that passed both predicates and
    reached no published story. `attached_but_off_predicate` counts the
    converse — an article carrying a story id that did NOT pass them, i.e. a
    story built from material the pipeline later judged unusable. Both are
    structurally zero while attachment is gated on the same two predicates;
    a single count difference can only ever see the first, so „verified as a
    set" would have been a claim about a check that was not there.

    ⚠️ AN ABSENT ANALYSIS TREE IS `not_measured`, NEVER A ROW OF ZEROS. The
    module's own rule for a fixture, applied here: „the residue is zero" and
    „we never looked" must not render identically — and a missing `index.json`
    produces the opposite artefact, a fabricated residue equal to the whole
    site-relevant count, on a pipeline that is fine.
    """
    index_path = ROOT / "news" / "data" / "analysis" / "index.json"
    records = sorted(glob.glob(str(ROOT / "news" / "data" / "analysis"
                                   / "articles" / "*" / "*.json")))
    missing = [
        name for name, present in (
            ("news/data/analysis/index.json", index_path.is_file()),
            ("news/data/analysis/articles/*/*.json", bool(records)),
        ) if not present
    ]
    if missing:
        return {"unit": "articles — NOT comparable to the story counts above",
                "status": "not_measured", "missing": missing}

    try:
        entries = read_json(index_path).get("articles") or {}
    except (OSError, json.JSONDecodeError) as exc:
        return {"unit": "articles — NOT comparable to the story counts above",
                "status": "not_measured",
                "missing": [f"news/data/analysis/index.json: {exc}"]}
    path_to_story = {entry["path"]: entry.get("story_id")
                     for entry in entries.values()
                     if isinstance(entry, dict) and entry.get("path")}
    urls_with_a_story_id = sum(1 for entry in entries.values()
                               if isinstance(entry, dict)
                               and entry.get("story_id"))

    published_ids = set()
    stories_path = APP_DATA / "stories.json"
    if stories_path.is_file():
        published_ids = {
            story.get("id")
            for story in (read_json(stories_path).get("stories") or [])
            if isinstance(story, dict) and story.get("id")
        }

    analysed = quality_ok = site_relevant = attached = 0
    relevant_not_ok = 0
    off_predicate: set[str] = set()
    for path in records:
        try:
            record = read_json(Path(path))
        except (OSError, json.JSONDecodeError):
            continue
        analysed += 1
        ok = (record.get("quality") or {}).get("verdict") == "ok"
        relevant = record.get("site_relevant") is True
        story_id = path_to_story.get(os.path.relpath(path, str(ROOT)))
        if story_id and story_id in published_ids and not (ok and relevant):
            off_predicate.add(story_id)
        if not ok:
            if relevant:
                relevant_not_ok += 1
            continue
        quality_ok += 1
        if not relevant:
            continue
        site_relevant += 1
        if story_id and story_id in published_ids:
            attached += 1
    return {
        "unit": "articles — NOT comparable to the story counts above",
        "status": "measured",
        "analysed": analysed,
        "quality_ok": quality_ok,
        "site_relevant": site_relevant,
        # ⚠️ OFF-STAGE, reported so nobody reconstructs „3,610 site-relevant"
        # from disk and reads the difference as loss.
        "site_relevant_but_not_quality_ok": relevant_not_ok,
        "attached_to_published_story": attached,
        "unattached": site_relevant - attached,
        "attached_but_off_predicate": len(off_predicate),
        "urls_with_a_story_id": urls_with_a_story_id,
    }


def resolve_clock(argument: str | None, head: dict) -> tuple[float, str, str]:
    """(instant, basis, label) — and a malformed `--now` is REFUSED.

    ⚠️ SILENTLY FALLING BACK MISREPORTS THE MEASUREMENT. An operator pinning
    a clock is deliberately reproducing a run; discarding a typo'd value and
    using the snapshot's own `as_of` answers a different question and reports
    the same shape either way.
    """
    if argument is not None:
        instant = parse_instant(argument)
        if instant is None:
            raise ValueError(
                f"--now {argument!r} is not an ISO instant "
                "(YYYY-MM-DDTHH:MM:SS with a Z or ±HH:MM offset)")
        return instant, "argument", argument
    for key in ("as_of", "generated_at"):
        instant = parse_instant(head.get(key))
        if instant is not None:
            return instant, f"snapshot.{key}", head[key]
    # ⚠️ The wall clock drifts every minute, so a windowed fixture would report
    # a different coverage for a build nobody touched. Named, never implied.
    now = datetime.now(timezone.utc)
    return now.timestamp(), "wall_clock", now.isoformat()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--enforce", action="store_true",
                    help="exit non-zero when the gate fails")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--now", default=None,
                    help="pin the clock (ISO instant); default: the snapshot's "
                         "own as_of, so a rolling window is reproducible")
    ap.add_argument("--allow-shrink", action="store_true",
                    help="accept a corpus smaller than the committed baseline")
    ap.add_argument("--update-baseline", action="store_true",
                    help="record this corpus size as the new baseline")
    args = ap.parse_args()

    stories_path = APP_DATA / "stories.json"
    filter_path = APP_DATA / "stories" / "filter-index.json"
    page_one = APP_DATA / "stories" / "index-1.json"
    missing = [str(p.relative_to(ROOT)) for p in (stories_path, filter_path,
                                                  page_one) if not p.is_file()]
    if missing:
        report = {"mode": "news_reachability_gate", "ok": False,
                  "reason": "app-data is not built", "missing": missing}
        print(json.dumps(report, ensure_ascii=False) if args.json
              else f"app-data is not built: {', '.join(missing)}")
        return 1 if args.enforce else 0

    try:
        stories = [s for s in (read_json(stories_path).get("stories") or [])
                   if isinstance(s, dict) and isinstance(s.get("id"), str)]
        filter_index = read_json(filter_path)
        head = read_json(page_one)
    except (OSError, json.JSONDecodeError) as exc:
        report = {"mode": "news_reachability_gate", "ok": False,
                  "reason": f"app-data is not readable JSON: {exc}"}
        print(json.dumps(report, ensure_ascii=False) if args.json
              else report["reason"])
        return 1 if args.enforce else 0

    try:
        page_size = int(head.get("page_size") or 150)
        now, clock_basis, clock_label = resolve_clock(args.now, head)
    except (TypeError, ValueError) as exc:
        report = {"mode": "news_reachability_gate", "ok": False,
                  "reason": str(exc)}
        print(json.dumps(report, ensure_ascii=False) if args.json
              else report["reason"])
        return 1 if args.enforce else 0

    # ⚠️ THE ROWS LIVE IN THE SHARDS. `filter_index["stories"]` no longer
    # exists: the index is a manifest plus `stories/filter-index-<n>.json`
    # shards. Reading the old key returns [] and fails TWO ways at once — the
    # set-difference arm reports the whole corpus "unreachable" (measured: 14
    # of 14 fixtures, 4,899 rows), and the facet-parity arm below iterates an
    # empty list and goes VACUOUS, so repairing only the loud half leaves a
    # green gate checking nothing.
    filter_rows: list = []
    global_problems: list[str] = []
    for entry in filter_index.get("shards") or []:
        shard_path = APP_DATA / str((entry or {}).get("path") or "")
        try:
            filter_rows.extend(read_json(shard_path).get("stories") or [])
        except (OSError, json.JSONDecodeError) as exc:
            global_problems.append(f"filter-index shard unreadable: {exc}")
    # The one assertion that tells "a shard failed to write" apart from "the
    # corpus shrank" — which is what the manifest's `count`/`total` are for.
    declared = filter_index.get("total")
    if isinstance(declared, int) and len(filter_rows) != declared:
        global_problems.append(
            f"filter-index shards hold {len(filter_rows)} rows against a "
            f"manifest total of {declared} — a shard is missing")
    paged: dict[str, list] = {}
    page_counts: dict[str, int] = {}
    for prefix in ("index", "ranked"):
        rows, pages, problems = load_pages(prefix)
        paged[prefix] = rows
        page_counts[prefix] = pages
        global_problems.extend(problems)
        # ⚠️ HOISTED OUT OF THE FIXTURE LOOP. Duplication is a property of the
        # family, not of a query — reported per fixture it read as fourteen
        # failures of one defect.
        seen = [story_id for story_id, _page, _row in rows]
        if len(seen) != len(set(seen)):
            global_problems.append(f"{prefix}: a story appears on two pages")

    fixtures = build_fixtures(stories)
    deep = deep_page_fixture(stories, page_size)
    if deep:
        fixtures.append(deep)

    results = []
    for fixture in fixtures:
        query = fixture["query"]
        eligible = {
            story["id"] for story in stories
            if matches(*eligible_facets(story),
                       parse_instant(story.get("last_published")), query, now)
        }
        entry = {"fixture": fixture["name"], "query": query,
                 "eligible": len(eligible)}
        if not eligible:
            # N/A, never 1.000 — see the module docstring.
            entry.update({"status": "not_applicable", "coverage": None})
            results.append(entry)
            continue

        from_filter = filter_index_ids(filter_rows, query, now)
        problems = []
        if len(from_filter) != len(set(from_filter)):
            problems.append("filter-index repeats a story id")
        if set(from_filter) != eligible:
            problems.append(
                f"filter-index set differs: "
                f"{len(set(from_filter) - eligible)} phantom, "
                f"{len(eligible - set(from_filter))} unreachable")

        per_order = {}
        for prefix, rows in paged.items():
            served = [(story_id, page) for story_id, page, row in rows
                      if matches(*row_facets(row),
                                 parse_instant(row.get("last_published")),
                                 query, now)]
            reached = {story_id for story_id, _ in served}
            phantom = reached - eligible
            unreachable = eligible - reached
            if phantom:
                problems.append(f"{prefix}: {len(phantom)} phantom ids")
            if unreachable:
                problems.append(f"{prefix}: {len(unreachable)} unreachable")
            per_order[prefix] = {
                "pages": page_counts[prefix],
                "reachable": len(reached),
                "coverage": round(len(reached & eligible) / len(eligible), 6),
                # ⚠️ THE PAGE THE INDEX ACTUALLY SERVED IT ON, and keyed on
                # what the ROW says rather than on the corpus: a story whose
                # row lost the queried facet is not something a client
                # filtering that page would find, so counting it here would
                # name a page the reader's filter skips.
                "first_match_page": next((page for _, page in served), None),
            }
        entry.update({
            "status": "fail" if problems else "pass",
            "coverage": min(o["coverage"] for o in per_order.values()),
            "orders": per_order,
            "problems": problems,
        })
        results.append(entry)

    answerable = [r for r in results if r["status"] != "not_applicable"]
    failures = [r for r in answerable if r["status"] == "fail"]
    eligible_checked = sum(r["eligible"] for r in answerable)
    # ⚠️ FAILS CLOSED WHEN NOTHING WAS CHECKED. Without this a build that
    # produced nothing scores „0 failures" and reports success.
    vacuous = not answerable or eligible_checked == 0

    # ⚠️ AND SEPARATELY, A SHRINK. Every fixture passing is equally true of a
    # snapshot that lost 99% of its stories — measured: a synthetic 32-story
    # corpus against the real 3,189 returns ok:true with twelve answerable
    # fixtures. Set equality is a within-snapshot property and cannot see it;
    # only a baseline can.
    baseline_count = None
    if BASELINE.is_file():
        try:
            baseline_count = int(read_json(BASELINE).get("corpus_stories"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            baseline_count = None
    shrank = bool(
        baseline_count
        and len(stories) < baseline_count * (1 - MAX_CORPUS_SHRINK)
        and not args.allow_shrink)

    corpus_ids = {s["id"] for s in stories}
    index_ids = {row[0] for row in filter_rows
                 if isinstance(row, list) and row and isinstance(row[0], str)}
    id_drift = {"only_in_stories_json": len(corpus_ids - index_ids),
                "only_in_filter_index": len(index_ids - corpus_ids)}
    facets = facet_drift(stories, filter_rows, paged)

    report = {
        "mode": "news_reachability_gate",
        "as_of": head.get("as_of") or head.get("generated_at"),
        "clock": {"basis": clock_basis, "value": clock_label},
        "page_size": page_size,
        "corpus_stories": len(stories),
        "baseline_stories": baseline_count,
        "corpus_shrank": shrank,
        "fixtures": len(results),
        "answerable": len(answerable),
        "expected_answerable_fixtures": EXPECTED_ANSWERABLE_FIXTURES,
        "eligible_checked": eligible_checked,
        "failing": len(failures),
        "vacuous": vacuous,
        "filter_index_rule_drift": id_drift,
        "facet_drift": facets,
        "problems": global_problems,
        "ok": (not failures and not vacuous and not shrank
               and not any(id_drift.values()) and not facets
               and not global_problems),
        "results": results,
        "article_funnel": article_funnel(),
    }

    if args.update_baseline:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(json.dumps({
            "corpus_stories": len(stories),
            "recorded_at": datetime.now(timezone.utc).replace(
                microsecond=0).isoformat(),
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report["baseline_written"] = str(BASELINE.relative_to(ROOT))

    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        print(f"reachability over {len(stories)} stories at {report['as_of']} "
              f"(clock: {clock_basis} {clock_label})")
        for row in results:
            if row["status"] == "not_applicable":
                print(f"  n/a   {row['fixture']} — no eligible stories")
                continue
            mark = "ok  " if row["status"] == "pass" else "FAIL"
            pages = " · ".join(
                f"{name} p{order['first_match_page']}"
                for name, order in row["orders"].items())
            print(f"  {mark}  {row['fixture']}: "
                  f"{row['coverage']:.3f} over {row['eligible']} eligible "
                  f"(first match: {pages})")
            for problem in row["problems"]:
                print(f"        ⚠️ {problem}")
        if len(answerable) < EXPECTED_ANSWERABLE_FIXTURES:
            print(f"  note: {len(answerable)} answerable fixtures "
                  f"(usually {EXPECTED_ANSWERABLE_FIXTURES}+) — a narrow or "
                  "quiet corpus, not a failure by itself")
        if vacuous:
            print("  ⚠️ nothing was checked — this is not a pass")
        if shrank:
            print(f"  ⚠️ corpus shrank: {len(stories)} against a baseline of "
                  f"{baseline_count} (--allow-shrink to accept, "
                  "--update-baseline to record)")
        if any(id_drift.values()):
            print(f"  ⚠️ filter-index disagrees with stories.json: {id_drift}")
        for where, detail in facets.items():
            print(f"  ⚠️ {where}: {detail['count']} rows carry facets the "
                  f"corpus does not, e.g. {detail['examples']}")
        for problem in global_problems:
            print(f"  ⚠️ {problem}")
        funnel = report["article_funnel"]
        print("article funnel (ARTICLES — not a denominator for the above):")
        if funnel.get("status") != "measured":
            print(f"  not measured: {', '.join(funnel.get('missing') or [])}")
        else:
            print(f"  analysed {funnel['analysed']} → quality-ok "
                  f"{funnel['quality_ok']} → site-relevant "
                  f"{funnel['site_relevant']} → attached "
                  f"{funnel['attached_to_published_story']} "
                  f"({funnel['unattached']} unattached, "
                  f"{funnel['attached_but_off_predicate']} attached off-predicate)")
            print(f"  off-stage: {funnel['site_relevant_but_not_quality_ok']} "
                  "site-relevant records are not quality-ok and carry no story")

    return 1 if (args.enforce and not report["ok"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
