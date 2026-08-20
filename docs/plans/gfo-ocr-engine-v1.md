# ГФО OCR engine bakeoff — Tesseract vs Gemini Flash

**Plan item P3** of `docs/plans/culture-investigative-v1.md`. Measured 2026-08-20 against the
16 ГФО documents cached in `raw_data/tr/gfo_bakeoff/` (gitignored). Nothing was fetched for
this bakeoff; nothing was built, loaded or deployed.

---

## Verdict

**Use Gemini Flash. Do not build a Tesseract path.**

**The number that decides it: on the nine documents that actually carry an income statement,
Gemini read `Общо приходи` correctly 9/9 (100%); Tesseract read it correctly 6/9 (67%) at
300 DPI and 2/9 (22%) at 150 DPI.** Since `Общо приходи` IS the denominator P3 exists to
produce — "won €X against €Y of turnover" — a third of that column being wrong is the whole
feature failing.

The accuracy gap is not the strongest argument, though. Two others are:

- **Tesseract's errors are the dangerous kind.** Its most common failure is publishing the
  **prior-year column** as the current year — internally consistent, plausible, and invisible
  to every arithmetic check we can build (measured below: the free validator catches a
  whole-column shift only **3/9** of the time, against **8/8** for single-cell errors).
  Gemini made no errors of any kind on this sample.
- **The capture-everything requirement flips the comparison further, not less.** Extracting
  the full `(код, label, current, prior)` table is what makes the free arithmetic validator
  possible at all — and it is a task Tesseract cannot do without a bespoke parser per form
  family, while Gemini does it in one prompt at 118.6 rows/document with every cross-foot
  identity reconciling.

Cost at the top-1,000 tier (~5,000 documents), capture-everything: **$80–$153** — a band,
because the list price is the one thing here I could not verify (§6).

---

## 1. The sample, and what it establishes about the corpus

16 documents, 89 KB → 7.7 MB, 93 pages across the 15 that are PDFs.

|                                              | measured                                   |
| -------------------------------------------- | ------------------------------------------ |
| documents                                    | 16                                         |
| **not a PDF at all**                         | **1 (6.25%)** — OLE2 MS Word `.doc`        |
| pages (15 PDFs)                              | 93; mean **6.2**, median **5**, range 1–20 |
| **documents with a usable text layer**       | **0 of 16 (0%)**                           |
| documents carrying an income statement (ОПР) | **9 of 15 readable (60%)**                 |
| distinct companies                           | 8, spanning fiscal years 2013–2023         |

### 1.1 The "~90% are scans" premise holds — and is stronger than stated

The brief expected ~90% pure scans. Measured: **100%**. Thirteen of sixteen carry no font
object at all. The other three declare exactly one font — `Helvetica, Type 1, WinAnsi,
emb=no, uni=no` — a non-embedded Latin placeholder with no ToUnicode CMap, so `pdftotext`
returns mojibake:

```
OTqerHa eA14Hrlqai          ← actually "Отчетна единица"
CTPOIiI-ABTO OOE            ← actually "СТРОЙ-АВТО ООД"
```

**There is no digital-PDF fast path on this corpus.** Any design that branches on
"has a text layer → parse it cheaply" will take that branch on ~19% of documents and get
garbage. The branch must test for _usable Cyrillic_, not for the presence of a font.
(Same class as the Sofia council protokols — `project_sofia_council_per_councillor_unlock`.)

### 1.2 One in sixteen is not a PDF, and the reference implementation silently drops it

`9e7e6feb…` is `d0cf11e0a1b11ae1` — an OLE2 Compound Document written by Microsoft Office
Word (Code page 1251, created 2014-06-17), carrying **two embedded JPEG page scans** and
three characters of text.

- `write_hospital_revenue.ts`'s `fetchPdf` guards on `b.subarray(0,4) === "%PDF"`, so it
  **retries three times and returns null** — the document is dropped with no log line.
- **Gemini rejects it too**, with `400 … input token count exceeds the maximum allowed
1048576`: posted as `application/msword`, the 1.59 MB blob is not interpreted as a document.
- **Tesseract cannot open it** either (`pdftoppm` → "May not be a PDF file").

It _is_ recoverable. Extracting the embedded JPEGs by scanning for `FFD8FF` markers and
posting them as `image/jpeg` works — verified, Gemini returned
`{"company":"ГЕО - МАР 03 ЕООД","year":2013,"kind":"statement_of_changes_in_equity"}`.
So the ingest needs a **content-sniffing pre-step** (OLE2 → extract images → treat as pages),
not a `%PDF` gate. At 6.25% of documents this is worth ~8,600 documents at the full tier.

### 1.3 A ГФО is filed as SEVERAL documents, and 40% of them carry no income statement

> ⚠️ **SUPERSEDED IN PART (§11b.2).** At scale the rate is **1.21** documents per EIK-year,
> not 1.59, and **91% of EIK-years carry exactly one**. The multi-document case is a real
> minority, not the norm. The 40%-no-ОПР figure is untouched by that measurement.

This is the finding that most changes P3's shape. One `ActID` is one document, not one filing:

| document   | company / year    | what it actually contains                               |
| ---------- | ----------------- | ------------------------------------------------------- |
| `3fc26c93` | Строй-Авто 2018   | **balance sheet only** (АКТИВ ×2, ПАСИВ ×2)             |
| `b71c43f6` | Строй-Авто 2019   | **balance sheet only**                                  |
| `4264552f` | Спартак 2018      | **съкратен balance only** — see §1.4                    |
| `c52b7a3d` | Спартак 2019      | **balance only**; revenue disclosed in PROSE, see §1.5  |
| `8b632d98` | Еко Хидро-90 2021 | **cash-flow statement only**                            |
| `d3c45a65` | Еко Хидро 90      | **independent auditor's report** — no statements at all |
| `9e7e6feb` | Гео-Мар 03 2013   | equity statement + non-current-asset schedule           |

Measured against the TR daily open-data feed already on disk (`raw_data/tr/daily`, 182 files
from 2026, 42,345 EIKs, 584,251 ГФО-family acts): **1.59 acts per (EIK, ActYear)**; 71% of
EIK-years have one act, 20% have two, 9% have three or more.

