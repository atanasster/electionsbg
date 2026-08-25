# НЗОК hospital-payment parser hardening — v1

**Status:** **IMPLEMENTED 2026-08-25 — Tiers 0, 1, 2 and 3, eleven commits.** Written
2026-08-24 after the 2026-08-22 `/process-watch-report` run surfaced the loader's
standing `Skipped 25 months (parser hardening TODO)` banner.

Where it landed: **0 of 127 files rejected** (from 24), per-block money drift
against НЗОК's own subtotals **€0** (from €21,170,591), and the €1,672,123 of
wrong money in 11 already-loaded months corrected. The investigation below (§1-§4)
is left at its original figures as the record of what was found; each tier's own
section carries a SHIPPED note where what shipped differs from what was planned.

⚠️ **Nothing is loaded or deployed.** All of it is verified against the cached
PDFs; `db:load:nzok-hospital:pg` has not been run, so the served table is still on
the old vintage. The publish path is §8, and the first load will report the
restatement (§9-2) and add ~4,000 rows.

⚠️ **Tier 0 is NOT built** — the coverage table and the `periodByStream` tile
footnote. The fields it needs now exist and are carried through the loader, so it
is wiring rather than design; but until it lands, everything Tiers 1-3 made
visible is visible to the OPERATOR only, and the devices stream being five months
stale stays invisible to a reader.

**Scope:** `scripts/nzok/parse_hospital_payments.ts` (the parser),
`scripts/db/load_nzok_hospital_pg.ts` (the loader), and the `nzok_hospital_payments`
corpus behind the НЗОК pack on `/awarder/121858220`, the reimbursement tile on
`/company/:eik` and the hospital map (075).

**One-line finding:** the 25 skips are 24 files with **four** distinct root causes,
of which **13 are a single hospital's row in a single stream** — but the more
serious defect is the one the skips hide: **11 months that DO load carry
€1,672,123 of provably wrong money**, including a **sign inversion** that publishes
a named Sofia clinic as having _received_ €5,205 when НЗОК's own report says it was
clawed back, and a facility stored at **€47 against a true €522,872**. Widening the
tolerances would ship all of that and more.

---

## 0. TL;DR for a reader in a hurry

|                                                                   |                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Skipped (stream, period) pairs                                    | **24 distinct** (25 log lines — one link is duplicated on the page)                                                               |
| …of which the parser genuinely drops money                        | **13** (12 devices + 1 bmp)                                                                                                       |
| …of which the data is fine and only НЗОК's own count/total is odd | **11**                                                                                                                            |
| Money currently **absent** from the corpus                        | devices YTD is stuck at **2026-02**; the site reports **€19,077,339** where НЗОК publishes **€51,390,274** → **−€32,312,935**     |
| Money currently **wrong** in the corpus (loaded months)           | **€1,672,123** across 11 months, all under the 0.5 % assert                                                                       |
| Rows that would be added by fixing everything                     | ~4,031 (19,109 → ~23,140, +21 %)                                                                                                  |
| Cleanest available discriminator                                  | the **per-РЗОК subtotal** printed before every block: rounding tops out at **€7** across 2,968 blocks, every defect is **≥ €129** |

---

## 1. How this was reproduced (no network beyond the four listing pages, no re-crawl)

Everything below is derived from the PDFs already cached under `raw_data/nzok/bmp/`
(176 files) plus the four `nhif.bg/bg/hospitals/bmp/{2023..2026}` listing pages,
which are only needed to enumerate the links the loader would walk.

