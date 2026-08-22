# КЗК record fracture, and the local↔cloud person-layer split — v1

**Status:** plan only. **Nothing implemented, nothing applied, no fix written.** Every
figure below was re-measured on 2026-08-22 against the live databases and the live
corpus, not carried over from the `/process-watch-report` run that surfaced these.

**Revised 2026-08-22 — v1.1, after a full audit of this file against the code and the
data.** The audit found **one measurement error in §2.1** (corrected in place, recorded
as §6.1) and **six gaps**, including a **live content defect on the SERVING database**
that v1 missed entirely because it scoped Problem 2 as a parity question and stopped at
„detect, do not converge". **If you have read v1, read §6 and nothing else.**
`git log -p` on this file has the superseded version.

**Owner surfaces.** Problem 1: `/procurement/appeals`, the `/tenders/:unp` appeals tile,
the `procurementAppeals` AI tool, and — the one that matters — `upheld_ocids` → the
contract **Corruption Risk Index**. Problem 2: every `/person/:slug` page, the
`/person` sitemap shard, `/persons`, `/connections`, and the governance
„фирми, регистрирани тук" tile.

---

## 0. What the measurement changed about the framing

Both problems turned out to be **differently shaped from the symptom that surfaced
them**, and in both cases the naive reading points at the wrong repair.

| | the symptom said | the measurement says |
|---|---|---|
| **P1** | „~8% of crawled КЗК decisions never reach Postgres" | **0 real acts are missing.** The 429 are not acts — they are FRAGMENTS of acts that are already loaded. The real loss is **363 loaded acts silently stripped of `initiators` / `respondent` / `kzk_case_no`**, which makes them permanently unmatchable. |
| **P2** | „local is ahead, cloud lags by 6–809 rows" | **Local is the DEGRADED copy.** 1,395 of the 1,422 local-only slugs are `-N` collision artifacts — local split ~1,393 identities that cloud keeps whole. Cloud is not behind; it is cleaner. |

Neither reframing is cosmetic: P1's obvious fix (make the rejection visible) would
document the wrong rows, and P2's obvious fix (re-resolve cloud to catch it up) would
make cloud *worse* while churning ~1,400 live `/person` URLs.

---

# Problem 1 — the КЗК record fracture

## 1.1 Evidence

Re-measured 2026-08-22 against `data/procurement/kzk_decisions.json`
(`generatedAt 2026-08-22T20:20:53.956Z`, 2.99 MB) and both databases.

### The corpus splits three ways, not two

| bucket | n | `kind` | `sourceUrl` | `fetchedAt` |
|---|---|---|---|---|
| legacy clean (2026-07-04 interactive crawl, ot=2 only) | **4,402** | absent | absent | absent |
| crawler-produced clean (2026-08-02 → 2026-08-22) | **377** | 277 определения + 100 решения | present | present |
| **rejected** | **429** | **absent** | **absent** | **absent** |
| total on disk | 5,208 | | | |

### Answer to „do the 429 skew toward определения?" — **neither. The question does not apply.**

**All 429 rejected rows carry no `kind`, no `sourceUrl` and no `fetchedAt`** — i.e.
every one of them predates the `ot` enumeration entirely. The legacy corpus's newest
act is **2026-06-25** and the определения register (`ot=6`) was first crawled on
**2026-08-02**, so no rejected row can have come from it. Of the 377 rows the committed
crawler has produced across both registers, **zero** were rejected.

So the determination arm is **not** losing rows to this defect, and the merits/suspension
gap is not explained by it. That hypothesis is closed.

### The rejected rows are not acts. They are fragments of acts already in the table.

| field | non-empty on the 429 |
|---|---|
| `ddate` | **0 / 429** |
| `pron` | **0 / 429** |
| `kzk` | 362 / 429 |
| `init` | 362 / 429 |
| `resp` | 362 / 429 |

And, on the other side of the same file:

```
clean rows with NULL kzk_case_no / initiators / respondent : 363
rejected rows carrying a kzk / init / resp                 : 362
```

**362 ≈ 363 is the whole finding.** Each rejected row is the continuation of a clean
row's record, and it carries away the three label-read fields that record should own.
The remaining ~67 rejected rows carry nothing — they are second-order fragments (a
record whose ruling text quotes *two* decision numbers).

The year profiles corroborate it. A fragment's `no` embeds the **buyer's** decision date,
which typically precedes the КЗК act by months, so a modest shift toward the earlier year
is exactly what should be seen:

| year | rejected rows (by embedded date) | clean rows missing `kzk` (by act date) |
|---|---|---|
| 2018 | 2 | — |
| 2019 | 33 | — |
| 2020 | 117 | 107 |
| 2021 | 52 | 65 |
| 2022 | 58 | 42 |
| 2023 | 71 | 54 |
| 2024 | 69 | 60 |
| 2025 | 26 | 24 |
| 2026 | 1 | 11 |

### Both databases are in exact parity, and the 2,098 are intact

| | local :5433 | cloud :5434 |
|---|---|---|
| `kzk_decisions` | 4,779 | 4,779 |
| `max(decision_date)` | 2026-08-20 | 2026-08-20 |
| `kind` решения / определения / NULL | 100 / 277 / 4,402 | 100 / 277 / 4,402 |
| `kzk_case_no IS NULL` | **363** | **363** |
| `kzk_appeals` | 7,998 | 7,998 |
| **`outcome IS NOT NULL AND decision_act_no IS NULL`** | **2,098** ✅ | **2,098** ✅ |
| `decision_act_no IS NOT NULL` | 987 | 987 |
| `outcome IS NOT NULL` | 3,078 | 3,078 |
| `suspension IS NOT NULL` | 0 | 0 |

The hard constraint holds on both sides. `suspension` is fully NULL on both, so the
`kzk_unfreeze_suspension.ts` one-off has already run everywhere and every displayed
suspension now rides `kzk_effective_suspension(NULL, status)`.

`data/procurement/derived/kzk_baselines.json` is `{outcomes: 3078, matched: 2920,
updatedAt: 2026-08-21}` and agrees with the live table.

## 1.2 Root cause — proven, not inferred

`DECISION_RECORD_RE` (`scripts/procurement/kzk_decisions_store.ts:77`) is

```
/^[^\S\n]*(?:\d+[^\S\n]+)?(?:Решение|Определение|Акт)[^\S\n]*№[^\S\n]*/gm
```

It is **line-anchored** (`^` with `m`), which is why the existing test
„does not fracture a record on 'акт' inside a field value" passes: an *inline*
„акт № D123" does not match. But the boundary asks only for the WORD, never for what
follows it — and КЗК's `Произнасяне` routinely **quotes the buyer's own decision
number using the identical words**:

> „ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО **Решение № F780424/02.12.2025 г.** на директора на
> Регионалния военноисторически музей – Плевен…"

Wherever the rendering puts a line break before that quotation, the record fractures.

**Reproduced against the CURRENT committed parser** (not the legacy producer) —
`parseDecisionsText` on one synthetic record whose ruling text wraps before the quote:

```
records parsed: 2
  {"no":"АКТ-100-01.02.2026", "ddate":"2026-02-01",
   "pron":"отменя незаконосъобразно решение(ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО",
   "kzk":null, "init":null, "resp":null}                      ← the real act, GUTTED
  {"no":"РД-25/10.01.2026 г. на кмета на община Х) - \"ФИРМА\" ЕООД;",
   "pron":null, "kzk":"КЗК/999/2026", "init":"\"ФИРМА\" ЕООД", "resp":"ОБЩИНА Х"}
                                                              ← the fragment, holding
                                                                the parent's three fields
clean: 1  rejected: 1  ["act number not \"АКТ-<n>-<DD.MM.YYYY>\" (column shift?)"]
```

That is the damage signature exactly: the parent keeps `no` / `ddate` / a truncated
`pron` and loses its three label-read fields to the fragment, and the fragment is
rejected with the message the loader prints.

The label ORDER is what decides which side loses what — the register renders
`header → Дата → Произнасяне → Номер на производството пред КЗК → Инициатор →
Ответник`, so a split inside `Произнасяне` leaves the date with the parent and puts
all three trailing labels in the fragment's chunk, where `afterLabel` happily finds them.

### Is the live crawler affected today? Not currently — and that is luck, not design

The register's `page.locator("body").innerText()` renders `Произнасяне` on **one
line**: crawled `pron` runs to 1,860 characters and 3 of the 377 crawled rows contain
an inline „Решение №" without fracturing. So the committed crawler has produced 0
rejected rows and would keep doing so **for as long as the rendering does not wrap**.

The legacy producer's exact rendering is not recoverable (it is gone), but its output
is consistent with the `</td>`→newline style render that
`DECISION_RECORD_RE`'s own header comment already warns about — the one that
„splits the row into one field per line". The parser is one rendering change away from
reproducing 8.9% damage on a live crawl, and the rate ceiling (15%) would not stop it.

### Two secondary findings from the same measurement

- **Legacy `pron` is truncated at exactly 160 characters** — 2,765 of 4,402 rows sit
  at the cap. `classifyOutcome` reads that field. **Measured harmless so far:** on the
  147 crawled rows whose `pron` exceeds 160 characters, truncating to 160 changed the
  classification **0 times** (КЗК prints the most significant ruling first in practice).
  Small sample; worth stating, not worth acting on alone.
- `mergeWrite` is a UNION keyed on `no` and refuses to shrink. **A re-crawl therefore
  cannot retire the 429** — a corrected re-read produces the parent under its own act
  number and never touches the fragment's key. The 429 persist in the JSON for ever,
  and the loader re-prints the warning on every run, unless something explicitly
  purges them.

