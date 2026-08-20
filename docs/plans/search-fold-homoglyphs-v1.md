# Search-fold homoglyphs, and the four smaller items beside them — v1

**Status:** T0 shipped (the gates); T1–T5 open. Written 2026-08-20 out of a CI triage
that started with two red test files and ended with a defect none of the gates could
see.

Every figure below was measured against the local Postgres on 2026-08-20 and is
reproducible with the query beside it. Where a number is a sample rather than the
corpus, it says so.

---

## 0. The finding, in one paragraph

`translit_bg_latin()` is the one Cyrillic→Latin fold: it produces the stored
`*_fold` columns on eleven tables AND folds the query on every search that reads
them, which is exactly why a hole in it is invisible — both sides agree on the
wrong answer. It has two independent holes. It applies `unaccent()` **after** the
Cyrillic→Latin `translate()`, so anything unaccent folds _into_ a Bulgarian letter
re-enters the output as Cyrillic — `translit_bg_latin('ё')` returns **`е`
(U+0435)**, not `e`. And its mapping covers only the 30-letter Bulgarian alphabet,
so Cyrillic **homoglyphs** outside it pass through untouched — `і`/`І`
(U+0456/U+0406) sits in **50,256 of 50,283** dossier folds, because ЦАИС's own
notice template writes the Roman numeral in „Раздел І:" with a Cyrillic І.

The consequence is a word that cannot be found by typing its Latin form. It is not
confined to boilerplate: `СБПФЗПЛР "Цар Фердинанд І" ЕООД` is in the corpus with
that homoglyph, so the hospital is unreachable via `i`.

---

## 1. Evidence

### 1a. The function, and where each hole is

`scripts/db/schema/pg/000_search_fns.sql:39`. The pipeline is

```
replace(digraphs ж ц ч ш щ ю я) → translate(30-letter alphabet) → unaccent → lower → collapse ws
                                   ^ hole B (coverage)          ^ hole A (order)
```

**Hole A — order.** `unaccent` strips ё's diaeresis to a plain Cyrillic `е` long
after `translate` has stopped looking:

```sql
SELECT translit_bg_latin('ё');                              -- 'е'  (U+0435, Cyrillic)
SELECT translit_bg_latin(translit_bg_latin('ё'));           -- 'e'  (U+0065, Latin)
```

The function is therefore **not idempotent**, and that is the cheapest possible
gate for this class — see T0.

**Hole B — coverage.** `translate()`'s source set is the Bulgarian alphabet, so
every other Cyrillic letter is a pass-through. Verified pass-throughs:
`і` U+0456, `І` U+0406, `ѝ` U+045D, `ѐ` U+0450, `ы` U+044B, `э` U+044D, `ї` U+0457.
`unaccent` does not rescue them either — it maps ё and leaves ѐ/ѝ alone.

### 1b. Residue in the stored folds

```sql
SELECT count(*) FROM tender_search_text WHERE fold LIKE '%і%';   -- etc.
```

Per character, on the largest surface:

| `tender_search_text.fold` (50,283 rows)              | rows carrying it |
| ---------------------------------------------------- | ---------------- |
| `і` U+0456                                           | **50,256**       |
| `ѝ` U+045D                                           | 3,258            |
| `э` U+044D                                           | 118              |
| `ы` U+044B                                           | 55               |
| a plain Bulgarian letter — _what the gate looks for_ | **1**            |

Across the other stored folds, counting rows carrying any Cyrillic outside the
Bulgarian alphabet (the full U+0400–U+04FF block minus those 30 letters).
`contracts.title_fold` carries a **second** plain-Bulgarian-letter instance, which no
gate had ever looked for:

| column                        | rows with residue | Bulgarian-letter residue |
| ----------------------------- | ----------------- | ------------------------ |
| `contracts.title_fold`        | 7,047             | **1**                    |
| `tenders.subject_fold`        | 4,477             | 0                        |
| `tr_companies.name_fold`      | 164               | 0                        |
| `person_search.name_fold`     | 38                | 0                        |
| `contractor_search.name_fold` | 18                | 0                        |

