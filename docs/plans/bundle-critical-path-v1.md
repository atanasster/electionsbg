# Critical-path bundle diet — implementation plan v1

Status: **T1–T5 landed 2026-07-29** (drafted 2026-07-28, audited the same day, §0c); a
negative-result addendum was appended 2026-08-11 — see "Measured negative result" at the foot.
Owner: TBD.
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

~~This does not change the critical path after T2 — it shrinks `vendor-charts` for the map and
chart routes that legitimately load it.~~ **Falsified on landing (2026-07-29):** `vendor-charts`
did **not** shrink — 556.37 kB raw before, 556.36 kB after (gzip 152.84 → 153.57, i.e.
marginally *worse*, within module-ordering noise; compare gzip figures from one tool only, vite
and `gzip -9` disagree by ~1.5 kB on the same file). `d3` v7 is pure ESM (`export *`), so Rollup
was already dropping every unimported module. C4's premise — that the umbrella carried dead
weight into the bundle — was simply wrong.

What the tier **did** deliver is dependency correctness, which is worth having on its own:

- three **phantom dependencies** declared — `d3-force` (imported by `ConnectionsScreen`,
  `MpConnectionsMini`, `ConnectionsCanvas`), and `d3-delaunay` + `d3-geo` (imported by
  `scripts/helpers/gen_city_rayon_data.ts`). None were in `package.json`; they resolved only
  through npm's flat hoisting of the meta package's own deps, and would have broken on a
  package-manager change or lockfile regeneration with a module-not-found on a screen nobody
  touched;
- `@types/d3`'s **ambient UMD global** removed from 13 files that referenced `d3.GeoPath` /
  `d3.GeoProjection` / `d3.GeoPermissibleObjects` while importing nothing at all;
- 27 packages dropped from the lockfile (installed, never shipped);
- and per-module ids, which are the **precondition for T3.5** below.

**Verify:** ~~`vendor-charts` raw size drops~~ `d3` is absent from `node_modules` (so both
`from "d3"` and a bare `d3.X` type reference now fail at build — a stronger gate than any lint
rule); `/`, `/regions`, `/indicators/compare`, `/budget` (flow graphic), `/funds` (muni map),
and one choropleth route render identically.

## T3.5 — Give d3-geo its own chunk (the saving T3 was actually reaching for)

`vendor-charts` is **124 KB br** and is the only non-leaflet chunk containing d3-geo, so every
geo-only route — the home regions map after T2.1, and every choropleth screen — downloads all of
recharts + lodash + victory-vendor to get `geoMercator` / `geoPath` / `geoBounds`. Standalone
`d3-geo` is 36 KB raw / 13 KB gz *un*-tree-shaken. Expected: **~115 KB br off every geo-only
route**, roughly 15× the entire measured T3 delta.

**`d3-array` MUST move with it.** `victory-vendor/es/d3-array.js` is literally
`export * from "d3-array"`, resolving to the same top-level module `d3-geo` depends on. Leave it
behind and the edge points `vendor-geo → vendor-charts`, so the map route downloads recharts
anyway and the split costs a chunk while saving nothing. Move it and the edge is
`vendor-charts → vendor-geo` — one-directional and safe. ~~`d3-array → internmap` falls through
to the catch-all, so `vendor-geo → vendor`.~~ **Measured on landing:** `internmap` is tree-shaken
out of `vendor-geo`'s reachable subgraph (only `d3-array`'s bisect/sort/ticks family is live), so
`vendor-geo` comes out a **true leaf with zero static imports**. That is incidental, not
load-bearing — the gate asserts the invariant that costs bytes ("no edge to `vendor-charts`")
plus "no edge outside the vendor chunks", so a future `internmap` revival does not turn the gate
red for a harmless edge.

The rule must be **narrow** (`d3-geo` + `d3-array` only) and ordered **above** the broad
`id.includes("/d3-")` matcher; sweeping in `d3-scale` / `d3-shape` / `d3-time` drags the recharts
half back and recreates a two-way edge. Note this is **not** the cycle the `vendor-charts`
comment records — that one had the *catch-all* on both ends.

**Measured on landing (2026-07-29):** `vendor-geo` 26,959 B raw / 9,441 B br, a leaf;
`vendor-charts` 556,368 → 529,321 B raw, 123,852 → 115,492 B br, importing `vendor-geo`
one-directionally. A geo-only route now pays **9.4 KB br instead of ~124 KB br**. The home
dashboard's dependency list lost `vendor-charts` entirely — `d3-geo` had been its only path into
the recharts subgraph — which is the win arriving, though it first showed up as a **failing
assertion** from T2.1 that hard-required `vendor-charts` to be in that list.

