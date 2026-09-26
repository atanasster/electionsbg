#!/usr/bin/env python3
"""The review workspace's queues — pure, so the server stays thin and testable.

Plan: `docs/plans/news-person-sentiment-v1.md` §8.1. Every human step of the
person-sentiment feature runs in one local tool; this module builds each
queue's items from the corpus and turns a keypress into the entry the queue's
decision file stores. `review_persons.py` serves them.

⚠️ NOTHING HERE DECIDES. A queue proposes; only a recorded human decision
reaches `person_identity_audit.json` or `person_surname_aliases.json`, and the
identity join (`person_identity_join.py`) reads only those files.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

try:
    from .resolve_mentions import fold
except ImportError:  # direct script execution
    from resolve_mentions import fold

# A page is automatic from this many eligible pairs (plan §4.3).
MIN_PAIRS = 5
EXCERPTS = 5
EXCERPT_CHARS = 160
MAX_CANDIDATES = 9
# How often a one-word surname must occur, unlinked, before it is worth a
# reviewer's minute.
MIN_SURNAME_PAIRS = 3
# A reviewed alias expires: the same surname may mean someone else later, so
# the default window ends this many days out and needs a second look then.
ALIAS_DAYS_AHEAD = 180
# The link kinds a page may rest on without a human check (plan §4.3).
STRONG_FORM_KINDS = frozenset({"full_name", "curated_entity"})
IDENTITY_DECISIONS = ("confirmed", "refused", "mixed")


def excerpt(text: str, surface: str) -> dict | None:
    """The text around the first occurrence of `surface`, split so the page
    can highlight the name without injecting markup."""
    if not text or not surface:
        return None
    m = re.search(re.escape(fold(surface)), fold(text))
    if not m:
        return None
    # `fold` keeps length for Cyrillic and Latin; a combining mark it strips
    # would shift offsets, so fall back to a plain search when it does.
    if len(fold(text)) != len(text):
        idx = text.find(surface)
        if idx < 0:
            return None
        start, end = idx, idx + len(surface)
    else:
        start, end = m.start(), m.end()
    lo = max(0, start - EXCERPT_CHARS)
    hi = min(len(text), end + EXCERPT_CHARS)
    return {"before": ("…" if lo else "") + text[lo:start].replace("\n", " "),
            "match": text[start:end],
            "after": text[end:hi].replace("\n", " ") + ("…" if hi < len(text) else "")}


def _pair(full: dict, subject: dict) -> dict:
    text = "\n".join(str(full.get(k) or "") for k in ("title", "content"))
    ident = subject.get("identity") or {}
    return {"url": full.get("url"), "domain": full.get("domain"),
            "title": full.get("title"), "published": str(full.get("published") or "")[:10],
            "surface": subject.get("name"), "basis": ident.get("basis"),
            "form_kind": ident.get("form_kind"),
            "excerpt": excerpt(text, subject.get("name") or "")}


def collect(pairs) -> dict:
    """Fold the joined corpus into what the queues need.

    `pairs` yields (app-data row, full article, stamped subjects, report) —
    `person_identity_join.corpus_pairs`.
    """
    by_person: dict = {}
    surnames: dict = {}
    for _art, full, subjects, _rep in pairs:
        for s in subjects:
            ident = s.get("identity")
            if ident and ident.get("kind") == "person":
                by_person.setdefault(ident["id"], []).append(_pair(full, s))
            elif (not ident and len(str(s.get("name") or "").split()) == 1
                  and s.get("refused_reason") in ("no_match", "ambiguous")):
                surnames.setdefault(fold(s["name"]), []).append(_pair(full, s))
    return {"by_person": by_person, "surnames": surnames}


def _spread(pairs: list, n: int, weakest_first: bool) -> list:
    """Up to `n` pairs with an excerpt, one per outlet first."""
    def weak(p):
        return 0 if (p.get("basis") == "context" or p.get("form_kind") not in
                     STRONG_FORM_KINDS) else 1
    ordered = sorted(pairs, key=lambda p: ((weak(p) if weakest_first else 0),
                                           p.get("published") or "",
                                           p.get("url") or ""))
    out, seen = [], set()
    for p in ordered:
        if p.get("excerpt") and p.get("domain") not in seen:
            out.append(p)
            seen.add(p.get("domain"))
        if len(out) == n:
            return out
    for p in ordered:
        if p.get("excerpt") and p not in out:
            out.append(p)
        if len(out) == n:
            break
    return out


def needs_audit(pairs: list) -> bool:
    """True when no pair rests on a full name, a curated entry or a cue."""
    return not any(p.get("basis") == "context"
                   or p.get("form_kind") in STRONG_FORM_KINDS for p in pairs)


def identity_items(collected: dict, people: dict, audit: dict) -> list:
    """People awaiting an identity decision: enough pairs for a page, or any
    link resting on a context cue or a surname alias."""
    decided = {d.get("id") for d in audit.get("decisions") or []}
    items = []
    for pid, pairs in collected["by_person"].items():
        # A page-eligible person, or anyone linked through a context cue or a
        # surname alias — §3.2's precision audit covers every such link.
        weak_basis = any(p.get("basis") in ("context", "surname_alias")
                         for p in pairs)
        if pid in decided or (len(pairs) < MIN_PAIRS and not weak_basis):
            continue
        entry = people.get(pid) or {}
        display = entry.get("display") or {}
        items.append({
            "key": pid, "id": pid, "canonical": entry.get("canonical"),
            "roles": display.get("roles") or [], "photo": display.get("photo"),
            "pairs": len(pairs), "needs_audit": needs_audit(pairs),
            "surfaces": sorted({p["surface"] for p in pairs if p.get("surface")}),
            "excerpts": _spread(pairs, EXCERPTS, weakest_first=True),
        })
    items.sort(key=lambda i: (not i["needs_audit"], -i["pairs"], i["id"]))
    return items


def surname_items(collected: dict, gazetteer_doc: dict, aliases: dict,
                  today: date | None = None) -> list:
    """One-word names worth an alias decision, with who could carry them."""
    today = today or date.today()
    # ⚠️ A decision covers its window only. An expired alias — or an expired
    # rejection — comes back for the second look `ALIAS_DAYS_AHEAD` forces.
    reviewed = {fold(a.get("surface") or "") for a in aliases.get("aliases") or []
                if (a.get("valid_to") or "9999") >= today.isoformat()}
    holders: dict = {}
    for e in gazetteer_doc.get("entries") or []:
        tokens = str(e.get("canonical") or "").split()
        if e.get("kind") == "person" and e.get("id") and tokens:
            holders.setdefault(fold(tokens[-1]), []).append(e)
    linked = {pid: len(p) for pid, p in collected["by_person"].items()}
    items = []
    for key, pairs in collected["surnames"].items():
        if len(pairs) < MIN_SURNAME_PAIRS or key in reviewed or key not in holders:
            continue
        cands = sorted(holders[key], key=lambda e: (
            -linked.get(e["id"], 0),
            not any(r.get("current") for r in (e.get("display") or {}).get("roles") or []),
            e["canonical"]))
        days = sorted(p["published"] for p in pairs if p.get("published"))
        items.append({
            "key": key, "surface": pairs[0]["surface"], "pairs": len(pairs),
            "holders_total": len(cands),
            "candidates": [{"id": e["id"], "canonical": e["canonical"],
                            "roles": (e.get("display") or {}).get("roles") or [],
                            "linked_pairs": linked.get(e["id"], 0)}
                           for e in cands[:MAX_CANDIDATES]],
            "window": {"from": days[0] if days else today.isoformat(),
                       "to": (today + timedelta(days=ALIAS_DAYS_AHEAD)).isoformat()},
            "excerpts": _spread(pairs, EXCERPTS, weakest_first=False),
        })
    items.sort(key=lambda i: (-i["pairs"], i["key"]))
    return items


def identity_entry(item: dict, decision: str, surfaces: list, reviewer: str,
                   now: str) -> dict:
    if decision not in IDENTITY_DECISIONS:
        raise ValueError(f"decision must be one of {IDENTITY_DECISIONS}")
    if decision == "mixed" and not surfaces:
        raise ValueError("mixed needs the surfaces that are someone else")
    known = set(item.get("surfaces") or [])
    if any(s not in known for s in surfaces):
        raise ValueError("a surface not in this item")
    return {"id": item["id"], "decision": decision,
            # A refusal covers every surface: the id is not the person the
            # corpus means. A confirmation needs none.
            "surfaces": sorted(surfaces) if decision == "mixed" else [],
            "reviewer": reviewer, "reviewed_at": now}


def surname_entry(item: dict, *, pick: str | None, valid_from: str,
                  valid_to: str, requires_cue: bool, reviewer: str,
                  now: str) -> dict:
    """`pick=None` rejects the surname outright."""
    if pick is not None and pick not in {c["id"] for c in item["candidates"]}:
        raise ValueError("pick a listed candidate")
    for d in (valid_from, valid_to):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", d or ""):
            raise ValueError("dates are YYYY-MM-DD")
    if valid_from > valid_to:
        raise ValueError("valid_from is after valid_to")
    return {"surface": item["surface"], "id": pick,
            "status": "accepted" if pick else "rejected",
            "valid_from": valid_from, "valid_to": valid_to,
            "requires_cue": bool(requires_cue) if pick else False,
            "reviewer": reviewer, "reviewed_at": now}
