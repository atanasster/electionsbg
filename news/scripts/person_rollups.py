#!/usr/bin/env python3
"""The per-person archive: how the published corpus frames one identity.

Plan: `docs/plans/news-person-sentiment-v1.md` §4. The unit is the (article,
identity) pair Jev scored and the identity join (`person_identity_join.py`)
stamped; this folds those pairs into one shard per person, an index and the
small baseline file the article page's person rail reads.

⚠️ THE DENOMINATOR RULES ARE THE FEATURE. For one person:

    M = eligible pairs — publishable articles where Jev read the person as the
        PRIMARY or SECONDARY subject
    N = the subset of M with a placeable score on the full text

and, enforced in code and asserted before anything is written:

    sum(raw bucket counts) == N
    N + insufficient_text + pending + unplaceable + conflict == M

Reported BESIDE M and never inside it: `incidental` (named in passing — no
score is asked for), `unreadable_role`, and `unscored_mentions` (the gazetteer
linked the person in an article Jev has not scored yet — the role is unknown,
so it cannot be counted as eligible).

⚠️ THREE BASES, ALL PUBLISHED; THE STORY BASIS IS THE DEFAULT (§4.2):
- `raw` — every assessed pair;
- `same_headline` — one unit per folded headline, so a wire copy published by
  five outlets counts once;
- `story` — one unit per (outlet, story): the mean of that outlet's articles on
  the story. Fifteen follow-ups from one outlet on one scandal are one outlet's
  position repeated, not fifteen observations. An article with no story is its
  own story.

The SE is BETWEEN units at the chosen basis — never Jev's `spread`, which is the
model's uncertainty about one article. There is no shrinkage: pulling a small
outlet toward the person's mean manufactures agreement; a wide CI and a
withheld mean (below `MEAN_MIN_N`) are the honest shapes.

⚠️ NO FAVOURABILITY RANKING. The index carries counts and n and no mean, so no
surface can sort people by how favourably they are covered. The one scalar a
page may show is in the person's own shard.
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rollup_common import (  # noqa: E402
    ARCHIVE_PAGE_SIZE, extend_window, page_of, published_key,
)
import sentiment_rollups as sr  # noqa: E402

ELIGIBLE_ROLES = frozenset({"primary", "secondary"})
PERSON_PAGE_SIZE = ARCHIVE_PAGE_SIZE
UNASSESSED_KINDS = ("insufficient_text", "pending", "unplaceable", "conflict")
BASES = ("story", "same_headline", "raw")
DEFAULT_BASIS = "story"
# Below this many units an outlet's MEAN is withheld; its counts still ship.
MEAN_MIN_N = 5
# A gazetteer person gets a page from this many story-basis units (§4.3).
PAGE_MIN_N = 5
# A series point is drawn only when at least this share of the corpus's
# articles in that point's period carry an analysis (§4.2).
COVERAGE_FLOOR = 0.8
# Links a page may rest on without a human identity check (§4.3).
STRONG_FORM_KINDS = frozenset({"full_name", "curated_entity"})
STRONG_BASES = frozenset({"context", "surname_alias"})
Z95 = 1.96


def _labels() -> tuple:
    import jev_axes as ax  # noqa: PLC0415
    return ax.SUBJECT_TONE.labels


def _bucket_of_value(value):
    """The display bucket of a MEAN — the same edges a row uses."""
    import jev_axes as ax  # noqa: PLC0415
    import jev_scales as js  # noqa: PLC0415
    if value is None:
        return None
    scale = ax.ANCHOR_VARIANTS.get(len(_labels()))
    index = js.bucket_index(value, scale) if scale is not None else None
    return _labels()[index] if isinstance(index, int) else None


def fold_title(title) -> str:
    return re.sub(r"\s+", " ", str(title or "").strip().lower())


def _empty(identity: dict) -> dict:
    return {
        "id": identity["id"], "kind": identity["kind"],
        "canonical": identity.get("canonical"),
        "identity_version": identity.get("identity_version"),
        "scope": identity.get("scope"),
        "public_figure": identity.get("public_figure"),
        "eligible": 0, "assessed": 0,
        **{k: 0 for k in UNASSESSED_KINDS},
        "incidental": 0, "unreadable_role": 0, "unscored_mentions": 0,
        "undated": 0, "first_published": None, "last_published": None,
        "outlets": set(), "stories": set(),
        "rows": [], "incidental_rows": [],
        "strong_link": False, "co_subjects": {},
    }


def _row(row: dict, subject: dict, status: str) -> dict:
    ident = subject.get("identity") or {}
    tone = subject.get("tone") if isinstance(subject.get("tone"), dict) else {}
    placed = status == "assessed"
    labels = _labels()
    index = tone.get("bucket_index")
    return {
        "url": row.get("url"), "domain": row.get("domain") or "",
        "article_id": row.get("article_id"), "title": row.get("title"),
        "published": row.get("published"), "story_id": row.get("story_id"),
        "surface": subject.get("name"),
        "merged_surfaces": subject.get("merged_surfaces") or [],
        "subject_role": subject.get("subject_role"),
        "status": status,
        # ⚠️ A value and a bucket ONLY on an assessed row: a conflicted or
        # truncated reading is shown as what it is, never as a score.
        "value": tone.get("value") if placed else None,
        "levels": tone.get("levels") if placed else None,
        "bucket": labels[index] if placed and isinstance(index, int) else None,
        "basis": ident.get("basis"), "form_kind": ident.get("form_kind"),
        "identity_version": ident.get("identity_version"),
    }


def _status(subject: dict, full_text: bool) -> str:
    tone = subject.get("tone")
    if subject.get("conflict"):
        return "conflict"
    if not isinstance(tone, dict):
        return "pending"
    if not full_text:
        return "insufficient_text"
    value, index = tone.get("value"), tone.get("bucket_index")
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not isinstance(index, int)):
        return "unplaceable"
    return "assessed"


def _co_label(subject: dict) -> tuple | None:
    ident = subject.get("identity")
    if subject.get("kind") == "party" and subject.get("name"):
        return ("party", subject["name"])
    if ident:
        return (ident["kind"], ident["id"])
    return None


def collect(rows: list) -> dict:
    """Fold published rows into one accounting per identity.

    `rows` is one dict per PUBLISHABLE article:
        {url, domain, article_id, title, published, story_id, analysis}
    whose `analysis.jev_sentiment.subjects` the build has already stamped.
    """
    people: dict = {}
    unscored: dict = {}
    labels = _labels()
    for row in rows:
        analysis = row.get("analysis") or {}
        jev = analysis.get("jev_sentiment")
        subjects = (jev or {}).get("subjects") or []
        full_text = ((jev or {}).get("text_scope") or {}).get("kind", "full") == "full"
        seen_here: set = set()
        eligible_here = []
        for s in subjects:
            ident = s.get("identity") if isinstance(s, dict) else None
            if s.get("kind") != "person" or not ident:
                continue
            key = ident["id"]
            if key in seen_here:
                continue
            seen_here.add(key)
            entry = people.setdefault(key, _empty(ident))
            if (ident.get("basis") in STRONG_BASES
                    or ident.get("form_kind") in STRONG_FORM_KINDS):
                entry["strong_link"] = True
            role = s.get("subject_role")
            if role == "incidental":
                entry["incidental"] += 1
                entry["incidental_rows"].append(_row(row, s, "incidental"))
                continue
            if role not in ELIGIBLE_ROLES:
                entry["unreadable_role"] += 1
                continue
            entry["eligible"] += 1
            entry["outlets"].add(row.get("domain"))
            if row.get("story_id"):
                entry["stories"].add(row["story_id"])
            extend_window(entry, row.get("published"))
            status = _status(s, full_text)
            if status == "assessed":
                entry["assessed"] += 1
            else:
                entry[status] += 1
            entry["rows"].append(_row(row, s, status))
            eligible_here.append(key)
        for key in eligible_here:
            co = people[key]["co_subjects"]
            for other in subjects:
                label = _co_label(other)
                if (label and label != ("person", key)
                        and label != ("news_person", key)
                        and other.get("subject_role") in ELIGIBLE_ROLES):
                    co[label] = co.get(label, 0) + 1
        # ⚠️ A PERSON THE GAZETTEER LINKED IN AN ARTICLE JEV HAS NOT SCORED.
        # Not eligible — the role is unknown — but not nothing either.
        # Collected apart and folded in after the loop, so the count does not
        # depend on whether an unscored article is read before a scored one.
        if jev is None:
            for link in (analysis.get("entity_links") or {}).values():
                if isinstance(link, dict) and link.get("kind") == "person":
                    unscored[link.get("id")] = unscored.get(link.get("id"), 0) + 1
    for pid, n in unscored.items():
        if pid in people:
            people[pid]["unscored_mentions"] += n
    for entry in people.values():
        _finish(entry, labels)
    return people


def _unit(rows: list) -> dict:
    values = [r["value"] for r in rows]
    mean = sum(values) / len(values)
    dated = sorted((r for r in rows if published_key(r)[0]), key=published_key)
    return {"value": mean, "bucket": _bucket_of_value(mean),
            "published": dated[0]["published"] if dated else None,
            "domain": rows[0]["domain"],
            "role": "primary" if any(r["subject_role"] == "primary" for r in rows)
            else "secondary"}


def units(rows: list, basis: str) -> list:
    """The assessed rows grouped into the units of one basis."""
    assessed = [r for r in rows if r["status"] == "assessed"]
    if basis == "raw":
        return [_unit([r]) for r in assessed]
    groups: dict = {}
    for r in assessed:
        if basis == "same_headline":
            key = fold_title(r["title"]) or r["url"]
        else:
            key = (r["domain"], r["story_id"] or f"url:{r['url']}")
        groups.setdefault(key, []).append(r)
    return [_unit(g) for _k, g in sorted(groups.items(), key=lambda kv: str(kv[0]))]


def summarize(unit_list: list) -> dict:
    labels = _labels()
    counts = {label: 0 for label in labels}
    for u in unit_list:
        if u["bucket"] in counts:
            counts[u["bucket"]] += 1
    stats = sr.summarize_values([u["value"] for u in unit_list])
    mean, se = stats["value_mean"], stats["value_se"]
    return {"n": len(unit_list), "counts": counts,
            "mean": _round(mean), "se": _round(se),
            "ci_low": _round(mean - Z95 * se) if se is not None else None,
            "ci_high": _round(mean + Z95 * se) if se is not None else None,
            "mean_bucket": _bucket_of_value(mean)}


def _round(value, places=4):
    return round(value, places) if isinstance(value, (int, float)) else None


def _finish(entry: dict, labels: tuple) -> None:
    raw_counts = {label: 0 for label in labels}
    for r in entry["rows"]:
        if r["status"] == "assessed" and r["bucket"] in raw_counts:
            raw_counts[r["bucket"]] += 1
    entry["raw_counts"] = raw_counts
    entry["units"] = {basis: units(entry["rows"], basis) for basis in BASES}
    entry["outlet_count"] = len(entry["outlets"])
    entry["story_count"] = len(entry["stories"])


def check_accounting(entry: dict) -> list:
    """The two identities, as a returnable list of failures."""
    problems = []
    total = sum(entry["raw_counts"].values())
    if total != entry["assessed"]:
        problems.append(f"bucket counts sum to {total}, N is {entry['assessed']}")
    parts = entry["assessed"] + sum(entry[k] for k in UNASSESSED_KINDS)
    if parts != entry["eligible"]:
        problems.append(f"N plus unassessed is {parts}, M is {entry['eligible']}")
    return problems


def n_story(entry: dict) -> int:
    return len(entry["units"][DEFAULT_BASIS])


def page_decision(entry: dict, *, confirmed: set, refused: set) -> str:
    """`publish`, or why not. ⚠️ A PAGE ABOUT A NAMED PERSON RESTS ON AN
    IDENTITY SOMEONE CAN DEFEND (§4.3)."""
    if entry["id"] in refused:
        return "identity_refused"
    if entry["kind"] == "news_person":
        # A news-only identity was chosen by a human; it may carry a page only
        # as a Bulgarian PUBLIC figure — a private individual named in the
        # news gets article-level display and nothing aggregated.
        if entry.get("scope") != "bg" or entry.get("public_figure") is not True:
            return "not_public_bg"
        return "publish" if entry["assessed"] else "no_assessed_pairs"
    if n_story(entry) < PAGE_MIN_N:
        return "below_threshold"
    if not (entry["strong_link"] or entry["id"] in confirmed):
        return "identity_unconfirmed"
    return "publish"


def by_outlet(entry: dict) -> list:
    groups: dict = {}
    for u in entry["units"][DEFAULT_BASIS]:
        groups.setdefault(u["domain"], []).append(u)
    rows_by_domain: dict = {}
    for r in entry["rows"]:
        rows_by_domain[r["domain"]] = rows_by_domain.get(r["domain"], 0) + 1
    out = []
    for domain, group in groups.items():
        s = summarize(group)
        if s["n"] < MEAN_MIN_N:
            s.update(mean=None, se=None, ci_low=None, ci_high=None,
                     mean_bucket=None, mean_withheld=True)
        out.append({"domain": domain, "rows": rows_by_domain.get(domain, 0), **s})
    # ⚠️ ORDERED BY COVERAGE, never by tone.
    out.sort(key=lambda o: (-o["n"], -o["rows"], o["domain"]))
    return out


def coverage_by_period(coverage_days: dict, granularity: str) -> dict:
    """period → share of the corpus's articles scored, aggregated once."""
    sums: dict = {}
    for day, (scored, total) in coverage_days.items():
        period = sr.period_of(day, granularity)
        if period is None:
            continue
        slot = sums.setdefault(period, [0, 0])
        slot[0] += scored
        slot[1] += total
    return {p: (s / t if t else None) for p, (s, t) in sums.items()}


