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
- **UI**: „Виж декларацията" `ExternalLink`; a filing-history list (year · ref · link)
  capped with a „виж всички" toggle, matching the top-N + see-all house rule this tile's
  `/judiciary` sibling already follows. Reuse `PersonDeclarations.tsx`'s citation-line
  *format*, not its component.
  ⚠️ **Do NOT render `registerDir` as „Годишна / За промяна"** — an earlier draft of this
  bullet said to, contradicting Finding 0b two sections above. It is the register's
  DIRECTORY, and the ИВСС files some annual declarations into the `-1` ("change") one.
  ⚠️ **When `filingsNameAmbiguous` is true the list must be headed „подадени под това име",
  never attributed to the person.** The register is indexed by name with no court or id
  beside it, so namesakes fold together: 956 of 3,594 rostered names (26.6%) carry more
  than one annual declaration in a single year, and 256 have two filed on the SAME DAY.
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

#### Validation result — 2026-08-24/25, n=60, seed 7

`scripts/judiciary/validate_declaration_parse.ts`, stratified across all 10 years and both
register directories.

⚠️ **The first run of this harness reported "100% agreement" and that number, recorded here,
was measuring the wrong thing.** It compared parsed row COUNTS against an independent count
from the raw text layer — good evidence about row *segmentation*, and none at all about
extraction, because no cell value was ever compared. A column SHIFT leaves every count
identical. Constructed against a header whose digits are printed CENTRED in their columns —
the ordinary way to typeset `1 | 2 | … | 12` — the reader put the acquisition year in „Цена
на сделката" and the location in „Вид на имота", and the harness scored it 100%. That is
precisely the Phase 6 failure the whole design is meant to prevent, and the evidence was
blind to it.

Two things came out of fixing that, and the second is the substantive finding:

**1. Column assignment is now alignment-independent.** When a row carries one run per column
the k-th run *is* column k, whatever the alignment; only sparse rows fall back to
nearest-header, and those are flagged `exact: false` so a consumer that publishes values can
require the unambiguous path. Pinned by a test that runs left-, centre- and right-aligned
headers through the same fixture.

**2. ⚠️ THE PRE-v3.0 FORM HAS THE SAME TWELVE COLUMNS IN A DIFFERENT ORDER.** With cell-shape
checks added, the harness immediately found 14 mis-shaped cells across 8 declarations —
„година на придобиване" holding the declarant's *name*, „цена на сделката" holding
„1997 Радослав Петров Маринов". Diffing an old filing against a new one:

```
old (≤2022):  … 7 година | 8 собственик | 9 идеална част | 10 цена …
v3.0 (2023+): … 7 цена   | 8 година     | 9 собственик   | 10 идеална част …
```

Twelve columns either way — so the column-COUNT guard passes and every value lands under the
wrong heading, with the row count unchanged. The discriminator is the form-version string
„v.3.0 / 22.11.2022 г." on page 1, absent from every older filing. `readTable` now refuses
anything that is not v3.0, because only the v3.0 map has been verified.

**The coverage that buys is a real cost, stated rather than buried:** 31,256 of 51,040
filings (**61%**) are pre-v3.0 and are now refused outright. Per *magistrate* it is much
softer — **4,703 of 5,579 (84%)** have at least one v3.0 filing — which is the number that
matters for a `/person` page. Mapping the older form is deliberate future work with its own
evidence, not a loosened guard.

⚠️ **THE REFUSAL RUNS IN BOTH DIRECTIONS, AND THE FORWARD ONE WAS MISSED UNTIL 2026-08-25.**
The guard accepts v3.0 and nothing else, so it refuses the ИВСС's NEW form as firmly as its
old ones — and the ИВСС began issuing **v4.0 during 2026**. Measured over the 9,124 filings
the crawl had loaded at the time: **every one of the 201 form-version refusals is v4.0, and
every one is from 2026** — 5.5% of that year's filings, against 100% v3.0 in 2024 and 2025 —
with **90 magistrates having their OWN record's filing refused** on this basis.

