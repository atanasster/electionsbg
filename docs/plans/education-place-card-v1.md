# Education place card — v1 plan

Put the matura picture on the Governance place nodes, starting with the oblast
(`/governance/region/:oblast`), including the context-adjusted "над очакваното"
cut — the part of the education dataset nobody else publishes.

Status: **shipped 2026-08-05**, all five steps — `bb1b054319` (loader),
`9963d116a4` (tiles + hook), `02a55c3481` (region node), `a69ba771bf`
(prerendered body), and this measurement pass. Supersedes nothing; extends
`education-mon-v1.md` (the /education explorer) with its place-grain half.

---

## 1. The gap

Education is absent from **every** node of the Governance place family — region
([RegionGovernanceCards.tsx](../../src/screens/dashboard/RegionGovernanceCards.tsx)),
município ([MyAreaScreen.tsx](../../src/screens/myarea/MyAreaScreen.tsx)) and
settlement. `/education` links *out* to places (the oblast table since
491d78351f, and every prerendered school page links to `/governance/{obshtina}`),
so the loop is now half-built: a reader clicks "Смолян" on the matura table,
lands on the region node, and finds no education there at all.

Two things make this look worse than an absence:

- `RegionGovernanceCards`' own header comment already claims the page carries
  "registered-unemployment / matura indicators". It does not —
  `RegionalIndicatorsTile` is Eurostat/НСИ only (GDP, migration, theft,
  enterprises, LT unemployment, FDI, museums, hospital beds, mortality).
- The prerendered region body ([bodyBuilders.ts:1166](../../scripts/prerender/bodyBuilders.ts))
  makes the same claim to crawlers, in both languages.

So the copy promises a matura number on 31 prerendered region pages × 2
languages that no tile has ever rendered. This plan makes the promise true.

---

## 2. What already exists — reuse, do not rebuild

**The hard part is already computed.** [load_schools_pg.ts](../../scripts/db/load_schools_pg.ts)
runs both regressions in the loader and bakes the verdicts into the directory
blob: per school `ses` / `predicted` / `residual` / `verdict` (SES-adjusted) and
`nvoPrior` / `vaPredicted` / `vaResidual` / `vaVerdict` (value-added 7→12), plus
`byOblast`, `byOblastYear`, `nationalByYear`, `regression`, `nvoRegression`.
Nothing in this plan re-derives a residual; it slices what the loader already has.

**The slim-blob precedent exists.** The same loader already emits a second,
tiny payload for exactly this reason — `risk` (3,796 B: the top-20 SES
under-performers) so the МОН pack's tile does not pull the 647 kB directory.
This plan is that pattern, keyed by place.

**No new route, no new migration.** `school_payloads` is a generic
`(kind, key) → jsonb` table, `/api/db/education-payload?kind=&key=` passes both
through verbatim ([db_routes.js:2086](../../functions/db_routes.js)), and the
loader `TRUNCATE`s the table each run — so new `(kind, key)` rows need no DDL and
the existing `ON CONFLICT DO NOTHING` stays harmless.

**Build-time SEO needs no database.** `data/schools/index.json` (1.3 MB) is
**committed**, so the prerender can build the education section from the file —
unlike `/court/**`, where `seo_courts.ts` needs a local Postgres and silently
emits zero pages without one.

**Precedents to copy for the awkward places:** the Sofia-МИР footnote
(`RegionalIndicatorsTile`), the Sofia omission (`CensusDemographicsTile`), the
`SOF00` fallback (`useSchools` / `useIndicators`), `MIN_RANK_COHORT = 10`, and
`bandVerdict` in [school_stats.ts](../../scripts/db/lib/school_stats.ts).

### Measured baseline (local PG, 2026-08-05)

| | |
|---|---|
| `school_payloads.directory` | **647 kB** |
| `school_payloads.risk` | 3,796 B |
| Schools per oblast | 25 (SML, KRZ) … 157 (S23) |
| Rankable (n ≥ 10) | 20/25 (SML) … 142/157 (S23) |
| Within-oblast spread | 3.55–5.38 (SML), **2.10–5.78 (S23)** |
| Municipalities with matura schools per oblast | 11–19 |
| Schools with an НВО prior | **~50–66%** (S23 104/157, PDV 40/78, VAR 30/56) |