So **"one ActID per EIK-year" under-collects**. Budget the document count as
`EIK-years × 1.6`, and expect to open documents that cannot answer the question — three of
the eight companies in this sample have **no income statement in any document sampled for
them**.

### 1.4 Some companies are legally entitled to publish no income statement at all

`4264552f` (Спартак ООД, FY2018) states it on its own cover page:

> „Съгласно чл. 38, ал. 4 от Закона за счетоводството предприятието е избрало да не публикува
> своя отчет за приходите и разходите."

Under чл. 19 ал. 3 / чл. 29 ал. 6 ЗСч a малко предприятие may publish a съкратен ГФО without
the ОПР. **This is not a fetch problem, a scan problem or an OCR problem — the number does
not exist in the register.** It bounds P3's maximum coverage independently of engine choice,
and it bites hardest exactly where the shell-winner detector is most wanted: small companies.

Neither engine can fix this and both handle it correctly — Gemini returns `found:false`,
Tesseract returns no match. What the ingest must do is **record the reason** (`opted_out`)
so "no denominator" is never rendered as "a small denominator". See §11.

### 1.5 The register contradicts itself, in one filing, and only a prose reader sees it

`c52b7a3d` (Спартак ООД, FY2019) has no ОПР table. Its cover page says:

> „През годината предприятието не е имало дейност и не е отчело приходи, разходи, печалба или
> загуба."

Its own Приложение, three pages later, says:

> „- продажба на услуги - 2 262 хил.лв / - други приходи - 25 хил.лв"

and its balance sheet shows Собствен капитал rising 338 → 473. The "no activity" sentence is
boilerplate the preparer did not delete. **A revenue figure is recoverable here, but only
from free-running prose** — which is an argument for a reading engine over a table parser, and
an argument for the ingest never treating a single sentence as authoritative. Both engines
correctly declined to emit a table figure here; neither was asked for the prose one.

---

## 2. The bakeoff — per document

Ground truth was established by reading the 150-DPI renders directly and cross-checking each
figure against the statement's own subtotals (§10 identity C). Values are **хиляди лева** as
printed. `—` means the document carries no ОПР and the correct answer is "not found".

**Engines.** `T-300` / `T-150` = Tesseract 5.5.3 `-l bul` over `pdftoppm` PNGs, plus the
purpose-built extractor described in §5. `G-3.5` / `G-3.7` = `gemini-3.5-flash` /
`gemini-3.7-flash`, native PDF input, `temperature: 0`. **A** = the anchored 4-field prompt
copied verbatim from `write_hospital_revenue.ts`. **B** = the capture-everything prompt (§8).

### 2.1 `Общо приходи` (total revenue) — the figure P3 needs

| document   | company · FY                  |  truth |     T-300 |        T-150 | G-3.5 A | G-3.7 A | G-3.7 B |
| ---------- | ----------------------------- | -----: | --------: | -----------: | ------: | ------: | ------: |
| `030fbef5` | 2Р България · 2016            |  9 977 |  ✅ 9 977 |     ✅ 9 977 |      ✅ |      ✅ |      ✅ |
| `29841207` | Нектон 2 · 2016               |  1 832 |  ✅ 1 832 |         ❌ 4 |      ✅ |      ✅ |      ✅ |
| `2d46f074` | Сезар Трейд · 2020            |  5 107 |     ❌ 11 |        ❌ 11 |      ✅ |      ✅ |      ✅ |
| `3b7d761b` | Енергомонтаж МК · 2023        |  8 351 |  ✅ 8 351 |       ❌ 779 |      ✅ |      ✅ |      ✅ |
| `5c954fae` | 2Р България · 2022            | 12 785 | ✅ 12 785 |        ❌ 10 |      ✅ |      ✅ |      ✅ |
| `ab4488e9` | Нектон 2 · 2013               |  2 716 |   ⚠️ null |      ⚠️ null |      ✅ |      ✅ |      ✅ |
| `cf11a8e9` | СЕ Спец. Енерготехника · 2023 |    819 |    ✅ 819 | ❌ **1 118** |      ✅ |      ✅ |      ✅ |
| `d1251970` | Сезар Трейд · 2021            |  4 793 |     ❌ −1 |        ❌ 11 |      ✅ |      ✅ |      ✅ |
| `e1cc030a` | Енергомонтаж МК · 2022        |  7 791 |  ✅ 7 791 |     ✅ 7 791 |      ✅ |      ✅ |      ✅ |
| `3fc26c93` | Строй-Авто · 2018             |      — |        ✅ |           ✅ |      ✅ |      ✅ |      ✅ |
| `4264552f` | Спартак · 2018                |      — |        ✅ |           ✅ |      ✅ |      ✅ |      ✅ |
| `8b632d98` | Еко Хидро-90 · 2021           |      — |        ✅ |           ✅ |      ✅ |      ✅ |      ✅ |
| `b71c43f6` | Строй-Авто · 2019             |      — |        ✅ |           ✅ |      ✅ |      ✅ |      ✅ |
| `c52b7a3d` | Спартак · 2019                |      — |        ✅ |           ✅ |      ✅ |      ✅ |      ✅ |
| `d3c45a65` | Еко Хидро 90 · audit          |      — |        ✅ |           ✅ |      ✅ |      ✅ |      ✅ |
| `9e7e6feb` | _(not a PDF)_                 |    n/a |        🚫 |           🚫 |  🚫 400 |  🚫 400 |  🚫 400 |

⚠️ = refused (null) where a value exists — a miss, not a wrong claim.
Bold = **silently plausible wrong number**, the dangerous class.

### 2.2 `Нетни приходи от продажби` — the same nine documents

| document   |  truth |        T-300 |      T-150 | G-3.5 A | G-3.7 A | G-3.7 B |
| ---------- | -----: | -----------: | ---------: | ------: | ------: | ------: |
| `030fbef5` |  9 770 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |
| `29841207` |  1 723 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |
| `2d46f074` |  4 703 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |
| `3b7d761b` |  8 277 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |
| `5c954fae` | 12 098 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |
| `ab4488e9` |  2 411 |      ⚠️ null |    ⚠️ null |      ✅ |      ✅ |      ✅ |
| `cf11a8e9` |    815 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |
| `d1251970` |  4 043 | ❌ **4 703** | ❌ **403** |      ✅ |      ✅ |      ✅ |
| `e1cc030a` |  6 934 |           ✅ |         ✅ |      ✅ |      ✅ |      ✅ |

