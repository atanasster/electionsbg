# Repoint the serving surfaces onto `declaration.filed_position` / `filed_institution`

**Status:** planned, not started. **Measured:** 2026-08-16, local Postgres :5433.

## 1. What the corpus actually says

⚠️ **Re-measured 2026-08-17. The 2026-08-16 table this plan was written against is
superseded** — `backfill_filed_position.ts` finished in between, so the coverage the brief
described (exec 2.8%, muni 0%) no longer holds anywhere.

```
 tier  | filings | filed_pos | filed_inst | listing_pos
-------+---------+-----------+------------+-------------
 exec  |   48834 |     48831 |      48832 |       48834
 mp    |    6296 |      6296 |       6296 |           0
 muni  |    6613 |      6613 |       6613 |        6613
 TOTAL |   61743 |     61740 |      61741 |       55447
```

61,740 of 61,743 filings carry a `filed_position`; the 3 exceptions are filings whose
`<Position>` the register itself leaves empty. Of the **55,444** rows carrying both a filed
and a listing position, **36,199 disagree exactly (65.3%)** and **21,906 still disagree once
case and whitespace are folded (39.5%)** — exec 20,583 of 48,831 (42.1%), muni 1,323 of 6,613
(20.0%). The mp tier has no listing position at all, so `filed_position` is its only source.

**Decision: `COALESCE(filed_x, listing_x)` at every serving site — but the reason has moved.**
On this database a straight swap would now blank only **3** rows, so the original "blanks
87.6% of the officials surfaces" argument is spent. What keeps the fallback load-bearing is
structural rather than statistical, and it is about the other databases: **Cloud SQL has
neither these columns nor any backfill**, and a fresh clone, a partial reload, or a filing
ingested since the last crawl are the same shape. With `filed_*` NULL every caller degrades to
exactly the label it serves today, which is what lets all nine files ship ahead of any crawl.

