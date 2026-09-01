# Audit — `home-dashboard-implementation-v1.md`

**Subject:** [docs/plans/home-dashboard-implementation-v1.md](../plans/home-dashboard-implementation-v1.md) (954 lines, "ready to execute")
**Date:** 2026-09-01
**Method:** every factual claim in the plan checked against the tree at `main`; every registry, gate and budget the plan touches read.

**Verdict: not ready to execute as written.** The product shape is sound and most current-state claims are accurate. Four findings are outright wrong or self-contradictory (B1–B4), six are missing work that will fail existing gates or ship a known defect class (H1–H6), and nine are gaps worth closing before Phase 0. Nothing here argues against the outcome; the fixes are edits to the plan, not a redesign.

---

## A. Confirmed correct — do not re-litigate

| Plan claim | Verified |
| --- | --- |
| index route → `DashboardScreen`; `DashboardCards` owns the result | `src/routes.tsx:1797`, `src/screens/DashboardScreen.tsx` |
| `/elections` does not exist; only `elections/:date` | `src/routes.tsx:4034` |
| root-as-election link sites | `placeViews.ts:152`, `crossElectionLink.ts:35`, `ElectionsBreadcrumb.tsx:43`, `reportMenus.ts:64,71`, + `PlaceHeader.tsx:214` fallback. That is the complete set in `src/` — grep for root-as-destination returns only these plus the logo. |
| `open_call` kind drift (§7.1) | **Real.** `scripts/myarea/build_alerts.ts:494` emits it; `MyAreaAlertKind` (`useMyAreaAlerts.tsx:17`) omits it; `MyAreaAlertsTile.tsx:152-153` is `ICONS[e.kind] ?? Activity` / `COLOR[e.kind] ?? "#888"`. Exactly as described. |
| `staleTime: Infinity` on alerts (§7.2) | `useMyAreaAlerts.tsx:86`. The route is `/api/db/myarea-alerts` and it **already returns `refreshedAt`**, so §7.2's "preferred" option is a small change. |
| `/og/dashboard-2026-04-19.png` has another consumer (§3.3) | Yes — `public/articles/index.json`. The caution is justified. |
| four macro selectors exist | `series.gdpGrowth` (2026-Q2), `latestMonthly.inflation` (2026-07), `latestMonthly.unemployment` (2026-06), `series.govDebt` (2026-Q1). |
| hub primitives exist | `HubHead` (with `kpis`, `search`, `evidence`, `scope`, `kpiNote`), `TileHubGrid`/`TileHubSection`, `HubSearch` at `@/ux/search/HubSearch`, `hubSearchSources`, `NewsCard` at `src/ux/feed/`. |
| eight tile destinations exist | all eight are static routes **except `/elections`** — which is what Phase 1 creates. |
| `bucket:sync:paths -- home` will work | `isExcluded` is a refuse-list, not an allowlist; `data/home` is not excluded, and the full `bucket:sync` `-x` regex does not match it. |
| generator registration is mechanically enforced | `refresh_coverage.test.ts:644` scans **all** `db:gen-*` keys in `package.json`, not just `gen_procurement/`. `db:gen-home-*` cannot land outside `REFRESH_GENERATORS` + `db:refresh`. |
| a `hub_stats` blob is a sanctioned exception to "no JSON from PG" | The memory rule explicitly sanctions `db:gen-hub-stats` as "a NEW small per-scope aggregate the ingest never produced". `home/hub_stats.json` is the same shape. |
| analytics mechanism exists | `src/lib/analytics.ts` → `trackEvent` → GA4 `gtag`. |

**Phase 1 is smaller than the plan implies.** `ElectionScreen.tsx` is literally `export const ElectionScreen = () => <DashboardScreen />`. §9.2 step 2 ("move/alias the current country election screen") is one route declaration. The real Phase 1 work is links, prerender, sitemap, OG and header active-state — which the plan does list.

---

## B. Blockers — wrong or self-contradictory

### B1. `LOCALE_BUNDLES` is in the wrong file

§10: *"Add `home` to `LOCALE_BUNDLES` in `scripts/i18n/bundles.ts`."*

