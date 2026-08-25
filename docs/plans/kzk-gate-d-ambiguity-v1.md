# Gate D cannot tell a worse matcher from a bigger corpus — v1

**Status: IMPLEMENTED — Tiers 1, 2 and 3, all landed 2026-08-25.** Gate D ratchets `reached`,
Gate E is live, the diagnostics ship, and the gate is GREEN on the corpus that failed it
(`e1a7cade1d`, `8dcf726a86`, `2d91593523`, `22886adc2c`). The ratchet was re-minted by
`npm run kzk:rejoin -- --apply` against LOCAL Postgres, never by hand, and now reads
`{outcomes: 3078, matched: 2918, reached: 4932, appeals: 8007, decisionsMerits: 4502}`.
The 2,098 hand-seeded rows are intact. **Still OPEN: §8.2 steps 4–6** — the committed
`kzk_appeals_summary.json` rebuild, the Cloud SQL publish, and the two ingest stamps, which
are operator actions this plan does not perform.

Every figure below was re-derived on **2026-08-25** against local
Postgres (`postgres://postgres:postgres@localhost:5433/electionsbg`, `PGPASSFILE=$PWD/.pgpass`)
from an instrumented copy of `matchDecisions`, not carried over from the brief that
commissioned it. Cloud SQL was not touched and is not measured here.

**The failing gate.** `scripts/db/tests/kzk_appeals_provenance.data.test.ts` →
*"Gate D — the matcher still resolves at least as many appeals"*:

```
AssertionError: the matcher now resolves 2918 appeals, below the ratchet's 2920
(set 2026-08-21). Match quality REGRESSED — check scripts/procurement/kzk_match.ts
against kzk_match.test.ts. Do not lower the ratchet to make this pass; it only
moves upward by design.
```

**Every clause of that message after the first is false.** Match quality did not regress,
`kzk_match.ts` is untouched and its 21 unit tests pass, and the quantity being ratcheted does
not "only move upward by design" — it is empirically non-monotone under growth of **either**
corpus. The gate fired on a routine, correct ingest of 9 real complaints, and it named a
recovery (audit the matcher) that cannot succeed because there is nothing there to find.

**Sibling plans.** `docs/plans/kzk-matcher-ambiguity-v1.md` (plan only, unimplemented) already
records this gate's *previous* mismeasurement as its §10.1, and its §10.2/§10.3 are load-bearing
here. `docs/plans/kzk-decisions-freshness-v1.md` §4 owns the "there is no shared key" ceiling.

---

## 1. Evidence, re-derived independently

### 1.1 The claim of regression does not survive inspection

| check | result |
|---|---|
| working tree for `kzk_match.ts` / `kzk_rejoin.ts` | **clean** — neither appears in `git status --porcelain` |
| last commit touching `kzk_appeals_provenance.data.test.ts` | `b73abee164` *"kzk: Gate D measured a corpus the writer never uses"* |
| `npx vitest run scripts/procurement/kzk_match.test.ts` | **21 passed / 21**, 147 ms |
| `data/procurement/derived/kzk_baselines.json` | `{"outcomes":3078,"matched":2920,"updatedAt":"2026-08-21"}` |

### 1.2 Corpus state

```sql
SELECT count(*) FROM kzk_appeals;                                              -- 8,007
SELECT count(*) FROM kzk_decisions;                                            -- 4,779
SELECT count(*) FROM kzk_decisions WHERE kind = 'определения';                 --   277
SELECT count(outcome) FROM kzk_appeals;                                        -- 3,078
SELECT count(*) FROM kzk_appeals WHERE decision_act_no IS NULL
                                   AND outcome IS NOT NULL;                    -- 2,098  ✅ intact
SELECT count(*) FROM kzk_appeals WHERE decision_act_no IS NOT NULL;            --   987
```

Merits-eligible decisions (`setsMeritsOutcome`, i.e. `kind IS DISTINCT FROM 'определения'`):
**4,502**. The 2,098 protected rows are intact, and `count(outcome)` **equals** the Gate C
ratchet exactly — Gate C passes, only Gate D fails.

### 1.3 The corpus-size experiment reproduces to the row

Running the gate's own computation — the same SELECT aliases, the same
`setsMeritsOutcome(d.kind)` filter, the same `matchDecisions` — over the appeal set with the
newest *N* rows removed:

| appeals | matches | ambiguous | partyAmbiguous | unmatched |
|---|---|---|---|---|
| 8,007 (post-crawl) | **2,918** | 43 | 1,410 | 1,718 |
| 8,002 (minus newest 5) | 2,918 | 43 | 1,410 | 1,718 |
| **7,998 (minus newest 9 = the pre-crawl count)** | **2,920** | 43 | **1,408** | 1,716 |
| 7,992 / 7,987 | 2,920 | 43 | 1,408 | 1,716 |

