# КЗК decisions: close the tier-2 gap and make staleness impossible — v1

**Status:** plan only, nothing implemented.
**Date:** 2026-08-02.
**Owner surface:** `/tenders/:unp` appeals tile, the `/procurement` "Recent appeals (КЗК)"
tile, `/procurement/appeals`, the `procurementAppeals` AI tool, and — indirectly but most
importantly — the contract **Corruption Risk Index**.

---

## 1. What is actually broken

The КЗК dataset has two arms. Only one of them works.

| Arm | Source | Generator | State today |
|---|---|---|---|
| **Tier 1 — intake** (complaint, parties, УНП, status) | `reg.cpc.bg/AllComplaints.aspx?dt=2` | `scripts/procurement/kzk_appeals.ts` (committed, 927 lines) | **Healthy.** Current to 2026-07-29, 7,886 rows, Cloud SQL byte-identical to local. |
| **Tier 2 — merits outcome** (`outcome`, `decision_date`, `suspension`) | `reg.cpc.bg/AllResolutions.aspx?dt=2&ot=2` | **does not exist** | **Frozen.** `max(decision_date) = 2026-06-25` — 38 days (5.4 weeks) stale. |

`data/procurement/kzk_decisions.json` is stamped `generatedAt: 2026-07-04T16:30:18Z`,
holds 4,836 rows spanning `2020-01-09 → 2026-06-25`, and is **gitignored with no committed
generator**. It was produced interactively once. Nothing in the repo can reproduce it.

### Measured impact

Outcome coverage by complaint year — 2026 has fallen below the historical ceiling:

| year | complaints | with outcome | % |
|---|---|---|---|
| 2020 | 1,034 | 277 | 26.8 |
| 2021 | 1,048 | 305 | 29.1 |
| 2022 | 966 | 280 | 29.0 |
| 2023 | 1,344 | 339 | 25.2 |
| 2024 | 1,351 | 399 | 29.5 |
| 2025 | 1,371 | 359 | 26.2 |
| **2026** | **772** | **139** | **18.0** |

Recent months: June 2/118, July 0/115.

**The risk index silently under-reports.** `042_kzk_appeals.sql` builds `upheld_ocids`
from `outcome = 'уважена'`, and that matview feeds the `procedureAppealUpheld` component of
the contract Corruption Risk Index. A frozen tier-2 arm does not merely blank a UI field —
it makes every recently-appealed procedure grade *cleaner than it is*, with nothing red
anywhere. This is the reason the work is worth doing properly rather than re-running a
hand crawl.

---

## 2. Why nothing caught it — five independent blind spots

Each of these must be closed, or the arm re-freezes the next time someone stops running it
by hand.

1. **The watcher is structurally blind to it.** `scripts/watch/sources/kzk_appeals.ts`
   fingerprints only the intake page (`Намерени са общо N жалби` + the newest
   `Complaint.aspx?ID=` anchors). `AllResolutions.aspx` is not a watch source at all, so the
   orchestrator cannot ever flag a decisions gap.

2. **The mandatory gate is a floor, not a freshness check.** The skill's Step 2 asserts
   `count(outcome) >= 2098`. That passes forever even if no new outcome ever lands again.

3. **The success line reads as health.** The ingest marker says
   `"2,098 outcomes preserved"` — a frozen number reported as a positive.

4. **The one thing the orchestrator does run cannot fix it.** On a `kzk_appeals` flip it
   runs the intake crawl, whose upserts are `COALESCE(existing, EXCLUDED)` on
   `outcome`/`suspension` ([kzk_appeals.ts:551](../../scripts/procurement/kzk_appeals.ts:551)).
   By construction it never writes an outcome. Every successful refresh *reinforces* the
   staleness.

5. **The vintage is invisible to git.** `kzk_decisions.json` is gitignored, so its July 4
   `generatedAt` never appears in `git status` or a diff.

---

## 3. A second, separate defect: the join itself is lossy

Independent of freshness, the complainant+respondent+year 1:1 match only lands **26.6%** of
appeals. Measured against the *existing* July 4 file, three concrete causes:

| Cause | Evidence | Rows |
|---|---|---|
| **Multi-party decisions are matched whole-string.** КЗК consolidates several complaints against one procedure into one АКТ, so `init` is a `;`-joined list — e.g. `"ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"`. The matcher compares the whole field against a single-complainant appeal row and misses every one. | 1,838 decision rows have a key with no appeal at all | large |
| **Year-boundary.** The key includes the year, but a complaint filed in December is decided in January. | decision rows matching only against the previous complaint year | 534 |
| **Ambiguity dropped silently.** Keys non-unique on either side are discarded with no counter. | keys present on both sides but ambiguous | 493 |

**Measured fix, no new crawl required.** Splitting `init` on `;` and widening the year
window to `year | year-1`, on the same July 4 file:

```
matched appeals: 2,908  (unambiguous: 2,865)
current PG:      2,098
gain:            +767   (+37%)
coverage:        26.6% → 36.3%
```

That is a free +767 outcomes available before any crawler is written, which makes it the
right first tier — it also validates the matcher against a known corpus before that matcher
starts consuming live crawl output.

---

## 4. Design principles

- **Freshness is asserted against the source, not the calendar.** A "max(decision_date) is
  within N days" rule is wrong: КЗК has August and Christmas recesses, so it would be flaky
  in exactly the months it fires. Instead the watcher records the register's own newest act
  in `state/watch/kzk_decisions.json` (committed), and the gate asserts **our max equals the
  register's newest**. That is exact, recess-proof, and needs no network at test time.
- **Every irreplaceable artifact gets a committed generator.** The whole failure class is
  "an interactive artifact with no code behind it". No tier of this plan ends with another one.
- **Never regress the 2,098.** Those rows stay protected. New tiers add, they do not replace,
  until a full re-derivation is proven to reproduce them.
- **The matcher is a pure, tested function.** Separating "fetch" from "join" is what lets
  Tier 0 run offline against the existing file and lets the join be unit-tested without BG
  egress or a headed browser.

---

## 5. The plan

### Tier 0 — Fix the matcher, recover +767 outcomes offline *(no crawl, no network)*

1. Extract the join into a new pure module `scripts/procurement/kzk_match.ts`:
   `matchDecisions(appeals, decisions) → Array<{complaintNo, outcome, decisionDate, suspension, actNo}>`.
   - Split `init` on `;` and match each party independently.
   - Normalise: uppercase, strip `" ' „ “ « » . ,`, collapse whitespace.
   - Year window `decisionYear | decisionYear - 1`.
   - Emit only unambiguous 1:1 resolutions; **return the ambiguous and unmatched counts as
     data**, so the caller can report them rather than dropping them silently.
   - Map `pron` → `outcome` over the measured vocabulary:
     `оставя жалбата без уважение` → `отхвърлена` (2,860);
     `отменя незаконосъобразно решение и връща` (1,173) and
     `отменя незаконосъобразно решение за откриване на процедура` (270) → `уважена`;
     `оставя жалбата без разглеждане` (11) → `прекратена`; the ~429 blank and 32 `друго`
     rows stay NULL rather than guessing.
2. Unit-test it (`kzk_match.test.ts`) with fixtures covering: a multi-party `;` decision, a
   December→January case, an ambiguous pair, and an unmappable `pron`.
3. Add `npx tsx scripts/procurement/kzk_rejoin.ts --apply` — re-runs the matcher over the
   existing `kzk_decisions.json` + `kzk_appeals.json`, writes back to the JSON store and
   upserts PG with `COALESCE(a.outcome, v.outcome)` (fill-only, same as today).
4. Verify: outcome count rises 2,098 → ~2,865; no existing row's `outcome` changes value.

**Exit:** +767 outcomes on local and Cloud SQL, matcher proven against a 4,836-row corpus.

---

### Tier 1 — Write the missing crawler `scripts/procurement/kzk_decisions.ts`

Model it on `kzk_appeals.ts`, which already solves every hard part.

