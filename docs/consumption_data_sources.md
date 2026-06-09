# Consumption view — adding per-oblast wages, NSI HPI, КЕВР utilities

Feasibility + implementation analysis for the three deferred cost-of-living ingests, 2026-06-09, **revised after a deep extraction spike**.

> **Build attempt (2026-06-09, coordinate-level):** went to implement КЕВР water + a curated wage snapshot; both confirmed NOT reliably buildable. **КЕВР water:** a pdfjs *coordinate* parse cleans the rows, but the major operators (Благоевград, Бургас, Варна, …) run **multiple water systems** and the household supply rate is ambiguously stacked relative to the operator name/№ (e.g. Благоевград's supply sits in Берковица's vertical band) — so any auto-parse **mis-assigns the big-city tariffs**, and picking the right per-operator household rate needs domain interpretation, not parsing. Small single-system munis parse fine, but the oblast capitals (what users want) don't. **Wages:** all 28 oblast values need either the 28 ТСБ per-oblast PDFs (which ARE fetchable — `/tsb/wp-content/uploads/…` returns 200 — but their filenames are inconsistent and only discoverable from the Cloudflare-walled listing pages) or the Infostat Playwright scrape. **Decision: do NOT ship either** (inaccurate cost-of-living data is worse than none). Keep the shipped clean baseline (КЗП basket + КЗП-vs-HICP + national HPI + GDP-per-capita affordability). Real builds need: КЕВР = manual per-city household-rate curation; wages = a dedicated Infostat/ТСБ-PDF scraper.

> **Spike verdict (2026-06-09):** the optimistic "tractable via press release" read below was **wrong for wages**. The exhaustive spike found: (1) **wages are genuinely walled** — the per-oblast table in the NSI press-release PDF is a **chart image** (`Фиг. 8`, not extractable text); nsi.bg **content/press pages are Cloudflare-walled from scripts** (curl → 0 bytes; only static `/sites/default/files/...` paths fetch); and the static labour XLS filename isn't discoverable (all guesses 404). So there is **no clean automated oblast-wage ingest** — only an Infostat Playwright scrape (fragile) or a hand-curated snapshot. (2) **КЕВР water tariffs DO extract as text** (verified: Берковица supply 1.829 + sewer 0.313 lv/m³, Бургас 2.992 + 0.730, …) but the multi-column / multi-row layout (wholesale "на друг ВиК" + non-potable + treatment tiers interleaved, multi-line operators) makes a **robust parser a fragile iterative effort** — a first heuristic pass extracted 0 clean rows. (3) **HPI national** is already shipped (Eurostat). Net: keep the GDP-per-capita affordability proxy; the two builds are fragile one-offs, not clean ingests. The section below is the original (pre-spike) plan, retained for the source/URL references.

## The shared constraint (and the way around it)

- NSI's **clean JSON-stat open-data API** (`getopendata_json.php?id=N`, the one `scripts/regional/fetch_nsi.ts` uses) has **none** of these at sub-national grain — verified by probing: the wage datasets (id=612) are by economic-activity only, income (id=470/690) splits urban/rural, and House-Price-Index returns 0 catalog matches.
- NSI's **Infostat dissemination DB is Cloudflare-walled** — re-confirmed (`server: cloudflare`, `cf-ray`; `infostat.nsi.bg` 301-redirects to a landing page, the data app is a JS SPA behind CF).
- **BUT** the sub-national wage and HPI breakdowns are *also* published in NSI **quarterly press releases + per-oblast Territorial-Statistical-Bureau (ТСБ) PDFs on nsi.bg**, which are ordinary content pages (Cloudflare lets them through — only the Infostat SPA is the hard wall). So wages/HPI do **not** require the Infostat-SPA bypass.
- Repo infra available either way: `scripts/parsers_local/cik_fetch.ts` (Cloudflare/cf_clearance bypass, if ever needed) and `scripts/budget/pdf_table.ts` + `scripts/council/lib/pdf_text.ts` (deterministic PDF-table extraction).

---

## 1. Per-oblast wages — HIGH value · MEDIUM effort · **RECOMMEND BUILD**

**Why it's the prize.** It upgrades the affordability tile + the `basketAffordability` AI tool from a **GDP-per-capita proxy** to a real **average wage per oblast** → a genuine "basket cost vs local wage" / months-of-wage affordability index (the Numbeo "Local Purchasing Power" pattern). The affordability feature already ships; wages make it real.

**Data.** NSI average gross monthly wage per oblast (28), quarterly. (Q3 2025: national 2,549 BGN; Sofia 3,474; Kyustendil 1,762.)

