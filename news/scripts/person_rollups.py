#!/usr/bin/env python3
"""T4.4 — the news-person publishing path: one shard per identity, with an
accounting a reader can check rather than a percentage they must trust.

⚠️ THE DENOMINATOR RULES ARE THE FEATURE. For one person:

    M = eligible target/article pairs — PUBLISHABLE articles carrying a
        resolved PRIMARY or SECONDARY mention of that identity.
    N = the subset of M with a valid, FULL-TEXT assessment under the
        displayed rubric.

and two identities must hold, enforced in code and asserted by the tests:

    sum(tone counts) == N
    N + insufficient_text + pending + refused == M     (mutually exclusive)

`partial_scope` is a SPLIT of `insufficient_text`, not a fifth part: the plan
asks for pending, insufficient-text and partial-scope counts separately, and
the two are different sentences — „the article was not read in full" describes
a scope, „there was not enough in the text" describes a reading. Both stay
inside M, so the identity above is untouched.

Everything that is NOT in M is reported beside it and never inside it:

- **incidental** mentions — named in passing; they create no eligibility and
  no page (plan: „incidental mentions alone do not create pages");
- **unresolved** mentions — unknown IDENTITY coverage, never assigned to
  this person's M, because the registry declined to say it was them;
- **unreadable_role** rows — a stored treatment whose `subject_role` we cannot
  read. That is not eligibility, so it is reported BESIDE M like an incidental
  mention. ⚠️ Counting it inside M without the matching `eligible` would break
  the second identity by construction, costing that person their whole page
  over one malformed row, and reporting it as an accounting failure would send
  the operator looking in the wrong place;
- `analyzed_count` is NOT N, and nothing here derives one from the other.

⚠️ SYNDICATION IS NAMED FOR WHAT IT MEASURES. A „copy" here is another
outlet publishing the SAME HEADLINE (folded); that is what the corpus can
show. The raw and deduplicated denominators are both published, neither
replaces the other, and the field is `same_headline_*` rather than
`syndicated_*` so nobody reads a stronger claim than the evidence carries.
Measured 2026-09-22: 1 headline shared across 2 outlets among the 53
articles with a resolved identity.

⚠️ A PAGE IS A HUMAN DECISION. A shard is written only for an identity the
registry marks `active` — T4.0's review state — so a generic person cannot
acquire a page by being mentioned. A main-site bridge is rendered only from
`verified_main_site_slug`; a null one is no link at all, never a guessed one.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from rollup_common import (  # noqa: E402
    ARCHIVE_PAGE_SIZE, extend_window, page_of, published_key,
)

ELIGIBLE_ROLES = frozenset({"primary", "secondary"})
PERSON_PAGE_SIZE = ARCHIVE_PAGE_SIZE
UNASSESSED_KINDS = ("insufficient_text", "pending", "refused")


def fold_title(title) -> str:
    return re.sub(r"\s+", " ", str(title or "").strip().lower())


def collect(rows: list, active_ids) -> dict:
    """Fold published articles into one accounting per ACTIVE identity.

    `rows` is one dict per publishable article:
        {url, domain, article_id, title, published, story_id, analysis}
    """
    people: dict = {}
    active = set(active_ids or ())
    for row in rows:
        analysis = row.get("analysis") or {}
        identities = analysis.get("news_persons") or []
        tones = {t.get("news_person_id"): t
                 for t in (analysis.get("person_tones") or [])
                 if isinstance(t, dict)}
        seen_here: set = set()
        for mention in identities:
            if not isinstance(mention, dict):
                continue
            person_id = mention.get("news_person_id")
            if not person_id or person_id not in active or person_id in seen_here:
                continue
            seen_here.add(person_id)
            entry = people.setdefault(person_id, _empty(person_id))
            tone = tones.get(person_id)
            role = (tone or {}).get("subject_role")
            if role == "incidental":
                # Named in passing: counted, never eligible.
                entry["incidental"] += 1
                entry["incidental_rows"].append(_row(row, tone, eligible=False))
                continue
            if tone is not None and role not in ELIGIBLE_ROLES:
                # Outside M, like an incidental mention: a role we cannot read
                # is not eligibility, and it is none of M's three unassessed
                # kinds either. Counted and reported BESIDE M.
                entry["unreadable_role"] += 1
                entry["incidental_rows"].append(_row(row, tone, eligible=False))
                continue
            # Eligible: a resolved primary/secondary mention on a publishable
            # article. A mention with NO stored tone yet is `pending` — the
            # assessment has not run, which is not the same as „no framing".
            entry["eligible"] += 1
            _observe(entry, row)
            if tone is None:
                entry["pending"] += 1
                entry["rows"].append(_row(row, None, eligible=True))
                continue
            status = tone.get("assessment_status")
            if status == "assessed" and tone.get("tone"):
                entry["counts"][tone["tone"]] = entry["counts"].get(tone["tone"], 0) + 1
                entry["assessed"] += 1
            elif status == "insufficient_text":
                entry["insufficient_text"] += 1
                if ((tone.get("text_scope") or {}).get("kind") or "full") != "full":
                    entry["partial_scope"] += 1
            else:
                entry["refused"] += 1
            entry["rows"].append(_row(row, tone, eligible=True))
    for entry in people.values():
        _finish(entry)
    return people


def _empty(person_id: str) -> dict:
    return {
        "news_person_id": person_id,
        "counts": {},
        "assessed": 0,
        "insufficient_text": 0,
        "pending": 0,
        "refused": 0,
        "eligible": 0,
        "partial_scope": 0,
        "incidental": 0,
        "unreadable_role": 0,
        "undated": 0,
        "outlets": set(),
        "stories": set(),
        "titles": {},
        "first_published": None,
        "last_published": None,
        "rows": [],
        "incidental_rows": [],
    }


def _observe(entry: dict, row: dict) -> None:
    entry["outlets"].add(row.get("domain"))
    if row.get("story_id"):
        entry["stories"].add(row["story_id"])
    key = fold_title(row.get("title"))
    if key:
        entry["titles"].setdefault(key, set()).add(row.get("domain"))
    extend_window(entry, row.get("published"))


def _row(row: dict, tone: dict | None, *, eligible: bool) -> dict:
    """One article row: enough to open the SHORT quoted evidence and the
    original source, never a body."""
    status = (tone or {}).get("assessment_status") or "pending"
    # ⚠️ STATUS AND TONE ARE ONE DECISION (`person_tones.validate`). A tone
    # arriving beside any other status — or on a row outside M — is a claim
    # the accounting never counted and no evidence span supports, so it is
    # dropped HERE rather than rendered as a framing label about a named
    # person. The server rejects that shape upstream, which is exactly why
    # this side must not depend on it having done so.
    published_tone = (tone or {}).get("tone") if (eligible and status == "assessed") else None
    return {
        "url": row.get("url"),
        "domain": row.get("domain") or "",
        "article_id": row.get("article_id"),
        "title": row.get("title"),
        "published": row.get("published"),
        "story_id": row.get("story_id"),
        "eligible": eligible,
        "subject_role": (tone or {}).get("subject_role"),
        "assessment_status": status,
        "tone": published_tone,
        "rationale": (tone or {}).get("rationale"),
        "evidence_spans": [
            {k: v for k, v in span.items()
             if k in ("quote", "field", "direction", "voice", "speaker", "located")}
            for span in ((tone or {}).get("evidence_spans") or [])
            if isinstance(span, dict)
        ],
        "text_scope": ((tone or {}).get("text_scope") or {}).get("kind"),
        "rubric_version": (tone or {}).get("rubric_version"),
        "identity_version": (tone or {}).get("identity_version"),
    }


def _finish(entry: dict) -> None:
    # Same headline elsewhere: the deduplicated denominator, published BESIDE
    # the raw one rather than instead of it.
    duplicates = sum(len(outlets) - 1 for outlets in entry["titles"].values()
                     if len(outlets) > 1)
    entry["same_headline_copies"] = duplicates
    entry["eligible_deduplicated"] = entry["eligible"] - duplicates
    entry["outlet_count"] = len(entry["outlets"])
    entry["story_count"] = len(entry["stories"])


def per_outlet(entry: dict) -> list:
    """Each outlet's OWN distribution — never one inferred tone per outlet."""
    by_domain: dict = {}
    for row in entry["rows"]:
        bucket = by_domain.setdefault(row["domain"], {
            "domain": row["domain"], "counts": {}, "assessed": 0, "eligible": 0})
        bucket["eligible"] += 1
        if row["assessment_status"] == "assessed" and row["tone"]:
            bucket["counts"][row["tone"]] = bucket["counts"].get(row["tone"], 0) + 1
            bucket["assessed"] += 1
    return sorted(by_domain.values(), key=lambda b: (-b["eligible"], b["domain"] or ""))


