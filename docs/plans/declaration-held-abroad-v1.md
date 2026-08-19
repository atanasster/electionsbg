# `held_scope` — where the declarant says the money sits

**Shipped 2026-08-19.** Adds the „В страната" / „В чужбина" cell pair to
`declaration_asset`, so the corpus can answer „колко от парите на властта се държат в
чужбина и къде" — a question the register publishes per account and we held none of.

Found while auditing our ingest against an actualno.com article
(`docs/audits/actualno-hristov-koprinkov-yotova-2026-08-19.md`): Иво Христов Петков's
228,100 EUR account is marked „Белгия" at source, and our five rows for his other
accounts were byte-identical to it in every column we stored.

## 1. Three corrections to the obvious specification

The natural reading of the register — „add `held_abroad boolean` and `held_country text`,
populate from cells 7/8 of tables 4/5/8" — is wrong in three ways, each measured over all
67,841 cached filings.

**Table 4 has NEITHER column.** „Налични парични средства" carries no domestic/abroad
pair at all, and its `Cell Num="7"` is „Произход на средствата". Reading the pair off it
does not yield a blank — it yields the funds origin, so all 25,717 cash rows would have
published as held in a country called „заплата". The pair exists on exactly two tables:

| form          | table                    | cells     | filings |
| ------------- | ------------------------ | --------- | ------- |
| 2018 (v2)     | 5 „Банкови влогове"      | 7 / 8     | 60,112  |
| 2018 (v2)     | 8 „Вложения в … фондове" | 7 / 8     | 60,112  |
| pre-2018 (v1) | 7 „Банкови влогове"      | **6 / 7** | 1,542   |

**The pre-2018 form puts them at 6/7, not 7/8.** No special case was needed:
`columnResolver` already shifts every column after the ЕГН cell and `EGN_COLUMN.bank = 6`
maps 7→6 and 8→7 exactly — but only because the pair is passed through `col()` like every
other cell. v1 has no `investment` table, which is why only one v1 row appears above.

**A boolean cannot represent the answer.** The two cells are not a flag plus a country;
they are a positional yes/no pair the register does not validate, so what they hold is
free text — **5,691** distinct spellings in „В страната", **597** in „В чужбина", over
82,665 money rows. The commonest filling is a tick in one column and a denial in the other
(„да" / „не", 18.3%), **28.8% of rows carry content in BOTH**, and the columns contradict
each other on a real minority. A boolean would have to invent an answer for:

- **346 rows that leave both blank** — defaulting those to `false` publishes „held in
  Bulgaria" as a fact about a named person;
- **~130 rows that tick both**;
- **~93 rows that SPLIT one amount across the two columns** — 151,744 in „В страната"
  - 967 in „В чужбина" against an amount cell of 152,711. Neither scope is true of the
    whole row;
- **47 rows that answer domestically inside the „В чужбина" column** („в страната",
  „България") and 17 the reverse, so position alone gets every one of them backwards.

## 2. The design

`classifyHeldPlace` in `scripts/declarations/held_abroad.ts` is the ONE definition, applied
at **parse** time and **stored**. There is deliberately no SQL twin — a serving surface
reads a column rather than re-deriving a rule over free text. That is the same shape as
`value_basis`, and the opposite of `is_declared_holding`, which must be re-derived per
query because it is a function of `table_num` alone.

Four columns on `declaration_asset` (089):

| column                | meaning                                           |
| --------------------- | ------------------------------------------------- |
| `held_scope`          | `'domestic'` \| `'abroad'` \| `'unknown'` \| NULL |
| `held_country`        | canonical Bulgarian country name, or NULL         |
| `held_raw_in_country` | the „В страната" cell, verbatim                   |
| `held_raw_abroad`     | the „В чужбина" cell, verbatim                    |

**NULL is not `'unknown'` and neither is `'domestic'`.** NULL means the row's table has no
such question (every real-estate, vehicle and cash row, and every row parsed before this
existed). `'unknown'` means the filing answered unintelligibly. Folding either into „held
in Bulgaria" publishes a claim nobody made.

