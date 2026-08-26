# `/persons` search: match name words independently, not as one contiguous substring

## The bug

Searching `/persons` for **"явор стефанов"** does not find **Явор Чавдаров Стефанов**
(Yavor *Chavdarov* Stefanov — Чавдаров is the patronymic, Стефанов the family name), but
*does* find "Явор Стефанов Джоганов" and "Явор Стефанов Стефанов" — two people whose
**second** name literally is "Стефанов".

That is the tell: the search is not word-aware at all. It folds the whole query
(`translit_bg_latin`) and requires it to appear as one **contiguous substring** of the
folded full name. `"yavor stefanov"` is a substring of `"yavor stefanov dzhoganov"` (the
query happens to be a literal prefix) but not of `"yavor chavdarov stefanov"` — the
patronymic sitting in between breaks contiguity. A reader who types first+family name and
skips the patronymic (the natural way most people search) gets nothing, while a reader who
gets lucky and picks a query that happens to be a name-prefix is rewarded with false-easy
hits.

## Where it lives

- **Resource + column**: `persons` (`functions/db_table.js:1100`), column `name`
  (`functions/db_table.js:1121-1128`) — `search: true, searchCol: "name_fold", searchFold: true`.
- **The predicate itself** — `buildWhere`'s `searchFold` arm, `functions/db_table.js:2505-2517`:
  ```js
  const foldArm = (inner) =>
    `${target} ILIKE '%' || replace(replace(replace(` +
    `${inner},` +
    ` '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'`;
  const gi = gParam();
  ors.push(foldArm(`translit_bg_latin($${gi})`));
  ```
  i.e. `name_fold ILIKE '%' || translit_bg_latin($q) || '%'` — one ILIKE, whole query,
  whole name, no tokenization anywhere in this file.
- **`name_fold`'s definition** — `scripts/db/schema/pg/081_person_identity.sql:67-69`:
  `name_fold text GENERATED ALWAYS AS (translit_bg_latin(display_name)) STORED`, where
  `display_name` is the full three-part Cyrillic name. `person_browse_table` (migration 120,
  `scripts/db/schema/pg/120_person_browse.sql:150`) copies it straight through.
- **UI wiring** — `src/screens/persons/PersonsBrowserScreen.tsx:726-733` passes
  `initialSearch={params.get("q")}` into `<DbDataTable resource="persons" .../>`, which is
  this exact `global` free-text filter. Confirmed via
  [PersonsBrowserScreen.tsx](src/screens/persons/PersonsBrowserScreen.tsx:726).
- **`person_search` (migration 126)**, the table behind the top-nav combined search
  (`/api/db/person-search`, `functions/db_routes.js:861-898`), has the *same*
  `name_fold GENERATED ALWAYS AS (translit_bg_latin(name))` shape
  (`scripts/db/schema/pg/126_person_search.sql:24`), but its fuzzy arm uses pg_trgm
  `%>` (`word_similarity`), not `ILIKE '%…%'` — architecturally different, and not
  confirmed to have the identical failure. Not in scope here; see "Follow-ups" below.

## Why this is fixable without an index or migration

`person_browse_table` already carries a trigram index on the fold column —
`scripts/db/schema/pg/120_person_browse.sql:628`:
`CREATE INDEX … ON person_browse_table USING gin (name_fold gin_trgm_ops)`.

Postgres can combine **multiple** `ILIKE '%x%' AND ILIKE '%y%'` predicates on the *same*
gin-trgm-indexed column into a `BitmapAnd` of two per-token bitmap index scans — this file
already documents that exact mechanic for the shliokavitsa `OR` arm at
`functions/db_table.js:2532-2540` ("Both arms here are gin scans on the SAME column, so
the second one joins the first as another index scan"). An `AND` of two selective probes is
if anything *cheaper* than one wide substring scan, not more expensive. No schema change,
no new index, no `db:load:*` step — this is pure query-building code in `functions/`.

## Proposed fix

Add a **new, narrowly-scoped opt-in flag** to the shared DbDataTable search engine —
`searchFoldTokens: true` (name open to bikeshedding) — set *only* on `persons.name` for
this pass. Do **not** touch the generic `searchFold` semantics that every other consumer
(`contractor_rank`/`buyer_fold`, `procurement_settlements`, `tenders`, awarder search, …)
relies on: this file's comments show those consumers are pinned to hand-measured plan
shapes (a 42x and a 178x regression are both recorded from what looked like an equivalent
rewrite — `functions/db_table.js:2324-2340`, `:2451-2459`). A blanket change to `searchFold`
would require re-measuring every one of those resources; a new opt-in flag scoped to one
column requires measuring exactly one.

**Behavior when `searchFoldTokens` is set**, in `buildWhere`'s `searchFold` branch
(`functions/db_table.js:2505`):

1. Split the trimmed raw query `g` on whitespace into tokens; drop empties; cap at a small
   constant (e.g. `MAX_SEARCH_WORDS = 5` — a Bulgarian full name is at most ~4 parts, and
   the cap bounds worst-case cost for a pasted sentence).
2. Keep only tokens meeting the *same* per-token floor the engine already uses elsewhere —
   `termLength(token) >= SEARCH_MIN_CHARS` (reusing `termLength`,
   `functions/db_table.js:2007`, and the existing `SEARCH_MIN_CHARS = 3`,
   `functions/db_table.js:1993`). This is the guard against the measured short-trigram
   scan hazard this file documents at length (e.g. `functions/db_table.js:2349-2373`).
3. **If fewer than 2 qualifying tokens survive** (single-word query, or a query whose extra
   words are all sub-floor), fall back verbatim to today's one-arm `foldArm(translit_bg_latin($g))`
   — i.e. the single most common case (searching by one surname) takes the *exact*,
   already-measured code path, byte-for-byte. This also sidesteps the edge case where a
   query passes the whole-string floor (`"яв ст"`, 5 chars) but every individual token is
   too short to probe safely.
4. Otherwise, fold each qualifying token independently
   (`translit_bg_latin($paramN)`) and **AND** the per-token `foldArm(...)` calls together,
   parenthesized as one group. Word order is irrelevant by construction (a bonus: "Стефанов
   Явор" would also match).
5. The shliokavitsa rewrite (`SHLYO_TRIGGER_RAW`, `functions/db_table.js:2569-2570`) stays
   scoped to the single-token fallback path only, as a deliberate, stated scope-narrowing —
   Latin-typed shliokavitsa spread across multiple space-separated name tokens is a rare
   enough combination to defer rather than risk getting the multi-token interaction wrong on
   the first pass.

This whole AND-group is still just **one** entry in the existing `ors` array
(`functions/db_table.js:2405` / `:2576`), so it keeps OR-ing correctly against the separate,
untouched `institution` substring arm (`functions/db_table.js:1183`).

## Implementation steps (for the follow-up coding session)

1. `functions/db_table.js`: add `searchFoldTokens: true` to the `persons.name` column def
   (~`:1121-1128`), with a short comment pointing at this plan doc / the bug it fixes.
2. `functions/db_table.js`: in the `searchFold` branch (~`:2505-2570`), branch on the new
   flag per steps 1-5 above. Reuse the existing `foldArm` helper (already parameterized on
   an inner SQL expression) rather than duplicating the escape logic.
3. `functions/db_table.test.js`: extend the existing `searchFold` coverage (tests already
   anchor on this shape around `:330`, `:415`, `:537`, `:846-851`, `:1048`) with:
   - a 2-token query on `persons` → assert the built WHERE clause has two `ILIKE` arms
     ANDed together, each independently parameterized and folded;
   - a single-word query on `persons` → assert the SQL is byte-identical to today's
     (regression guard for the fallback path);
   - a query with one qualifying token + one sub-floor token (e.g. `"явор ст"`) → assert it
     falls back to the single-arm path rather than either refusing or scanning on the short
     token;
   - confirm `institution`'s separate arm and the overall `OR` join are unaffected.
4. Local verification against Postgres (`person_browse_table` is populated by
   `npm run db:load:persons-browse:pg`, already run locally per the existing corpus):
   - `EXPLAIN ANALYZE` the 2-token AND directly in psql to confirm it plans as a
     `BitmapAnd` over `idx_person_browse_table_name_fold_trgm` (or whatever the index is
     named) rather than a seq scan;
   - hit the dev server's `/api/db/table?resource=persons&filters={"global":"явор стефанов"}`
     (or drive it through the UI) and confirm "Явор Чавдаров Стефанов" is now returned
     alongside the two pre-existing matches.
5. Manual UI check: `npm run dev`, open `/persons?sector=private`, search "явор стефанов",
   confirm all three Yavors now show up (per the two screenshots the user attached).
6. No PG migration, no `db:load:*:cloud` step, no changelog/`recent_updates` entry — this is
   query-building code in `functions/`, not a data change. Ship with the normal
   `npm run deploy:db` (functions code) once verified; no ordering dependency on any other
   deploy step.

## Explicitly out of scope for this pass

- **Generalizing `searchFoldTokens` to other `searchFold` columns** (contractor/awarder/TR
  officer names, `procurement_settlements`, etc.). Those are mostly organization names
  (no patronymic-shaped "skippable middle word" pattern) and each carries its own measured
  perf profile in this file; a wider rollout is a separate, deliberate follow-up once this
  one is proven, not a bundled change.
- **`/api/db/person-search`** (`functions/db_routes.js:861-898`, the top-nav combined
  search) — same `name_fold` full-name-fold column, but a *different* code path using
  pg_trgm `%>` word-similarity rather than `ILIKE`. Needs its own quick manual check
  ("does `явор стефанов %> yavor chavdarov stefanov` clear the default 0.6
  `word_similarity` threshold?") before deciding whether it has the same bug — not assumed,
  not blocking this fix.
- Any relevance ranking / "best match first" ordering — `persons` has no free-text ranking
  today (plain column sort), so this fix only changes which rows are *included*, not the
  order they're returned in.
