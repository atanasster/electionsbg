# PRD: Roll-call votes — frontend features

The data pipeline is done (commit `911041c1f`). Sessions land in
`data/parliament/votes/sessions/<date>.json`; derived metrics land in
`data/parliament/votes/derived/{loyalty,similarity,cohesion}.json`.
This PRD is about exposing that data in the SPA.

## Context

- **What exists.**
  - `scripts/parliament/scrape_rollcall.ts` ingests sessions from
    parliament.bg stenograms.
  - `scripts/parliament/derived/{loyalty,similarity,cohesion}.ts`
    compute per-MP party-line adherence, MP-vs-MP cosine similarity, and
    per-party cohesion. Run weekly via GH Actions.
  - `/update-rollcall` skill orchestrates ingest manually.
  - Bucket-uploaded via `scripts/lib/upload.ts`.
- **What's missing.** The SPA doesn't fetch any of the above. No
  candidate page surfaces voting record. No party page shows cohesion.
  No way to find "MPs who vote like X."
- **Data shape (already canonical).**
  ```
  data/parliament/votes/
    index.json                    # sessions list with date, billId?, title?
    sessions/<YYYY-MM-DD>.json    # SessionItem[] — one per voting day
    derived/loyalty.json          # per-MP party-line adherence
    derived/similarity.json       # MP-vs-MP cosine similarity matrix
    derived/cohesion.json         # per-party cohesion stats over time
  ```

## Goals

1. **Per-MP voting record.** Every candidate page that's a sitting MP
   gets a "voting" tab: loyalty %, dissent count, recent notable votes.
2. **Per-party cohesion view.** Each party page shows how unified its
   parliamentary group is, with trend over time.
3. **MP-similarity browser.** Pick an MP, see their voting twins (and
   anti-twins) across party lines. Highlights cross-party blocs.
4. **Per-session pages.** One URL per voting day. Useful for sharing
   "here's how parliament voted on bill X."

## Non-goals (this PRD)

- Bill metadata (titles, sponsors, full text). The current pipeline
  records vote tuples without bill detail. Bills layer on later.
- Live election-night style updates. Sessions land in batch via the
  daily ingest job; near-real-time is out of scope.
- Comparison with other parliaments / cross-country. BG only.

## Data hooks (new files in `src/data/parliament/votes/`)

```ts
useRollcallIndex()         // sessions list (for the /votes index page)
useRollcallSession(date)   // one day's SessionItem[]
useMpLoyalty(mpId)         // mp's row from derived/loyalty.json
useMpSimilarity(mpId)      // mp's similarity vector from derived/similarity.json
useFactionCohesion()       // all parties' cohesion over time
```

All wrap through `dataUrl()` → bucket. `staleTime: Infinity` per the
existing pattern.

## Routes & screens

| Route | Screen | Data |
|---|---|---|
| `/votes` | Sessions index (date + summary) | `useRollcallIndex` |
| `/votes/:date` | One session: items, tallies, who voted what | `useRollcallSession` |
| `/candidate/:name/votes` | Voting record tab on existing candidate page | `useMpLoyalty`, `useRollcallIndex` |
| `/party/:name/cohesion` | Party group cohesion + trend | `useFactionCohesion` |
| `/parliament/similarity` | MP-similarity explorer (pick MP → see twins) | `useMpSimilarity`, `useMps` |

Each lazy-loaded via `routes.tsx` (existing pattern).

## UX details

### Per-MP voting tab (highest leverage)
- Loyalty headline: `Гласува с групата си в 87% от случаите`
- Dissent count: total + most recent N votes where MP broke party line
- For each dissent: link to `/votes/<date>` with that vote highlighted
- Sparkline showing dissent rate over time (per session, last 12 months)

### MP-similarity explorer
- Search/picker to select a "seed" MP
- Top-N similar MPs (cosine ≥ threshold), grouped by party-of-twin
- Surface CROSS-PARTY similarity prominently — that's the headline
  finding. ("MP X from party A votes most like MPs Y, Z from party B.")