The spread column is the finding a place page can make that the national table
cannot: the gap *inside* София is wider than the gap *between* any two oblasts.

---

## 3. What the card shows

Two tiles in one new `Образование / Education` `DashboardSection`
(icon `GraduationCap`), placed after "Цени" and **before** "Програми и
финансиране" — education is a "what is this place like" reading, not a funding
programme, which is the same reason §9 refuses to fold it *into* the money
section.

### 3.1 Tile A — "Матура в областта"

- **Headline**: latest ДЗИ БЕЛ average, rank among the 28 oblasts, delta vs
  the national average.
- **Trend**: first→latest change with the national tick (the dumbbell idiom
  already in [OblastTrendTable.tsx](../../src/screens/education/OblastTrendTable.tsx),
  one row instead of 28).
- **Spread line**: best and worst school in the oblast (rankable only), and the
  share of graduates in schools below 3.00.
- **Counts**: N училища · N зрелостници, with the cohort change — which is a
  demographic signal, and sits one tile away from the page's net-migration and
  census numbers.
- **По общини**: every município in the oblast with matura schools — average,
  change, schools — each row linking to `/governance/{obshtina}`. Full list in a
  `bodyMaxHeight` scroll body (max 19 rows), not a top-N: these are the
  region→município crawl paths the region node exists to provide, and capping
  them throws away the reason the page is prerendered.
- **Footer**: the flat-2.00 methodology note (the same caveat `/education`
  carries, so the two pages cannot read as contradicting each other) and a link
  to `/education`.

**Shipped in step 2 vs deferred.** The trend, the spread line, the по-общини
table (with a labelled header, and its change column naming its baseline) and
both footers are in. Two §3.1 details are deferred to phase 2 rather than
dropped: the cohort CHANGE beside the counts, and a schools column in the
по-общини table — four numeric columns is already the most a tile-width table
carries, and both numbers are in the payload when a wider surface wants them.
The scroll body is a local `max-h-64` box around the table, not `StatCard`'s
`bodyMaxHeight`, so the footnote and the methodology line stay outside the
scroll where a reader will actually see them.

### 3.2 Tile B — "Над очакваното" (in scope, operator decision 2026-08-05)

- **Verdict line**: the oblast's mean SES residual — "училищата в областта
  постигат средно +0,12 над очакваното за контекста си".
- **List**: schools ranked by residual, `verdict === "above"` first, each linking
  to `/school/:id`, showing actual vs predicted.
- **Value-added arm** (7→12 НВО): rendered as a secondary line **only when the
  place has ≥ 5 schools carrying a `vaVerdict`**, and always labelled with its
  coverage ("за 30 от 56 училища"). Coverage is 50–66% nationally, so an
  unlabelled figure would imply a completeness we do not have.
- **Caveat**: the residual is measured against the **national** SES regression
  computed once in the loader. The tile never recomputes it, and never regresses
  within an oblast — a 25-school fit would be noise.

**Rankable, stated in full**: ≥10 graduates (`MIN_RANK_COHORT`) **in the headline
year**. Both halves matter. A school that stopped reporting keeps its last score
in `latestScore`, so a cohort-only rule ranks it — undated — inside a card
headlined with a later year, on a different school set from the headline itself.
It leaves every list instead. (Caught in review at step 1: 10 rows across 7
blobs, on a 2023 score under a 2026 headline.)

A place with **no** current cohort gets no blob at all rather than one reading
`avg: 0`; and a place with too few rankable schools for a distinct head and tail
gets an empty `bottom` rather than the same schools listed twice.

---

## 4. Delivery — a precomputed place payload

Emit a third payload kind from the same loader pass:

```
school_payloads (kind='place', key=<oblast code | obshtina code>)
```

One namespace is safe: oblast codes are 3-char (`SML`) or `S23`, obshtina codes
are 5-char (`SML10`, `SOF00`) — they cannot collide.

**Blob contents** (~3–8 kB): `latestYear`, headline (`avg`, `examinees`,
`schools`, `rank`, `nationalAvg`), `series` (per-year avg + examinees),
`byObshtina[]` (region blobs only), `top[]` / `bottom[]` by score, `above[]` by
residual, `va` (coverage + list), and the place's own label fields.

