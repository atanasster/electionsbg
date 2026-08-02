# Village mayors (кметове на кметства) — attribution, place and declarations — v1

Triggered by `/person/rosen-rusev-a0a8lm` (Росен Господинов Русев, кмет на кметство с. Безмер,
общ. Тунджа): the profile labels his seat **"Тунджа"**, shows **no declaration**, and is missing
his **2019 term** — which our data currently awards to a different man.

Follow-on to `local-person-links-v2.md`. That plan's Tier A1/A2 are now green locally (verified
below); **A3 is still open and interacts with Tier 1 here**. This plan closes v2's open question
**B3** with evidence, and adds three defects v2 did not identify.

Everything below was measured against local docker Postgres and the committed
`raw_data/` HTML/CSV caches on **2026-08-01**. Cloud SQL was NOT inspected.

---

## 0. Findings, mapped to tiers

| # | Finding | Severity | Tier |
|---|---|---|---|
| F1 | Kметство **runoff winners are never ingested** → the round-1 vote leader is published as the seat holder at `confidence='high'`. **267 measured wrong village mayors** (2023: 137, 2019: 130). | Wrong named person on a public page | **T1** |
| F2 | Correcting F1 makes flipped seats' mentions change person — and `chooseStableSlug` would hand the **new winner the loser's `/person` URL**. Verified on the Безмер locks. | Would create a worse defect than it fixes | **T1 guard** |
| F3 | All **10,721** `village_mayor` roles carry `place_kind='obshtina'`, so every village mayor's seat renders as their община. `place_dim` already has the settlements (97.0% resolvable). | Wrong granularity, sitewide | **T2** |
| F4 | 2007 stores every runoff кметство **twice** (2,395 duplicate-name entries; 1,243 round-2-only), so the resolver mints a role for **both** the round-1 leader and the round-2 winner. | Phantom officeholders | **T3** |
| F5 | Кметове на кметства **do not file** in the central register at all — confirmed, not an ingest gap. Closes v2 §B3. | Needs an honest UI, not a scraper | **T4** |
| F6 | The SPA has the same round-1 fallback (`LocalElectionScreen.tsx:525`), so `/local/**` displays the wrong кмет for the same seats. Fixed by T1's re-parse, no code change. | Same defect, second surface | rides T1 |

Not defects, recorded so they are not re-investigated: Русев has **no** TR company, **no** NGO board
seat, **no** procurement/ИСУН/ДФЗ link, **no** parliamentary candidacy, **no** ЕРИК donor row, and a
clean single-alias identity. His page is thin because his record genuinely is.

---

## T1 — Ingest the кметство runoff (the wrong-person defect)

### Evidence

`pickLocalWinner` ([localPersonRefs.ts:25](../../scripts/parsers_local/localPersonRefs.ts:25)) uses
`round2` when present, else the round-1 pool. ЦИК marks **both** runoff finalists `isElected` in
round 1, so with no `round2` it silently returns the round-1 vote leader.

Measured across all cycles: **`round2` is populated on 2 of 10,721** kmetstvo entries (both in
`2026_06_14_chmi`). It works everywhere else — 113 обшtina mayors and 31 районни in 2023 alone — so
only the кметство arm is dark.

**The code to fix it already exists and works.** `mergeKmetstvoRounds`
([build_municipality_json.ts:100](../../scripts/parsers_local/build_municipality_json.ts:100),
commit `4713907651`, 2026-06-30) is wired, and `parse_local_elections.ts:301` passes `tur2`. Run
against the **cached** HTML it produces the right answer:

```
raw_data/2023_10_29_mi/html/tur2/2825.html (Тунджа) → 7 kmetstva runoffs parsed
  Ботево: round2 [Танев 239, Йовчева 242] → elected = Татяна Димитрова Йовчева
stored data/2023_10_29_mi/municipalities/JAM25.json → kmetstva keys: [kmetstvoName, ekatte, candidates]
  (no `round2`, no `elected` — the bundles predate the fix)
person_role 2023_10_29_mi:JAM25:kmetstvo:1 → Георги Иванов Танев   ← the loser
```

