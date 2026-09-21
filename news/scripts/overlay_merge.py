#!/usr/bin/env python3
"""Plan §4.6(a) / §6.5 — the base+overlay merge, as pure functions.

An hourly ("cold") run publishes a full immutable version tree. A fast
("hot") run must not: measured 2026-09-20, one full tree is **37.2 MB over
~2,100 objects** and takes **96 s** to upload, so at a five-minute cadence
it is 26.8 GB/month of storage to convey a few hundred KB of new articles.
The overlay is how a hot run says only what changed: one small object plus
a manifest CAS, against the same `run_id`, so no reader's cache is cleared.

**THIS MODULE IS THE SPECIFICATION OF THE MERGE, AND NOTHING ELSE.** It
reads nothing, writes nothing and knows no bucket — every function here is
a pure transform over payloads. That is deliberate: the property the whole
design rests on is

    merge(base, overlay)  ≡  what `bundles` would have produced from the
                             same store

and a property like that is only testable if the transform can be called
without a pipeline around it. `test_overlay_merge.py` asserts exactly that,
against two REAL builds of the same fixture corpus.

⚠️ THE CLIENT'S MERGE IS A WEAKER THING, AND THE DIFFERENCE MATTERS.
This module merges a WHOLE base: it holds every index page, so it can
re-sort and re-paginate and land on the rebuild's exact PAYLOADS — value
equality, path for path, not byte equality, since nothing here serialises.
A browser
holds a PREFIX — `useStoryList` has fetched pages 1..k and nothing else —
so it can only merge into what it has. Two rules follow for §4.6(b), and
neither is optional:

  1. A story the overlay moves forward must be REMOVED from the held pages
     before the overlay's row is prepended, or it renders twice.
  2. A page fetched from the base AFTER an overlay was applied may still
     contain a story the overlay already placed at the front, so the
     accumulator must dedupe by id on every append, not only at merge time.

Neither rule is visible from this module's tests, because this module never
holds a prefix. They are pinned on the TypeScript side.

WHAT THE OVERLAY CARRIES. The primary facts — changed article records per
domain, changed story DETAIL files, the home payload, and the removals —
plus any other published path that differs, carried whole. `latest.json`,
`stories.json`, `stories/by-url.json` and the paginated index are
RECOMPUTED here from the primary facts rather than shipped, because each is
a whole-corpus ordering: shipping one would ship the whole file, and two
shipped copies of the same fact can disagree. `diff_overlay` names the two
cases where that recomputation is impossible even in principle and falls
back to carrying the file — read them before adding a third.
"""

from __future__ import annotations

# ⚠️ IMPORTED, NEVER RESTATED — every rule that decides what a published
# file CONTAINS or how it is ORDERED. `story_index_row` fixes the fields a
# list screen gets, `FEED_OMIT` the ones the feed drops, `article_sort_key`
# / `story_sort_key` the published order, `STORY_PAGE_SIZE` the page
# boundary. A merge carrying its own copy of any of them diverges from the
# cold build only for the records a hot run happened to touch — invisible
# in any count, and visible to a reader as a card missing its outlet chips
# or two stories swapping places between the hourly release and the one
# five minutes later.
from build_app_data import (
    FEED_OMIT, STORY_PAGE_SIZE, article_sort_key, story_index_row,
    story_prominence, utc_instant,
    story_sort_key)

OVERLAY_SCHEMA_VERSION = 1


# --------------------------------------------------------------------------
# Keyed upsert — the one primitive every merge below is built from.
# --------------------------------------------------------------------------

def upsert(base: list, incoming: list, *, key, removed=()) -> list:
    """`base` with `incoming` applied by `key`, and `removed` keys dropped.

    Order: an unchanged base row keeps its position, an updated one is
    replaced in place, and a genuinely new row is appended. Callers that
    care about order re-sort afterwards — which every caller here does, so
    the appended position is never load-bearing. It exists so that a caller
    who forgets to sort gets a stable result rather than a random one.
    """
    removed = set(removed)
    by_key = {}
    for row in incoming:
        k = key(row)
        if k is not None:
            by_key[k] = row
    out = []
    seen = set()
    for row in base:
        k = key(row)
        if k in removed:
            continue
        if k in by_key:
            out.append(by_key[k])
            seen.add(k)
        else:
            out.append(row)
    for row in incoming:
        k = key(row)
        if k is None or k in seen or k in removed:
            continue
        out.append(row)
        seen.add(k)
    return out


