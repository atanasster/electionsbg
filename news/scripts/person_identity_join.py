#!/usr/bin/env python3
"""The person identity join — which human each Jev-scored name is.

Plan: `docs/plans/news-person-sentiment-v1.md` §3.1. Jev scores every subject
by the NAME the model wrote; this stamps each person subject with an identity
at BUILD time, so a resolver fix re-attributes history without re-scoring.

⚠️ A WRONG LINK IS WORSE THAN A MISSING ONE. It attributes a tone to the
wrong human, on a page that names them. Every step below therefore REFUSES
rather than grades, and a refusal carries its reason so the rail can say why
a name has no profile.

The steps, in order — the first that answers wins:

1. **exact** — the article's own `entity_links[name]` (the gazetteer's
   exact-one-match), unless the identity audit refused that link or marked it
   `mixed` (then it needs a context cue, like step 2).
2. **context** — a name of two or more words the resolver offered 2–5
   candidates for resolves when
   exactly one candidate carries a cue in this article: its party is linked in
   the article, or an office word it held on the article's date appears within
   `CUE_WINDOW` characters of the name. Zero or two → refused.
3. **surname_alias** — a one-word name resolves through a HUMAN-REVIEWED,
   date-windowed alias (`news/data/person_surname_aliases.json`), only when no
   other person carrying that surname is named in the same article, and with a
   cue when the alias says `requires_cue`. Never generated.
4. **registry** — a reviewed news-only identity (`np_*`) the article's
   `news_persons` rows already resolved (news_persons.py owns that decision).

Then the MERGE rule: two subjects resolving to one identity in one article
keep one row — the higher role, then more mentions — and never an average. If
their values differ by `CONFLICT_GAP` or more, the kept row is `conflict` and
stays out of every aggregate (it still shows on the article page).

Run the measurement (writes nothing):
    python3 news/scripts/person_identity_join.py --report
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

try:
    from .resolve_mentions import fold
except ImportError:  # direct script execution
    from resolve_mentions import fold  # noqa: E402

DATA = ROOT / "news" / "data"
GAZETTEER_PATH = DATA / "gazetteer.json"
ALIASES_PATH = DATA / "person_surname_aliases.json"
CUES_PATH = DATA / "person_context_cues.json"
AUDIT_PATH = DATA / "person_identity_audit.json"
LOCALES = ROOT / "src" / "locales"


def role_labels(locales: Path = LOCALES) -> dict:
    """role code → {bg, en}, from the MAIN site's own `pp_role_*` vocabulary,
    so the rail names an office exactly as the person profile does. A missing
    locale file leaves the code unlabelled rather than failing the build."""
    out: dict = {}
    for lang in ("bg", "en"):
        path = locales / lang / "translation.json"
        if not path.exists():
            continue
        for key, value in json.loads(path.read_text(encoding="utf-8")).items():
            if key.startswith("pp_role_") and not key.startswith("pp_role_plural_"):
                out.setdefault(key[len("pp_role_"):], {})[lang] = value
    return out

# Characters either side of a name within which an office word counts as
# describing THAT name. A whole-article match would let „кметът" in paragraph
# nine vouch for an unrelated person in paragraph one.
CUE_WINDOW = 100
# One bucket on the five-level scale is 1.0 wide; two scores of one person in
# one article that far apart are two readings, not one.
CONFLICT_GAP = 1.0
ROLE_RANK = {"primary": 0, "secondary": 1, "incidental": 2}
BASES = ("exact", "context", "surname_alias", "registry")


def _load(path: Path, default):
    """ABSENT is tolerated; MALFORMED raises with its path. A parse error
    read as „no decisions" would put every refused link back live."""
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


