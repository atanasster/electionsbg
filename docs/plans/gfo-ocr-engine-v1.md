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

Cost at the top-1,000 tier (~9,600 documents), capture-everything: **$155–$300** — a band,
because the list price is the one thing here I could not verify (§4.2).

⚠️ **That figure is double the `$80–$153` this section carried until the 2026-08-21 audit pass**,
which found the tier's document count under-budgeted 1.7× — the corrected rate is §11d.1, and
every tier table below has been re-derived from it.

⚠️ **THE ENGINE VERDICT IS UNCHANGED BY THAT AUDIT. EVERYTHING DOWNSTREAM OF IT MOVED.** The
bakeoff answered _which OCR engine_, and that answer stands on its own measurements. It did not
answer three questions the feature cannot ship without, each now a section of its own:

| question                                          | section  | worst case if skipped                                 |
| ------------------------------------------------- | -------- | ----------------------------------------------------- |
| how is the list of documents to fetch BUILT?      | **§11d** | the named source covers 34% of the tier               |
| what is the extracted figure COMPARED AGAINST?    | **§11e** | a false claim about a named company, every gate green |
| where does the corpus LAND, and who refreshes it? | **§11f** | a local-only capture nothing serves                   |

§11e is the one to read first. Two of its four findings publish a wrong headline about a real
company with every check in §10 passing.

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
>
> ⚠️ **AND SUPERSEDED AGAIN FOR EVERY TIER THIS PLAN ACTUALLY RUNS (§11d.1).** 1.21 is the
> CORPUS mean and the corpus is micro-companies. The **top-1,000 contractors file 2.13**
> documents per EIK-year, and only 62% of their EIK-years are single-document against 87–91%
> corpus-wide. Both numbers are correctly measured; they describe different populations. Apply
> the one matching the population being fetched, and never the headline — the tier this plan
> starts with is selected precisely for being atypical.

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

  ⚠️ **This is the trap with the worst consequence and the weakest defence, and §10's
  validator cannot see it at all — see §10.2b.** A misread unit is a uniform ×1000 (хил. лв.
  read as лв.) or ×1.96 (лв read as EUR across the 2026 changeover) on every figure in the
  document, and every identity in §10.1 survives it untouched. It needs a canonical unit
  vocabulary and an EXTERNAL magnitude check, neither of which exists yet.

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

⚠️ **`kind` IS NOT ENOUGH — CONSOLIDATED AND INDIVIDUAL STATEMENTS ARE BOTH `opr`.** A group
files both an индивидуален and a консолидиран ГФО, and the consolidated one includes every
subsidiary's revenue. Picking the wrong one silently changes the denominator by whatever the
group is worth, in the direction that makes a real finding disappear. No document in this
16-document sample was consolidated, which is not evidence of rarity — it bites hardest on
exactly the large groups tier 1 is made of. The capture needs a second axis
(`basis` ∈ `individual | consolidated | unknown`), read from the statement's own heading
(„консолидиран" / „индивидуален"), and a consumer must never sum across it.

⚠️ **`unit` is FREE TEXT and drives a ×1000 multiplier.** Store the printed string verbatim
AND a canonical `unit_scale` (1 | 1000) × `unit_currency` (BGN | EUR) resolved by one shared
rule, in the shape `canonicalCurrency` / `normCurrency` take in CLAUDE.md's `value_basis`
section — same corpus, same hand-typed Cyrillic homoglyph problem. Refuse an unresolvable
unit rather than defaulting it: defaulting to `хил. лв.` is a 1000× publication risk on any
document that departs from the norm, and §10 cannot catch it (§10.2b).

### 8.3 Storage — follow the `cr_deeds.sqlite` precedent

Yes: a durable SQLite capture with offline projections reading it without re-fetching, exactly
as `docs/plans/cr-deeds-capture-v1.md` describes for the deeds corpus. Four reasons it is the
right shape here: the crawl is rate-limited and non-repeatable; two independent projections are
already foreseen (financial capacity, and the `company_public_money` denominator); the raw
capture must survive a change of mind about which fields matter; and it is far too large to
serve from.

⚠️ **The location is `/Volumes/Storage/gfo/` (§11c.1), NOT `raw_data/tr/gfo.sqlite`** — this
section said the latter and §11c.1 said the former, in the same document. §11c.1 is the decision:
the PDFs alone are 17 GB at tier 1 and ~310 GB at full scope, which is not something to put on
the boot volume. `raw_data/tr/` keeps only the `cr_deeds.sqlite` precedent, not this store.

⚠️ **"It must never be bucket-synced" needs no exclusion, and writing one is dead config.**
`bucket:sync` / `bucket:sync:dry` take `data` as their sync ROOT (`package.json`) and
`bucket_sync_paths.ts` never leaves it — `raw_data/` and `/Volumes/` are unreachable from every
upload path, which is why `cr_deeds.sqlite` carries no exclusion either. The ~16.8k
company-connection shards CLAUDE.md warns about were under `data/`. The rule that DOES apply
here is the opposite one: if any projection ever writes a serving artifact into `data/`, that
artifact needs the exclusions, not the capture.

Suggested tables — the raw capture, plus the document-level facts needed to explain a hole:

```sql
-- The WORK LIST. One row per (eik, fiscal_year) we intend to answer for — minted from the
-- TR feed (§11d), NOT from the contractor list, so a company-year with no filing has a row
-- and can say so. Without this table "not filed yet" has nowhere to live: gfo_document is
-- keyed by act_id, and the whole point of that state is that no act exists.
gfo_target(eik, fiscal_year, tier, has_gfo_act, state, absence_reason, last_checked_at,
           PRIMARY KEY (eik, fiscal_year))
           -- state: 'not-yet-tried' | 'captured' | 'retryable-failure'
           --      | 'terminal-failure' | 'no-act-in-feed'   (§11c.3's four, plus the
           --        feed-level absence that never becomes a fetch at all)

gfo_document(act_id PK, eik, act_year, act_mode, fetched_at, http_status, content_kind,
             page_count, engine, model, prompt_version,
             found, report_year, prior_year, company_name,
             unit_raw, unit_scale, unit_currency,   -- printed string + resolved pair (§8.2)
             basis,                                 -- individual | consolidated | unknown
             absence_reason, in_tokens, out_tokens, wall_ms, raw_json)
gfo_row(act_id, stmt_ord, statement_kind, page, seq, code, label, current, prior,
        PRIMARY KEY (act_id, stmt_ord, seq))
gfo_check(act_id, identity, lhs, rhs, passed)   -- §10, materialised at ingest
```

Three things in that shape are corrections to the first draft, and each was a silent
data-loss bug:

- ⚠️ **`gfo_row`'s key is `(act_id, stmt_ord, seq)`, never `(act_id, statement_kind, seq)`.**
  A document can carry two statements of the SAME kind — §1.3 already records `АКТИВ ×2,
ПАСИВ ×2` on `3fc26c93`, and consolidated-beside-individual (§8.2) is the same shape. The
  `statements[]` array is ordered and each entry's `seq` restarts at 0, so two same-kind
  statements collide on every row. Under `INSERT OR IGNORE` that is a silent half-capture of
  a document that reports as captured; under a plain INSERT it aborts the document. The
  ordinal is the position in the returned array, and `statement_kind` becomes an attribute.
- ⚠️ **`absence_reason` needs the two states no document can carry.** The draft enum
  (`opted_out_38_4 | no_opr_in_document | auditor_report | not_a_pdf`) covers only reasons
  discovered by opening a document, while §11 lists four cases of which the FIRST — _not
  filed yet_, the only one that improves with time — is a property of an (eik, year) with no
  act at all. Add `not_filed_yet` and `declared_no_activity` (the чл. 38 ал. 9 т. 2
  declaration, act mode 61 — readable from the feed with no fetch and no OCR, §11d.3) and put
  both on `gfo_target`, where they can exist.
- **`act_mode` is stored** because "ГФО-family" is three different act modes and only one
  carries statements (§11d.3). Without it, mode-60 documents (the annual activity report,
  where employee counts live) and mode-2 documents are indistinguishable in the store.

Measured footprint, built by loading the real 1,779 captured rows into SQLite with an
`act_id` index: **175 bytes/row**, 118.6 rows/document → **20.8 KB per document**.

| tier                   |      documents |        rows | SQLite, uncompressed |
| ---------------------- | -------------: | ----------: | -------------------: |
| top-1,000 contractors  |         ~9,600 |   1,138,600 |           **200 MB** |
| top-5,000 contractors  | ~33,000–53,000 | 3.9 M–6.3 M |    **690 MB–1.1 GB** |
| all 27,531 contractors |       ~179,000 |      21.2 M |           **3.7 GB** |

(Document counts corrected 2026-08-21 — §11d.1. The 175 bytes/row and 118.6 rows/document
measurements are unchanged; only the counts they are multiplied by moved.)

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
documents, over **5 fiscal years**.

⚠️ **REBUILT 2026-08-21. The table this section carried until then applied NO multiplier at
all** — its counts were literally `EIKs × 5` (5,000 and 138,000) while this paragraph claimed
1.59 acts per EIK-year was "what converts EIK-years into documents", and §11b.1 gave a third
count (166,600) for the same full tier. Three numbers for one scope. The counts below apply
the measured rate for **each population separately** (§11d.1) — that distinction is the whole
correction, since the corpus rate and the tier rate differ by 1.6×:

| tier            |   EIKs |  fetchable |   docs/EIK-yr |      documents |            OCR cost | OCR wall (8 conc.) |         store |
| --------------- | -----: | ---------: | ------------: | -------------: | ------------------: | -----------------: | ------------: |
| top-1,000 by €  |  1,000 |    **904** |      **2.13** |         ~9,600 |     **$155 – $300** |             ~3.7 h |        200 MB |
| top-5,000 by €  |  5,000 | unmeasured | 1.30–2.13 (?) | ~33,000–53,000 |   **$530 – $1,650** |         ~13 – 20 h | 690 MB–1.1 GB |
| all contractors | 27,531 | unmeasured |      **1.30** |       ~179,000 | **$2,900 – $5,550** |              ~69 h |        3.7 GB |

- **`fetchable`** is the count that can have a ГФО at all: 96 of the top-1,000 keys by € are
  `obed-` carriers, `ph-`/`np-` synthetics or odd ids with no EIK (§11e.1). Budgeting on 1,000
  over-buys; the free preflight in §11d.2 narrows it further before a byte is spent.
- The top-5,000 rate is **not measured** and the band is the two rates that are. Measure it
  from the feed (free, no fetch) before committing that tier — do not interpolate.
- The full tier uses the corpus rate because at 27,531 EIKs it IS the corpus. Note the two
  corpus-wide slices measured give 1.21 (§11b.2, 40 files) and 1.30 (§11d.1, 25 files, deed-scoped);
  1.30 is used here because over-budgeting a four-day crawl is the cheap direction to be wrong in.