MERGED_PATHS = frozenset({"latest.json", "stories.json", "home.json",
                          "stories/by-url.json"})

# The files the merge RE-STAMPS, as opposed to replacing or enveloping.
# `home.json` is absent because the overlay carries it whole.
RESTAMPED_PATHS = frozenset({"latest.json", "stories.json",
                             "stories/by-url.json"})


def _is_merged_path(path: str) -> bool:
    """Does one of the per-path merges above own this file?

    The complement is what `replaced_paths` carries whole, so this is the
    boundary between "too big to ship" and "ship it". Getting it wrong in
    one direction ships `stories.json` in every overlay; in the other it
    ships a second, stale copy of a file a merge already owns, and the two
    then disagree about the same release.
    """
    # ⚠️ THE FILTER INDEX IS CARRIED WHOLE, NOT MERGED. Nothing here merges
    # it, so leaving it inside `stories/` meant the overlay passed the BASE's
    # copy through: a story published in the hot window was absent from every
    # facet while being present in the pages — „filter what you happen to
    # have", which is the exact defect the index was built to remove. It is
    # one whole-corpus file of ~45 KB, about 2% of the overlay ceiling, and
    # a merge for it would have to re-derive counts over rows the overlay
    # does not hold.
    if path == "stories/filter-index.json":
        return False
    return (path in MERGED_PATHS
            or path.startswith("articles/")
            or path.startswith("stories/"))


def _article_key(record: dict):
    return record.get("url")


def _story_key(story: dict):
    return story.get("id")


# --------------------------------------------------------------------------
# The per-path merges.
# --------------------------------------------------------------------------

def merge_articles_bundle(base: dict, records: list, *, removed_urls=(),
                          envelope: dict) -> dict:
    """`articles/<domain>.json` — upsert by url, newest first.

    ⚠️ THE ENVELOPE IS CARRIED WHOLE, not field by field, and a new outlet
    is why. Every non-article field of the bundle — `domain`, `outlet`, and
    the content-derived `generated_at` — comes from the overlay rather than
    from the base, because a domain appearing for the first time has NO
    base bundle to inherit them from: the merge would publish a real
    outlet's articles under an envelope it had invented. Naming the fields
    individually here also puts a second copy of the bundle's shape in a
    file that must not have one; the first `outlet` renamed upstream would
    then silently keep its old name on every hot release.

    `generated_at` in particular is never recomputed. It is content-derived
    (`bundle_generated_at`), and a merge that guessed it would rewrite
    every bundle on every hot run — the exact churn the content stamp was
    introduced to remove.
    """
    merged = upsert(base.get("articles") or [], records,
                    key=_article_key, removed=removed_urls)
    merged.sort(key=article_sort_key, reverse=True)
    return {**base, **envelope, "articles": merged}


def merge_latest(base: dict, records: list, *, removed_urls=(), limit: int,
                 generated_at: str) -> dict:
    """`latest.json` — the N newest articles corpus-wide.

    ⚠️ A GLOBAL TRUNCATED SORT, WHICH IS WHY IT IS RECOMPUTED AND NOT
    PATCHED. Appending the overlay's records to the base's list is wrong in
    both directions: it overflows `limit`, and a record the overlay merely
    TOUCHED (a re-analysis, a corrected title) is already in the base, so
    appending publishes it twice. Upsert-then-sort-then-truncate is the
    only form that reproduces the builder.

    ⚠️ THE FEED RECORD IS NARROWER THAN THE BUNDLE RECORD, so the overlay's
    records are projected here rather than carried a second time. The
    builder drops `FEED_OMIT` — `section_path`, `image_alt`, `first_seen`,
    `keywords` — because they are read on the article page only, which
    already loads the per-domain bundle; measured 2026-08-26, carrying them
    takes this file from 763 KB to 955 KB, on the one object every page in
    the app downloads before it can paint. The field list is IMPORTED, not
    restated: a merge with its own copy would publish wider records for
    exactly the articles a hot run touched, quietly re-inflating the file
    the `FEED_GZIP_BUDGET_BYTES` gate exists to hold down.
    """
    records = [{k: v for k, v in r.items() if k not in FEED_OMIT}
               for r in records]
    merged = upsert(base.get("articles") or [], records,
                    key=_article_key, removed=removed_urls)
    merged = [r for r in merged if r.get("published")]
    merged.sort(key=article_sort_key, reverse=True)
    return {**base, "generated_at": generated_at, "articles": merged[:limit]}