**Both grains are emitted in v1, only the region UI is wired.** The rows are
free — the loader already holds every school in memory — and the expensive,
easy-to-forget half is the *cloud reload*, not the rows. Emitting município
blobs now means phase 2 is a UI-only change with no second
`db:load:schools:pg:cloud`.

**Client**: `useEducationPlace(code)` in `src/data/schools/`, React Query,
`staleTime: Infinity`. A missing blob returns `null` and both tiles self-hide —
degrade, don't fail, so a cloud database that has not re-run the loader shows no
education section rather than a 500 (the `psp:not-built` discipline in CLAUDE.md,
minus the log: a place with no schools is a legitimate empty, not a defect).

**Cloud**: `npm run db:load:schools:pg:cloud`, already step-listed in the
`update-schools` skill (SKILL.md:96), so nothing new to wire. The plan still
states the failure mode: a skipped cloud load leaves prod serving the previous
matura vintage at a 200, with nothing red anywhere.

### Rejected alternatives

- **Filter the directory blob client-side** — zero backend work, but that is
  **647 kB measured** pulled onto a place dashboard to render two tiles. The
  `risk` blob exists precisely because this was already rejected once.
- **Live SQL aggregate over `schools`/`school_scores`** — the residual and
  verdict are not relational columns; only the loader has the regression. Making
  them columns is a reasonable future move (queryable by the AI tools), but it is
  a migration + a new route for no v1 gain.

---

## 5. Performance contract

Every budget below is **measured**, not asserted by eye, and the numbers land in
a `## Measured` section appended to this plan at the end of the build.

| # | What | Budget | How measured |
|---|---|---|---|
| P1 | Serving read `WHERE kind='place' AND key=$1` | < 5 ms, < 50 shared buffers | `EXPLAIN (ANALYZE, BUFFERS)` on the **worst-case key** (`S23` — largest school set, biggest blob) |
| P2 | Per-place blob size | ≤ 12 kB max, ≤ 8 kB p95 | `length(payload::text)` over all `kind='place'` rows |
| P3 | `school_payloads` total | ≤ 4 MB | `pg_total_relation_size` |
| P4 | Added loader wall-clock | ≤ +3 s on `db:load:schools:pg` | time the loader before and after |
| P5 | Region page network cost | the directory blob is **never** fetched; place blob ≤ 12 kB on the wire | `read_network_requests` on `/governance/region/S23` |
| P6 | Prerender cost | +0 file reads per region (index parsed **once**, hoisted), ≤ +1 s on the prerender step | time `buildGovernanceRegionRoutes` before and after |

Notes that will otherwise waste a measurement cycle:

- **P1's assertion must be on buffers and time, not on plan shape.** `school_payloads`
  will hold ~300 rows; Postgres may legitimately choose a seq scan on a table that
  small and still be fast. A "must be an Index Scan" assertion would be a flaky
  test that fails for a correct reason.
- **P4 is measured on a warm cache, twice**, and reported as the median — the
  loader's own variance across runs is larger than the increment we're bounding.
- Per [feedback_db_query_perf], any *new* SQL introduced along the way (e.g. an
  index on `schools.oblast` if the по-общини rollup ends up querying rather than
  folding in memory) gets its own `EXPLAIN ANALYZE` on the worst-case entity
  before it ships. The intended implementation folds in memory and adds no query.
- P2 is enforced as a **hard test assertion**, not just a measurement: a blob
  that grows past the ceiling is how this quietly becomes a second directory blob.

---

## 6. Edge cases that will bite

