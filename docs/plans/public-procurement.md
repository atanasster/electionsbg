# PRD: Public procurement (АОП) — money-flow + conflict-of-interest

The single highest-impact unbuilt feature on the roadmap. Joins
public-procurement award data to the existing MP business-connections
graph to expose patterns like "company X, owned by family of MP Y,
received N лв in state contracts."

## Context

- **АОП** (Агенция по обществени поръчки → Агенция за обществени
  поръчки) is the Bulgarian Public Procurement Agency. Award data is
  open via data.egov.bg + the АОП register itself.
- **What we already have.**
  - `data/parliament/connections.json` — MP-to-company ownership +
    management edges (built from register.cacbg.bg + Commerce Registry,
    refreshed by `/update-connections`).
  - `data/parliament/companies-index.json` — EIK (Bulgarian company id)
    → company name + roles.
  - The watcher already polls data.egov.bg's commerce extract for
    timestamp changes. Procurement is a sibling dataset on the same
    portal but a different bucket.
- **What's missing.** No procurement data in the system. No way to
  cross-reference contracts against MP-tied EIKs. No money-flow
  visualization.

## Why this matters

The MP-connections graph already shows _what_ MPs own. Procurement
data shows _what they get paid_. The cross-reference is the
journalism payload — it converts the connections graph from "MPs have
business interests" (true but abstract) into "MPs' interests received
N лв in public contracts" (specific, sourced, verifiable).

This is what civic-tech sites in other countries (e.g. Bihus.info in
UA, civio.es in ES) lead with. Currently no BG site does this with
this much rigor.

## Goals

1. **Ingest АОП award records** at contract granularity (contractor
   EIK, awarding body, amount, date, subject).
2. **Cross-reference contractors against MP-connected EIKs** to surface
   conflicts of interest.
3. **Money-flow surfaces in the SPA**:
   - Per-MP "public contracts to connected companies" panel
   - Per-company contract history (with MP affiliations highlighted)
   - "Top contractors" list, with MP-tied flagged
   - Contract-level detail page for sharing
4. **Stay defensible.** Surfacing conflicts is editorial; we report
   facts (X owns Y; Y received Z). No accusations of wrongdoing.

## Non-goals (this PRD)

- Full АОП archive back to the agency's founding. MVP covers the
  current year + previous 2-3.
- Procurement procedures other than awards (e.g. tender announcements,
  appeals). Awards are what's spent.
- Cross-EU TED (Tenders Electronic Daily) integration. Could come later
  for high-value contracts but adds another data shape.
- A predictive "this looks corrupt" model. We surface raw connections
  + amounts; readers + journalists draw conclusions.

## Data sources

| Source | URL | Notes |
|---|---|---|
| **АОП register / data.egov.bg** | `https://data.egov.bg/data/resourceView/...` | Bulk JSON/CSV exports per year. Field set: договор, изпълнител (EIK + name), стойност, дата, възложител, предмет |
| **Commerce Registry (already ingested)** | `data.egov.bg` | EIK lookup, ownership chains |
| **NSI gov-org index (optional)** | NSI publishes the list of awarding bodies (министерства, агенции, общини) for normalisation |

Watcher source: extend `scripts/watch/sources/egov_commerce.ts` or
add a sibling `egov_procurement.ts` checking the procurement dataset's
`last-modified` timestamp.

## Data model

```
data/procurement/
  index.json
    { years: ["2024", "2025", "2026"], totals: { ... }, lastIngest: "..." }
  contracts/<YYYY>/<bucket>.json
    Contract[]  — sharded by month or by awarding body to keep file size sane
  contractors/<EIK>.json
    Per-contractor rollup: lifetime award total, awarding bodies, contract list
  awarders/<orgId>.json
    Per-awarding-body rollup
  derived/
    mp_connected.json   — flattened: { mpId, eik, totalAwarded, contractCount }
    top_contractors.json — sorted by amount
    flow.json           — sankey-shaped: awarder → contractor → MP
```

```ts
type Contract = {
  id: string;             // АОП contract id
  date: string;           // ISO YYYY-MM-DD
  awarderId: string;      // normalised gov body id
  awarderName: string;
  contractorEik: string;  // joins to companies-index.json
  contractorName: string;
  amountBgn: number;      // contract value, лв
  vatIncluded: boolean;
  subject: string;        // short description
  cpvCode?: string;       // EU procurement classification
  procedureType: string;  // открита, договаряне, обявление за малка, ...
  url?: string;           // link back to the AОП notice
};
```

## SPA features

### Per-MP "public contracts" panel
On `/candidate/:name/connections` (existing connections page) — add a
new tile: "Связани компании с обществени поръчки" listing every
company connected to this MP that received a public contract in the
last N years, sorted by amount. Each row links to the contractor page.

