# Consortium members are invisible on their own page — v1

**Status:** **T1 APPLIED** to `011_company_api.sql` + `024_person_api.sql` and to LOCAL Postgres
on 2026-09-21, with its gate (`scripts/db/tests/consortium_member_visibility.data.test.ts`).
**NOT applied to Cloud SQL** — see T5; prod still returns NULL for all 1,101.
⚠️ T1 is inert on its own: T3 is what a reader sees. T2–T4 not started.
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
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  011_company_api.sql 024_person_api.sql
```

⚠️ **Name BOTH files.** They have different automatic appliers and can drift: `db:load:pg`
(contracts) applies 011, `db:load:tr:pg` (TR — a `REFRESH_EXCLUSIONS` member `db:refresh` never
runs, ~280 s on cloud) applies 024. Waiting for a loader therefore ships half the guard. This
command is the only thing that ships both.

### T2 — SQL: make the annex trail reachable from the member

Add `consortiumAnnexCount` to the participation block, counted over the CARRIER's rows:

```sql
SELECT count(*) FROM procurement_annexes a
  JOIN contracts cc ON cc.key = a.contract_key
 WHERE cc.contractor_eik IN (SELECT DISTINCT consortium_eik FROM base WHERE consortium_role = 'member')
```

Rendered as a link to the carrier's annexes page — **never** folded into the member's own
`amendmentCount`, which is a count of the member's own rows.

### T3 — UI: a member-side participation block

Change the section gate to `rollup && (rollup.contractCount > 0 || (procurement?.consortiumCount ?? 0) > 0)`,
and give the member-only branch its own head rather than the solo `StatCard` grid:

- heading „Участие в обединения" (not „Обществени поръчки" — this firm won nothing on its own)
- the joint total, explicitly labelled as the FULL contract value with the share not public
- each `consortiumContracts` row → buyer, title, date, value, link to the carrier `/company/:consortiumEik`
- the co-members, resolved from the carrier
- the annex link from T2
- the existing „средно / договор" line suppressed when `contractCount === 0` (the `Infinity` trap)
- ⚠️ **and NONE of the solo fields — invariant 7.** No „Възложители" StatCard (it would read
  „Договори 0 · Възложители 1"), no `byAwarder` / `byYear` tile (their rows carry their own
  member-counting `contractCount` beside a €0), no `ProcurementBenchmarksTile` (285 of these
  companies carry `singleBidN > 0` computed from placeholders), no `totalOther` (every one of
  them ships `{"BGN": 0}`, which reads as „paid zero BGN" — a claim nobody made).

Mirror on `PersonScreen`, which reads the same jsonb shape and today has no consortium field
at all.

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
  npx tsx scripts/db/apply_functions.ts 011_company_api.sql 024_person_api.sql
npm run deploy:db     # the /api/db/company + /api/db/person routes
npm run deploy        # the two screens
```

⚠️ **NOTHING RUNS THAT FIRST COMMAND FOR YOU, and no loader you would plausibly run ships both
halves.** 011 rides `db:load:pg` (a ~5-minute contracts publish) and 024 rides `db:load:tr:pg`
(a ~280 s TR publish that is a `REFRESH_EXCLUSIONS` member), so waiting for a loader lands one
half and leaves the other on the old body indefinitely, with every row count reconciling. The
apply itself is seconds, takes no AccessExclusiveLock on any table, and has no stored-query
dependents to CASCADE.

Order is cosmetic here — both routes pass the jsonb straight through, and an older bundle
ignores a new key — but the SQL should lead so the first deployed bundle has something to render.

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