| Case | Behaviour |
|---|---|
| **Sofia's three МИР** (`S23`/`S24`/`S25`) | МОН publishes Столична община as one `SOF00` aggregate, so the loader keys it `S23`. Alias all three region pages to that blob **with a footnote** — the `RegionalIndicatorsTile` precedent. Silently showing S23's numbers on the S24 page without saying so is the failure to avoid. |
| **`PDV-00`** (Пловдив град МИР) | regions.json carries both `PDV` and `PDV-00`; the education cut has only `PDV`, city included. Same alias + footnote. |
| **МИР 32 / diaspora** | No schools → no blob → section self-hides. The surrounding sections already drop for diaspora. |
| **Sofia районы** (`S23xx`…) | Phase 2 only: fall back to `SOF00`, as `useSchools`/`useIndicators` already do. |
| **Place with no matura schools** | Tiles hide. Not an error state, no log. |
| **Methodology** | The flat-2.00 note ships with any headline average. Without it, `/education` (4,33) and a region page quoting МОН's own figure read as contradicting each other. |
| **Small N** | `MIN_RANK_COHORT` gate on every ranked list, both tiles. |
| **A school stopped reporting** | It leaves every ranked list rather than appearing with an undated older score — the ranked lists share the headline's membership rule (§3.2). It still counts toward the trend in the years it did report, which is the honest rule for a series. |
| **Too few schools to rank** | `bottom` is empty below 10 rankable schools; the tile shows a "best" list only, instead of naming the same schools as both best and worst. |

---

## 7. Build order

Each step is independently shippable and ends green.

**Step 1 — loader emits `kind='place'`.** ✅ `bb1b054319`. Region + município blobs in the
existing pass; extend [schools_pg.data.test.ts](../../scripts/db/tests/schools_pg.data.test.ts)
with the reconciliation and size gates (§8).

**Step 2 — data hook + tiles.** ✅ `9963d116a4`. `useEducationPlace`, `EducationPlaceTile`
(Tile A) and `EducationExpectedTile` (Tile B), i18n keys in bg + en, co-located
component tests.

**Step 3 — wire into the region node.** ✅ `02a55c3481`. New `DashboardSection`, the Sofia /
`PDV-00` aliasing and footnote, self-hide behaviour.

**Step 4 — prerendered body.** ✅ `a69ba771bf`. Education section in `buildGovernanceRegionBody`
(bg + en) from the committed index, parsed once; fix the stale "matura
indicators" claim in the same pass; prerender unit test.

**Step 5 — performance pass.** ✅ — see `## Measured`. Run P1–P6, record the numbers in `## Measured`,
and fix anything over budget before declaring done.

**Phase 2 — the município node** (`/governance/{obshtina}`, 265 pages + Sofia's
24 районы + the 11 Пловдив/Варна районы; UI only, the blobs already exist).

- *Step 1* — the section on `MyAreaScreen`, `chrome="none"` because that page is
  a flat run of cards. Sub-city places alias to their parent (Sofia районы →
  `SOF00`, `PDV22-01` → `PDV22`) and say so. The quality strip's schools column
  names its own basis, because it and the new card show two different numbers
  for the same place (Столична община 4.37 vs 4.69) and unlabelled they read as
  a contradiction.
- *Step 2* — the prerendered município body, so the 265×2 crawler pages carry
  what the SPA renders.

**Phase 3**: the settlement node, where schools carry `loc` — see §9's open
question about whether it aggregates by `loc` or by school coordinates.

---

## 8. Tests

**Postgres data tests** (extend `schools_pg.data.test.ts`, auto-skips without a
database, like its siblings):

- Every oblast present in `byOblast` has a `kind='place'` blob; `SOF00` has one.
- The blob's headline **reconciles to the directory blob's `byOblast` row** for
  the same oblast — same aggregation rule, so the region page cannot drift from
  `/education`.
- `byObshtina` school counts sum to the oblast's school count.
- Every school in `top`/`bottom`/`above` satisfies `latestN >= MIN_RANK_COHORT`.
- Every `above` entry carries `verdict === "above"` and a residual matching the
  directory blob's value for that school id.
- **Size ceiling (P2)** — hard fail past 12 kB.

**Component tests**: headline renders; `null` payload hides both tiles;
município rows link to `/governance/{obshtina}` and school rows to `/school/:id`;
the Sofia footnote appears for `S24`/`S25` and not for `SML`; the value-added
line is suppressed under the ≥5 threshold and carries its coverage label above it;
the methodology note is present wherever the average is.

**Prerender test**: the education section appears for an oblast in the index,
every emitted URL is the **no-slash** form, and the body degrades to today's
output when the index has no entry for that oblast.

---

## 9. Decisions

Settled:

- **"Над очакваното" is in scope for v1** (operator, 2026-08-05).
- Delivery is the precomputed place blob; both grains emitted, region UI only.
- Its own `Образование` section, not folded into "Програми и финансиране" —
  education is not a funding programme, and the section header is what makes it
  findable on a long page.
