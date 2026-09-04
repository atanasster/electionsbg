# Presidential elections — ingest and surface plan

**Status:** ready to execute (Tiers 0–4 are fully specified; Tiers 5–8 carry product decisions listed in §9)  
**Scope:** every presidential election ЦИК publishes machine-readably — 2001, 2006, 2011, 2016, 2021 — plus the
2026 cycle (constitutional window: first Sunday of November; `upcomingElections.ts` carries 2026-11-08 as an
*estimated* anchor until the decree is published)  
**Version:** v1 — a third election kind (`presidential`) beside `parliamentary` and `local`, on the same raw → data
→ surface grammar, with its own outcome contract (ticket ranking + runoff), never folded into a party ranking  
**Raw data:** downloaded 2026-09-05 and placed under `raw_data/<round-1 date>_pvr/` (§1). Every bundle reconciles
to the vote with the official ЦИК totals (§2.4).

## 0. Outcome

A reader can open `/presidential/<cycle>` and answer, on the first screen, the question presidential elections
actually pose: **who led the first round, was it decided there, who went to the runoff, and who won it** — at
country, abroad, region, municipality, settlement and polling-section depth, with the same map / list / evidence
grammar the parliamentary and local surfaces already use.

Two things only presidential data can show, and this plan deliberately keeps room for both (Tier 8):

- **Runoff transfer** — where the eliminated candidates' voters went between round 1 and round 2, per section
  (2011: Кунева's 470,808; 2016: Каракачанов's 573,016 + Марешки's 427,660; 2021: nobody's — Радев was one
  point short of a round-1 win at 49.42% and won 66.72% a week later).
- **Split-ticket voting on 14 Nov 2021** — the presidential and parliamentary ballots were cast in the SAME
  sections on the same day, and both bundles are on disk: per section, ПП's 25.7% list vote against the Радев
  ticket's 49.4%. No other dataset in this repo has two simultaneous national ballots.

## 1. What was downloaded, and where it sits

All seven bundles were fetched on 2026-09-05 through the headed-Playwright session
(`scripts/parsers_local/cik_fetch.ts`); every one of them, including the legacy `pvr2006.cik.bg` host and the
`before_2003/` archive, is Cloudflare-walled to plain `curl` (403, 5.4 KB challenge page).

| cycle (`raw_data/`) | R1 / R2 dates | source (results.cik.bg unless noted) | on disk | bytes |
| --- | --- | --- | --- | --- |
| `2021_11_14_pvr` | 2021-11-14 / 2021-11-21 | `pvrns2021/tur1/export.zip` (130.3 MB), `pvrns2021/tur2/export.zip` (24.9 MB) | `ТУР1/` = the bundle's `pvr/` half; `ТУР2/` = the round-2 files + `suemg/` (11,667 per-section zips) | 53 MB |
| `2016_11_06_pvr` | 2016-11-06 / 2016-11-13 | `pvrnr2016/tur1/export.zip` — **`tur2/export.zip` is the same file** (md5 `2aff1313…`), one bundle carries both rounds as `06.11.2016/` and `13.11.2016/` | `ТУР1/`, `ТУР2/` | 8.1 MB |
| `2011_10_23_pvr` | 2011-10-23 / 2011-10-30 | `mipvr2011/el2011_t1.zip` (already on disk under the gitignored `2011_10_23_mi/ТУР1/президент/`), `mipvr2011/el2011_t2.zip` | `ТУР1/`, `ТУР2/` — the `президент/` race folder of each joint bundle | 4.0 MB |
| `2006_10_22_pvr` | 2006-10-22 / 2006-10-29 | `pvr2006.cik.bg/results_1/export_t1.zip`, `results_2/export_t2.zip` | `ТУР1/`, `ТУР2/` | 2.1 MB |
| `2001_11_11_pvr` | 2001-11-11 / 2001-11-18 | `results.cik.bg/before_2003/2001_prezident.zip` (8.1 MB; only `DATA/izb01pr/` kept — `DIAGRAMS/` is a PowerPoint viewer with DLLs) | `ТУР1/` (32 `.201` files + `COMMON.201`), `ТУР2/` (`.301`), `Read_WIN.txt` / `Read_DOS.txt` | 2.1 MB |