def check_accounting(entry: dict) -> list:
    """The two identities the plan states, as a returnable list of failures
    rather than a comment nobody runs."""
    problems = []
    tone_total = sum(entry["counts"].values())
    if tone_total != entry["assessed"]:
        problems.append(f"tone counts sum to {tone_total}, N is {entry['assessed']}")
    parts = entry["assessed"] + sum(entry[k] for k in UNASSESSED_KINDS)
    if parts != entry["eligible"]:
        problems.append(f"N plus unassessed is {parts}, M is {entry['eligible']}")
    return problems


def payload(entry: dict, person: dict, generated_at: str, rubric_version: str,
            *, page: int = 1, page_size: int = PERSON_PAGE_SIZE) -> dict:
    """One identity's archive page. ⚠️ PAGINATED for the reason the party
    archive is: the first shard was 99,194 bytes for 53 rows, fetched whole on
    every view, and rows grow with the corpus rather than with the number of
    identities. The accounting above the fold is computed over ALL rows, so a
    page never shows a denominator it is not the whole of."""
    rows = sorted(entry["rows"] + entry["incidental_rows"],
                  key=published_key, reverse=True)
    page, total_pages, window = page_of(rows, page, page_size)
    return {
        "version": 1,
        "generated_at": generated_at,
        "rubric_version": rubric_version,
        "news_person_id": entry["news_person_id"],
        "name_bg": person.get("name_bg"),
        "name_en": person.get("name_en"),
        "disambiguation_bg": person.get("disambiguation_bg"),
        "disambiguation_en": person.get("disambiguation_en"),
        "identity_version": person.get("identity_version"),
        "reviewed_by": person.get("reviewed_by"),
        "reviewed_at": person.get("reviewed_at"),
        # ⚠️ A bridge is rendered only from a VERIFIED slug; null is no link.
        "verified_main_site_slug": person.get("verified_main_site_slug"),
        "counts": dict(entry["counts"]),
        "assessed": entry["assessed"],
        "insufficient_text": entry["insufficient_text"],
        "pending": entry["pending"],
        "refused": entry["refused"],
        "eligible": entry["eligible"],
        # A SPLIT of insufficient_text, not a fifth part of M.
        "partial_scope": entry["partial_scope"],
        "eligible_deduplicated": entry["eligible_deduplicated"],
        "same_headline_copies": entry["same_headline_copies"],
        "incidental": entry["incidental"],
        "unreadable_role": entry["unreadable_role"],
        "outlet_count": entry["outlet_count"],
        "story_count": entry["story_count"],
        "first_published": entry["first_published"],
        "last_published": entry["last_published"],
        # Rows inside M that carry no date: counted, so the window above
        # cannot read as covering every row it is printed beside.
        "undated": entry["undated"],
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "per_outlet": per_outlet(entry),
        "articles": window,
    }


def index_row(entry: dict, person: dict) -> dict:
    return {
        "news_person_id": entry["news_person_id"],
        "name_bg": person.get("name_bg"),
        "name_en": person.get("name_en"),
        "counts": dict(entry["counts"]),
        "assessed": entry["assessed"],
        "eligible": entry["eligible"],
        "incidental": entry["incidental"],
        "unreadable_role": entry["unreadable_role"],
        "outlet_count": entry["outlet_count"],
        "story_count": entry["story_count"],
        "first_published": entry["first_published"],
        "last_published": entry["last_published"],
        "undated": entry["undated"],
    }
