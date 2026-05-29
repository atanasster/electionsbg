---
name: update-council-minutes
description: Ingest new municipal-council (общински съвет) resolutions + aggregate vote tallies (за/против/въздържал) + per-councillor named votes where available into data/council/. Use when the daily watch report flags `council_minutes` as changed, when the user asks to refresh council resolutions / council votes / общински решения, when adding a new município parser to the dispatcher, or after a fresh git clone if data/council/index.json carries an empty resolutionsByObshtina for the wired municipalities.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Council Minutes skill

Pulls per-município council resolutions + aggregate vote tallies (and per-councillor named votes where the protocol PDF carries them) from each município's own website. Writes canonical JSON to `data/council/{obshtinaCode}/{YYYY}/` and updates the `resolutionsByObshtina` slot in `data/council/index.json` that the React hook `useCouncilMinutes` reads.

There is **no central register**. Bulgaria's РМС 436/2017 only mandates the narrow чл.45 ЗМСМА "returned-decisions" register on data.egov.bg (verified by sampling — see memory `project-council-votes-ingest`). Every município publishes its own протоколи, on its own CMS, in its own format. The ingest is a fleet of per-município parsers under `scripts/council/parsers/`.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `Council resolutions: N município(s) changed` | Run incremental ingest for ALL wired munis (`npm run council:scrape`) |
| User asks to "refresh council resolutions" / "update council votes" | Same — incremental |
| User asks for one município only ("refresh Стара Загора council") | `npm run council:scrape -- --only <code>` |
| `data/council/index.json` shows empty `resolutionsByObshtina` (fresh clone) | Cold-start ingest — drop the per-município watermarks from `state/ingest/council_*.json` and run a `--since-year` of 2 years back |
| Adding a new município to the fleet | See "Adding a parser" below — Phase 0 discovery + a per-município parser file + dispatcher entry |
| `process-watch-report` invokes this skill | Reads watermarks from `state/ingest/council_<obshtina>.json`, runs incremental ingest, stamps marker |

## Step 1 — Prerequisites

- `pdftotext` (poppler-utils) on PATH — required for native-text PDF extraction. `which pdftotext` should return a binary; if missing, `brew install poppler` on macOS.
- `unzip` on PATH — required for DOCX text extraction.
- `data/officials/municipal/index.json` populated — required when running with `--per-councillor` (provides the councillor roster for the name→slug join). Run the `update-officials` skill first if missing.
- `GEMINI_API_KEY` in `.env.local` — required ONLY when running with `--ocr` (used for scanned-image protocol fallbacks; not needed for the wired-native-text municipalities).

## Step 2 — Probe sources (optional pre-flight)

If you suspect a município's website has migrated or a recipe has rotted:

```bash
npm run council:discover            # probe all 10 recipes for liveness
npm run council:discover -- --only SOF --verbose
```

Reports HTTP status + content-type + byte count per município index URL + sample PDF. A recipe that fails here will silently produce zero records when scrape.ts runs — re-discover the URL, update `data/council/sources.json`, then re-scrape.

## Step 3 — Incremental scrape

```bash
npm run council:scrape                             # all wired munis, since last ingest
npm run council:scrape -- --only VTR01             # one município
npm run council:scrape -- --only VTR01 --since-year 2025 --max 5
npm run council:scrape -- --only VTR01 --per-councillor   # Phase 2 join to roster
npm run council:scrape -- --only SZR01 --ocr       # Phase 3 — enable Gemini OCR fallback
npm run council:scrape -- --only VTR01 --dry       # parse, don't write index/shards
```

### What it does

1. Reads `data/council/sources.json` for per-município recipes (tier, format, indexUrl, fetch strategy).
2. Per município, dispatches into `scripts/council/parsers/<muni>.ts`:
   - Walks the município's session/протокол index page.
   - Downloads each session's source artefact (PDF / DOCX / HTML).
   - Extracts text via `pdftotext -layout` (PDF), `unzip + strip <w:t>` (DOCX), or `cheerio` (HTML). Falls back to Gemini Vision OCR if `looksLikeScannedPdf` triggers and `--ocr` is on.
   - Runs the three tally regexes (digit-first / label-first / shorthand) to extract aggregate `{for, against, abstain, method}`; runs the resolution-marker regex to anchor each tally to a Решение №.
   - When `--per-councillor` is set, lifts the numbered name-vote block preceding each named-method tally and joins to `data/officials/municipal/` by normalised (first+last) name.