- **Probe first.** `AllResolutions.aspx?dt=2&ot=2` markup is unverified from here
  (reg.cpc.bg 403s non-BG egress). Step 1 is a `--dry-run` probe from a BG connection that
  dumps page 1 and confirms the pager shape, the `Намерени са общо N` header, and the six
  fields the existing JSON carries (`no`, `ddate`, `pron`, `kzk`, `init`, `resp`).
- Reuse from the intake crawler: headed Playwright launch, `UA` / `BLOCK_HOSTS`,
  `atomicWrite`, `mergeWrite`, the header-total assertion (parsed count vs
  `Намерени са общо N`), and the **incremental early-exit** (stop at the first page whose
  acts are all already stored — the register is newest-first, so a daily run walks 1–2 pages).
- Flags mirroring the intake crawler exactly: `--year` / `--backfill` / `--apply` /
  `--dry-run` / `--full`, with the same mutual-exclusion guards and the same Step-0 local-DB
  pinning hazard.
- On `--apply`: merge into `kzk_decisions.json`, then call the Tier 0 matcher and upsert
  `kzk_appeals.outcome` / `decision_date` / `suspension` fill-only; refresh `upheld_ocids`,
  `appealed_ocids`, `buyer_appeal_stats` and `kzk_appeals_summary_cache`; `recordIngestBatch`
  under source `kzk_decisions`.
- **Store the act number.** Add `decision_act_no text` to `kzk_appeals` (migration 042 is
  idempotent `CREATE TABLE IF NOT EXISTS`, so this needs an `ALTER TABLE … ADD COLUMN IF NOT
  EXISTS`). Without it there is no way to tell a re-derived outcome from a hand-seeded one,
  and no way to audit a match after the fact.
- **Prove the backfill reproduces the hand-made rows** before trusting it: a full
  `--backfill --dry-run` must re-derive all 2,098 existing outcomes with no value conflicts.
  Any conflict is a matcher bug, investigated before `--apply`.

---

### Tier 2 — Make it watchable

1. New watch source `scripts/watch/sources/kzk_decisions.ts`, registered in
   `scripts/watch/sources/index.ts`:
   - `id: "kzk_decisions"`, `cadence: "weekly"` (matching the intake source; decisions land
     ~37–47/month).
   - Fingerprint = `Намерени са общо N` for the current year + a hash of the newest act
     numbers on page 1.
   - **`meta` must carry `newestAct` and `newestDate`** — Tier 3's gate reads them.
   - Same BG-egress note as the intake source.
2. Map it in `process-watch-report/SKILL.md` (both the source table at line ~41 and the
   marker table at line ~395) → `update-kzk-appeals`, stamping `state/ingest/kzk_decisions.json`.
   The two arms are separate markers so one can go stale without the other reporting green.

---

### Tier 3 — Gates that make silent staleness impossible

This is the tier that actually answers "ensure we don't run stale in the future". Three
gates, each catching a different failure.

| Gate | Where | Catches |
|---|---|---|
| **A. Source-truth freshness** — `max(kzk_appeals.decision_date)` must equal `state/watch/kzk_decisions.json → meta.newestDate`, and `max(decision_act_no)` must equal `meta.newestAct`. | new `scripts/db/tests/kzk_decisions.data.test.ts` (PG gate, auto-skips when PG is down) | The exact failure of today: the register moved, we did not. Recess-proof, offline, no network. |
| **B. Ingest-time drift warning** — the intake crawler prints a loud warning when `max(decision_date)` trails `max(complaint_date)` by more than 45 days. | `kzk_appeals.ts` post-commit block | The operator running the *intake* skill is told the *decisions* arm is behind — closing blind spot #4, where the only routine that runs is the one that cannot fix it. |
| **C. Coverage floor with a moving baseline** — assert `count(outcome) >= <baseline>` where the baseline is a committed constant bumped by each successful decisions load, not a frozen 2,098. | `update-kzk-appeals` Step 2 + the same data test | Keeps today's regression protection while removing the "passes forever" property. |