`LOCALE_BUNDLES` lives in **`src/locales/bundles.ts`** (deliberately import-free — its own header explains why, and `src/entryGraph.test.ts` is the gate). `scripts/i18n/bundles.ts` is the reachability *analysis* module (`readRouteEntries`, `analyzeBundles`) and exports no such constant.

Adding a bundle is four steps, and the plan names two: (1) `src/locales/bundles.ts`; (2) `withBundle("home", …)` in `src/routes.tsx:50`; (3) **`BUNDLE_IMPORTS` in `src/i18n.ts:65`** — Vite needs literal specifiers, so a missing entry is a type error; (4) `split_bundles.ts --apply`, then re-ratchet. Step 3 is missing from the plan entirely.

### B2. "CPI inflation" collides with an existing series that means something else

§2.5 and §5.1 name the figure **`inflation_cpi`** / "CPI inflation".

In this repo **`cpi` means Transparency International's Corruption Perceptions Index**:

```
indicators.cpi.titleBg = "Корупционен индекс (Transparency Int'l)"
series.cpi             = [{year:2024,value:43},{year:2025,value:40}]
```

The figure the plan actually selects is `latestMonthly.inflation`, whose `datasetCode` is `prc_hicp_minr` — **HICP**, the harmonised EU index, not the national CPI and not TI's CPI. So the plan's own head figure would ship a `HomeFigureId` that reads as a corruption score, sourced from an index that is not CPI at all. This is precisely the "arithmetically right, false as a sentence" class §14.1 exists to reject.

Rename to `inflation_hicp` and label it HICP in both locales.

### B3. The feed's rolling window contradicts the determinism gate — and stores a status the repo forbids storing

Two clauses cannot both hold:

- §6.6: *"default window: 30 days, with event-kind-specific deadline windows"*
- §12.3 / §14.1: *"deterministic and byte-stable under unchanged inputs"*, *"byte-identical double generation"*, *"`computedAt` derives from sources"*

A 30-day window whose end is *now* changes every day with no source change: rows age out, `daysLeft`-style fields move, ranking's "date recency" term moves. `db:check-generated` compares committed bytes against the live bucket object and would report drift permanently.

Worse, §6.2 lists funds events **"call opened, deadline approaching/closed"** and §7.3 adds `call_deadline`, `promotion_ending`. `CLAUDE.md`'s `open_calls` section (migration 142) is explicit that this is a solved and re-solvable defect:

> *"Nothing stores a status. `open_calls_table` derives it by comparing `closes_at` to `now()` … Stored-at-crawl-time would show expired calls as open all weekend after a Friday failure; query-time derivation makes the worst case UNDER-reporting."*

A committed static `feed.json` carrying "deadline approaching" is the stored-status shape, one layer up. The plan never cites that rule.

**Fix:** anchor the window on `max(source date)` rather than `now`, and store only absolute dates (`deadlineAt`) with the *renderer* deriving proximity at read time — the same split the `open_calls` design uses. If a kind cannot be expressed without a now-relative field, it does not belong in a static artifact.

### B4. The root HTML byte budget will trip, and the plan does not name it

`tests/perf.spec.ts:35`:

```js
const HOME_HTML_MAX_BYTES = 18_000;   // "~17.2k today leaves a little headroom"
```

§11.1 asks for a body "covering the pulse, eight destinations, change feed meaning, and source methodology" **plus** `WebSite` + `Organization` + an `ItemList` of eight destinations + per-corpus `Dataset` nodes. That is a near-certain overrun on ~800 bytes of headroom. §14.5 says "re-ratchet with recorded deltas" but never names this constant, and it is a hard gate.

Related and also unnamed: `HOME_MODULEPRELOAD_MAX = 7` with 6 in use — one slot.

---

## C. High — missing work that fails existing gates or ships a known defect

### H1. Three gate registries are missing from the plan

§14.2 names only `HUB_SCREENS`. A new hub must also join, or the suite goes red:

| Registry | File | Consequence if missed |
| --- | --- | --- |
| `HUB_SCREENS` | `src/ux/infographic/hubHead.gates.test.ts:123` | named ✓ |
| `HUB_HEAD_SCREENS` | `tests/ui.spec.ts:890` | **not named** |
| `HUB_HEAD_BUDGETS` | `tests/ui.spec.ts:547` | **not named** |