Cross-checked against a **second, independent source** for Безмер 2019 — the ЦИК round-2 CSV
`raw_data/2019_10_27_mi/ТУР2/КК/votes_03.11.2019.txt`, unit `3229`, sections `282500002/3`:
ИК Русев **291**, ВМРО Стоянов **263**. The tur2 HTML agrees exactly. We publish Стоянов.

### Scale (measured by re-parsing every OIK offline)

| cycle | kmetstvo seats | runoff seats merged | **winner flips** | OIKs missing a tur2 page |
|---|---:|---:|---:|---:|
| 2023_10_29_mi | 3,032 | 451 | **137** (30.4%) | 0 |
| 2019_10_27_mi | 1,966 | 441 | **130** (29.5%) | 0 |

2007 is excluded here — different failure, see T3. Of the 2,165 ambiguous seats corpus-wide
(≥2 round-1 `isElected`, no `round2`), 1,248 are 2007, 451 are 2023, 441 are 2019 and **25** are
chmi partials.

### Ref stability — verified, no churn

`kmetstvoRef` keys on the array index. Re-parsing produces the **identical index order**
(JAM25: Безмер 0, Ботево 1, Ген. Тошево 6, Дражево 9, Завой 10, Калчево 12, Маломир 18, Ханово 36 —
stored and fresh agree). So refs are stable; only the *winner behind a ref* changes.

Do **not** switch the ref to `ekatte` (which `kmetstvoRef` supports) as part of this. The
index key was chosen deliberately — `local_person_roles.data.test.ts` records that a name-keyed ref
"collided two different winners onto one mention id" — and changing it would churn all 10,721 refs.

### F2 — the slug-lock trap (must land in the same change)

`chooseStableSlug` ([slugLock.ts](../../scripts/person/slugLock.ts)) reuses the persisted slug of a
person's **oldest** member mention; ties break **alphabetically by slug**. The two Безмер locks:

```
local:2019_10_27_mi:JAM25:kmetstvo:16 → ivan-stoyanov-1xhzvh   first_seen 2026-08-01 02:35:04.280028
local:2023_10_29_mi:JAM25:kmetstvo:0  → rosen-rusev-a0a8lm     first_seen 2026-08-01 02:35:04.280028
```

Identical `first_seen` (all 10,767 village/район locks share one seeding timestamp), and
`ivan-stoyanov-1xhzvh < rosen-rusev-a0a8lm`. So after the corrected 2019 mention joins Русев's
cluster he would be served at **`/person/ivan-stoyanov-1xhzvh`**, with `rosen-rusev-a0a8lm` retired
and 301'd into it. Every one of the 267 flips has this shape.

**Mitigation — targeted lock purge, before the resolve:**

1. Compute the flip set (ref → old winner, new winner) during the re-parse and write it to
   `raw_data/person/kmetstvo_flips_2026_08.json` (auditable, committed).
2. `DELETE FROM person_slug_lock WHERE mention_id = ANY($flipped_mention_ids)` — only those refs.
   The new winner then takes their natural name-hash slug; the loser's slug orphans and the
   existing `person_slug_retired` machinery 301s it, which is correct (he is no longer that seat).
3. Re-run `db:resolve:persons`, then `collapseSlugRedirectChains` runs itself (documented in
   CLAUDE.md), so no chain repair is needed.

Do this as a one-off script under `scripts/person/`, gated behind a flag per
[[feedback_one_off_backfills]] (`--from-flips <file>`), not folded into the resolver.

### T1 interaction with v2 §A3 (open)

**751 (name, obshtina, role) groups still span multiple person records**, of which 294 are
`village_mayor`. For village mayors specifically, cross-cycle same-name-same-obshtina groups merge
**1,653 of 1,840 (90%)**. So Русев's restored 2019 role will *probably* fold into person 47037 —
but 1 in 10 will instead mint a second person for the same man. Verify his case explicitly
(query below); do not assume. A3's continuity rule remains the real fix and stays in v2.

### T1 steps

1. `npm run data -- --local --local-date 2023_10_29_mi` (offline; re-reads `raw_data/*/html/`).
   Then `2019_10_27_mi`. Then the chmi cycles that have a tur2 page.