The accounting closes exactly: `matches −2`, `partyAmbiguous +2`, `unmatched +2`. Two appeals
that were resolved 1:1 are now refused, and the two single-party acts that used to resolve them
now hit nothing at all.

### 1.4 Which two, and why — confirmed directly, not inferred

The brief inferred a 2-of-4 split from the aggregate. Confirmed by set difference of the
matched complaint numbers:

```
lost (matched pre-crawl, unmatched now): ВХР-1131-06.04.2026, ВХР-731-02.03.2026
gained: (none)
```

Of the nine complaints filed 2026-08-24, **four** share a folded `(complainant, respondent)`
key with a pre-existing appeal, and exactly **two** of those pre-existing siblings had been
matched:

| new complaint | pre-existing sibling(s) in the year window | sibling was matched? |
|---|---|---|
| ВХР-2561 · КООПЕРАЦИЯ "ПАНДА" vs УМБАЛСМ "Н. И. ПИРОГОВ" | ВХР-1131 @ 2026-04-06 | **yes → lost** |
| ВХР-2560 · "В И К МОНТАЖИ - БОТЕВГРАД" ДЗЗД vs "В И К" ЕООД, Плевен | ВХР-731 @ 2026-03-02 | **yes → lost** |
| ВХР-2565 · "ГАРАНТ - 90 - ЦОНЕВ И СИЕ" ООД vs ОБЩИНА ВРАЦА | ВХР-2361 @ 2026-08-04 | no (never matched) |
| ВХР-2572 · "ЗАПРЯНОВИ - 03" ООД vs ОБЩИНА АСЕНОВГРАД | ВХР-1291 @ 2026-04-24, ВХР-2407 @ 2025-10-20 | no — **the group was already ambiguous** |

The last row is the one worth keeping: that key had *two* in-window candidates before the
crawl, so the new complaint changed nothing. Ambiguity is a property of the group, not of the
arriving row.

This is `matchDecisions`' documented refusal working exactly as specified — "ONLY UNAMBIGUOUS
1:1 RESOLUTIONS ARE EMITTED … A wrong outcome is materially worse than a missing one" — and the
skill's "ambiguous rows stay null — no low-confidence guesses". **Nothing regressed. The
matcher declined to guess which of two complaints by the same firm against the same buyer a
ruling decides, which is the behaviour that protects a named firm and a named public buyer from
a fabricated outcome.**

---

## 2. Three findings the brief did not have, and each strengthens the case

### 2.1 ⚠️ The failure has ZERO effect on published data — `writable` is unchanged

Gate D ratchets `report.matches.length`. The writer does not write `matches`; it writes
`partitionByProvenance(matches, rows).writable`. Measured either side of the crawl:

| | matches | writable (= what the UPDATE touches) | protectedHand | conflicts |
|---|---|---|---|---|
| pre-crawl (7,998) | 2,920 | **984** (0 new + 984 re-derived) | 1,936 | 4 |
| post-crawl (8,007) | 2,918 | **984** (0 new + 984 re-derived) | 1,934 | 4 |

**Both lost matches land on hand-seeded rows** (`decision_act_no IS NULL`, outcome
`отхвърлена` on each) — rows `partitionByProvenance` case 3 forbids any writer from touching.
So the corpus `kzk:rejoin --apply` would produce is **byte-identical** before and after. Gate D
halted a publish over a delta that cannot change a single served outcome, and the operator has
no way to learn that from the message.

It also means the ratchet's units are not the writer's: of the 2,918 matches, **1,934 (66%) are
matches onto rows the writer is forbidden to write**. That is defensible as a *sensitivity*
choice — a bigger sample detects a fold regression sooner — but it must be a stated choice, not
an accident, because it is why a gate failure and a product change are independent events here.

### 2.2 ⚠️ The count is non-monotone on the DECISIONS side too, not only the appeals side

Sweeping both corpora from 60 rows short of current up to current, one row at a time, and
asserting the metric never falls as the corpus grows:

| metric | appeal-side growth (61 sizes) | decision-side growth (61 sizes) |
|---|---|---|
| `matches` | **2 violations** (at drop 8 and 9 — the case above) | **1 violation** (at drop 36) |
| `reached` (§4.1) | **0 violations** | **0 violations** |

The decision-side violation is a second, independent mechanism the brief did not reach: a newly
crawled act can become a *second* claimant of an already-matched appeal, moving it into
`ambiguous`. So `db:load:kzk-decisions:pg` — the merits arm, refreshed on its own schedule —
can fail Gate D by itself, with the appeals corpus frozen. Any fix that only addresses appeal
growth is half a fix.