def merge_stories(base: dict, stories: list, *, removed_ids=(),
                  generated_at: str) -> dict:
    """`stories.json` — the legacy whole-corpus file, upsert by id.

    Sorted on `(last_published, id)` to match the builder. The id tiebreak
    is what makes this reconstructible at all: on the real corpus 183 of
    1,919 stories carry a NULL `last_published` and tie at "", and under a
    bare stable sort their order is a fact about how the run was assembled,
    which no merge can recover.
    """
    merged = upsert(base.get("stories") or [], stories,
                    key=_story_key, removed=removed_ids)
    merged.sort(key=story_sort_key, reverse=True)
    return {**base, "generated_at": generated_at, "stories": merged}


def overlay_stories(overlay: dict) -> list:
    """The changed story OBJECTS, derived from the changed detail files.

    ⚠️ ONE PRIMARY FACT, NOT TWO, AND THE REASON IS A REAL ASYMMETRY. A
    detail file can change while its story does not: `related` carries the
    RECIPROCAL half of relatedness — the stories pointing back at this one
    — so publishing a new story that links to T rewrites T's detail file
    although nothing about T moved. Carrying `stories` beside
    `story_details` would therefore need the two lists to have different
    memberships and still agree about every story in both, which nothing
    would enforce. Deriving is free instead: upserting a story identical to
    the base's is a no-op in `stories.json`, the index and the url map.
    """
    return [payload["story"]
            for _id, payload in sorted((overlay.get("story_details") or {}).items())
            if isinstance(payload, dict) and payload.get("story") is not None]


def merge_stories_by_url(base: dict, stories: list, *, removed_ids=(),
                         generated_at: str) -> dict:
    """`stories/by-url.json` — article url → story id.

    ⚠️ A TOUCHED STORY CAN LOSE A MEMBER, so this is not a dict update.
    When two stories are merged, the members move; patching only the winner
    leaves every moved url still pointing at the story it left, and
    ArticleScreen then fetches a detail file that does not contain the
    article the reader is on. Every url belonging to a story this overlay
    touches is therefore REBUILT from that story's member list, not added
    to.
    """
    touched = {s.get("id") for s in stories if s.get("id")} | set(removed_ids)
    out = {url: sid
           for url, sid in (base.get("stories_by_url") or {}).items()
           if sid not in touched}
    for story in stories:
        sid = story.get("id")
        if not sid:
            continue
        for member in story.get("members") or []:
            if isinstance(member, dict) and member.get("url"):
                out[member["url"]] = sid
    return {**base, "generated_at": generated_at,
            "stories_by_url": dict(sorted(out.items()))}


def merge_story_index(base_pages: list, index_rows: list, *, removed_ids=(),
                      page_size: int, generated_at: str,
                      sort: str = "latest") -> list:
    """`stories/index-N.json` / `ranked-N.json` — upsert, re-sort, re-paginate.

    ⚠️ THE PAGES ARE NOT INDEPENDENT AND CANNOT BE PATCHED ONE AT A TIME.
    The index is newest-first, so one story moving to the front shifts every
    later story by one and therefore rewrites every page after it. The merge
    is flatten → upsert → sort → re-slice; anything cheaper produces a page
    boundary that duplicates or drops a story, which is invisible in a
    page's own `total` field because that field is recomputed too.

    Returns the full page list, so a caller writing fewer pages than the
    base held must delete the tail — the count can go DOWN when stories are
    merged away.
    """
    flat = []
    for page in base_pages:
        flat.extend(page.get("stories") or [])
    merged = upsert(flat, index_rows, key=_story_key, removed=removed_ids)
    base_as_of = (base_pages[0].get("as_of") if base_pages else None) or generated_at
    if sort == "prominence":
        # ⚠️ THE ROWS' OWN STORED SCORES, AND THE BASE'S `as_of`. Prominence
        # DECAYS with the instant it was computed against, so a correct
        # re-ranking would have to re-score every row in the corpus — which is
        # precisely the full rebuild an overlay exists to avoid. Upserting and
        # removing keeps the ordering free of phantom and missing stories,
        # which is the reachability rule; it does not pretend the ORDER is
        # fresh. The page keeps the base's `as_of` and says `stale_ranking`, so
        # a client can offer the new-results notice rather than silently
        # showing a mixture of two snapshots as one ranking.
        merged.sort(key=lambda r: r.get("id") or "")
        merged.sort(key=lambda r: r.get("last_published") or "", reverse=True)
        merged.sort(key=lambda r: (r.get("prominence") or {}).get("score", 0.0),
                    reverse=True)
        as_of, stale = base_as_of, bool(index_rows) or bool(removed_ids)
    else:
        merged.sort(key=story_sort_key, reverse=True)
        # Newest-first does not decay, so the merged order IS current.
        as_of, stale = generated_at, False
    pages = [merged[i:i + page_size]
             for i in range(0, len(merged), page_size)] or [[]]
    return [{"generated_at": generated_at,
             "as_of": as_of,
             "sort": sort,
             "prominence_version": (base_pages[0].get("prominence_version")
                                    if base_pages else None),
             "stale_ranking": stale,
             "page": number, "pages": len(pages),
             "page_size": page_size, "total": len(merged),
             "stories": page}
            for number, page in enumerate(pages, start=1)]