2. **Review the diff before accepting it.** The re-parse rewrites bundles + `index.json` +
   `_unmatched_coalitions.json` + region rollups + demographics + chmi history + `officials_diff`
   (latest cycle only). Assert the delta is confined to `kmetstva[].round2 / .elected` and their
   downstream rollups; anything else means the parser has drifted since the data was built.
3. Emit the flip file + purge the flipped locks (F2).
4. `npm run db:resolve:persons` → `npm run data:local-person-refresh` (re-stamps `personSlug`,
   which the re-parse wipes) → `db:load:person-elections:pg` → `db:load:persons-browse:pg` →
   `db:load:person-search:pg`.
5. Gates (new, in `scripts/db/tests/local_person_roles.data.test.ts`):
   - every kmetstvo entry with ≥2 round-1 `isElected` and a tur2 page **has** `round2`;
   - no `village_mayor` role whose ref's bundle entry carries a `round2` disagreeing with it;
   - `person_slug_lock` has no mention_id in the flip file still pointing at the old slug.

---

## T2 — Give the village mayor their village

### Evidence

[resolve_persons.ts:940](../../scripts/person/resolve_persons.ts:940) stamps
`obshtinaPlaceFor(d.obshtinaCode)` on mayor, councillor **and** village-mayor mentions alike, so the
кметство is dropped at the source. `082_person_api.sql:60` then joins `place_dim` and prints the
община.

`place_dim` (117) already carries `kind='settlement'` — 5,366 rows with `name_bg`, `settlement_type`
(`с.`/`гр.`), `obshtina_code`, `oblast_code`, `loc`. Resolving `(obshtinaCode, lower(kmetstvoName))`
against it covers **10,397 / 10,721 = 97.0%** (2023 2,989/3,032; 2019 1,922/1,966; 2007 5,165/5,367).
That beats the SPA's own `data/local_mayors/kmetstvo_to_ekatte.json` (95.6%, and built only from the
2023 cycle) — so **resolve against `place_dim`, not that file**. Only 7 (obshtina, name) pairs are
ambiguous within an obshtina; skip those to the obshtina fallback rather than guessing.

Unresolved names (multiword: "Хаджи Димитрово", "Гара Елин Пелин") keep today's obshtina place — a
strict widening, nothing regresses.

### Changes

1. **115** — widen the CHECK: `place_kind IN ('mir','obshtina','judicial','settlement')`.
   115 is in `resolve_persons`' `SCHEMA_FILES`, so it ships with the resolve. Its guarded
   `DROP COLUMN place` block is already a no-op on a migrated DB.
2. **resolver** — a `settlementPlaceFor(obshtinaCode, kmetstvoName)` sibling of `obshtinaPlaceFor`,
   backed by a `place_dim` lookup map loaded once, falling back to `obshtinaPlaceFor`. Village
   mayors only; `rayon_mayor` keeps its obshtina (районите are not settlements).
3. **082** — for `kind='settlement'` render `settlement_type || ' ' || name_bg` ("с. Безмер").
   Do **not** change `place_dim.name_bg` — `/procurement/by-settlement` and 123 read it.
4. **120** — copy the same label expression **verbatim** (the file says so, and the browser and the
   profile must not print different names for one seat), and add the missing arm:
   ```sql
   WHEN pl.place_kind = 'settlement' THEN pd.obshtina_code
   ```
   Without it, `?obshtina` (`PersonsBrowserScreen.tsx:143` → `obshtina_code`) silently stops
   matching 10.7k people. `oblast_code`/`oblast_codes` already read `place_dim.oblast_code` and are
   safe. **NB: 120 has staged uncommitted changes (tier1 S3a name-fold arm) — rebase onto those.**
5. `person_search.place_label` reads `person_browse_table.place_label`, so it follows for free —
   but `db:load:person-search:pg` must re-run.

### Knock-ons to accept deliberately

- `PersonProfileScreen` dedupes offices on `(role, placeCode)`. Today a man who was village mayor of
  two different villages in one obshtina shows **one** row; after T2 he shows two. That is the
  correct reading, and same-village-across-cycles still collapses to one.
- Consequence for Русев: his restored 2019 term and his 2023 term collapse into a single
  "Кмет на кметство · с. Безмер" row, because local roles carry no dates. The two-term story needs
  v2 §B2 (`person_local_elections`); note it there rather than special-casing here.
