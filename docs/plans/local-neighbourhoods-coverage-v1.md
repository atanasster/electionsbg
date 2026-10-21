# Local neighbourhood coverage — why 2019/2023 now match 8 (v1)

Trigger: `scripts/parsers_local/problem_sections_local.data.test.ts` fails on
„REPORTS the shrink the recent cycles carry" — 2023 matches 8 neighbourhoods
against a historical maximum of 7. The test says to rewrite it rather than relax it
when this happens. This plan is that rewrite plus the two real defects the
investigation found.

## 1. What the corpus says (measured 2026-10-21)

| neighbourhood   | 2011 | 2015 | 2019 | 2023 | match rule            |
| --------------- | ---- | ---- | ---- | ---- | --------------------- |
| stolipinovo     | 70   | 71   | 70   | 70   | section prefix        |
| fakulteta       | 10   | 10   | 10   | 10   | address               |
| filipovci       | 4    | 4    | 5    | 5    | section suffix        |
| nadezhda_sliven | 8    | 8    | 8    | 8    | address               |
| pobeda_burgas   | 8    | 8    | 8    | 8    | address               |
| gorno_ezerovo   | 3    | 3    | 3    | 3    | address               |
| dolno_ezerovo   | —    | —    | 7    | 7    | address               |
| maksuda         | 22   | 24   | 23   | 26   | address               |
| **total**       | 7    | 7    | 8    | 8    |                       |

So 2019 also has 8, not just 2023. The one difference is **Долно Езерово**.

## 2. Why Долно Езерово appears only from 2019

- Its seven stations are Burgas codes `020400309–315` (ОУ „Христо Ботев", кв. Долно
  Езерово). **Those codes do not exist in 2011 or 2015**: Burgas had 291 / 290
  stations then and 336 / 339 in 2019 / 2023. The parliamentary corpus agrees: it
  matches `dolno_ezerovo` from 2017 on, never in 2013 / 2014.
- Before about 2016 the neighbourhood voted under other codes, and we cannot tell
  which, because **no address we hold is from that era** (next section).

So 7 → 8 is a real renumbering of Burgas, not a matcher change. It is not a defect.

## 3. Why the September record said „2", and why it was wrong

On 2026-09-07 (`fa5260ca06`) 2019 and 2023 matched 2. No matcher, catalogue or
backfill code has changed since then (`git log` on all four files). The two rules
that need no address are Stolipinovo (prefix) and Filipovci (suffix), so the
„2" was almost certainly a **shard tree with no addresses yet**: a re-parse rewrote
`data/<cycle>/sections/*.json` and `--local-problem-sections` ran before
`--local-coords` stamped the addresses back on. A later run in the right order gave
8. The „7 → 2 shrink" the test was written to keep visible never existed. The
artifact was just built out of order.

That is the defect worth guarding, because the tile hides itself when the result is
empty, so this can happen again with nothing failing.

## 4. A second defect: every local address is anachronistic

`backfill_local_section_coords.ts` takes addresses from the parliamentary archive,
and **only 2022_10_02 onward carries addresses** (every earlier year has 0 of ~700
in oblast 02). So all local cycles, 2011 included, get 2022–2026 addresses, joined
by section code. The only check is that the settlement matches, and for a city that
check is „Бургас = Бургас".

Consequences:

- A code that was a different building in 2011/2015 gets today's building's address.
  Burgas renumbered: 48 of 289 codes shared by 2015 and 2019 moved their roll by
  more than 40%.
- Observed contamination: 2015 `maksuda` includes `03396` (23 voters) and `03397`
  (24). Those are small special stations in 2015 that carry the 2023+ Възраждане
  address.
- The 2011/2015 „7 is closed history" ratchet therefore pins numbers that were
  partly computed from addresses the cycle never had. They are probably *mostly*
  right (the roll per code for Pobeda / Gorno Ezerovo / Maksuda looks continuous),
  but „cannot change" is not true. They change whenever a newer parliamentary
  election re-addresses a code.

## 5. Plan

### Step 1: rewrite the test (the call you asked for)

Replace the „recent ≤ historical max" test and the „2011/2015 == 7" ratchet with
one **per-cycle expected ID set**, derived from the catalogue minus named
exclusions:

```ts
const NOT_MATCHABLE: Record<string, { id: string; why: string }[]> = {
  "2011_10_23_mi": [{ id: "dolno_ezerovo", why: "codes 020400309-315 created ~2016; earlier stations unaddressable" }],
  "2015_10_25_mi": [{ id: "dolno_ezerovo", why: "…same…" }],
};
// expected(cycle) = PROBLEM_NEIGHBORHOODS ids − NOT_MATCHABLE[cycle]
expect(new Set(ids)).toEqual(expected(cycle));
```