### 2.3 Reporting year

Gemini returned the correct fiscal year on **9/9** ОПР documents and on **13/15** readable
documents overall under prompt B (the two exceptions are the auditor's report, which has no
fiscal year to report, and the non-PDF). Tesseract's year comes from a regex over the OCR'd
text and was correct on the ОПР documents it read, but it is not an engine property — it is
the same regex either way — so it does not discriminate and is not scored as a column.

### 2.4 Summary

Denominator = the **9 documents carrying an ОПР** for value fields; the **15 readable
documents** for "did it correctly decide whether an ОПР is present".

| engine · task                                 | ОПР present/absent | `Нетни приходи` | `Общо приходи` | silently-wrong figures |
| --------------------------------------------- | -----------------: | --------------: | -------------: | ---------------------: |
| **Gemini 3.7-flash · B (capture-everything)** |   **15/15 (100%)** |  **9/9 (100%)** | **9/9 (100%)** |                  **0** |
| Gemini 3.7-flash · A (anchored)               |       15/15 (100%) |      9/9 (100%) |     9/9 (100%) |                      0 |
| Gemini 3.5-flash · A (anchored)               |       15/15 (100%) |      9/9 (100%) |     9/9 (100%) |                      0 |
| Gemini 3.5-flash · B (capture-everything)     |        14/15 (93%) |       8/9 (89%) |      8/9 (89%) |          0 (1 refusal) |
| Tesseract 300 DPI                             |        14/15 (93%) |       7/9 (78%) |  **6/9 (67%)** |                      1 |
| Tesseract 150 DPI                             |        14/15 (93%) |       7/9 (78%) |  **2/9 (22%)** |                      3 |

**The accuracy delta on the decisive field is 33 points at 300 DPI (100% vs 67%) and 78
points at 150 DPI.**

---

## 3. Performance

Wall clock, single run, MacBook (12 cores), 2026-08-20. Tesseract totals **include
rasterisation**, since these are image-only PDFs and that step is not optional.

| stage                                                 |     300 DPI |     150 DPI |
| ----------------------------------------------------- | ----------: | ----------: |
| `pdftoppm` rasterise, 93 pages                        |     135.5 s |      40.4 s |
| `tesseract -l bul` (TSV, the config the parser needs) |     160.8 s |      96.2 s |
| **Tesseract end-to-end**                              | **296.3 s** | **136.6 s** |
| per page                                              |      3.19 s |      1.47 s |
| per document                                          |      19.8 s |       9.1 s |

| engine · task        |   total | per doc | per page |
| -------------------- | ------: | ------: | -------: |
| Gemini 3.7-flash · A |  52.4 s |   3.5 s |   0.56 s |
| Gemini 3.7-flash · B | 166.1 s |  11.1 s |   1.79 s |
| Gemini 3.5-flash · A |  77.3 s |   5.2 s |   0.83 s |
| Gemini 3.5-flash · B | 631.6 s |  42.1 s |   6.79 s |

Notes that matter for planning:

- **Gemini 3.7-flash is 3.8× faster than 3.5-flash on the capture-everything task** (11.1 s
  vs 42.1 s per document) and _more_ accurate. The gap is thinking tokens: 27,141 vs 134,918
  over the same 15 documents. This inverts the usual "older model is cheaper" intuition and
  matches the repo's existing note in `scripts/council/lib/gemini_ocr.ts`.
- Tesseract's 19.8 s/doc is **single-core**; it parallelises perfectly across documents, so
  on 12 cores it is ~1.65 s/doc of wall time. Gemini's 11.1 s/doc parallelises across
  concurrent requests. Neither is the bottleneck — **the rate-limited register fetch is**
  (§9).

### 3.1 DPI is not a free knob

150 DPI halves the cost and **destroys the answer**: `Общо приходи` accuracy falls from
6/9 to **2/9**, and the number of silently-plausible wrong figures rises from 1 to 3.
Two of those three are the worst possible shape:

- `cf11a8e9`: **1 118** against a true **819** (+36%) — it read the „Всичко (Общо приходи + Г)"
  decoy row (§7.3).
- `d1251970`: **403** against a true **4 043** — a 10× understatement, which on the shell-winner
  detector converts a normal company into a headline.

**If Tesseract were used at all it would have to be 300 DPI.** At 300 DPI it is 2.2× slower
than Gemini 3.7-flash on the capture task and still 33 points less accurate.

---

## 4. Cost

### 4.1 Measured token volumes — these are hard numbers from `usageMetadata`

Over the 15 readable documents / 93 pages:

| task · model      |      input |     output |   thinking | billable output |
| ----------------- | ---------: | ---------: | ---------: | --------------: |
| A · 3.7-flash     |     51,714 |        357 |      5,502 |           5,859 |
| A · 3.5-flash     |     51,714 |        357 |      9,859 |          10,216 |
| **B · 3.7-flash** | **55,389** | **61,620** | **27,141** |      **88,761** |
| B · 3.5-flash     |     55,389 |     66,103 |    134,918 |         201,021 |

Fitting input tokens against page count across the sample (1, 2, 4, 5, 10 and 20-page
documents) gives an exact linear law:

> **input tokens = 532 × pages + prompt overhead** (150 tokens for prompt A, 214 for prompt B)

**532 tokens per scanned A4 page**, measured — worth recording because it is roughly double
the 258/page figure usually quoted for PDF pages, and it is what makes the input side
predictable enough to budget.

Per 1,000 documents at this sample's 6.2 pages/document:

| task · model      |      input | billable output |
| ----------------- | ---------: | --------------: |
| A · 3.7-flash     |     3.45 M |          0.39 M |
| **B · 3.7-flash** | **3.69 M** |      **5.92 M** |
| B · 3.5-flash     |     3.69 M |         13.40 M |

### 4.2 Dollars — a band, because the rate is unverified

⚠️ **I could not verify the list price for `gemini-3.5-flash` / `gemini-3.7-flash`.** No
pricing page was consulted and the repo records no rate card. Everything below is the measured
token volume multiplied by a **stated assumption that must be confirmed before it is quoted to
anyone.**

