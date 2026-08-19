# Open-sourcing the procurement risk methodology (OCP Cardinal model) v1

Status: **implementation plan**, drafted 2026-08-18, **revised the same day after a verification
pass against the shipped code** — the pass corrected five claims that would otherwise have shipped
into the published spec (the exposure weights are two sets not one, the per-contract A–F grade
exists, `weakCompetition`'s two arms sit at different CPV grains, the contract CRI is unweighted,
and a flag catalog already exists in `RiskBadges.tsx`), and added the deploy path (§7.5) the first
draft had no section for. Follows
[procurement-risk-v2.md](procurement-risk-v2.md) (the methodology itself) and the "four moves"
from [cross-linking-strategy-v2.md](cross-linking-strategy-v2.md) §3 (move 3). Owner: TBD.

The goal is **not** to write more risk rules. The rules already exist and are shipped. The goal
is to turn them from scattered implementation detail into a **named, versioned, published, open
artifact** — one a reader can check, a researcher can cite, and anyone can reuse.

---

## 0. Why this is worth doing

Three reasons, none of them about anybody else's release schedule:

1. **A flag that fires on a named company is a public claim, and right now it is unfalsifiable
   from outside.** The site tells a reader that a contract tripped `annexGrowth` or that a buyer
   grades D, and there is no document anywhere that says what those mean, what threshold was
   applied, on what legal basis, or what the base rate is. Publishing the definitions is what
   turns an assertion into a checkable one — and it is the strongest answer to "you are accusing
   people" that a publisher without a legal mandate can give.
