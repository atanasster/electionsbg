# Bulgaria flyover — money columns, money arcs, and the guided tour

**Status:** ready to execute
**Scope:** one dependency-free 3D-like scene engine over pre-projected Bulgaria geometry; three programmes (money columns, money arcs, guided tour) rotating in ONE slot on `/`; then a scroll-driven article built from the same scenes; then a Remotion explainer rendered from the same engine
**Version:** v1 — oblast grain, three money layers plus elections and prices, no terrain, no municipality zoom
**Decided:** 2026-09-05 from the concept gallery (concepts 1 + 2 + 6 chosen; 3, 4, 5, 7, 8 not in scope except where noted)
**Related:** [home-dashboard-implementation-v1.md](./home-dashboard-implementation-v1.md) (the home contract this plan amends), [explainer-video-v1.md](./explainer-video-v1.md) (the video pipeline this plan reuses), [cr-deeds-capture-v1.md](./cr-deeds-capture-v1.md) (the contractor-seat gap this plan closes part of)

> **Audit — 2026-09-05, same day, against the tree.** Nine corrections, folded into the
> sections below rather than appended: (1) article markdown lives in
> `public/articles/<slug>-{bg,en}.md`, not under `src/` (§9); (2) the home plan's §9.3a
> request-log gate was never written, so §11.3 ADDS it rather than amending it; (3) there is
> no dev-route idiom — `/db` is a public console with a justified coverage exemption — so the
> camera-tuning harness is a frame renderer, not a route (§6, §13); (4) Remotion blends
> per-scene PARTIAL states over narration-measured durations (`resolveTimeline`), so the
> engine's unit is a blendable `FlyoverState`, not a `t` into a fixed loop (§0.2, §4, §10);
> (5) posters are COMMITTED files generated before the build — `public/` is copied at build
> time, so `postbuild` would be too late (§8.3); (6) Cyrillic labels in Node need the brand
> script's `registerFonts()` (§8.3); (7) the two money bases differ by 0.77%, not < 0.5%,
> because the seat sum is the PLACED total — the gate now compares the right pair (§3, §11.1);
> (8) Postgres names oblasts (`София (столица)`) while the artifact keys them by code, so the
> generator owns one name→code map and a 28↔28 gate (§3); (9) `ORDER_PAIRS` is in
> `refresh_coverage.test.ts`, as `{ after, before, why }` (§3). Also recorded: the home HTML
> is at 10,295 of its 18,000 characters, and caption i18n keys must be literals (§4, §8.4).
>
> **What this plan changes about the home page, stated up front.** The home plan's §4.1 fixed
> "no full-width map, decorative hero illustration, or election result chart appears above the
> primary destinations", and `tests/perf.spec.ts` pins `/` in `MAP_FREE_HUBS` with the basis
> "the screen header disclaims maps and charts (807f3c583e)". This plan puts a moving map on
> `/`. It does so WITHOUT touching the property that gate protects — the home chunk's `mapDeps`
> still carries no `vendor-geo`, `vendor-leaflet` or `vendor-charts` — because the scene has no
> map library at all: the geometry is projected at GENERATION time and the client draws plain
> canvas. The gate stays; its `basis` string and the screen header are rewritten to record the
> new decision (§8.4). The other home contracts (two GCS requests at first paint, zero
> `/api/db`, the 18,000-character HTML budget, the head height budget, CLS < 0.1) are kept
> exactly, and §8 says how.

## 0. Decisions and the measurements behind them

Every number below was measured on the local Postgres on 2026-09-05 unless it says otherwise.

### 0.1 No deck.gl, no MapLibre — a hand-rolled canvas engine over pre-projected geometry

The concept gallery was drawn with pre-projected polygons and a 2.5D transform, and it was
convincing at 300 px wide. The production engine is the same idea with a real camera:

- **Geometry is projected once, offline**, into a 1000×625 planar frame (Mercator fit, the same
  `geoMercator().fitExtent` the app's `d3_utils.ts` uses), simplified with Douglas–Peucker, and
  stored as integer tenths. Measured on `data/regions_map.json` (31 features): 1,282 points at a
  1.9 px tolerance = **17,088 bytes**; 1,977 points at 1.1 px = 25,204 bytes. The client never
  imports `d3-geo`.
- **The client draws with `CanvasRenderingContext2D`** — polygons, extruded boxes, lifted
  Bézier arcs, and labels — behind a pinhole camera (position, target, pitch, yaw, focal
  length) with painter's-order depth sorting. At this point budget (31 polygons, 28 columns,
  ≤ 60 arcs) a 2D canvas is far inside a frame budget; WebGL buys nothing.
- **What that costs:** no terrain, no per-pixel lighting, no municipality-level zoom (265
  polygons is still fine for canvas; it is out of v1 for data reasons, §12). A later tier could
  add a precomputed hillshade raster under the polygons; nothing in v1 forecloses it.
- **What it buys:** the flyover chunk is app code of roughly 10–14 KB brotli with no vendor
  import, so it satisfies every home gate as written; the identical draw function runs in the
  browser (home + article), in Node under `@napi-rs/canvas` (posters, OG images), and inside
  Remotion (the video), which is what makes the article and the video derivatives rather than
  re-implementations.

deck.gl + MapLibre would be ~400–500 KB brotli on the site's entry page, would need its own
tiles or a raster basemap, and would put a WebGL dependency in front of a poster that must
paint on a 2019 phone. It is the wrong tool for a route whose HTML is budgeted at 18,000
characters.

### 0.2 One scene engine, explicit state, explicit clock, no wall clock

The engine has two pure functions and nothing else:

- `stateAt(programme, t): FlyoverState` — a programme is a keyframe timeline; `t` is seconds
  into it. `FlyoverState` is a plain, BLENDABLE record: camera (target, distance, pitch, yaw),
  per-layer weights (procurement / funds / agri / elections / prices, each 0..1), the
  highlighted oblast, arc visibility, and the caption id.
