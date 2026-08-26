#!/usr/bin/env python3
"""Choose the gold set: 200–300 articles to be judged by a frontier model, and
then used to measure everything else.

⚠️⚠️ THE 365 RECORDS ON DISK CANNOT BE THE BASELINE, and a random draw cannot
fix it. Measured over them: `leaning` is `not_applicable` on 90% and
`russia_stance` on 94%, so a classifier that always answers `not_applicable`
scores ~90% and every agreement metric on that set is meaningless. A random
sample inherits exactly that skew.

So this stratifies, and deliberately OVERSAMPLES the rare-but-important cells:
Russia-dense framing, entity-rich articles, and the quality-gate classes —
short bodies, non-articles, paywall shells — so the gate itself is measured
rather than assumed.

⚠️⚠️ THE STRATUM IS NOT A LABEL. Every article is recorded with the cell it
was DRAWN FOR (`drawn_for`), never with a judgment. „russia_dense" means the
word Русия occurs three times; it does NOT mean the article is pro-Russian,
and a scorer that read it as one would be measuring this file's regex instead
of the model. The signals here are for CHOOSING WHAT TO HAVE JUDGED, and the
rubric's ban on keyword-matching applies to judging, not to sampling.

Run:  python3 news/scripts/build_gold_set.py --size 250
"""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import resolve_mentions as rm  # noqa: E402

ROOT = Path(os.environ.get("DATA_BG_ROOT") or
            Path(__file__).resolve().parents[2])
NEWS_DATA = ROOT / "news" / "data"
OUT = NEWS_DATA / "gold" / "gold_set.json"

# ⚠️ A SAMPLING signal, never a label. Three or more hits means „this article
# is worth having judged on the Russia axis", not „this article is
# pro-Russian" — the axis is precisely what we are paying a frontier model to
# decide. Written with an explicit non-letter boundary because Python's `\b`
# is fine here but the pattern is copied often and `\b` is ASCII-only in
# JavaScript, where this repo has been bitten before.
# ⚠️⚠️ THE STEMS ARE THE HARD PART, and the first cut was wrong in BOTH
# directions. `Рус[а-я]*` matched Русе (a city), русенски, руса (blonde) and
# русалка (mermaid) — 5 of the 50 shipped entries were a puppet-theatre
# obituary, two missing sisters, a Danube water level and a petrol-price
# story. Meanwhile `Украйн[а-я]*` structurally CANNOT reach украински /
# украинци (the demonym stem is Украин-, not Украйн-), and an anchored
# `санкции` cannot reach санкциите — 44 genuine articles excluded.
#
# ⚠️ NOT case-insensitive. `re.I` let „Русия" match lowercase fragments of
# unrelated words; the proper nouns are capitalised in Bulgarian and the
# common adjectives carry their own lowercase stems here.
RUSSIA_RE = re.compile(
    r"(?<![^\W\d_])("
    r"Русия|руск[а-я]*|русн[а-я]*|"              # Russia · Russian · Russians
    r"Путин[а-я]*|Кремъл[а-я]*|Москва|московск[а-я]*|"
    r"Украйн[а-я]*|украин[а-я]*|Украин[а-я]*|"   # Ukraine AND the demonym stem
    r"Зеленски|санкци[а-я]*|НАТО"
    r")(?![^\W\d_])", re.UNICODE)
RUSSIA_MIN_HITS = 3

# Below this the quality gate should fire — `too_short` — so these are drawn
# ON PURPOSE rather than filtered out.
SHORT_BODY_CHARS = 400

# ⚠️ ORDER MATTERS: the first matching cell wins, and the rare cells come
# first. Listed the other way round, `mainstream` would swallow the
# Russia-dense and entity-rich articles that are the whole reason for
# stratifying — and the gold set would be a random sample wearing a
# stratified label.
CELLS = (
    ("quality_short", "body under 400 chars — the too_short gate"),
    ("quality_no_body", "no body at all — the extractor's own failure mode"),
    ("russia_dense", f"{RUSSIA_MIN_HITS}+ Russia/Ukraine terms — the axis "
                     "that is 94% not_applicable in the current corpus"),
    ("entity_rich", "3+ gazetteer-resolved mentions — measures the mention "
                    "layer's precision, which matters more than its recall"),
    ("person_linked", "at least one resolvable PERSON — the highest-"
                      "consequence link the site renders"),
    ("no_author", "no byline — one of the AI-generation signals"),
    ("mainstream", "everything else, so the ordinary case is measured too"),
)