Gate A is the load-bearing one. Deliberately **not** a calendar rule: it does not fire during
a genuine КЗК recess and it does fire the moment a single act is missed.

Also change the ingest summary line from `"2,098 outcomes preserved"` to
`"outcomes: N (tier-2 through <max decision_date>)"` — a frozen date is visible in the
changelog feed where a frozen count is not.

---

### Tier 4 — Rewire the skill and the docs

- `update-kzk-appeals/SKILL.md`: add the decisions crawl as **Step 1b**, replace the
  tier-2-gap section (which currently says the crawler does not exist), rewrite Step 2 around
  gates A/C, and add the cloud publish for the decisions arm to Step 4 — same
  re-crawl-against-the-proxy shape as the intake arm, since there is no
  `db:load:kzk:pg:cloud` wrapper.
- `CLAUDE.md`: no new section needed; this dataset publishes by re-running its writer, which
  is already documented.
- Memory: update `project_kzk_appeals_pager_fix` or add a note that the tier-2 arm now has a
  committed generator and a source-truth gate.

---

### Tier 5 — *Investigate only:* an exact join to replace the name match

Even fixed, the name matcher tops out around 36%. The register exposes a per-complaint
detail page (`Complaint.aspx?ID=<id>`) that the crawler currently records as `sourceUrl` but
never fetches. If that page carries the КЗК case number (`КЗК/417/2026`, which the decisions
side already has in its `kzk` field), the join becomes **exact** and coverage could approach
the true ceiling.

Cost: one detail fetch per complaint. Prohibitive as a backfill (7,886 geo-gated headed
fetches), cheap incrementally (~115/month). Scope this as a **spike with a decision gate**:
fetch 20 detail pages, check for the case number, and only then decide. Do not commit to it
in this plan.

---

## 6. Non-goals

- Not re-running `update-procurement`. Different source, different corpus.
- Not `bucket:sync` and not `db:dump` — `procurement/` is Cloud-SQL-served; `db:dump` only
  snapshots outward to GCS.
- Not a CI step, ever. Headed browser plus BG egress.
- Not touching the intake arm's crawl logic, which is healthy.
- Not backfilling coverage beyond what the decisions corpus supports — 7,886 appeals against
  4,836 decisions means a large share of complaints legitimately have no act (withdrawn,
  consolidated into another party's act, still pending). 100% is not the target.

## 7. Risks

| Risk | Mitigation |
|---|---|
| `AllResolutions.aspx` markup differs from the assumed shape | Tier 1 starts with a `--dry-run` probe; the header-total assertion fails loud rather than returning a short list. |
| A matcher bug overwrites a good hand-made outcome | Every write stays `COALESCE(existing, EXCLUDED)` fill-only, and Tier 1's backfill must reproduce all 2,098 in `--dry-run` before any `--apply`. |
| Widening the year window introduces false matches | Only unambiguous 1:1 resolutions are emitted; ambiguity counts are reported, not dropped. Tier 0 runs against a known corpus so any new match can be spot-audited. |
| No BG egress available when it matters | Unchanged from today, and now explicit: gate A fails visibly instead of the arm freezing quietly. |

## 8. Verification checklist

- [ ] T0: `count(outcome)` 2,098 → ~2,865; zero existing values changed.
- [ ] T0: `kzk_match.test.ts` green on all four fixture classes.
- [ ] T1: `--backfill --dry-run` re-derives all 2,098 pre-existing outcomes, zero conflicts.
- [ ] T1: `decision_act_no` populated on every tier-2 row written by the crawler.
- [ ] T2: `npm run watch` reports `kzk_decisions` with a non-null `meta.newestAct`.
- [ ] T3: gate A fails when `decision_date` is manually rolled back in a transaction, and
      passes on a current table (prove it discriminates — do not just assert it is green).
- [ ] Cloud SQL: `max(decision_date)` matches local after the publish; live
      `/api/db/kzk-appeals-summary` `withOutcome` matches PG.
- [ ] `upheld_ocids` row count rises, and a spot-checked recently-appealed contract's risk
      index reflects the newly-known upheld appeal.