### 2.3 ⚠️⚠️ Two of four simulated regressions RAISE the match count — Gate D is blind to them

Four regressions injected into the fold, on the current corpus (see §6.2 for the recipe):

| injected regression | matches | Gate D verdict | reached | unexplained losses |
|---|---|---|---|---|
| *(healthy, today)* | 2,918 | — | 4,932 | 0 |
| `normalizeParty` stops folding quote styles | **2,934** | ✅ **PASSES** | 4,914 | 1 |
| `normalizeParty` stops folding whitespace runs | **2,926** | ✅ **PASSES** | 4,911 | 1 |
| `splitInitiators` stops splitting on `;` | 2,432 | ❌ fails | 4,166 | 482 |
| year window narrowed to `y` only (drop `y-1`) | 2,616 | ❌ fails | 4,131 | 485 |

The two fold regressions **raise** the count, because breaking a fold destroys *collisions*
faster than it destroys *matches* — fewer appeals share a key, so more groups collapse to a
spurious 1:1. A gate whose only assertion is `matches >= ratchet` therefore **cannot detect a
name-fold regression at all**, and the quote-style fold is precisely the one the module header
calls out as fragile (the register mixes `" ' „ “ « »`).

So Gate D today has both a false positive (§1.3, blocking a correct ingest) and a false
negative (this row, on a real regression class). It is not merely mis-calibrated.

---

## 3. What Gate D can and cannot detect today — precise statement

`matchDecisions` is a pure function of (appeal set, merits-decision set). Gate D asserts one
scalar of its output is `>= ` a committed constant.

**Can detect** (the count falls):
- a fold or split that stops *reaching* appeals faster than it stops colliding them —
  `splitInitiators`, the year window, a wholesale `normalizeParty` failure;
- a merits-eligibility filter that **widens** (the writer then raises a ratchet this gate's
  narrower population cannot reach) — the direction `b73abee164` fixed.

**Cannot detect** (documented and measured):
- a fold regression whose collision loss exceeds its match loss — **§2.3, measured, two of four**;
- a merits-eligibility filter that **narrows** — the file's own ⚠️ note; the writer lowers its
  own output, the monotonic ratchet does not follow, the gate stays green;
- a wrong *outcome value* — `classifyOutcome` is not exercised by this assertion at all;
- over-matching — a ratchet that only rises cannot flag a count that rose too far.

**Fires spuriously on** (the count falls for a legitimate reason):
- a new appeal joining a matched appeal's `(complainant, respondent)` group inside the year
  window — **§1.3/§1.4, the live case**;
- a new act becoming a second claimant of a matched appeal — **§2.2**;
- a corpus correction that re-spells a party into an existing group.

**The root cause in one sentence.** The ratchet's premise — "coverage becomes monotonic by
construction", "it only moves upward by design" — is a property of `count(outcome)`
(append-only, §5) that was carried over to `matches`, which has no such property: the appeal
corpus only grows, growth creates ambiguity, and the matcher's *correct* response to ambiguity
is to withdraw a match. Growth and regression are therefore observationally identical in this
scalar, and the gate fails closed on growth.

---

## 4. Options

### 4.1 Option A — ratchet `reached`, the coarse candidate set *(recommended, Tier 1)*

Define **`reached`** = the number of DISTINCT appeals that at least one merits act's
`(party, respondent)` key pointed at inside the year window — i.e. the union of every candidate
set `matchDecisions` builds, *before* it decides whether the group is 1:1. Today: **4,932**.

It is already computed inside the matcher's inner loop; exposing it costs one `Set`.

- **Monotone under growth of either corpus, empirically and structurally.** 0 violations across
  122 corpus sizes (§2.2). Structurally: a new appeal can only *join* a group (never leave one),
  and a new act can only *point at* more groups. Neither can shrink the union.
- **Catches all four simulated regressions**, including the two Gate D misses: 4,914 / 4,911 /
  4,166 / 4,131 against a bar of 4,932.
- **Wider sample than `matches`** — 4,932 appeals rather than 2,918.
- ⚠️ **It must be defined at the COARSE level and stay there.** `docs/plans/kzk-matcher-ambiguity-v1.md`
  recommends R1 ("an act cannot predate its complaint") as a *candidate filter*. Measured with
  R1 applied: `matches` 2,918 → **3,136**, coarse `reached` **4,932 → 4,932 (unchanged)**, but
  a `reached` defined *after* candidate filtering collapses to **4,753** — i.e. the ratchet
  would fail on the very improvement the sibling plan exists to ship. Any future
  candidate-narrowing rule (R1, R2/`kzk_case_no`) must be applied *after* `reached` is taken.
  This is the same coupling the gate file already warns about for the `kzk_case_no` SELECT, and
  it needs to be written into `kzk_match.ts` beside the field, not only here.

