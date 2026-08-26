#!/usr/bin/env python3
"""Freeze real article pages as extraction fixtures for test_save_articles.py.

Run:  python3 news/scripts/capture_fixtures.py            # capture the manifest
      python3 news/scripts/capture_fixtures.py --refresh  # re-fetch existing ones
      python3 news/scripts/capture_fixtures.py --list     # what is frozen now

Why this exists: BodyExtractor is 150 lines of heuristics tuned against real
Bulgarian news pages, and every rule in it was learned from one — windows-1251
on moreto.net, the iubenda cookie banner on glasove.com, the `with-sidebar`
class that names the MAIN column and once zeroed every article on that domain.
None of that was pinned by a test, so the only way to find out whether a change
to the extractor broke something was a 4,700-page sweep.

The fixtures are COMMITTED (unlike news/data/, which is not) and gzipped, one
page per known failure class. Each carries an expectation in
tests/fixtures/expectations.json saying what the extractor must produce from
it — not an exact character count, which would break on a cosmetic change, but
a band plus the gate verdict, which is what the pipeline actually acts on.

A fixture is a point-in-time capture of somebody else's page. It is test data,
never republished content: the tests read char counts and gate verdicts from
it, and nothing in this repo renders it.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
FIXTURE_DIR = SCRIPT_DIR / "tests" / "fixtures"
MANIFEST = FIXTURE_DIR / "expectations.json"

sys.path.insert(0, str(SCRIPT_DIR))
import save_articles as sa  # noqa: E402

# One page per failure class the skills and this repo's history already
# document. `min_chars`/`max_chars` are a band, not an assertion about the
# page: the point is that extraction lands in the right ORDER OF MAGNITUDE and
# on the right side of the gate.
ASSERT_NO_RAW_ENTITIES_ON_ALL = True

MANIFEST_SEED = [
    # --- the F1 defect class: JSON-LD + a headline + no reachable body -------
    dict(name="jsonld_empty_body__24chasa", domain="24chasa.bg",
         url="https://www.24chasa.bg/ozhivlenie/article/23432280",
         gate="title_as_body",
         min_chars=0, max_chars=95,
         min_paras=0, max_paras=3,
         expect_title='Джорджина осинови децата на Роналдо',
         why="valid JSON-LD, real headline, 205 KB of HTML, one paragraph — "
             "the shape that was stored as a complete article 100% of the time"),
    dict(name="jsonld_empty_body__forbes", domain="forbesbulgaria.com",
         url="https://forbesbulgaria.com/2026/08/20/vsyaka-kriza-e-shans/",
         gate="thin_body",
         min_chars=0, max_chars=50,
         min_paras=0, max_paras=2,
         expect_title='Всяка криза е шанс',
         why="611 KB of HTML yielding one paragraph"),
    dict(name="jsonld_empty_body__toest", domain="toest.bg",
         url="https://www.toest.bg/sedmitsata-27-yuli-1-avgust/",
         gate="thin_body",
         min_chars=0, max_chars=50,
         min_paras=0, max_paras=2,
         expect_title='Седмицата (27 юли – 1 август)',
         why="zero extracted paragraphs"),
    # --- healthy articles: the extractor must NOT regress on these ----------
    dict(name="healthy__dnevnik", domain="dnevnik.bg",
         url="https://www.dnevnik.bg/knigi/2026/08/22/4948085_turms_bezmurtniia_na_mika_valtari_otkus/",
         gate=None,
         min_chars=7875, max_chars=13700,
         min_paras=30, max_paras=36,
         expect_title='"Турмс Безмъртния" на Мика Валтари (откъс)',
         why="browser-tier page with an iubenda cookie banner in the rendered "
             "DOM — the banner swamped 100+ paragraphs per article until the "
             "junk filter learned iubenda/cmp/consent"),
    dict(name="healthy__mediapool", domain="mediapool.bg",
         url="https://www.mediapool.bg/kosovo-glasuva-na-predsrochni-izbori-za-vtori-pat-prez-2025-g-news378700.html",
         gate=None,
         min_chars=6450, max_chars=11231,
         min_paras=34, max_paras=40,
         expect_title='Косово гласува на предсрочни избори за втори път през 2025 г.',
         why="every mediapool article TRAILS the donor boilerplate as a "
             "footer; only a body CONSISTING of it is a shell"),
    dict(name="healthy__segabg", domain="segabg.com",
         url="https://www.segabg.com/category-sport/transferite-purva-liga-lyato-2026-g",
         gate=None, min_chars=14235, max_chars=24725,
         min_paras=45, max_paras=53,
         expect_title='Трансферите в Първа лига - лято 2026 г.',
         why="long ordinary article"),
    # --- charset ------------------------------------------------------------
    dict(name="cp1251__moreto", domain="moreto.net",
         url="https://www.moreto.net/novini.php?n=534254",
         gate=None,
         min_chars=2452, max_chars=4301,
         min_paras=16, max_paras=20,
         expect_title='Мощен GPS заглушител е открит и неутрализиран в София',
         why="windows-1251 AND no <p> tags — the longest-contiguous-run "
             "fallback, measured past an anti-adblock popup that duplicates "
             "the lede plus every menu"),
    # --- browser-rendered DOM ----------------------------------------------
    dict(name="rendered__glasove", domain="glasove.com",
         url="https://glasove.com/glasovete-koito-pomnim/putin-estestvena-chast-ot-golyama-evraziya-mozhe-da-bade-i-neyniya-zapaden-kray-evropa-ednopolyusniyat-svyat-e-minalo",
         gate=None,
         min_chars=114381, max_chars=198311,
         min_paras=322, max_paras=392,
         expect_title='Путин: Естествена част от голяма Евразия може да бъде и нейния западен край - Европа. Еднополюсният свят е минало',
         why="'with-sidebar' is a LAYOUT class naming the MAIN column; a bare "
             "'sidebar' substring in the junk regex zeroed every article here"),
    dict(name="rendered__offnews", domain="offnews.bg",
         url="https://offnews.bg/razsledvane/fiktivni-pregledi-i-vlivki-na-vitamini-v-pluven-klub-kup-institu-872930.html",
         gate=None, min_chars=14553, max_chars=25276,
         min_paras=52, max_paras=62,
         expect_title="Фиктивни прегледи и вливки на ''витамини'' в плувен клуб - куп институции не откриват нарушения",
         why="rendered DOM, no machine date"),
    # --- pages that are NOT articles and must not be stored as one ----------
    dict(name="known_gap__terms_page", domain="burgas24.bg",
         url="https://www.burgas24.bg/pages/termsofuse.html",
         gate=None, known_gap=True,
         min_chars=7803, max_chars=13576,
         min_paras=27, max_paras=31,
         expect_title=None,
         why="A KNOWN GAP, pinned as it behaves today: a terms-of-use page is "
             "stored as a 10,405-char article. It carries no title, no publish "
             "date and no JSON-LD, and passes purely on paragraph count. The "
             "obvious discriminator — no Article node AND no date — is NOT "
             "safe: svobodnoslovo.eu is 100% undated and its articles are "
             "real, so that rule would delete a whole domain. Whoever narrows "
             "the article gate should make this fixture flip and update the "
             "expectation deliberately."),
    dict(name="known_gap__donate_page", domain="bird.bg",
         url="https://bird.bg/donate/",
         gate=None, known_gap=True,
         min_chars=6971, max_chars=12133,
         min_paras=24, max_paras=28,
         expect_title='Подкрепи BIRD',
         why="The same KNOWN GAP, pinned as it behaves today: a donation page "
             "stored as a 9,295-char article. Title 'Подкрепи BIRD', no date, "
             "no JSON-LD."),
    # --- the article gate's REJECT direction --------------------------------
    dict(name="not_article__section_page", domain="segabg.com",
         url="https://www.segabg.com/category-sport",
         gate="non_article_page", expect_is_article=False,
         min_chars=0, max_chars=50,
         min_paras=0, max_paras=2,
         expect_title='Спорт',
         why="A section listing: no Article JSON-LD, og:type=website, zero "
             "qualifying paragraphs. The ONLY fixture that exercises the "
             "article gate's reject direction — without it, replacing the "
             "whole listing/homepage protection with `is_article = True` "
             "passed the entire suite."),
    dict(name="known_gap__listing_page", domain="pogled.info",
         url="https://pogled.info/analitichen",
         gate=None, known_gap=True,
         min_chars=10143, max_chars=17631,
         min_paras=19, max_paras=23,
         expect_title='Анализи - Поглед.инфо',
         why="The third instance of the same KNOWN GAP, and the worst: a "
             "section listing extracts 13.5 KB of teaser text and passes "
             "every gate. This is the plovdiv24.bg class the skill documents "
             "('the recorded sitemap lists only section pages'). Pinned as it "
             "behaves today so a narrowing of the article gate flips it."),
    # --- shells -------------------------------------------------------------
    dict(name="footer_boilerplate__mediapool", domain="mediapool.bg",
         url="https://www.mediapool.bg/dans-neutralizira-moshten-gps-zaglushitel-v-sofiya-zasyagal-samoletite-news378900.html",
         gate=None,
         min_chars=2133, max_chars=3747,
         min_paras=16, max_paras=20,
         expect_title='Българският филм "Пакет Вечност" тръгна по екраните в Европа преди премиерата му у нас',
         why="The stored record for this URL was 666 chars of donor "
             "boilerplate; a fresh fetch is a 2,844-char article. That is the "
             "shell/footer distinction the analyze skill warns about — the SAME "
             "boilerplate trails every full mediapool article, so a shell is a "
             "body CONSISTING of it, never one merely containing it. This "
             "fixture pins the FULL page, so a junk rule that started eating "
             "the footer's neighbours would show up here."),
    dict(name="short_undated__svobodnoslovo", domain="svobodnoslovo.eu",
         url="https://svobodnoslovo.eu/bulgaria/predlozhenie-za-satrudnichestvo/145789",
         gate=None,
         min_chars=520, max_chars=952,
         min_paras=13, max_paras=17,
         expect_title='ПРЕДЛОЖЕНИЕ ЗА СЪТРУДНИЧЕСТВО',
         why="A real but very short undated editorial, just above the 400 "
             "floor — the band that proves the gate is not simply rejecting "
             "everything short. svobodnoslovo.eu carries no dates anywhere."),
    # --- long-form and wire -------------------------------------------------
    dict(name="long__pogled", domain="pogled.info",
         url="https://pogled.info/analitichen/miarshaymar-i-golemiyat-vapros-mozheshe-li-voynata-v-ukrayna-da-bade-izbegnata.196212",
         gate=None, min_chars=27444, max_chars=47620,
         min_paras=110, max_paras=134,
         expect_title='Миършаймър и големият въпрос: Можеше ли войната в Украйна да бъде избегната?',
         why="36 KB of body — the upper band"),
    dict(name="wire__bta", domain="bta.bg",
         url="https://www.bta.bg/bg/ot-arhivite/1188282-prez-avgust-2017-g-v-balgariya-e-otbelyazana-nay-visokata-temperatura",
         gate=None, min_chars=10221, max_chars=17766,
         min_paras=36, max_paras=42,
         expect_title='През август 2017 г. в България е отбелязана 1100-годишнината от битката при Ахелой',
         why="agency wire copy, JS-rendered"),
    # --- entity escaping ----------------------------------------------------
    dict(name="entities__podtepeto", domain="podtepeto.com",
         url="https://podtepeto.com/zdrave/cbd-i-zdraveto-zastho-sastavat-i-laboratorniyat-kontrol-imat-znachenie/",
         gate=None,
         min_chars=3466, max_chars=6058,
         min_paras=0, max_paras=3,
         expect_title='CBD и здравето защо съставът и лабораторният контрол имат значение',
         why="JSON-LD headline carrying &#8222;…&#8220;; 197 stored records "
             "carried those verbatim into the LLM prompts and the "
             "story-clustering keys"),
]


BROWSER_DIR = SCRIPT_DIR.parent / "data" / "_browser"


def read_browser_prefetch(domain, url):
    """The rendered HTML the browser tier already captured for this URL, if any.
    save_articles.py --prefetched reads these same files, so a fixture drawn
    from one is byte-identical to what the saver processed."""
    path = BROWSER_DIR / f"{domain}.jsonl"
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if d.get("url") == url and d.get("html"):
                    return d["html"]
    except OSError:
        return None
    return None


def fixture_path(name):
    return FIXTURE_DIR / f"{name}.html.gz"


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"fixtures": []}


def capture(entry, refresh=False, refresh_network=False):
    path = fixture_path(entry["name"])
    if path.exists() and not (refresh or refresh_network):
        return "kept", path.stat().st_size
    if refresh_network:
        html = sa.fetch_html(entry["url"])
        write_fixture(path, html)
        return "network(forced)", path.stat().st_size
    # Source order: the browser-tier prefetch store, then the HTML cache, then
    # the network. The first two hold the page this corpus ACTUALLY saw — and
    # for a browser_render_scrape domain the network is not an option at all,
    # since a plain HTTP client gets a 403 or an empty JS shell. Freezing what
    # the pipeline really processes is the point of a fixture.
    html = read_browser_prefetch(entry["domain"], entry["url"])
    source = "browser-prefetch"
    if html is None:
        html = sa.read_html_cache(entry["domain"], entry["url"])
        source = "cache"
    if html is None:
        html = sa.fetch_html(entry["url"])
        source = "network"
    # ⚠️ --refresh re-CAPTURES; it must not change WHERE from. Skipping the
    # first two sources sends a browser_render_scrape domain to a plain HTTP
    # client, which is exactly what cannot fetch it — measured, that overwrites
    # a good fixture in place with a 403 body or an empty JS shell, and the
    # suite then blames the extractor ("extraction REGRESSED to 0 chars").
    # Use --refresh-network to deliberately go back to the network.
    write_fixture(path, html)
    return source, path.stat().st_size


# The record keys whose value is a property of the frozen page rather than a
# judgement about it, so they are re-derived on capture instead of seeded.
FIELD_KEYS = ("image", "image_alt", "canonical", "language", "section_path",
              "tags", "updated")

FIELD_NOTES = {
    "why_exact": (
        "expect_fields pins EXACT values, not truthiness. A truthiness gate "
        "passes on a relative URL stored raw, a truncated language tag and a "
        "reversed breadcrumb list — the regressions these fields are prone to."),
    "language_is_declared_not_detected": (
        "jsonld_empty_body__24chasa and not_article__section_page declare "
        "lang=\"en\" while publishing Bulgarian (verified in the frozen HTML). "
        "`language` records what the page SAYS. It must never gate the "
        "non-Bulgarian quality class on its own."),
    "image_present_is_not_image_usable": (
        "not_article__section_page and known_gap__listing_page resolve to the "
        "SITE LOGO, and known_gap__terms_page to nothing at all. Consumers "
        "must survive a wrong image, not only a missing one."),
    "epoch_dates": (
        "jsonld_empty_body__24chasa emits dateModified as a bare Unix epoch. "
        "Before normalize_date grew _epoch_dt it was stored verbatim as the "
        "string '1787689400', which nothing downstream could tell from a real "
        "timestamp."),
}


def read_fixture(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return f.read()


def write_fixture(path, html):
    """Atomic, like every other writer in this pipeline. A fixture half-written
    by an interrupted capture is a corrupt gzip that reads as a regression."""
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        f.write(html)
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true",
                    help="re-capture frozen pages from their ORIGINAL source "
                         "(browser prefetch / HTML cache / network, in that "
                         "order)")
    ap.add_argument("--refresh-network", action="store_true",
                    help="deliberately re-fetch from the network. NOT safe for "
                         "a browser_render_scrape domain, which a plain HTTP "
                         "client cannot fetch at all")
    ap.add_argument("--rebaseline-fields", action="store_true",
                    help="accept the metadata a fixture NOW extracts as the "
                         "new expectation. Without it a changed value is "
                         "reported and the old one kept, so an extractor "
                         "regression cannot be recorded as truth by the "
                         "command the failure message tells you to run.")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        # Read the SEED, not the generated manifest: a newly seeded fixture is
        # invisible to a manifest-driven listing, which is the one moment you
        # would run --list to check on it.
        on_disk = load_manifest()
        declared = {e["name"] for e in on_disk["fixtures"]}
        for e in MANIFEST_SEED:
            p = fixture_path(e["name"])
            size = f"{p.stat().st_size / 1024:.0f} KB" if p.exists() else "MISSING"
            flag = "" if e["name"] in declared else "  (seeded, not captured)"
            print(f"{e['name']:34} {size:>9}  {e['domain']}{flag}")
        orphans = declared - {e["name"] for e in MANIFEST_SEED}
        for name in sorted(orphans):
            print(f"{name:34} {'ORPHAN':>9}  (in the manifest, not in the seed)")
        return 0

    kept, failed = [], []
    total = 0
    for entry in MANIFEST_SEED:
        try:
            source, size = capture(entry, refresh=args.refresh,
                                   refresh_network=args.refresh_network)
        except Exception as e:
            failed.append((entry["name"], f"{type(e).__name__}: {e}"))
            print(f"FAILED {entry['name']}: {type(e).__name__}: {e}",
                  file=sys.stderr)
            continue
        total += size
        kept.append(entry)
        print(f"{entry['name']:34} {size/1024:6.0f} KB  ({source})")

    # ⚠️ Write the manifest only when EVERY seeded fixture was captured.
    # Dropping a failed entry silently shrinks the suite: the manifest still
    # agrees with the files on disk, every test passes, and a failure class
    # quietly stops being covered.
    if failed:
        print(f"\n{len(failed)} of {len(MANIFEST_SEED)} fixtures could not be "
              f"captured; the manifest was NOT rewritten:", file=sys.stderr)
        for name, why in failed:
            print(f"  {name}: {why}", file=sys.stderr)
        return 1

    # The metadata fields are DERIVED from the frozen page, not hand-seeded:
    # what `og:image` or the breadcrumb list says is a property of the HTML,
    # so re-reading it here is a re-measurement rather than a re-baseline. The
    # gate bands above stay in the seed because those encode a judgement.
    #
    # ⚠️ Pinned EXACTLY, never as truthiness. A "the field is set" assertion
    # passes on a relative URL stored raw, a truncated language tag and a
    # breadcrumb list in reverse order — the three regressions these fields
    # are actually prone to.
    #
    # ⚠️ REFUSES to move an existing expectation unless asked. A plain run
    # re-derives all 18 — so adding ONE fixture silently re-baselined every
    # other one, and an extractor regression would be recorded as the new
    # truth by the very command the failure message tells you to run. New
    # fixtures are filled in; changed ones are reported and left alone until
    # --rebaseline-fields says the change is intended.
    rebaseline_fields = args.rebaseline_fields
    prior = {e["name"]: e.get("expect_fields")
             for e in load_manifest().get("fixtures", [])}
    moved = []
    for entry in kept:
        html = read_fixture(fixture_path(entry["name"]))
        rec, _ = sa.extract_record(html, entry["domain"], entry["url"])
        fresh = {k: rec.get(k) for k in FIELD_KEYS}
        was = prior.get(entry["name"])
        if was is not None and was != fresh and not rebaseline_fields:
            moved.append((entry["name"],
                          sorted(k for k in FIELD_KEYS
                                 if was.get(k) != fresh.get(k))))
            entry["expect_fields"] = was
        else:
            entry["expect_fields"] = fresh
    if moved:
        print(f"\n⚠️  {len(moved)} fixture(s) extract DIFFERENT metadata than "
              f"the manifest records. Kept the old values — re-run with "
              f"--rebaseline-fields only if the change is intended:",
              file=sys.stderr)
        for name, keys in moved:
            print(f"  {name}: {', '.join(keys)}", file=sys.stderr)

    tmp = MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"fixtures": kept, "field_notes": FIELD_NOTES},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    tmp.replace(MANIFEST)
    print(f"\n{len(kept)} fixtures, {total/1024/1024:.1f} MB total -> "
          f"{MANIFEST.relative_to(SCRIPT_DIR.parents[1])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
