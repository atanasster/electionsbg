# Role-guarding the bare `GRANT`s in `scripts/db/schema/pg/` — v1

**Status:** DONE (2026-08-11). All tiers shipped; zero bare GRANTs remain repo-wide, and
`scripts/db/grant_role_guard.test.ts` keeps it that way. Two numbers in this plan were wrong
and are corrected in place: the count was 48 across 26 files, not 59 across 34 (the extra 11
were already guarded by two idioms the first inventory did not recognise), and §6's
verification recipe was vacuous — see the box there.

**Superseded by the implementation in:** Tier 0 `fed3f0b`, Tier 1 `44f10ad29a`, Class C
`b268d5bd44`, Tier 2 `3954f9862a`, Tier 3 `869773df37`.

**Original status:** SCOPED. Nothing changed. No migration touched.
**Measured:** 2026-08-11 against local Postgres `postgres://postgres:postgres@localhost:5433/electionsbg`
and against the working tree at `f0a74ed33d`.
**Occasion:** `f0a74ed33d` guarded the second of 070's two grants. That fixed one file's internal
coherence and explicitly did not fix the class. This scopes the class.

---

## 0. Executive summary

**The cold bootstrap is already broken, not latently at risk.** On a genuinely fresh clone — a new
machine, or any `docker compose down -v` — `npm run db:refresh` cannot get past its fifth step. The
role `app_readonly` does not exist on a virgin cluster, `017_company_relationships.sql` grants to it
bare, and `exec()` sends a migration as one implicit transaction, so the whole file rolls back and
`db:load:pg` throws. Nothing in the repo creates the role: `roles_readonly.sql` is its only creator
and no script, npm target or container init invokes it.

**Correcting my own earlier number:** I reported 73 unguarded grants. That came from a crude 8-line
lookback and was wrong. A block-aware parse gives **59 bare `GRANT` lines across 34 files**, after
excluding the 6 in `roles_readonly.sql`, which are correctly bare because that file creates the role
two statements earlier.

**The sweep is not the first thing to do.** One line makes the bootstrap work — running
`roles_readonly.sql` (which is already `IF NOT EXISTS`-guarded and idempotent) as part of the
bootstrap. That fixes the actual breakage. The 59 guards are defense-in-depth *underneath* it and
are worth doing, but shipping them first would leave the bootstrap broken while looking like the
fix. Recommendation: **Tier 0 then Tier 1–3**, in that order, and Tier 0 alone is a legitimate
stopping point if the guards are judged not worth 34 files of churn.

| | Files | Lines |
| --- | ---: | ---: |
| Bare `GRANT` lines in scope | 34 | 59 |
| …of which loader-applied (bootstrap-reachable) | 33 | 58 |
| …of which hand-applied only (`apply_functions.ts`) | 1 | 1 |
| Already guarded, for reference | 15 | — |

---

## 1. The mechanism, link by link

Each link measured rather than assumed, because the severity claim rests on all four holding
together.

1. **A bare `GRANT` to an absent role raises `42704` and aborts its transaction.** Measured, A/B
   against local Postgres: the bare form errors and the transaction never reaches its end; the
   `DO $$ … pg_roles … $$` form runs through to completion.
2. **`exec()` sends a migration file as ONE implicit transaction.** Verified in
   `scripts/db/lib/pg.ts:129` — a single `c.query(sql)` over the simple query protocol. The file's
   own sibling `execEach` exists precisely because of this property, and documents it.
3. **Therefore a bare `GRANT` anywhere in a file rolls back every table, index, view and function
   above it**, leaving the database with nothing from that file and the loader throwing.
4. **Nothing creates `app_readonly`.** `grep -rn "CREATE ROLE"` over `scripts/`, `functions/` and
   `docker-compose.yml` returns exactly one hit, inside `roles_readonly.sql`; no caller anywhere.
   `docker-compose.yml` mounts a bare `pgdata` volume with no init script, and `db:refresh` opens
   with `db:pg:up` (`docker compose up -d`) followed directly by `db:load:pg`.

Roles are **cluster-wide**, which is why this is invisible on any machine that has ever run
`roles_readonly.sql` by hand — including every machine this repo has been developed on. A new
database in the same cluster still sees the role, so it cannot be reproduced by creating a scratch
database; it needs a fresh cluster.

## 2. Where it bites, in `db:refresh` order

`db:load:pg` is step 5 of the 57-step chain and applies four of the affected files. The first
apply-time failure is:

```
scripts/db/load_pg.ts:225   await exec(readFileSync(RELATIONSHIPS_FILE, …))   ← 017, bare GRANT at :43
```

`000_search_fns.sql` is applied earlier (`load_pg.ts:207`) and is **not** the first failure, because
its grant is the `EXECUTE 'GRANT SELECT ON contracts_list TO app_readonly'` form inside a plpgsql
function body — that runs at CALL time, not apply time. See §3, class C.