That is the opposite risk profile from the pre-v3.0 backlog, and worse. A legacy gap is
static and shrinks in relevance; this one **grows with every filing season** and lands on the
most current declarations — the ones a reader is most likely to want. Left alone it ends with
the register fully migrated and the parser reading none of it, while every gate stays green,
because refusing is the designed behaviour.

**[DONE 2026-08-25 — see „Mapping v4.0" below.** It turned out to be the euro changeover
rather than a new layout: same map, different money. The forward gap is closed and the
pre-v3.0 backlog is what remains.]**

Mapping v4.0 was therefore the highest-value parser work outstanding, ahead of the pre-v3.0
backlog. It needs the same treatment v3.0 got: a column-map verified against a sample, a
positional/nearest-header `exact` flag, and `validate_declaration_parse.ts` re-run per form
version rather than in aggregate — an aggregate pass rate hides a version that is 5% of the
corpus today and a majority next year.

Also corrected in the reader while establishing this: `isRefusal` was typed so narrowly that
every `readTable` call site was a `tsc` error — 22 green Vitest tests and a clean lint on top
of a broken `npm run build`, because Vitest never typechecks. And the period regex, anchored
on „31.12" over the flattened page, pulled a year across a row boundary out of a money
table's „към 31.12." header — inventing a covered period for exactly the entry/exit filings
that leave it blank by design.

**Status of the five items.** 1-3 have a verified mechanism on v3.0 forms. **Item 4 (Table 1
prices) is NOT cleared** — the claim that it was is withdrawn; row-count agreement never
supported it, and the shape checks that would support it are new. **Item 5 (money tables
10/11/13) is NOT cleared** and was never in this harness; its precondition is unchanged —
re-run Phase 6's own hand-checked magistrates (Kovachev, Shutova) plus Цацаров before any
stored money figure moves.

**Where it landed, same sample, after all of the above:**

| | result |
|---|---|
| declarations read | **60 / 60**, none unreadable |
| **Таблица 1** on v3.0 forms | **25 / 25 agree**, 0 disagree, **0 mis-shaped cells** |
| **Таблица 2** on v3.0 forms | **24 / 25 agree**, 1 disagree, 0 mis-shaped cells |

The single Table-2 disagreement reads 0 rows where the raw text has 1 — an **under**-read, so
it withholds a row rather than inventing one. That is the direction to fail in, and it is the
one case the sample leaves for a human.

| declined as pre-v3.0 | 35 of 60, by design |
| declaration kind | 44 annual · 14 unknown · 2 entry |
| covered period printed | 38 / 60 |

Two corpus properties worth carrying forward, neither of them a parser defect:

- **23% of declarations state no kind** (14 of 60 `unknown`) — older filings whose marker row
  the ИВСС does not print. `unknown` is the document's answer and must not be rounded to
  `annual`; doing so was a live defect in the first cut, which read „ежегодна" out of the
  form's own **footnote** and reported every filing, entry declarations included, as annual.
- **37% print no covered period** (22 of 60). Entry and exit filings are anchored to a date
  and leave it blank by design; plenty of annuals leave it blank too. So the period is
  available for under two thirds of filings and **the filing year may never be substituted
  for it** — which is why the tile still labels only what it can defend.

One property of the harness is worth keeping in view: `rawRowCount` is independent of the
header detection and the column map, but shares `toRows` and the ordinal predicate with the
reader. It is a strong check on segmentation and a *partial* one on geometry. The cell-shape
assertions, not the count, are what make it evidence about extraction.

And one thing it cannot be: the form's „Нямам нищо за деклариране" is **not** usable as a
third reading. It is the static label of a checkbox printed above every table, and the tick
is a graphic rather than text — Цацаров's 2026 filing prints it directly above four declared
properties. Used as evidence it manufactured five false alarms in this very sample.