`ui.spec.ts:1019` asserts `HUB_HEAD_SCREENS` and `HUB_HEAD_BUDGETS` have **identical key sets** — neither can gain a member without the other. Each budget entry needs `maxPx`, `measured` (at the 1280 desktop project, not 1024), and `cells`. The `cells` field is load-bearing: its own comment records that a head which *lost its band entirely* sits comfortably inside its ceiling.

Fourth: if home renders `HubSearch`, `src/screens/hub_finder_single_render.test.ts` applies (one finder per screen, `idPrefix` uniqueness).

Reference points for the budget: `/governance` 430/500, `/parliament` 443/520, `/funds` 531/600. A head with four KPIs **and** a full `HubSearch` **and** eight tiles below sits in the `/funds`–`/consumption` band (~600), not the compact one.

### H2. The feed has no full destination, and it collides with `/data/updates`

§6 promises "a route to the relevant full destination", and §6.5 gives each *row* a destination — but the **feed itself has no "see all"**. Six rows on root and nowhere to go.

The obvious destination already exists and the plan never mentions it. Per `reference_two_changelogs`, the site already has:

1. `recent_updates()` (PG) — dev-only consumer;
2. **`data/data-changes.json` → `/data/updates`** — the *user-facing* change feed, 322 entries, per-skill, free-text `summary`;
3. `myarea_alerts` — the per-município activity tile.

`data/home/feed.json` would be a **fourth**. §1 says the home feed "is not a raw ingest log" — which is exactly what `/data/updates` is — so the two will present different answers to "what changed" with no cross-link and no stated relationship.

**Fix:** decide explicitly. Either the home feed's "see all" is `/data/updates` with the ingest-log-vs-event distinction stated on both pages, or a new destination is in scope and must ship with prerender/sitemap/OG like every other canonical page in §2.17.

### H3. `usePreserveParams` leaks scope onto tile links — and the elections tile can contradict its own destination

`src/ux/usePreserveParams.tsx:4,20` — `elections` and `pscope` are **global preserved params**. Every in-app link carries them; anything absent is stripped.

Two consequences the plan does not address:

- **Scope leak.** A reader arriving at `/` carrying `?pscope=y:2019` gets it pushed onto `/consumption`, `/my-area`, `/governance/sectors` — tiles whose destinations have no such window. The hook's own header records this shipping once on `/governance`: *"the following cell's `/funds/beneficiaries`, which deliberately forces nothing, came out carrying it, so a scope-free destination silently answered for one window."* §4.2 asserts "preserved forced scopes" for procurement but says nothing about the seven tiles that force none.
- **Elections tile vs. destination.** §5.3 defines the elections tile metric as "date/status of the selected current event" — computed by the generator at build time, i.e. the *latest* cycle. But `?elections=2013_05_12` is preserved and, per the elections plan's fixed decision 15, `/elections` **reads it and captions that cycle**. So the tile advertises 2026 and the destination renders 2013. The tile must either read the param client-side or state that it always describes the latest event.

`CLAUDE.md`'s rule applies to `/` itself too: *"A page narrower than the corpus MUST resolve the inbound scope."* State whether `/` ignores `pscope`, and make it explicit rather than incidental.

### H4. `/elections` will duplicate `/elections/<latest date>`

`/elections/:date` is already prerendered with its own body, title, `Dataset` JSON-LD and breadcrumbs (`scripts/prerender/dynamicRoutes.ts:2583`) and already in the sitemap (`route_defs.ts:791`, `{path:"elections/:id", file:"elections-list"}`).

Adding a static `/elections` that renders the same latest cycle produces two prerendered, sitemapped URLs with the same screen and the same numbers. §14.3 requires uniqueness between **root and `/elections`** and says nothing about `/elections` vs `/elections/<latest>`. Today the same problem exists between `/` and `/elections/2026_04_19`; the migration does not fix it and makes it more visible.

Decide the canonical relationship (most likely: `/elections` canonical, the dated page canonical to itself with a distinct "historical result" framing) and gate it.