# ⚠️ Shares, not counts, so --size changes the set's size and not its shape.
# The rare cells are oversampled RELATIVE to the corpus (russia_dense is 11%
# of articles and 20% of the gold set) because that is the whole point; the
# corpus share is recorded beside each so the distortion is visible.
TARGET_SHARE = {
    "quality_short": 0.10,
    "quality_no_body": 0.04,
    "russia_dense": 0.20,
    "entity_rich": 0.20,
    "person_linked": 0.16,
    "no_author": 0.10,
    "mainstream": 0.20,
}


# ⚠️ NOT EVERY DIRECTORY UNDER news/data/ IS AN OUTLET. The rule was „starts
# with an underscore", and neither of these does: `analysis/` holds an index
# of the articles we have already JUDGED, and `gold/` holds this file's own
# output — so the selector drew its own predecessor into the pool (ranks 35
# and 38 of 88 in quality_no_body) and both inflated `corpus_scanned`, the
# denominator of every published share.
NON_CORPUS_DIRS = frozenset({"analysis", "gold", "stories"})


def is_corpus_dir(path: Path) -> bool:
    return (path.is_dir() and not path.name.startswith("_")
            # ⚠️ On the STEM, so the list still bites when a future working
            # directory is called `analysis.v2` — matched on the full name it
            # is unreachable today (none of these has a dot) and deleting it
            # changes nothing any test can see.
            and path.name.split(".", 1)[0] not in NON_CORPUS_DIRS
            # An outlet directory is named after a domain.
            and "." in path.name)


def signals_present(rec: dict, mentions: list) -> set:
    """Every cell whose signal this article carries — not just the winner.

    ⚠️ `cell_for` is first-match-wins, which is right for the DRAW and wrong
    for the denominator. An article with five linked mentions AND no byline
    is drawn once and carries two signals; counting only the winner makes
    every later cell look rarer than it is — person-linked read as 0.69% of
    the corpus when 7.65% of articles carry a resolvable person, making the
    oversampling look 11x more aggressive than it really is.
    """
    body = rec.get("content") or ""
    linked = [m for m in mentions if m.get("id")]
    out = set()
    if not body.strip():
        out.add("quality_no_body")
    elif len(body) < SHORT_BODY_CHARS:
        out.add("quality_short")
    if len(RUSSIA_RE.findall(body)) >= RUSSIA_MIN_HITS:
        out.add("russia_dense")
    if len(linked) >= 3:
        out.add("entity_rich")
    if any(m["kind"] == "person" for m in linked):
        out.add("person_linked")
    if not (rec.get("author") or "").strip():
        out.add("no_author")
    return out or {"mainstream"}


def cell_for(rec: dict, mentions: list) -> str:
    body = rec.get("content") or ""
    if not body.strip():
        return "quality_no_body"
    if len(body) < SHORT_BODY_CHARS:
        return "quality_short"
    if len(RUSSIA_RE.findall(body)) >= RUSSIA_MIN_HITS:
        return "russia_dense"
    linked = [m for m in mentions if m.get("id")]
    if len(linked) >= 3:
        return "entity_rich"
    if any(m["kind"] == "person" for m in linked):
        return "person_linked"
    if not (rec.get("author") or "").strip():
        return "no_author"
    return "mainstream"


