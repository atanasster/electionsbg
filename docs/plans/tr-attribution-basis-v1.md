# TR company attribution — publish the BASIS, and give Bridge B a real uniqueness guard

Plan, 2026-08-11. Follows the Gap-2 investigation in
[person-enrichment-v1.md](person-enrichment-v1.md) §"The identity lever we deliberately
declined", which ends with an open decision. This plan takes that decision in the narrowest
form that fixes the defect, and separates the parts that must not wait for it.

Trigger: `/person/ivan-georgiev-takuchev-c39f00` lists two Plovdiv companies (АЙВИ АРХ
205945260, УНИСОН ГРУП 205243218) for the chief architect of Ивайловград. Every figure below
is measured against local Postgres and `raw_data/tr/daily/` on 2026-08-11.

---

## §0 — What is actually wrong

Three separate defects. Only the third needs the `Indent` decision.

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
| of which `confidence='high'` (Bridge B, name-derived) | 200,638 |
| public figures carrying any TR link | 13,453 |
| **of which carry ONLY name-derived links** | **13,409** |

`person_by_slug` filters `confidence IN ('exact_id','high','manual')` and then emits every
company identically. Meanwhile `person_browse_table.tr_link_basis` (migration 120) *does*
classify the same link — `declared` / `mixed` / `name_match` — and
[`120_person_browse.sql:100`](../../scripts/db/schema/pg/120_person_browse.sql) states the rule
the profile is currently breaking: *"The UI caveats anything that is not 'declared'."* On the
public arm that table reads 337 `declared`, 58 `mixed`, **13,058 `name_match`**.

The two surfaces must not disagree about the same person — the same file calls that "the worst
bug this table can carry".

**`confidence` is not a usable proxy for the basis.** Bridge A holds 849 (person, uic) pairs;
only 62 coincide with an `exact_id` role and 345 have no `tr` role at all. Deriving the basis
from `confidence` would mislabel 442 corroborated links as name matches — safe in direction,
but it would put the profile and the browser in disagreement, which is the thing being fixed.

### 0.3 Bridge B's uniqueness guard counts the wrong universe

```sql
AND NOT EXISTS (SELECT 1 FROM person p2
                 WHERE p2.name_fold = p.name_fold AND p2.person_id <> p.person_id)
```

This asks whether the fold is unique among people **we have resolved**, not among people who
**exist**. A private namesake never enters `person` unless the Tier-V money gate happens to
mint them, so the guard is blind in exactly the case it exists for.

Measured against the registry's own key (§A.2): of 12,900 name-only public figures matched
into the feed, **1,914 (14.8%) sit on a name that provably belongs to ≥2 registry people** —
722 of them on prerendered pages, 228 carrying a money figure, the largest €983.3m, the worst
name shared by 8 people. The Tier-V private arm — which *does* get the identity caveat — sits
at 8.2%. The arm with no identity caveat is twice as likely to be contaminated.

`namesake_risk` does not close this: it counts a name's COMPANIES, not its PEOPLE, and the
profile ignores it entirely.

---

## §1 T1 — the link basis reaches the profile (does NOT wait for §2)

This is the fix that protects the 13,409 pages that are live today, including every page a
later re-resolve will demote. Ship it first.

### 1.1 One definition of Bridge A, consumed by both surfaces

New migration `147_person_company_basis.sql`:

```sql
CREATE OR REPLACE VIEW person_company_bridge_a AS
  -- verbatim the CTE at 120_person_browse.sql:327, moved here so there is one definition
  SELECT DISTINCT pr.person_id, cp.eik AS uic FROM company_politicians cp JOIN person_role pr …
  UNION
  SELECT DISTINCT pr.person_id, mc.eik FROM magistrate_company mc JOIN person_role pr …;
```

Small by construction — `company_politicians` 522 rows, `magistrate_company` 245 usable, 849
resulting pairs — so a view is the right shape and a matview would be a refresh trigger for
nothing. Per the repo's perf rule, still `EXPLAIN ANALYZE` the worst-case profile (a person
with 5 companies) before shipping; budget the same ceiling
`person_connections.data.test.ts` uses.

Then:

- `120_person_browse.sql` replaces its inline `bridge_a` CTE with `SELECT * FROM
  person_company_bridge_a`. No behaviour change, no re-load required beyond the next
  `db:load:persons-browse:pg`.
