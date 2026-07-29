# Critical-path bundle diet — implementation plan v1

Status: **DRAFT (2026-07-28), audited 2026-07-28 (§0c).** Owner: TBD.
Trigger: a load-performance analysis of `/procurement/settlement/10135` (Варна) found that
the page ships **~1.0 MB brotli of JavaScript, of which 5.9 KB is the page**. Everything else
is the shared shell, and five separate causes put route-only libraries on the critical path of
every route in the app.

Prior art this touches: `vite.config.ts` (`manualChunks` + `modulePreload.resolveDependencies`),
`src/routes.tsx` (the lazy-route registry), `src/i18n.ts`, `tests/perf.spec.ts` (an existing
gate that currently asserts the wrong invariant — see A1).

## 0. Baseline — measured against **production** (electionsbg.com, 2026-07-28)

All figures are **brotli**, which is what Firebase Hosting actually serves
(`content-encoding: br` confirmed on both HTML and assets). Local `vite preview` reports
**gzip**, which overstates transfer by ~22% — do not mix the two when checking a budget.

| Wave | What | br |
|---|---|---|
| 1 — entry + `modulepreload` | `index` 339.5K · `vendor` 246.2K · `vendor-react` 66.4K · `vendor-radix` 37.2K · `vendor-query` 24.2K · `vendor-i18n` 15.8K · `vendor-search` 5.6K · CSS 17.8K | **752.7 KB** |
| 2 — **static** imports of `index`, preload-filtered | `vendor-charts` 123.8K · `vendor-pdf` 122.3K · `vendor-leaflet` 40.8K | **286.9 KB** |
| 3 — the route | screen + Card/Title/H1/FollowStar/useWatchlist/hook | **~5 KB** |

**Critical path ≈ 1,015 KB br / 4.38 MB decoded**, in three sequential waterfall hops before
the screen chunk is requested. The route's own code is ~0.5% of it.

Reproduce the wave structure locally (gzip units):

```bash
npm run build && npm run preview
```

then load the route and read `performance.getEntriesByType('resource')` (`encodedBodySize`).

Not the problem, measured and ruled out:

- `/api/db/procurement-settlement?ekatte=10135` → 43.8 KB in **132 ms warm** (1.29 s cold function).
- Warm SPA re-entry into the route: **zero** network requests, **zero** long tasks. The
  112-row awarder table renders cheaply.
- The prerendered HTML carries SEO text in `<div id="ssg-content" hidden>` and an empty
  `<div id="root">`, so nothing visible paints until waves 1+2 download, parse and execute.

## 0b. Root causes (each verified against the deployed bundle)

**C1 — jsPDF is on every page's critical path by accident (122.3 KB br / 456 KB raw).**
The deployed entry contains `from"./vendor-pdf-DkuU3k1o.js"`, importing `_` — Vite's
`__vitePreload` helper. The helper is a *virtual* module (`\0vite/preload-helper.js`, Vite
6.4.3), so [vite.config.ts:206](../../vite.config.ts) — `if (!id.includes("node_modules"))
return undefined;` — bounces it out of every named chunk and Rollup parks it in `vendor-pdf`.
Every dynamic import in the app therefore blocks on jsPDF + canvg.

**C2 — CodeMirror ships in the always-loaded `vendor` chunk (~64% of it).**
[routes.tsx:79](../../src/routes.tsx) says *"Lazy-loaded so its CodeMirror deps stay in a
separate chunk"* — but the catch-all `return "vendor"` at the end of `manualChunks` overrides
the lazy boundary, and `vendor` is `modulepreload`ed on every page. It is the only chunk
containing `cm-editor`. Measured by gzipping the chunk with and without the CodeMirror lines:
293.1K → 106.8K gz (63.6%); pro-rated to the deployed chunk, ~156 KB br of 246 KB.

**C3 — the home dashboard is eager, and it drags the map stack into the entry (165 KB br).**
[routes.tsx:17](../../src/routes.tsx) is `import { DashboardScreen } from "@/screens/DashboardScreen";`
— the only screen not behind `lazy()`. Static chain:

```
src/main.tsx -> App.tsx -> routes.tsx -> screens/DashboardScreen.tsx
  -> dashboard/DashboardCards.tsx -> dashboard/RegionsMapTile.tsx
  -> components/regions/RegionsMap.tsx -> components/maps/LeafletMap.tsx     (react-leaflet)
                                       -> components/maps/useMapElements.tsx
                                          -> components/maps/MapText.tsx     (d3)
                                       -> components/maps/d3_utils.ts        (d3)
```

