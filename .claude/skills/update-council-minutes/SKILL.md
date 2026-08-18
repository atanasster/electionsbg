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
| Daily watcher reports `Council resolutions: N município(s) changed` | Run incremental ingest for ALL wired munis (`npm run council:scrape -- --per-councillor`) |
| User asks to "refresh council resolutions" / "update council votes" | Same — incremental |
| User asks for one município only ("refresh Стара Загора council") | `npm run council:scrape -- --only <code> --per-councillor` |
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
npm run council:discover            # probe all 17 wired recipes for liveness
npm run council:discover -- --only SOF --verbose
```

Reports HTTP status + content-type + byte count per município index URL + sample PDF. A recipe that fails here will silently produce zero records when scrape.ts runs — re-discover the URL, update `data/council/sources.json`, then re-scrape.

## Step 3 — Incremental scrape

```bash
npm run council:scrape -- --per-councillor         # all wired munis, since last ingest
                                                   # ⚠️ --per-councillor is NOT optional on the
                                                   # daily path — see "The named-vote freeze"
npm run council:scrape                             # aggregate tallies only (debugging)
npm run council:scrape -- --only VTR01             # one município
npm run council:scrape -- --only VTR01 --since-year 2025 --max 5 --dry
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
4. Writes the watermark to `state/ingest/council_<obshtina>.json`.

   **Not "the latest seen date" — the latest date everything below it was ingested** (`scripts/council/lib/watermark.ts`). Parsers filter candidates on `date > sinceDate`, so advancing past a protocol that failed to download removes it from consideration for ever; it is reported once among the "N fetch error(s)" and then it is gone. A failed download therefore caps the watermark strictly below its own date, and a failed *index* — which could have hidden anything — freezes it entirely.

   Which of those happens is set by the parser via `MuniScrapeError.kind`:

   | kind | meaning | watermark | ledger |
   | --- | --- | --- | --- |
   | `discovery` | an enumeration step failed — a year index, a CDX query. Carries no date by construction | **frozen** — we cannot know what it hid | while it recurs (it is re-read every run, so silence means it recovered) |
   | `fetch` | couldn't retrieve one protocol; it is missing | capped strictly below its `date`, or frozen when it has none | while it recurs |
   | `content` | retrieved but unusable as-is (scanned PDF, unsupported variant) — retrying identically will never help | not held | **kept until the URL is ingested** |
   | `enrich` | the protocol landed; only an extra failed (per-councillor protokol, OCR unlock, roster join) | not held | not kept |

   `kind` is REQUIRED and the union is discriminated, so the compiler makes every new call site choose. **A per-protocol `fetch` site should also carry `date`** — without one the watermark freezes the whole município instead of capping at the failure. When the date is only known inside the `try` (the sitting date comes out of the document), hoist a `let` above it; `parsers/error_sites.test.ts` enforces this and holds the (currently empty) list of exemptions.

   **`--max N` freezes it too, and that is why the example above pairs it with `--dry`.** Every parser sorts newest-first and drops the rest, and a dropped candidate raises no error at all — so a non-`--dry` run with `--max` would otherwise advance the watermark past protocols it never looked at, permanently. Parsers report `candidatesDropped`; the orchestrator also treats the bare presence of `--max` as truncation for any parser that does not.

   `deferred` in the state file is the durable list of what we know is missing — it is what stops a `content` skip from silently becoming "forgotten" once the watermark has passed it. A `fetch` failure that survives `MAX_BLOCKING_ATTEMPTS` (5) consecutive runs stops holding the line and stays on the ledger flagged `givenUp`, so one dead URL cannot wedge a município's ingest for ever.

5. A município that touched 0 protocols **and** had a failed lookup is reported `UNVERIFIED` and is **neither merged nor stamped** — "0 new protocols" is a claim we have no basis for when we never managed to read the source. It is retried on the next run.

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

## Step 4.5 — Publish the corpus to Postgres