def series(entry: dict, coverage_days: dict) -> dict:
    unit_list = entry["units"][DEFAULT_BASIS]
    granularity = sr.pick_granularity(unit_list)
    buckets: dict = {}
    undated = 0
    for u in unit_list:
        period = sr.period_of(u["published"], granularity)
        if period is None:
            undated += 1
            continue
        buckets.setdefault(period, []).append(u)
    shares = coverage_by_period(coverage_days, granularity)
    points = []
    for period in sorted(buckets):
        share = shares.get(period)
        points.append({
            "period": period, **summarize(buckets[period]),
            "coverage": _round(share, 3),
            # ⚠️ PER POINT, not per month: a week at 62% hides inside a month
            # that passes. The client hatches these instead of drawing a line.
            "below_floor": share is None or share < COVERAGE_FLOOR,
        })
    return {"granularity": granularity, "points": points, "undated": undated,
            "coverage_floor": COVERAGE_FLOOR}


def co_subjects(entry: dict, limit: int = 10) -> list:
    ranked = sorted(entry["co_subjects"].items(),
                    key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [{"kind": k[0], "id": k[1], "count": n} for k, n in ranked]


def accounting(entry: dict) -> dict:
    return {k: entry[k] for k in (
        "eligible", "assessed", *UNASSESSED_KINDS, "incidental",
        "unreadable_role", "unscored_mentions", "undated")}


def payload(entry: dict, meta: dict, generated_at: str, rubric_version: str,
            coverage_days: dict, *, page: int = 1,
            page_size: int = PERSON_PAGE_SIZE) -> dict:
    rows = sorted(entry["rows"] + entry["incidental_rows"],
                  key=published_key, reverse=True)
    page, total_pages, window = page_of(rows, page, page_size)
    return {
        "version": 2, "generated_at": generated_at,
        "rubric_version": rubric_version,
        "id": entry["id"], "kind": entry["kind"],
        **meta,
        "identity_version": entry["identity_version"],
        "accounting": accounting(entry),
        "default_basis": DEFAULT_BASIS,
        "bases": {basis: summarize(entry["units"][basis]) for basis in BASES},
        "raw_counts": dict(entry["raw_counts"]),
        "by_outlet": by_outlet(entry),
        "by_role": {role: summarize([u for u in entry["units"][DEFAULT_BASIS]
                                     if u["role"] == role])
                    for role in ("primary", "secondary")},
        "series": series(entry, coverage_days),
        "co_subjects": co_subjects(entry),
        "outlet_count": entry["outlet_count"],
        "story_count": entry["story_count"],
        "first_published": entry["first_published"],
        "last_published": entry["last_published"],
        "page": page, "page_size": page_size, "total_pages": total_pages,
        "articles": window,
    }


def index_row(entry: dict, meta: dict) -> dict:
    """⚠️ NO MEAN. Counts and n only — the index must not be sortable by tone."""
    story = summarize(entry["units"][DEFAULT_BASIS])
    return {"id": entry["id"], "kind": entry["kind"],
            "name_bg": meta.get("name_bg"), "name_en": meta.get("name_en"),
            "role": meta.get("current_role"), "party": meta.get("party"),
            "photo": meta.get("photo"),
            "n": story["n"], "counts": story["counts"],
            "eligible": entry["eligible"], "outlet_count": entry["outlet_count"],
            "last_published": entry["last_published"],
            "outlets": sorted(o["domain"] for o in by_outlet(entry))}


def baseline(entry: dict) -> dict:
    """What the article rail's „в други материали" line needs: the raw sum and
    count of assessed values. The rail subtracts the article it sits on (it
    holds that article's own score) before bucketing, so its baseline never
    includes itself."""
    assessed = [r for r in entry["rows"] if r["status"] == "assessed"]
    levels = {r.get("levels") for r in assessed}
    # ⚠️ ONE SCALE OR NONE. A sum over values from scales with different anchor
    # counts has no bucket; the rail then shows no baseline rather than a
    # wrong one.
    if len(levels) != 1 or None in levels:
        return {"n": 0, "sum": None, "levels": None}
    return {"n": len(assessed), "sum": _round(sum(r["value"] for r in assessed)),
            "levels": levels.pop()}


def page_name(person_id: str, page: int) -> str:
    """⚠️ `.p<n>`, NOT `-<n>`. Main-site slugs contain hyphens, so
    `ivan-ivanov-2.json` could be page 2 of one person or page 1 of another."""
    return f"{person_id}.json" if page == 1 else f"{person_id}.p{page}.json"
