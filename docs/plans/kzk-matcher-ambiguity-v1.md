# КЗК matcher ambiguity — closing the outcome gap without a crawl — v1

**Status: plan only. Nothing implemented, no source file edited, no database written.**
Every figure below was measured on **2026-08-22** against local Postgres
(`postgres://postgres:postgres@localhost:5433/electionsbg`), not carried over from the
brief that commissioned it. Where a measured figure disagrees with the brief it is
flagged in place. Cloud SQL was not touched.

**Why this file exists.** `docs/plans/kzk-columnshift-and-cloud-parity-v1.md` §6.2 found
that its own problem (363 parse-fractured decisions) is at most ~15% of the outcome gap,
and named the matcher's ambiguity bucket as "the bigger lever … it belongs in a follow-up
plan; it does not belong bolted onto this one, because a matcher change and a corpus
change landing in the same rejoin make the ratchet's movement unattributable." This is
that follow-up.

**Owner surfaces.** `/procurement/appeals`, the `/tenders/:unp` appeals tile, the
`procurementAppeals` AI tool, and — the one that decides how careful this has to be —
`upheld_ocids` → the contract **Corruption Risk Index**.

---

## 0. What the measurement changed about the framing

| | the brief said | the measurement says |
|---|---|---|
| the three counters | "1,408 party-ambiguous is the largest identified contributor" | **True, and larger than it looks: 1,189 of the 1,716 "decisions matched nothing" ARE party-ambiguous acts.** The two buckets overlap by 69%. Only **164** of the 1,716 are genuine name-fold or window misses. |
| where the fix lives | "test disambiguators … date ordering, case number, subject overlap" | **Not the name fold and not the text. TIME.** Two independent temporal signals are already in the two tables and neither is used: an act cannot predate its complaint, and `kzk_case_no` is issued at intake in filing order. |
| what limits accuracy | "a wrong outcome is materially worse than a missing one" | **Correct, but the residual error is not in the pairing.** Of 110 newly-matched appeals checkable against a hand-made outcome, **2 disagree — and in both the pairing is right to within 5 days**. Both are `classifyOutcome` attributing a consolidated act's most-significant ruling to every one of its parties. |

The practical consequence: the recommended change is **two candidate-filtering rules**, not a
scoring model, and the one genuinely risky idea in this area (per-party outcome attribution
on consolidated acts) is deliberately carved OUT into §11 as a human decision, because it
changes what the risk index measures.

---

## 1. Baseline, reproduced

```bash
export PGPASSFILE="$PWD/.pgpass"
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \
  npm run kzk:rejoin -- --dry-run
```

```
→ matching 4502 decisions against 7998 appeals…
  matched 2920 appeals (43 appeals claimed by >1 act, 1408 parties with >1 candidate appeal,
                        1716 decisions matched nothing)
  writable: 0 new + 984 re-derived; 1936 hand-seeded rows left untouched
  would write: 617 отхвърлена, 356 уважена, 7 null, 4 прекратена
  ⚠ 4 hand-seeded row(s) the matcher would classify differently (NOT written)
```

Identical to the brief's figures, to the row. Table state:

```sql
SELECT count(*) FROM kzk_appeals WHERE outcome IS NOT NULL AND decision_act_no IS NULL;
```

| | |
|---|---|
| `kzk_appeals` | 7,998 (complaint dates 2020-01-02 → 2026-08-21) |
| `kzk_decisions` | 4,779; merits-eligible (`kind IS DISTINCT FROM 'определения'`) **4,502** (2020-01-09 → 2026-08-13) |
| `outcome IS NOT NULL` | 3,078 |
| **`outcome IS NOT NULL AND decision_act_no IS NULL`** | **2,098** ✅ the protected population, intact |
| `decision_act_no IS NOT NULL` | 987 |
| `data/procurement/derived/kzk_baselines.json` | `{outcomes: 3078, matched: 2920, updatedAt: 2026-08-21}` |

Coverage by the register's own status — reproduces the brief exactly:

```sql
SELECT status, count(*), count(outcome) FROM kzk_appeals GROUP BY status ORDER BY 2 DESC;
```

| status | appeals | with outcome | % |
|---|---|---|---|
| **приключено производство** | **5,043** | **2,725** | **54.0** |
| отказано производство | 1,661 | 12 | 0.7 |
| открито производство | 716 | 230 | 32.1 |
| обединено | 261 | 102 | 39.1 |
| иницииран процес | 199 | 0 | 0.0 |
| прекратено производство | 95 | 9 | 9.5 |
| оставено без движение | 19 | 0 | 0.0 |
| спряно производство | 4 | 0 | 0.0 |

**2,318 concluded appeals carry no outcome.** That is the target.

### The measurement harness

Every decomposition below comes from an **instrumented copy** of `matchDecisions`, run
offline against JSON dumps of both tables:

```bash
psql "$LOCAL" -At -c "SELECT json_agg(json_build_object('complaintNo',complaint_no,
  'complainant',complainant,'respondent',respondent,'complaintDate',complaint_date,
  'outcome',outcome,'decisionDate',decision_date,'decisionActNo',decision_act_no,
  'status',status,'unp',unp,'buyerEik',buyer_eik,'appealedAct',appealed_act)) FROM kzk_appeals;"
psql "$LOCAL" -At -c "SELECT json_agg(json_build_object('no',act_no,'ddate',decision_date,
  'pron',pronouncement,'init',initiators,'resp',respondent,'kzk',kzk_case_no,'kind',kind))
  FROM kzk_decisions;"
```