### H5. Root gets two new bucket fetches and no preload hints

The root prerender entry (`scripts/prerender/routes.ts:1471`) carries **no `preloadData`**. The plan adds `home/hub_stats.json` and `home/feed.json` and never mentions preload — despite `routes.ts:29-42` documenting the exact cost:

> *"#root is empty, so a data fetch is discovered only after the browser has run the entry bundle, the i18n chunk AND the route chunk — five serial round trips before the first data byte is requested."*

Add both to `preloadData` with `fetchpriority="low"` semantics (the mechanism already does this), and honour the two guardrails in `CLAUDE.md`: the emitted href's origin must match the built entry chunk's `VITE_DATA_BASE_URL` (gated by `scripts/prerender/index.ts` and `tests/perf.spec.ts`), and the hint set is a small net loss at 1.6 Mbps — so measure before adding a second path.

### H6. A `home` locale bundle puts a serial chunk fetch on the index route

§10 tags the **index route** with `withBundle("home", …)`. Bundles are `import()`ed at route mount and are **not** preload-hinted (only the core locale chunk is, via an inline script — `vite.config.ts:170`). So `/` — the highest-traffic route and the one the LCP budgets are written against — gains: entry → route chunk → **home bundle** → first head text.

That is the inverse of what the mechanism is for. It buys every *other* route the home copy's bytes; it costs the index route a round trip before it can render its own H1. §14.5's gate "exactly one locale bundle loads for root" also reads oddly beside the existing `tests/perf.spec.ts` test *"a page load fetches exactly one translation bundle"*, which loads `/` and counts `/assets/translation-*` (bundle chunks are named `budget-*` / `methodology-*`, so they do not collide — but the intent should be stated).

**Fix:** measure both ways before committing. Keeping home copy in core is defensible precisely because home is the one route where deferral cannot pay off.

---

## D. Medium — gaps worth closing before Phase 0

**M1. An umbrella `db:gen-home` would trip the generator gate.** §6.6 offers it as a fallback. `refresh_coverage.test.ts:644` requires every `db:gen-*` key to be either in `REFRESH_GENERATORS` (one `artifact`, one `bucketPath`) or `--write`-gated. A wrapper has no unique artifact and would have to be `--write`-gated — which `refresh_coverage.test.ts:652` then rejects for registered generators. Use two entry points and pin their order in `db:refresh`.

**M2. §5.2 does not say where per-figure metadata comes from, and the obvious lookup mislabels half the band.** Observations in `series.*` carry only `{period, value}`; the metadata lives in `macro.indicators[key]`. But the keys do not line up:

| Figure | Plan's selector | Correct metadata key | Naive `indicators[id]` gives |
| --- | --- | --- | --- |
| unemployment | `latestMonthly.unemployment` (`une_rt_m`, monthly SA) | `indicators.unemploymentMonthly` | `indicators.unemployment` → `une_rt_q`, **quarterly** |
| inflation | `latestMonthly.inflation` (`prc_hicp_minr`, monthly) | **the observation itself** — no monthly indicators entry exists | `indicators.inflation` → *"% YoY (HICP, quarterly avg)"* |
| GDP growth | `series.gdpGrowth` | `indicators.gdpGrowth` → *"% YoY (real, SCA)"* | ✓ |
| gov debt | `series.govDebt` | `indicators.govDebt` → `gov_10q_ggdebt`, % of GDP | ✓ |

Name the metadata source per figure in the plan, and make the data test assert the `datasetCode` on each emitted figure equals the one on the observation it was selected from.

**M3. `RouteDef.file` is a single optional string.** §11.1's parenthetical *"the route generator may take the max with `feed.json` if the sitemap contract supports multiple files"* — it does not (`scripts/sitemap/route_defs.ts:1`). Pick one; `hub_stats.json` is the right one.

**M4. Root's body today includes the articles strip, and §11.1 deletes it.** `homeBodies` (`scripts/prerender/routes.ts:549`) is `buildHomeBody(...)` joined with `buildArticlesSection(...)`. `tests/perf.spec.ts:30` records that the shell grew for *"a richer 'latest analyses' strip"*. Wholesale replacement drops those crawlable article links from the site's strongest page. Decide whether the strip survives into the new body.

