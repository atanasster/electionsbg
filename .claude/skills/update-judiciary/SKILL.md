---
name: update-judiciary
description: Refresh the judiciary (Съдебна власт) data — the court caseload/workload series in data/judiciary/caseload.json, parsed from the ВСС annual "Обобщени статистически таблици за дейността на съдилищата" PDFs, and the judiciary budget-by-body in data/budget/vss/budget.json, parsed from the State Budget Law. It also indexes the ИВСС magistrate asset-declaration register into data/judiciary/declarations.json. These feed the /judiciary dashboard, the ВСС sector pack on /awarder/121513231, and the AI judiciaryCaseload / judiciaryWorkload / judiciaryBudget / judiciaryDeclarations tools. Use when the daily watch report flags `vss_court_statistics` or `ivss_declarations` as changed, when the user asks to refresh judiciary / съдебна власт / court statistics / натовареност data, or after a fresh git clone if data/judiciary/caseload.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Judiciary skill

Two independent artifacts, two independent triggers.

| Artifact | Source | Watcher | Script |
|---|---|---|---|
| `data/judiciary/caseload.json` | ВСС annual statistical-tables PDFs (vss.justice.bg) | `vss_court_statistics` | `scripts/judiciary/__write_caseload.ts` |
| `data/budget/vss/budget.json` | ЗДБРБ „Бюджет на съдебната власт" article (cached law HTML) | `budget_law` (owned by `update-budget`) | `scripts/budget/__write_judiciary.ts` |
| `data/judiciary/declarations.json` | ИВСС declaration register + its non-compliance lists | `ivss_declarations` | `scripts/judiciary/__write_declarations.ts` |

## When to run

| Trigger | Action |
|---|---|
| `vss_court_statistics` flips | The ВСС published a new annual (or half-year) table. **First** add the new year's PDF URL to `VSS_ANNUAL_TABLES` in `scripts/judiciary/sources.ts` — the filenames are NOT uniform across years, so the map is curated by hand. Then run the caseload script. |
| `budget_law` flips / new ЗДБ year | Handled by the `update-budget` skill, which runs `scripts/budget/__write_judiciary.ts` alongside `__write_izdrazhka.ts`. |
| `ivss_declarations` flips | A new year landed in the register, **or** the ИВСС added/cleared a name on one of its four non-compliance lists. Run the declarations script — no curated URL map needed, it discovers years from the register index. |
| Fresh clone, `data/judiciary/` missing | Run the caseload script; it fetches the PDFs it needs. |

## Step 1 — Caseload ingest

```bash
npx tsx scripts/judiciary/__write_caseload.ts
```

Fetches any missing `raw_data/judiciary/tables-<year>-<urlhash>.pdf` (gitignored,
regenerable; ~5-30 MB each), parses **Приложение № 1** out of each, and writes
`data/judiciary/caseload.json`. It prints a per-year summary table — eyeball it.

The cache filename carries a hash of the source URL, so pointing `VSS_ANNUAL_TABLES`
at a corrected re-publication is a cache miss by construction. For a **same-URL**
re-upload (the ВСС does this — the 2021 file is literally named `…-2021_new.pdf`)
pass `--refetch` to force a re-download. The watcher can't detect that case: it
fingerprints the set of links, not their bytes.

The PDFs carry a real text layer, so there is **no OCR step**. Parsing reconstructs
the table with pdfjs text positioning (bucket items into rows by y, merge into cells
by x-gap), the same technique as the investment-annex parser.

## Step 2 — Verify (the script asserts, but read the output)

If ANY year fails to parse the script **throws and writes nothing** — a partial
rebuild would silently regress `latestYear` and ship a stale dashboard. Re-run with
`--allow-partial` only when the loss is intended; it warns loudly and prints the new
`latestYear`. Every year must satisfy:

- exactly 6 tier rows + 1 total row in **both** sections of Приложение № 1
- Σ tiers == total for every column
- the stock-flow identity `pendingEnd == pendingStart + filed − resolved`
- the printed "% в срок" == `round(withinDeadline / resolved)`

Independent cross-checks, if you want more assurance: the same PDF's separate
"СРАВНИТЕЛЕН ОТЧЕТ ЗА ДВИЖЕНИЕТО НА ДЕЛАТА" page prints the last three years and must
agree with Приложение № 1; and the ВСС's published 2021 headline (546,530 filed /
550,209 resolved / 80% within deadline) matches the parsed row.

## Step 3 — Stamp, commit, sync

```bash
npx tsx scripts/stamp-ingest.ts update-judiciary --summary "caseload <first>-<last>"
```

Commit `data/judiciary/caseload.json` (+ `scripts/judiciary/sources.ts` if a year was
added). `data/` is served from the bucket in prod, so `bucket:sync data/judiciary/`.

## Declarations ingest

```bash
npx tsx scripts/judiciary/__write_declarations.ts
```

Crawls the register (9 years × 29 first-letter pages = 261 HTML pages, ~2 min at
concurrency 4) plus the ИВСС's four non-compliance lists, and writes
`data/judiciary/declarations.json` (~12 KB). The full per-declaration index with PDF
paths goes to `raw_data/judiciary/declarations_index.json` (gitignored) — it is the
input for any future asset-extraction job.

