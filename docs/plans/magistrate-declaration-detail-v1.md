# Magistrate declaration detail — v1 plan

Trigger: reviewing `/person/sotir-tsatsarov-qrrjem` against
[BIRD's 2026-07-20 piece](https://bird.bg/cacarov-vila-balchik/) on Цацаров's declared
real estate — our card shows no per-property detail, no link to the ИВСС register, and
no filing history. Extends Phase 6 of [judiciary-vss-v1.md](judiciary-vss-v1.md).

**Everything below is measured, not assumed** — against the live register, the local
corpus and Postgres, 2026-08-22. Three of the measurements overturn what the earlier
plan (and Phase 6's "Not yet built" list) assumed.

---

## Finding 0 — the current card states something false

The ИВСС **annual** declaration mixes two bases in one form, and our tile renders one
row from each as if they were the same kind of fact:

| table | basis | evidence |
|---|---|---|
| Таблица 1 (недвижимо имущество) | **FLOW** — property *acquired during the declared year* | Цацаров's 2024 filing (covering 2023) reads „Нямам нищо за деклариране" while he demonstrably owned the 620,088 лв apartment bought in 2022. A stock would have re-listed it. Every row in all three sampled filings carries `Година на придобиване` = the declared year. |
| Таблици 10/11/13 (парични средства / банкови сметки / задължения) | **STOCK** — balance at 31.12 | BIRD reads „към 31.12.2024 г. … 28,936 лв. спестявания" off the prior filing; the mortgage in the 2025 filing is the outstanding balance. |

So „**4 недвижими имота**" on `PersonMagistrateHoldingsTile` is a count of properties
*bought in 2025*, presented — beside a cash balance — as a holdings count. Цацаров owns
considerably more than four properties. This is a wrong claim about a named judge, which
is the failure class the whole magistrate pipeline was written to avoid, and it is
**live today**. It should be fixed regardless of which tier below is built: the minimum
fix is a label change („придобити през 2025 г."), which costs nothing and needs no new data.

## Finding 0b — a sold property, and the accounting model that actually works

The form records disposals: **Таблица № 2 „Прехвърляне на имоти през предходната
година"**. Our pipeline never reads it — `extractFinancials` uses the string
„Прехвърляне на имоти" only as a *boundary marker* to stop counting Table 1, then throws
the table away. So the question doesn't arise today (we show one year), but it becomes
the central correctness problem the moment we backfill.

A naive union of Table 1 across years **would** keep sold property. Цацаров's Table 2
rows, parsed:

```
2023 annual (2022): 10 disposals — incl. вила „Св. Константин", Пещера, 1/2, брачен договор
                                   and апартамент Пловдив 56 м², 1/1, продажба, 123,218 лв
2025 filing (2024):  1 disposal  — апартамент с гараж, гр. София, 83 м², 1/1, продажба, 303,154 лв
2026 annual (2025):  none
```

So a union-of-Table-1 would credit him a villa and a 303,154 лв apartment he no longer
owns — both of which BIRD names as disposed.

**Netting works, and there is a proper baseline.** The form's column 1 is „към датата на
встъпване в длъжност" — and an **entry declaration's Table 1 is a full STOCK snapshot**,
not a flow. Цацаров's off-cycle July 2022 filing (акт за встъпване, on returning to ВКП)
lists **11 properties with acquisition years 2003–2018**. That resolves the matching
problem cleanly:

| entry snapshot (2022) | later disposal | match |
|---|---|---|
| апартамент с гараж, София, 83 м², **1/1, since 2010**, 83,000 лв | sold 2024, 83 м², 1/1, 303,154 лв | exact |
| вила, Св. Константин, Пещера, 75/140 м², since 2018 | 2022, брачен договор, 1/2 | exact |
| апартамент, Пловдив, 56 м², since 2007 | 2022, продажба, 123,218 лв | exact |

So the honest model is:

> **estate = entry/leaving stock snapshot + Σ annual Table-1 acquisitions − Σ Table-2 disposals**

matched on (вид, местонахождение, община, площ, разгъната площ, идеална част).

⚠️ **It only holds when a stock snapshot exists inside the window.** The register starts
2017; a magistrate who took office earlier has their entry declaration outside it (or under
the previous regime). Without a baseline, a Table-2 disposal can have **no antecedent** —
Цацаров's орchards (bought, per BIRD, while he ran the Plovdiv court, long pre-2017) appear
only as a disposal — and the subtraction goes negative. **How many magistrates have a
baseline is not knowable without the crawl**: the declaration type is stamped in the PDF
(„Е Ж Е Г О Д Н А" / акт за встъпване), not in the index. That number is the gate on whether
a holdings figure is publishable for anyone beyond a lucky subset, and it should be measured
first (Tier 3a below).

**Two more live labelling defects surfaced here**, both in the tile's one caption sentence:

- **The register's `batch` is not the declaration type.** Цацаров's filing from the `2025-1`
  („change") directory is stamped **ЕЖЕГОДНА** and covers 01.01–31.12.2024. The Tier-1 draft
  proposed labelling filings „Годишна / За промяна" from `batch`; that would mislabel it.
  Read the type from the PDF, or say nothing.
- **`decl_year` is the filing year, not the period covered.** The tile says „декларацията …
  за 2026 г." while the numbers describe **2025** (the form states its period explicitly:
  „01.01 – 31.12 2025"). Off by one, on every magistrate.

## Finding 1 — older declarations: feasible, and *necessary*

Yes — the corpus is reachable and the cost is bounded. But note the correction to the
earlier draft of this file: a union of every year does **not** yield holdings. Per Finding
0b it yields an *event stream*; holdings additionally require a stock baseline and the
disposal table. The backfill is necessary for either, and sufficient for neither on its own.

Measured against `raw_data/judiciary/declarations_index.json` (already committed-adjacent,
regenerated by the watched `ivss_declarations` source) and the live register:

| | |
|---|---|
| filings in the index | **51,040** (2017–2026, annual + „change" under чл. 175в ал. 5) |
| distinct magistrates | **5,579** — median **10** filings each, mean 9.1, max 72 |
| already parsed | **3,596** (latest annual only — the entire current corpus) |
| register reachable | yes — `HTTP 200`, index in 1.0 s |
| per PDF | **775 KB**, **1.4 s** fetch, **0.67 s** parse (11 pages) |
| backfill cost | ~47,400 PDFs → **~28 h serial, ~7 h at CONC=4** (the index crawler already uses CONC=4) |
| bytes | ~37 GB downloaded, **0 stored** — the harvester already streams fetch→parse→discard |

So it is one long operator-run crawl, the same shape as `tr:cr-deeds` and the ЦАИС
dossier ingest (~26 h) that CLAUDE.md already treats as operator actions rather than
pipeline steps. It is resumable through the existing `holdings_cache.json` (which would
need re-keying from `name` to `(name, sourceUrl)`).

„Change" filings are **~40% of the corpus** and carry real signal, not noise — the
early-mortgage-repayment filing BIRD cites („за което дори има подадена отделна
декларация") is one of them.

## Finding 2 — the Tier-2 spike is answered, and the answer is mixed

I ran the AcroForm probe the previous draft called for:

- **Not a named-field form.** `getFieldObjects()` returns `null` — the ИВСС publishes a
  *flattened print* of a fillable form. There is no field-name shortcut; positional
  parsing is the only option. That half of the old plan's hope is dead.
- **But the text layer is far better than Phase 6 implies.** Every table carries a
  **numbered column-header row** immediately above its data (`1 | 2 | 3 | … | 12`), and
  every data row is ordinal-prefixed (`1.`, `2.`, …). That is a *per-declaration column
  map anchor* — precisely the "per-declaration structure detection" Phase 6 said would
  be required if this were ever revived. It exists, in every declaration, for free.

Цацаров's 2026 Table 1, parsed with the repo's own row-bucketing technique:

```
1. | апартамент със склад - груб строеж | гр. София | София-град | 110 | 110 | 178665 | 2025 | Сотир Стефанов Цацаров | 1/1 | покупко-продажба | продажба имот, наеми
2. | гараж - груб строеж              | гр. София | София-град |  24 |  24 |  19950 | 2025 | …
3. | гараж - груб строеж              | гр. София | София-град |  23 |  23 |  19550 | 2025 | …
4. | вила                             | Балчик…   | Балчик     |  68 | 141 | 234700 | 2025 | …
```

Against BIRD: вила Балчик **141 кв.м., 234,700 лв** — exact. Sum of the 2025
acquisitions **452,865 лв** against BIRD's „над 453 хиляди лева" — exact. The money
tables reconcile too (4,500 + 8,858 + 4,910 = **18,268 лв**, matching the stored
`bank_cash_lv` exactly; the mortgage 187,760 лв = **96,000 EUR**, matching BIRD).

**This does not overturn Phase 6's caution, and must not be read as doing so.** One
declaration is not a validation set, and Phase 6's failures (a 24% cash undercount on
Kovachev, a false-positive figure on Shutova) were *variance across* declarations —
filings that leave the „равностойност" column blank, or carry stray cells. What has
changed is the *mechanism available*: the old parser read by heuristic (find a currency
token, take the number before or after it), which is exactly what that variance defeats.
Anchoring on the numbered header row instead makes the column map per-declaration and,
critically, makes it **self-checking** — a table whose header row is missing or whose
column count is unexpected can be *refused* rather than silently mis-read. Phase 6's
central complaint, "no reconciliation ground-truth, so good and bad extractions can't be
told apart", gets a partial answer for the first time.

## Finding 3 — the MP→magistrate case is real, live, and already visible

Both pipelines resolve to **one** `person_id` — the person layer does its job. But the
page then renders **two disconnected blocks** with different UIs and different semantics.

Measured:

- **339** people hold a magistrate role *and* another role (`tr` 188, `ngo` 93,
  `official_exec` 49, `candidate` 34, `local` 16, `official_muni` 4, **`mp` 2**).
- **59** of them have both ИВСС magistrate data *and* Court-of-Audit `declaration` rows
  — **178 filings** across tiers `exec`, `mp`, `muni`.

The concrete instance of the question asked: **Дани Стефанова Каназирева**
(`/person/mp-3631`) — областен управител Пловдив (2020) → **MP** (47-мо НС, 2021–22) →
**magistrate at Административен съд Пловдив**, filing with ИВСС in 2026. Her page today
renders:

| block | source | shows |
|---|---|---|
| `PersonDeclarations` | Сметна палата | 8 filings, 2020–2022, source links, per-asset expand, net worth (2019 €72,783 / 2021 €92,561) |
| `PersonMagistrateHoldingsTile` | ИВСС | one line, 2026, €24,797 cash, no link, no history |

A reader gets no signal that these are one continuous career across two registers, in
chronological order. (Десислава Ахладова, `mp-3180` — Minister of Justice, MP, magistrate
— is the second MP case.)

**No double-counting today**, and the reason is worth recording: `declaration` holds
**0 rows** at `tier='magistrate'`, so ИВСС money never reaches `person_wealth_year`. The
58 magistrate-role people who *do* have a net worth get it entirely from their exec/mp/muni
filings. ⚠️ **This is the risk Tier 2b would introduce**: 090 picks ONE declaration per
`(person, period_year)`, so loading magistrate filings would not double-count — it would
create a *silent arbitration* between two registers covering the same person-year, with
no rule saying which is authoritative. And because the ИВСС real-estate table is a FLOW,
its rows are **not commensurable** with the cacbg estate at all. Any unification must
carry that distinction or it will publish a wrong net worth for exactly these 59 people.

One smaller note: the tile is mounted on a `person_id` gate
(`p.roles.some(r => r.source === 'magistrate')`) but then does its **own `normName`
lookup** — a second, weaker key on a page where everything else is `person_id`. It costs
nothing today (measured: **0 of 3,594** magistrate-role people fail the lookup, and all
3,594 `name_norm` values are unique), but it is a latent namesake surface of the kind
this codebase otherwise refuses. Cheap to remove while touching the serving function.

---

## The plan

### Tier 0 — fix the false label (do first, independent of everything else)

Relabel the tile's real-estate figure to „N имота, придобити през <year> г." and the
money figures to „към 31.12.<year>". Pure copy change in
[`PersonMagistrateHoldingsTile.tsx`](../../src/screens/components/procurement/PersonMagistrateHoldingsTile.tsx),
no data movement. Removes a live wrong claim.

### Tier 1 — source link + filing history (no new parsing, no re-crawl)

Everything needed is already in `declarations_index.json`; the writer reads it and throws
`pdf`/`ref` away. Ships the source link and the full 2017–2026 history *without* parsing
a single extra PDF.

- **Writer** (`__write_magistrate_holdings.ts`): emit per magistrate every filing found
  in the index — `{year, batch, ref, sourceUrl}`, newest first, `sourceUrl` fully
  qualified — plus `sourceUrl` on the parsed record. Warn (not throw) if a previously
  emitted magistrate's filing count shrinks.
- **Schema** (070): `magistrate.source_url` (with the warm-DB reconcile block this file
  already uses for `decl_year`); new `magistrate_filing` child table keyed like
  `magistrate_company`; `magistrate_filings_json(name)`; widen `magistrate_by_name()`.
  While there: take `magistrate_by_name` a `person_id`/ref rather than a name, per the
  namesake note above.
- **Loader** (`load_magistrates_pg.ts`): COPY both, same pattern as `magistrate_company`.
- **UI**: „Виж декларацията" `ExternalLink`; a filing-history list (year · Годишна/За
  промяна · ref · link) capped with a „виж всички" toggle, matching the top-N + see-all
  house rule this tile's `/judiciary` sibling already follows. Reuse
  `PersonDeclarations.tsx`'s citation-line *format*, not its component.
- **Gate**: `scripts/db/tests/magistrate_filings.data.test.ts` — every magistrate has a
  non-null `source_url`; filings newest-first; no duplicate `(name, source_url)`; sample
  count matches the raw index (Цацаров = **14**).

⚠️ The register is **plain HTTP on a bare IP** with the trust-boundary warning in
[`sources.ts`](../../scripts/judiciary/sources.ts): we would now be publishing outbound
links built from it. Links only ever point at the register itself, never at anything the
register names — keep it that way, and keep the ingest off untrusted networks.

### Tier 2 — per-asset detail (needs a validation pass first)

Rewrite the harvester's table reader to anchor on the numbered header row (Finding 2),
producing a per-declaration column map, and **refuse** any table whose header is missing
or whose column count is unexpected — so an unparseable filing is reported, never guessed.

Sequenced by descending confidence, and **nothing ships without a hand-checked sample**:

1. **Table 1 (real estate) descriptions** — вид, местонахождение, община, площ, година,
   идеална част, правно основание. Highest confidence: single unambiguous
   „Цена на сделката /лева/" column, verified exact against an independent source (BIRD).
2. **Table 2 (disposals)** — same shape, same confidence, and per Finding 0b it stops being
   optional the moment more than one year is shown. Parse it as its own event kind; never
   fold it into Table 1.
3. **The declaration's own type and period** („ЕЖЕГОДНА" / акт за встъпване; „01.01–31.12
   YYYY"), both on page 2 of every filing. Cheap, and it fixes both labelling defects in
   Finding 0b — so it should ride the first parser change regardless of what else lands.
4. **Table 1 prices**, only if (1)'s validation holds.
5. **Money tables (10/11/13)** — reconciled clean on this sample, but these are exactly
   where Phase 6's two documented failures were. Re-run the *same* magistrates Phase 6
   hand-checked (Kovachev, Shutova) plus Цацаров before touching the stored figures.

**Validation set, not a spot check**: sample ≥30 declarations spanning years and both
batches, compare row-by-row against the PDFs, and record the result in this file. Phase 6's
verdict — *"a wrong 'declared wealth' on a NAMED judge is a serious integrity/liability
risk"* — still governs. The bar to clear is not "it parsed", it is "we can tell when it
didn't".

**Do not unify into `declaration`/`declaration_asset` (tier `'magistrate'`) in this
tier.** The schema reserves it and `PersonDeclarations.tsx` already renders it, which
makes it tempting — but the FLOW/STOCK mismatch (Finding 0) and the 59-person arbitration
problem (Finding 3) are unsolved design questions, not wiring. Revisit only after Tier 2's
validation, with an explicit rule for which register wins a contested person-year and how
a flow-basis table is kept out of a stock-basis net worth.

### Tier 3 — the backfill (operator run, after Tier 2 lands)

**3a — measure the baseline coverage first.** Per Finding 0b, whether a holdings figure is
publishable for a given magistrate turns on whether a **stock snapshot** (entry or leaving
declaration) exists inside the 2017+ window, and the type is only readable from the PDF. A
cheap stratified pass — page 2 only, type marker + period line, ~0.7 s per filing — answers
"for how many of the 5,579 do we have a baseline?" before committing to the full crawl. If
the answer is a small minority, the estate model is a per-magistrate capability, not a
corpus-wide feature, and the UI must say which magistrates it can and cannot answer for.

**3b — the full crawl: ALL 51,040 filings, every magistrate, every year, both batches.**
Target state is one parsed record per *filing*, not per magistrate — 51,040 records over
5,579 people, 2017–2026 — of which 3,596 are already cached, leaving **~47,400 to fetch**
(~7 h at CONC=4).

⚠️ **This is not "run the existing crawler longer".** Four structures in the current
pipeline forbid it, and all four have to be lifted first — they are the actual work of
this tier, the crawl itself is just wall-clock:

1. **The current-bench fetch guard** —
   [`__write_magistrate_holdings.ts:434`](../../scripts/judiciary/__write_magistrate_holdings.ts)
   `if (year !== latestYear) continue;`. Departed magistrates are never fetched; the
   comment there calls the rest "a deliberate, separate backfill". This tier is that
   backfill.
2. **`batch === "annual"`** (line 373) — the roster is built from annual filings only, so
   **all 19,422 change filings are excluded from the pipeline entirely**. They are ~38% of
   the corpus and carry real signal: Цацаров's 303,154 лв disposal is in one, and per
   Finding 0b the register's batch label does not even reliably mean "change".
3. **Per-magistrate keying, top to bottom** — `cache[name]`, one record per magistrate in
   the emitted JSON, and `magistrate.name text PRIMARY KEY` in
   [070](../../scripts/db/schema/pg/070_magistrates.sql). A per-filing corpus needs the
   grain to change at all three layers. Tier 1's `magistrate_filing` table is the natural
   home, extended from metadata to extracted content.
4. **The shrink guard** compares committed roster *names*; at per-filing grain it has to
   compare filings, or it silently stops protecting anything.

**A coverage hole this also closes:** because of (2), **251 magistrates have only change
filings and are invisible to the entire pipeline today** — no `magistrate` row, so nothing
from this source reaches their `/person` page at all. That is a fifth of a percent of the
register getting no ИВСС surface, for a reason that is purely an artifact of how the roster
is built.

Sizing to settle when scoping: per-filing extracted rows are ~2–4 KB, so the corpus is
~100–200 MB — too large for the current single committed JSON. Either per-magistrate
shards or PG-only (loaded from the gitignored cache, `REFRESH_EXCLUSIONS`-style, as the
CR-deeds and dossier corpora already are).

Sequencing note: only worth spending once Tier 2 can extract something per filing worth
storing. Before that, Tier 1 already gives every year a link **without fetching anything** —
which is why Tier 1 is not blocked on any of this.

### Tier 4 — one career, one timeline

Once magistrates have filings with dates, interleave the two registers chronologically on
`/person` — one list, each row labelled with its register — instead of two blocks that
never reference each other. Directly answers the MP→magistrate case. Needs Tier 1 only for
the ИВСС half's dates and links; does **not** require unifying the underlying schemas, and
is the cheapest honest answer to Finding 3.

---

## Non-goals

- No on-demand PDF parsing from a Cloud Function — parsing stays offline/batch, never
  fetching the untrusted bare-IP register from a request handler.
- No cross-magistrate wealth ranking (ruled out in judiciary-vss-v1.md, unaffected here).
- No magistrate figures entering `person_wealth_year` until the flow/stock and
  register-arbitration questions above have answers.

## Rollout

```bash
npm run db:load:magistrates:pg          # local: applies 070's reconcile, reloads
npm run test:unit                       # + magistrate_filings.data.test.ts
npm run db:load:magistrates:pg:cloud    # schema + data → Cloud SQL
npm run deploy                          # the UI
```

No `deploy:db` needed for Tier 0/1 and no ordering hazard: `magistrate-by-name` in
[`db_routes.js`](../../functions/db_routes.js) already returns
`SELECT magistrate_by_name($1)` verbatim, so widening the function's jsonb needs no route
change — and the new fields are additive, with the tile already guarding on a null
`holding`. (Changing the function's *signature* for the `person_id` re-key does need a
`deploy:db`, ordered loader → `deploy:db` → `deploy`.)