The copy carries `normalizeParty` / `splitInitiators` / `classifyOutcome` / `matchDecisions`
verbatim and adds per-event recording. **It reproduces `2920 / 43 / 1408 / 1716` exactly**,
which is the check that makes every number below comparable to the dry run. It lives in the
session scratchpad and is not proposed for the repo.

---

## 2. Decomposition — and the units really do not sum

### 2.1 The 1,408, in four different denominators

| unit | n |
|---|---|
| **`partyAmbiguous` EVENTS** (one per act × party where the window named >1 candidate appeal) | **1,408** |
| distinct **DECISIONS** involved | **1,295** |
| distinct **(party, respondent, window) GROUPS** | **877** |
| distinct **APPEALS** named in any candidate set | **2,051** |

Two things follow that the counter cannot show on its own:

- **1,191 of the 1,295 acts had EVERY party ambiguous**, so they also incremented
  `unmatched`. Only **104** resolved one party cleanly and lost another. The brief's
  warning that the counters "have different units and do not sum" understates it: two of
  them **overlap by 1,189 rows** (measured from the unmatched side, see §2.3).
- Of the 2,051 candidate appeals, **1,827 have no outcome today**, and **1,284 of those are
  `приключено производство`** — i.e. this bucket alone accounts for **55.4% of the 2,318**.
  A further 80 are already matched 1:1 by a *different* act.

State of the 2,051:

| | n |
|---|---|
| no outcome / приключено производство | 1,284 |
| no outcome / открито производство | 257 |
| has outcome / приключено производство | 201 |
| no outcome / отказано производство | 171 |
| no outcome / обединено | 69 |
| no outcome / иницииран процес | 30 |
| no outcome / прекратено производство | 15 |
| has outcome / отказано производство | 10 |
| has outcome / открито производство | 9 |
| has outcome / обединено | 4 |
| no outcome / спряно производство | 1 |

### 2.2 The shape of the ambiguity

Building the bipartite graph per `(complainant|respondent)` key — edge iff the appeal's
year is in the act's `{y, y-1}` window — and taking connected components:

| | n |
|---|---|
| components holding ≥1 act | 3,657 |
| **1 act × 1 appeal** (what the matcher resolves today) | **2,839** |
| non-trivial | **818**, covering **2,090 appeals** and **1,598 acts** |

| shape | components |
|---|---|
| 2 acts × 2 appeals | 248 |
| **1 act × 2 appeals** | **240** |
| 3 × 3 | 62 |
| 2 × 3 | 54 |
| **2 acts × 1 appeal** (the appeal-side collision) | **38** |
| 1 × 3 | 31 |
| 2 × 4 | 15 |
| 4 × 4 | 13 |
| everything else | 117 |

**The two dominant shapes need different rules**, which is why "just pair them in date
order" is not one answer: a 2×2 admits a permutation, a 1×2 does not (one of the two
appeals is resolved by an act we do not hold, or by a determination, or is still pending).

### 2.3 The 1,716 "decisions matched nothing"

| bucket | acts | of which classify `уважена` |
|---|---|---|
| **A. `initiators` AND `respondent` both NULL** — the parse fracture of the sibling plan | **363** | 125 |
| **B. every party of the act was ambiguous** — ALSO inside the 1,408 | **1,189** | 452 |
| D. the (party, respondent) pair exists but no appeal falls in the year window | 20 | 8 |
| E. both names known to the intake register, never as this pair | 54 | 24 |
| F. respondent known, complainant name unknown | 42 | 6 |
| G. complainant known, respondent name unknown (respondent fold miss) | 46 | 21 |
| H. neither name known | 2 | 0 |

Bucket A's year profile — `2020:107 2021:65 2022:42 2023:54 2024:60 2025:24 2026:11` — and
its 125 upholds match the sibling plan's §1.3 table exactly, which cross-validates both
measurements.

⚠️ **The answer to "how much of the 1,716 is the 363 versus genuine name-fold misses" is
NEITHER 363 nor the remainder.** It is 363 fracture + 1,189 ambiguity overlap + **164**
name/window misses (D+E+F+G+H). **A better name fold is worth at most 164 acts** — 3.6% of
the merits corpus — and several of those 164 are legitimately absent from the intake
register rather than mis-folded. Any plan that starts with the name fold is optimising the
smallest bucket.

### 2.4 The 43 appeal-side collisions

| | |
|---|---|
| status | 36 приключено · 3 открито · 4 обединено |
| all claiming acts classify the SAME outcome | 17 |
| the claiming acts DISAGREE | 26 |
| all claiming acts share one decision date | 1 |

Typical: `ВХР-341-24.02.2025` claimed by `АКТ-365-10.04.2025` (уважена) and
`АКТ-77-29.01.2026` (отхвърлена) — two acts **ten months apart**, so one of them is
deciding a *different* complaint by the same party against the same buyer that our intake
corpus does not carry, or carries outside the window.

