# Extraction fixtures

Frozen real pages, one per failure class the body extractor in
`news/scripts/save_articles.py` has actually met. Driven by
`test_save_articles.py::ExtractionFixtures`; captured and re-captured by
`news/scripts/capture_fixtures.py`.

## Why these are committed when `news/data/` is not

`BodyExtractor` is ~150 lines of heuristics and every rule in it was learned
from one specific page — windows-1251 on moreto.net, the iubenda cookie banner
in glasove.com's rendered DOM, the `with-sidebar` class that names the MAIN
content column and once silently zeroed every article on that domain. None of
that was pinned by a test, so the only way to learn whether a change broke
something was a 4,700-page network sweep that reports a number moved and cannot
say which edge did it.

## Provenance and scope

Each file is a **point-in-time capture of a third party's page**, stored gzipped
and used as test input only. Nothing in this repository renders, publishes or
serves them: the assertions read character counts, paragraph counts, extracted
titles and gate verdicts. They are the smallest set that covers the known
classes — 18 pages, ~1 MB — and a class is added only when a real defect
motivates one.

`expectations.json` records, per fixture, the source domain and URL, so any page
here can be traced back to what it is a capture of.

## Editing

**Edit `MANIFEST_SEED` in `capture_fixtures.py`, never `expectations.json`.**
The manifest is generated; the next capture run overwrites it. A test asserts
the two agree, so an edit in the wrong place fails loudly rather than being
silently reverted.

```bash
python3 news/scripts/capture_fixtures.py            # capture anything new in the seed
python3 news/scripts/capture_fixtures.py --list     # what is frozen, and what is only seeded
python3 news/scripts/capture_fixtures.py --refresh  # re-capture from the ORIGINAL source
```

`--refresh` deliberately re-reads the same source tier a fixture came from
(browser prefetch → HTML cache → network). Use `--refresh-network` only for a
domain a plain HTTP client can actually fetch: for a `browser_render_scrape`
domain the network returns a 403 or an empty JS shell, which would overwrite a
good fixture in place and make the suite blame the extractor.

## The `known_gap` fixtures

Three fixtures — `known_gap__terms_page`, `known_gap__donate_page`,
`known_gap__listing_page` — pin behaviour we consider **wrong**: a terms-of-use
page, a donation page and a section listing are each stored as long "articles",
because the article gate passes on paragraph count alone.

The obvious discriminator (no Article JSON-LD **and** no publish date) is not
safe — svobodnoslovo.eu carries no dates anywhere and its articles are real, so
that rule would delete a whole domain. Whoever narrows the gate should make
these three flip, then update the seed and drop the `known_gap` flag
deliberately. A test asserts each one still says "KNOWN GAP" in its `why`, so
none can quietly stop being read as a defect.