**Do not unify into `declaration`/`declaration_asset` (tier `'magistrate'`) in this
tier.** The schema reserves it and `PersonDeclarations.tsx` already renders it, which
makes it tempting — but the FLOW/STOCK mismatch (Finding 0) and the 59-person arbitration
problem (Finding 3) are unsolved design questions, not wiring. Revisit only after Tier 2's
validation, with an explicit rule for which register wins a contested person-year and how
a flow-basis table is kept out of a stock-basis net worth.

### Tier 3 — the backfill (operator run, after Tier 2 lands)

**3a — measure the baseline coverage first. BUILT:**
`scripts/judiciary/measure_declaration_kinds.ts`.

Per Finding 0b, whether a holdings figure is publishable for a given magistrate turns on
whether a **stock snapshot** (entry or leaving declaration) exists inside the 2017+ window,
and the kind is readable only from the PDF — the register's index carries nothing that
distinguishes an entry filing from an annual, and its `batch` field is the directory, which
the ИВСС does not use consistently. So the script opens documents, but **page 2 only**, where
the form prints both the kind and the covered period.

It samples at the grain the question is actually asked at: `--magistrates N` picks N *people*
and reads **all** of their filings, because „does THIS person have a snapshot" is not
answerable from a share of filings. `--all` is the full-corpus operator run — 51,040 filings,
roughly 20 hours of polite fetching.

If the answer is a small minority, the estate model is a per-magistrate capability, not a
corpus-wide feature, and the UI must say which magistrates it can and cannot answer for.

#### Baseline-coverage result — 2026-08-25, 40 magistrates / 355 filings, seed 7

**It IS a small minority. ⭐ 4 of 40 sampled magistrates have a stock snapshot — a point
estimate of 10%, 95% CI [2.8%, 23.7%]**, i.e. somewhere between ~156 and ~1,322 of the 5,579.

| | |
|---|---|
| filings read | 355 / 355, none unreadable |
| kind, per filing | annual **63.9%** · unknown **34.6%** · entry **1.4%** |
| covered period printed | 217 / 355 (61.1%) |
| **magistrates with an entry or exit filing** | **4 / 40** — 10%, CI [2.8%, 23.7%] |

⚠️ **Quote the interval, not the 10%.** The design conclusion below holds across the *whole*
interval — even at the optimistic end, three magistrates in four have no baseline — which is
what makes a 40-magistrate sample adequate for the decision while being far too small for the
headline. Two biases also run in opposite directions and are not corrected for: the script
samples NAMES, and Tier 1 measured 7.3% of names as provably covering more than one human,
which biases the share **up**; while a filing whose kind is unreadable cannot be counted as a
snapshot, which biases it **down**. On that second point the 34.6% `unknown` is not a
"second, independent ceiling" as an earlier draft of this section called it — it is
measurement error *inside* the same number.

So for most magistrates the register holds acquisitions and disposals with **no opening
balance**, and no arithmetic over them yields an estate. That settles the design question
Finding 0b left open:

- **„What this magistrate owns" is not a corpus-wide feature and must never be presented as
  one.** Where it can be computed at all it is a per-person capability, and the surface has
  to say which people it can answer for — an estate figure shown for the 10% and silently
  absent for the rest reads as „this judge owns nothing".
- **The per-filing corpus is still worth building for everything else.** Acquisitions,
  disposals, the declared period and the property detail on `/person` are all per-filing facts
  that need no baseline. Only the *net estate* needs one.
- **34.6% of filings state no kind at all** — mostly older forms whose marker row the ИВСС
  does not print. For those the pipeline cannot tell whether it is looking at a snapshot, so
  they can only ever count against the share.

⚠️ Sample, not a census — 40 of 5,579 magistrates. The `--all` run settles it exactly, and is
the same crawl Tier 3b needs, so the two should be paid for once.

**3b — the full crawl: ALL 51,040 filings, every magistrate, every year, both batches.
BUILT: `scripts/judiciary/crawl_declarations.ts`.**