- `render(ctx, world, state, viewport, clock)` — draws one frame from a state. `clock` is
  seconds and drives only continuous effects (arc dash offset, label fade); it is an argument,
  never read from `Date.now()` or `performance.now()`.

Three callers, three sources of state: `/` runs `stateAt` on a `requestAnimationFrame` clock;
the article maps scroll position to `t`; Remotion does NOT use `stateAt` at all — its
`resolveTimeline` blends each scene's PARTIAL `FlyoverState` over the durations the narration
measured (§10), which is why the state must be blendable and why a fixed-length loop would not
have fitted. Nothing in the engine imports React. `flyoverEngine.test.ts` renders the same
state twice into a recording context and compares the command logs.

### 0.3 The data basis of each layer, and the one that is only a quarter covered

| layer | basis | coverage of the € | source |
| --- | --- | --- | --- |
| procurement columns | contract € at `tag = 'contract'`, by the BUYER's seat oblast | **€93.18bn of €94.12bn (99.0%)** | `contracts` ⨝ `awarder_seats` |
| EU funds columns | `fund_projects.grant_eur` by `oblast` | ~50% — the national-scope programmes carry no oblast (`funds_hub_stats.placedMoneyPct`, migration 145: 50.05% of grant money has no oblast) | `fund_projects` |
| farm subsidies columns | `agri_subsidies.total_eur` by `oblast` | full | `agri_subsidies` |
| money arcs | contract € with BOTH the buyer seat and the contractor seat resolved to an oblast | **€22.09bn of €94.12bn (23.5%)** | `contracts` ⨝ `awarder_seats` ⨝ `tr_company_place` |
| elections overlay | winner + share per МИР, latest two parliamentary elections | full | committed `data/<date>/region_votes.json` |
| prices overlay | basket index vs 2 Jan 2026, per oblast | 166 panel settlements | `price_payloads` (`kind='index'`, `regions`) |

**The arcs are the concept with a data problem, and the plan says so rather than drawing
around it.** Of the €94.12bn at `tag = 'contract'`:

| contractor bucket | €bn | rows | why it has no seat |
| --- | --- | --- | --- |
| EIK in `tr_companies`, seat text EMPTY, unplaced | **42.66** | 275,991 | the TR daily feed's genesis gap — the company predates the feed and its seat was never re-stated |
| EIK not in `tr_companies` at all | **21.67** | 29,286 | foreign firms (Saab, Indra, S&P Global…), BULSTAT-only bodies, state enterprises with 13-digit ids |
| EIK in TR with seat, placed | 22.26 | 97,061 | the arcs today |
| `obed-` consortium carriers | 6.23 | 2,688 | a carrier is a member set, not a registered seat |
| other synthetic (`ph-`, `np-`, filler) | 1.16 | 1,369 | not identifiers |
| in TR with seat, resolver refused (ambiguous name) | 0.14 | 997 | correct refusal |