This also means the failure is **loud and early**, which is the one merciful property here: a fresh
clone fails at step 5 with a clear `42704`, rather than completing and serving something wrong. That
is why this is a bootstrap-quality defect and not a data-integrity one, and why it ranks below any
finding that ships a wrong number.

## 3. Inventory — three classes needing three different edits

**Class A — plain top-level `GRANT` (the bulk).** Wrap in the 117/130 shape. 33 files.

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON <obj> TO app_readonly;
  END IF;
END $$;
```

**Class B — multi-object and `GRANT EXECUTE` forms.** Same wrapper, no special handling; listed
separately only so nobody reformats them into one-object-per-statement while sweeping.
`033:207` (four relations in one statement), `044:205–206` (`GRANT EXECUTE ON FUNCTION`, with a full
argument-type signature that must be copied verbatim — a wrong signature silently grants nothing).

**Class C — `EXECUTE 'GRANT …'` inside a plpgsql body.** One occurrence, `000_search_fns.sql:164`,
inside the function that rebuilds `contracts_list`. **Its failure mode is different and the wrapper
above is the wrong fix**: it raises at function-CALL time, so it breaks a contracts reload rather
than a cold apply, and it is already inside a plpgsql block. The fix is an `IF EXISTS (SELECT 1 FROM
pg_roles …) THEN` around the `EXECUTE`, in that function. Do not batch this one with Class A — it
wants its own commit and its own verification (call the function, don't just apply the file).

### By reachability

| | Files | Lines |
| --- | ---: | ---: |
| **Loader-applied** — runs automatically, reachable on a cold bootstrap | 33 | 58 |
| **Hand-applied only** — `061_awarder_group_model.sql`, reached only via `apply_functions.ts` | 1 | 1 |

The heaviest single file is `125_person_procurement_breakdowns.sql` (7), then `042_kzk_appeals.sql`
(5), `041` / `122` (3 each).

## 4. Guard, do not delete

The tempting simplification is to delete these grants entirely and lean on
`roles_readonly.sql`'s `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … GRANT SELECT ON TABLES`, which
does cover views and matviews created afterwards. `124_procurement_payloads.sql:184` says as much in
its own comment.

**Do not.** `046_agri_subsidies.sql:134` records the reason, and it is not obsolete: default
privileges only fire for objects created **by the role they were declared for**. A loader connecting
as anything other than `postgres` creates objects the defaults never touch, and the failure shape is
`42501` on a serving endpoint with the corpus fully loaded and every row count reconciling — the
silent class this repo treats as most serious. The explicit grants are the belt to that braces, and
re-derive the ACL on every apply rather than once per database.

So the sweep **adds guards and removes nothing**.

## 5. Two options, and why the order matters

**Tier 0 — make the role exist (recommended first, ~1 file).**
Run `roles_readonly.sql` as part of the bootstrap. It is already idempotent: `CREATE ROLE` sits
behind `IF NOT EXISTS`, and every `GRANT`/`ALTER DEFAULT PRIVILEGES` in it is re-runnable. Candidate
homes, in preference order:
- a `db:pg:bootstrap` npm target chained into `db:refresh` right after `db:pg:up`;
- the docker-compose `docker-entrypoint-initdb.d` mount (fires only on a virgin volume, which is
  exactly the case that breaks — but does NOT help a cloud database or a hand-made local one).

Two things to decide before writing it, neither of which I would guess at:
- The role is `LOGIN` with **no password**. Creating it automatically in the local container is
  fine (nothing listens beyond the docker port binding, and a password-less role cannot authenticate
  over TCP under the default `scram-sha-256`), but it should be a deliberate call, not a side effect.
- `roles_readonly.sql` also runs `GRANT CONNECT ON DATABASE electionsbg`, so it is
  database-name-coupled. A bootstrap target must not run it against an arbitrary `DATABASE_URL`
  without checking, or it grants connect on the wrong database and says nothing.

**Tier 1–3 — the guards.** Below. These make each file independently safe regardless of how the
database was created, which Tier 0 does not: Tier 0 fixes the docker path, and says nothing about a
Cloud SQL instance rebuilt from a dump, a Neon branch, or any database made outside the compose flow.

## 6. The sweep, tiered

Each tier is one commit, and each is independently shippable.

- **Tier 1 — the 4 files `db:load:pg` applies** (`017`, `018`, `021`, plus `000` if Class C is
  folded in). This is the tier that unblocks the bootstrap end-to-end alongside Tier 0, and it is
  where verification is cheapest: one `db:load:pg` exercises all of them.
- **Tier 2 — the remaining 29 loader-applied files** (54 lines). Mechanical. Group by loader so each
  group can be verified by running that loader, rather than 29 separate applies.
- **Tier 3 — `061_awarder_group_model.sql`** (1 line, hand-applied). Trivial, and last, because it
  is the only one a cold bootstrap never reaches.
- **Class C — `000_search_fns.sql`'s `EXECUTE` grant**, separately, with a function-call
  verification rather than an apply.

**Per-file verification, which is the real work and must not be skipped:** apply the file, then
confirm the object is still readable by `app_readonly`. A guard that silently stops granting is
worse than the bare form it replaced, because it degrades to `42501` on a serving endpoint instead
of failing at apply time. That is the one way this sweep can make things worse, and it is a real
risk on Class B's function signatures.

> **The obvious way to check this is VACUOUS, in three different ways, and each one was written
> and believed before being caught.** A bare `has_table_privilege(...)` / `has_function_privilege(...)`
> returns `true` for a guard that can never fire. Confirmed by pointing a guard at a role that does
> not exist and watching every check still pass. Three separate backstops produce the false green:
>
> 1. **`ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES`** — most of these files `DROP`+`CREATE`
>    their object, and the fresh one is auto-granted. Suppress it inside the test transaction with
>    `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM
>    app_readonly`. `IN SCHEMA public` is load-bearing — without it the ALTER hits a different
>    `pg_default_acl` row and the suppression silently does nothing.
> 2. **`EXECUTE` is granted to `PUBLIC` by default**, so *every* function check is true regardless
>    of any per-role grant. Needs `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC` as well as from the role.
> 3. **`ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS`** — the function-side twin of (1).
>
> A correct check therefore: open a transaction, revoke from the role *and* from `PUBLIC`, suppress
> both default-privilege classes, assert the privilege is now **false** (the non-vacuity step —
> without it the rest proves nothing), apply the file, assert **true**, `ROLLBACK`. Roll back rather
> than clean up in a `finally`: these are cluster-visible mutations and vitest runs files in parallel.

## 7. The gate

Without a gate the sweep decays: the next migration copies the bare form from a neighbour, because
34 files' worth of precedent is what a new file gets written against.

`scripts/db/grant_role_guard.test.ts` (SHIPPED — note the path: not under `tests/`, which is the
`.data.test.ts` home this section argues against) — a **pure parser test**, no database, so it runs in
`test:unit` and cannot be skipped by an absent Postgres (unlike `.data.test.ts`, which auto-skips —
exactly the property that would let this rot on CI):

- Read every `scripts/db/schema/pg/*.sql`.
- Find `GRANT` statements not inside a `DO $$ … pg_roles … END $$` block, ignoring comment lines.
- Fail on any hit, naming file and line and quoting the guarded form to copy.
- **Exempt `roles_readonly.sql` by name, with the reason inline** — it creates the role two
  statements earlier, so a guard there would be a tautology.

**Keep it non-vacuous**, the way `migration_drop_dependents.data.test.ts` and
`sync_enrichment.test.ts` do: a second assertion that the detector still fires, by running the same
parser over a fixture string containing a known-bare grant and asserting it is caught. Without that,
a parser bug that matches nothing turns the gate green forever and looks like success.

The parser has one known trap worth writing a case for: `000_search_fns.sql`'s grant is inside a
single-quoted `EXECUTE '…'` string within a `$fn$`-quoted body. A naive regex either misses it or
double-counts it. Decide deliberately whether the gate covers Class C or explicitly allowlists it.

## 8. What this does not fix, stated so the plan is not read as more than it is

- **It is not a data-correctness fix.** No served number changes. Every affected database today has
  the role and is working.
- **It does not make a fresh clone work on its own** — that is Tier 0. Guarding all 59 lines leaves
  `app_readonly` still absent, so the loaders would then succeed while every `/api/db` endpoint
  returns `42501`. Shipping the sweep *without* Tier 0 converts a loud step-5 failure into a quiet
  serving failure, which is strictly worse. **This is the ordering error the plan exists to
  prevent.**
- **It does not audit whether the grants are the right grants.** Whether `app_readonly` should read
  each of these 59 objects is a separate question nobody has asked here.
- **Cloud SQL is unaffected either way** — the role was created there by hand long ago.

## 9. Effort

| Tier | Files | Effort | Risk |
| --- | ---: | --- | --- |
| 0 — bootstrap the role | ~2 | Low | Low, but needs the two decisions in §5 |
| 1 — `db:load:pg`'s files | 3–4 | Low | Low; one loader run verifies all |
| 2 — remaining loader-applied | 29 | **Medium** — the churn is trivial, the per-file ACL verification is not | Medium: a mistyped Class B signature grants nothing, silently |
| 3 — hand-applied | 1 | Trivial | None |
| Gate | 1 new test | Low | Must be written non-vacuous or it is worse than nothing |