**Anchor 1 — an assumed rate.** Applying **$0.30 / 1M input and $2.50 / 1M output**:

```
task B, per 1,000 documents = 3.69 × 0.30 + 5.92 × 2.50 = $1.11 + $14.80 = $15.91
task A, per 1,000 documents = 3.45 × 0.30 + 0.39 × 2.50 = $1.04 + $0.98  =  $2.01
```

**Anchor 2 — the repo's own measurement.** `scripts/council/lib/gemini_ocr.ts` records
`gemini-3.7-flash` at **132 scanned pages for $0.65** = **$0.004924/page**, on a
comparable scan-to-structured-output task. At 6.2 pages/document that is
**$30.5 per 1,000 documents**.

The two anchors bracket the answer. **Use $16–$31 per 1,000 documents for the
capture-everything pass** and re-derive it from a confirmed rate card before committing.

**Tesseract's dollar cost is zero** and its CPU cost is 27.5 CPU-hours per 1,000 documents at
300 DPI (5.5 hours on 5 cores). The saving is real. It buys a 67%-accurate revenue column.

### 4.3 The anchored prompt is 8× cheaper and must not be used

Prompt A costs ~$2/1,000 documents against ~$16–31 for prompt B — a 8–15× saving, and it is
the wrong trade for three independent reasons:

1. it violates the capture-everything requirement outright (§8);
2. it forfeits the arithmetic validator, which needs sibling rows to cross-foot (§10) — with
   four fields there is nothing to check anything against;
3. it saves nothing on the expensive half: input tokens are ~94% identical either way
   (3.45 M vs 3.69 M per 1,000 docs), because **you pay to look at the page regardless**. The
   whole delta is output tokens, i.e. the data you actually wanted.

---

## 5. What "Tesseract" means here — six parser revisions, and why that is the finding

Tesseract emits text; something must turn text into `{year, netSales, totalRevenue}`. The
comparison is only fair if that something is competently written, so it was written six times.
Each revision is a real defect found by measurement, not tuning:

| rev    | change                                                                       |                                                  `Общо приходи` |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------: | --- |
| v1     | anchored regex over plain text, digit-count grouping for the thousands space |                                                             5/9 |
| v2     | strip OCR noise (`!`, `                                                      | `, `[`); suppress `код на реда`; numbers must follow the anchor | 4/9 |
| v3     | **geometry**: merge numeric words by horizontal gap, not by digit count      |                                                             6/9 |
| v4     | column clustering + refuse-if-not-in-current-column                          |                                              2/9 (over-refused) |
| v5     | v3 + treat the cleaned token as the value everywhere                         |                                                             6/9 |
| **v6** | **detect the `код` form from the header text, not the digit distribution**   |                                                         **6/9** |

Two of those revisions are worth recording because the bug is not obvious and both produced
**silently wrong revenue figures**:

- **v2's `код на реда` suppression collided with the revenue value range.** The rule "a
  leading 5-digit token in 10000–19999 is a row code, not a value" is correct for the coded
  form — and `12 098 хил.лв` of revenue is _also_ in 10000–19999. On `5c954fae` the parser
  discarded the true revenue and published the **prior-year** column instead.
- **The form detector was fooled by the amounts.** Detecting the coded form by counting
  5-digit numbers starting with `1` classifies the _uncoded_ 2Р България form as coded,
  because `12098`, `13704`, `12785`, `12217` all match. Fixing it needs the literal header
  text — which Tesseract reads as `Кодна` on one page and `код на реда` on another.

**After six revisions it is still 67%.** The remaining failures are not parser bugs: on
`d1251970` Tesseract read the current-year cell `4 043` as the word `По` and the only number
on the row is the prior year; on `ab4488e9` it emitted the two panels' cells out of document
order, so the numbers precede their labels. No parser recovers either.

**Gemini required one prompt and zero revisions.** That asymmetry — six iterations to 67%
versus one to 100% — is a larger part of the recommendation than the accuracy delta.

---

## 6. Does whole-table capture change the ranking?

**This is the crux the brief asked to measure rather than assume. It does not change the
ranking, and it widens the gap.**

|                   | anchored (A) |                            capture-everything (B) |
| ----------------- | -----------: | ------------------------------------------------: |
| Gemini 3.7-flash  |          9/9 |                               **9/9**, 1,779 rows |
| Gemini 3.5-flash  |          9/9 |                               **8/9**, 1,481 rows |
| Tesseract 300 DPI |          6/9 | not implementable without per-form parsers (§8.3) |

Three measured observations:

- **3.7-flash holds at 100% on the harder task.** 1,779 rows over 93 pages — 118.6 rows per
  document, 19.1 rows per page — across five statement kinds (`balance_assets`,
  `balance_equity_liabilities`, `opr`, `cashflow`, `equity`, plus `spravka`).
- **3.5-flash loses a document to the harder task.** On `ab4488e9` — the worst scan in the
  sample, the one Tesseract also fails — it answered the anchored prompt correctly and
  returned `found:false` with **zero rows** for the full-table prompt. The harder task has a
  real cost, and 3.5-flash pays it. It failed _safely_ (a refusal, not a number), which is the
  right direction, but it is a 1-in-15 coverage loss for no saving: 3.5-flash is also 3.8×
  slower and 2.3× more expensive on output.
- **Every capture reconciles.** All four cross-foot identities pass on all nine ОПР documents
  under 3.7-flash, and the balance-sheet identity passes **13/13** on documents that have one
  (§10). A capture that reconciles is evidence the columns were not confused.

**Recommendation: `gemini-3.7-flash`, prompt B.** `gemini-3.5-flash` — the model the
hospital script pins — is worse on every axis measured here.

---

## 7. Failure modes

### 7.1 Gemini

**Observed on this sample: refusal only, never a wrong number.** Zero incorrect figures across
60 model-document extractions (2 models × 2 tasks × 15 documents). The two failure shapes seen:

| shape                                                      | frequency                                | severity                                     |
| ---------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `{"found": false}` + zero rows on a document that has data | 1/60 (3.5-flash, task B, worst scan)     | **Safe** — a hole, and the ingest can see it |
| HTTP 400, input rejected                                   | 1/16 documents (the non-PDF, all models) | **Safe** — loud, and fixable (§1.2)          |