`vendor-charts` is pulled in by **d3-geo, not recharts** — recharts is not statically
reachable from `main.tsx`; the entry's map code calls `geoMercator()/geoPath()/geoBounds()`.

**C4 — `import * as d3 from "d3"` pulls the whole d3 meta-package.** Five files import the
`d3` umbrella (see A3), which re-exports every `d3-*` module. `manualChunks` funnels all of it
into `vendor-charts` (553 KB raw), so even routes that legitimately need one projection pay
for force simulation, chord layouts, hierarchy, etc.

**C5 — both locales are compiled into the entry chunk.** [src/i18n.ts:4-5](../../src/i18n.ts)
statically imports both translation JSONs. They are **66% of the entry chunk's characters**
(946k of 1.43M). Standalone gz: bg 163.7 KB, en 133.1 KB. The English half is dead weight for
a Bulgarian visitor and vice versa.

**C6 — the existing preload filter treats the symptom, in both directions.**
[vite.config.ts:189-201](../../vite.config.ts) strips `vendor-(pdf|leaflet|markdown|charts|flow)`
from preload lists, on the stated assumption that they are "loaded on demand". For
pdf/leaflet/charts that assumption is **false** — they are static imports of the entry, so
filtering the hint does not stop the download, it only delays it by a round-trip. And because
the hook ignores its `hostType` argument, the filter also strips those chunks from the
**dynamic-import dependency lists** (`__vite__mapDeps`) — verified: `vendor-charts` and
`vendor-pdf` do not appear in the entry's mapDeps table at all. So the routes that legitimately
need recharts or jsPDF *also* pay a serial round-trip. The filter makes every page slower and
no page faster.

## 0c. Audit (2026-07-28) — corrections that SUPERSEDE the first draft

Nine findings. A1 and A2 change what gets built; A5 changes every number in the document.

### A1 — BLOCKER: a perf gate already exists and asserts the wrong invariant

`tests/perf.spec.ts` already bans `vendor-pdf`, `vendor-charts`, `vendor-leaflet`,
`vendor-markdown`, `exportToPDF-` — **from the `modulepreload` list** — and it is **green
today**, while all three of those chunks are downloaded on every page as static imports. Its
comment records the change that created C6:

> *"We trimmed the eagerly-modulepreloaded chunk count from 9 → 6 by stripping vendor-pdf,
> vendor-charts, vendor-leaflet, vendor-markdown."*

That change saved **zero bytes** and added a round-trip. The gate measures the *hint* rather
than the *load*, which is why the regression has been invisible.

The first draft proposed a new Vitest budget test without reconciling with this file — that
would have left two gates, one of them lying. **T5 is rewritten**: repair `perf.spec.ts` first
(assert on requests actually issued, not on preload links), then add the budget assertions.

### A2 — the preload filter must be narrowed to `hostType === 'html'`, not just left alone

`ResolveModulePreloadDependenciesFn` receives `{ hostId, hostType: 'html' | 'js' }`
(`vite/dist/node/index.d.ts:2747`). The current implementation ignores it. **New step T2.2**
restricts the filter to the HTML head, so chart/pdf/leaflet routes get their deps preloaded in
parallel again. Once T1–T3 land, the filter can arguably be deleted entirely.

### A3 — T3 undercounted the d3 umbrella importers: five, not three

```
src/screens/components/maps/d3_utils.ts             import * as d3 from "d3"
src/screens/components/maps/MapText.tsx             import { GeoProjection } from "d3"   ← a TYPE, imported as a value
src/screens/components/demographics/EuChoroplethMap.tsx  import * as d3 from "d3"
src/screens/budget/BudgetFlowGraphic.tsx            import { easeCubicInOut } from "d3"   ← missed in v1
src/screens/funds/FundsMuniMapTile.tsx              import * as d3 from "d3"              ← missed in v1
```

`MapText.tsx` is the cheapest and most valuable: `GeoProjection` is a type, so
`import type { GeoProjection } from "d3-geo"` emits nothing at all.

### A4 — T2's sufficiency is now verified, and it will trip the existing preload budget