Two facts make this recoverable rather than terminal. The money is concentrated — the top 200
contractors carry **46.3%** of plain-EIK contract money and the top 1,000 carry **74.0%** — and
the Commerce Registry deed capture (`raw_data/tr/cr_deeds.sqlite`, 29,777 captures) carries the
seat as a structured field (`CR_F_5_L`: „Област: Благоевград, Община: Разлог, Населено място: гр.
Разлог"), which `parse_cr_deeds.ts` already parses into `seat` and which `project_cr_deeds.ts`
**does not write anywhere**. 246 of the top-1,000 contractors are already captured. Tier 3 closes
the gap in three moves (§7) and the scene states its coverage in words until then.

What the arcs already show, on the placed quarter: **55.7%** of both-placed money stays inside
the buyer's oblast, **31.1%** flows INTO Sofia-city contractors from buyers elsewhere, and only
**7.3%** flows out of Sofia-city buyers to contractors elsewhere. The largest cross-oblast flows
are Пловдив → София (€1,116m), Варна → София (€1,005m), Стара Загора → София (€727m). The
28×28 matrix has 628 non-zero cells and the query runs in 247 ms.

### 0.4 One slot, three programmes, rotation rather than stacking

The user's instruction: "place them on the home page; if they don't fit, we can randomly
switch them." They do not fit — three moving scenes on the entry page would compete with the
eight destinations the page exists to route to. So `/` gets ONE band holding ONE programme per
visit, rotated deterministically (§8.2), with a visible switch so a reader can see the other two.
The guided tour on `/` is the AUTO-ADVANCING variant (captions and camera move on a timer); the
scroll-driven tour is the article (§9).

### 0.5 Motion is opt-in by environment, and a static poster is the default state

The band always renders a poster first — an `<img>` with a reserved aspect ratio, generated by
the same engine in Node — and the canvas replaces it only when ALL of: the band is in view, the
document is visible, the browser is idle after load, `prefers-reduced-motion` is not `reduce`,
and `Save-Data` is not on. Reduced motion never animates; the switch control still changes the
poster. This is what keeps CLS on `/` unchanged and keeps first paint at two GCS requests.

## 1. Outcome

- `/` shows, under the hub head and above the eight tiles, a 3D-like moving map of Bulgaria in
  one of three programmes: money columns by oblast cycling procurement → EU funds → subsidies
  with a flying camera; money arcs between buyer and contractor oblasts; or a 40-second guided
  tour with captions. Every caption carries its basis and its coverage.
- `/articles/2026-09-DD-money-map` (BG + EN) is a scroll-driven tour of five chapters over the
  same scenes, prerendered with its prose and one poster per chapter, in the sitemap with its
  own OG image.
- `brand/videos/2026-09-money-map/yt.mp4` is a 60–120 s 16:9 explainer rendered from the same
  engine inside Remotion, with a 9:16 cutdown, produced by the `naiasno-video` skill's chain.
- `data/home/flyover.json` is the one committed artifact behind all three, regenerated by
  `db:refresh`, byte-stable, budgeted, bucket-synced and gated.

## 2. Fixed v1 decisions

1. Oblast grain everywhere: 28 oblasts for money, 31 МИР polygons for elections (Sofia's three
   and Plovdiv city keep their own polygons and map to their oblast for money).
2. Geometry is pre-projected at generation time; the client never runs a geographic projection.
3. One engine, one blendable `FlyoverState`, explicit clock, no wall clock, no React, no `@/`
   imports (so `video/` can import it by relative path — `video/tsconfig.json` deliberately
   excludes the app's alias map).
4. One artifact, `data/home/flyover.json`, ≤ 48 KiB uncompressed, holding geometry + layers +
   flows + caption figures. No second request for geometry.
5. `/` first paint stays at exactly two GCS requests and zero `/api/db`; the flyover artifact is
   the THIRD request and is made only after the band arms.
6. Three money layers are three TAPS, never a total (the corpora overlap — an ИСУН-funded
   contract is in `fund_projects` AND `contracts`). No caption sums across layers.
7. Every caption names its basis (`buyer seat`, `grant € by oblast`) and, for the arcs, the placed
   share. A number without its basis is a defect.
8. Rotation is deterministic per visitor-day, never per render; a `?scene=` query is honoured
   for capture and tests and is NOT in `usePreserveParams`.
9. Reduced motion means no `requestAnimationFrame` at all, not a slower one.
10. The prerendered `/` body gains at most 600 characters (one paragraph, one `<img>`, one link)
    against `HOME_HTML_MAX_BYTES`; the map geometry is never inlined in HTML.
11. The article is a bespoke route in the `machine-only-sections` pattern: a hard-coded
    `<Route>` beside `articles/:slug`, prose in `public/articles/<slug>-{bg,en}.md`, an entry in
    `public/articles/index.json` (which is what gives it a prerender body, a sitemap `<loc>` and
    an `ogImage`), and a one-line note in `ogAndSitemapCoverage.test.ts`'s route table.
12. The video is an `explainer` (16:9, 60–120 s) per the `naiasno-video` decision of
    2026-08-08; the 9:16 cut is a cutdown of it, not a separate production.
13. Nothing in this plan adds a Postgres migration, a Cloud Function route or a `db:load:*:cloud`
    step. The only cloud publish is the bucket sync of one object.

## 3. The artifact — `data/home/flyover.json`

Generated by `scripts/db/gen_home/flyover.ts` (`npm run db:gen-home-flyover`). Shape (v1):

```jsonc
{
  "v": 1,
  "computedAt": "2026-09-04",            // MAX SOURCE VINTAGE — the latest contract date, never `now`
  "frame": { "w": 1000, "h": 625 },
  "geo": {
    "regions": {                          // 31 МИР polygons, integer tenths in the frame
      "BLG": { "oblast": "BLG", "rings": [[[1864,3370], …]], "c": [1259,3303] },
      "S23": { "oblast": "SOF", "rings": […], "c": [1237,2220] },
      "PDV-00": { "oblast": "PDV", … }
    },
    "cities": { "SOF": [1148, 2056, "София", "Sofia"], … }   // 28 oblast seats
  },
  "layers": {
    "all": {                              // + "ns:2026_04_19"; year windows are NOT in v1
      "proc":  { "SOF": 52709, "PDV": 5950, … },   // M€, buyer seat, tag='contract'
      "funds": { "SOF": 4345, … },                 // M€ grant_eur by oblast
      "agri":  { "PDV": 819, … }                   // M€ total_eur by oblast
    }
  },
  "pop": { "SOF": 1274290, … },           // census 2021, for the per-capita mode
  "flows": {
    "scope": "all",
    "keys": ["SOF","PDV",…],              // 28
    "m": [[…], …],                        // 28×28 M€, buyer row → contractor column, both placed
    "coverage": {                         // the sentence the scene must say
      "totalEur": 94.12e9, "bothPlacedEur": 22.09e9, "buyerPlacedEur": 93.18e9,
      "unplaced": { "trNoSeat": 42.66e9, "notInTr": 21.67e9, "carriers": 6.23e9, "synthetic": 1.16e9 }
    }
  },
  "elections": {
    "2026_04_19": { "S23": { "nick": "ПрБ", "color": "#034a3f", "share": 32.6 }, … },
    "2024_10_27": { … }
  },
  "prices": { "asOf": "2026-08-30", "byOblast": { "BGS": 99.7, … }, "national": 99.6 },
  "figures": {                             // caption NUMBERS, never prose
    "procTotalEur": 93.9e9, "procContracts": 410880, "sofiaBuyerShare": 0.56,
    "sameOblastShare": 0.557, "intoSofiaShare": 0.311, "outOfSofiaShare": 0.073,
    "topFlow": ["PDV", "SOF", 1116e6], "fundsPlacedEur": 16.1e9, "agriTotalEur": 11.0e9
  }
}
```

Rules, each of which is a gate in §11:

- **Deterministic.** Keys sorted, numbers quantized (M€ as integers, shares to 3 decimals,
  coordinates as integer tenths), `computedAt` = max source date. Two rebuilds of one corpus are
  byte-identical, so `db:check-generated` can compare the live object.
- **Budget ≤ 48 KiB uncompressed**, measured at generation and asserted. Geometry is ~17 KB at
  1.9 px; the matrix is 784 integers; the rest is small. If a future layer pushes it over, split
  geometry into `home/flyover_geo.json` — but not in v1, because the second request is the cost
  the budget exists to avoid.
- **Reads Postgres at BUILD time only** (`contracts`, `awarder_seats`, `tr_company_place`,
  `fund_projects`, `agri_subsidies`, `price_payloads`) plus committed files
  (`data/regions_map.json`, `data/census_2021.json`, `data/<date>/region_votes.json`,
  `data/<date>/cik_parties.json`, `src/data/json/elections.json`). Nothing at runtime.
- **A missing input drops its layer and records it in `available`**, the `hub_stats` idiom; it
  never zeroes a layer, because a zero column is a claim.
- **Registered in `REFRESH_GENERATORS`** with `artifact`, `reason` and
  `bucketPath: "home/flyover.json"`; placed in `db:refresh` immediately before
  `db:gen-home-hub-stats`, i.e. after `db:load:tr-company-place:pg` (the arcs' contractor side)
  and after every loader whose table it reads. `refresh_coverage.test.ts` enforces membership;
  its `ORDER_PAIRS` table (in the TEST file, shape `{ after, before, why }`) gains
  `{ after: "db:gen-home-flyover", before: "db:load:tr-company-place:pg", why: "the arcs'
  contractor side is tr_company_place, which that loader rebuilds" }`.
- **Bucket:** `bucket:sync` already carries `home/` (no exclusion matches it); run `bucket:gz`
  after, per home plan §9.3b, or the object serves uncompressed.

**The money basis is named once, and there are THREE numbers in play.** The corpus total at
`tag = 'contract'` is €94.12bn; `hub_stats.json`'s `totalEur` is €93.91bn (it excludes the
628 empty-`contractor_eik` rows, €0.21bn, 0.22% apart); and the buyer-PLACED sum the columns
are built from is €93.18bn (99.0% of the corpus — the rest has no resolvable buyer seat). The
caption headline uses `figures.procTotalEur` from `hub_stats`, the number the tile one screen
below shows; the column heights use the placed sum; `flows.coverage.buyerPlacedEur` says how
much is placed, and the caption says „по седалище на възложителя". The data test asserts the
corpus total and the `hub_stats` figure agree within 0.5% and that `buyerPlacedEur / totalEur
≥ 0.98`. Do not "reconcile" them.

**Oblasts are NAMED in Postgres and CODED in the artifact.** `awarder_seats.oblast`,
`tr_company_place.oblast`, `fund_projects.oblast` and `agri_subsidies.oblast` carry names
(`София (столица)`, `София`, `Пловдив`), while the artifact, `data/census_2021.json` and the
election files carry codes (`SOF`, `SFO`, `PDV`). The generator owns ONE name→code map
(`scripts/db/gen_home/oblastCodes.ts`, seeded from `data/census_2021.json` — NOT from
`src/data/json/regions.json`, which is МИР-keyed, carries no `SOF` at all and spells the two
provinces `обл. Пловдив` / `София област`, neither of which any input uses) and refuses to
write if any name in any input maps to zero or two codes, or if fewer than 28 codes receive a
value. `funds.oblast` uses codes already (`S22` for Sofia city — folded to `SOF`); the prices
block keeps МИР keys (31) because its source `regions` are МИР-keyed and so are the polygons.

## 4. The engine — `src/lib/flyover/`

Pure TypeScript, no DOM beyond the `CanvasRenderingContext2D` type, no React, no `@/` imports.

```
src/lib/flyover/
  types.ts        World, Programme, Camera, Keyframe, Caption
  camera.ts       pinhole projection, keyframe interpolation (ease-in-out, dwell segments)
  layers.ts       column heights (√ scaling, per-layer max), arc geometry (lifted quadratic), colour ramps
  programmes/
    columns.ts    the money-columns flyover: 3 layers × camera path (overview → Sofia → Varna → overview), 42 s loop
    arcs.ts       the money arcs: Sofia hub, top-N flows, in/out colouring, 30 s loop
    tour.ts       the guided tour: 5 chapters, captions, 40 s, auto-advance; the same chapter table the article scrolls
  state.ts        FlyoverState, blend(a, b, k), STATE_ZERO — the unit every caller exchanges
  render.ts       render(ctx, world, state, viewport, clock) → draws; accepts any Ctx2D-shaped object, so tests pass a recorder
  captions.ts     CAPTIONS: Record<CaptionId, { key, params }> — LITERAL i18n keys, never templates
  rotation.ts     which programme a visitor sees (§8.2)
```

Caption keys are literal strings in one table because `scripts/i18n/key_usage.test.ts` and
`bundle_reachability.test.ts` treat a built template (`` `flyover_${id}` ``) as naming every key
it could match — the home registry's `descKey` comment records the same trap.

Design rules:

- **Camera** — position/target/pitch/yaw/focal; keyframes carry `t`, target, distance, pitch,
  yaw and an optional `dwell`. Interpolation is smoothstep between keyframes; the loop closes on
  the first keyframe. Sofia and Varna targets come from `geo.cities`, so a re-projection moves
  the camera with the map.
- **Depth** — every primitive gets a camera-space depth (polygon: centroid; column: base
  centre; arc: midpoint); draw order is polygons, then columns and arcs sorted by depth. This is
  approximate and sufficient at oblast grain.
- **Columns** — `h = H · sqrt(v / max)` per layer, `max` per layer so the three taps are each
  legible (Sofia dominates procurement 9:1; funds 4:1; agri is flat). Sofia's column stands at
  the CITY, not at the S23 centroid.
- **Arcs** — top N by € (default 40) plus every flow into or out of the highlighted oblast in the
  tour; width ∝ √€; lift ∝ distance; two colours (into Sofia, out of Sofia) and one neutral;
  animated dash offset from `t`. A flow with an UNPLACED end is never drawn as an arc — it is
  the number in the coverage caption.
- **Captions** — the engine emits `{ key, params }`; the React host renders them as DOM text
  through `t()`. Canvas never draws Bulgarian prose, so captions are translatable, selectable,
  and readable by a screen reader. City labels (proper nouns) are the only text on canvas.
- **Colours** are inputs, not constants: the host passes a palette resolved from CSS variables
  (theme-aware) or, for posters and video, the brand palette. The engine holds no hex.
- **Performance** — draw cost target ≤ 4 ms per frame at 1,282 points + 28 columns + 40 arcs on
  a 2019 laptop, measured by `scripts/home/flyover_bench.test.ts` under `@napi-rs/canvas` (a
  proxy, and named as one). It lives under `scripts/` because `vitest.config.ts` runs `src/**`
  in jsdom — where there is no canvas — and `scripts/**` in node. The host caps at 30 fps and
  `devicePixelRatio ≤ 2`.
- **Tuning harness** — there is no `/dev/flyover` route. `scripts/prerender/ogAndSitemapCoverage.test.ts`
  requires every routed page to be declared or exempt ON MERIT (`/db` is exempt as a query
  console with `useNoindex()`, not as "a developer tool"), and a tuning page has no merit to
  claim. Camera paths are tuned with `npm run home:flyover-posters -- --programme columns --t 12`
  (one frame to PNG) and on the real band with `?scene=`.

## 5. Three programmes

| programme | what a reader sees | length | data |
| --- | --- | --- | --- |
| **columns** | oblast columns rise; the camera pulls in over Sofia, sweeps east along Тракия to Бургас and up the coast to Варна, then back out; every 14 s the layer changes: procurement → EU funds → subsidies, with the caption naming the layer, its total and its basis | 42 s loop | `layers.all`, `figures` |
| **arcs** | flat-ish tilt; the top 40 buyer→contractor flows animate as dashed arcs; the caption cycles: „55,7% остават в областта", „31,1% отиват в софийски фирми", „едва 7,3% излизат от София", then the coverage sentence | 30 s loop | `flows`, `figures` |
| **tour** | five chapters, each a camera move plus a caption: (1) where the state buys, (2) where the money goes, (3) EU funds vs procurement, (4) the countryside inverts the map (subsidies), (5) prices since the euro; the elections overlay is NOT in the home tour (it is chapter 6 of the article) | 40 s, auto-advance, then loops | all layers |

The tour's chapter table (`programmes/tour.ts`) is the article's spine: the article imports the
same table and maps scroll position to chapter and intra-chapter `t`.

## 6. Tier 0 — data and geometry (no UI)

1. `scripts/geo/project_regions.ts` — projects `data/regions_map.json` into the 1000×625 frame,
   simplifies (tolerance a CLI flag, default 1.9), emits the `geo` block, prints point count and
   bytes. Pure function over the file; unit-tested on the committed input (31 keys, every ring
   closed, RSE keeps its two rings, Sofia's three keys map to `SOF`).
2. `scripts/db/gen_home/flyover.ts` — the generator of §3, on the `price_events.ts` idiom
   (`allRows` / `end` from `scripts/db/lib/pg`). Reads PG + committed files; writes the
   artifact; asserts the 48 KiB budget; prints the coverage table of §0.3 so a run's output is
   the measurement. `scripts/db/gen_home/oblastCodes.ts` is its name→code map (§3).
3. `package.json`: `db:gen-home-flyover`; `db:refresh` gains it before `db:gen-home-hub-stats`.
4. `scripts/db/refresh_coverage.ts`: the `REFRESH_GENERATORS` entry (artifact, reason,
   bucketPath) and the `ORDER_PAIRS` entry.
5. `scripts/db/tests/flyover.data.test.ts` — see §11.1.
6. Commit the artifact; `npm run db:check-generated` must report it absent from the bucket
   until Tier 2's publish, which is the expected state, not a failure.

Exit: the artifact exists, is ≤ 48 KiB, and the data gate is green.

## 7. Tier 3 (moved up because the arcs need it) — contractor placement

Ordered by yield per effort; each step is independently shippable and the flyover regenerates
after each.

1. **Project the deed seat.** `project_cr_deeds.ts` writes `seat` into `tr_companies.seat`
   **fill-if-null only** (the same precedence rule `subject_of_activity` uses and for the same
   reason: the daily feed re-states the field and a capture is frozen at `fetched_at`). Then
   `tr:daily-refresh` → `db:load:tr:pg` → `db:load:tr-company-place:pg` re-resolves. Expected
   yield from the 29,777 existing captures: measured in the run, reported as a before/after
   coverage line. Gate: `tr_sole_trader.data.test.ts`'s sibling pattern — a data test that skips
   with a DISTINCT reason on a corpus predating the projection.
2. **Capture the top contractors.** Export the top-1,000 plain-EIK contractors by contract €
   (74.0% of the money; 246 already captured) and run
   `npm run tr:cr-deeds -- --eiks <list>` (`--probe` first). ~754 rate-limited fetches — an
   operator action, not a pipeline step. Re-run step 1's chain.
3. **Place consortium carriers at the lead member.** `contracts.consortium_eik` and the 087
   member set give each `obed-` carrier its members; place the carrier at the FIRST placed
   member's oblast and mark `flows.coverage.carriersPlacedAtLead` so the caption can say it.
   This is a generator rule, not a table change.
4. **Foreign and non-TR contractors stay unplaced and are COUNTED.** `notInTr` is rendered as one
   off-map endpoint („извън регистъра / чужбина") in the arcs programme with its € beside it.
   Never a guessed oblast.

Cloud side, when a step changes the corpus: `db:load:tr:pg:cloud` (280 s) then
`db:load:tr-company-place:pg:cloud` (28 s) — the documented pair — then regenerate and sync the
artifact. Nothing else moves.

Ratchet: `flyover.data.test.ts` holds `bothPlacedEur / totalEur ≥ FLOOR`, with `FLOOR` set at
0.20 today and raised by hand after each step lands. A step that lowers it fails the gate.

## 8. Tier 2 — the home slot

### 8.1 Files

```
src/screens/home/flyover/
  HomeFlyover.tsx        the band: poster <img>, canvas, captions, switch, arming logic
  useFlyoverArtifact.ts  fetch(dataUrl("/home/flyover.json")), staleTime Infinity, enabled only when armed
  useArm.ts              in view (useInView) ∧ document visible ∧ idle ∧ !reduced-motion ∧ !Save-Data
  FlyoverCaptions.tsx    DOM captions from the engine's {key, params}
public/flyover/
  columns.webp arcs.webp tour.webp      posters, 1000×625, generated (§8.3)
```

`HomeDashboardScreen` mounts `<HomeFlyoverSlot />` between `HubHead` and `TileHubGrid`. The
slot is `lazy(() => import("./home/flyover/HomeFlyover"))` wrapped in a `Suspense` whose
fallback is the SAME poster `<img>` in the same aspect box — so the reserved height is identical
in all three states (fallback, poster, canvas) and CLS cannot move.

### 8.2 Rotation

`rotation.ts`: `programme = PROGRAMMES[(dayIndex + seed) % 3]` where `dayIndex` is the UTC day
number and `seed` is a per-session integer minted once into `sessionStorage` (so back-navigation
within a session shows the same scene, and a reload on another day shows another). Three dots
under the band switch programmes; the choice persists for the session. `?scene=columns|arcs|tour`
overrides everything, for OG capture, Playwright and screenshots; it is NOT added to
`usePreserveParams`, so it never rides onto a tile link.

### 8.3 Posters and the prerendered body

`scripts/home/flyover_posters.ts` (`npm run home:flyover-posters`) renders each programme at
its first keyframe with the engine under `@napi-rs/canvas` (`^0.1.99`, already used by
`scripts/brand/generate_brand_art.ts`) into `public/flyover/<programme>.webp` at 1000×625
(PNG if the build's encoder lacks WebP; the gate accepts either). ~30–60 KB each. Two things
about it are not optional:

- **The posters are COMMITTED and generated BEFORE `npm run build`.** Vite copies `public/`
  into `dist/` during the build, so a `postbuild` step would write files the deploy never
  ships — the same reason the home plan runs OG capture and the sitemap before the build. The
  script runs as part of the artifact publish (§13) and the gate asserts the files exist,
  decode to 1000×625, and are newer than `data/home/flyover.json`.
- **Cyrillic labels need a registered font.** Node canvas has no system font fallback for
  Cyrillic; the script calls `registerFonts()` and uses `FONT` from
  `scripts/brand/lib/brandMark.ts`, exactly as the brand art does.

The same script, with `--og`, composes the article's share card
(`public/og/money-map.png`, 2400×1260 — the size `public/og/home.png` uses, a 2× render of
the 1200×630 OG clip) from the chapter-2 state. Article OG images are not captured by
`scripts/og/capture-screens.ts` (no article has an entry there); they are committed files
named by `ogImage` in `public/articles/index.json`, e.g. `"/og/money-map.png"`.

`buildHomeBody` gains ONE section: a heading-less paragraph (≤ 300 characters BG, ≤ 300 EN)
naming the three scenes and their basis, the poster `<img>` with `width="1000" height="625"`
and `loading="lazy"`, and a link to the article. Budgeted against `HOME_HTML_MAX_BYTES`; the
addition is measured in the PR and the ceiling is raised only with that measurement in its
comment, per the existing comment on that constant.

### 8.4 Contracts kept, contracts amended

| contract | where | how this plan meets it |
| --- | --- | --- |
| `/` first paint = two GCS requests, zero `/api/db` | home plan §9.3a | the artifact request happens only after `useArm` resolves true. ⚠️ The gate §9.3a specified was NEVER WRITTEN (no test names `home/hub_stats.json` or `feed.json`); §11.3 adds it with the three-request shape |
| `MAP_FREE_HUBS` — no `vendor-geo` / `vendor-leaflet` / `vendor-charts` in the home chunk's `mapDeps` | `tests/perf.spec.ts` | the flyover is a separate lazy chunk importing only `react` and the engine; the gate is unchanged, its `basis` string is rewritten to: "a dependency-free canvas scene behind its own lazy boundary (this plan); map libraries stay banned" and the screen header's "renders no map" sentence is replaced by the same statement |
| `HOME_HTML_MAX_BYTES` = 18,000 chars | `tests/perf.spec.ts` | the built home is at **10,295** characters today, so ≤ 600 added leaves the ceiling untouched; geometry never inlined |
| `HOME_MODULEPRELOAD_MAX` = 7 | same | the chunk is a dynamic import from the home chunk, not the entry; no hint is emitted |
| head budget 520 px / 4 cells | `tests/ui.spec.ts` | the band is OUTSIDE `[data-hub-head]`; the OG capture still frames the head |
| CLS < 0.1 on `/`, also with slow JSON | same | reserved aspect box in all states; captions live in a fixed-height row |
| `entryGraph.test.ts` | source | nothing under `src/lib/flyover` or `src/screens/home/flyover` is statically reachable from `main.tsx` — a new forbidden-set entry names the engine so a future static edge fails in milliseconds |
| i18n | core corpus | ~25 LITERAL keys in `translation.json` (no bundle: a bundle is a request, and `/` is budgeted in requests; no templates, per §4) |

### 8.5 Accessibility and motion

- The band is `role="img"` with an `aria-label` equal to the current caption sentence; captions
  are live DOM text; the switch is three buttons with `aria-pressed`.
- `prefers-reduced-motion: reduce` → poster only, captions static, switch changes the poster.
  No `requestAnimationFrame` is ever scheduled (asserted in a component test by stubbing it).
- `document.visibilityState !== "visible"` or the band leaving the viewport pauses the loop;
  returning resumes at the same `t`.
- 30 fps cap; `devicePixelRatio` clamped to 2; on `matchMedia("(max-width: 640px)")` the band
  renders at 24 fps and the arcs programme draws the top 20 flows.

## 9. Tier 4 — the article

Route `articles/2026-09-DD-money-map`, a bespoke `<Route>` beside `articles/:slug` exactly as
`2026-07-21-machine-only-sections` is, rendering `MoneyMapArticleScreen`
(`src/screens/scenarios/MoneyMapArticleScreen.tsx`). Registered in `public/articles/index.json`
(title, summary, `ogImage`, category) so `buildArticleRoutes` emits its prerender body, its
sitemap `<loc>` and its OG entry; `ogAndSitemapCoverage.test.ts` gets the same one-line note the
machine-only route has.

Layout: `ArticleLayout` shell; a two-column body on ≥ 1024 px — prose left (`ArticleProse`
primitives, one `<section data-chapter>` per chapter), a sticky canvas right (`position:
sticky; top`) — and a stacked body on narrow viewports where each chapter's poster sits inline
above its prose and the canvas is a single sticky strip at the top. Scroll position maps to
(chapter, intra-chapter `t`) through an `IntersectionObserver` per section plus a scroll-progress
ratio inside the active section; the engine gets that `t` and nothing else.

Chapters (BG prose in `public/articles/2026-09-DD-money-map-bg.md`, EN mirror at `-en.md` —
the path `buildArticleRoutes` and the sitemap's `articleLastmod` read, and where the
machine-only article's own markdown sits; the markdown is ALSO the prerendered body, so a
crawler reads the whole argument while the SPA renders the bespoke screen):

1. **Къде купува държавата** — columns, procurement, the 56% Sofia buyer share and why (the
   ministries, АПИ, НКЖИ, Булгартрансгаз are seated there).
2. **Къде отиват парите** — arcs; 55.7% stay in-oblast, 31.1% into Sofia, 7.3% out; the
   coverage sentence in full, with the four unplaced buckets as a small table.
3. **Еврофондове срещу поръчки** — columns, funds vs procurement, and the half of grant money
   that has no oblast because the programme is national.
4. **Провинцията обръща картата** — subsidies: Пловдив €819m, Добрич €698m, Sofia at €717m only
   because the ministry pays there.
5. **Цените след еврото** — prices overlay, per-oblast index, the coverage of 166 panel
   settlements.
6. **Изборите върху картата** — the 2024 → 2026 swing as an overlay on the same map; the one
   chapter that is NOT in the home tour. Its numbers come from `elections` in the artifact.

Every chapter ends with a link to the page that owns the number (`/procurement?pscope=all`,
`/funds`, `/subsidies`, `/consumption`, `/elections`). The article's own posters
(`public/articles/money-map/ch1..6.webp`) come from the same poster script with a `--chapter`
flag; the OG image is `public/og/money-map.png` from §8.3, named in the index entry's
`ogImage`. The sitemap `<loc>` and its `lastmod` come from `public/articles/index.json` and the
markdown mtimes automatically; nothing is added to `route_defs.ts`.

## 10. Tier 5 — the video

Everything runs through the `naiasno-video` skill's existing chain; this tier adds one canvas
kind and one spec.

1. `video/src/lib/spec.ts`: `CanvasKind` gains `"flyover"`.
2. `video/src/canvases/FlyoverCanvas.tsx`: a `<canvas>` sized to the stage's chart area
   (`chartW × chartH`, the props `InflationCanvas` and `RiskCanvas` receive) that, on every
   frame, calls the engine's `render` with a state from
   `resolveTimeline(STATE_ZERO, blend, scenes, sceneDurations, frame, fps)` — each scene in the
   spec declares a PARTIAL `FlyoverState` (`canvas?: Partial<FlyoverState>`), exactly as
   `resolveCanvas` does for `CanvasState` — plus `clock = frame / fps`, and the world from
   `video/src/generated/flyover.json`. `ExplainerVideo.tsx`'s canvas switch gains the
   `"flyover"` arm. It imports the engine by relative path (`../../../src/lib/flyover/…`) —
   legal because the engine has no `@/` imports (§2.3) and `video/tsconfig.json` resolves
   relative imports outside its `include`. Its unit test lives in `video/src/**` — collected by
   the node project since 2026-08-26.
3. `scripts/video/build_flyover.ts` copies `data/home/flyover.json` into
   `video/src/generated/flyover.json` and ASSERTS every claim the script makes (the 56%, the
   55.7 / 31.1 / 7.3 split, the top flow), refusing to write if a refresh moved one — the
   `build_inflation.ts` discipline. `npm run video:data-flyover`.
4. `video/src/specs/e3-money-map.ts`: `kind: "explainer"`, `canvasKind: "flyover"`,
   `runtimeSeconds: [60, 120]`, scenes mirroring the article's chapters 1–4 plus an outro; the
   voice-over carries no digits (rule 7); registered in `Root.tsx` and in the `SPECS` maps of
   `synthesize.ts`, `emit_vtt.ts`, `gate1.ts`.
5. Produce: `video:data-flyover` → `video:gate1 -- e3-money-map` → `video:voice` → `video:vtt`
   → `video:render -- 2026-09-money-map--yt brand/videos/2026-09-money-map/yt.mp4`. Then the
   9:16 cutdown of scenes 1, 2 and 4 as `reel.mp4`. Output stays a draft under `brand/videos/`,
   which is gitignored; the operator publishes by hand.

The scene states are the tour's chapter states (`programmes/tour.ts` exports them), so the
video and the home tour show the same camera positions; what differs is the timing, which
the narration sets, and the stage size and palette.

## 11. Gates

### 11.1 Data (`scripts/db/tests/flyover.data.test.ts`, Postgres, skips when down)

- the artifact is git-tracked, parses, `v === 1`, ≤ 48 KiB;
- `geo.regions` has exactly the 31 keys of `data/regions_map.json`, every ring is closed, every
  region maps to one of 28 oblasts, the frame is 1000×625;
- for each layer and oblast, the stored M€ equals the SQL recount within rounding (procurement:
  `contracts` ⨝ `awarder_seats` at `tag='contract'`; funds: `fund_projects`; agri:
  `agri_subsidies.total_eur`), and the layer totals are NOT summed anywhere in the file;
- the flow matrix equals the SQL recount cell by cell; row and column sums equal
  `coverage.bothPlacedEur`; the four unplaced buckets plus `bothPlacedEur` equal `totalEur`;
- `bothPlacedEur / totalEur ≥ FLOOR` (the §7 ratchet), and a mutation check — the same recount
  with the contractor join removed yields a strictly larger figure, so a join that silently
  stopped filtering cannot pass;
- `figures.procTotalEur` equals `data/home/hub_stats.json`'s procurement figure; the corpus
  total at `tag='contract'` agrees with it within 0.5%; `coverage.buyerPlacedEur / totalEur
  ≥ 0.98` (the three bases of §3, kept distinct);
- every oblast name in every PG input maps to exactly one code and all 28 codes receive a
  value in each money layer (the §3 map);
- `computedAt` equals the max contract date, never today;
- two consecutive generator runs are byte-identical.

### 11.2 Unit and component

- `flyoverEngine.test.ts` (jsdom, no canvas — it passes a recording `Ctx2D`): projection
  invariants (a point on the target projects to the viewport centre; depth increases away from
  the camera); `stateAt` is continuous at keyframe boundaries and loops; `blend(a, b, 0) === a`
  and `blend(a, b, 1) === b`; the same state renders the same command log twice; every caption
  id resolves to a literal key and no string the engine returns contains Cyrillic.
- `rotation.test.ts`: deterministic for a (day, seed); `?scene=` wins; all three programmes are
  reachable over three consecutive days.
- `HomeFlyover.test.tsx` (jsdom): renders the poster with the reserved box; does not fetch
  until armed; with `prefers-reduced-motion: reduce` stubbed, never calls
  `requestAnimationFrame` and the switch changes the poster `src`; captions render through `t`.
- `flyoverPosters.test.ts`: the three home posters and six article posters exist and decode to
  1000×625.
- `src/entryGraph.test.ts`: the engine and the slot join the forbidden set.

### 11.3 Browser (`tests/perf.spec.ts`, `tests/ui.spec.ts`, `tests/seo.spec.ts`)

- `/` request log: exactly two `home/*.json` before the band arms and three after; zero
  `/api/db/` throughout — a NEW gate; the home plan specified it in §9.3a and it was never
  written, which this plan would otherwise have relied on;
- the flyover chunk's brotli size ≤ 16 KB and it imports no `vendor-*` chunk other than
  `vendor-react`;
- `MAP_FREE_HUBS` unchanged and green;
- `HOME_HTML_MAX_BYTES`, `HOME_MODULEPRELOAD_MAX`, the head budget and both CLS gates for `/`
  stay green with the band mounted, including the slow-JSON CLS variant;
- the article: prerendered body contains all six chapter headings and six poster `<img>`s, has
  a sitemap `<loc>`, a non-redirecting canonical, its own OG image, and exactly one `h1`;
- `distHeadings.data.test.ts` covers the article like every other prerendered page.

## 12. Out of scope, deliberately

- Municipality-level zoom (265 polygons). Canvas would draw it; the DATA is the blocker — the
  arcs' contractor side is 23.5% placed at oblast grain and worse at municipality grain, and a
  zoom that reveals empty municipalities reads as "no contracts here".
- Terrain. A precomputed hillshade raster under the polygons is a later tier; nothing in v1
  forecloses it.
- Year windows (`y:<year>`) in the artifact. Two scopes (`all`, latest `ns`) keep the artifact
  under budget; a year slider belongs to a procurement page, not to `/`.
- Concepts 3, 4, 5, 7 and 8 from the gallery. The elections swing survives as article chapter 6;
  the price map as chapter 5; the block map's role (a static, prerenderable poster) is filled by
  the posters; the split screen and the standalone video-first concept are not built.

## 13. Order of work and deploy

1. Tier 0 (data + geometry + gates) — commit the artifact.
2. Tier 1 (engine + posters + unit tests) — no UI change yet; camera paths are tuned with the
   poster script's single-frame mode (§4), not with a route.
3. Tier 2 (home slot) — `npm run home:flyover-posters` and commit, `npm run bucket:sync:paths
   -- home` then `npm run bucket:gz`, `npm run build` (prerender), `npm run deploy`. Hosting
   only; no `deploy:db`.
4. Tier 3 (contractor placement) — steps 1–4 of §7, each followed by regenerate → commit → sync.
   Cloud: `db:load:tr:pg:cloud` → `db:load:tr-company-place:pg:cloud` when the TR corpus moved.
5. Tier 4 (article) — `npm run sitemap`, OG capture, `npm run build`, `npm run deploy`.
6. Tier 5 (video) — the skill's chain; a draft under `brand/videos/`.

Every publish of the artifact is `db:gen-home-flyover` → `home:flyover-posters` → commit →
`bucket:sync:paths -- home` → `bucket:gz`; `db:check-generated` verifies the live object
byte-for-byte, and the poster gate verifies the posters are not older than the artifact.

## 14. Things that are easy to get backwards

- **The arcs' coverage sentence is content, not a disclaimer.** "€22bn of €94bn has both ends
  placed" is the first thing a reader must see on that programme; hiding it in a tooltip turns
  a partial view into a false one.
- **Do not sum the three money taps**, on the band, in the article or in the video. The
  overlap is real (ИСУН-funded contracts) and the home plan's §5 rule applies.
- **Sofia's column stands at the city, not the МИР centroid**, and Sofia's three МИР polygons
  share one oblast value. The S23 centroid is 10 km south of the city.
- **`computedAt` is the max source date.** A `now` stamp makes two rebuilds differ and lets a
  stalled pipeline look fresh — the feed's rule, restated.
- **The poster is not optional and not decorative.** It is the reserved box that holds CLS at
  zero, the reduced-motion state, the Save-Data state, the prerendered body's image and the
  Suspense fallback. Removing it "because the canvas loads fast" breaks four contracts.
- **`?scene=` must stay out of `usePreserveParams`.** Preserved, it rides onto every tile link
  and every destination gets a parameter it cannot read.
- **The engine may not import with `@/`.** The video project resolves no alias; one alias import
  breaks `npm run video:check` and the render, and nothing in `npm run build` sees it.
- **A `Partial<FlyoverState>` that omits a field INHERITS the previous scene's value** under
  `resolveTimeline` — that is how the accreting canvas works, and it means a video scene that
  wants the arcs OFF must say `arcs: 0` rather than leave the field out.
- **Sofia city has three codes on the input side (`S22` in funds, `S23`/`S24`/`S25` in
  elections and prices, `София (столица)` in every seat table) and one on the money side
  (`SOF`).** The name→code map is the only place that fold may live.
- **Widening the contractor join is a generator change AND a ratchet move.** After each §7 step,
  raise `FLOOR` by hand; a floor left at 0.20 after step 2 lands is a gate that has stopped
  discriminating.