Target state is one parsed record per *filing*, not per magistrate — 51,040 records over
5,579 people, 2017–2026.

⚠️ **The existing 3,596-entry holdings cache does NOT carry over, and an earlier draft of this
line said it did** ("leaving ~47,400 to fetch"). That cache is keyed by NAME and holds one
parse per magistrate; this corpus is keyed by the register's pdf path and holds one per
filing. Nothing is shared, so the crawl fetches all 51,040. Measured live at **~3.8
filings/s** with CONC=4 — about **3.5 hours**, and it is resumable per filing, so an
interruption costs only the current checkpoint interval.

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

Sizing, now MEASURED rather than estimated: the per-filing cache runs **~529 B/record**, so
the full 51,040-filing corpus is **~27 MB**, not the ~100-200 MB an earlier draft of this
line guessed. (For scale, the existing per-magistrate `holdings_cache.json` is 1.6 MB.) That
is small enough that the shards-vs-PG question does not force itself — PG-only, loaded from
the gitignored cache `REFRESH_EXCLUSIONS`-style like the CR-deeds and dossier corpora, is the
straightforward choice rather than a size-driven one.

Sequencing note: only worth spending once Tier 2 can extract something per filing worth
storing. Before that, Tier 1 already gives every year a link **without fetching anything** —
which is why Tier 1 is not blocked on any of this.

### Finding 4 — the tile's headline count is wrong in BOTH directions

Found while verifying Tier 2 against local Postgres. The card reads „N имота в
декларацията" from `magistrate.real_estate_count`, produced by the ORIGINAL heuristic
extractor. Expanding the same filing now lists the properties the STRUCTURED reader found —
two numbers about one document, inches apart, disagreeing.

⚠️ **A first draft of this finding said the heuristic under-reports ~3× (319 against 1,009).
That figure is withdrawn.** It was measured over the records that HAVE parsed property rows,
which excludes by construction every record where the parser found nothing — i.e. it
conditioned on one of the two directions of disagreement. Over all records with a parsed
count it is not a one-directional undercount at all.

Measured over the 3,497 records the partial crawl has reached, no subsetting:

| | records |
|---|---|
| the two counts agree | **2,562 (73.3%)** |
| parser finds MORE | **528** — of which **450** the heuristic scored 0 |
| parser finds FEWER | **407** — of which **360** the parser scores 0 |
| properties, parser vs heuristic | **1,901 vs 1,653** |

**Which side is right was settled against the documents, not by preferring the newer code.**
Eight filings were re-fetched and their full text scanned for property nouns across every
page — the earlier two-page probe was itself too narrow and produced one false reading, which
is how the check earned its own correction:

- **Иво Веселинов Радев** — heuristic **0**, parser **20**. 13 pages, 24 property nouns,
  the parsed rows carrying coherent detail („предварителен договор за покупка на имот
  Апартамент в незавършен вид", Плевен, 62 m², 65,000 лв, 1/2). **Parser right.**
- **Димо Николов Николов** — heuristic **6**, parser **0**. 11 pages, **zero** property
  nouns, „Нямам нищо за деклариране" printed five times; he declares one car. **Parser
  right.** Its control number `95991190` is stamped on every page and clears the heuristic's
  „a cell over 2,000" test, which is the likeliest source of the fabricated 6.
- **Four more** at heuristic 6 / parser 0 — all zero property nouns. **Parser right.**

So the heuristic both **invents** property against magistrates who declared none and
**misses** it wholesale where it exists, and its errors are not a bias that could be
corrected by scaling. The structured reader wins wherever it has an answer.

**Shipped as a SECOND column, `magistrate.real_estate_count_parsed`, not as a correction of
the first.** Overwriting would leave `real_estate_count` a mix of two counting methods, which
the `/judiciary` aggregate then sums into one plausible, unfalsifiable integer. Two columns
keep the basis visible.

**And the heuristic is NOT a fallback — decided 2026-08-25, after one commit that made it
one.** Where the structured reader has no answer the card shows no count at all. The
reasoning: a fallback is only honest when the fallback value is a rougher version of the same
quantity, and this one is not — it fabricates. 3,497 of the 3,594 roster records already
carried a read answer when this shipped, so withholding affected exactly **40 records**, and
every magistrate's own filing is 2024-or-later, which means the pre-v3.0 backlog never
reaches this figure at all; the residual NULLs are the v4.0 refusals.

⚠️ **The operational consequence, stated rather than discovered later:** `magistrate` is
TRUNCATEd and reloaded by `db:load:magistrates:pg`, which does not fill this column, and the
asset loader that does is a `REFRESH_EXCLUSIONS` member. So a magistrates reload makes the
count vanish from every card until `db:load:magistrate-filing-assets:pg` runs again. That is
the intended direction — visibly absent beats quietly wrong — but it means the two loaders
travel together on both sides, and the cloud publish order is magistrates → assets → deploy.

⚠️ **NULL is not zero, and the loader must not derive it from `table1_refused`.** That column
is NULL both for a filing read without refusal AND for one the crawl has never reached — the
loader only ever writes meta for filings it parsed — so keying on it writes `0`, i.e. „this
judge declared no property", against unread documents. The derivation is driven from the
run's own parsed set instead.

**What this says about the tile's OTHER figures is not yet established, and is the reason
item 5 stays uncleared.** `bankCashLv` and `securitiesLv` come from the same heuristic
extractor, are published on the same card, and have had no equivalent adjudication. That the
property count fails in both directions is evidence about the extractor, not only about one
of its fields.

### The backfill, as it actually landed (2026-08-25)

The crawl ran to completion: **51,005 of 51,040 filings cached in 202.8 minutes** at ~4.2/s,
concurrency 4. **35 failures, every one an HTTP 404** — files the register's own index lists
but does not serve, clustered in 2017-2019 (the acceleration in the failure rate around
filing 37,000 is the crawl reaching those years, not the register degrading; a mid-run probe
returned a known PDF at 200 in 1.6 s).

| | |
|---|---|
| filings parsed into Postgres | **36,995** of the 37,023 the roster publishes |
| property rows stored | **11,584** — 9,398 acquisitions, 2,186 disposals |
| positionally exact (may show a price) | **10,489 (90.5%)** |
| magistrates with at least one property row | **2,488** |
| magistrates with ≥1 readable filing | **3,593 of 3,594** |
| Таблица 1 refusals | 21,589 |

**The form-version split, now measured rather than estimated.** The Tier-2 note put the
pre-v3.0 share at 61% from a stratified sample; the full corpus gives the breakdown:

| version | filings | |
|---|---|---|
| **3.0** | 15,409 | supported |
| 2.2 / 2.1 / 2.0 | 18,021 | backlog — different column order, deliberately unmapped |
| none detected | 3,364 | backlog |
| **4.0** | **201** | **forward gap — 5.5% of 2026, growing** |

⚠️ **A gate written against the COMBINED refusal share is worthless, and the first cut of one
was.** It bounded total refusals at 25% and fired at 58.3% the moment the full corpus landed —
on a corpus with no forward problem at all, because the static backlog dominates the ratio. It
now bounds the NEWEST season's share of filings on a version *newer* than supported: 5.5%
today, 100% under a simulated completed migration, so it discriminates in the direction that
matters and is silent about the one that does not.

**Nothing about the headline counts moved.** Still 3,497 records with a read answer, 1,901
properties against the heuristic's 1,653, 935 disagreeing — because every roster record's own
filing is 2024-or-later, so the whole pre-v3.0 backlog is invisible to that figure. Predicted
before the reload and confirmed after.

### Mapping v4.0 — it is the euro changeover, not a new layout (2026-08-25)

The forward-compat gap is closed, and what it actually was is worth stating plainly, because
the obvious reading was wrong.

**v4.0 is v3.0 re-denominated.** Verified before anything was admitted, across 6 v4.0 and 2
v3.0 filings: the header declares the same **12 columns at the same x-positions** (39, 88,
163, 231, 282, 327, 374, 421, 519, 618, 686, 767) in the same order. The sole difference in
the entire table is the price column's unit — „Цена на сделката **/лева/**" becomes
„…**/евро/**". Таблица 2 moves with it. The ИВСС reissued the form for Bulgaria's 2026-01-01
euro adoption; nothing about the layout changed.

So the fix is NOT "allow another version". Sharing the map is the easy half; the load-bearing
half is that **column 7 now means different money on different documents**.

⚠️ **THE UNIT IS READ FROM THE DOCUMENT, NEVER INFERRED — and the trap is the YEAR, not the
version.** 2026 carries BOTH forms: **3,483 filings still on v3.0 in лева beside 201 on v4.0
in евро**. A year rule would restate 3,483 filings' prices at 1.95583× against named judges. A
version rule is right today and one reissue from being wrong. `priceCurrency()` reads the
label, `readTable` **refuses a mapped document that states no unit at all** — a price stored
under a guessed unit is worse than no price, being off by a factor of two in a figure that
looks entirely ordinary — and `magistrate_filing_asset.price_currency` carries it per row.
Nothing is converted at ingest or at render: the number shown must be the number printed on
the document the row links to.

**What it bought**, measured on the reload:

| | before | after |
|---|---|---|
| magistrates with a read property count | 3,497 | **3,587** (+90) |
| property rows | 11,584 | **11,862** (+278) |
| Таблица 1 refusals | 21,589 | **21,388** (−201) |

The +90 is exactly the population sized when the gap was found — every magistrate whose own
record's filing was v4.0.

**Re-reading cost 52 seconds, not 3.5 hours.** `crawl_declarations.ts --reparse 4.0` re-fetches
only the filings a previous run refused at that version (the cached refusal names it, so the
set needs neither network nor database to compute). A second selector,
`--backfill-currency`, re-fetches every filing that HAS rows but no recorded unit —
**19,773 filings**, ~80 minutes. That one is deliberately not a version rule: stamping „v3.0
means лева" onto 11,584 stored prices is the exact shortcut the refusal exists to prevent.

⚠️ **Three different populations appear in this section and they are NOT the same set** — an
earlier draft quoted them as if they were:

| figure | population |
|---|---|
| **15,409** v3.0 filings | of the **36,995** loaded into Postgres, i.e. names the published roster carries |
| **19,773** to re-fetch | of the **51,005** in the CACHE, which spans every name in the register index |
| **11,862** property rows | rows, not filings — several per filing, roster-scoped |

The cache is wider than the roster by design (14,010 crawled filings belong to names the
roster does not carry), so a cache-scoped count will always exceed a Postgres-scoped one.
Quoting one as the other overstates coverage.

⚠️ **A defect this surfaced in the Tier-2 renderer, unrelated to currency.** The heading was
binary — snapshot for entry/exit, „Придобито през периода" for everything else — which rounds
`unknown` to `annual`, the one thing 185's header says must never happen. Дияна Пенчовска's
filing is `unknown` and lists five properties acquired **1991-2021**; headed „Придобито през
периода" it states she acquired a 1991 apartment during 2025. **330 filings carry a table-1
span of more than five years.** The heading is now three-way, and an unknown kind asserts
neither meaning.

⚠️⚠️ **A THIRD DENOMINATION EXISTS AND IS NOT RESOLVED.** Found in review of this change,
not by it. Bulgaria redenominated the lev on **1999-07-05 at 1000:1**, and the register lists
property acquired long before that under a header saying only „лева". Measured on the full
corpus: **42 positionally-exact rows are pre-1999 acquisitions priced at ≥100,000, 13 of them
above a million** — an apartment bought in 1997 for „241 872", another in 1996 for „450 600".
They render today as modern leva.

It is left unresolved on purpose. The unit is **unknowable per row**: the header says „лева"
either way, and declarants split between writing the historical figure and restating it. The
acquisition year is not evidence, because both kinds of declarant produce the same row. So
`price_currency` admits only BGN and EUR — a `BGL` slot could only ever be filled by a guess,
and a guessed 1000× is worse than a visible oddity.

**The rule that follows:** rendering one row as the document wrote it is honest; SUMMING
these is not. Any future surface that aggregates declared prices — a total, an average, a
ranking — must exclude or flag pre-1999 acquisitions first.

### Mapping the pre-v3.0 form (2026-08-25) — one layout, not four

The backlog is closed. It is **one** legacy layout, not four: v2.0, v2.1, v2.2 and the
unversioned 2017-2020 form all order Таблица 1 the same way, and it is the order the Tier-2
note predicted.

| | modern (v3.0/v4.0) | legacy (v2.x + unversioned) |
|---|---|---|
| Таблица 1 | 7 цена · 8 година · 9 собственик · 10 идеална | 7 година · 8 собственик · 9 идеална · **10 цена** |
| Таблица 2 | 7 цена · 8 собственик · 9 идеална | 7 собственик · 8 идеална · **9 цена** |

⚠️ **THE MAP IS NOT THE SAFETY — THE PROOF IS.** A version-keyed map is still an assumption
drawn from one sample per bucket, and its failure mode is a SHIFTED row, which no row count
can see. So `readTable` now verifies the era against each document's **own header labels**
before reading a value, checking the two columns whose confusion is worst — the money and the
year. Measured against real PDFs, every document accepts only its own era and refuses the
other, in both directions. Over the full re-parse of **31,224 legacy filings there were ZERO
`column-role` refusals**, so the layout derived from four samples was confirmed by 31,224
documents.

An **unversioned** document is held to a stricter rule: its era rests on no revision string,
so the labels must positively confirm it. One laid out the modern way is refused rather than
read as legacy.

**Result** — the corpus roughly doubled:

| | before | after |
|---|---|---|
| filings with a readable Таблица 1 | 13,135 | **32,648** |
| property rows | 11,862 | **26,142** |
| Таблица 1 refusals | 21,388 | **53** |

Headline per-magistrate counts did **not** move (3,587), and that is correct: every roster
record's own filing is 2024-or-later, so the legacy corpus is entirely historical. What it
adds is depth — a magistrate's earlier filings, not their current figure.

⚠️ **A 24% loss hid behind the word „empty", and it was NOT a legacy defect.** After the
re-parse the loader reported 5,384 „empty rows dropped" against 109 before. They were not
empty: 8,254 rows carried real property whose KIND had merged into the ordinal cell —
„1. апартамент с прилежащи 1.734 % ид.ч." — because on a row whose run count does not match
the header, each run is placed by nearest edge, and the header digits are printed CENTRED.
The same defect affects 1,196 MODERN rows and predates this work; the legacy corpus merely
made it six times bigger.

Un-merging is safe **specifically** for column 1, whose only neighbour is column 2, so
whatever follows the ordinal there can only be the kind. It recovers **8,251 of 8,254**; the
remaining 3 are reported. The rest of such a row is left as parsed and its price stays
withheld by the `exact` flag, which is the right treatment for a row whose columns merged.

⚠️ **A cold-database test destroyed three live functions, and the technique is the lesson.**
To prove 070/185 apply to a virgin schema I ran them with
`PGOPTIONS="--search_path=vp2,public"`. 070 contains three UNQUALIFIED drops
(`DROP FUNCTION IF EXISTS magistrate_by_name(text)` and two more); an unqualified DROP
resolves through the search path, found nothing in `vp2`, and dropped the **public** ones —
then created the replacements in `vp2`. `/person` pages lost the whole ИВСС card while every
row of data stayed intact. **A search-path sandbox is not a sandbox for a file containing
unqualified DROPs; use a separate DATABASE.** Local only; production was never on that path.

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