A static-import trace from `src/main.tsx` (following only static imports, stopping at
`lazy(() => import())`, type-only imports excluded) reports **207 eager modules**, with
`DashboardScreen` the **only** path to react-leaflet or d3. Re-running with `DashboardScreen`
treated as lazy: **121 eager modules and no static path to any of** recharts, react-leaflet,
leaflet, jspdf, d3, `@codemirror/*`. T2 alone is sufficient; no second eager path is hiding.

~~Consequence to handle in the same commit: `HOME_MODULEPRELOAD_MAX = 7` needs a bump, because
making the dashboard lazy adds its chunk to home's hint list.~~ **Falsified when T2.1 landed:**
Vite only emits `modulepreload` hints for the entry's **static** import graph, so a dynamically
imported chunk is never a candidate and the count stayed at exactly 6. No bump was needed.

The corollary is the part worth keeping: because every perf assertion is "chunk X is absent
from list Y", and a newly-lazy chunk is absent by construction, **no existing gate could
observe whether T2.1 cost home a serial round-trip**. It does not — the `hostType === "html"`
narrowing (A2) leaves dynamic-import dep lists intact, so the dashboard's own `mapDeps` entry
preloads `vendor-leaflet` + `vendor-charts` in parallel — and that is now asserted positively
in `perf.spec.ts` rather than assumed.

### A5 — units: production serves **brotli**; the v1 numbers were gzip

`content-encoding: br` on the live site. The deployed entry is **339.5 KB br**, not the
460.6 KB gz measured from `vite preview`. Every figure in this document has been restated in
brotli against the live deployment (§0). Ratios and ordering are unchanged; absolute savings
are ~22% smaller than v1 claimed. **Budgets in T5 are brotli** and must be measured against a
brotli-serving origin (or converted), not against `vite preview`.

### A6 — `/sql` is NOT dev-gated; deleting the route is not an option

`SqlBrowserScreen` is a plain lazy route at [routes.tsx:3762](../../src/routes.tsx), backed in
production by the hardened `sql` Cloud Function. It ships to prod deliberately. The
`vendor-editor` split in T1.2 is therefore the whole fix — recorded here so a future reader
does not "optimize" by removing the route.

### A7 — T4's blast radius is smaller than v1 implied (evidence, not hope)

- Single init site: `src/App.tsx:1` — `import "./i18n.ts"; // imports + initializes i18n`.
  Nothing else imports the module.
- Component tests do **not** exercise it: they `vi.mock("react-i18next", …)` (8+ files).
- **No module-scope `t()` / `i18n.t()` calls** found in `src/` — the "module reads `t` at
  import time" failure mode has no instances today. The T5 gate should keep it that way.
- Specifier hygiene: `i18n.ts` currently resolves translations via a bare `src/locales/...`
  path. The dynamic imports should use the project alias — `@/locales/{bg,en}/translation.json`.

### A8 — T5 budgets need a per-tier ratchet, not final numbers

Final-state budgets fail on every intermediate commit. Each tier sets the budget to *its own*
measured output +5% headroom; the last tier lands the final numbers.

### A9 — no acceptance protocol in v1

Added below (§Acceptance). "Faster" is not checkable; a fixed URL, a fixed method, a fixed
compression, and a before/after pair are.

## Decisions

1. **Fix the causes, not the preload list.** No chunk that is a static import of the entry may
   be hidden by filtering its preload hint.
2. **Chunking changes go first** (T1) — config-only, zero app-code risk, ~278 KB br recovered.
3. **Ship one language.** Loading the inactive locale on demand beats any remaining code split.
4. **No SSR/hydration work.** Making the prerendered body visible is a separate project with
   CLS and duplicate-render hazards. Non-goal.
5. **The gate is repaired, not duplicated** (A1), and ships with the fix — every cause here is
   a silent regression class.

## T1 — Chunking fixes (`vite.config.ts` only)

### T1.1 — Give the Vite preload helper a home (fixes C1)

In `manualChunks`, **before** the `if (!id.includes("node_modules")) return undefined;` guard:

```js
// Vite's __vitePreload helper is a VIRTUAL module ("\0vite/preload-helper.js"),
// so it never matches the node_modules guard below and Rollup parks it in
// whichever chunk it happens to land in — historically vendor-pdf, which put
// jsPDF + canvg (122 KB br) on the critical path of every page, since every
// dynamic import in the app imports the helper. Pin it to the foundational
// chunk that every other chunk already depends on.
if (id.includes("vite/preload-helper")) return "vendor-react";
```

`vendor-react` is the correct target: the config's own comment calls it foundational precisely
so other chunks can import from it without creating a cycle.