- Equality, not `≥`, catches a lost neighbourhood and an unexplained new one.
- A catalogue addition fails every cycle until someone decides, per cycle, whether
  it matches. That is the review point the old count-based test lacked.
- A stale exclusion fails too, because the set equality fails.
- Fix the header comment's „7 in 2011/2015 → 2 in 2019/2023" history: state that the
  „2" was an out-of-order build, not a shrink.

### Step 2: guard the out-of-order build (generator + test)

- In `generateForCycle`, measure address coverage of the cycle's shards before
  matching. Below a floor (current coverage is 85% / 90% / 93% / 94% for
  2011 / 2015 / 2019 / 2023; use **80%**), **refuse to write**, keep the previous
  file, and log `run --local-coords first`. Writing a 2-neighbourhood file over an
  8-neighbourhood one is the regression.
- Add a data-test arm asserting the same coverage floor per cycle, so a stale shard
  tree fails on its own merits rather than through a count three steps away.

### Step 3: stop the anachronism contaminating matches (scoped, measure first)

- Have the backfill record `addressSource` (the parliamentary date the address came
  from) on each section. Cheap and makes the gap visible.
- In the local generator, for a section whose `addressSource` is newer than the
  cycle, require **roll continuity**: the code's `numRegisteredVoters` must be
  within ±50% of the same code's roll in the nearest address-era local cycle (2023).
  This drops `03396` / `03397`-type special stations without touching continuous
  ones. Measure the before/after per neighbourhood and cycle first. If it moves
  anything except the known small stations, stop and report.
- Do **not** try to recover Долно Езерово pre-2016 by guessing codes. Only an
  era-correct address list (a 2011/2015/2016 ЦИК СИК address publication, if one
  exists) could place it. Leave that as an open investigation, not a commitment.

### Step 4: correct the record

- `docs/plans/presidential-analysis-sections-v1.md` keeps its dated figures (repo
  rule). Append a dated note saying the „2 in 2019/2023" was an out-of-order build
  and the corpus matches 8, with a pointer here.

### Status (2026-10-21)

- **Step 1** shipped (`6c2b076c60`).
- **Step 2** shipped (`e5298321a5`). The coverage floor is measured **per settlement an
  address rule reads**, not corpus-wide: those settlements are ~23% of sections, so Sofia alone
  losing its addresses would leave the corpus-wide figure at ~82% and pass. The weakest real
  settlement is Варна 2011 at 86.4%; the floor stays 80%.
- **Step 3, first bullet** shipped (`8ca977a73a`). `addressSource` takes effect on the next
  `--local-coords` run. A scratch run on 2015 gave identical addresses, all from `2026_04_19`.
- **Step 3, roll-continuity filter: NOT shipped.** The measurement this step required moved
  far more than the known small stations. Against the same code's 2023 roll, ±50% drops:
  2011: Pobeda `078/081/083`, Fakulteta `063/068`, Maksuda `194/200/209`; 2015: Pobeda
  `078`, Fakulteta `068`, Maksuda `193/194/396/397`; 2019: Pobeda `079`, Fakulteta `068`,
  Maksuda `194/213`. Those are ADDRESS-MATCHED stations only, and a code absent from 2023
  counts as failing. The rule as written in Step 3 keys on `addressSource`, which
  prefix-matched Stolipinovo stations also carry, and would additionally drop Stolipinovo
  `009` (2011), `004/009/034/052` plus `071` (absent from 2023) (2015), and `009/047` (2019).
  Some of these may be real roll changes at the same building, so this needs a per-station
  decision. Carried in `docs/deferred-followups.md`.
- **Step 4**: `presidential-analysis-sections-v1.md` was retired in `cf6ec257dd` and its
  open items moved to `docs/deferred-followups.md`. The dated correction went there instead
  of reviving a retired file.
- No published number moved, so there is nothing to `bucket:sync`.

### Order and scope

Steps 1 and 2 are small and independent of 3, and they make the suite green for the
right reason. Step 3 changes published numbers (2015 Maksuda loses two stations,
47 voters), so it ships only after its measurement. Nothing here needs a Cloud SQL
step: `problem_sections.json` is a bucket-served file, so Step 3 publishes with
`bucket:sync:paths` for the four `*_mi/problem_sections.json`.