**Cost / residual risk.** A *corpus correction* — a re-crawl fixing a misspelled complainant, or
re-labelling legacy `kind IS NULL` acts as `определения` — can legitimately lower `reached` and
would fail the gate. Rare, loud, and recoverable by re-deriving the baseline after verifying the
correction. Note Gate D has the identical exposure today, so this is not a new class.

### 4.2 Option B — assert on the REASON a match was lost *(recommended, Tier 2; answers "can the gate assert on the reason?" — yes)*

Do not compare counts at all. Use the **database as the snapshot**: `decision_act_no IS NOT NULL`
marks the 987 rows the matcher *did* resolve at some point, and that column is monotone once set
(the writer only ever assigns a non-null act; a full reseed carries `decisionActNo` through the
JSON). Then assert:

> Every appeal carrying a machine-derived outcome is still **reached** by the matcher — i.e. it
> is matched, or refused as `party-collision`, or refused as `act-collision` — unless its citing
> act has left the corpus or is no longer merits-eligible.

A loss with a named collision is corpus growth. A loss with no reason is a regression.

| | unexplained losses |
|---|---|
| pre-crawl (7,998) | **0** |
| post-crawl (8,007) — the live case | **0** ✅ |
| quote-fold regression | 1 |
| whitespace-fold regression | 1 |
| `;`-split regression | **482** |
| narrow-window regression | **485** |

It needs **no baseline, no ratchet, no snapshot file**, and it fails with a list of complaint
numbers rather than a scalar. The three machine-derived rows that are already unmatched today
classify cleanly and would not fire:

```
ВХР-1346-29.04.2026  party-collision (sibling ВХР-2352-03.08.2026)
ВХР-3066-23.12.2025  act-collision
ВХР-340-24.02.2025   party-collision (siblings ВХР-2330-31.07.2026, ВХР-2439, ВХР-2478)
```

- ⚠️ **Coverage is 987 of 2,918 matches (34%).** Matches onto the 1,934 protected hand-seeded
  rows leave no trace of ever having been matched, so the database cannot snapshot them. That
  is why this is Tier 2 *beside* Option A, not instead of it — the two cover disjoint failure
  shapes and different populations.
- ⚠️ **It will fire when the sibling plan's R1 ships, and that is correct.** Measured with R1:
  **2** machine-derived rows become unreachable — the published negative-lag pairings
  `kzk-matcher-ambiguity-v1` §4.1 identifies as *provably impossible* (an act dated before the
  complaint was filed). The right resolution is §11.4 there — revoke a derived outcome whose
  match disappeared — **not** an allowlist, which would silently preserve exactly the false
  attributions R1 exists to remove.

### 4.3 Option C — the match RATE. **REJECTED — measured, it fails the live case too**

`matches / reached`: **59.241% pre-crawl → 59.165% post-crawl.** The rate *falls*, so a rate
ratchet fails on 2026-08-25 for the same reason the count does. Ambiguation removes one appeal
from the numerator and adds one to the denominator; the rate is strictly worse-behaved than the
count, not better. The brief's worry that "a rate can be gamed by the denominator moving" is
real, but it does not get that far — the rate is not monotone in the first place.

### 4.4 Option D — a FROZEN appeal set. **REJECTED — the only variant that works is the wrong one**

Restrict to appeals with `complaint_date <= baselines.updatedAt` (2026-08-21):

| variant | result |
|---|---|
| re-run `matchDecisions` over the frozen subset | 7,998 appeals → **2,920** ✅ passes |
| filter the FULL run's matched set to frozen appeals | **2,918** ❌ fails |

Only the first passes, and the first re-runs the matcher over **a corpus that does not exist and
that the writer never uses** — reintroducing precisely the defect `b73abee164` fixed and whose
⚠️ block occupies `kzk_appeals_provenance.data.test.ts:167–214`. It also goes stale by
construction: the frozen fraction shrinks with every crawl, so the gate covers less of the
matcher's behaviour every day, and re-freezing it re-opens the window in which a regression is
invisible. Reject.

### 4.5 Option E — treat a newly-ambiguated pair as neither gain nor loss

Equivalent to "count `matches + partyAmbiguousAppeals + actCollisionAppeals`", which is exactly
`reached` (§4.1) — the same quantity reached from the other direction. Folded into Option A.

### 4.6 Option F — carry the corpus size in the baseline *(recommended, Tier 3; diagnostic only)*