Every response parsed as JSON on the first attempt; `finishReason` was `STOP` on all 60 — no
truncation, despite task-B outputs reaching 8,572 tokens.

**Unmeasured risk.** This is a 15-document sample. It cannot bound the rate of confident
hallucination on scans worse than any here, and a plausible-but-invented revenue figure is the
single worst outcome for P3. The validator in §10 exists for exactly that residual, and the
hand-checked sample in §10.4 is what would put a number on it.

### 7.2 Tesseract

**Both shapes, and the wrong-number shape dominates the useful cases.**

| shape                                      | example                                   | severity                                                          |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| **Prior-year column published as current** | `d1251970`: 4 703 vs true 4 043 (+16%)    | **Worst** — plausible, and invisible to arithmetic checks (§10.2) |
| **Decoy row published as revenue**         | `cf11a8e9` @150: 1 118 vs true 819 (+36%) | **Worst** — see §7.3                                              |
| **Order-of-magnitude digit slip**          | `d1251970` @150: 403 vs true 4 043 (10×)  | Bad, but detectable by cross-foot                                 |
| Obvious garbage                            | `2d46f074`: 11; `d1251970`: −1            | Benign — any sanity floor rejects it                              |
| Silent refusal                             | `ab4488e9`: null                          | Benign                                                            |

### 7.3 The two traps that produce a plausible wrong revenue

Both are properties of the forms, not of Tesseract, and any engine must be checked against
them:

- **„Всичко (Общо приходи + Г)" is not total revenue.** On the coded form the bottom line
  adds the year's _loss_ back to revenue, so for a loss-making company it exceeds `Общо
приходи`. `cf11a8e9`: `Всичко` = 1 118 against `Общо приходи` (код 18000) = **819** — a
  +36% overstatement available to anyone who reaches for the largest number at the foot of
  the table. Gemini took 819 on every run; Tesseract took 1 118 at 150 DPI.
- **The space is a thousands separator and it is genuinely ambiguous.** Tesseract reads
  `1 723   2 963` as the tokens `1 723 2 963`, and `815   727` — one number per column —
  looks identical to a separated `815 727`. Digit counting cannot resolve it; only the
  horizontal gap can (v3 above). Measured: `9 770` renders with a 10 px inter-token gap
  against 152 px between columns, so geometry separates them cleanly — but only if the
  pipeline keeps coordinates. **Gemini was given no coordinates and got every one right.**
- **Values are in хиляди лева.** Every document in the sample declares `Сума (хил. лв.)`, and
  Gemini returned `unit: "хил. лв."` on 13/13 documents that carry a statement. Nothing may
  assume the unit — the ingest must store what was declared and multiply at read time.
  (Pre-2026 filings are in лв; convert at the locked peg 1.95583 per `feedback_bg_uses_eur`.)

---

## 8. The capture-everything schema

### 8.1 Principle

**Store every `(код на реда, label, current, prior)` tuple the engine can see, from every
statement, with page provenance — including fields with no consumer today.** The OCR pass is
the expensive, rate-limited, non-repeatable step; a second pass to recover equity or employee
counts would cost the whole crawl again. The hospital script's `{found, year, totalRevenue,
netSales}` is exactly the shape not to repeat: equity and employee counts, both named in P3,
live in the balance sheet and a separate справка that prompt A never looks at.

### 8.2 The prompt's return shape (as measured, not as proposed)

```jsonc
{
  "found": true,
  "reportYear": 2023, "priorYear": 2022,
  "unit": "хил. лв.",                 // as PRINTED — never assumed
  "eik": "200704049", "companyName": "СЕ СПЕЦИАЛНА ЕНЕРГОТЕХНИКА ООД",
  "statements": [
    { "kind": "opr", "page": 6,
      "rows": [ { "code": "15100", "label": "Нетни приходи от продажби",
                  "current": 815, "prior": 727 }, … ] }
  ]
}
```

`kind` ∈ `opr | balance_assets | balance_equity_liabilities | cashflow | equity | spravka |
other`. All seven were exercised on this sample.

### 8.3 Storage — follow the `cr_deeds.sqlite` precedent

Yes: a gitignored durable SQLite capture at `raw_data/tr/gfo.sqlite`, with offline projections
reading it without re-fetching, exactly as `docs/plans/cr-deeds-capture-v1.md` describes for
the deeds corpus. Four reasons it is the right shape here: the crawl is rate-limited and
non-repeatable; two independent projections are already foreseen (financial capacity, and the
`company_public_money` denominator); the raw capture must survive a change of mind about which
fields matter; and it must never be bucket-synced (a PG load source on a bucket nobody reads
is the shape that once pushed ~16.8k company-connection shards — see CLAUDE.md).

Suggested tables — the raw capture, plus the document-level facts needed to explain a hole:

```sql
gfo_document(act_id PK, eik, act_year, fetched_at, http_status, content_kind,
             page_count, engine, model, prompt_version,
             found, report_year, prior_year, unit, company_name,
             absence_reason,          -- 'opted_out_38_4' | 'no_opr_in_document'
                                      -- | 'auditor_report' | 'not_a_pdf' | NULL
             in_tokens, out_tokens, wall_ms, raw_json)
gfo_row(act_id, statement_kind, page, seq, code, label, current, prior,
        PRIMARY KEY (act_id, statement_kind, seq))