- `082_person_api.sql` adds `'linkBasis'` to each element of `companies`:
  `declared` when the (person, uic) pair is in the view, else `name_match`. Add the same
  scalar `trLinkBasis` alongside `procuredEur` on the profile root, computed with 120's
  `bool_and` / `bool_or` rule so `mixed` means what it means there.

**These three files ship in ONE `apply_functions.ts` command, 147 first.** 082 is
`LANGUAGE sql` and is validated at CREATE time, so applying it against a database without the
view fails the whole file with `42P01` — the same trap CLAUDE.md documents for 081 → 082:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 147_person_company_basis.sql 082_person_api.sql 120_person_browse.sql
```

Note 120 is DROP + CREATE, so the matview comes back empty on the target until
`db:load:persons-browse:pg[:cloud]` runs. Sequence accordingly, or apply 120 from the loader
run itself.

### 1.2 The UI says which basis it is

`ProfileCompany` in [`usePersonProfile.ts:39`](../../src/screens/person/usePersonProfile.ts)
gains `linkBasis: "declared" | "name_match"`. In
[`PersonCompanies.tsx`](../../src/screens/person/PersonCompanies.tsx):

- **Per company** — a `name_match` row carries the small "по име" marker the browser already
  uses (`Marker` in [`PersonMoneyCells.tsx:193`](../../src/screens/persons/PersonMoneyCells.tsx)).
  A `declared` row carries nothing; its provenance is the cacbg attribution line already on
  the card.
- **The card footnote stops being unconditional.** It renders only when at least one company
  is `name_match` — which is the honest reading, and it stops the 337 fully-corroborated
  people being told their own declared holdings might be somebody else's.
- **When the fold is known-shared (§2 lands), the sentence gets specific**: "Търговският
  регистър съдържа поне N различни лица с това име." A number a reader can act on beats
  boilerplate they have learned to skip.

Nothing changes about the amber identity card at
[`PersonProfileScreen.tsx:289`](../../src/screens/person/PersonProfileScreen.tsx). It is about
who the PERSON is, and for a cross-source-resolved public figure it would be false. The
company list is what needed qualifying, and now it is qualified per company.

---

## §2 T2 — a real uniqueness guard, from a COUNT and nothing else

### 2.1 The decision, narrowed

[person-enrichment-v1.md](person-enrichment-v1.md) §"The identity lever" proposes using the
`Indent` hash transiently in memory and persisting an opaque per-run cluster id. **Persist a
count instead.** The entire safety win comes from knowing how many distinct people share a
name; the identifier buys only the ability to *split* a footprint, and you cannot tell which
cluster is the public figure without an external corroborant anyway. With 62 EIK-exact roles
across 44 people, the split is worth almost nothing today.

So: **no hash, no cluster id, no pseudonymous column anywhere.** The published artifact is a
list of name spellings shared by two or more registry people, plus the count. That is a
statement about name commonality, not about any person.

### 2.2 What the hash can and cannot settle — measured on this very case

The `Indent` on `Иван Георгиев Такучев` in the 2022-09-27 АЙВИ АРХ `ShareTransfer/OldOwner` is
byte-identical to the one on `ИВАН ГЕОРГИЕВ ТАКУЧЕВ` in the 2025-08-13 УНИСОН ГРУП filing —
across three years and a case difference in the name string. **The registry's own key says the
two Plovdiv companies are one person.**

It does not say that person is the Ивайловград chief architect, and nothing can: no officials,
declarations or CACBG source carries an EGN or its hash, so the registry → public-figure bridge
stays a name match whatever we do here. Adopting the hash would not have removed the caveat
from this page. **The right use of it is refusal — it tells you when to stop attributing, not
who to attribute to.**

### 2.3 The counter (manual, like every other raw-feed step)

`scripts/declarations/tr/count_registry_people.ts`, `npm run tr:count-people`:

1. Stream `raw_data/tr/daily/*.json` for `Indent`/`Name` pairs. Replace every hash with a
   truncated SHA-256 digest **at read time** — the raw value never leaves the parsing
   expression.
2. Resolve the folds in one PG round-trip
   (`SELECT s, translit_bg_latin(s) FROM unnest($1::text[])`, the idiom already at
   [`resolve_persons.ts:1333`](../../scripts/person/resolve_persons.ts)). There is no TS twin
   of `translit_bg_latin`, and inventing one would be a fourth normalizer.
3. Merge digest sets by fold, emit `data/person/tr_shared_name_folds.json` — only folds with
   `people_n > 1` (~26,479 raw names today), drop everything else.

Deliberately a separate script rather than a hook in `parse_daily_filing.ts`: that parser
carries three test-asserted policy guards that `Indent` must not reach its output
([`parse_share_transfer.test.ts:55`](../../scripts/declarations/tr/parse_share_transfer.test.ts)),
and this must not weaken them. Cost is not a reason to hesitate — the whole 15 GB feed scans
in **5.6 s**.

### 2.4 The artifact is COMMITTED, which is the point

~26k rows, ~1 MB. Committing it means a fresh clone, CI and Cloud SQL all apply the same guard,
so the resolver cannot publish more on one machine than another — the "green locally, different
on prod" class this repo keeps paying for. The counter needs `raw_data/`; nothing else does.

`147_person_company_basis.sql` also creates `tr_shared_name_fold (name_fold text primary key,
people_n int)`; `scripts/db/load_tr_shared_names_pg.ts` (`db:load:tr-shared-names:pg[:cloud]`)
loads it from the committed file. Committed input, so it belongs in `db:refresh` proper — no
`REFRESH_EXCLUSIONS` entry — placed **before `db:resolve:persons`**, with an `ORDER_PAIRS`
entry in [`refresh_coverage.test.ts:85`](../../scripts/db/refresh_coverage.test.ts):

> `after: "db:resolve:persons"`, `before: "db:load:tr-shared-names:pg"` — Bridge B reads the
> shared-fold table to decide whether a name is one person. Run first, the table is empty, the
> guard passes everything, and ~1,914 public figures publish a merged footprint with nothing
> failing.

### 2.5 The guard

`elig` in Bridge B gains one clause:

```sql
AND NOT EXISTS (SELECT 1 FROM tr_shared_name_fold s WHERE s.name_fold = p.name_fold)
```

An absent or empty table must be **loud, not silent**: the resolver logs a single explicit
warning naming the loader, and prints the guard's kill count on every run so a drop to zero is
visible in the same place the merge counts are.

No backfill is needed for the ~1,914 live pages — the resolver DELETEs and rebuilds
`person_role`, so a re-resolve removes them. That is also why §1 ships first: those pages stay
up, correctly caveated, until the re-resolve happens.

---

## §3 T3 — two sentences that are currently false

1. **`person_namesake_disclosure`** (`src/locales/{bg,en}/translation.json:3268`) says
   «регистърът няма ЕГН» / "the register has no personal ID". The feed carries 1,484,303
   EGN-typed and 21,355 ЛНЧ-typed `Indent` values across 2,007,400 `Name` nodes — ~75% of named
   nodes carry an identity key. The limitation is **ours, by policy**, and the sentence should
   say so: the register does publish a person key, we do not use it, and that is why these
   records may combine namesakes.
2. **[`resolve_persons.ts:2130`](../../scripts/person/resolve_persons.ts)** records a guarantee
   that does not exist. Rewrite it to name the real containment — the footprint cap, the
   shared-fold guard from §2, and the per-company basis from §1.

---

## §4 Order, and what it costs

| # | Step | Where | Cost |
|---|---|---|---|
| 1 | Apply 147 + 082 + 120 (one command, 147 first) | local, then cloud | seconds |
| 2 | `db:load:persons-browse:pg[:cloud]` (120 was DROP+CREATE) | both | minutes |
| 3 | Ship the UI (T1.2) | `npm run deploy` | — |
| 4 | `npm run tr:count-people`, commit the artifact | local only, needs `raw_data/` | ~6 s |
| 5 | `db:load:tr-shared-names:pg[:cloud]` | both | seconds |
| 6 | Bridge B guard (T2.5), then `db:resolve:persons` | local | ~5 min |
| 7 | `db:resolve:persons:cloud` **and its whole tail** | cloud | hours |

Step 7 is the expensive one and it is not optional: a re-resolve invalidates the person layer's
dependents. Per CLAUDE.md that means, in order — `db:load:declarations:pg:cloud -- --resolve`,
`db:load:official-candidate-links:pg:cloud`, `db:load:persons-browse:pg:cloud`,
`db:load:person-search:pg:cloud`, `db:load:graph:pg:cloud`, then `person:slugs:cloud` to
re-mint the prerender manifest. Slugs are stable across a re-resolve only where the identity is;
demoting a footprint does not move a slug, but `person_slug_lock` accumulates per database, so
the manifest must be minted from the SERVING database as always.

Steps 1-3 stand alone and can ship the same day. Do not bundle them with 4-7.

---

## §5 Tests

- **`scripts/db/tests/person_company_basis.data.test.ts`** — the anti-drift gate: for every
  person with TR links, 082's per-company `linkBasis` folded by 120's `bool_and`/`bool_or` rule
  must equal `person_browse_table.tr_link_basis`. Fails on any disagreement.
- **`scripts/declarations/tr/count_registry_people.test.ts`** — the policy guard, asserted on
  the writer rather than trusted: the emitted artifact matches no `[0-9a-f]{64}` and contains no
  `Indent` key. Same shape as
  [`parse_share_transfer.test.ts:55`](../../scripts/declarations/tr/parse_share_transfer.test.ts),
  and the fixture is asserted too.
- **`scripts/db/tests/tr_shared_name_fold.data.test.ts`** — table non-empty; and the guard
  discriminates: no `person_role` row at `source='tr'`, `confidence='high'` belongs to a person
  whose `name_fold` is in the table. Zero is the passing value, and it starts at ~1,914.
- **`PersonCompanies.test.tsx`** — a `declared`-only person shows no footnote; a mixed person
  shows it; a `name_match` company carries the marker and a `declared` one does not. Asserted on
  the words, not on a class, per the convention in
  [`PersonMoneyCells.test.tsx:116`](../../src/screens/persons/PersonMoneyCells.test.tsx).
- **`refresh_coverage.test.ts`** — the new `ORDER_PAIRS` entry and chain membership.

---

## §6 Out of scope, and why

- **Persisting any cluster id or hash.** §2.1. Revisit only if a corroborated-company →
  verified-footprint promotion becomes worth it, which needs Bridge A to be much larger than
  849 pairs.
- **Raising `FOOTPRINT_CAP`.** Independent question, and
  [cr-deeds-capture-v1.md](cr-deeds-capture-v1.md) already flags that backfilled owners will
  push people over it.
- **Any "undeclared holding" badge.** Already settled in
  [person-enrichment-v1.md](person-enrichment-v1.md) §6 — the report exists, nothing is
  published.
- **Fixing the 42.2% of the registry the feed never touched.** The count is a floor (§A.3), and
  a floor that removes 1,914 wrong merges is worth shipping before the ceiling is reachable.

---

## Appendix A — measurements

### A.1 Reproduce the people-per-name scan (5.6 s, 15 GB)

```bash
rg -oI --no-filename '"Indent":\[\{"_":"[0-9a-f]{64}"\}\],"Name":\[\{"_":"[^"]{3,120}"\}\]' raw_data/tr/daily/
```

Pipe into an aggregator that digests the hash on read and counts distinct digests per name.
Result on 2026-08-11: 1,678,256 pairs · 533,778 distinct names · **26,479 names (5.0%) with ≥2
distinct person keys** (histogram: 18,915 names have 2, 3,856 have 3, 404 have ≥12).

### A.2 The contaminated public figures

Join those counts against `person` on `upper(regexp_replace(display_name,'\s+',' ','g'))`,
restricted to people whose only TR links are `confidence='high'`:

| | public figures | Tier-V privates |
|---|---:|---:|
| people with TR links | 13,453 | 68,796 |
| matched into the feed | 12,941 | 54,978 |
| **name is ≥2 registry people** | **1,918 (14.8%)** | 4,495 (8.2%) |

Of the 1,914 in the name-only subset: 722 prerendered, 228 with money, max €983.3m, max 8
people on one name, and only 24 had `namesake_risk = 0`.

### A.3 Both numbers are floors

The feed starts 2021-01-01 and holds only records a filing touched, so a name absent from it is
unmeasured rather than clean. The join is exact-uppercase, not the translit fold, so spelling
variants do not match. Both push the measured share DOWN.

### A.4 The Такучев filings

| filing | node | name as printed | key |
|---|---|---|---|
| 2022-09-27 АЙВИ АРХ | `ShareTransfers/ShareTransfer/OldOwner` | `Иван Георгиев Такучев` | identical |
| 2025-08-13 УНИСОН ГРУП | `ShareTransfers/ShareTransfer/OldOwner` | `ИВАН ГЕОРГИЕВ ТАКУЧЕВ` | identical |

One registry person, two companies. Whether that person is the Ивайловград chief architect is
not answerable from this corpus, and §2.2 explains why no amount of `Indent` work changes that.