def apply_overlay(base: dict, overlay: dict) -> dict:
    """The whole merge: a base release keyed by path, plus an overlay.

    Returns the merged release in the same shape. Paths the overlay does
    not touch are passed through unchanged — which is most of them, and is
    why a reader on a warm base pays one small fetch for a release.

    ⚠️ Index pages are returned as the merge computed them, so the caller
    must DELETE any `stories/index-N.json` beyond the returned count. The
    page count goes down when stories are merged away, and a leftover tail
    page is served, parses, and shows stories the index no longer lists.
    """
    # ⚠️ REFUSED, NOT IGNORED. A reader that silently merged an overlay it
    # does not understand would publish a release nobody built — and the
    # failure is invisible, because the unknown arms are simply skipped and
    # every path still parses. The version is the only thing standing
    # between a future overlay shape and a plausible-looking wrong answer.
    version = overlay.get("schema_version")
    if version != OVERLAY_SCHEMA_VERSION:
        raise ValueError(
            f"overlay schema_version {version!r} is not "
            f"{OVERLAY_SCHEMA_VERSION} — refusing to merge")
    stamps = overlay.get("merged_stamps") or {}
    # The base's own value when the overlay does not carry one, so a path
    # this release did not touch is never re-stamped.
    def stamp_for(path: str):
        return stamps.get(path, (base.get(path) or {}).get("generated_at"))
    envelopes = overlay.get("bundle_envelopes") or {}
    stories = overlay_stories(overlay)
    removed_ids = overlay.get("removed_story_ids") or []
    out = dict(base)

    for domain in overlay.get("removed_domains") or []:
        out.pop(f"articles/{domain}.json", None)
    for domain, records in (overlay.get("articles") or {}).items():
        path = f"articles/{domain}.json"
        out[path] = merge_articles_bundle(
            out.get(path) or {"articles": []},
            records,
            removed_urls=(overlay.get("removed_article_urls") or {}).get(domain, ()),
            envelope=envelopes.get(domain) or {})

    # `latest.json` is corpus-wide, so it takes EVERY domain's delta — not
    # only the one being looked at. The records arrive in BUNDLE shape and
    # `merge_latest` narrows them to feed shape itself, via the builder's
    # own `FEED_OMIT`; do not "optimise" that projection away, or the one
    # object every page downloads before it can paint re-inflates by 25%
    # for exactly the articles a hot run touched.
    feed_delta = [r for records in (overlay.get("articles") or {}).values()
                  for r in records]
    feed_removed = [u for urls in (overlay.get("removed_article_urls") or {}).values()
                    for u in urls]
    if "latest.json" in out:
        out["latest.json"] = merge_latest(
            out["latest.json"], feed_delta, removed_urls=feed_removed,
            limit=overlay["latest_limit"],
            generated_at=stamp_for("latest.json"))

    if "stories.json" in out:
        out["stories.json"] = merge_stories(
            out["stories.json"], stories, removed_ids=removed_ids,
            generated_at=stamp_for("stories.json"))

    # ⚠️ BOTH ORDERINGS, or the overlay leaves one of them listing stories the
    # other has removed. `ranked-*` is scored against the base instant and says
    # so; see `merge_story_index`.
    for prefix, sort in (("stories/index-", "latest"),
                         ("stories/ranked-", "prominence")):
        base_pages = [out[p] for p in sorted(
            (p for p in out if p.startswith(prefix)),
            key=lambda p: int(p.rsplit("-", 1)[1][:-5]))]
        if not base_pages:
            continue
        # The row's `as_of` must match the family it joins, so a ranked row
        # carries the base's instant rather than this overlay's.
        row_as_of = utc_instant(
            base_pages[0].get("as_of") if sort == "prominence"
            else stamp_for(f"{prefix}1.json"))
        # The story objects already carry `prominence` — the builder stamps it
        # once, before any writer — so the row projection copies it.
        index_rows = [story_index_row(s, row_as_of) for s in stories]
        pages = merge_story_index(
            base_pages, index_rows, removed_ids=removed_ids,
            # The base's own page size, so a release built under a
            # different one still re-paginates the way it was written;
            # `STORY_PAGE_SIZE` is the builder's value, for a base that
            # somehow carries none. Never a count derived from the delta —
            # that makes the page boundary depend on how busy the hour was.
            page_size=base_pages[0].get("page_size") or STORY_PAGE_SIZE,
            generated_at=stamp_for(f"{prefix}1.json"),
            sort=sort)
        for path in [p for p in out if p.startswith(prefix)]:
            del out[path]
        for number, page in enumerate(pages, start=1):
            out[f"{prefix}{number}.json"] = page

    if "stories/by-url.json" in out:
        out["stories/by-url.json"] = merge_stories_by_url(
            out["stories/by-url.json"], stories, removed_ids=removed_ids,
            generated_at=stamp_for("stories/by-url.json"))

    for story_id in removed_ids:
        out.pop(f"stories/{story_id}.json", None)
    for story_id, payload in (overlay.get("story_details") or {}).items():
        out[f"stories/{story_id}.json"] = payload

    if overlay.get("home") is not None:
        out["home.json"] = overlay["home"]
    for path in overlay.get("removed_paths") or []:
        out.pop(path, None)
    out.update(overlay.get("replaced_paths") or {})
    return out