**Verify:** the entry's import header (`grep -o 'from"\./vendor-[a-z-]*-[A-Za-z0-9_-]*\.js"'`)
no longer lists `vendor-pdf`; `vendor-pdf` disappears from the network log on
`/procurement/settlement/10135`; `/procurement/contracts` → export-to-PDF still works.

### T1.2 — Split the CodeMirror family out of the catch-all (fixes C2)

Add a rule alongside the existing leaflet/charts rules. Include the support deps for a **size**
reason — they are CodeMirror-only in this tree, so leaving them out strands them in the
always-preloaded catch-all and gives back part of the saving. They are leaf packages and could
not have caused a cycle.

The cycle hazard is real but points the other way. `vendor-editor` **does** statically import
`vendor` (`@uiw/react-codemirror` compiles against two `@babel/runtime` helpers), so the
invariant to preserve is one-directional: **`vendor` must never import `vendor-editor`** —
nothing that falls through to the catch-all may re-export the CodeMirror family. The
`codemirror` **meta package** must therefore be matched explicitly: it is installed (a
dependency of `@uiw/react-codemirror`) and re-exports `@codemirror/*`, so the documented
`import { basicSetup } from "codemirror"` would land it in the catch-all and close the loop —
the same patch `vendor-charts` already carries for the `d3` meta package.

```js
// The SQL browser's editor (/sql — a prod route, see A6). routes.tsx lazy-loads
// the screen, but without this rule the catch-all `vendor` return below
// re-attaches ~156 KB br of CodeMirror to the always-preloaded chunk and
// defeats the lazy boundary entirely.
if (
  id.includes("/@codemirror/") ||
  id.match(/[\\/]node_modules[\\/]codemirror[\\/]/) || // meta pkg — see above
  id.includes("/@lezer/") ||
  id.includes("/@uiw/") ||
  id.match(/[\\/]node_modules[\\/]style-mod[\\/]/) ||
  id.match(/[\\/]node_modules[\\/]w3c-keyname[\\/]/) ||
  id.match(/[\\/]node_modules[\\/]crelt[\\/]/)
) {
  return "vendor-editor";
}
```

Installed members covered: `@codemirror/{autocomplete,commands,lang-sql,language,lint,search,state,theme-one-dark,view}`,
`codemirror` (the meta package), `@lezer/{common,highlight,lr}`, `@uiw/react-codemirror`,
`@uiw/codemirror-extensions-basic-setup`, `style-mod`, `w3c-keyname`, `crelt`.

**Verify:** `grep -l cm-editor dist/assets/*.js` names only `vendor-editor-*.js`; `/sql` loads
and runs a query; no `Cannot access 'X' before initialization` on any route.

**Expected after T1:** critical path 1,015 → **~737 KB br**.

## T2 — Take the home dashboard off the entry (fixes C3, unblocks C6)

### T2.1 — `lazy()` the dashboard

Convert [routes.tsx:17](../../src/routes.tsx) to the `lazy()` + `<Suspense
fallback={<RouteFallback />}>` shape the other 257 screens use. Per A4 this is sufficient: no
other eager path to the map stack exists.

**Trade-off to measure, not assume:** `/` gains one chunk hop. Measure home before/after per
§Acceptance. If the hop costs more on home than it saves, the mitigation is to let the
dashboard chunk through `resolveDependencies` — preloaded in parallel rather than inlined into
the entry — which keeps home flat while every other route stops paying for the map stack.

Give the index route a non-empty Suspense fallback in the same commit. The shared
`RouteFallback` is an empty `min-h-[40vh]` div, but the dashboard used to paint its skeleton
grid straight from the entry chunk — leaving it empty trades bytes for a blank landing page and
a layout shift on the highest-traffic route. The skeleton must live in its own module that does
**not** import `DashboardCards`, or the map stack returns to the entry and the T5.2 gate fires.

`HOME_MODULEPRELOAD_MAX` needs no bump — see the correction in A4.

### T2.2 — Narrow the preload filter to the HTML head (fixes the second half of C6)

```js
resolveDependencies: (_filename, deps, { hostType }) =>
  // Only trim the <head> preload list. Applying this to hostType 'js' also
  // stripped these chunks from __vite__mapDeps, so the routes that genuinely
  // need recharts/jsPDF discovered them one serial round-trip late.
  hostType === "html"
    ? deps.filter((d) => !/vendor-(markdown|flow)/.test(d))
    : deps,
```