2. **Standards already exist and we should be legible in their terms.** OCP's *Red Flags for
   Integrity* (2024) defines 73 flags with formulas, and **Cardinal** is its open-source
   reference implementation ([OCP](https://www.open-contracting.org/2024/06/12/cardinal-an-open-source-library-to-calculate-public-procurement-red-flags/)).
   Our flags are Bulgarian-calibrated — ЗОП ceilings, чл.116 ал.2's cumulative cap, the statutory
   `22112` carve-out — which is exactly the kind of local variation those standards expect and
   cannot derive themselves. Mapping ours onto theirs (§5) is what makes the difference
   inspectable rather than invisible.
3. **Comparability is a property a local-only methodology simply does not have.** iMonitor 2.0
   (OpenTender/GTI, D2.2 risk methodology, 2026 ed.) is deployed in Bulgaria via TI-Bulgaria, so
   a cross-country lens on the same corpus exists. An analyst who can see where our definitions
   agree with theirs and where they deliberately do not can use both; one who cannot must pick
   one and hope.

There is also a plain maintenance argument, independent of any audience: the flag definitions
live in six places today (§1b) and are kept in step by hand. A published spec that is *generated*
from one source is cheaper to keep true than an unpublished one kept in step by memory.

For where this sits relative to other platforms in the field, see
[competitive-review-2026.md](../../competitive-review-2026.md) — as context, not as a deadline.

## 1. What exists today, and why "open-source" is currently aspirational

### 1a. The methodology is real and shipped

| Layer | Home | Shipped |
|---|---|---|
| Contract scorer — 13 checks, `cri = 100 × fired/available` | `src/data/procurement/computeProcurementRisk.ts` | ✅ |
| Tender scorer — 4 checks (ex-ante) | `src/data/procurement/computeTenderRisk.ts` | ✅ |
| Exposure grade (awarder + supplier), A–F banded | `041_procurement_risk_grade.sql`, `awarder_risk_grade_frac()` | ✅ |
| Bit-mask cache + decode fn | `112_contract_risk_cache.sql` (`contract_risk_checks`) | ✅ |
| Mask → chips decoder (browser reads the SERVER's masks) | `src/lib/contractRiskMask.ts` (`RISK_MASK_BITS`) | ✅ |
| Per-contract A–F grade, banded on the FIRED COUNT | `112` (`contract_risk_grade_letter`), served as `risk_grade`, filtered by `?grade` | ✅ |
| Per-flag UI catalogue (label / why / n-a reason / legal ref) | `RiskBadges.tsx` (`CHECK_CATALOG`, `satisfies`-guarded) | ✅ |
| Risk-index inputs (debarred/concentration/pep/mp/split/founded/nkid) | `033_procurement_risk_indexes.sql` | ✅ |
| КЗК appeal join | `042_kzk_appeals.sql` | ✅ |
| Neutral NGO foreign-funding disclosure (not scored) | `080_ngo_signals.sql` | ✅ |
| НКИД→CPV crosswalk (SSOT) | `src/lib/naceCpv.ts` | ✅ |
| Normalcy (context, not risk) | `063`/`067_procurement_normalcy.sql` | ✅ |
| Vocabulary contract (exposure/flags/screening/index/normalcy) | `procurement-risk-v2.md` §3–§4, i18n | ✅ |

### 1b. But it is scattered, and the repo is not legally open

- The **flag definitions live in six places**, kept in sync by hand + parity harnesses:
  1. TS constants — `computeProcurementRisk.ts` (the `RiskComponentKey` union, the `WEIGHT_*`
     literals, `ANNEX_GROWTH_CAP`, `NEW_FIRM_MONTHS`, `SHORT_TENDER_DAYS`);
  2. `RISK_MASK_BITS` — `src/lib/contractRiskMask.ts`, the bit order as a TS array. **This is
     the copy `risk_parity.harness.ts` imports as its reference**, not 112;
  3. `CHECK_CATALOG` — `src/screens/components/procurement/RiskBadges.tsx`, whose own comment
     calls it *"The full applicable-check catalogue"*: `key` · `icon` · `labelKey` · `whyKey` ·
     `naReasonKey` (the availability reason) · `ref` (the legal basis, e.g. `ЗОП чл.116`),
     ordered heaviest-first, with a `satisfies` **compile-time exhaustiveness guard** against
     `RiskComponentKey`;
  4. SQL, contract grain — `112`'s bit-order comment block, the `contract_risk_checks()` name
     array, the threshold literals inside each `f_*` predicate, **and its own inline copy of
     the additive weights** (`* 80`, `* 50`, `* 40` … in the `score` expression);
  5. SQL, exposure grain — `041`'s `awarder_risk_grade_frac()` weights *and* the separate,
     un-centralised supplier literals; plus `033`'s emit;
  6. i18n labels + the risk-v2 plan prose.

  There is **no single machine-readable SSOT** — the same class of "someone missed one" drift
  the repo keeps paying for (`SCOPED_MATVIEWS`, `declared_label`, the six `magistrate_current`
  copies). It has already produced visible residue: 112's header and `risk_parity.harness.ts`
  both still say *"the 12 risk checks"* against thirteen.
- **There is no LICENSE file** (verified 2026-08-18: `ls LICENSE* COPYING*` is empty). The repo
  is public on GitHub (`atanasster/electionsbg`) and the README says "open-source platform", but
  with no license it is *all rights reserved* by default. Any journalist, researcher or SIGMA
  engineer "adopting" the flag list is relying on goodwill, not a license.
- **There is no `/procurement/methodology` page.** The elections side has
  `/risk-analysis/methodology` and `/risk-score/methodology`; procurement's methodology lives only
  in the risk-v2 plan and code comments. The 2026-05-13 procurement article covers the
  MP-connection matching, not the risk index.
- **There is no *published* flag catalog.** `CHECK_CATALOG` (above) is the closest thing and is
  ~60% of the fields this plan needs — but it lives inside a React screen component, imports
  `lucide-react` icons, covers the contract grain only, and is not emitted anywhere. Externally
  the 13 + 4 checks are enumerable only by reading two TS files and two SQL migrations.

## 2. Scope — what "open-source the methodology" delivers

Five artifacts, one of them the SSOT that makes the other four stay true:

1. **A license.** MIT for the methodology spec + reference implementation (maximise adoption;
   SIGMA and journalists can use it without asking). Add `LICENSE` + a `METHODOLOGY.md` pointer —
   **and `package.json`, which is `"private": true` with no `license` field at all**; a
   `LICENSE` file alone leaves every tool that reads package metadata still saying "UNLICENSED".
   Decide `private` deliberately (it only gates accidental npm publish; keeping it true is fine,
   but say so).

   **The dual boundary must be stated by PATH, not by adjective.** "The data corpus stays under
   its own terms" is not actionable for the adopter it is written for. `LICENSE` (or a
   `LICENSING.md` beside it) enumerates: code + spec under MIT (`src/**`, `scripts/**`,
   `functions/**`, `docs/**`, `METHODOLOGY.md`, the compiled `risk-flags.json`); republished
   government data under each source's own terms, which the README already documents per source
   (the КЗП entry is the worked example). Without the path split, a SIGMA engineer cannot tell
   whether MIT reaches the corpus, and the safe assumption they will make is "no" — which forfeits
   the adoption the license exists to buy.
2. **A machine-readable flag catalog** (`flagCatalog`) — one declarative source for every flag's
   id, grain, bit, legacy weight, threshold, legal basis, citation, availability rule, label key
   and framing. This is the "library" — the thing OCP Cardinal is, in miniature, but
   BG-calibrated. **It is a relocation and widening of `CHECK_CATALOG`, not a new object** (§3b);
   building a second catalog beside it would add a seventh copy to the six in §1b.
3. **The published spec** — a generated "red-flags handbook": how to read a flag, per-flag
   reference, legal thresholds, base-rate calibration, reconciliation rules, known limits.
4. **The reference implementation** — the two pure scorers, published as reusable modules with
   their own README and a stable, documented API (they are already pure and React-free — the
   packaging is the work, not the code).
5. **A public surface on the site** — `/procurement/methodology` (BG + EN, prerendered, sitemap),
   a downloadable compiled `risk-flags.json`, a "cite this flag" anchor behind every flag chip,
   and the `/data` map link. Plus the **OCP Cardinal / iMonitor 2.0 alignment table** (§5).

Explicit **non-goals**: no new risk rules (that is `procurement-risk-v2.md`); no change to how
any flag is *computed* (the scorers' logic is untouched — only the declarative parts are
extracted); no new grade of any grain; no bid-level cartel screen (blocked on data, risk-v2 §7
item 7).

⚠️ **The per-contract A–F grade EXISTS and the spec must document it, not deny it.** An earlier
draft listed "no A–F contract grade" as a non-goal on the authority of risk-v2 §2. That decision
was superseded by code: `contract_risk_grade_letter()` shipped in `112` (2026-07-27), is stored as
`contract_risk_cache.grade`, is served as `risk_grade`, and is filterable from the contracts
browser via `?grade=D,E,F`. Publishing a spec that says we deliberately grade no contract, next
to a UI control that filters contract grades, is the single most quotable error this plan could
make. What §2 actually rules out — a grade **banded on the CRI** — remains true and is *why* the
shipped grade bands on the **fired count** instead: 112's header records that CRI bands put 99% of
the corpus in A/B and made **F mathematically unreachable** (the corpus maximum CRI is 60, so the
eleven most-flagged contracts in the country would read "E"). §4 carries that reasoning, together
with the PRWP-10444 "a contract is n=1" caveat that made §2 right about the underlying risk.

## 3. The flag catalog — SSOT design

### 3a. The flags to declare

**Contract grain (13, bit order is a contract — `112`):**

⚠️ **The `legacy weight` column is the additive `score`'s weight, and it is not an input to any
number a reader sees.** The published contract index is `cri = 100 × fired / available` —
**unweighted**. `computeProcurementRisk.ts`'s own header says the additive `score` *"is NOT
rendered anywhere … it survives only as a stable internal ordering key"*, and
`contractRiskFromMasks()` returns `score: 0` outright because the masks cannot carry it. So the
catalog declares these weights (112 and the TS scorer both hold copies that must not drift) but
the spec must label them **legacy sort key, not a published input**, or an external reader will
try to reproduce a CRI we do not compute. The weights that genuinely drive a published number are
the exposure ones below, and §4d discusses their evidence there — not here.

| bit | id | legacy weight | threshold / rule | legal basis or citation |
|---|---|---:|---|---|
| 0 | `debarred` | 80 | contractor on АОП "Стопански субекти с нарушения" | АОП debarment register |
| 1 | `mpConnected` | 50 | sitting/former MP tie (company_politicians) | — |
| 2 | `pepConnected` | 40 | non-MP official tie (pep_connected) | — |
| 3 | `awarderConcentration` | 30 | ≥30% of awarder lifetime spending | — |
| 4 | `amendment` | 10 | `tag = contractAmendment` | — |
| 5 | `annexGrowth` | 30 | signed→current ≥ +50% | ЗОП чл.116 ал.2 (cumulative) |
| 6 | `newFirmWinner` | 30 | award − founded < 12 months | — |
| 7 | `splitPurchase` | 25 | all-direct, each ≤ чл.20 ал.4 ceiling, Σ over | ЗОП чл.20 ал.4 / чл.21 |
| 8 | `appealUpheld` | 70 | КЗК уважена | КЗК decision |
| 9 | `weakCompetition` | 40 | 1 bid (suppressed when the **2-digit CPV division**'s single-bid share ≥0.8, or CPV `22112`) **or** below the **5-digit CPV prefix** median (median ≥3) | EC Scoreboard; чл.79 ал.1 т.3 |
| 10 | `directAward` | 20 | procedure bucket `direct` or no-notice rationale | EC Scoreboard "no calls for bids" |
| 11 | `shortTenderPeriod` | 15 | window < 14 days | EU Dir 2014/24 Art. 27 |
| 12 | `nkidMismatch` | 20 | CPV division disjoint from declared НКИД (naceCpv crosswalk) | — |

**Tender grain (4):** `nonOpenProcedure` (no-notice procedure type) · `rushedDeadline`
(<12 days, competitive tiers only — low-value tiers are statutory, not anomalous) ·
`shortDecisionPeriod` (<4 days) · `awardOverEstimate` (awards >110% of estimate).

**Exposure grade (`041`) — TWO different weight sets, not one.** Availability-weighted mean,
A–F banded via the shared `risk_grade_letter()`:

| role | weights | components | centralised? |
|---|---|---|---|
| **awarder** (buyer) | connection `.35` · singleBid `.15` · direct `.30` · concentration `.20` · upheldAppeal `.30` | 5 | ✅ `awarder_risk_grade_frac()`, the only copy |
| **supplier** | connectedSelf `.30` · singleBid `.25` · direct `.20` · buyerConcentration `.25` | 4 — **no `upheldAppeal` arm at all** | ❌ inline literals in `supplier_risk_grade()` |

Three differences the catalog must carry and the spec must state:

- **The supplier arm has no upheld-appeal component.** A КЗК decision is an integrity signal about
  the *buyer's* procedure; it is not folded into the supplier grade.
- **The supplier arm still carries the PRE-rebalance direct/singleBid weights** (`.20`/`.25`).
  risk-v2 §8's rebalance (direct `.20`→`.30`, singleBid `.25`→`.15`) moved the BUYER weights only.
  risk-v2 §0a notes the supplier set — *"appear only once and were left alone — no duplication to
  fix"* — but that is an observation about **copies**, not a decision about **values**, which is
  why the open question below is still open. Either way §4d must scope its EC-Scoreboard evidence
  to the buyer grade, or it describes a change that was never applied to half the surface.
- **The component KEYS differ** (`connection`/`concentration` vs `connectedSelf`/
  `buyerConcentration`), and the supplier's `connectedSelf` is unconditionally available — its
  `.30` sits in the denominator on every row, unlike every other component.

**Open question this surfaces, and the plan should not close it silently:** is the supplier arm's
un-rebalanced weight set a deliberate exception (the Scoreboard argument is about buyers' choice
of procedure, which a supplier does not make) or drift that survived §8?

**Resolved for T2 by NOT resolving it, which is the honest option.** The handbook publishes both
weight sets as facts, states the three differences, and says in as many words that the rationale
for the supplier set is undecided and under review. Inventing a rationale would put a claim we
cannot support into the one document written to be quoted; suppressing the difference would let a
reader assume the Scoreboard evidence covers a grade it never touched. `risk-flags.json` carries
the same statement in `exposureGrades.supplierOpenQuestion`, and `gen_risk.test.ts` fails if
either loses it. The underlying question is still a decision for whoever owns the exposure
grades — it is simply not a blocker on publishing, because "we have not decided" is publishable
and a fabricated reason is not.

**Neutral disclosure (never scored):** `ngoForeignFunded` (direct/connected, `080`).

### 3b. The SSOT file and what it generates

**T1 is a relocation, not a greenfield.** `CHECK_CATALOG` (`RiskBadges.tsx`) already declares
`key` · `icon` · `labelKey` · `whyKey` · `naReasonKey` · `ref` for all 13 contract checks, ordered
heaviest-first, with a `satisfies` compile-time exhaustiveness guard. The work is to move that
data out from under the UI and widen it — **not** to author a parallel object, which would make
the count in §1b seven.

**The blocker is `lucide-react`.** `CHECK_CATALOG` imports icon components, so a `tsx` generator
cannot import it as it stands. The split is therefore load-bearing rather than tidy-up:

- **`src/lib/riskFlagCatalog.ts`** — React-free, no icon imports, importable by the SPA, by
  `scripts/**` generators, by the harnesses and by vitest. It sits beside
  `src/lib/contractRiskMask.ts`, which already holds `RISK_MASK_BITS` and is already imported by
  `risk_parity.harness.ts` — so this is a proven import direction, not a new one.
- **`RiskBadges.tsx`** keeps a thin `Record<RiskComponentKey, LucideIcon>` and reads everything
  else from the catalog. Its `satisfies` exhaustiveness guard moves onto that record, so the
  compile-time property §1b relies on survives the move rather than being re-invented as a test.

Declared per flag: `id`, `grain` (`contract` | `tender` | `exposure`), `role` (exposure only:
`awarder` | `supplier`), `bit` (contract only), `legacyWeight` (contract), `weight` (exposure),
`threshold` (typed, e.g. `{ kind: "gtePct", value: 0.5, legalBasis: "ЗОП чл.116 ал.2" }`),
`citation`, `labelKey` / `whyKey` / `naReasonKey`, `framing` (the OCP a/b/c line or the "for
review" line), and `availability` (one-line rule).

**`labelKey` must be a declared field, never derived.** Five of the thirteen i18n keys break any
mechanical camelCase→snake rule:

| flag id | actual key |
|---|---|
| `newFirmWinner` | `risk_flag_new_firm_long` |
| `awarderConcentration` | `risk_flag_concentration_long` |
| `shortTenderPeriod` | `risk_flag_short_period_long` |
| `splitPurchase` | `risk_flag_split_long` |
| `nkidMismatch` | `risk_flag_nkid_long` |

Generating key *names* instead would orphan already-translated BG/EN copy and trip
`scripts/i18n/key_usage.test.ts` / `npm run i18n:prune` in both directions at once — the old keys
become unreachable, the new ones have no call site the scan can see. `genRiskI18n` therefore
audits and back-fills **values** against declared keys; it never renames.

**✅ SHIPPED (T1).** What was built, and where it differs from this section's first draft:

| Side | Mechanism | Where |
|---|---|---|
| TypeScript | **direct import** — no generator | the two scorers, `contractRiskMask.ts`, `RiskBadges.tsx` |
| SQL (033 / 041 / 112) | **static drift gate** — no generator | `scripts/risk/risk_catalog_sql_parity.test.ts` |
| i18n keys | asserted against both corpora | `src/lib/riskFlagCatalog.test.ts` |
| the handbook + `risk-flags.json` | **generated** (`npm run gen:risk`) | T2 |

**`genRiskTs` was not built, deliberately — generating TypeScript from TypeScript is strictly
worse than importing it.** The catalog is a TS module, so the scorers, the decoder and the chip
ledger read the values directly; there is no build step to run and no window in which a generated
copy can be stale. `RiskComponentKey` and `TenderRiskKey` are now DERIVED from the catalog and
re-exported from their old modules, so the ~15 files importing them are untouched.

**`genRiskSql` became a GATE rather than a generator, and this is the resolution of the threshold
seam below.** These three migrations are *applied artifacts with deploy semantics* — 112 rides a
~90-minute contracts reload or `apply_functions.ts` plus a full `rebuild_contract_risk_cache()`,
041 rides `db:load:tr:pg` — so mechanically rewriting a file that is already live on Cloud SQL
risks reformatting a served function body, and buys nothing over failing the build on divergence.
The gate parses all three and checks, statically and with no database: `contract_risk_checks()`'s
name array, both mask shift-orders, 112's thirteen inline score weights, its four threshold
literals and the `22112` carve-out, 041's buyer *and* supplier weight sets (numerically — SQL
writes `0.30` where JS writes `0.3`), that the supplier arm still has no upheld-appeal component,
that the buyer weights appear only inside `awarder_risk_grade_frac()`, and 033's concentration
share and minimum-buyer-total.

So the threshold seam is closed by **enforcement rather than compilation**: the number has one
source, and a hand-edit to any SQL copy fails the build. What that cannot catch is a predicate
applying the right number the wrong way round — which is exactly what
`scripts/procurement/risk_parity.harness.ts` covers, over real rows. Measured after the
refactor: **20,000 contracts, 0 mismatches on all thirteen checks, 0 on cri/score, 0 on the mask
decoder.**

(An earlier draft said the generators "all run in `prebuild`". They must not: `scripts/prebuild.mjs`
is a `dist/` cleaner, and a build step that rewrites tracked migration files would put uncommitted
SQL under a deploy. See §8.)

**What stays hand-written and is NOT generated:** the *scoring logic itself* — the `available` /
`fired` predicates, the structural single-bid suppression, the legally-single-source `22112`
carve-out, the graded weak-competition arm, the merge rules. Generation covers the **declarative
truth** (names, order, weights, labels, citations); the code keeps the judgment.

⚠️ **Thresholds sit on a seam — resolved above by option 2 with the gate made total.** Kept
because the reasoning is what a future change has to re-read. Every threshold is
*declared* in the catalog and *also* written inside a hand-written predicate on the SQL side:
`>= 0.5` (annexGrowth), `< 12` months (newFirmWinner), `< 14` days (shortTenderPeriod), `>= 0.8`
(structural single-bid), `22112%`, `1.1` (awardOverEstimate). One is worse than a duplicate:
`structuralSingleBidShare` is an **injectable parameter** in TS (`args.structuralSingleBidShare ??
0.8`) and a hard literal in `112`. So "the build refuses to let them drift" is **not** achieved
for thresholds by declaration alone — only `risk_parity.harness.ts`'s output comparison catches
them, and only where the corpus exercises the branch. Two acceptable resolutions, and T1 must pick
one explicitly:

1. **Generate the SQL predicates' constants too** — emit a `risk_thresholds` SQL block of named
   constants (or `CREATE OR REPLACE FUNCTION risk_threshold(name) RETURNS numeric`) that the
   `f_*` predicates reference, so the number has one home on each side. Higher effort; ends the
   class.
2. **Declare thresholds as documentation-only**, enforced by the corpus-level parity harness and
   said so plainly in the spec ("the threshold values in this catalog are asserted against the
   implementation over the full corpus, not compiled into it").

**Chosen: option 2, with the caveat discharged by making the gate total rather than sampled.**
Option 1's goal is "the number has one home on each side"; the static gate delivers that for
every number that HAS a SQL copy — `annexGrowth` 0.5, `newFirmWinner` 12, `shortTenderPeriod` 14,
`weakCompetition` 0.8 (both arms), the `22112` prefix, and 033's concentration 0.3 + €100k floor,
each parsed out and compared on every test run. The three TENDER thresholds (12 / 4 / 1.1) have
no SQL copy at all — tenders have no server-side risk cache — so for those the catalog is the
only home and there is nothing to drift from. Option 2's weakness as originally stated was that it
leaned on the *corpus-sampled* parity harness, which only catches a threshold the sample happens
to exercise. It no longer does. The spec still carries the honest sentence: the threshold values
in the published catalog are **asserted against** the implementation, not compiled into it.

**The tender grain is asymmetric and T1/T2 should budget for it.** Tender flags have no bit mask,
no additive weights, no `contract_risk_cache` equivalent, no `CHECK_CATALOG` (their metadata sits
in `TenderRiskPanel.tsx`), and essentially no per-flag i18n keys — only `tender_risk_title` and
`tender_risk_note` exist today. The contract side is a relocation; the tender side is closer to
authoring.

**The bit-order rule becomes an enforced property.** `112` already says "append, never renumber,
or historic masks silently re-map." The catalog makes `bit` a declared field, asserted against a
**committed literal** in the test — the pattern `risk_parity.harness.ts` already uses against
`RISK_MASK_BITS` — rather than diffed against the previous commit, which would need git history
inside a test run.

### 3c. Versioning

`flagCatalog.version` (semver) + a committed `CHANGELOG.md` next to it. Bump on any flag add,
rename, reweight, or threshold change — never silently. A reweight (§4d below) is a **minor**
bump; a flag removal/renumber is a **major**. The site's methodology page prints the version so a
journalist can cite "flag set v1.4.0, 2026-08-18".

⚠️ **The printed version must be the version the SERVED MASKS were computed under, not the
bundle's.** `flagCatalog.version` in the bundle says what the *code* declares; every flag a reader
actually sees on a contract row comes from `contract_risk_cache`, built by the last
`rebuild_contract_risk_cache()` on that database. Those two diverge for the entire window between
a catalog deploy and a cache rebuild (§7.5) — so the naïve implementation lets the page cite
"v1.4.0" over masks computed under v1.3.0, which is exactly the citation a journalist would rely
on and the one claim we would have no way to walk back.

Fix (**shipped, T1.5**): a one-row `contract_risk_meta` table holds `catalog_version`,
`rebuilt_at` and `row_count`; `contract_risk_stamp()` is its only writer;
`rebuild_contract_risk_cache(text)` records the version its caller supplies and the bare
`rebuild_contract_risk_cache()` **clears** it. `/api/db/risk-catalog-version` serves it, and the
methodology page plus `risk-flags.json` render **that** value with its timestamp — falling back to
"not stamped" rather than to the bundle constant. A version the page cannot prove is worse than no
version.

Two properties are load-bearing and both are gated:

- **Clearing, not preserving.** A hand-run `SELECT rebuild_contract_risk_cache();` in psql leaves
  no version rather than the previous one. A stale stamp asserts the served masks were computed
  under a flag set they were not — strictly worse than absence, and the likelier failure since
  that bare call is what every existing runbook says to type.
- **One TS entry point.** `scripts/db/lib/rebuildRiskCache.ts` is where `CATALOG_VERSION` reaches
  SQL; the three call sites (`load_pg.ts`, `refresh_risk.ts`, `kzk_dependents.ts`) go through it,
  because a missed one would not fail — it would just silently stop stamping.

## 4. The spec — what the handbook contains

Generated from the catalog + the prose already written in `procurement-risk-v2.md`, restructured
for an external reader:

### 4a. How to read a flag (the framing contract)

Adopt OCP (2024) p. 13 verbatim: a fired flag means the behaviour is *"a) not at all illicit or
suboptimal; b) not illicit, but suboptimal in terms of value for money…; or c) illicit."* — the
two innocent explanations before the guilty one. State explicitly that we are a **public
publisher, not a monitoring institution with a legal mandate** (risk-v2 §2), and that the CRI
denominator is *available* checks, never all checks — a data-poor contract is not penalised.

### 4b. Per-flag reference

One row per flag: id, grain, definition, data source, availability rule, threshold + legal basis,
base rate where measured, and the framing line. **Weights are NOT in this table** — the contract
CRI is unweighted (§3a), so a weight column here would invite a reader to reproduce a number we
do not publish. The additive weights appear once, in a clearly-labelled "legacy sort key" appendix
with the PwC/Ecorys ordering caveat; the weights that drive a published number are the exposure
ones and live in §4d. The base-rate numbers already exist in `procurement-risk-v2.md`
§6b-results (non-open 14.3%; tier-conditional rushed deadline <1%; award-over-estimate 4.1%;
split 0.09%; exactly-50.000% annex cohort) — they are the single strongest trust signal and must
be in the spec, not just the plan.

### 4c. Legal thresholds (primary-source, dated)

- **ЗОП чл.116 ал.2** — the 50% cap is **cumulative** ("общата стойност на измененията"),
  stricter than EU Art. 72; the ал.3 inflation indexation carries its *own* separate 50% that
  does **not** count against ал.2; чл.116 ал.6 exempts sectoral awarders. (The `annexGrowth` flag
  can detect the cumulative Δ but not which ground it hit — say so.)
- **ЗОП чл.20 ал.4** ceilings, date/category-dependent (risk-v2 §7 **item 4**'s ceiling table —
  §7 is a numbered list, it has no `§7.4` subsection), and чл.21's
  anti-splitting rule vs the legal recurring-need pattern the data cannot distinguish.
- **ЗОП чл.79 ал.1 т.3** — textbooks (CPV `22112xx`) are single-source by law, not by choice.
- **EU Dir 2014/24 Art. 27** — the 14-day open-procedure minimum; but note our tender `rushedDeadline`
  is tier-conditional at <12 days, *not* the flat 14-day legal minimum (risk-v2 §6b).
- Explicit: **the 10%/15% de minimis is EU, not ЗОП** — not transposed; do not attribute to ЗОП.

### 4d. Exposure-grade weights and their evidence

The **buyer** weights `.35/.15/.30/.20/.30` and the EC Single Market Scoreboard table that
justified raising `direct` and lowering `singleBid` (risk-v2 §8) — with the disclaimer that the
Scoreboard does **not** measure corruption, and the median-vs-mean caveat. Measured effect, worth
publishing because it is the honest scale of a reweight: of 1,149 ranked buyers 234 changed grade
(226 better, 8 worse) and the two worst were unchanged.

⚠️ **Scope every sentence here to the BUYER arm.** The supplier grade was not rebalanced and
carries `.30/.25/.20/.25` with no upheld-appeal component at all (§3a). Presenting the Scoreboard
argument as "the exposure weights" would attribute to the supplier grade a change it never
received — and the supplier grade is the one a *company* reads about itself, which is the higher
defamation exposure of the two. State both sets side by side, state that the supplier arm is
un-rebalanced, and state the §3a open question's resolution once it is made.

This is the part most likely to be copied wholesale; document it so it is copied *correctly*.

### 4e. Reconciliation rules (the part that rarely gets documented)

The data-quality rules that make the flags trustworthy, currently buried in scripts/CLAUDE.md:
the four-feed cross-source dedup (release_id prefixes, no summing across feeds); the УНП backfill
(OCDS carries none); the annex identity resolution K2→K1 with its three guards (±12% continuity,
15× cap, supplier membership); and the "never score missing data" rule (PwC/Ecorys France/
Netherlands finding). These are the part that is genuinely hard to reproduce — anyone can copy a
threshold, almost nobody documents how they kept the corpus from double-counting — and they are
what a reader needs in order to trust any figure the flags are computed over.

### 4f. Known limits (published honestly)

The Decarolis & Giorgiantonio (2022) finding (validated red flags uncorrelated/negatively
associated with corruption; best F=0.597), the Goodhart risk (a published flag is a spec for
evasion — OECD 2024 Hungary), and the OCP transparency-vs-adaptation tension — we are on OCP's
side **deliberately**, and we say why. Plus construct validity (risk-v2 §9). Publishing these is
what distinguishes a methodology from a press release.

### 4g. The three A–F grades, and what each is banded on

Three different letters are published, on three different grains and three different bases. A
reader who assumes they are one scale will mis-read all three, and an external adopter who copies
one banding onto another grain will produce nonsense. State the table explicitly:

| grade | grain | banded on | function |
|---|---|---|---|
| **awarder exposure** | buyer entity, over all its contracts | availability-weighted mean of 5 share components, 0–100 | `awarder_risk_grade()` / `risk_grade_letter()` (041) |
| **supplier exposure** | contractor entity | same shape, 4 components, un-rebalanced weights | `supplier_risk_grade()` (041) |
| **contract** | one contract | the **fired COUNT** (A = 0 … F = ≥5), *not* the CRI | `contract_risk_grade_letter()` (112) |

Two things must be said in the reader's own terms:

- **Why the contract grade is not banded on the CRI.** The CRI is a 23-value lattice, not a
  continuous score — `fired` never exceeds 6 and `available` only varies 7–11. Fed to 041's bands
  it put 99% of the corpus in A/B and made **F mathematically unreachable**: the corpus maximum
  CRI is 60, so the eleven most-flagged contracts in the country would have read "E". A grade
  nobody can score is not a grade. Banding on the fired count gives every letter a real population
  and a one-sentence meaning ("F = five or more checks fired").
- **Why a contract letter is weaker evidence than an entity letter, published anyway.** risk-v2
  §2's argument stands and belongs in the spec verbatim: a contract is n=1, and PRWP 10444's own
  words are that *"CRIs at the individual contract level may be quite noisy"* while organisational
  aggregation *"identif[ies] more robust patterns."* The contract grade exists because the
  contracts browser needs a sortable, filterable severity handle (`?grade=D,E,F`), and the spec
  says so plainly rather than implying an evidential parity it does not have.
- **The known non-monotonicity, not hidden.** Because the CRI divides by a varying denominator it
  is *almost* monotone in `fired` but not quite — a 4-of-11 contract scores 36 while a 3-of-8
  scores 38. The grade itself is unaffected (it reads `fired` directly) and the leaderboard orders
  by `fired` first for this reason.

## 5. OCP Cardinal / iMonitor 2.0 alignment

A committed mapping table (generated from the catalog) that names, per flag, the closest
**OCP *Red Flags for Integrity* (2024)** R-flag id and the **iMonitor 2.0 / OpenTender**
indicator, plus a "we differ" note:

**✅ VERIFIED AND SHIPPED (T3).** Both source documents were read rather than recalled, and the
mapping now lives in the catalog (`ocp` / `imonitor` on every flag, both REQUIRED) and is emitted
into the handbook and `risk-flags.json`. The verification itself was the tier, and it changed the
answer:

| the plan guessed | the source says |
|---|---|
| `splitPurchase` → **R049** "contract splitting" | R049 is **"Direct awards below threshold"** — a SINGLE award, nearer our `directAward`. The multiple-awards-around-a-threshold flag is **R055**; R011 is the named concept. |
| `awardOverEstimate` differs from **R016** "under-valuation" | R016 is **"Tender value is higher or lower than average for this item category"** — a comparison against PEERS, which is our normalcy panel. The estimate-versus-award flag is **R031**. |

Both wrong ids were plausible, which is the point: nobody would have caught them by reading the
table. Method, recorded in `ALIGNMENT_SOURCES` so it can be re-run: **`pdftotext -layout`** — the
mode that keeps the two-column Definition tables apart, and therefore the only one that shows what
a flag actually says; iMonitor's Table 2 gives 11 indicators, scored 0/50/100 rather than boolean.
The 73 titles are committed at `scripts/risk/__fixtures__/ocp_2024_flags.json`, so a mapping is
re-checked by a test rather than by re-reading the PDF.

Findings worth carrying beyond the table:

- **Four of our seventeen checks map to nothing in either scheme** — `mpConnected`,
  `pepConnected`, `newFirmWinner` and `nkidMismatch`. The political-connection pair being
  unmapped in both is the sharpest statement of what is local here, and it is also the part
  making the strongest claim about named people.
- **OCP publishes R062 "Decision period extremely long" beside R061 "extremely short".** So the
  one-sidedness of our `shortDecisionPeriod` is a choice rather than the standard — independent
  corroboration of the caveat risk-v2 already recorded about that flag's direction.
- **iMonitor bands every indicator 0/50/100 where we fire booleans**, and its advertisement-period
  indicator is banded per country — which is exactly the re-cut risk-v2 §6a says our flat 14-day
  `shortTenderPeriod` needs.
- **`unmapped` now means "somebody read the source and found no equivalent"**, with a note saying
  what was searched. `gen_risk.test.ts` rejects a note under 20 characters, which is what caught
  five bare "VERIFIED UNMAPPED." entries that told a reader nothing.

The point of the table is **comparability**, not compliance: it lets an OpenTender/iMonitor user
see our BG-calibrated flags through their lens, and it documents the two places we deliberately
deviate (single-bid suppression, one-sided over-estimate). It also gives TI-Bulgaria's iMonitor
deployment a concrete bridge to our corpus.

⚠️ **This warning is DISCHARGED — kept because the rule it states outlived the task.** It read
"every R-id above is UNVERIFIED and T3 must verify each one before the table ships", and it was
right: both PDFs were read, and two of the ids above were wrong. What the verification also
showed is that getting the ID right is not the whole job — three *supporting claims* about what
those flags SAY were wrong even where the id was correct (R049 does cover multiple awards; R014
measures to bid opening, not to the submission deadline; and `pdftotext -layout` does not fail on
the OCP PDF — that reading came from piping the command into `head`, which SIGPIPEs it). All
three were published in the handbook before review caught them.

So the standing rule is stronger than the original warning: **an alignment claim is not verified
until the source's own sentence has been read, and `unmapped` is an honest cell while a
plausible-looking wrong id is not.** `scripts/risk/__fixtures__/ocp_2024_flags.json` commits the
73 flag titles verbatim so re-checking a mapping is `npm run test:unit` rather than a 2 MB PDF
read — which is what let the three false claims through a green suite in the first place.

## 6. Publishing surface

1. **`/procurement/methodology`** — mirror the elections `/risk-analysis/methodology` screen
   pattern. Renders §4a–§4g and the stamped version (§3c). Serves the crawlable text that
   currently exists nowhere on the site. **Three artifacts, not two** (the dashboard-hub rule):
   - a **prerendered** static page, BG + EN, `preloadData` where needed;
   - a sitemap `<loc>` in **BOTH** `route_defs` lists — `scripts/sitemap/families.data.test.ts`
     fails a `<loc>` with no `dist/<path>/index.html`, and the sitemap is committed while `dist/`
     is not, so run that gate **after** `npm run build`;
   - its **own `og:image`** — without one the share card falls back to the site-wide default,
     which is the failure this page can least afford (it is the artifact meant to be *shared* at
     journalists).

   URL form: no trailing slash (`/procurement/methodology`), and the EN mirror is
   `/en/procurement/methodology`. Both the canonical and the `hreflang` must name the no-slash
   form; the only slash-keeping root is the bare `/`, and `/en/` is **not** one of them.
2. **`risk-flags.json`** — the compiled catalog, downloadable from the methodology page and from
   `/data/sources`, versioned (the stamped version, §3c), with the alignment table embedded.
   **Ship it from `public/`, not the bucket.** It is a small committed build artifact whose whole
   value is being a stable citable URL; putting it in the bucket drags in `bucket_sync_paths.ts`
   exclusions and the `-x` arms, and buys nothing. If that is ever revisited, both halves of the
   sync guard have to move together.
3. **Citation anchor per flag** — every flag chip on the contract/tender/exposure surfaces links
   to its `/procurement/methodology#<flag-id>` anchor (the chip's existing tooltip already names
   the flag; the link makes the methodology one click away instead of zero).
4. **`/data` map + sources** — `ds:procurement` already exists; add the methodology as a cited
   source with the license, and the lateral-edge work already planned
   (`data-hub-lateral-edges-v1.md`) gets a `methodology` kind when it lands.
5. **`LICENSE` + `CONTRIBUTING`** — MIT with the path-scoped boundary from §2.1, plus a short
   "citing the methodology" block and an explicit **fitness disclaimer**: the flags support
   review, they are not a finding of wrongdoing and are not fit for a legal conclusion (§9).

## 7. Sequencing

| Tier | Deliverable | Depends on | Notes |
|---|---|---|---|
| **T0** | `LICENSE` (MIT, path-scoped) + `package.json` `license` field + `METHODOLOGY.md` pointer + confirm repo public | — | Half a day; the legal prerequisite for everything else |
| **T1** ✅ | `src/lib/riskFlagCatalog.ts` (relocated + widened `CHECK_CATALOG`) + direct imports + the two vitest drift gates (§8) | T0 | Touched `RiskBadges.tsx`, `contractRiskMask.ts`, both scorers **and** `derived.ts`/`by_ns.ts` (two further copies found during the work) — not a UI-free refactor. Threshold resolution picked (§3b) |
| **T1.5** ✅ | Version stamping: `contract_risk_meta` + `contract_risk_stamp()` + a `rebuild_contract_risk_cache(text)` overload + `/api/db/risk-catalog-version` | T1 | T4 cannot print an honest version without it (§3c). An OVERLOAD, not a defaulted argument — the latter would make the existing no-arg call ambiguous, inside `load_pg.ts` mid-reload |
| **T2** ✅ | `npm run gen:risk` → `docs/methodology/procurement-risk-flags.md` + `public/risk-flags.json` | T1, T1.5 | Docs generated, not hand-copied, with a `--check` staleness gate. The i18n audit lives in `riskFlagCatalog.test.ts` rather than a `genRiskI18n` — the keys are declared, so what is needed is a check that they RESOLVE in both corpora, not a generator |
| **T3** ✅ | OCP/iMonitor alignment, in the catalog and both artifacts (§5) | T2 | Both PDFs read; two of the plan's own guessed R-ids were wrong. `pdftotext -layout` extracts NOTHING from the OCP PDF — use plain `pdftotext` |
| **T4** | `/procurement/methodology` page (prerender + both sitemap lists + own og:image) + per-chip citation links + download | T2, T3 | See §6.1's three artifacts |
| **T5** | (optional) publish the two scorers as a standalone subpackage with README | T1 | Only if SIGMA/others express interest; the catalog JSON already covers most use |

T0 and T1 are the load-bearing ones; T2–T4 are presentation over them. T1 first because it is
what makes the published spec *stay true* instead of becoming a second hand-maintained copy.

### 7.5. Publishing a catalog change — the deploy path

A generator that rewrites a migration is only half a change; nothing a reader sees moves until the
SQL reaches the serving database **and** the derived cache is rebuilt. Both halves have documented
traps, and neither is carried by `npm run deploy` (hosting only) or `npm run deploy:db` (which
ships `functions/` code — a different thing from a Postgres function).

**If `041` changed (an exposure weight):**

```bash
# 041 is applied ONLY by load_tr_pg.ts — a plain db:load:pg will NOT pick it up.
npm run db:load:tr:pg:cloud
# …or surgically, in which case rebuildRiskGradeScoped() must be re-fanned by hand afterwards:
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 041_procurement_risk_grade.sql
```

risk-v2 §0a carries this as its own ⚠️ and it is the trap most likely to produce "green locally,
stale on prod": the weight change is committed, the harness passes, and every awarder and supplier
grade on the site keeps serving the previous vintage at a 200.

**If `112` changed (a bit, a threshold, the `contract_risk_checks()` name list, the score
weights):**

```bash
# 112 is applied by db:load:pg — a ~90-minute cloud contracts reload. For a
# function/threshold-only change, apply surgically instead:
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 112_contract_risk_cache.sql
# …then REBUILD, or the served masks stay on the old definition indefinitely.
# Pass the catalog version — the BARE form deliberately clears the stamp (§3c),
# so a hand-run without it leaves the methodology page unable to attribute the
# masks it is serving. `CATALOG_VERSION` is in src/lib/riskFlagCatalog.ts.
psql "$DATABASE_URL" -c "SELECT rebuild_contract_risk_cache('1.0.0');"
```

The rebuild is what moves `cri`, `fired`, `grade` and both masks on 407k rows (~36 s locally).
Skipping it is invisible to every row count — the table is full, the API answers, the chips
render, and they are computed under the previous catalog version. **This is the exact failure
§3c's version stamp exists to make visible**, which is why T1.5 precedes T4.

⚠️ Earlier drafts of this runbook told the operator to type the BARE
`SELECT rebuild_contract_risk_cache();` — while §3c named that same call as the likeliest way to
lose the stamp. Both cannot be right. The stamped form is the one to type; the bare form exists
so that a rebuild which cannot name its version clears the claim instead of inheriting a stale
one.

**A bit RENUMBER is not deployable at all**, and the spec should say so as a property of the
format rather than a warning: historic masks re-map silently, so `bit` is append-only (§3b) and a
renumber is a **major** version bump plus a full rebuild before any reader sees a mask.

Order for a change spanning both: SQL → rebuild → `deploy:db` (if a route field changed) →
`deploy`. Hosting last, so the bundle never advertises a catalog version the database cannot
serve.

## 8. Tests & gates

⚠️ **Gate placement first, because an earlier draft got it wrong twice.** "The build fails on
drift" was not achievable as written: `scripts/prebuild.mjs` is a `dist/` cleaner and does nothing
else, and `firebase.json`'s predeploy runs only `lint`, `budget:test`, `ai:test`, `build` —
**not** `risk:test`, **not** `risk:parity`, not `test:unit`, not `test:data`. The risk harnesses
are standalone `tsx` scripts behind `npm run risk:test` / `risk:parity`, and `risk_parity` needs a
Postgres with a populated `contract_risk_cache` to run at all. So the split is:

| gate | home | why there |
|---|---|---|
| catalog ↔ source-text drift (`112`/`041`/`033` literals, bit order, i18n keys, generated docs) | **vitest** — `scripts/risk/risk_catalog_sql_parity.test.ts` + `src/lib/riskFlagCatalog.test.ts` ✅ | Static, no database, ~0.3 s. Sibling gates: `gen_sql/shlyo_query_fold.test.ts`, `entryGraph.test.ts`, `key_usage.test.ts`. The TS constants need no gate at all — they are imports (§3b) |
| catalog ↔ *computed output* over real rows | **the existing harnesses** (`risk_parity.harness.ts`, `risk_scorer.harness.ts`, `kzk.harness.ts`) | Needs Postgres and the corpus; already the right tool, already exists |

Only the first can be described as "fails the build". The second is the deeper check and stays
operator-run — say so, rather than implying CI covers it.

- **Parity (vitest)** — catalog == scorer constants == `RISK_MASK_BITS` == `112`'s bit array and
  `contract_risk_checks()` name list == `112`'s score weights == `041`'s buyer *and* supplier
  weights == declared i18n keys == generated docs. A one-line edit to a weight in
  `computeProcurementRisk.ts` that bypasses the catalog fails here.
- **Parity (harness)** — unchanged in kind: `risk_parity.harness.ts` still compares every
  component's available/fired bit and the derived `cri`/`score` over real contracts. Under
  resolution 2 of §3b's threshold seam **this is the only enforcement thresholds get**, so it must
  stay in the release checklist even though CI cannot run it.
- **Append-only bit order** — the catalog's `bit` field is asserted against a **committed
  literal** (the pattern `risk_parity.harness.ts` already uses against `RISK_MASK_BITS`), not
  diffed against the previous commit — a test that needs git history is a test that fails in the
  wrong environments.
- **Exhaustiveness** — every flag in the catalog appears in: the scorer (as a component), the
  docs, the i18n corpora (bg **and** en), the bit map, and the alignment table (an `unmapped` cell
  counts; an absent row does not). A new flag fails until all five are registered — the
  `SCOPED_MATVIEWS` / `declaration_filed_position.data.test.ts` pattern. **`RiskBadges.tsx`'s
  `satisfies` guard is preserved through T1** rather than replaced by this: a compile error naming
  the missing key beats a test failure, and it is the gate that already works.
- **Threshold provenance** — every threshold carries a `legalBasis` or `citation`; a bare number
  fails. (Kills the "14 days is legal minimum not risk threshold" class of drift risk-v2 §6a hit.)
- **Version bump** — a catalog change with no version bump and no CHANGELOG line fails.
- **No SQL drift** — every literal `033`/`041`/`112` holds that the catalog also declares is
  parsed out and compared. **No SQL is generated** (§3b), so what stops a hand-edit is this gate
  failing, not a regeneration overwriting it. Its own §"the gate discriminates" block mutation-
  tests the primitives, because a drift gate that quietly stops matching is worse than none — the
  first cut of it passed eleven realistic single-value drifts, including a 10× move on the
  concentration floor and the buyer weight rebalance run backwards.

## 9. Risks & open questions

- **Goodhart / adaptation.** Decarolis is the empirical case that a published flag is a spec for
  evasion, and the OCP transparency thesis and the adaptation finding are in direct conflict.
  We are on OCP's side — say so deliberately (risk-v2 §9 already frames this). The mitigation is
  the same one risk-v2 chose: flags fire *for review*, exposure is entity-grain, and the normalcy
  panel stays judgment-free.
- **Defamation posture.** Publishing a flag catalog makes the accusations *more* copyable. The
  a/b/c framing and the "public publisher, not a mandate-holding monitor" line are load-bearing;
  the license should disclaim fitness-for-a-legal-conclusion. Do not weaken the framing in the
  name of brevity.
- **Maintenance.** A published spec is a promise. The SSOT + generators are what make it
  affordable; without T1, open-sourcing is a one-time dump that drifts immediately.
- **License choice.** MIT (methodology) maximises adoption by the exact actors we want to
  reuse it (SIGMA, TI-Bulgaria, journalists, researchers). AGPL would protect the *code* but
  this artifact is a spec + JSON + a pure function — viral protection buys nothing here. Decision
  is MIT; the data corpus stays under its own separate terms.
- **Open:** is the supplier exposure arm's un-rebalanced `.30/.25/.20/.25` a deliberate exception
  or drift that survived risk-v2 §8? (§3a.) **This one blocks T2** — the handbook cannot describe
  the exposure weights until it is answered, and answering it either way is a paragraph.
- **Open:** does `/procurement/methodology` consolidate the *six* existing methodology pages into
  one `/methodology` hub, or stay a sibling? The site already carries
  `/risk-analysis/methodology`, `/risk-score/methodology`, `/benford/methodology`,
  `/where-did-votes-go/methodology`, `/budget/methodology` and
  `/governance/sectors/methodology` — this is a seventh, and "two elections pages" (an earlier
  draft's framing) understates the consolidation question by a factor of three. Out of scope here;
  the risk-v2 §4 vocabulary contract already spans several of them.
- **Open:** the exactly-50.000% annex cohort (risk-v2 §0b) — the spec references it as a
  *finding*, but whether it also ships as a scored input is `procurement-risk-v2.md`'s decision,
  not this plan's.

## 10. Sources

- OCP, *Cardinal — an open-source library to calculate public procurement red flags* (Jun 2024).
  <https://www.open-contracting.org/2024/06/12/cardinal-an-open-source-library-to-calculate-public-procurement-red-flags/>
- OCP, *Red Flags for Integrity* (2024, 73 flags) and (2016, 60 flags).
- iMonitor D2.2 *Risk Assessment Methodology* (2024 & 2026 eds.) — Opentender indicator list +
  country calibrations. ⚠️ PDFs defeat text extractors; `pdftotext -layout`.
- Fazekas, Poltoratskaia & Tóth, *Corruption Risks and State Capture in Bulgarian Public
  Procurement*, World Bank PRWP 10444 (2023). ⚠️ `govtransparency.eu` serves an expired TLS cert.
- Decarolis & Giorgiantonio, EPJ Data Science 11:16 (2022).
- PwC/Ecorys, *Identifying and Reducing Corruption in Public Procurement in the EU* (2013) —
  the only source with measured per-flag weights. ⚠️ Wayback only.
- EC Single Market Scoreboard, public procurement, 01/2024–12/2024.
- OECD (2024), Hungary public procurement review, p. 65.
- Repo: `docs/plans/procurement-risk-v2.md` (the methodology), `docs/plans/nkid-cpv-mismatch-v1.md`,
  `docs/plans/cross-linking-strategy-v2.md` §3 move 3, `competitive-review-2026.md`.