⚠️ **`status = 'обединено'` does NOT explain them, and consolidation is not what that
status marks.** Only **4 of the 43** are `обединено`. Meanwhile **189 acts already resolve
more than one appeal today**, covering 401 appeals — of which only **84** carry the
`обединено` status (174 are `приключено`, 141 `открито`). So the status is neither
necessary nor sufficient for "this act was consolidated", and using it as a matcher signal
would key on a label that describes 21% of the phenomenon.

---

## 3. The ceiling — the corpus cannot answer more than ~4,662 appeals

The matcher is party-based: an act can resolve at most one appeal per party it names. So
the hard ceiling is the number of **(act, party) slots**.

```
merits acts 4,502
  with parseable initiators                   4,139
  NULL init AND resp (unmatchable for ever)     363
TOTAL (act, party) slots                      4,662
  … on acts whose pronouncement classifies    4,622
party-count histogram   1:3742  2:312  3:60  4:14  5:8  6:2  8:1
merits acts classifying to a non-null outcome 4,457 (99.0%)
```

Against a merits-eligible appeal population of **5,304** (`приключено` 5,043 + `обединено`
261 — `отказано` / `иницииран` / `открито` / `оставено без движение` are pre-merits states
for which no merits act exists yet):

| | appeals | share of the 5,304 |
|---|---|---|
| **absolute slot ceiling** | **4,662** | **87.9%** |
| slots that actually reach a candidate today | 3,008 resolved + 246 with no candidate at all | — |
| outcomes today | 3,078 | 58.0% |
| **outcomes under the recommendation (§6)** | **3,603** | **67.9%** |

Three reasons the true ceiling is below 4,662 and cannot be raised offline:

- **363 slots are gone** to the parse fracture and are only recoverable by re-crawling
  (the sibling plan's option B).
- **246 slots have no candidate appeal at all** — the act names a party/buyer pair the
  intake register does not carry in the window. Some are real intake-corpus gaps.
- **Consolidation consumes appeals without consuming slots in the other direction**: 189
  acts already resolve 401 appeals, so slots and appeals are not interchangeable.

**Do not promise "close the 2,318".** The honest statement is: the offline ceiling is
roughly **4,400–4,600 outcomes**, the recommendation reaches **3,603**, and the remaining
~800 need either the re-crawl (363) or party-name work with a poor return (164) or are
genuinely unanswerable from these two registers.

---

## 4. Disambiguators tested

Everything here is offline, reads only `kzk_appeals` and `kzk_decisions`, and needs no
crawl. Rules are named R1…R6.

### 4.1 R1 — an act cannot predate its complaint. **SURVIVES; strongest single change.**

Lag `complaint_date → decision_date` over the 2,920 matches the current matcher produces:

```
min -249   p1 23   p5 30   p25 45   median 58   p75 73   p95 94   p99 129   max 388
<0: 5 | 0-30: 147 | 31-60: 1464 | 61-90: 1101 | 91-120: 160 | 121-180: 35 | 181-365: 7 | >365: 1
```

Two findings:

- **The current matcher already produces 5 provably impossible pairings** (act dated
  before the complaint was filed, one by 249 days). The year window `y | y-1` admits them
  by construction: an act dated 2023-02 is "in window" for a complaint filed 2023-11.

  ⚠️ **Three units here, and they are not the same number — verified 2026-08-22 against
  local Postgres.** The 5 above are what a fresh `matchDecisions` run EMITS. What is
  actually PUBLISHED in `kzk_appeals` is **3** (`decision_act_no IS NOT NULL AND
  decision_date::date < complaint_date::date`) — provenance blocks the rest from being
  written. And across ALL provenances the table holds **29** negative-lag rows, so **26
  of them are hand-seeded**: the irreplaceable 2,098 contain impossible pairings too.
  That is a separate finding this plan does not otherwise make, and it matters because
  R1 as a candidate filter cannot repair those — `partitionByProvenance` protects them,
  by design. Two of the three published ones share a single act (`АКТ-121-06.02.2020`
  attributed to two complaints filed eight months later), which is also the shape §4's
  one-act-two-appeal discussion is about.
- Adding `lag ≥ 0` as a **candidate filter** takes `matched` **2,920 → 3,136** — +222
  gained, 6 lost (5 of them the impossible ones). It resolves ambiguity as a side effect:
  when a party sued the same buyer twice in a window, the complaint filed *after* the act
  cannot be its subject, so the group collapses to one candidate.

This rule is not a heuristic. It is a fact about causality, and its failure mode is a
register that mis-dates an act — which would be a source defect, not a matcher one.

### 4.2 R2 — `kzk_case_no` predicts the complaint's filing date. **SURVIVES; the big lever.**

`КЗК/417/2026` is issued when the case is **opened**, and the register issues them in
order. Measured on the 2,920 current matches (all of which carry a well-formed case
number):

| case-year vs complaint-year | n |
|---|---|
| equal | 2,791 |
| case-year = complaint-year + 1 | 125 |
| other | 4 |

Concordance of case number with complaint date, per case-year, and the residual of a linear
fit:

| year | n | concordant | \|resid\| median | p90 | max |
|---|---|---|---|---|---|
| 2020 | 396 | 97.9% | 7.2 d | 16.5 d | 121.7 d |
| 2021 | 423 | 98.6% | 4.1 | 9.8 | 105.0 |
| 2022 | 349 | 98.8% | 4.5 | 9.8 | 65.9 |
| 2023 | 493 | 98.5% | 9.2 | 16.5 | 105.7 |
| 2024 | 546 | 98.6% | 3.8 | 9.7 | 40.7 |
| 2025 | 478 | 98.5% | 3.4 | 8.6 | 103.0 |
| 2026 | 231 | 98.2% | 4.4 | 10.1 | 56.1 |

A **monotone interpolation** over the (case_no → complaint_date) points, evaluated
**leave-one-out**, is much tighter than the linear fit:

```
|error| days:  median 2.0   p75 4.3   p90 8.0   p95 12.0   p99 30.0   max 129.4   (n=2,916)
within 3d 65.2%   7d 88.7%   14d 96.3%   30d 99.0%   60d 99.6%
```

**So a case number names the week the complaint was filed.** That is a far sharper
instrument than the act date (whose lag has an IQR of 45–73 days), and it is *independent*
of it. The rule:

> When a party names more than one candidate appeal, compute the act's **implied filing
> date** from its case number, score each candidate by `|complaint_date − implied|`, and
> accept the best **only if** its error ≤ `NEAR` **and** it beats the runner-up by ≥
> `MARGIN`. Otherwise leave the group ambiguous, as today.

Sweep (all with R1 applied first):

| NEAR / MARGIN | matched | resolved by R2 | hand-checkable | agree | NEW outcomes | of which уважена |
|---|---|---|---|---|---|---|
| 14 / 14 | 3,646 | 512 | 110 | 98.2% | 613 | 286 |
| 14 / 30 | 3,553 | 419 | 108 | 98.2% | 522 | 254 |
| 30 / 14 | 3,651 | 517 | 112 | 98.2% | 616 | 289 |
| **30 / 30** | **3,558** | **424** | **110** | **98.2%** | **525** | **256** |
| 30 / 60 | 3,475 | 341 | 108 | 98.2% | 444 | 223 |
| 60 / 30 | 3,559 | 425 | 112 | 98.2% | 524 | 256 |

`NEAR` barely matters; `MARGIN` is the whole knob. The agreement rate does not move across
the sweep because **the two disagreements are not near any threshold** (§5).

**Calibration is self-maintaining and shows no leakage.** Re-running with four different
calibration sets — all current matches, excluding the 5 negative-lag pairs, a half sample,
and **excluding every hand-seeded row (i.e. the entire validation population)** — produced
`matched` of 3,558 / 3,558 / 3,562 / 3,555 and the same 2 disagreements in all four.

### 4.3 R3 — an act-date lag CEILING. **Survives, but subsumed by R2. Do not ship both.**

Filtering ambiguous candidates to `0 ≤ lag ≤ L`:

| L | matched | gained | lost | hand-checkable agree |
|---|---|---|---|---|
| 90 | 3,505 | 592 | 7 | 99.1% |
| 120 | 3,469 | 556 | 7 | 99.1% |
| 180 | 3,382 | 469 | 7 | 98.0% |
| 240 | 3,296 | 382 | 6 | 98.9% |

Comparable yield, comparable accuracy — but **applied after R2 it adds only 5 more
matches** (`neg + case(30,30) + lag120` → 3,562 vs 3,558). R2 dominates it because the
implied filing date is an order of magnitude sharper than the lag distribution. Shipping
both means two tunable constants where one suffices, and the second one is the weaker.

⚠️ **A lag ceiling applied as a hard candidate FILTER (rather than a tie-break) is a
different and worse proposal** — at L=120 it loses **47** current matches, 42 of them
legitimate long-running cases, in exchange for its gains. Rejected in that form.

### 4.4 R4 — pair by date ORDER inside a component. **REJECTED — subsumed, and unsafe where it is not.**

Sorting a component's acts by date and its appeals by filing date and pairing by rank,
validated against hand-seeded outcomes:

| pairing | all non-trivial | \|acts\|=\|appeals\| | outcome-UNIFORM component | outcome-MIXED component |
|---|---|---|---|---|
| forward | 98.2% (n=223) | 99.1% (n=113) | 100.0% (n=128) | **95.8% (n=95)** |
| reversed | 68.2% | 51.3% | 100.0% | **20.9%** |
| rotated | 65.4% | 47.3% | 100.0% | **14.0%** |

The reversed/rotated controls prove the ordering carries real information (a uniform
component is agnostic to the pairing, so only the MIXED column tests anything). But:

- restricted to balanced components it is 99.1% on n=113 — **the same population R1+R2
  already resolves**, at 98.2% and with an explicit refusal when the evidence is weak;
- on **unbalanced** components (404 of 743 ambiguous keys have fewer acts than appeals, and
  240 components are exactly 1 act × 2 appeals) rank-pairing has to *invent* a partner for
  the surplus appeal. There is no version of this that refuses.

R2 subsumes the safe half and refuses the unsafe half. **Recommend against R4.**

### 4.5 R5 — УНП or buyer ЕИК reaching the decisions side. **REJECTED — the data is not there.**

```sql
SELECT count(*) FROM kzk_decisions WHERE pronouncement ~ '[0-9]{5}-[0-9]{4}-[0-9]{4}';  -- 0
SELECT count(DISTINCT d.act_no) FROM kzk_decisions d
  JOIN kzk_appeals a ON d.pronouncement LIKE '%'||a.buyer_eik||'%'
 WHERE a.buyer_eik ~ '^[0-9]{9,13}$';                                                   -- 18
```

`kzk_appeals.unp` is populated on **7,852** rows (28 are the literal `--`, 118 empty), and
**zero** decision pronouncements contain a УНП-shaped token. Eighteen contain a digit run
matching some buyer's ЕИК — 0.4% of the corpus, and `kzk_decisions` carries no ЕИК column
of its own. `kzk_decisions` has exactly nine columns and none of them is an identifier the
intake register shares. **This axis is closed.**

### 4.6 R6 — `appealed_act` text overlap, weaker variants. **REJECTED — nothing survives.**

The sibling plan's §6.4 rejected `appealed_act` as an exact key (1 of 100 crawled решения
carries a `D`-prefixed token). Re-tested over the **whole** merits corpus rather than the
crawled subset, including the weaker forms the brief asked about:

- УНП in the pronouncement: **0**;
- buyer ЕИК in the pronouncement: **18**;
- the legacy `pron` is truncated at 160 characters on 2,765 rows, so even where the register
  does quote the buyer's act, the quotation is the part most likely to be cut.

No weaker variant survives. The one thing that could change this is the sibling plan's
option B re-crawl, which un-truncates `pron` — **re-measure then, do not plan around it.**

### 4.7 Consolidation (`status = 'обединено'`) as a signal. **REJECTED — see §2.4.**

It labels 261 appeals while 401 appeals are already resolved by a shared act; 174 of those
are `приключено` and 141 `открито`. It explains 4 of the 43 collisions. Using it would key
on a label that covers a fifth of the phenomenon.

### 4.8 Subject / pronouncement free-text overlap. **NOT PURSUED, and the reason is structural.**

`kzk_appeals.subject` describes the *procurement*; the pronouncement describes the *ruling*.
The one place they touch is the buyer's name, which is already the join key. With the
legacy half of the corpus truncated at 160 characters and the определения arm being a
one-line ruling, any lexical score here would be fitted on the crawled 8% and applied to the
other 92%. Given that R1+R2 already reduce the residual to 818 acts of which most are
genuinely under-determined, the expected yield does not justify a text model on this column.

---

## 5. Accuracy against the wrong-outcome asymmetry

The only ground truth available offline is the **2,098 hand-made outcomes**. They are the
rows the writer may never touch, so every match landing on one is a free test.

| | agree | disagree | rate |
|---|---|---|---|
| **CONTROL** — the current matcher's 1:1 matches vs hand | 1,932 | 3 | **99.84%** |
| R1-stage gains (act cannot predate complaint) | 3 | 0 | — (n too small) |
| **R2-stage gains** (case-number tie-break, 30/30) | **108** | **2** | **98.2%** |

At face value the new rule's error rate is ~11× the baseline's. **It is not, and the
evidence is specific.** Both disagreements were inspected:

| complaint | implied filing | actual filing | error | hand | derived | act's pronouncement |
|---|---|---|---|---|---|---|
| `ВХР-599-24.02.2026` | 2026-02-19 | 2026-02-24 | **5 d** | отхвърлена | уважена | `отменя незаконосъобразно решение и връща() - ОБЩИНА ПЛОВДИВ; оставя жалбата без уважение() - ДЗЗД "ПИМАРИСА"; …` |
| `ВХР-1487-12.05.2026` | 2026-05-11 | 2026-05-12 | **0.6 d** | уважена | отхвърлена | `оставя жалбата без уважение() - "ЕСО" ЕАД;` |

Against the distribution of the 108 **agreeing** matches — implied-date error median
**1.8 d**, p90 **7.4 d**, max **15.9 d** — both disagreements sit *inside* the healthy
range. The pairing is not what failed. The first is a consolidated act that upheld one
complainant and rejected others, with `classifyOutcome` returning the act-level
most-significant code for every party; the second is the same class in the opposite
direction.

That defect is **pre-existing and already live**: it produces 3 of the control's 1,935
disagreements too. 70 merits acts carry more than one ruling code in `pron`, and **95
matches (at every stage) are resolved from such an act**. See §11 decision 3 — it is
deliberately not in this plan's scope.

### Three honest caveats on this number

1. **The validation sample is the protected population, and the writes land elsewhere.**
   Every hand-checkable row is by definition one the writer will not touch. The 98.2% is an
   extrapolation from protected rows to writable ones.
2. **The sample is not proportionally spread.** Hand-checkable new matches by complaint
   year vs new *writable* matches by complaint year: 2020 **4 vs 63**, 2021 19 vs 87, 2022
   15 vs 65, 2023 **16 vs 123**, 2024 20 vs 90, 2025 20 vs 84, 2026 **22 vs 17**. The
   validation is thinnest exactly where the most rows would be written.
3. **Ambiguous appeals are under-represented among hand-made rows** — 224 of the 2,051
   candidate appeals (10.9%) carry an outcome against 26.2% corpus-wide. The human who
   produced the 2,098 evidently found these hard too, so the sample may be biased toward
   the ambiguous cases that were *easy* to resolve.

### Blast radius on the risk index

```
distinct УНП flagged 'уважена' (the upheld_ocids join key): 849 → 1,001   (+152, +18%)
kzk_appeals.outcome = 'уважена':                            983 → 1,239   (+26%)
```

