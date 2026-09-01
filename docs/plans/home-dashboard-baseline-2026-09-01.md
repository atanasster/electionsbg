# Home dashboard — pre-cutover baseline

**Captured:** 2026-09-01, Phase 0 of
[home-dashboard-implementation-v1.md](./home-dashboard-implementation-v1.md).
**Measured against:** `dist/` built 2026-09-01 10:12, i.e. BEFORE any phase of this plan
touched the root route. Every later phase re-measures against these numbers and records the
delta rather than re-ratcheting silently.

---

## 1. The root HTML budget — and the unit it is actually in

⚠️ **`HOME_HTML_MAX_BYTES` is not measured in bytes.** `tests/perf.spec.ts` asserts
`html.length` on the response text, which is JavaScript string length — **UTF-16 code
units**. The distinction is not academic on a Bulgarian page: the same file is

| measure | value |
| --- | --- |
| `wc -c` (bytes on disk / on the wire) | **22,262** |
| `html.length` (what the gate compares) | **17,624** |
| `HOME_HTML_MAX_BYTES` | 18,000 |
| **headroom the gate sees** | **376 units** |

So the constant's name over-states the room by ~4.6 kB, and anyone sizing new copy against
"18 kB minus 22 kB" would conclude the gate is already red when it is not. It is not red —
but 376 units is roughly two short Bulgarian paragraphs, and §11.1 of the plan adds a body
covering the pulse, eight destinations, the change feed and the source methodology, plus an
`ItemList` and per-corpus `Dataset` nodes.

**Conclusion for Phase 2: this budget WILL trip, and re-ratcheting it is expected work, not a
failure.** Record the new measurement beside the constant with the same two units, so the next
reader is not misled the same way.

Where the current 17,624 sits:

| block | units |
| --- | --- |
| `#ssg-content` (the prerendered body) | 10,758 |
| JSON-LD (`WebSite` 271 + `Organization` 250 + `Dataset` 1,144) | 1,665 |
| everything else (head, preload hints, hreflang, shell) | ~5,201 |

The `Dataset` node is the single largest JSON-LD block and is the one §11.1 replaces.

## 2. Module preloads — no headroom at all

`HOME_MODULEPRELOAD_MAX = 7`, and the built shell already emits **7**: `vendor-react`,
`vendor`, `vendor-i18n`, `vendor-query`, `vendor-radix`, `vendor-search`, plus the entry.

The home route must therefore add **no** new static import to the entry graph. §14.5's
entry-graph rule and `src/entryGraph.test.ts` are the mechanism; this is the number that says
there is no slack to absorb a mistake.

## 3. Critical-path brotli

| chunk | brotli |
| --- | --- |
| `index-DXwao6qL.js` (entry) | 54,738 |
| `vendor` | 125,368 |
| `vendor-react` | 66,799 |
| `vendor-radix` | 37,168 |
| `vendor-query` | 24,190 |
| `vendor-i18n` | 15,825 |
| `vendor-search` | 5,607 |
| **total** | **329,695** |

## 4. Locale corpus

| | raw | brotli (q11) | built chunk |
| --- | --- | --- | --- |
| bg | 713,862 | 121,627 | 121,050 |
| en | 469,359 | 106,175 | 105,329 |

Phase 0 added 9 keys per language (the alert-kind labels and the alerts vintage line); the
brotli figures above are AFTER that addition, so they are the honest starting point for §10's
bundle decision.

⚠️ **The bg corpus is 15% larger than en in brotli terms and 52% larger raw**, so a bundle
split saves materially more on bg. That is the number §10's measurement should be weighed
against — not the raw sizes, which over-state the gap because Cyrillic is two bytes a
character before compression and roughly one after.

## 5. JSON-LD block count

The built root emits exactly **3** blocks, which is what `tests/seo.spec.ts`'s
`home page declares 3 JSON-LD blocks (WebSite + Organization + Dataset)` asserts with a
literal `toBe(3)`. §11.1 changes this set, so that test changes with it — the audit flagged
it because the failure would present as an unrelated SEO regression.

## 6. Alerts feed, before Phase 0's repair

- `scripts/myarea/build_alerts.ts` emitted **8** kinds; `MyAreaAlertKind` declared **7**.
  `open_call` rows rendered through `ICONS[e.kind] ?? Activity` and `COLOR[e.kind] ?? "#888"`
  — a generic grey row, at a 200, with TypeScript asserting the kind could not occur.
- `useMyAreaAlerts` used `staleTime: Infinity`, so an open tab served the same events until
  reload on the one surface whose entire value is recency.
- ⚠️ **The app-wide client (`src/data/queryClient.ts`) sets `refetchOnWindowFocus: false`,
  `refetchOnReconnect: false` and `gcTime: Infinity`. A per-query `staleTime` therefore does
  NOT on its own refresh an idle open tab** — it is a permission, not a trigger: it only stops
  React Query refusing a refetch that something else has already asked for. Lowering it fixes
  the navigate-away-and-back case (via the default `refetchOnMount`) and nothing more. Any
  freshness claim in a later phase must name the trigger it relies on, not just the stale
  time. Phase 0 opts this one query into `refetchOnWindowFocus` and a `refetchInterval`
  (`refetchIntervalInBackground: false`); it does not change the global defaults, because the
  rest of the app really is static per session.
- The tile displayed **no** kind label of any sort: the icon and its hue were the only signal,
  so a screen reader got nothing and a colour-blind reader got a shape.

All three are repaired in this phase. The numbers are recorded because "the feed looks the
same afterwards" is the expected outcome for a reader who is not using a screen reader, and a
future reviewer should be able to see what actually changed.
