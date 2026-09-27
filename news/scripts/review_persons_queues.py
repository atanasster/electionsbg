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
# A surname more public figures carry than the queue can list is never
# proposed: „Димитров" (51 holders) meant Георги Димитров in one article and a
# footballer in the next, and with the holders cut to nine the person an
# article means may not even be on offer. Such a surname stays unlinked.
MAX_SURNAME_HOLDERS = MAX_CANDIDATES
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
    names: dict = {}
    for _art, full, subjects, _rep in pairs:
        for s in subjects:
            ident = s.get("identity")
            words = len(str(s.get("name") or "").split())
            if ident and ident.get("kind") == "person":
                by_person.setdefault(ident["id"], []).append(_pair(full, s))
            elif (not ident and words == 1
                  and s.get("refused_reason") in ("no_match", "ambiguous")):
                surnames.setdefault(fold(s["name"]), []).append(_pair(full, s))
            elif not ident and words >= 2 and s.get("refused_reason") == "no_match":
                # A full name nobody holds — a candidate news-only identity.
                names.setdefault(fold(s["name"]), []).append(_pair(full, s))
    return {"by_person": by_person, "surnames": surnames, "names": names}


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


def candidate_window(entry: dict, corpus_from: str, default_to: str) -> dict:
    """The candidate's dated roles, clipped to the corpus span: from the later
    of the corpus start and their first role, to the earlier of the default
    horizon and their last role's end (an open role runs to the horizon)."""
    roles = [r for r in (entry.get("display") or {}).get("roles") or []
             if r.get("start")]
    if not roles:
        return {"from": corpus_from, "to": default_to}
    first = min(r["start"] for r in roles)
    ends = [r.get("end") for r in roles]
    last = default_to if any(not e for e in ends) else max(ends)
    start = max(corpus_from, first[:10])
    end = min(default_to, last[:10])
    return ({"from": start, "to": end} if start <= end
            else {"from": corpus_from, "to": default_to})


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
        if (len(pairs) < MIN_SURNAME_PAIRS or key in reviewed
                or key not in holders
                or len(holders[key]) > MAX_SURNAME_HOLDERS):
            continue
        cands = sorted(holders[key], key=lambda e: (
            -linked.get(e["id"], 0),
            not any(r.get("current") for r in (e.get("display") or {}).get("roles") or []),
            e["canonical"]))
        days = sorted(p["published"] for p in pairs if p.get("published"))
        corpus_from = days[0][:10] if days else today.isoformat()
        default_to = (today + timedelta(days=ALIAS_DAYS_AHEAD)).isoformat()
        items.append({
            "key": key, "surface": pairs[0]["surface"], "pairs": len(pairs),
            "holders_total": len(cands),
            "candidates": [{"id": e["id"], "canonical": e["canonical"],
                            "roles": (e.get("display") or {}).get("roles") or [],
                            "linked_pairs": linked.get(e["id"], 0),
                            # §8.1 — the window this person could carry the
                            # surname in: their roles within the corpus span.
                            "window": candidate_window(
                                e, corpus_from, default_to)}
                           for e in cands[:MAX_CANDIDATES]],
            "window": {"from": corpus_from, "to": default_to},
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


# ── Оценки — the blinded tone annotation behind the gate (plan §8) ─────────

ANNOTATION_ROLES = ("primary", "secondary", "incidental", "not_substantive")
SUBSTANTIVE_ROLES = frozenset({"primary", "secondary"})


def annotation_items(sample: dict, *, second_reader: bool) -> list:
    """The pairs to label. ⚠️ BLINDED: only what the annotator may see — the
    pair id, the name to judge and who it is — never the outlet, the URL, the
    stratum or the model's answer. The text is served per pair, separately."""
    ids = set(sample.get("second_reader") or ())
    out = []
    # ⚠️ ORDERED BY pair_id — a hash, uncorrelated with anything. The sample
    # file is drawn stratum by stratum, so its own order would tell the
    # annotator the model's group from the position counter alone.
    for p in sorted(sample.get("pairs") or [], key=lambda p: p["pair_id"]):
        if second_reader and p["pair_id"] not in ids:
            continue
        ident = p.get("identity") or {}
        out.append({"key": p["pair_id"], "surface": p.get("surface"),
                    "canonical": ident.get("canonical")})
    return out


def annotation_answer(*, role: str | None, level, wrong_person: bool,
                      declined: bool) -> dict:
    """Validate one keypress-level answer."""
    if declined:
        return {"declined": True}
    if wrong_person:
        if role is not None and role not in ANNOTATION_ROLES:
            raise ValueError(f"role must be one of {ANNOTATION_ROLES}")
        return {"wrong_person": True, "role": role or "not_substantive"}
    if role not in ANNOTATION_ROLES:
        raise ValueError(f"role must be one of {ANNOTATION_ROLES}")
    if role in SUBSTANTIVE_ROLES:
        if not isinstance(level, int) or not 0 <= level <= 4:
            raise ValueError("a main subject or participant needs a tone 1–5")
        return {"role": role, "level": level}
    return {"role": role}


def adjudication_rows(sample: dict, answers: dict, *, annotator: str,
                      rubric_version: str, finalized_at: str,
                      revealed: set) -> list:
    """The finished working copy as the gate's rows: the sealed sample fields
    plus the human answer. `answers` is pair_id → annotation_answer()."""
    by_id = {p["pair_id"]: p for p in sample.get("pairs") or []}
    rows = []
    for pid, ans in sorted(answers.items()):
        p = by_id.get(pid)
        if not p:
            continue
        rows.append({
            "pair_id": pid, "split": "test", "stratum": p.get("stratum"),
            "article_url": p.get("article_url"), "surface": p.get("surface"),
            "identity": p.get("identity"),
            "identity_version": p.get("identity_version"),
            "rubric_version": rubric_version,
            "pipeline_role": p.get("pipeline_role"),
            "pipeline_value": p.get("pipeline_value"),
            "pipeline_bucket_index": p.get("pipeline_bucket_index"),
            "role": ans.get("role"), "level": ans.get("level"),
            "wrong_person": bool(ans.get("wrong_person")),
            "declined": bool(ans.get("declined")),
            "source_revealed": pid in revealed,
            "annotator": annotator, "annotated_at": finalized_at,
        })
    import person_accuracy_gate as gate  # noqa: PLC0415
    for row in rows:
        row["seal"] = gate.seal_of(row)
    return rows


def merge_adjudications(doc: dict, rows: list, annotator: str,
                        served: set, *, second_pass: bool = False,
                        finalized_at: str | None = None) -> dict:
    """Replace THIS annotator's rows on the pairs this pass served, keep
    everything else — a second reader must never overwrite the first, which is
    what agreement is computed over, and a reviewer's second pass must not
    delete their first."""
    pass_name = "second" if second_pass else "first"
    clash = [r for r in doc.get("pairs") or []
             if r.get("annotator") == annotator and r.get("pair_id") in served
             and (r.get("pass") or "first") != pass_name]
    if clash:
        # §9 — one person relabelling is not agreement, and replacing their
        # other pass would delete it. A second reader must be someone else.
        raise ValueError(
            f"{annotator} already has {len(clash)} {('first' if second_pass else 'second')}"
            "-pass rows on these pairs — the second reader must be a different person")
    kept = [r for r in doc.get("pairs") or []
            if not (r.get("annotator") == annotator
                    and r.get("pair_id") in served)]
    finalized = dict(doc.get("finalized") or {})
    if finalized_at:
        finalized[f"{annotator}:{pass_name}"] = finalized_at
    return {**doc, "version": 2, "finalized": finalized,
            "pairs": kept + [{**r, "pass": pass_name} for r in rows]}


# ── Нови лица — Bulgarians outside the gazetteer (plan §3.1.4) ─────────────

MIN_NEW_PERSON_PAIRS = 5


MAX_SIMILAR = 5


def similar_people(surface: str, people: dict) -> list:
    """Gazetteer people whose name shares this one's surname — the main-site
    namesakes a reviewer must rule out before minting a news-only identity.
    Same first name first."""
    words = [fold(w) for w in surface.split()]
    if len(words) < 2:
        return []
    out = []
    for pid, e in people.items():
        parts = [fold(w) for w in str(e.get("canonical") or "").split()]
        if len(parts) >= 2 and parts[-1] == words[-1]:
            out.append((parts[0] != words[0], e.get("canonical") or "", pid))
    out.sort()
    return [{"id": pid, "canonical": name}
            for _, name, pid in out[:MAX_SIMILAR]]


def new_person_items(collected_names: dict, registry: dict, scope_review: dict,
                     *, people: dict | None = None,
                     stoplist: list | None = None,
                     today: date | None = None) -> list:
    """Full names Jev scored that resolve to nobody, most-scored first.

    `collected_names` is folded name → [pair] for UNLINKED subjects of two or
    more words. Names already in the registry, or already decided as foreign
    or rejected, are not proposed again."""
    known = set()
    for p in registry.get("persons") or []:
        known.add(fold(p.get("name_bg") or ""))
        for a in p.get("aliases") or []:
            known.add(fold(a.get("surface") or ""))
    for bucket in ("foreign", "rejected"):
        for row in scope_review.get(bucket) or []:
            known.add(fold(row.get("name") or ""))
    # Foreign heads of state and senior foreign officials (§8.1: „already
    # filtered out") — the reviewer's time goes on missing Bulgarians.
    known.update(fold(n) for n in stoplist or ())
    items = []
    for key, pairs in collected_names.items():
        if len(pairs) < MIN_NEW_PERSON_PAIRS or key in known:
            continue
        surface = pairs[0]["surface"]
        outlets = sorted({p.get("domain") for p in pairs if p.get("domain")})
        items.append({
            "key": key, "surface": surface, "pairs": len(pairs),
            "outlets": len(outlets),
            "excerpts": _spread(pairs, EXCERPTS, weakest_first=False),
            "similar": similar_people(surface, people or {}),
            # A DRAFT the reviewer must edit — never saved as written.
            "draft_bg": f"Споменат(а) в {len(pairs)} материала от "
                        f"{len(outlets)} издания.",
        })
    items.sort(key=lambda i: (-i["pairs"], i["key"]))
    return items


def news_person_id(name: str) -> str:
    import hashlib  # noqa: PLC0415
    return "np_" + hashlib.sha256(fold(name).encode("utf-8")).hexdigest()[:8]


def registry_person(item: dict, *, name_bg: str, name_en: str,
                    disambiguation_bg: str, disambiguation_en: str,
                    public_figure: bool, reviewer: str, now: str) -> dict:
    """A reviewed, ACTIVE registry entry — every field `load_registry`
    requires, with the evidence the reviewer looked at."""
    for label, value in (("name_bg", name_bg), ("name_en", name_en),
                         ("disambiguation_bg", disambiguation_bg),
                         ("disambiguation_en", disambiguation_en)):
        if not str(value or "").strip():
            raise ValueError(f"{label} is required")
    if disambiguation_bg.strip() == item["draft_bg"]:
        raise ValueError("the description is still the draft — edit it")
    urls = [x["url"] for x in item["excerpts"] if str(x.get("url") or "").startswith("https://")]
    if not urls:
        raise ValueError("no https evidence to cite")
    source = lambda x: {  # noqa: E731
        "url": x["url"], "domain": x.get("domain"),
        "published": x.get("published"),
        "supports": "the name as written in the article",
        "reviewer": reviewer, "reviewed_at": now}
    return {
        "news_person_id": news_person_id(name_bg),
        "name_bg": name_bg.strip(), "name_en": name_en.strip(),
        "status": "active", "created_at": now,
        "reviewed_by": reviewer, "reviewed_at": now,
        "disambiguation_bg": disambiguation_bg.strip(),
        "disambiguation_en": disambiguation_en.strip(),
        "identity_sources": [source(x) for x in item["excerpts"][:2]
                             if str(x.get("url") or "").startswith("https://")],
        "aliases": [{"surface": item["surface"], "scope": "global",
                     "status": "accepted", "evidence": urls[:3],
                     "reviewer": reviewer, "reviewed_at": now, "note": ""}],
        "verified_main_site_slug": None, "namesakes": [], "history": [
            {"at": now, "by": reviewer, "change": "created in the review workspace"}],
        "scope": "bg", "public_figure": bool(public_figure),
    }
