# Presidential elections — ingest and surface plan

**Status:** ready to execute (Tiers 0–4 are fully specified; Tiers 5–8 carry product decisions listed in §9)  
**Scope:** every presidential election ЦИК publishes machine-readably — 2001, 2006, 2011, 2016, 2021 — plus the
2026 cycle (constitutional window: first Sunday of November; `upcomingElections.ts` carries 2026-11-08 as an
*estimated* anchor until the decree is published)  
**Version:** v1.1 — a third election kind (`presidential`) beside `parliamentary` and `local`, on the same raw → data
→ surface grammar, with its own outcome contract (ticket ranking + runoff), never folded into a party ranking.
Revised 2026-09-05 after review: the majority DENOMINATOR (§2.4, decision 5), per-section residues (§2.5-10,
T2.6), abroad resolution for 2006/2011 (§2.5-12, T3.1), the turnout basis (§2.5-11, T3.2), the EIGHT folder
sweeps (Tier 0), and the hub / adapter / perf integration points (T4.7–T4.9, T5, §14)  
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
| 2021 | Радев/Йотова **1,322,385** · Герджиков/Митева 610,862 · Карадайъ (ДПС) 309,681 · Костадинов 104,832 · Панов 98,488 — tickets 2,615,149 + „не подкрепям никого" 60,786 = **valid 2,675,935** | Радев **1,539,650** · Герджиков 733,791 |
| 2016 | Радев/Йотова **973,754** · Цачева/Манушев 840,635 · Каракачанов 573,016 · Марешки 427,660 · Орешарски 253,726 — tickets 3,613,556 + „никого" 214,094 = **valid 3,827,650** | Радев **2,063,032** · Цачева 1,256,485 |
| 2011 | Плевнелиев/Попова **1,349,380** · Калфин/Данаилов 974,300 · Кунева 470,808 · Сидеров 122,466 | Плевнелиев **1,698,136** · Калфин 1,531,193 |
| 2006 | Първанов/Марин **1,780,119** · Сидеров/Шопов 597,175 · Беронов/Николова 271,078 · Марков 75,478 · Берон 21,812 · Велев 19,857 · Петров 13,854 — valid 2,779,381, signatures 2,809,725, registered 6,430,117 | Първанов **2,050,488** · Сидеров 649,387 |

These twenty figures become the **hard-coded anchors of the round-total gate** (§7), the way
`declaration_fx_conversion.data.test.ts` pins hand-verified ECB rates: a parser that drops a form, double-counts a
machine row or mis-splits a tuple cannot pass it.

⚠️⚠️ **A SHARE IS COMPUTED OVER ALL VALID VOTES, „НЕ ПОДКРЕПЯМ НИКОГО" INCLUDED — and the ticket sum is the
WRONG denominator.** Радев's 1,322,385 is **50.57%** of the 2021 round-1 ticket votes and **49.42%** of the valid
votes; the second is the official figure, and it is the one the round-1 decision reads. A parser summing the
tickets would have ELECTED him in round 1. 2016 confirms the rule from the other side: 25.44% with the 214,094
„никого" ballots in the denominator (the official figure), 26.95% without. The „никого" count is protocol field
7.2 — index 18 across forms 24/26/28/32/41 in E2021 (60,786 = 3,859 + 219 + 2,242 + 52,490 + 1,814), position 27
(index 26) in E2016 — and it does not exist before 2016, so the earlier eras' denominators ARE the ticket sums.

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
10. **Per section, the ticket sum does NOT equal the protocol's valid count, in any era — the national totals
    still match because ЦИК publishes the same per-ticket sums.** Measured on round 1: 2021 paper rows disagree
    on 17 sections (|Δ| 2,393 votes), 2016 on 54 (|Δ| 4,878), 2011 on at least 10 in BOTH directions (net +6:
    `224610044` has 524 valid against 551 ticket votes, `161200020` 435 against 411). An exact per-section
    equality gate fails on the first run on ЦИК's own inconsistencies; the gate is a REPORTED residue with a
    per-cycle ceiling and a named allowlist, and the surface renders the ticket votes while the protocol panel
    shows the protocol's own figure, both labelled.
11. **The turnout basis is not the one the CIK activity page prints, and it must be declared.** Summing the 2021
    round-1 protocols gives signatures **2,687,307 — exactly the page's figure** — but registered voters of
    6,667,895 over all forms or 6,609,634 over domestic forms against the page's 6,635,305; neither reproduces its
    40.50% (40.30% / 37.20%). Anchor on signatures, publish the registered basis the aggregator uses (all forms,
    abroad lists included), name it on the surface, and record that the activity page counts registration
    differently rather than chasing its figure.
12. **2006 and 2011 abroad rows carry a CITY and no country**, so `lookup_international_sections` — keyed on the
    „32. Извън страната" region label plus a „Country, City" place string — fits only 2016 and 2021. 2011 rows read
    `ЧУЖБИНА;Чужбина;Канбера;100001`, 2006 rows are a bare city with an EMPTY ЕКАТТЕ, and one of them is
    „Mелбърн" with a LATIN M. Tier 3 adds a city→country table for the two eras (the helper's existing city
    fallback is the seam) behind a fold that survives mixed-script typos, and a gate that every abroad section
    resolves or is listed.

## 3. Fixed v1 decisions

1. **Cycle id = `<round-1 date>_pvr`** (`2021_11_14_pvr`), the folder name under both `raw_data/` and `data/`,
   and the URL segment in `/presidential/:cycle`. Never rendered as a label — the catalogue carries ISO dates,
   the `electionsHubCycle.ts` rule.