⚠️ **The R1 stage skews heavily toward upholds — 64% of its 215 gains classify `уважена`,
against a corpus base rate of 33.7%.** That has a plausible mechanism (a party that wins an
appeal re-files against the buyer's corrected decision, producing exactly the two-complaint
pattern R1 disambiguates), and it is a *consequence* of which cases were previously
unresolvable rather than a bias in the rule. It is stated here because an 18% jump in the
risk index's uphold set is a change somebody must sign off on, not a silent side effect.

---

## 6. Recommendation

**Ship R1 and R2, as two tiers, with a rejoin dry-run between them so the ratchet's movement
stays attributable.** Reject R3–R6. Do not touch `classifyOutcome`.

| tier | change | matched | outcomes | уважена | concluded coverage |
|---|---|---|---|---|---|
| — | today | 2,920 | 3,078 | 983 | 2,725 / 5,043 = 54.0% |
| **T1** | R1 — drop candidates whose complaint post-dates the act | **3,136** | **3,293** | 1,122 | 2,901 / 5,043 = **57.5%** |
| **T2** | R2 — case-number implied filing date, `NEAR=30 MARGIN=30` | **3,558** | **3,603** | 1,239 | 3,147 / 5,043 = **62.4%** |

Simulated writer output under T1+T2 (`partitionByProvenance` applied to the same rows the
rejoin would):

```
matched 3558 | writable 1509 = 527 new + 982 re-derived | 2049 hand-seeded protected (7 conflicts)
would write: 881 отхвърлена, 612 уважена, 9 null, 7 прекратена
```

**The gap closes by 422 concluded appeals (2,318 → 1,896, −18.2%)**, and total outcomes rise
+525. That is the realistic gain — materially more than the sibling plan's re-crawl (≤363
decisions, of which 125 upholds) and it needs no browser, no BG egress and no operator.

### Why `MARGIN = 30` and not 14

`MARGIN=14` yields 3,651 matched / 3,694 outcomes / 63.9% concluded coverage — **+91 more
outcomes** — at the same measured agreement rate. It is rejected as the default anyway,
because the measured rate is an extrapolation off 110 protected rows (§5) and the extra 91
rows are precisely those where two candidate appeals were filed **within a fortnight of
each other**, i.e. the ones the implied date is least able to separate. The constant should
be one named export with this paragraph beside it, so widening it later is a decision rather
than a tweak.

### What must NOT be bundled

- **Any change to `classifyOutcome`** (§11.3). It is the only remaining measured error
  source, and folding it in makes the ratchet's movement unattributable — the exact reason
  this file exists separately from the sibling plan.
- **The sibling plan's re-crawl.** Same argument, stated there.
- **The `отказано производство` guard** (§11.2). It is cheap and principled and it
  contradicts 9 hand-made rows, so it needs a decision first.

---

## 7. Exact command sequence

```bash
export PGPASSFILE="$PWD/.pgpass"
export KZK_LOCAL='postgres://postgres:postgres@localhost:5433/electionsbg'
```

⚠️ Every `db:*:cloud` script exports a password-less `DATABASE_URL` that resolves the CLOUD
password from `.pgpass`. Pin `DATABASE_URL` on every command below or a "local" run writes
to prod.

**Step 0 — restore point.** `kzk_appeals` holds 2,098 irreplaceable rows and both corpora
are gitignored.

```bash
npm run db:dump
cp data/procurement/kzk_appeals.json data/procurement/kzk_appeals.json.pre-t1.bak
psql "$KZK_LOCAL" -At -c "SELECT count(*) FROM kzk_appeals WHERE outcome IS NOT NULL AND decision_act_no IS NULL;"
#   MUST print 2098
```

**Step 1 — T1 (R1), offline.** Add the chronology filter to `matchDecisions`, extend
`kzk_match.test.ts` (§8), then:

```bash
npx vitest run scripts/procurement/kzk_match.test.ts scripts/procurement/kzk_provenance.test.ts
npm run lint
DATABASE_URL="$KZK_LOCAL" npm run kzk:rejoin -- --dry-run
```

Expect `matched 3136 · 40 appeals claimed by >1 act · writable 1198 = 215 new + 983
re-derived · 1938 protected · 4 conflicts`. **A parser or matcher change ships no data** —
nothing has been written yet.

**Step 2 — apply T1 locally and verify.**

```bash
DATABASE_URL="$KZK_LOCAL" npm run kzk:rejoin -- --apply
psql "$KZK_LOCAL" -At -c "SELECT count(*) FROM kzk_appeals WHERE outcome IS NOT NULL AND decision_act_no IS NULL;"
#   MUST print 2098
npm run test:data 2>&1 | grep -i kzk
git add data/procurement/derived/kzk_baselines.json   # ratchet, upward only
```

**Step 3 — T2 (R2).** Add `kzk_case_no` to `MatchableDecision`, the calibration builder and
the tie-break; **and add `kzk_case_no AS kzk` to BOTH SELECTs that feed `matchDecisions`** —
`kzk_rejoin.ts` and `scripts/db/tests/kzk_appeals_provenance.data.test.ts` (§10.1). Then:

```bash
npx vitest run scripts/procurement/kzk_match.test.ts
DATABASE_URL="$KZK_LOCAL" npm run kzk:rejoin -- --dry-run
```

Expect `matched 3558 · 46 · writable 1509 = 527 new + 982 re-derived · 2049 protected ·
7 conflicts · would write 881 отхвърлена, 612 уважена, 9 null, 7 прекратена`.