The loader truncates each error at 70 characters (`load_nzok_hospital_pg.ts`, in
`collectRows`' catch),
so the drift percentages and row counts never reach the console. The first step was
to replay `collectRows()` with the truncation removed, then re-run the parser with
its two `throw`s replaced by a diagnostics array so a failing file still yields its
rows. That gives, for **all 127 published (stream, period) files**:

- the header's own facility count and grand total,
- the parsed row count, paid-row count and Σ,
- **the per-РЗОК subtotal lines** (count + cumulative), which the parser reads past today,
- the `№ по ред` ordinal per row, which `ROW_START_RE` matches and discards.

The three throwaway scripts live in this session's scratchpad only; §7 turns the
useful half of them into a committed gate.

---

## 2. Evidence — the 24 files

`worst block` compares the parser's Σ for one РЗОК block against the subtotal НЗОК
prints above that block, in EUR (BGN files converted at the peg).

| #   | stream  | period  | assert  | hdr count / parsed rows | header € / parsed Σ €         | worst block                       | verdict                    |
| --- | ------- | ------- | ------- | ----------------------- | ----------------------------- | --------------------------------- | -------------------------- |
| 1   | bmp     | 2023-01 | count   | 373 / 372               | 101,555,155 / 101,555,027     | Варна €129                        | **parser loses money**     |
| 2   | bmp     | 2023-02 | count   | 375 / 375               | 235,822,811 / 235,822,825     | ≤ €7                              | data fine                  |
| 3   | bmp     | 2023-03 | count   | 375 / 375               | 379,721,687 / 379,721,677     | ≤ €7                              | data fine                  |
| 4   | bmp     | 2025-01 | count   | 383 / 380               | 162,962,260 / 162,963,003     | София град €740 (parser **high**) | **parser swallows a row**  |
| 5   | bmp     | 2026-01 | count   | 388 / 380               | 182,964,878 / 182,964,880     | ≤ €7                              | data fine                  |
| 6   | devices | 2023-06 | count   | 157 / 101               | 14,887,137 / 14,887,138       | ≤ €7                              | **source count error**     |
| 7   | devices | 2023-07 | count   | 157 / 102               | 18,160,499 / 18,160,500       | ≤ €7                              | **source count error**     |
| 8   | devices | 2024-09 | Σ-drift | 103 / 104               | 35,310,892 / 33,265,726       | София град €2,045,167             | **parser loses money**     |
| 9   | devices | 2024-10 | Σ-drift | 103 / 105               | 39,248,321 / 37,203,153       | София град €2,045,167             | **parser loses money**     |
| 10  | devices | 2024-11 | Σ-drift | 105 / 105               | 43,457,328 / 40,900,869       | София град €2,556,459             | **parser loses money**     |
| 11  | devices | 2024-12 | Σ-drift | 105 / 106               | 48,968,189 / 46,411,732       | София град €2,556,458             | **parser loses money**     |
| 12  | devices | 2025-01 | count   | 105 / 97                | 5,347,360 / 5,347,357         | ≤ €7                              | data fine                  |
| 13  | devices | 2025-02 | Σ-drift | 99 / 99                 | 10,682,871 / 10,171,583       | София град €511,290               | **parser loses money**     |
| 14  | devices | 2025-03 | Σ-drift | 101 / 101               | 15,488,523 / 14,977,234       | София град €511,292               | **parser loses money**     |
| 15  | devices | 2025-06 | Σ-drift | 104 / 104               | 31,595,196 / 30,061,323       | София град €1,533,874             | **parser loses money**     |
| 16  | devices | 2026-01 | count   | 108 / 105               | 12,975,094 / 12,975,097       | ≤ €7                              | data fine                  |
| 17  | devices | 2026-03 | Σ-drift | 109 / 109               | 31,273,944 / 30,273,942       | София град €999,999               | **parser loses money**     |
| 18  | devices | 2026-04 | Σ-drift | 109 / 109               | 31,273,944 / 30,273,942       | София град €999,999               | **parser loses money**     |
| 19  | devices | 2026-05 | Σ-drift | 109 / 109               | 38,347,926 / 36,347,923       | София град €1,999,999             | **parser loses money**     |
| 20  | devices | 2026-06 | Σ-drift | 111 / 111               | 45,044,089 / 43,044,091       | София град €1,999,999             | **parser loses money**     |
| 21  | devices | 2026-07 | Σ-drift | 112 / 112               | 51,390,274 / 49,390,277       | София град €2,000,001             | **parser loses money**     |
| 22  | drugs   | 2023-06 | count   | 45 / 42                 | 254,205,656 / 254,205,660     | ≤ €7                              | data fine                  |
| 23  | drugs   | 2023-07 | count   | 45 / 42                 | 300,608,787 / 300,608,788     | ≤ €7                              | data fine                  |
| 24  | drugs   | 2024-06 | Σ-drift | 43 / 386                | **3.29 × 10¹⁷** / 329,287,339 | ≤ €7                              | **header total misparsed** |

By shape: **14 Σ-drift** (matching the 14 `reconciliation failed` lines in the run)
and **11 facility-count**. By stream: devices 16, bmp 5, drugs 3. By year: 2026 → 8,
2025 → 5, 2024 → 5, 2023 → 7 — i.e. **not** an era problem, which is what the
current README's "3-column early-year files" framing would predict.

The 25th log line is `devices 2026-07` counted twice: that href appears twice in the
2026 listing HTML, and `seenPeriods` dedup runs only on the SUCCESS path, so a
failing duplicate is reported once per occurrence.

---

## 3. Root causes

### RC-1 — `repairGluedThousands` covers one of four observed glue spacings (13 files)

**Every one of the 13 money-losing files is the same single row**: Рег.№
`2201211067`, „АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА ЕАД", София град, `devices`
stream. In each file exactly one block disagrees (София град) and the shortfall is a
**round million-multiple in the report's own currency**.

`pdftotext -layout` pushes the amount's leading thousands group into the name, and
the spacing it lands with varies:

| layout as extracted                            | months                             | `repairGluedThousands` fires?                           |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `…ТОКУДА1EАД           601 077`                | 2023-06, 2023-07                   | ✅ yes — letter·digit·letters, no spaces                |
| `…ТОКУДА 2EАД   953 094`                       | 2025-02/03/06, 2026-03/04/05/06/07 | ❌ a **space** precedes the digit                       |
| `…ТОКУДА 4           EАД376 725   589 225`     | 2024-09, 2024-10                   | ❌ digit free-standing, letters glued to the **amount** |
| `…ТОКУДА 5     EАД` + amounts on the next line | 2024-11, 2024-12                   | ❌ same, and the row wraps                              |

The regex is
`/(\p{L})(\d{1,3})(\p{L}+)(\s+)(\d{1,3}(?:[ \t ]\d{3})+|\d+)/u` — it requires a
letter immediately left of the digit run and an amount immediately right of the
letters that follow it. Only the first row above satisfies both.

**The header is right, and this is provable without trusting it.** Summing the 27–28
per-РЗОК subtotals НЗОК prints reproduces the grand total to within €1–3 in all 13
files (2026-07: Σ subtotals €51,390,273 vs header €51,390,274), and only the София
град block is short — by €2,000,001 in that file, against a Токуда row parsed at
€953,094 whose true value is €2,953,094. So the assert's own comment — _"A large
drift means the parser dropped rows"_ — is correct here; it is verified, not assumed.

### RC-2 — the header grand total can merge two columns (1 file: drugs 2024-06)

The first `ОБЩО` line of `Заплатени средства за лек_прод … към 30.06.2024` extracts as

```
                           43                     ОБЩО                     644 030 052 115 383 323
```

— a **single** space between the YTD and month columns. `AMOUNT_RE` matches
`644 030 052 115 383 323` as one 18-digit number, so `totalCumulativeEur` becomes
3.29 × 10¹⁷ and the drift is 100 %.

**The rows are correct.** Parsed Σ = €329,287,339 against Σ of the per-РЗОК
subtotals = €329,287,337 (the true €644,030,052 BGN). The same total line repeats on
pages 2, 3 and 4 of the document **with a wide gutter and parses correctly**;
`lines.find(TOTAL_RE)` takes the first.

This is the case the brief asks about explicitly: here the header total, not the row
extraction, is what the assert misreads.

_(Secondary, same file: this month НЗОК published the drugs report listing **all 386**
facilities with €0 against the 343 that received no drug money, instead of the 43-row
form used every other month. That is harmless — the count assert passes, since it
compares paid rows — but it is why the file has 386 rows.)_

### RC-3 — the facility-count model does not hold across eras (11 files)

**All 11 count failures reconcile on money**, per block and in total: every block
diff is ≤ €7 except #1 and #4 below. So in nine of eleven cases the corpus is being
withheld over a count, not over a number.

Four distinct sub-shapes, and no single rule covers them:

**(a) The header count is not consistently "paid".** The current model (`paidRows`,
landed 2026-08-06 in `d2edc80b73`) was derived from bmp 2026-06 and holds there
(381 paid = 381 header, 11 zero rows uncounted). It does **not** hold in 2023:

| file                  | rows | zero rows | paid | header | matches    |
| --------------------- | ---- | --------- | ---- | ------ | ---------- |
| bmp 2023-02           | 375  | 3         | 372  | 375    | **listed** |
| bmp 2023-03           | 375  | 3         | 372  | 375    | **listed** |
| bmp 2024-02 _(loads)_ | 380  | 6         | 374  | 374    | paid       |
| bmp 2026-06 _(loads)_ | 392  | 11        | 381  | 381    | paid       |

All the zero rows are genuine distinct facilities (no duplicate Рег.№). Both models
are right somewhere and wrong somewhere; ±2 papers over the small cases and fails
the large ones.

**(b) A source-side count error — devices 2023-06 and 2023-07.** The София град
subtotal cell prints **83**, which is the _БМП_ report's Sofia facility count; the
devices table lists **27**. `101 − 27 + 83 = 157` = the printed header exactly, and
the money reconciles to the euro. Nothing is wrong with the data; НЗОК typed the
wrong count into its own spreadsheet.

**(c) Facilities counted but never printed — bmp 2026-01, devices 2025-01/2026-01,
drugs 2023-06/07.** In bmp 2026-01 the header says 388 and **only 380 reg numbers
exist in the PDF under every extraction mode** (`-layout`, `-raw`, and default all
return 380 distinct), spread as one or two missing `№ по ред` ordinals across seven
blocks — while every block's money reconciles. The 8 facilities НЗОК counted and did
not print are necessarily €0.

**(d) One genuine parser drop — bmp 2023-01, and it produces a wrong number.**

```
 03    Варна                 22       0314211005    МБАЛ- Девня ЕООД        255       255
 3     Варна                 23       0306391032   ДЦ ХИПОКРАТ ЕООД       4 277     4 277
```

Exactly one line in the file renders its РЗОК code with the leading zero stripped.
`ROW_START_RE`'s `^\s*(\d{2})` rejects it, so the line is absorbed as a
_continuation_ of the row above — the failure mode the parser's own comment
describes. The result: **МБАЛ-Девня ЕООД (0314211005) would publish 4,277 BGN —
ХИПОКРАТ's money — instead of its own 255**, and ДЦ ХИПОКРАТ ЕООД disappears
entirely. Net block loss €129, i.e. 0.0001 % of the file: the Σ assert cannot see it
and **only the count assert is holding this back**. (bmp 2025-01 is the same class in
the other direction: 2 Sofia rows missing and the block Σ €740 _above_ the printed
subtotal.)

### RC-4 — 11 LOADED months carry €1,672,123 of wrong money (the finding that matters most)

This is not in the 25. These months pass both asserts and are in
`nzok_hospital_payments` right now, on local and on Cloud SQL.

| period      | file Σ − header | culprit                            |
| ----------- | --------------- | ---------------------------------- |
| bmp 2023-07 | **+€10,613**    | sign inversion                     |
| bmp 2023-08 | +€10,412        | sign inversion                     |
| bmp 2023-09 | +€10,412        | sign inversion                     |
| bmp 2023-10 | +€10,406        | sign inversion                     |
| bmp 2023-11 | +€10,415        | sign inversion                     |
| bmp 2023-12 | +€10,418        | sign inversion                     |
| bmp 2024-04 | −€142,650       | amount split across the line break |
| bmp 2024-05 | −€285,720       | ditto ×2 blocks                    |
| bmp 2024-12 | −€522,822       | wrapped name with digits           |
| bmp 2025-12 | −€544,987       | wrapped name with digits           |
| bmp 2026-02 | −€113,268       | wrapped name with digits ×2        |

**(i) Sign inversion — the parser's stated premise is false.** The header comment on
`SIGNED_AMOUNT_RE` says the negative-carrying reports are ЛП/МИ, _"which the БМП
report never does"_. It does. НЗОК's БМП report carries negatives in 8 files, 7 of
them loaded. `AMOUNT_RE` has no `-`, so:

```
 22  София град  81  2217134501  ДКЦ Св. София ЕООД        -10 180        0
```

is read as **+10 180 BGN** and the minus is swallowed into the name. Live in the
table today:

```
 period     | cumulative_eur |         name
 2023-08-01 |           5205 | ДКЦ Св. София ЕООД -
 …2023-09 … 2023-12: identical
```

A named Sofia clinic that НЗОК **recovered** €5,205 from is published as having
received €5,205 — a €10,410 error per month in the direction that flatters the
facility, and the trailing `-` in the rendered name is the only visible trace.
(Two more: МБАЛ-Дулово ЕООД 2023-06 month −55,394 → +55,394; МБАЛ Проф. Димитър
Ранев ООД 2023-10 month −565 → +565.)

**(ii) Wrapped name whose continuation lines contain digits.** `МИ-МВР-ФИЛИАЛ ВАРНА`
(`0306253028`) wraps its name across three physical lines that carry stray digits
(`ПРОДЪЛЖИТЕЛНО 91ЛЕЧЕНИЕ`, `063 ИР`). `extractAmounts` then takes a name fragment
as the amount:

```
 reg_no    | period     | cumulative_eur | true    | name as stored
 0306253028| 2024-12-01 |             47 | 522,872 | МИ-МВР-ФИЛИАЛ ВАРНА … , 1 022 653 ПРОДЪЛЖИТЕЛНО
 0306253028| 2025-12-01 |             36 | 545,022 | … , 1 065 968 ПРОДЪЛЖИТЕЛНО
 0306253028| 2026-02-01 |         31,022 |  88,426 | … , ПРОДЪЛЖИТЕЛНО 57 88 426 ЛЕЧЕНИЕ 404 И РЕХАБИЛИТАЦИЯ
```

Note the stored **`name` contains the euro amount** — the corpus is publishing a
facility whose name reads „…ЗА ДОЛЕКУВАНЕ, 1 022 653 ПРОДЪЛЖИТЕЛНО".

**(iii) Amount split across the line break with its first group glued to the name.**
`ДЪЧМЕД ДИАЛИЗА БЪЛГАРИЯ … ЕООД279` / `464          68 000` → stored **€237**
against a true **€142,890** (bmp 2024-04). Same class: `МНОГОПРОФИЛНА БОЛНИЦА ЗА
АКТИВНО ЛЕЧЕНИЕ - ВАРНА9 758 ЕООД` at €4,989 (bmp 2025-03).

**Corpus-wide fingerprint, measured against the live table:** 6 rows / 3 facilities
whose `name` matches `[0-9]{1,3} [0-9]{3}`, and 6 rows / 1 facility whose `name`
ends in a stray `-`. Both are one-line SQL checks — see §7.

### RC-5 — source-side, needs a human decision: the April 2026 devices file

`…към 30.04.2026` carries a YTD of **€31,273,944 — byte-identical to March's** — and
a **month column of 0** on the total line. The per-facility rows differ from March's
in layout but not in YTD. Fixing RC-1 will therefore publish April as identical to
March. That may be exactly what НЗОК published (no МИ payments in April) or a
mis-issued file; it is not decidable from the PDF. See §9.

---

## 4. Impact

### 4.1 What is absent

`nzok_hospital_payments`, local (and the same shape on Cloud SQL — the same loader
writes both):

```
 stream  | months |   first    |    last    | rows
 bmp     |     38 | 2023-04-01 | 2026-07-01 | 14486
 devices |     25 | 2023-02-01 | 2026-02-01 |  2835
 drugs   |     40 | 2023-01-01 | 2026-07-01 |  1788
```

Missing per stream: **devices 16 of 41 published months (39 %)**, bmp 5 of 43
(11.6 %), drugs 3 of 43 (7 %).

### 4.2 What the site therefore reports

`nzok_hospital_payments_latest_rows` (050, redefined in 065) deliberately takes
**each stream at its own `max(period)`** so a lagging stream is not dropped. With
devices stuck at February that means the page adds a **February** YTD to two **July**
YTDs:

| stream      | served as-of | served YTD         | НЗОК's own latest (2026-07) | shortfall                  |
| ----------- | ------------ | ------------------ | --------------------------- | -------------------------- |
| bmp         | 2026-07      | €1,326,051,415     | €1,326,051,421              | —                          |
| drugs       | 2026-07      | €506,082,518       | €506,082,516                | —                          |
| **devices** | **2026-02**  | **€19,077,339**    | **€51,390,274**             | **−€32,312,935 (−62.9 %)** |
| **total**   | mixed        | **€1,851,211,272** | €1,883,524,207              | **−€32,312,935 (−1.72 %)** |

Facilities: the devices snapshot covers **106**; НЗОК lists **112** in July.

Worked per-hospital example — Аджибадем Сити Клиник УМБАЛ Токуда (`2201211067`,
the RC-1 facility): served €37,398,035 + €23,399,363 + €1,138,734 = **€61,936,132**
against a true **€63,750,492** — understated **€1,814,360 (2.85 %)** for one
hospital on its own page.

### 4.3 Two surfaces degrade further than the table does

- **`nzok_hospital_map()` (075) drops the devices stream entirely.** It takes
  `max(period)` across **all** streams — 2026-07 — and filters `WHERE period = that`,
  so with devices ending in February it contributes **zero** to every hospital's map
  figure. That is a second-order consequence of the skip, not an independent bug, but
  it means the map and the tile disagree about the same hospital.
- **Annual figures.** devices is missing 2024-09 … 2024-12, so the 2024 devices
  year-end (€48,968,189) is unavailable and the newest 2024 devices datapoint is
  August (€30,629,740) — 37 % short for anything reading a year-end.

`nzok_hospital_payments_trends()` pins `stream = 'bmp'` and is unaffected.

### 4.4 The absence is currently invisible to a reader

`periodByStream` is in the payload (050/065) and typed in `src/data/budget/types.ts`,
whose comment states _"the tile footnotes the lag rather than silently dropping the
lagging stream's money"_. **No component reads it.** `NzokHospitalReimbursementTile`
renders `devicesEur` beside `bmpEur`/`drugsEur` with a single `asOf` derived from the
bmp anchor. So the page shows a July as-of over a February devices figure and says
nothing. The contract was designed and never wired.

---

## 5. Options

### O1 — Widen the tolerances (0.5 % → 6 %, ±2 → ±60). **Rejected.**

It would "fix" 24 files by making the parser stop looking. Concretely it would ship
the Токуда row 62 % short in 13 months, ship МБАЛ-Девня with another facility's money
(RC-3d), and — because the two asserts are the only thing standing between a
misparse and the page — remove the guard that is _already_ being defeated by
RC-4 at 0.02 %. The measured margin runs the wrong way: legitimate rounding across
2,968 blocks tops out at **€7**, and the smallest real defect is **€129**. There is
no tolerance that admits the 24 without also admitting €1.67M of known-wrong numbers.

### O2 — Fix the four parser defects, keep both asserts as they are.

Recovers 13 of the 24 and the €1.67M. Leaves 11 files rejected over a count НЗОК
itself got wrong or never printed — i.e. leaves devices short by 4 months and the
2023 bmp quarter absent — and leaves the ±2 window still unable to distinguish
(b)/(c) from (d).

### O3 — Fix the four defects **and** replace both asserts with a per-block reconciliation. **Recommended.**

Every one of these reports prints, immediately above each РЗОК's facilities, a
subtotal line carrying that block's **count and cumulative**:

```
                         83                   РЗОК София град     18 472 390    3 917 276
```

Measured across all 127 files: Σ of the block subtotals equals the header grand total
in **127 / 127** (± €3) and Σ of the block counts equals the header count in
**125 / 127**. So the block lines are a second, independent, finer-grained copy of
the same truth — and the parser reads past them today.

Replacing the two global asserts with:

1. **per block, |parsed Σ − printed subtotal| ≤ an ABSOLUTE tolerance** (a relative
   one cannot see RC-3d's €129 inside a €51.9M block), and
2. **per block, the `№ по ред` ordinals form 1…n** where n is the block's printed
   count — with unnumbered rows counted separately, and a shortfall **reported, not
   thrown**, when the block's money reconciles

gives a guard that is strictly sharper _and_ strictly less trigger-happy than what
exists. Measured over the 2,968 blocks in the corpus:

- rounding band: 1,819 blocks at €0, 922 at €1, and a tail to **€7** (a block of 83
  rows each rounded independently against one rounded subtotal);
- next values up: **€129** (RC-3d), **€740** (bmp 2025-01), then €10,406 and above —
  every one a known defect.

An absolute per-block tolerance of `max(10, rows)` euro sits in an 18× gap. It
**rejects** all 13 RC-1 files, RC-3d, bmp 2025-01 and all 11 RC-4 months; it
**accepts** the 10 files currently rejected over a count with the money exact.

The ordinal check is what localises a drop: for bmp 2026-01 it names the seven blocks
and the exact ordinals (`Кюстендил n=8 missing=[5]`, …) rather than reporting "8 short".

### O4 — Publish a coverage record so a hole is visible instead of a log line.

Orthogonal to O1–O3 and needed regardless: nothing that survives §5 will ever parse
100 % of what НЗОК publishes, and RC-5 shows a month can be un-decidable. See §6
Tier 0.

---

## 6. Recommendation — four tiers, each shippable alone

### Tier 0 — make the hole visible — SHIPPED 2026-08-25

The corpus is missing five months of one stream and every surface says nothing.
Two changes, both additive:

- **`nzok_payment_coverage` (new table, migration `045`-adjacent or a new file),
  written by the loader inside its existing transaction**: one row per
  `(stream, period)` the listing offered, with `status` (`loaded` | `rejected`), the
  header's own count and grand total, and the rejection reason. Same shape as
  `ted_coverage` / `aop_expert_coverage` / `isun_clean_delivery_coverage` — the
  repo's established way of making an omission a queryable fact rather than stdout.
  Because the header total parses correctly in 23 of the 24 rejected files, the
  coverage row can state **what НЗОК says the month was worth** even when we refuse
  to publish per-facility rows for it.
- **Wire `periodByStream` into `NzokHospitalReimbursementTile`** — the contract its
  own type comment already promises. When a stream's as-of differs from the tile's
  headline as-of, footnote it: „Медицински изделия: към 02.2026 (по-стар отчет)".
  With Tier 0 alone the page stops implying that €19.1M is July's devices figure.

Rationale for ordering: Tier 0 turns a silent 1.72 % understatement into a stated
one, and it is the only tier that is safe to ship without touching a single number.

> **SHIPPED 2026-08-25, both bullets — `0217ea8f08` (coverage) and `d89fec3bcb`
> (tile). Three deviations worth carrying:**
>
> 1. **The coverage table is its own migration, `187_nzok_payment_coverage.sql`,
>    not "045-adjacent"**, and it carries FOUR columns this section did not
>    anticipate: `count_mismatch_blocks` / `count_mismatch_ordinals` /
>    `unreconciled_blocks` / `unreconciled_eur`. `status = 'loaded'` turned out
>    not to mean "verified" — a month can load with blocks НЗОК prints no subtotal
>    for, whose money is reconciled by nothing but the whole-file 0.5 % ratio, the
>    check that let €1,672,123 through. A consumer reading only `status` would
>    call those months clean. They are NULL on a refused month, because 0 there
>    would state that a withheld month's blocks all reconcile.
> 2. **The footnote fires in BOTH directions, and the one-directional version this
>    section describes („по-стар отчет") was a live gap.** The headline is the БМП
>    anchor — `max(period)` over LOADED bmp rows — so a REFUSED bmp month leaves
>    drugs/devices AHEAD of it. Five periods in this corpus carry drugs and/or
>    devices rows and no bmp row at all (2023-01/02/03, 2025-01, 2026-01), and
>    2026-01 is row #5 of this plan's own rejection table. Testing `p < headline`
>    would render every hospital's newer money under an older date with both
>    caveats silent — this defect, mirrored. The rule is `p !== headline`, and the
>    label picks „по-стар" / „по-нов" from the direction.
> 3. **The per-EIK `periodByStream` is CORPUS-WIDE months, not the company's own.**
>    `nzok_hospital_payments_latest_rows` pins every stream to its global
>    `max(period)`, so a stream missing from the payload means "no rows in that
>    stream's latest month" — 159 EIKs have devices history and no `devices` key —
>    not "no rows at all". Both readings suppress the footnote, which is why the
>    behaviour was right while the comment was wrong; the comment is now correct,
>    because it is what the next person acts on.
>
> Measured on the local corpus at ship time: **95 of 258** hospital company pages
> carry the note, over **€18,816,902** of devices money that was presented as July's
> and is February's. The national pack on `/awarder/121858220` is NOT covered — it
> reads a different payload whose `periodByStream` still has no reader, and
> `NzokHospitalPaymentsFile`'s type comment now says so instead of claiming
> otherwise. That is open work, not done.

### Tier 1 — the four parser defects (recovers 13 files and repairs €1.67M) — SHIPPED 2026-08-25

1. **RC-4(i) sign** — read signed amounts on **all three streams**, not only the
   lenient ones, and delete the "БМП never carries negatives" premise from the header
   comment (it is falsified by 8 files). Keep the `!lenient && cumulative < 0 → null`
   rejection **off** for `bmp` now that the sign is actually captured — otherwise
   ДКЦ Св. София's row is dropped instead of inverted, which is better but still
   wrong. **Note the interaction:** the `month > cumulative` clamp is a bmp-only
   heuristic that is invalid once negatives are readable (−50 > −100), exactly as the
   existing comment says for the lenient streams. It must become
   `lenient`-independent, i.e. only fire when both figures are non-negative.

   > **SHIPPED 2026-08-24 — and the last sentence above was NOT followed. Do not
   > "finish the job".** The non-negative requirement shipped; making the clamp
   > `lenient`-independent was measured and REJECTED. devices 2023-02 prints a
   > national month ABOVE its national YTD (`91 ОБЩО 5 381 471 5 385 156`, because
   > January was negative), and `УМБАЛ Александровска - ЕАД 43 388 47 073` sits
   > inside it — so on a lenient stream a positive month legitimately exceeds a YTD
   > an earlier clawback dragged down, and clamping there would zero a real figure
   > on a named hospital. The clamp therefore stays `!lenient`-gated with a
   > `cumulative >= 0` guard; the `month >= 0` half of the suggested condition was
   > dropped as provably unreachable. See `extractAmounts`'s comment and the test
   > case "lenient stream keeps a positive month that exceeds its own YTD".
   >
   > Two further deviations from this item as written, both deliberate:
   > **(a)** the sign guard is a lookbehind on the MINUS only
   > (`(?:(?<![\p{L}\p{N}])-)?`), never on the whole token — anchoring the token
   > also refuses a digit run welded to a name, so `…ЕООД242 730` reads as `730`
   > and €242,730 vanishes. **(b)** `readTotalLine` was extracted as an exported,
   > tested seam here rather than in item 5, because item 5 rewrites it and it had
   > no coverage at all; its test pins today's WRONG answer for the RC-2 merged
   > line, so item 5 lands as a visibly flipping red test.

2. **RC-1 glue** — generalise the repair from one rigid pattern to the invariant it
   is actually encoding: _a short digit run adjacent to letters, immediately left of a
   money column, whose reattachment makes the row's block reconcile._ Two options,
   both acceptable: (a) widen the pattern to the four observed spacings and keep it
   unconditional (the block assert is the net); (b) make the repair **block-driven** —
   attempt it only when the block fails to reconcile, and accept it only if it makes
   the block reconcile exactly. (b) is more work and strictly safer; it cannot invent
   money, because a wrong repair leaves the block failing and the file is still
   rejected.
3. **RC-4(ii)/(iii) wrapped rows** — a row's amounts must be taken from the
   **column positions** the header establishes, not from "the last two numbers in the
   accumulated text". `pdftotext -layout` preserves the gutter (`\s{2,}` splits the
   row cleanly into name / YTD / month on every well-formed line); the wrapped
   continuation then contributes its columns at the same offsets. This is the
   largest single change in the tier and the one that fixes МИ-МВР Варна, ДЪЧМЕД and
   МНОГОПРОФИЛНА ВАРНА at once. It also fixes the polluted `name` column as a side
   effect.
4. **RC-3d single-digit РЗОК** — `^\s*(\d{2})` → `^\s*(\d{1,2})` with left-padding to
   two digits. One line; recovers ДЦ ХИПОКРАТ and stops МБАЛ-Девня inheriting its money.
5. **RC-2 header total** — take the total-line amounts by the same column split
   (`\s{2,}`), and when the first `ОБЩО` line yields a single implausible run, fall
   back to the later page repeats. A cheap independent cross-check is already
   available and should be used instead of any heuristic: **Σ of the block subtotals**.
   If the header total disagrees with Σ subtotals by more than the rounding band, the
   _header_ is the suspect value, not the rows.

### Tier 2 — replace the two asserts (recovers the remaining 11 files) — SHIPPED 2026-08-25

Per §5-O3. Concretely, in `parseHospitalPaymentsPdf`:

- capture the block subtotal lines (`^\s*(\d+)\s+РЗОК\s+(name)\s{2,}(cum)\s{2,}(month)$`)
  and the `№ по ред` ordinal `ROW_START_RE` already matches;
- **throw** when any block's |parsed Σ − printed subtotal| > `max(10, rowsInBlock)`,
  naming the block, both figures and the rows;
- **throw** when Σ blocks ≠ header total beyond the same band (catches RC-2 from the
  other side);
- **report, do not throw**, when a block's ordinals are incomplete while its money
  reconciles — that is (b)/(c), НЗОК's own bookkeeping, and belongs in the coverage
  row as `countMismatch`, not in a rejection;
- keep the global 0.5 % Σ assert as a cheap backstop; it costs nothing and catches a
  file with no parseable block structure at all.

Expected outcome after Tiers 1+2: **0 of 127 files rejected**, ~4,031 rows added
(19,109 → ~23,140), devices current to 2026-07, and the €1.67M corrected.

### Tier 3 — decide RC-5 and the residue (see §9) — SHIPPED 2026-08-25

---

## 7. Gating tests

The existing `scripts/nzok/parse_hospital_payments.test.ts` (8 cases) tests
`extractAmounts` on synthetic tails only. It is worth keeping and extending, but it
cannot catch any defect in this document: all four root causes live in the row/block
assembly around it, and RC-1's four spacings are exactly the kind of case a
hand-written fixture list keeps missing (it already has a glued-name case — the
`a9dfef1aa` one — and still missed these).

Add three layers:

1. **Unit — extend the layout matrix** with one case per observed shape, transcribed
   verbatim from the PDFs: the four Токуда spacings, the МИ-МВР three-line wrap, the
   ДЪЧМЕД split-across-break, the `-10 180` negative, the single-digit РЗОК line, and
   the single-space merged total line. Each with its verified true value.
2. **Corpus gate — `scripts/nzok/hospital_payments_corpus.test.ts`** (new, Vitest,
   skips when `raw_data/nzok/bmp/` is absent, as the `.data.test.ts` family does for
   Postgres). For **every cached PDF**: parse it, and assert
   - every block's Σ matches its printed subtotal within the absolute band,
   - Σ blocks matches the header total,
   - **no stored `name` matches `[0-9]{1,3}[ ][0-9]{3}` or ends in `-`** — the two
     fingerprints of RC-4, and the cheapest possible mutation check,
   - the number of REJECTED files is ≤ a committed ceiling (0 after Tier 2), so a
     regression that starts skipping months fails rather than logging.
     This is the gate that would have caught all four causes, and it needs no network.
3. **Data gate — `scripts/db/tests/nzok_hospital_payments.data.test.ts`** — ⚠️ **NOT
   BUILT.** It needs the table to be loaded, which has not happened, and the coverage
   table it would assert against is Tier 0's. Left open deliberately; what shipped
   instead is `scripts/nzok/hospital_payments_corpus.test.ts` (the corpus gate, which
   needs no database) and `scripts/db/load_nzok_hospital_pg.test.ts` (the loader's
   pure helpers). It would assert
   - each stream's `max(period)` is within N months of the newest coverage row (i.e.
     a stream cannot silently fall five months behind again),
   - `nzok_payment_coverage` has a row for every published month and no
     `rejected` row without a reason,
   - no `name` carries the two fingerprints above,
   - **a mutation check**: recompute a sampled month's Σ from the PDF and compare to
     the table, so an assertion satisfied by two implementations that both dropped
     the same row cannot pass.

---

## 8. Command sequence

Local Postgres must be running and **explicitly pinned** — every `db:*:cloud` script
exports a password-less URL that resolves the _cloud_ password from `.pgpass` and
fails 28P01 against local:

```bash
npm run db:pg:up
```

Diagnose / verify at any point without writing anything:

```bash
npm run test:unit -- scripts/nzok   # the corpus gate; NOT the `--audit` CLI this
                                   # line first proposed, which was never built —
                                   # hospital_payments_corpus.test.ts does the job
npm run test:unit -- scripts/nzok
```

Publish, after Tiers 1+2 are green:

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' npm run db:load:nzok-hospital:pg
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' npm run db:load:nzok-hospital-map:pg
npm run test:data -- nzok
```

Then Cloud SQL — `db:load:nzok-hospital-map:pg` is **mandatory** after it, because
five recovered devices months add facilities (106 → 112) and the map's crosswalk is
keyed on the facility universe:

```bash
npm run db:proxy:cloud                      # if not already up; nc -z 127.0.0.1 5434
npm run db:load:nzok-hospital:pg:cloud
npm run db:load:nzok-hospital-map:pg:cloud
npm run db:dump:cloud
```

If Tier 0 lands (new table + new payload field), the order is
**loader → `deploy:db` → `deploy`**: the coverage read is additive and degrades to
absent, so it does not break a page in either order, but the tile's footnote is
useless until the loader has written the rows.

The `update-nzok` skill's step 2 already names the two `:cloud` loaders and
`db:dump:cloud`; add the coverage-table note and the new gate to its verification
table so a future operator sees a non-zero rejected count as a failure rather than as
a standing TODO banner.

---

## 9. Decisions that need a human

1. **RC-5 — the April 2026 devices file.** Its YTD is identical to March's and its
   month total is 0. After Tier 1 the parser will happily publish April = March.
   Options: publish as НЗОК filed it (defensible — it _is_ what the report says);
   or hold it as `rejected` with reason `identical-to-prior-period` until a corrected
   file appears. Recommendation: **publish, and flag it in the coverage row**, because
   a zero month is a fact НЗОК published and withholding it creates a hole that looks
   like our defect rather than theirs. But this is a judgement call about a named
   number and should not be made silently.

   > **DECIDED 2026-08-25 — the recommendation was taken: PUBLISH, and name it.**
   > `republishedMonths` in `scripts/db/load_nzok_hospital_pg.ts` reports every month
   > that repeats its predecessor's year-to-date with a zero month column, and the
   > loader prints it as its own banner rather than folding it into the skip list —
   > the two are opposite facts (one is absent, one is present and identical to the
   > month before). Re-measured over the whole cache: **devices 2026-04 is the only
   > instance**, and both files parse cleanly, so it is the source's figure and not
   > a parse artifact.
   >
   > Two euro figures appear for this month and both are right: **€31,273,944** is
   > what the file's own grand-total line prints (quoted in §3 RC-5 and the table in
   > §2), and **€31,273,942** is the sum of its 109 facility rows, which is what
   > `republishedMonths` compares. They differ by €2 of per-row rounding — the same
   > band every block tolerance in this plan is sized against.
   >
   > What made this safe to decide rather than escalate is that the alternative was
   > measurably worse. Withholding it puts a hole in the devices series one month
   > after the five Tier 1 recovered, and a reader cannot tell "we refused this
   > month" from "the parser broke again" — the exact confusion this plan exists to
   > end.
   >
   > ⚠️ **"Labelled" currently means labelled to the OPERATOR, not to the reader.**
   > The banner is a line in the loader's output; `nzok_payment_coverage` does not
   > exist yet and no component reads `periodByStream`. So as things stand a visitor
   > to `/awarder/121858220` sees April's figures with nothing marking them, and the
   > only person who learns of the repetition is whoever runs the load. That is the
   > honest state of this decision and it is Tier 0's job to close — this entry
   > should not be read as "the reader is informed".
   >
   > ⚠️ The detection needs BOTH halves. A zero month total alone is an ordinary
   > "nothing was paid" report, which is a different fact and must not carry this
   > warning; the prior period's year-to-date must be identical. Both directions are
   > pinned in `load_nzok_hospital_pg.test.ts`, along with the two boundaries a
   > year-to-date series makes load-bearing: the rule must NOT fire across a
   > December→January boundary (January's cumulative resets, so equality there means
   > nothing) and must compare the IMMEDIATELY preceding calendar month rather than
   > the nearest earlier file held — the devices stream has real gaps, so "nearest
   > earlier" would pair 2024-02 with 2023-12, across both the gap and the reset.
   > All four clauses are mutation-checked.
   >
   > That test file also exists because this loader had NO tests at all: `main()`
   > ran at import, so nothing in it could be imported without starting a load. It
   > is now behind the same entrypoint guard `load_open_calls_pg.ts` uses.

2. **Whether the €1.67M correction gets a changelog entry.** The loader already writes
   `ingest_first_seen` via `recordIngestBatch`, keyed on `(reg_no, period)`, so a
   TRUNCATE+reload of corrected months will not itemise them as new — the correction
   would be invisible on `/data/updates`. Eleven months of published per-hospital
   euros are changing, including a sign flip on a named clinic. Recommendation: a
   one-line `data-changes.json` entry naming the correction and its size.

   > **DECIDED 2026-08-25 — the recommendation is taken, but NOT by writing the
   > entry now.** No loader has been run, so the corrected figures are not in any
   > served table: an entry today would tell `/data/updates` that published money
   > changed on a day it did not. What ships instead makes the entry both TRUE when
   > it lands and unavoidable:
   >
   > - `diffAgainstPrevious` reads the previous vintage inside the load's own
   >   transaction and reports how many rows were RESTATED and by how much, with
   >   the `append-data-change` command pre-filled. The €1.67M figure stops being
   >   something someone has to remember and becomes something the load measures.
   > - the loader APPENDS the entry itself (`appendDataChange`, `dedupeSameDay` —
   >   the `update-prices` pattern) rather than printing a command. Review caught
   >   why that matters: the signal is ONE-SHOT — once the load commits, the
   >   corrected figures are the previous vintage and the next run reports nothing —
   >   and `db:refresh` runs this loader with `--tolerate-offline`, so the run that
   >   consumes a correction may be unattended. A message printed to a console
   >   nobody reads is the same as no message.
   > - `update-nzok` gains a step: commit `data/data-changes.json` and include it in
   >   the bucket sync — it is git-tracked AND bucket-served, so the corrected
   >   figures otherwise publish while the note explaining them does not.
   >
   > This closes the general case rather than this instance. §9-2's mechanism —
   > `recordIngestBatch` keys on `(reg_no, period)`, so a reload of months already
   > in `ingest_first_seen` itemises nothing — is a permanent property of the
   > loader, and the NEXT silent restatement is caught by the same code.
   >
   > ⚠️ Follow-through: the entry is still owed, and it is owed at the moment
   > `npm run db:load:nzok-hospital:pg[:cloud]` is next run. The load will report
   > ~11 restated months / ~€1.67M plus ~4,000 new rows from the 24 months the old
   > asserts withheld.

3. **How hard the ordinal shortfall should be.** Tier 2 reports rather than throws
   when ordinals are missing but money reconciles. That is right for (b)/(c) — but it
   means a future parser regression that drops a genuinely €0 facility will be
   reported, not caught. The alternative (throw, with an allowlist of the known
   source-side files) is stricter and higher-maintenance. Recommendation: report, and
   put the count in the coverage row so a _rising_ count is visible.

   > **DECIDED 2026-08-25 — report, and the premise that made this a hard call is
   > gone.** This item worried that leniency would let a dropped €0 facility through
   > uncaught, since such a row moves no money and is invisible to every
   > reconciliation. **Tier 2 step 2 NARROWED that**: the parser asserts the Рег.№
   > UNIVERSE — every facility the document prints must reach a row — and it is a
   > throw, not a report. Mutation-checked: making `extractAmounts` drop zero-value
   > rows now fails, naming the six Рег.№.
   >
   > ⚠️ NARROWED, not closed, and an earlier draft of this note said closed. The
   > universe is built from the SAME `matchRowStart` that builds the rows, so it is
   > blind to a RECOGNISER regression — a line that stops starting a row disappears
   > from both sides at once. That is RC-3d's class, and for a €0 facility the block
   > money, the count report and the corpus gate are blind to it too. What guards it
   > is the unit test on `matchRowStart` and nothing else.
   >
   > The alternative this item weighed ("throw on a count mismatch with an
   > allowlist") would still have been worse: the count means four different things
   > across the corpus and the allowlist would have grown every January.
   >
   > So what is left for the count is a TREND, and the loader now prints it: per
   > accepted month, how many blocks disagree with their printed count, how many
   > ordinals are absent, and how many blocks print no subtotal at all — whose money
   > rests on the whole-file ratio, the check that let €1,672,123 through. The
   > coverage ROW this item asks for is Tier 0's; the fields it needs
   > (`countMismatches`, `unreconciledBlocks`, `unreconciledEur`) exist on the parsed
   > file and are carried through the loader, so Tier 0 is wiring rather than design.
   >
   > ⚠️ Until Tier 0 lands this is visible to the OPERATOR only. What actually fails
   > on a rise is the corpus gate's identity set — `hospital_payments_corpus.test.ts`
   > keys on (stream, BLOCK), so a new January adds no noise and a new region names
   > itself.

4. **Whether to widen `YEARS` afterwards.** The parser work in Tier 1 (column-position
   amounts, signed amounts, flexible РЗОК code) is most of what `scripts/nzok/README.md`
   lists as blocking ≤2022. Out of scope here; worth a follow-up once the block
   reconciliation exists, because that is the guard that makes a new era safe to attempt.

---

## 10. Rollback

Every tier is independently revertable and none of them changes a schema
destructively.

- **Tier 0** — `nzok_payment_coverage` is a new table; dropping it affects nothing
  else. The tile footnote is additive and reads an optional payload field.
- **Tiers 1–2** — parser-only. Revert the commit and re-run
  `db:load:nzok-hospital:pg[:cloud]`; the loader `TRUNCATE`s and rebuilds from the
  PDFs on every run, so the previous corpus comes back exactly, including the 24
  skips. There is no migration to unwind and no committed artifact derived from this
  table.
- **The one irreversible thing is the PDF cache** — `fetchToCache` keys on
  `sha256(link)` and never re-downloads. Do not delete `raw_data/nzok/bmp/` as part
  of a rollback: it is gitignored, it is the only copy of some superseded uploads, and
  the listing pages no longer link all 176 of them.
- **`db:dump:cloud`** should be re-run after any rollback that reached Cloud SQL, so
  the GCS snapshot does not keep the reverted vintage.

---

## 11. What this document deliberately does not claim

- That the header count has a single meaning. It does not; §3-RC-3 shows four
  behaviours across the corpus and the recommendation stops relying on it.
- That the 127 files are all НЗОК published. The loader walks four listing pages;
  months НЗОК never linked (devices 2023-01, 2024-01) are absent from this analysis
  and from the corpus, and no attempt was made to find them.
- That Cloud SQL matches local. The measurements in §4 are against local Postgres;
  the same loader writes both and the row count matches the 2026-08-22 run's banner
  (19,109), but the cloud table was not queried.
