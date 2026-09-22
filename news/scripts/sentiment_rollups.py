#!/usr/bin/env python3
"""T4.4 Phase 3 — per-outlet and over-time aggregation of one subject's rows.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` Phase 3 and §6.3. Shared by
the party (T4.2) and person (T4.3) archives, which ask the same two questions
about a different subject: **which outlets, and when**.

⚠️ THE COUNTS WORK TODAY AND THE SCALAR IS OPTIONAL. Every row already carries
a nominal `tone`; a `sentiment` block with a continuous `value` arrives only
once the Jev pass is live for that article. So every function here reports the
counts unconditionally and the scalar only where it exists, with its own `n` —
a mean over the handful of scored rows on a page of forty is a number that
looks like the page's and is not.

⚠️ NO SINGLE CONTEXT-FREE NUMBER FOR AN OUTLET. Refusal 4 of the plan: a
per-subject series over time describes COVERAGE and is what §6.3 draws; a
scalar labelled "pik.bg: −1.8" is a rating of a publication, which this project
does not publish. `outlet_breakdown` is therefore always per (outlet, SUBJECT)
and always carries its denominator — it is a filter over one archive, never a
league table of outlets.
"""
from __future__ import annotations

import math
from datetime import timedelta, timezone

from rollup_common import published_key

try:
    from zoneinfo import ZoneInfo

    # ⚠️ THE CORPUS'S OWN WALL CLOCK, not UTC. This is Bulgarian news: an
    # article published at 01:00 on 1 January Sofia time is 23:00 on
    # 31 December UTC, so a UTC cut files it under the previous day, the
    # previous month AND the previous year. The reader's "that week" is the
    # newsroom's.
    CORPUS_TZ = ZoneInfo("Europe/Sofia")
except Exception:  # pragma: no cover — a tzdata-less environment
    CORPUS_TZ = timezone.utc

# ⚠️ READ FROM `party_rollups`, NOT RESTATED. The nominal vocabulary is one
# list; two copies is how a fifth label reaches the archive counts and not the
# breakdown beneath them. (`mixed` is a label GLM writes; on the ordinal side
# it is DERIVED from the distribution and never stored — `jev_scales`.)
from party_rollups import TONE_ORDER, empty_counts  # noqa: E402,F401

# ⚠️ CHOSEN FROM THE SPAN, not fixed. A month bucket over a three-week corpus
# is one point (no line at all); a day bucket over three years is ~1,100 points
# of mostly-zero. The thresholds are stated here so a reader of the payload can
# see which rule produced their x-axis — the payload carries `granularity`.
GRANULARITY_THRESHOLDS = ((timedelta(days=45), "day"),
                          (timedelta(days=560), "week"))
DEFAULT_GRANULARITY = "month"


def empty_counts() -> dict:
    return {tone: 0 for tone in TONE_ORDER}


def outlet_breakdown(rows: list) -> list:
    """One entry per outlet that covered this subject, most coverage first.

    ⚠️ ALWAYS WITH ITS DENOMINATOR. "actualno.com: positive" is a claim about
    one article when the outlet published one; the entry carries `assessed` so
    the reader sees which it is.
    """
    by_domain: dict = {}
    for row in rows:
        domain = row.get("domain")
        if not domain:
            continue
        entry = by_domain.setdefault(domain, {
            "domain": domain, "counts": empty_counts(), "rows": 0, "assessed": 0,
            "first_published": None, "last_published": None,
            "values": [],
        })
        # ⚠️ `rows` AND `assessed` ARE DIFFERENT DENOMINATORS. A row whose
        # tone the evidence gate withheld is coverage that exists and was not
        # assessed; counting only the second makes an outlet that published
        # five pieces look like one that published two.
        entry["rows"] += 1
        tone = row.get("tone")
        if tone in entry["counts"]:
            entry["counts"][tone] += 1
            entry["assessed"] += 1
        published = row.get("published")
        if published:
            for field, better in (("first_published", lambda a, b: a < b),
                                  ("last_published", lambda a, b: a > b)):
                current = entry[field]
                if not current or better(published_key({"published": published}),
                                         published_key({"published": current})):
                    entry[field] = published
        value = scalar_of(row)
        if value is not None:
            entry["values"].append(value)
    out = []
    for entry in by_domain.values():
        values = entry.pop("values")
        out.append({**entry, **summarize_values(values)})
    # "Most coverage first" means the ROWS, which is what the caption says —
    # ordering by `assessed` sorts by how much of the coverage we could score.
    out.sort(key=lambda e: (-e["rows"], -e["assessed"], e["domain"]))
    return out


def scalar_of(row: dict):
    """The continuous value on a row, or None. Never a substitute for a label."""
    block = row.get("sentiment")
    if not isinstance(block, dict):
        return None
    value = block.get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def summarize_values(values: list) -> dict:
    """`mean`, `n` and the standard error — or all None.

    ⚠️ `scored` IS ITS OWN DENOMINATOR and is never the row count. A mean over
    the three scored rows of forty is not this page's mean, and publishing it
    beside `assessed` without saying so is how it would be read as one.

    ⚠️ AND THE STANDARD ERROR IS None AT n = 1. A single article has no spread
    to report, and a band of zero width around one point reads as certainty.
    """
    # ⚠️ GUARDED HERE TOO, not only in `scalar_of`. This is a public helper —
    # `bool` is an `int` in Python, so `True` would average as 1.0, and a NaN
    # poisons every statistic it touches into NaN silently.
    clean = [float(v) for v in values
             if not isinstance(v, bool) and isinstance(v, (int, float))
             and math.isfinite(v)]
    if not clean:
        return {"value_mean": None, "value_scored": 0, "value_se": None}
    mean = sum(clean) / len(clean)
    if len(clean) < 2:
        return {"value_mean": mean, "value_scored": 1, "value_se": None}
    variance = sum((v - mean) ** 2 for v in clean) / (len(clean) - 1)
    return {"value_mean": mean, "value_scored": len(clean),
            "value_se": math.sqrt(variance / len(clean))}


