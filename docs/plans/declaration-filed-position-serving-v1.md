# Repoint the serving surfaces onto `declaration.filed_position` / `filed_institution`

**Status: SHIPPED AND DEPLOYED, 2026-08-17.** Six commits (`7fdbfc1220` … `cae356c807`),
applied to Cloud SQL, values shipped, verified in a browser against production. The
deployment record — including two places where this plan was wrong — is §7a.

**Measured:** originally 2026-08-16 on local Postgres :5433; §1 was re-measured 2026-08-17
after the backfill completed and supersedes the brief's coverage table.

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
| ~~`102_municipal_officials.sql`~~ | matview `municipal_officials_table` | muni | **excluded — see below** |
| `105_mp_serving.sql:406,407` | `d.` = declaration | mp | pure win — 100% filled, listing NULL |
| ~~`120_person_browse.sql`~~ | matview `person_browse_table` | `exec,muni` | **excluded — facet key, see below** |
| `159_person_crypto.sql:95,96` | matview `person_crypto_table` | none | `/declarations/crypto` |

`101_declaration_subject_alias.sql:62` — **leave alone.** Those are the alias table's own
columns, holding a *dropped listing's* labels by construction; carrying filed values there
would need a loader change and is scope creep. Revisit only if the muni backfill runs.

`102` — **EXCLUDE.** This entry has now been wrong twice, and the second time is the
instructive one. It was first planned as a harmless no-op (muni 0% filled); the step-1
re-measure flipped that to "include, a real improvement" on the strength of a 20%
disagreement rate; reading the actual VALUES in step 4 reversed it again. Both columns are
renamed into contracts the filed values do not satisfy:

- `ld.institution AS municipality` — the listing holds the município NAME („Ямбол"), the
  filing holds the EMPLOYER („Община Ямбол", and for 25 Видин rows „Общински съвет - Видин",
  a council). 6,576 of 6,613 rows differ, so the swap rewrites essentially the whole column
  into something that no longer answers "which município".
- `ld.position_title AS role_raw` — the listing has FIVE clean roles; `filed_position` has
  **563 distinct free-text spellings** of them, and sometimes names the body instead of the
  role („Общински съветник" → „Общински съвет").

`120` — **EXCLUDE, on a second and different ground.** `person_browse_table.institution` is
a FACET KEY, not a description of anyone's job: `db_table.js` exposes it as `filter: "in"`
(EXACT) and its own comment records that the picker facets and filters that same column. The
register's listing is a controlled vocabulary of 1,013 institutions; the filed value is free
text, and routing it through takes the column from **991 to 12,626 distinct values** („НАП" /
„ЦУ на НАП" / „Национална агенция за приходи" as three separate entries). That does not make
the picker noisier, it stops it being a picker. Measured: the fragmentation is driven by the
EXEC tier, so narrowing the repoint to one tier does not rescue it.

The cost is accepted and stated: the exec tier's group buckets survive as facet VALUES here.
That is coherent — as a grouping key „the heads of foreign missions" is usable, and it is only
as a claim about one named person that it is false. Every surface that renders it as a
person's job routes through `declared_label`.

**So the rule that decides these sites is what the COLUMN is for, not which tier it spans:**

| column's job | example | source |
|---|---|---|
| a rendered label / substring search (`filter: "text"`) | 090, 093, 098, 100, 105, 159 | **filed**, listing as fallback |
| an exact-match facet key (`filter: "in"`) | 120 `institution` | **listing** (controlled vocabulary) |
| renamed into a different contract | 102 `municipality`, `role_raw` | **listing** |

**The general lesson, which applies to any future site added to this list: a disagreement
COUNT cannot distinguish correction from noise.** On the exec tier the listing invents group
buckets that describe nobody, and the filed value is a fix; on muni the listing is a clean
controlled vocabulary and the filed value is unnormalised free text. Both read as "20-42% of
rows disagree". Only reading the values tells them apart. The reasoning is recorded in 102's
own header so the next reader does not "finish the job".

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

## 5. The gate — as shipped

`scripts/db/tests/declaration_filed_position.data.test.ts`, 18 tests, following
`person_compare.data.test.ts`'s reachability-skip pattern (skips when PG is down or 089 is
unapplied). Four layers:

**The function itself** — the filed value wins and is returned TRIMMED; the listing label is
passed through UNTOUCHED (it is the exact value 120's `filter: "in"` picker matches on, so
trimming it there would silently change which rows a selection returns); `NULL` / `''` /
whitespace-only all fall through; NULL only when neither side has a value; and a catalogue
assertion that it stays `IMMUTABLE PARALLEL SAFE` and **not** `STRICT` (STRICT would
short-circuit the whole fallback).