class Sources:
    """Everything the join reads besides the article, loaded once per build.

    ⚠️ ABSENT FILES ARE TOLERATED, as the gazetteer is in build_app_data: a
    checkout without them builds exactly what it built before — step 1 and
    step 4 only.
    """

    def __init__(self, gazetteer_doc: dict | None = None,
                 aliases: dict | None = None, cues: dict | None = None,
                 audit: dict | None = None, registry: dict | None = None,
                 labels: dict | None = None):
        doc = gazetteer_doc if gazetteer_doc is not None else _load(
            GAZETTEER_PATH, {})
        self.people: dict = {}
        self.party_ids: set = set()
        for e in doc.get("entries") or []:
            if e.get("kind") == "person" and e.get("id"):
                self.people[e["id"]] = e
            elif e.get("kind") == "party" and e.get("id"):
                self.party_ids.add(e["id"])
        a = aliases if aliases is not None else _load(ALIASES_PATH, {})
        self.aliases = [x for x in (a.get("aliases") or [])
                        if isinstance(x, dict) and x.get("status") == "accepted"]
        c = cues if cues is not None else _load(CUES_PATH, {})
        self.role_words = {role: [fold(w) for w in words]
                           for role, words in (c.get("role_words") or {}).items()}
        # Every cue word with its role, longest first — the masking in
        # `_role_near` needs to see a longer office that CONTAINS a shorter one
        # („евродепутат" ⊃ „депутат", „районен кмет" ⊃ „кмет").
        self.all_words = sorted(
            ((w, role) for role, words in self.role_words.items()
             for w in words), key=lambda x: -len(x[0]))
        au = audit if audit is not None else _load(AUDIT_PATH, {})
        self.refused: dict = {}
        self.mixed: dict = {}
        # Read by the page guard (person_rollups.page_decision, plan §4.3),
        # not by the join: a confirmation lets a two-part-only person get a page.
        self.confirmed: set = set()
        for d in au.get("decisions") or []:
            pid, decision = d.get("id"), d.get("decision")
            surfaces = {fold(s) for s in d.get("surfaces") or []}
            if decision == "confirmed":
                self.confirmed.add(pid)
            elif decision == "refused":
                self.refused[pid] = surfaces
            elif decision == "mixed":
                self.mixed[pid] = surfaces
        self.role_labels = labels if labels is not None else role_labels()
        reg = registry or {}
        self.news_persons = {p["news_person_id"]: p
                             for p in reg.get("persons") or []
                             if isinstance(p, dict) and p.get("status") == "active"}


def _day(value) -> str | None:
    text = str(value or "")[:10]
    return text if re.match(r"^\d{4}-\d{2}-\d{2}$", text) else None


def held_on(role: dict, day: str | None) -> bool:
    """Did this office cover `day`? An undated role never vouches for one."""
    start, end = role.get("start"), role.get("end")
    if not day or not start:
        return False
    return start <= day and (not end or day <= end)


def _windows(text_folded: str, name: str):
    key = fold(name)
    if not key:
        return
    for m in re.finditer(re.escape(key), text_folded):
        lo = max(0, m.start() - CUE_WINDOW)
        yield text_folded[lo:m.end() + CUE_WINDOW]


def _word_at(window: str, word: str) -> list:
    """Start offsets of `word` not preceded by a letter or a hyphen, so a stem
    matches its inflections but never the tail of a compound
    („заместник-министър" is not „министър")."""
    pattern = r"(?<![\w-])" + re.escape(word)
    return [m.start() for m in re.finditer(pattern, window)]


def _role_near(src: "Sources", text_folded: str, name: str, role: str) -> bool:
    """An office word of `role` within the window, not inside a longer office
    word belonging to another role."""
    words = src.role_words.get(role) or []
    if not words:
        return False
    for window in _windows(text_folded, name):
        masked = window
        for longer, other in src.all_words:
            if other == role:
                continue
            if any(longer != w and w in longer for w in words):
                for start in _word_at(masked, longer):
                    masked = (masked[:start] + " " * len(longer)
                              + masked[start + len(longer):])
        if any(_word_at(masked, w) for w in words):
            return True
    return False


def _party_near(text_folded: str, name: str, surfaces: list) -> bool:
    folded = [fold(x) for x in surfaces if x]
    return any(_word_at(window, f) for window in _windows(text_folded, name)
               for f in folded)