After T1.1 and T2.1 nothing in the filtered set is a static import of the entry any more, so
`pdf|charts|leaflet` can come out of the pattern; `markdown|flow` stay until traced.

**Verify:** entry import header lists no `vendor-leaflet` / `vendor-charts`; `/` renders the
regions map; `/procurement/settlement/10135` loads neither; a chart route (`/budget`) requests
`vendor-charts` **in parallel** with its screen chunk, not after it.

**Expected after T2:** critical path **~572 KB br**, wave 2 empty.

## T3 — Stop importing the d3 umbrella (fixes C4)

Replace the umbrella import in the five files listed in A3 with per-module imports
(`d3-geo`, `d3-scale`, `d3-ease`, …); `MapText.tsx` becomes `import type`. Add the concrete
`d3-*` packages to `dependencies` and drop the `d3` meta-package if nothing else needs it
(`d3-sankey` is already a direct dep and stays).

This does not change the critical path after T2 — it shrinks `vendor-charts` for the map and
chart routes that legitimately load it.

**Verify:** `vendor-charts` raw size drops; `/`, `/regions`, `/indicators/compare`, `/budget`
(flow graphic), `/funds` (muni map), and one choropleth route render identically.

## T4 — Ship one language (fixes C5)

### T4.1 — Per-language chunks, awaited at bootstrap

Rework `src/i18n.ts` to export an async initializer and dynamically import only the active
language:

```ts
export const initI18n = async () => {
  const lang = detectLang();                    // existing URL / localStorage logic
  const bundle = await (lang === "en"
    ? import("@/locales/en/translation.json")
    : import("@/locales/bg/translation.json"));
  await i18n.use(initReactI18next).init({
    resources: { [lang]: { translation: bundle.default } },
    lng: lang,
    fallbackLng: lang,                          // NOT "bg" — the other bundle is not loaded
    // …existing options, incl. react.useSuspense: false
  });
};
```

`src/main.tsx` awaits `initI18n()` before `ReactDOM.createRoot(...).render(...)`, and
`src/App.tsx:1`'s side-effect import is removed. This preserves the invariant the current
`useSuspense: false` comment depends on: resources are present and synchronous by first render,
so no component sees `ready: false`.

`fallbackLng` **must** become the loaded language. With one bundle in memory, `fallbackLng: "bg"`
on an English session silently returns raw keys.

### T4.2 — Language switch loads the other bundle first

`src/layout/header/Header.tsx:329` becomes async: import the target bundle,
`i18n.addResourceBundle(lang, "translation", bundle.default)`, then `i18n.changeLanguage(lang)`.

**Verify:** a BG session downloads no `en/translation` chunk; switching to EN downloads it once
and translates fully; a hard load of an `/en/*` URL starts in English with no flash of keys;
`npm run test:unit` green (per A7 the component tests mock `react-i18next`, so the blast radius
is the two files above).