⚠️ **Read all 7 conflicts by hand before applying.** Three are new; the four existing ones
are listed in the sibling plan §1.8.3.

**Step 4 — apply T2 locally, verify, ratchet.** Same three commands as Step 2. Expect
`kzk_appeals: 3603 outcomes`.

**Step 5 — publish. Nothing here is automatic.**

```bash
npm run kzk:rejoin:cloud -- --dry-run     # compare against the local dry run, row for row
npm run kzk:rejoin:cloud -- --apply
psql "postgres://postgres@127.0.0.1:5434/electionsbg" -At -c \
  "SELECT count(*) FROM kzk_appeals WHERE outcome IS NOT NULL AND decision_act_no IS NULL;"
#   MUST print 2098
```

The rejoin refreshes `upheld_ocids` through `kzk_dependents.ts`, which is what carries the
+152 upheld УНП into the risk index. **`kzk:rejoin:cloud` writes neither the JSON nor the
ratchet** (`isServingDatabase()` short-circuits both) — that is by design; the ratchet must
be minted locally.

**No `deploy:db` and no `deploy`.** Nothing in this change touches `functions/` or the
bundle.

---

## 8. Gating and testing

### Existing gates that already cover this

| gate | what it catches here |
|---|---|
| `HAND_SEEDED_FLOOR = 2098` (`kzk_baselines.ts`) | the irreplaceable rows, in both directions |
| Gate C — `outcomes` ratchet | a change that publishes fewer outcomes |
| Gate D — `matched` ratchet | a matcher that got worse (Gate C cannot: see §10.2) |
| provenance SQL guard in `kzk_rejoin.ts`'s UPDATE | protects the 2,098 even if the caller is wrong |
| `kzk_appeals_provenance.data.test.ts` — orphan act check | a `decision_act_no` citing an act the corpus lost |

### New tests this change needs

All pure, all in `scripts/procurement/kzk_match.test.ts`, all sub-second:

1. **R1 — an act dated before the complaint is never a candidate.** Fixture: one party, two
   complaints in the window, the act dated between them. Assert exactly one match and that
   it is the earlier complaint. **Mutation check:** with the filter removed the fixture
   yields `partyAmbiguous = 1` and no match.
2. **R1 negative invariant, over the corpus** (new arm in
   `kzk_appeals_provenance.data.test.ts`): **no produced match may have
   `decision_date < complaint_date`.** Today that assertion fails on 5 rows — which is the
   point of adding it. It is the one gate that is cheap, total, and independent of any
   ratchet.
3. **R2 — the tie-break refuses when the margin is not met.** Two candidates 5 days apart,
   `MARGIN=30`: assert `partyAmbiguous = 1` and no match. The refusal is the safety
   property, so it needs a test of its own, not merely the accept path.
4. **R2 — the calibration floor.** With fewer than the minimum calibration points for the
   act's case-year, `impliedFiling` returns null and the group stays ambiguous. Without
   this a fresh or year-scoped database silently disambiguates off a two-point fit.
5. **R2 — a malformed or absent `kzk_case_no` is inert.** 363 acts have none (`NULL`) and
   one carries the literal `-`; assert they behave exactly as today.
6. **Both — no rule may reduce `matches.length` on the committed fixtures.** The unit
   fixtures are the only place a loss is visible without a database.

### The gate that should exist and does not

**`matched` is ratcheted; `уважена` is not.** The whole reason a wrong outcome is worse
than a missing one is the `upheld_ocids` → risk-index path, and nothing today would notice
`уважена` doubling. Add a third ratcheted field (`upheld`) to `kzk_baselines.json`, and —
because a ratchet only ever moves up — pair it with a **relative-jump warning** in the
rejoin's dry-run output: "this run would move `уважена` by +26%; the last run moved it by
X%". A number that only ever rises cannot flag over-matching; a delta can.

---

## 9. Rollback

| after | how |
|---|---|
| Step 1 / Step 3 (code only) | `git checkout scripts/procurement/kzk_match.ts scripts/procurement/kzk_rejoin.ts`. No data touched — a matcher change ships no data. |
| Step 2 / Step 4 (local applied) | revert the matcher, re-run `kzk:rejoin --apply` against local. Every row it wrote carries `decision_act_no`, so every row it wrote is re-derivable by definition; the 2,098 were never written. Then `git checkout data/procurement/derived/kzk_baselines.json` — **the ratchet is the one artifact a revert must also undo**, or the next run fails Gate C/D with a message forbidding the only available fix. |
| Step 5 (cloud applied) | identical, against `:5434`. `kzk:rejoin:cloud` writes neither the JSON nor the ratchet, so there is nothing else to unwind on that side. |

⚠️ **There is one thing a revert does NOT restore, and it is pre-existing (§10.3).** A row
whose match disappears keeps its previous derived `outcome` and `decision_act_no` — the
writer only ever UPDATEs rows it matched. So reverting T2 leaves ~5 rows carrying an
outcome derived from an act that no longer claims them. They are not wrong values; they are
unrefreshed ones. Fixing that is §11.4.

**No irreversible step exists in this plan.** Unlike the sibling plan's Step 4, nothing here
overwrites a corpus: both `kzk_appeals.json` and `kzk_decisions.json` are read-only inputs
except for the outcome mirror the rejoin already performs today.

