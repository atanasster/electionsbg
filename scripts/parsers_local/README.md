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

**Cycle coverage:** 2011 + 2015 + 2019 + 2023 ingested. The `votes.txt` shape
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
  _unmatched_coalitions.json      ← coalition names whose canonical lookup failed
```

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
