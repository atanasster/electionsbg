#!/usr/bin/env python3
"""T4.2 — publish party treatment: dated count distributions with VISIBLE
denominators, per party and per topic.

⚠️ THREE REFUSALS SHAPE THIS FILE, and each of them is a claim we decline to
make rather than a feature we have not built yet.

1. **A party without a resolved `party_id` gets no page and no row.** The
   surface the model wrote („Възраждане" with no gazetteer claim, or a name
   the registry refuses because it is shared) is a NAME, not an identity —
   name-match ≠ identity — so it is counted once, as an unresolved-surface
   total, and never rolled up under a party. The bucket holds two different
   things and says so: a surface the registry KNOWS and refuses (shared,
   ambiguous) and one it has never heard of (a foreign party — „Алтернатива
   за Германия", „ХДС" — which this registry does not cover at all). See the
   §0.1 T4.2 row for the dated split and every measured figure — they move
   with the corpus, so this file keeps none of its own.
2. **A party's own tone is never inferred from a person's, or the reverse.**
   Nothing here reads person data. The plan says so twice.
3. **The rollup is an ARCHIVE FILTER, never a leaderboard.** Parties are
   ordered by how much coverage the corpus holds, never by how favourable it
   is, and no party carries a score. The sibling plan
   (`news-party-tone-integration-v1.md`) says party tone is „a dimension of
   articles, stories, topics and outlet profiles, not a standalone
   leaderboard"; `/party/:id` exists to SHOW THE ARTICLES.

Every figure carries its denominator: `assessed` is the number of
(party, article) pairs this distribution is over, `articles` the distinct
articles, `outlets` the distinct outlets, and `window` the first and last
publication date in it. A tone that the T4.1 evidence gate withheld never
arrives here (`build_app_data` filters it out of the public analysis), and a
scoped-observation article (T4.1c) is excluded by `rollup_eligible` — both
exclusions are counted so the omission is visible rather than silent.
"""
from __future__ import annotations

TONE_ORDER = ("favorable", "neutral", "unfavorable", "mixed")
# The id charset the writer and the client share; `partyId.ts` is the twin.
import re

PARTY_ID_SAFE = re.compile(r"\A[A-Za-z0-9_-]{1,80}\Z")
# How many unresolved surfaces the index carries; the totals cover all.
UNRESOLVED_SHOWN = 20


def empty_counts() -> dict:
    return {tone: 0 for tone in TONE_ORDER}


def _add(bucket: dict, tone: str) -> None:
    if tone in bucket:
        bucket[tone] += 1


def collect(rows: list, rollup_eligible, in_registry=None) -> dict:
    """Fold published party tones into per-party and per-topic distributions.

    `rows` is one dict per PUBLISHABLE article:
        {url, domain, published, title, article_id, story_id, analysis}
    — `article_id` is what makes a row linkable, so a row without one renders
    as plain text rather than a dead link.

    `rollup_eligible` is `analyze_articles.rollup_eligible` — injected so this
    module imports nothing from the analysis layer and the ONE rule still
    decides. `in_registry(surface) -> bool` is optional and splits the
    unresolved bucket into „the registry refuses this surface" and „the
    registry does not cover this party at all"; without it every unresolved
    surface is reported as `unknown`.
    """
    parties: dict = {}
    topics: dict = {}
    unresolved: dict = {}
    scoped_out = 0
    refused_id = 0
    duplicate_pairs = 0
    for row in rows:
        analysis = row.get("analysis") or {}
        tones = [t for t in (analysis.get("party_tones") or []) if isinstance(t, dict)]
        if not tones:
            continue
        if not rollup_eligible(analysis):
            # T4.1c — a scoped observation is not a whole-article claim.
            scoped_out += len(tones)
            continue
        primary = next((t for t in (analysis.get("topics") or [])
                        if isinstance(t, dict) and t.get("primary")), None)
        category = (primary or {}).get("category")
        for tone in tones:
            label = tone.get("tone")
            if label not in TONE_ORDER:
                continue
            party_id = tone.get("party_id")
            if not party_id:
                # Refusal 1: a surface, not an identity.
                name = str(tone.get("party") or "").strip()
                if name:
                    entry = unresolved.setdefault(name, {
                        "surface": name, "pairs": 0,
                        "basis": ("refused" if in_registry and in_registry(name)
                                  else "unknown" if in_registry else "unknown"),
                    })
                    entry["pairs"] += 1
                continue
            if not PARTY_ID_SAFE.match(str(party_id)):
                # The id reaches a URL and a file path. Refused ONCE, here, so
                # the index, the payloads and every link inherit the refusal —
                # a row the client cannot link is worse than no row.
                refused_id += 1
                continue
            party = parties.setdefault(party_id, {
                "party_id": party_id,
                "names": {},
                "counts": empty_counts(),
                "assessed": 0,
                "articles": set(),
                "outlets": set(),
                "first_published": None,
                "last_published": None,
                "undated": 0,
                "pairs_seen": set(),
                "rows": [],
            })
            name = str(tone.get("party") or "").strip()
            if name:
                party["names"][name] = party["names"].get(name, 0) + 1
            # ⚠️ ONE PAIR PER (ARTICLE, PARTY), like both story writers. An
            # article naming „ГЕРБ" and „ГЕРБ-СДС" carries two tones for one
            # identity; counting both would inflate a denominator captioned
            # „(партия, материал)". The collision is counted, not dropped.
            key = (row.get("url"), party_id)
            if key in party["pairs_seen"]:
                duplicate_pairs += 1
                continue
            party["pairs_seen"].add(key)
            _add(party["counts"], label)
            party["assessed"] += 1
            party["articles"].add(row.get("url"))
            party["outlets"].add(row.get("domain"))
            published = row.get("published")
            if not published:
                party["undated"] += 1
            if published:
                if not party["first_published"] or published < party["first_published"]:
                    party["first_published"] = published
                if not party["last_published"] or published > party["last_published"]:
                    party["last_published"] = published
            party["rows"].append({
                "url": row.get("url"),
                "domain": row.get("domain"),
                "article_id": row.get("article_id"),
                "title": row.get("title"),
                "published": published,
                "story_id": row.get("story_id"),
                "tone": label,
                "rationale": tone.get("rationale"),
                # ⚠️ SHORT EVIDENCE ONLY — the located quotes, never the body.
                "evidence_spans": [
                    {k: v for k, v in span.items()
                     if k in ("quote", "field", "direction", "voice", "speaker", "located")}
                    for span in (tone.get("evidence_spans") or [])
                    if isinstance(span, dict)
                ],
            })
            if category:
                cat = topics.setdefault(category, {})
                bucket = cat.setdefault(party_id, empty_counts())
                _add(bucket, label)
    return {"parties": parties, "topics": topics, "unresolved": unresolved,
            "scoped_out": scoped_out, "refused_id": refused_id,
            "duplicate_pairs": duplicate_pairs}