`updatedAt` is read only to render the message; nothing asserts on it. Add
`appeals` / `decisionsMerits` (and `matched` demoted to an observation) to `KzkBaselines` so a
failure can say:

> the appeals corpus grew 7,998 → 8,007 since this ratchet was set, and 2 of the loss is
> attributable to new `(complainant, respondent)` collisions — see §N

⚠️ **Diagnostic, never part of the assertion.** "Only ratchet when the corpus is unchanged"
would produce a gate that stops asserting the moment data lands — the "passes forever" failure
`kzk_baselines.ts`'s header was written to end.

---

## 5. Gate C — does it share the flaw?

**Not today, and only by accident.** Gate C ratchets `count(outcome)`, measured at **3,078**,
exactly the ratchet. The live case did not move it, and cannot:

- an appeal that stops being matched is simply **absent from `writable`**, so the writer never
  touches it and its stale outcome survives (`kzk-matcher-ambiguity-v1` §10.2/§10.3);
- a newly inserted appeal carries a NULL outcome, which `count(outcome)` ignores;
- in the live case both lost rows are hand-seeded, so no writer would ever have touched them.

⚠️ **The protection is a data defect, and fixing that defect breaks Gate C in exactly this
way.** §10.3 — "a derived outcome is never revoked" — is what keeps the count from falling.
The moment §11.4 lands (revoke a derived outcome whose match disappeared), corpus growth that
ambiguates a *machine-owned* match will lower `count(outcome)` and Gate C will fail closed for
the same reason Gate D does now. Arithmetically, today's three §4.2 rows would take it to
**3,075 < 3,078** immediately.

**So Gate C needs no change now, and must not be left as-is when §11.4 ships.** Whoever
implements revocation must bring Gate C onto Option B's reason-based footing in the same
change. Record it here so the coupling is not rediscovered by a red gate.

Two documentation defects found alongside, both stating a superseded reason:

- `.claude/skills/update-kzk-appeals/SKILL.md` Step 2: *"Gate D exists separately because
  `outcome` is only ever written, never cleared, so `count(outcome)` is non-decreasing by
  construction"* — corrected in the code comments by §10.2 but not here.
- The same SKILL.md gate table describes D as *"re-running the matcher still resolves at least
  as many appeals"*, which is the claim this plan retires.

---

## 6. Recommendation — IMPLEMENTED

**Option A + Option B + Option F, in that order. Replace the `matched` ratchet; do not keep it.**

**What the implementation added beyond this section**, each because a review round found it
five of the seven pinned by a mutant that fails without them (the two placement
caveats are recorded rather than gated — see the note after the list):

- **`outcomes` needed the same finiteness guard as `reached`.** A non-finite observation
  writes JSON `null`, `readBaselines` maps that to `FLOOR.outcomes`, and Gate C silently
  drops **3,078 → 2,098** — the hardcoded floor the ratchet exists to replace — in a
  committed file. Both bars fail closed now.
- **`raised` and `wrote` are different questions.** After the swap the steady state is a bar
  that holds while `matched` drifts, which still rewrites a COMMITTED file; reporting only
  raises left it modified with the operator told nothing. `recordBaselines` returns
  `{raised, refreshed, wrote}` and names which observations moved.
- **A `KzkBaselines` field in neither `RATCHETED` nor `OBSERVED` is never written at all** —
  verified against the successor field `kzk-matcher-ambiguity-v1` §8 proposes (`upheld`).
  A compile-time exhaustiveness
  alias makes that a type error.
- **`reached`'s placement is load-bearing in BOTH directions.** §4.1 records the downward
  hazard (a narrowing rule above the `reached.add` loop). The upward one is symmetric and was
  missing: hoisted above the year-window filter, `reached` goes window-blind and §7.2's
  `narrow-window` regression stops being detectable. Both are pinned by fixtures.
- **Gate E must be its own `test()`.** Written as a trailing assertion inside Gate D it never
  ran on the case it exists for — the ratchet throws first. Verified with a `';'`-split
  mutant, which reported only "reaches 4166" and never mentioned the 482 rows it orphaned.
- **`corpusDelta`'s tail must branch on DIRECTION and name the calling gate's bar.** Growth
  cannot lower a bar; a shrink on either side can, and that is Gate D's own cause 3 — one
  fixed sentence has the message dismiss the evidence it just produced.
- **Both new bars are ONE-SIDED**, and §3 did not carry that caveat onto `reached`. An
  over-MERGING fold reaches more, matches more, and leaves every row accounted: three green
  gates while a ruling is published against the wrong company. The only guard is
  `normalizeParty`'s refusal to fold legal forms, pinned by one unit test — recorded beside
  the claim it qualifies.