The council corpus is PG-served (migration 160). `data/council/` is the ingest's
output and the loader's input; nothing reads it from the bucket any more.

```bash
npm run db:load:council:pg          # local
npm run db:load:council:pg:cloud    # ⚠️ PROD — nothing runs this automatically
```

**Order matters on the cloud side.** The loader must run AFTER
`db:resolve:persons` and after `db:load:ngo-board-links`: the resolver does
`DELETE FROM person` + re-COPY with `person_id` as a positional ordinal, so
`council_vote.person_id` is nulled table-wide on every re-resolve
(ON DELETE SET NULL) and this loader is what re-attaches it; and
`db:load:ngo-board-links` is the only writer of `official_roster`, the roster
bridge every attribution resolves through. See CLAUDE.md §council.

**The cloud line is the one that gets forgotten**, and its failure is the usual
shape: local is green, prod keeps the previous vintage at a 200, and every row
count reconciles. Run it after every ingest that added resolutions.

Expected output — the two numbers to read:

```
[council] 16 municipalities, 4676 resolutions, 28214 named votes (refused 840 vote-label-polluted rows)
[council] person_id attached to 26550/28214 named votes (94.1%)
```

**94.1% is the number.** A drop to ~77% means the two sides of `councilNameKey`
have drifted apart again (see Troubleshooting). The loader refuses rather than
publishing a collapse: if attribution would fall below 90% of what is already
live it throws, naming `db:load:ngo-board-links` — the only writer of
`official_roster`, which degrades to NULL `obshtina` on a clone with no
municipal shards. `--allow-attribution-drop` overrides when the loss is real.

## The named-vote freeze — read before touching the scrape flags

`data/council/votes/*.json` did not move between 2026-05-29 and 2026-08-16 while
`index.json` refreshed weekly, and nothing reported it. Two causes, and the
second makes the obvious fix for the first destructive:

1. **`--per-councillor` is opt-in and the daily path did not pass it.** The May
   corpus came from explicit one-off runs. Since then no scrape produced a
   single `tally.perCouncillor`.
2. **The votes shard was rebuilt from a source that had already been stripped.**
   `writeIndex` removes `perCouncillor`, and `mergeMuniResult` read its previous
   state back out of the index — so the shard could only ever hold what the
   current scrape returned. 530 resolutions and 10,754 vote rows sat in the
   durable tree, unserved.

The `kept === 0` early return was the only thing preserving the shards, so the
corpus was protected by extraction being broken: adding `--per-councillor`
without fixing the merge would have overwritten each shard with one resolution.
Both are fixed (the merge is additive and reads the durable tree), which is why
the flag is now on the daily path.

`--ocr` stays opt-in: it is ~$1.85/session for Sofia and that is a budget
decision, not a default.

⚠️ **So the daily path does NOT refresh Sofia's named votes, and cannot.**
`parsers/sof.ts` gates per-councillor extraction behind `opts.ocr` (its full
protokol PDFs carry ABBYY Cyrillic→Latin mojibake, so plain text extraction
yields nothing usable). A daily `--per-councillor` run advances Sofia's
resolutions while its named-vote watermark stays put — by design, not as a
defect. Move it with a deliberate periodic run:

```bash
npm run council:scrape -- --only SOF --per-councillor --ocr
```