def party_index(collected: dict, generated_at: str, rubric_version: str) -> dict:
    """The index: one row per RESOLVED party, ordered by how much coverage the
    corpus holds — never by how favourable it is."""
    rows = []
    for party in collected["parties"].values():
        rows.append({
            "party_id": party["party_id"],
            "name": most_common_name(party["names"]),
            "counts": dict(party["counts"]),
            "assessed": party["assessed"],
            "article_count": len(party["articles"]),
            "outlet_count": len(party["outlets"]),
            "first_published": party["first_published"],
            "last_published": party["last_published"],
            "undated": party["undated"],
        })
    rows.sort(key=lambda r: (-r["assessed"], r["party_id"]))
    # ⚠️ The index ships the TOP surfaces and the totals, not all of them:
    # the page prints the counts and the worst offenders, and 158 rows of
    # long tail is payload nobody renders. The totals below are over ALL of
    # them, so nothing is hidden by the cap.
    all_unresolved = sorted(collected["unresolved"].values(),
                            key=lambda r: (-r["pairs"], r["surface"]))
    unresolved = all_unresolved[:UNRESOLVED_SHOWN]
    return {
        "version": 1,
        "generated_at": generated_at,
        "rubric_version": rubric_version,
        "parties": rows,
        # The omissions, counted rather than silent.
        "unresolved_surfaces": unresolved,
        "unresolved_surface_count": len(all_unresolved),
        "unresolved_pairs": sum(r["pairs"] for r in all_unresolved),
        "unresolved_refused_pairs": sum(r["pairs"] for r in all_unresolved
                                        if r.get("basis") == "refused"),
        "unresolved_unknown_pairs": sum(r["pairs"] for r in all_unresolved
                                        if r.get("basis") != "refused"),
        "scoped_out_pairs": collected["scoped_out"],
        "refused_id_pairs": collected.get("refused_id", 0),
        "duplicate_pairs": collected.get("duplicate_pairs", 0),
    }


# ⚠️ The archive is PAGINATED for the same reason the story index is: the
# largest party carried 147 KB (33.5 KB gz) unbounded, and it grows with the
# corpus. Page 1 ships with the header; the rest are fetched on demand.
PARTY_PAGE_SIZE = 50


def party_payload(party: dict, generated_at: str, rubric_version: str,
                  *, page: int = 1, page_size: int = PARTY_PAGE_SIZE) -> dict:
    """One party's archive page: the distribution, its denominators, and the
    articles the distribution is made of, newest first."""
    # ⚠️ Sorted on the INSTANT, not the string: the corpus carries both
    # `+00:00` and `Z` offsets, which string-sort against each other wrongly.
    rows = sorted(party["rows"], key=_published_key, reverse=True)
    total_pages = max(1, -(-len(rows) // page_size))
    page = min(max(page, 1), total_pages)
    window = rows[(page - 1) * page_size: page * page_size]
    return {
        "version": 1,
        "generated_at": generated_at,
        "rubric_version": rubric_version,
        "party_id": party["party_id"],
        "name": most_common_name(party["names"]),
        "names_seen": sorted(party["names"], key=lambda n: (-party["names"][n], n)),
        "counts": dict(party["counts"]),
        "assessed": party["assessed"],
        "article_count": len(party["articles"]),
        "outlet_count": len(party["outlets"]),
        "first_published": party["first_published"],
        "last_published": party["last_published"],
        "undated": party["undated"],
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "articles": window,
    }


def _published_key(row: dict):
    from datetime import datetime, timezone
    value = row.get("published")
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return (0, datetime.min.replace(tzinfo=timezone.utc))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (1, parsed)


def most_common_name(names: dict) -> str | None:
    if not names:
        return None
    return sorted(names, key=lambda n: (-names[n], n))[0]
