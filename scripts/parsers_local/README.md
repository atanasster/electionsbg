# Local-elections parser tree

Parses Bulgarian local-election bundles published by ЦИК. Three URL
shapes are supported:

- `results.cik.bg/mi{YYYY}/tur{1,2}/rezultati/{oik}.html` —
  modern regular cycles (`mi2019`, `mi2023`, future `mi2027`).
- `results.cik.bg/chmi{YYYY}-{YYYY}/{YYYY-MM-DD}_chastichen/` —
  partial elections triggered when a mayor resigns mid-term.
- `results.cik.bg/{minr2015,mipvr2011}/tur{1,2}/mestni/{oik}.html` —
  historical joint-cycle archives (2015 was joint with the national
  referendum; 2011 with the presidential election). Same shape, but
  `mestni/` instead of `rezultati/`. The 2015 archive also splits
  Sofia (24) / Plovdiv (6) / Varna (5) район mayor races into separate
  `mestni/{parentOik}_{rayonOik}r.html` subpages, harvested by the
  ingest cascade's targeted second sweep and merged into the parent
  município's `districts[]` by the parser's post-pass.

See [`.claude/skills/update-local-elections/SKILL.md`](../../.claude/skills/update-local-elections/SKILL.md)
for the operator manual; this file documents the parser internals.

Outputs per-município JSON bundles + a cycle catalogue under
`data/<cycle>/`, mirroring the per-cycle layout of the parliamentary
parser tree.

## Section-level CSV ingest (votes / turnout per polling station)

The per-município HTML pages carry the council **mandates** but not always
the council **votes** — 2015's summary page is mandates-only, so its
`council[].totalVotes` shipped all-zero. The per-section vote/turnout data
lives only in CIK's CSV bundle. `--local-csv <slug>` automates the whole
acquisition:

```bash
npm run data -- --local-csv minr2015   # or mi2019
```

It downloads the bundle through the CF-clearing headed Playwright session
(`cikDownloadFile`, see [`cik_fetch.ts`](./cik_fetch.ts)), extracts it with a
dependency-free CP866-aware reader ([`extract_bundle.ts`](./extract_bundle.ts))
under `raw_data/<folder>/ТУР1/`, then re-parses the cycle. The bundle URL is
**not** a uniform `csv.zip` — see [`download_csv_bundle.ts`](./download_csv_bundle.ts)
for the per-cycle map (`minr2015/tur1/mi2015.zip`, `mi2019/csv.zip`, …).

On re-parse, [`augment_sections.ts`](./augment_sections.ts) + the HTML bundles
combine additively (the HTML still drives obshtina resolution + the elected
list): council `totalVotes`/`pctOfValid` get backfilled (and vote-winning
seatless parties appended), the council-ballot `protocol` gets real
registered/actual/valid turnout, and per-município section shards are written
to `data/<cycle>/sections/<obshtinaCode>.json` (consumed by `LocalSectionsTile`).

The section shards also carry **per-station mayor votes** so the section map can
colour by leading mayoral candidate (not just council party): `augment_sections`
reads the `КО` (община mayor) + `КР` (район mayor) race folders and attaches
`mayorVotes`/`mayorValid` + `rayonMayorVotes`/`rayonMayorValid` to each section.
Two sharp edges: `КО` may ship several dated `votes_*.txt` (original + a later
1-município re-count) — they are **merged later-date-wins**, because the single
file `resolveRaceFile` picks is the tiny re-count (would drop everyone else's
mayor votes). And Sofia районs (`S2***`) get their own per-район light index
(`sections/S2***.json`, ~50KB) rather than narrowing the ~2MB `SOF.json` on the
client; the heavy per-station detail files stay shared under `sections/SOF/`.

### Section coordinates (map + top-sections tiles)

The section shards ship turnout + per-party council votes but **no GPS**. A
separate idempotent pass stamps `longitude`/`latitude`/`address` onto each
section from the latest parliamentary election that ships coordinates — the
9-digit CIK section code is shared across parliamentary and local cycles, so
the parliamentary GPS transfers verbatim:

```
npm run data -- --local-coords
```

[`backfill_local_section_coords.ts`](./backfill_local_section_coords.ts) reads
`data/<YYYY_MM_DD>/sections/by-oblast/*.json` (parliamentary) and patches every
local `data/<cycle>/sections/<obshtinaCode>.json`. Re-run after a new
parliamentary cycle lands fresh coordinates, or after re-ingesting local
sections. It is also folded into `--all`. Commit the patched shards.

