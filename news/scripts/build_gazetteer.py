#!/usr/bin/env python3
"""Build news/data/gazetteer.json — the surface forms a mention resolver may
match, and the identity each one is allowed to claim.

⚠️⚠️ THE ONE RULE, AND THE PLAN GOT IT WRONG: „the bare surname where it is
unique WITHIN THE ROSTER" is not safe, and the corpus says so unambiguously.
Measured 2026-08-26 against the identity layer:

    254 current MPs
    175 have a surname unique within that roster
     …of which 137 are shared with at least one OTHER public figure
     …and only 27 are nationally unique at all
    „Иванов" alone is shared by 1,554 public figures

Unique-in-roster is a fact about the roster, not about the name. So a bare
surname NEVER resolves on its own here — it is stored as a COREFERENCE ANCHOR
only (`resolvable: false`), usable by T2.3 to attach „Пеевски" in ¶4 to
„Делян Пеевски" in ¶1 of the SAME DOCUMENT, and never to a roster row on its
own. That is a within-document fact rather than a guess about which Иванов a
newsroom meant.

The same measurement kills a weaker version of the assumption: the TWO-PART
form („Делян Пеевски") is unique among public figures for only 146 of 254
MPs. So two-part forms are emitted with `resolvable` computed against the
whole public-figure corpus, not against the roster, and the other 108 are
carried as anchors too. Refuse rather than grade — the `aop_expert` rule, one
dataset over.

Output shape (one JSON object on stdout as usual; the file is the artifact):

    {"version": 1, "generated_at": …, "coverage": {…},
     "entries": [{"kind": "person", "id": "<slug>", "canonical": "…",
                  "forms": [{"surface": "…", "resolvable": true|false,
                             "why": "…"}], …}]}

Run:  python3 news/scripts/build_gazetteer.py [--json]
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])
OUT = ROOT / "news" / "data" / "gazetteer.json"
GAZETTEER_VERSION = 1

# Three queries over indexed tables; slower than this is a hung
# connection rather than a big corpus.
QUERY_TIMEOUT_SECONDS = 300

# ⚠️ A surface form shorter than this never resolves, whatever the roster says.
# „ЕС", „МО", „БГ" and every two-letter surname would otherwise fire on
# ordinary words and abbreviations, and a false institution mention is as
# wrong as a false person one — it just looks less alarming.
MIN_SURFACE_CHARS = 4

# Institution names below this contract count are not worth a surface form:
# `awarder_search` holds 10,550 rows, most of them a single school or a
# municipal kindergarten that no newsroom names. The cut is on EVIDENCE (does
# this body actually appear in public life) rather than on name length.
MIN_AWARDER_CONTRACTS = 25

# ⚠️ Places whose name is also an ordinary Bulgarian word, a common given
# name, or a national institution's name. `place_dim` has 5,720 rows and its
# short entries fire constantly: „Средище", „Църква", „Победа", „Езерово" are
# villages AND words. This is a DENY list rather than a length rule because
# length does not separate them — „Победа" is six characters.
PLACE_STOPWORDS = frozenset({
    "победа", "средище", "църква", "езерово", "искра", "звезда", "надежда",
    "любен", "богдан", "иван", "george", "изгрев", "младост", "дружба",
    "свобода", "пролет", "септември", "май", "юг", "север", "запад", "изток",
    "център", "нови", "ново", "нова", "старо", "стара", "стари", "долно",
    "долна", "горно", "горна", "малко", "малка", "голямо", "голяма",
})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class NoDatabase(Exception):
    """Postgres is unreachable. Not an error — see main()."""


def query(sql: str, params: dict | None = None) -> list:
    """Run one SELECT through `psql` and return its rows as parsed JSON.

    ⚠️ A SUBPROCESS, not a driver, and that is a design decision rather than a
    shortcut. The whole point of the gazetteer is that it is a COMMITTED FILE:
    built once on a machine that has the identity layer, then read by the
    standalone analysis box, which has no Postgres and must not need psycopg2
    to run the pipeline. Every other script in news/scripts is pure-file for
    the same reason; a database driver here would put a build-time dependency
    on the runtime.

    Params ride psql `-v` variables and are interpolated as QUOTED literals
    via :'name', so a value can never be read as SQL.
    """
    url = os.environ.get("NEWS_GAZETTEER_DATABASE_URL") \
        or os.environ.get("DATABASE_URL") \
        or "postgres://postgres@127.0.0.1:5433/electionsbg"
    # One row of JSON out, so nothing is parsed by hand and a NULL stays null
    # rather than becoming the empty string `psql -tA` prints for it.
    wrapped = f"select coalesce(json_agg(t), '[]'::json) from ({sql}) t"
    argv = ["psql", url, "-tAX", "-v", "ON_ERROR_STOP=1"]
    for k, v in (params or {}).items():
        argv += ["-v", f"{k}={v}"]
    # ⚠️ The SQL goes in on STDIN, not through `-c`. psql expands :\'name\'
    # only while parsing a script; with `-c` the string is handed to the
    # server as-is, so every variable reference arrives as a literal colon and
    # the query dies with `syntax error at or near ":"`. Measured — `-c` with
    # `-v ns=52` and `select :\'ns\'` is a syntax error, the same query on
    # stdin returns 52.
    argv += ["-f", "-"]
    try:
        proc = subprocess.run(argv, input=wrapped, capture_output=True,
                              text=True, timeout=QUERY_TIMEOUT_SECONDS)
    except FileNotFoundError as exc:
        raise NoDatabase("psql is not on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise NoDatabase(
            f"psql timed out after {QUERY_TIMEOUT_SECONDS}s") from exc
    if proc.returncode != 0:
        # ⚠️ "cannot connect" and "your SQL is wrong" are different problems
        # and only the first is a legitimate skip. Swallowing a query error as
        # „no database" would write nothing and exit 0 on a broken build —
        # the shape this file's own skip path is otherwise careful to avoid.
        err = (proc.stderr or "").strip()
        first = err.splitlines()[0] if err else "connection failed"
        if "could not connect" in err or "could not translate host" in err \
                or "Connection refused" in err:
            raise NoDatabase(first)
        raise RuntimeError(f"gazetteer query failed: {first}\n{err[:1500]}")
    return json.loads(proc.stdout or "[]")


def form(surface: str, resolvable: bool, why: str,
         ident: str | None = None) -> dict:
    """One surface form, and the identity it is allowed to claim.

    ⚠️⚠️ THE ID LIVES ON THE FORM, NOT ON THE ENTRY, and that is the whole
    safety property of this file. With the id on the entry, a person whose
    every form is ambiguous still published a perfectly good-looking slug —
    204 of them — and any consumer reading `entry.id` after a surface hit
    would link „Александър Александров" (47 public figures) to one specific
    person. Here a refused form carries `id: null` BY CONSTRUCTION, so the
    only way to obtain an id is to match a form that had earned one.

    The invariant is total and mechanically checkable across all four kinds:
    `resolvable is False` ⟺ `id is None`.
    """
    return {"surface": surface, "resolvable": resolvable,
            "id": ident if resolvable else None, "why": why}


def person_forms(slug: str, s_full: str, tok_first: str, tok_last: str,
                 full_n: int, full_self: bool,
                 two_n: int, two_self: bool, sur_n: int) -> list:
    """The surface forms one roster person may be matched by.

    ⚠️ `resolvable` is computed against the PUBLIC-FIGURE CORPUS, never
    against the roster. „unique among the 254 MPs" is a fact about the roster;
    the newsroom is writing about Bulgaria.

    ⚠️ THAT INCLUDES THE FULL NAME. The obvious version marks the three-part
    form resolvable unconditionally — it is the identity layer's own key, so
    it feels safe — and it is not: 9,774 of 63,816 public figures (15.3%)
    share a folded three-part name. Marking it true by default reported „0
    people with no resolvable form" over a roster where the count is 202.

    ⚠️⚠️ AND A COUNT OF ONE IS NOT ENOUGH — the one may be SOMEBODY ELSE.
    „Надя Спасова Клисурска - Жекова" splits to the two-part surface „Надя
    Жекова", which matches exactly one public figure and it is NOT her (her
    family fold is the compound). Resolving on the count alone would have
    linked her name to a stranger. Hence the `*_self` flags: a surface
    resolves only when it matches exactly one person AND that person is this
    one.

    Every argument here is the string this function will EMIT, or a count
    taken against that same string — see the note above PEOPLE_SQL.
    """
    forms = []
    if len(s_full) >= MIN_SURFACE_CHARS:
        unique = full_n == 1 and full_self
        forms.append(form(
            s_full, unique,
            "full name, unique among public figures" if unique else
            (f"full name shared with {max(full_n - 1, 0)} other public "
             "figure(s) — anchor only") if full_self else
            "full name does not fold to this person — anchor only", slug))
    two = f"{tok_first} {tok_last}".strip()
    # ⚠️ `tok_first != tok_last` is the SINGLE-TOKEN guard, and it is not
    # covered by the `two != s_full` test beside it: a one-word name folds
    # both tokens onto itself, so the two-part form comes out as „Мадона
    # Мадона" — a surface nobody writes, differing from the full name and so
    # passing every other check.
    if tok_first and tok_last and tok_first != tok_last \
            and two.casefold() != s_full.casefold() \
            and len(two) >= MIN_SURFACE_CHARS:
        unique = two_n == 1 and two_self
        forms.append(form(
            two, unique,
            "given+family, unique among public figures" if unique else
            (f"given+family shared with {max(two_n - 1, 0)} other public "
             "figure(s) — anchor only") if two_self else
            (f"given+family matches {two_n} other public figure(s) and not "
             "this one — anchor only"), slug))
    if tok_last and len(tok_last) >= MIN_SURFACE_CHARS \
            and tok_last.casefold() != s_full.casefold():
        # ⚠️ NEVER resolvable, whatever the count. See the module docstring:
        # „Иванов" is 1,554 public figures. This exists so in-document
        # coreference can attach a later „Пеевски" to an earlier „Делян
        # Пеевски" — a fact about the document, not a guess about the country.
        forms.append(form(
            tok_last, False,
            f"surname alone — {sur_n} public figure(s) share it; coreference "
            "anchor only, never a standalone match"))
    return forms


PEOPLE_SQL = """
with roster as (
    select distinct on (p.person_id)
        p.person_id, p.slug, p.display_name, p.name_fold,
        p.given_fold, p.family_fold,
        case
            when pr.source = 'mp' then 'mp'
            when pr.role in ('cabinet', 'political_cabinet') then 'cabinet'
            when pr.role = 'deputy_minister' then 'deputy_minister'
            when pr.role = 'regional_governor' then 'regional_governor'
            when pr.role = 'mayor' then 'mayor'
        end as tier,
        pr.party
    from person_role pr
    join person p using (person_id)
    where p.status = 'active' and p.is_public_figure
      and (
        (pr.source = 'mp' and split_part(pr.ref, ':', 2) = :'ns')
        or (pr.source = 'official_exec'
            and pr.role in ('cabinet', 'political_cabinet', 'deputy_minister',
                            'regional_governor')
            and pr.end_date is null)
        or (pr.source = 'official_muni' and pr.role = 'mayor'
            and pr.end_date is null)
      )
    -- ⚠️ DETERMINISTIC. The artifact is committed, so a tie broken by heap
    -- order would churn the file on every rebuild. person_id is the tiebreak
    -- of last resort; an MP who is also a former deputy minister is one entry
    -- and stays on the `mp` tier across runs.
    order by p.person_id,
             case when pr.source = 'mp' then 0 else 1 end,
             pr.role, pr.ref
), surfaced as (
    select r.*,
           btrim(regexp_replace(r.display_name, '\\s+', ' ', 'g')) as s_full,
           split_part(btrim(regexp_replace(r.display_name, '\\s+', ' ', 'g')),
                      ' ', 1) as tok_first,
           reverse(split_part(reverse(btrim(
               regexp_replace(r.display_name, '\\s+', ' ', 'g'))),
               ' ', 1)) as tok_last
    from roster r
)
select s.person_id, s.slug, s.display_name, s.tier, s.party,
       s.s_full, s.tok_first, s.tok_last,
       (select count(*) from person p1
        where p1.status = 'active' and p1.is_public_figure
          and p1.name_fold = translit_bg_latin(s.s_full)) as full_n,
       (translit_bg_latin(s.s_full) = s.name_fold) as full_self,
       (select count(*) from person p2
        where p2.status = 'active' and p2.is_public_figure
          and p2.given_fold = translit_bg_latin(s.tok_first)
          and p2.family_fold = translit_bg_latin(s.tok_last)) as two_n,
       (translit_bg_latin(s.tok_first) = s.given_fold
        and translit_bg_latin(s.tok_last) = s.family_fold) as two_self,
       (select count(*) from person p3
        where p3.status = 'active' and p3.is_public_figure
          and p3.family_fold = translit_bg_latin(s.tok_last)) as sur_n