def has_cue(src: Sources, pid: str, name: str, text_folded: str,
            party_surfaces: dict, day: str | None) -> bool:
    """Does this article carry a positive cue, NEAR the name, that `name`
    means `pid`? `party_surfaces` maps a linked party id to the surfaces the
    article wrote it as.

    ⚠️ BOTH CUES ARE LOCAL. A party linked anywhere in a political article
    vouches for nobody in particular — ГЕРБ is in most of them.
    """
    entry = src.people.get(pid) or {}
    party = entry.get("party")
    # ⚠️ Only a CANONICAL party id is a cue. The person layer also carries
    # local-election codes (`p_20`) that name no party this corpus links.
    if (party and party in src.party_ids and party in party_surfaces
            and _party_near(text_folded, name, party_surfaces[party])):
        return True
    for role in (entry.get("display") or {}).get("roles") or []:
        if held_on(role, day) and _role_near(
                src, text_folded, name, role.get("role")):
            return True
    return False


def _identity(kind: str, pid: str, basis: str, src: Sources,
              form_kind: str | None = None, canonical: str | None = None) -> dict:
    if kind == "person":
        # ⚠️ A curated override (`entity_link_overrides.json`) can link a
        # person the gazetteer does not list; the link's own canonical name is
        # then the only one there is, and a page must never ship nameless.
        entry = src.people.get(pid) or {}
        display = entry.get("display") or {}
        roles = display.get("roles") or []
        # The office the rail names: the current one, else the latest held —
        # flagged, so a page never calls a former minister „министър".
        role = next((r for r in roles if r.get("current")), roles[0] if roles else None)
        return {"kind": "person", "id": pid, "basis": basis,
                "canonical": entry.get("canonical") or canonical,
                **({"form_kind": form_kind} if form_kind else {}),
                **({"role": role["role"], "role_current": bool(role.get("current")),
                    "role_label": src.role_labels.get(role["role"]) or {}}
                   if role and role.get("role") else {}),
                "identity_version": entry.get("identity_version")}
    person = src.news_persons.get(pid) or {}
    return {"kind": "news_person", "id": pid, "basis": basis,
            "canonical": person.get("name_bg"),
            "identity_version": person.get("identity_version"),
            **({"scope": person["scope"]} if person.get("scope") else {}),
            **({"public_figure": person["public_figure"]}
               if "public_figure" in person else {})}


