# Consortium members are invisible on their own page — v1

**Status:** **T1 APPLIED** to `011_company_api.sql` + `024_person_api.sql` and to LOCAL Postgres
on 2026-09-21, with its gate (`scripts/db/tests/consortium_member_visibility.data.test.ts`).
**NOT applied to Cloud SQL** — see T5; prod still returns NULL for all 1,101.
**T2 + T3 APPLIED** — T2 to the same two SQL files, T3 to the two screens (nothing to apply).
⚠️ Prod is UNCHANGED: Cloud SQL still returns NULL for all 1,101, so the tile renders nowhere
there. T4 (component/route gates beyond those already shipped per tier) not started.
**Measured:** 2026-09-21 against local Postgres `postgres://postgres@127.0.0.1:5433/electionsbg`
(contracts 411,713 rows).
**Trigger:** a reader compared `/company/113581389` (МЛГ ЕООД) against a competitor tool that
showed the same company holding an АПИ guardrail framework. Our corpus holds that contract —
at a **higher and more current** value than the competitor publishes — and our page shows
nothing.

---

## 0. Executive summary

Migration 087 moves a joint award's whole value onto one carrier row and **zeroes the member
rows**. That is correct and must not change: it is what stops a three-firm consortium from being
counted three times. But every serving surface then treats "this firm's own money is €0" as
"this firm has no procurement", and **drops the participation it just computed**.

The payload is not missing. It is built and then discarded by a one-line `CASE` guard.

| Surface                                                      | Population affected |                                  Joint value they are party to |
| ------------------------------------------------------------ | ------------------: | -------------------------------------------------------------: |
| `/company/:eik` — member-only companies                      |           **1,172** | **€7.48 bn** across 1,048 consortia (deduped by carrier award) |
| `/person/:name` — people whose companies are all member-only |  **731** name folds |                 €6.13 bn (per-fold, co-members double-counted) |

Five things this measurement establishes:

1. **Two independent gates hide it, and they fail at different counts.** `company_procurement()`
   returns NULL for 1,101 of the 1,172 (the 71 with amendment rows get a payload); the TSX gate
   `rollup && rollup.contractCount > 0` then hides the section for **all 1,172**. Fixing either
   alone changes nothing a reader sees.
2. **`consortiumEur` / `consortiumCount` / `consortiumContracts` already exist** in the payload
   and already render as a sub-line — but only on companies that ALSO have solo work. The 2,063
   mixed companies are already served correctly. This plan is only about the member-only case.
3. **`person_procurement()` (024) carries the identical guard** and the identical defect. It is
   not a follow-up; it is half the bug — and the two files have **different automatic appliers**
   (011 rides `db:load:pg`, 024 rides `db:load:tr:pg`, a `REFRESH_EXCLUSIONS` member), so a
   routine contracts publish lands the company half and leaves `/person` on the old body with
   nothing red. Ship them by name, together.
4. **The annex trail is unreachable from the member.** `procurement_annexes` attaches to the
   carrier key only, so a member page cannot show the amendments that moved the contract.
5. **Nothing here is a money change.** Not one euro moves in any rollup, leaderboard, sector
   total or risk index. The member rows stay €0.

---

## 1. The worked example

`/company/113581389` — МЛГ ЕООД, Перник, founded 2011-02-15.

```
company_procurement('113581389')  →  NULL
company_related('113581389')      →  []
company_public_money              →  no row
```

What the corpus actually holds, УНП `00044-2022-0028`, buyer АПИ (000695089),
„ВЪЗСТАНОВЯВАНЕ, РЕМОНТ, ДОСТАВКА И МОНТАЖ НА ОГРАНИЧИТЕЛНИ СИСТЕМИ ЗА ПЪТИЩА…" (мантинели):