**Per-surface** — each repointed surface compared against `declared_label` over its own source
rows, separately: the three 090 functions, both 093 sites, 098, and the three bulk surfaces
(100's `officials_rankings_table`, 105's `mp_declarations`, 159's `person_crypto_table`). Each
arm first asserts its own NON-VACUOUSNESS — that the rows it walks really do contain a
filed/listing disagreement — so a converged corpus or a fixture that stopped filing fails
loudly rather than passing over nothing.

**The exceptions, positively** — 120's `institution` stays under 3,000 distinct values (it is
1,263; the filed value took it to 12,626) and 102's `role_raw` under 25 (it is 5; the filed
value has 563). These assert the property that JUSTIFIED each exclusion, not merely that the
column is unrouted.

**The degrade half, on real rows** — the three filings whose `<Position>` the register itself
leaves empty are the only rows in this corpus that exercise the fallback, and they stand in for
every row on an unbackfilled database. Asserted directly, because every other assertion covers
the branch that fires 61,740 times.

**Exhaustiveness** — a sweep enumerates every function, view and matview whose definition reads
`declaration` and mentions these columns, and requires each to be CLASSIFIED: routed through
`declared_label`, or named in `LISTING_LABEL_EXCEPTIONS` with a reason. A new surface fails
until someone decides. It also refuses a STALE exception (one whose object no longer qualifies,
or has since been routed). This exists because review caught `declaration_events_feed`
repointed but untested, where reverting it passed every other assertion in the repo.

**Mutation checks — one SHIPPED, seven run during development.** The shipped one redefines
`declared_label` to prefer the listing value inside a transaction, asserts the surfaces flip
with it, and rolls back; without it, every assertion comparing a payload to `declared_label` is
satisfiable by an inverted implementation both sides agree on. Verified during development:
inverting the preference (reds 4), dropping the fallback (2), a bare COALESCE (3), reverting
`person_declarations` (1), reverting `declaration_events_feed` (1), **swapping
`declared_label`'s ARGUMENTS in 100** (1 — and this one passes the exhaustiveness sweep, which
is why the per-surface arms exist), adding an unrouted view (the sweep), and trimming the
listing branch (1).

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
  148_person_company_basis.sql \
  120_person_browse.sql \
  159_person_crypto.sql
