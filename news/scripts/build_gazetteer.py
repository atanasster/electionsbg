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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])
OUT = ROOT / "news" / "data" / "gazetteer.json"
GAZETTEER_VERSION = 1

# Three queries over indexed tables; slower than this is a hung
# connection rather than a big corpus.
QUERY_TIMEOUT_SECONDS = 300

# ⚠️ IMPORTED, not restated. The first cut wrote the pattern out a second
# time and an escaping slip turned `[^\W\d_]` into `[^\\W\\d_]` — a class
# matching a literal backslash. It did not fail: the scan found 163 words
# instead of thousands, the filter silently did nothing, and the gazetteer
# built cleanly with „места" still resolvable. A word counted here has to be
# a word the resolver would have matched, and one definition is the only way
# to guarantee that.
from resolve_mentions import TOKEN_RE  # noqa: E402

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

# ⚠️⚠️ A ONE-WORD SURFACE THAT IS ALSO AN ORDINARY BULGARIAN WORD IS THE
# DOMINANT FALSE MATCH, and no length or kind rule separates them. Measured
# over 400 analysed articles before this filter existed: 87% of all mentions
# were places, and the frequent ones included „места", „било", „подкрепа",
# „река", „водата" — every one a real village AND a word a newsroom writes
# constantly. „места" resolved as `gazetteer_exact` to a village, from an
# article about parking.
#
# The corpus settles it empirically. Counting how often each token appears
# LOWERCASE mid-sentence across 1,199 articles gives a clean separation with
# no overlap at all:
#
#     места 204 · подкрепа 225 · било 149 · крайна 75 · река 63 · водата 51
#     София 0 · Пловдив 0 · Варна 0 · Русе 0 · Бургас 0 · Айтос 0 · Германия 0
#
# So the rule is: a ONE-WORD surface whose lowercase form occurs at least
# COMMON_WORD_MIN times in the news corpus may not resolve. It applies to
# every kind, not just places — „Възраждане" is a party and a word.
#
# ⚠️ The list is a COMMITTED ARTIFACT (news/data/common_words.json) rather
# than a live corpus scan, because news/data/<domain>/ is gitignored: on a
# fresh clone a live scan finds nothing, the filter silently does not fire,
# and „места" comes back as a village with every count reconciling. The
# builder REFUSES to write when the file is absent.
COMMON_WORDS_FILE = "common_words.json"
COMMON_WORD_MIN = 5

# Below this the scan found no corpus worth calling one.
COMMON_WORDS_MIN_ARTICLES = 200

# ⚠️ A ONE-WORD PLACE THAT IS ALSO A COMMON GIVEN NAME is the second false
# class, and the corpus frequency list cannot see it: „Владимир" is a village
# AND 942 people's first name, and it never appears lowercase, so it sails
# through. 54 one-word places collide with a given name held by 50+ people —
# „Красимир", „Елена", „Ивайло", „Росица". A sentence naming a person then
# links to a village.
#
# The threshold is deliberately generous. A name held by fewer than this is
# rare enough that the place reading is the likelier one, and refusing it
# would delete real villages for nothing.
GIVEN_NAME_MIN_BEARERS = 50

# ⚠️ CURATED, and small on purpose. The given-name filter is right about 53 of
# its 54 collisions — „Красимир", „Ивайло", „Росица", „Зорница" are villages
# and a newsroom writing one of those words means the person. It is wrong
# about exactly one: София is the capital, and 121 public figures share the
# name. Refusing it is the safe direction (a lost link, never a wrong one)
# but it costs the most-mentioned place in the corpus, 51 occurrences in 400
# articles.
#
# No derived signal separates it. Obshtina population does not: the villages
# in the collision list sit inside obshtini of 45k–113k people, well above
# most oblast centres. The administrative hierarchy does not either — Sofia's
# oblast is „София (столица)", a different string, so the multi-level collapse
# that rescues Пловдив and Варна never fires here.
#
# So this is a hand-written exemption of one, with its reason attached, rather
# than a threshold tuned until Sofia passes. A future entry needs the same
# test: is this place what a Bulgarian newsroom means by the bare word, so
# overwhelmingly that a person of that name is the surprising reading?
GIVEN_NAME_EXEMPT = frozenset({"софия"})