**Expected after T4:** entry ~339 → **~235 KB br** (estimate — the marginal saving inside a
chunk is smaller than the standalone file's compressed size); critical path **~467 KB br**.

## T5 — Repair the perf gate, then budget it (A1, A8)

### T5.1 — Make `tests/perf.spec.ts` assert the load, not the hint

Replace the "not in the modulepreload list" test with one that counts **requests actually
issued** before the route settles:

```ts
const requested: string[] = [];
page.on("request", (r) => requested.push(r.url()));
await page.goto("/procurement/settlement/10135", { waitUntil: "networkidle" });
for (const banned of ["vendor-pdf", "vendor-charts", "vendor-leaflet", "vendor-editor"]) {
  expect(requested.find((u) => u.includes(banned)), `unexpected download: ${banned}`)
    .toBeUndefined();
}
```

Keep the home HTML-size and LCP/CLS tests as they are. Use a route with **no** map and **no**
chart — the settlement page is the ideal probe, since the whole point is that it needs none of
them.

### T5.2 — Entry-purity assertion

Assert the built entry's static import header references none of
`vendor-(pdf|charts|leaflet|markdown|flow|editor)`. This is the check that catches C1 and C3
recurring, and it runs off `dist/` with no browser. Add as a Vitest node test that skips when
`dist/` is absent (same shape as the Postgres gates that skip when PG is down).

### T5.3 — Size budgets, brotli (A5), ratcheted per tier (A8)

Final targets: entry ≤ 250 KB, `vendor` ≤ 100 KB, entry + preloads ≤ 520 KB. Each tier sets
the budget to its own measured output +5%; the last tier lands these. Budgets are a ratchet —
failing means "justify or split", not "raise the number". Measure against a brotli origin, or
compress with brotli locally; `vite preview` gzip figures will not match.

### T5.4 — No module-scope translation calls

Assert no `src/**` module calls `i18n.t` / `t(` at module scope (A7 found zero today). This is
what keeps T4's awaited-init invariant true.

Once the budgets hold, drop `chunkSizeWarningLimit: 800` back toward Vite's default — the
comment justifying it ("maps + jspdf … loaded on demand") finally becomes true.

## T6 — Data layer (small, independent)

- `canonical_parties.json` (84 KB) and `governments.json` (10 KB) are fetched from
  `storage.googleapis.com` — a **second origin** (extra DNS+TLS, 175 ms measured) served
  **uncompressed**, per the known GCS behaviour (`gsutil cp -Z`; see
  `reference_gcs_bucket_compression`). Re-uploading these two gzipped: 84 KB → ~20 KB, no code
  change.
- Optional: `canonical_parties.json` is fetched on **every** route, including procurement pages
  that never render a party. Check whether its consumer can move behind the routes that need it.

## Acceptance (A9)

Per tier, before and after, same machine, cache disabled:

1. **Transfer** — load `https://<target>/procurement/settlement/10135`, sum `encodedBodySize`
   for `/assets/*.js` + `.css`. Record against a **brotli** origin (staging or prod), not
   `vite preview`.
2. **Request count before the route chunk** — number of `/assets/*.js` requests that start
   before the screen chunk. Today: 10. Target after T2: 7.
3. **Home is not worse** — `/` LCP over 5 runs at 4× CPU throttle, before vs after T2.
4. **Gates green** — `npm run test:unit`, `npm test` (needs a built `dist/`), `npm run lint`.

## Expected result

| | now | after T1 | after T2 | after T4 |
|---|---|---|---|---|
| critical-path JS+CSS (br) | 1,015 KB | 737 KB | 572 KB | **~467 KB** |
| waterfall hops before route chunk | 3 | 3 | 2 | 2 |
| decoded JS parsed before first paint | 4.38 MB | 3.47 MB | 2.75 MB | ~2.0 MB |

**Over half the critical path removed with no change to any screen's code** — T1 and T2 are a
config edit and one `lazy()`.

## Risks

1. **Chunk cycles (T1.2).** The `vendor-charts` comment records a real production failure
   (`Cannot access 'X' before initialization`) from a split that left a chunk reaching back into
   the catch-all. Mitigation: the invariant is "`vendor` never imports `vendor-editor`" — the
   `codemirror` meta package is matched so it cannot fall through and close the loop — and it is
   machine-checked by the catch-all cycle gate in `tests/perf.spec.ts` rather than by comment.
   Verification is still a real `/sql` page load, not just a green build.
2. **Home-page regression (T2).** `/` is the highest-traffic route and currently renders from
   the entry. Acceptance criterion 3 exists for this; the `resolveDependencies` mitigation is
   prepared in T2.1.
3. **i18n first-render (T4).** Mitigated by awaiting init before `createRoot().render()`, and
   by T5.4. A7 shows there are no module-scope `t()` calls to break today.
4. **Prerender coupling (T4).** `scripts/prerender/index.ts` clones `dist/index.html` and swaps
   the SEO block, inheriting whatever preload links Vite emits; it does not touch i18n. Re-run
   `npm run build` (which runs `postbuild` → prerender) and spot-check one page per tier.
5. **Concurrent builds.** `prebuild` renames `dist/` → `dist.old-<ts>` and forks a detached
   `rm -rf`; measuring against `dist/` while another build runs reads a half-written tree. Take
   measurements from a build you started.

## Non-goals

- **Visible SSR / hydration.** The prerendered body stays `hidden`. Making it paint is a
  separate project (CLS, duplicate render, per-route body builders) and is not needed to
  recover the ~550 KB above.
- **Removing the `/sql` route** (A6) — it is a production route, not dev-only.
- **Route-level splitting beyond `DashboardScreen`.** The other 257 screens are already lazy
  and this route's own payload is ~5 KB.
- **The API.** 43.8 KB / 132 ms warm is not a bottleneck. The 1.29 s cold-function figure is a
  Cloud Function warm-up question, tracked separately if it matters.
