# „Проверка на връзка": second-degree (one-bridge) connections

**Status:** IMPLEMENTED 2026-08-26 (migration 192, the `/api/db/connection` route,
`PersonConnectionCheck`, and three test files). Every path, line, figure and timing below was
read or measured against the live tree and the LOCAL Postgres. §7 records what implementation
changed about the design — read it before trusting a detail in Tiers 1–4.

## 0. The finding this exists to serve

The reader's case, reproduced end to end:

```
Георги Винков Фърцов   — съдружник        →  РАДИО СОТ (7 вписани лица)
ИВАН ДИМИТРОВ НЕДЕЛЧЕВ — управител        →  РАДИО СОТ
ИВАН ДИМИТРОВ НЕДЕЛЧЕВ — член на УС       →  СДРУЖЕНИЕ НА ЧАСТНИТЕ ПРЕДПРИЕМАЧИ … ПАЗАРДЖИК (7 лица)
БЛАГОЙ АНГЕЛОВ АНГЕЛОВ — член на УС       →  СДРУЖЕНИЕ НА ЧАСТНИТЕ ПРЕДПРИЕМАЧИ … ПАЗАРДЖИК
```

Today `Проверка на връзка` answers „не се срещат заедно в нито една фирма" and stops. It is
right — they share no company — and it is unhelpful, because one bridge person joins them and
the site already holds every row needed to say so.

**The block is the right home for this, and that is not obvious.** `person_connections()`
(084) — the graph behind „Кръг от партньори" and `/connections` — carries an
*association-noise guard* that drops a company with more than `MAX_CO_OFFICERS = 6` co-owners
as „a board, not a business tie". Both companies in the chain above have **7** distinct
officer folds in `tr_officers`. So the curated graph is designed never to publish this edge,
while this block's own basis line already promises the opposite: „но за име по ваш избор и
**без изключенията там**". A reader who types a specific name is asking a specific question,
and the honest answer is the evidence, labelled — not a curated refusal.

## 1. What exists now

| piece | file | what it does |
| --- | --- | --- |
| SQL | `scripts/db/schema/pg/008_connections.sql:271` `connection_between(a,b)` | self-join of `tr_officers` on two folded names → the companies where BOTH are entered. **Degree 1 only.** |
| route | `functions/db_routes.js:1758` `connection` | `{ a, b, shared: [...] }` |
| UI | `src/screens/components/procurement/PersonConnectionCheck.tsx` | one input, one fetch, hit-list or the negative-result copy |
| mounted on | `src/screens/dev/PersonScreen.tsx:976` (name-matched page, `politicalAnchor`) and `src/screens/person/PersonProfileScreen.tsx:736` (resolved page, `strictIdentity`) | |
| tests | `PersonConnectionCheck.test.tsx`, `dev/PersonScreen.test.tsx:129` | basis line + negative-result contract |

**The precedent already exists one page over.** `company_person_path(eik, name, depth)` (008,
line 403) is a recursive BFS from a company to a person, rendered by
`CompanyConnectionCheck.tsx` as a „Свързан на 2-ра степен" chain — with the hub cut
(`officer_name_counts.company_count <= 12`) that stops „everyone is connected". This plan is
its person-anchored twin. Copy the shape; do **not** copy the recursion (§3).

`/api/db/connection` has exactly one caller (grep over `src/ scripts/ functions/ ai/`), so the
payload can be extended additively with no other consumer to migrate.

## 2. The measurement that decides the design

All against local Postgres (881,744 `tr_officers` rows, 504,078 `officer_name_counts` folds).
Column statistics are present (`pg_stats` populated); the `pg_stat_user_tables` counters have
been reset, so ignore `n_live_tup = 0` there.

**a. A 2-hop hit is informative, not universal.** 400 random name pairs drawn from folds with
1–12 companies: **0 connected at degree 2.** So a hit means something. (This is the number to
re-measure if the hub cap is ever loosened.)

