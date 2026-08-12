# TR company attribution — publish the BASIS, and give the fold-keyed mints a real uniqueness guard

Plan, 2026-08-11 (audited and revised the same day — §7 records what the audit changed).
Follows the Gap-2 investigation in [person-enrichment-v1.md](person-enrichment-v1.md) §"The
identity lever we deliberately declined", which ends with an open decision. This plan takes
that decision in the narrowest form that fixes the defect, and separates the parts that must
not wait for it.

Trigger: `/person/ivan-georgiev-takuchev-c39f00` lists two Plovdiv companies (АЙВИ АРХ
205945260, УНИСОН ГРУП 205243218) for the chief architect of Ивайловград. Every figure below
is measured against local Postgres and `raw_data/tr/daily/` on 2026-08-11. Where a figure comes
from replaying a resolver clause verbatim rather than approximating it, it says so.

---

## §0 — What is actually wrong

Four defects. Only the third and fourth need the `Indent` decision.

### 0.1 Bridge B cites a mitigation that cannot reach it

[`resolve_persons.ts:2130`](../../scripts/person/resolve_persons.ts) justifies the
`FOOTPRINT_CAP = 5`: *"The residual risk … is bounded by the cap and carried by the
name-match caveat shown on the person page."*

That caveat is [`PersonProfileScreen.tsx:289`](../../src/screens/person/PersonProfileScreen.tsx),
gated `p.isPublicFigure === false`. Bridge B's eligibility clause is
`WHERE p.name_parts = 3 AND p.is_public_figure`
([`resolve_persons.ts:2142`](../../scripts/person/resolve_persons.ts)). **The two populations
are disjoint by construction** — that card has never rendered on a single Bridge-B page and
never can.

The premise "the page shows companies with no caveat" is nonetheless **not** correct as
stated: [`PersonCompanies.tsx:243`](../../src/screens/person/PersonCompanies.tsx) renders
`person_namesake_disclosure` unconditionally whenever `companies.length > 0`. So there is a
caveat. The defect is that it is **the same sentence for every link**.

### 0.2 The profile cannot tell a corroborated link from a name match; the browser can

| | |
|---|---:|
| `person_role` rows at `source='tr'` | 200,700 |
| of which `confidence='exact_id'` | 62 |
| of which `confidence='high'` (fold-keyed mints) | 200,638 |
| public figures carrying any TR link | 13,453 |
| **of which carry ONLY name-derived links** | **13,409** |

`person_by_slug` filters `confidence IN ('exact_id','high','manual')` and then emits every
company identically. `person_browse_table.tr_link_basis` (migration 120) *does* classify the
same link — `declared` / `mixed` / `name_match` — and
[`120_person_browse.sql:100`](../../scripts/db/schema/pg/120_person_browse.sql) states the rule
the profile is currently breaking: *"The UI caveats anything that is not 'declared'."* On the
public arm that table reads 337 `declared`, 58 `mixed`, **13,058 `name_match`**.

The two surfaces must not disagree about the same person — the same file calls that "the worst
bug this table can carry".

**`confidence` is not a usable proxy for the basis.** Bridge A holds **766 distinct (person,
uic) pairs**; only 49 carry an `exact_id` role and 367 have no `tr` role at all. Deriving the
basis from `confidence` would mislabel the remaining 350 corroborated pairs as name matches —
safe in direction, but it would put the profile and the browser in disagreement, which is the
thing being fixed. (The 62 `exact_id` rows counted in the table above are ROLES; one pair can
hold several, e.g. manager + sole_owner. An earlier draft of this plan reported 849/62/345 by
counting join rows rather than pairs.)

**`declared` is not a confirmed identity, and the copy must not say it is.** Bridge A takes the
TR officers on an EIK the person is independently linked to and keeps those "whose name matches
the linked person's (given, family)" ([`resolve_persons.ts:1317`](../../scripts/person/resolve_persons.ts)).
The *company* link is register-sourced; the officer row inside it is still a name match. Much
stronger than a bare fold hit — not proof.

### 0.3 Bridge B's uniqueness guard counts the wrong universe