3. Merges results into `data/council/index.json` via `lib/index_writer.ts`:
   - Preserves the original `tags`/`source`/`indexName` scaffolding;
   - Updates `resolutionsByObshtina[<obshtina>]` with the latest 200 (slim — `tally.perCouncillor` stripped to keep the index lean);
   - Writes per-município **votes shards** to `data/council/votes/<obshtina>.json` carrying the per-councillor breakdown keyed by resolution id (only for munis with named-vote data — VTR01 + SOF today). These power the "Как гласуваха в съвета" MyArea tile (`MyAreaCouncilVotesTile`);
   - Writes per-resolution shards at `data/council/{obshtina}/{YYYY}/<id>.json` carrying the full record including perCouncillor (durable history).
4. Writes the watermark to `state/ingest/council_<obshtina>.json` with the latest seen date.

### Expected output (one município)

```
→ VTR01 Община Велико Търново (sinceDate=2026-05-07, sinceYear=auto)
  [VTR01] fetching 3 protocol(s)
    + prot 40 (2026-05-07): 28 resolution(s) · roster join 443/545 exact, 102 unmatched
    + prot 39 (2026-04-29): 1 resolution(s)
    + prot 37 (2026-03-05): 30 resolution(s) · roster join 693/854 exact, 161 unmatched
  VTR01: +9 new, 50 updated, 59 total in index

→ done · 9 new · 50 updated · 3 protocol(s) touched · 0 skipped · 0 error(s)
```

If a município's recipe is marked `phase1Defer: true` in sources.json (e.g. BLG03 — legacy directory listing dead, migrated to e-obs.online), the scraper logs `skip ... — phase1Defer` and moves on.

## Step 4 — Verify

```bash
node -e "
const d = require('./data/council/index.json');
for (const [k, v] of Object.entries(d.meta || {})) {
  console.log(k, '·', v.name, '·', v.resolutionCount, 'resolutions ·', v.lastIngest.slice(0, 10));
}
console.log('---');
const code = process.argv[1] || 'VTR01';
const rs = d.resolutionsByObshtina[code] || [];
console.log(code, ':', rs.length, 'rows');
console.log('first:', rs[0]?.id, '|', rs[0]?.title?.slice(0, 60));
" VTR01
```

Spot-check: open the most recent resolution's `sourceUrl` in a browser and confirm the tally numbers match the document. Drift here usually means the source CMS changed the protocol format — fix the per-município parser, don't fix the regex globally.

## Step 4.5 — Refresh the derived councillor signals + conflicts

Two derivations sit downstream of the votes shards and MUST be rebuilt after any ingest, otherwise the "standouts" strip in the unified `MyAreaCouncilTile` and the conflict-warning chips on `/officials/<slug>` stay stale. Both scripts walk `data/council/votes/*.json` so they pick up new munis the moment the shard exists:

```bash
npx tsx scripts/officials/build_councillor_signals.ts
npx tsx scripts/officials/build_councillor_conflicts.ts
```

Outputs land at `data/officials/derived/councillor_signals.json` (≈ 50 KB — per-councillor attendance + dissent counts, used by the standouts strip) and `data/officials/derived/councillor_conflicts.json` (≈ 0.1 KB today; populated when conflict-detection hits a hit — currently `0 flags across 0 resolutions` since conflict-matching against company-officer ties is opt-in and few tier-A municípios have full per-decision bodies indexed). The `COUNCIL_TO_OFFICIALS` map at the top of each script names which munis feed the join — every new parser landing in the dispatcher needs the same one-line entry added.

## Step 5 — Stamp the ingest marker

For watcher / process-watch-report integration:

```bash
npx tsx scripts/stamp-ingest.ts update-council-minutes --summary "<N> município(s), <M> protocols touched"
```

(The scraper writes per-município watermarks at `state/ingest/council_<obshtina>.json` automatically; the parent `state/ingest/update-council-minutes.json` is what `process-watch-report` reads.)

## Adding a new município parser

1. **Phase 0 — discovery**: open the município's council site, identify the session/протокол index URL, the per-session URL pattern, and the format (pdf-text / docx / html / pdf-scan).
2. Add a recipe block to `data/council/sources.json` under `munisByObshtina`. Run `npm run council:discover -- --only <code>` to confirm liveness.
3. Create `scripts/council/parsers/<code>.ts` — copy the closest existing parser (vtr.ts for full-protocol PDFs with per-councillor blocks, szr.ts for per-decision PDFs with aggregate-only tallies). Update the obshtina code, BASE URL, and per-município URL/regex constants.
4. Register the parser in `scripts/council/scrape.ts` `DISPATCHERS`.
5. Run `npm run council:scrape -- --only <code> --since-year <currentYear-1> --max 2 --dry` and verify the protocol/decision counts before writing real records.

The framework is parser-agnostic — `lib/tally.ts`, `lib/pdf_text.ts`, `lib/docx.ts`, `lib/index_writer.ts` are reused by every parser.

## Currently wired municipalities

See `data/council/sources.json` for the authoritative list. As of 2026-05-29:

| Obshtina | Tier | Format | Tally | Per-councillor | Status |
|---|---|---|---|---|---|
| VTR01 (Велико Търново) | A | pdf-text | yes | yes (170 sessions, ~85% roster match) | full coverage; backfill 2026-05-29 re-ingested the entire 2024-2026 window (was 38 sessions) after the SZR12 VOTE_LINE_RE fix unlocked entries that previously silently failed on names without leading whitespace before the colon |
| SZR01 (Стара Загора) | A | pdf-text | yes | no | titles + tally + result |
| RSE01 (Русе) | A | docx | yes | no | tally + result; titles empty (no ОТНОСНО marker in DOCX) |
| PVN01 (Плевен) | A | docx | yes | no | tally + result; titles empty |
| SLV01 (Сливен) | A | pdf-text | no | no | titles only (FineReader 15 clean Cyrillic, but ПРЕПИС format strips tallies) |
| VAR01 (Варна) | B | pdf-text | no | no | titles only (Препис-извлечение format) |
| BGS01 (Бургас) | A | pdf-text via Drupal /node | yes (86) | yes (~94% roster match) | full coverage via `--per-councillor` — pulls the parallel `protokol-N-sayt.pdf` from `/video` while keeping the za-sayta extraction for Phase-1 decision metadata |
| PDV01 (Пловдив) | B | html via WP category | no | no | titles only (WordPress category listings, no Playwright needed) |
| SOF (Столична) | A | pdf-text + Gemini OCR via Playwright | yes (77) | yes (75 sessions, ~89% roster match) | full coverage via `--ocr --per-councillor`; full protokol-N PDFs have ABBYY FineReader 14 Cyrillic→Latin mojibake so OCR is mandatory — costs ~$1.85/session |
| GAB05 (Габрово) | A | pdf-text via Wayback CDX | yes (244 across 12 protokols) | partial — 2025+ only (2024 protokols ship aggregate-only) | Apache directory listing 403-blocked; discovery uses Wayback CDX index. 2024 protokols have compact "Т. 1: За – 9 Против – 10 Въздържали се – 9" aggregate tallies but no per-councillor table; 2025+ added a full tabular per-councillor block (NN  Name  ЗА|ПРОТИВ|ВЪЗДЪРЖАЛИ СЕ|отсъства). |
| SZR12 (Казанлък) | A | pdf-text via Wayback CDX + brute-force | yes | yes | Nuxt-rendered category page doesn't surface protokol links via curl; discovery is Wayback CDX + a focused brute-force probe (Protokol_{N}_SAIT.pdf across {YYYY-MM} dirs, current year only). Per-councillor block in standard "<N>. <Name>: <vote>" form. |
| HKV34 (Хасково) | B | pdf-text via Wayback CDX | yes | no | 89 protokols at haskovo.bg/uploads/posts/{YYYY}/protokol-{N}.pdf. Born-digital text-layer. Tally form is novel — chair-announcement prose ("Т.ЗАХАРИЕВА: С 37 гласа „за\", без „против\" и „въздържали се\""); parser pre-processes the text to rewrite it into the canonical V. Tarnovo form so the shared SUMMARY_RE_DIGIT_FIRST matches. NO per-councillor block — protokol records the chair's totals, not the individual readout. |
| DOB28 (Добрич) | B | pdf-text via Wayback CDX | yes | no | Full session protokols at dobrich.bg/uploads/posts/{YYYY}/protokol-{N}_{DD-MM-YYYY}.pdf, ~200 pages each, ~45 decisions per session. Two custom handlers: (1) dual-numbered "РЕШЕНИЕ <session> – <item>:" markers, (2) semicolon separators in the ПОИМЕННО ГЛАСУВАЛИ tally line, pre-processed to comma so the shared label-first regex matches. NO per-councillor block. |
| HKV09 (Димитровград) | B | doc-binary + docx via static index | yes | no | Static paginated HTML index at dimitrovgrad.bg/bg/protokoli-ot-zasedaniyata-na-obshtinskiya-savet (/page/10, /page/20, ... — 220+ pages back to 2009). Each session links a full protokol — older sessions ship .doc (Word 97-2003 binary, converted via macOS textutil), session 33+ shifted to .docx (handled via the shared `extractDocxText`). Tally form is VERBOSE label-first with semicolon separators ("„за" – 22 общински съветници; „против" – 2; „въздържали се" – 0"), already matched by the shared SUMMARY_RE_VERBOSE — no pre-processing. Marker is letter-spaced "Р  Е  Ш  Е  Н  И  Е № NNN От \d" (textutil-output); the "От \d" trailer anchors true markers vs body cross-references. Tally PRECEDES the marker (chair narrates first). 537 decisions ingested across 27 sessions of the 2024-2026 mandate. Per-decision .docx files also published on the companion /bg/resheniya-na-obs page but carry only the signed body, no tally. NO per-councillor block. |
| RAZ26 (Разград) | B | docx/pdf via Joomla index | yes | no | Joomla session-list at razgrad.bg/protokoli-i-zapisi-na-zasedania-na-obsinski-s-vet (?start=N pagination — 10 per page). Each session page links a full protokol at /images/OBS_doc/.../2023-2027/.../Protokol_{N}.{docx,pdf} across FOUR distinct sub-layouts (Protokol_N/Protokol_N.docx · Protokol_N-{date}.docx · OS-Protokol_N-{date}/Protokol_N.docx · /Protokoli/2023-2027/OS-Protokol_N-{date}/Protokol_N.docx). Parser anchors on the filename + an OBS_doc parent + a date anywhere in the path. Tally vocabulary is the most heterogeneous in the fleet — FIVE distinct chair-narrated forms in a single session (split-quote SHORTHAND dominant: "„ЗА" – 5, „против" и „въздържали се" – няма"; без-form: "без „против" и „въздържали се""; partial-form: "и 1 – „въздържал се""; label-second NEGATIVE: "няма – „против""; digit-first with -ма suffix: "4-ма „ЗА""). Parser pre-processes all five into the canonical SHORTHAND so the shared `SUMMARY_RE_SHORTHAND` matches. Tally PRECEDES marker. 379 decisions ingested across 10 sessions of the 2025-2026 window. NO per-councillor block — chair-announced totals only. Decisions without an extractable tally fall back to result="adopted" + empty tally so they still surface with metadata. |
| PER32 (Перник) | A | docx via WordPress category | yes | yes (~82% roster match) | Live static WordPress category at obs-pernik.bg/category/заседания/протоколи-заседания/ with /page/N/ pagination. Posts at Cyrillic slug /протокол-№-{N}-{DD}-{MM}-{YYYY}г/ — each links a single .docx under /wp-content/uploads/{YYYY}/{MM}/. Born-digital text. Tally form is canonical label-first ('Общинският съвет гласува и със 'за' - 22, 'против' - 0 и 'въздържали се' - 0'), matched directly by the shared SUMMARY_RE_LABEL_FIRST. Marker filter requires the past-tense verb "прие" within 300 chars of the lookback to distinguish real adoption announcements from agenda cross-references to past decisions ("поправка на РЕШЕНИЕ №863 от 29.01.2026 г."). Per-councillor block sits BETWEEN the tally summary and the marker as UNGROUPED `<Name>: <vote>` lines (no leading position number, unlike the shared VOTE_LINE_RE form). Parser ships its own PER_NAME_RE with a Unicode lookahead `(?=[^\p{L}]|$)` after the vote token instead of `\b` (ASCII word-boundary doesn't fire after Cyrillic). 485 decisions across 19 sessions of the 2025-2026 mandate; 6,319 per-councillor vote rows joined (82% exact). 28 councillors observed; 14 with dissent activity. |
| BLG03 (Благоевград) | C | doc | — | — | DEFERRED (legacy URL dead; município migrated to e-obs.online SaaS) |

Total: 16 of 16 wired. Per-councillor coverage surfaces in the unified "Общински съвет" MyArea tile (`MyAreaCouncilTile`) + on the public `/local/:cycle/:obshtinaCode` page + on each `/officials/<slug>` profile.

### One-shot: rebuild shards after pipeline change

`scripts/council/rebuild_shards.ts` regenerates the slim index + every per-município votes shard from whatever is currently on disk. Run after a `lib/index_writer.ts` shape change so the on-disk artefacts catch up without re-scraping every município:

```bash
npx tsx scripts/council/rebuild_shards.ts
```

## Troubleshooting

- **All-zero counts on a município**: recipe rotted (CMS migration / URL change). Re-discover, update sources.json.
- **`pdftotext` ENOENT**: install poppler-utils.
- **OCR not invoked on a known-scanned PDF**: `--ocr` flag not passed, or pdftotext is producing >200 chars of garbage. Lower the `looksLikeScannedPdf` threshold in `lib/pdf_text.ts` if needed.
- **Roster join rate <50%**: `data/officials/municipal/index.json` is stale (replacements not declared yet) OR the município name string doesn't exactly match the cacbg `municipality` field. Check `buildMuniLookup` in `lib/roster_join.ts`.
- **Watermark stuck**: delete `state/ingest/council_<obshtina>.json` to force a fresh `--since-year` walk.

## See also

- Project memory: `project-council-votes-ingest` — why data.egov.bg is a dead end + the per-município difficulty tiers
- Project memory: `project-connections-expansion` — how councillors join into the connections graph (Phase 2 per-councillor data feeds this)
- `scripts/council/README.md` — phased plan + per-município source landscape