# ⚠️ KNOWN RESIDUE, recorded rather than hidden: „Левски" is a town, a
# football club and Васил Левски. It is refused here only because four
# villages share the name — a surname or institution collision on a
# UNIQUELY-named place would still get through. That is a proper-noun
# ambiguity, which needs the model pass rather than a frequency list.

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


def fold_bg(text: str) -> str:
    """Lookup key for a one-word surface. Case only — see below."""
    return text.casefold()


def given_name_places() -> frozenset:
    """Place names that are also a given name many Bulgarians bear.

    ⚠️ THE JOIN HAPPENS IN SQL, and that is not laziness. `person.given_fold`
    is `translit_bg_latin(...)` — a LATIN transliteration — so a Python-side
    casefold of „Владимир" can never equal „vladimir". Reimplementing that
    function here is the drift this repo already documents at length
    (`gen:shlyo-sql` exists for the same reason). Postgres has it; we ask
    Postgres, and get back plain Bulgarian names to compare by case alone.
    """
    rows = query("""
        with names as (
            select given_fold as g
            from person where status = 'active'
            group by 1 having count(*) >= :'min'::int
        )
        select distinct p.name_bg
        from place_dim p
        join names n on n.g = translit_bg_latin(p.name_bg)
        where p.name_bg !~ ' ' and char_length(p.name_bg) >= :'chars'::int
    """, {"min": GIVEN_NAME_MIN_BEARERS, "chars": MIN_SURFACE_CHARS})
    return frozenset(r["name_bg"].casefold() for r in rows)


def scan_common_words(data_dir: Path, min_count: int = COMMON_WORD_MIN) -> dict:
    """Tokens the news corpus writes in lowercase — i.e. ordinary words.

    ⚠️ LOWERCASE ONLY, and that is the whole discriminator. A capitalised
    „Места" is ambiguous between a village and a sentence-initial common
    noun; a lowercase „места" can only be the word.
    """
    counts: dict[str, int] = {}
    articles = 0
    for path in sorted(data_dir.glob("*/*.json")):
        if path.parent.name.startswith("_"):
            continue
        try:
            rec = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        body = rec.get("content") or ""
        if not body:
            continue
        articles += 1
        for m in TOKEN_RE.finditer(body):
            tok = m.group()
            if tok[:1].islower():
                counts[tok] = counts.get(tok, 0) + 1
    return {
        "generated_at": now_iso(),
        "articles_scanned": articles,
        "min_count": min_count,
        "words": sorted(w for w, n in counts.items() if n >= min_count),
    }


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


# Populated once by main(). ⚠️ A module global rather than a parameter
# threaded through five builders, because the alternative is five call sites
# that can each forget it — and forgetting it does not fail, it republishes
# „места" as a village.
COMMON_WORDS: frozenset = frozenset()
COMMON_GIVEN_NAMES: frozenset = frozenset()


def is_common_given_name(surface: str) -> bool:
    """One token, and it is a first name a lot of Bulgarians have.

    ⚠️ Folded through the same translit the DB uses, and ONE-WORD only — for
    the same reason as is_common_word: „Свети Влас" contains no given name,
    and „Елена" is both a town and 895 people.
    """
    parts = surface.split()
    if len(parts) != 1:
        return False
    key = fold_bg(parts[0])
    return key in COMMON_GIVEN_NAMES and key not in GIVEN_NAME_EXEMPT


def is_common_word(surface: str) -> bool:
    """One token, and the corpus writes it in lowercase. See COMMON_WORDS_FILE.

    ⚠️ ONE-WORD ONLY. „Стара Загора" contains „стара", an ordinary adjective,
    and is not remotely ambiguous; filtering multi-word surfaces on their
    parts would delete most of the real place names in the country.
    """
    parts = surface.split()
    return len(parts) == 1 and parts[0].casefold() in COMMON_WORDS