**b. Cost is bounded and small.** Under `PREPARE` (a generic plan, which is what the pooled
route actually gets):

| pair | time |
| --- | --- |
| the reader's case | 37 ms |
| hub A (292 companies) × common B | 35 ms |
| hub × hub (292 × 285) | 52 ms |
| officer of the largest body in the corpus (773 folds) × common B | 46 ms |
| Пеевски × Борисов (no hit) | 0.8 ms |

**c. The hub cap is what makes it tractable *and* meaningful.** Hub × hub returns **5,216**
bridge rows uncapped; with `COALESCE(company_count,1) <= 12` it returns **5**, in 100 ms.

**d. `COALESCE` is mandatory, not defensive.** 43,761 `tr_officers` rows carry a fold that is
absent from `officer_name_counts` — the exit-only shareholders 008's header describes
(`added_at IS NULL`, stake predating the 2021 feed window). A bare join drops them; they are
ordinary low-risk people and must be admitted at count 1.

**e. `Заличено обстоятелство.` is the single largest fold in the corpus — 4,383 companies.**
It is the registry's deleted-fact placeholder, not a person (CLAUDE.md, `tr_owner_share`). The
hub cap removes it, but do not rely on that alone: exclude it by fold as well, so loosening
the cap later cannot resurrect a 4,383-company „bridge person".

**f. ⚠️ The dominant false-positive class is COURT-APPOINTED professionals.** Uncapped hub ×
hub returned 5 chains and **all five were `liquidator → liquidator → liquidator`** — синдици
appearing in each other's caseload. A liquidator is appointed by a court; nobody chose anyone.
28,709 of 501,972 folds under the hub cap are professional-only
(`liquidator` / `trustee` / `verifier` and nothing else); 24,905 companies carry such an
officer; and the five largest folds in the whole corpus are синдици. Guarding all four legs on
„this role set is not professional-only" removes all five hub×hub chains and leaves the
reader's case **byte-identical**. That guard is Tier 1, not a refinement.

## 3. Degree 2 only — one bridge person, no recursion

`company_person_path` walks to depth 3. Do not.

Measured reachable-company fan-out from the reader's subject, hub-capped:
`7 → 55 → 266 → 1,435` at depths 0/1/2/3 — roughly ×5 per hop, and **847 ms** for the depth-3
walk on an *ordinary* person. A hub subject is far worse, and the pool's `statement_timeout`
is 10 s.

Two independent reasons beyond cost:

- **Degree 3 stops being evidence.** At degree 2 the payload is four registry rows a reader
  can check in the Търговски регистър themselves. At degree 3 it is a claim about a graph.
  0/400 random pairs connect at 2; nobody has measured 3, and the honest prior after a ×5
  fan-out per hop is that it approaches „everyone".
- **The user asked for second level.** Ship that, measure the density of degree 3 separately,
  and only then decide.

A fixed 2-hop join is also *cheaper and more legible* than a recursive CTE bounded at 2: it
lets every leg carry its own roles, which the BFS cannot (it aggregates `MIN(name)` per step).

## Tier 1 — the SQL: `person_person_bridge()` (migration 192)

New file `scripts/db/schema/pg/192_person_bridge.sql`. Nothing else goes in it.

```sql
CREATE OR REPLACE FUNCTION person_person_bridge(a text, b text, p_limit int DEFAULT 25)
RETURNS TABLE (
  bridge_name      text,
  bridge_companies int,     -- officer_name_counts.company_count → namesake risk, rendered
  a_eik text, a_company text, a_subject_roles text, a_bridge_roles text, a_body int,
  b_eik text, b_company text, b_subject_roles text, b_bridge_roles text, b_body int
) LANGUAGE sql STABLE AS $$ … $$;
```

