# КЗК decisions: close the tier-2 gap and make staleness impossible — v1

**Status:** plan only, nothing implemented.
**Date:** 2026-08-02. **Revised 2026-08-02** after a full audit against the live system —
see §9 for what the audit changed. The first draft's freshness gate was unworkable and its
scope missed three live defects; both are corrected below. `git log -p` on this file has the
superseded version.

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
anywhere. This is why the work is worth doing properly rather than re-running a hand crawl.

---

## 2. Why nothing caught it — five blind spots

Each must be closed, or the arm re-freezes the next time someone stops running it by hand.

1. **The watcher is structurally blind to it.** `scripts/watch/sources/kzk_appeals.ts`
   fingerprints only the intake page (`Намерени са общо N жалби` + the newest
   `Complaint.aspx?ID=` anchors). `AllResolutions.aspx` is not a watch source at all.
2. **The mandatory gate is a floor, not a freshness check.** Step 2 asserts
   `count(outcome) >= 2098` — which passes forever even if no new outcome ever lands.
3. **The success line reads as health.** The ingest marker says `"2,098 outcomes preserved"`
   — a frozen number reported as a positive.
4. **The one thing the orchestrator runs cannot fix it.** On a `kzk_appeals` flip it runs the
   intake crawl, whose upserts are `COALESCE(existing, EXCLUDED)` on `outcome`/`suspension`
   ([kzk_appeals.ts:551](../../scripts/procurement/kzk_appeals.ts:551)). By construction it
   never writes an outcome. Every successful refresh *reinforces* the staleness.
5. **The vintage is invisible to git.** `kzk_decisions.json` is gitignored, so its July 4
   `generatedAt` never appears in `git status` or a diff.

---

## 3. Three further defects the audit found

These are **live today**, independent of freshness, and in scope because the same tiers touch
them.

### 3a. `suspension` is frozen `false` on 7,778 of 7,886 rows — and that kills a documented fallback

```
suspension: false 7,778 | true 4 | null 104        vm_requested true: 1,501
status ~* 'спрян': 4
```

Intake writes NULL ([kzk_appeals.ts:582](../../scripts/procurement/kzk_appeals.ts:582)), but
the stored value is `false`, and the upsert is `COALESCE(existing, EXCLUDED)` — so it can
never move. That makes 042's serving expression dead for those rows:

```sql
'suspension', COALESCE(suspension, status ~* 'спрян')   -- always false, never falls through
```

042's own comment states the intent — *"updates false→true on re-scrape"* — which the stored
`false` defeats. 1,501 appeals requested a temporary measure; the site can show at most the 4
whose `suspension` happens to be true or null. **Independently shippable (T3); does not need
the crawler.**

### 3b. 8.9% of the decisions corpus is column-shifted

429 of 4,836 rows have the act description in `no`, with `pron` and `ddate` blank:

```json
{"no": "F788088/26.12.2025 г. на заместник-кмета на община Пловдив… - ОБЩИНА ПЛОВДИВ; Отменя…",
 "pron": "", "ddate": ""}
```

Only 4,407 are well-formed `АКТ-`. A blank `ddate` means those rows can never match, and they
are silently part of the 1,838 "unmatched" counted in §4. The first draft used this file as
both the matcher's input and the backfill's validation corpus, assuming it was clean.

### 3c. The определения (temporary-measure) register is probably not crawled at all

Every well-formed act is `АКТ-`, and only 37 of 4,836 pronouncements mention
временна мярка/спиране — against 1,501 `vm_requested`. 042's comment says outcomes come from
"the Решения/Определения register**s**" (plural); `ot=2` is likely one act type. Tier-2 may be
missing a whole sub-source, which is also the only authoritative source for 3a's fix.

---

## 4. A fourth defect: the join itself is lossy

Independent of freshness, the complainant+respondent+year 1:1 match lands only **26.6%** of
appeals. Measured against the existing July 4 file:

| Cause | Evidence | Rows |
|---|---|---|
| **Multi-party decisions matched whole-string.** КЗК consolidates several complaints against one procedure into one act, so `init` is a `;`-joined list — `"ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"`. Compared whole against a single-complainant appeal row, it misses every one. | decision rows whose key matches no appeal | 1,838 (incl. the 429 from §3b) |
| **Year-boundary.** The key includes the year, but a December filing is decided in January. | rows matching only against the previous complaint year | 534 |
| **Ambiguity dropped silently.** Keys non-unique on either side are discarded with no counter. | keys present on both sides but ambiguous | 493 |

**Measured fix, no new crawl.** Splitting `init` on `;` and widening the year window to
`year | year-1`, on the same July 4 file:

```
matched appeals: 2,908  (unambiguous: 2,865)
current PG:      2,098
gain:            +767   (+37%)
coverage:        26.6% → 36.3%
```

Free before any crawler exists — and it validates the matcher against a known corpus before
that matcher starts consuming live crawl output.

---

## 5. Design principles

- **Freshness is asserted against the source, not the calendar.** A "max date within N days"
  rule is wrong here: КЗК has August and Christmas recesses, so it would be flaky exactly when
  it fires. The watcher records the register's own newest act in committed watch state, and
  the gate asserts our corpus contains it.
- **The gate anchors on the decisions corpus, never on the joined column.** 1,838 decisions
  match no appeal, so `max(kzk_appeals.decision_date)` can legitimately lag the register's
  newest act. Anchoring there would fail spuriously on a current table. *(This is the audit's
  correction to the first draft.)*
- **Every irreplaceable artifact gets a committed generator and a table.** The whole failure
  class is "an interactive artifact with no code behind it". No tier may end with another one.
- **Provenance decides what may be overwritten.** Fill-only `COALESCE` protects hand-made rows
  but makes a *wrong* machine value permanent. `decision_act_no IS NOT NULL` marks a row as
  machine-derived and therefore re-derivable; NULL marks it hand-seeded and protected.
- **Never regress the 2,098** until a full re-derivation is proven to reproduce them.
- **The matcher is a pure, tested function.** Separating fetch from join is what lets T2 run
  offline and lets the join be unit-tested without BG egress or a headed browser.

---

## 6. The plan

Dependency graph — **T1, T3 and T5 are independent and can land in any order**; only T4 needs
the probe, and only T6 needs both a corpus and a watcher.

```
T1 (decisions table) ──► T2 (matcher +767) ──┐
T3 (suspension fix)  ─────────────────────────┼──► T6 (gates) ──► T7 (skill/docs/UI)
T5 (watch source)    ─────────────────────────┘
                          T4 (crawler) ──────► T6
                                               T8 (spike, gated)
```

Rough sizing: T1 ~M, T2 ~M, T3 ~S, T4 ~L, T5 ~S, T6 ~M, T7 ~S, T8 spike-only.

---

### T1 — Give the decisions corpus a home *(closes G2, G3, G8)*

The corpus is currently 4,836 rows in a gitignored file on one machine, with no table, no
changelog and no gate. That is the same failure class this plan exists to end.

1. New migration `scripts/db/schema/pg/130_kzk_decisions.sql`:
   `kzk_decisions(act_no text PK, decision_date text, pronouncement text, kzk_case_no text,
   initiators text, respondent text, source_url text, fetched_at text)`, indexed on
   `decision_date DESC` and `kzk_case_no`. `GRANT SELECT TO app_readonly`.
2. Loader `scripts/db/load_kzk_decisions_pg.ts` (`db:load:kzk-decisions:pg[:cloud]`) —
   loads the existing JSON, stage-merged (the table will be on a serving path once T6's gate
   and T8 read it), with `recordIngestBatch` under source `kzk_decisions` per
   [[feedback_pg_changelog_required]].
3. **Quality gate on load.** Assert `act_no` matches `/^АКТ-\d+-\d{2}\.\d{2}\.\d{4}$/` and
   `decision_date` is non-empty. Reject the 429 malformed rows into a reported bucket rather
   than loading them — and count them, so T4's crawler is measured against a clean baseline.
