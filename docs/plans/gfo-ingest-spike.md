# ГФО (annual financial statements) ingest — feasibility spike

**Goal.** Put per-company financials (revenue, profit, assets, employees) on the
DB company page so we can answer *"is this company's state income proportionate
to its real business?"* — the shell-company / captured-supplier signal that the
best public-sector tools (Tussell, USASpending sub-award context) surface and
that papagal.bg shows locally. A contractor billing the state €200M with €2M of
private revenue is the headline red flag procurement data alone can't show.

**Verdict up front.** There is **no structured open-data source** for Bulgarian
company financials. ГФО are filed to the Търговски регистър as **attached
documents (PDF, often scanned)** — the figures live *inside* the documents, not
in structured fields (confirmed against registryagency.bg and our own TR feed).
So this is a genuine new-source ingest requiring **document parsing (PDF text +
OCR)** or a **paid commercial feed** — not a quick build. Run Phase 0 (below)
before committing.

## Source landscape (assessed 2026-07-02)

| Source | Structured financials? | Access | Verdict |
|---|---|---|---|
| **TR published acts (обявени актове)** | ❌ — ГФО are **attached PDF/scanned documents**; line items are inside the file | per-company via portal (CF-Turnstile, like local-elections) OR the **paid full-DB export** (~100 BGN/yr, incl. act documents — see docs/tr-full-db-access-request.md) | **Primary DIY path** — get the documents, parse them |
| TR deeds open-data feed (what we ingest now) | ❌ — carries only Managers/Partners/Funds(=capital)/Seat/ActualOwner (verified: zero financial markers) | data.egov.bg (already used) | Not a financials source |
| **НСИ** annual accounts | ✅ but **aggregate only** (per sector/region, confidentiality) | open data | Not per-company — unusable for this |
| **Commercial** (papagal.bg, APIS Регистър+) | ✅ structured financials | paid API / subscription | **Stopgap** for top-N; cost + ToS + dependency (not "our own data") |
| "Expected" TR ГФО open-data initiative | ✅ (proposed) | not delivered | Watch, don't wait |

## The two real options

**A. DIY document parse (recommended long-term).** Get the ГФО documents (via the
paid full-DB export, which bundles the act files — cleaner than scraping the
portal at scale past its anti-bot), classify digital-PDF vs scanned, and extract
~5 headline line items. Reuses tooling we already run:
- digital PDFs → `pdf2array`/pdfjs (as in the budget/procurement PDF parsers),
- scanned PDFs → **Gemini Vision OCR** (proven on the Sofia-council protokols,
  ~89% match, ~$1.85/session — see project_sofia_council_per_councillor_unlock).

**B. Commercial feed stopgap.** Buy structured financials for the top-N
contractors (APIS/papagal) to ship the tile fast while A matures. Faster, but
paid + ToS + a dependency that undercuts the "all data from our own pipeline"
posture.

## Scope down — don't parse 1M companies

We don't need every company. The proportionality signal matters most for the
**~26k procurement contractors** (and the ~46k EU-funds beneficiaries). Parsing
ГФО for the contractors we actually surface is far more tractable than the whole
register, and covers ~all the value. Start there.

## Phased plan

**Phase 0 — feasibility test (small, do FIRST).** Pull ~100 ГФО documents for a
sample of real contractors, measure: (a) digital-PDF vs scanned split, (b) layout
consistency (НСС vs IFRS forms, micro/small/large templates), (c) extraction
accuracy of `pdf2array` on digital + Gemini Vision on scans for the 4–5 target
fields. Output: a go/no-go + a cost/accuracy estimate. **This decides everything.**

**Phase 1 — contractor financials.** Pipeline for the ~26k contractors:
fetch ГФО act → classify → extract → normalise (лв→EUR at the peg for pre-2026)
→ `financials(eik, year, revenue_eur, net_result_eur, assets_eur, employees, source_url, method)`
in PG. Per the DB-only rule, the page reads it from PG.

**Phase 2 — company-page integration.** A "Финансово състояние" tile (revenue /
profit / assets / employees by year) + a **proportionality** line: procurement €
÷ revenue ("87% of its revenue is state contracts"), the actual differentiator.
Later widen coverage beyond contractors.

## Schema sketch
```
financials(
  eik text, year int, revenue_eur double precision, net_result_eur double precision,
  assets_eur double precision, employees int, currency text, source_url text,
  method text,           -- 'pdf' | 'ocr' | 'commercial'
  PRIMARY KEY (eik, year)
)
```
Joins the entity graph on `eik` like everything else.

## Risks / caveats
- **Fetch at scale** is the operational hard part — per-company portal download
  hits CF-Turnstile; the paid full-DB export is the realistic bulk route.
- **Layout variance** — micro/small/medium/large templates + НСС vs IFRS; the
  extractor needs per-template field maps or a vision model with a schema prompt.
- **Scanned quality + OCR cost** — older filings are scans; Gemini Vision cost
  scales with volume (bound it via the contractor scope).
- **Coverage gaps** — not all traders file on time / at all; show "no ГФО on file".
- **EUR** — pre-2026 statements are in лв; convert at the locked peg (feedback_bg_uses_eur).

## Recommendation
Run **Phase 0** (a ~100-doc feasibility test) before any build. It's a day of work
and tells us whether DIY parsing clears a usable accuracy bar or whether we lead
with a commercial stopgap. Everything downstream (schema, tile, proportionality)
is straightforward once the extraction is proven — the extraction is the risk.
