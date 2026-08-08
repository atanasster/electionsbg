# Hub search v1 — one finder per hub, and a shliokavitsa fold that reaches the server

**Status:** IMPLEMENTED 2026-08-08, T1–T5. Live on `/governance/declarations` and
`/parliament`; migration 141 needs applying on Cloud SQL before the `deploy:db` that ships
the routes (see §5 T1 and CLAUDE.md's "applied, never loaded" section).

Three things the plan called for and the implementation deliberately did NOT do, each with
its reason recorded in the commit that decided it:

- **`ProcurementSearchTile` was not migrated onto `HubSearch`** (T2.6). It composes nine
  groups with bespoke per-group rendering and two cross-referencing fetches; the duplication
  the step existed to remove — a second copy of the query/arm/empty-state machinery — went
  with `SectorEntitySearch` either way.
- **The declarations hub has no officials group** (T3.8). Its content, its label and its
  destination were three different sets, and `/officials/assets` does not read `?q`.
- **The parliament hub's topics group has no "see all"** (T4.10). `SessionsIndexScreen`
  reads only `?topic`, so `/votes?q=` is a dead end; nothing lists matching items across
  days.

A dashboard hub is a page whose entire job is to point somewhere else. Every hub today
points with TILES only — a fixed set of curated destinations — so a reader who arrives
knowing *what they are looking for* („Желязков", „бюджет 2026", „моята болница") has no way
to say so. They must guess which tile contains their subject, land on a browser, and search
there.

This plan gives every hub one search box, from shared parts, and closes the one gap that
makes a server-backed box behave differently from a client-side one: **shliokavitsa works in
the browser and does not work in Postgres.**

---

## 0. What already exists — most of this is assembly, not construction

The single most useful finding: **the generic shell is already built and already has three
adapters.** Nothing in this plan needs a new ARIA combobox, a new dropdown, or new keyboard
navigation.

| Piece | Where | State |
|---|---|---|
| Generic "one box, grouped dropdown" shell | `src/ux/search/EntitySearchTile.tsx` | Done — owns the card, combobox/listbox ARIA, keyboard nav, highlight, scroll-into-view, loading/empty. Already exposes `seeAll` per group. |
| Client-side pre-folded index | `src/lib/entitySearchIndex.ts` | Done — build-time fold, rank-ordered, honest truncation |
| Shliokavitsa fold (client) | `src/lib/translitSearch.ts` | Done and mature — `latinSkeleton` + `SHLYO_RULES` + memo + `rankedFilter` |
| Cyrillic→Latin fold (server) | `pg/000_search_fns.sql` `translit_bg_latin()` | Done — **but Streamlined-only, no shliokavitsa** |
| Client-indexed adapter | `screens/components/search/SectorEntitySearch.tsx` | Done — the sector-dashboard box |
| Server-backed adapter | `screens/components/procurement/ProcurementSearchTile.tsx` | Done — people + contractors + buyers + contracts + tenders + funds |
| Ranked person index (server) | `pg/126_person_search.sql`, `/api/db/person-search` | Done — 3 tiers, exact-fold float + trigram fuzzy |

**Which hubs have a box today:** `/procurement` and `/consumption`. **Which do not:**
`/parliament`, `/governance`, `/governance/declarations`, `/governance/sectors`,
`/analysis`, `/indicators`, `/reports`.

So the work is: **generalize the two adapters into one, declare the groups per hub, and fix
the server fold.**

---

## 1. The gap this plan exists to close

`translitSearch.ts` documents it against itself, in its own header:

> It is CLIENT-SIDE ONLY. The server fold (`translit_bg_latin()`) implements the
> Cyrillic→Latin half alone — it has neither these rules nor the ч/х collapse — so a
> server-filtered browser answers the same query differently. Closing that gap is a
> separate, deliberate decision.

This plan is that decision. Measured against the live corpus, 2026-08-08:

| Typed | `translit_bg_latin()` | Hits |
|---|---|---|
| `Желязков` | `zhelyazkov` | 2 ✓ |
| `Zhelyazkov` | `zhelyazkov` | 2 ✓ |
| `Jelyazkov` | `jelyazkov` | 2 ✓ — **trigram tolerance, not the fold** |
| `Jelqzkov` | `jelqzkov` | **0 ✗** |

The failure is precise and worth stating exactly, because it decides the fix's shape: the
`%>` trigram operator already absorbs the *letter-for-letter* variants (`j`→`zh`,
`dj`→`дж`), so the fold looks healthier than it is. What it cannot absorb is the
**substitutions that change the letter count** — `q`→`я`, `6`→`ш`, `6t`→`щ`, `4`→`ч`,
`9`→`я`, `w`→`в`, `x`→`х`. Those are exactly the ones a Bulgarian actually types, and they
return nothing at all.

Any hub search big enough to need the server (declarations: 62,050 people) inherits this.

### 1a. The rule table is NOT portable as written — the ч/х trap

`SHLYO_RULES` targets `latinSkeleton`'s alphabet, which has **already collapsed `ch`→`h`**
(so "арх", "arh" and "arch" all meet). `translit_bg_latin()` does no such collapse: ч→`ch`,
х→`h`, and they stay apart.

So the client rule `4 → "h"` is correct client-side and **wrong server-side** — it would
fold "4erven" to `herven` against a stored `cherven` and match nothing. Copying the table
into SQL verbatim is the obvious move and it is a defect.

The fix is to declare the table against the **Streamlined alphabet** (`4 → "ch"`) and derive
the client's copy from it. One table, two consumers.

**And the derivation collapses each rule's REPLACEMENT, never the finished string.** T1.1
shipped the finished-string version first and it is not equivalent — it also eats `ch`
sequences no rule produced, and because the collapse *deletes* a character the rewritten
needle becomes a subsequence rather than a substring, so it starts **losing** matches
instead of only adding them. Two reachable sources:

- `x → "h"` landing after a literal `c`: `"cx"` → `"ch"` correctly, `"h"` wrongly.
- **`latinSkeleton` itself emits `ch`** — it collapses *before* stripping non-alphanumerics,
  so any `c` and `h` separated by punctuation survive as a pair:
  `latinSkeleton("Basic Holding") === "basicholding"`.

Measured blast radius on the real corpus: ~1 name in 19,189, and every test in the tree
passed. Only the ч rule's `to` contains `ch`, so collapsing replacements reproduces the old
hand-written table exactly — `shlyoRules.test.ts` asserts that against a frozen copy of it
over an exhaustive corpus rather than leaving it as a claim.

---

## 2. Architecture — four shared pieces

### S1. `shlyoQueryFold()` in SQL — query-side only, no reindex, no schema change

```sql
-- pg/1XX_shlyo_query_fold.sql
CREATE OR REPLACE FUNCTION shlyo_query_fold(txt text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ … $$;
```

Three properties are contracts, all inherited from the client module's header:

- **QUERY SIDE ONLY.** Applied to stored data it is simply wrong — a Latin trade name
  "Wow Ltd" would be stored as `vovltd`. Nothing in this plan writes a `*_fold_shlyo`
  column, and no migration reindexes anything.
- **STRICTLY ADDITIVE.** The alternate needle is probed only after the plain one, and its
  hits are appended. It can add results; it can never remove one. Every existing caller of
  `person-search` / `procurement-search` is therefore un-regressible by construction.
- **THE INDEX STILL SERVES.** Only the `$1` side is transformed, so
  `name_fold %> shlyo_query_fold(translit_bg_latin($1))` uses `idx_person_search_fold`
  exactly as today.

`c → ts` stays deliberately absent, for the reason the client module already gives: it would
refold every Latin trade name carrying a `c` (Keytruda, Abemaciclib) away from what the
reader typed. **Do not "complete" this table.**

### S2. One rule table, one generator, one gate

The rules would otherwise exist in TS and in SQL and drift — the exact failure mode the
`dashboard-hub` skill names ("if a number is computed in two places, it will drift").

- Canonical declaration: `src/lib/shlyoRules.ts` (Streamlined-targeted).
- `translitSearch.ts` imports it and keeps its `ch`→`h` post-step.
- `scripts/db/gen_sql/shlyo_query_fold.ts` emits the SQL body from it.
- Gate: the checked-in `.sql` byte-matches the generator's output, **and** a data test runs
  a corpus of ~200 typed variants through both implementations and asserts identical output.
  Not "both return something" — identical strings.

### S3. `<HubSearch>` — one adapter over `EntitySearchTile`, both source kinds

`SectorEntitySearch` handles client indexes; `ProcurementSearchTile` handles server fetches;
neither handles both, and every hub in this plan needs a mix (declarations: server people +
client officials; parliament: client MPs + server topics).

```ts
// src/ux/search/HubSearch.tsx
type HubSearchSource = {
  id: string;
  /** Two labels because scope RANKS (D1): in-scope rows first, out-of-scope second. */
  label: I18nPair;
  outLabel?: I18nPair;
  /** Absent = the source has no scope, so it renders one group. */
  partition?: (row: SearchItem) => "in" | "out";
  /** PER GROUP, not shared — a shared cap is filtering with extra steps. */
  limit?: number;
} & (
  | { kind: "index";  index: EntityIndex | null }
  | { kind: "server"; fetch: (q: string, signal: AbortSignal) => Promise<SearchItem[]> }
);
```

It owns: `MIN_QUERY = 2`, `useDeferredValue` for index sources, a **250 ms debounce +
`AbortController`** for server sources, the arm-on-first-focus-or-keystroke trick
(`SectorEntitySearch` already documents why focus alone is unreliable), the
"searched in: …" empty state, and per-group `seeAll`.

Both existing adapters then become thin callers, or are deleted in favour of it. **Migrating
them is in scope** — leaving three near-identical shells is how the next divergence happens.

### S4. A per-hub registry, beside the tile registry

Pure data, no JSX, mirroring `declarationsRegistry.ts`:

```
src/screens/governance/declarationsSearch.ts   → HubSearchSource[]
src/screens/parliament/parliamentSearch.ts     → HubSearchSource[]
```

A hub's search is then a two-line addition to its screen. This is what makes the pattern
reusable for `/governance/sectors`, `/analysis`, `/reports` later without touching `S3`.

---

## 3. The two hubs in scope

### 3a. `/governance/declarations` — people

| Group | Source | Notes |
|---|---|---|
| Хора с декларация | server, `/api/db/person-search` + a new `decl=1` param | `seeAll` → `/persons?q=…&decl=1` |
| Останали публични фигури | same call, the non-declared remainder | second group, labeled |
| Длъжностни лица | server, same route filtered to the exec tier | `seeAll` → `/officials/assets?q=…` |

**`person_search` has no `has_declaration` column** — verified; its columns are `key, name,
name_fold, tier, position_type, primary_role, party, place_label, top_eik, firms_count,
public_money_eur, has_photo, identity_confidence, href, rank_static`. So this needs one
column added in `126_person_search.sql` and filled by `db:load:person-search:pg`, which
already runs after `db:load:persons-browse:pg` (its source for `has_declaration`).

That loader has **no automatic cloud path** — `npm run db:load:person-search:pg:cloud` is a
hand-run step, and the route degrades a missing table but not a stale one. It goes in the
shipping order below.

### 3b. `/parliament` — MPs and voted topics

| Group | Source | Notes |
|---|---|---|
| Депутати — <NS>-то НС | client index over `useMps()` | ~240 rows; already fetched by the hub's neighbours |
| Депутати — други НС | same index, out-of-scope remainder | second group |
| Гласувани теми — <NS>-то НС | server, new `/api/db/vote-item-search?ns=&q=` | → `/votes/<date>#item-<id>` |

**Measured, so no new index is needed for the scoped case:** a naive
`WHERE ns=52 AND superseded_by IS NULL AND translit_bg_latin(title) LIKE '%…%' LIMIT 8`
costs **182 buffers / 12.6 ms** — `idx_vote_item_ns_date` carries it, and an NS holds only
~1,400–1,900 standing items (avg title 138–149 chars). That is an order of magnitude under
the ~2,000-buffer serving budget. An expression index becomes necessary only if the group is
ever unscoped (16,741 items).

**`superseded_by IS NULL` is mandatory** — CLAUDE.md's rule for every aggregate over
`vote_item`, and here it also prevents a search returning an annulled re-vote as if it were
the standing one.

---

## 4. Decisions

**D1 — SCOPE RANKS, IT NEVER FILTERS. Settled 2026-08-08.**

In-scope hits become the first group; out-of-scope hits a second labeled group („други НС",
„без декларация"). The reader always finds the person or the topic; the scope decides only
what they see first. This keeps `SectorEntitySearch`'s founding principle — "a finder must
find", because „your hospital does not exist" is a far worse answer than „your hospital has
no contracts in this window" — while still honouring the selected parliament.

Four consequences that are easy to get wrong, and that the implementation must carry:

1. **Each source yields TWO groups, not one.** `HubSearchSource` therefore needs a
   `partition?: (row) => "in" | "out"` and two labels, rather than callers hand-rolling the
   split per hub. Building this into `S3` is what stops the second group from being
   forgotten on the third hub.
2. **The per-group limit applies PER GROUP**, so an in-scope group of 8 does not consume the
   out-of-scope budget. Ranking that shares one cap is filtering with extra steps — the same
   trap `rankedFilter` documents, where fold-matches early in source order ate the whole
   budget and pushed 17 real Вълчев entries out of view.
3. **The out-of-scope group renders only when it is non-empty**, and its label must NAME the
   scope it is outside („депутати от други НС"), never „други" — a band called „Още" is the
   defect the hub work already fixed once.
4. **The server sources must rank in SQL, not fetch-then-split.** Ranking once and
   partitioning afterwards silently empties the narrower tier — measured on
   `contested-votes`, where ZERO of a trailing week's rows appeared in a global top-200.
   Each group gets its own `LIMIT`, `UNION ALL`-style, exactly as `person-search` already
   does per tier.

**D2 — Placement: directly under the intro paragraph, above the first `SectionHeading`.**
Adopted as the default; cheap to move, and no hub depends on it.

**D3 — Declarations results do NOT respect the election selector.** `/mp-assets` and
`/mp-cars` open scoped to `?elections`, but `/persons` does not, and the people groups here
land on `/persons`. Lifetime, matching the destination. (This is D1 applied: there is no
in/out partition for these groups because there is no scope to partition on.)

---

## 5. Steps

**T1 — the fold (no UI).**
1. `src/lib/shlyoRules.ts`; rewire `translitSearch.ts` onto it; assert the existing
   `translitSearch.test.ts` is unchanged and still green.
2. `pg/1XX_shlyo_query_fold.sql` + the generator + the byte-match gate.
3. The cross-implementation data test (~200 variants, identical output).
4. Wire `person-search` and `procurement-search` to probe the alternate needle. Verify
   `Jelqzkov` returns Желязков and that every existing query returns a **superset** of
   today's rows.

**T2 — the shell.**
5. `src/ux/search/HubSearch.tsx` (both source kinds, debounce, abort, arm).
6. Migrate `SectorEntitySearch` and `ProcurementSearchTile` onto it; delete the duplication.

**T3 — declarations hub.**
7. `has_declaration` on `person_search` (126 + loader); `decl` param on the route.
8. `declarationsSearch.ts`; mount in `GovernanceDeclarationsScreen`.

**T4 — parliament hub.**
9. `/api/db/vote-item-search` (ns-scoped, `superseded_by IS NULL`, degrade set
   `42P01 · 55000 · 42501 · 55P03`, **never `57014`**).
10. `parliamentSearch.ts`; mount in `ParliamentHubScreen`.

**T5 — generalize.** Document the pattern in the `dashboard-hub` skill (a §14 "every hub
gets a finder"), and note the three hubs left without one.

---

## 6. Gates

| Gate | Catches |
|---|---|
| TS and SQL folds agree over a ~200-variant corpus | The drift this design's two implementations invite |
| Checked-in SQL byte-matches the generator | A hand-edited function body |
| Every server search returns a SUPERSET of its pre-change rows | The additive contract, broken |
| No `*_fold_shlyo` column exists anywhere | The rules applied to the data side |
| `EXPLAIN` buffers under budget on the worst key | A search route that 500s at the 10 s timeout |
| Every `seeAll` target is a routed path | Dead links |
| Every vote-item search filters `superseded_by` | Annulled re-votes surfacing as standing |
| A scoped source returns out-of-scope rows for a query that has them | Scope silently filtering — the D1 regression, invisible because the page still shows results |
| Each group's cap is independent | An in-scope group eating the out-of-scope budget |

Then **break each gate and watch it fire** — per the skill, a gate that shares the
implementation's misunderstanding is not a gate.

---

## 7. What this does not do

- **No crawlability.** The box is client-only and hydrates from an inert input, exactly as
  `SectorEntitySearch` documents. Discovery stays with the prerendered pages and the sitemap.
- **No new corpus.** Every group searches something already loaded and already served.
- **It does not replace the header search.** That is a global, cross-type finder over a Fuse
  index (`src/data/search/`); this is a per-hub finder over that hub's own subjects. They
  answer different questions and share only the fold.
- **It does not touch `c → ts`.** See S1.