gfo_check(act_id, identity, lhs, rhs, passed)   -- §10, materialised at ingest
```

Measured footprint, built by loading the real 1,779 captured rows into SQLite with an
`act_id` index: **175 bytes/row**, 118.6 rows/document → **20.8 KB per document**.

| tier                   | documents |       rows | SQLite, uncompressed |
| ---------------------- | --------: | ---------: | -------------------: |
| top-1,000 contractors  |     5,000 |    593,000 |           **104 MB** |
| top-5,000 contractors  |    25,000 |  2,965,000 |           **519 MB** |
| all 27,531 contractors |   138,000 | 16,366,800 |           **2.9 GB** |

For scale, `raw_data/tr/cr_deeds.sqlite` already sits alongside it. 2.9 GB is comfortable for
a gitignored local store; store `raw_json` compressed or drop it once `gfo_row` is populated
if that matters. **Do not upload any of it** — add the exclusion at the same time as the
store, per the `bucket_sync_paths.ts` rule.

⚠️ **`ActYear` from the TR feed is not a fiscal year and must not be stored as one.** Measured
over 1.48 M acts, the field contains `2100`, `2910`, `3165`, `4556`, `7876` and similar — a
small share (~0.005%), but it is unvalidated free text. **The fiscal year to trust is the one
read off the document** (`reportYear`), which Gemini returned correctly on 13/13. Keep
`act_year` as provenance only.

---

## 9. Scope tiers

Using **`gemini-3.7-flash`, prompt B**, at the measured 11.1 s/document and $16–31 per 1,000
documents. The document counts are the brief's tiers; §1.3's measured **1.59 acts per
(EIK, ActYear)** is what converts EIK-years into documents.

| tier            |   EIKs | documents |            OCR cost | OCR wall (8 concurrent) |  store |
| --------------- | -----: | --------: | ------------------: | ----------------------: | -----: |
| top-1,000 by €  |  1,000 |    ~5,000 |      **$80 – $153** |                  ~1.9 h | 104 MB |
| top-5,000 by €  |  5,000 |   ~25,000 |     **$398 – $763** |                  ~9.6 h | 519 MB |
| all contractors | 27,531 |  ~138,000 | **$2,196 – $4,212** |                   ~53 h | 2.9 GB |

`contracts` at `tag='contract'` currently holds **27,534** plain 9/13-digit contractor EIKs
(local PG, 2026-08-20), matching CLAUDE.md's 27,531.

**The OCR is not the bottleneck and the cost is not the risk — the fetch is.** Nothing was
fetched for this bakeoff, so the crawl rate is **unmeasured**. The comparable in-repo figure is
the CR Deeds capture at ~26 h for its tier, and `portal.registryagency.bg/CR/api/Documents/`
is WAF-guarded (node/undici's TLS fingerprint 500s; the hospital script uses `curl` for exactly
that reason). At even 1 request/second, 138,000 documents is 38 hours of fetching, and it is
prudent to assume worse. **Start at the top-1,000 tier**, which is a few hundred dollars and
a day or two of crawling, and which covers the contractors whose € actually make the
shell-winner claim worth publishing.

Expected yield, from this sample's rates: **60% of documents carry an ОПР**, so ~5,000
documents yields on the order of 3,000 income statements — before §1.4's statutory opt-outs
are subtracted. Both rates come from a 15-document sample and should be re-measured on the
first 500 documents of the real crawl before the full tier is committed.

---

## 10. The validation problem

The hospital run's gate — drop a read when same-year НЗОК payments exceed 1.15× the OCR'd
revenue — **cannot be ported**, and the reason is structural rather than technical: for a
general contractor the analogous check is procurement receipts against revenue, which _is the
finding_. A real shell winner and an OCR misread produce the identical signal, so a gate on
that ratio would delete precisely the rows P3 exists to surface.

Four replacements, in the order they should be built. The first two are free and were measured
here; the third and fourth are proposals.

### 10.1 Cross-field arithmetic — free, engine-agnostic, and the primary gate

Four identities the statements assert about themselves. Measured on the nine ОПР documents
under 3.7-flash prompt B:

| id    | identity                                                                                                                                    |                             coverage |      pass |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------: | --------: |
| **A** | `Всичко (Общо приходи)` = `Всичко (Общо разходи)`                                                                                           |                                  9/9 |   **9/9** |
| **B** | `Общо приходи` − `Общо разходи` = `Счетоводна печалба/загуба` (±1)                                                                          |                                  7/9 |   **7/7** |
| **C** | `Нетни приходи` + `Увеличение на запасите` + `Придобиване по стопански начин` + `Други приходи` = `Общо приходи от оперативна дейност` (±2) |                                  9/9 |   **9/9** |
| **D** | `СУМА НА АКТИВА` = `СУМА НА ПАСИВА`                                                                                                         | 13/13 documents with a balance sheet | **13/13** |

**Sensitivity, measured by mutation** — corrupt one captured value, re-run the identities, and
count only cases where the baseline passed and the mutant fails:

| injected error                               |       detected |
| -------------------------------------------- | -------------: |
| `Нетни приходи` × 10                         | **8/8** (by C) |
| `Нетни приходи` ÷ 10                         | **8/8** (by C) |
| `Общо приходи` × 10                          | **7/7** (by B) |
| single-cell −0.6% (a `727`→`721` digit slip) | **8/8** (by C) |

⚠️ **My first attempt at this mutation test was vacuous** and is recorded so nobody repeats it:
identity C failed at _baseline_ on 8/9 documents because of a bug in my own label regex, so
"detected 8/8" was measuring my bug, not the mutant. A mutation check that does not first
assert the baseline passes proves nothing. (Same idiom, and the same trap, as the mutation
checks in `declaration_foreign_assets.data.test.ts`.)

**These identities exist only because the capture is complete.** With prompt A's four fields
there is nothing to cross-foot. This is the concrete link between the architectural
requirement (§8) and the validation problem: **capture-everything is what buys the free gate.**

### 10.2 ⚠️ The gate's blind spot, measured — and it is exactly Tesseract's failure

| injected error                                   |      detected |
| ------------------------------------------------ | ------------: |
| **whole prior-year column published as current** | **3/9 (33%)** |

A shifted column is _internally consistent_: every identity still balances, because every term
shifted together. The three detections are partial-shift artifacts, not the check working.

So identity checking covers Gemini's plausible failure mode (a single mis-read cell) and does
**not** cover Tesseract's dominant one (a column swap). **The validator's power is a function
of which engine you pick**, which is an independent reason to pick the one whose errors it can
see.

### 10.3 Cross-year overlap — the check that does cover column shift

Filing Y's `prior` column must equal filing Y−1's `current` column. This is only possible
because the schema stores `prior` — another dividend of capture-everything. Measured on the
three consecutive-year company pairs in the sample:

| pair                        | comparable rows |         agree |
| --------------------------- | --------------: | ------------: |
| Сезар Трейд 2020 → 2021     |              59 |  54 (**92%**) |
| Енергомонтаж МК 2022 → 2023 |              62 |  60 (**97%**) |
| Строй-Авто 2018 → 2019      |              42 | 42 (**100%**) |

The eleven mismatches are informative rather than alarming: most are row-label drift between
two years' form layouts (`общо за група II` vs `III`), one is a genuine 1-unit restatement
(`3 739` → `3 740`), and none is on a headline revenue row. **Match on `код на реда` where the
form has one and fall back to a folded label otherwise**; a mismatch on a _headline_ row is the
signal, and it fires on a column shift by construction. Note this check is unavailable for a
company's first captured year and for gaps in the filing history.

### 10.4 A hand-checked sample with a stated error rate — do this, and publish the number

The three checks above are all _internal consistency_. None can catch a capture that is
self-consistent and wrong. The only instrument that bounds that is a human reading documents.

**Proposal: after the first 500 documents of the real crawl, hand-check a random 100 and
publish the measured error rate in the page's own methodology note.** This bakeoff is a
16-document version of exactly that exercise and produced `0/9` errors for the recommended
engine — enough to justify building, nowhere near enough to justify a claim about a named
company. A 100-document check bounds the error rate at roughly ±3 points, which is the
resolution needed before publishing "won €X against €Y of turnover" about anyone.

### 10.5 What the ingest should do with a failed check

**Withhold the figure and record the reason — never publish a figure that failed a check, and
never silently drop one.** `gfo_check` stores the identity, both sides and the verdict, so a
withheld company-year can say _why_. This matters more here than in most of the repo: the
consumer claim is "this named company won more public money than its entire turnover", and a
wrong denominator makes that claim defamatory rather than merely inaccurate.

---

## 11. Recency — how to represent a corpus that is structurally thin at the recent end

Late filing is normal, and the recent-year thinness is not a coverage bug. Measured against
the 182 daily TR feed files from 2026 (feed current to **2026-08-07**), counting ГФО-family
acts per fiscal year over 42,345 EIKs:

| fiscal year |       acts | share of the FY2023 peak |
| ----------- | ---------: | -----------------------: |
| 2019        |     42,868 |                      77% |
| 2021        |     47,260 |                      85% |
| 2022        |     50,174 |                      91% |
| **2023**    | **55,373** |                 **100%** |
| 2024        |     32,273 |                  **58%** |
| 2025        |      5,897 |                  **11%** |
| 2026        |          8 |                       0% |

FY2025's statutory publication deadline (30 September 2026) has not passed at the time of
writing, so **FY2025 is 11% filed and will keep filling for a year**. The shape matches the
hospital run's coverage (2019:118 … 2023:86, 2024:43, 2025:2) precisely.

**Three rules so "no denominator yet" never renders as "a small denominator":**

- **A missing year is `NULL`, never `0`, and never carried forward.** Absence must be a
  distinct state from a filed zero. This is the same rule as `held_scope`'s tri-state and
  `value_basis`'s NULL in CLAUDE.md, and for the same reason: a boolean would have to invent
  the third answer.
- **The reason for absence is stored, and the UI says which one.** Four distinguishable
  cases, all observed in this 16-document sample: _not filed yet_ (the recency ramp — the
  honest label is „ГФО за 2025 г. още не е обявен"), _lawfully not published_ (§1.4, чл. 38
  ал. 4 — „предприятието не публикува ОПР"), _filed but no ОПР in the documents we hold_
  (§1.3), and _read failed a consistency check_ (§10.5). Only the first improves with time.
- **Every ratio names its year, and no ratio silently reaches back.** „Спечелил €X при оборот
  €Y **за 2023 г.**" — with the procurement € taken from the _same_ year. Comparing 2025
  contract money against a 2022 denominator (the newest we hold) is how a normal company
  becomes a headline, and it is the single easiest error to make here. If the year cannot be
  matched, publish neither side of the ratio.

A companion **coverage tile** — filings per fiscal year, as the table above — makes the ramp
visible rather than something a reader has to infer, in the same spirit as `ted_coverage`
keeping TED's index ramp visible instead of storing a misleading zero.

---

## 11b. Open questions resolved by measurement (2026-08-20, audit pass)

Three of §12's ten were closed. Two of the three **contradict figures used elsewhere in this
plan**; the corrected numbers are below and the affected sections are annotated.

### 11b.1 ⚠️ The register enforces an explicit document limit — §12.2, RESOLVED

`/CR/api/Documents/{ActID}` was probed with 82 real requests. It does not block at a polite
rate, and it **does** push back above one:

| shape                          | result                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| sequential, 1 s delay, 30 reqs | **30/30 → 200.** latency p50 **4.72 s**, p90 16.13 s, max 34.50 s |
| concurrency 3, 20 reqs         | **20/20 → 200**, 40.6 s → **1,772 docs/hour**                     |
| concurrency 6, 20 reqs         | 13 × 200, **7 × 302**                                             |
| concurrency 8, 12 reqs         | 3 × 200, **9 × 302**                                              |

⚠️ **The 302 target is `https://portal.registryagency.bg/CR/DocumentLimit`** — a named
rate-limit page, not an incidental redirect. It recovers on its own: an id that 302'd returned
200 (797 KB) on a rested single request minutes later.