**2007 (regular cycle) — separate ЦИКМИ archive.** The oldest regular cycle,
2007, predates BOTH the modern results.cik.bg page model and the section-CSV
bundle. It lives on its own legacy domain `mi2007.cik.bg`, shipped as two
static-HTML ZIPs: `results_1.zip` (round 1: mayor + full council + kmetstva +
район mayors) and `results_2.zip` (round-2 runoffs). One UTF-8 page per place,
organised by oblast folder (`<oblast2>/<obshtina4>.html`,
`<oblast2>/<settlement8>.html`, `<oblast2>/r<code>.html`); tables are keyed by
`<caption>` and resolution comes from the `<ol id="breadcrumbs">`. Ingested by a
dedicated path that reuses the shared `parseMayorTable` (the mayor/kmetstvo/район
tables are 2007-template-identical) plus a 2007-specific council parser
(`parseMi2007Council`, for the `<p><span>N.</span>NAME</p><ol><li>` cell). One
manual operator step — the data has not changed since 2007, so it is NOT in the
watcher or `--all`:

```bash
npm run data -- --local-ingest mi2007            # downloads + extracts both ZIPs (Playwright/CF), parses, writes data/2007_10_28_mi/
```

Turnout stays `{0,0,0}` (2007 publishes activity only in a separate `activity1/`
archive, like the other HTML-only cycles). Gotcha burned: the Добрич city/rural
pair is labelled inconsistently — the CITY obshtina page reads "община град
Добрич" and the RURAL município's villages split between "Добричка" and a bare
"Добрич"; `MI2007_OBSHTINA_RENAME` in `ingest_mi2007.ts` maps both to the
canonical labels before resolution.

**2008–2011 partials.** results.cik.bg archives exactly ONE partial in the
2007-2011 council term: the **2009-11-15** Sofia by-election (Столична mayor —
Йорданка Фандъкова — + Район Панчарево), under the `chmi2008-2010` umbrella. It
is a single caption-based page (2007 template), ingested by `ingest_chmi2009.ts`
and surfaced on `/local/chmi`. Also a one-off manual step:

```bash
npm run data -- --local-ingest "chmi2008-2010/2009-11-15_chastichen"
```

(An older `chmi2004-2006` umbrella exists on results.cik.bg with many 2004-2006
partials, but it predates the parliamentary-coverage floor of 2005 and is not
ingested.)