Not downloaded, known to exist: `before_2003/1991_1999.zip` (the 1992 and 1996 presidential elections, same
„Деметра" archive family as 2001 — Tier 9), and the 2016 national referendum half of `pvrnr2016`
(`tur1/csv_nr.html`) — out of scope, but the bundle's `sections` are shared so a referendum ingest later is cheap.

### 1.1 Layout decisions (the "as per convention" part)

- **`<round-1 date>_pvr` with `ТУР1/` / `ТУР2/` subfolders holding the ORIGINAL file names and original
  bytes.** Multi-round cycles already use `ТУР1/…` (local), and presidential is a two-round national ballot; the
  flat renamed layout (`votes.txt`, `protocols.txt`) is the single-round parliamentary convention and would lose
  the per-round provenance. Encodings are left as published (§2.2) — the parsers decode. One exception, and it
  is the repo-wide one: `core.autocrlf = input` normalises the files' CRLF line endings to LF in the committed
  blobs (220 of the text files warned on commit), exactly as every tracked parliamentary raw file already is
  (`git ls-files --eol` reports `i/lf w/crlf` for `raw_data/2021_11_14/votes.txt` too). A fresh clone therefore
  reads LF; every reader must accept both, and no gate may fingerprint a raw file's bytes.
- **Tracked in git, unlike `_mi`/`_chmi`.** The local trees are gitignored because they are regenerable by
  `--local-ingest`; these are small (20 MB for five cycles, against 90 MB for one parliamentary `preferences.txt`)
  and two of the hosts are legacy archives that could vanish. No `.gitignore` rule is added.
- **The 2021 round-1 machine records are NOT duplicated.** `raw_data/2021_11_14/suemg/` (tracked, 11,861 files)
  IS the joint bundle's `suemg/` tree — a single machine export interleaves both ballots, discriminated by
  `row[1]`: `64` = parliament (what `scripts/machines_memory` keeps today), **`256` = president**. The presidential
  parser reads block 256 out of the same files. Round 2 was a presidential-only day, so its `suemg/` lives in
  `2021_11_14_pvr/ТУР2/`.
- The parliamentary half of `pvrns2021` (`np/`) is byte-identical to `raw_data/2021_11_14/*.txt`
  (md5 `301ce3c3…` on `votes.txt`), so nothing there changes.

### 1.2 The download quirk worth recording

`cikDownloadFile()` (a `page.goto` to the zip, waiting for Chromium's `download` event) works for 2016, 2011,
2006 and the 2001 archive, and **fails for `pvrns2021` — no download event fires within the timeout, twice.**
What works is a **user-gesture click on the `./export.zip` anchor of `tur1/csv.html`** after the page has cleared
the challenge (`page.click('a[href$="export.zip"]')` + `waitForEvent("download")`): 130 MB in 21 s, 200
`application/zip`. Tier 1 adds that as a second strategy in `cik_fetch.ts` rather than a one-off, because the 2026
bundle will live on the same generation of the archive.

## 2. Corpus analysis — five format eras

The five cycles are five different file formats. Nothing in the parliamentary parser's year-keyed `if` ladder
(`scripts/parsers/votes.ts`, `protocols.ts`) matches more than one of them, and two use encodings no parser in
`scripts/parsers/` handles, so this plan builds era readers rather than extending the ladder (§3, decision 4).

### 2.1 Era table

| era | files | sections file | protocols | votes | grid | encoding |
| --- | --- | --- | --- | --- | --- | --- |
| **E2021** | `cik_parties`, `cik_candidates`, `sections`, `protocols`, `votes` (+ `suemg/`) | 8 cols: code; admin-unit id; admin-unit name; ЕКАТТЕ; place; mobile; ship; **machines count** | forms 24 (Х), 25 (М), 26 (ХМ), 27 (КР), 28 (ЧХ), 29 (ЧМ), 31 (ЧКР), 32 (one row per machine), 41 (machine abroad) — field positions identical to the `isMachineOnlyVote("2021_11_14")` branch | `form;code;admin;` then **pairs** `ticket;valid` — one row per paper protocol (24/28) and one per machine (32/41) | 31 МИР + `32` abroad (750 abroad sections) | UTF-8 |
| **E2016** | `cik_candidates`, `sections`, `protocols`, `votes` | 8 cols, last = **machine flag** (500 flagged sections) | forms 1 (paper), 7 (abroad), 8 (machine+paper), 32 positions, readme-documented | `code;admin;` then **5-tuples** `ticket;valid;paper(Б);machine(М);invalid` | 31 МИР + `32` (325 abroad) | UTF-8 with BOM |
| **E2011** | `el2011_president_{candidates,protocols,readme,result,sections,votes}` | `flag;code;област;община;населено място;ЕКАТТЕ` | 27 positions (readme decoded in this session), row flag `П` (mobile) / `Е` (experimental count) | `flag;code;` then **pairs** | **28-oblast grid**, `29` abroad (see §2.3) | **windows-1251** |
| **E2006** | `Readme`, `izbori2006_T{1,2}_protocols`, `izbori2006_t{1,2}_sections` — **no votes file** | `code;населено място;ЕКАТТЕ` | 16 protocol fields then the **ticket votes inline** (cols 17–23 in R1, 17–18 in R2) | inside protocols | 31 МИР + `32` (144 abroad) | windows-1251 |
| **E2001** | per-oblast INI-style files `NN0000z0.201` (R1) / `.301` (R2), `COMMON.*` | `[NM]` block: `obsht;sec;place;ЕКАТТЕ;flag` | `[PROT]` block: `vid;obl;obsht;sec;` + `+`-joined protocol counters + `+`-joined ticket votes | inside `[PROT]` | `(obl 2)(obsht 4)(sec 3)` — its own key space | **MIK** (Bulgarian DOS: bytes `0x80–0xBF` → `А–я`), decoded cleanly with a 64-entry table; `iconv` has no name for it |

Row counts measured: 2021 R1 13,238 sections / 15,616 vote rows / 25,174 protocol rows (R2: 13,234 / 15,375 /
24,950); 2016 12,340 sections both rounds; 2011 11,784 / 11,779; 2006 11,809; 2001 32 oblast files (31 МИР + `32`
abroad) with a 537-section Благоевград file as the sample.

### 2.2 Tickets — the candidate identity

A presidential "party" is a **ticket**: president + vice-president, nominated by a party, a coalition, or an
инициативен комитет. The ticket's **ballot number is the key**, and it is stable across the two rounds in every
cycle (2006: 3 & 6; 2011: 2 & 8; 2016: 13 & 17; 2021: 6 & 15). How the names arrive differs per era and the
plan normalises to one `tickets.json`:

- E2011 gives the two names in separate columns (`num;president;vicePresident;nominatedBy`) — the clean case
  and the fixture for the splitter.
- E2016 / E2021 give ONE string „Румен Георгиев Радев **и** Илияна Малинова Йотова" in `cik_candidates`.
  Split on the ` и ` that leaves 2–4 name tokens on each side; a hyphenated compound surname („Митева-Матеева",
  „Касимова-Моасе") is one token. In 2021 `cik_parties` carries a DIFFERENT composite for the ИК rows („ИК за
  Румен Радев и Илияна Йотова-Румен Георгиев Радев и…") — **use `cik_candidates` for the names and
  `cik_parties` only for the nominating body**.
- E2006 has NO candidates file: the ticket names are the column HEADERS in `Readme.txt` („Гласове за 3. Георги
  Първанов, Ангел Марин"). The reader parses the readme.
- E2001 `[PARTII]`: `num;full ticket;initials;short ticket`.

`nominatedBy.kind ∈ {party, coalition, committee}`; colour comes from `scripts/party_defaults.json` when the
nominating body resolves to a known `nickName` (ГЕРБ, БСП, ДПС, ВЪЗРАЖДАНЕ, АТАКА, ВМРО…), otherwise a neutral
slate. A person-level `canonicalTicketKey` (president's folded name) links Радев 2016 → 2021 and Сидеров 2006 →
2011 → 2021 across cycles; it is a cross-cycle DISPLAY key, not a person-layer identity (§Tier 8 does the real
link through the person resolver, and refuses ambiguity the way `aop_expert_person_links()` does).

### 2.3 Section grids — the thing that is different from parliamentary

- **2016, 2021, 2006** use the parliamentary 9-digit code on the 31-МИР grid (`23/24/25` = Sofia's three МИР,
  `16` Пловдив-град, `17` Пловдив-област, `32` abroad). 2021 round 1's `sections.txt` is **byte-identical** to the
  NS one (md5 `85d34876…`), so the section GPS / addresses the parliamentary tree carries (2026 CEC source,
  backfilled to older cycles) join 1:1 — the same transfer `backfillLocalSectionCoords` already does for local
  shards. Round 2 differs in six codes (e.g. `021700053` → `021700054`) — sections are re-numbered between rounds,
  so **the round is part of the section key**.
- **2011 is on the 28-OBLAST grid** because the election was run by the ОИК alongside the local vote: prefix `22`
  = София-град (1,455 sections), `23` = Софийска, `16` = the whole of Пловдив (city + oblast, 961), `29` = abroad.
  Those codes do NOT join parliamentary sections. Oblast comes from `OIK_PREFIX_TO_OBLAST`
  (`scripts/parsers_local/oblastNames.ts`, verified 1:1 on the 2011/2015 pages), place from ЕКАТТЕ.
- **2001** keys sections `(obl, obsht, sec)` and its `[NM]` block carries ЕКАТТЕ per (obsht, sec) — place
  resolution goes through ЕКАТТЕ only.

Consequence: a `sectionKey` is `{cycle, round, code}` and the geo join is **ЕКАТТЕ-first**, with the 9-digit code
as an additional join only for the three МИР-grid eras.

### 2.4 Validation — every bundle reconciles with the official ЦИК totals

Summed from the section files in this session, compared with the ЦИК decisions (2016: № 3992-ПВР and
№ 4032-ПВР; 2021: № 956-ПВР; 2011 from the bundle's own `result.txt`):

| cycle | round 1 | round 2 |
| --- | --- | --- |
| 2021 | Радев/Йотова **1,322,385** · Герджиков/Митева 610,862 · Карадайъ (ДПС) 309,681 · Костадинов 104,832 · Панов 98,488 — ticket total 2,615,149 | Радев **1,539,650** · Герджиков 733,791 |
| 2016 | Радев/Йотова **973,754** · Цачева/Манушев 840,635 · Каракачанов 573,016 · Марешки 427,660 · Орешарски 253,726 | Радев **2,063,032** · Цачева 1,256,485 |
| 2011 | Плевнелиев/Попова **1,349,380** · Калфин/Данаилов 974,300 · Кунева 470,808 · Сидеров 122,466 | Плевнелиев **1,698,136** · Калфин 1,531,193 |
| 2006 | Първанов/Марин **1,780,119** · Сидеров/Шопов 597,175 · Беронов/Николова 271,078 · Марков 75,478 · Берон 21,812 · Велев 19,857 · Петров 13,854 — valid 2,779,381, signatures 2,809,725, registered 6,430,117 | Първанов **2,050,488** · Сидеров 649,387 |

These twenty figures become the **hard-coded anchors of the round-total gate** (§7), the way
`declaration_fx_conversion.data.test.ts` pins hand-verified ECB rates: a parser that drops a form, double-counts a
machine row or mis-splits a tuple cannot pass it.

### 2.5 Traps found in the data (each one becomes a gate or a documented rule)

1. **Machine votes are rows, not columns, in E2021.** A section's paper protocol (form 24/28) and each of its
   machines (form 32/41) are separate `votes.txt` rows with the same section code; `total = Σ rows`,
   `machine = Σ form-32/41 rows`, `paper = the form-24/28 row`. Reading only the first row per section (what a
   naïve `find(section)` does) drops every machine vote. Forms in R1: 24×3,089 · 25×9,350 · 26×49 · 27×101 ·
   28×542 · 29×208 · 31×5 · 32×11,419 · 41×411.
2. **E2016 machine votes live in the 5-tuple, not in separate rows** — 500 flagged sections, both `paper(Б)` and
   `machine(М)` columns populated (`010300011` has ticket 13 at 126 = 86 + 40). Invariant: `valid = Б + М` on
   flagged sections and `Б = valid, М = 0` elsewhere.
3. **2006 abroad protocols carry no signature count.** All 144 sections with prefix `32` have т.3 = 0 while
   holding 69,679 valid votes (both rounds). Turnout abroad in 2006 therefore uses т.6 (ballots found, col 10);
   `Σ signatures < Σ valid` for the country is expected and must not trip the turnout gate.
4. **2011 `result.txt`** marks `Б` (goes to runoff) / `И` (elected); the R2 file says `И;2;Росен Асенов
   Плевнелиев;…;1698136`. Use it as a cross-check, never as the source of the winner — the winner rule is
   computed (§3, decision 5) and compared.
5. **Encodings differ per era and two are not UTF-8** (windows-1251 for 2006/2011, MIK for 2001). Reading them
   with the default decoder does not throw — it stores mojibake ticket names that pass every count, exactly the
   `Response.text()` trap the АОП experts ingest documents. Each reader declares its encoding and the fixture tests
   assert a real Cyrillic name.
6. **The bundle URLs are not uniform**, and the 2021 one needs a click (§1.2). The per-cycle map lives in ONE
   place (`scripts/parsers_presidential/sources.ts`) and is what the watcher and the downloader both read.
7. **Two folder sweeps in the pipeline enumerate directories by name.** `parseElections --all`
   (`scripts/parsers/parse_elections.ts`) maps EVERY `raw_data/` directory, and `runStats`
   (`scripts/stats/collect_stats.ts`) rewrites `src/data/json/elections.json` from every `data/` directory
   starting with `20`/`19`. `elections.json` holds 0 `_mi` names today only because those trees lack
   `region_votes.json` — an accident, not a filter. A `data/2021_11_14_pvr/` tree WILL carry one. Tier 0 makes both
   sweeps explicit about kind before any presidential output exists.
8. **Sections are re-numbered between rounds** (§2.3) — six codes moved in 2021, five sections fewer in 2011 R2.
   Any R1→R2 per-section comparison (Tier 8) joins on `(code, ЕКАТТЕ)` and reports the unmatched residue rather
   than dropping it.
9. **The 2021 `suemg` block-256 rows use the SAME column shift as block 64** (`partyNumColumn("2021_11_14") = 2`,
   votes at `pCol + 1`, `99` = „не подкрепям никого"), so `parseSectionRows` needs a `block` parameter, not a
   second copy.

## 3. Fixed v1 decisions

1. **Cycle id = `<round-1 date>_pvr`** (`2021_11_14_pvr`), the folder name under both `raw_data/` and `data/`,
   and the URL segment in `/presidential/:cycle`. Never rendered as a label — the catalogue carries ISO dates,
   the `electionsHubCycle.ts` rule.
2. **Catalogue `src/data/json/presidential_elections.json`**:
   `{ name, round1Date, round2Date | null, decidedInRound: 1 | 2, winnerTicket, tickets: number }` — shape
   parallel to `local_elections.json`, imported by `ElectionContext` as `presidentialElections`, never entering the
   parliamentary `elections` array (so prev/next arrows keep skipping it, as locals do).
3. **Output tree mirrors the parliamentary per-election tree, per round**:
   ```
   data/<cycle>_pvr/
     tickets.json                 both rounds' tickets, numbers, nominating bodies, colours
     national_summary.json        R1 + R2 outcome, decidedInRound, turnout per round, abroad
     tur1/ | tur2/
       region_votes.json          same shape as the parliamentary file, partyNum := ticket number
       municipality_votes.json
       settlement_votes.json
       sections/<oblast>/…        per-section shards (protocol + votes), sharded by prefix as §5.0 of the hub plan
       abroad.json                the `32` / `29` prefix as one entity, by country
   ```
   Reusing `Votes` (`partyNum`, `totalVotes`, `paperVotes`, `machineVotes`, `suemgVotes`) and `SectionProtocol`
   verbatim is what lets the region / municipality / settlement hooks be parametrised by `(cycle, round)` instead
   of a new type family, and what lets the existing map and hemicycle-free result list render a ticket ranking.
4. **New parser tree `scripts/parsers_presidential/`, not new branches in `scripts/parsers/`.** One
   `PresidentialRound` canonical shape, one reader per era (`era2001.ts`, `era2006.ts`, `era2011.ts`,
   `era2016.ts`, `era2021.ts`), each a pure `rows → round` function with a fixture test, and one aggregator that
   writes the tree above. The parliamentary ladder is already keyed on five different year literals for four
   protocol shapes; adding a sixth key for a different election kind is the shape this repo has learned not to
   repeat (`declared_label()`, `magistrate_current`).
5. **Winner rule is computed and cross-checked, never copied.** Round 1 decides when a ticket has **more than half
   of the valid votes AND more than half of the registered voters took part** (Constitution, art. 93 (3)); otherwise
   the top two go to a runoff a week later. 2001, 2006, 2011, 2016 and 2021 all went to a runoff — 2006 and 2021
   on turnout (Първанов 64.05%, Радев 49.42%) — which is exactly the case a "majority = win" shortcut gets wrong.
   `decidedInRound` is derived from the numbers and compared with `result.txt` (2011) and the `elected` flag
   (2016) where those exist.
6. **Abroad is an entity, not a region.** Prefix `32` (`29` in 2011) aggregates to `abroad.json` by country
   (`lookup_international_sections` already resolves section → country for the parliamentary tree); turnout abroad
   is votes cast, never a registered-voter denominator — the elections-hub plan's abroad rule.
7. **JSON, bucket-served, no Postgres in v1.** This is the parliamentary precedent and the surface system reads
   files; nothing here needs a live query. If a serving need appears later (a cross-cycle person page, the
   split-ticket analysis) it gets a migration with a changelog, per [[feedback_pg_changelog_required]].
   `data/*_pvr/` is already inside `bucket:sync`'s include set (no `-x` arm matches it) — Tier 7 confirms with
   `bucket:sync:dry` before the first publish.
8. **`ElectionKind` gains `"presidential"`**, and every switch over it must be exhaustive (the TypeScript
   `never` check, plus `surfaceIsNotAHub.test.ts`-style gates that already enumerate kinds). The outcome contract
   is a new discriminated member — `{ kind: "presidential", round1: TicketRanking, runoff?: TicketRanking,
   decidedInRound }` — beside the parliamentary and local contracts, never a normalisation of either.

## 4. Tier 0 — guards before any output exists (½ day)

- **T0.1** `parseElections`: filter `raw_data/` directories to `^\d{4}_\d{2}_\d{2}$` (parliamentary only) and
  make the `--all` path say how many it skipped. Today `--all` maps every directory, including `agri/` and every
  `_mi`; establish first whether that path is actually exercised (`npm run prod`) and what a missing
  `cik_parties.txt` does — the `createReadStream` error is unhandled.
- **T0.2** `runStats`: the `startsWith("20")` sweep over `data/` gains the same regex; a unit test asserts that a
  directory named `2021_11_14_pvr` (and `2023_10_29_mi`) can never enter `elections.json`.
- **T0.3** `scripts/machines_memory/parseSectionRows` takes `block: "64" | "256"` (default `"64"`), so the
  presidential reader can reuse it; the existing test gains a block-256 fixture row from
  `raw_data/2021_11_14/suemg/01/010100001.zip` (`010100001;256;6;99;0` is the „никого" row, `256;15;42;0` the
  Герджиков row).
- **T0.4** i18n: reserve the key family `presidential_*` in `translation.json` (core) — the hub, selector and
  upcoming-ballot tile name the kind on every page, so it cannot be a deferred bundle; the screens' own copy goes
  into a new `elections.json` bundle only if `scripts/i18n/bundles.ts` proves it exclusive (T4.5).

## 5. Tier 1 — acquisition tooling (1–2 days)

- **T1.1** `scripts/parsers_presidential/sources.ts` — the per-cycle map: slug (`pvrns2021`, `pvrnr2016`,
  `mipvr2011`, `pvr2006`, `prezident2001`), round → zip URL, warm URL, download strategy
  (`"goto"` | `"click"`), extraction rule (which subtree becomes `ТУР1/`/`ТУР2/`), encoding. ONE map, read by the
  downloader (T1.2), the watcher (T7.1) and the readers (Tier 2).
- **T1.2** `cikDownloadFile` gains `strategy: "click"` — warm the listing page, `page.click` the anchor whose
  `href` ends in the zip name, race `waitForEvent("download")`. Keep `"goto"` as the default; the map says which
  cycle needs which (§1.2). `npm run data -- --pvr-download <slug>` mirrors `--local-csv`: flag-gated, pops a
  window, extracts under `raw_data/<cycle>_pvr/`, never part of the watcher flow
  ([[feedback_one_off_backfills]]).
- **T1.3** Decoders in `scripts/parsers_presidential/encoding.ts`: `decodeMik(buf)` (64-entry table; the `Read_DOS`
  / `COMMON.201` pair is the fixture — „Президент и Вицепрезидент" must round-trip), `decodeCp1251` via
  `TextDecoder("windows-1251")`, and BOM stripping for E2016. `extractZipCp866` stays for the 2011 zip's
  cp866 FILE NAMES — a different concern from the cp1251 CONTENTS.
- **T1.4** A `raw_data/<cycle>_pvr/SOURCE.json` stamp written by the downloader: URL, byte size, md5, fetched-at —
  the provenance the five hand-placed trees from this session lack; back-fill it from §1 for them.

## 6. Tier 2 — the readers (3–4 days)

Canonical shape, `scripts/parsers_presidential/types.ts`:

```ts
type Ticket = { number: number; president: string; vicePresident: string;
                nominatedBy: { name: string; kind: "party" | "coalition" | "committee" };
                nickName?: string; color?: string };
type PresidentialSection = { code: string; round: 1 | 2; ekatte?: string; oblast: string; obshtina?: string;
                             placeName: string; abroad?: { country: string };
                             isMobile: boolean; isShip: boolean; machines: number;
                             protocol: SectionProtocol; votes: Votes[] /* partyNum := ticket number */ };
type PresidentialRound = { cycle: string; round: 1 | 2; date: string; tickets: Ticket[];
                           sections: PresidentialSection[]; sourceEra: "2001"|"2006"|"2011"|"2016"|"2021" };
```

- **T2.1 `era2021.ts`** — parties + candidates (§2.2), sections (8 cols), protocols by form (positions from the
  `isMachineOnlyVote` branch of `protocols.ts` — copy the POSITIONS into a per-form table with the readme's field
  names beside each index, which the ladder never had), votes as pairs summed across rows per (section, form
  class), `suemgVotes` from block 256. The `cik_parties` composite names are ignored for names.
- **T2.2 `era2016.ts`** — 5-tuples; protocol forms 1/7/8 (32 positions, readme lines 5–32); machine flag from
  `sections[7]`; ticket split on ` и `.
- **T2.3 `era2011.ts`** — cp1251; pairs; 27-position protocol (fields 3–27 per the decoded readme: registered =
  3, additional = 4 + 5, signatures = 7, ballots found = 20, invalid = 26, valid = 27); oblast grid via
  `OIK_PREFIX_TO_OBLAST`; `result.txt` as the cross-check.
- **T2.4 `era2006.ts`** — cp1251; the readme is the ticket list; protocol cols 2–16 (registered = 5 + 6,
  signatures = 7, ballots found = 10, invalid = 15, valid = 16), votes cols 17+; abroad turnout from col 10
  (§2.5-3).
- **T2.5 `era2001.ts`** — MIK; INI blocks; `[PROT]` `+`-joined fields (the Благоевград sample:
  `813+1+347+347+0+1+1+0+346` then `2+148+58+12+124+2` for six tickets); `[NM]` for ЕКАТТЕ; `[MAJ]`/`[AGGR]` as
  per-oblast cross-checks the reader must reproduce from its own sections.
- **T2.6 Gates (Vitest, `scripts/parsers_presidential/*.test.ts`, no Postgres):**
  - each era reader on a 3-section fixture cut from the real file, asserting one decoded Cyrillic ticket name;
  - the **round-total anchor gate** over the full raw tree: the twenty figures in §2.4, exact;
  - `Σ votes == protocol.numValidVotes` per section, with the per-era exception list stated (2001 `[PROT]` has
    both, 2006 col 16, 2011 col 27, 2016 pos 24, 2021 pos 18);
  - `paper + machine == total` on every row that has both (E2016 flagged sections, E2021);
  - runoff rounds carry exactly two tickets whose numbers exist in round 1;
  - section counts per round equal the sections-file line count; abroad prefix is `32` except 2011 (`29`);
  - the `decidedInRound` rule agrees with `result.txt` / the 2016 `elected` flag.

## 7. Tier 3 — aggregation and the output tree (2–3 days)

- **T3.1** `aggregateRound()` — ЕКАТТЕ → `data/settlements.json` → municipality → oblast, reusing `addResults`
  and `regionCodes`; for the МИР-grid eras also the 9-digit-code join to the parliamentary section shards for
  GPS/address (the `backfillLocalSectionCoords` transfer, read-only). Writes the §3-3 tree; sections sharded by
  oblast prefix.
- **T3.2** `national_summary.json` per cycle: per-round turnout (registered, signatures — ballots found for 2006
  abroad), valid, invalid, „не подкрепям никого" where the form has it (2016+), the ticket ranking, the runoff
  pair, `decidedInRound`, abroad totals, and the R1→R2 swing (Δ votes per surviving ticket, Δ turnout).
- **T3.3** `tickets.json` with colours and `canonicalTicketKey`; a `scripts/parsers_presidential/ticket_defaults.json`
  for the few nominating bodies whose `nickName` differs from the parliamentary spelling.
- **T3.4** `npm run data -- --pvr <cycle>` / `--pvr --all` wired in `main.ts` next to the local flags; folded into
  `--all` only after T0.1/T0.2 exist. A `data/data-changes.json` entry per ingest via
  `scripts/append-data-change.ts` ([[reference_two_changelogs]]).
- **T3.5** Gate: a byte-stability test (a second run over the same raw tree writes identical files — nothing reads
  the clock), and a `region_votes.json` ↔ `national_summary.json` reconciliation per round.

## 8. Tier 4 — catalogue, context, hub (2 days)

- **T4.1** `presidential_elections.json` (decision 2) + `ElectionContext.presidentialElections`.
- **T4.2** `electionsHubCycle.ts`: `ElectionsHubCycle.kind` gains `"presidential"`; `ELECTION_EVENTS` merges the
  third catalogue; the latest event on 2026-11-1x becomes the presidential cycle, which is the whole point of the
  sorted merge that file already insists on.
- **T4.3** `ElectionsSelect.tsx`: a third row kind with the winner's ticket surname and `decidedInRound`; arrows
  keep skipping non-parliamentary rows.
- **T4.4** `electionsRegistry.ts`: a `presidential` tile in the results band (`to: /presidential/<latest>`,
  `cycleScoped`) and, in the analysis band, the runoff-transfer tile once Tier 8 lands — never before, a tile must
  not seed a destination (`dashboard-hub` skill).
- **T4.5** i18n keys in both locales, run `npm run i18n:prune` dry to confirm reachability; the `elections`
  bundle question settled by `scripts/i18n/bundles.ts`, not by hand.
- **T4.6** `upcomingElections.ts`: flip the 2026 entry to `scheduled` with the decree date when it is published
  (the Народно събрание sets the date ≥ 60 days ahead); the My-Area tile already reads it.

## 9. Tier 5 — screens and routes (5–7 days; product decisions marked ⚑)

Route family, parallel to `local/:cycle/…` in `src/routes.tsx`:

```
/presidential/:cycle                       country: R1 ranking + runoff panel, map by leading ticket, turnout, abroad
/presidential/:cycle/round/2               the runoff as its own page (map by winner, swing vs R1)   ⚑ or a toggle on the country page
/presidential/:cycle/region/:oblast        oblast: both rounds, municipalities table, map
/presidential/:cycle/municipality/:obshtina
/presidential/:cycle/settlement/:ekatte
/presidential/:cycle/section/:code         evidence: the protocol, per-ticket votes, paper/machine, suemg parity
/presidential/:cycle/abroad                by country, votes cast only
```

Rules carried over from `elections-hub-implementation-v1.md` and not re-litigated: ranked result before the map
on mobile; every map has a list twin; colour never the only encoding; the `?elections` contract; the surface
projection only for levels that pass the emission test; prerender + sitemap `<loc>` + og:image for every route
family member. The **outcome panel is ticket-shaped**: president + vice-president names, nominating body, votes,
share of valid, and — on round 1 — the two-condition decision rule stated in words with the turnout figure, since
„49.42% and no winner" is the sentence a reader needs.

⚑ **Section maps for 2011**: the oblast-grid codes carry no GPS join; the map falls back to settlement
centroids for that cycle (as the 2005 parliamentary tree does), and the page says so.
⚑ **2001**: include in the selector from day one (its numbers are as verified as the rest) or hold until Tier 9
resolves the `[SEC]` code space — recommendation: hold, ship four cycles, add 2001 with 1992/1996 together.

## 10. Tier 6 — SEO surface (1–2 days)

- Prerender routes for every family member above (`scripts/prerender/routes.ts`, both languages, no-slash URLs;
  the EN root asymmetry rule), `sitemap_presidential.xml` as its own family in BOTH `route_defs` lists, and
  `tests/seo.spec.ts` samples that skip rather than fail on a checkout without the data tree.
- One og:image per country / round page from a captured chart (`scripts/capture-*.mjs` pattern); the region
  pages reuse the parliamentary region scene with the ticket palette.
- `llms-full.txt`: a presidential section, refused by `buildFull.ts` if it would disappear.
- Volume: 5 cycles × (1 country + 1 runoff + 28 regions + 265 municipalities) ≈ 1,500 pages ×2 languages —
  inside the Firebase file-count ceiling with room; settlement and section pages are SPA-only, as for local.

## 11. Tier 7 — operations for the 2026 cycle (1–2 days)

- **T7.1 Watcher**: `scripts/watch/sources/cik_results.ts` learns a `presidential` kind — discover the slug from
  the root index with `/(pvr[a-z]*\d{4})\//` (2016 was `pvrnr`, 2021 `pvrns`; 2026 is a standalone election
  unless a snap parliamentary vote coincides, so expect `pvr2026`), HEAD both `tur1/export.zip` and
  `tur2/export.zip`, fingerprint on Last-Modified + Content-Length. Round 2 publishes ~7 days after round 1
  into `tur2/` — the local watcher's `RUNOFF_RECHECK_DAYS` scheduling applies unchanged. The 2021 bundle was
  dated four days after election day; the first-round results appear as HTML within hours, so a **provisional
  HTML path** (the per-МИР `rezultati/NN.html` pages, same shape the local ingest mirrors) is the ⚑ option for
  election night, with the CSV bundle as the authoritative re-ingest.
- **T7.2 Skill** `update-presidential-elections`: triggers, the download → parse → aggregate → surfaces →
  `bucket:sync:paths -- <cycle>_pvr` → `data-changes` → `person:slugs`? (no — no PG) chain, the runoff re-check,
  and the troubleshooting table (the §2.5 traps in operator form). Registered in `process-watch-report`'s map and
  stamped in `state/ingest/cik_presidential.json`.
- **T7.3** `bucket:sync:dry` before the first publish; confirm `data/*_pvr/` is uploaded and nothing under
  `raw_data/` is (it never is — `bucket:sync` roots at `data/`).

## 12. Tier 8 — cross-links and the two analyses only this data can carry (3+ days, ⚑ scope)

- **T8.1 Tickets ↔ persons.** Radev, Йотова, Цачева, Каракачанов, Карадайъ, Костадинов, Панов, Марешки,
  Плевнелиев, Калфин, Кунева, Първанов, Сидеров are all in the person layer through MP terms, cabinet posts
  or the declarations register. Link a ticket to `/person/<slug>` through the existing candidate→person
  resolution (`docs/plans/person-candidate-merge-v1.md`), refusing a name that folds to more than one person
  ([[feedback_name_match_not_identity]]). A presidential candidacy becomes a `person_role`
  (`source = 'pvr'`, `date_basis = 'term'`) only in a later PG tier.
- **T8.2 Runoff transfer** — per section, `R2(winner) − R1(winner)` against the eliminated tickets' R1 votes and
  the turnout change; a settlement-level map and a national Sankey (the `voteFlows/` machinery). Join on
  `(code, ЕКАТТЕ)` with the residue reported (§2.5-8).
- **T8.3 Split-ticket 2021** — per section, the ПВР ticket vote vs the НС list vote of the nominating party
  (Радев/ИК vs ПП+ИТН+БСП…, Герджиков vs ГЕРБ-СДС, Карадайъ vs ДПС, Костадинов vs Възраждане): the share of a
  party's list voters who did not vote for its ticket. Both files are on disk and byte-aligned on section code.
- **T8.4** The AI chat: a `presidentialResults(cycle, round, place?)` tool over the JSON tree; the data map
  (`scripts/data_map`) gains the source.

## 13. Tier 9 — the pre-2003 archives (stretch)

`1991_1999.zip` (1992, 1996) and finishing 2001: the same „Деметра" INI format; the open question is the
`[SEC]` code space (`01;0100;001;6;001` — the second field is not the `[NM]` obsht code) and whether settlement
ЕКАТТЕ codes from 2001 still resolve in `data/settlements.json` (most will; renamed villages will not). Go/no-go
after T2.5 reports the resolution rate.

## 14. Gates — the full list

| gate | where | what it holds |
| --- | --- | --- |
| sweep isolation | `parse_elections.test.ts`, `collect_stats.test.ts` | a `_pvr` / `_mi` directory can never enter `elections.json` or the parliamentary parse |
| era fixtures | `scripts/parsers_presidential/era*.test.ts` | 3-section fixture per era; a decoded Cyrillic ticket name; the exact per-era protocol positions |
| round-total anchors | `presidential_totals.data.test.ts` (node project, reads `raw_data/`) | the twenty §2.4 figures, exact; skips with a DISTINCT reason if a raw tree is absent |
| protocol invariants | same file | `Σ votes = valid`, `paper + machine = total`, section counts, abroad prefix, runoff pair ⊂ R1 tickets, 2006 abroad signatures = 0 (documented, asserted so a "fix" cannot silently change the denominator) |
| winner rule | `winnerRule.test.ts` | the two-condition rule on the five real outcomes plus a synthetic R1 win |
| byte stability | `aggregate.test.ts` | two runs, identical output |
| kind exhaustiveness | existing `surfaceIsNotAHub`, `electionsHubCycle`, `electionCopyCoverage` tests | every switch over `ElectionKind` handles `presidential` |
| i18n | `key_usage.test.ts`, `bundle_reachability.test.ts` | no unreachable `presidential_*` key; bundle membership proven |
| SEO | `tests/seo.spec.ts`, `families.data.test.ts` | every `<loc>` has a `dist/` page; canonicals do not redirect |
| block-256 | `machines_memory/index.test.ts` | the presidential block parses with the same column shift and the `99` row is excluded |

## 15. Sequencing and effort

```
T0 ─► T1 ─► T2 ─► T3 ─► T4 ─► T5 ─► T6 ─► T7        (v1 cut: ≈ 3 weeks)
                        └─► T8 (after T5)   T9 (after T2.5 go/no-go)
```

- T0–T3 are pure pipeline work with no UI, each landing with its gates; the raw data is already in place, so
  T1's downloader is exercised against the on-disk trees (idempotent skip) and only "live" on 2026-11.
- T4 must precede T5 (the hub cycle model is what the screens resolve); T6 follows T5 in the same step so no
  route ships without its prerender and `<loc>`.
- T7 is the deadline-bound tier: it must be green before the 2026 decree, i.e. **September–October 2026** is the
  window in which the whole chain is proven on the four historical cycles.

## 16. Open questions (⚑ recap, the decisions this plan does not make)

1. Runoff as its own route or a round toggle on the country page (T5).
2. Ship 2001 with v1 or hold it for Tier 9 (recommendation: hold).
3. Election-night provisional HTML ingest vs waiting ~4 days for the CSV bundle (T7.1).
4. Whether a presidential candidacy should become a `person_role` now (PG migration + changelog) or after the
   JSON layer proves the identity links (recommendation: after).
5. Whether the 2011 presidential half should ALSO surface on the existing `/local/2011_10_23_mi` pages, which
   were built from the same joint bundle and currently ignore the `президент/` folder (recommendation: link out
   to `/presidential/2011_10_23_pvr`, do not merge).