```sql
AND NOT EXISTS (SELECT 1 FROM person p2
                 WHERE p2.name_fold = p.name_fold AND p2.person_id <> p.person_id)
```

This asks whether the fold is unique among people **we have resolved**, not among people who
**exist**. A private namesake never enters `person` unless the Tier-V money gate happens to
mint them, so the guard is blind in exactly the case it exists for.

Replaying that clause verbatim against the registry's own person key (§A.2): of **17,861**
eligible folds, **2,785 (15.6%) sit on a fold the registry proves is two or more people**,
14,578 are confirmed a single person, and 498 are unmeasured. (Earlier drafts said 1,995 of
16,724 — measured before the counter was corrected to exclude 154,995 legal entities.) Of the contaminated
population, 722 are on prerendered pages, 228 carry a money figure and the largest is €983.3m.

`namesake_risk` does not close this: it counts a name's COMPANIES, not its PEOPLE, and the
profile ignores it entirely.

### 0.4 Tier-V has the same defect, a weaker guard, and calls the result "verified"

[`resolve_persons.ts:2280`](../../scripts/person/resolve_persons.ts) mints a private person per
money-linked fold, on the same ≤5-company cap, guarded only by `name_fold NOT IN (SELECT
name_fold FROM person)` — weaker than Bridge B's, since it asks whether we already hold the
fold rather than whether it is one person.

| | Bridge B | Tier-V |
|---|---:|---:|
| population | 16,724 eligible pairs | 68,783 persons |
| **on a provably multi-person fold** | **2,785 (15.6%)** | **4,407 (6.4%)** |
| unmeasured folds | 489 (2.9%) | 13,805 (20.1%) |
| carrying money | 228 | 4,269 |
| largest attributed figure | €983.3m | **€2,423.9m** |

Tier-V is the bigger exposure by count and by money, and it publishes at
`identity_confidence = 'verified'` — the data model calling "verified" a fold the registry says
is several people.

**They also carry no visible mark in the browser.** The "по име" chip at
[`PersonsBrowserScreen.tsx:445`](../../src/screens/persons/PersonsBrowserScreen.tsx) fires on
`identityConfidence === "name_fold"`, which is the 4,448 browse-only rows 120 synthesises —
**not** the 68,783 minted Tier-V people, who read `verified`. Their profile does get the amber
card (they are `is_public_figure = false`), but it says "identity is a name match, not
verified", which understates a fold the registry positively says is two people.

---

## §1 T1 — the link basis reaches the profile (does NOT wait for §2)

This is the fix that protects the 13,409 pages live today, including every page the guard will
later demote. Ship it first and alone.

### 1.1 One definition of Bridge A, consumed by both surfaces

New migration `148_person_company_basis.sql` (147 is `tender_search_text`).
**Number collision to settle with whoever owns
[municipal-fiscal-commitments-v1.md](municipal-fiscal-commitments-v1.md) §T2.1** — that plan
reserves 148 for `148_municipal_fiscal.sql`, but no such file exists and this one is on disk,
so that reservation should move to 149.

```sql
CREATE OR REPLACE VIEW person_company_bridge_a AS
  -- verbatim the CTE at 120_person_browse.sql:327, moved here so there is one definition
  SELECT DISTINCT pr.person_id, cp.eik AS uic FROM company_politicians cp JOIN person_role pr …
  UNION
  SELECT DISTINCT pr.person_id, mc.eik FROM magistrate_company mc JOIN person_role pr …;
```

Small by construction — `company_politicians` 522 rows, `magistrate_company` 245 usable, **766
resulting pairs** — so a view is the right shape and a matview would be a refresh trigger for
nothing. **Measured, not assumed**: `SELECT * FROM person_company_bridge_a WHERE person_id = $1`
runs in **0.266 ms over 10 buffers**, the predicate pushed into two `person_role_pkey`
index-only scans with `company_politicians` never executed. Hold that as the ceiling in the
data test, the way `person_connections.data.test.ts` does.

Then:

- `120_person_browse.sql` replaces its inline `bridge_a` CTE with `SELECT * FROM
  person_company_bridge_a`. No behaviour change.