**M5. The root prerender is the SPA fallback for every unprerendered route.** `dist/index.html` is what Firebase's catch-all serves — including the ~101k non-prerendered `/person/*` URLs (`scripts/prerender/dynamicRoutes.ts:3251,3311` document this). Today they inherit an election `Dataset` node; after the change they inherit the home body plus an `ItemList` of eight destinations. Better in kind, but it is a change to ~101k pages' structured data and should be a stated consequence, not a side effect.

**M6. Two hub-of-hubs, and the plan never states the relationship.** `/governance` is already one: 23 tiles, 21 pointing at other hubs, its own folded `hub_stats.json` whose generator header calls it *"a HUB OF HUBS"*. `/` becomes a second, with `/governance` as one of its eight tiles. That may be right (broad → narrow), but §4 should say so, and should say whether `/governance`'s four money figures and `/`'s four pulse figures are allowed to be different kinds of thing on purpose.

**M7. `TileHubGrid` is 4-across only at `xl`.** `lg:grid-cols-3 xl:grid-cols-4` (`TileHubGrid.tsx:41`). §4.2's "four tiles per band at the desktop four-column breakpoint" holds at 1280/1440 (which §14.4 tests) but orphans one tile per band at 1024–1279. Either accept it explicitly or the gate should say `xl`.

**M8. Coordination with `elections-hub-implementation-v1.md` is one-directional.** That plan carries an integration banner deferring `/` to this one. This plan does not reciprocate: §11.2 assigns `/elections` a body, canonical, `Dataset` JSON-LD, sitemap entry and `public/og/elections.png` — all of which the elections plan then rewrites (its §6.0 makes `/elections` a `HubHead` hub with its own registry, scenes and scope bar; its fixed decision 14 re-ships prerender/sitemap/OG). State whether Phase 1's `/elections` artifacts are deliberately throwaway, and which plan owns the final `/elections` OG image and locale bundle.

**M9. There is no capture-screens precedent for the election card.** `/og/dashboard-2026-04-19.png` is a legacy hand-made asset — `scripts/og/capture-screens.ts` has no entry producing it. Both `home` and `elections` entries are new work (`slug` + `routePath` + a `data-og` anchor + a data-populated `waitFor`), and `capture_routes.test.ts` / `ogAndSitemapCoverage.test.ts` must gain both. §11.3 says this; §16's command block assumes the CLI already accepts the names, which §16 itself flags — keep that caveat.

---

## E. Suggested plan edits, in order

1. **§10** — fix the file path (`src/locales/bundles.ts`), add the `src/i18n.ts` `BUNDLE_IMPORTS` step, and add a decision point on whether home copy is bundled at all (H6).
2. **§2.5 / §5.1 / §5.2** — rename `inflation_cpi` → `inflation_hicp`; add the per-figure metadata-source column from M2.
3. **§6.6 / §12.3** — resolve the window/determinism contradiction: anchor on `max(source date)`, store absolute dates only, derive proximity in the renderer. Cite the `open_calls` query-time rule as the precedent.
4. **§6** — name the feed's "see all" destination and its relationship to `/data/updates`.
5. **§14.5** — add `HOME_HTML_MAX_BYTES` and `HOME_MODULEPRELOAD_MAX` by name to the re-ratchet list.
6. **§14.2** — add `HUB_HEAD_SCREENS`, `HUB_HEAD_BUDGETS` (with `cells`) and `hub_finder_single_render.test.ts`.
7. **§4.2 / §9.3** — state `/`'s handling of inbound `pscope` and `elections`, and add a tile gate that no non-forcing tile emits a scope param.
8. **§11.1 / §11.2** — add `preloadData`; decide the articles strip; decide `/elections` vs `/elections/<latest>` canonicalization.
9. **Header** — add the reciprocal integration note to `elections-hub-implementation-v1.md` (M8).

Nothing above changes the phase structure. B1, B2 and M2 are Phase 0/2 edits; B3 and H2 are Phase 4 preconditions and should be settled before any adapter is written; B4, H1 and H5 are Phase 2.