That last row of the first table is the whole of what the existing gate looks for,
which is why it reports **one row** against a defect touching essentially the whole
dossier corpus: its
character class is the Bulgarian alphabet, and `і` is not in it. The one row it
does catch (УНП `00382-2021-0002`, a `ё` in its notice text, stored as the token
`proеkti`) is hole A. Everything else is hole B, and no gate sees it.

### 1c. Provenance — not a stale row, and not our text

Recomputing the fold from the live source reproduces the stored value exactly, so
nothing here is a leftover from an older function:

```sql
-- returns t, t : still Cyrillic, and byte-identical to what is stored
WITH src AS (SELECT translit_bg_latin(concat_ws(' ', d.description_text, n.txt, x.txt)) f …)
SELECT f ~ '[абвгдежзийклмнопрстуфхцчшщъьюя]', f = (SELECT fold FROM tender_search_text …) FROM src;
```

Context sample shows where the `і` comes from — the register's own template:

```
… obosobeni pozitsii ne razdel і: vazlozhitel sektoren i.1) naimenovani …
… ostavenoto iziskvane, v chast іv, razdel v ,,tehnicheski i profesional …
```

„Раздел **І**:" and „част **ІV**" — the Roman numeral typed as Cyrillic І. The
adjacent `i.1)` on the same line is an ASCII i, so the two are one character apart
in the source and a whole search apart in the index.

---

## 2. What must NOT be assumed (checked, so nobody re-checks)

- **Reordering `unaccent` is safe for Bulgarian.** The obvious fear is that
  unaccent-first mangles `й` into `и` and costs every name its `y`. It does not:
  `unaccent` returns `й Й ъ щ ю` unchanged and only strips ё's diaeresis. Verified
  before proposing the reorder, because if it had been false the whole approach
  would be wrong rather than merely incomplete.
- **`ы`/`э` are a DECISION, not an oversight.** `tender_search_text.data.test.ts`
  today argues passing them through is "correct and harmless" — true in the narrow
  sense that both sides agree, false in the sense that nobody can find those rows
  by typing Latin. Mapping them (`ы`→`y`, `э`→`e`) is proposed in T1 but is a
  change of a documented decision and needs a yes, not an assumption.
- **The client-side fold is a SECOND table with the same hole.**
  `src/lib/translitSearch.ts`'s `CYR_TO_LATIN` carries no entry for
  `ё і І ѝ ы э ї` either. It is deliberately not a twin of the SQL function (it
  also collapses ч/х, which is right for a substring filter and wrong for a stored
  index), so it needs its own fix and its own test — not a shared generator.
- **`141_shlyo_query_fold.sql` is generated** from `src/lib/shlyoRules.ts` by
  `npm run gen:shlyo-sql`. It is the _shliokavitsa_ (Latin-input) half and is
  query-side-only; it is not affected by this, and it must not be hand-edited.

---

## 3. Blast radius — eleven STORED columns, one loader-written

```sql
SELECT c.relname||'.'||a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE a.attgenerated='s' AND pg_get_expr(d.adbin,d.adrelid) LIKE '%translit_bg_latin%';
```

`awarder_search.name_fold`, `contractor_search.name_fold`, `contracts.title_fold`,
`person.name_fold`, `person_alias.alias_fold`, `person_search.name_fold`,
`tenders.buyer_fold`, `tenders.subject_fold`, `tr_companies.name_fold`,
`tr_officers.name_fold`, `tr_person_roles.name_fold` — plus
**`tender_search_text.fold`**, which is the only one written by a loader rather
than generated, and the only one 099 never had to think about.

26 migrations reference the function.

**A STORED generated column does not recompute when the function body changes.**
It recomputes when its row is rewritten. That is not a new discovery here —
`scripts/db/schema/pg/099_translit_fold_recompute.sql` is the precedent, a one-time
data migration that does `UPDATE t SET base = base` on seven tables, refreshes five
matviews, and opens with a fail-fast `DO $$ … RAISE EXCEPTION` guard so it cannot
rewrite ~4M rows against a function that was never updated. T2 follows it exactly.

---

## 4. The ordering hazard, stated once