and then bump `SOF` in `NAMED_VOTE_WATERMARK`
(`scripts/db/tests/council_corpus.data.test.ts`) — the gate is a ratchet and
will tell you to.

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
| GAB05 (Габрово) | A | pdf-text via Wayback CDX | yes (244 across 12 protokols) | **no — 0 of 244** (see note) | Apache directory listing 403-blocked; discovery uses Wayback CDX index. 2024 protokols have compact "Т. 1: За – 9 Против – 10 Въздържали се – 9" aggregate tallies but no per-councillor table; 2025+ protokols DO carry a tabular per-councillor block (NN  Name  ЗА|ПРОТИВ|ВЪЗДЪРЖАЛИ СЕ|отсъства), but **none of it has ever been extracted**: measured 2026-08-16, 0 of 244 durable shards carry `perCouncillor` and `council_muni.has_named_votes` is false. This column previously claimed partial coverage. A município with NO named votes is invisible to the per-council staleness gate (it filters `WHERE has_named_votes`), which is why the vote-bearing SET is pinned separately in `council_corpus.data.test.ts`. |
| SZR12 (Казанлък) | A | pdf-text via Wayback CDX + brute-force | yes | yes | Nuxt-rendered category page doesn't surface protokol links via curl; discovery is Wayback CDX + a focused brute-force probe (Protokol_{N}_SAIT.pdf across {YYYY-MM} dirs, current year only). Per-councillor block in standard "<N>. <Name>: <vote>" form. |
| HKV34 (Хасково) | B | pdf-text via Wayback CDX | yes | no | 89 protokols at haskovo.bg/uploads/posts/{YYYY}/protokol-{N}.pdf. Born-digital text-layer. Tally form is novel — chair-announcement prose ("Т.ЗАХАРИЕВА: С 37 гласа „за\", без „против\" и „въздържали се\""); parser pre-processes the text to rewrite it into the canonical V. Tarnovo form so the shared SUMMARY_RE_DIGIT_FIRST matches. NO per-councillor block — protokol records the chair's totals, not the individual readout. |
| DOB28 (Добрич) | B | pdf-text via Wayback CDX | yes | no | Full session protokols at dobrich.bg/uploads/posts/{YYYY}/protokol-{N}_{DD-MM-YYYY}.pdf, ~200 pages each, ~45 decisions per session. Two custom handlers: (1) dual-numbered "РЕШЕНИЕ <session> – <item>:" markers, (2) semicolon separators in the ПОИМЕННО ГЛАСУВАЛИ tally line, pre-processed to comma so the shared label-first regex matches. NO per-councillor block. |
| HKV09 (Димитровград) | B | doc-binary + docx via static index | yes | no | Static paginated HTML index at dimitrovgrad.bg/bg/protokoli-ot-zasedaniyata-na-obshtinskiya-savet (/page/10, /page/20, ... — 220+ pages back to 2009). Each session links a full protokol — older sessions ship .doc (Word 97-2003 binary, converted via macOS textutil), session 33+ shifted to .docx (handled via the shared `extractDocxText`). Tally form is VERBOSE label-first with semicolon separators ("„за" – 22 общински съветници; „против" – 2; „въздържали се" – 0"), already matched by the shared SUMMARY_RE_VERBOSE — no pre-processing. Marker is letter-spaced "Р  Е  Ш  Е  Н  И  Е № NNN От \d" (textutil-output); the "От \d" trailer anchors true markers vs body cross-references. Tally PRECEDES the marker (chair narrates first). 537 decisions ingested across 27 sessions of the 2024-2026 mandate. Per-decision .docx files also published on the companion /bg/resheniya-na-obs page but carry only the signed body, no tally. NO per-councillor block. |
| RAZ26 (Разград) | B | docx/pdf via Joomla index | yes | no | Joomla session-list at razgrad.bg/protokoli-i-zapisi-na-zasedania-na-obsinski-s-vet (?start=N pagination — 10 per page). Each session page links a full protokol at /images/OBS_doc/.../2023-2027/.../Protokol_{N}.{docx,pdf} across FOUR distinct sub-layouts (Protokol_N/Protokol_N.docx · Protokol_N-{date}.docx · OS-Protokol_N-{date}/Protokol_N.docx · /Protokoli/2023-2027/OS-Protokol_N-{date}/Protokol_N.docx). Parser anchors on the filename + an OBS_doc parent + a date anywhere in the path. Tally vocabulary is the most heterogeneous in the fleet — FIVE distinct chair-narrated forms in a single session (split-quote SHORTHAND dominant: "„ЗА" – 5, „против" и „въздържали се" – няма"; без-form: "без „против" и „въздържали се""; partial-form: "и 1 – „въздържал се""; label-second NEGATIVE: "няма – „против""; digit-first with -ма suffix: "4-ма „ЗА""). Parser pre-processes all five into the canonical SHORTHAND so the shared `SUMMARY_RE_SHORTHAND` matches. Tally PRECEDES marker. 379 decisions ingested across 10 sessions of the 2025-2026 window. NO per-councillor block — chair-announced totals only. Decisions without an extractable tally fall back to result="adopted" + empty tally so they still surface with metadata. Decision titles are lifted from each agenda item's structured `ОТНОСНО:` subject in the докладна записка (Разград publishes clean ones — contrast Добрич, whose verbatim transcript scatters conversational "относно …" that is not a title field); existing shards backfill on the next full re-ingest. **[2026-08-18] Three defects fixed together; each was invisible to every count the pipeline keeps.** (1) `findMarkers` accepted every `Р Е Ш Е Н И Е №` in the document, so citations inside the докладна bodies were published as Разград decisions — including `Решение № 4157-НС … на Централната избирателна комисия`, a ЦИК decision served at `/council/resolution/RAZ26-2025-prot28-r4157`. It now requires the chair's announcement (`взе следното` / `прие следно`) and binds each announcement FORWARD to the single marker it introduces, because a citation standing just after a real decision otherwise inherits its anchor. 338 → 207 records, and the kept numbers form a gapless run per session that chains unbroken across 11 consecutive sessions (295-309 … 521-535) — that contiguity is the independent check that no real decision was dropped with them. (2) Разград's dominant tally form (`С 28 гласа - „ЗА“, „против“- няма`) matched none of the shared regexes — `GL` covers only the abbreviation `гл.`, and `HGAP` admits no dash — so 332 of 338 records carried a 0/0/0 tally, against ZERO such records in the other fifteen municipalities. Normalised in this parser's own `preprocessTally`, not by widening the shared regex that sixteen parsers read. (3) A tally is paired only when its own sentence names the COUNCIL as the voter (`isCouncilTally`): the protokol prints standing-committee votes (`ПК … подкрепи … „ЗА“ – 6`) and the agenda-adoption vote inside the same pairing window, and a committee blacklist alone handed two decisions the agenda's plausible unanimous 28-0-0. A decision with no council-attributed tally now stores NO tally rather than 0/0/0 — `TallyLine` suppresses a null but renders „за 0" for a zero, asserting a unanimity the source never recorded. 12 of 207 are in that state. Gates: `scripts/council/parsers/raz26.test.ts`. |
| PER32 (Перник) | A | doc+docx via WordPress category | yes | yes (~82% roster match) | Live static WordPress category at obs-pernik.bg/category/заседания/протоколи-заседания/ with /page/N/ pagination. Posts at Cyrillic slug /протокол-№-{N}-{DD}-{MM}-{YYYY}г/ — each links a single .docx under /wp-content/uploads/{YYYY}/{MM}/. Born-digital text. Tally form is canonical label-first ('Общинският съвет гласува и със 'за' - 22, 'против' - 0 и 'въздържали се' - 0'), matched directly by the shared SUMMARY_RE_LABEL_FIRST. Marker filter requires the past-tense verb "прие" within 300 chars of the lookback to distinguish real adoption announcements from agenda cross-references to past decisions ("поправка на РЕШЕНИЕ №863 от 29.01.2026 г."). Per-councillor block sits BETWEEN the tally summary and the marker as UNGROUPED `<Name>: <vote>` lines (no leading position number, unlike the shared VOTE_LINE_RE form). Parser ships its own PER_NAME_RE with a Unicode lookahead `(?=[^\p{L}]|$)` after the vote token instead of `\b` (ASCII word-boundary doesn't fire after Cyrillic). 485 decisions across 19 sessions of the 2025-2026 mandate; 6,319 per-councillor vote rows joined (82% exact). 28 councillors observed; 14 with dissent activity. |
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
- **Watermark stuck**: check the run output for `watermark held at …` first — that is the design working, and the named URL is what to fix. Deleting `state/ingest/council_<obshtina>.json` forces a fresh `--since-year` walk, but also drops the `deferred` ledger.
- **`deferred` entry that never clears**: expected for a `content` skip whose URL is not a resolution's `sourceUrl` — RSE01's "PDF variant skipped" and the "no .docx link on session page" cases. The ledger is the record that they are missing; picking one up after the source is fixed needs an explicit `--since-date` behind it, and the entry only clears itself if the parser deferred the DOCUMENT url rather than the page url (per32 does; hkv09 still defers the session page, so its entries are immortal by construction and need deleting by hand once ingested).
- **`not a .docx: … is a legacy Word 97-2003 .doc`**: no longer a skip. `extractWordText` (lib/docx.ts) routes OLE2 to macOS `textutil` and OOXML to the zip reader, deciding from the file's first eight bytes rather than from the href — six municipalities link `.doc` and `.docx` from one index and several migrated mid-mandate. Seeing this message means the bytes are neither: a PDF or an HTML error page served at 200 under a Word href. `textutil not found on PATH` is different again — that is a `fetch` failure (the bytes are fine, the machine is not macOS), so it holds the watermark for five runs and then gives up.
- **A município re-writes its whole window every run (`+0 new, N updated`)**: its watermark is pinned by a `fetch` entry on the ledger that will never succeed. Check the entry's `kind`: a body that downloaded fine and is merely unreadable — a malformed archive, an unsupported variant — is `content`, which the watermark passes. The five parsers that read an office container (`per32`, `rse`, `pvn`, `raz26`, `hkv09`) ask `isMalformedArchiveError(err)` in their catch for exactly this; `parsers/error_sites.test.ts` fails if one stops. PER32 sat at 2025-10-16 re-writing 271 resolutions a run for a month before this was classified.
- **`UNVERIFIED` município**: the source was unreadable, so nothing was merged or stamped. Not a failure to fix here unless it persists — re-run with `--only <key>` once the council's site is back.
- **A run that hangs**: it should not any more (`--budget-min`, default 20, caps each município's wall clock; `--ocr` raises it to 60). If one does, the status table on SIGINT names exactly how far it got.

- **Attribution drops to ~77%**: the vote side and the roster side of
  `councilNameKey` (`scripts/council/lib/tally.ts`) have diverged. The two
  divergences that have happened are `й`→`и` (the parser's NFD strip) and
  hyphen collapse — 4,899 votes between them. Both sides must call that one
  function; `council_corpus.data.test.ts` gates it.
- **`refusing to shrink <code> votes shard`**: a run would have published fewer
  named-vote resolutions than are already on disk. That cannot happen through
  the additive merge, so it means something upstream changed shape. Investigate
  before overriding. Note `--allow-shrink` is parsed by `rebuild_shards.ts`
  ONLY — `council:scrape` ignores it, so the override belongs on the repair
  command (`npx tsx scripts/council/rebuild_shards.ts --allow-shrink`), not on
  the scrape that raised the error.
- **`person attribution collapsed`**: `official_roster` is empty or partial.
  Re-run `db:load:ngo-board-links`, then this loader.
- **A município's named votes stop updating while its resolutions keep
  arriving**: the parser is no longer emitting `perCouncillor` for it. This is
  the 2026-05 freeze in miniature and nothing else reports it — compare
  `named_vote_count` in `council_muni` against the previous run.

## See also

- Project memory: `project-council-votes-ingest` — why data.egov.bg is a dead end + the per-município difficulty tiers
- Project memory: `project-connections-expansion` — how councillors join into the connections graph (Phase 2 per-councillor data feeds this)
- `scripts/council/README.md` — phased plan + per-município source landscape