def rank_key(url: str, seed: str) -> str:
    """Deterministic, seed-dependent order within a cell.

    ⚠️ A HASH, not `random`. The gold set is an artifact people argue about,
    so „why is this article in it" has to be answerable a year later on
    another machine — and `random.shuffle` with a seed is only stable within
    one Python version's PRNG. It also spreads the draw evenly across
    outlets and dates, which a date-sorted take would not.
    """
    return hashlib.sha256(f"{seed}:{url}".encode("utf-8")).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=250)
    ap.add_argument("--seed", default="naiasno-gold-v1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    gaz_path = NEWS_DATA / "gazetteer.json"
    gaz = rm.Gazetteer.load(gaz_path) if gaz_path.exists() else None

    pools: dict = {name: [] for name, _ in CELLS}
    prevalence: dict = {}
    scanned = 0
    for domain_dir in sorted(NEWS_DATA.iterdir()):
        if not is_corpus_dir(domain_dir):
            continue
        for path in sorted(domain_dir.glob("*.json")):
            try:
                rec = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            scanned += 1
            mentions = (rm.dedupe(rm.resolve(rm.article_text(rec), gaz))
                        if gaz else [])
            for name in signals_present(rec, mentions):
                prevalence[name] = prevalence.get(name, 0) + 1
            pools[cell_for(rec, mentions)].append({
                "path": f"news/data/{domain_dir.name}/{path.name}",
                "domain": domain_dir.name,
                "url": rec.get("url"),
                "title": rec.get("title"),
                "published": rec.get("published"),
                "content_chars": len(rec.get("content") or ""),
                "linked_mentions": sum(1 for m in mentions if m.get("id")),
            })

    if not scanned:
        print(json.dumps({"error": "empty_corpus", "data": str(NEWS_DATA)}))
        return 2

    chosen = []
    cells_report = {}
    shortfall = {}
    for name, why in CELLS:
        want = round(args.size * TARGET_SHARE[name])
        pool = sorted(pools[name], key=lambda a: rank_key(a["url"] or a["path"],
                                                          args.seed))
        take = pool[:want]
        for a in take:
            chosen.append({**a,
                           # ⚠️ WHY IT WAS DRAWN, never what it is. See the
                           # module docstring: a scorer reading this as a
                           # label would be measuring our regex, not a model.
                           "drawn_for": name})
        cells_report[name] = {
            "target": want, "available": len(pool), "taken": len(take),
            # What was LEFT for this cell after the earlier ones took
            # theirs — the pool the draw actually saw.
            "residual_share": round(len(pool) / scanned, 4),
            # ⚠️ How many articles carry the SIGNAL AT ALL, whichever cell
            # claimed them. This is the honest denominator for „how much did
            # we oversample" — see signals_present().
            "signal_prevalence": round(
                prevalence.get(name, 0) / scanned, 4),
            "oversampled_vs_prevalence": (
                round((len(take) / max(args.size, 1))
                      / (prevalence[name] / scanned), 2)
                if prevalence.get(name) else None),
            "gold_share": round(len(take) / max(args.size, 1), 4),
            "why": why,
        }
        if len(take) < want:
            # ⚠️ REPORTED, not silently topped up from another cell. A gold
            # set that quietly refilled a rare cell with mainstream articles
            # would be a random sample wearing a stratified label.
            shortfall[name] = {"wanted": want, "got": len(take)}

    doc = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(
            timespec="seconds"),
        "seed": args.seed,
        "requested_size": args.size,
        "actual_size": len(chosen),
        "corpus_scanned": scanned,
        "cells": cells_report,
        "shortfall": shortfall,
        "drawn_for_is_not_a_label": (
            "each article records the CELL IT WAS DRAWN FOR, never a "
            "judgment. „russia_dense" + chr(34) + " means the word Русия occurs three "
            "times; it does not mean the article is pro-Russian, and a "
            "scorer treating it as a label would be measuring this file's "
            "regex rather than a model."),
        "articles": chosen,
    }
    dest = Path(args.out) if args.out else OUT
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1),
                    encoding="utf-8")

    result = {"out": str(dest), "size": len(chosen), "scanned": scanned,
              "shortfall": shortfall,
              "cells": {k: v["taken"] for k, v in cells_report.items()}}
    print(json.dumps(result, ensure_ascii=False) if args.json else
          json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