- `emit_prerender_slugs.ts:326` joins `place_dim` generically → village-mayor cards gain the village
  name automatically. Re-mint the manifest (`person:slugs:cloud`) after.
- `102_municipal_officials.sql` and `load_official_candidate_links_pg.ts` filter
  `source='official_muni'`, so they are untouched. Verified.

---

## T3 — 2007's duplicated кметства

2007 does not share the HTML path; `ingest_mi2007.ts:275` **replaces** `candidates` with the round-2
table and never sets `round2`/`elected`. Worse, the same кметство arrives from two different
round-1 pages:

```
2007: 5,367 kmetstvo entries, 2,395 duplicate-name entries
      round-sets: {1}: 4,124   {2}: 1,243        (2019/2023: 0 duplicates)
BGS04 "Банево" ← results_1/02/20400002.html (5 rows, no r2)
              ← results_1/02/20402573.html (10 rows, r2 exists → stored as 2 round-2 rows)
```

So one village yields **two** `village_mayor` roles — the round-1 leader *and* the round-2 winner —
plus the round-1/round-2 vote totals disagree in a way page-duplication alone does not explain
(Банево R1 188/174 vs R2 310/390). **Root cause is not established**; the page-family difference
(`20400002` vs `20402573` = obshtina+EKATTE) must be diagnosed before any fix.

Steps: diagnose the two page families → merge to one entry per (obshtina, place) carrying
`round1` + `round2` + `elected` → re-run `--local-ingest mi2007` (the raw ZIPs are already extracted,
`ensureExtracted` reuses them) → expect ~1,243 phantom roles to disappear. Treat every removed role
as a slug retirement and run the same lock purge as T1.

Lower priority than T1/T2: 2007 is 19 years old and no one's current office depends on it. But it is
**24% of all village_mayor roles**, so it distorts any "how many terms" or continuity metric that
v2 §B2 would build on.

---

## T4 — Declarations: say the true thing (closes v2 §B3)

**Village mayors are not in the central register.** Evidence, stronger than v2's open question:

- `register.cacbg.bg/2025/list.xml` (4.8 MB, 95 categories, 15,935 `<Position>` entries) contains
  the substring **"кметств" zero times**, and "кметски наместник" zero times.
- The municipal category is verbatim *"Кметове, и зам.-кметове на общини, кметовете и зам.-кметовете
  на райони, председателите на общинските съвети, общинските съветници и гл. архитекти на общините и
  районите"* — ЗПК чл. 6 (**висша** публична длъжност). Кметовете на кметства are not on that list.
- Our corpus mirrors it exactly: `declaration` tier `muni` = 6,388 rows over five titles only
  (Общински съветник 4,827 / Заместник кмет 694 / Кмет 305 ≈ 265 общини + 35 района / Главен
  архитект 300 / Председател на ОбС 262).

They file with their own общински съвет's standing commission; each municipality publishes its own
register (e.g. `tundzha.bg/zpkonpi/registri-i-deklaratsii-po-zpkonpi/`).

**T4a (do now, cheap).** `/person` must distinguish *"this office is outside the central register"*
from *"this person did not file"*. Today they render identically, which reads as an accusation.
Drive it off the role, not off the missing row: `village_mayor` (and any future non-чл.6 office) →
"не подлежи на деклариране в централния регистър". Mirror it in the `/persons` "с декларация" facet
copy so the KPI is not read as compliance.

**T4b (research spike, timeboxed).** Size a municipal-register ingest: 265 sites, no common schema,
no register API, no `data.egov.bg` dataset, values often in scanned PDFs. Probe 5 municipalities
(Тунджа + 4 of differing platform: egov.bg portal, WordPress, custom) and report format, per-year
coverage and whether values are machine-readable **before** committing to anything. Do not start a
crawler on the strength of one site.

---

## T5 (optional) — ЕРИК for local elections

`ERIK_ELECTIONS` ([erik_config.ts:39](../../scripts/smetna_palata/erik_config.ts:39)) holds **only
three parliamentary elections** (2026_04_19, 2024_10_27, 2024_06_09) — matching the 1,283 `donor`
roles, split 791/252/240. Русев won Безмер twice as an **инициативен комитет**, and ИК campaign
financing is exactly what ЕРИК holds.