`contracts` at `tag='contract'` currently holds **27,534** plain 9/13-digit contractor EIKs
(local PG, 2026-08-20), matching CLAUDE.md's 27,531.

**The OCR is not the bottleneck and the cost is not the risk — the fetch is.** Nothing was
fetched for this bakeoff, so the crawl rate is **unmeasured**. The comparable in-repo figure is
the CR Deeds capture at ~26 h for its tier, and `portal.registryagency.bg/CR/api/Documents/`
is WAF-guarded (node/undici's TLS fingerprint 500s; the hospital script uses `curl` for exactly
that reason). At even 1 request/second, 179,000 documents is 50 hours of fetching, and it is
prudent to assume worse. (Superseded by measurement — §11b.1 puts the safe rate at 1,772
docs/hour and the full tier at ~101 h. The conclusion is unchanged and stronger.) **Start at the top-1,000 tier**, which is a few hundred dollars and
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

### 10.2b ⚠️ The SECOND blind spot — scale — and it is the one with the worst consequence

**All four identities in §10.1 are homogeneous of degree 1.** Multiply every value in a
document by any constant and:

| identity                              | survives a uniform ×k? |
| ------------------------------------- | ---------------------- |
| A `Всичко приходи` = `Всичко разходи` | ✅ both sides scale    |
| B `приходи − разходи = печалба`       | ✅ both sides scale    |
| C components sum to their total       | ✅ both sides scale    |
| D `СУМА НА АКТИВА` = `СУМА НА ПАСИВА` | ✅ both sides scale    |

So **a misread `unit` passes every check this plan has**, at a ×1000 (`хил. лв.` read as
`лв.`) or ×1.96 (`лв` read as `EUR` across the 2026 changeover). §10.3's cross-year overlap
does not close it either: two filings of the same company in the same form family misread the
same way, so `prior` still equals the previous `current` and the check passes. The mutation
table above cannot see this class at all, because every mutation it injects is into ONE cell
— a scale error is a mutation of every cell at once, which is precisely the shape internal
consistency is defined not to notice.

**This matters more than §10.2's column shift, for three reasons.** It survives the engine
choice (§10.2's blind spot is Tesseract's problem and Gemini's errors are visible; this one
is not an engine property at all). Its magnitude is 1000× rather than 16%. And it is
SYSTEMATIC — one form family misread once is misread for every company using it, so it
produces a whole cohort of fake shell winners rather than one.

**Two defences, and neither is internal:**

- **Canonicalise the unit and refuse an unresolvable one** (§8.2). Never default. A stored
  `unit_scale`/`unit_currency` pair with a `NULL` for "could not resolve" is the same
  tri-state rule as `held_scope` in CLAUDE.md, for the same reason.
- **One EXTERNAL magnitude anchor.** `tr_companies.funds_amount` (registered capital) is
  already in PG and is the cheap one; a year-over-year jump of exactly ×1000 or ×1.95583
  within one company is the other, and it is free because the schema already stores `prior`.
  Neither is a precision instrument — they do not need to be. They need to separate 1000×
  from 1×, which is a gap no plausible business has.

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

**Schedule at the safe rate (1,772 docs/hour).** ⚠️ **Re-derived 2026-08-21** — the table
here used 1.21 docs/EIK-year for every tier, including the one tier where that rate does not
apply (§11d.1):

| tier      | EIKs   | documents      | fetch time            | download    |
| --------- | ------ | -------------- | --------------------- | ----------- |
| top-1,000 | 1,000  | ~9,600         | **~5.4 h**            | ~17 GB      |
| top-5,000 | 5,000  | ~33,000–53,000 | **~19 – 30 h**        | ~57 – 92 GB |
| all       | 27,531 | ~179,000       | **~101 h (4.2 days)** | **~310 GB** |

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

## 11c. Operator decisions taken 2026-08-20 — storage, first tier, resumability

Three decisions, with what was measured for each. **Nothing is built yet.**

### 11c.1 The capture lives on the external drive

⚠️ **THIS IS THE ONLY STORE LOCATION IN THIS PLAN.** `/Volumes/Storage/gfo/` — nothing under
`raw_data/`, `data/` or any other path on the boot volume, at any tier, including a trial run.
§8.3 and §13 said `raw_data/tr/gfo.sqlite` until 2026-08-21 and were wrong. (The only
`raw_data/tr/gfo_bakeoff/` reference left in this document is the 16-document, 7.7 MB BAKEOFF
sample — history, not the store.)

**It does not fit anywhere else, and by a wide margin.** Measured 2026-08-21:

| volume                        | device           |        free | tier 1 (~17 GB) | full (~310 GB)   |
| ----------------------------- | ---------------- | ----------: | --------------- | ---------------- |
| `/` — boot, holds `raw_data/` | `/dev/disk3s1s1` |  **26 GiB** | ❌ does not fit | ❌               |
| `/Volumes/Storage`            | `/dev/disk7s1`   | **476 GiB** | ✅              | ✅ ~166 GiB left |

`raw_data/` is **already 32 GB** against 26 GiB of remaining boot space, so the boot volume
cannot absorb even the first tier — a `raw_data/tr/gfo.sqlite` store fills the disk partway
through tier 1 and takes every other pipeline down with it.

`/Volumes/Storage` is **APFS over USB, 476 GiB free of 476** (essentially empty). Verified:
an 8 MB write + fsync + delete round-trips, and **SQLite opens there in WAL mode** and commits
(the usual reason to keep a SQLite index off an external volume is exFAT's absent locking;
this volume is APFS, so that objection does not apply and the index can sit beside the PDFs).