# How strong the surface itself is as evidence of identity.
#
# ⚠️⚠️ THIS IS NOT DECORATION, and the measurement is why: 464 of 468 person
# links in the reciprocal index (99.1%) rest on a TWO-PART match, and only 4
# on a full three-part name. Bulgarian newsrooms write two parts while the
# identity layer stores three, so „unique among OUR public figures" is the
# only test a two-part form can pass — and it says nothing about whether the
# person the article means is in our layer at all. „проф. Николай Витанов",
# interviewed 50 times by Поглед.инфо, matches a deputy minister of that name
# and may well be somebody else entirely.
#
# The links are kept, because dropping them deletes 99% of the feature and
# hides the finding. They are LABELLED, so a page can say „a person of this
# name" where that is all we know, and no consumer can render a two-part
# match as an identity claim without having seen this field.
FORM_KINDS = ("full_name", "two_part", "surname", "name")


def form(surface: str, resolvable: bool, why: str,
         ident: str | None = None, kind: str | None = None,
         form_kind: str = "name") -> dict:
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
    # ⚠️ COMPUTED WHETHER OR NOT THE FORM STILL RESOLVES. Gated on
    # `resolvable`, a form the caller had ALREADY refused (as an ambiguity)
    # never received a reason code — 99 shipped forms are ordinary Bulgarian
    # words carrying none, so the resolver could not tell them from review
    # candidates and put them back in the queue.
    refusal = None
    if kind == "place" and is_common_given_name(surface):
        # ⚠️ PLACES ONLY. A PERSON surface being a given name is the whole
        # point of a person surface; applying this to every kind would refuse
        # „Елена Йончева" — no, that is two words — but it would certainly
        # refuse a party or institution legitimately named after somebody.
        refusal = "given_name"
        # ⚠️ The caller's `why` is kept when it had ALREADY refused — „4
        # distinct places share this name" is a more useful thing to read
        # than „is a given name", and overwriting it loses the ambiguity.
        if resolvable:
            why = (f"„{surface}\u201c is a given name borne by many "
                   "Bulgarians — anchor only; a person named here would "
                   "otherwise link to a village")
        resolvable = False
    if is_common_word(surface):
        # ⚠️ Refused HERE rather than at each call site, so a new kind cannot
        # be added without the filter. The anchor is kept: „Места" really is a
        # village, and a document that establishes the place some other way
        # can still corefer to it.
        refusal = "common_word"
        if resolvable:
            why = (f"„{surface}" + "\u201c is an ordinary Bulgarian word in "
                   "this corpus — anchor only; a one-word common noun cannot "
                   "be told from the place that shares its name")
        resolvable = False
    assert form_kind in FORM_KINDS, form_kind
    return {
        "surface": surface,
        "resolvable": resolvable,
        "form_kind": form_kind,
        "id": ident if resolvable else None,
        # ⚠️ WHAT THIS ANCHOR ANCHORS TO — and it is deliberately NOT `id`.
        # `id` means „you may link this"; `anchor_for` means „if this DOCUMENT
        # independently resolved that entry, this surface refers to it".
        # Without it a refused form is untraceable, so in-document
        # coreference — the whole reason bare surnames are kept — could not
        # be performed at all: „Пеевски" in ¶4 had nothing tying it to the
        # „Делян Пеевски" the same article resolved in ¶1.
        **({} if resolvable else {"anchor_for": ident}),
        # ⚠️ MACHINE-READABLE, because the consumer has to act on it and
        # `why` is prose. „войници", „места", „река" are refused as ordinary
        # words — KNOWN NON-ENTITIES — and emitting them as unresolved
        # mentions filled the roster-review queue with 583 of them, 171
        # distinct, almost all noise. An ambiguity is a review candidate; a
        # common noun is not.
        **({} if refusal is None else {"refusal": refusal}),
        "why": why,
    }


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
            "full name does not fold to this person — anchor only", slug,
            None, "full_name"))
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
             "this one — anchor only"), slug, None, "two_part"))
    if tok_last and len(tok_last) >= MIN_SURFACE_CHARS \
            and tok_last.casefold() != s_full.casefold():
        # ⚠️ NEVER resolvable, whatever the count. See the module docstring:
        # „Иванов" is 1,554 public figures. This exists so in-document
        # coreference can attach a later „Пеевски" to an earlier „Делян
        # Пеевски" — a fact about the document, not a guess about the country.
        forms.append(form(
            tok_last, False,
            f"surname alone — {sur_n} public figure(s) share it; coreference "
            "anchor only, never a standalone match", slug, None, "surname"))
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
        select a.eik, a.name, a.contracts,
               -- ⚠️⚠️ HOW MANY DIFFERENT INSTITUTIONS SHARE THIS EIK. The
               -- rule below asked „is this NAME unique to one EIK" and never
               -- the reverse — so „Софийска градска прокуратура" resolved to
               -- EIK 121817309 and sent the reader to a page titled
               -- „Прокуратура на република българия" seated in Благоевград.
               -- That EIK is the ENTIRE prosecution service: 179 district and
               -- regional offices share one legal entity. 72 EIKs carry more
               -- than five names and the worst carries 190.
               (select count(distinct lower(regexp_replace(b.name, '\\s+', ' ', 'g')))
                from awarder_search b where b.eik = a.eik) as names_on_eik
        from awarder_search a
        where a.contracts >= :'min'::int
          and char_length(a.name) >= :'chars'::int
        order by a.name
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
    umbrella: dict[str, int] = {}
    for r in rows:
        name = " ".join(r["name"].split())
        key = name.casefold()
        by_name.setdefault(key, []).append((r["eik"], r["contracts"]))
        umbrella[r["eik"]] = max(umbrella.get(r["eik"], 0),
                                 int(r.get("names_on_eik") or 1))
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
        # ⚠️⚠️ TWO QUESTIONS, and the first cut asked only one. „Is this NAME
        # unique to one EIK" is not „does this EIK STAND FOR this name": EIK
        # 121817309 is the whole prosecution service, so „Софийска градска
        # прокуратура" resolved to it and the reader landed on a page titled
        # „Прокуратура на република българия", seated in Благоевград. 72 EIKs
        # carry more than five names and the worst carries 190 — the social
        # assistance agency, the state forestry enterprises, the prosecution.
        #
        # A name that maps to an umbrella EIK does not identify its
        # institution; it identifies a legal wrapper around dozens of them.
        eiks = {e for e, _ in holders}
        shared = max((umbrella.get(e, 1) for e in eiks), default=1)
        unique = len(eiks) == 1 and shared == 1
        if not unique:
            ambiguous += 1
        forms = [form(
            name, unique,
            "unique awarder name" if unique else
            f"{len(holders)} bodies share this name — anchor only"
            if len(eiks) > 1 else
            f"EIK {sorted(eiks)[0]} covers {shared} differently-named bodies "
            "— it is a legal umbrella, not this institution — anchor only",
            holders[0][0], "institution")]
        entries.append({
            "kind": "institution",
            # ⚠️ CONDITIONAL on the FORM, not on `unique`. `form()` refuses a
            # one-word common noun on its own — „Чистота" is a municipal
            # cleaning company and the word cleanliness — so an id set from
            # `unique` alone advertises a link the form will not honour.
            "id": holders[0][0] if forms[0]["resolvable"] else None,
            "canonical": name,
            "forms": forms,
        })
    return entries, {"institutions": len(entries),
                     "institutions_ambiguous": ambiguous}


