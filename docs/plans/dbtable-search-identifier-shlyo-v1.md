# DbDataTable search — identifiers, a length floor, and shliokavitsa (v1)

Three changes to the shared server-side table engine (`functions/db_table.js`), landing
first and only on `/procurement/contractors` (`contractor_rankings` → `contractor_rank`,
migration 122). No migration, no loader, no new index.

    A  route by query SHAPE instead of OR-ing an identifier arm into the name search
    C  floor the trigram arms at 3 characters
    B  add a shliokavitsa second gin arm, gated on the trigger characters

All three are engine-generic; the contractors registry entry is the first subscriber. The
order above is the order they were designed in, **not** the order they ship — see §7.

---

## 1. Where this starts

`contractor_rankings` declares exactly one searchable column:

```js
name: { type: "text", sort: true, search: true, searchCol: "name_fold", searchFold: true }
```

which emits `name_fold ILIKE '%' || translit_bg_latin($n) || '%'` against
`idx_contractor_rank_fold` (gin_trgm), inside the `OFFSET 0` fence. `eik` is `filter:"eq"`
only — never searchable. Nothing in `db_table.js` knows about `shlyo_query_fold` (141);
that function is wired only into the bespoke `db_routes.js` search endpoints.

The relation is a **14.6× fan-out — 432,228 rows over 29,615 distinct EIKs** (scope ×
contractor × CPV division), so the 21 MB trigram index holds 29.6k distinct names about
fifteen times over.

### 1.1 Measured baseline

Local, warm, `SET plan_cache_mode = force_generic_plan` + `PREPARE`/`EXECUTE` — i.e. the
plan shape a deployed parameterized query actually gets. A psql test with a **literal**
term constant-folds, the planner estimates through pg_trgm, and every row below looks
fine; that trap is what
[[reference_dbtable_search_orderby_fence]] was written about and it applies unchanged here.

| query | plan | buffers | ms |
|---|---|---|---|
| `софарма` — today | BitmapAnd(key, gin fold) | 255 | 2.7 |
| `апи` (3 char) — today | same | 257 | 3.9 |
| `строй` (1,828 hits) — today | same | 729 | 10.6 |
| **`ст` (2 char) — page query** | gin returns **all 432,959** | **3,447** | **359–490** |
| `ст` (2 char) — count query | same | 3,441 | 249 |
| `103267194` — today | matches nothing | 228 | 1.7 |
| name `OR` eik-prefix arm | **gin abandoned for the whole predicate** | 704–722 | **114–126** |
| eik-prefix arm alone (parameterized pattern) | full partition scan | 704 | 4.8–12.6 |
| **`eik = $n` exact** | `Index Cond` on all three key columns | **4** | **0.35** |
| name `OR` shlyo-rewrite (`6ipka`) | **BitmapOr of two gin scans** | 310 | 10.4 |
| dimension semi-join via `contractor_search`, `софарма` | Hash Semi Join | 756 | 5.4 |
| dimension semi-join, `ст` | Hash Semi Join | 1,737 | 225 |

### 1.2 The key universe it has to serve

`SELECT count(DISTINCT eik) FROM contractor_rank`, by shape:

| shape | n |
|---|---|
| `^[0-9]{9}$` | 27,531 |
| `^(obed\|ph\|np)-[0-9a-f]{12}$` | 1,803 |
| other all-digit (lengths 3,4,6,7,8,10,11,12,14) | 144 |
| neither | 137 |

Zero 13-digit contractors today. The synthetic three are the consortium / filler /
natural-person carriers `scripts/procurement/supplier_identity.ts` mints, and they are
**printed in the table** — row 4 of the current page is `obed-3c76d4088cb9` at €70.4M — so
they are as pasteable as an EIK and equally unfindable.

---

## 2. The three defects

**2.1 — The page prints an identifier it cannot find.** Every row shows the EIK beside the
name. Typing or pasting it returns nothing, at a 200, with no indication that the column
simply is not searched. This is the correctness half of the work.

**2.2 — A sub-3-character query is a full 432,959-row GIN index scan, twice.** pg_trgm
extracts no trigrams from a 1–2 char pattern, so the index scan degenerates to a full scan
and returns every row in the matview before the BitmapAnd narrows it. It costs ~3,440
buffers on the page query **and again** on the count query. `DbDataTable` debounces 250 ms
but has **no minimum length**, so a user typing `строй` pays it on the way. Locally 2,662
of those blocks came off disk; prod is a `db-g1-small` read cold over the proxy under a
10 s `statement_timeout`, which is where the exposure actually lives.

**2.3 — Shliokavitsa returns nothing.** `translit_bg_latin` folds Cyrillic→Streamlined
Latin on both sides, so `sofarma` finds `СОФАРМА`. What it cannot reach is the Latin-side
spelling a Bulgarian types — `6ipka`, `4erven`, `jelezopyten`, `plowdiw`. `6ipka` returns
0 rows today and 85 with the rewrite.