Budget against the corrected document counts (§11d.1) at the pessimistic 1,728 KB mean:
tier 1 ≈ **17 GB**, top-5,000 ≈ **57–92 GB**, all 27,531 EIKs ≈ **310 GB**. All fit; the full
tier leaves ~166 GiB. ⚠️ The full tier is the first thing that could exhaust the drive if the
mean document size is worse than measured — the two samples so far disagree 2.4× (§11b.1) —
so tier 1's measured mean is a go/no-go input for the full tier, not a curiosity.

⚠️ **THE DRIVE-ABSENT HAZARD, and it is silent.** If the volume is not mounted, macOS lets a
process **create `/Volumes/Storage` as an ordinary directory on the boot volume** and write
into it. The boot disk has **26 GiB free** (measured 2026-08-21), so a tier-1 run at the
corrected ~17 GB would very nearly exhaust it and a full run certainly would — while every
path in the code looks right and every write succeeds. The
ingest must therefore verify the MOUNT, not the path: confirm `/Volumes/Storage` is a mount
point on a different device from `/`, and refuse to start otherwise. A `--allow-unmounted`
escape hatch is not wanted; there is no case where writing the capture to the boot disk is
the intended thing.

**Layout.** PDFs as ordinary files (`/Volumes/Storage/gfo/pdf/<ActID>.pdf`) rather than blobs: they are
already compressed, so a gzipped-blob store buys nothing, and the OCR step wants a path to
hand to the model. The SQLite index (`/Volumes/Storage/gfo/gfo.sqlite`) holds capture state, per-document
metadata and — later — the extracted rows, following the `cr_deeds.sqlite` precedent of a
durable raw store that offline projections read without re-fetching.

### 11c.2 First tier: the top 1,000 contractors — 74.1% of the reachable money

⚠️ **The 68.4% this section claimed is a MIXED-BASIS quotient** — the trap CLAUDE.md's
supplier-identity section is written about. Re-measured 2026-08-21 on local PG at
`tag='contract'`, its numerator (€64.16bn) is the top-1,000 **plain-EIK** keys while its
denominator (€93.67bn) is the **whole corpus including keys that have no EIK at all**. Two
populations, one fraction. Measured cleanly:

| basis                                         |                  € |
| --------------------------------------------- | -----------------: |
| top-1,000 plain-EIK contractors               |           €64.03bn |
| corpus, plain-EIK keys only                   |           €86.39bn |
| corpus, all keys                              |           €93.77bn |
| **→ tier 1 as a share of REACHABLE money**    |          **74.1%** |
| → tier 1 as a share of all contract money     |              68.3% |
| **→ money on keys that can NEVER have a ГФО** | **€7.38bn (7.9%)** |

Both readings are worth stating and neither is the one that was there: the tier reaches
three quarters of the money it _can_ reach, and €7.4bn is permanently out of scope for any
turnover ratio (§11e.1).

At the corrected **2.13 documents per EIK-year for this population** (§11d.1), over ~5 filed
years and the **904 fetchable** keys, that is **~9,600 documents ≈ 5.4 h of fetching** at the
safe rate, ~3.7 h of OCR, **$155–$300**, ~17 GB. The `~6,050 documents ≈ 3.4 h` this section
carried came from applying the corpus-wide rate to a deliberately atypical tier.

That is the right first cut: two thirds of the money for 3.6% of the EIKs, and it is the tier
where a capacity test is worth having — a shell-winner among the largest contractors is a
finding; among the smallest it is usually a small company.

### 11c.3 Resumability — the design constraints, not the code

The run must survive being stopped, the drive being unplugged, the register rate-limiting, and
a later run extending to the next tier. Four constraints follow, and the first two are
correctness rather than convenience:

- **The unit of work is a DOCUMENT (ActID), not an EIK.** An EIK-level resume marker would
  re-fetch a partly-captured EIK's documents on every restart, and at 1.21 docs/EIK-year that
  is mostly wasted requests against a rate-limited register.
- ⚠️ **Four states, and they must not share a representation.** `captured` (bytes on disk whose
  first four are `%PDF`, or a recorded non-PDF such as the OLE2 Word case in §1.2),
  `not-yet-tried`, `retryable-failure` (the `DocumentLimit` 302, a transport error, a 5xx), and
  `terminal-failure` (404 — the register does not have it). Collapsing retryable into terminal
  loses documents permanently; collapsing it into not-yet-tried makes a rate-limited run spin
  on the same ids. This is the invariant the CR Deeds capture exists for, and §11b.1 showed
  the 302 arrives looking like success.
- **The resume predicate is a query against the index**, not a cursor or a line number in a
  file. Anything positional breaks when the target list grows — which it does by design, since
  tier 2 is the same list plus more.
- **Tier membership is a stored attribute of the target, not a filter applied at fetch time.**
  Then "run the next batch" is additive: insert the tier-2 targets, and the existing captures
  are already `captured` and skipped. Re-running tier 1 after tier 2 lands must be a no-op.

**Two things the crawler must do that a naive one will not**, both measured in §11b.1 and §1.2:
treat the `DocumentLimit` 302 as backoff-and-retry rather than as an answer, and sniff content
rather than trusting the extension — 1 in 16 documents is an OLE2 Word file, and the reference
implementation's `%PDF` guard drops it silently.

**Politeness is settled by measurement, not guessed:** concurrency **3** (20/20 clean),
never 6 (7 of 20 rate-limited).

---

## 11d. The target list — how a document becomes a fetch (audit pass, 2026-08-21)