Shipped with it: the `vendor-geo` cycle assertion (the pre-existing guards only cover the entry
and the catch-all, so a `vendor-geo ⇄ vendor-charts` edge would have passed all of them); a
route-level gate walking the transitive closure of the first-party `d3_utils` chunk, proving a
geo-only chunk never reaches `vendor-charts`; the `no-restricted-imports` ban on the `d3`
umbrella, in **both** the base and `ai/**` blocks (flat-config rule entries replace rather than
merge, so a base-only rule is silently dropped wherever an override redefines the same rule);
and the relabelling of the now-dead `d3` meta-package matcher in `vite.config.ts` as a guard.
`staticImportsOf` in the test helper was also widened to match Rollup's side-effect import form
(`import"./x.js"`), of which the build emits ~3,200 — without it a leaf assertion can pass
vacuously.

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

### T4.3 — Hint the visitor's bundle from the head

Vite cannot emit a static `<link rel="modulepreload">` for the locale chunk: which of the two
it is only becomes knowable at runtime (`/en/*` prefix, else the stored `language`). So
`vite/preload-locale.ts` injects a tiny inline script into `<head>` that picks the bundle and
appends the hint itself, tagged `data-locale-preload` for the gate in `tests/perf.spec.ts`.

**Verify:** the script ships in `dist/index.html` and offers both chunk URLs; exactly one
translation bundle is requested per load (both are asserted in `perf.spec.ts`). Note the hint
makes the chunk *discoverable* at ~770 ms but not *downloaded* then — it queues behind the
vendor chunks on a bandwidth-bound link, which is expected and is not a defect; see "Measured
negative result" below.

**Expected after T4:** entry ~339 → **~235 KB br** (estimate — the marginal saving inside a
chunk is smaller than the standalone file's compressed size); critical path **~467 KB br**
— the HOME route, which is what this table tracks throughout. A route with its own lazy chunk
and chart vendor is higher; `/indicators/economy` measures ~675 KB br.

## T5 — Repair the perf gate, then budget it (A1, A8)

### T5.1 — Make `tests/perf.spec.ts` assert the load, not the hint

**Implemented as an addition rather than a replacement.** The hint gate still guards the shipped
HTML; the request gate guards what the browser actually fetches. Both are needed — a hint list
that is correct while the load is wrong is exactly the §0c/A1 lesson, and so is the reverse.

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

~~Final targets: entry ≤ 250 KB, `vendor` ≤ 100 KB, entry + preloads ≤ 520 KB.~~ **Landed
2026-07-29 at the measured output +~5%,** which beat two of the three targets and missed one:

| | target | measured | budget |
|---|---|---|---|
| entry + preloads + CSS | ≤ 520 KB | **359,267 B** | 377,000 |
| entry chunk | ≤ 250 KB | **67,169 B** | 71,000 |
| catch-all `vendor` | ≤ 100 KB | **124,814 B** ✗ | 131,000 |
| locale bundle (bg / en) | — | **168,371 / 152,852 B** | 177,000 / 161,000 |

The `vendor` target was **not** met. T1.2 took that chunk from 246 KB to 125 KB by extracting
CodeMirror, and what remains — lucide-react, tailwind-merge, react-ga4, `@babel/runtime` and the
long tail of unsplit deps — has no single dominant member left to extract. Budgeted at the
measured value rather than at the wish, so the ratchet is real rather than permanently red.

Budgets are a ratchet — failing means "justify or split", not "raise the number". They are
computed with brotli **quality 11**, pinned: that is not what a CDN compresses at on the fly
(q5 measures +14.2%), so the numbers are a deterministic lower bound on wire bytes rather than
the served size — which is what a ratchet needs, since q11 is monotone in content. `vite preview`
and the build log report gzip, which runs ~27% higher; never compare the two.

### T5.4 — No module-scope translation calls

Assert no `src/**` module calls `i18n.t` / `t(` at module scope (A7 found zero today). This is
what keeps T4's awaited-init invariant true.

Once the budgets hold, drop `chunkSizeWarningLimit: 800` back toward Vite's default — the
comment justifying it ("maps + jspdf … loaded on demand") finally becomes true.

## T6 — Data layer (small, independent)

**Status: one operator action outstanding, one investigation closed as won't-fix.**

### The re-upload — an OPERATOR action, deliberately not automated

`canonical_parties.json` (84 KB) and `governments.json` (10 KB) are fetched from
`storage.googleapis.com` — a **second origin** (extra DNS+TLS, 175 ms measured) served
**uncompressed**, per the known GCS behaviour. Re-uploading them with content-encoding gzip
takes 84 KB → ~20 KB at zero code cost:

```bash
gsutil -h "Content-Encoding:gzip" cp -Z canonical_parties.json governments.json gs://data-electionsbg-com/
```

Left for the operator rather than run from here: it mutates the production bucket, and nothing
in this plan's scope required it. Note `gsutil -m` hangs on macOS (see
`reference_gsutil_macos_multiprocessing`) — the command above is deliberately single-threaded.