def pick_granularity(rows: list) -> str:
    """`day` · `week` · `month`, from the span the rows actually cover."""
    # ⚠️ THE VALIDITY FLAG, NOT MERELY THE PRESENCE OF A STRING.
    # `published_key` returns `(0, datetime.min)` for anything it cannot
    # parse, so one garbage date contributes the year 1 and drags the span to
    # two millennia: measured, a clean four-day corpus plus one „не се знае"
    # row went from `day` to `month`. `period_of` already respects the flag,
    # so that same row is counted as `undated` — the two must agree.
    dated = [moment for flag, moment in
             (published_key(row) for row in rows) if flag]
    if len(dated) < 2:
        return "day"
    span = max(dated) - min(dated)
    for threshold, name in GRANULARITY_THRESHOLDS:
        if span <= threshold:
            return name
    return DEFAULT_GRANULARITY


def period_of(published, granularity: str):
    """The bucket label for one date, or None when it has no date."""
    if not published:
        return None
    flag, moment = published_key({"published": published})
    if not flag:
        return None
    moment = moment.astimezone(CORPUS_TZ)
    if granularity == "day":
        return moment.date().isoformat()
    if granularity == "week":
        # ⚠️ ISO week, anchored to its MONDAY rather than printed as
        # `2026-W38`: a date sorts and plots, a week label does neither
        # without a second rule on the client.
        monday = moment.date() - timedelta(days=moment.weekday())
        return monday.isoformat()
    return moment.date().replace(day=1).isoformat()


def series(rows: list, granularity=None) -> dict:
    """The subject's coverage over time: counts per period, and the scalar.

    ⚠️ EVERY POINT CARRIES ITS `n`. A weekly mean over two articles is not a
    trend, and §6.3 requires the count to be annotated on the chart rather
    than inferred from the line's steadiness.

    ⚠️ AN EMPTY PERIOD IS ABSENT, NOT ZERO. A zero would plot as "the press
    said nothing favourable that week" where the truth is "nothing was
    published"; the client draws a gap, which is what a gap means.
    """
    granularity = granularity or pick_granularity(rows)
    buckets: dict = {}
    undated = 0
    for row in rows:
        period = period_of(row.get("published"), granularity)
        if period is None:
            undated += 1
            continue
        entry = buckets.setdefault(period, {
            "period": period, "counts": empty_counts(), "rows": 0, "assessed": 0,
            "values": [],
        })
        entry["rows"] += 1
        tone = row.get("tone")
        if tone in entry["counts"]:
            entry["counts"][tone] += 1
            entry["assessed"] += 1
        value = scalar_of(row)
        if value is not None:
            entry["values"].append(value)
    points = []
    for period in sorted(buckets):
        entry = buckets[period]
        values = entry.pop("values")
        points.append({**entry, **summarize_values(values)})
    return {"granularity": granularity, "points": points, "undated": undated}


def attach_sentiment(rows: list, records: dict, *, kind: str) -> int:
    """Join the stored Jev record onto each row, by (url, kind, surface).

    ⚠️⚠️ THE SUBJECT COMES FROM THE ROW'S OWN `subject_name`, WHICH THE
    COLLECTOR WRITES — it is never guessed from a chain of maybe-keys. An
    earlier cut read `subject_name or party or name`, and production rows carry
    NONE of the three: `name` resolved to `None`, and `s.get("name") == None`
    then matched the first sidecar subject that happened to lack a `name` key,
    so a party row picked up an unrelated subject's value. The test passed only
    because its fixture injected a key the collector never writes — which is
    the whole failure, twice.

    ⚠️ `kind` IS PART OF THE IDENTITY, because `jev_sentiment` dedupes subjects
    on `(kind, casefold(name))`: a party and a person can share a surface, and
    matching on the name alone cross-joins them. The comparison is casefolded
    for the same reason the dedupe is.
    """
    attached = 0
    for row in rows:
        record = records.get(row.get("url"))
        surface = row.get("subject_name")
        if not isinstance(record, dict) or not isinstance(surface, str):
            continue
        wanted = surface.casefold()
        match = next((s for s in record.get("subjects") or []
                      if isinstance(s, dict)
                      and isinstance(s.get("name"), str)
                      and s["name"].casefold() == wanted
                      and s.get("kind") == kind
                      and isinstance(s.get("tone"), dict)), None)
        if not match:
            continue
        row["sentiment"] = {
            "value": match["tone"].get("value"),
            "normalized": match["tone"].get("normalized"),
            "spread": match["tone"].get("spread"),
            "confidence": match["tone"].get("confidence_derived"),
            "levels": match["tone"].get("levels"),
            "both_directions": match["tone"].get("both_directions"),
            "subject_role": match.get("subject_role"),
        }
        attached += 1
    return attached