Body, in the shape measured in §2 (the full prototype is in the scratchpad and reproduces the
reader's chain in 37 ms):

- `qa` / `qb` — `translit_bg_latin` of each name. **Both sides folded, exactly as
  `connection_between` does**; this block is name-matched by design and the basis line says so.
- `a_leg` / `b_leg` — each subject's `(uic, roles)` from `tr_officers`, index-served by
  `idx_tr_officers_fold_eq`.
- `bridge` — officers of `a_leg`'s companies, excluding: either subject's own fold, the empty
  fold, the `Заличено обстоятелство.` fold, and `COALESCE(officer_name_counts.company_count, 1) > 12`.
- `pairs` — that bridge's rows in `b_leg`'s companies, with `ob.uic <> oa.uic`.
- **Two exclusions that are not decoration:**
  - `NOT EXISTS (SELECT 1 FROM b_leg x WHERE x.uic = oa.uic)` — a company where BOTH subjects
    already sit is a *direct* hit, already answered by `connection_between`. Without this the
    second-degree list restates the first-degree one. (Measured: this alone takes the
    773-member-body case from a large list to 0 rows, correctly.)
  - the professional-only guard of §2f, on **all four legs**:
    `role_set !~ '^(liquidator|trustee|verifier)(,(liquidator|trustee|verifier))*$'`.
    Write it once as an `IMMUTABLE` helper `tr_role_is_professional_only(text)` in the same
    file rather than four times inline — the 042 `kzk_effective_suspension` precedent. Four
    hand-copies of a predicate is the shape that produced the six-way `magistrate_current`
    duplication.
- `a_body` / `b_body` — `count(DISTINCT name_fold)` of the bridging company. **Returned, not
  filtered on.** It is what lets the UI say „7-членен управителен съвет" instead of letting a
  board read like a two-man firm. Only 316 companies in the corpus exceed 20 officers and
  46 exceed 50, so an upper cap buys nothing that ordering does not.
- `ORDER BY a_body + b_body, bridge_companies, bridge_name` — tightest tie first — then
  `LIMIT LEAST(p_limit, 100)`.

**Who applies it.** `person_person_bridge` reads only `tr_officers` / `tr_companies` /
`officer_name_counts`, so its home is the TR loader: add `192` to `load_tr_pg.ts`'s apply list
beside 003/008/022. That is what makes `db:load:tr:pg:cloud` carry it.

⚠️ **It must be applied BEFORE the `deploy:db` that ships the route** — but the route degrades
(§Tier 2), so this is ordering hygiene, not a breakage. Standalone hatch, and note 008 must
precede it because the function reads the `officer_name_counts` matview 008 owns:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  003_tr_search.sql 008_connections.sql 192_person_bridge.sql
```

⚠️ **Do NOT put this function in 008.** 008 DROPs and recreates `officer_name_counts` as a
matview; a body change to this function must not require rebuilding that matview, and
`migration_drop_dependents.data.test.ts` reasons per file.

## Tier 2 — the route

Extend `functions/db_routes.js`'s `connection` handler. Two queries in one `Promise.all`, the
`company-connection` shape at line 1774:

```js
const [shared, bridged] = await Promise.all([
  dbRows("SELECT * FROM connection_between($1, $2)", [a, b]),
  dbRows("SELECT * FROM person_person_bridge($1, $2, 25)", [a, b]).catch(missingMigrationEmpty),
]);
return { body: { a, b, shared, bridged } };
```

- **`bridged` DEGRADES to `[]`** on `42883 · 42P01 · 55000 · 55P03 · 42501` — a database whose
  TR loader has not yet applied 192 must still answer the first-degree question. Use the
  **logging** variant (`pp:`-style, once per process), not the silent one: a permanently empty
  second degree with nothing in the logs is how `/api/db/mp-management` sat on a stale body.
  ⚠️ **`57014` stays OUT** of that set — it is the pool's own 10 s timeout, and the direct query
  has already been paid for; degrading there would hide a real regression.
- Additive only: `shared` keeps its exact current shape, so the existing UI and both existing
  tests keep passing untouched.

New test file `functions/db_routes.connection.test.js` (the `db_routes.graph.test.js` shape):
both queries issued, `bridged` degrades to `[]` on 42883, `57014` rethrows, a missing `a` or
`b` is still a 400.

## Tier 3 — the UI

`PersonConnectionCheck.tsx`. The component's header block is a specification — extend it, do
not rewrite it.

**When it renders.** Only when `shared.length === 0`. This is the `CompanyConnectionCheck`
rule (`deepPath` is gated on `direct` and `shared` both being empty) and it is right here for a
stronger reason: a direct co-entry *answers the question*, and listing weaker second-degree
chains underneath dilutes a fact with inferences. The extra query still runs — it is 0.8–52 ms
in parallel with a query that must run anyway — so the two-round-trip alternative buys nothing.

**What replaces the negative-result copy.** Today a miss prints two paragraphs. With a bridge
hit, the first paragraph is still true and still leads („не се срещат заедно в нито една
фирма") — then:

> **Свързани през едно лице (2-ра степен)**
> Не са вписани в обща фирма, но едно лице ги свързва. Съвпадението е по ИМЕ и в двата края —
> насока, не доказателство.

and one row per bridge, rendering the whole four-leg chain so the reader can verify it:

```
Георги Винков Фърцов · съдружник
  └ РАДИО СОТ  (7 вписани лица)
      ИВАН ДИМИТРОВ НЕДЕЛЧЕВ · управител
      ИВАН ДИМИТРОВ НЕДЕЛЧЕВ · член на управителния съвет
  └ СДРУЖЕНИЕ НА ЧАСТНИТЕ ПРЕДПРИЕМАЧИ И РАБОТОДАТЕЛИ В ПАЗАРДЖИК  (7 вписани лица)
БЛАГОЙ АНГЕЛОВ АНГЕЛОВ · член на управителния съвет
```

Rules for that block:

- **Every role goes through `trRoleList`** (`src/lib/trRole.ts`). Do not add a fourth private
  copy — its header records exactly this mistake being made twice, once rendering a bare
  `partner,actual_owner` to a Bulgarian reader.
- **Companies link to `/company/:eik`; the bridge person links to `/person/<name>`** — the
  existing pattern in both check components. The bridge name is a raw registry name, so it goes
  to the name-matched page, which is `useNoindex`-marked and says so.
- **Print the officer-body size beside each company.** „(7 вписани лица)" is what stops a
  7-member управителен съвет reading as a two-man company, and it is the only thing on the row
  that distinguishes a real tie from an association artefact.
- **Print the bridge's own company count when it is high** („вписан в 9 фирми") — the same
  namesake signal `foldPeopleN` carries elsewhere on the page. Below ~4, say nothing.
- **`strictIdentity` gets a stronger line.** On `/person/:slug` the surrounding page is
  EIK-exact and this is now *two* name folds deep: the existing „може да сочи съименник"
  becomes „и двата края се съпоставят по име — при връзка през трето лице рискът от съименник
  се удвоява."
- **Keep the „това не значи, че връзка няма" paragraph and the `politicalAnchor` link** in the
  no-bridge case. Nothing about adding a second degree makes the absence claim any safer;
  `tr_officers` still covers a minority of companies.
- **No new i18n keys.** The component uses inline `bg ? "…" : "…"` literals throughout; follow
  it rather than splitting the copy across two conventions.

## Tier 4 — gates

**`scripts/db/tests/person_person_bridge.data.test.ts`** (new, the `.data.test.ts` skip-on-no-PG
convention):

1. **The reference chain.** `person_person_bridge('Георги Винков Фърцов','БЛАГОЙ АНГЕЛОВ АНГЕЛОВ')`
   returns exactly one row, bridge `ИВАН ДИМИТРОВ НЕДЕЛЧЕВ`, via `РАДИО СОТ` (`partner` /
   `manager`) and the Пазарджик сдружение (`ngo_board` / `ngo_board`). This is the user's
   finding, pinned.
2. **The professional-only guard still discriminates** — a mutation check, the
   `tr_owner_share.data.test.ts` shape: re-run the hub×hub pair
   (`Биляна Пламенова Михайлова` × `Снежина Минчева Маджарова`) with the guard removed inside a
   rolled-back transaction and assert it returns strictly more rows (measured 5 → 0). An
   assertion that merely says „0 rows" passes on a function that has stopped returning anything.
3. **The hub cap still discriminates** — same shape, 5,216 → 5.
4. **No direct hit is restated as second degree**: for a pair with a shared company, no returned
   `a_eik` appears in `connection_between`'s result.
5. **The `COALESCE` arm is live**: a fold absent from `officer_name_counts` can still bridge
   (43,761 rows depend on it) — pick one from the corpus rather than a literal.
6. **`Заличено обстоятелство.` never appears as `bridge_name`**, at any pair.
7. **Buffer / latency ceiling** under `PREPARE`, on the hub×hub pair, generously above the
   measured 52 ms — with the anchor pinned to this function's own scan nodes, not to a bare
   `Index Cond` regex (the `tr_owner_share` gate's lesson: `person_roles` also joins on `uic`,
   so a loose regex matches the regressed form too).

**Component tests** — extend `PersonConnectionCheck.test.tsx`:

- a bridge hit renders the chain, both companies, all four roles, and both body counts;
- a bridge hit **still** carries the „не се срещат заедно" sentence — the direct answer is not
  overwritten by the indirect one;
- `shared.length > 0` renders **no** second-degree block even when `bridged` is non-empty;
- `strictIdentity` renders the doubled-namesake warning.

**Route test** — as §Tier 2.

⚠️ **`dev/PersonScreen.test.tsx:138` stubs `/api/db/connection` with `{ shared }`.** The new
code must treat a missing `bridged` as `[]`, or that test fails on a payload shape that a real
older deploy can also produce.

## Tier 5 — publish

Local:

```bash
npm run db:load:tr:pg          # applies 192
npm run test:unit && npm run functions:test
```

Cloud, in this order — nothing here is automatic:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  003_tr_search.sql 008_connections.sql 192_person_bridge.sql
npm run deploy:db              # the route
npm run deploy                 # the UI
```

The cheap `apply_functions.ts` path exists so this does not have to wait for a
`db:load:tr:pg:cloud` — that publish is **34.9 min** and takes a measured reader-visible
`55P03` window on `tr_*` (CLAUDE.md, 003's TRUNCATE note).

⚠️ **EXPLAIN on Cloud SQL before trusting any timing here.** Every figure in §2 is local. The
[[local-pg-has-no-stats]] rule applies to exactly these tables — a local timing has already
been wrong about `tr_*` by four and a half hours once. Run the §Tier 4.7 EXPLAIN against
`127.0.0.1:5434` after applying, with `PREPARE` and not a literal (a literal constant-folds and
hides the generic plan the pooled route actually gets).

## 6. Deliberately NOT in scope

- **Degree 3.** §3. Measure the density first; the fan-out is ×5 per hop.
- **Resolving the subject by `person_id` on `/person/:slug`.** The resolved page could pass a
  slug and ride `person_role`, which would make one end EIK-exact. It would also make the two
  mount points behave differently and split the block's basis line in two. Worth doing as its
  own change, with `person_company_bridge_a` as the licence, not folded in here.
- **Declared stakes (`declaration_stake_company`) as a bridge edge.** The negative-result copy
  already points at „Политически връзки" for that population. Mixing a declaration-derived edge
  into a Търговски-регистър chain would give one row two evidence bases.
- **Any change to `person_connections()` / `MAX_CO_OFFICERS`.** The curated graph's exclusions
  are correct *for a curated graph*. This block exists precisely because a reader can ask
  without them.


## 7. What implementation changed — read this before Tiers 1–4

Six deltas. Four are corrections the plan got wrong; two are findings it did not have.

**a. The direct-hit exclusion is SYMMETRIC.** The plan specified
`NOT EXISTS (… b_leg … = oa.uic)` only. That leaves the mirror case: a chain can END at a
company the FIRST subject is also entered in, i.e. present the direct hit as an indirect one
with a person spliced into the middle. Both arms shipped.

**b. The hub-cap mutation check needs BOTH guards lifted, and the first draft was vacuous.**
With the professional guard ON, the hub × hub pair returns **0 chains either way** — every one
of them is a court appointment — so a cap-only mutation compares 0 against 0 and passes while
measuring nothing. It shipped that way and failed on the first run. Both arms now lift the role
guard, so the cap is the only difference: **5 vs 5,216** (the assertion is written against the
function's own 100-row clamp, so it reads 5 vs 100).

**c. ⚠️ The buffer ceiling is NOT a page count, and the hub cap is NOT what it guards.**
`sumExecutionBuffers` sums every node's `Buffers:` line and Postgres reports them
*cumulatively*, so the figure scales with plan depth as well as work — the shipped body scores
**144,792** where the root node's true total is 7,581. That is the convention every sibling
gate is calibrated in, so this one stays in it rather than forking the shared instrument.
Measured, **lifting the hub cap scores 144,768 — identical to shipped**, because the extra
bridges are pruned by the role guard before they cost anything. So the ceiling's discrimination
control is `enable_indexscan/bitmapscan/indexonlyscan = off` (a transaction-local GUC — **not**
`DROP INDEX`, which would take an AccessExclusiveLock on `tr_officers` while ~16 vitest workers
query the same database). The cap is guarded by the row-count test; the ceiling guards the PLAN.

**d. ⚠️ Measure the route's plan through the POOL, not through psql — and `PREPARE` is not
enough either.** A psql literal constant-folds; `PREPARE` + fewer than five `EXECUTE`s still
gets a custom plan. The 0.8–52 ms figures in §2 are custom-plan timings and stand, but the
plan the gate actually measures came out an order of magnitude different on the same query
purely through node-postgres's extended protocol. Any future cost claim here wants the
node-side EXPLAIN.

**e. ⚠️ A BRIDGE IS NOT ALWAYS A HUMAN — measured, and deliberately left alone.**
`tr_officers` carries no person/entity flag: **7,941 officer folds (0.9%) also name a company**
in `tr_companies`, so a firm on two boards is an ordinary bridge row. Not filtered and not
flagged, for three reasons — a corporate bridge is a real and often stronger tie; the exact
test is unaffordable (`tr_companies` has only a GIN **trigram** index on `name_fold`, so one
equality probe is **321 buffers / 59 ms**, ~1.5 s across 25 bridges); and the heuristic
alternative is 024's regex, which is one of the exclusions this block exists to operate
without. The visible consequence is that the UI links a corporate bridge to `/person/<name>`,
which resolves to nothing — **pre-existing behaviour** shared with `company_connection()` and
`PersonAssociatesTile`, not introduced here. The fix, if it is ever wanted, is a btree on
`tr_companies(name_fold)` plus a `bridge_is_entity` column; it is not in this change.

**f. The component's injectable prop is `fetchCheck`, not `fetchRows`** — it now returns
`{ shared, bridged }`. `dev/PersonScreen.test.tsx`'s global-`fetch` stub is untouched and still
passes, because the live path reads `j?.bridged ?? []`.

### Where the code landed

| tier | file |
| --- | --- |
| SQL | `scripts/db/schema/pg/192_person_bridge.sql` (`person_person_bridge`, `tr_role_is_professional_only`) |
| applier | `scripts/db/load_tr_pg.ts` — after 008 and the `officer_name_counts` refresh |
| route | `functions/db_routes.js` — `connection` now returns `bridged`; `BRIDGE_LIMIT = 25` |
| UI | `src/screens/components/procurement/PersonConnectionCheck.tsx` |
| gates | `scripts/db/tests/person_person_bridge.data.test.ts` (11), `functions/db_routes.connection.test.js` (6), `PersonConnectionCheck.test.tsx` (17) |

Both mount points get the feature with no change of their own — the component is shared.