---

## 3. The trap that decides the whole design

**Adding an EIK arm as a second OR term is a 42× regression on the common case.** Measured:
with `(name_fold ILIKE … OR eik LIKE …)` the planner stops using `idx_contractor_rank_fold`
**for the entire predicate** and scans the full 29,615-row scope partition applying both as
row filters. `софарма` goes 2.7 ms / 255 buffers → 114 ms / 704 buffers, to serve a case
that shares no rows with it.

That is the general fact this plan is built on: **an EIK never matches a name and a name
never matches an EIK, so the two must be ROUTED, never OR-ed.** The shliokavitsa arm is the
opposite case and proves the rule is about the index rather than about OR — both of its arms
are gin scans on the same column, so they plan as a BitmapOr *inside* the existing BitmapAnd
and cost 55 extra buffers.

Two corollaries that are easy to get backwards:

- **Prefix is not a cheaper equality.** `eik LIKE $n || '%'` alone is still 704 buffers,
  because the planner's pattern→range transform (`prefix_quals`) needs a `Const` pattern and
  a bound parameter is not one under a generic plan. `eik = $n` is 4 buffers because
  equality on the third column of `idx_contractor_rank_key` is an ordinary index cond once
  `scope_key` and `division` are equality-filtered. **The identifier arm must be equality.**
- **The fan-out looks like the problem and is not.** Resolving the query against a
  per-EIK dimension (`contractor_search`, 29,638 EIKs) halves the 2-char case and *triples*
  the selective one — the hash build materialises the whole scope partition. See §10.

---

## 4. Tier A — route by query shape

### A1 · Registry surface (`functions/db_table.js`)

Two new column-descriptor keys, both registry-sourced and never user input:

```js
/** Emit `col = $n` instead of a LIKE/trigram arm. For identifier columns whose
 *  equality is index-served. Mutually exclusive with searchFold/searchText/
 *  searchPrefix/searchInSet. */
searchEq: true,
/** A source regex (string). This column's arm participates ONLY when the term
 *  matches. See the routing rule in A2 — this is not a filter, it is a router. */
searchWhen: "^[0-9]{8,14}$|^(obed|ph|np)-[0-9a-f]{6,32}$",
```

### A2 · The routing rule

After `globalCols` restriction and before any arm is built:

```
routed = active defs whose searchWhen matches the term
active = routed.length ? routed : (active defs with NO searchWhen)
```

A column with `searchWhen` is a **specialist** — it claims the term or stays silent. A
column without one is the **fallback set**, used only when no specialist claimed it. So
`name` needs no change at all: an EIK-shaped term is claimed by `eik` and the name arm is
not emitted; anything else falls through to `name` exactly as today.