def resolve_subject(name: str, *, src: Sources, links: dict, candidates: dict,
                    news_rows: dict, other_people: list, text_folded: str,
                    party_surfaces: dict, day: str | None) -> tuple:
    """(identity | None, refused_reason | None) for ONE person subject."""
    key = fold(name)
    link = links.get(name)
    if isinstance(link, dict) and link.get("kind") == "person" and link.get("id"):
        pid = link["id"]
        refused = src.refused.get(pid)
        if refused is not None and (not refused or key in refused):
            return None, "identity_refused"
        mixed = src.mixed.get(pid)
        if mixed is not None and (not mixed or key in mixed):
            if has_cue(src, pid, name, text_folded, party_surfaces, day):
                return _identity("person", pid, "context", src,
                                 link.get("form_kind"),
                                 link.get("canonical")), None
            return None, "context_required"
        return _identity("person", pid, "exact", src,
                         link.get("form_kind"), link.get("canonical")), None
    if isinstance(link, dict) and link.get("kind") != "person":
        return None, "not_a_person"

    offers = [o for o in candidates.get(name) or []
              if isinstance(o, dict) and o.get("kind") == "person"]
    # ⚠️ NEVER FOR A ONE-WORD NAME. A surname's candidate list is only the
    # gazetteer's public figures, so the person the article means may not be
    # on it at all: measured, „кмета Терзиев" satisfied the office cue for
    # Людмил Терзиев, a mayor elsewhere, in articles about Васил Терзиев. A
    # bare surname links only through a reviewed alias (step 3).
    if offers and len(name.split()) >= 2:
        cued = [o["id"] for o in offers
                if o["id"] not in src.refused
                and has_cue(src, o["id"], name, text_folded,
                            party_surfaces, day)]
        if len(cued) == 1:
            return _identity("person", cued[0], "context", src), None
        return None, "ambiguous"

    if len(name.split()) == 1:
        # ⚠️ AN UNDATED ARTICLE GETS NO ALIAS. The window exists because the
        # same surname meant someone else in another period.
        matches = [] if not day else [
            a for a in src.aliases if fold(a.get("surface") or "") == key
            and (a.get("valid_from") or "") <= day <= (a.get("valid_to") or "9999")]
        if len(matches) == 1:
            alias = matches[0]
            pid = alias.get("id")
            # ⚠️ Another person with this surname named in the same article
            # makes the bare surname unsafe for every occurrence.
            clash = any(fold(p.split()[-1]) == key and fold(p) != key
                        and (links.get(p) or {}).get("id") != pid
                        for p in other_people if p and p.split())
            if clash:
                return None, "surname_clash"
            if alias.get("requires_cue") and not has_cue(
                    src, pid, name, text_folded, party_surfaces, day):
                return None, "cue_required"
            if pid in src.people:
                return _identity("person", pid, "surname_alias", src), None
        elif len(matches) > 1:
            return None, "ambiguous"
        elif offers:
            return None, "ambiguous"

    row = news_rows.get(key)
    if row and row.get("news_person_id") in src.news_persons:
        return _identity("news_person", row["news_person_id"], "registry",
                         src), None
    return None, "no_match"


def _value(subject: dict):
    tone = subject.get("tone")
    return tone.get("value") if isinstance(tone, dict) else None


def merge(subjects: list) -> list:
    """One row per identity. Returns the list with merged-away rows removed."""
    by_id: dict = {}
    for s in subjects:
        ident = s.get("identity")
        if ident:
            by_id.setdefault((ident["kind"], ident["id"]), []).append(s)
    drop = set()
    for group in by_id.values():
        if len(group) < 2:
            continue
        group.sort(key=lambda s: (ROLE_RANK.get(s.get("subject_role"), 3),
                                  -(s.get("mentions") or 0)))
        kept = group[0]
        kept["merged_surfaces"] = sorted({s["name"] for s in group[1:]})
        values = [v for v in (_value(s) for s in group) if v is not None]
        if len(values) >= 2 and max(values) - min(values) >= CONFLICT_GAP:
            kept["conflict"] = True
        drop.update(id(s) for s in group[1:])
    return [s for s in subjects if id(s) not in drop]


def stamp(subjects: list, analysis: dict, article: dict, src: Sources) -> dict:
    """Stamp identities onto an article's Jev subject rows IN PLACE.

    Returns a count report. Party subjects are left untouched.
    """
    report = {b: 0 for b in BASES}
    report.update(refused=0, merged=0, conflict=0)
    links = analysis.get("entity_links") or {}
    candidates = analysis.get("entity_candidates") or {}
    news_rows = {fold(r.get("surface") or ""): r
                 for r in analysis.get("news_persons") or []
                 if isinstance(r, dict) and r.get("news_person_id")}
    # ⚠️ BOTH MODELS' PEOPLE. Jev writes its own subject names and the entity
    # extractor does not always agree; a second „Терзиев" Jev scored is as
    # much a clash as one the extractor listed.
    other_people = [p for p in ((analysis.get("entities") or {}).get("people")
                                or []) if isinstance(p, str)]
    other_people += [s["name"] for s in subjects
                     if s.get("kind") == "person" and s.get("name")]
    party_surfaces: dict = {}
    for surface, v in links.items():
        if isinstance(v, dict) and v.get("kind") == "party" and v.get("id"):
            party_surfaces.setdefault(v["id"], []).append(surface)
    text = "\n".join(str(article.get(k) or "")
                     for k in ("title", "description", "content"))
    text_folded = fold(text)
    day = _day(article.get("published"))
    for s in subjects:
        if s.get("kind") != "person" or not s.get("name"):
            continue
        ident, reason = resolve_subject(
            s["name"], src=src, links=links, candidates=candidates,
            news_rows=news_rows, other_people=other_people,
            text_folded=text_folded, party_surfaces=party_surfaces, day=day)
        if ident:
            s["identity"] = ident
            report[ident["basis"]] += 1
        else:
            s["identity"] = None
            s["refused_reason"] = reason
            report["refused"] += 1
    before = len(subjects)
    subjects[:] = merge(subjects)
    report["merged"] = before - len(subjects)
    report["conflict"] = sum(1 for s in subjects if s.get("conflict"))
    return report