Between the function change and the re-fold, the two sides disagree, and it breaks
searches that work TODAY: a reader typing Cyrillic `І` currently folds to `і` and
matches the stored `і`; after the function change the query folds to `i` while the
stored value is still `і`, so the match is lost until the row is rewritten. It is a
small population, but the direction matters — **function and re-fold must land in
one window per database**, and the cloud half is not optional once the local half
has shipped.

---

## 5. Tiers

### T0 — the gates that would have caught it (do these FIRST, expect red)

They are written before the fix on purpose: a gate that has never failed is a gate
nobody has calibrated.

- **T0.1 Idempotence.** `translit_bg_latin(translit_bg_latin(x)) = translit_bg_latin(x)`
  over a literal table (`ё Ё ѐ ѝ і І ы э ї` + ordinary Bulgarian and Latin words) and
  over a corpus sample. **Fails today** on `ё` (`'е'` vs `'e'`) and passes on everything
  else, which is exactly the discrimination a mutation check wants.
- **T0.2 Widen the residue class** in `tender_search_text.data.test.ts` from the
  Bulgarian alphabet to **all** Cyrillic (U+0400–U+04FF). It cannot be an equality
  gate until T2 lands, so it ships as a **measured ceiling** carrying today's numbers,
  then tightens to zero in T2. Note in the test WHY the narrow class existed — the
  `ы`/`э` argument in §2 — so the widening reads as a decision and not as somebody
  forgetting.

  **Shipped**, with two corrections the implementation forced. The wide class is
  GENERATED from the block minus the Bulgarian letters (`scripts/db/lib/cyrillic.ts`)
  rather than typed: the first cut hand-listed fourteen characters and missed four —
  `ѕ ј ӓ ӧ` — one of which is `hӧrmann gmbh` in `contracts.title_fold`, Hörmann GmbH
  with a Cyrillic ӧ, unreachable by anyone typing `hormann`. And the homoglyph arm is a
  **RATE**, not an absolute count: `tr_*` is rebuilt daily and the dossier corpus has a
  4.7× runway, so an absolute ceiling equal to today's count would go red on ordinary
  ingestion while §T0.2's own "may only be lowered" rule forbade the only green fix —
  the shape that gets a gate deleted rather than fixed. A `RATCHET` arm enforces the
  lowering mechanically, so T2's refold cannot land without re-measuring.

- **T0.3** The same residue probe over the other five fold columns, since today only
  the dossier one is gated at all.

### T1 — the function (`000_search_fns.sql`)

1. Move `unaccent` to run **before** the digraph replaces and the `translate`.
2. Extend the mapping with the homoglyphs: `І і` → `i`, `Ѝ ѝ` → `i`, `Ѐ ѐ` → `e`,
   `Ї ї` → `i`, and — pending the §2 decision — `Ы ы` → `y`, `Э э` → `e`.
3. Unit-test the table of cases directly, not through a consumer.

Both halves are needed and neither is sufficient: (1) alone leaves 50,256 rows
holding `і`; (2) alone leaves ё re-entering after `translate`.

### T2 — the re-fold, modelled on 099

New one-time migration, `NNN_translit_homoglyph_refold.sql`, **not** in any
idempotent file list:

- fail-fast guard: `IF translit_bg_latin('І') <> 'i' OR translit_bg_latin('ё') <> 'e' THEN RAISE`;
- the seven `UPDATE t SET base = base` rewrites 099 already names;
- the five matview refreshes 099 already names;
- then the person chain 099 documents (`db:resolve:persons` → `db:load:declarations:pg -- --resolve`
  → `db:load:person-elections:pg` → `person:slugs`), which is what rebuilds
  `person.name_fold` / `person_alias.alias_fold`;
- **new, and the reason this cannot be a copy of 099:** `tender_search_text.fold` is
  loader-written, and its loader's input is the gitignored ~26 h ЦАИС capture. The
  fold INSERT itself reads only tables already in Postgres, so add a
  **`--refold`** flag to `scripts/db/load_tender_dossier_pg.ts` that runs that one
  statement over every УНП already in `tender_dossier` and touches no capture. Without
  it, the largest affected surface is un-repairable on any machine that lacks the crawl.