### Per-company contract history
New page `/company/:eik` (or extend existing if there's one) — full
contract history, total awarded, awarding body breakdown, optional
CPV-category breakdown. MP affiliations shown as a sidebar.

### Top contractors list
New page `/procurement` — top-N contractors by amount across the
period, with MP-tied highlighted (badge or color tint).

### Contract detail
Lightweight per-contract page `/procurement/contract/:id` for sharing.
Fields, source link back to АОП.

### Money-flow visualization
On `/procurement` (or its own route) — sankey: awarding bodies →
contractors → MPs (only the MP-tied flow, to keep the diagram readable).
Reuses the existing `VoteFlowSankey` pattern.

## Pipeline

- `scripts/watch/sources/egov_procurement.ts` — fingerprint dataset
  last-modified.
- `scripts/procurement/scrape.ts` — pull bulk export, parse, normalise.
- `scripts/procurement/normalize.ts` — awarder-id normalisation,
  amount currency normalisation (most are лв but check), date parsing.
- `scripts/procurement/cross_reference.ts` — join contractor EIKs
  against `data/parliament/companies-index.json`. Output
  `derived/mp_connected.json`.
- `scripts/procurement/derived.ts` — top-contractors,
  awarder/contractor rollups, flow.
- `/update-procurement` Claude Code skill wraps the chain.
- `bucket:sync` after success.

## Validation

- Schema validation on every contract record (zod recommended).
- Sanity check: total awarded per year vs. published АОП annual
  totals (within 5%). If wildly off, parser drift or missing source —
  block ingest, surface report.
- Currency sanity: amounts > 1B лв are individually flagged for review
  (could be a source data error or genuinely huge contract — both
  warrant a human glance).
- Canary contract: pin one historical contract as a regression
  fixture in `tests/fixtures/procurement/`.

## Implementation phases

**Phase 1 — Ingest pipeline (~1 week)**
- Watch source + scraper + parser + validator.
- Single year (current) only. Storage layout above.
- `/update-procurement` skill.
- Output `data/procurement/contracts/2026/...` + `contractors/<EIK>.json`.

**Phase 2 — Cross-reference (~3 days)**
- `cross_reference.ts` joins contractors to MP-companies.
- Output `derived/mp_connected.json` — the journalism payload.
- Sanity-check by hand on 5-10 known cases.

**Phase 3 — Per-MP "connected contracts" panel (~3 days)**
- Add tile to existing `/candidate/:name/connections` page.
- Hooks for `useMpConnectedContracts(mpId)`.

**Phase 4 — Top contractors + per-company pages (~5 days)**
- `/procurement` index.
- `/company/:eik` detail.
- Sortable, filterable.

**Phase 5 — Money-flow sankey (~3 days)**
- Add to `/procurement` or a separate `/procurement/flow` route.
- MP-tied flow only (full bipartite would be unreadable).

**Phase 6 — Backfill prior years (~3 days)**
- Re-run scraper for 2024, 2025.
- Append to existing files.

**Phase 7 — Article(s) walking through the data** (optional, content
work — not engineering)
- Draft a launch article in `public/articles/` introducing the data
  + a worked example.

## Editorial guardrails

This dataset is sensitive. The PRD recommends:

- **Source link on every claim.** Each contract row has a `url` back
  to the original АОП notice. Show it in the UI.
- **No editorialising in the data layer.** Don't compute or display
  "suspicious score." Surface raw amounts + connections; let the
  reader assess.
- **Conservative MP linking.** Only flag a connection if it's recorded
  in the official declarations (cacbg) OR Commerce Registry. Don't
  guess via name matching.
- **Family-tied vs. directly-owned distinction** preserved from the
  existing connections graph. UI shows the relationship type
  ("MP X's spouse owns Y", "MP X is on the board of Y").
- **Right of reply convention.** Add a footer note inviting affected
  parties to submit corrections.

## Success criteria

- AОП watcher fires when new procurement data is published; ingest
  runs within 24h; new contracts appear in the SPA the next deploy.
- Top 50 MP-connected contractors by amount are accurate vs.
  spot-check of 10 cases.
- The launch article gets coverage from at least one BG outlet
  (Капитал, Mediapool, Дневник, etc.) — qualitative success metric.

## Open questions

1. **Source choice.** data.egov.bg's procurement export vs. scraping
   the АОП register directly. Latter has more fields but heavier
   scraping. Recommend egov bulk first; fall back if fields are thin.
2. **EIK normalization.** Some records have a 9-digit EIK, some have
   13 (with branch suffix). Normalize to 9 for the join, preserve full
   for source link.
3. **Local government contracts.** Общини and регионални структури
   procurement is also AОП-published. Include or scope to central gov?
   Recommend include — the local stories are often the juiciest.
4. **VAT handling.** Some contracts list amount with VAT, some without.
   Need a single canonical comparison number. Use без-ДДС as canonical;
   compute с-ДДС on the fly when displaying for completeness.
5. **Anonymisation of small contracts.** Below some threshold (1000 лв?)
   the data is noisy. Filter or display all? Recommend display all for
   transparency, with a default sort by amount.

## Reference

- `data/parliament/connections.json` — MP-to-company edges.
- `scripts/watch/sources/egov_commerce.ts` — pattern for an egov.bg
  watcher source.
- `scripts/parliament/scrape_rollcall.ts` — best reference for an
  ingest pipeline that handles validation + canary.
- `scripts/lib/upload.ts` — bucket upload helpers.
- `src/screens/components/voteFlow/VoteFlowSankey.tsx` — d3-sankey
  example for the money-flow visualization.
- `src/data/parliament/useConnectionsGraph.tsx` — pattern for the
  connections-style SPA hook.
