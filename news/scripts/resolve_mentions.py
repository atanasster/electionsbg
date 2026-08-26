#!/usr/bin/env python3
"""Dictionary pass over an article's text: find gazetteer surfaces, and emit
the `mentions` block for the ones that earned an identity.

This runs BEFORE the model and costs no tokens. What it cannot do is
coreference („Пеевски" in ¶4 after „Делян Пеевски" in ¶1) or role assignment
— those are T2.3, and this pass deliberately leaves them alone.

⚠️ IT NEVER PICKS A WINNER. Every refusal in the gazetteer is carried through
as a refusal here: a surface whose form is `resolvable: false` produces a
mention with `basis: "ambiguous_refused"` or `"not_in_gazetteer"` and NO id.
The reason is measured, not defensive — see build_gazetteer.py's header:
„Иванов" is 1,554 public figures, and a wrong link is shape-identical to a
right one.

Run:  python3 news/scripts/resolve_mentions.py --text-file article.txt
      python3 news/scripts/resolve_mentions.py --article news/data/x.bg/a.json
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])
GAZETTEER = ROOT / "news" / "data" / "gazetteer.json"

# Surfaces are matched over TOKENS, not with one giant alternation: 12,914
# forms in a single regex is slow to compile and slower to run, and the
# longest surface in the corpus is 67 words. A token window with dict lookups
# is O(tokens × window) and needs no dependency — this package stays
# pure-stdlib so the standalone analysis box can run it.
#
# ⚠️ The window is capped. The 67-word institution names are real, but a
# window that long turns every article into 67 dict lookups per token for
# entries no newsroom writes out in full. Measured on the corpus, 99.0% of
# surfaces are 10 words or fewer.
MAX_SURFACE_WORDS = 10

# ⚠️ THE TOKEN PATTERN IS WHAT MAKES THE BOUNDARY CYRILLIC-AWARE, and getting
# it wrong is silent. Python's `\b` and `\w` ARE Unicode-aware for str
# patterns, unlike JavaScript's — so the usual warning about `\b` never
# matching after a Cyrillic letter does NOT apply here. What DOES bite is the
# hyphen: with a plain `(?<!\w)…(?!\w)` boundary, the surface „Иван Петров"
# matches inside „Иван Петров-Георгиев", who is a different person. A hyphen
# is part of a Bulgarian compound surname, so it is a word character for this
# purpose and a token may contain one.
TOKEN_RE = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*|\d+", re.UNICODE)


def fold(text: str) -> str:
    """Case- and diacritic-insensitive key.

    ⚠️ NFKD then strip combining marks, so „Й" and „И"+breve compare equal —
    the register and the newsroom disagree about which they use, and a
    byte-comparison silently misses every one of those.
    """
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


class Gazetteer:
    """Folded surface → the forms that claim it."""

    def __init__(self, doc: dict):
        self.version = doc.get("version")
        self.coverage = doc.get("coverage") or {}
        # ⚠️ A LIST per key, not a single form. Two entries can legitimately
        # claim the same folded surface across KINDS — a place and an
        # institution named after the same person — and keeping only one
        # would silently pick by file order, which is the party-surface
        # defect build_gazetteer.py already had once.
        self.by_surface: dict[str, list] = {}
        self.max_words = 1
        for entry in doc.get("entries") or []:
            for form in entry.get("forms") or []:
                surface = form.get("surface") or ""
                words = len(surface.split())
                if not surface or words > MAX_SURFACE_WORDS:
                    continue
                # ⚠️ THE KEY IS BUILT WITH THE RESOLVER'S OWN TOKENISER,
                # not by splitting on whitespace. A surface carrying internal
                # punctuation — „Гечева - Захариева", ОУ „Христо Ботев" —
                # folds to a string no tokenised text can ever equal, so the
                # entry is indexed under a key that cannot be looked up.
                # Measured: 3,211 resolvable forms, 34.4% of the total.
                #
                # BOTH hyphen spellings are indexed, because the register
                # writes „Гечева - Захариева" and a newsroom writes
                # „Гечева-Захариева", and the hyphen is INSIDE a token (that
                # is what stops „Иван Петров" matching in „Иван
                # Петров-Георгиев"), so the two tokenise differently.
                claim = {
                    "kind": entry["kind"],
                    "canonical": entry["canonical"],
                    "resolvable": form["resolvable"],
                    "id": form["id"],
                    # ⚠️ NOT an id. See build_gazetteer.form(): this says what
                    # the anchor points at, usable only when the document has
                    # already resolved that entry outright.
                    "anchor_for": form.get("anchor_for"),
                    # Why the gazetteer refused it, machine-readable.
                    "refusal": form.get("refusal"),
                    # ⚠️ How strong the surface is as evidence — see
                    # FORM_KINDS in build_gazetteer.py. 99.1% of person links
                    # rest on a two-part name, and a consumer that cannot see
                    # that will render „a person of this name" as an identity.
                    "form_kind": form.get("form_kind", "name"),
                    # Distinguishes homonyms that share a canonical name —
                    # „Айтос" is both a settlement and an obshtina, and a
                    # candidate list built without it collapses to one.
                    "detail": entry.get("place_kind") or entry.get("tier"),
                    "why": form["why"],
                }
                for variant in {
                    " ".join(TOKEN_RE.findall(surface)),
                    " ".join(TOKEN_RE.findall(
                        re.sub(r"\s*-\s*", "-", surface))),
                }:
                    if variant:
                        self.by_surface.setdefault(
                            fold(variant), []).append(claim)
                self.max_words = max(self.max_words, words)

    @classmethod
    def load(cls, path: Path = GAZETTEER) -> "Gazetteer":
        return cls(json.loads(path.read_text(encoding="utf-8")))


# The gazetteer's `kind` is already singular and matches MENTION_KINDS in
# analyze_articles.py. Stated here so a divergence is a failing import rather
# than a mention block the validator rejects at save time.
MENTION_KINDS = ("person", "party", "institution", "company", "place")


def label(claim: dict) -> str:
    """A candidate string a human can tell apart from its neighbour.

    ⚠️ Two homonym places both have the canonical name „Айтос", so a
    candidate list built from canonical names alone collapses to one entry —
    and a one-entry list is not an ambiguity, so the surface silently fell
    through to „not in gazetteer". The kind and id are what distinguish them.
    """
    bits = [claim["kind"]]
    if claim.get("detail"):
        bits.append(str(claim["detail"]))
    # ⚠️ `anchor_for` too. A REFUSED claim carries its identity there rather
    # than in `id`, so a label built from `id` alone collapsed „Ангелов
    # (person)" ×7 into one string — and a one-entry list is not an
    # ambiguity, so 453 genuinely contested surfaces reported „not in
    # gazetteer" instead of naming their candidates.
    ident = claim.get("id") or claim.get("anchor_for")
    if ident:
        bits.append(str(ident))
    return f"{claim['canonical']} ({', '.join(bits)})"


def decide(claims: list, resolved_ids: set) -> tuple:
    """(basis, id, candidates) for everything claiming one surface.

    ⚠️⚠️ THE FIRST TEST IS „HOW MANY ENTITIES CLAIM THIS SURFACE", NOT „HOW
    MANY OF THEM RESOLVE". The obvious version counted only the resolvable
    claims, so a single village outvoted every refusal beside it: „Ангелов" is
    refused as a surname by seven public figures AND is a settlement, and the
    village won — 36 live occurrences emitting `gazetteer_exact` with a
    settlement id on what an article meant as a person's name. A refusal is
    evidence of ambiguity, not an abstention.

    ⚠️ THERE IS NO SCORING HERE. No "prefer the person", no "prefer the one
    with more contracts" — each would be right sometimes and wrong sometimes,
    with nothing in the output to say which.

    `resolved_ids` is the set of ids resolved OUTRIGHT elsewhere in THIS
    DOCUMENT, and it is what makes coreference possible without a model:
    „Пеевски" in ¶4 is a bare surname, which never resolves on its own — but
    if „Делян Пеевски" resolved in ¶1 and is the only entry claiming that
    surname, this document has already said who is meant.
    """
    resolvable = [c for c in claims if c["resolvable"] and c["id"]]

    # Exactly one ENTITY claims it, and it resolves.
    if len(claims) == 1 and len(resolvable) == 1:
        return "gazetteer_exact", resolvable[0]["id"], None

    # Several claim it. Can the DOCUMENT settle it? A surface whose anchors
    # point at exactly one entity the article ALREADY resolved outright is a
    # coreference — a fact about the document, not a guess about the country.
    anchored = {c["anchor_for"] for c in claims
                if c.get("anchor_for")} & resolved_ids
    anchored |= {c["id"] for c in resolvable} & resolved_ids
    # ⚠️ NOT gated on `len(claims) > 1`. The commonest coreference is a bare
    # surname claimed by exactly ONE roster entry — „Пеевски" after „Делян
    # Пеевски" — which is a single refused claim, so that guard silently
    # switched off the whole feature while every other test stayed green.
    if len(anchored) == 1:
        return "coref_resolved", next(iter(anchored)), None

    if len(claims) == 1:
        # One claim, and it refuses — see the note on `not_in_gazetteer` in
        # analyze_articles.py. We cannot name the competitors, so we cannot
        # call it an ambiguity.
        return "not_in_gazetteer", None, None

    # ⚠️ Candidates are LABELLED, not canonical names — see label(). And the
    # ambiguity is counted over CLAIMS, so two homonym places named „Айтос"
    # are two candidates rather than one deduped string.
    labels = sorted({label(c) for c in claims})
    if len(labels) >= 2:
        return "ambiguous_refused", None, labels
    return "not_in_gazetteer", None, None


# ⚠️ WHAT MAY SIT BETWEEN TWO WORDS OF ONE SURFACE — and the first cut
# checked nothing at all, so a multi-word surface formed across ANY gap. That
# is not a theoretical hazard: „…това каза Иван." followed by „Петров съобщи
# вчера." produced „Иван Петров", a person the article never named, and the
# newline article_text() inserts between title and body did not stop it
# either. A name is written with spaces; a full stop, a comma, a quote or a
# line break between two words means they belong to different phrases.
#
# The class is empirically sufficient rather than guessed: a census of every
# inter-token whitespace gap across 600 corpus articles found only U+0020 and
# U+00A0.
# ⚠️ QUOTES AND HYPHENS ARE ALLOWED, SENTENCE PUNCTUATION IS NOT. An
# institution's name legitimately contains them — ОУ „Христо Ботев", „В и К"
# ООД, Гечева - Захариева — and a spaces-only gap made 3,211 resolvable forms
# (34.4%) unreachable, including a sitting minister in both spellings a
# newsroom writes. A full stop, comma, semicolon, colon, bracket or line
# break still separates: those are what „…каза Иван. Петров съобщи" turns on.
GAP_RE = re.compile(
    r"[ \u00a0\u2009\t\u2010-\u2015-"           # spaces and dashes
    r"\u0022\u0027\u00ab\u00bb\u2018\u2019\u201a"
    r"\u201c\u201d\u201e\u2039\u203a]*\Z")     # quote marks


def _joinable(text: str, a: tuple, b: tuple) -> bool:
    """May tokens `a` and `b` belong to one surface?"""
    return GAP_RE.match(text[a[2]:b[1]]) is not None


def _windows(tokens: list, gaz: Gazetteer, text: str = ""):
    """Longest-match walk over the token stream, yielding (n, window, claims).

    ⚠️ Shared by both passes of resolve() ON PURPOSE. Written twice, the
    coreference pre-pass and the emitting pass could disagree about where a
    surface starts — and the resulting mention would cite a span the pre-pass
    never saw.
    """
    i = 0
    while i < len(tokens):
        hit = None
        for n in range(min(gaz.max_words, len(tokens) - i), 0, -1):
            window = tokens[i:i + n]
            if any(not _joinable(text, window[k], window[k + 1])
                   for k in range(len(window) - 1)):
                continue
            claims = gaz.by_surface.get(fold(" ".join(t[0] for t in window)))
            if claims:
                hit = (n, window, claims)
                break
        if not hit:
            i += 1
            continue
        yield hit
        i += hit[0]


def resolve(text: str, gaz: Gazetteer) -> list:
    """Every gazetteer surface occurring in `text`, longest match first.

    ⚠️ LONGEST WINS, and it decides correctness rather than tidiness. „Делян
    Пеевски" and „Пеевски" are both surfaces; the first is resolvable and the
    second never is. Taking the shortest — or both — would turn a clean
    full-name hit into an unresolved anchor sitting on the same words.
    """
    tokens = [(m.group(), m.start(), m.end())
              for m in TOKEN_RE.finditer(text or "")]
    # ⚠️ TWO PASSES over the same token stream, and one pass cannot do this.
    # Coreference needs to know what the document resolved OUTRIGHT before it
    # can decide a bare surname — and the full name can appear after the
    # short form („Пеевски заяви… Делян Пеевски добави"). A single forward
    # pass would resolve the first and refuse the second, on the same person,
    # in the same article, depending only on paragraph order.
    # ⚠️ MATERIALISED ONCE. The walk was run twice — once to collect the
    # outright resolutions, once to emit — which is a measured 1.97x
    # (312 ms → 159 ms over 400 articles) for byte-identical output.
    hits = list(_windows(tokens, gaz, text))
    resolved_ids = {
        claims[0]["id"] for _, _, claims in hits
        if len(claims) == 1 and claims[0]["resolvable"] and claims[0]["id"]
    }
    out: list = []
    for _, window, claims in hits:
        basis, ident, candidates = decide(claims, resolved_ids)
        # ⚠️ THE WINNING CLAIM'S KIND, never claims[0]'s — that is gazetteer
        # FILE ORDER. Measured: 37 mentions across 26 articles carried
        # `kind: "person"` with a settlement id, and „Възраждане" resolved to
        # a party while labelled a place, which also split one party across
        # two dedupe keys.
        won = next((c for c in claims if ident and
                    (c["id"] == ident or c.get("anchor_for") == ident)),
                   claims[0])
        mention = {
            "kind": won["kind"],
            # ⚠️ The surface AS WRITTEN, sliced from the source text rather
            # than taken from the gazetteer. „ПЕЕВСКИ" in a headline must not
            # be reported as „Делян Пеевски" — the reader is shown what the
            # article said, and a roster reviewer needs the real spelling.
            "surface": text[window[0][1]:window[-1][2]],
            "basis": basis,
            "id": ident,
            # ⚠️ The dictionary pass cannot tell subject from passing mention;
            # that is the model's job (T2.3). „mention" is the honest floor —
            # claiming „subject" here would put an article on somebody's page
            # for being named once in the last paragraph.
            "role": "mention",
        }
        # ⚠️ Carried on the mention, not left in the gazetteer, because the
        # consumer that has to caption it never reads the gazetteer.
        mention["form_kind"] = ("coref" if basis == "coref_resolved"
                                else won.get("form_kind", "name"))
        # ⚠️ A KNOWN NON-ENTITY IS NOT A REVIEW CANDIDATE. „войници",
        # „места", „река" are gazetteer surfaces refused as ordinary
        # Bulgarian words, and emitting them as `not_in_gazetteer` filled the
        # roster-review queue with 583 mentions, 171 distinct, almost all
        # noise. They are dropped only when NOTHING about them resolved —
        # a document that establishes the place some other way still gets its
        # coreference.
        if (basis == "not_in_gazetteer"
                and claims
                and all(c.get("refusal") in ("common_word", "given_name")
                        for c in claims)):
            continue
        if candidates:
            mention["candidates"] = candidates
        out.append(mention)
    return out


# Strongest provenance first. ⚠️ This is a TOTAL ORDER over the bases, and
# dedupe depends on it: without one, „Пеевски" (coref) arriving before „Делян
# Пеевски" (exact) kept the weaker of the two, so the article reported a
# coreference where it had a clean full-name hit. First-wins is the wrong
# tiebreak whenever paragraph order is the only thing separating them.
BASIS_RANK = {"gazetteer_exact": 0, "coref_resolved": 1,
              "ambiguous_refused": 2, "not_in_gazetteer": 3}


def dedupe(mentions: list) -> list:
    """One entry per (kind, id-or-surface), keeping the STRONGEST basis.

    ⚠️ Folded, so „ПЕЕВСКИ" in the headline and „Пеевски" in the body are one
    mention rather than two. Keyed on the ID where there is one, so two
    spellings of the same resolved person collapse — and on the folded
    surface where there is not, so two DIFFERENT unresolved people who share
    a surname do not.

    ⚠️ The surface kept is the WINNER's, not the first seen: reporting
    „Пеевски" as the surface of a `gazetteer_exact` match would show the
    reader a string that did not produce the resolution.
    """
    best: dict = {}
    order: list = []
    for m in mentions:
        key = (m["kind"], m["id"] or f"~{fold(m['surface'])}")
        if key not in best:
            best[key] = m
            order.append(key)
        elif BASIS_RANK[m["basis"]] < BASIS_RANK[best[key]["basis"]]:
            best[key] = m
    return [best[k] for k in order]


def article_text(rec: dict) -> str:
    """Title, description and body — the fields a mention can occur in.

    ⚠️ Joined with a newline rather than a space, so a surface cannot be
    formed ACROSS the seam: a title ending „…каза Иван" followed by a body
    starting „Петров съобщи" would otherwise produce „Иван Петров", a person
    the article never named.
    """
    return "\n".join(str(rec.get(k) or "")
                     for k in ("title", "description", "content"))


def main() -> int:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--article", help="a corpus article JSON")
    src.add_argument("--text-file", help="raw text ('-' for stdin)")
    ap.add_argument("--gazetteer", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    path = Path(args.gazetteer) if args.gazetteer else GAZETTEER
    if not path.exists():
        # ⚠️ Exit 2 and emit NOTHING. An empty mentions list would mean „the
        # extractor ran and found nobody" — the claim analyze_articles.py's
        # absent-vs-empty rule exists to keep separate.
        print(json.dumps({"error": "no_gazetteer", "path": str(path)}))
        return 2
    gaz = Gazetteer.load(path)

    if args.article:
        rec = json.loads(Path(args.article).read_text(encoding="utf-8"))
        text = article_text(rec)
    elif args.text_file == "-":
        text = sys.stdin.read()
    else:
        text = Path(args.text_file).read_text(encoding="utf-8")

    mentions = dedupe(resolve(text, gaz))
    result = {
        "mentions": mentions,
        "gazetteer_version": gaz.version,
        # Counts beside their denominator, so „we linked 3" is never read as
        # „3 people were mentioned".
        "resolved": sum(1 for m in mentions if m["id"]),
        "refused": sum(1 for m in mentions if not m["id"]),
    }
    print(json.dumps(result, ensure_ascii=False,
                     indent=None if args.json else 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())


# ─────────────────────────────────────────────────────────────────────────
# Entity-list resolution: turning the model's `entities` strings into links
# to the main site.
#
# ⚠️ THIS IS A DIFFERENT PROBLEM FROM SCANNING TEXT, and the difference is
# what makes it safe. `resolve()` above walks free prose, where „места" is a
# village and „Владимир" is a given name; here the string arrives already
# classified BY THE MODEL as a person, a place or an institution central to
# the article. The common-word and given-name hazards do not apply, because
# nobody put „места" in `entities.places` — the model put „София" there.
#
# What DOES still apply is the identity rule, unchanged: a surface may only
# claim an identity it owns. Only `gazetteer_exact` produces a link.
#
# ⚠️ MEASURED, so the ceiling is known rather than assumed. Over the 365
# analyses: 8 of 138 distinct people resolve, 54 of 138 places, 3 of 7
# parties, 9 of 121 institutions and 0 of 30 companies. The people are the
# ones that matter — MPs and ministers — and the institutions are low for a
# reason no threshold can fix: a Bulgarian article writes „МВР", while the
# registry holds „Министерство на вътрешните работи". An abbreviation
# crosswalk is separate work.

# Where each kind lives on the MAIN site. ⚠️ Absolute URLs: the news app is a
# different origin, so a relative href would 404 against news.electionsbg.com.
MAIN_SITE = "https://electionsbg.com"

# A real settlement page is keyed by a bare 5-digit EKATTE — see the
# refusal in entity_link() for the two shapes this excludes.
EKATTE_RE = re.compile(r"^[0-9]{5}$")

# ⚠️ A kind with no entry here is NOT LINKED, and that is the safe default.
# `obshtina` and `oblast` place ids resolve to no route on the main site, so
# a place that is only an obshtina stays plain text rather than becoming a
# link to a 404.
ENTITY_ROUTES = {
    "person": "/person/{id}",
    "party": "/party/{id}",
    "institution": "/awarder/{id}",
    "place:settlement": "/settlement/{id}",
}


def entity_link(name: str, gaz: "Gazetteer") -> dict | None:
    """A link for one entity string, or None.

    ⚠️ Returns the gazetteer's CANONICAL name beside the href, and every
    caller must show it. All eight people this resolves today matched on a
    TWO-PART form („Иван Христанов" → Иван Маркос Христанов), which is how
    newsrooms write them and is unique among public figures — but the reader
    is the last check, and they can only perform it if they can see who we
    think it is.
    """
    claims = gaz.by_surface.get(fold(" ".join((name or "").split())))
    if not claims:
        return None
    basis, ident, _ = decide(claims, set())
    if basis != "gazetteer_exact" or not ident:
        return None
    won = next((c for c in claims if c.get("id") == ident), claims[0])
    kind = won["kind"]
    # A place id is „<place_kind>:<code>"; the route depends on which.
    route_key = kind
    plain_id = ident
    if kind == "place":
        place_kind, _, code = ident.partition(":")
        route_key = f"place:{place_kind}"
        plain_id = code
    route = ENTITY_ROUTES.get(route_key)
    if not route:
        return None
    if route_key == "place:settlement" and not EKATTE_RE.match(plain_id):
        # ⚠️⚠️ A COUNTRY IS NOT A SETTLEMENT. `place_dim` stores foreign
        # countries under kind='settlement' with a two-letter code — ZA is
        # South Africa, UA is Ukraine — so „Южна Африка" cheerfully produced
        # `/settlement/ZA`, a link to a page that does not exist. Sofia's
        # rayon codes (`68134-2302`) are the same shape of problem from the
        # other direction. A real settlement page is keyed by a bare 5-digit
        # EKATTE, and 5,257 of 5,272 rows are one.
        return None
    return {
        "kind": kind,
        "id": plain_id,
        "canonical": won["canonical"],
        "form_kind": won.get("form_kind", "name"),
        "href": MAIN_SITE + route.format(id=plain_id),
    }


def entity_links(entities: dict, gaz: "Gazetteer") -> dict:
    """name → link, for every entity string that earned one.

    ⚠️ Keyed on the NAME AS THE MODEL WROTE IT, so a renderer can look up the
    chip it is about to draw without re-folding anything. A name that did not
    resolve is simply absent — never present with a null href, which a
    renderer would happily turn into a dead link.
    """
    out = {}
    for names in (entities or {}).values():
        for name in names or []:
            if name in out:
                continue
            link = entity_link(name, gaz)
            if link:
                out[name] = link
    return out
