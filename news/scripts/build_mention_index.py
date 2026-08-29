#!/usr/bin/env python3
"""The reciprocal index: for each entity, which articles named it.

Emits `data/news/mentions/<kind>/<id>.json` under the MAIN site's data tree,
so `/person/:slug` and `/company/:eik` can render a „в новините" block through
the ordinary `dataUrl()` seam.

⚠️⚠️ THE ORIGIN IS THE POINT. `/person` and `/company` are served from the
main target — the person page from Postgres via `/api/db`, the company page
from `spa_page.js` — while the news app lives at a different host. A
cross-origin fetch from the main app to the news target is explicitly out.
Two mechanisms were available and this is the static one:

  • bucket-serve under the main site's data origin  ← chosen
  • load into Postgres with a db:load:news-mentions:pg:cloud

Postgres is this repo's convention for QUERYABLE families — things a route
filters, sorts or aggregates. This is a per-id blob lookup with no query
behind it, rebuilt whole every night, and CLAUDE.md's own rule is that PG
migrations are for live serving and queryable tables only. A PG family would
also inherit the staleness trap that rule exists to warn about: a JSON→PG
family with no `:cloud` loader goes stale on prod with every row count
reconciling. A bucket shard cannot go stale without the file changing.

⚠️ PLACES ARE DELIBERATELY EXCLUDED, and the measurement is why: they are
10,926 of 12,160 (entity, article) pairs — 90% — and the busiest is „България"
at 1,157 articles. „Bulgaria was mentioned in 1,157 articles" is not a
finding, and shipping it would bury the 982 person and institution pairs that
are. `coverage.excluded_kinds` records the decision so a consumer cannot read
the absence as „no places were mentioned".

Run:  python3 news/scripts/build_mention_index.py [--json]
"""

import argparse
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
OUT_DIR = Path(os.environ.get("NEWS_MENTIONS_DIR") or
               ROOT / "data" / "news" / "mentions")

# ⚠️ Only kinds whose id is a KEY THE MAIN SITE ALREADY ROUTES ON: a person
# slug is `/person/:slug`, an institution EIK is `/company/:eik`, a party id
# is the canonical-parties key. A shard for a kind with no page is a file
# nobody can reach.
INDEXED_KINDS = ("person", "institution", "party")
EXCLUDED_KINDS = {
    "place": ("10,926 of 12,160 (entity, article) pairs are places, and "
              "the busiest is Bulgaria itself at 1,157 articles \u2014 a "
              "count that is not a finding, and that would bury the "
              "person and institution pairs that are"),
    "company": ("no company entries exist: 1.02M registry names cannot be "
                "matched by name, so a company resolves only on an explicit "
                "EIK in the text"),
}

# ⚠️ Only a mention that EARNED an identity. A refusal is a statement about
# what we could not establish; putting one on a person's page would render
# „this article may be about you" beside their name.
LINKED_BASES = frozenset({"gazetteer_exact", "coref_resolved"})

# ⚠️ `coref_resolved` IS UNREACHABLE HERE, and saying so beats implying
# otherwise. A coreference resolves only when the SAME document already
# resolved that id outright — which produces its own mention under the same
# (kind, id) dedupe key, and `BASIS_RANK` keeps the stronger one. So after
# `dedupe()` an index row is always `gazetteer_exact`. The basis stays in this
# set deliberately: it is real in the UNdeduped stream and in a saved
# analysis, so a future consumer of either is covered, and a set that quietly
# omitted it would look like a decision nobody made. It means no shard should
# ever be captioned „referred to as" on the strength of this file.

# Newest first, capped. A person's page shows a block, not an archive.
MAX_ARTICLES_PER_ENTITY = 50

# ⚠️ An id becomes a FILENAME. Place ids carry a colon (`settlement:68134`)
# and an institution EIK is digits, but neither is trusted: a `..` or a slash
# arriving from corpus data would write outside the output tree.
SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def safe_id(ident: str) -> str:
    out = SAFE_ID_RE.sub("_", ident).strip("._") or "_"
    # Belt and braces: `..` cannot survive the substitution above (a dot is
    # allowed), so it is removed explicitly rather than assumed impossible.
    return out.replace("..", "_")