---

## 10. Defects found in passing — real, out of scope, worth their own line

### 10.1 Gate D measures a different population from the writer

`kzk_appeals_provenance.data.test.ts` selects **every** decision:

```sql
SELECT act_no AS no, decision_date AS ddate, pronouncement AS pron,
       initiators AS init, respondent AS resp FROM kzk_decisions
```

while `kzk_rejoin.ts` filters `WHERE kind IS DISTINCT FROM 'определения'`. Measured: the
gate computes **2,940** matches against the ratchet's **2,920**. It passes today on 20 rows
of headroom drawn from a population the writer never touches, and a determination-arm crawl
would inflate that headroom further — masking a real merits regression. **This must be
fixed as part of Step 3 anyway**, because that SELECT also needs `kzk_case_no` or the gate
would evaluate a degraded matcher against a ratchet the full matcher raised.

### 10.2 `count(outcome)` is not non-decreasing, but not for the reason the comment gives

`kzk_baselines.ts` says outcomes "can only be written, never cleared". The mechanism is
different: a row that stops being matched is simply **absent from `writable`**, so its old
value survives untouched. Values *are* cleared, but only for rows still matched whose act
now classifies to null. The conclusion (Gate C cannot detect a worse matcher) is right; the
stated reason is not.

### 10.3 A derived outcome is never revoked

3 appeals today (5 under the recommendation) carry `decision_act_no` pointing at an act that
no longer claims them. The orphan check in the data test only catches an act that left the
*corpus*, not one that stopped matching. Low severity, but it is a published provenance
claim that is no longer true.

### 10.4 230 outcomes sit on `открито производство` rows, 12 on `отказано`

All 12 of the `отказано` ones are hand-seeded (9 `уважена`, 3 `отхвърлена`) — which is why
§11.2 is a decision and not a fix. The 230 open ones are mostly intake-status lag, but the
recommendation would add **80 more**, so the direction matters.

---

## 11. Needs a human decision — do not decide these silently

1. **Whether an 18% jump in the risk index's uphold set is acceptable on this evidence.**
   `upheld_ocids` goes from 849 to 1,001 distinct УНП, and `уважена` from 983 to 1,239. The
   supporting accuracy figure is 98.2% measured on 110 protected rows with the three caveats
   in §5. **My read: yes for T1 unconditionally** (it removes provably impossible pairings
   and adds only pairings the year window was already willing to make), **and yes for T2 at
   `MARGIN=30`**, because the rule refuses rather than scores and both measured errors are
   attributable to a separate, pre-existing classifier limitation. But it is a change to
   what a public risk grade says about named procurement procedures, and that is not mine to
   sign off.

2. **Whether to refuse a merits outcome on an `отказано производство` row.** КЗК refused to
   open proceedings, so no merits act should exist — and the recommendation would write 2
   such rows (the current matcher writes 0). The guard is one line and principled. It also
   **contradicts 9 hand-made `уважена` rows** on refused complaints, which means either the
   status is not what it appears to be, or those 9 are wrong, or the status changed after the
   filing. Worth one look at the register before deciding; a warning line in the dry-run
   output is the safe interim.

3. **Whether to classify a consolidated act's outcome PER PARTY.** This is the only measured
   error source left, and it is bigger than it looks: 70 merits acts carry more than one
   ruling code, all 70 name the party after each `;` segment
   (`оставя жалбата без уважение() - ДЗЗД "ПИМАРИСА"`), and **95 matches are resolved from
   such an act**. A crude per-party locator found the complainant's own segment for 62 of
   those 95, and **42 of the 62 classify differently from the act-level code** — nearly all
   `уважена` → `отхвърлена`, i.e. the direction that currently manufactures upholds.
   ⚠️ Three reasons this is a decision and not a bug fix: the trailing party is sometimes
   the RESPONDENT rather than the complainant (`отменя … - ОБЩИНА ПЛОВДИВ`); `kzk_match.ts`'s
   header records "уважена wins a mixed act" as a **deliberate** choice about what the risk
   index measures; and 33 of the 95 have no locatable segment at all, so a partial rule
   would treat two identical acts differently. **Recommendation: measure it properly in its
   own plan, and do not let it ride along with this one.**

4. **Whether a match that disappears should revoke its derived outcome.** Today it does not
   (§10.3). Revoking is more truthful and would make Gate C able to fall, which is arguably
   the point of a ratchet. Not free: it would need the writer to clear rows it no longer
   matches, and that is a delete-shaped operation on a table holding 2,098 irreplaceable
   rows. Design it deliberately or leave it.

5. **The interaction with `отказано производство` as a rendered outcome** (sibling plan
   §6.3, being handled separately). It adds ~1,661 rows to whatever surface publishes it
   **without touching the matcher** — so if it lands as an `outcome` value rather than as a
   UI string, it moves Gate C's ratchet by more than everything in this plan combined, and
   the two changes become mutually unattributable. **Land them in separate rejoins, and if
   it becomes a stored value, give it its own ratcheted field.**

6. **Whether `MARGIN` should be 30 or 14.** 14 buys 91 more outcomes at the same *measured*
   agreement rate, on the subset where two complaints were filed within a fortnight — i.e.
   exactly where the implied date is weakest. §6 recommends 30; the 91 rows are the price
   of that caution and somebody may reasonably want them.