**Access — two fetchable nsi.bg paths (no Infostat SPA):**
- (a) The **quarterly national press release** "Наети лица и средна работна заплата" (`/press-release/...-8846`) carries the **consolidated per-oblast table** — parse its HTML table or, if present, a downloadable XLS/CSV annex (cleanest).
- (b) The **28 per-oblast ТСБ PDFs** (`/tsb/wp-content/uploads/YYYY/MM/SRZ-<Q>-<YYYY>-<obl>.pdf`) — one per oblast/quarter; reuse `budget/pdf_table.ts`.

**Effort.** Medium. **Spike first**: open the latest press release and confirm whether a per-oblast **XLS/CSV annex** exists (→ trivial parse) vs only an HTML table (→ scrape) vs only the 28 PDFs (→ pdf_table per oblast). Then one-off `--backfill` + a quarterly watcher source.

**Integration.** Write a per-oblast `avgWage` series into `data/regional.json` (oblast-keyed → joins the affordability tile/AI tool **directly**, same codes). Then make the affordability metric `basket ÷ wage` (months/weeks of wage), keeping GDP-per-capita as a secondary signal. Update **both** the frontend `ConsumptionAffordabilityTile` and the AI `basketAffordability` (per the in-code "keep in sync" note). Convert BGN→EUR at 1.95583 and display `${n} €` / `€${n}`.

**Caveat.** It's **gross** wage, not net — still far better than GDP/capita; note it in the methodology line.

---

## 2. NSI House Price Index (sub-national) — LOW value · **SKIP**

- **Already shipped**: the **national** HPI YoY (Eurostat `prc_hpi_q`) is in `macro.json` (`housePricesYoY`) and surfaced on the Consumption inflation tile. Clean, done.
- **Sub-national** NSI HPI grain is **NUTS2 statistical region (6) + 6 big cities** — *not* oblast. It lives in Infostat (walled) and the quarterly HPI press release; even via the press release the grain is coarse (6 regions) and adds little over the national signal already shown.
- **Recommendation: skip.** Revisit only if a dedicated "property" tab is wanted, then via the HPI press release (NUTS2 + 6 cities), clearly labelled coarse. Property transaction *prices* remain closed (Агенция по вписванията = counts only).

---

## 3. КЕВР water utilities — MEDIUM value · MEDIUM effort · **BUILD if a utilities section is wanted**

**Value.** Per-operator water + sewerage tariffs (~28 ВиК operators ≈ oblast grain) are a real cost-of-living component absent from the КЗП basket — a "Комунални / Utilities" section on the Consumption view.

**Data.** КЕВР "Утвърдени цени на ВиК услуги" — an **annual consolidated PDF** on dker.bg (`/uploads/2025/Ceni_ViK_uslugi_01012025.pdf`), one table, ~28 operators, lev/m³ for supply + sewerage + treatment. **Not** on data.egov.bg as a clean CSV (confirmed — PDFs only).

**Access.** PDF-table parse — reuse `scripts/budget/pdf_table.ts`. It's **one** consolidated PDF (not 28 separate), so the parse is bounded. Behind a `--backfill` flag; annual refresh (Dec–Jan) when КЕВР issues new tariffs.

**Fragility.** PDF layout can shift year-to-year — calibrate the column parse (same discipline as the local-section ingest's per-cycle column offset).

**Integration.** `data/utilities/water/` keyed per operator → map operator→oblast → a per-oblast water-tariff tile (+ optional AI tool). National gas (КЕВР monthly, national PDF) and district heating are national/per-utility grain — lower fit, defer. Telecom (КРС) is national pricing — excluded.

---

## Recommended sequence

1. **Wages** — highest value, tractable via the press release / ТСБ PDFs (no Infostat SPA). Spike the format, then build → the real purchasing-power index. This is the one that materially upgrades the feature.
2. **КЕВР water** — if you want a utilities section; reuse the PDF infra; annual cadence.
3. **HPI sub-national** — skip (national already shipped; sub-national is coarse + walled).

## Summary

| Domain | Grain | Source (fetchable path) | Access | Reuse | Value | Rec |
|---|---|---|---|---|---|---|
| **Wages** | oblast (28), quarterly | NSI press release + ТСБ PDFs (nsi.bg) | HTML/XLS/PDF parse — **no Infostat SPA** | `budget/pdf_table.ts`, `regional.json` join | High | **Build** |
| **HPI sub-national** | NUTS2 (6) + 6 cities | Infostat / HPI press release | walled/coarse | — | Low | **Skip** (national Eurostat done) |
| **КЕВР water** | per-operator ≈ oblast, annual | dker.bg consolidated PDF | PDF-table parse | `budget/pdf_table.ts` | Medium | **Build if utilities tab wanted** |

All three were previously blocked as "not in the clean open-data API." The new finding: **wages (and HPI) have a press-release/PDF path on nsi.bg that sidesteps the Cloudflare-walled Infostat SPA** — so wages move from "fragile Infostat scrape" to "tractable PDF/HTML parse," which is what makes the purchasing-power upgrade worth doing.