from surfaced s
where s.tier is not null
order by s.slug
"""


def build_people(ns: str) -> tuple[list, dict]:
    return people_entries(query(PEOPLE_SQL, {"ns": ns}), ns)


def people_entries(rows: list, ns: str) -> tuple[list, dict]:
    """Pure — see the note on place_entries."""
    entries = []
    anchors_only = 0
    for r in rows:
        slug, name = r["slug"], r["display_name"]
        tier, party = r["tier"], r["party"]
        forms = person_forms(slug, r["s_full"], r["tok_first"], r["tok_last"],
                             r["full_n"], r["full_self"],
                             r["two_n"], r["two_self"], r["sur_n"])
        if not any(f["resolvable"] for f in forms):
            # ⚠️ COUNTED, not dropped. A person whose every form is ambiguous
            # still belongs in the roster: coreference can reach them, and the
            # count is the honest measure of how far names get us.
            anchors_only += 1
        entries.append({
            "kind": "person",
            # ⚠️ Present only when SOME form earned it. Kept for roster review
            # („which of these people can we never match?") and deliberately
            # NOT the thing a resolver reads — that is `form.id`.
            "id": slug if any(f["resolvable"] for f in forms) else None,
            "canonical": name, "tier": tier, "party": party, "forms": forms,
        })
    by_tier: dict[str, int] = {}
    for e in entries:
        by_tier[e["tier"]] = by_tier.get(e["tier"], 0) + 1
    return entries, {
        "people": len(entries),
        "people_with_no_resolvable_form": anchors_only,
        "people_by_tier": by_tier,
        "ns": ns,
        # ⚠️⚠️ THE TIERS ARE NOT A CLAIM ABOUT WHO HOLDS OFFICE TODAY, and
        # the numbers make that obvious once stated: the roster carries 229
        # „regional_governor" rows against Bulgaria's 28 oblasti. The test is
        # `end_date IS NULL`, which in this corpus means „no end date was
        # recorded", not „still serving" — 2,495 of 9,842 official_exec roles
        # carry one at all.
        #
        # That is fine for what this file is FOR: it decides whether a NAME
        # identifies one public figure, and a former governor is exactly as
        # identifiable as a sitting one. It would not be fine for a surface
        # captioned „министър" — the person page is where currency is
        # established, and the id points there.
        "tiers_mean": "held this kind of office; NOT current — end_date IS "
                      "NULL means no end date recorded",
    }


def build_institutions() -> tuple[list, dict]:
    return institution_entries(query("""
        select eik, name, contracts
        from awarder_search
        where contracts >= :'min'::int and char_length(name) >= :'chars'::int
        order by name
    """, {"min": MIN_AWARDER_CONTRACTS, "chars": MIN_SURFACE_CHARS}))


def institution_entries(rows: list) -> tuple[list, dict]:
    """Group awarder rows into entries. Pure — see the note on build_places."""
    # ⚠️ FOLDED, and case-sensitive grouping was a live defect: the corpus
    # holds 1,511 case-variant groups and six of them span different EIKs, so
    # „В И К ООД" and „В и К ООД" were two entries each claiming a resolvable
    # id for the same name. The refusal logic was already right — only the
    # key was wrong, which is why it looked correct in review.
    by_name: dict[str, list] = {}
    canonical: dict[str, str] = {}
    for r in rows:
        name = " ".join(r["name"].split())
        key = name.casefold()
        by_name.setdefault(key, []).append((r["eik"], r["contracts"]))
        # The spelling shown is the busiest holder's, deterministically.
        if key not in canonical or r["contracts"] > canonical[key][1]:
            canonical[key] = (name, r["contracts"])
    entries = []
    ambiguous = 0
    for key, holders in sorted(by_name.items()):
        name = canonical[key][0]
        # ⚠️ ONE NAME, SEVERAL EIKs happens — municipal schools reuse a
        # patron's name across towns. Refused rather than resolved to the
        # busiest, which is the rank-picking the whole tier forbids.
        unique = len({e for e, _ in holders}) == 1
        if not unique:
            ambiguous += 1
        entries.append({
            "kind": "institution",
            "id": holders[0][0] if unique else None,
            "canonical": name,
            "forms": [form(
                name, unique,
                "unique awarder name" if unique else
                f"{len(holders)} bodies share this name — anchor only",
                holders[0][0])],
        })
    return entries, {"institutions": len(entries),
                     "institutions_ambiguous": ambiguous}


def build_places() -> tuple[list, dict]:
    return place_entries(query("""
        select kind, code, name_bg,
               count(*) over (partition by name_bg) as homonyms
        from place_dim
        where char_length(name_bg) >= :'chars'::int
        order by name_bg, code
    """, {"chars": MIN_SURFACE_CHARS}))


def place_entries(rows: list) -> tuple[list, dict]:
    """Turn place_dim rows into entries.

    ⚠️ PURE, and separated from its query deliberately. With the rules inline
    the only way to reach them was through `psql`, so the tests fell back to
    reading the COMMITTED artifact — and mutating the builder then changes
    nothing a test can see. Measured on the first cut: 5 of 9 mutations
    survived for exactly that reason.
    """
    entries = []
    stopped = ambiguous = 0
    for r in rows:
        kind, code, name = r["kind"], r["code"], r["name_bg"]
        homonyms = r["homonyms"]
        low = name.casefold()
        if low in PLACE_STOPWORDS:
            # ⚠️ „Победа" is a village AND the word victory. Dropped at build
            # time rather than filtered by the resolver, so the omission is
            # visible in the artifact's own coverage block.
            stopped += 1
            continue
        unique = homonyms == 1
        if not unique:
            ambiguous += 1
        entries.append({
            "kind": "place",
            # ⚠️ KIND-QUALIFIED. `place_dim.code` is unique per (kind, code)
            # and NOT on its own: `AF` is both an obshtina and a settlement,
            # `BGS` both a mir and an oblast. A bare code sends a consumer to
            # whichever table it happened to look in.
            "id": f"{kind}:{code}" if unique else None,
            "canonical": name, "place_kind": kind,
            "forms": [form(
                name, unique,
                "unique place name" if unique else
                f"{homonyms} places share this name — anchor only",
                f"{kind}:{code}")],
        })
    return entries, {"places": len(entries), "places_stopworded": stopped,
                     "places_ambiguous": ambiguous}


def build_parties() -> tuple[list, dict]:
    src = ROOT / "data" / "canonical_parties.json"
    if not src.exists():
        return [], {"parties": 0, "parties_source": "absent"}
    return party_entries(json.loads(src.read_text(encoding="utf-8")))


def party_entries(doc: dict) -> tuple[list, dict]:
    """Pure — see the note on place_entries."""

    # ⚠️ TWO PASSES, and the single-pass version was a live defect. Claiming
    # each surface with `setdefault` awards it to whichever party
    # canonical_parties.json happens to list FIRST — so six contested
    # surfaces shipped resolvable ids, and re-sorting that file would have
    # silently moved them to a different party. A surface claimed by two
    # parties must resolve to NEITHER, which can only be known after every
    # party has been read. Coalition names are reused across cycles, so this
    # is the ordinary case rather than an edge one.
    claims: dict[str, set] = {}
    parties = []
    for party in doc.get("parties") or []:
        pid = str(party.get("id") or "").strip()
        display = (party.get("displayName") or "").strip()
        if not pid or not display:
            continue
        surfaces = {display}
        for h in party.get("history") or []:
            for key in ("nickName", "name"):
                val = (h.get(key) or "").strip()
                if val:
                    surfaces.add(val)
        surfaces = {x for x in surfaces if len(x) >= MIN_SURFACE_CHARS}
        parties.append((pid, display, surfaces))
        for x in surfaces:
            claims.setdefault(x.casefold(), set()).add(pid)

    entries = []
    contested = 0
    for pid, display, surfaces in parties:
        forms = []
        for x in sorted(surfaces):
            holders = claims[x.casefold()]
            unique = len(holders) == 1
            if not unique:
                contested += 1
            forms.append(form(
                x, unique, "party name" if unique else
                f"surface claimed by {len(holders)} parties — anchor only",
                pid))
        if forms:
            entries.append({
                "kind": "party",
                "id": pid if any(f["resolvable"] for f in forms) else None,
                "canonical": display, "forms": forms})
    return entries, {"parties": len(entries),
                     "party_forms_contested": contested}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true",
                    help="one JSON object on stdout (default: human summary)")
    ap.add_argument("--ns", default="52",
                    help="National Assembly whose MPs form the roster")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    coverage: dict = {}
    entries: list = []
    try:
        for build, arg in ((build_people, args.ns),
                           (build_institutions, None),
                           (build_places, None)):
            rows, cov = build(arg) if arg is not None else build()
            entries.extend(rows)
            coverage.update(cov)
    except NoDatabase as exc:
        # ⚠️ Exit 0 and write NOTHING. A partial gazetteer is worse than none:
        # its coverage block would report the buckets it managed, and a
        # resolver reading it would refuse every person as „not in gazetteer"
        # while looking perfectly healthy.
        out = {"skipped": str(exc), "written": None}
        print(json.dumps(out) if args.json else
              f"skipped: {exc} — no gazetteer written")
        return 0

    rows, cov = build_parties()
    entries.extend(rows)
    coverage.update(cov)

    resolvable = sum(1 for e in entries
                     for f in e["forms"] if f["resolvable"])
    coverage["forms_total"] = sum(len(e["forms"]) for e in entries)
    coverage["forms_resolvable"] = resolvable
    # ⚠️ Companies are deliberately absent, and the absence is RECORDED so a
    # consumer cannot read "no company entries" as "no companies matched".
    # 1.02M tr_companies rows cannot be matched by name; a company resolves
    # only on an explicit EIK in the text.
    coverage["companies"] = 0
    coverage["companies_excluded_because"] = (
        "1.02M registry names cannot be matched by name without inventing "
        "matches; a company resolves only on an explicit EIK in the text")

    # ⚠️ Asserted here, not only in a test: this file is the artifact, and a
    # violation means an id is sitting on a form nobody may follow. Cheap
    # enough to run on every build, and a build that cannot uphold it must
    # not write.
    leaks = [(e["canonical"], f["surface"]) for e in entries
             for f in e["forms"] if not f["resolvable"] and f["id"]]
    if leaks:
        raise RuntimeError(
            f"{len(leaks)} refused form(s) carry an id — e.g. {leaks[:3]}")

    doc = {"version": GAZETTEER_VERSION, "generated_at": now_iso(),
           "coverage": coverage, "entries": entries}
    dest = Path(args.out) if args.out else OUT
    dest.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ ONE ENTRY PER LINE, not pretty-printed and not one long line. This
    # file is COMMITTED — the standalone analysis box has no Postgres and
    # cannot rebuild it — so its diff is read by humans. `indent=1` made it
    # 4.4 MB and a one-word change a 20-line diff; a single line makes every
    # change the whole file. Per-line entries keep both the size and the diff
    # proportional to what actually moved.
    head = json.dumps({k: doc[k] for k in ("version", "generated_at",
                                           "coverage")},
                      ensure_ascii=False, indent=1)
    body = ",\n ".join(json.dumps(e, ensure_ascii=False, sort_keys=True)
                       for e in doc["entries"])
    dest.write_text(head[:-2] + ',\n "entries": [\n ' + body + '\n ]\n}\n',
                    encoding="utf-8")
    # Re-read to prove we wrote parseable JSON — hand-assembling it is the
    # price of a readable diff, and an unparseable gazetteer would only be
    # discovered by the resolver, one step later and with a worse message.
    reparsed = json.loads(dest.read_text(encoding="utf-8"))
    if len(reparsed["entries"]) != len(doc["entries"]):
        raise RuntimeError("gazetteer round-trip lost entries")

    result = {"out": str(dest), "entries": len(entries), **coverage,
              "bytes": dest.stat().st_size}
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        for k, v in result.items():
            print(f"{k:38} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