```

⚠️ **`148_person_company_basis.sql` is in that list and must precede 120** — 120's matview
selects `person_company_bridge_a`, a view only 148 creates. Omitting it is the worst available
failure: 120 raises 42P01 **after** 090's CASCADE has already deleted `person_browse_table`, so
`/persons` is down with nothing left to recreate it. `load_declarations_pg.ts` pairs the two in
`PERSON_BROWSE_SCHEMA` for exactly this reason, and its own comment says so. A local run can
pass without it purely because the view is already there from unrelated work — which is how it
was missing from this command until review caught it.

089 first (the helper), 090 next (the CASCADE), then every dependent. 097, 104 **and 120** are
edited by nothing here and are present purely to recreate what 090's CASCADE removed — 120 is
in the list despite being an excluded site precisely because it is a CASCADE victim, and
leaving it out is how `/persons` 500s. 102 is neither edited nor a victim; it is in the list
only because its header changed and re-applying is free. 104 must precede 105.
`apply_functions.ts`'s collateral-drop guard should report **nothing vanished**; if it names a
relation, a file is missing from the list.

**VERIFIED 2026-08-17.** The command above was run end to end against local `:5433`:
all twelve files applied, the collateral-drop guard reported nothing vanished, and the whole
thing took **21.8 s** (the earlier 48.7 s figure was the sum of individual REFRESHes; the
DROP+CREATE path is cheaper). `person_wealth_year` and `person_browse_table` dominate.

Post-apply verification, all green:

- the new gate, 18/18, with every assertion mutation-checked (inverted preference, dropped
  fallback, bare COALESCE, reverted caller, swapped arguments, unrouted object, trimmed
  listing branch);
- `npm run test:data` — **1,201 passed, 21 skipped, 1 failed**: `tr_company_place.data.test.ts
  > the worst-case place answers fast`, a 400 ms TIMING assertion on migration 133, which this
  work does not touch. It passes in 1.4 s when re-run alone, which is the documented
  flaky-under-load behaviour rather than a regression;
- `npm run functions:test` 411/411, `tsc -b` and `eslint` clean.

The original defect, checked directly — both people the listing bucket „Служебен
министър-председател и министър" covered now serve their own filed job:

| person | listing claimed | now serves |
|---|---|---|
| Иван Демерджиев | Служебен министър-председател и министър | министър · Министерство на вътрешните работи |
| Лазар Лазаров | Служебен министър-председател и министър | Заместник министър-председател и министър на труда и социалната политика · Министерски съвет |

## 7. Cloud rollout

**Cloud SQL has neither the 089 columns nor any backfill.** Two consequences the order must
respect:

1. **089 must land first, or every file below 42703s on `filed_position`.** 089 carries
   idempotent `ADD COLUMN IF NOT EXISTS` at `:111-112`, so this is cheap and safe on a warm
   database.
2. **With the columns present and empty, `declared_label` degrades to the listing label by
   construction** — exactly the required behaviour, and it needs no feature flag. Cloud serves
   what it serves today until a backfill runs there.

**RECOMMENDED: route (A), the loader.**

```bash
npm run db:load:declarations:pg:cloud -- --resolve
```

`migration_drop_dependents.data.test.ts` sanctions 090's `DROP … CASCADE` *on the stated
ground that the recreate rides this same path*, and this is that path. It re-applies 089 →
090 → 093 → 098 → 097 → 100 → 102 → 104 → 105 → 148 → 120 → 159 in the loader's own order, so there is no
hand-derived file list to get wrong — which is the failure mode that took `/persons` and
`/officials/assets` down on prod on 2026-08-15.

Route (B), the surgical eleven-file `apply_functions.ts` command from §6 with `DATABASE_URL`
pointed at the proxy (`:5434`), is faster and correct **only if the list is complete**. Prefer
it only when a re-resolve is unacceptable, and check the collateral-drop guard's output.

**Nothing else is required.** `npm run deploy:db` does NOT carry any of this — it ships
`functions/` code, and no `functions/` file changed. `npm run deploy` is likewise unrelated.

### ⚠️ The outage window — announce it, don't discover it

Between 090's CASCADE and each dependent's recreate, five relations **do not exist**.
`/persons`, `/officials/assets` and `/declarations/crypto` are DbDataTable resources with **no
`missingMigration` degrade**, so during that window they answer **500**, not a narrower result.
Local is 33.6 s; Cloud SQL is a db-g1-small reading cold over the proxy, so budget
**5–10 minutes**, and route (A) is longer still because it re-resolves.

Run it off-peak. Wrapping the apply in ONE `psql` transaction (`BEGIN; \i …; COMMIT;`) removes
the "relation missing" state — readers then block on the AccessExclusiveLock instead, and only
those exceeding `lock_timeout` get a 55P03. Either way the window is real.

### What changes on prod, and when

**Nothing a reader sees, until a backfill runs there.** Cloud SQL has no `filed_*` values, so
`declared_label` returns the listing label on every row — byte-identical to today. That is the
property that makes this shippable ahead of the crawl, and it is asserted by the gate's
fallback arm (§5).

The backfill itself is **explicitly out of scope** (§8) and is an operator decision. Two ways
to get the values onto Cloud SQL when that call is made, and the second is much cheaper:

1. `scripts/declarations/backfill_filed_position.ts` — a ~5 h crawl of a rate-limited public
   register. **Do not point it at Cloud SQL**: a filing is immutable once published, so this
   recomputes bytes we already hold locally.
2. `scripts/db/ship_filed_position.ts` — ships the LOCAL values across, keyed on `source_url`
   (not `declaration_id`, which is a `bigserial` and therefore a property of how a database was
   loaded). It refuses below a 95% match rate and only updates rows that differ, so re-running
   is free. This is what CLAUDE.md already documents for the columns themselves.

After shipping values the matviews need refreshing — the functions read live, but
`officials_rankings_table` and `person_crypto_table` are materialised.

⚠️ **This paragraph used to say "re-run this plan's apply", at the cost of a second
~8-minute outage. That is WRONG — see §7a.** Only those two matviews read `declared_label`,
both have a UNIQUE index, and `REFRESH MATERIALIZED VIEW CONCURRENTLY` on the pair took
**14 seconds with no reader blocking**. Re-apply the migrations only when a DEFINITION
changed; after a DATA ship, refresh.

## 7a. Deployment record — what actually happened, 2026-08-17

Both halves went out. This section is the corrected account; where it disagrees with §7
above, §7 was the prediction and this is the measurement.

### The apply — route (B), not the recommended (A)

§7 recommends the loader on the ground that a hand-derived file list is the error-prone
part. **Route (B) was taken instead**, because that risk had been retired by the time of
the deploy: the list was verified locally twice, the missing `148` was fixed (§6), and —
decisively — every CASCADE dependent was resolved against **the actual cloud target** and
all eight proved to be recreated by files in the list:

```
mp_assets_rankings_table · mp_cars_table · municipal_officials_current
officials_rankings_table · person_browse_table · person_cohort_wealth · person_crypto_table
```

Route (A) would additionally have reloaded 61,743 filings over the proxy that did not need
to change, and pulled a follow-up loader chain (persons-browse, official-candidate-links,
person-search) behind it. **Prefer (A) only when the dependent set has NOT been checked
against the target** — that check is what makes (B) safe, not the file list on its own.

Pre-flight state of Cloud SQL: `filed_*` columns **absent**, `declared_label` absent,
`person_company_bridge_a` present, corpus 61,743 filings (identical to local).

**16:57:02 → 17:05:04, 8m02s.** All twelve files applied, collateral-drop guard reported
nothing vanished, every relation recreated and populated with counts matching local exactly
(`person_browse_table` 136,863 · `officials_rankings_table` 20,524 · `person_wealth_year`
43,887 · `person_cohort_wealth` 10,428 · `mp_assets_rankings_table` 4,329 ·
`mp_cars_table` 2,038 · `municipal_officials_table` 6,647 · `person_crypto_table` 114).

The outage window predicted in §7 was real: for those eight minutes `/persons`,
`/officials/assets` and `/declarations/crypto` returned **500**. As designed, nothing a
reader saw changed afterwards — with `filed_*` NULL, `declared_label` returned the listing
label on every row, confirmed directly on the caretaker-PM rows.

### The values ship

`ship_filed_position.ts`, dry run first: **61,743/61,743 matched on `source_url` (100%)**,
confirming the two corpora were the same vintage. Applied **17:18:01 → 17:18:17, 16s**,
61,743 rows updated. Prod now carries 61,740 `filed_position` / 61,741 `filed_institution`
— identical to local, the 3 and 2 gaps being the register's own empty elements.

### ⚠️ The refresh — where §6/§7 were WRONG

Both sections say to re-run the twelve-file apply so the matviews pick the values up, at the
cost of a second ~8-minute window. **That is wrong and should not be followed.** The matview
DEFINITIONS already carried `declared_label` from the apply; only their CONTENTS were stale.
And only **two** matviews read it at all:

```sql
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'm' AND pg_get_viewdef(c.oid) ~ 'declared_label';
--  officials_rankings_table
--  person_crypto_table
```

Both carry a UNIQUE index (`idx_officials_rankings_slug`, `ux_person_crypto_table`), so:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY officials_rankings_table;
REFRESH MATERIALIZED VIEW CONCURRENTLY person_crypto_table;
```