### The fetch-scope question — investigated, not worth doing

`canonical_parties.json` is fetched on every route, and the obvious hypothesis was that a
procurement page has no business loading party colours. It does not survive contact with the
code: `useCanonicalParties()` has **two shell consumers**, `layout/header/ElectionsSelect.tsx`
and `layout/header/CabinetAnchorPill.tsx`, and the first renders the party-coloured election
picker in the header on every page. Deferring the fetch would mean the election selector paints
without its colours and then re-colours — a visible flash on the highest-traffic control on the
site, to save a request that is off the critical path (it is a data fetch, not a blocking
module) and that the gzip re-upload above shrinks by 76% anyway.

`CabinetAnchorPill` calls the hook unconditionally and then returns `null` when no cabinet is
anchored, which looks like a free win — but React Query dedupes the two calls into one request,
so gating it saves nothing while `ElectionsSelect` remains.

**Closed as won't-fix.** The right fix is the re-upload, not a code change.

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

## Measured negative result — preloading the route chunks earlier (2026-08-11)

Do not re-attempt this without new evidence. It looks obviously right and it is not.

`/indicators/economy` was profiled because it "feels slow on phone" (Lighthouse mobile: LCP
6.2–8.2 s, score 0.11 / 0.02; real applied throttling: FCP 5.4 s). The waterfall below is the
state **before** the data preloads landed in `c65819ebb1` — hop 5 is exactly what that commit
moved into the head, and it is kept here unchanged because it is what motivated this
experiment. Pixel 5, 150 ms RTT, 1.6 Mbps, 4x CPU:

```
   0 →  762ms   HTML (2.7 KB, #root empty)
 765 → 1620ms   entry + 6 vendor chunks (~345 KB br)
1639 → 1999ms   translation chunk (185 KB br)
2035 → 2217ms   route chunk + vendor-charts (~145 KB br)
2341 → 2789ms   macro.json + macro_peers.json   ← now preloaded from the head
```

Each hop is discovered by executing the previous one, so the natural reading is "hop 4 exists
because the route chunk is discovered late — hint it in the head and it starts with the
vendors." Measured on the live site by injecting `<link rel="modulepreload">` for the route's
lazy graph. Pixel 5, 150 ms RTT, 4x CPU; LCP in ms, median of 3 with all three runs shown.
**control = the live site as deployed at the time, i.e. before the data preloads** — so this
table is internally comparable but its baseline is NOT the shipped configuration, and it is
`dataPreload.ts`'s `none` row rather than its `low` row:

| variant | 1.6 Mbps | 10 Mbps |
| --- | --- | --- |
| control | **5664** (5664/5664/5672) | **3308** (3308/3456/3300) |
| + 18 small route chunks (~20 KB) | 5928 (6184/5928/5876) | 3672 (3160/3756/3672) |
| + those and `vendor-charts`/`vendor-geo` (~145 KB) | 6208 (5892/6208/6532) | 3016 (3740/3016/2872) |

At 1.6 Mbps both variants are a regression and the spread does not overlap the control. At
10 Mbps neither is a reliable win — the `all` row's runs span 868 ms and straddle the control.

**Why.** The chain is bandwidth- and execution-ordered, not discovery-ordered. The route chunk
cannot *run* until the entry, the vendors and i18n have parsed, so fetching it sooner does not
move the moment it executes — it only takes bandwidth from the chunks that gate it. On a link
that is already saturated for the whole pre-paint window, any extra parallel byte is
subtracted from the critical path rather than overlapped with it.

Two corollaries worth keeping:

- **The translation chunk is already hinted as early as it can be**, by the inline
  `data-locale-preload` script `vite/preload-locale.ts` emits (T4.3). Its 1639 ms start is
  bandwidth queueing behind the vendors, not late discovery, so there is nothing to fix there.
- **The same effect bounds the data preloads** in `scripts/prerender/dataPreload.ts`, which is
  why they ship at `fetchpriority="low"` and are still a small net loss at 1.6 Mbps. That
  comment carries its own measurement table, on the same hardware.

**What would actually move it**: fewer critical-path bytes, not a different order. On this
route ~675 KB br must transfer and parse before anything paints — more than the ~467 KB in the
Expected-result table above, which is the HOME route's critical path and excludes this page's
lazy route chunk and chart vendor. The largest single item is the translation catalogue: the
`bg` chunk is 185 KB br / 961 KB raw (`perf.spec.ts` quotes the same raw figure as 947 KB), the
whole site's strings, loaded for every route. `perf.spec.ts` reaches the same conclusion at its
budget comment, which now has ~900 bytes of headroom against a ceiling already re-ratcheted
once — so namespace-splitting the catalogue is closer to forced than optional. Making the
prerendered body visible (currently `hidden`, see Non-goals) is the other lever, and would
decouple first paint from the JS chain entirely.