**Unverified:** whether ЕРИК exposes an `electionId` for МИ 2023 at all. One probe of
`/Reports?electionId=<id>` answers it. If yes, this is a config addition plus a donor-parser run —
and it is the only money signal that exists for a village mayor.

---

## Sequencing

1. **T1** — re-parse 2023 + 2019 (+ chmi), diff-review, flip file, lock purge, resolve, gates.
   Fixes 267 named people and the `/local/**` display at the same time.
2. **T2** — the settlement place. Independent of T1 but touches the same resolve; landing it in the
   same resolve saves one multi-hour cloud rebuild.
3. **T4a** — the declaration copy. No data dependency; can land any time.
4. **T3** — 2007, after its diagnosis.
5. **T4b / T5** — research spikes, report before building.

T1 and T2 should ship as **one** resolve. v2's **A3** should follow, not precede: it merges people,
and merging on top of corrected winners is cheaper than merging the wrong ones first.

## Cloud sequence (nothing here is automatic)

```bash
npm run db:resolve:persons:cloud              # applies 115 (widened CHECK) + 082, rebuilds person_role
npm run db:load:declarations:pg:cloud -- --resolve
npm run db:load:official-candidate-links:pg:cloud
npm run db:load:person-elections:pg:cloud     # person_id is re-minted every resolve (v2 A1)
npm run db:load:persons-browse:pg:cloud       # applies 120 (settlement arm + label)
npm run db:load:person-search:pg:cloud        # place_label rides person_browse_table
npm run person:slugs:cloud                    # re-mint the committed prerender manifest
```

The 082 label change alone can ship without a resolve:
```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 082_person_api.sql
```
— but it prints settlement labels only for rows a resolve has already re-placed, so it is only
useful as a follow-up fix, never as the whole T2.

## Verification queries

```sql
-- T1: the case that started this — must be Росен Господинов Русев, and the SAME person_id as 2023
SELECT r.ref, p.person_id, p.display_name, p.slug
  FROM person_role r JOIN person p USING (person_id)
 WHERE r.ref IN ('2019_10_27_mi:JAM25:kmetstvo:16','2023_10_29_mi:JAM25:kmetstvo:0');

-- T1: his slug must NOT have become ivan-stoyanov-1xhzvh
SELECT slug FROM person WHERE person_id = (
  SELECT person_id FROM person_role WHERE ref = '2023_10_29_mi:JAM25:kmetstvo:0');

-- T2: no village mayor left on an obshtina place where place_dim has the settlement
SELECT count(*) FROM person_role WHERE role = 'village_mayor' AND place_kind = 'obshtina';
-- expect ≈324 (the 3.0% unresolvable), not 10,721

-- T2: the ?obshtina filter must not have lost anyone
SELECT count(*) FROM person_browse_table WHERE place_kind = 'settlement' AND obshtina_code IS NULL;
-- must be 0

-- T3: 2007 duplicate кметства
SELECT count(*) FROM (
  SELECT split_part(ref,':',2) ob, count(*) n FROM person_role
   WHERE role='village_mayor' AND ref LIKE '2007%' GROUP BY 1) x;

-- v2 A3 regression guard (was 751 on 2026-08-01)
SELECT count(*) FROM (
  SELECT translit_bg_latin(p.display_name), split_part(r.ref,':',2), r.role
    FROM person_role r JOIN person p USING (person_id) WHERE r.source='local'
   GROUP BY 1,2,3 HAVING count(DISTINCT r.person_id) > 1) x;
```

## Risks

- **The re-parse is not surgical.** It rewrites every artifact of the cycle. Step T1.2's diff review
  is the control; without it, an unrelated parser drift ships silently.
- **Every flip is a slug retirement.** The 301 machinery handles it, but the committed
  `data/person/prerender_slugs.json` must be re-minted from the **serving** database
  (`person:slugs:cloud`) — `emit_prerender_slugs.ts` refuses to write from local docker.
- **A resolve on Cloud SQL is multi-hour.** Batch T1 + T2 into one.
- **Landing T2 without 120's settlement arm** silently empties `?obshtina` for 10.7k people —
  green everywhere, wrong on one filter. It is the single easiest thing to forget here.