Keeping `matches >= ratchet` alongside `reached` preserves the false positive that caused this
report and buys nothing — every regression it catches, `reached` catches more sharply (§2.3).
`matched` is demoted to a *recorded observation* so the delta stays visible in the rejoin's
output and in the baseline file.

### Tier 1 — `reached`, exposed from the matcher and ratcheted

1. `scripts/procurement/kzk_match.ts` — add `reached: number` (or the `Set<string>`) to
   `MatchReport`, computed from the coarse candidate union inside the existing loop. Carry the
   ⚠️ from §4.1: **any future candidate-narrowing rule is applied after `reached` is taken.**
2. `scripts/procurement/kzk_baselines.ts` — `KzkBaselines` gains `reached`; `recordBaselines`
   raises it like the others. `matched` stays in the type as an observation (still recorded,
   no longer asserted).
2b. `scripts/procurement/kzk_rejoin.ts` — pass `reached: report.reached` into
   `recordBaselines`, print it in the counters line beside `matched`, and name it in the
   serving-database "ratchet not updated" message. **Not optional and not cosmetic:** step 2
   changes `recordBaselines`' `Pick<KzkBaselines, …>` parameter, and this is its only call
   site, so step 2 type-breaks the rejoin and cannot be completed without it.
   ⚠️ `reached` must ALSO join the `(["outcomes", "matched"] as const)` tuple inside
   `recordBaselines` that builds the `raised` array — a field added to the type and to
   `Math.max` but not to that tuple is written and never reported as raised, so §8.1's
   expected output never appears and an operator concludes the mint failed.
3. `scripts/db/tests/kzk_appeals_provenance.data.test.ts` — Gate D asserts
   `report.reached >= baselines.reached`. Rewrite the failure text: it must say *which* fold /
   split / window is implicated, and must stop asserting the false monotonicity claim.
4. `scripts/procurement/kzk_match.test.ts` — a fixture where adding a second complaint by the
   same party against the same buyer inside the window drops `matches` by 1 and leaves
   `reached` unchanged-or-higher. **Mutation check:** with `reached` computed *after* the
   1:1 test rather than before, the fixture must fail — otherwise the assertion is satisfiable
   by a definition that is just `matches` under another name.

### Tier 2 — the reason-based invariant (new test, no baseline)