4. **Backup.** Until T4's backfill is proven to reproduce the corpus, the recoverable copy is
   a `db:dump` restore point taken immediately after this load, referenced in the skill. State
   this explicitly — "never regress the 2,098" is not a recovery plan.

---

### T2 — Fix the matcher, recover +767 outcomes offline *(closes G6, G9)*

1. Extract the join into a pure module `scripts/procurement/kzk_match.ts`:
   `matchDecisions(appeals, decisions) → {matches, ambiguous, unmatched}`.
   - Split `init` on `;`, match each party independently.
   - Normalise: uppercase, strip `" ' „ “ « » . ,`, collapse whitespace.
   - Year window `decisionYear | decisionYear - 1`.
   - Emit only unambiguous 1:1 resolutions; **return ambiguity and miss counts as data** so
     the caller reports them rather than dropping them silently.
   - Map `pron` → `outcome` over the measured vocabulary: `оставя жалбата без уважение` →
     `отхвърлена` (2,860); `отменя незаконосъобразно решение и връща` (1,173) and
     `отменя незаконосъобразно решение за откриване на процедура` (270) → `уважена`;
     `оставя жалбата без разглеждане` (11) → `прекратена`. The 32 `друго` rows stay NULL
     rather than guessing. (The 429 blanks are gone at T1.)
2. Unit-test (`kzk_match.test.ts`): a multi-party `;` decision, a December→January case, an
   ambiguous pair, an unmappable `pron`, and a malformed row.
3. **Provenance column.** `ALTER TABLE kzk_appeals ADD COLUMN IF NOT EXISTS decision_act_no
   text` (042 is idempotent `CREATE TABLE IF NOT EXISTS`, so the column needs its own ALTER).
   Write semantics:
   - `decision_act_no IS NULL` → hand-seeded, **fill-only** `COALESCE(existing, new)`.
   - `decision_act_no IS NOT NULL` → machine-derived, **overwrite allowed**, so a matcher fix
     can correct a bad value. Without this, the first wrong outcome is permanent.
4. `npx tsx scripts/procurement/kzk_rejoin.ts --apply` re-runs the matcher over the stored
   corpus, writes back to `kzk_appeals.json` and upserts PG under the rules above. Same local-DB
   pinning hazard as every other writer here (Step 0 of the skill).
5. **Rebuild and commit the derived artifacts** — `npm run kzk:summary` (the committed
   `derived/kzk_appeals_summary.json`, whose `withOutcome` jumps 2,098 → ~2,865), refresh
   `upheld_ocids` / `appealed_ocids` / `buyer_appeal_stats` / `kzk_appeals_summary_cache`, and
   stamp `/data/updates` via `append-data-change`.
6. Verify: outcome count 2,098 → ~2,865; no hand-seeded row's value changes.

---

### T3 — Unfreeze `suspension` *(closes G4 — independently shippable)*

1. One-off correction: `UPDATE kzk_appeals SET suspension = NULL WHERE suspension IS FALSE
   AND decision_act_no IS NULL` — i.e. every row whose `false` was never established by a
   decision. That restores 042's `COALESCE(suspension, status ~* 'спрян')` fallback, which is
   what makes a live suspension visible without waiting for tier-2.
2. Behind `--backfill`-style opt-in per [[feedback_one_off_backfills]], not an automatic step.
3. Keep the intake writing NULL (it already does, correctly).
4. Regression test: a row with `status = 'спряно производство'` and `suspension IS NULL` must
   serve `suspension: true` from `tender_appeals()`; the same row with a stored `false` must
   not — proving the gate discriminates.
5. Only T4's определения arm (§3c) can set `suspension = true` authoritatively. Until then the
   status fallback is the honest answer, and this tier is what re-enables it.

---

### T4 — Write the missing crawler `scripts/procurement/kzk_decisions.ts` *(closes G5, G13)*

Model it on `kzk_appeals.ts`, which already solves every hard part.