This still diverges from the reference implementation `scripts/person/compare_declarations.ts:579`,
which uses `filed_*` with **no** fallback and argues for it ("no role on the card is a gap a
reader can see, while a wrong one is a claim they cannot check"). Right for a hand-reviewed
card about one named person; wrong for a browse table that must render on an unbackfilled
database. Different surface, different call.

## 2. The site list is wrong in both directions — corrected

A full sweep of alias-qualified `declaration` reads across `scripts/db/schema/pg/*.sql` and
`functions/*.js` found **three false positives and one missed site**.

### FALSE POSITIVES — do not touch (different column entirely)

`mp_profile.position_title` is the **parliament.bg roster role**, written by
`scripts/db/load_mp_roster_pg.ts:296`, not by the declarations loader. Live values:

```
 член | 221 · парламентарен секретар | 12 · зам.-председател на НС | 6 · Председател на НС | 1
```

Repointing any of these at a declaration field would be a regression:

- `functions/db_routes.js:5275` — `'position', position_title` inside `FROM mp_profile`
- `scripts/db/schema/pg/104_mp_roster.sql:85` — the `mp_profile` column definition
- `scripts/db/schema/pg/105_mp_serving.sql:332` — `t.position_title`, `t` = `mp_profile`

### MISSED SITE — add

- `scripts/db/schema/pg/120_person_browse.sql:321-324` — `person_browse_table.institution`
  is `DISTINCT ON (d.person_id) d.institution` over the exec/muni tiers. This is the
  `/persons` browser, one of the largest reader-facing surfaces, and it is not in the brief.

### IN SCOPE — confirmed declaration reads

| file:line | object | tier filter | effect today |
|---|---|---|---|
| `090_person_wealth.sql:471,504,600` | fns `person_wealth_series`, `person_declarations`, `declaration_detail` | none | `/person` profile — mp rows gain a position they lack today |
| `093_declaration_events.sql:45,77` | declaration events | none | same |
| `098_new_filings.sql:53` | new-filings feed | none | same |
| `100_officials_rankings.sql:180,193,194` | matview `officials_rankings_table` | `exec,muni` | newest-filing label changes for a large share of rows |
| `102_municipal_officials.sql:61,76,85,95,97` | matview `municipal_officials_table` | muni | 1,323 of 6,613 rows (20.0%) change |
| `105_mp_serving.sql:406,407` | `d.` = declaration | mp | pure win — 100% filled, listing NULL |
| `120_person_browse.sql:321-324` | matview `person_browse_table` | `exec,muni` | institution only |
| `159_person_crypto.sql:95,96` | matview `person_crypto_table` | none | `/declarations/crypto` |

`101_declaration_subject_alias.sql:62` — **leave alone.** Those are the alias table's own
columns, holding a *dropped listing's* labels by construction; carrying filed values there
would need a loader change and is scope creep. Revisit only if the muni backfill runs.

`102` — **include.** This was planned as a deliberate no-op on the strength of muni being 0%
filled; the re-measure kills that reasoning and replaces it with a better one. Muni is now
100% filled and **1,323 of its 6,613 rows (20.0%) carry a filed position that disagrees with
the listing label**, so `role_raw` on `municipal_officials_table` changes for one row in five.
It is a real improvement, not future-proofing.

## 3. The rule lives once — a helper, not twelve COALESCEs

Twelve hand-copied `COALESCE(d.filed_position, d.position_title)` is precisely the shape this
codebase has been burned by (the `magistrate_current` predicate copied six times; "someone
missed one" fired twice in one day). Follow the established local precedent —
`kzk_effective_suspension(suspension, status)` in 042 — and add to
**`089_declarations.sql`**, beside the column comments that already explain the distinction:

```sql
CREATE OR REPLACE FUNCTION declared_label(p_filed text, p_listed text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(nullif(btrim(p_filed), ''), p_listed)
$$;
```

`nullif(btrim(...),'')` because an empty-string capture must fall through, not blank the cell.

**089 is the right home and the ordering works:** it is the phase-1 SCHEMA file
(`load_declarations_pg.ts:50`), applied before every file in §2, and these are `LANGUAGE sql`
bodies validated at CREATE — so the helper must exist first or each dependent file 42883s and
rolls back.

Rejected alternatives: a **generated column** (needs a table rewrite and walks into the
known `db:sync:cloud` generated-column-ordering hazard); a **`declaration_served` view**
(changes `FROM` at every site, a larger diff for the same result).

## 4. Filter and URL semantics — no `db_table.js` change needed

`functions/db_table.js` does **not** contain these expressions. `officials_rankings`
(`:838,862`) and `crypto_holdings` (`:1300,1323`) name `institution` / `position_title` as
**columns of their base matview**; `municipal_officials` (`:1084`) names `role_raw`. Coalescing
inside the matview means the same column name now carries the better value.

**Decision: filter on the coalesced value, no separate column.** The parameter names
(`?institution=`, `?position_title=`) are unchanged; only the values move — on a much larger
share than first planned, now that the backfill has landed (§1).
Adding a parallel `filed_position` column would give the UI two columns that mean almost the
same thing and force every consumer to pick — the defect the register already has.

**Stated consequence:** a bookmarked filter URL naming a listing label (e.g.
`?institution=Служебен министър-председател и министър`) will match fewer rows afterwards.
That is the fix landing, not a regression.

The UI needs no change either — `PersonDeclarations.tsx:268` and `OfficialsAssetsScreen.tsx:138`
already render `positionTitle ?? institution`.

## 5. The gate

New `scripts/db/tests/declaration_filed_position.data.test.ts`, following
`person_compare.data.test.ts`'s reachability-skip pattern (skip when PG is down / corpus empty
/ 089's columns absent).

Assertions:
1. For every declaration with a non-empty `filed_position`, the payload from
   `person_declarations()` / `declaration_detail()` returns that value, not `position_title`.
2. Same for `filed_institution`.
3. Where `filed_position IS NULL`, the payload returns `position_title` — the degrade half,
   which is what protects the 87.6%.
4. `officials_rankings_table` / `person_browse_table` / `person_crypto_table`: no row whose
   underlying newest declaration carries a `filed_*` still shows the listing label.
5. **The Демерджиев / Лазаров fixture explicitly** — the two people the bucket
   `Служебен министър-председател и министър` was wrong about. Assert neither serves that
   string. This is the regression that motivated the work; it should be named in the test.

**Mutation check (required):** invert `declared_label` to `COALESCE(p_listed, p_filed)` in a
rolled-back transaction and confirm assertions 1/2/5 go red — otherwise they are satisfiable
by any implementation that happens to agree. Same technique as
`sync_enrichment.test.ts`'s rank-predicate stub and `person_connections.data.test.ts`'s
old-body restore.

## 6. Local apply — order is forced

`090:318` is an unconditional `DROP MATERIALIZED VIEW person_wealth_year CASCADE`. The three
edits in 090 are all inside `CREATE OR REPLACE FUNCTION` bodies (lines 441, 486, 591) — but
applying the file still executes that DROP, which takes **five** dependents owned by other
migrations. Measured live:

```
person_wealth_year → person_cohort_wealth (097), officials_rankings_table (100),
                     mp_assets_rankings_table (105), person_browse_table (120),
                     person_crypto_table (159)
```

This is the exact failure `apply_functions.ts`'s own header records from 2026-08-15 (`/persons`
and `/officials/assets` 500'd on prod until somebody looked). Every dependent must be in the
command, after 090:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5433/electionsbg npx tsx scripts/db/apply_functions.ts \
  089_declarations.sql \
  090_person_wealth.sql \
  093_declaration_events.sql \
  097_cohort_benchmark.sql \
  098_new_filings.sql \
  100_officials_rankings.sql \
  102_municipal_officials.sql \
  104_mp_roster.sql \
  105_mp_serving.sql \
  120_person_browse.sql \
  159_person_crypto.sql
```

089 first (the helper), 090 next (the CASCADE), then every dependent. 097 and 104 are edited by
nothing here and are present purely to recreate what 090's CASCADE removed. 104 must precede
105. `apply_functions.ts`'s collateral-drop guard should report **nothing vanished**; if it
names a relation, a file is missing from the list.

Measured rebuild cost, local, all seven matviews: **48.7 s**
(`person_wealth_year` 27.9 s, `person_browse_table` 17.2 s, the rest ≤1.4 s).

## 7. Cloud rollout

**Cloud SQL has neither the 089 columns nor any backfill.** Two consequences the order must
respect:

1. **089 must land first, or every file below 42703s on `filed_position`.** 089 carries
   idempotent `ADD COLUMN IF NOT EXISTS` at `:111-112`, so this is cheap and safe on a warm
   database.
2. **With the columns present and empty, `declared_label` degrades to the listing label by
   construction** — exactly the required behaviour, and it needs no feature flag. Cloud serves
   what it serves today until a backfill runs there.

Two routes, in preference order:

**(A) Sanctioned — the loader re-applies everything in order:**
```bash
npm run db:load:declarations:pg:cloud -- --resolve
```
`migration_drop_dependents.data.test.ts` sanctions 090's CASCADE *on the ground that the
recreate rides this same path*. Slower, but no hand-derived file list to get wrong.

**(B) Surgical — the §6 command with `DATABASE_URL` pointed at the proxy (`:5434`).**
Faster; correct only if the file list is complete.

Then, and only then:
```bash
npm run db:load:persons-browse:pg:cloud   # person_browse_table is 120's own loader
npm run db:load:person-search:pg:cloud    # reads person_browse_table
```

`npm run deploy:db` is **not** required and does not carry any of this — it ships `functions/`
code, and no `functions/` file changes in this plan.

### ⚠️ The outage window — state it before shipping

Between 090's CASCADE and each dependent's recreate, those five relations **do not exist**.
`/persons`, `/officials/assets` and `/declarations/crypto` are DbDataTable resources with **no
`missingMigration` degrade**, so they answer **500**, not a narrower result. Local total is
48.7 s; Cloud SQL is a db-g1-small reading cold over the proxy, so budget **5–10 minutes**.

Mitigation: run off-peak, and prefer wrapping the whole apply in ONE `psql` transaction
(`BEGIN; \i …; COMMIT;`) so there is never a "relation missing" state — readers then block on
the AccessExclusiveLock instead, and the ones that exceed `lock_timeout` get 55P03 rather than
a 42P01 the route cannot distinguish from a broken deploy. Either way the window is real and
should be announced, not discovered.

## 8. Explicitly out of scope

- **The backfill crawl.** ~47,500 exec + 6,613 muni filings, ~5 h against a shared government
  register, an operator decision. Tool: `scripts/declarations/backfill_filed_position.ts`
  (`--cache-only`, `--like`, `--slug`, `--all`; batched and resumable). Nothing in this plan
  starts it, and every change here is correct with or without it.
- `101_declaration_subject_alias.sql` (§2).
- The three `mp_profile` false positives (§2).