- The по-общини list is **complete** (scroll body), not top-N — crawl paths.
- The value-added arm ships in v1 but **gated** at ≥5 schools with a `vaVerdict`
  and always labelled with coverage.

Open (do not block the build):

- Whether the settlement node (phase 3) aggregates by `loc` or by school
  coordinates.
- Whether `residual` / `verdict` should become relational columns on `schools`
  so the AI tools can query them (a follow-up, not a v1 blocker).

---

## Measured

Local Postgres (docker, :5433), 994 schools / 271 place blobs, 2026-08-05.
Every figure below was measured, not estimated.

All sizes are **bytes** (`octet_length`), not characters: these blobs are mostly
Cyrillic, so `length()` under-reports them by ~14% and would have let a 14 kB
payload through a ceiling labelled 12 kB. The committed gate was measuring
characters until this pass; it now measures bytes.

| # | Budget | Measured | |
|---|---|---|---|
| **P1** | serving read < 5 ms, < 50 buffers | **0.04–0.06 ms**, `shared hit=2`, `Index Scan using school_payloads_pkey` — on `SFO`, the largest blob, and on `S23`, the largest school set | ✅ |
| **P2** | ≤ 12 kB max, ≤ 8 kB p95 | **9,413 B max** (`SFO`), **7,849 B p95**, 2,327 B mean | ✅ |
| **P3** | `school_payloads` ≤ 4 MB | **672 KiB** on disk (`pg_total_relation_size` = 688,128 B) | ✅ |
| **P4** | ≤ +3 s on `db:load:schools:pg` | **+0.00 s** — median 0.68 s before (bb1b054319^) and 0.68 s after, three runs each | ✅ |
| **P5** | directory blob never fetched; ≤ 12 kB on the wire | **one** request, `kind=place&key=S23`, **7,795 B**, 20 ms; `kind=directory` never requested | ✅ |
| **P6** | index parsed once, ≤ +1 s on the prerender | **1 read** of `data/schools/index.json` for the whole 31-region × 2-language build (counted by instrumenting `fs.readFileSync`); 11.8 ms for `readEducationPlaces`, 11 ms median for the whole route build | ✅ |

Notes on what the numbers mean, and what they don't:

- **P1's plan shape held after all** — the planning note anticipated a seq scan on
  a ~300-row table and asked for the assertion to be on buffers and time. Postgres
  chose the primary-key index anyway (2 buffers). The gate in
  `schools_pg.data.test.ts` still asserts size, not plan, for the reason the plan
  gives: a plan-shape assertion on a table this small would be flaky for a correct
  reason.
- **The largest blob is `SFO`, not `S23`** — §5 guessed the latter. Size follows
  the uncapped по-общини list (Софийска област has 19 municipalities), not the
  school count (Sofia city has 155 schools inside one município). Both were
  measured; both give the same plan and the same 2 buffers.
- **P2's p95 clears its budget by 4%, not comfortably.** 7,849 B against 8,192.
  The list caps (5/5/8/5) and the по-общини row shape are what hold it there, and
  the 12 kB hard gate is the backstop if a cap is ever loosened.
- **P4's loader gained no measurable time.** The 271 blobs ship in one batched
  INSERT (a step-1 review finding), so the added work is an in-memory fold, below
  the loader's own run-to-run variance. Cloud SQL is unmeasured; the batching is
  what keeps it one round-trip rather than 271.
- **P5 is the whole point of the `place` kind.** 7,795 B on the wire against a
  718,009 B directory blob — 92× — and the request COUNT (one, not two) is what
  proves the page never falls back to the full corpus.
- **P6's evidence is the read count, not the timing.** Timing can suggest a single
  parse; counting the reads establishes it. `readEducationPlaces` runs inside
  `buildGovernanceRegionRoutes`, so its 11.8 ms is part of that build's 11 ms
  median, not additional to it — the two figures come from separate runs with a
  warm page cache.
- **All 31 region routes carry the section in both languages** — including the
  three Sofia МИР and `PDV-00`, which reach it through the alias rule rather than
  through a blob of their own. (32 regions exist; МИР 32, abroad, is not
  prerendered.)