| key                 | contractor                                      | role    |    amount_eur | consortium_full_eur |
| ------------------- | ----------------------------------------------- | ------- | ------------: | ------------------: |
| `669288540780`      | МЛГ ЕООД                                        | member  |             0 |       21,602,081.97 |
| `ae8d824eb32c`      | МЛГ ЕООД                                        | member  |             0 |       47,583,414.54 |
| `obed-e577e14118e1` | Обединение: Безопасност запад, КМВ-системи, МЛГ | carrier | 21,602,081.97 |                   — |
| `obed-abf3a70ed9bb` | (same carrier)                                  | carrier | 47,583,414.54 |                   — |

So МЛГ is a named party to **€69,185,496.51** and its page says nothing.

The annex trail on РД-37-45/30.09.2022, all чл. 116 ал. 1 (options + inflation indexation),
attached to `obed-abf3a70ed9bb` and therefore also unreachable from МЛГ:

| date              | new value (BGN, без ДДС) |
| ----------------- | -----------------------: |
| signed 30.09.2022 |               42,598,403 |
| 2023-03-31        |               63,723,403 |
| 2024-09-20        |               76,396,403 |
| 2025-06-06        |            83,065,069.67 |
| 2025-08-19        |        **93,065,069.67** |

**+118% over the signed value.** The competitor's published figure, 105,973,403 BGN, reconciles
exactly as `42,250,000 + 63,723,403` — the pair as of the FIRST annex. Ours is
**135,315,070 BGN**, €15.0M higher and three annexes more current. We are not missing data. We
are failing to render it.

---

## 2. The two gates

### 2a. SQL — `011_company_api.sql` (guard at :236), `company_procurement()`

```sql
WHEN hd.contract_count = 0 AND hd.award_count = 0 AND hd.amendment_count = 0 THEN NULL
```

`hd.contract_count` is deliberately `tag = 'contract' AND consortium_role IS DISTINCT FROM
'member'`. That exclusion is right for a COUNT and wrong as an existence test: the CTEs
`conshd` / `conslist` directly above it have already computed the participation, and this line
throws it away. Identical line in `024_person_api.sql` (guard at :208), in `person_procurement()`.

⚠️ Line numbers here are POST-T1 and move whenever the comment blocks do — anchor on the
text `AND conshd.consortium_count = 0 THEN NULL`, which the T4 static gate matches.

### 2b. TSX — `src/screens/dev/CompanyDbScreen.tsx:1604`

```tsx
{rollup && rollup.contractCount > 0 && ( … whole procurement section … )}
```

The `consortiumCount` sub-line (1646) lives INSIDE that block, so it is only ever reachable by a
company that already has solo work.

⚠️ The headline `StatCard` divides by `rollup.contractCount` for „средно / договор". A
member-only company has `contractCount = 0`, so simply relaxing the gate yields `Infinity`. The
member-only case needs its own presentation, not a reuse of the solo headline.

---

## 3. Invariants — what must NOT change

These are the reason this is a rendering change and not a corpus change.

1. **The member rows stay €0.** No sum anywhere gains a euro.
2. **`consortiumEur` is NEVER added to `totalEur`.** The per-member share is not public; the
   full contract value is shown as _participation_, under its own label, and the existing
   tooltip already says so. Summing them would re-create the triple count 087 exists to prevent.
3. **`company_public_money` (127) gains no row.** Member-only firms must stay out of it, or the
   `/connections` graph, the governance "фирми, регистрирани тук" ranking and `tr_company_place.money_eur`
   all inherit a double count.
4. **`contractor_rank` (122) / `contractor_search` are untouched.** МЛГ is already in both (6 and
   1 rows) at €0, correctly — it is findable; only its page is blank.
5. **`contract_count` keeps its member exclusion** everywhere it is a count. The fix is a new
   existence test, never a widened count.