5. `kzk_match.ts` — return the refusals as data rather than as counters:
   `unresolved: Array<{ complaintNo: string; reason: "party-collision" | "act-collision" }>`.
   The header already commits to this direction ("Ambiguity and misses are now RETURNED as
   data"); the counters stay for the rejoin's console output.
6. New arm in `kzk_appeals_provenance.data.test.ts`: every `decision_act_no IS NOT NULL` appeal
   is matched, or `unresolved` with a reason, or cites an act that is absent / no longer
   merits-eligible. Fail with the complaint numbers listed, capped, with `count(*) OVER ()`
   carrying the true total — the pattern the orphan test in the same file already uses.

### Tier 3 — diagnosis in the message

7. `KzkBaselines` gains `appeals` / `decisionsMerits`; both gates' messages report the corpus
   delta since the ratchet was set. Diagnostic only (§4.6).

   ⚠️ **Shipped WITHOUT the "names the newly-collided groups when `matched` fell while
   `reached` held" half, deliberately.** That state is a PASSING Gate D — nothing fails, so
   there is no failure message to put it in, and printing it from a green test is output
   nobody reads. The rejoin covers the same ground where an operator is actually looking:
   it prints `reached`, `unresolved.length` and which observations moved on every run.

### Explicitly NOT in this plan

- **Any change to the matcher's refusal on ambiguity.** It is correct and it is the only thing
  standing between this pack and a ruling attributed to the wrong named firm.
- **R1 / R2 / `kzk_case_no`.** They belong to `kzk-matcher-ambiguity-v1`, and landing a matcher
  change and a gate change in one rejoin makes the ratchet's movement unattributable — that
  plan's own stated reason for existing separately.
- **§11.4 revocation** and the Gate C follow-through (§5). Named as a coupling, not scheduled.
- **Lowering or hand-editing `data/procurement/derived/kzk_baselines.json`.**

---

## 7. How the new gate behaves — required, and how to prove it

### 7.1 The real 2026-08-25 case — must PASS ✅ CONFIRMED

| assertion | value | bar | verdict |
|---|---|---|---|
| Tier 1 · `reached >= baselines.reached` | 4,932 | 4,932 (as minted) | ✅ passes |
| Tier 2 · unexplained machine-derived losses | **0** | 0 | ✅ passes |
| Gate C · `count(outcome) >= 3078` | 3,078 | 3,078 | ✅ passes (unchanged) |
| hand-seeded floor | 2,098 | 2,098 | ✅ passes |

The two withdrawn matches are onto hand-seeded rows, so Tier 2 does not see them — correct:
nothing published changed, so nothing should fire.

⚠️ The bar in that row is **4,932, not the 4,929 this section originally predicted**. The bar
was minted from the POST-crawl corpus (there was never a 4,929 in a committed file), so the
margin is +0 rather than +3 — the gate passes on equality. That is the ratchet working as
designed and it is what every steady-state run will look like; the +3 the plan predicted is the
distance a PRE-crawl bar would have had, which no run ever held.

### 7.2 A genuine regression — must FAIL ✅ CONFIRMED

Simulate by variant-injecting the fold, exactly as §2.3 was measured. No repo file is edited;
a scratch harness re-implements `matchDecisions` with the fold parameterised, reads both tables
from local Postgres, and reports each metric per variant. The four variants and the recipe:

Every variant below was built and run. Measured outcome in the last column.

| variant | what is broken | must fail via |
|---|---|---|
| `no-quote-fold` | drop `.replace(/["'„“”«»]/g,"")` from `normalizeParty` | **Tier 1** (4,914 < 4,932). The RETIRED `matched` gate passed this at 2,934. |
| `no-ws-fold` | drop `.replace(/\s+/g," ")` | **Tier 1** (4,911). The RETIRED `matched` gate passed at 2,926. |
| `no-semicolon-split` | `splitInitiators` returns `[init]` | Tier 1 (4,166) **and** Tier 2 (482 rows) |
| `narrow-window` | candidate filter `c.y === y` only | Tier 1 (4,131) **and** Tier 2 (485 rows) |

The first two are the load-bearing cases: they are the regressions the OLD gate could not see,
and they are the ones the module header identifies as most fragile.

The `36/36` figures below are mid-Tier-2 counts, quoted because that is where each guard was
measured. The file went 21 → 30 (Tier 1) → 38 (Tier 2); §11's "21/21 pre-plan" is the same
series read from the other end.

**Confirmed 2026-08-25.** The `';'`-split mutant fails Gate D at `reaches 4166, below 4932`
AND Gate E at exactly **482** named rows — independently, in the same run, which is why Gate E
is a separate `test()`. Three further mutants were built and killed by fixtures the suite did
not previously have: an R1 narrowing rule folded in above `reached.add` (caught by the
predating-act fixture), `reached.add` hoisted above the year-window filter (caught by
"does not reach back two years"), and each of the two partition guards at the foot of
`matchDecisions` (each of which could be deleted with the suite green at 36/36 before this
plan landed).

⚠️ **The simulation must run the gate's own SELECT aliases and its `setsMeritsOutcome` filter.**
Selecting `*` from `kzk_decisions` yields a row shape `matchDecisions` silently scores at 0
matches — a false trail that costs an afternoon. The aliases are
`act_no AS no, decision_date AS ddate, pronouncement AS pron, initiators AS init,
respondent AS resp, kind`.

A permanent, cheaper form of the same proof belongs in `kzk_match.test.ts` (Tier 1 step 4): a
fixture whose quote styles differ across the two sides, asserting `reached` collapses when the
fold is removed. That runs in the unit suite with no database.

---

## 8. The baseline, and whether to publish now

### 8.1 The baseline MUST be re-derived once the gate changes — as an operator step ✅ DONE

**Done 2026-08-25** — the committed ratchet now reads
`{outcomes: 3078, matched: 2918, reached: 4932, appeals: 8007, decisionsMerits: 4502,
updatedAt: "2026-08-25"}`, minted by the command below against LOCAL Postgres and never edited
by hand. The rest of this section is the standing rule for the NEXT time a bar field is added.

`reached` (and, under Tier 3, `appeals` / `decisionsMerits`) did not exist in the committed file,
and `readBaselines` would fall back to `FLOOR` — a bar of 0 that passes forever, the exact
"cannot tell healthy from frozen" failure the ratchet was built to end. Nothing in this plan
edits `kzk_baselines.json`. Raising it is one command, **against LOCAL Postgres only** (the
rejoin refuses to mint the ratchet from a serving database, by design):

```bash
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \
  npm run kzk:rejoin -- --apply
```

Expected: `→ raised the coverage ratchet (reached) — commit data/procurement/derived/kzk_baselines.json`,
landing `reached: 4932` beside the existing `outcomes: 3078`. `outcomes` and `matched` will not
move — measured, the run writes the same 984 rows to the same values.

⚠️ **Ship Tier 1's `recordBaselines` change in the same commit as the gate.** A gate reading a
field no writer mints is a gate reading `FLOOR`.

### 8.2 `kzk_appeals` — publish; Tier 1 has landed, so steps 4–6 are what remain

The ingest was correct and the data is safe on every measurable axis: 9 real complaints filed
2026-08-24, the 2,098 intact, `count(outcome)` unchanged at 3,078, and `writable` identical at
984 rows (§2.1) — so publishing changes exactly nine intake rows and no outcome anywhere.

**Gate D is now GREEN, so the halt no longer applies — steps 1–3 below are done and steps 4–6
are what an operator still owes.** The rule that produced the halt stands and is worth keeping
in view: **do not stamp `state/ingest/kzk_appeals.json` while a gate is red.** That marker is the
orchestrator's "this arm ran clean" signal, and `/process-watch-report` reads it to decide
whether to re-run the skill. Stamping over a red gate is how the merits arm sat five weeks stale
— the specific history these four gates were built to prevent. The skill's halt-on-gate-failure
rule is right; the gate is what is wrong.

Recommended sequence — ✅ 1–3 done 2026-08-25, ☐ 4–6 outstanding:

1. ✅ Land Tier 1 (matcher field, baseline field, gate assertion, unit test) — and Tiers 2–3.
2. ✅ `DATABASE_URL=…5433 npm run kzk:rejoin -- --apply` → `kzk_baselines.json` committed.
3. ✅ `npx vitest run scripts/db/tests/kzk_decisions.data.test.ts scripts/db/tests/kzk_appeals_provenance.data.test.ts scripts/db/tests/kzk_suspension.data.test.ts` → 14/14 green.
4. `npm run kzk:summary` → commit `data/procurement/derived/kzk_appeals_summary.json`.
5. Publish: `npm run db:load:kzk-decisions:pg:cloud` then `npm run kzk:rejoin:cloud -- --apply`.
6. Stamp both arms per the skill's Stamping section, quoting the tier-2 **date**, never
   "2,098 outcomes preserved".

The "if Tier 1 is deferred, publish under an explicit override" fallback this section
originally offered is **moot** — Tier 1 landed, so there is nothing to override. It is not
reinstated here, because an override note is only ever the second-best answer to a red gate.

⚠️ **Cloud SQL was not measured for this plan.** `state/ingest/kzk_appeals.json` claims
local/cloud parity as of 2026-08-22; whether prod's `kzk_appeals` already holds the nine new rows
was not checked and should be, before step 5 is read as a no-op.

---

## 9. Files this plan would touch

| file | change |
|---|---|
| `scripts/procurement/kzk_match.ts` | `reached` on `MatchReport`; `unresolved[]` with reasons (T2); the ⚠️ that narrowing rules come after `reached` |
| `scripts/procurement/kzk_baselines.ts` | `reached` ratcheted; `matched` demoted to an observation; `appeals`/`decisionsMerits` (T3) |
| `scripts/procurement/kzk_rejoin.ts` | record + print `reached`; report the corpus delta |
| `scripts/db/tests/kzk_appeals_provenance.data.test.ts` | Gate D rewritten; new reason-based arm; message text |
| `scripts/procurement/kzk_match.test.ts` | ambiguation fixture + fold-collapse fixture, both with mutation checks |
| `data/procurement/derived/kzk_baselines.json` | **not edited by hand** — re-minted by §8.1 |
| `.claude/skills/update-kzk-appeals/SKILL.md` | Gate D's row, the superseded §5 rationale, and a row for the new Gate E |

## 10. Rollback

Tiers 1–3 are code plus one regenerated ratchet field; no corpus is written and no migration is
applied. `git checkout` the source files, then `git checkout data/procurement/derived/kzk_baselines.json`
— **the ratchet is the one artifact a revert must also undo**, or the next run fails with a
message forbidding the only available fix. Same rule the sibling plan's §9 states.

## 11. Reproduction

```bash
export PGPASSFILE="$PWD/.pgpass"
DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \
  npm run kzk:rejoin -- --dry-run     # read-only; prints matches / ambiguity / writable
npx vitest run scripts/procurement/kzk_match.test.ts   # 21/21 pre-plan; 38/38 implemented
npx vitest run scripts/db/tests/kzk_appeals_provenance.data.test.ts        # 6/6 green since 22886adc2c
```

Every table in §1–§4 came from an instrumented copy of `matchDecisions` reading both tables
directly, reproducing the committed matcher's `2,918 / 43 / 1,410 / 1,718` exactly before any
variant was applied — the check that makes the variant numbers comparable. It lives in the
session scratchpad and is not proposed for the repo; §7.2 step 4 is its permanent replacement.