2. **Catalogue `src/data/json/presidential_elections.json`**:
   `{ name, round1Date, round2Date | null, decidedInRound: 1 | 2, winnerTicket, tickets: number,
   rounds: { [1|2]: { machineVoting: boolean, flashRecords: boolean, noneOfTheAbove: boolean } } }` — shape
   parallel to `local_elections.json` plus the per-round CAPABILITY flags the parliamentary `ElectionInfo`
   carries as `hasSuemg` etc. (2021: machines + flash records both rounds; 2016: machines in 500 sections, no
   flash; „никого" from 2016 on), so a tile never renders a paper/machine split for a round that has none.
   Imported by `ElectionContext` as `presidentialElections`, never entering the parliamentary `elections` array
   (so prev/next arrows keep skipping it, as locals do).
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
   the top two go to a runoff a week later. **"Valid votes" is the protocol's total of valid ballots — the ticket
   votes PLUS the „не подкрепям никого" ballots on the 2016+ forms — never the sum of the ticket rows** (§2.4). The
   rule therefore reads two protocol fields (7.1 + 7.2) beside the ticket totals, and its unit test carries 2021
   round 1 as a MUTATION case: the ticket-sum denominator elects Радев outright (50.57%), the correct one sends him
   to a runoff (49.42%). 2001, 2006, 2011, 2016 and 2021 all went to a runoff — 2006 on turnout alone (Първанов
   64.05% of valid votes, 42% turnout) and 2021 on both conditions — which is exactly the case a "majority = win"
   shortcut gets wrong. `decidedInRound` is derived from the numbers and compared with `result.txt` (2011) and the
   `elected` flag (2016) where those exist.
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

- **T0.1 ✅ DONE.** One predicate, `electionFolderKind(name): "parliamentary" | "local" | "chmi" |
  "presidential" | null` in `scripts/lib/electionFolders.ts`, and every LOOSE sweep goes through it.
  ⚠️ **The count in v1.1 was wrong: it is FIVE sites, not eight.** That estimate came from grepping
  `readdirSync` callers whose file mentions `data/` or `raw_data/` anywhere, and three of the eight turned out
  not to enumerate election folders at all — `split_sections.ts` reads a single election's OUTPUT directory for
  stale `*.json`, `smetna_palata/index.ts` reads the party-financing folder, and `officials/candidate_links.ts`
  reads officials shards. Re-measured by the filter each caller actually applies, the real set is:

  | site | filter before | why it was unsafe |
  | --- | --- | --- |
  | `scripts/parsers/parse_elections.ts` | **none at all** | `--all` handed every directory — `agri/`, `budget/`, every `_mi` — to `parseParties`, whose `createReadStream` on a missing `cik_parties.txt` rejects unhandled |
  | `scripts/stats/collect_stats.ts` | `startsWith("20") \|\| startsWith("19")` | rewrites `elections.json`; `_mi` stays out only because those trees lack `region_votes.json`, which a `_pvr` tree WILL carry |
  | `scripts/parsers/findSection.ts` | `startsWith("20")` | cross-election section lookup; 2011's oblast-grid codes are a different key space, so a hit there attributes one election's section to another |
  | `scripts/preferences/index.ts` | `startsWith("20")` | preferences are a proportional-list mechanic; a presidential ballot has no list to prefer within |
  | `scripts/bucket_gzip.ts` | `/^\d{4}_\d{2}_\d{2}/` **unanchored** | matched `_pvr` already — and that is the RIGHT behaviour (presidential data is bucket-served), so it is routed through `isElectionFolder()` to make it a decision rather than an accident |

  ⚠️ **The 8 − 3 = 5 arithmetic is a coincidence, and the two adjustments matter to anyone reconciling the
  lists.** `scripts/parsers/backfill_section_coords.ts` was in the original eight and is NOT in the five — it is
  a real election sweep, but it already carries the anchored form, so it falls under the ~20 below rather than
  under the three exonerations. And `scripts/bucket_gzip.ts` is in the five and was NOT in the original eight:
  it was found by searching for the regex SHAPE rather than for `readdirSync`. Net: 8 − 3 − 1 + 1 = 5.

  The ~20 remaining sites already use an anchored exact regex (`/^\d{4}_\d{2}_\d{2}$/`, `…_mi$/`) and are
  correct as they stand; rewriting them would be a large unrelated refactor. `scripts/elections/build_surfaces.ts`
  is one of those and only needs the new arm (T3.1). ⚠️ Two **variant** spellings existed that a grep for the
  canonical literal cannot see — `/^20\d\d_\d\d_\d\d$/` in `scripts/preferences/rebuild_resolved.ts` and
  `/^2\d{3}_\d{2}_\d{2}$/` in `scripts/migrate_sections_to_oblast.ts`; both were folded into the predicate, and
  the module's header records the shapes so a future consolidation searches for them rather than for the text.

  `parse_elections.ts` and `collect_stats.ts` report what they skipped; `findSection.ts` and `preferences/index.ts`
  are silent narrowings and `bucket_gzip.ts` is kind-blind, so neither has anything to report. **The skip line
  counts other ELECTION kinds only** (`describeSkippedElectionFolders`) — a raw "non-parliamentary" difference is
  120 of 133 under `data/` and 96 of 109 under `raw_data/`, dominated by unrelated datasets, i.e. a number nobody
  can act on printed on every run. A `--date` naming a tree of the wrong kind is REFUSED, naming the ingest that
  would take it.

  **Gates.** `electionFolders.test.ts` carries the unit cases, an on-disk inventory sweep over both roots (a real
  `ctx.skip` when a root is absent, so "not checked" cannot read as "all classified"), and — because a new sweep
  that never calls the predicate is invisible to unit tests — a **static gate** over `scripts/` and `src/`,
  test files included, with comments stripped. It covers all three loose shapes: the year-prefix test, the
  unanchored date regex, and — structurally, since it has no text to match — **the no-filter shape itself**, by
  requiring that a file which enumerates a data root classify by kind somehow (the predicate, an anchored regex,
  or a suffix test) or be allowlisted with a reason (three are: two walk a subdirectory through a root-named
  variable, one is kind-blind by design). Both halves carry a **positive control**, because a gate whose patterns
  are nine escaped metacharacters each fails green when one breaks.
  `scripts/parsers/parse_elections.test.ts` covers the refusal branch and `scripts/preferences/index.test.ts` the
  ordering contract below.

  ⚠️ **T0.1 also carried two pre-existing defects out with it, both found by review rather than by the change:**

  - **`preferences/index.ts` was not a no-op narrowing.** `folders` is INDEX-ORDERED and
    `createPreferencesFiles` reads `folders[index - 1]` as "the previous election". Under the old
    year-prefix filter that predecessor was the nearest `_chmi` folder for **12 of 13** elections — none of
    which carries a `candidates.json`, against an unguarded `readFileSync`, so prev-year preference carry-over
    could never have run for them. It now resolves to the previous PARLIAMENTARY election, which is what
    `assignPrevYearPreference` means. That is the intended answer AND a change to generated output: the next
    `--candidates` run may write carry-over that was never there. The read is now guarded so a missing prior
    year degrades instead of aborting the whole `Promise.all`, and the list is a named export
    (`listPreferenceFolders`) whose header states the coupling.
  - **`runStats` read and wrote `public/`, which holds no election data at all.** The GCS migration moved the
    tree to `data/` and updated the folder LIST without updating the reads and writes, so `npm run data -- --stats`
    threw ENOENT on the first election and every guard this tier adds there was unreachable. All five targets
    (`sofia_stats.json`, `regions/`, `municipalities/`, `settlements/`, `sections/`) exist under `data/` and were
    last written by that migration commit; `publicFolder` now resolves to the data root, keeping the historical
    name the whole pipeline uses for it.
- **T0.2** With the predicate in, establish what `npm run prod` (`--all`) actually does today against the `_mi`
  and non-election directories — the `createReadStream` error on a missing `cik_parties.txt` is unhandled — and
  add the `elections.json` gate: a `_pvr` or `_mi` name can never enter it.
- **T0.3 ✅ DONE.** `parseSectionRows` takes `block: MachineBlock` (default `PARLIAMENT_BLOCK`), and
  `parseSectionFile` threads it, so the presidential reader is the same parser with a different block rather
  than a copy that can drift from it — it inherits the column shift, the `99` exclusion and the
  first-occurrence rule for free. ⚠️ `parseMachinesFlashMemory` is deliberately NOT parameterised: it writes the
  fixed `suemg.json` that `parseVotes` reads, so a presidential caller pointed at it would overwrite the
  parliamentary tally under the same filename; T2.1 composes `parseSectionFile` and owns its own output path.
  The fixture is verbatim from `raw_data/2021_11_14/suemg/01/010100001.zip`, cross-checked against the SECOND
  (machine) row for that section in **`raw_data/2021_11_14_pvr/ТУР1/votes_14.11.2021.txt`** — ticket 6 → 99,
  ticket 15 → 42. ⚠️ NOT against `raw_data/2021_11_14/votes.txt`: that is the parliamentary file from the same
  day and carries neither ticket, so citing it (as an earlier draft of this bullet and of the test comment both
  did) makes the fixture look fabricated to anyone who checks. ⚠️ Note also the row this plan first cited as
  „никого" was misread: `010100001;256;6;99;0` is **ticket 6 with 99 votes**; the „никого" row is `256;99;6;0`
  — party 99, six votes.

  **Tests 1–3 are what a parameter-ignoring stub cannot pass** — each asserts a value only the 256 block can
  produce, and all three were measured failing against such a stub. The fourth guards the OTHER direction, that
  the default has not moved: it asserts the 3-argument call equals the explicit `PARLIAMENT_BLOCK` call and that
  the result is the parliamentary content, so a flipped default fails it. (Crediting the mutation guarantee to
  the fourth test, as an earlier draft did, would invite someone to consolidate 1–3 away and leave a green suite
  that proves nothing.) Two more cover the refusal branch, and two read the committed zip through
  `parseSectionFile`, because deleting the block argument from its one internal call reverts every presidential
  read to the parliamentary tally while every pure-function test still passes.
- **T0.4 ⛔ NOT DOABLE AT THIS TIER — it moves to T4.5, and the reason is a gate, not an oversight.**
  `scripts/i18n/key_usage.test.ts` asserts `usage.unused` is EMPTY: every key in the corpus must be reachable
  from a call site. "Reserving" a `presidential_*` family before any screen names it would therefore turn the
  i18n gate red on the commit that reserved it. What survives from T0.4 is the DECISION, recorded here and
  binding on T4.5: the hub, the selector and the upcoming-ballot tile name this kind on pages that are not
  presidential pages, so those keys belong in **core `translation.json`** and cannot go in a deferred bundle;
  only the presidential screens' own copy is a bundle candidate, and `scripts/i18n/bundles.ts` decides that by
  proving exclusivity rather than by hand.

## 5. Tier 1 — acquisition tooling (1–2 days)

- **T1.1 ✅ DONE.** `scripts/parsers_presidential/sources.ts` — the per-cycle map: slug, round → zip URL, warm
  URL, download strategy, extraction subtree, encoding, and an md5 where one was measured. ONE map, read by the
  downloader (T1.2), the watcher (T7.1) and the readers (Tier 2). Two structural facts fell out of building it:
  **two rounds can name ONE archive** (2016 and 2001 publish a single zip holding both, and 2016's two round
  URLs serve the same md5), so `archivesToFetch()` collapses them rather than fetching the file twice and
  implying the source publishes two; and **`subtree` is the field that moves data between rounds**, so it has a
  disk-backed gate — a mutation pointing 2016 round 1 at round 2's folder passed every other test in the file,
  and would have published the runoff's protocols under round 1's date with every count reconciling.
  ⚠️ `scripts/parsers_local/download_csv_bundle.ts` names the SAME 2011 archive for the local races; both maps
  now cross-reference each other, and giving that URL one home is open work.
- **T1.2 ✅ DONE.** `cikDownloadFile` gains `strategy: "click"`, and `npm run data -- --pvr-download <cycle>`
  mirrors `--local-csv`: flag-gated, pops a window, never part of the watcher flow. `--pvr-force` re-fetches a
  cycle already on disk and `--pvr-allow-digest-change` accepts an archive ЦИК has re-published. Four things the
  build settled:

  - ⚠️ **The click selector cannot be the zip's BASENAME.** Three archives in the map are called `export.zip`,
    and Playwright's `page.click` takes the first match with no strict-mode error — so a warm page linking both
    rounds would quietly download the wrong one. Every anchor is resolved against the page URL and matched on
    the full href, and a page with no matching anchor says so rather than reporting "Cloudflare or 404".
  - ⚠️ **Placement is ATOMIC, and that is forced by the skip check.** `roundIsPresent` asks only whether the
    round folder is non-empty, so a copy that threw halfway would leave a PARTIAL round that every later run
    reports as "already on disk" and never re-fetches — a quietly incomplete corpus whose logs say `skipped`.
    Files are built in `ТУРn.incoming` and swapped; an empty placement is refused outright.
  - ⚠️ **The zip is removed in a `finally`.** `raw_data/**_pvr` is TRACKED, so a throw between download and
    extraction would otherwise leave 130 MB in a committed directory. The sibling local downloader gets away
    without this only because its output tree is gitignored wholesale.
  - **The md5 is checked BEFORE extraction**, so a re-published archive can never reach the tree; the error
    names the override and points at §2.4's totals for the re-verification.
- **T1.4 ✅ DONE.** `raw_data/<cycle>_pvr/SOURCE.json` per cycle, written by `stamp_from_archives.ts` — a
  COMMITTED producer rather than a throwaway snippet, matching archives to slots by CONTENT (the declared md5)
  rather than by filename. Three distinctions it keeps that a simpler file would blur:

  - `stampedAt` is when the file was written and `fetchedAt` when the bytes were fetched. The five historical
    stamps were written in one pass ~1 ms apart, so a single timestamp claiming to be five download times would
    have been false on its face; the stamper passes the real fetch date rather than its own run time.
  - `downloadedHere: false` is paired with an `origin` saying what happened INSTEAD. The 2011 round-1 archive
    was never fetched by this tooling — those files came from the pre-existing local `_mi` tree — so it carries
    a null digest and that sentence, rather than borrowing its sibling's.
  - The stamp MERGES rather than replaces, because the ordinary run measures nothing; and `readStamp` REFUSES a
    present-but-unparseable file rather than reporting it absent, since reporting absent is the same erasure
    reached through a different door. Both halves are gated, and the committed stamps are asserted to be a
    fixed point of a skipped re-run so a no-op run cannot churn a tracked file.
- **T1.3 ✅ DONE.** `scripts/parsers_presidential/encoding.ts`: `decodeMik` (a 256-entry table, `0x80–0xBF` →
  `U+0410–U+044F`, verified across the whole committed 2001 corpus — 111,437 high bytes, none above `0xBF`),
  `decodeCp1251`, `stripBom`, a `decodeBundleText` dispatcher keyed on the era's declared encoding, and
  `parseSemicolonRows`. `extractZipCp866` stays for the 2011 zip's cp866 FILE NAMES — a different concern from
  the cp1251 CONTENTS. Four things the build settled that this plan had wrong or unsaid:

  - ⚠️ **MIK is not cp866, and cp866 is the trap rather than a fallback.** They agree on `0x80–0xAF` and diverge
    at exactly `0xB0` — `р` against `░` — so a cp866 read yields „Избо░и за п░езиден▓", 75% right and therefore
    survivable in review. `decodeMik` REFUSES a byte above `0xBF` by default: such a byte means the file is not
    MIK at all.
  - ⚠️ **The BOM hazard is string IDENTITY, not numeric parsing.** `Number("\uFEFF13")` is 13, not `NaN` —
    U+FEFF is JS whitespace. What breaks is equality, and a ticket number is a JOIN KEY: the candidates file's
    `"\uFEFF13"` never matches the votes file's `"13"`, so Радев's 2016 ticket drops out of the join with every
    row count reconciling. `TextDecoder("utf-8")` already strips it; neither non-UTF-8 path can see it as a
    character (cp1251 decodes it to „п»ї", MIK throws on `0xEF`), so those strip on the BYTES.
  - **Line endings are BOTH**, per §1.1 — published CRLF, committed LF — so the splitter accepts either.
  - **The naive `split(";")` is correct, and that is measured rather than assumed**: zero quote-wrapped fields
    and zero semicolons inside quotes across all five trees, with a uniform field count per row in every data
    file. Quote CHARACTERS do occur inside field text (`БДС "Радикали", БДФ`), so a CSV parser would in fact
    mis-read that row. Empty leading and trailing FIELDS are preserved — the 2011 sections rows begin with one,
    the 2006 protocol rows end with one, and a `.filter(Boolean)` would shift every column in both.

  ⚠️ Open, and deliberately a separate commit: `scripts/parsers_local/augment_sections_2011.ts`'s `readLines` is
  a third copy of decode+split over the SAME 2011 bundle, with the weaker `/\r?\n/` split. Re-pointing it at
  `decodeBundleText` + `parseSemicolonRows` retires it.


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

- **T2.1 ✅ DONE.** `era2021.ts` + the shared `types.ts`. Reproduces every §2.4 anchor exactly on both rounds
  (Радев 1,322,385 / 1,539,650; tickets 2,615,149; „никого" 60,786; 13,238 and 13,234 sections). Five things the
  build settled:

  - **The form classification is measured, not assumed**, and is confirmed three ways: the round's own readme,
    the data, and `scripts/parsers/protocols.ts`, which partitions the same nine forms identically for the
    parliamentary ballot held the SAME DAY. Electorate figures come from the one form per section that carries
    them ({24,25,26,28,29} = 13,238, exactly the section count); ticket votes are PAPER on 24/26/28 and MACHINE
    on 27/31/32/41. ⚠ 27/31 (control receipts) do NOT duplicate 32/41 — 101 sections carry one, 37 also carry
    machine data, and **0 (section, machine) pairs appear in both**.
  - ⚠️ **`numMachineBallots` is summed from the MACHINES, not read off the form's own 5.2.** The two disagree on
    97 sections and where they do the machines are right: `244606005` claims 712 machine ballots against 398
    signatures — impossible — while its two machines report 197 + 155, each reconciling with its own valid +
    „никого". This also matches what the parliamentary parser does.
  - ⚠️ **ЕКАТТЕ IS PUBLISHED WITHOUT LEADING ZEROS HERE** — 10 codes are 2 characters, 250 are 3, 1,230 are 4 —
    while `data/settlements.json` keys domestic settlements on 5. Reading it unpadded loses ~1,490 sections'
    place with every vote still adding up. `normaliseEkatte` pads. ⚠️ Padding is necessary and NOT sufficient:
    the catalogue is not uniformly 5-character (abroad is keyed ISO-2, Sofia's districts on a compound
    `68134-2302`), so ~1,601 domestic sections — all of Sofia among them — and all 750 abroad still need T3.1.
  - ⚠️ **`nominatorKind` REFUSES rather than defaulting to "party".** The plan assumed the register names the
    kind; it does so only sometimes. Of 44 distinct nominator labels across 2016 and 2021, **24 carry no
    coalition or committee marker at all**, and only 7 of those declare themselves with a `ПП` prefix. A
    "party" default therefore published Реформаторски блок (five parties), Обединени патриоти – НФСБ, АТАКА и
    ВМРО, Движение 21 – НДСВ and Патриотичен фронт as PARTIES — three of them while naming their own members in
    the label. Those four are explicit overrides; everything else unmarked is `"unknown"`, which on the 2021
    ballot is 10 of 23 tickets. A surface must render that as unknown rather than assert a legal form.
  - **The 2021 machine records need no separate ingest**: `suemgVotes` comes from block 256 of the joint
    `raw_data/2021_11_14/suemg/` tree via T0.3, which is why that parameter exists.

  ⚠️ The `„<president> и <vice>"` split is 2016/2021 ONLY. 2006 joins the pair with a COMMA and 2011 publishes
  the two names in separate columns, so `splitTicketNames` returning null is an error for those eras and the
  ordinary case for these.
- **T2.2 ✅ DONE.** `era2016.ts` reproduces every §2.4 anchor on both rounds (Радев 973,754 / 2,063,032;
  tickets 3,613,556; „никого" 214,094). Its shape is the OPPOSITE of 2021's — one protocol row and one votes
  row per section, with the machine half in extra COLUMNS — so the two readers exist because the formats
  disagree, not the elections. Four things the build settled:

  - ⚠️ **TWO FILES STATE THE PAPER/MACHINE SPLIT AND THEY DISAGREE.** The protocol's 7.1 box/machine pair says
    41,792 machine votes nationally; the votes file's Б/М columns say 41,585. They differ on **56 of the 500**
    machine sections, including exact swaps, and BOTH reconcile to ЦИК's published per-ticket totals — so
    nothing downstream would notice. Each is kept for the question it can answer (the protocol is the section's
    own summary; the votes file is the only PER-TICKET split), the divergence is gated, and a surface must name
    which basis a „% cast on machines" figure came from.
  - **The ticket total comes from the source's own `valid` column and the split is DERIVED**, because the
    decomposition does not always add up: `273100059` ticket 8 states valid = 0 with М = 1, and summing Б+М
    would publish a national total one vote above ЦИК's. The clamped vote is counted and warned about rather
    than dropped silently.
  - **Both halves of the found total must come from the SAME block.** 5.а (found in box) and 5.б (found on
    machine) are the pair; the signatures block's 3.а/3.б disagrees with them on 2 sections. One section then
    remains where found exceeds signatures by one — `223100016`, 397 + 90 = 487 against 486 — which is the СИК's
    own arithmetic and is pinned as the single exception.
  - **The machine branch is the section's own FLAG, not "are the machine fields non-zero".** Six form-8
    sections recorded zero machine votes; a truthiness test files them as paper and publishes `machines: 1`
    beside absent machine fields, destroying the absent-vs-zero distinction the shape rests on.

  ⚠️ `machines` is a FLAG here (1/0), not a count: this era publishes whether a section had machine voting, not
  how many machines it had. Machine voting was 1.2% of the vote in 2016 against 88% in 2021.
- **T2.3 ✅ DONE.** `era2011.ts` reproduces every §2.5 anchor on both rounds (round 1 Плевнелиев 1,349,380 /
  Калфин 974,300 / Кунева 470,808 / Сидеров 122,466 over 11,784 sections; round 2 1,698,136 / 1,531,193 over
  11,779), and `result.txt` independently confirms both outcomes. Field map as specified: registered = 3,
  additional = 4 + 5, signatures = 7, сгрешени = 10, ballots found = 20, invalid = 26, valid = 27. Six things
  the build settled:

  - ⚠️ **THE ABROAD PREFIX IS `29`, NOT `32`.** The election ran through the ОИК alongside that year's local
    vote, so the codes are on the 28-oblast grid: prefix 22 is София-град and 16 is the WHOLE of Пловдив, which
    the parliamentary grid splits into 16 and 17. Reading `32` — what every other era uses — finds nothing and
    publishes zero votes abroad at no error. The nine digits do NOT join another election's sections.
  - **„не подкрепям никого" is left ABSENT, not zero.** The option did not exist before 2016, so the valid
    total IS the ticket total here; a stored 0 would claim nobody chose it, and the winner rule reads exactly
    this field to build its denominator.
  - ⚠️ **THE PROTOCOLS DO NOT ALWAYS RECONCILE WITH THEMSELVES, so nothing downstream may derive one figure
    from the other two.** Measured over round 1: 19 of 11,784 sections have `found ≠ invalid + valid`, and 149
    have an invalid count that is not the sum of its own five components. (The readme's own formula, „сумата от
    числата по т. 19, т. 20, т. 21, т. 22 и т. 23", is a typo for fields 21–25 — which is what the rows that
    do reconcile follow.)
  - **The ticket-sum vs valid-column residue is ELEVEN named sections, net +6, in both directions** — held as
    an allowlist rather than a ceiling, so a NEW disagreement fails while a known one does not.
  - **`result.txt`'s `Б` is tested for explicitly, never inferred as „not `И`".** Falling through would turn a
    mojibake byte into the positive assertion that a named candidate reached a balotage — and this file is the
    INDEPENDENT cross-check on the computed winner rule, so an outcome invented here would agree with a broken
    rule instead of catching it.
  - **The readme declares a third section flag, `Е` (експериментална преброителна комисия), and the corpus
    holds none** — only blank (11,702 / 11,699) and `П` (82 / 80). The reader REFUSES a round carrying one
    rather than publishing it as an ordinary section, since `PresidentialSection` has nowhere to record it and
    a silent pass would put a second count of the same ballots into the national total.

  Two things landed beside it, both spanning the era readers rather than this one:

  - **`readerKit.ts`** — `num`, `readBundleFile` and `sectionLookup` in one copy, where the three readers each
    had their own (the `num` bodies were byte-identical). It also closes the gap `encoding.ts`'s banner
    described but no reader honoured: **the encoding is now READ from `sources.ts`** and threaded through,
    where all three previously passed a hardcoded literal, so the declaration and the behaviour were two
    independent spellings of one fact.
  - **The `raw_data` skips became ASSERTIONS.** Every presidential round is committed and CI does a full
    checkout, so `existsSync` → skip was hiding a broken working copy as one more green tick. `assertCommitted`
    states it instead. That also required fixing `report_skip_coverage.test.ts` to pass `git ls-files -z`:
    without it git octal-escapes any non-ASCII path, so every Cyrillic `ТУРn` tree read as untracked.
- **T2.4 ✅ DONE.** `era2006.ts` reproduces every §2.4 anchor on both rounds (round 1 Първанов 1,780,119 /
  Сидеров 597,175 / Беронов 271,078 / Марков 75,478 / Берон 21,812 / Велев 19,857 / Петров 13,854, valid
  2,779,381, signatures 2,809,725, registered + additional 6,430,117, over 11,809 sections; round 2 2,050,488 /
  649,387). Field map as specified. Five things the build settled:

  - ⚠️⚠️ **THE READ-ME IS THE BALLOT, AND IN THE RUNOFF ITS COLUMN ORDER IS NOT THE TICKET ORDER.** There is no
    candidates file: the only statement of which column holds which ticket is prose inside `Readme.txt`. Round 2
    keeps the survivors' round-1 numbers — column 17 is ticket **3**, column 18 is ticket **6** — so „first vote
    column = ticket 1" publishes Първанов's 2,050,488 against a candidate who was not in the runoff, with the
    national total still exact.
  - ⚠️ **A READ-ME LINE THAT FAILS TO PARSE IS A WHOLE TICKET'S VOTES, so „did any line parse" is not a
    completeness test.** Any proper subset of the ballot parsed happily. The reader now checks the ballot
    columns are a CONTIGUOUS run from `F.valid + 1` — the protocol's own fields end there, so where the votes
    start is known independently of the prose — and refuses a protocol row carrying a value past the last named
    column. Measured over both rounds: every row is exactly 24 cells in R1 and 19 in R2, and not one carries a
    non-blank cell past its last ballot column.
  - ⚠️ **ABROAD SIGNATURE COUNTS ARE NOT COUNTS.** All 144 prefix-32 sections publish точка 3 = 0 while holding
    46,113 valid votes in round 1, and not one of the 11,665 domestic sections does. The cell is a literal „0",
    never empty, so this is an INFERENCE from the pattern rather than something the file states — and read as a
    count it is 0% turnout abroad against real ballots, hidden inside a national sum that still reconciles.
    `PresidentialSection.signaturesUnreported` carries it, because the shared `SectionProtocol` makes
    `totalActualVoters` required. **T3.2 must read that flag** and fall back to точка 6, and say that it did.
  - **The bundle names NO nominator for any ticket, in either round** — the only era where that is true — so
    `nominatedBy` is empty with kind `unknown`. The two names are separated by a COMMA, not „и", so
    `splitTicketNames` is not used; „Ангелова-Банкова" and „Цонева-Иванова" are why.
  - **The per-section residue is ONE section in round 1** (`234615094`, −8) and none in round 2, held as a named
    allowlist rather than a ceiling.

  ⚠️ Two things a duplicate row does here that the reader's OUTPUT cannot show: a repeated protocols row DOUBLES
  the section (votes are columns and `addTicketVotes` sums), and a repeated sections row moves its ЕКАТТЕ — the
  aggregator's join key. Both are now refused, and the gate asserts over the RAW rows, since a Map keyed by code
  and a fold by ticket number make the obvious assertions true by construction.

  ⚠️ **Correction to §2.5-3 above**: its „69,679 valid votes (both rounds)" is round 2 alone. Round 1 is 46,113.
  The claim that all 144 abroad sections carry т.3 = 0 in both rounds is correct.
- **T2.5 ✅ DONE.** `era2001.ts` reads the MIK bundle — `COMMON.<ext>` plus 33 files per round — and reproduces
  every figure the bundle publishes: round 1 Първанов 1,032,665 / Стоянов 991,680 / Бонев 546,801 / Инджова
  139,680 / Ганчев 95,481 / Берон 31,394, registered 6,824,979, signatures 2,850,650, valid 2,837,708 over
  12,191 sections; round 2 Първанов 2,043,443 / Стоянов 1,731,676 over 12,192. Six things the build settled:

  - ⚠️⚠️ **THE VOTE VECTOR IS POSITIONAL AND THE TICKET NUMBERS DO NOT HELP.** `[PROT]`'s second `+`-joined
    group is one figure per `[PARTII]` ROW, in that order, while the tickets keep their ROUND-1 numbers into the
    runoff — round 2's two figures belong to tickets **02 and 05**. Reading the vector as „ticket 1, ticket 2"
    hands 2,043,443 votes to a candidate who was not on the ballot, with the national total still exact. This is
    T2.4's trap from the other side: there the mapping was column numbers in prose, here it is a row ORDER with
    misleading numbers printed beside it.
  - ⚠️ **`[MAJ]`/`[AGGR]` ARE ENFORCED, AND THE NATIONAL ONE NEEDS A SECOND PASS.** They reconcile with the
    sections EXACTLY — 32 oblasts, both rounds, zero mismatches — so a dropped or duplicated section cannot pass.
    But `000000z0` sorts FIRST by filename, so reconciling it inside one pass compared it against an empty
    corpus and asserted nothing: measured, corrupting its registered/signatures/valid figures read perfectly
    clean. Aggregate-only files are deferred to the end. The check also **fails closed** on a missing block —
    returning quietly removed the cross-check exactly when the file was damaged, and stripping oblast 01's two
    blocks beside a duplicated `[PROT]` row published Първанов at 1,032,789.
  - ⚠️ **т. 8 IS VALID, NOT INVALID.** `[TOCHKI]` — the bundle's own field list, in the data rather than in a
    readme — states „т. 7 = т. 5 + т. 6", so envelopes holding several ballots for the SAME list count as one
    valid vote. Folding т. 8 into invalid moves **73,546 votes** nationally. The `[AGGR]` invalid check is what
    defends that reading; without it the decision rests on one hand-picked section.
  - ⚠️ **THE ROUND'S EXTENSION IS MAPPED, NOT DERIVED FROM THE FOLDER.** `.201` is round 1 and `.301` round 2,
    and the reader takes `dir` and `round` separately — so deriving the extension made every folder
    self-consistent: `readEra2001Round("…/ТУР2", source, 1)` published all 12,192 RUNOFF sections stamped round
    1 and dated 2001-11-11, every internal gate green. Naming it turns that into a refusal.
  - **The ballot was in an ENVELOPE**, so the protocol counts envelopes where later eras count ballots, and
    `[PARTII]`'s initials column (`ПКБ+СВА`) is an INDEPENDENT check on splitting the pair on „и" — an ordinary
    Bulgarian word, so a name containing it would cut in the wrong place and yield two plausible people.
  - **62 sections serve MORE THAN ONE settlement**, so their ЕКАТТЕ is ambiguous and is left ABSENT rather than
    resolved to whichever came first. Of the 261 round-1 sections with no ЕКАТТЕ: 134 abroad (the source
    publishes none), 62 multi-settlement, 65 domestic settlements whose own `[NM]` row leaves the code blank.

  ⚠️ `isMobile` / `isShip` are `false` because this bundle publishes NO such flag — not because it publishes one
  saying no. „No mobile sections in 2001" is a claim this corpus cannot support. Residue: 7 named sections in
  round 1 (net −7), none in round 2.
- **T2.6 ✅ DONE.** Three new modules and two cross-era gates, on top of the five per-era suites:
  `readers.ts` (the era dispatcher), `winnerRule.ts` (art. 93 (3)), `testCorpus.ts` (a per-round memo the two
  gates share), `winnerRule.test.ts` and `anchors.test.ts`. 534 tests green across `scripts/parsers_presidential/`
  and `scripts/lib/`. Five things the build settled:

  - ⚠️⚠️ **THE MUTATION CASE HOLDS, AND IT IS THE POINT.** `validVotes = ticketVotes + „никого"` reproduces the
    published 2,675,935 (2021) and 3,827,650 (2016) EXACTLY, and with it Радев's 2021 round 1 is **49.42%** — a
    runoff. Over the ticket sum it is **50.57%**, which elects him outright. The gate computes the wrong answer
    explicitly and requires the two to disagree, so a rule passing under both implementations cannot pass.
  - ⚠️⚠️ **AND SO DOES THE THRESHOLD ITSELF — this was nearly missed.** The first strict-half „control" evaluated
    `50 * 2 > 100` in its own test body: it never called `tallyRound`, and MEASURED, flipping both `>` to `>=` in
    the rule passed all 284 tests in the directory. No real round sits at exactly half on either condition, so
    the comparison deciding whether a president was elected a week early had no coverage at all. It now tallies a
    contrived one-section round at exactly half and at one vote past it; `>=` fails.
  - ⚠️ **BOTH CONDITIONS, AND THE CORPUS SEPARATES THEM.** 2006 has a 64.05% majority and 43.88% turnout; 2011 has
    40.11% and 52.28%. So a rule checking only the majority elects a president in 2006, and an `||` elects one in
    both. All five cycles went to a runoff, and `decidedInRound` agrees with 2011's `result.txt` and 2016's
    `elected` flag. ⚠️ **2001 publishes a THIRD witness nothing reads yet** — its `[MAJ]` rows carry an outcome
    marker (`2` for each runoff-bound ticket, `1` for the winner, `0` otherwise), which T3 should wire in. 2006
    and 2021 publish none, so the rule stands unwitnessed there and no surface may imply otherwise.
  - ⚠️ **`protocol.numValidVotes` CANNOT BE SUMMED NATIONALLY WITHOUT ITS MACHINE HALF.** 2016 splits paper and
    machine across two fields and 2021 sets the paper one only on paper forms, so a bare sum gives 3,567,851 and
    311,671 against ticket totals of 3,613,556 and 2,615,149. `protocolValidVotes` adds both fields and is
    exposed as a SECOND basis — never the denominator — beside `validVotesResidue`: −7 (2001), −8 (2006), **+6**
    (2011), +3,913 (2016), −1,929 (2021). The sign is not constant.
  - **Turnout is signatures over registered voters, and `turnoutBasis` carries the wording** — because telling a
    caller to „name the basis" without giving it one is how two pages describe the same number differently. ⚠️ In
    2006 it is a DOMESTIC figure: all 144 abroad sections report neither registered voters nor signatures while
    casting 46,113 valid votes, so they sit in neither half of the ratio. Round-1 turnout: 41.77% · 43.88% ·
    52.28% · 57.65% · 40.30%.

  ⚠️ **A cross-cycle person link CANNOT go through `canonicalKey`, and 2006 is why.** It is the only era
  publishing TWO-part names — „Георги Първанов" where every other era gives „Георги Седефчов Първанов" — so Волен
  Сидеров, who stood in 2006 and 2011, folds to two identities. Радев links 2016↔2021 and is asserted; the 2006
  gap is pinned as a measurement, not asserted away. T4 needs another route.

  ⚠️ **Naming**: this plan called the totals gate `presidential_totals.data.test.ts`. It shipped as
  `anchors.test.ts` — `*.data.test.ts` is this repo's marker for a gate that needs Postgres and auto-skips
  without it, and these read only committed files.

## 7. Tier 3 — aggregation and the output tree (2–3 days)

- **T3.1** `aggregateRound()` — ЕКАТТЕ → `data/settlements.json` → municipality → oblast, reusing `addResults`
  and `regionCodes`; for the МИР-grid eras also the 9-digit-code join to the parliamentary section shards for
  GPS/address (the `backfillLocalSectionCoords` transfer, read-only). Writes the §3-3 tree; sections sharded by
  oblast prefix. **Abroad resolution is per era**: 2016/2021 through `lookup_international_sections` as is
  (region label + „Country, City"); 2006/2011 through a committed `abroad_cities.json` city→country table fed
  into the helper's city fallback, after a fold that maps Latin homoglyphs onto Cyrillic (§2.5-12). An
  unresolved abroad section is written with `country: null` AND listed in the run summary — never dropped and
  never guessed. `coveredCycles()` in `scripts/elections/build_surfaces.ts` gains a `presidential` arm
  (`/^\d{4}_\d{2}_\d{2}_pvr$/`, latest cycle) once the tree exists.
- **T3.1a ✅ DONE — abroad resolution.** `abroad.ts` + `build_abroad_cities.ts` +
  `data/presidential/abroad_cities.json` (1,248 cities). The plan said „a committed `abroad_cities.json`
  city→country table"; what shipped DERIVES it from the thirteen committed parliamentary `sections.txt`, which
  name a country beside each abroad city. That is the point: a hand-written table is unfalsifiable, and a wrong
  entry files a real polling station in the wrong country while looking exactly like a right one. Coverage on the
  three city-only eras is **792 of 876 sections (90.4%)** and 245 of 286 city spellings; the rest are `null`.
  Four things the build settled, three of them found only by reading MORE evidence:

  - ⚠️⚠️ **FIVE `sections.txt` LAYOUTS ARE COMMITTED, AND THE FIRST CUT UNDERSTOOD ONE.** 2013 splits country and
    city into separate cells, 2005 publishes a bare city with no country, and the pre-2017 files put the fields
    in different columns — so four cycles matched nothing, were counted as read, and their evidence was thrown
    away. The cost was not merely narrower coverage: **Бостън resolved confidently to GB, Оукланд to NZ and
    Триполи to LY**, each a real city in two countries with Bulgarian sections in both. Partial evidence does not
    look partial. The harvest now gates on the SECTION CODE — nine digits, oblast `32` — which is the one thing
    every layout agrees on, and NAMES any cycle that yielded no country evidence (2005, legitimately).
  - ⚠️ **A NON-BREAKING SPACE COST A COUNTRY.** The corpus spells Bosnia „Босна\u00a0и Херцеговина" and the
    catalogue uses an ordinary space; the two render identically, compare unequal, and BA resolved to nothing.
    Found only because a test printed two „identical" values that were not equal. `countryKey` collapses all
    whitespace.
  - ⚠️ **FOUR CITIES ARE REFUSED, NOT DECIDED** — Пърт, Бостън, Оукланд, Триполи. `AMBIGUOUS_CITIES` is checked
    against the corpus in BOTH directions, so a stale „this is ambiguous" fails the build too.
  - ⚠️ **THE TABLE ANSWERS FOR BULGARIAN VILLAGE NAMES.** Nine keys — Димитровград, Охрид, Сараево, Подгорица,
    Прилеп, Тетово, Есен, Мугла, Кортен — are also domestic settlements, each a real foreign city. **The
    caller's abroad flag is the gate, never this lookup**; T3.1b must pass it only sections already marked
    abroad. `--write` also refuses a narrowing rebuild, because the regeneration gate cannot catch one (file and
    fresh build narrow together).

- **T3.1b ✅ DONE — placement.** `places.ts` turns a section into a settlement, municipality and oblast. Every
  round places with nothing dropped. Four things the build settled:

  - ⚠️⚠️ **THE PREFIX FALLBACK ALMOST REPRODUCED THE VERY DEFECT THE MODULE OPENS BY WARNING ABOUT.** No
    prefix→oblast table is hard-coded (2011's `22` is София-град, 2021's is Смолян), and the map is derived per
    round — but the first cut then took the PLURALITY of each prefix's witnesses. 2011's `22` splits 54/35/12
    across S23/S24/S25, so **1,354 sections and 441,328 votes, 13.1% of round 1**, were filed in S25, two thirds
    of them in the wrong МИР, with every count reconciling. A prefix now places nothing unless its witnesses
    agree past `PREFIX_PURITY_FLOOR` (0.95, measured: no prefix sits between 0.975 and 1.0), and the refused
    sections are REPORTED with a reason. Their votes stay in every national figure; what they lack is an oblast
    attribution the evidence cannot support.
  - ⚠️ **`data/settlements.json` IS NOT A COMPLETE ЕКАТТЕ CATALOGUE** — 5,364 rows, carrying neither София
    (68134) nor absorbed quarters like Банево (02573) — so 12.1–13.2% of domestic sections fall back to the
    prefix and get an oblast and nothing finer. `PlaceBasis` carries which, because „this section is in Пловдив"
    and „this section is in a prefix whose other sections are in Пловдив" are different claims and only the
    first supports a settlement figure.
  - ⚠️ **AN ЕКАТТЕ CAN CONTRADICT ITS OWN SECTION CODE, AND THE CODE WINS.** 7 sections in 2001 and 5 in 2006:
    `с.Зверино` is in Мездра, Враца, and its recorded ЕКАТТЕ resolves to Чирпан, Стара Загора. The discriminator
    is the OBLAST, never the name — hundreds of sections spell their settlement differently from the catalogue
    (Мусомища/Мосомище) with a perfectly good code, and a name check would refuse them all.
  - **Abroad is decided structurally, per era.** The 2006 and 2011 readers mark it; 2016 and 2021 do not, so the
    code prefix does (`ABROAD_PREFIX_BY_ERA` — `29` in 2011, `32` elsewhere; on the МИР grid `29` is Хасково).
    2016/2021 then take the country from the name their sections carry, and only the three city-only eras reach
    the derived table. ⚠️ That gate is load-bearing: the table answers `RS` for `гр.Димитровград`, of which 2021
    has 58 DOMESTIC sections.

- **T3.1c ✅ DONE — aggregation and the tree.** `aggregate.ts` rolls a round up and writes
  `data/<cycle>/tur<n>/` — `region_votes.json`, `municipality_votes.json`, `settlement_votes.json`,
  `abroad.json`, `placement.json` and `sections/<oblast>.json`. Byte-stable across runs (T3.5's first half).
  Four things the build settled:

  - ⚠️⚠️ **THE THREE LEVELS DO NOT COVER THE SAME VOTES, so every file carries a `coverage` block.** The oblast
    roll-up plus abroad reconciles to the round exactly in four cycles; the municipality and settlement roll-ups
    are 400k–690k votes narrower, because they need an ЕКАТТЕ the catalogue has no row for on an eighth of
    sections. Summing a settlement file as a national total under-states by that much, so no bare array is
    written and each block names its own basis, section count and vote total.
  - ⚠️⚠️ **„NOTHING IS DROPPED" IS A CLAIM ABOUT THE WRITTEN TREE, AND IT WAS FALSE.** `placement.json` carried a
    code and a reason per refused section and no votes, so 2011's **441,328 refused votes — 13.1% of round 1**
    appeared in no file at all: every roll-up excludes them by design and nothing else named them. They now have
    their own shard (`sections/_unplaced.json`, full protocols and votes) and a per-row total, and the gate
    asserts the VOTES rather than a row count.
  - ⚠️ **A SHARD MUST NOT REPUBLISH AN ЕКАТТЕ PLACEMENT OVERRULED.** Writing each section verbatim put
    `с.Зверино`'s code — which resolves to Чирпан, Стара Загора — into `sections/VRC.json`, where a consumer had
    no way to know it had been rejected. Shards now carry the PLACEMENT (`oblast`, `obshtina`, `placeBasis`) and
    the overruled code is stripped.
  - **The indent is a parameter and the shard directory is cleared before a write.** Measured, two-space
    indentation costs **+102.4 MB** across the ten rounds in a tree that is both committed and bucket-synced, so
    a hard-coded literal would put it outside the pipeline's `--prod` flag; and a shard left behind by a
    previous vintage is a whole oblast every consumer reads as current.

  ⚠️ Open, and deliberately so: the roll-ups carry VOTES only, no protocol — so turnout, invalid and „никого"
  live in `national_summary.json` (T3.2), which is where T3.5's reconciliation will read them. Still open in
  T3.1: the `coveredCycles()` arm in `scripts/elections/build_surfaces.ts`.
- **T3.2** `national_summary.json` per cycle: per-round turnout (registered, signatures — ballots found for 2006
  abroad), valid, invalid, „не подкрепям никого" where the form has it (2016+), the ticket ranking with shares
  over VALID votes (decision 5), the runoff pair, `decidedInRound`, abroad totals, and the R1→R2 swing (Δ votes
  per surviving ticket, Δ turnout). **Every turnout figure names its basis** — `registeredBasis:
  "protocol-all-forms"`, `castBasis: "signatures"` — and the summary carries the CIK activity page's own
  registered figure as a separate, labelled `cikActivity` field where the page is archived (2021: 6,635,305 /
  2,687,307), so the two bases sit side by side instead of one masquerading as the other (§2.5-11).
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
- **T4.7 The hub's figures band has a rule to decide, not just a kind to add.** `electionsHubFigures.ts` states
  that cells 3 and 4 ALWAYS describe a parliamentary cycle because only that catalogue carries a protocol, and
  falls back with a basis that says so when a local cycle is selected. A presidential cycle DOES carry a
  protocol. Decision: a selected presidential cycle fills cells 3–4 from its OWN round-1 protocol (turnout on the
  §2.5-11 basis, valid votes incl. „никого"), and the basis names the round; the fallback stays for local. The
  turnout rule is imported from `ballotTotals.ts`, per that file's own warning — a presidential-only copy is how
  the abroad 329.6% guard gets lost again.
- **T4.8** `electionsSearch.ts`: presidential cycles, tickets and the candidate names are searchable from the hub
  search box, landing on `/presidential/:cycle`; the exhaustiveness gate on `ElectionKind` catches the switch.
- **T4.9** `scripts/data_map/model.ts` gains the source (the `/data` map lists every dataset), and the ingest
  stamps `state/ingest/cik_presidential.json` via `scripts/stamp-ingest.ts` the way every skill does.

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
family member.

What the shared system needs from this kind, named so it cannot be discovered halfway through:

- **Map adapters.** `src/screens/elections/adapters/` holds four PARLIAMENTARY adapters (country, region,
  municipality, settlement) and nothing for local, which renders through the legacy composition. Presidential
  ships `PresidentialCountryMap` / `RegionMap` / `MunicipalityMap` / `SettlementMap`, each colouring by leading
  TICKET with the ticket palette and taking the round as a prop; `electionMapSlots.ts` learns the kind.
- **Eleven modules switch on `ElectionKind` today** (`electionMapSlots`, `electionSurfaceDescriptors`,
  `electionsHubFigures`, `electionSurfaceAnalytics`, `electionsSearch`, `ElectionsHubScreen`,
  `ElectionResultsShell`, `useElectionSurface`, `surfacePath`, `destinations`, `surfaceTypes`). The `never`
  check and the existing kind-enumerating tests are what make the third member reach all of them; none is
  extended by hand without the compiler saying so.
- **`SURFACE_POLICY["presidential"]` is MEASURED before it is declared.** Every level row carries
  `measuredMaxBytes` / `measuredCycle` / `measuredOn` from `npm run elections:budget` over the generated tree —
  the country level is one `national_summary.json` (canonical, expected inside the 24 KiB budget), region and
  municipality are decided by the measurement, settlement and section follow the parliamentary answer. A row
  written without a measurement is the §5.0 defect the policy file exists to prevent.
- **Screens are lazy routes** (`routes.tsx` has 288 `lazy(` entries and no eager screen), and NOTHING routing
  imports from `electionsRegistry.ts` or a scene barrel — `src/entryGraph.test.ts` fails the build otherwise, and
  it did once for ~265 KB. The **outcome panel is ticket-shaped**: president + vice-president names, nominating body, votes,
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
- **T7.1b A joint bundle is handled, not assumed away.** If a snap parliamentary election coincides (2021's
  shape), the round-1 zip carries `np/`, `pvr/` and ONE `suemg/` tree. The downloader routes `np/` to
  `raw_data/<date>/` under the parliamentary flat names for the parliamentary ingest, `pvr/` to
  `raw_data/<date>_pvr/ТУР1/`, and the machine tree ONCE into the parliamentary folder — the presidential reader
  reads block 256 out of it (§1.1). A standalone `pvr2026` bundle is the same map with no `np/` arm.
- **T7.2 Skill** `update-presidential-elections`: triggers, the download → parse → aggregate → surfaces →
  `bucket:sync:paths -- <cycle>_pvr` → `data-changes` chain (no PG, so no `person:slugs`), the runoff re-check,
  and the troubleshooting table (the §2.5 traps in operator form). Registered in `process-watch-report`'s map and
  stamped in `state/ingest/cik_presidential.json`. **The orchestrator already couples every `cik_results` flip to
  `update-persons` and `db:load:person-elections:pg`** (its map says a `cik_results` flip is what refreshes the
  candidate data), and that loader reads the PARLIAMENTARY candidate files. A presidential flip therefore
  either feeds it a ticket arm (Tier 8.1) or is registered as a SEPARATE watcher source (`cik_presidential`)
  that the map routes to this skill only — v1 does the second, explicitly, so the chain neither stalls on a
  tree it cannot read nor silently skips the new cycle.
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
| majority denominator | `winnerRule.test.ts` (mutation case) | 2021 R1 is a runoff under the valid-vote denominator and a round-1 win under the ticket-sum one — the test fails if both implementations agree |
| per-section residue | `presidential_totals.data.test.ts` | residue per cycle/round under its ceiling; every disagreeing section in the allowlist; a new one fails |
| abroad resolution | same file | every abroad section resolves to a country or is listed; the 2006 „Mелбърн" homoglyph row resolves |
| turnout basis | `national_summary` shape test | `registeredBasis` / `castBasis` present on every round; the CIK activity figure, where carried, is a separate labelled field |
| folder sweeps | `electionFolders.test.ts` + the eight call sites | every sweep routes through `electionFolderKind()`; `_pvr` never reaches a parliamentary reader |
| perf | `src/entryGraph.test.ts`, `tests/perf.spec.ts`, `tests/ui.spec.ts` | no registry on the entry path; byte budgets hold; the presidential hub head passes the height budget with its `data-kpi-cell` count |
| surface policy | `surfacePath` tests | every `presidential` level row carries a measurement; unmeasured rows are rejected |

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
