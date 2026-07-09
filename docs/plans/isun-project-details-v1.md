# ИСУН per-project details ingest — contractors + dated payments (v1)

**Goal.** Enrich the fund contract page (`/funds/contract/:number`, `FundsContractScreen`)
with two things the current data can't support:

1. **Contractors / executors** of the specific project (изпълнители по проекта) — so
   we can answer "who actually built this" per fund, not just beneficiary-wide.
2. **Dated payment events** (изплащания with dates) — enabling a **timeline by
   government** (payments bucketed into the cabinet in office at each payment date,
   reusing `cabinetAnchorContext` / the cabinet-tenure model already in the app).

Decision (2026-07-08, operator): pursue the scrape for BOTH. This plan is the
gate before writing crawl code.

## Why the existing ingest can't do it

The whole funds corpus comes from ONE endpoint: the "Проекти" bulk XLSX export
`GET https://2020.eufunds.bg/bg/0/0/Project/ExportToExcel`
(`scripts/funds/projects_fetch.ts`). Verified facts:

- The export is **15 columns (A–O)**. The ONLY temporal field is `durationMonths`
  (col N) + a `status` string. **No dates, no executors.**
- `?searchFilter=<contractNumber>` is **ignored** — the endpoint returns the full
  ~9.9 MB corpus regardless. There is no per-project query on this route.
- There is **no plain-HTTP per-project API**: `/Project/Details/<n>`,
  `/Project/Details?contractId=<n>`, `/api/projects`, `/Project/GetProjects` all 404.
- Contracts (procurement) carry only an `eu_funded` 0/1 flag — **no ИСУН project
  reference** — so there is no DB join from a fund to its procurement executors.