## 1.3 The actual harm, quantified

Not „429 acts missing" — **363 acts loaded and unmatchable**.

`kzk_match.ts` joins on `complainant | respondent` + year window. A decision with NULL
`initiators` and NULL `respondent` matches **nothing, by construction, for ever**. Of
those 363:

| classification of the (truncated) `pron` | n |
|---|---|
| **уважена** (uphold — feeds `upheld_ocids` → Corruption Risk Index) | **125** |
| отхвърлена | 226 |
| прекратена | 1 |
| null (says nothing about the merits) | 11 |

Distribution by act year (merits-eligible rows only):

| year | unmatchable | total | share |
|---|---|---|---|
| 2020 | 107 | 619 | 17.3% |
| 2021 | 65 | 685 | 9.5% |
| 2022 | 42 | 538 | 7.8% |
| 2023 | 54 | 701 | 7.7% |
| 2024 | 60 | 795 | 7.5% |
| 2025 | 24 | 733 | 3.3% |
| 2026 | 11 | 431 | 2.6% |

Against current outcome coverage (local, by complaint year):

| year | complaints | with outcome | % |
|---|---|---|---|
| 2020 | 1,034 | 417 | 40.3 |
| 2021 | 1,048 | 444 | 42.4 |
| 2022 | 966 | 372 | 38.5 |
| 2023 | 1,344 | 512 | 38.1 |
| 2024 | 1,351 | 603 | 44.6 |
| 2025 | 1,371 | 508 | 37.1 |
| 2026 | 884 | 222 | 25.1 |

**125 upheld procedures are invisible to the risk index** because the act that upheld
them lost its party names to a parse fracture. That is the sentence this whole problem
reduces to, and it is a materially different claim from „8% of rows are not loaded".

Current rejoin baseline (`--dry-run`, read-only, local, 2026-08-22):

```
matching 4502 decisions against 7998 appeals…
  matched 2920 appeals (43 appeals claimed by >1 act,
                        1408 parties with >1 candidate appeal,
                        1716 decisions matched nothing)
  writable: 0 new + 984 re-derived; 1936 hand-seeded rows left untouched
  would write: 617 отхвърлена, 356 уважена, 7 null, 4 прекратена
  ⚠ 4 hand-seeded row(s) the matcher would classify differently (NOT written)
```

The 363 sit inside those 1,716.

## 1.4 Options

The prompt offers (a) fix the parser, (b) make the loss visible, (c) both. The
measurement adds a constraint neither anticipated: **a parser fix repairs nothing
retroactively.** The corpus is the JSON; only a re-read of the register can recover
what the fracture ate, and that needs a headed browser and Bulgarian egress.

So the real axis is *parser fix* × *re-crawl* × *purge*, and they are separable.