**Two consequences, and the first is a correctness rule, not a tuning note.**

- **A crawler MUST treat the 302 as a REFUSAL, never as a fetch.** `curl` without `-L` writes a
  zero-byte file and exits 0; with `-L` it writes an HTML limit page whose bytes are not a PDF.
  Either way an unchecked crawler stores a non-document and moves on. This is the same
  invariant the CR Deeds capture is built on — _an answer and a failure must never share a
  representation_ — and here the failure is a **200-shaped success** one redirect away. Check
  the status, and check the `%PDF` magic, and treat `DocumentLimit` as backoff-and-retry rather
  than as a permanent absence.
- **Concurrency 3 is the measured safe ceiling.** 6 already trips it.

**Schedule at the safe rate (1,772 docs/hour), using the corrected 1.21 docs/EIK-year:**

| tier      | EIKs   | documents | fetch time         | download    |
| --------- | ------ | --------- | ------------------ | ----------- |
| top-1,000 | 1,000  | ~6,050    | **~3.4 h**         | ~10 GB      |
| top-5,000 | 5,000  | ~30,250   | **~17 h**          | ~50 GB      |
| all       | 27,531 | ~166,600  | **~94 h (4 days)** | **~280 GB** |

⚠️ The **fetch, not the OCR, is the schedule** — as §12.2 suspected. At the full tier it is four
days of crawling against a register that publishes a limit page, versus a few hours of OCR.