⚠️ **Nothing above this section says how the list of ActIDs to fetch is BUILT, and the source
it names cannot build it.** §11c.3 settles what to do with a target (four states, document-level
unit of work, tier as a stored attribute) and never says where targets come from. Measured
below; all three findings are free to act on, because they are properties of the TR daily feed
already on disk and need no fetching.

### 11d.1 The document rate is a property of the POPULATION, and the tier is the atypical one

Deed-scoped parse of 25 daily feed files (each act attributed to its own `Deed.$.UIC`, so a
related party's UIC cannot be misread as the subject), counting act mode 2 only:

| population                |    acts | (EIK, ActYear) | docs/EIK-year | single-document share |
| ------------------------- | ------: | -------------: | ------------: | --------------------: |
| corpus-wide               | 205,639 |        158,029 |      **1.30** |                   87% |
| **top-1,000 contractors** |   1,809 |            851 |      **2.13** |               **62%** |

An independent 182-file slice gives **1.96** for the same population (7,881 acts / 4,018
pairs), so the effect is not a small-sample artefact. §11b.2's corpus figure is confirmed
(1.21 over 40 files vs 1.30 here); what is wrong is applying it to this tier.

**1.6–1.8× more documents than budgeted, and it lands on the tier that runs FIRST.** Big
contractors file more per year — a ГФО plus an audit report plus a group's second statement
set — and the top-1,000 tail runs to **37 documents in one EIK-year**. Every count, cost,
schedule and storage figure in §9, §11b.1 and §11c.2 has been re-derived from this.

### 11d.2 The 2026 feed slice covers a third of the tier

The measurements in §11 and §11b were taken over "the 182 daily TR feed files from 2026". As a
target-list source that does not work:

| over the 182 files of 2026 | top-1,000 EIKs |
| -------------------------- | -------------: |
| appear at all              |  **341 (34%)** |
| carry a ГФО (mode 2) act   |  **274 (27%)** |

**The full archive is the source**: `raw_data/tr/daily`, **1,666 files / 15 GB, 2021-01-01 →
2026-08-07**. What makes it usable is that the feed re-lists a deed's **entire** act history
whenever the company appears for any reason — a 2026-08-05 file carries an `ActYear` 2007 ГФО
— so one appearance anywhere in the archive yields every ActID that company has. ⚠️ The
converse bounds it: a company that has not appeared since 2021-01-01 contributes nothing, and
acts **published** before then (FY2019 filings, statutory deadline 30 Sep 2020) are reachable
only via a later re-appearance. Whether that leaves a hole at the tier is unmeasured.

**This also supplies the free preflight §9 assumes.** Building `gfo_target` from the archive
answers "which of these 1,000 EIKs has a ГФО act, in which years, and how many" before a
single request — so the tier's real document count, and the §11e.1 exclusions, are known at
zero cost rather than discovered mid-crawl.

### 11d.3 „ГФО-family" is three act modes, and only one carries statements

Never defined anywhere above, yet every count in this plan depends on which were included.
Measured on one daily file (2026-08-05):

| `ActModeValue` | `ActModeText`                         | in one file | what it is                                               |
| -------------: | ------------------------------------- | ----------: | -------------------------------------------------------- |
|          **2** | Годишен финансов отчет                |  **15,946** | the statements — everything §2–§10 measured              |
|         **60** | Годишен доклад за дейността           |         459 | the annual activity report — **where employees live**    |
|         **61** | Декларация по чл.38, ал.9, т.2 от ЗСч |          66 | filed **instead of** a ГФО by a company with no activity |

Three consequences:

- **§12.8's employee gap is explained, and is probably not a gap.** "No document in this
  sample contained one" is what a mode-2-only sample must return: the headcount is in the
  доклад за дейността, a separate act. Measured over the 2026 slice, **909 mode-60 acts across
  133 of the 274 top-1,000 EIKs that file a ГФО** — so it is reachable for roughly half the
  tier, at ~1.27 extra documents per EIK-year for those that file one. Budget it as a
  deliberate add-on, not as a free by-product.
- **Mode 61 is a FIFTH absence reason and the only one that is free.** A company that filed
  the чл. 38 ал. 9 т. 2 declaration has no ГФО by law and no document worth fetching — and the
  feed says so. Read it into `gfo_target.absence_reason = 'declared_no_activity'` and skip the
  fetch entirely. 0 among top contractors (they have activity), 66 in a single daily file
  corpus-wide, so this matters at the wider tiers, where §1.4's opt-out population lives.
- **Store `act_mode`** (§8.3). Without it a mode-60 document and a mode-2 document are
  indistinguishable in the capture, and the ОПР-presence yield in §12.5 is computed over the
  wrong denominator.

Also on each act: `ActWithErasedPersonalData` — the register's own flag for a redacted
document. Unmeasured; worth recording at capture rather than rediscovering as an OCR anomaly.

---

## 11e. What the extracted figure is COMPARED AGAINST (audit pass, 2026-08-21)

⚠️ **This plan specifies the denominator to four decimal places and never specifies the
numerator.** P3's claim is "won €X against €Y of turnover"; §2–§10 are entirely about €Y. Two
of the four findings below publish a false headline about a named company **with every check
in §10 passing**, which puts them in the same class as §10.5's warning rather than in the
"nice to have" pile.

### 11e.1 ⚠️ A consortium is the maximal shell signature, and it is an ARTEFACT

The plan mentions консорциум / ДЗЗД / обединение **zero times**. Measured 2026-08-21 on local
PG at `tag='contract'`, over the top 1,000 contractor keys by €:

| shape                                                   |    keys |            € |
| ------------------------------------------------------- | ------: | -----------: |
| `obed-` synthetic carriers — no EIK exists, unfetchable |  **66** |  **€3.56bn** |
| `ph-` / `np-` / odd ids — unfetchable                   |      30 |            — |
| plain EIKs named ДЗЗД / ОБЕДИНЕНИЕ / КОНСОРЦИУМ         | **209** | **€12.48bn** |
| …of which absent from `tr_companies` entirely           | **202** |            — |
| plain EIKs absent from `tr_companies` for any reason    |     251 |            — |

**~275 of the top 1,000 by € — €16bn, 27.5% of the tier — can never have a ГФО.** A ДЗЗД is
not a търговец: it holds an ordinary 9-digit EIK, wins contracts, and files no annual financial
statement in the Commerce Registry, because it is a BULSTAT subject. The name test and the
TR-presence test agree on **202 of 209 (96.7%)**, which makes `tr_companies` membership a
name-free discriminator that needs no string matching.

⚠️ **`company_public_money` puts the whole consortium's € on that key by design.**
`127_company_public_money.sql:4` sums contracts `WHERE tag='contract' AND consortium_role IS
DISTINCT FROM 'member'` — so the carrier holds the money and the member firms, which have real
ГФО, do not. The detector's output on such a key is therefore: **maximum public money, zero
turnover, no filings** — a perfect shell winner, manufactured entirely by how consortium money
is attributed. It is the highest-scoring false positive available and it is 27.5% of the tier.

**Rule: REFUSE, do not grade.** The ratio must not be computed for a key that cannot have a
ГФО, and the absence must be classified `not_a_trader` rather than rendered as a small or zero
denominator. This is the same refusal `aop_expert_person_links()` makes in CLAUDE.md — "25
matched, 33 refused" is a different claim from "25 of 88 are in our person layer", and only the
refusal is honest. A future widening (attributing a consortium's € to its members through
migration 087's inferred composition) is a separate piece of work and must not be assumed here.

### 11e.2 ⚠️ VAT — the numerator's basis is unresolved and the direction is known

`ДДС` appears **once** in this plan, as a false positive inside the word "observations". ГФО
revenue is **net of VAT**. Contract values are not consistently either: `legacy_csv.ts:38`
records that the newer CE files carry `Стойност при сключване` **and a `ДДС` column**, and a
grep of `scripts/procurement/` + `scripts/db/` finds **nothing that reads it** — so
`contracts.amount_eur` carries whatever basis each of the four feeds published, unreconciled.

A systematic ~20% inflation of the numerator against a VAT-exclusive denominator is not a
rounding caveat on a claim of this severity: it moves a company at 0.85× turnover to 1.02×,
i.e. across the line the whole feature is about. **Resolve the basis per feed before the ratio
ships**, and if it cannot be resolved, say so in the caption rather than in a footnote.

### 11e.3 ⚠️ An award value is not a year's revenue

Zero mentions of рамково / framework. A framework contract's entire value is dated at award;
the revenue accrues over its term. §11's rule ("every ratio names its year, and no ratio
silently reaches back") fixes year _matching_ and does nothing about this: a four-year
framework signed in 2023 is compared against 2023 turnover alone, and any normal company
winning one becomes a headline. **This is the single largest false-positive generator for this
specific detector** and it is not addressed anywhere in the plan.

Two mitigations exist in the corpus already and neither is free: amortise across the contract
term where the term is known, or state the ratio as a MULTI-YEAR aggregate (Σ contract € over
the years captured ÷ Σ turnover over the same years), which is also what makes the §11 year-
matching rule cheap to satisfy. Decide which before building the projection; publishing the
single-year form without deciding is the defect.

### 11e.4 Consolidated statements — see §8.2

A group files both an individual and a consolidated ГФО and the plan's `kind` enum cannot tell
them apart. Same failure direction as §11e.1 and §11e.3: the denominator is silently the wrong
size, the arithmetic all reconciles, and the affected population is the large contractors this
tier exists to examine.

---

## 11f. Where the corpus lands (audit pass, 2026-08-21)

§13's step 5 — "wire the projections" — is the entire delivery, and this plan contains none of
what CLAUDE.md requires for a new PG-backed family. Zero mentions of migration, `db:load`,
`:cloud`, `refresh_coverage`, `recent_updates`, `data-changes`, or `vacuum`. The current head
migration is **177**; no `gfo_*` or `financials` schema exists.

**The checklist, from CLAUDE.md's own rules for this repo:**

| requirement                                                               | why it is not optional here                                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| a migration + a `db:load:gfo:pg` loader                                   | nothing serves a SQLite file on an external drive                                                                                        |
| **a `:cloud` twin**                                                       | without it prod keeps the previous vintage at a 200 — the repo's most-repeated failure                                                   |
| a `REFRESH_EXCLUSIONS` entry, with the reason                             | the input is a gitignored, hand-run, rate-limited crawl — the `tr:cr-deeds` shape; `refresh_coverage.test.ts` FAILS until it is declared |
| `vacuumAfterReload` + a `RELOADED` entry                                  | a TRUNCATE-reload leaves `relallvisible = 0` permanently                                                                                 |
| a `recent_updates` changelog row **and** a `data/data-changes.json` entry | two changelogs, and they are not the same one                                                                                            |
| `scripts/db/tests/gfo_*.data.test.ts`                                     | with a mutation check — §10.1's own §10.1-⚠️ records what a vacuous one costs                                                            |

**Two things beyond the checklist:**

- ⚠️ **There is no refresh cadence, and the corpus is structurally incomplete at the recent
  end by §11's own measurement.** FY2025 is 11% filed and fills for a year. §11c.3's
  resumability handles "extend to the next tier" and not "re-check an (eik, year) that had
  nothing last time" — which is the _only_ absence state §11 says improves with time. That
  re-check is a `gfo_target` sweep against a re-read of the feed archive, and it needs a
  trigger: `state/watch/egov_commerce.json` already watches the TR feed and nothing maps it to
  ГФО. Without this the capture is a one-off snapshot that silently ages.
- **`GEMINI_FLASH` is now shared, and this plan's accuracy measurement is not.**
  `scripts/lib/gemini_models.ts` is the single source (`gemini_models.test.ts` fails on any
  inline literal), so the ingest must import the constant — a literal `"gemini-3.7-flash"` will
  not pass the gate. The consequence runs the other way too: a future bump of `GEMINI_FLASH`
  for some unrelated OCR path silently re-points this ingest at an unmeasured model. Storing
  `model` / `prompt_version` per document records that it happened; nothing yet triggers
  re-validation when it does.

⚠️ **And the closing recommendation's justification is stale.** "Not `gemini-3.5-flash` — the
model the hospital script pins" was true when written and is not now:
`scripts/nzok/write_hospital_revenue.ts:50` imports `GEMINI_FLASH`, i.e. 3.7-flash, since the
2026-08-20 consolidation. The _recommendation_ is unaffected — 3.7-flash is still the measured
winner — only the contrast is gone.

### 11f.1 Reproducibility — the bakeoff cannot currently be re-run

**Prompt B's text is not in this document.** §8.2 gives its return shape. Nor is the harness
committed: the prompt, the six-revision Tesseract extractor, the four identity checks and the
mutation test all live outside git, so the 16-document regression that produced every number
here cannot be repeated — by a reviewer, or after a `GEMINI_FLASH` bump. Commit the prompt and
the identity checks with the capture store (§13), and keep the 16-document sample as their
fixture.

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
5. ~~**The real ОПР yield per EIK-year.**~~ **HALF RESOLVED — but the resolved half was
   applied to the wrong population, see §11d.1.** The documents half is **1.30 corpus-wide
   (91% single) and 2.13 for the top-1,000 contractors (62% single)**; §11b.2's 1.21 is the
   corpus figure and is confirmed. The ОПР-presence half still needs documents opened, and its
   denominator must be mode-2 acts specifically (§11d.3). Original note: This sample gives 60%
   of documents and 1.59 documents per EIK-year, from 16 documents over 8 companies.
6. **The statutory opt-out rate (§1.4).** One document in sixteen invoked чл. 38 ал. 4. That
   is 6% ± a great deal, and it is a hard ceiling on coverage for small companies, so it is
   worth measuring early.
7. **Whether a coded-form share exists worth exploiting.** Only 1 of 9 ОПР documents carried
   the `код на реда` column (`15100`/`18000`). The hospital prompt anchors on those codes and
   they are **absent from 8 of 9** — it works only via its abbreviated-label fallback. Whether
   the coded form is more common corpus-wide is unknown.
8. ~~**Employee counts.**~~ **LIKELY EXPLAINED — §11d.3.** They live in the **Годишен доклад
   за дейността, act mode 60**, which is a different act from the ГФО this bakeoff sampled —
   so "no document in this sample contained one" is what a mode-2-only sample must return, not
   evidence of rarity. Measured: 909 mode-60 acts across 133 of the 274 top-1,000 EIKs that
   file a ГФО. Reachable for roughly half the tier at ~1.27 extra documents per EIK-year;
   confirm by opening one. Original note: Named in P3, live in a separate справка, and no
   document in this sample contained one.
9. **Tesseract at 600 DPI, with deskew/binarisation preprocessing, or with a fine-tuned `bul`
   model.** Only 150 and 300 DPI with stock `bul` were measured. Preprocessing would likely
   help the two documents it failed on. It would not change the recommendation — 300 DPI
   Tesseract is already slower than Gemini per document — but the headroom is unquantified.
10. **`gemini-flash-lite`.** Not tested. ⚠️ Its stated trigger is wrong: §11b.1 measured that
    **the fetch, not the price, is the binding constraint** at every tier, so a cheaper model
    buys hours off the short half of the schedule. Measure it if the _cost_ becomes the
    objection; do not expect it to shorten a four-day crawl.

**Added by the 2026-08-21 audit pass:**

11. **The top-5,000 document rate.** Between the two measured rates (1.30 corpus, 2.13 for the
    top-1,000) and unmeasured in between — which is a ±60% band on that tier's cost and
    schedule. Free to settle from the feed archive before committing (§11d.2).
12. **Whether the feed archive has a hole at the old end.** It starts 2021-01-01; FY2019 acts
    were published in 2020 and are reachable only through a later re-appearance of the company
    (§11d.2). Unmeasured, and it decides how many fiscal years the tier can actually cover.
13. **The VAT basis of `contracts.amount_eur`, per feed.** The source CSVs carry a `ДДС`
    column nothing reads (§11e.2). This is the numerator of the published claim.
14. **How often a large contractor files a CONSOLIDATED ГФО** (§8.2, §11e.4). Zero in this
    sample; the sample contains no groups.
15. **Whether the register's `DocumentLimit` is also a per-PERIOD quota**, and what the
    Registry Agency's terms say about bulk document download — the page is a stated limit, not
    only a rate signal, and this plan reads it purely as one (§13).
16. **The paid TR full-DB export.** `docs/plans/gfo-ingest-spike.md` — this plan's own
    predecessor — records it at ~100 BGN/yr **bundling the act documents** and calls it "the
    realistic bulk route". It is not compared anywhere here against $2,900–$5,550 plus 4.2 days
    of crawling. At the full tier that comparison is not close, and it should be made before
    the full tier is authorised (tier 1 is small enough not to wait for it).

---

## 13. Recommended next steps

1. **Confirm the rate card** and replace §4.2's band with a number. (Anchor 2 is verified —
   §11b.3 — so the band is sound; only the list price is missing.)
2. ~~Probe the fetch~~ — **DONE, §11b.1.** Safe rate is concurrency 3 ≈ 1,772 docs/hour; above
   it the register 302s to a named `DocumentLimit` page. The crawler must treat that 302 as a
   refusal, not a fetch — unchecked, it stores a non-document at a 200-shaped success.
3. **Build the target list first — it is free, and it re-scopes everything after it (§11d).**
   Read the full `raw_data/tr/daily` archive (1,666 files, 2021-01-01 → 2026-08-07) into
   `gfo_target`: per (eik, fiscal_year), which act mode 2 ActIDs exist, plus mode 60 for
   employees and mode 61 as a no-fetch absence. This costs no requests and settles the tier's
   real document count, the top-5,000 rate (§12.11), the old-end hole (§12.12) and — with the
   `tr_companies` join — the §11e.1 exclusions, all before a byte is spent.
4. **Decide the numerator (§11e) before anything is published, and preferably before the
   crawl.** Four decisions, none of which the bakeoff touched: refuse the ratio for keys that
   cannot have a ГФО (§11e.1 — 27.5% of tier 1); resolve the VAT basis per feed (§11e.2);
   choose amortised or multi-year-aggregate for framework contracts (§11e.3); and give the
   capture a consolidated/individual axis (§11e.4). The first and third each publish a false
   headline about a named company with every §10 check passing.
5. **Build the capture store at `/Volumes/Storage/gfo/`** — never under `raw_data/`, which sits
   on a boot volume with 26 GiB free against a 17 GB tier and a 310 GB full scope (§11c.1).
   Verify the MOUNT, not the path. Commit the prompt and the four identity checks alongside it
   (§11f.1), with the 16-document sample as their fixture, and materialise the checks into
   `gfo_check` at ingest (§10.1). Add the canonical `unit_scale`/`unit_currency` resolution and
   its refusal path at the same time — retrofitting it means re-reading every `raw_json`
   (§8.2, §10.2b).
6. **Run the top-1,000 tier** — ~9,600 documents, ~5.4 h of fetching at concurrency 3 plus
   ~3.7 h of OCR, ~17 GB, $155–$300 (§9, §11c.2). Then **hand-check 100 at random and publish
   the error rate** (§10.4).

   ⚠️ That single run also closes SEVEN of §12's remaining opens as a by-product, so do not
   schedule them as separate work: the hallucination rate (#3), whether accuracy survives
   worse scans (#4), the ОПР-presence half of the yield (#5), the чл. 38 ал. 4 opt-out rate
   (#6), the coded-form share (#7), the mean document size (§11b.1 — a go/no-go input for the
   full tier, which is the first thing that could exhaust the drive), and the consolidated-ГФО
   rate (#14). Instrument the run to record them rather than re-deriving later.

7. **Land it in Postgres properly — §11f is a checklist, not a summary.** Migration, loader,
   **`:cloud` twin**, `REFRESH_EXCLUSIONS` entry with its reason, `vacuumAfterReload` +
   `RELOADED` entry, a `recent_updates` changelog row AND a `data-changes.json` entry, and a
   `gfo_*.data.test.ts` with a mutation check. Missing the `:cloud` twin is this repo's
   single most-repeated failure: local green, prod serving the previous vintage at a 200.
8. **Wire the refresh trigger.** FY2025 is 11% filed and fills for a year (§11), so the target
   list must be re-derived on a cadence and previously-empty (eik, year) pairs re-checked —
   the one absence state that improves with time. `state/watch/egov_commerce.json` already
   watches the feed; nothing maps it here (§11f).
9. Only then wire the projections: the financial-capacity test, and the
   `company_public_money` denominator.

**What a tier-1 run will still NOT settle**, stated so it is not assumed: the mean document
size (§11b.1 — the two samples disagree 2.4×, and it is the difference between ~120 GB and
~310 GB at full scope, against 476 GiB of drive; tier 1 measures it properly), and whether the register's
`DocumentLimit` is purely a concurrency guard or also a per-period QUOTA. ~118 documents were
fetched across this session's probes without exhausting anything, but a ~9,600-document run is
the first real test of that, and if it is a quota the schedule in §11b.1 is optimistic.

**Engine: `gemini-3.7-flash`, prompt B (capture-everything), native PDF input,
`temperature: 0`, with an OLE2 content-sniffing pre-step.** Not `gemini-3.5-flash`, which is
3.8× slower, 2.3× more expensive on output, and lost a document on the harder task.

⚠️ **Take the id from `GEMINI_FLASH` (`scripts/lib/gemini_models.ts`), never as a literal** —
`gemini_models.test.ts` fails on an inline model id. That constant is already 3.7-flash and is
shared with every other OCR path in the repo, including
`scripts/nzok/write_hospital_revenue.ts:50` — so the contrast this paragraph used to draw
("the model the hospital script pins") no longer exists, and the live risk is the opposite one:
a bump made for an unrelated path silently re-points this ingest at an unmeasured model
(§11f).