- Optional: a 2D embedding (UMAP / t-SNE) of all MPs as a scatter,
  colored by party. Defer to phase 2 — needs offline embedding compute.

### Per-session page
- Header: date, total items voted, attendance %
- Per-item list: title (placeholder until bill metadata lands), tallies,
  expandable per-party breakdown
- Filter: hide unanimous, show only contested
- Per-MP "how this MP voted" filter (deep link from candidate page)

### Per-party cohesion
- Single line chart: cohesion score over time (one point per session
  week, last N months)
- Comparison toggle: overlay all parties, or pick 2-3 to compare
- Below-chart: "most divisive votes for this party" — list of items
  where intra-party agreement was lowest

## Implementation phases

**Phase 1 — Data hooks + per-MP voting tab (~3 days)**
- Five hooks in `src/data/parliament/votes/`.
- Add `/candidate/:name/votes` route + screen.
- Wire loyalty headline + dissent list.
- Ship.

**Phase 2 — Per-session page + sessions index (~3 days)**
- `/votes` and `/votes/:date` routes.
- Existing per-party color/branding + party group lookup.
- Deep links from candidate page dissents.

**Phase 3 — Party cohesion view (~2 days)**
- `/party/:name/cohesion` tab.
- Recharts line chart (already in vendor-charts).

**Phase 4 — MP-similarity explorer (~3 days)**
- `/parliament/similarity` screen.
- Picker → top-N twins UI.
- Cross-party highlighting.

**Phase 5 — UMAP embedding (optional, ~3 days)**
- Pre-compute 2D embedding offline (umap-js in derived job).
- Scatter plot screen.

## Success criteria

- Every sitting MP's candidate page has a populated voting tab within
  24h of a new session being ingested.
- A user can answer "which MPs voted against their party most often
  this month?" in ≤ 3 clicks from the homepage.
- Cohesion chart loads in < 200 ms after manifest hit (file is small).
- The cross-party similarity finding ("X from party A votes like Y
  from party B") is surfaced prominently — that's the journalism hook.

## SEO considerations

- Per-session pages prerender into `dist/votes/<date>/index.html` with
  meta tags + JSON-LD `Dataset`. Add to sitemap_static or a new
  sitemap_votes.xml.
- Per-MP voting tab is a sub-route of candidate page; the candidate's
  existing prerendered HTML stays canonical.

## Open questions

1. **Bill titles.** Without bill metadata, per-session items show as
   "Item N." Acceptable for MVP, but limits per-vote shareability.
   Worth a small follow-up scrape of the stenogram body to extract
   item titles before phase 2 ships?
2. **Cross-NS analysis.** The similarity matrix currently lives within
   one NS. Cross-NS comparison ("did MP X vote consistently when they
   moved from 51st to 52nd NS?") requires merging matrices. Defer to
   post-MVP.
3. **Public-facing terminology.** Use "lojalnost" or "партийна
   дисциплина"? Bulgarian audience cue — partial dictionary needed.
4. **Mobile UX.** Per-session pages can have 100+ items. Virtualised
   list (react-window) or paginated?

## Reference

- `src/data/dataUrl.ts` — bucket origin helper.
- `src/data/parliament/useMps.tsx` — pattern for MP data hooks with
  byId/byName lookup.
- `src/screens/components/charts/HistoryChart.tsx` — recharts wrapper
  used for trend lines.
- `src/screens/components/voteFlow/VoteFlowSankey.tsx` — d3-sankey
  example for the optional UMAP scatter.
- `data/parliament/index.json` — MP id → name/party/region lookup
  (but note: scrape_rollcall.ts uses CSV-internal MP ids that don't
  always match index.json's deduped ids; the resolved-id field in each
  SessionItem is what to join on).