def build_places() -> tuple[list, dict]:
    return place_entries(query("""
        select kind, code, name_bg,
               -- ⚠️ The hierarchy, normalised so an OBLAST row (whose
               -- oblast_code is NULL because it IS the oblast) compares
               -- equal to the settlement inside it.
               case when kind = 'oblast' then code else oblast_code end as obl,
               case when kind = 'obshtina' then code
                    else obshtina_code end as obs
        from place_dim
        where char_length(name_bg) >= :'chars'::int
        order by name_bg, kind, code
    """, {"chars": MIN_SURFACE_CHARS}))


# Most specific first. „Пловдив" in a news article means the CITY, not the
# oblast — and a reader following the link expects the place they read about.
PLACE_SPECIFICITY = {"settlement": 0, "obshtina": 1, "oblast": 2, "mir": 3}


def place_entries(rows: list) -> tuple[list, dict]:
    """Turn place_dim rows into entries.

    ⚠️ PURE, and separated from its query deliberately. With the rules inline
    the only way to reach them was through `psql`, so the tests fell back to
    reading the COMMITTED artifact — and mutating the builder then changes
    nothing a test can see. Measured on the first cut: 5 of 9 mutations
    survived for exactly that reason.

    ⚠️⚠️ SAME NAME ≠ DIFFERENT PLACE. „Пловдив" is a settlement, an obshtina
    and an oblast — three rows, one city — and counting rows called it a
    3-way ambiguity and refused to link it, along with Варна, Русе, Бургас
    and 211 other groups. Meanwhile „Левски" really is three different
    villages in three oblasti and must stay refused. The two are separated by
    the HIERARCHY, not by the count: rows that agree on their oblast and on
    their (non-null) obshtina are one place seen at several levels, and the
    most specific of them is what a reader means.
    """
    by_name: dict[str, list] = {}
    for r in rows:
        by_name.setdefault(r["name_bg"], []).append(r)

    entries = []
    stopped = ambiguous = collapsed = 0
    for name, group in sorted(by_name.items()):
        low = name.casefold()
        if low in PLACE_STOPWORDS:
            # ⚠️ „Победа" is a village AND the word victory. Dropped at build
            # time rather than filtered by the resolver, so the omission is
            # visible in the artifact's own coverage block.
            stopped += len(group)
            continue
        obls = {r["obl"] for r in group if r["obl"]}
        obss = {r["obs"] for r in group if r["obs"]}
        one_place = len(obls) <= 1 and len(obss) <= 1
        if one_place:
            if len(group) > 1:
                collapsed += 1
            pick = min(group,
                       key=lambda r: (PLACE_SPECIFICITY.get(r["kind"], 9),
                                      r["code"]))
            pid = f"{pick['kind']}:{pick['code']}"
            forms = [form(name, True,
                          "unique place" if len(group) == 1 else
                          f"one place at {len(group)} administrative levels; "
                          "linked to the most specific", pid, "place")]
            entries.append({
                "kind": "place",
                # ⚠️ CONDITIONAL, like every other kind. `form()` can refuse
                # this surface on its own (a common word, or a given name many
                # Bulgarians bear), and an entry id set before that check
                # advertises a link the only form on it will not honour —
                # which the artifact gate caught on 53 places.
                "id": pid if forms[0]["resolvable"] else None,
                "canonical": name, "place_kind": pick["kind"],
                "forms": forms,
            })
            continue
        # Genuinely different places sharing a name — refused, all of them.
        for r in group:
            ambiguous += 1
            entries.append({
                "kind": "place",
                # ⚠️ KIND-QUALIFIED. `place_dim.code` is unique per
                # (kind, code) and NOT on its own: `AF` is both an obshtina
                # and a settlement, `BGS` both a mir and an oblast.
                "id": None, "canonical": name, "place_kind": r["kind"],
                "forms": [form(
                    name, False,
                    f"{len(group)} distinct places share this name — "
                    "anchor only", f"{r['kind']}:{r['code']}")],
            })
    return entries, {"places": len(entries), "places_stopworded": stopped,
                     "places_ambiguous": ambiguous,
                     "places_collapsed_to_one": collapsed}