- **VACUUM after.** ~4M rows rewritten by `UPDATE` is precisely the shape that leaves
  the visibility map short — the subject of `reload_visibility_map.data.test.ts` and of
  this session's other fix. End the migration with `VACUUM (ANALYZE, PARALLEL 0)` over
  the seven tables; `PARALLEL 0` is required on the docker Postgres (64 MB `/dev/shm`).

Then the same on Cloud SQL, in one window, per §4.

### T3 — `tender_dossier_reconcile`: the assertion measures the wrong side

`currency_code maps to a currency` fails at **0.737** against its `>0.8` floor. Its
comment blames euro-adoption straddle. The year split refutes that — **2026 is the
clean part** (100 EUR vs 3 BGN); the disagreement is pre-adoption (2021: 23 BGN vs
19 EUR; 2022: 12 vs 29; 2023: 8 vs 11).

The peg ratio settles who is wrong. For the disagreeing rows,
`value_native / contracts.amount_eur` is **0.83–1.02** by year, not 1.956 — so
`value_native` is genuinely in euro and the dossier's `currency_code = 1 → EUR` is
right; it is `contracts.currency = 'BGN'` on those ~57 rows that is mislabelled.
Code 3 → BGN is unaffected (23,912 vs 9, 99.96%).

So the fix belongs on the contracts side or in what the test treats as ground truth.
**Relaxing the threshold would delete the signal** and is the one change to refuse.

### T4 — documentation drift

- CLAUDE.md still describes the dossier corpus as "1,861 of 237,321 procedures
  (0.78%)" in several places. `tender_search_text` now holds **50,283** rows. That
  section's own rule is that a UI must cite `/api/db/tender-search-coverage` before
  claiming it searched documents, so a stale figure there is worse than elsewhere.
- Record the local↔cloud person-layer divergence as a KNOWN and ACCEPTED state (§6),
  so the next person to diff the two databases does not re-derive it as a defect.

### T5 — two test-isolation flakes (low priority, but they cost a CI read each time)

Both are green when run alone and red under the full parallel suite:

- `contracts_list_grant.data.test.ts > rebuild_contract_risk_cache() grants risk_upheld_ocid`
  — `deadlock detected`. It calls `rebuild_contract_risk_cache()`, which drops and
  recreates `risk_upheld_ocid`, while other files hold overlapping locks.
- `tr_company_place.data.test.ts > the worst-case place answers fast` — a 400 ms budget
  measured at 1,140 ms under load. The budget is defending an index, not a wall-clock,
  so it wants either serialisation or a plan-shape assertion (`Index Scan` on
  `idx_tr_company_place_ekatte_rank`) instead of a timing.

---

## 6. Known-and-accepted: the local↔cloud person divergence

Not a defect and **not** closable by a publish, recorded so it is not investigated a
third time. The resolver's inputs are byte-identical on both databases
(`tr_companies` 1,020,707 · `tr_officers` 872,202 · `tr_person_roles` 1,340,793 ·
`tr_name_fold_people` 456,398 · `person_slug_lock` 143,521). What differs is
resolve-run history: `person_role` at `source='tr'` is 192,374 local vs 192,369 cloud
(5 rows → 2 people, 3 companies, 5 graph edges), and `person_slug_retired` diverges
in BOTH directions — 849 slugs only local (419 of them `-N` collision artifacts that
only ever existed on that machine), 40 only on cloud, and 533 shared slugs pointing
at different targets.

`db:resolve:persons:cloud` re-mints against prod's own accumulated `person_slug_lock`
and cannot import local's identity decisions, so it would churn `/person` URLs
without converging anything — at the cost of a ~37 min resolve plus the declarations
phase-1/phase-2 and council re-attach chain, during which 090's
`DROP MATERIALIZED VIEW … CASCADE` leaves `/persons`, `/officials/assets`,
`/mp-assets` and `/declarations/crypto` at 500 for ~8 minutes.

Prod is self-consistent on its own terms and that is the bar that matters:
`person_slug_retired` = 24,910 rows, **0** without a target, **0** targets missing
from `person`, **0** chains.

---

## 7. Order of work

`T0 → T1 → T2 (local) → T2 (cloud, same window)`, with T3/T4/T5 independent of all
of it. The only hard coupling is §4: once T1 ships to a database, T2 must follow it
there before the next deploy, or a small set of searches that work today stop.