| | option | what it costs | what it buys | what it leaves |
|---|---|---|---|---|
| **A** | **Tighten the boundary regex** — require the token after `№` to be `АКТ-\d+-\d{2}\.\d{2}\.\d{4}` | one regex + tests; blast radius is 5 call sites, none of them serving code | future crawls cannot fracture; the failure mode inverts to LOUD (`no records rendered within 15s`) | the 363 stay gutted, the 429 stay in the JSON |
| **B** | **Re-crawl `--backfill --full` (ot=2, 2020→2026)** after A | a multi-hour headed crawl on BG egress; blocks on the operator | recovers `init`/`resp`/`kzk` for the 363 **and** un-truncates `pron` on 2,765 legacy rows | the 429 still sit in the JSON (union merge), so the log line persists |
| **C** | **Purge the 429 from the JSON** (one-off, after B proves recovery) | a small script + a restore point | the loader stops printing a warning that names the wrong rows; `5,208` stops being quoted as a corpus size | nothing — but purging BEFORE B destroys the only surviving copy of those 362 party names |
| **D** | **Reconstruct offline** — re-attach each fragment's `kzk`/`init`/`resp` to its parent without re-crawling | — | — | **Rejected.** The file is sorted by `byDateDesc`, so original adjacency is destroyed, and there is no shared key: a fragment's `no` is the *continuation* of the parent's `pron`, with no overlap to join on. Any pairing would be a heuristic guess at which named company sued which named buyer. Not implementable soundly. |
| **E** | **Make the loss visible only** (the prompt's (b) in isolation) | a counter | — | **Insufficient alone.** The visible number would still be 429, which is the count of things that are *not* acts. Reporting it more loudly makes a misleading figure more prominent. |

## 1.5 Recommendation — A, then B, then C, in that order, gated between each

**A is unconditionally worth doing and is the only step that needs no operator, no
egress and no database.** B is the only step that recovers anything. C is bookkeeping
and must never precede B.

### A — the boundary fix

Change `DECISION_RECORD_RE` so the header must be followed by an act number:

```
/^[^\S\n]*(?:\d+[^\S\n]+)?(?:Решение|Определение|Акт)[^\S\n]*№[^\S\n]*(?=АКТ-\d+-\d{2}\.\d{2}\.\d{4})/gm
```

A lookahead, so the split still consumes only the header and `parseDecisionsText`'s
`part.split(/[\n\r]/)[0]` still yields the act number unchanged.

Why this discriminator and not another: **every register header carries `АКТ-…`, and
no quoted buyer decision ever does** — the quoted references measured in the corpus are
`РД-` (21), `РД15-` (8), `СОА19-` (7), `Р-` (9), `ОП-` (6), `ЗОП-` (2), `F…`, `Ц…`,
`ТО-…` and bare integers. Not one is `АКТ-`-shaped.

Why the failure direction is right: if КЗК ever changes the act-number format, the
boundary matches nothing, `waitForRecords` times out and `crawlYear` throws
`no records rendered within 15s`. That is the loud failure the file already wants —
against today's regex, the same change would silently fracture every record instead.

Blast radius (grepped, complete): `firstActNo` (store), `parseDecisionsText`,
`waitForRecords`, `waitForTurn`, `probe` — all in the two КЗК files. **No serving
code, no route, no migration.** The watch source
(`scripts/watch/sources/kzk_decisions.ts`) does **not** use this regex; it scrapes
`/АКТ-\d+-\d{2}\.\d{2}\.\d{4}/g` off the HTML directly, so it is immune and stays an
independent check.

### The gate that should have existed — and it needs no browser

The watcher already proves the invariant: **the number of records parsed from a page
must never exceed the number of `АКТ-…` tokens on it.** A fracture is precisely a
record with no act number of its own. Add it as a pure unit assertion over the
existing synthetic fixtures plus the one new wrapping fixture, and — cheaply — as a
`--probe` line, so a live markup change reports it.

That is the mutation check too: with the boundary reverted, the wrapping fixture
yields 2 records against 1 act number and fails.

### B — the re-crawl

Only after A ships and its tests are green.

### C — the purge

Only after B demonstrably recovers `init`/`resp` on the 363. Needs a decision (§1.8).

## 1.6 Exact command sequence

Every write pins the local database explicitly. `PGPASSFILE` must be set or every
`:cloud` command fails 28P01.

```bash
export PGPASSFILE="$PWD/.pgpass"
export KZK_LOCAL='postgres://postgres:postgres@localhost:5433/electionsbg'
```

**Step 0 — restore point, before anything.** Non-negotiable: the JSON is gitignored and
`kzk_decisions` is a `CRITICAL_TABLES` member with no committed generator.

```bash
npm run db:dump
cp data/procurement/kzk_decisions.json data/procurement/kzk_decisions.json.pre-fix.bak
```

**Step 1 — A, offline.** Edit `DECISION_RECORD_RE`, add the wrapping fixture and the
act-count invariant to `scripts/procurement/kzk_decisions.test.ts`, then:

```bash
npx vitest run scripts/procurement/kzk_decisions.test.ts scripts/procurement/kzk_decisions_store.test.ts
npm run lint
```

Nothing has changed on disk or in any database at this point. **A parser fix ships no
data** — same rule `CLAUDE.md` states for `kzk_match.ts`.

**Step 2 — probe the register before committing to a crawl.** Needs headed browser +
BG egress. Reports what a parser can see per `ot` variant and whether page 1 survives
validation:

```bash
npm run kzk:decisions -- --probe
```

Read three things: `parsed N → clean C, rejected R` per variant (R must be 0), the
label-present lines, and `oldest reachable act` (this decides whether `--backfill`
can reach 2020 at all).

**Step 3 — one year, dry, as the decisive experiment.** 2020 is the right year: it
holds 107 of the 363 gutted rows, the highest concentration in the corpus.

```bash
npm run kzk:decisions -- --year 2020 --full --dry-run
```

Expect ~619+ acts, **0 rejected**, and the run's own completeness assertion against the
register's „Намерени са общо N" header. A non-zero rejection count here means the fix is
incomplete — stop and re-probe rather than proceeding.

**Step 4 — the backfill.** Multi-hour, headed, BG egress, both registers, per-year
persistence (a slow postback does not discard earlier years):

```bash
npm run kzk:decisions -- --backfill --apply
```

**Step 5 — measure the recovery before publishing anything.** Read-only:

```bash
node -e "
const d=JSON.parse(require('fs').readFileSync('data/procurement/kzk_decisions.json','utf8'));
const ACT=/^АКТ-\d+-\d{2}\.\d{2}\.\d{4}\$/;
const g=d.decisions.filter(x=>ACT.test((x.no||'').trim()));
const bad=d.decisions.length-g.length;
console.log('clean',g.length,'rejected',bad);
console.log('clean rows still missing init+resp:',g.filter(x=>!x.init&&!x.resp).length,'(was 363)');
console.log('pron still capped at 160:',g.filter(x=>String(x.pron||'').length===160).length,'(was 2765)');
"
```

**Success is `still missing init+resp` falling well below 363.** If it does not move,
the re-crawl did not recover anything and Steps 6–8 must not run.

**Step 6 — load and rejoin LOCAL, dry first.**

```bash
DATABASE_URL="$KZK_LOCAL" npm run db:load:kzk-decisions:pg
DATABASE_URL="$KZK_LOCAL" npm run kzk:rejoin -- --dry-run     # ← compare against §1.3
```

The dry run is the comparison the prompt asks for. Against the recorded baseline:

| | baseline (2026-08-22) | after |
|---|---|---|
| decisions matched into 1:1 | 2,920 | must be **≥ 2,920** |
| appeals claimed by >1 act | 43 | must not rise materially |
| parties with >1 candidate appeal | 1,408 | must not rise materially |
| decisions matching nothing | 1,716 | expected to FALL |
| hand-seeded rows left untouched | 1,936 | must not fall |
| hand-seeded conflicts listed | 4 | read every new one by hand |

**A rise in `ambiguous` is the failure mode to watch for**, not a fall in matches.
Restoring 363 sets of party names introduces 363 new claimants, and an act that now
claims an appeal another act already claims makes that appeal ambiguous — which
*removes* an outcome. If `ambiguous` rises by more than a handful, stop: the net effect
may be negative and the ratchet will (correctly) refuse the apply.

**Step 7 — apply locally, then verify the constraint.**

```bash
DATABASE_URL="$KZK_LOCAL" npm run kzk:rejoin -- --apply
psql "$KZK_LOCAL" -At -c \
  "SELECT count(*) FROM kzk_appeals WHERE outcome IS NOT NULL AND decision_act_no IS NULL;"
#  MUST print exactly 2098
npm run test:data 2>&1 | grep -i kzk
```

**Step 8 — publish, in this order, nothing automatic.**

```bash
npm run db:load:kzk-decisions:pg:cloud
npm run kzk:rejoin:cloud -- --apply
psql "postgres://postgres@127.0.0.1:5434/electionsbg" -At -c \
  "SELECT count(*) FROM kzk_appeals WHERE outcome IS NOT NULL AND decision_act_no IS NULL;"
#  MUST print exactly 2098
```

The rejoin refreshes `upheld_ocids` through `kzk_dependents.ts`, which is what carries
the recovered upholds into the risk index. Skipping it leaves prod grading recently
appealed procedures cleaner than they are.

**Step 9 — commit the ratchet upward only.** `recordBaselines` writes upward by
construction; commit `data/procurement/derived/kzk_baselines.json` when the rejoin says
it moved. **Never lower it.** If the new run scores below 3,078 / 2,920, that is Gate C
or D failing and the answer is to revert, not to edit the file.

## 1.7 Gating and rollback

**Gates.**

| gate | where | what it catches |
|---|---|---|
| act-count invariant (new) | `kzk_decisions.test.ts` | records parsed > `АКТ-…` tokens on the page — i.e. any fracture, on any rendering, offline |
| wrapping fixture (new) | `kzk_decisions.test.ts` | this specific defect; mutation-checked by reverting the regex |
| `validateDecisions` rate ceiling (15%) | crawler + loader | a rendering change that fractures *most* records |
| shrink guard (95%) | `load_kzk_decisions_pg.ts` | a short or year-scoped JSON reaching the anti-join DELETE |
| `HAND_SEEDED_FLOOR = 2098` | `kzk_baselines.ts` | the irreplaceable rows, in both directions |
| Gates C / D (ratchet) | `kzk_baselines.json` | a matcher/parser change that loses coverage |
| `kzk_decisions.data.test.ts` | `test:data` | a malformed act reaching the table |

**Rollback.**

- *After Step 1 (A only):* `git checkout` the two files. No data touched.
- *After Step 4 (backfill written):* restore
  `data/procurement/kzk_decisions.json.pre-fix.bak`, re-run
  `db:load:kzk-decisions:pg`. The loader's shrink guard will refuse if the restore is
  short — pass `--allow-shrink` **only** after confirming the row delta against the
  backup by hand.
- *After Step 7 (local rejoin applied):* the rejoin is idempotent and provenance-safe;
  re-running it against a restored `kzk_decisions` re-derives the previous outcomes.
  Rows with `decision_act_no IS NOT NULL` are re-derivable by design; the 2,098 were
  never written.
- *After Step 8 (cloud applied):* same, against `:5434`. If the cloud state is worse
  than local and cannot be re-derived, `db:restore:cloud` from the Step-0 dump — but
  note that dump is of LOCAL, so it is a restore of the corpus, not of prod.

**One irreversible step exists and it is Step 4**: `--backfill --apply` overwrites the
only copy of the corpus (union-merged, so it cannot lose acts — but it can overwrite
field VALUES via `mergeDecisionInto`, which applies any non-null incoming value). Step 0's
backup is what makes it reversible.

## 1.8 Needs a human decision — do not decide these silently

1. **Whether to purge the 429 (option C), and when.** They are inert (always rejected,
   never loaded) but they hold the *only surviving copy* of 362 (complainant, respondent,
   case-number) triples for acts that the corpus otherwise cannot name. Purging before
   the backfill proves recovery destroys that. Purging after is safe and stops the loader
   printing a misleading warning for ever. **Recommendation: purge only after Step 5
   shows recovery, and keep the backup.**
2. **Whether to run the backfill at all.** It is a multi-hour headed crawl of a
   rate-limited public register on BG egress, and the payoff is bounded: at most 363
   decisions become matchable, of which 125 are upholds, and an unknown fraction will be
   lost again to newly-created ambiguity. **My read: worth it, because 125 missing
   upholds are a signal defect in the risk index rather than a coverage rounding error —
   but the decision is the operator's, and Step 3 (one year, dry) is the cheap way to
   size it before committing.**
3. **The 4 hand-seeded conflicts.** Three say hand=`отхвърлена` vs derived=`уважена`.
   That is the direction that matters (an uphold recorded as a rejection), and the
   provenance rule correctly refuses to write over them. They deserve a manual look at
   the register — separately from this plan.
4. **Whether the 160-char `pron` truncation is worth its own remediation.** Measured
   harmless on the 147 rows testable today. The backfill fixes it for free as a side
   effect; nothing else should be built for it.

---

# Problem 2 — local and Cloud SQL person layers have drifted

## 2.1 Evidence

Re-measured 2026-08-22, local :5433 vs Cloud SQL through the proxy on :5434.

### The source corpus is byte-identical; the derived layer is not

| table | local | cloud | Δ |
|---|---|---|---|
| `tr_companies` | 1,020,707 | 1,020,707 | **0** |
| `tr_officers` | 872,202 | 872,202 | **0** |
| `tr_person_roles` | 1,340,793 | 1,340,793 | **0** |
| `tr_name_fold_people` | 456,398 | 456,398 | **0** |
| `declaration` | 61,743 | 61,743 | **0** (and `person_id` 100% populated on both) |
| `council_vote` with `person_id` | 43,261 | 43,261 | **0** |
| `person` | 133,727 | 133,721 | +6 local |
| `person_role` | 323,472 | 323,445 | +27 local |
| `person_role` @ `source='tr'` | 192,398 | 192,369 | +29 local |
| `person_slug_lock` | 144,274 | 143,521 | +753 local |
| `person_slug_retired` | 25,719 | 24,910 | +809 local |
| `company_politicians` | 982 | 973 | +9 local |
| `person_browse_table` | 136,877 | 136,875 | +2 local |
| `graph_edge` | 200,498 | 200,463 | +35 local |
| `graph_person_node` | 83,301 | **83,304** | **−3 local** |

`graph_person_node` being *higher* on cloud already rules out „local is simply ahead".

### The divergence is collision splits, and local has more of them

| | local | cloud |
|---|---|---|
| public-figure slugs (`is_public_figure AND slug IS NOT NULL`) | **63,782** | **63,782** |
| shared | 62,366 | 62,366 |
| present on this side only | 1,422 | 1,416 |
| …of which `-N` collision-suffixed | **1,395 (98.1%)** | **2 (0.1%)** |
| **collision-suffixed slugs** (`~ '-[0-9]+$'` AND NOT `^mp-[0-9]+$`) | **6,985** | **5,592** |
| …of which resolver-minted (the name-hash tier) | 5,744 | 4,337 |
| …of which officials-origin (the slug IS a `person_role.ref`) | 1,241 | 1,255 |

The two databases hold **exactly the same number of public figures** and disagree about
~1,420 of their identities. Local carries **1,393 more collision-suffixed slugs** than
cloud — which accounts for the whole gap, including the `person`, `person_slug_lock`
and `person_slug_retired` deltas.

⚠️ **`person.slug ~ '-[0-9]+$'` is NOT a collision test, and v1 of this plan used it as
one.** It also matches every `mp-<id>` slug — **2,118 on each side** — so v1's
„9,103 / 7,710" were inflated by that constant. The Δ of 1,393 is unaffected (the MP
count is identical on both) and every conclusion drawn from the Δ stands, but any future
probe must exclude `^mp-[0-9]+$`. Recorded as §6.1.

The split by origin decides where a repair belongs: **officials-origin suffixes are
level** (1,241 vs 1,255 — those come from the officials ingest's own
`_slug_collisions.json`, not from the resolver). **The whole divergence sits in the
resolver's name-hash tier**, 5,744 vs 4,337.

A worked example (the first local-only slug alphabetically):