# ── Measurement (plan §3.2) ────────────────────────────────────────────────

def corpus_articles(app_data: Path, *, paths: dict | None = None) -> tuple:
    """(published app-data rows by url, raw corpus bodies by url).

    The app-data rows carry the public analysis (links, candidates,
    news_persons); only the raw corpus file carries the article text. When
    `paths` is given it is filled with url → the body's repo-relative path.
    """
    articles = {}
    for f in sorted((app_data / "articles").glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        rows = doc if isinstance(doc, list) else doc.get("articles", doc)
        if isinstance(rows, dict):
            rows = list(rows.values())
        for a in rows:
            if isinstance(a, dict) and a.get("url"):
                articles[a["url"]] = a
    bodies = {}
    for f in DATA.glob("*/*.json"):
        if f.parent.name.startswith("_") or f.parent.name == "analysis":
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and d.get("url") in articles:
            bodies[d["url"]] = d
            if paths is not None:
                paths[d["url"]] = f.relative_to(ROOT).as_posix()
    return articles, bodies


def corpus_pairs(app_data: Path, sentiment_dir: Path, src: Sources, *,
                 corpus: tuple | None = None):
    """Yield (article, full_article, stamped subjects, report) per scored
    article. `full_article` carries the text; `article` is the app-data row.
    Pass `corpus` (from `corpus_articles`) when the caller already read it."""
    articles, bodies = corpus or corpus_articles(app_data)
    for f in sorted(sentiment_dir.glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        art = articles.get(doc.get("url"))
        if not art:
            continue
        subjects = [dict(s) for s in doc.get("subjects") or []
                    if isinstance(s, dict) and s.get("kind") == "person"
                    and s.get("subject_role") != "incidental"
                    and isinstance(s.get("tone"), dict)]
        body = bodies.get(doc["url"], {})
        full = {**art, "content": body.get("content"),
                "description": body.get("description")}
        rep = stamp(subjects, art.get("analysis") or {}, full, src)
        yield art, full, subjects, rep


def measure(app_data: Path, sentiment_dir: Path, registry: dict) -> dict:
    """Linked pairs and people per basis over the corpus on disk."""
    src = Sources(registry=registry)
    out = {"eligible_pairs": 0, "by_basis": {b: 0 for b in BASES},
           "refused": {}, "people": {b: set() for b in BASES},
           "merged": 0, "conflict": 0}
    for _art, _full, subjects, rep in corpus_pairs(app_data, sentiment_dir, src):
        out["merged"] += rep["merged"]
        out["conflict"] += rep["conflict"]
        for s in subjects:
            out["eligible_pairs"] += 1
            ident = s.get("identity")
            if ident:
                out["by_basis"][ident["basis"]] += 1
                out["people"][ident["basis"]].add(ident["id"])
            else:
                r = s.get("refused_reason")
                out["refused"][r] = out["refused"].get(r, 0) + 1
    out["people"] = {b: len(v) for b, v in out["people"].items()}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    if not args.report:
        ap.print_help()
        return 2
    import news_persons  # noqa: PLC0415
    registry = news_persons.load_registry(ROOT / "news" / "config"
                                          / "news_persons.json")
    print(json.dumps(measure(ROOT / "news" / "app-data",
                             DATA / "analysis" / "sentiment", registry),
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
