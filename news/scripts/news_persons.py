#!/usr/bin/env python3
"""Plan T4.0 — news-person identity: the registry, the resolver, the queue.

⚠️⚠️ THE MODEL CANNOT MINT A TRUSTED ID. `news/config/news_persons.json` is
a human-owned registry; this module RESOLVES an article's person mentions
against its reviewed aliases and nothing else. A name that matches no
accepted alias in an applicable scope stays an UNLINKED name — visible,
„not assessed", counted in coverage — and is queued for review with the
articles it occurred in. A name that matches two active identities in the
same scope is REFUSED as ambiguous, never picked.

⚠️ THE ID IS OPAQUE AND IMMUTABLE. `np_<8 hex>` survives every spelling
change; the main-site Postgres id is a positional ordinal reassigned on
every resolve and may never be a durable news key; the main-site slug is an
OPTIONAL, verified link (`verified_main_site_slug`) — a private individual
in the news has no official profile and must not be given one.

⚠️ SCOPES, AND WHY A SURNAME MAY NEVER BE GLOBAL. An alias resolves only
within its scope: `global` (a full name unique across the corpus),
`case:<slug>` (only in articles the T3.3 case RULE matched — the raw rule
hit at build time, BEFORE the fixture verification that decides whether the
case publishes; it is supporting context, never proof, so the alias still
needs a reviewer), or `article:<url>` (a reviewed override for ONE article,
the only way a bare-surname report ever resolves). ⚠️ An `article:` alias
asserts EVERY occurrence of that surface in that article is one person; when
the identity's own `namesakes` list names someone who is ALSO named in the
article, the override is refused as ambiguous rather than applied.
`load_registry` refuses a global alias of one NAME word — an honorific does
not make „г-н Калушев" a full name; „Калушев" is two people inside one case.

⚠️ THE DECISION IS VERSIONED INDEPENDENTLY OF ANY TONE. Every resolution
carries `identity_version` — the registry version and a digest of the
accepted alias set — so a correction (a merge, a split, a withdrawn alias)
invalidates the pairs built on the old decision without silently
transferring an assessment to another person. T4.3 must carry it on every
person-treatment record and refuse one whose version no longer matches.

The dependency order the plan states, and where each step lives:
  extract mentions/spans      → resolve_mentions.py (dictionary pass), the model
  resolve against the registry → resolve_article() here, at BUILD time
  queue new/ambiguous          → write_candidate_queue() here
  approve identity             → a human edits the registry
  assess the resolved targets  → T4.3 (not here)
  validate → publish           → build_app_data
Resolution runs at build time on purpose: a registry change re-resolves
EVERY article on the next build, which is the „changing aliases triggers
re-resolution and all dependent rebuilds" rule with no second mechanism.

Pending and withdrawn identities never produce public output: the app-data
index exports ACTIVE identities only, and only their reviewed fields.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

try:
    from .resolve_mentions import TOKEN_RE, fold
except ImportError:  # direct script execution
    from resolve_mentions import TOKEN_RE, fold

ID_RE = re.compile(r"^np_[0-9a-f]{8}$")
# Titles that precede a name in Bulgarian copy and are not part of it.
HONORIFIC_RE = re.compile(
    r"^(?:г-н|г-жа|г-ца|д-р|проф\.?|доц\.?|акад\.?|инж\.?|адв\.?|ген\.?|полк\.?|кап\.?|"
    r"министър|депутат|кмет|премиер|президент|вицепрезидент|съдия|прокурор|отец)\s+",
    re.IGNORECASE)
# Strongest scope first: an article override beats a case scope beats global.
SCOPE_RANK = ("article:", "case:", "global")
LIST_FIELDS = ("identity_sources", "aliases", "namesakes", "history")
STATUSES = ("pending_review", "active", "withdrawn")   # a MERGED record leaves `persons` and lives in retired_ids
ALIAS_STATUSES = ("pending_review", "accepted", "rejected")
SCOPE_RE = re.compile(r"^(global|case:[a-z0-9]+(-[a-z0-9]+)*|article:https://\S+)$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
REQUIRED = {"news_person_id", "name_bg", "name_en", "status", "created_at", "reviewed_by",
            "reviewed_at", "disambiguation_bg", "disambiguation_en", "identity_sources",
            "aliases", "verified_main_site_slug", "namesakes", "history"}
NOT_ASSESSED = "not_assessed"


def name_words(surface: str) -> int:
    """Name tokens EXCLUDING a leading title — „г-н Калушев" is one name word,
    and one name word is a surname, never a global alias."""
    return len(TOKEN_RE.findall(HONORIFIC_RE.sub("", surface or "")))


def scope_rank(scope: str) -> int:
    return next(i for i, k in enumerate(SCOPE_RANK) if scope.startswith(k))


def load_registry(path: Path) -> dict:
    """The registry, validated. A malformed entry refuses the build: an
    identity record is a published claim about a named individual."""
    if not path.exists():
        return {"version": 1, "registry_version": "none", "retired_ids": {}, "persons": []}
    doc = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(doc, dict) or doc.get("version") != 1
            or not isinstance(doc.get("persons"), list) or not isinstance(doc.get("retired_ids"), dict)
            or not str(doc.get("registry_version") or "").strip()):
        raise ValueError(f"{path}: expected {{version: 1, registry_version, retired_ids: {{}}, persons: []}}")
    seen = set()
    for p in doc["persons"]:
        missing = REQUIRED - set(p) if isinstance(p, dict) else REQUIRED
        if missing:
            raise ValueError(f"{path}: person {p.get('news_person_id') if isinstance(p, dict) else p!r} lacks {sorted(missing)}")
        pid = p["news_person_id"]
        if not ID_RE.match(pid) or pid in seen or pid in doc["retired_ids"]:
            raise ValueError(f"{path}: bad, duplicate or retired news_person_id {pid!r}")
        seen.add(pid)
        if p["status"] not in STATUSES:
            raise ValueError(f"{path}: {pid}.status must be one of {STATUSES}")
        if not str(p["name_bg"]).strip() or not str(p["name_en"]).strip():
            raise ValueError(f"{path}: {pid} needs a bg and an en display name")
        if not ISO_RE.match(str(p["created_at"])):
            raise ValueError(f"{path}: {pid}.created_at must be an ISO instant")
        for key in LIST_FIELDS:
            if not isinstance(p[key], list):
                raise ValueError(f"{path}: {pid}.{key} must be a list")
        slug = p["verified_main_site_slug"]
        if slug is not None and not re.match(r"^[a-z0-9-]+$", str(slug)):
            raise ValueError(f"{path}: {pid}.verified_main_site_slug must be a slug or null")
        for a in p["aliases"]:
            if not isinstance(a, dict) or not str(a.get("surface") or "").strip():
                raise ValueError(f"{path}: {pid} alias needs a surface")
            if a.get("status") not in ALIAS_STATUSES:
                raise ValueError(f"{path}: {pid} alias {a['surface']!r} status must be one of {ALIAS_STATUSES}")
            if not SCOPE_RE.match(str(a.get("scope") or "")):
                raise ValueError(f"{path}: {pid} alias {a['surface']!r} scope must be global | case:<slug> | article:<https url>")
            # ⚠️ THE rule this file exists for.
            if a["scope"] == "global" and name_words(a["surface"]) < 2:
                raise ValueError(f"{path}: {pid} alias {a['surface']!r} is one name word with global scope — a surname (with or without a title) is never a global alias")
            if a["status"] == "accepted":
                if not a.get("evidence") or not a.get("reviewer") or not ISO_RE.match(str(a.get("reviewed_at") or "")):
                    raise ValueError(f"{path}: {pid} accepted alias {a['surface']!r} needs evidence, reviewer and reviewed_at")
                if not all(str(u).startswith("https://") for u in a["evidence"]):
                    raise ValueError(f"{path}: {pid} alias {a['surface']!r} evidence must be https URLs")
        if p["status"] == "active":
            if not p["identity_sources"] or not p["reviewed_by"] or not ISO_RE.match(str(p["reviewed_at"] or "")):
                raise ValueError(f"{path}: {pid} is active but lacks identity sources, a reviewer or a review time")
            for src in p["identity_sources"]:
                if not (isinstance(src, dict) and str(src.get("url", "")).startswith("https://")
                        and src.get("supports") and src.get("reviewer")):
                    raise ValueError(f"{path}: {pid} identity source needs an https url, what it supports and a reviewer")
            if not any(a["status"] == "accepted" for a in p["aliases"]):
                raise ValueError(f"{path}: {pid} is active with no accepted alias — it can resolve nothing")
    for old, target in doc["retired_ids"].items():
        if not ID_RE.match(old) or target not in seen:
            raise ValueError(f"{path}: retired id {old!r} must redirect to a live news_person_id")
    return doc


def identity_version(doc: dict, person: dict) -> str:
    """The registry version plus a digest of this person's ACCEPTED alias set
    — what a tone assessment must carry, and what a correction changes."""
    accepted = sorted((a["surface"], a["scope"]) for a in person["aliases"] if a["status"] == "accepted")
    # The id is in the digest, so two identities with identical alias sets
    # never share a version string.
    digest = hashlib.sha256(json.dumps([person["news_person_id"], accepted], ensure_ascii=False).encode("utf-8")).hexdigest()[:12]
    return f"{doc['registry_version']}:{digest}"


class Resolver:
    """Accepted aliases of ACTIVE identities, by folded surface and scope."""

    def __init__(self, doc: dict):
        self.doc = doc
        self.by_id = {p["news_person_id"]: p for p in doc["persons"]}
        self.retired = dict(doc.get("retired_ids") or {})
        self.claims: dict = defaultdict(list)   # folded surface → [(scope, person)]
        for p in doc["persons"]:
            if p["status"] != "active":
                continue
            for a in p["aliases"]:
                if a["status"] == "accepted":
                    self.claims[fold(a["surface"])].append((a["scope"], p))

    def canonical(self, pid: str) -> str:
        seen = set()
        while pid in self.retired and pid not in seen:
            seen.add(pid)
            pid = self.retired[pid]
        return pid

    def _applies(self, scope: str, url: str, case_ids: set) -> bool:
        if scope == "global":
            return True
        if scope.startswith("case:"):
            return scope[5:] in case_ids
        if scope.startswith("article:"):
            return scope[8:] == url
        return False

    def resolve_surface(self, surface: str, url: str, case_ids: set) -> dict:
        """One surface → {basis, news_person_id | None, ...}. Never picks."""
        claims = [(scope, p) for scope, p in self.claims.get(fold(surface), [])
                  if self._applies(scope, url, case_ids)]
        ids = {p["news_person_id"] for _, p in claims}
        if len(ids) == 1:
            scope, p = claims[0]
            # An article override outranks a case scope outranks global, but
            # they all name the same person here, so the strongest is stated.
            best = min(claims, key=lambda c: scope_rank(c[0]))
            return {"basis": "registry_alias", "news_person_id": p["news_person_id"],
                    "alias_scope": best[0], "identity_version": identity_version(self.doc, p)}
        if len(ids) > 1:
            return {"basis": "ambiguous_registry", "news_person_id": None,
                    "candidates": sorted(ids)}
        return {"basis": "not_in_registry", "news_person_id": None}


def person_surfaces(rec: dict) -> list:
    """The person names an analysis record carries: the dictionary pass's
    person mentions AS WRITTEN, plus the model's `entities.people`. Folded
    duplicates collapse to the first spelling seen."""
    seen: dict = {}
    for m in rec.get("mentions") or []:
        if isinstance(m, dict) and m.get("kind") == "person" and m.get("surface"):
            slot = seen.setdefault(fold(m["surface"]), {"surface": m["surface"], "main_site_ids": set()})
            # The dictionary pass's OWN resolutions, carried as a seed for the
            # reviewer — a main-site id is evidence toward an identity, never
            # the identity itself. A SET: coreference can resolve two
            # occurrences of one surface to two people, and a disagreement
            # must reach the reviewer rather than be settled by position.
            if m.get("id") and m.get("basis") in ("gazetteer_exact", "coref_resolved"):
                slot["main_site_ids"].add(m["id"])
    for name in ((rec.get("entities") or {}).get("people") or []):
        if isinstance(name, str) and name.strip():
            seen.setdefault(fold(name), {"surface": name, "main_site_ids": set()})
    return list(seen.values())


def resolve_article(resolver: Resolver, rec: dict, case_ids) -> list:
    """Every person name in the record with its identity decision. A name
    with no decision is carried with `assessment: not_assessed` — visible,
    unlinked, counted."""
    url = rec.get("url") or ""
    cases = set(case_ids or [])
    surfaces = person_surfaces(rec)
    folded_in_article = {fold(f["surface"]) for f in surfaces}
    out = []
    for found in surfaces:
        surface = found["surface"]
        decision = resolver.resolve_surface(surface, url, cases)
        if decision["news_person_id"] and name_words(surface) < 2:
            # ⚠️ A one-word surface resolved only through an override. If the
            # identity's own namesake is ALSO named in this article, the
            # override cannot be right for every occurrence — refuse it.
            p = resolver.by_id[decision["news_person_id"]]
            clashing = sorted(n["name"] for n in p.get("namesakes") or []
                              if isinstance(n, dict) and fold(n.get("name") or "") in folded_in_article)
            if clashing:
                decision = {"basis": "ambiguous_registry", "news_person_id": None,
                            "candidates": [p["news_person_id"]],
                            "reason": f"namesake named in the same article: {', '.join(clashing)}"}
        row = {"surface": surface, **decision, "assessment": NOT_ASSESSED}
        if found["main_site_ids"]:
            row["main_site_ids"] = sorted(found["main_site_ids"])
        if decision["news_person_id"]:
            p = resolver.by_id[decision["news_person_id"]]
            row["name_bg"] = p["name_bg"]
            row["name_en"] = p["name_en"]
            row["verified_main_site_slug"] = p["verified_main_site_slug"]
        out.append(row)
    return out


BASIS_RANK = {"ambiguous_registry": 0, "not_in_registry": 1}


def candidate_queue(rows_by_article: dict, registry: dict, generated_at: str,
                    published_articles: int | None = None) -> dict:
    """`news/review/news_person_candidates.json` — every surface that did
    NOT resolve, with how often and where, so a reviewer can create or
    extend an identity from evidence rather than from a spelling. Names the
    registry already holds as pending are marked so; ambiguous ones carry
    the ids that collided."""
    by_surface: dict = defaultdict(lambda: {"articles": 0, "basis": None, "examples": [], "candidates": set(),
                                            "main_site_ids": set(), "spellings": Counter()})
    pending = {fold(a["surface"]): p["news_person_id"] for p in registry["persons"]
               if p["status"] == "pending_review" for a in p["aliases"]}
    for url, rows in rows_by_article.items():
        for r in rows:
            if r["news_person_id"]:
                continue
            key = fold(r["surface"])
            slot = by_surface[key]
            slot["spellings"][r["surface"]] += 1
            slot["articles"] += 1
            # Ambiguity anywhere is the row's basis: an ambiguous surface must
            # never be filed as merely unknown because its last article was.
            if slot["basis"] is None or BASIS_RANK[r["basis"]] < BASIS_RANK[slot["basis"]]:
                slot["basis"] = r["basis"]
            if len(slot["examples"]) < 3:
                slot["examples"].append(url)
            slot["candidates"].update(r.get("candidates") or [])
            slot["main_site_ids"].update(r.get("main_site_ids") or [])
            if key in pending:
                slot["pending_identity"] = pending[key]
    items = []
    for v in by_surface.values():
        # The most frequent spelling labels the row, not the first seen.
        surface = v["spellings"].most_common(1)[0][0]
        items.append({**{k: x for k, x in v.items() if k != "spellings"}, "surface": surface,
                      "candidates": sorted(v["candidates"]), "main_site_ids": sorted(v["main_site_ids"])})
    items.sort(key=lambda v: (-v["articles"], v["surface"]))
    # A name seen once is retrieval noise until it recurs; it is COUNTED but
    # not listed, so the queue stays a reviewable size (measured: 4,340
    # surfaces / 1.7 MB unfiltered, most of them singletons).
    singletons = sum(1 for i in items if i["articles"] < 2)
    items = [i for i in items if i["articles"] >= 2]
    # Single words are surnames or given names: retrieval candidates, never
    # a global alias — say so on the row so nobody creates one.
    for it in items:
        it["single_word"] = name_words(it["surface"]) < 2
    return {
        "version": 1,
        "generated_at": generated_at,
        "registry_version": registry["registry_version"],
        "how_to_read": "Person names that resolved to NO news identity, over every published article. `not_in_registry` needs an identity or an alias with evidence; `ambiguous_registry` names the identities that collided in scope and needs a narrower scope or a split. A single-word surface may become a case- or article-scoped alias only, never a global one. `main_site_ids` is what the dictionary pass resolved the surface to on the main site — a seed for the reviewer, not an identity. Nothing here is a claim about who a name is.",
        "counts": {"surfaces": len(items), "singletons_omitted": singletons,
                   "articles_with_person_names": len(rows_by_article),
                   "published_articles": published_articles,
                   "ambiguous": sum(1 for i in items if i["basis"] == "ambiguous_registry"),
                   "pending_in_registry": sum(1 for i in items if i.get("pending_identity"))},
        "items": items,
    }


def public_index(registry: dict, article_counts: dict, generated_at: str) -> dict:
    """The app-data export: ACTIVE identities only, reviewed fields only.
    Pending and withdrawn identities never leave the registry."""
    persons = []
    for p in registry["persons"]:
        if p["status"] != "active":
            continue
        persons.append({
            "news_person_id": p["news_person_id"],
            "name_bg": p["name_bg"],
            "name_en": p["name_en"],
            "disambiguation_bg": p["disambiguation_bg"],
            "disambiguation_en": p["disambiguation_en"],
            "identity_sources": [{"url": s["url"], "domain": s.get("domain"), "published": s.get("published")}
                                 for s in p["identity_sources"]],
            "aliases": sorted({a["surface"] for a in p["aliases"] if a["status"] == "accepted"}),
            "verified_main_site_slug": p["verified_main_site_slug"],
            "identity_version": identity_version(registry, p),
            "reviewed_at": p["reviewed_at"],
            "article_count": article_counts.get(p["news_person_id"], 0),
        })
    active = {p["news_person_id"] for p in persons}
    resolver = Resolver(registry)
    return {"version": 1, "generated_at": generated_at, "registry_version": registry["registry_version"],
            "basis": "reviewed identities only; article_count is how many published articles resolved a mention to this identity — not an assessment of anyone",
            # Only redirects whose live target is exported: a redirect into a
            # pending identity would name it.
            "retired_ids": {old: resolver.canonical(old) for old in (registry.get("retired_ids") or {})
                            if resolver.canonical(old) in active},
            "persons": sorted(persons, key=lambda p: p["news_person_id"])}