```
local  :5433   abidin-mehmed-hadzhimehmed-fe44ee    person_id 11   candidate
               abidin-mehmed-hadzhimehmed-fe44ee-2  person_id 12   official_muni
cloud  :5434   abidin-mehmed-hadzhimehmed-fe44ee    person_id 12   official_muni
```

**One human. Local publishes two profiles and splits their candidacy from their office;
cloud publishes one.** That is the defect the collision-fold work exists to remove — so
**local is the degraded copy**, and the „+753 / +809 local" reading in the symptom
inverts what is actually true.

### The mechanism is a ratchet, which is why re-resolving cannot converge it

`person_slug_lock` accumulates per database and is never truncated. A mention whose
preferred slug is already locked to a different person takes `-2`. So every resolve adds
locks, more locks mint more `-N` slugs, and the two databases **diverge monotonically**.
Local has been re-resolved more times (144,274 locks vs 143,521) and has correspondingly
more splits. Nothing in the resolver reads the other database's lock table, so no number
of re-resolves on either side can bring them together.

### The manifest is correct, and the drift is *not* purely latent any more

`data/person/prerender_slugs.json` (committed, 8.28 MB, mtime 2026-08-14): 63,782
entries, `prerender: true` on **25,358**, `indexable: true` on **44,655**, and
`prerender ⊆ indexable` (0 entries prerendered but not indexable).

| check | result |
|---|---|
| manifest slugs absent from **CLOUD** `person` | **0** |
| manifest slugs absent from **LOCAL** `person` | **1,416** |
| …of which are in the **prerender** set | **834** |
| …of which are `indexable` | 846 |
| manifest `indexable` vs **CLOUD** live floor | **0 disagreements / 63,782** |
| manifest `indexable` vs **LOCAL** live floor | **236 disagreements / 62,366 shared** |
| …of the 236, in the **prerender** set | **181** |

So: **the manifest was correctly minted from the serving database and is still exactly
current against it.** Zero dangling `<loc>`s, zero soft-404 prerenders. `isServingDatabase()`
did its job.

But `emit_prerender_slugs.ts`'s own header says the exposure was bounded because
„that ~5,000-entry ex-officials set was byte-identical between the local- and
cloud-minted manifests (0 churn)". **That is superseded.** The prerender set has widened
from ~5,000 to **25,358**, and **834 of its slugs (3.3%) now exist only on cloud**, with
**181 more disagreeing on `indexable`**. The header predicted precisely this
(„It stops being latent the moment the prerender set widens") — it has widened.

### Answers to the four questions

**1. Is the drift still latent?** **Yes for what is served; no for the safety margin.**
Nothing reads `indexable` at runtime — grepped across `src/`, `scripts/`, `functions/`
and `ai/`, the only readers are `emit_prerender_slugs.ts` itself and its tests. Both
manifest consumers filter on `prerender` (`scripts/sitemap/index.ts:478`,
`if (!e.prerender) continue;`, and `buildPersonRoutes`). And the manifest resolves 100%
on cloud. So no wrong page is built and no wrong `<loc>` ships today.

What has changed is that the single guard now stands between correct output and **834
prerendered soft-404s plus 834 dead sitemap entries**, where the header measured 0.

**And the „content disagreement" question CLAUDE.md left open is now answered: it is a
standing split, not a temporal artifact.** The 236 flips are live *today* between two
databases whose `declaration` corpus is identical (61,743 rows, fully resolved, both
sides) — so the difference is entirely in `person_role`, i.e. in which identity the roles
hang off. 212 of 236 are local-false / cloud-true: on local the role moved to the `-N`
twin and the bare slug was left holding only a candidacy. That is the collision split
expressing itself through the content floor, not an independent content drift.

**2. Cheapest ongoing detectability.** See §2.3 — a read-only parity probe. Note the
existing machinery cannot do it: `sync_cloud.ts`'s `parityShortfalls` runs only during a
restore and uses a **90% floor**, which a 0.02%–3.3% drift never trips.

**3. When is a cloud re-resolve justified?** See §2.4 — essentially never for *this*.

**4. Is `company_politicians` a TR-vintage lag?** **No.** The diff:

```
shared 968 · local-only 14 · cloud-only 5
```

and every differing row's `ref` is a person-layer key (`/officials/<slug>`,
`/candidate/mp-<n>`). `load_tr_pg.ts` builds both arms **from the gated person layer**
(`person_role` ⨝ contracts), and the TR corpus is byte-identical on both sides — so a
`db:load:tr:pg:cloud` would rebuild cloud's copy from the *same* TR rows against *cloud's*
person layer and produce cloud's answer again. **The 9-row gap is downstream of the slug
divergence and will not close.** Run `db:load:tr:pg:cloud` when the TR corpus moves, for
its own reasons — not to fix this number.

## 2.2 Root cause

`person_slug_lock` is resolve-run **history**, not an input, and it is append-only. Two
databases re-resolved a different number of times hand the same people different slugs,
and the difference compounds. Cloud has been re-resolved fewer times, so it carries fewer
locks, fewer forced collisions and fewer split identities.

There is no bug to fix here. The design consequence — that the derived person layer is a
**per-database artifact** — is already documented in `CLAUDE.md` and in the emitter's
header. What is missing is (i) an ongoing detector, and (ii) an updated record, since the
committed prose still says the exposure is confined to a 5,000-entry set that no longer
exists at that size.

## 2.3 Recommendation — do not converge; detect, and correct the record

### R1 — a read-only parity probe (the answer to question 2)

`scripts/db/person_parity.ts`, run against both databases, printing one table and exiting
non-zero on a declared threshold breach. Everything it needs is measurable in seconds and
every query in it appears in §2.1 above:

| signal | today | why it is the right signal |
|---|---|---|
| public-figure slug count, both sides | 63,782 / 63,782 | a divergence here is population drift, not identity churn — a different, worse class |
| shared / local-only / cloud-only slugs | 62,366 / 1,422 / 1,416 | the headline drift number |
| `-N` share of the one-sided sets | 1,395 / 2 | separates collision churn (benign-ish) from real identity divergence (not) |
| **manifest slugs absent from the SERVING db** | **0** | **the only one that is a live defect.** Non-zero = shipped soft-404s |
| manifest `indexable` vs serving-db live floor | 0 | proves the manifest has not gone stale against the database that serves it |
| `person_slug_retired` health, both sides | 0 / 0 / 0 / 0 | re-verified: no null targets, no missing targets, no chains, no retired-and-live |

**The threshold that should fail the build is the fourth row, and only it.** The others
are reported, not asserted — they will drift for ever by design, and an assertion on them
would be a gate nobody can keep green.

Cheapest placement, in increasing order of cost:

1. **A `test:data` gate is the wrong home** — it pins the local database, so it is
   structurally blind to cloud (the same trap `graph.data.test.ts` documents:
   `pinLocalDatabase()` makes a cloud comparison return local's numbers twice).
2. **A step in `process-watch-report`'s person chain** — the natural home. It already
   opens the proxy and already runs the `:cloud` loaders; the probe is one read-only
   command at the end.
3. **A standalone `npm run person:parity`** the operator can run any time. This is what
   R1 should ship as, with (2) calling it.

### R2 — correct the committed record

`scripts/person/emit_prerender_slugs.ts`'s „SCOPE, HONESTLY" block and the matching
`CLAUDE.md` passage both rest on measurements that are now stale in the unsafe direction
(„~5,000-entry set, 0 churn" → 25,358-entry set, 834 churn; „whether that was purely
temporal is NOT established" → established, standing, and mechanistically explained).
Update both with the 2026-08-22 figures. This is documentation, but it is the half that
decides whether the next person reads the guard as belt-and-braces or as load-bearing.

### R3 — leave the drift alone

Nothing else. Local is the degraded copy and it is not what serves; cloud is
self-consistent, and the manifest that binds them is correct.

**One thing that IS worth doing when convenient**, and is unrelated to parity: local's
9,103 `-N` slugs are 1,393 more split identities than the corpus warrants, and they
degrade local `/persons` and `/connections` for development. The cheap repair is a local
`person_slug_lock` truncation **followed by a full local re-resolve and the whole
repair chain** (`CLAUDE.md`, „A LOCAL `db:resolve:persons` is never one command"). That
is a local-hygiene task, not a parity task, and it will make the two databases *more*
different before it makes them cleaner. Out of scope here; flagged as a decision (§2.6).

## 2.4 When a cloud re-resolve IS justified (question 3)

**Never for slug parity.** A cloud re-resolve re-mints against cloud's own accumulated
lock table, so it cannot import local's identity decisions, converges nothing, and costs:

- ~29–37 min of resolve (measured on the *old* `db-g1-small`; not re-measured on
  `db-perf-optimized-N-2`, so treat as an upper bound);
- the mandatory repair chain after it — `db:load:declarations:pg:cloud` phase 1 and
  phase 2, `db:load:person-elections:pg:cloud`, `db:load:official-candidate-links:pg:cloud`,
  `db:load:council:pg:cloud`, `db:load:persons-browse:pg:cloud`,
  `db:load:person-search:pg:cloud`, `db:load:graph:pg:cloud`,
  `db:load:agri-hub-stats:pg:cloud`, `db:load:tr-company-place:pg:cloud`;
- an **~8-minute window** in which `/persons`, `/officials/assets`, `/mp-assets` and
  `/declarations/crypto` serve **500** (090's `DROP MATERIALIZED VIEW … CASCADE`, and a
  DbDataTable resource has no `missingMigration` degrade);
- churn on ~1,400 live `/person` URLs, each needing a `person_slug_retired` row that
  `collapseSlugRedirectChains()` then has to flatten.

**The triggers that DO justify one**, all of them about content rather than parity:

| trigger | why |
|---|---|
| a new upstream identity source lands on cloud (`ivss_declarations`, `cacbg_officials`, `cacbg_local`, `egov_commerce`, `cik_results`, `erik_campaign_financing`, `ofac_sanctions`, `comdos_ds`, `regulator_rosters`) | the resolve is the only thing that turns it into `person` / `person_role` |
| `db:load:magistrates:pg:cloud` or `db:load:judicial-bodies:pg:cloud` ran | the resolver reads `judicial_body_alias`; a stale one publishes ~2,700 magistrate roles with no court |
| the officials roster re-slugs | `declaration.subject_ref` and the office-period `date_basis` both depend on it |
| a resolver **rule** change (fold, bridge gate, `date_basis`) | a rule change ships no data by itself |
| a resolve on cloud is observed to have **aborted mid-chain** | 090's CASCADE has already committed; the survivor set dates the failure — see `collateral_drop.ts` |

And one hard precondition regardless: **if a cloud re-resolve is run, `npm run
person:slugs:cloud` MUST follow it**, or the committed manifest names slugs prod no
longer serves. That is the step that turns a latent divergence into 834+ live soft-404s.

## 2.5 Commands

**The probe (read-only, safe any time):**

```bash
export PGPASSFILE="$PWD/.pgpass"
npm run db:proxy:cloud          # if :5434 is not already up — check with: nc -z 127.0.0.1 5434
npm run person:parity           # R1, to be built
```

Until R1 exists, the equivalent by hand — the exact queries behind §2.1:

```bash
export PGPASSFILE="$PWD/.pgpass"
for P in 5433 5434; do
  psql "postgres://postgres@127.0.0.1:$P/electionsbg" -At -F$'\t' \
    -c "SELECT slug FROM person WHERE is_public_figure AND slug IS NOT NULL ORDER BY slug COLLATE \"C\"" \
    > /tmp/person_$P.slugs
done
node -e "
const fs=require('fs');
const rd=f=>new Set(fs.readFileSync(f,'utf8').split('\n').filter(Boolean));
const L=rd('/tmp/person_5433.slugs'), C=rd('/tmp/person_5434.slugs');
const man=Object.values(JSON.parse(fs.readFileSync('data/person/prerender_slugs.json','utf8')));
const onlyL=[...L].filter(s=>!C.has(s)), onlyC=[...C].filter(s=>!L.has(s));
const isN=s=>/-[0-9]+\$/.test(s);
console.log('public-figure slugs  local',L.size,' cloud',C.size);
console.log('only local',onlyL.length,'(-N:',onlyL.filter(isN).length,')  only cloud',onlyC.length,'(-N:',onlyC.filter(isN).length,')');
const miss=man.filter(e=>!C.has(e.slug));
console.log('MANIFEST slugs absent from the SERVING db:',miss.length,'(prerender:',miss.filter(e=>e.prerender).length,') ← must be 0');
"
```

**No write commands are proposed for Problem 2.** That is the recommendation.

## 2.6 Needs a human decision

1. **Whether to repair local's 1,393 excess collision splits.** It costs a local
   `person_slug_lock` truncation + a full re-resolve + the nine-step repair chain, and it
   will *widen* the measured slug gap before it narrows anything. It buys a local
   `/persons` and `/connections` that match what prod shows. **Recommendation: yes, but
   as its own task, and only when a local re-resolve is happening anyway.**
2. **Where the parity probe should fail vs merely report.** My proposal is: fail on
   „manifest slugs absent from the serving database > 0" and report everything else. A
   stricter threshold (e.g. „slug divergence < 2%") would be green today at 2.2% and is
   one resolve away from being permanently red.
3. **Whether `person:parity` belongs in `process-watch-report`'s person chain** (adds one
   read-only step to every person publish) or stays operator-invoked.

---

# 3. Lower-priority items from the same run

## 3.1 `db:load:nzok-hospital:pg` — 25 skipped months, and a cloud gap nobody mentioned

**The cloud gap is the newer finding and is not in the loader's own TODO:**

| | local :5433 | cloud :5434 |
|---|---|---|
| `nzok_hospital_payments` rows | **19,109** | **18,679** |
| distinct periods | **43** | **42** |
| period range | 2023-01 … **2026-07** | 2023-01 … **2026-06** |

`db:load:nzok-hospital:pg:cloud` **is** wired into `update-nzok` and into
`process-watch-report`'s `nzok_hospital_bmp` row, so this is not a coverage hole in the
skill graph — the `:cloud` half simply did not run in this session. **One command
closes it**, and it should be run before anything else here is scoped:

```bash
export PGPASSFILE="$PWD/.pgpass"
npm run db:load:nzok-hospital:pg:cloud
npm run db:load:nzok-hospital-map:pg:cloud   # facility universe may have moved
```

**The skipped months are better characterised per (year, stream) than as a flat „25".**
The loader attempts `YEARS = [2026, 2025, 2024, 2023]` × 12 × 3 streams; what actually
landed locally:

| year | stream | months present | missing |
|---|---|---|---|
| 2026 | bmp | 6 | 01 |
| 2026 | **devices** | **1** | **01, 03, 04, 05, 06, 07** |
| 2026 | drugs | 7 | — |
| 2025 | bmp | 11 | 01 |
| 2025 | **devices** | 8 | 01, 02, 03, 06 |
| 2025 | drugs | 12 | — |
| 2024 | bmp | 12 | — |
| 2024 | **devices** | 7 | 01, 09, 10, 11, 12 |
| 2024 | drugs | 11 | 06 |
| 2023 | bmp | 9 | 01, 02, 03 |
| 2023 | **devices** | 9 | 01, 06, 07 |
| 2023 | drugs | 10 | 06, 07 |

**`devices` is the whole story** — 2026 holds one month of seven. The `bmp` and `drugs`
streams are near-complete apart from the documented early-year 3-column layout
(2023 Jan–Mar, and January in each of 2025/2026).

Scoping note, and it is the reason this is low priority rather than ignorable: a
hospital's НЗОК income is the **sum** of the three streams, so a facility whose
`devices` months are missing is *understated*, not absent — the same silent-partial shape
`nzok_casemix_expected_vs_actual()`'s `partial-payment-year` guard exists for. Worth
checking whether that guard's `fullYearMonths` denominator is derived per stream or
across all three before treating the case-mix ratios from 2026 as sound. **Not
investigated here.**

The remediation is per-era parser work in `scripts/nzok/parse_hospital_payments.ts`,
tracked in `scripts/nzok/README.md`. The loader's behaviour is correct as it stands:
`NhifNetworkError` is skippable only under `--tolerate-offline`, a reconciliation failure
skips the month rather than shipping wrong numbers, and both are reported.

## 3.2 `data.egov.bg` 403s this host — Tier B of the awarder geo map

Confirmed 2026-08-22:

```
https://data.egov.bg/api/listDatasets  → 403
https://data.egov.bg/                  → 403
```

This is the egress-IP block already recorded in
[[reference_egov_api_endpoints]] / [[reference_egov_operator_midt]], not a new outage.

`scripts/procurement/awarder_geo_map.ts` handles it correctly by design: the МОН school
register (Tier B) is fetched defensively, `down()` returns an empty index on any failure
with an explicit `Tier B unavailable — МОН register fetch failed: …` line, and the merge
**carries prior entries forward** (92 carried, 0 dropped on this run) with the staleness
of a down tier's carried entries reported.

**No action proposed.** What is worth writing down, because it is invisible from a green
run: **Tier B is an intermittently-unavailable geo tier whose availability depends on the
egress IP of whichever machine runs the ingest**, so its contribution to
`awarder_seats` is not reproducible across machines. Two consequences to keep in mind
rather than fix:

- A machine that has *never* had egov access has no carried-forward entries to inherit,
  so on a fresh clone Tier B contributes zero rather than 92.
- `db:load:awarder-seats:pg:cloud` refreshes 119 + 123 + 124, so a run with Tier B down
  publishes the carried-forward attribution — correct, but one vintage old for any
  school whose seat changed.

If this becomes a real constraint, the durable fix is the same as for every other
egov-dependent ingest: commit the resolved crosswalk rather than the fetch, so the tier
is reproducible offline. Out of scope.

---

# 4. Decisions this plan deliberately does not take

| # | decision | §  |
|---|---|---|
| 1 | Whether to purge the 429 fragments from the corpus, and when | 1.8 |
| 2 | Whether the multi-hour `--backfill` re-crawl is worth its cost | 1.8 |
| 3 | What to do about the 4 hand-seeded outcome conflicts | 1.8 |
| 4 | Whether to repair local's 1,393 excess collision splits | 2.6 |
| 5 | Where the person-parity probe fails vs merely reports | 2.6 |
| 6 | Whether `person:parity` joins `process-watch-report`'s person chain | 2.6 |
| 7 | Whether the `nzok_casemix` `partial-payment-year` guard is stream-aware | 3.1 |
| ~~8~~ | ~~whether `отказано производство` becomes an outcome~~ — **DECIDED: it is an outcome.** Derive at query time, never store (§7.1) | 6.3, 7.1 |
| 9 | **v1.1** — the slug tiebreak's priority order, and that it must ride a cloud re-resolve happening for another reason rather than trigger one. **Downgraded by §7.2** — it is a symptom of the under-merge, not the disease | 6.6, 6.9, 7.2 |
| ~~10~~ | ~~whether the 71 same-name families are namesakes or fragments~~ — **RESOLVED: not namesakes.** ~2,781 duplicate profiles on prod (§7.2) | 6.7, 7.2 |
| ~~11~~ | ~~whether the party-ambiguity bucket gets its own plan~~ — **DELEGATED** to `docs/plans/kzk-matcher-ambiguity-v1.md` (§7.3) | 6.2, 7.3 |
| **12** | **v1.2** — the reader-facing label for the refusal outcome (`отказана` as a code is fine; „отказано образуване на производство" is the honest chip text) | 7.1 |
| **13** | **v1.2** — whether the 1,639 re-election duplicates (the safest shape) are merged as their own change, or wait for one resolver fix | 7.2 |

# 5. What was NOT done in this session

- **No fix applied.** No source file edited, no migration applied, no loader run, no
  `--apply` anywhere. The only KZK command executed was `kzk:rejoin -- --dry-run`,
  which is read-only by construction (it refuses to run without `decision_act_no`
  present rather than applying 131).
- **No crawl.** `--probe` was not run: it needs a headed browser and Bulgarian egress.
  Every claim about the register's live markup in §1.2 is derived from the committed
  corpus and from running the committed parser on synthetic input, **not** from the
  live site.
- **No write to either database.** All 40+ queries were `SELECT`.
- **The parser fix in §1.5 is a proposal, not a patch.** It has not been applied and its
  regression suite has not been written.


---

# 6. v1.1 — audit of this plan (2026-08-22)

Everything below was measured after v1 was committed, by auditing v1's own claims
against the code and both databases. **Nothing here is implemented either.**

The one-line verdict: **v1's Problem 1 diagnosis is correct but its harm sizing is 6×
too small, and v1's Problem 2 recommendation („detect, do not converge") stops one
question short of the actual defect — which is live on production and has nothing to do
with parity.**

## 6.1 CORRECTION — v1 used a regex that is not a collision test

`person.slug ~ '-[0-9]+$'` also matches every `mp-<id>` slug. **2,118 on each side.**

| | v1 said | correct |
|---|---|---|
| local „`-N` collision slugs" | 9,103 | **6,985** |
| cloud „`-N` collision slugs" | 7,710 | **5,592** |
| **Δ** | **1,393** | **1,393** — unchanged |

The Δ is what every v1 conclusion rests on and the MP count is identical on both sides,
so **no conclusion changes.** But the absolute numbers were wrong in a published plan,
and the same regex appears in v1's §2.5 hand-probe — anything built from it must carry
`AND slug !~ '^mp-[0-9]+$'`. A `regexp_replace(slug,'-[0-9]+$','')` „base" also collapses
all 2,118 MPs into one bogus family of size 2,118, which is how this was caught.

**New, and it narrows the repair:** splitting the corrected set by origin shows the
officials-origin suffixes are **level** (local 1,241, cloud 1,255 — those are minted by
the officials ingest's `_slug_collisions.json`, not by the resolver). **The entire
divergence is the resolver's name-hash tier: 5,744 vs 4,337.**

## 6.2 GAP — P1's harm sizing is 6× too small, and the parser is not the main lever

v1 sized the damage as „363 acts loaded and unmatchable" and never asked what the total
outcome-coverage gap is. Measured, by the register's own status:

| `kzk_appeals.status` | appeals | with outcome | % |
|---|---|---|---|
| **приключено производство** (concluded) | **5,043** | **2,725** | **54.0** |
| отказано производство (refused) | 1,661 | 12 | 0.7 |
| открито производство (open) | 716 | 230 | 32.1 |
| обединено (consolidated) | 261 | 102 | 39.1 |
| иницииран процес | 199 | 0 | 0.0 |
| прекратено производство | 95 | 9 | 9.5 |
| оставено без движение | 19 | 0 | 0.0 |
| спряно производство | 4 | 0 | 0.0 |

**2,318 appeals that КЗК has CONCLUDED carry no outcome.** The 363 gutted decisions are
at most ~15% of that. The rest sits in the matcher's own reported buckets — 1,408 parties
with more than one candidate appeal in the year window, 43 appeals claimed by two acts,
and name-fold misses.

**What this changes about the plan.** The parser fix (§1.5 A) is still unconditionally
right — it is cheap, offline, and stops the defect recurring. The **re-crawl (B) is now
clearly the smaller lever**, and the honest expected value is „recovers up to 363
decisions, of which 125 are upholds, against a 2,318-appeal gap". v1's §1.8 decision 2
(„is the backfill worth a multi-hour headed crawl?") should be read with that
denominator, which v1 did not supply.

**The bigger lever was never scoped: the matcher's 1,408 party-ambiguous bucket.** That
is its own piece of work and it is offline, free and re-runnable — `kzk_rejoin` exists
precisely so a matcher fix costs no crawl. It belongs in a follow-up plan; **it does not
belong bolted onto this one**, because a matcher change and a corpus change landing in
the same rejoin make the ratchet's movement unattributable.

## 6.3 GAP — 1,661 appeals publish a blank outcome where the register states a refusal

> **DECIDED 2026-08-22 by the repo owner: `отказано производство` IS an outcome.** The
> filing was denied and will never be reviewed on the merits. It is a terminal state, not
> a missing value. **How to record it is designed in §7.1 — and it must NOT be an
> `UPDATE … SET outcome`, for a reason that is not obvious.**


`отказано производство` — КЗК refused to open proceedings. That is a determinate,
published state, and the appeal surfaces render it as no outcome at all. It needs **no
crawl and no matcher**: it is already in `kzk_appeals.status`.

Whether it should become an `outcome` is a **design decision, not a bug fix**, and it
must not be taken silently: `outcome` feeds `upheld_ocids` → the Corruption Risk Index,
and a refusal is not a merits ruling. The safe shape is almost certainly to leave
`outcome` NULL and have the SURFACE say „производството е отказано" rather than showing
a blank — i.e. a UI change, not a data change. Flagged, not designed.

## 6.4 INVESTIGATED AND REJECTED — `appealed_act` as an exact matcher key

Worth recording so nobody re-chases it. `kzk_appeals.appealed_act` is populated on
**7,998 of 7,998** rows (5,964 distinct, e.g. `D56292596`), and КЗК's `Произнасяне`
quotes the annulled buyer decision by number — the very text that causes the fracture in
§1.2. That looks like a free exact disambiguator for the 1,408 ambiguous parties.

**Measured: it is not there.** Of the 100 crawled решения, **1** contains a `D`-prefixed
act token in `pronouncement` at all, and **1** matches any appeal's `appealed_act`.
Across all 377 crawled rows the match count is 2. The register's list-page `Произнасяне`
mostly does not quote the act number; the определения arm (277 of 377) is a one-line
ruling with no act reference whatsoever.

Re-measure after a backfill un-truncates the legacy `pron` — it may improve — but do not
plan around it.

## 6.5 VALIDATED — the proposed regex in §1.5 (v1 shipped it unverified)

v1 proposed the lookahead fix without testing it against the register's real header
shapes. Now tested against all eight:

| header shape | old | new |
|---|---|---|
| `1     Решение № АКТ-734-23.07.2026` (ot=2, ordinal) | 1 | **1** |
| `2   Определение № АКТ-847-20.08.2026` (ot=6, ordinal) | 1 | **1** |
| `Решение № АКТ-5-01.02.2026` (no ordinal) | 1 | **1** |
| non-breaking space between `№` and the act | 1 | **1** |
| `Акт № АКТ-1-01.01.2020` | 1 | **1** |
| inline quote (already safe under both) | 0 | **0** |
| **`Решение № РД-25/10.01.2026 г. на кмета`** at line start | **1** | **0** ✅ |
| **`Решение № D48869521/03.10.2025 г.`** at line start | **1** | **0** ✅ |

Preserves all six legitimate shapes; kills exactly the two fracture cases. The fix is
sound as written.

## 6.6 GAP — the live Problem-2 defect v1 missed: the canonical URL goes to the wrong person

**This is the „underlying issue" the parity framing hid, and it is on PRODUCTION.**

v1 asked „do the two databases agree?" and concluded „no, but cloud is correct and
serves, so it is latent". It never asked the independent question: **on the serving
database, is the canonical `/person/<name>-<hash>` URL held by the right human?**

Measured on Cloud SQL, comparing each collision-suffixed person against the person
holding its base slug, „content" being the manifest's own floor (a declaration, or any
`person_role` whose source is not `candidate`):

| | cloud (serving) | local |
|---|---|---|
| base/`-N` pairs where both are live | 197 | 1,582 |
| **`-N` twin has content, base does NOT — the canonical URL is the empty one** | **34** | **402** |
| base has content, `-N` does not (correct) | 24 | 204 |
| both have content | 71 | 721 |
| neither | 68 | 255 |

**All 34 of the substantive twins on cloud are `prerender: true` and `indexable: true`,
and all 34 of the contentless base slugs are also in the manifest.** So production ships
two indexed pages per case, and the one with the shorter, canonical-looking URL is the
empty namesake. Examples: `emil-denchev-enchev-196819` (empty) beside `-2` and `-3`
(both „Емил Денчев Енчев", both with content); `emil-dimitrov-1hwpnn` beside `-3` and
`-4` (both „Емил Сашев Димитров").

### Root cause — the contest is decided by iteration order, not by claim

`chooseStableSlug` (`scripts/person/slugLock.ts`) returns a person's locked slug with
**no knowledge of whether another cluster in the same run has already claimed it**. The
deduplication is then a bare loop in `resolve_persons.ts` (~line 1851):

```js
const seen = new Set();
for (const b of built) {
  let s = b.slug; let i = 2;
  while (seen.has(s)) s = `${b.slug}-${i++}`;
  b.slug = s; seen.add(s);
}
built.sort((a, b) => a.slug.localeCompare(b.slug));   // ← sorts AFTER assigning
```

Whichever cluster `built` happens to reach first keeps the base slug. `built` is not
ordered by anything meaningful at that point — the sort runs *after* — so **the winner is
an artifact of cluster iteration order, not a property of the data.** That is precisely
why the same code produces 34 wrong assignments on cloud and 402 on local from
byte-identical `tr_*` inputs.

**The fix is a deterministic tiebreak**, and it should be by claim strength, in this
order: an anchored tier (MP / officials ref) always wins; then the OLDEST lock
(`firstSeen`, which is already carried in `SlugLock` and already the tiebreak *within* a
cluster); then content-bearing over candidate-only; then slug for determinism. Two
things follow that must be decided rather than assumed — see §6.9.

### The retirement hazard beside it — theoretically live, empirically not observed

The retirement diff a few lines below is:

```js
if (prev && prev !== b.slug && !liveSlugs.has(prev)) retired.set(prev, b.slug);
```

If cluster A held slug `X` and now gets `X-2` while cluster B takes `X`, then
`liveSlugs.has('X')` is **true**, so **no retirement is recorded** — and `/person/X`, a
URL that has been serving person A, silently starts serving person B at a 200 with no
301 and no record anywhere.

**Measured, and it has not happened at scale:** across the 132,305 slugs live on both
databases, only **3** resolve to a different `display_name`, and all three are the same
human with different casing/trailing space (`Андрей Руменов Кадишев ` vs
`АНДРЕЙ РУМЕНОВ КАДИШЕВ`). So this is a **tripwire worth adding, not a confirmed
defect** — but a slug tiebreak change (above) is exactly the edit that could start
moving base slugs between clusters, so the tripwire must land **with** it, not after.

## 6.7 GAP — cluster fragmentation on the serving database, unquantified by v1

Same-base-slug families on cloud, excluding the bogus `mp-` family:

| family size | families | all members share one name | mixed names |
|---|---|---|---|
| 2 | 90 | 86 | 4 |
| 3 | 26 | 26 | 0 |
| 4 | 9 | 9 | 0 |
| 5 | 2 | 2 | 0 |
| 6 | 1 | 1 | 0 |
| 7 | 1 | 1 | 0 |

**125 of the 130 families have every member under one normalised name, and 71 of those
have two or more content-bearing members — 170 people.**

**This needs a human, and it is genuinely ambiguous.** A family of three „Емил Денчев
Енчев" rows is either (a) three real namesakes, which Bulgarian naming makes entirely
plausible and which the resolver is right to keep apart, or (b) one human fragmented
across three profiles by cluster drift. The resolver already carries a `namesakeRisk`
signal per member; nothing currently reports it at family level. **170 people is a
hand-reviewable number** — that is the cheapest way to settle whether this is a defect at
all, and it should happen before any merge logic is written.

## 6.8 VERIFIED CLEAN — so nobody re-audits these

Measured on both databases and found healthy. Recorded because each is a plausible
suspicion that costs an hour to re-check:

| check | local | cloud |
|---|---|---|
| lock rows whose slug is neither live nor retired (dead URL, no 301) | **0** | **0** |
| `person_slug_retired` with a NULL target | 0 | 0 |
| `person_slug_retired` whose target is missing from `person` | 0 | 0 |
| redirect chains (target is itself retired) | 0 | 0 |
| a slug both retired AND live | 0 | 0 |
| `-N` slug whose base 301s to a DIFFERENT person | — | **0** |
| shared slugs resolving to a different human | **3, all casing-only** | |
| untrimmed `display_name` | 0 | 0 |

One more, so it is not mistaken for parity drift later: **44,957 / 44,955 `display_name`
values are ALL-CAPS** on local/cloud respectively — a corpus-wide pre-existing condition
inherited from the TR feed, essentially identical on both sides, and only **171** of them
are `is_public_figure`. It is not a divergence and it is not in scope here.

## 6.9 Revised recommendation for Problem 2

v1 said „detect, do not converge, leave the drift alone". **That still holds for the
drift.** It was the wrong stopping point for the defect underneath it.

| | v1.1 recommendation | why |
|---|---|---|
| **P2-a** | **Give the slug contest a deterministic tiebreak by claim strength** (§6.6) | This is the underlying fix. It is offline, it is in one pure function plus one loop, and it is what makes the outcome a property of the data instead of of iteration order. |
| **P2-b** | **Add the slug-changed-hands tripwire in the same change** (§6.6) | A tiebreak change is the one edit that can start moving base slugs between humans with no 301. Ship the detector with the change, not after. |
| **P2-c** | Hand-review the 170 people in the 71 same-name multi-content families (§6.7) | Settles whether fragmentation is real before anyone writes merge logic for it. |
| **P2-d** | The read-only parity probe from §2.3, with `AND slug !~ '^mp-[0-9]+$'` | Unchanged, minus the §6.1 error. |
| **P2-e** | Still do NOT re-resolve cloud for parity | Unchanged. §2.4's triggers stand. |

⚠️ **The ordering constraint P2-a creates, and it is the expensive one.** A tiebreak
change only takes effect on a **re-resolve**, and a re-resolve on cloud costs the full
§2.4 bill — ~29–37 min plus the nine-step repair chain plus an ~8-minute window at 500 on
four pages. Worse, it will **re-slug some of the 34 affected people**, so each needs a
`person_slug_retired` row and then `npm run person:slugs:cloud` to re-mint the manifest,
or those pages become the soft-404s §2.1 says have so far been avoided.

So P2-a is **not** a „ship it when convenient" change. It should ride the next cloud
re-resolve that is happening for one of §2.4's own reasons, and the plan for that run must
include the manifest re-mint. Landing it alone, to fix 34 pages, is not worth the outage.

## 6.10 What the audit did NOT do

- **Did not size the matcher's 1,408 party-ambiguous bucket** (§6.2). It is named as the
  bigger lever on evidence, and left unquantified; that is a follow-up plan's job.
- **Did not verify the §6.6 tiebreak proposal against a real resolve.** It is reasoned
  from the code, not measured — the only way to measure it is to run a local resolve,
  which mutates 133k rows and was out of scope for an audit.
- **Did not hand-check any of the 71 families** (§6.7) to see whether they are namesakes
  or fragments. That is P2-c and it needs a human who reads Bulgarian names.
- **Did not re-run any Problem-1 command.** §1's evidence is unchanged from v1 apart from
  the additions in §6.2–6.5.

---

# 7. v1.2 — three owner decisions taken, and what measuring them found (2026-08-22)

Three items from §4 came back with rulings. Two of them turned out to change the
diagnosis rather than merely close a question. **Still plan-only; nothing implemented.**

## 7.1 DECIDED — `отказано производство` is an outcome. It must NOT be stored.

**The ruling** (repo owner, 2026-08-22): `отказано производство` means the filing was
denied and **will not be reviewed**. It is a determinate terminal state, so it is an
outcome, not a missing value. 1,661 appeals — 20.8% of the register.

**The trap, and it is the whole of this section.** The obvious implementation is
`UPDATE kzk_appeals SET outcome = … WHERE status = 'отказано производство'`. That would
**silently destroy the provenance guard protecting the 2,098 irreplaceable rows.**

`scripts/procurement/kzk_provenance.ts` partitions on exactly one test:

```
decision_act_no IS NOT NULL  → machine-derived, re-derivable, may be overwritten
decision_act_no IS NULL      → hand-seeded, irreplaceable, NEVER written
```

A status-derived outcome has a **third** provenance — neither hand-seeded nor
act-derived — and it has no act number, so it lands in the protected bucket. Measured
consequence:

| | today | after a stored UPDATE |
|---|---|---|
| `outcome IS NOT NULL AND decision_act_no IS NULL` | **2,098** | **3,759** |
| `HAND_SEEDED_FLOOR` assertion (`>=`, `kzk_appeals_provenance.data.test.ts:74`) | passes | **still passes** ⚠️ |

The gate is a `>=` floor, so it would go green on a corpus whose hand-seeded population
had been inflated by 79% with rows no human ever produced — precisely the laundering
hazard `kzk_baselines.ts` warns about in its `HAND_SEEDED_FLOOR` comment
(„the only way the observed count could rise is … a machine-derived outcome losing its
`decision_act_no` and being re-read as hand-seeded"). It would also freeze those 1,661
rows against every future matcher improvement, because the rule refuses to overwrite
them.

### The design: derive it at query time, exactly like `kzk_effective_suspension`

042 already contains this pattern, and `CLAUDE.md` cites it as the precedent for
`declared_label()`:

```sql
CREATE OR REPLACE FUNCTION kzk_effective_suspension(p_suspension boolean, p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_suspension, p_status ~* 'спрян');
$$;
```

The twin, beside it in 042, and **named once so no call site restates the COALESCE**:

```sql
CREATE OR REPLACE FUNCTION kzk_effective_outcome(p_outcome text, p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_outcome, CASE WHEN p_status ~* 'отказано' THEN 'отказана' END);
$$;
```

Six properties that make this the right shape, each measured or checked:

- **Stores nothing**, so `decision_act_no IS NULL` keeps meaning „hand-seeded" and the
  2,098 stays 2,098.
- **The stored value wins.** 12 appeals carry `status = 'отказано производство'` AND a
  merits outcome (9 `уважена`, 3 `отхвърлена`) — **all 12 hand-seeded.** Either the
  status is stale or the seeding was wrong; either way `COALESCE` keeps the human's
  answer, which is the same precedence `kzk_effective_suspension` uses.
- **`upheld_ocids` cannot be polluted.** 042:201 filters `outcome = 'уважена'` and reads
  the RAW column; a refusal is not an uphold and never becomes one. The Corruption Risk
  Index is untouched by construction — verify that stays true if any consumer is switched
  to the function.
- **The ratchet does not move**, because `kzk_baselines.outcomes` counts the stored
  column. That is correct: 1,661 outcomes appearing from a status re-reading is not the
  matcher getting better, and letting it raise the bar would mask a later real regression.
- **NOT STRICT, deliberately** — same reason 089's `declared_label` is not: `STRICT` would
  return NULL for a row with a NULL `outcome`, which is every row this exists for.
- **`IMMUTABLE`** is honest here (unlike `open_calls`' `is_current`, which cannot be a
  generated column because `CURRENT_DATE` is not immutable) — both inputs are stored text.

### Consumers that must be switched, and the two that must not

Enumerated by grep; this is the `declared_label()` exhaustiveness shape and deserves the
same treatment:

| site | file | switch? |
|---|---|---|
| `kzk_appeals_by_unp` jsonb payload | `042:113` | **yes** |
| `kzk_appeals_recent` | `042:142` | **yes** |
| `kzk_appeals_list` view | `042:267` | **yes** |
| `upheld_ocids` | `042:201` | **NO** — an uphold filter; a refusal is not an uphold |
| `partitionByProvenance` | `kzk_provenance.ts` | **NO** — it reasons about the STORED value; feeding it a derived one would make 1,661 rows look hand-seeded, which is the defect this design avoids |

Frontend labels live in `AppealChip.tsx` / `AwarderAppealsTile.tsx` /
`AppealsBrowserDbScreen.tsx` / `TenderDetailScreen.tsx`, plus the `procurementAppeals` AI
tool and the `db_table.js` registry facet — a new code needs a label and a chip colour in
each, and the DbDataTable facet list will gain a value.

**Needs a human (naming, not mechanism):** the code `отказана` agrees with „жалба" like
its three siblings (`уважена | отхвърлена | прекратена`, declared at `042:42`), but the
register's own phrase is „отказано **производство**" — the refusal is of the PROCEEDINGS,
not of the complaint. Reader-facing copy should probably say „отказано образуване на
производство" rather than a one-word chip. Flagged, not decided.

## 7.2 RESOLVED — the same-name families are NOT namesakes, and the defect is ~40× bigger than §6.7 said

§6.7 asked whether the 71 same-name multi-content families are genuine namesakes or one
human fragmented. **Measured: overwhelmingly the latter, and the slug-collision families
were a ~6% sample of the real population.**

### What the role rows say

Pulling every member's `person_role` for the ambiguous families settles it without
leaving the database:

```
angel-angelov-1dfeea    Ангел Петров Ангелов  local/councillor@SHU23  2023_10_29_mi:SHU23:66:110   2023-10-29 →
angel-angelov-1dfeea-2  Ангел Петров Ангелов  local/councillor@SHU23  2019_10_27_mi:SHU23:1:102    2019-10-27 → 2023-10-29

ivan-petrov-26l5r0      Иван Георгиев Петров  local/councillor@SLV24  2023_10_29_mi:SLV24:23:102   2023-10-29 →
ivan-petrov-26l5r0-2    Иван Георгиев Петров  local/councillor@SLV24  2019_10_27_mi:SLV24:67:102   2019-10-27 → 2023-10-29
ivan-petrov-26l5r0-3    Иван Георгиев Петров  local/councillor@SLV24  2007_10_28_mi:SLV24:5:1      2007-10-28 → 2011-10-23
```

`SHU23` = Велики Преслав, `SLV24` = Твърдица. **Same municipality, same role, consecutive
election cycles — a councillor re-elected, held as two and three separate people.** The
other dominant shape is the same councillor appearing once from the CIK roster
(`local`), once from the Сметна палата officials register (`official_muni`) and once from
the CIK candidate list (`candidate`), all at the same municipality.

### Web verification (as requested)

- **Твърдица** — [zvanar.com's 2023 elected-councillor list](https://zvanar.com/%D0%B2%D0%B8%D0%B6%D1%82%D0%B5-%D0%B8%D0%B7%D0%B1%D1%80%D0%B0%D0%BD%D0%B8%D1%82%D0%B5-%D0%BE%D0%B1%D1%89%D0%B8%D0%BD%D1%81%D0%BA%D0%B8-%D1%81%D1%8A%D0%B2%D0%B5%D1%82%D0%BD%D0%B8%D1%86%D0%B8-%D0%B2/)
  names „Иван Георгиев Петров" among the БЗНС councillors, and he is separately reported
  as **chairman of the Твърдица municipal council** in a КПКОНПИ conflict-of-interest
  ruling upheld by the ВАС ([Sliveninfo](https://sliveninfo.bg/%D0%BA%D0%BF%D0%BA%D0%BE%D0%BD%D0%BF%D0%B8-%D1%83%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%B8-%D0%BA%D0%BE%D0%BD%D1%84%D0%BB%D0%B8%D0%BA%D1%82-%D0%BD%D0%B0-%D0%B8%D0%BD%D1%82%D0%B5%D1%80%D0%B5%D1%81/),
  [Zonanews](https://zonanews.bg/regioni/sliven/vas-potvardi-konflikta-na-interesi-pri-predsedatelya-na-obshtinskiya-savet-tvarditsa)).
  One continuous public figure; our corpus holds him as **three** profiles.
- **results.cik.bg is not fetchable** — HTTP 403, the Cloudflare Turnstile wall the repo
  already documents for `scripts/parsers_local/cik_fetch.ts` (headed Playwright only). The
  CIK rows are in any case already ingested and are what `person_role.ref` quotes.
- **The negative control passes.** `emil-dimitrov-1hwpnn` holds four „Емил Сашев
  Димитров" — two candidacies in Плевен plus councillors in **Баните (SML02)** and **Бяла
  Слатина (VRC08)** in the SAME 2019 cycle. Nobody sits on two municipal councils at
  once, so those two are genuinely different people — and the place-scoped rule below
  correctly declines to merge them.

### The real size, measured on Cloud SQL (the serving database)

Groups of >1 `person` row sharing a normalised **3-part** display name + the same place +
the same role:

| shape | groups | person rows | **excess rows** |
|---|---|---|---|
| **a. one source, several election cycles** (re-elected to the same council) | 1,160 | 2,799 | **1,639** |
| **b. several sources** (CIK roster + officials register + candidate list, same place) | 1,090 | 2,225 | **1,135** |
| c. one source, one cycle — where true namesakes would live | **7** | 14 | **7** |
| **total** | **2,257** | **5,038** | **2,781** |

**~2,781 duplicate `/person` profiles on production**, against the 170 people §6.7 found
via slug collisions. Only **7 groups** sit in the shape where a genuine namesake is even
possible. The 3-part-name restriction is what makes that defensible — a shared given+
family name is common in Bulgaria, a shared given+patronymic+family name in the same
municipality in the same role is not.

### Why this is worse than a duplicate page

Each split profile carries **half a person's history**. A councillor re-elected in 2023
has their 2019–2023 term, its declarations, its wealth series and its company links on
one URL and their current term on another, and neither page says the other exists. The
person layer's entire purpose is „one person_id across nine datasets"; this is that
purpose failing on the municipal tier, which is also the tier with the least press
scrutiny.

### It also re-explains §6.6

The 34 wrong canonical URLs are **a symptom of this, not a separate defect.** A
collision-suffixed slug requires two clusters claiming one slug — which is exactly what
under-merging produces. Fix the merge and most of the 34 stop existing, because the two
clusters become one person. **So the §6.9 tiebreak (P2-a) is the smaller, cosmetic half;
this is the real repair.**

### What must NOT be done

⚠️ **Do not write a merge rule from this section and run it.** „Same 3-part name + same
place + same role → one person" is a strong heuristic and it is still a heuristic; the
person layer's own rule (`CLAUDE.md`, [[feedback_name_match_not_identity]]) is that a
name match is not an identity, and a wrong MERGE is worse than a wrong split — it
attributes one human's declared wealth, company links and votes to another, on a page
that names them. The 7 bucket-c groups are the proof the rule is not universal.

The honest next step is a **separate plan**, sized against the resolver's existing
machinery rather than bolted on: `resolve_persons.ts` already has cluster confidence,
`namesakeRisk`, Bridge A/B and the `tr_name_fold_people` people-count gate. The question
is why the municipal tier's mentions are not clustering when the officials tier's are,
and the place + cycle evidence above is the input to that, not the answer.

**Needs a human:** whether bucket **a** (re-elections, 1,639 excess rows, the safest
shape by a distance — same council, same role, non-overlapping terms) is merged first as
its own change, or whether the whole thing waits for one resolver fix.

## 7.3 DELEGATED — the matcher's party-ambiguity bucket

§6.2 named the 1,408 party-ambiguous / 43 appeal-ambiguous / 1,716 unmatched buckets as
the larger P1 lever and deliberately left them unscoped. That analysis has been spun out
to its own plan — `docs/plans/kzk-matcher-ambiguity-v1.md` — with the same constraints
(2,098 untouchable, ratchet upward-only, offline, no crawl, pin the local DB) and the
explicit brief that **a wrong outcome is worse than a missing one**, so a disambiguator
that cannot be made safe should be recommended against rather than shipped.

Its interaction with §7.1 must be stated wherever both land: the `отказано` change adds
~1,661 EFFECTIVE outcomes without touching the matcher or the stored column, so the two
must not be measured in the same before/after — one moves the served coverage, the other
moves the ratchet.