⚠️ **Mean document size is unsettled and matters at scale.** This probe's 30 documents averaged
**1,728 KB**; the 16-document bakeoff sample averaged ~720 KB. The download column above uses
the larger figure deliberately. Two samples of 30 and 16 do not settle a mean this skewed
(§1 records a 89 KB → 7.7 MB spread) — measure it on the first real tier.

### 11b.2 ⚠️ 1.21 documents per EIK-year, not 1.59 — §12.5, RESOLVED

Measured over **40 daily feed files**: **327,107 distinct ГФО ActIDs across 269,948 (EIK,
ActYear) pairs = 1.21 documents per EIK-year**, median 1, p90 1, max 54.

**91% of EIK-years (245,481 of 269,948) carry exactly ONE ГФО document.** So §1.3's framing —
"a ГФО is filed as SEVERAL documents" — is true of a small minority, not of the corpus. The
1.59 figure came from 16 documents over 8 companies and does not survive scale.

That lowers every document count by ~24% against the 1.59 assumption, and it means a
per-EIK-year fetch loop is usually a single request. Attribution was verified non-vacuously:
the chunked pass attributed 327,116 acts against 327,107 distinct ActIDs found without
chunking — essentially complete, and the apparent 14% gap in a first check was an artefact of
counting the same ActID once per daily file it reappears in.

### 11b.3 The cost anchor is real — §12.1, PARTIALLY resolved

`scripts/council/lib/gemini_ocr.ts:6` does record it: _"protokol 65: 132 scanned pages cost
$0.65"_ → **$0.004924/page**, on `gemini-3.7-flash` — the same model this plan recommends, on a
comparable scan-to-structured-output task, measured 2026-08-17. §4.2's Anchor 2 is sound.
(A grep for the literal `0.004924` finds only this plan: the repo stores the two inputs, not
the quotient.)

**Still unresolved:** the list price itself. Anchor 1 remains an assumption. The band stands.

---

## 12. What I could NOT determine

Listed explicitly so none of it is mistaken for measured.

1. ~~**The Gemini list price.**~~ **PARTIALLY RESOLVED — §11b.3.** The repo's Anchor-2
   measurement is real and verified; the list price itself is still unconfirmed. Original note: No rate card was consulted and the repo records none. §4.2's
   dollar figures are token volumes (hard) × an assumed rate (soft), bracketed by the repo's
   own $0.004924/page measurement. **Confirm the rate before quoting any cost.**
2. ~~**The fetch rate and block behaviour of `/CR/api/Documents/{ActID}`.**~~ **RESOLVED —
   §11b.1: safe at concurrency 3 (1,772 docs/hour), a named `DocumentLimit` 302 above it, and
   the fetch is the schedule at every tier.** Original note: Nothing was fetched.
   The crawl, not the OCR, sets the schedule for every tier in §9, and it is entirely
   unmeasured here.
3. **Gemini's hallucination rate.** Zero errors in 60 model-document extractions is consistent
   with anything up to a few percent at this sample size. §10.4 is how to bound it.
4. **Whether 100% survives contact with worse scans.** All 15 readable PDFs were legible to a
   human at 150 DPI. A corpus-wide crawl will surface faxed, skewed and photocopied filings
   that this sample does not contain.
5. ~~**The real ОПР yield per EIK-year.**~~ **HALF RESOLVED — §11b.2 settles the documents
   half at 1.21/EIK-year (91% single). The ОПР-presence half still needs documents opened.**
   Original note: This sample gives 60% of documents and 1.59 documents
   per EIK-year, from 16 documents over 8 companies. The interaction — how often _some_
   document for an EIK-year carries an ОПР — needs a few hundred documents to estimate.
6. **The statutory opt-out rate (§1.4).** One document in sixteen invoked чл. 38 ал. 4. That
   is 6% ± a great deal, and it is a hard ceiling on coverage for small companies, so it is
   worth measuring early.
7. **Whether a coded-form share exists worth exploiting.** Only 1 of 9 ОПР documents carried
   the `код на реда` column (`15100`/`18000`). The hospital prompt anchors on those codes and
   they are **absent from 8 of 9** — it works only via its abbreviated-label fallback. Whether
   the coded form is more common corpus-wide is unknown.
8. **Employee counts.** Named in P3, live in a separate справка, and **no document in this
   sample contained one**. Prompt B would capture it if present; that it is not present here
   is not evidence that it is rare.
9. **Tesseract at 600 DPI, with deskew/binarisation preprocessing, or with a fine-tuned `bul`
   model.** Only 150 and 300 DPI with stock `bul` were measured. Preprocessing would likely
   help the two documents it failed on. It would not change the recommendation — 300 DPI
   Tesseract is already slower than Gemini per document — but the headroom is unquantified.
10. **`gemini-flash-lite`.** Not tested. If the price band in §4.2 turns out to be the binding
    constraint at the 138,000-document tier, that is the first thing to measure.

---

## 13. Recommended next steps

1. **Confirm the rate card** and replace §4.2's band with a number. (Anchor 2 is verified —
   §11b.3 — so the band is sound; only the list price is missing.)
2. ~~Probe the fetch~~ — **DONE, §11b.1.** Safe rate is concurrency 3 ≈ 1,772 docs/hour; above
   it the register 302s to a named `DocumentLimit` page. The crawler must treat that 302 as a
   refusal, not a fetch — unchecked, it stores a non-document at a 200-shaped success.
3. **Build the capture store** (`raw_data/tr/gfo.sqlite`, §8.3) with the sync exclusions in
   place from the first commit, and the four identity checks materialised into `gfo_check`
   at ingest (§10.1).
4. **Run the top-1,000 tier** (~5,000 documents, $80–153, ~2 h of OCR), then **hand-check 100
   at random and publish the error rate** (§10.4).
5. Only then wire the projections: the financial-capacity test, and the
   `company_public_money` denominator.

**Engine: `gemini-3.7-flash`, prompt B (capture-everything), native PDF input,
`temperature: 0`, with an OLE2 content-sniffing pre-step.** Not `gemini-3.5-flash` — the model
the hospital script pins is 3.8× slower, 2.3× more expensive on output, and lost a document on
the harder task.