def is_linkable(mention: dict) -> bool:
    """May this mention become a link on a named individual's page?

    ⚠️ BOTH CLAUSES, and the basis one is deliberately redundant. `resolve()`
    never returns an id on a refused basis — the gazetteer strips it and
    `decide()` returns None — so the id test alone catches every refusal it
    can currently produce. The basis test is there for the day a resolver
    change breaks that invariant, which is precisely the day nobody is
    watching. It is tested here rather than through `build()`, where it is
    unreachable by construction.
    """
    return bool(mention.get("id")) and mention.get("basis") in LINKED_BASES


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def outlet_names() -> dict:
    """domain → the outlet's display name, from the registry CSV."""
    import csv
    names = {}
    for fname in ("bg_news_sites.csv", "retired_sites.csv"):
        path = NEWS_DATA / fname
        if not path.exists():
            continue
        with open(path, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                domain = (row.get("domain") or "").strip()
                if domain:
                    names[domain] = (row.get("outlet") or domain).strip()
    return names


def corpus_articles():
    """Every readable corpus record, with its path.

    ⚠️ Directories starting with `_` are skipped: `_quarantine`, `_html` and
    `_browser` are working state, not the corpus, and indexing a quarantined
    article would put a record we rejected onto a person's page.
    """
    for domain_dir in sorted(NEWS_DATA.iterdir()):
        if not domain_dir.is_dir() or domain_dir.name.startswith("_"):
            continue
        for path in sorted(domain_dir.glob("*.json")):
            try:
                yield domain_dir.name, json.loads(
                    path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue


def build(gaz, analysed: set) -> tuple[dict, dict]:
    names = outlet_names()
    by_entity: dict = {}
    seen_articles = 0
    skipped_kinds: dict = {}
    for domain, rec in corpus_articles():
        if not rec.get("content"):
            continue
        seen_articles += 1
        for m in rm.dedupe(rm.resolve(rm.article_text(rec), gaz)):
            if not is_linkable(m):
                continue
            if m["kind"] not in INDEXED_KINDS:
                skipped_kinds[m["kind"]] = skipped_kinds.get(m["kind"], 0) + 1
                continue
            entry = by_entity.setdefault((m["kind"], m["id"]), [])
            entry.append({
                "url": rec.get("url"),
                "domain": domain,
                "outlet": names.get(domain, domain),
                "title": rec.get("title"),
                "published": rec.get("published"),
                "image": rec.get("image"),
                # ⚠️ The BASIS travels with the link, so a consumer can render
                # „named in" differently from „referred to as" — and so a
                # future audit can find every coreference without re-running
                # the resolver.
                "basis": m["basis"],
                # ⚠️⚠️ HOW STRONG THE MATCH IS, and the reason it is on every
                # row rather than in a footnote: 464 of 468 person links
                # (99.1%) rest on a TWO-PART name. Bulgarian newsrooms write
                # two parts and the identity layer stores three, so a
                # two-part form can only ever be „unique among the public
                # figures WE hold" — which says nothing about whether the
                # person the article means is one of them. „проф. Николай
                # Витанов", interviewed 50 times by one outlet, matches a
                # deputy minister of that name and may be somebody else.
                #
                # A page rendering these must say „a person of this name"
                # where form_kind is `two_part`, and may say „named" only for
                # `full_name`.
                "form_kind": m.get("form_kind", "name"),
                "role": m.get("role", "mention"),
                "surface": m["surface"],
                # ⚠️ Whether this article has been JUDGED. The block is on a
                # person's page, and „we analysed this" is a different claim
                # from „we collected it".
                "analyzed": rec.get("url") in analysed,
            })
    coverage = {
        "articles_scanned": seen_articles,
        "form_kind_meaning": {
            "full_name": "the article wrote all three name parts — near-certain",
            "two_part": "the article wrote two parts, unique among the public "
                        "figures we hold; it may be a person we do not hold",
            "coref": "a short form resolved to a longer one in the same article",
            "name": "a non-person entity matched by its name",
        },
        "entities": len(by_entity),
        # ⚠️ Two numbers, because they answer different questions and the cap
        # separates them: `pairs_found` is what the corpus holds,
        # `pairs_shipped` (added by write_shards) is what the shards carry.
        # One key called „pairs" sitting beside a post-cap split was an
        # internal contradiction in the coverage block itself.
        "pairs_found": sum(len(v) for v in by_entity.values()),
        "indexed_kinds": list(INDEXED_KINDS),
        "excluded_kinds": {k: {"mentions": skipped_kinds.get(k, 0),
                               "why": why}
                           for k, why in EXCLUDED_KINDS.items()},
        "max_articles_per_entity": MAX_ARTICLES_PER_ENTITY,
        "gazetteer_version": gaz.version,
    }
    return by_entity, coverage


def write_shards(by_entity: dict, coverage: dict, out_dir: Path) -> list:
    # ⚠️ Created up front rather than as a side effect of the first shard. A
    # run that indexes NOTHING — a corpus with no resolvable person,
    # institution or party — still has to write `index.json` saying so, and
    # relying on `dest.parent.mkdir` inside the loop crashed on exactly that
    # case with a FileNotFoundError instead.
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    by_form: dict = {}
    claimed: dict = {}
    for (kind, ident), articles in sorted(by_entity.items()):
        # Newest first; an article with no publication date sorts last rather
        # than being dropped — 13% of the corpus carries none.
        articles.sort(key=lambda a: (a.get("published") or "", a.get("url") or ""),
                      reverse=True)
        total = len(articles)
        shown = articles[:MAX_ARTICLES_PER_ENTITY]
        # ⚠️ COUNTED AFTER THE CAP, because the coverage block describes what
        # is SHIPPED. Counted before it, the published split (1,234) disagreed
        # with the rows actually in the shards (1,148) — and that figure is
        # quoted in three files as the reason `form_kind` exists at all.
        for a in shown:
            key = f"{kind}.{a['form_kind']}"
            by_form[key] = by_form.get(key, 0) + 1

        # ⚠️ A COLLISION WOULD MERGE TWO PEOPLE'S ARTICLE LISTS, which is
        # the worst thing this file could do. Today `safe_id` is injective
        # over every id in the corpus — by luck, since no id needs
        # sanitising at all — and luck is not a guarantee once a place or a
        # future kind with punctuation in its id is indexed.
        fname = safe_id(ident)
        clash = claimed.get((kind, fname))
        if clash is not None and clash != ident:
            raise RuntimeError(
                f"two {kind} ids flatten to the same filename {fname!r}: "
                f"{clash!r} and {ident!r} — refusing to merge their articles")
        claimed[(kind, fname)] = ident
        dest = out_dir / kind / f"{fname}.json"
        # ⚠️ Refuse anything that escaped the tree. safe_id() should make this
        # unreachable; an assertion beats a comment saying it is unreachable.
        if out_dir.resolve() not in dest.resolve().parents:
            raise RuntimeError(f"refusing to write outside {out_dir}: {dest}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps({
            "kind": kind, "id": ident,
            "generated_at": coverage["generated_at"],
            # ⚠️ Both numbers. „50 articles" beside a cap of 50 is
            # indistinguishable from „exactly 50", and the difference is
            # whether the reader is seeing everything.
            "article_count": total,
            "shown": len(shown),
            "analyzed_count": sum(1 for a in articles if a["analyzed"]),
            "articles": shown,
        }, ensure_ascii=False), encoding="utf-8")
        written.append(str(dest))
    # ⚠️⚠️ ORPHANS ARE PRUNED, and without this the header's central claim —
    # „a bucket shard cannot go stale without the file changing" — is false.
    # An entity that LEAVES the corpus (its article quarantined, its name gone
    # ambiguous, its slug retired by a db:resolve:persons) keeps a live shard
    # carrying its old article list for ever; and since `bucket:sync` passes
    # no `-d`, the bucket copy is permanent. That is the exact staleness the
    # bucket-over-Postgres decision was argued on.
    keep = {Path(w).resolve() for w in written}
    keep.add((out_dir / "index.json").resolve())
    pruned = []
    for stale in sorted(out_dir.rglob("*.json")):
        if stale.resolve() in keep:
            continue
        stale.unlink()
        pruned.append(str(stale))
    for kind_dir in sorted(out_dir.iterdir()):
        # An emptied kind directory would otherwise linger and read as „this
        # kind is indexed and holds nothing".
        if kind_dir.is_dir() and not any(kind_dir.iterdir()):
            kind_dir.rmdir()
    coverage["pruned"] = len(pruned)
    # ⚠️ PUBLISHED, so „222 entities in the news" can never be quoted without
    # the strength of the evidence beside it. 99.1% of person links rest on a
    # two-part name.
    coverage["pairs_by_form_kind"] = dict(sorted(by_form.items()))
    coverage["pairs_shipped"] = sum(by_form.values())

    (out_dir / "index.json").write_text(
        json.dumps({"generated_at": coverage["generated_at"],
                    "coverage": coverage,
                    # The ids that HAVE a shard, so a page can decide whether
                    # to fetch without a 404 round-trip.
                    "ids": {kind: sorted(safe_id(i) for (k, i) in by_entity
                                         if k == kind)
                            for kind in INDEXED_KINDS}},
                   ensure_ascii=False), encoding="utf-8")
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    gaz_path = NEWS_DATA / "gazetteer.json"
    if not gaz_path.exists():
        # ⚠️ Exit 2 and write NOTHING. An empty index would replace a good
        # served tree with one asserting that no article names anybody.
        print(json.dumps({"error": "no_gazetteer", "path": str(gaz_path)}))
        return 2
    gaz = rm.Gazetteer.load(gaz_path)

    # Which articles carry an analysis — read once, so „analyzed" is a fact
    # rather than a per-article file probe.
    index_path = NEWS_DATA / "analysis" / "index.json"
    analysed = set()
    if index_path.exists():
        try:
            analysed = set(json.loads(
                index_path.read_text(encoding="utf-8")).get("articles") or {})
        except json.JSONDecodeError:
            pass

    by_entity, coverage = build(gaz, analysed)
    coverage["generated_at"] = now_iso()
    if not by_entity:
        print(json.dumps({"error": "no_mentions", **coverage}))
        return 2

    out_dir = Path(args.out) if args.out else OUT_DIR
    written = write_shards(by_entity, coverage, out_dir)
    result = {"out": str(out_dir), "shards": len(written), **coverage}
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        for k, v in result.items():
            print(f"{k:28} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