The executors + payment dates are shown ONLY in the **interactive** public module,
which is behind an **F5 BIG-IP ASM WAF** (`f5avr…` / `TS01…` cookies; a headed
browser hitting `/bg/0/0/Project` gets a JS-challenge interstitial, not the app).
The bulk export path is NOT challenged (that's why plain `fetch` works for it).

## Feasibility spike (do FIRST — everything below depends on it)

Before any 81k-scale crawl, prove the data exists and is machine-readable for ONE
known contract (`BG16FFPR001-2.001-0001`, АПИ Ruse–V.Tarnovo motorway):

1. Headed Playwright (reuse the pattern in `scripts/parsers_local/cik_fetch.ts` —
   it already warms an anti-bot cookie for CIK). Load `/bg/0/0/Project`, let the
   F5 challenge resolve, persist the WAF cookies to `data/_cache/funds/waf/`.
2. Drive the UI to open the project's detail view; capture the XHR/fetch the SPA
   makes (the real per-project API URL + JSON shape). This is the deliverable of
   the spike — the actual endpoint, not guessed.
3. Confirm the JSON contains: (a) an executors/contractors array (name + EIK +
   procedure/contract ref + amount), and (b) a **dated** payment/tranche array
   (date + amount). If either is absent, STOP — the corresponding feature is
   unbuildable from this source and we report that instead of faking it.

Gate: only proceed to the crawl if BOTH arrays are present and dated. Record the
endpoint + JSON schema back into this doc before building.

## Build (only after the spike passes)

- **Fetcher** `scripts/funds/project_details_fetch.ts` — WAF-cookie-warmed session
  hitting the per-project API discovered in the spike. Per
  `[[feedback_one_off_backfills]]`: the full 81,616-project crawl runs behind an
  explicit `--backfill` / `--from`/`--to` flag, NEVER in the watcher/CI. Cache raw
  JSON per contract under `data/_cache/funds/details/<n>.json` (gitignored).
  Throttle hard (WAF) — expect this to be a multi-hour, resumable crawl.
- **Parser** → typed records: `executors: {name, eik, role, procedureRef, amountEur}[]`
  and `payments: {date, amountEur, kind}[]` per contract.
- **Schema** (Postgres, follows `[[project_funds_pg_migration]]` +
  `[[feedback_no_json_from_pg]]`): two child tables keyed on `contract_number`
  FK → `fund_projects`:
  - `fund_project_executors(contract_number, eik, name, role, procedure_ref, amount_eur)`
  - `fund_project_payments(contract_number, paid_on date, amount_eur, kind)`
  Index both on `contract_number`. Wire into `recent_updates` via
  `recordIngestBatch` per `[[feedback_pg_changelog_required]]`.
- **Serving.** Extend `fund_contract_detail(number)` (043_funds_serving.sql) to
  fold `executors` + `payments` arrays into the returned jsonb, OR add two sibling
  routes in `functions/db_routes.js`. EXPLAIN ANALYZE on the worst-case contract
  (`[[feedback_db_query_perf]]`).
- **UI** (`FundsContractScreen`):
  - "Изпълнители" tile — MpAvatar-less company rows (name → `/company/:eik`,
    amount, procedure link). Reuse the row grammar from the awarder suppliers tile.
  - "Плащания по кабинети" — bucket `payments` by the cabinet in office at
    `paid_on` (cabinet tenure model already exists); a small stacked bar / timeline.
    Reconcile Σ payments ≈ `paidEur` (assert; the bulk `paidEur` is the source of
    truth for the headline).
  - Verify mobile (375px) — the fund page is already responsive; keep new tiles
    single-column on narrow.

## Fallback if the spike FAILS (WAF unbeatable or arrays absent)

- Contractors: add a clearly-labelled cross-link tile "Обществени поръчки на
  бенефициента" → `/awarder/:eik` (beneficiary-wide, NOT project-specific). Honest,
  cheap, no new data.
- Timeline by government: not buildable — report the data gap, do not fabricate.

## Spike findings (headed browser, 2026-07-08)

Ran a headed browser session against the interactive module. Established:

1. **Executors ARE first-class data — feature #2 is data-feasible.** The public
   module has dedicated entities: `Изпълнители` (executors), `Подизпълнители`
   (subcontractors), `Членове на обединение` (consortium members), and
   `Договори с изпълнители` (contracts-with-executors). The project search form
   (`/bg/0/0/Project/Search`) has an `Изпълнител` filter. So per-project
   contractors are obtainable.
2. **Timing is exposed only at YEAR granularity — feature #3 is weak/unconfirmed.**
   The search facets are `Година на стартиране/приключване (от/до)` — YEAR
   dropdowns (2007–2027), NOT dates. I could NOT reach a project `Details` page to
   check for dated payment tranches (WAF blocked it, see #3). So the only CONFIRMED
   temporal grain is the calendar YEAR. Year-level is too coarse to attribute
   payments to a specific cabinet in BG's turbulent 2021–2024 window (multiple
   cabinets per year) → the "payments by government" timeline is **not** safely
   buildable on confirmed data. Revisit only if a later Details-page read proves
   true payment dates exist.
3. **Anti-bot = F5 BIG-IP TSPD (automatic JS token, NOT a visual CAPTCHA).**
   Endpoints `/TSPD/...?type=17|22`. Behaviour observed: the `/bg` landing warms
   the token; **in-app navigation** (clicking links / submitting forms) passes;
   **hard GETs to data routes** (`/Project`, `/Project/Details?contractId=`)
   re-challenge and show a browser error page; after repeated automated hits the
   WAF **escalates to a hard block** ("The requested URL was rejected"). A scraper
   must therefore: warm TSPD via headed browser, navigate strictly in-app, throttle
   hard, and back off on rejection. Harder + more fragile than the CIK Turnstile
   case; a full 81k crawl is a real, slow, escalation-prone undertaking.

**Recommendation.** Contractors (#2): feasible but the full crawl is heavy — prefer
either an on-demand / high-value-project scrape, or ship the cheap beneficiary-wide
cross-link fallback first. Gov timeline (#3): DON'T build on year-only data; keep
blocked pending confirmation of real payment dates on a Details page.

### UPDATE — WAF hard-blocks automated crawling at scale (2026-07-09)

A second headed-browser session (attempting to reach ONE `Details` page to capture
its HTML for the parser) hit the F5 WAF's escalation ceiling: after only a handful
of data-route requests it returns **"The requested URL was rejected. Please consult
with your administrator. Your support ID is: <…>"** — and this now fires even for a
plain in-app link click (`/bg/0/0/Beneficiary`), not just hard GETs. In-app
navigation only evades the WAF for the first few requests of a fresh session.

**Consequence for the greenlit "full 81k crawl":** a full crawl needs ~81,000
data-route fetches; this WAF hard-blocks after ~a handful per session/IP. Making
that work would require **industrial-scale anti-bot evasion** — rotating IPs +
programmatically defeating the F5 TSPD challenge for tens of thousands of requests.
That is qualitatively different from "warm one cookie like the CIK path" and is
**out of scope** (systematically circumventing an anti-bot system that is actively
refusing us). I did NOT capture a Details page — the parser-gating artifact is still
missing, and the crawl-as-specified is not viable against this WAF.

**Viable paths that remain (operator to choose):**
1. **Cheap cross-link (no scraping).** Beneficiary-wide "Обществени поръчки на
   бенефициента" tile → `/awarder/:eik`. Honest, ships now, not project-specific.
2. **Very-low-volume, human-paced on-demand fetch** for a handful of flagship
   projects only — stays within what the WAF tolerates; cannot cover the corpus.
3. **Official data request (ЗДОИ)** to ИСУН/УО for a bulk executors + payment-dates
   dataset — the legitimate route to the data at scale; unblocks BOTH #2 and #3
   (dated payments) if granted. Slow (statutory response window) but clean.

## Status

- [x] Feasibility spike on the bulk/plain-HTTP paths — CONFIRMED insufficient.
- [x] Headed-browser spike — executors CONFIRMED available; payments YEAR-only
      (dated tranches unconfirmed, WAF-blocked); anti-bot characterised (F5 TSPD).
- [x] Attempt to capture ONE Details page — FAILED: F5 WAF hard-blocks after a
      handful of data-route requests ("requested URL was rejected"); parser-gating
      artifact NOT obtained; full crawl not viable without industrial anti-bot
      evasion (out of scope).
- [x] Operator re-decision (2026-07-09): **SHELVED.** Full crawl non-viable (WAF);
      fund page already cross-links to the beneficiary, so no new work. Revisit via
      a ЗДОИ bulk-data request if the feature is wanted at scale later.
