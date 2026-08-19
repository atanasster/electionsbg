# Чуждо имущество — the two declaration tables that are not holdings

**Status:** implemented 2026-08-18 (T0-T6). Cloud publish pending — see §5.

`person_wealth_year` (090) publishes, as a named person's wealth, property and
vehicles that person explicitly declared they **do not own**. Tables 1.2
(„Чуждо недвижимо имущество") and 3.4 („Чужди моторни сухопътни, водни и
въздухоплавателни превозни средства") record assets the declarant *uses* —
rented, or provided by a third party — and the parser folds them into the same
`real_estate` / `vehicle` categories as tables 1 and 3, with nothing on the row
to tell them apart.

## 1. What the register actually says

The two pairs of tables are not variants of one thing. Their COLUMN HEADERS
differ, and every difference says the same thing:

| | table 1 / 3 (own) | table 1.2 / 3.4 (чуждо) |
|---|---|---|
| the money column | „Цена на **придобиване** /лева/" | „Цена **по договор** /лева/" |
| the basis column | „Правно основание за **придобиване**" | „Правно основание за **ползване**" |
| the year column (3 vs 3.4) | „Година на придобиване" | „Година на **сключване на договора**" |

So the number being summed into net worth is not a mis-attributed asset value —
it is **the price of the use contract**. Пеевски's 2025 filing carries
„къща с двор, София, 917 кв.м. … 126 738 … договор за наем": that figure is what
the tenancy costs, and it is currently published as €64,800 of his estate.

## 2. Measured

Whole cached corpus (67,841 XMLs; root `PublicPerson` only, v2 forms only —
the pre-2018 form has no 1.2/3.4 at all — honouring `Declared="True"` and
`isEmptyRow`, i.e. the parser's own selection):

| | rows | declarations | € |
|---|---:|---:|---:|
| valued чуждо rows in `declaration_asset` | 5,183 | 2,931 | **69,545,664** |
| …of which reach `person_wealth_year` | — | 2,422 person-years / 1,306 people | **58,669,803** |

By tier: exec €47.1m, mp €16.5m, muni €6.0m. Vehicles alone: 612 MP rows /
€11.5m, which is what reaches `/mp-cars`.

**The leaderboard TOP is unaffected, and that is why this survived.** Of the
19,188 people with a published net worth, the top 100 does not change at all —
the largest fortunes are dominated by genuine holdings. The damage is entirely
per-profile, and it is severe there:

- **882** people's latest published year contains чуждо;
- **217** are ≥50% чуждо, **106** are ≥90%;
- **552** fall 50+ ranks once it is removed;
- eight people go from a published **positive** net worth to a **negative** one
  — Лазарина Василева Бонева-Харалампиева is published at €185,129 and actually
  declares net liabilities of €30,570.

Worst single case: **Стефан Добрев Стайков, €445,386 published, €0 real** — 100%
of his published estate is other people's property.

Пеевски (person 37421, 2025 annual, declaration 5101): €10,070,563 published,
€233,109 property + €77,307 vehicles чуждо, **€9,760,147** owned. His Table 1 and
Table 3 are both `Declared="False"` — he declares no property and no vehicles of
his own at all.

## 3. Why nothing catches it

- **`declaration_asset` stores no table provenance**, so no downstream consumer
  *can* tell an owned asset from a used one. `declaration_stake` has carried
  `table_num` since 089; the asset table never did.
- **`legal_basis` is not a discriminator.** Пеевски's чужди cars carry
  `legal_basis = 'договор'` — and so does Румен Радев's own car, which is in
  table 3. A probe on `legal_basis ILIKE '%наем%'` finds 948 real-estate rows in
  the 2026 annuals and **misses the vehicle side entirely**.
- Every row count reconciles, no page errors, and the front page of
  `/officials/assets` is correct. The failure is invisible from every angle a
  reviewer normally checks — the same shape as the visibility-map class.

## 4. The fix

### T0 — the parser records which table a row came from

`MpAsset` gains `tableNum: string | null`; `parseAssetTables` sets it as it
walks each family. Store the **canonical v2 number** (`'1'`, `'1.1'`, `'1.2'`,
`'3'`…`'3.4'`, `'4'`…`'9'`) regardless of the filing's form version — that is
the existing precedent: `parseTable10Row` hard-codes `table: "10"` so a v1
filing's table 11 is stored as 10. The printed number is version-dependent and
ambiguous (v1's „4" is boats, v2's is cash); the canonical number is not.

### T1 — schema + loader

`declaration_asset.table_num text` (089, `ADD COLUMN IF NOT EXISTS` in the
reconcile block so warm databases get it), written by `load_declarations_pg.ts`
in `ASSET_COLS`. **No CHECK constraint listing the numbers** — a new subtable in
a future form revision must land as data, not as a failed COPY.

### T2 — one definition of "is this a holding"

The rule gets ONE home and both languages read it, on the
`asset_share_multiplier` / `is_crypto_asset` / `declared_label` precedent —
twelve hand-copied COALESCEs is the shape that produced the six-way
`magistrate_current` duplication:

- `is_declared_holding(p_table_num text)` in **089**, IMMUTABLE, PARALLEL SAFE,
  **not STRICT** — `NULL` must return TRUE.
- `isDeclaredHolding(tableNum)` in `src/lib/declarations.ts`.

**NULL → true is load-bearing.** Rows loaded before T1 carry no table number,
and treating them as non-holdings would silently delete real estates from every
published figure. The migration is therefore **inert until T3 lands**, which is
correct: it changes nothing until the corpus can answer the question.

### T3 — re-parse and reload (this is the step that moves the numbers)

The shard trees are **committed** (1,061 MP + 16,109 officials + 6,937 municipal
files), so the re-parse travels with git and the diff is reviewable:

```bash
npx tsx scripts/declarations/backfill_asset_table_num.ts --apply   # no network
npm run db:load:declarations:pg
npm run db:load:declarations:pg -- --resolve
```

⚠️ **NOT `rebuild_all_from_cache.ts`.** That re-parses the MP tree only (1,061 shards) and
rewrites each declaration wholesale; the tiers carrying most of the damage are exec
(€47.1m) and muni (€6.0m), which it never touches, and re-running their ingests needs the
register's listing pages — a network pass with its own `--max-missing` refusals. The
backfill walks the three committed shard trees the PG loader itself reads and writes
exactly one new field per asset row.

Measured on the 2026-08-18 run: **351,938 rows stamped across 21,684 of 23,817 shards**,
of which **8,803 are чуждо** (1.2 = 6,606, 3.4 = 2,197). Rows by table:

```
1=87550  1.1=46017  1.2=6606  3=39854  3.1=1192  3.2=222  3.3=846  3.4=2197
4=27004  5=72515    6=3686    7=47495  8=8390    9=8364
```

**37 filings were skipped and the script says so.** Their shards predate a parser value
fix — `anatoli-vaskov-velikov-70ba58`'s three debts are `valueEur: null` in the shard and
real numbers on re-parse — so the row sets no longer match on (category, description,
valueEur). Stamping them positionally would be a guess, and re-parsing them whole would
move values this change has no business touching. They keep `table_num = NULL`, i.e. they
stay counted as holdings, and the script reports how many чуждо rows that leaves: **13**
on this run, against 8,803 stamped. The residue is named rather than rounded away — it is
0.15% of the чуждо corpus and the only part of this change that is knowingly incomplete.

### T4 — the consumers stop counting them

Five call sites, all reading the T2 helper, never restating the rule:

| where | what |
|---|---|
| `090_person_wealth.sql` | `person_wealth_year` assets/net; `person_declaration_detail`'s totals |
| `100_officials_rankings.sql`, `105_mp_serving.sql` | the two rankings matviews |
| `092_accumulation_gap.sql` | the accumulation endpoints |
| `src/lib/declarations.ts` `declarationTotals` | the JSON rollups behind `/officials/assets`, `/mp-assets`, `/candidate/:id/assets` |
| `scripts/declarations/build_car_makes.ts` | `/mp-cars` — it filters on `a.category !== "vehicle"` only, so 612 чужди cars are currently counted as MPs' cars |

`159_person_crypto.sql` needs no change (crypto is table 8) but sits behind the
090 CASCADE, so it is in the apply command regardless.

### T5 — surface them, do not hide them

Excluding without rendering *loses* something real: „Пеевски declares no property
of his own and rents eight houses at 126,738 лв." is a finding. The rows stay in
`declaration_asset`, and `/person` + `/candidate/:id/assets` render them under
their own heading — **„ползва"**, separate from „притежава", with the money
column labelled as the contract price rather than a value.

### T6 — the gate

`scripts/db/tests/declaration_foreign_assets.data.test.ts`:

1. a `table_num IN ('1.2','3.4')` row never contributes to `assets_eur` /
   `net_eur` — asserted on Пеевски's 2025 row by name and value;
2. `is_declared_holding` and `isDeclaredHolding` agree over **every distinct
   `table_num` in the corpus**, not a hand-picked list (the
   `asset_share_multiplier.data.test.ts` pattern);
3. a **mutation check** — restore the unfiltered sum in a rolled-back
   transaction and assert the figure moves, so the assertion cannot go vacuous;
4. non-vacuity: at least one чуждо row exists and is excluded;
5. an **exhaustiveness sweep** in the `declaration_filed_position` style —
   enumerate every function/view/matview whose definition reads
   `declaration_asset` and sums a value, and fail unless it either routes
   through `is_declared_holding` or is listed with a reason. A new wealth surface
   then fails until someone decides.

## 4b. The format trap the backfill hit

`scripts/declarations/formats.ts` ends „Do NOT mass-reformat either family to
unify them", and the first cut of the backfill did exactly that. The parliament
tree is `compactJson` (one line, no trailing newline); the officials trees are
`writeJson` (2-space indent, trailing newline). Writing one format for both
reformatted 1,061 MP shards into a ~1.4M-line whitespace diff — and the next MP
ingest writes them straight back, so it would churn the bucket on every run
thereafter.

The writer now re-serialises each file in the format its own bytes are already
in (`/^\s*\[\s*\n/` on the head, trailing newline preserved), detected per
file rather than from a hard-coded tree list so a family that changes format
later cannot start silently churning. Verified as a byte-identical round-trip on
one file from each of the three trees before the real run.

## 4c. MEASURED after the change (local, 2026-08-18)

Every figure in §2 was estimated by matching чуждо rows on `(declaration_id, category,
amount)` before `table_num` existed. That join **over-matched**: where a declarant files
the same property in both table 1 and table 1.2 — Гергана Стоянова Младенова's 2022 filing
lists four identical apartments in each — it counted the owned row as чуждо too. The
numbers below are from the stamped corpus and supersede §2.

| | measured |
|---|---:|
| чуждо rows in `declaration_asset` | **7,278** (6,945 valued), €73,556,611 raw, 3,201 filings |
| removed from `person_wealth_year` | **€55,565,683** — 1,980 person-years, 1,120 people |
| corpus total assets | €4,213,997,747 → **€4,158,432,064** (see the drift note) |
| latest-year profiles affected | **795**; 208 were ≥50% чуждо, 100 ≥90%, **77 entirely** |
| rank displacement | 562 fall 50+ places; worst drop 15,106; **top 100 unchanged** |
| `/mp-cars` | 721 → **643** rows, €7,109,059 → **€5,483,110**, 401 → **360** MPs |

Worked examples hold: Пеевски 2025 **€10,070,563 → €9,760,147**, exactly the figure the
report predicted; Стефан Добрев Стайков 2024 **€445,386 → €0**.

**Drift note.** The two ABSOLUTE totals above were true at the moment of measurement and
have since moved: concurrent FX-imputation work (`declaration_asset.value_basis`) began
valuing rows the declarants left blank, taking the corpus to €4,184,427,196 and Пеевски's
2025 to €9,849,697. That is unrelated and legitimate. **The DELTA figures are invariant** —
7,278 rows, €73,556,611 raw, €55,565,683 removed, 1,980 person-years, 1,120 people — and are
the ones to quote. The data test was re-anchored for the same reason: it asserted Пеевски's
published assets fell in a €9.6-9.9m band, which the imputation walked to the edge of, and
now asserts the RELATIONSHIP (published == holdings-only recompute), which nothing else can
move.

## 4d. ⚠️ The lease asymmetry — an open decision, not a bug

**103 people move from a published positive net worth to a negative one, and 70 of them do
so because of a pairing this change does not resolve.** Table 3.4's dominant use is a
LEASED vehicle: **1,014 of the 1,826 filings carrying a 3.4 row also carry a лизинг debt**.
Under a lease the lessor owns the car, so 3.4 is the correct table — but the lease
liability sits in table 7, which stays counted. Excluding the asset while keeping the debt
is asymmetric.

Александра Ботева Сарийска (2026) is the shape: two leased cars at €71,161 and €87,978 in
3.4, and €186,697 of лизинг debt in table 7, against €82,655 of owned property. Published
€89,973; now **−€69,167**.

Three readings, none obviously wrong:

1. **Strict (shipped).** She does not own the cars and she does owe the money, so her
   estate really is negative. Defensible, and it is what the form says.
2. **IFRS-16-like.** A lease creates a right-of-use asset AND a liability; dropping one
   side is not an accounting treatment anyone uses.
3. **Pair and drop both.** Not reliably implementable — the table-7 description is free
   text, and matching on „лизинг" would also drop lease debts against property the
   declarant DOES own.

Shipped as (1) plus a caveat: the „ползва" block renders each row's „правно основание"
(„договор за наем" / „лизинг"), and when a filing pairs a чуждо VEHICLE with a лизинг debt
the block states in words why the net figure can be negative. The arithmetic is right;
unexplained beside a named public official it reads as an accusation.

**This is worth a decision before the numbers are relied on.** It was not visible when the
plan was written — the pre-`table_num` estimate put the flip count at 8, not 103.

## 4e. A pre-existing hazard this reload uncovered (fixed)

Running phase 1 to land the stamped shards **returned all 61,740
`declaration.filed_position` / `filed_institution` values to NULL.** They are not in the
shards — the shard writers never persisted them — so they live only in Postgres, filled by
a ~5-hour, 54,071-fetch crawl. Phase 1 is `TRUNCATE declaration … CASCADE` + COPY of
columns that do not include them. The load reported success and every row count reconciled;
the only symptom was `declared_label()` falling back to the register's LISTING label, a
GROUP bucket that describes nobody.

This is not caused by the чуждо change — **any** `db:load:declarations:pg` did it, and
CLAUDE.md instructs running phase 1 against Cloud SQL after a roster re-slug, so the
documented procedure destroyed the values on the SERVING database. Cloud SQL survived only
because nobody had followed that instruction against it yet.

Recovered by shipping back from Cloud SQL (`ship_filed_position.ts --from <cloud> --to
<local> --apply`, 61,743/61,743 matched) and closed permanently: the loader now snapshots
both columns by `source_url` inside its own transaction and writes them back after the
COPY, reporting `carried … for N/N filing(s)` — verified on a subsequent reload.

## 5. Cloud publish order

Nothing here is automatic. 090 opens with `DROP MATERIALIZED VIEW
person_wealth_year CASCADE` and takes five dependents, so the apply command is
the full one from CLAUDE.md **including 148** — omit it and 120 raises 42P01
after the CASCADE has already deleted `person_browse_table`.

```bash
npm run db:load:declarations:pg:cloud              # phase 1 — the re-parsed shards
npm run db:resolve:persons:cloud                   # only if slugs moved; usually skip
npm run db:load:declarations:pg:cloud -- --resolve # applies 089/090/…/159 in its own order
npm run db:load:persons-browse:pg:cloud
npm run db:load:person-search:pg:cloud
npm run deploy                                     # T5's rendering
```

Phase 1 must lead: it is what rewrites the asset rows with their table numbers,
and `--resolve` alone will not. Skipping it leaves the corpus without
`table_num`, every row NULL, and the whole change inert on prod while local is
correct — with every row count reconciling.

## 6. Deferred, deliberately

**Table 1.2's area column is „Площ /декара/" while table 1's is „Площ кв.м.",
and the parser feeds both into `area_sqm`.** Measured: all 1,787 declared 1.2
tables carry the декара header, but 5,375 of 5,830 rows are bare numbers, 451
say кв.м. and 4 say декара — so the declarants largely ignore the header and the
unit is genuinely unrecoverable per row. This matters because `perSqmAnchor`
drives `correctRealEstateSeparatorTypo`, which **mutates the stored value**. Out
of scope here (excluding these rows from wealth removes the consequence for
every figure this plan touches), but it is a live parse-time ambiguity and wants
its own pass before any surface renders a 1.2 area.