**The raw cells are stored because the rule reads free text.** A later refinement has to be
able to re-decide without a re-parse — and the institution declarants write there
(„ОББ", „Revolut", „Amundi Funds", an IBAN) is recorded nowhere else in the corpus.

### How a disagreement is settled

Each cell is classified into an assertion with a SPECIFICITY TIER, and only the top tier
present votes:

```
'place'    named a country, or echoed „В страната" / „В чужбина"   — content beats position
'content'  a denial, a bank, a fund, an IBAN, an amount            — the column decides
'tick'     „да", „х", „x", „v", „+"                                — the column decides
```

Two rules in there are load-bearing and neither is obvious:

- **A named place beats a bare tick in the other column.** „РБългария" in „В страната"
  beside „х" in „В чужбина" (~100 rows of that shape) is one declarant naming their country
  and then STRIKING OUT the column that does not apply — „х" is a tick to some filers and a
  strike-through to others, and nothing in the cell says which. Read as two equal claims,
  every one of those filings is thrown away as `unknown`.
- **A lone denial asserts the OTHER column.** The pair is exhaustive by construction — the
  money is either in the country or outside it — so „В чужбина: не" is a positive statement
  that the money is domestic, and it is the only statement **81 rows** make.

A tie WITHIN the top tier is a genuine contradiction and stays `unknown` rather than being
resolved by picking a side. That is what the split amounts land on.

## 3. Measured

Local Postgres, 2026-08-19, after the backfill and reload — 76,953 money rows on tables 5+8:

| scope      | rows      | share     | €               |
| ---------- | --------- | --------- | --------------- |
| domestic   | 73,461    | 95.46%    | 2,074,105,247   |
| **abroad** | **3,196** | **4.15%** | **168,515,251** |
| unknown    | 296       | 0.38%     | 13,572,006      |

**765 people** declare at least one holding abroad.

**A country is named on only 521 of 3,288 abroad rows — 11.6% of the money.** „да" in the
„В чужбина" column (1,576 rows) says abroad and names nowhere. So `held_country IS NULL`
is NOT evidence of being domestic, „how much is abroad" is answerable over `held_scope`,
and „where" is answerable only over the named subset — which any surface reporting it must
say. 37 distinct countries; by money: Белгия €8.63m, Швейцария €3.49m, Германия €0.97m,
САЩ €0.94m, Турция €0.85m, Австрия €0.82m, Люксембург €0.81m.

## 4. Applying it

The change is **INERT until the shards are re-parsed** — the cells exist only in the source
XML, no SQL can backfill them, and 089 reads the NULL as „no such question". Same order as
`is_declared_holding` and `value_basis`, and `--resolve` alone does NOT rewrite asset rows:

```bash
npx tsx scripts/declarations/backfill_asset_held_abroad.ts --apply   # offline, reads raw_data/
npm run db:load:declarations:pg                                     # phase 1
npm run db:load:declarations:pg -- --resolve                        # phase 2 — refills person_id
```

Phase 2 is not optional here even though nothing in this change reads `person_id`: phase 1
TRUNCATEs `declaration`, so skipping it leaves every filing unresolved. Applying 089 to Cloud
SQL WITHOUT shipping the values changes nothing there while local is correct, with every row
count reconciling.

### On Cloud SQL, SHIP rather than reload — the reload route takes a measured outage

The `:cloud` twin of the two commands above works, and costs ~8 minutes of **500s** on
`/persons`, `/officials/assets`, `/mp-assets` and `/declarations/crypto`: phase 1 TRUNCATEs
`declaration` and NULLs every `person_id`, and phase 2 runs 090's `DROP MATERIALIZED VIEW
person_wealth_year CASCADE`, during which a DbDataTable resource has no `missingMigration`
degrade. CLAUDE.md says off-peak only, and it means it.

None of that is necessary for THIS change. The four columns are derived from immutable
filings, so their values are identical whichever database computes them — the same argument
`ship_filed_position.ts` is built on. `scripts/db/ship_held_abroad.ts` writes them into the
rows already there:

```bash
DATABASE_URL=… npx tsx scripts/db/apply_functions.ts 089_declarations.sql   # additive, no DROPs
npx tsx scripts/db/ship_held_abroad.ts --to postgres://postgres@127.0.0.1:5434/electionsbg
npx tsx scripts/db/ship_held_abroad.ts --to … --apply
```

**Done 2026-08-19 at 13:15 EEST — peak hours, deliberately, because it takes no outage.**
76,953 rows in **31 s**, RowExclusiveLock only, `person_id` and `filed_position` untouched,
all five matviews still populated, all four pages 200 throughout.

The key is `(source_url, seq)`, never `declaration_id` — that is a `bigserial` handed out in
insertion order, i.e. a property of how a database was loaded. And because `seq` alone is not
an identity, the payload carries `category` too and **any** disagreement refuses the whole
ship: the backfill only ever ADDS fields and skips a filing whose row set has moved, so the
two sides' numbering agrees by construction, and this check is what would catch it if that
stopped being true. It is the one thing standing between a mis-keyed write and publishing
„Белгия" against somebody else's bank account. Verified 76,953/76,953 on the real run.

Reload instead of shipping when the SHARDS have moved for some other reason — the shipper
only carries these four columns.

The backfill is positional-but-verified, like `backfill_asset_table_num.ts`: rows are
matched by index then checked on (category, description, valueEur), and a shard whose row
set a parser change has since moved is reported and left alone. **37 filings** were skipped
that way, holding **14 abroad rows** that stay unstamped.

## 5. Residue, stated rather than hidden

- **296 rows `unknown`** (€13.57m) — 346 blank pairs, ~130 double ticks, the split amounts,
  and a handful of keyboard slips. Counted, never guessed.
- **14 abroad rows in 37 skipped filings**, as above.
- **Cities and currencies are not read as countries.** „Банка ВТБ24, Москва" and „не
  (канадски долари)" resolve as abroad/domestic with no country. Москва is unambiguous and
  a city→country map would work, but the raws are stored and the named subset is already
  declared as a subset, so guessing buys little.
- **Institution names are not resolved to a country.** „Revolut" (Lithuania), „Amundi"
  (Luxembourg) and „Coinbase" are abroad with no country. Attributing them would be a claim
  about corporate domicile the filing does not make — „Bank of China" is the counter-example
  that settles it.

## 6. Gates

- `scripts/declarations/held_abroad.test.ts` — 17 unit tests over the rule.
- `scripts/db/tests/declaration_held_abroad.data.test.ts` — 8 PG tests: the pair exists on
  tables 5 and 8 and nowhere else, table 4 is NULL (stated separately, because that is the
  „заплата" defect), the vocabulary is closed, a country never attaches to a non-abroad row,
  the named subset stays a small minority, `unknown` stays a residue, and the worked Belgian
  account is distinguishable. It carries a **mutation check** — every stored value is
  re-derived from the stored RAW cells — so an assertion satisfied by two implementations
  that both got the rule wrong cannot pass; verified by reverting the lone-denial rule, which
  fails it on 9 distinct fillings. It skips with a DISTINCT reason when `held_scope` is
  entirely NULL, so „the corpus has no provenance yet" can never read as „the rule is
  enforced".

## 7. Not done

- **No serving surface reads these columns yet.** The natural one is a „къде се държат
  парите" block on `/person` and an aggregate on `/persons` or a declarations landing; both
  need copy that states the named-country caveat in §3.
- **`nzok`-style country normalisation for institutions** — see §5.
- **The `unknown` split rows could carry the split** rather than being refused, if a
  consumer ever needs per-row partial attribution. The raws make that a pure re-derivation.