Asserts: ≥8 years; every **closed** year has ≥3,000 magistrates and BOTH filing
batches (annual + change); dedupe accounting balances and every surviving row has a
distinct PDF path; the page heading's year and the year in the PDF's own path agree,
except for a bounded handful (currently **5**) where the ИВСС files a January change
declaration into the prior cycle's directory — any other offset means the pages are
mis-grouped and throws; >40% of annual declarations fall in May (if that clustering
vanishes, the входящ-номер date parsing broke); and each
non-compliance list matches the exact column count declared in `INTEGRITY_PAGES`
(the discrepancy list has **five** columns — a silent truncation would drop „Вид
декларация").

The **newest** year is exempt from the completeness asserts: change declarations
(чл. 175в, ал. 5) arrive through the autumn, so `change === 0` in spring is the
truth, not a bad parse. It only warns. Failing there would also stop the fast-moving
integrity lists from refreshing, for a reason that has nothing to do with them.

**The „(1)" footnote is data, not noise.** Its legend reads „лицето е подало
декларация извън срока" — the person DID file, late. A name *without* the marker
never filed at all. The parser carries this through as `filedLate`, and the tile
renders a chip plus the legend. Never strip it: the two states are materially
different statements about a named private individual.

**What this is NOT.** It indexes *that* a declaration was filed and *when* — never the
contents. Each declaration is a 12-page PDF form (v3.0 since 2022) with a real text
layer, so extracting assets is feasible, but it is 46k PDFs / ~37 GB and a separate
project. Filing gaps across years mostly reflect entering or leaving the corps, NOT
misconduct, and must not be presented as a compliance score.

**Framing.** Magistrates are not elected officials. Report only what the ИВСС itself
publishes. An empty non-compliance list is a finding — show it as empty rather than
hiding the list, or a reader will assume the worst.

Register quirks:
- The register lives at a bare IP over **HTTP** (`http://62.176.124.194`), a Joomla
  site the ИВСС links to as "Публикувани декларации".
- Each year has **two** PDF directories: `/declaracii/<year>/` (annual, due 15 May) and
  `/declaracii/<year>-1/` (change declarations, filed through the autumn).
- The year heading is wrapped in `<strong>`, so the heading regex must tolerate tags.
- Dedupe on the PDF path: a hyphenated surname can be listed under two letters.
- A couple of входящи номера carry a typo'd date (`15.50.2024`); they are reported and
  excluded from the calendar rather than silently dropped.

## Trust boundary: the register is fetched over plain HTTP from a bare IP

`IVSS_REGISTER` is `http://62.176.124.194` — **no TLS, no hostname, no certificate.**
The four ИВСС non-compliance lists come over HTTPS from `inspectoratvss.bg`, but the
46,528-row register behind the bare IP does not.

Everything that crawl returns is committed: magistrate names, входящи номера, positions,
courts, and PDF paths land in `data/judiciary/declarations.json` and are published. So
anyone able to observe or modify traffic on the path to that IP — a hostile network, a
compromised upstream, a DNS/BGP hijack of the address — chooses what this repository
asserts about **named private individuals**, including who appears on a non-compliance
list. The parser's asserts catch structural damage (column counts, year offsets, dedupe),
not a plausible-looking substituted name.

Consequences to respect:

- Run the ingest from a network you trust. Do not run it over public Wi-Fi or an
  untrusted VPN exit.
- **Read the diff before committing.** A name appearing on or disappearing from an
  integrity list is a claim about a person; treat an unexplained one as suspect until
  checked against `inspectoratvss.bg` (HTTPS) in a browser.
- Do not widen what is scraped from this host (e.g. the declaration PDFs themselves)
  without revisiting this note.
- If the ИВСС ever publishes the register over HTTPS with a hostname, switch
  `IVSS_REGISTER` immediately — that is the actual fix, and it is one line.

## Parser gotchas (learned the hard way)

- **The decimal separator drifts.** Up to 2021 the workload figures use a dot
  (`8.74`); from 2022 they use a comma (`7,14`). Thousands are always a space. The
  `num()` helper accepts either as the decimal mark.
- **Rows are keyed by order + numeric-cell count, never by label.** The wrapped
  "Районни съдилища извън / областните центрове" label leaves its data row *label-less*
  in section I, and the "Окръжни съдилища + СГС" label carried "+ СНС" until the
  specialised criminal court closed in 2022.
- **Section II is positional from both ends.** Take the first three numeric cells
  (judges, load/post to-consider, load/post resolved) and the last three (person-months,
  actual to-consider, actual resolved) — the civil/criminal middle block is absent for
  the tiers whose bench doesn't split.
- **Coverage.** Приложение № 1 covers the appellate, military, regional, district and
  administrative courts. The supreme courts (ВКС, ВАС) and the prosecution report
  separately and are NOT in this table — do not present the totals as "the whole
  judiciary's caseload".

## One-off backfill

Years before 2018 exist (`Otchet-2006.pdf` … `stat-2015.pdf`) but the layout differs.
Adding them is a **backfill**, not watcher work: extend `VSS_ANNUAL_TABLES`, confirm the
asserts hold for each new year, and note any layout branch here. Never wire a backfill
into the watcher or CI.