- **Probe first, and probe the `ot` parameter space.** `AllResolutions.aspx` markup is
  unverified from here (reg.cpc.bg 403s non-BG egress). Step 1 is a `--dry-run` probe from a BG
  connection that: dumps page 1; confirms the pager shape and the `Намерени са общо N` header;
  confirms the six fields; and **enumerates `ot` values to find the определения register**
  (§3c). Scope the rest of this tier only after the probe reports.
- Reuse from the intake crawler: headed Playwright launch, `UA` / `BLOCK_HOSTS`,
  `atomicWrite`, `mergeWrite`, the header-total assertion (parsed count vs
  `Намерени са общо N`), and the **incremental early-exit** (stop at the first page whose acts
  are all stored — the register is newest-first, so a daily run walks 1–2 pages).
- **Add a column-alignment assertion** so §3b's failure cannot recur: every parsed row must
  satisfy T1's `act_no` and `decision_date` shape, and the run fails loud on drift rather than
  storing shifted rows.
- Flags mirroring the intake crawler exactly: `--year` / `--backfill` / `--apply` /
  `--dry-run` / `--full`, with the same mutual-exclusion guards.
- On `--apply`: merge into `kzk_decisions.json` **and** the T1 table, then call T2's matcher and
  upsert `kzk_appeals` under T2's provenance rules; refresh the four dependents;
  `recordIngestBatch`.
- **Prove the backfill reproduces the hand-made rows** before trusting it: a full
  `--backfill --dry-run` must re-derive all 2,098 existing outcomes with no value conflicts.
  Any conflict is a matcher bug, investigated before `--apply`.
- **Retention risk.** If the register no longer paginates back to 2020, `--backfill` cannot
  rebuild the corpus and T1's dump becomes the permanent record. The probe must report the
  oldest reachable act, and that number decides whether the backup in T1.4 is temporary or
  permanent.

---

### T5 — Make it watchable

1. New watch source `scripts/watch/sources/kzk_decisions.ts`, registered in
   `scripts/watch/sources/index.ts`:
   - `id: "kzk_decisions"`, `cadence: "weekly"` (decisions land ~37–47/month).
   - Fingerprint = `Намерени са общо N` for the current year + a hash of the newest act numbers
     on page 1.
   - **`meta` must carry `newestAct` and `newestDate`** — T6's gate reads them, and
     `state/watch/*.json` is committed, so the gate needs no network.
   - Same BG-egress note as the intake source.
2. Map it in `process-watch-report/SKILL.md` (the source table at ~line 41 and the marker table
   at ~line 395) → `update-kzk-appeals`, stamping `state/ingest/kzk_decisions.json`. **Separate
   markers per arm**, so one can go stale without the other reporting green.

---

### T6 — Gates that make silent staleness impossible *(closes G1, G7)*

