# MP Financial Connections — Implementation Plan

_Companion to [docs/mp-financial-connections-research.md](../mp-financial-connections-research.md). Read that first for the data-source feasibility analysis._

> **Update after Slice 0** — see [mp-financial-connections-slice0-findings.md](mp-financial-connections-slice0-findings.md). Two changes affect §3 and §4 below:
> 1. Declarations are **structured XML**, not PDFs — the parser is trivial.
> 2. Management/board roles are **legally absent** from declarations (ЗПК Art. 35 incompatibility) — the Commerce Registry is the only source, so Slice 3 becomes required, not optional.

## 1. Goal

Surface the business affiliations of seated Bulgarian MPs (current + former companies, board roles, ownership) inside the existing candidate dashboards, and add a network ("spatial") view that visualises shared connections across MPs and non-MP associates.

Not in scope: financial figures of MPs (income/assets), conflict-of-interest scoring, predictive analytics. Those are downstream features once the base graph exists.

## 2. Data sources (decided)

| # | Source | What it gives | Format | Notes |
|---|---|---|---|---|
| A | Court of Audit register — `register.cacbg.bg` | MP property + interest declarations: company participations, management roles (current and prior 12 months), incomes, debts | Per-MP PDFs in year-indexed static HTML directories | **Primary source.** Static HTML, predictable URLs (`{year}/index.html`, `2021_nc/` for НС). |
| B | `data.egov.bg` Commerce Registry dump | Company filings (officers, owners, addresses, status) | Daily JSON/XML, CC0 | EGN replaced with hash+salt — joins via full name only. Used to enrich companies referenced in declarations and to discover non-MP co-officers. |
| C | `parliament.bg` (existing scraper, [scripts/parliament/scrape_mps.ts](../../scripts/parliament/scrape_mps.ts)) | MP identity, names, photo, current Народно събрание | Already in [public/parliament/index.json](../../public/parliament/index.json) | Anchor for matching declarations to seated MPs. 240 current MPs in 52-ро НС. |