# --------------------------------------------------------------------------
# The reference differ.
# --------------------------------------------------------------------------

def diff_overlay(base: dict, full: dict, *, seq: int, base_run_id: str,
                 generated_at: str, latest_limit: int) -> dict:
    """`full` − `base`, over two already-built releases.

    ⚠️ THIS IS WHAT THE HOT PATH USES, AND AN EARLIER NOTE HERE SAID THE
    OPPOSITE. It claimed the hot path "cannot" take a full rebuild as its
    second argument, and that `build_overlay.py` would compute the same
    delta from the store incrementally. That was a prediction written
    before the timings were read, and it is wrong: `bundles` is **21–76 s**
    (§4.2, three runs) against the **96 s + 22.6 s** of upload the overlay
    removes. The rebuild was never the cost.

    Which leaves the reason to prefer this differ anyway: it is the only
    one that cannot disagree with `bundles`, because it reads what
    `bundles` wrote. An incremental differ would be a second
    implementation of every rule about what a release contains, with
    nothing to check it against except the rebuild it exists to avoid.

    `base` and `full` are the release payloads keyed by published path.
    """
    def records(release, domain):
        return ((release.get(f"articles/{domain}.json") or {})
                .get("articles") or [])

    domains = {p.split("/", 1)[1][:-5] for p in full if p.startswith("articles/")}
    base_domains = {p.split("/", 1)[1][:-5]
                    for p in base if p.startswith("articles/")}

    changed_articles: dict[str, list] = {}
    envelopes: dict[str, dict] = {}
    removed_urls: dict[str, list] = {}
    # ⚠️ THE UNION, NOT `full`'s DOMAINS. An outlet that disappears between
    # two releases has no bundle in `full` to iterate, so walking `full`
    # alone records the vanished BUNDLE and none of the article urls that
    # were in it — and `latest.json` is corpus-wide, so those urls stay at
    # the top of the feed, linking to a bundle the same release deleted.
    # Measured: `https://c.bg/four` remained the first card of the merged
    # feed after its outlet was removed.
    for domain in sorted(domains | base_domains):
        bundle = full.get(f"articles/{domain}.json")
        was = {r.get("url"): r for r in records(base, domain)}
        now = records(full, domain)
        delta = [r for r in now if was.get(r.get("url")) != r]
        gone = sorted(set(was) - {r.get("url") for r in now} - {None})
        if bundle is None:
            # The whole outlet went. `removed_domains` drops the bundle;
            # this is what drops its articles from the feed.
            if gone:
                removed_urls[domain] = gone
            continue
        envelope = {k: v for k, v in bundle.items() if k != "articles"}
        if (delta or gone or domain not in base_domains
                or envelope != {k: v
                                for k, v in (base.get(f"articles/{domain}.json")
                                             or {}).items()
                                if k != "articles"}):
            changed_articles[domain] = delta
            removed_urls[domain] = gone
            envelopes[domain] = envelope

    # ⚠️ DIFFED ON THE DETAIL FILE, NOT ON THE STORY OBJECT, and the gap
    # between the two is not an edge case. `related` in a detail file
    # carries the RECIPROCAL half of relatedness, so a brand-new story that
    # links to T rewrites T's file while T itself is untouched. Diffing
    # story objects would leave T's published detail asserting it is
    # related to nothing, indefinitely, at a 200 — and no row count would
    # move. It also subsumes the story diff, since a changed story always
    # changes its own file.
    def details(release):
        return {path.split("/", 1)[1][:-5]: payload
                for path, payload in release.items()
                if path.startswith("stories/")
                and not path.startswith("stories/index-")
                and not path.startswith("stories/ranked-")
                # ⚠️ NOT A DETAIL FILE. It is the whole-corpus structured
                # index; treating it as one story's payload raises KeyError on
                # `story` and ships it as a detail nobody can merge.
                and path != "stories/filter-index.json"
                and path != "stories/by-url.json"}

    base_details, full_details = details(base), details(full)
    # ⚠️⚠️ COMPARED WITHOUT `prominence`, AND THIS IS NOT A TIDY-UP. That field
    # is a DERIVED score that decays against the run clock, and a detail file's
    # stamp is content-derived precisely so an unchanged story stays
    # byte-identical between releases. Leave prominence in the comparison and
    # every story looks changed on every run: measured on the fixture, nothing
    # in the corpus edited and five minutes of wall clock shipped 3 of 3
    # details (0 of 3 with the clock pinned). At production scale that is
    # ~3,031 details / 11.0 MB against the 2 MB MAX_OVERLAY_BYTES ceiling —
    # every hot publish refused, and every cold one re-uploading the corpus to
    # convey nothing.
    #
    # A story whose CONTENT changed still ships, carrying whatever score it
    # was built with; one whose score merely decayed does not, which is
    # exactly the `stale_ranking` semantics the ranked pages already declare.
    def without_prominence(payload):
        story = payload.get("story") if isinstance(payload, dict) else None
        if not isinstance(story, dict) or "prominence" not in story:
            return payload
        return {**payload,
                "story": {k: v for k, v in story.items() if k != "prominence"}}

    changed_details = {story_id: payload
                       for story_id, payload in sorted(full_details.items())
                       if without_prominence(base_details.get(story_id))
                       != without_prominence(payload)}
    removed_ids = sorted(set(base_details) - set(full_details))

    # ⚠️ THE TWO CASES A MERGE CANNOT COMPUTE, SHIPPED WHOLE INSTEAD.
    # Everything above is a delta a merge folds into the base; these are the
    # paths where that is not possible even in principle, so the overlay
    # carries the file. Both were live defects before they were listed here.
    carry_whole = set()

    # (1) A SINGLETON FILE THE BASE DOES NOT HAVE. `apply_overlay` merges
    # into what the base holds, so a `latest.json`/`stories.json`/`home.json`
    # /`by-url`/index the base lacks has nothing to merge into and would be
    # dropped from the merged release without a word. That is a first
    # overlay against a base built by an older builder, and it is silent.
    # (The per-story details and per-domain bundles are exempt: their own
    # arms already carry a file the base has never seen.)
    # The symmetric case is the planned retirement of `stories.json`: a
    # singleton the builder STOPS writing must be dropped from the merged
    # release too, or a hot reader keeps a file the cold path has retired.
    for path in set(full) | set(base):
        if path in MERGED_PATHS or path.startswith(
                ("stories/index-", "stories/ranked-")):
            if (path in base) != (path in full):
                carry_whole.add(path)

    # (2) THE TRUNCATION BOUNDARY OF `latest.json`. The feed is the N newest
    # articles corpus-wide, so when a record LEAVES the top N the record
    # that should take the freed slot is in neither the base's list (it was
    # past the cut) nor the overlay (it did not change). Measured: base
    # [four, three, two] → rebuild [three, two, one] → merge [three, two],
    # i.e. the feed silently shortens and hides an article until the next
    # cold build. A record can leave by being removed OR by being re-dated
    # downwards, so both count — but only when the base was actually AT the
    # limit; below it nothing was ever cut off and the merge is exact.
    base_feed = (base.get("latest.json") or {}).get("articles") or []
    if len(base_feed) >= latest_limit:
        base_feed_urls = {r.get("url") for r in base_feed}
        displaced = (any(urls for urls in removed_urls.values())
                     or any(r.get("url") in base_feed_urls
                            for delta in changed_articles.values()
                            for r in delta))
        if displaced:
            carry_whole.add("latest.json")

    def carried(path: str) -> bool:
        return not _is_merged_path(path) or path in carry_whole

    return {
        "schema_version": OVERLAY_SCHEMA_VERSION,
        "seq": seq,
        "base_run_id": base_run_id,
        "generated_at": generated_at,
        # ⚠️ TWO KINDS OF STAMP, AND BOTH ARE CARRIED RATHER THAN
        # RECOMPUTED. This one is the RUN's time, which `latest.json`,
        # `stories.json` and the story index carry. The per-domain bundles'
        # is CONTENT-derived (`bundle_generated_at`) and rides in
        # `bundle_envelopes` with the rest of the bundle's shape — see
        # `merge_articles_bundle` for why it is carried and not guessed.
        "release_generated_at": full.get("home.json", {}).get("generated_at"),
        # ⚠️ A STAMP PER RE-STAMPED FILE, NOT ONE FOR ALL OF THEM. Each
        # of these keeps its own `generated_at` when its content did not
        # change, so they legitimately differ — `latest.json` can sit at
        # an older stamp than `stories.json` on any hour when the feed was
        # unchanged and a story moved. Re-stamping all four from one value
        # made the merge disagree with the rebuild for exactly that case,
        # which the fixtures could not show because they move together in
        # every scenario.
        #
        # ⚠️ ONLY the files the merge RE-STAMPS. A per-story detail file
        # is replaced wholesale and an article bundle takes its envelope,
        # so neither needs an entry here — and including them put one line
        # per story in every overlay: ~1,919 in production, 115 KB to say
        # nothing. Measured on the fixture as 10,110 B against a 58,798 B
        # tree, which is what caught it.
        "merged_stamps": {
            path: full[path].get("generated_at")
            for path in sorted(RESTAMPED_PATHS | {
                p for p in full
                if p.startswith(("stories/index-", "stories/ranked-"))})
            if isinstance(full.get(path), dict)
            and isinstance(full[path].get("generated_at"), str)
        },
        "bundle_envelopes": envelopes,
        # Not recoverable from the output: a `latest.json` shorter than the
        # limit is indistinguishable from one the limit never reached.
        "latest_limit": latest_limit,
        "articles": changed_articles,
        "removed_article_urls": {d: u for d, u in removed_urls.items() if u},
        "removed_domains": sorted(base_domains - domains),
        "story_details": changed_details,
        "removed_story_ids": removed_ids,
        "home": full.get("home.json"),
        # ⚠️ EVERYTHING ELSE THAT DIFFERS, CARRIED WHOLE — and this arm is
        # what makes the overlay EXACT rather than approximately right.
        # The named families above are merged because carrying them whole
        # would defeat the point; every other published path is small and
        # is simply replaced. Two things that is not: it is not a
        # convenience, because `feedback-targets.json` genuinely changes
        # when an article appears and a reader on a stale copy cannot
        # submit feedback on the new one; and it is not a list to
        # maintain, because a path the builder adds tomorrow is covered
        # the day it is added rather than silently going stale on every
        # hot release while the hourly one looks fine.
        "replaced_paths": {
            path: payload for path, payload in sorted(full.items())
            if carried(path) and base.get(path) != payload
        },
        "removed_paths": sorted(
            path for path in base if carried(path) and path not in full),
    }