**By-election turnout (числови данни).** A chmi rezultati page carries vote
tallies only, so a partial bundle ships with a zeroed `protocol`. But ЦИК serves
the per-протокол "Числови данни" as clean HTML at
`<cycle>/tur{1,2}/protokoli/<el>/<oik>/<aggId>.html` (one aggregate page per ОИК
— район/kmetstvo/община; `<aggId>` = район/kmetstvo код or literal `ik`, found
via the `ik-*` sentinel in `pdf/data.js`'s `HAS_PDF`). `ingest_byelection_turnout.ts`
fetches the aggregate page for each район/община-mayor bundle and writes the
exact registered + гласували totals (`parse_protocol_chislovi.ts`) into
`protocol`, so the dashboard shows the official активност instead of an estimate.
Verified район Средец 2026-06-14: aggregate == Σ per-section == 26 800 registered
/ 3 520 voted → 13.13%. **Exact + deterministic — no OCR** (the числови-данни is
HTML; the scanned PDFs at `pdf/<el>/<oik>/<id>.pdf` are only a fallback). Runs
automatically at the tail of every current-style `chmi*` `--local-ingest` (so it
survives the protocol-zeroing re-parse); re-run standalone with:

```bash
npm run data -- --local-byelection-turnout "chmi2024-2026/2026-06-14_chastichen"
```

Kmetstvo by-elections are skipped (mayor.round1 empty; turnout never surfaces on
the mayor card). The bundle stores the synthetic obshtinaCode as `oikCode`, so
the real 4-digit ОИК is recovered from the raw HTML's `data-ik` keyed by place
name.

The same step also writes a **by-election section shard** (`data/<cycle>/sections/<obshtinaCode>.json`): the числови-данни is served per-section too (`protokoli/<el>/<oik>/<9digit>.0.html`, `.1` = paper-only fallback), each carrying per-candidate votes (combined paper+machine = last table per ballot №). `buildSectionShard` parses every station and joins lat/lon + address from the latest regular `_mi` shard (the protocol HTML has no coords) — so the partial gets its own per-section **mayor map** (`rayonMayorVotes`/`mayorVotes`) on the dashboard, exactly like a regular cycle. Finally it rebuilds `local_chmi_history.json` so the turnout reaches the `/local/chmi` feed + the `chmiEvents` AI tool. Known gap: Пловдив/Варна city-районs read their *parent-city* shard, so a город-район by-election there (none exist yet) would need a per-parent-city write; Sofia районs (`S2xxx`) and full-município mayor by-elections both work.

**Cycle coverage:** 2007 + 2011 + 2015 + 2019 + 2023 ingested. The `votes.txt` shape
varies by era: 2015/2019 are **triplets** (`party ; valid ; invalid`); 2023
added machine voting → a leading `№ формуляр` field + **quadruplets**
(`party ; total ; paper ; machine`); `parseLocalVotes` auto-detects both.
**2011** is a separate schema entirely (CP1251 content, `общински съветници`
folder, `coalitions` file, **pairs** `party ; votes`, no admin/serials columns)
handled by a dedicated reader, `augment_sections_2011.ts` — the orchestrator
falls back to it when the modern ОС folder is absent. (2011's HTML council
table was incomplete — it omitted also-ran parties — so the section CSV both
completes the vote share and adds turnout + per-station data.)

## Manual acquisition (fallback)

> The Cloudflare-bypass automation above (`--local-csv`) is the normal path.
> If it fails (e.g. CIK moves a bundle), drop the files into
> `raw_data/<cycle>/` by hand and run `npm run data -- --local --local-date <cycle>`.

### 1. Download `csv.zip` for the cycle

`results.cik.bg` sits behind a Cloudflare anti-bot challenge — plain
`curl` / `wget` returns HTTP 403. The simplest workaround is a browser
session that has already cleared the challenge.

For mi2023 (29.10.2023 / 5.11.2023):

```
https://results.cik.bg/mi2023/csv.zip
```

For mi2019 (27.10.2019 / 3.11.2019):

```
https://results.cik.bg/mi2019/csv.zip
```

For partials (the URL templates differ by cycle umbrella — check the
selector at `https://results.cik.bg/chmi2024-2026/`):

```
https://results.cik.bg/chmi2024-2026/<YYYY-MM-DD>_chastichen/csv.zip
```

### 2. Extract with CP866 filename fix

The zip uses CP866-encoded Cyrillic directory names ("ТУР1", "ОС", "КО",
"КК", "КР") that Node's `unzipper` decodes as mojibake. The Python
`zipfile` module hits the same issue but offers a clean fix path:

```bash
cd raw_data
mkdir 2023_10_29_mi
python3 - <<'PY'
import zipfile, os
src = "/path/to/downloaded/csv.zip"
dst = "2023_10_29_mi"
z = zipfile.ZipFile(src)
for info in z.infolist():
    info.filename = info.filename.encode("cp437").decode("cp866")
    z.extract(info, dst)
PY
```

After extraction the layout should be:

```
raw_data/2023_10_29_mi/
  ТУР1/
    readme_29.10.2023.txt
    ОС/cik_parties_29.10.2023.txt
    ОС/local_parties_29.10.2023.txt
    ОС/local_candidates_29.10.2023.txt
    ОС/sections_29.10.2023.txt
    ОС/protocols_29.10.2023.txt
    ОС/votes_29.10.2023.txt
    ОС/preferences_29.10.2023.txt
    КО/...  (no preferences)
    КК/...
    КР/...   (Sofia/Plovdiv/Varna only)
  ТУР2/
    readme_05.11.2023.txt
    КО/...
    КК/...
    КР/...
```

The parser reads from `ТУР1/ОС/*` (council ballot — present for every
município) as the source-of-truth for the OIK catalogue and for protocol
totals. Other folders are read defensively (missing-file safe) since
some cycles don't have all four race types.

### 3. Mirror per-município HTML pages

The TXT bundle has per-section votes but NOT the elected councillor
list. That comes from `results.cik.bg/mi{YYYY}/tur{1,2}/rezultati/{oikCode}.html`
where each council party row has a Мандати column and each candidate
row carries a `candidate-elected` CSS class.

To mirror ~265 pages without rate-limiting yourself off Cloudflare:

1. Open `https://results.cik.bg/mi2023/tur1/index.html` in a browser
   you'll use for the download.
2. Open dev-tools → Network → reload → copy a successful request as
   `cURL (bash)`. The `cf_clearance` cookie is the bit that matters.
3. Save the curl flags to a file `~/.cik_cookie.sh`, e.g.:
   ```bash
   export CIK_COOKIE='cf_clearance=...; __cf_bm=...'
   export CIK_UA='Mozilla/5.0 ...'  # match your browser's UA exactly
   ```
4. Mirror with sequential per-município pulls:
   ```bash
   source ~/.cik_cookie.sh
   mkdir -p raw_data/2023_10_29_mi/html/tur1 raw_data/2023_10_29_mi/html/tur2
   for oik in $(seq -f "%04g" 1 99 ; seq -f "%04g" 100 9999); do
     # Skip already-downloaded files.
     [ -s "raw_data/2023_10_29_mi/html/tur1/${oik}.html" ] && continue
     curl -sS -A "$CIK_UA" -b "$CIK_COOKIE" \
       -o "raw_data/2023_10_29_mi/html/tur1/${oik}.html" \
       "https://results.cik.bg/mi2023/tur1/rezultati/${oik}.html"
     sleep 1
   done
   # Drop 404s (most OIK codes don't exist; valid ones are sparse):
   find raw_data/2023_10_29_mi/html/tur1 -name "*.html" -size -2k -delete
   # Same for tur2 — many municípios didn't go to runoff so most pulls 404.
   ```
5. Sanity-check: the mi2023 cycle should leave ~265 non-empty tur1 files
   and roughly 80–100 tur2 files.

A future step-2 deliverable replaces all of the above with a
Playwright/TLS-fingerprint watcher that runs from CI.

### 4. Run the parser

```bash
npm run data -- --local --local-date 2023_10_29_mi
```

Or to reprocess every local cycle currently in `raw_data/`:

```bash
npm run data -- --local --all
```

The parser writes to `data/<cycle>/`:

```
data/2023_10_29_mi/
  index.json                      ← cycle catalogue + national rollups
  municipalities/BLG03.json       ← per-município bundle (mayor, council, kmetstva)
  municipalities/SOF.json
  ...
  dashboard/demographic_cleavages.json  ← leading council parties × Census 2021
                                          Pearson correlations (cycle dashboard tile)
  _unmatched_coalitions.json      ← coalition names whose canonical lookup failed
```

`dashboard/demographic_cleavages.json` is emitted automatically for every
regular `_mi` cycle by `build_local_demographics.ts` (the council-vote analogue
of the parliamentary `scripts/parties/build_demographics.ts`). To regenerate it
for all cycles straight from the already-written bundles — no HTML re-parse —
run `npx tsx scripts/parsers_local/build_local_demographics.ts [cycle]`.

### 5. Curate unmatched coalitions

If `_unmatched_coalitions.json` has entries, open it and add overrides
to `scripts/parsers_local/local_coalition_overrides.ts`:

```ts
{
  rawName: "Местна коалиция Граждани за X (ВМРО-БНД, БДЦ)",
  primaryCanonicalId: "vmro",
  memberCanonicalIds: ["vmro", "bdc"],
}
```

…or, if the same fragment appears across many local coalitions:

```ts
{ fragment: "ВМРО-БНД", canonicalId: "vmro" }
```

Re-run the parser; the file should now be empty (or close to it).

## Schema notes

See [`types.ts`](./types.ts) for the canonical TypeScript shapes the
parser emits. The front-end mirrors these in `src/data/local/types.ts`.

Coalition handling follows the **primary-party credit** rule: the first
canonical-party-id matched in the coalition string gets 100% of the
votes credited in national rollups. Member ids are preserved on each
record so the UI can show the full coalition on hover. Independent
committees ("Инициативен комитет ...") bucket to the special
`independent` canonical id.

National vote rollup uses **council R1 votes only** — mayoral votes are
person-centric, not party-centric, and conflating them with council
votes would overweight charismatic independents. The per-município
bundle keeps full mayor vote totals for display purposes; only the
`index.json` `councilVoteShare` aggregate excludes them.