**⚠️ If `active` ends up empty, emit `FALSE` — never nothing.** Dropping the arm makes the
search match the **entire corpus**, which is precisely the failure the existing `globalCols`
validation comment warns about ("a typo would silently drop the whole search arm and match
the entire corpus"). The reachable path is a caller who restricts `globalCols` to `["eik"]`
and sends a non-identifier term.

### A3 · The subscriber

```js
eik: {
  type: "text", sort: true, filter: "eq",
  search: true, searchEq: true,
  searchWhen: "^[0-9]{8,14}$|^(obed|ph|np)-[0-9a-f]{6,32}$",
},
```

`8..14` rather than `9|13`: it also covers the 144 odd-length numeric ids
`supplier_identity.ts`'s header calls unclassifiable offline, and no contractor NAME is an
8+ digit run. `2000` and `2024` stay under the floor and keep going to the name arm, which
is what „Невен 2000" and „Метро Люлин 2024" need.

### A4 · Traps to write into the code

- `searchEq` binds the **raw** term. No `likeEscape`, no `translit_bg_latin` — it is an
  equality, and folding it would be wrong for `obed-…` keys.
- Routing runs **after** `globalCols` restriction, so a restricted caller cannot be handed
  an arm it excluded.
- A shape-valid EIK that is not in this scope returns 0 rows. That is the right answer and
  must not be "helpfully" widened back to a name search — a fallback would resurrect the
  OR cost on every identifier query.

---

## 5. Tier C — floor the trigram arms at 3 characters

### C1 · Engine (the authority)

`SEARCH_MIN_CHARS = 3`. An arm of kind `searchFold` / `searchText` / plain-ILIKE is only
emitted when `g.length >= SEARCH_MIN_CHARS`. `searchEq` and `searchPrefix` arms are exempt —
they are index-served at any length.

**If the floor leaves no arm at all, throw `DbRequestError` (400), do not return 0 rows.**
The corpus has 6,462 rows matching `ст`; answering "0" would be a wrong answer served at a
200, which is the one outcome worse than the slow query being fixed. A 400 cannot be
misread.

### C2 · Client (so the 400 is never reached)

`DbDataTable` gains `searchMinChars` (default 3): below it, `global` is not put in the
request and a hint replaces the row count. `?q=` seeds are subject to the same check, so a
`?q=ст` deep link shows the hint rather than an error.

**The integer 3 is therefore written twice** — `functions/` is a separate CJS package that
cannot import from `src/`, the same constraint that already forces `SHLYO_KEYBOARD` to be a
hand-mirrored copy in `db_routes.js`. This duplication is safe in one direction only: if the
client floor is ever lowered below the server's, the user sees an error state, not a wrong
count. Say so in both comments.

### C3 · Traps

- **C must be evaluated after A's routing**, or a 9-digit EIK would be measured against a
  floor that has nothing to do with it. (It passes either way at 8+ digits; the ordering
  still has to be right, because a future resource may route a 2-character code.)
- The floor is on the **raw** term, not the shliokavitsa rewrite. `6u` rewrites to `shu`,
  which is indexable, and is refused anyway. Deliberate: one rule, stated once, and `6u` is
  not a query anyone types.
- Both the page query and the count query are built from the same descriptor, so the floor
  reaches both. Verify, do not assume — they are separate builders.

---

## 6. Tier B — the shliokavitsa arm

### B1 · Where the trigger lives

`SHLYO_TRIGGER_RAW = /[469qjwx]/i` currently sits in `db_routes.js`, which `require`s
`db_table.js` and not the other way round. **Move it into `db_table.js`, export it, and have
`db_routes.js` import it** — one definition, correct dependency direction.

**⚠️ It is NOT `SHLYO_TRIGGER` from `src/lib/shlyoRules.ts`.** The client's trigger includes
`y(?![aeiou])`; the server's deliberately does not, and `db_routes.js` documents why at
length: `translit_bg_latin` itself emits `y` for й and ь, so „Бойко Борисов" folds to
`boyko borisov` and would rewrite to `boako borisov`. 13.64% of 539,985 indexed names
rewrite under the wider trigger and 97.4% of those carry no shliokavitsa character at all.
The client tolerates it because its probe is a substring test; the server's is fuzzy trigram
similarity, so a nonsense needle matches plenty. Copying the client trigger here injects
rows the reader never asked for.

### B2 · The arm

For a `searchFold` column, when `SHLYO_TRIGGER_RAW.test(g)`, add a second OR term beside the
plain fold arm:

```sql
OR name_fold ILIKE '%' || replace(replace(replace(
     shlyo_query_fold(translit_bg_latin($n)),
   '\','\\'), '%','\%'), '_','\_') || '%'
```

Same SQL-side escaping as the existing fold arm, and for the same reason: the needle is
produced by `translit_bg_latin` server-side, so a JS-side escape would be undone by the
transliteration. Same bound parameter — no second placeholder.

Measured: `6ipka` plans as a BitmapOr of two gin scans inside the BitmapAnd, 310 buffers /
10.4 ms, and returns 85 rows the plain probe returns 0 for.

### B3 · The 141 dependency, and why the gate makes it acceptable

`shlyo_query_fold` is migration 141, applied by `db:load:person-search:pg[:cloud]` and by
`apply_functions.ts`. In-lined into the predicate, a database without it raises **42883 for
the whole query**.

`db_routes.js` solves this with a separate round trip whose failure yields `null`. That
pattern **does not transplant here**: `DbDataTable` is a paginated table whose count,
aggregates and page must come from one predicate, so a merge-the-tail approach would make
the total disagree with the rows. Its three stated reasons split, and only one survives —
cost and latency are already answered by the trigger gate (a query with no trigger character
emits no arm at all), while degradation is not.

What makes the residual risk acceptable is the gate's blast radius: the arm is emitted
**only** for terms carrying `[469qjwx]`, so on a database missing 141 exactly the
shliokavitsa queries fail and every ordinary search is untouched. Add a presence assertion
to the data gate (§8) so the state is named rather than discovered.

The alternative, recorded so it is not re-derived: emit a fourth generated artifact
(`functions/shlyoRules.js`, from `scripts/db/gen_sql/`) and fold in JS, binding a plain
second parameter — zero DB dependency. Rejected for now because 141's header states the
argument must be **already folded** by `translit_bg_latin`, and the JS side does not have
that; the two converge only because `translit_bg_latin` lowercases afterwards, which is an
assertion needing its own parity gate rather than something to assume. Revisit if a serving
database is ever expected to lack 141.

### B4 · Scope limit

`searchFold` arms only. `searchText` columns (contract title, tender subject) go through
`fold_prefix_tsquery` and would need a differently-shaped rewrite; out of scope, and stated
in the code so the omission reads as a decision.

---

## 7. Order of work

**C → A → B.** C first because it removes the only measured hazard and shrinks the surface
the other two are measured against; A second because it is the correctness gap and needs the
routing rule C's guard is ordered around; B last because it is purely additive and its gate
depends on both.

Each tier is independently shippable and independently green.

---

## 8. Gates

**`functions/db_table.test.js`** — SQL-shape assertions, no database:

1. an identifier term emits `eik = $n` and **no** `name_fold` arm;
2. a name term emits the fold arm and **no** `eik` arm;
3. `globalCols: ["eik"]` + a name term emits `FALSE`, never an empty predicate;
4. a 2-char term throws `DbRequestError`; a 9-digit term at any length does not;
5. the floor reaches the count builder as well as the page builder;
6. the shlyo arm appears **iff** the term matches `[469qjwx]`, and carries the same escape
   wrapper as the plain arm;
7. every descriptor with `searchEq` has neither `searchFold` nor `searchText` nor
   `searchPrefix` nor `searchInSet`, and every `searchWhen` compiles — the registry-shape
   style the existing `searchInSet` well-formedness test already uses.

**`scripts/db/tests/contractor_search_arms.data.test.ts`** — new, Postgres, `skipIf` on
reachability like its neighbours:

8. `shlyo_query_fold` exists (`to_regprocedure`), reported as its own named failure;
9. buffer ceilings under **`SET plan_cache_mode = force_generic_plan` + `PREPARE`** — a
   literal-term test constant-folds and passes against the broken shape, so a gate written
   that way proves nothing. Proposed: identifier ≤ 50, selective name ≤ 400, shlyo ≤ 600;
10. **a mutation check** — restore the OR-ed identifier arm inside a rolled-back transaction
    and assert it *breaks* the ceiling. Following `person_connections.data.test.ts`, which
    "proves it still discriminates by restoring the old body". Without this, ceilings that
    two implementations both satisfy prove nothing;
11. **non-vacuity** — a real corpus term with a trigger character returns more rows with the
    shlyo arm than without. Pick it by querying the corpus, not by hand, so it survives a
    reload.

**`src/ux/data_table/DbDataTable.test.tsx`** —

12. a sub-floor term is not sent and renders the hint; the floor also applies to
    `initialSearch`.

---

## 9. Deploy

No migration, no loader, no index. `functions/db_table.js` + the client bundle.

Verify 141 on the serving database first:

```bash
psql "$DATABASE_URL" -c "SELECT to_regprocedure('shlyo_query_fold(text)');"
```

NULL → apply it before shipping B:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 141_shlyo_query_fold.sql
```

Then, because both the bundle hash and the function move and no NEW `/api/db` route is
involved, the CLAUDE.md three-step applies:

```bash
npm run deploy                    # hosting live with the new bundle
npm run deploy:db                 # fresh instances fetch the CURRENT shell
SKIP_PREDEPLOY=1 npm run deploy   # purge the edge entries step 2 could not
```

---

## 10. Explicitly out of scope, with the measurement that rules each out

- **A per-EIK dimension semi-join.** `contractor_search` (29,638 EIKs) as an `IN (SELECT …)`
  halves the 2-char case (3,447 → 1,737 buffers) and **triples** the selective one
  (255 → 756), because the hash build materialises the whole scope partition. The 14.6×
  fan-out is not the bottleneck; the sub-3-char pattern is, and C removes it for nothing.
- **EIK prefix search.** 704 buffers against 4 for equality, for a case nobody has: an EIK
  is pasted whole. §3 has the planner reason.
- **Name-variant recall.** `contractor_search` holds **45,777 name variants over 29,638
  EIKs**, so a contractor appearing in the corpus under a former name is findable in the
  combined-search dropdown and not in the leaderboard, which searches only the canonical
  (TR-preferred) name. Closing it means a second indexed fold and a decision about whether a
  leaderboard should match a name it does not display. Own plan.
- **`searchText` columns getting the shlyo arm** (§B4).
- **`c → ts`** in the rule table — deliberately absent upstream; do not "complete" it.

---

## 11. Risks

- **Every number here is local and warm.** Prod is a `db-g1-small` read cold over the proxy.
  The ranking of the options is what generalises; the absolute figures do not. Re-measure
  the A and C ceilings against Cloud SQL before trusting the numbers in §8.
- **The generic-plan caveat is the whole game.** Any new arm added later must be measured
  under `force_generic_plan`; a psql literal hides exactly the pathology in §3.
- **`searchWhen` is a new registry concept and a router, not a filter.** A descriptor that
  reads like a filter invites someone to use it to *restrict* results, which would silently
  narrow a search rather than route it. Name and comment it accordingly.