6. **The carrier page is unchanged.** `consortiumMembers` (the „Обединение — участници" block)
   already works.
7. **The member-only branch renders NONE of the solo fields.** `awarderCount`, `byAwarder`,
   `byYear`, `topContracts`, `totalOther` and the whole `breakdown` filter `tag = 'contract'`
   with **no** member exclusion — so for a member-only company they are computed entirely from
   €0 participation placeholders. Measured 2026-09-21 over the 1,101: all 1,101 report
   `awarderCount ≥ 1` beside `contractCount = 0`, all 1,101 carry a non-empty `byAwarder` and
   `byYear`, 1,032 a non-zero `methodKnownN`, 915 a non-zero `bidKnownN`, and **285 a non-zero
   `singleBidN`** — i.e. a single-bidder competition statistic about a firm that won nothing on
   its own. **Decided:** the SQL fields are NOT narrowed, because narrowing them would move the
   per-row counts of the 2,063 MIXED companies as a side effect and that needs its own
   measurement and its own gate. Instead T3's member-only branch renders only the `consortium*`
   fields. A new consumer reading `awarderCount` or `breakdown` must check `contractCount > 0`
   first. Both SQL files carry this note at `hd.awarder_count`.

---

## 4. Tiers

### T1 — SQL: stop discarding the payload

`011_company_api.sql` and `024_person_api.sql`, one line each:

```sql
WHEN hd.contract_count = 0 AND hd.award_count = 0 AND hd.amendment_count = 0
     AND conshd.consortium_count = 0 THEN NULL
```

Both files are `DROP FUNCTION IF EXISTS` + `CREATE OR REPLACE` with **no stored-query
dependents** (verified: the four other migrations naming `company_procurement` mention it only in
comments), so this is a safe, cheap apply with no CASCADE and no reload:

```bash
export PGPASSFILE=$PWD/.pgpass
# LOCAL (port 5433 — the docker Postgres). Port 5434 is the Cloud SQL proxy; that is T5.
DATABASE_URL=postgres://postgres@127.0.0.1:5433/electionsbg \
  npx tsx scripts/db/apply_functions.ts \
    114_procurement_annexes.sql 011_company_api.sql 024_person_api.sql
```

⚠️ **Name BOTH files.** They have different automatic appliers and can drift: `db:load:pg`
(contracts) applies 011, `db:load:tr:pg` (TR — a `REFRESH_EXCLUSIONS` member `db:refresh` never
runs, ~280 s on cloud) applies 024. Waiting for a loader therefore ships half the guard. This
command is the only thing that ships both.

### T2 — SQL: make the annex trail reachable from the member ✅ DONE

`procurement_annexes` resolves against `contracts.key`, and 087 puts the money — and with it
the amendments — on the carrier, so member rows carry **0 annexes across the whole corpus**.

Both files gained a `carannex` CTE that resolves each member row's carrier on
**`(ocid, contract_id)`** — the exact key `rebuild_consortium()` groups on, so a member and its
carrier always agree — and from it:

- `consortiumAnnexCount` on the payload — **unbounded**, unlike the per-row count, which would
  otherwise stop at `conslist`'s `LIMIT 25` and under-report the firms with the most joint work;
- `carrierKey`, `consortiumName` and `annexCount` on each `consortiumContracts` row, so the UI
  links straight at the carrier's contract.

⚠️ **Never folded into `amendmentCount`.** „this firm's contract was amended N times" and „this
firm filed N amendments" are different claims; the reference company has 5 of the first and 0 of
the second.

Measured 2026-09-21: МЛГ reports 5 (4 on РД-37-45, 1 on РД-37-42) — matching
`procurement_annexes` exactly — and **387 of the 1,172** member-only companies now resolve at
least one annex. Resolving the carrier ONCE per payload rather than per consumer took the
corpus's worst case (835013079, 128 member rows) from 3,279 buffers / 15.7 ms to **2,225 /
10.3 ms**, all index scans, and the person side gained ~226 buffers of 9,009 (2.6%) on the
busiest real fold — its temp spill is `base AS MATERIALIZED` and predates this change. A
buffer ceiling on each side is in the gate.

⚠️ There is deliberately **no** „does the plan seq-scan `contracts`?" assertion: neither
rollup is inlinable, so `EXPLAIN` of a call prints one `Result` node and no inner plan —
verified by disabling every index scan, which took the call to 9.08M buffers and 13.8 s while
such a regex still matched nothing. The buffer ceiling is the only thing that discriminates.

### T3 — UI: a member-side participation block ✅ DONE

`src/screens/components/procurement/ConsortiumParticipationTile.tsx`, shared by
`CompanyDbScreen` and `PersonScreen`, rendered in its own branch gated on
`contractCount === 0 && consortiumCount > 0`.

**Its own branch, NOT a relaxed `contractCount > 0` gate** — that section's `StatCard`
divides by `contractCount` (→ `Infinity`) and its tiles read the solo fields invariant 7
names. A company with BOTH solo and joint work falls through to the existing section and its
`consortiumCount` sub-line, so **nothing moved for the 2,063 mixed companies**.

What the tile shows: the heading „Участие в обединения (N)" — never „Обществени поръчки" —
the joint total, the carrier annex count, and each contract with buyer, date, value, the
consortium, and „договорът е изменян N пъти".

⚠️ **Three claims are in VISIBLE BODY TEXT, not a tooltip**: the sum is the contracts' full
value, the per-participant share is not public, and it is therefore **not revenue**. „€69,2
млн." beside a company name reads as income unless something adjacent says otherwise, and a
reader on a phone never hovers.

⚠️ **The row link is `/procurement/contract/:id`, never `/funds/contract/:number`.** Those
are different corpora — the funds route is the ИСУН EU-funds page keyed by
`fund_projects.contract_number` — and the wrong family dead-ends on „contract not found",
which would defeat T2 entirely. The first cut had this wrong and the test asserted the broken
href, so it passed on the defect.

⚠️⚠️ **AND THE RIGHT ROUTE DID NOT WORK EITHER — a pre-existing defect this change surfaced.**
`useContract`'s `enabled` guard was `/^[0-9a-f]{12}$/`, which rejects the synthetic carrier
keys 087 mints as `'obed-' || left(md5(…), 12)`. `enabled: false` fires no request at all, so
`/procurement/contract/obed-…` rendered „Договорът не е намерен" for **all 2,699 carrier
contracts in the corpus** (against 409,014 bare keys) — on a page whose `/api/db/contract`
resolves them perfectly. It was never confined to this tile: `CompanyTopContractsTile` builds
its links from the same keys, so on any consortium entity's own page every top-contract link
was dead too. The guard is now `CONTRACT_KEY_RE = /^(?:obed-)?[0-9a-f]{12}$/`, exported and
pinned by `useContract.test.ts` against both real shapes and the junk it exists to stop.

Verified after the fix: `/procurement/contract/obed-abf3a70ed9bb` serves the carrier contract
with **€21,780,218 при сключване → €47,583,415 текуща стойност, +118.5%** and fires the
чл. 116 ал. 2 risk flag — i.e. the annex trail this plan set out to make reachable from
МЛГ's page is now one click from it.

⚠️ **Truncation is disclosed against `count`, not against the delivered array.** Both SQL arms
cap `consortiumContracts` at `conslist`'s `LIMIT 25` while `consortiumCount` is unbounded, so
the array arrives pre-truncated: on EIK 206331450 (count 40, 25 delivered, 8 shown) the array
form said „и още 17" and lost 15 contracts under a heading reading 40.

**Three sibling surfaces also stopped rendering from €0 placeholders** (invariant 7, each
found by review rather than by design):

| surface                                 | was gated on                           | now gated on                    | why                                                                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AllTimeScopeNote` (company)            | `contracts > 0 && contractCount === 0` | …`&& summary.contract_rows > 0` | told 1,172 firms „nothing in this window, try all time" in EVERY window incl. `?pscope=all` — a loop. ⚠️ Keyed on the ALL-TIME member-excluding count, not on participation in the current window: the latter costs 158 **mixed** companies their route to their solo total. |
| `CabinetTimelineTile` (company)         | `contracts > 0` (all tags)             | `summary.contract_rows > 0`     | rendered „Най-висок темп при <PM>: €0 / мес" — a money-per-month tile whose every share is 0/0.                                                                                                                                                                              |
| the „Активен в N сектора" chip (person) | `breakdown.cpvRaw.length > 0`          | …`&& contractCount > 0`         | `cpvRaw` filters `tag = 'contract'` with no member exclusion, so it read „Активен в 2 сектора" off contracts the person won no part of.                                                                                                                                      |

`person-consortium` is registered in `DashboardSectionIdProp`. `ProcurementBreakdownTile` and
the person-side cabinet tile were already inside the `contractCount > 0` section and needed
nothing.

**Verified live** against the real route table + local Postgres (the Vite `dbApi` plugin, so
dev == prod by construction): `/company/113581389?pscope=all` renders „Участие в обединения
(2)", €69,2 млн., 5 анекса and both contracts; no „Възложители" StatCard, no „средно", no
`Infinity`/`NaN`, no console errors. The DEFAULT scope renders no tile and keeps the scope
note — which is correct and worth knowing: МЛГ's contracts are from 2022, outside the current
parliament window, so **a reader landing on the page must widen to see any of this**.
`/person/ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ?pscope=all` renders 3 contracts / €76 млн. / 7 анекса with
„чрез МЛГ ЕООД".

### T4 — Gates

`scripts/db/tests/consortium_member_visibility.data.test.ts` — **items 1–4 and 6 landed with
T1** (7 tests, green); T4 adds the rest:

1. `company_procurement('113581389')` is NOT NULL, and its `consortiumEur` equals
   `SUM(consortium_full_eur)` over that EIK's member rows.
2. `totalEur` is still **0** for it — the mutation check that the fix did not become a money
   change. This is the assertion that matters most; everything else is cosmetic beside it.
3. Corpus-wide: **no** company with `own_rows = 0 AND member_rows > 0` returns NULL. Fails at
   1,101 today.
4. `person_procurement('ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ')` is NOT NULL.
5. `company_public_money` still has no row for 113581389 — invariant 3, pinned.
6. A mutation check on the guard itself: with `AND conshd.consortium_count = 0` removed in a
   rolled-back transaction, test 3 must go red. Otherwise test 3 is satisfied by an
   implementation that never applied the fix.

7. A static check that 011 and 024 carry the **identical** guard text — they are one rule in two
   files with two different appliers, and nothing else stops them diverging. (Landed with T1.)

Component tests (T4 proper): `CompanyDbScreen` renders the participation block, renders NO
„средно" line at `contractCount = 0`, and renders none of the solo tiles named in invariant 7.
There is currently **no `CompanyDbScreen` component test at all**, so this is the first.

### T5 — Deploy

Hosting and function only; no corpus reload.

```bash
export PGPASSFILE=$PWD/.pgpass
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts \
    114_procurement_annexes.sql 011_company_api.sql 024_person_api.sql
npm run deploy:db     # the /api/db/company + /api/db/person routes
npm run deploy        # the two screens
```

⚠️ **114 IS IN THAT COMMAND, AND IT IS A THIRD LOADER.** T2 made both rollups read
`procurement_annexes`, whose only applier is `db:load:annexes:pg` — neither `db:load:pg`
(011) nor `db:load:tr:pg` (024). Under `check_function_bodies = off` a missing relation does
not fail at CREATE; it raises **42P01 on the first CALL**, inside a ~30-way `Promise.all`.
Both route arms now degrade that to a null rollup and log once under `co:no-procurement:*`
(`db_routes.consortium_annex.test.js`), so the worst case is a narrowed page rather than a
500 on every `/company`, `/awarder` and `/person` — but applying 114 avoids both.

⚠️ **The degrade is `42P01` ONLY, and that asymmetry is a decision.** 114 is a TABLE, so its
absence is `undefined_table`. A **`42883`** on these arms can only mean the rollup FUNCTION
itself is absent — 011/024 never reached this database — and swallowing it would render „no
procurement" on every `/company`, every `/awarder` (one route serves both) and every
`/person` at a **200**, indefinitely, behind one log line. For a state buyer that is its
entire contract history reading as nothing, and `CompanyDbScreen`'s
`!company && !institution && !hasProcurement` branch can then serve the „we do not track this
entity" dead end for a real contractor. So a `deploy:db` landing ahead of 011 stays a loud 500. `missingRelationLogged` exists rather than reusing `missingMigrationLogged` for exactly
this, and five per-arm tests pin each of `42883 / 57014 / 55P03 / 42501 / 53400` as still
rejecting.

⚠️ **NOTHING RUNS THAT FIRST COMMAND FOR YOU, and no loader you would plausibly run ships both
halves.** 011 rides `db:load:pg` (a ~5-minute contracts publish) and 024 rides `db:load:tr:pg`
(a ~280 s TR publish that is a `REFRESH_EXCLUSIONS` member), so waiting for a loader lands one
half and leaves the other on the old body indefinitely, with every row count reconciling. The
apply itself is seconds, takes no AccessExclusiveLock on any table, and has no stored-query
dependents to CASCADE.

⚠️ **THE SQL MUST LEAD, AND HERE THAT IS NOT COSMETIC.** Verified 2026-09-21: prod Cloud SQL
still serves the PRE-T1 payload, so `company_procurement` returns **NULL** for every
member-only entity. Ship the bundle first and the tile has nothing to render on any of the
1,172 companies or 731 folds — the whole change is invisible, and looks like it did not work.
A bundle older than the SQL degrades gracefully in the other direction (it ignores the new
keys), and an intermediate state where 011/024 are applied but the bundle is not just serves
today's page. So: **SQL → `deploy:db` → `deploy`.**

One narrower ordering inside that: a payload from 011 WITHOUT T2 carries no `carrierKey`, so
each row falls back to linking the MEMBER's own key — a real page, but the €0 row rather than
the carrier's, with no annex trail. Applying both files together (the command above does)
avoids it.

**Verify on the serving database afterwards**, since a green local gate says nothing about prod:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx vitest run \
  scripts/db/tests/consortium_member_visibility.data.test.ts
```

---

## 5. Risks

- **Re-creating the triple count.** The single real risk. Guarded by invariants 2–3 and by T4.2.
- **`Infinity` in „средно".** Named above because it is the one thing that breaks by relaxing the
  gate alone.
- **A member-only company now looks like a procurement player.** Mitigated by the heading:
  „Участие в обединения", not „Обществени поръчки". A reader must not come away thinking МЛГ won
  €69M — it was one of three firms on a contract worth that much, and the split is not public.
- **Reading the competitor's number as authoritative.** It is three annexes stale. Ours is the
  better figure; this plan is about showing it, not about adopting theirs.

---

## 6. Out of scope

- The board-seat bridge (Adamov ↔ Хилс Инвестмънт 205427392). Our TR history for that company
  starts 2021-04-29 and never names him; the daily feed begins 2021 and 205427392 is not in the
  CR Deeds capture. A targeted `npm run tr:cr-deeds` capture would settle it. Genesis gap, not a
  contradiction.
- The political-links basis (`person_politicians` reading the money-restricted
  `company_politicians`). Real, separate, and it cannot help МЛГ until this plan lands — a
  political link needs money on the page to hang from.
- `FOOTPRINT_CAP = 5` refusing Anton Adamov's five name-matched companies at a footprint of 6.
  Needs its own measurement before anything moves.