| Gate | Where | Catches |
|---|---|---|
| **A. Source-truth freshness** — `state/watch/kzk_decisions.json → meta.newestAct` must exist in **`kzk_decisions`** (T1's table), and `max(kzk_decisions.decision_date)` must equal `meta.newestDate`. | new `scripts/db/tests/kzk_decisions.data.test.ts` | Exactly today's failure: the register moved, we did not. Recess-proof, offline. |
| **B. Ingest-time drift warning** — the *intake* crawler warns loudly when `max(kzk_decisions.decision_date)` trails `max(kzk_appeals.complaint_date)` by more than 45 days. | `kzk_appeals.ts` post-commit block | Blind spot #4: the operator running the arm that *can't* fix this is told the other arm is behind. |
| **C. Coverage floor with a moving baseline** — `count(outcome) >= <committed constant>`, bumped by each successful decisions load. | skill Step 2 + the same data test | Keeps today's regression protection while removing the "passes forever" property. |
| **D. Match-quality floor** — the matcher's ambiguous + unmatched counts must not rise between runs on an unchanged corpus. | `kzk_match.test.ts` + the rejoin script's report | A future matcher edit that silently loses coverage. |

**Gate A anchors on the decisions corpus, not on `kzk_appeals.decision_date`.** 1,838
decisions match no appeal, so the joined column legitimately lags the register — anchoring
there would fail on a perfectly current table. This is the audit's correction to the first
draft, and it is the reason T1 must exist.

**Missing-state behaviour is an assertion, not a skip.** If `state/watch/kzk_decisions.json`
is absent, or `kzk_decisions` is empty, the test **fails** — following the
`procurement_payloads.data.test.ts` precedent in CLAUDE.md, where the absent and unpopulated
states are the two things the gate exists to catch. It auto-skips only when Postgres itself is
down, like every other `.data.test.ts`.

Also change the ingest summary from `"2,098 outcomes preserved"` to
`"outcomes: N (tier-2 through <max decision_date>)"` — a frozen date is visible in the
changelog feed where a frozen count is not.

---

### T7 — Rewire the skill, docs and UI surfaces *(closes G10, G11)*

- `update-kzk-appeals/SKILL.md`: add the decisions crawl as **Step 1b**; replace the tier-2-gap
  section (which currently says the crawler does not exist); rewrite Step 2 around gates A/C/D;
  add the decisions arm to Step 4's cloud publish — same re-crawl-against-the-proxy shape as
  the intake arm, since there is no `db:load:kzk:pg:cloud` wrapper, plus the new
  `db:load:kzk-decisions:pg:cloud`; and record T1.4's restore point.
- `042_kzk_appeals.sql`: expose `decision_act_no` on `kzk_appeals_list` (the view is DROP-first,
  so this is reapply-safe) and add it to the `kzk_appeals` DbDataTable resource, so a match is
  auditable from `/procurement/appeals` rather than only from psql.
- [DataSources.tsx:541](../../src/screens/components/DataSources.tsx:541): the КЗК group lists
  only `AllComplaints.aspx`. Add the decisions register — it is a distinct source behind a
  published field.
- Memory: note that the tier-2 arm now has a committed generator, a table and a source-truth
  gate.

---

### T8 — *Investigate only:* an exact join to replace the name match

Even fixed, the name matcher tops out near 36%. The register exposes a per-complaint detail
page (`Complaint.aspx?ID=<id>`) that the crawler records as `sourceUrl` but never fetches. If
it carries the КЗК case number (`КЗК/417/2026` — which the decisions side already has in
`kzk_case_no`), the join becomes **exact**.

Cost: one detail fetch per complaint. Prohibitive as a backfill (7,886 geo-gated headed
fetches), cheap incrementally (~115/month). **Spike with a decision gate:** fetch 20 detail
pages, check for the case number, then decide. Not committed to in this plan.

---

## 7. Non-goals

- Not re-running `update-procurement`. Different source, different corpus.
- Not `bucket:sync` and not `db:dump` as a *publish* — `procurement/` is Cloud-SQL-served, and
  `db:dump` only snapshots outward to GCS. (T1.4 uses it as a restore point, which is its
  actual job.)
- Not a CI step, ever. Headed browser plus BG egress.
- Not touching the intake arm's crawl logic, which is healthy.
- Not chasing 100% coverage. 7,886 appeals against 4,407 clean decisions means many complaints
  legitimately have no act — withdrawn, consolidated into another party's act, or still pending.

## 8. Risks

| Risk | Mitigation |
|---|---|
| `AllResolutions.aspx` markup differs from the assumed shape | T4 opens with a probe; the header-total and column-alignment assertions fail loud rather than storing shifted rows (§3b is precisely this failure, unguarded). |
| A matcher bug overwrites a good hand-made outcome | Provenance (T2.3): hand-seeded rows stay fill-only. Machine rows are overwritable *by design*, so a fix is possible. |
| Widening the year window introduces false matches | Only unambiguous 1:1 resolutions are emitted; ambiguity counts are reported (gate D), and T2 runs against a known corpus so new matches can be spot-audited. |
| The register no longer serves 2020 | T4's probe reports the oldest reachable act; T1.4's dump becomes the permanent record if it does not reach back. |
| No BG egress when it matters | Unchanged from today, but now explicit: gate A fails visibly instead of the arm freezing quietly. |
| T3's one-off NULLs a legitimately-established `false` | **Revised in implementation.** `decision_act_no IS NULL` turned out to be the wrong scope: the OUTCOME matcher sets that column without touching `suspension`, so 916 rows carry both and the proxy proves nothing. The guard tests the premise directly instead — it refuses if any row is suspended while its status does NOT say `спрян`, since such a value cannot have come from the intake snapshot. Measured before the run: `true` on 4 rows (all 4 `спрян`), `false` on 7,778 (none `спрян`), i.e. the column was exactly a frozen copy of the fallback expression. |
| T3 changes a served answer after all | **It did.** `kzk_appeals_list` selected the RAW column, so releasing it took `/procurement/appeals` from 4 suspended chips to 0 while the other four consumers still showed 4. The expression was inlined five times and one copy was wrong; 042 now defines `kzk_effective_suspension()` once and all five call it, and the T3 gate asserts per-row agreement across the serving objects rather than against its own re-implementation. |

## 9. What the audit changed (2026-08-02)

Thirteen gaps, folded in above.

| # | Gap | Landed in |
|---|---|---|
| G1 | Gate A anchored on `kzk_appeals.decision_date`, which legitimately lags the register — the gate would fail on a current table | §5, T6 |
| G2 | Decisions never got a PG table — the plan reproduced the failure class it exists to end | T1 |
| G3 | 429 of 4,836 corpus rows are column-shifted; the plan treated the file as clean | §3b, T1.3, T4 |
| G4 | `suspension` frozen `false` on 7,778 rows, killing 042's documented fallback | §3a, T3 |
| G5 | The определения register is likely uncrawled — a whole missing sub-source | §3c, T4 |
| G6 | Fill-only COALESCE makes a *wrong* value permanent; no correction path | T2.3 |
| G7 | Undefined behaviour when the watch-state file is missing | T6 |
| G8 | No recovery story for the irreplaceable rows | T1.4 |
| G9 | T0 never rebuilt the committed summary or stamped `/data/updates` | T2.5 |
| G10 | `DataSources.tsx` omits the decisions register | T7 |
| G11 | `decision_act_no` not exposed, so matches aren't auditable from the UI | T7 |
| G12 | No sequencing or sizing; T1/T3/T5 are independent and were presented as serial | §6 |
| G13 | No answer for a register that no longer serves 2020 | T4, §8 |

What survived unchanged: the §4 measurement (+767, 26.6% → 36.3%), the source-truth-over-calendar
principle, and the tier ordering — G3 and G5 reinforce it, since probing before crawling
matters more than the first draft credited.

## 10. Verification checklist

- [ ] T1: `kzk_decisions` loaded; the 429 malformed rows rejected and **counted**, not loaded.
- [ ] T1: restore point taken and referenced in the skill.
- [ ] T2: `count(outcome)` 2,098 → ~2,865; zero hand-seeded values changed.
- [ ] T2: `kzk_match.test.ts` green on all five fixture classes.
- [ ] T2: committed `kzk_appeals_summary.json` rebuilt; `/data/updates` stamped.
- [ ] T3: a `спряно производство` row serves `suspension: true`; the same row with a stored
      `false` does not — proving the fix discriminates.
- [ ] T4: probe reports the `ot` parameter space and the oldest reachable act.
- [ ] T4: `--backfill --dry-run` re-derives all 2,098 pre-existing outcomes, zero conflicts.
- [ ] T4: `decision_act_no` populated on every tier-2 row the crawler writes.
- [ ] T5: `npm run watch` reports `kzk_decisions` with a non-null `meta.newestAct`.
- [ ] T6: gate A fails when an act is deleted from `kzk_decisions` in a rolled-back
      transaction, and passes on a current table — prove it discriminates, don't just assert green.
- [ ] T6: gate A fails (not skips) with the watch-state file absent.
- [ ] Cloud SQL: `max(decision_date)` matches local; live `/api/db/kzk-appeals-summary`
      `withOutcome` matches PG.
- [ ] `upheld_ocids` row count rises, and a spot-checked recently-appealed contract's risk index
      reflects the newly-known upheld appeal.