Supplementary: optionally email **Открит парламент** ([openparliament.net](https://openparliament.net/)) to ask if they share parsed declaration CSVs — could skip the PDF parser entirely for the initial cycle.

## 3. Pipeline architecture

Mirrors the existing `scripts/smetna_palata/` and `scripts/parliament/` patterns: a separate scraper invoked from `scripts/main.ts` behind a CLI flag, output written as static JSON under `/public/parliament/` (already the home of MP profiles).

```
scripts/
  declarations/
    index.ts               # entry point, called from main.ts
    scrape_cacbg.ts        # walks register.cacbg.bg → PDFs to raw_data/declarations/{year}/{mpId}.pdf
    parse_declaration.ts   # pdfplumber-equivalent in node (see §3.2) → typed JSON
    match_to_mps.ts        # fuzzy-match declarant name → existing MP id from public/parliament/index.json
    enrich_companies.ts    # for each EIK referenced, look up company record from TR dump (§3.3)
    build_graph.ts         # produces the network: nodes (MPs, persons, companies), edges (role, owner, co-officer)
```

CLI flag added to `main.ts`: `--declarations` (mirrors existing `--financing`, `--candidates`, etc.). `--all` opts in.

### 3.1 PDF acquisition

`register.cacbg.bg` exposes year-indexed directories. Each declarant has a stable URL pattern. Scrape lazily with a per-MP cache file (`raw_data/declarations/{year}/{mpId}.pdf`) — never re-download a PDF that exists. Politeness: 1 req/sec, `User-Agent: electionsbg.com data pipeline`.

The 2021_nc directory specifically lists Народно събрание. Walk year by year for the parliaments we care about (current 52nd НС first; backfill earlier on demand).

### 3.2 PDF parsing

Declarations follow a **fixed ordinance template** with predictable section headings. Two extraction approaches:

- **Preferred:** `pdf2json` or `pdfjs-dist` (already common in Node ecosystems, no native deps) to extract text + table coordinates. Sections are stable: "II. Имущество", "III. Други доходи", "VI. Дялово участие в търговски дружества", "VII. Лица, на които съм управител или член на орган на управление".
- **Fallback for image-only PDFs:** few are scanned; for those we tag the row as `parseError: "scanned"` and surface manually-corrected JSON in `raw_data/declarations/manual/{mpId}.json` that overrides the parser output.

Each declaration parses to a typed record (see §4). A small golden-file test (`scripts/declarations/__tests__/parse_declaration.test.ts`) pins the parser against three hand-checked PDFs (one easy, one with multi-page tables, one with a re-declaration / amendment).

### 3.3 Commerce Registry enrichment

The full TR dump is ~hundreds of MB of daily JSON. We do **not** ingest it into the repo. Instead:

1. One-time download into `raw_data/tr_dump/{date}/` (gitignored).
2. Build a local **EIK → company-record** index (`scripts/declarations/build_tr_index.ts`) — keep only fields we need: name, status, address, current officers (name + role), current owners (name + share %).
3. For each EIK referenced in any MP declaration, write `public/parliament/companies/{eik}.json`. Only the small subset of "MP-touched" companies ships in `/public`.
4. From those company records, derive **non-MP associates** (officers/owners that are not in our MP index) — these become graph nodes too.

This keeps the static-asset footprint bounded (~hundreds of companies, not millions) while making any MP→company→associate query a flat-file lookup at runtime.

## 4. Data shape (TypeScript types)

Add to `src/data/dataTypes.ts` (consumed by both scripts and frontend):

```ts
export type MpDeclaration = {
  mpId: number;                    // matches public/parliament/index.json
  declarantName: string;           // as printed on the PDF
  year: number;                    // declaration year
  filedAt?: string;                // ISO date
  sourceUrl: string;               // link to the original PDF
  parseStatus: "ok" | "partial" | "scanned";

  companyRoles: MpCompanyRole[];   // sections VI + VII
  incomes?: MpIncome[];            // section III (optional, low priority)
  debts?: MpDebt[];                // section IV (optional)
};

export type MpCompanyRole = {
  eik?: string;                    // ЕИК — may be absent in older PDFs
  companyName: string;             // as written
  role: "owner" | "shareholder" | "manager" | "board_member" | "other";
  sharePercent?: number;           // for owner/shareholder
  startDate?: string;
  endDate?: string;                // null = still active
  isCurrent: boolean;              // derived from end date + declaration year
};

export type MpCompanyRecord = {
  eik: string;
  name: string;
  status: "active" | "in_liquidation" | "bankrupt" | "deleted" | "unknown";
  registeredAt?: string;
  address?: string;
  officers: MpCompanyOfficer[];    // current officers from TR
  owners: MpCompanyOwner[];        // current owners from TR
  sourceUrl: string;               // canonical TR portal link
};

export type MpCompanyOfficer = {
  name: string;
  role: string;                    // raw role string from TR
  isMp: boolean;                   // true if name fuzzy-matches a known MP
  mpId?: number;
};

export type MpCompanyOwner = {
  name: string;                    // person OR legal entity
  isLegalEntity: boolean;
  eik?: string;                    // if legal entity
  sharePercent?: number;
  isMp: boolean;
  mpId?: number;
};

export type MpConnectionsGraph = {
  generatedAt: string;
  nodes: MpGraphNode[];
  edges: MpGraphEdge[];
};

export type MpGraphNode =
  | { id: string; type: "mp"; mpId: number; label: string; partyGroup?: string }
  | { id: string; type: "person"; label: string }                 // non-MP associate
  | { id: string; type: "company"; eik: string; label: string; status: string };

export type MpGraphEdge = {
  source: string;
  target: string;
  kind: "owner" | "shareholder" | "manager" | "board_member" | "co_officer";
  sharePercent?: number;
  isCurrent: boolean;
  declarationYear?: number;
};
```

Output files:

```
public/parliament/
  declarations/
    {mpId}.json           # MpDeclaration[] (one entry per year)
  companies/
    {eik}.json            # MpCompanyRecord
  connections.json        # MpConnectionsGraph (whole graph; expect ~3–10k nodes)
  connections-index.json  # {mpId: [neighbouringNodeIds]} for fast per-MP loading
```

The whole graph compressed (gzip-dist already runs in the build) should be well under 1 MB based on current-NS scale (~240 MPs × ~3–5 connections = a few thousand edges).

## 5. Candidate-dashboard integration

Existing entry point: [`MpProfileHeader.tsx`](../../src/screens/components/candidates/MpProfileHeader.tsx) renders MP info on the candidate page. We add a sibling tile section.

### 5.1 Hooks

Add to `src/data/parliament/`:

- `useMpDeclarations(mpId)` → loads `/parliament/declarations/{mpId}.json`. Same React Query pattern as `useMpProfile`.
- `useMpCompany(eik)` → loads `/parliament/companies/{eik}.json`.
- `useMpConnectionsGraph()` → loads `connections.json` (whole-graph view, lazy on Spatial screen entry only).
- `useMpNeighbourhood(mpId)` → loads `connections-index.json` once, then derives the subgraph around a single MP for the dashboard tile.

All read-only, `staleTime: Infinity`, fits the existing data-hook pattern in CLAUDE.md.

### 5.2 Tiles on the candidate dashboard

Inserted on the candidate dashboard for MPs (gated on `indexEntry.isCurrent` first, then backfill historic):

1. **"Бизнес връзки" summary tile** — count of current company roles, count of unique companies, count of co-officers who are also MPs. Click → expands.
2. **Roles table** — `MpCompanyRole[]` rendered with the existing `DataTable` from `src/ux/`. Columns: company (links to `/mp/company/{eik}`), role, share %, start, end, source PDF (icon link). Default sort: current first, then by start date descending.
3. **Mini-graph card** — small 1-hop neighbourhood (this MP + companies + immediate co-officers) using d3-force. Click → opens full Spatial UI focused on this MP.

### 5.3 New routes

- `/mp/company/:eik` → `MpCompanyScreen` — single company page: officers table, owners table, all connected MPs.
- `/connections` → `ConnectionsScreen` — full-graph spatial view (§6).
- `/connections/mp/:mpId` → same screen, focused starting node.

Add to `src/routes.tsx` with the same lazy-import pattern used elsewhere.

## 6. Spatial UI

Goal: an explorable force-directed graph of MPs ↔ companies ↔ non-MP associates with filtering by party group, role type, and currency (current vs historic).

**Rendering library — recommendation: d3-force + custom SVG/Canvas.** The project already depends on `d3 ^7.9.0` (no new top-level dependency). For ≤10k nodes, d3-force on Canvas performs well. `react-flow` is overkill (it's authoring-oriented; we want exploration), and `cytoscape.js` would be a fresh dependency.

### 6.1 Layout

- Force simulation with `forceManyBody`, `forceLink`, `forceCenter`. MPs clustered by party group via a categorical `forceX`.
- Node colour: blue = MP, gray = non-MP person, gold = company. Size proportional to degree.
- Edge style: solid = current role, dashed = historic.

### 6.2 Interactions

- Hover → highlight 1-hop neighbourhood, dim everything else.
- Click → side panel with the entity's full record (declaration source link for MPs, TR source link for companies).
- Filters: party group multi-select, role-kind toggles, current/historic toggle, search-by-name autocomplete (reuse `src/screens/components/Search` patterns).
- "Find connection" — given two MPs, BFS the graph and highlight the path. Two clicks.

### 6.3 Performance

For ~3–10k nodes the simulation can run on the main thread with `alphaDecay` tuned conservatively. If we exceed that on backfill (multiple parliaments), move the simulation to a Web Worker — straightforward with d3-force since it has no DOM dependencies.

## 7. Phasing

Ship in slices. Each slice is independently deployable.

| Slice | Deliverable | Demo path |
|---|---|---|
| **0 — research close-out** | Decide PDF parser library, sanity-check 5 PDFs by hand, confirm field coverage | Manual notebook in `scripts/declarations/notebooks/` |
| **1 — single MP, manual** | Pipeline parses 1 declaration to `public/parliament/declarations/{mpId}.json`, dashboard shows the roles tile | Visit one MP page, see business roles |
| **2 — current parliament** | Bulk parse all 240 MPs in 52nd НС, ship roles tile + per-company page | Browse all current MPs, click through to companies |
| **3 — TR enrichment** | Companies pages show non-MP officers/owners, mini-graph card on MP dashboard | Click a company, see its full officer list |
| **4 — Spatial UI** | `/connections` route with full-graph d3-force exploration | Open the page, filter, find paths |
| **5 — backfill** | Earlier parliaments (51, 50, 49…) | Time-travel via `ElectionContext` |
| **6 — i18n + SEO** | Bulgarian + English translations; prerender new routes (per [feedback_static_seo.md](../../.claude/projects/-Users-atanasster-data-bg/memory/feedback_static_seo.md)) | Crawler-visible meta on `/mp/company/{eik}` |

Slices 1–3 deliver real value before the spatial UI exists. Slice 4 is the headline feature.

## 8. Open questions / risks

1. **Name matching across sources.** Bulgarian names are reordered in different filings ("Иван Петров Иванов" vs "Иванов, И. П."). Need a robust normaliser — punt to Slice 1, gather error rate before scaling.
2. **PDF parser maintenance.** If the Court of Audit changes the declaration template (it has changed at least once with the КПКОНПИ→СП transition), the parser breaks. Keep golden files; add a CI check that re-parses them.
3. **Legality of company-link republishing.** Names in TR are public; we are not republishing EGNs. Add a short "data sources & methodology" page (linked from every dashboard) that cites the GDPR journalistic-purpose basis. Coordinate language with legal once before slice 2 ships.
4. **Common-name false positives.** "Георги Иванов" matches many people. Conservative default: when fuzzy-match confidence < threshold, mark the edge `unverified: true` and render dashed-with-tooltip in the spatial UI rather than asserting the connection.
5. **Disambiguation at company level.** Some declarations write company names without EIK; without EIK we cannot reliably enrich. Track `eikMissing` in the data and surface the row as text-only (no link) until manually resolved.
6. **Open Parliament collaboration.** Their parsed dataset (if shared) could collapse Slice 0–2 to days. Worth one outreach email before building the parser.
7. **Backfill reliability.** Older PDFs (pre-2019) are more likely scanned. Backfill cost is unbounded — defer past slice 5 until current-cycle quality is proven.

## 9. Definition of done — Slice 4 (the headline)

- All 240 MPs in the current Народно събрание have a declarations entry in `public/parliament/declarations/`.
- Each MP candidate page shows the roles tile and mini-graph card.
- Each referenced company has a page at `/mp/company/{eik}`.
- `/connections` renders the full graph with party-group / role / currency filters and "find connection between two MPs".
- Bulgarian and English translations land for all new strings.
- Source links on every record point back to the originating PDF / TR filing.
- Prerender step covers the new routes (no SEO regression).