def build_aliases() -> tuple[list, dict]:
    """The hand-verified abbreviation crosswalk.

    ⚠️⚠️ A CURATED ENTRY SIDESTEPS EVERY HEURISTIC IN THIS FILE, on purpose.
    „МВР" and „КПКОНПИ" are in the corpus as EIKs and as no surface at all —
    the registry holds „Министерство на вътрешните работи" — so no length
    floor, no folded match and no umbrella rule could ever have reached them.
    What makes the link safe is not a rule but a person having checked, and
    the file records what they checked (see `evidence` on each entry).

    ⚠️ MIN_SURFACE_CHARS DOES NOT APPLY. „МВР" is three characters, which the
    floor exists to exclude — because in FREE TEXT a three-letter token is
    noise. Here the string arrives already classified by the model as an
    institution and matched against a hand-verified list of seven, so the
    floor is answering a question that is not being asked.
    """
    src = ROOT / "news" / "data" / "institution_aliases.json"
    if not src.exists():
        return [], {"aliases": 0, "aliases_source": "absent"}
    doc = json.loads(src.read_text(encoding="utf-8"))
    entries = []
    for a in doc.get("aliases") or []:
        alias, eik = (a.get("alias") or "").strip(), (a.get("eik") or "").strip()
        if not alias or not eik:
            continue
        entries.append({
            "kind": "institution", "id": eik,
            "canonical": a.get("display") or alias,
            "forms": [form(alias, True,
                           "hand-verified abbreviation — "
                           + (a.get("evidence") or "")[:160],
                           eik, "institution", "name")],
        })
    return entries, {
        "aliases": len(entries),
        "aliases_verified_on": doc.get("verified_on"),
        # ⚠️ The refusals are published too. „КЗК is not linked" must be
        # readable as a decision with a reason, not as an oversight.
        "aliases_refused": [r.get("alias") for r in doc.get("refused") or []],
    }


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
    ap.add_argument("--rebuild-common-words", action="store_true",
                    help="rescan the news corpus for ordinary words first "
                         "(needs news/data/<domain>/, which is gitignored)")
    ap.add_argument("--allow-word-shrink", action="store_true",
                    help="permit the common-word list to more than halve")
    args = ap.parse_args()

    global COMMON_WORDS
    words_path = ROOT / "news" / "data" / COMMON_WORDS_FILE
    if args.rebuild_common_words:
        doc = scan_common_words(ROOT / "news" / "data")
        # ⚠️⚠️ REFUSE RATHER THAN OVERWRITE. news/data/<domain>/ is
        # gitignored, so on any machine without the corpus this scan returns
        # `words: []` — and writing that CLOBBERS the committed 21,943-word
        # artifact, after which the `exists()` guard below is satisfied, the
        # filter silently does nothing, and „Места" is a resolvable village
        # again at exit 0. The floor is deliberately crude: the question is
        # „did a corpus exist", not „is this the best corpus".
        if doc["articles_scanned"] < COMMON_WORDS_MIN_ARTICLES:
            print(f"only {doc['articles_scanned']} articles found under "
                  f"{ROOT / 'news' / 'data'} — refusing to overwrite "
                  f"{words_path} with a near-empty word list. The corpus is "
                  "gitignored; run this where it exists.", file=sys.stderr)
            return 2
        if words_path.exists():
            prev = json.loads(words_path.read_text(encoding="utf-8"))
            before = len(prev.get("words") or ())
            if before and len(doc["words"]) < before * 0.5:
                print(f"the word list would shrink {before} → "
                      f"{len(doc['words'])} — refusing. Pass "
                      "--allow-word-shrink if the corpus really did.",
                      file=sys.stderr)
                if not args.allow_word_shrink:
                    return 2
        words_path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"wrote {words_path} — {len(doc['words'])} words from "
              f"{doc['articles_scanned']} articles", file=sys.stderr)
    if not words_path.exists():
        # ⚠️ REFUSE. Building without the filter does not fail — it publishes
        # „места", „река" and „водата" as resolvable villages, and every count
        # in the coverage block still reconciles.
        print(f"{words_path} is absent — refusing to build a gazetteer with "
              "the common-word filter disabled. Run with "
              "--rebuild-common-words on a machine that has the news corpus.",
              file=sys.stderr)
        return 2
    words_doc = json.loads(words_path.read_text(encoding="utf-8"))
    COMMON_WORDS = frozenset(words_doc.get("words") or ())

    coverage: dict = {}
    entries: list = []
    try:
        global COMMON_GIVEN_NAMES
        COMMON_GIVEN_NAMES = given_name_places()
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

    # ⚠️ AFTER the institutions, so a curated alias is the LAST claimant on
    # its surface and `decide()` sees it beside any it collides with. It
    # cannot silently overwrite one: two entries claiming a surface make it
    # ambiguous, which is the correct answer if a hand-written alias ever
    # collides with a real institution name.
    rows, cov = build_aliases()
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
    coverage["common_words"] = len(COMMON_WORDS)
    coverage["places_named_like_a_given_name"] = len(COMMON_GIVEN_NAMES)
    coverage["common_words_from_articles"] = words_doc.get("articles_scanned")
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
    # ⚠️ `anchor_for` must never appear on a RESOLVABLE form: there it would
    # be a second, unvalidated route to the same identity, and a consumer
    # reading it would bypass every check `id` went through.
    strays = [(e["canonical"], f["surface"]) for e in entries
              for f in e["forms"] if f["resolvable"] and "anchor_for" in f]
    if strays:
        raise RuntimeError(
            f"{len(strays)} resolvable form(s) carry anchor_for — "
            f"e.g. {strays[:3]}")
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