- `082_person_api.sql` adds `'linkBasis'` (`declared` | `name_match`) to each element of
  `companies`. **No `trLinkBasis` scalar on the payload root** — the page derives the
  `declared` / `mixed` / `name_match` rollup from the array it is already rendering, so one page
  cannot contradict itself. PG-side agreement with 120 is a test obligation (§5), not a second
  stored producer.

**These three files ship in ONE `apply_functions.ts` command, 148 first.** `person_by_slug` is
`LANGUAGE sql STABLE` with no `check_function_bodies = false`, so it is validated at CREATE and
applying it against a database without the view fails the whole file with `42P01` — the trap
CLAUDE.md documents for 081 → 082:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 148_person_company_basis.sql 082_person_api.sql 120_person_browse.sql
```

120 is `DROP MATERIALIZED VIEW … CASCADE` + CREATE, so it comes back empty until
`db:load:persons-browse:pg[:cloud]` runs. Sequence accordingly.

### 1.2 The UI says which basis it is

`ProfileCompany` in [`usePersonProfile.ts:39`](../../src/screens/person/usePersonProfile.ts)
gains `linkBasis: "declared" | "name_match"`. In
[`PersonCompanies.tsx`](../../src/screens/person/PersonCompanies.tsx):

- **Per company** — a `name_match` row carries the small "по име" marker the browser already
  uses (`Marker` in [`PersonMoneyCells.tsx:193`](../../src/screens/persons/PersonMoneyCells.tsx)).
  A `declared` row carries nothing; its provenance is the cacbg attribution line already on the
  card.
- **The card footnote stops being unconditional** — it renders only when at least one company
  is `name_match`, so the 337 fully-corroborated people stop being told their own declared
  holdings might be somebody else's.
- **`declared` gets no reassuring gloss.** Per §0.2 the wording is "фирмата е свързана с лицето
  по регистър на декларации / ИВСС", never "потвърдена самоличност".
- **When §2 lands, the sentence gets specific**: "Търговският регистър съдържа поне N различни
  лица с това име." A number a reader can act on beats boilerplate they have learned to skip.

Nothing changes about the amber identity card at
[`PersonProfileScreen.tsx:289`](../../src/screens/person/PersonProfileScreen.tsx). It is about
who the PERSON is, and for a cross-source-resolved public figure it would be false. The company
list is what needed qualifying, and now it is qualified per company.

---

## §2 T2 — a real uniqueness guard, from a COUNT and nothing else

### 2.1 The decision, narrowed

[person-enrichment-v1.md](person-enrichment-v1.md) §"The identity lever" proposes using the
`Indent` hash transiently in memory and persisting an opaque per-run cluster id. **Persist a
count instead.** The entire safety win comes from knowing how many distinct people share a fold;
the identifier buys only the ability to *split* a footprint, and you cannot tell which cluster is
the public figure without an external corroborant anyway. With 62 EIK-exact roles across 44
people, the split is worth almost nothing today.

So: **no hash, no cluster id, no pseudonymous column anywhere.** The published artifact is a
name fold and an integer.

### 2.2 What the hash can and cannot settle — measured on this very case

The `Indent` on `Иван Георгиев Такучев` in the 2022-09-27 АЙВИ АРХ `ShareTransfer/OldOwner` is
byte-identical to the one on `ИВАН ГЕОРГИЕВ ТАКУЧЕВ` in the 2025-08-13 УНИСОН ГРУП filing —
across three years and a case difference in the name string. **The registry's own key says the
two Plovdiv companies are one person.**

It does not say that person is the Ивайловград chief architect, and nothing here can: no
officials, declarations or CACBG source carries an EGN or its hash, so the registry →
public-figure bridge stays a name match whatever we do. Adopting the hash would not have removed
the caveat from this page. **The right use of it is refusal — it tells you when to stop
attributing, not who to attribute to.**

### 2.3 The counter (manual, like every other raw-feed step)

`scripts/declarations/tr/count_registry_people.ts`, `npm run tr:count-people`:

1. Stream `raw_data/tr/daily/*.json` for `Indent`/`Name` pairs. Replace every hash with a
   truncated SHA-256 digest **at read time** — the raw value never leaves the parsing expression.
2. Resolve the distinct names to folds in one PG round-trip
   (`SELECT s, translit_bg_latin(s) FROM unnest($1::text[])`, the idiom at
   [`resolve_persons.ts:1333`](../../scripts/person/resolve_persons.ts)). There is no TS twin of
   `translit_bg_latin` and inventing one would be a fourth normalizer.
3. Merge digest sets **by fold**, emit the count, drop everything else.

Grouping by fold rather than by raw name is not cosmetic: it is the key both mints use, and it
correctly treats two spellings of one person as one person. Measured both ways, the answer is
stable — 533,778 raw names / 26,479 multi-person against 531,270 folds / 26,530 multi-person.

Deliberately a separate script rather than a hook in `parse_daily_filing.ts`: that parser
carries three test-asserted policy guards that `Indent` must not reach its output
([`parse_share_transfer.test.ts:55`](../../scripts/declarations/tr/parse_share_transfer.test.ts)),
and this must not weaken them. Cost is not a reason to hesitate — the whole 15 GB feed scans in
**5.6 s**.

### 2.4 The artifact is the FULL table, and committed

`data/person/tr_name_fold_people.tsv` — every measured fold and its count, **531,270 rows,
~14 MB**, not merely the 26,530 shared ones. That is decision Q2, and the reason is that the
subset cannot distinguish *unique* from *unmeasured*, so a guard built on it fails open silently.
With the full table the resolver sees three states:

| state | meaning | Bridge B | Tier-V |
|---|---|---|---|
| `n = 1` | registry says one person | mint | mint |
| `n > 1` | registry says ≥2 people | **refuse** | mint, and LABEL (§2.6) |
| absent | never observed in the feed window | **refuse** (489 pairs, 2.9%) | mint, labelled "не е проверено" (13,805, 20.1%) |

Committing it means a fresh clone, CI and Cloud SQL all apply the same guard, so the resolver
cannot publish more on one machine than another — the "green locally, different on prod" class
this repo keeps paying for. The counter needs `raw_data/`; nothing else does.

`148_person_company_basis.sql` also creates `tr_name_fold_people (name_fold text primary key,
people_n int)`; `scripts/db/load_tr_name_fold_people_pg.ts`
(`db:load:tr-name-fold-people:pg[:cloud]`) loads it from the committed file. Committed input, so
it belongs in `db:refresh` proper — no `REFRESH_EXCLUSIONS` entry — placed **before
`db:resolve:persons`**, with an `ORDER_PAIRS` entry in
[`refresh_coverage.test.ts:85`](../../scripts/db/refresh_coverage.test.ts):

> `after: "db:resolve:persons"`, `before: "db:load:tr-name-fold-people:pg"` — both fold-keyed
> mints read this table to decide whether a name is one person. Run first, the table is empty,
> every fold reads as unmeasured, and the guard's behaviour flips wholesale with nothing failing.

### 2.5 The Bridge B guard (refuse shared AND unmeasured — decision Q3)

`elig` gains one clause:

```sql
AND EXISTS (SELECT 1 FROM tr_name_fold_people f
             WHERE f.name_fold = p.name_fold AND f.people_n = 1)
```

Positive evidence, not absence of evidence: a fold reaches Bridge B only when the registry has
been asked and answered "one person". Bridge B publishes an attribution about a **public
figure** — the highest-consequence claim this site makes — so the 489 unmeasured pairs (2.9%)
are worth giving up, and they are precisely the pre-2021 / CR-Deeds folds the feed's window
never covered.

An absent or empty table must be **loud, not silent**: the resolver logs one explicit warning
naming the loader, and prints the guard's kill count on every run so a drop to zero is visible
where the merge counts already are.

No backfill is needed for the ~1,995 live pages — the resolver `DELETE FROM person`
([:2133](../../scripts/person/resolve_persons.ts)) and rebuilds, so a re-resolve removes their
Bridge-B roles. A public figure on a shared fold keeps any Bridge-A company they have, and the
page then shows only register-confirmed companies plus the count sentence from §1.2 — which is
the right page. That is also why §1 ships first: until the re-resolve, those pages stay up,
correctly caveated per company.

### 2.6 Tier-V keeps its people and gets labelled (decision Q1)

Tier-V is **not** guarded by exclusion. Excluding a fold there deletes the person row — the
table is rebuilt from scratch on every run — which orphans its slug with no valid redirect
target, the magistrate-roster 404 class, and `person_slug_retired` cannot repair a chain with no
servable end. 4,497 deletions (13,805 more if unmeasured were refused) to fix a labelling
problem is the wrong trade.

Instead:

- **`person.fold_people_n int` (NULL = unmeasured)**, written by the resolver from
  `tr_name_fold_people` for every person, both arms. A non-identifying integer, and the only
  thing this whole §2 publishes.
- **`identity_confidence` gains a third value, `shared_name`**, for a fold-keyed mint on
  `people_n > 1`. The CHECK becomes `ARRAY['resolved','verified','shared_name']`, and 082's two
  serving gates ([:18, :418](../../scripts/db/schema/pg/082_person_api.sql)) widen to
  `is_public_figure OR identity_confidence IN ('verified','shared_name')` so these people stay
  servable — the point of Q1.
- **The browser chip stops missing them.** The condition at
  [`PersonsBrowserScreen.tsx:445`](../../src/screens/persons/PersonsBrowserScreen.tsx) currently
  matches only the 4,448 synthesised `name_fold` rows; it widens to any non-`resolved` value,
  with `shared_name` getting the stronger wording and the count.
- **The amber card stops understating.** For `shared_name` it says the registry itself shows N
  people under this name, not merely that we could not verify.

---

## §3 T3 — two sentences that are currently false

1. **`person_namesake_disclosure`** (`src/locales/{bg,en}/translation.json:3268`) says
   «регистърът няма ЕГН» / "the register has no personal ID". The feed carries 1,484,303
   EGN-typed and 21,355 ЛНЧ-typed `Indent` values across 2,007,400 `Name` nodes. The limitation
   is **ours, by policy**, and the sentence should say so.
2. **[`resolve_persons.ts:2130`](../../scripts/person/resolve_persons.ts)** records a guarantee
   that does not exist. Rewrite it to name the real containment — the footprint cap, the
   people-count guard, and the per-company basis from §1.

---

## §4 Order, and what it costs

| # | Step | Where | Cost |
|---|---|---|---|
| 1 | Apply 148 + 082 + 120 (one command, 148 first) | local, then cloud | seconds |
| 2 | `db:load:persons-browse:pg[:cloud]` (120 was DROP+CREATE) | both | minutes |
| 3 | Ship the UI (T1.2) | `npm run deploy` | — |
| 4 | `npm run tr:count-people`, commit the artifact | local only, needs `raw_data/` | ~6 s |
| 5 | `db:load:tr-name-fold-people:pg[:cloud]` | both | seconds |
| 6 | Guards + `fold_people_n` + `shared_name` (§2.5, §2.6), then `db:resolve:persons` | local | ~5 min |
| 7 | `db:resolve:persons:cloud` **and its whole tail** | cloud | hours |

Step 7 is the expensive one and it is not optional: a re-resolve nulls `declaration.person_id`
table-wide and invalidates the person layer's dependents. Per CLAUDE.md, in order —
`db:load:declarations:pg:cloud -- --resolve`, `db:load:official-candidate-links:pg:cloud`,
`db:load:persons-browse:pg:cloud`, `db:load:person-search:pg:cloud`, `db:load:graph:pg:cloud`,
then `person:slugs:cloud` to re-mint the prerender manifest from the SERVING database.

Because Tier-V keeps its rows (§2.6), **no slug is orphaned by this plan** and no
`person_slug_retired` work is needed. Steps 1-3 stand alone and can ship the same day; do not
bundle them with 4-7.

---

## §5 Tests

- **`scripts/db/tests/person_company_basis.data.test.ts`** — the anti-drift gate: for every
  person with TR links, 082's per-company `linkBasis` folded by 120's `bool_and`/`bool_or` rule
  equals `person_browse_table.tr_link_basis`. Plus the measured buffer ceiling on the view.
- **`scripts/declarations/tr/count_registry_people.test.ts`** — the policy guard, asserted on
  the writer rather than trusted: the emitted artifact matches no `[0-9a-f]{64}` and carries no
  `Indent` key, the fixture included. Same shape as
  [`parse_share_transfer.test.ts:55`](../../scripts/declarations/tr/parse_share_transfer.test.ts).
- **`scripts/db/tests/tr_name_fold_people.data.test.ts`** — three assertions, because the table
  has three jobs:
  1. **Bridge B discriminates.** No `person_role` row at `source='tr'` on a person whose fold is
     shared *or* unmeasured. Zero is the passing value; it starts at 1,995 + 489.
  2. **`fold_people_n` is actually populated.** Every person whose fold IS in
     `tr_name_fold_people` carries a non-NULL `fold_people_n`. This assertion has to come
     first, because `person` is DELETEd and rebuilt every resolve and the column only arrives
     if the resolver's `copyRows` list names it — the `date_basis` failure class 081 documents.
     Dropped from that list, every row is NULL, and assertion 3 below then passes **over an
     empty set** while the guard has silently reverted to "everything is unmeasured".
  3. **Tier-V labels.** Every person with `fold_people_n > 1` reads `identity_confidence =
     'shared_name'`, and none reads `'verified'`. Vacuous without assertion 2 — keep them
     together.
  4. **Coverage has a floor.** Measured ÷ Bridge-B-gated folds ≥ 90% (today 97.2%).
     This is the §6 decay alarm, and it must fail rather than warn.
- **`PersonCompanies.test.tsx`** — a `declared`-only person shows no footnote; a mixed person
  shows it; a `name_match` company carries the marker and a `declared` one does not. Asserted on
  the words, per [`PersonMoneyCells.test.tsx:116`](../../src/screens/persons/PersonMoneyCells.test.tsx).
- **`refresh_coverage.test.ts`** — the new `ORDER_PAIRS` entry and chain membership.

---

## §6 The coverage decays, and that is the uncomfortable part

The guard covers **97.2%** of the folds it gates (17,363 of 17,861); over the whole
`tr_person_roles` universe it is 78.5%. That share will **fall, not rise**: the CR Deeds capture carries **no
`Indent`, no EGN and no 64-hex of any kind** (verified against the stored bodies), and it is the
growth path — 29,777 of 1.02M companies today, with
[cr-deeds-capture-v1](cr-deeds-capture-v1.md) targeting the 478k missing-owner tail. Every
company that arm recovers is a footprint this guard cannot see.

Nothing here fixes that; the registry publishes the key on one feed and not the other. What this
plan does is make the decay **visible** — the coverage floor in §5, and `fold_people_n IS NULL`
rendered as "не е проверено" rather than silently reading as "one person". Revisit if the
measured share approaches the floor: at that point the honest options are to narrow Tier-V's cap
or to stop minting on unmeasured folds there too, and both are decisions with a page count
attached.

---

## §7 What the audit changed (2026-08-11)

| # | Correction |
|---|---|
| 1 | **Tier-V was missing entirely** and is the bigger exposure — 4,497 contaminated people, €2,423.9m top row, published as `verified` with no browser chip. Now §0.4 + §2.6 |
| 2 | Headline number was an uppercase-name approximation (1,914). Replaying Bridge B's actual clause at fold level gives **1,995 of 16,724 (11.9%)** |
| 3 | The shared-subset artifact could not distinguish unique from unmeasured, so the guard failed open. Now the full table + three-state semantics (§2.4) |
| 4 | Coverage was framed as a floor that would rise. It **falls** — CR Deeds carries no identity key at all (§6) |
| 5 | "No backfill needed" held only because Tier-V keeps its rows; exclusion there would delete people and orphan slugs (§2.6) |
| 6 | `declared` must not be worded as confirmed identity — Bridge A is name-matched *within* a register-sourced company link (§0.2) |
| 7 | Dropped the `trLinkBasis` payload scalar — a second producer of what the array already says (§1.1) |
| 8 | The view's per-person cost is now measured (0.266 ms / 10 buffers), not deferred to "EXPLAIN it before shipping" |

---

## §8 Out of scope, and why

- **Persisting any cluster id or hash.** §2.1. Revisit only if a corroborated-company →
  verified-footprint promotion becomes worth it, which needs Bridge A to be much larger than it
  is today (§0.2) — stated as a comparison rather than a number so the threshold cannot go stale
  the way the pre-audit 849 did.
- **Raising `FOOTPRINT_CAP`.** Independent question, and
  [cr-deeds-capture-v1.md](cr-deeds-capture-v1.md) already flags that backfilled owners will push
  people over it.
- **Retiring or repointing `namesake_risk`.** It is deprecated as a namesake proxy and
  `fold_people_n` is what it wanted to be, but converting the column has consumers beyond this
  plan. Leaving both is a trap for the next reader; scope it separately and soon.
- **Any "undeclared holding" badge.** Already settled in
  [person-enrichment-v1.md](person-enrichment-v1.md) §6 — the report exists, nothing is published.

---

## Appendix A — measurements

### A.1 Reproduce the scan (5.6 s over 15 GB)

```bash
rg -oI --no-filename '"Indent":\[\{"_":"[0-9a-f]{64}"\}\],"Name":\[\{"_":"[^"]{3,120}"\}\]' raw_data/tr/daily/
```

Pipe into an aggregator that digests the hash on read, resolves names to folds through
`translit_bg_latin`, and counts distinct digests per fold. Result on 2026-08-11: 1,678,256 pairs
· **531,270 folds** · **26,530 (5.0%) with ≥2 distinct person keys** (18,957 have 2, 3,863 have
3, 163 have 8).

### A.2 The two mints, replayed verbatim

Bridge B's `elig` + `capped` clauses, and the current Tier-V population
(`identity_confidence='verified' AND NOT is_public_figure`), joined to the fold counts:

| | eligible / minted | unmeasured | `n = 1` | **`n > 1`** |
|---|---:|---:|---:|---:|
| Bridge B | 16,724 | 489 | 14,240 | **1,995** |
| Tier-V | 68,783 | 13,805 | 50,481 | **4,497** |

Coverage, on the denominator that matters — the folds Bridge B actually gates (public, 3-part,
people-unique, with a TR footprint): **17,363 of 17,861 measured (97.2%)**, splitting into 14,578
minted, **2,785 refused as shared** and 498 refused as unmeasured.

⚠️ The global figure over ALL `tr_person_roles` folds is **78.5%**, not the 90.6% earlier drafts
of this plan reported. Both corrections come from the same fix: the first cut of the counter
matched on `Indent` alone and so counted 154,995 legal entities (`IndentType: UIC`) as people.
The global number is also the wrong instrument — it is dominated by folds no public figure has
(officer rows whose "name" is a company, sentence-shaped names), so it moves for reasons that
never touch a person page. The data test's floor is set on the candidate set for that reason.

### A.3 Both shares are floors

The feed starts 2021-01-01 and holds only records a filing touched, so an unmeasured fold is
unmeasured rather than clean. Sampling can only push the measured share of multi-person folds
DOWN.

### A.4 The Такучев filings

| filing | node | name as printed | key |
|---|---|---|---|
| 2022-09-27 АЙВИ АРХ | `ShareTransfers/ShareTransfer/OldOwner` | `Иван Георгиев Такучев` | identical |
| 2025-08-13 УНИСОН ГРУП | `ShareTransfers/ShareTransfer/OldOwner` | `ИВАН ГЕОРГИЕВ ТАКУЧЕВ` | identical |

One registry person, two companies — so this page survives the §2.5 guard, and what §1 changes
for it is that the two companies are now marked as the name matches they are. Whether that
registry person is the Ивайловград chief architect is not answerable from this corpus, and §2.2
explains why no amount of `Indent` work changes that.