**17:19:56 → 17:20:10, 14 seconds, no reader blocking and no outage** — against a predicted
eight-minute one. The general rule this teaches: after shipping DATA into columns an already
-deployed matview reads, refresh the matviews; re-apply the migrations only when a
DEFINITION changed.

### Verified in a browser against production

Every `/api/db` call 200, zero console errors.

- **`/person/mp-5104`** — all four of Демерджиев's filings render „Министър · МВР" /
  „Министър · Министерство на вътрешните работи". „Служебен министър-председател" does not
  appear on the page. This is the published defect, fixed.
- **`/officials/assets`** — 25 of 14,583 rows; zero caretaker-PM labels, zero
  „Ръководителите на задграничните представителства" buckets; the ROLE column carries filed
  jobs against real institutions („член на Надзорния Съвет · НС на НОИ").
- **`/declarations/crypto`** — 25 of 34 rows, institutions rendering.
- **`/persons`** — 63,782 rows, all facet calls 200, picker still 1,263 values. This is the
  §4 exclusion, and it is unchanged, which is the correct outcome.

### Local suite

`npm run test:data`: **1,203 passed, 21 skipped, 0 failed** (166 files). Two earlier runs
each had ONE failure — `tr_company_place`'s 400 ms timing assertion, then
`migration_drop_dependents`' 003 re-apply — a different test each time, both passing when
re-run alone. That is lock contention across the suite, which
`migration_drop_dependents.data.test.ts` documents in its own header (003 takes ACCESS
EXCLUSIVE 33 times under a deliberate 20 s `lock_timeout`). Ruled out this plan's own gate as
the cause by running the two files together repeatedly: 21/21.

## 8. Explicitly out of scope

- **The backfill crawl.** ~47,500 exec + 6,613 muni filings, ~5 h against a shared government
  register, an operator decision. Tool: `scripts/declarations/backfill_filed_position.ts`
  (`--cache-only`, `--like`, `--slug`, `--all`; batched and resumable). Nothing in this plan
  starts it, and every change here is correct with or without it.
- `101_declaration_subject_alias.sql` (§2).
- The three `mp_profile` false positives (§2).
