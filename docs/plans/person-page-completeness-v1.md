# The `/person` profile — completeness for people the corpus half-covers (v1)

**Status:** design, ready to implement T1. Written 2026-08-11 from a walkthrough of
`/person/mp-868` (Сергей Дмитриевич Станишев — 39/40 НС, PM 2005–2009, МЕП 2014–2024), which
is the worst case for every gap below at once: a public figure whose whole parliamentary career
predates the roll-call corpus, whose highest office has no source in `person_role` at all, and
whose declared company stakes are held by a spouse.

Every number in §0 is measured against local PG `:5433` and the committed data tree on
2026-08-11. Re-derive with the commands inline; do not trust a figure here that a later corpus
reload has moved.

Builds on / does not duplicate:
- [person-identity-v1.md](person-identity-v1.md) — the `person_role` model, resolver tiers, the
  source catalog. This plan adds a source (T3) and widens two existing ones (T2).
- [mp-party-affiliation-v1.md](mp-party-affiliation-v1.md) — `person_role.party` per parliament,
  and §0a's explicit "the NULL is deliberate". T2 does **not** reopen that decision; it adds a
  weaker, clearly-labelled fallback for the people that plan's source cannot reach.
- [persons-declarations-audit-v1.md](persons-declarations-audit-v1.md) — the unified
  declarations block (T3.3) whose renderer T1.1 stops suppressing.
- [person-candidate-merge-v1.md](person-candidate-merge-v1.md) — why the MP sections are mounted
  separately from the PG blocks in the first place (Phase 6).

---

## 0. What is actually true today (measured)

### 0a. The roll-call corpus starts mid-44th, and 73% of MPs are outside it

```sql
SELECT ns, min(date) AS first_sitting, count(*) AS items
  FROM vote_item WHERE superseded_by IS NULL GROUP BY ns ORDER BY ns;
```

NS **44–52**, first sitting **2020-10-28**. The 44th convened in 2017, so even *its* coverage is
the last five months — the rule is not "NS ≥ 44", it is "this person has an `mp_seat` row", and
only that is authoritative.

Against `data/parliament/index.json` (2,122 MP rows, 240 currently sitting):

| | rows |
|---|---|
| carry `nsFolders` | 859 |
| carry **no** `nsFolders` | 1,263 |
| last NS < 44 (roll-call impossible) | 293 |

The 1,263 are not an ingest gap on our side — **0 of them have an `oldnsList` in their cached
profile either.** parliament.bg publishes no parliament list for those people, so no amount of
re-scraping recovers it. T2 must not promise mandate chips for them.

`MpScorecardTile` gates on `if (!scorecard.hasAny) return null`
([MpScorecardTile.tsx:143](../../src/screens/components/candidates/MpScorecardTile.tsx)), so one
surviving metric (declared net worth) keeps the whole four-tile row alive. For ~1,556 MPs that is
three tiles reading `—` with nothing saying why.

### 0b. The party of a former MP is already on disk, and we drop it at emit

`data/parliament/profiles/{id}.json` carries `A_ns_CoalL_value` — the coalition the MP was
elected with:

```
data/parliament/profiles/868.json → "A_ns_CoalL_value": "\"Коалиция за България\""
```

**3,715 of 4,284 profile shards (86.7%) have it.** Restricted to the 2,122 index rows: 1,683 have
it and **1,443 of those show no party anywhere today**, because
[`PersonProfileHeader.tsx:90`](../../src/screens/components/candidates/PersonProfileHeader.tsx)'s
badge falls back to `mpEntry.currentPartyGroupShort`, which the scrape leaves NULL for every
non-sitting MP. `scrape_mps.ts` emits `seatedRegion` from the same profile blob and simply does
not emit this field.

`data/canonical_parties.json` already folds „Коалиция за България" → `bsp`, colour
`rgb(237,28,36)`, nickName `БСП` for `2005_06_25`, so it can become a real coloured `PartyBadge`
linking to the party page for that cycle rather than a grey string.

**But it is ONE party for a whole career and it is not attributable to a term.** Measured against
the roll-call-derived per-NS party for the 72 MPs who changed group:

| the profile coalition matches… | MPs |
|---|---|
| the LAST NS only | 12 |
| the FIRST NS only | 4 |
| both | 17 |
| neither endpoint | 27 |

(The 27 are a mix of genuine disagreement and misses in the exact canonical-name fold used for
this measurement — either way it is not safe as a per-term claim.) T2 therefore renders it as an
unattributed „избран с", **never** overriding `person_role.party` where that exists.

### 0c. `person_role` for a pre-roll-call MP carries no dates

```
source | ref | role | party | start_date | end_date | date_basis | place_code
mp     | 868 | mp   |       |            |          |            | VAR
```

`mpRoleRowsFor` ([resolve_persons.ts:180](../../scripts/person/resolve_persons.ts)) returns a
single bare-ref row with NULL everything when `seatsForMp` finds nothing — deliberate and correct
today, because the only date source is the roll-call corpus. `NS_TERM_BOUNDS`
([resolve_persons.ts:141](../../scripts/person/resolve_persons.ts)) already derives start/end from
`NS_TERM_START`, which covers **NS 40–52** (the elections we serve). `oldnsList` across all
profiles reaches back exactly one parliament further:

```
39:221  40:241  41:361  42:494  43:449  44:475  45:710  46:571  47:612  48:525  49:400  50:276  51:90
```

Nothing before the 39th. So one historic bounds entry (39: 2001-06-17 → 2005-06-24) closes the
whole set.

### 0d. The declarations list is rendered for everyone EXCEPT MPs

[PersonProfileScreen.tsx:479](../../src/screens/person/PersonProfileScreen.tsx):

```tsx
{!mpAssetRollup && <PersonDeclarations slug={p.slug} />}
```

`PersonDeclarations` is the per-filing list — type badge, position held, net worth per filing, a
per-filing link to that exact XML on register.cacbg.bg, expandable to full detail. It is
suppressed for anyone the MP rollup covers.

Stanishev has **11 filings** in Postgres — 3 as MP (2015–2017) and 8 as МЕП (2018–2024):

```sql
SELECT declaration_year, fiscal_year, declaration_type, institution
  FROM declaration WHERE person_id = (SELECT person_id FROM person WHERE slug='mp-868')
 ORDER BY declaration_year DESC;
```

`mp_declarations('mp-868')` returns all 11 and `mp_assets('mp-868')` correctly spans both tiers
(latest = 2024 `Vacate`, МЕП). So this is purely a render gate: the page shows one snapshot plus
one prior year, and the section titled „Имущество и декларации" contains no декларации. The full
list is one small „Виж детайли →" away on `/candidate/mp-868/assets`
([MpAssetsSummary.tsx:144](../../src/screens/components/candidates/MpAssetsSummary.tsx)).

### 0e. The unvalued-asset list truncates at 12 with a dead label

[MpAssetsSummary.tsx:290](../../src/screens/components/candidates/MpAssetsSummary.tsx) slices to
12; line 332 renders the overflow as a non-interactive `<li className="italic">`:

```tsx
+{unvaluedItems.length - 12} {t("mp_assets_more") || "more"}
```

`mp_assets_more` is `"още"` in BG, so it composes to **„+3 още"** — wrong word order in Bulgarian
— and clicks nothing, although the items are already in memory.

### 0f. There is no cabinet source, and `data/governments.json` has been sitting there

`person_role.source` ∈ {mp, official, magistrate, local, candidate, donor, mep, tr}. No cabinet.
`data/governments.json` holds **18 cabinets since 2005**, each with `pmBg`, exact
`startDate`/`endDate`, `type` (regular/caretaker) and `pmPartyBg`. Stanishev's
`2005-08-17 → 2009-07-27` is in the repo, unused. There is **no minister list** in that file, and
the cacbg exec register only starts ~2015, so PM is the only cabinet office this source can give.

Party leadership has a `party_leader` category in the resolver
([resolve_persons.ts:577](../../scripts/person/resolve_persons.ts)) but it is derived from
*filings*, so it reaches only officers who filed from ~2015. A БСП chairmanship 2001–2014 is
invisible to it.

His МЕП role carries an end date and `date_basis='filing'` only, so the office renders as
„декларация при напускане 13.08.2024" rather than a term.

### 0g. Declared stakes carry no ЕИК, and the existing gate cannot see a spouse

```sql
SELECT count(*) total, count(uic) with_uic FROM declaration_stake;   -- 15304 | 0
```

`declaration_stake.uic` is **0 of 15,304 populated** and always will be — 096's header says so.
Resolution is by name, through migration 096's three gates, yielding **2,147** rows in
`declaration_stake_company`.

Over the 15,281 stake rows with a usable normalised name (7,039 distinct):

| | rows | share |
|---|---|---|
| normalised name matches exactly one trading company | 8,549 | 56.0% |
| ambiguous (>1 company) | 608 | 4.0% |
| no TR name match at all | 6,124 | 40.1% |

**Gate B is the binding constraint, and it asks the wrong question for family holdings.** It
requires the TR to record *the declarant* at that ЕИК. But 8,526 rows carry a `holder_name` and
only **4,431 are the declarant** — ~4,095 name a spouse or child, which gate B can never confirm.

Extending gate B to also accept the **declared holder's** own TR footprint
(`tr_officers` ∪ `tr_person_roles` on `name_fold`):

| | rows |
|---|---|
| gate A + B(declarant) — today, before gate C | 3,049 |
| gate A + B(holder) | 2,321 |
| **net new from the holder arm** | **779** (across **291** people) |
| ambiguous names disambiguated to exactly one ЕИК by a footprint | **218** |

The worked example is the whole design in one row set:

| declared | TR | outcome |
|---|---|---|
| „Актив груп ЕООД" / Моника Любомирова Станишева | two active `АКТИВ ГРУП` ЕООД — `121891779`, `125577092` | gate A drops it today; Моника is `sole_owner` 100% at `121891779` in `tr_officers`, which **resolves it uniquely** |
| „Интерактив комюникейшънс ЕООД" | exactly one — `203801820` | name-unique; blocked today only because gate B looks for *him* |
| „Призма Къмпани ЕООД" | zero matches | stays unlinked, correctly |

### 0h. Ten candidacies he never contested

`person_role` holds `candidate` rows `2014_10_05:mp-868` … `2026_04_19:mp-868`, minted from
synthetic `data/<election>/candidates/by-slug/mp-868.json` shards
(`partyNum: null, oblasts: [], prefs: {}, cikRows: []`). `hasElectionResults`
([usePersonElections.ts:24](../../src/data/dashboard/usePersonElections.ts)) suppresses them in
the UI, so nothing is visibly wrong — but the table asserts ten candidacies, and any future
consumer that counts roles will read them. Noted here, addressed in §6 (out of scope for v1) so
it is a recorded decision rather than an oversight.

---

## Tier 1 — render what we already hold (UI only, no data changes)

No loader, no migration, no scrape. Every fact below is already fetched by the page.

### T1.1 Stop suppressing the filing list for MPs

`PersonProfileScreen.tsx:479` — drop the `!mpAssetRollup` gate so `MpAssetsSummary` (the headline
snapshot) and `PersonDeclarations` (the per-filing list) both render, snapshot first.

Both read Postgres (`mp_assets`/`mp_declarations` vs `person_declarations`, all off `declaration`),
so they cannot disagree on a figure. Two things to get right:

- **One heading, not three.** `id="declarations"` is opened by `PersonMpSections.tsx:78`,
  `PersonDeclarations.tsx:92` **and** `PersonNoDeclarationNote.tsx:68` — today at most one of the
  first two can render, so removing the gate creates a duplicate DOM id and a repeated title.
  Hoist the section wrapper to the caller and pass both as children, or have `PersonDeclarations`
  accept a `bare` prop that skips its own `DashboardSection`. The `#declarations` anchor is a
  deep-link target from `MpScorecardTile`'s `netWorth` link — keep exactly one element with it.
- **`PersonDeclarations` self-hides** when there is no asset-bearing filing, so a person with an
  MP rollup and nothing in `declaration` is unchanged.

Gate: extend `PersonDeclarations.test.tsx` with an MP fixture (non-null `mp_assets` + ≥2 filings)
asserting both blocks render and exactly one `#declarations` exists.

### T1.2 Make „+3 още" expand, and fix the Bulgarian

`MpAssetsSummary.tsx:290,332` — replace the `<li>` with a `<button>` toggling
`slice(0, 12)` ↔ full list; no fetch, the items are in the rollup. Retire `mp_assets_more` in
favour of an interpolated pair so the count sits inside the phrase:

```
mp_assets_show_more: "Покажи още {{count}}"   /  "Show {{count}} more"
mp_assets_show_less: "Скрий"                  /  "Show less"
```

`mp_assets_more` has exactly one call site (`MpAssetsSummary.tsx:332`), so the key retires with it.

### T1.3 Retire the dead KPI row

`MpScorecardTile` — render only the metrics with a value instead of `formatPct(null)` → `—`.
Keep the tile when at least one survives; when *none* do, the tile already returns null.

### T1.4 Say why the voting record is missing

Where the MP has no `mp_seat` row (authoritative — not `nsFolders` arithmetic, since NS 44 is
itself partial), print one line under the MP block instead of leaving the absence unexplained:

> „Поименните гласувания в сайта започват от 44-то НС (окт. 2020 г.). За мандатите на този
> народен представител няма публикувани поименни гласувания."

This is the same discipline as `PersonNoDeclarationNote` — a blank section renders "never had to"
and "we don't hold it" identically, and only one of those is true here.

### T1.5 Lead with identity, not analytics

Current order is wealth chart → portfolio → cohort → transfers → scorecard → assets → **offices**.
Move „Длъжности" above the wealth blocks and fold the header's „Мандати: 39 НС, 40 НС" into it, so
the one section that describes *who this is* is not last and the mandate list is not stranded in
the header. Purely a JSX reorder inside the `!electoralPending` fragment — mind that
`PersonWealthTrajectory` and friends keep their relative order (the CLS gate in `tests/perf.spec.ts`
reserves the electoral block's footprint, not theirs).

**Exit:** on `/person/mp-868` — 11 filings listed with per-filing register links; the unvalued
list expands; no `—` tiles; a sentence explaining the missing voting record; offices above wealth.

---

## Tier 2 — the party and the mandate dates already on disk

### T2.1 Emit `A_ns_CoalL_value` into `index.json`

`scripts/parliament/scrape_mps.ts` — add `electedWith: string | null` beside `seatedRegion`,
read from the already-fetched profile blob, `trim()`ed and stripped of the stray `"` quoting the
source wraps it in (`"\"Коалиция за България\""`). No new fetch: the profiles are cached.

Consume in `PersonProfileHeader`'s badge fallback chain, **after** the candidacy-derived party and
after `currentPartyGroupShort`:

```
party (newest cycle with results) → currentPartyGroupShort → electedWith
```

Canonicalise through `data/canonical_parties.json` for the colour and the link, exactly as the
resolver already does (`partyKey`, [resolve_persons.ts:284–323](../../scripts/person/resolve_persons.ts));
an unmappable string renders as an uncoloured badge rather than being dropped.

**Label it for what it is.** §0b shows it is not per-term. The badge tooltip / adjacent label says
„избран с" — not the sitting group, not a current affiliation. It must never be written into
`person_role.party`, whose contract (mp-party-affiliation-v1 §2) is the group *entered per
parliament*.

Expected: **1,443 index MPs gain a party badge**; 240 sitting MPs unchanged.

Gate: a unit test on the fallback chain (candidacy wins over `currentPartyGroupShort` wins over
`electedWith`), plus a scrape-side assertion that the emitted value carries no surrounding quotes.

### T2.2 Date the mandates of pre-roll-call MPs

`mpRoleRowsFor` — when `seatsForMp` is empty, fall back to the profile's `oldnsList` (via
`index.json`'s `nsFolders`, already loaded by `loadNsFolders`) and emit one row per NS with
`NS_TERM_BOUNDS` dates, `party: null`, `date_basis: 'term'`.

Add the one historic entry the corpus needs — NS 39, 2001-06-17 → 2005-06-24 — as a **separate**
`NS_TERM_BOUNDS_HISTORIC` map, *not* a new key in `ELECTION_TO_NS`: that record is keyed by
election folders we actually serve, and inventing `2001_06_17` there would imply a `data/` tree
that does not exist. §0c shows nothing before the 39th exists in `oldnsList`, so the table is one
row and stays one row.

**Risk to weigh before implementing.** This changes the ref shape for ~859 MPs from bare
`'<mpId>'` to `'<mpId>:<ns>'`. CLAUDE.md documents both shapes and every consumer reads
`split_part(ref, ':', 1)`, so it is within contract — but it also multiplies `person_role` rows
for those people and changes `foldOffices`' input. Grep every `source='mp'` consumer
(`082_person_api.sql`, `120_person_browse.sql`, `PersonProfileScreen`'s `mpId` extraction,
`officials_person_slug`) before landing, and re-run `person_role_date_basis.data.test.ts` — its
"mp count collapsing" assertion is the tripwire.

The 1,263 with no `oldnsList` keep their bare undated row. That is correct and must be stated in
the code comment: parliament.bg publishes nothing, so there is nothing to fall back to.

### T2.3 Give the МЕП role a term — **WITHDRAWN, measured 2026-08-12**

The step said: EP terms are fixed and public (8th 2014-07-01 → 2019-07-01, 9th 2019-07-02 →
2024-07-15), so date the `mep` role from the term containing the filing rather than from the filing
itself, and it stops rendering as „декларация при напускане".

**Do not implement it.** It rests on a premise the corpus refutes, and it would replace a measured
bound with a worse inference. Four findings, all against the 34 `mep` roles and the 132 EP filings
that resolve to them:

- **The filing is not attributable to one term.** 18 of the 33 MEPs with EP filings have filings on
  BOTH sides of the 8th/9th boundary. "The term containing the filing" is undefined for 55% of them,
  and picking either end erases the other mandate.
- **A term start is not a mandate start.** The register knows only that somebody filed as an MEP in
  a given year. A replacement who joined in 2023 would be dated from 2019-07-02 — an overstatement
  of up to a full term, on a page that names the person. `nsFolders` has no counterpart here:
  **there is no MEP roster in this repo**, authoritative or otherwise.
- **Service gaps are undetectable, so the span cannot be split either.** 18 of 33 have a gap in
  their filing YEARS, and every one of them is the missing 2020 filing — a register artifact, not
  a period out of office. Reading those as gaps would invent absences; ignoring them is the only
  option, which means one span or nothing.
- **The ref cannot be widened to carry per-term rows.** `person_role.ref` for `source='mep'` is the
  officials slug, and 132 rows join `declaration.subject_ref` to it. A `<slug>:<term>` shape breaks
  that fill, which is the "NULL `person_id`, filing drops off /person" failure CLAUDE.md documents.

**What is already true.** These dates come from the Сметна палата's own встъпителна / при напускане
filings — `min(Entry)` / `max(Vacate)` per posting — and carry `date_basis = 'filing'` precisely
because ЗПКОНПИ allows a month, making each an upper bound. The profile renders them with an inline
note saying exactly that. The step treated an honest, caveated label as a defect; it is the correct
presentation of the only evidence there is.

**What would unblock it:** an actual roster of Bulgarian MEPs by term (europarl.europa.eu publishes
one). With that, `mep` becomes the same shape as T2.2 — authoritative membership per term, dated
from a static bounds table — and the ref question can be settled on its own merits. Until then, a
term here is a guess wearing a mandate's clothes.

**Exit:** `/person/mp-868` header shows a red БСП badge linking to `/party/БСП?elections=2005_06_25`;
Длъжности reads „Народен представител · 39 НС (2001–2005), 40 НС (2005–2009) · Варна".

---

## Tier 3 — cabinet offices from `governments.json`

A new resolver source `cabinet`, role `pm`, one row per cabinet: `ref = <cabinet id>`,
`start_date`/`end_date` from the file, `date_basis: 'term'`, `party` canonicalised from
`pmPartyBg`. Eighteen rows.

Identity attaches under the existing accuracy rule (the one `data/person/regulators.json` states):
a full three-part name that the resolver confirms globally unique, or no row. All 18 `pmBg` values
are full three-part names; measure `namesake_risk` for each before landing and list any that do
not resolve **in the plan's own appendix**, resolved:false, rather than attaching them loosely.

Two-way linking falls out for free: `/governments/:id` ↔ `/person/:slug`, which today are two
unconnected views of the same 18 people. `officeHeading` needs a `pm` arm („Министър-председател",
„Служебен министър-председател" for `type='caretaker'` — the distinction is in the file and
collapsing it would be a real misstatement).

**Ministers are out.** `governments.json` has no minister list and the cacbg exec register starts
~2015; inventing a minister roster is a curation project, not this tier.

Gate: a data test asserting all 18 cabinets resolve to a person or are explicitly allowlisted, and
that `pm` roles never overlap for one person.

---

## Tier 4 — the holder arm on migration 096

Widen gate B: a stake row is confirmed when the TR records **either the declarant or the declared
holder** at that ЕИК, and use the same footprint to break gate A's ambiguity.

```
A′ (name)   : the normalised name matches ≥1 trading company (was: exactly 1)
B′ (person) : the TR records the declarant OR declaration_stake.holder_name at that ЕИК
resolve     : publish only when A′ ∩ B′ leaves exactly ONE ЕИК
```

That is strictly stronger than today's A ∧ B for the ambiguous set (two independent sources must
agree on the *same* company) and strictly wider for the family set. Gate C (identity
unambiguity) applies unchanged to whichever name did the confirming — and this is the part to get
right: when the holder is the spouse, gate C must be evaluated on **the holder's** folded name,
not the declarant's, or the namesake risk the gate exists to price is measured against the wrong
person.

Expected: +779 stake rows across 291 people, +218 ambiguous rows resolved (§0g).

**Attribution is a hard requirement, not a nicety.** A spouse's company:
- links to `/company/:eik` on its own row, keeping the existing italic holder attribution;
- must **not** join `p.companies` (the person's own registry footprint);
- must **not** enter `procuredEur`, `company_public_money`, or any money figure attributed to the
  person;
- must not create a `person_role` row of `source='tr'` for the declarant.

The matview grows a `holder_name` + `holder_is_declarant` column so every consumer can see which
arm confirmed a row and no caller can render a spouse's holding as the subject's. Anything that
sums `declaration_stake_company` today must add `WHERE holder_is_declarant` or be re-read —
enumerate those callers in the implementation PR (`PersonStakeProcurement`, `096`'s own
consumers) before changing the matview.

UI: „Декларирани дялове (не в Търговския регистър)" splits three ways with the reason stated —
linked / „няколко фирми с това име" (list the candidates, link none) / „няма съвпадение в ТР"
(likely closed or renamed before the register snapshot). 40% of rows land in the third bucket and
that is a fact about the register, not a failure to be hidden.

Cloud: 096 is applied-never-loaded. Ship with
`apply_functions.ts 096_stake_procurement.sql` and a `REFRESH MATERIALIZED VIEW`; the loader that
already refreshes it (`load_declarations_pg.ts`) carries it on the next declarations reload.

Gate: extend `PersonStakeProcurement.test.tsx` and add a data test asserting (a) no published row
resolves to >1 ЕИК, (b) every holder-arm row carries `holder_is_declarant = false`, (c) the
Stanishev fixture resolves `АКТИВ ГРУП` to `121891779` and leaves `ПРИЗМА КЪМПАНИ` unlinked.

### What T4 actually shipped, where it differs from the above (2026-08-12)

Three deviations, all measured rather than chosen:

- **Gate C is `n = 1`, never `n <= 1`, so `АКТИВ ГРУП` does NOT resolve** — the case that
  motivated the whole holder arm. Its declared holder, Моника Любомирова Станишева, is an
  officer at 14 companies and **absent from `person` entirely**, so `n = 0`. Admitting `n = 0`
  would publish 624 candidate rows on no identity evidence at all: `person` is not a census, and
  "we hold nobody by that name" is not "that name is unique". The gate's price, paid the same way
  the plan already accepts it elsewhere. `ПРИЗМА КЪМПАНИ` is unlinked as specified — for a
  different reason (no registry footprint), which is why the pair is worth pinning.
- **The remainder splits three ways in the UI over SIX reasons in the payload**, not three. The
  plan's three buckets came from an assumption that the non-absent remainder was ambiguity; it is
  not. Measured over the stake rows of active public figures: `absent` 40.1% (the plan's 40%
  prediction, exact), `unconfirmed` 31.6% — a company of that name IS registered and does not
  record the declared holder — `namesake` + `unverified` 9.5%, `ambiguous` 3.0%, `linked` 15.9%.
  Calling the 31.6% „няма съвпадение в ТР" states something false about a company that exists,
  which is the same class of error the split exists to end.
- **The verdict is keyed per (declared name, declared HOLDER)**, which the plan does not mention
  and which turns out to be load-bearing. Resolution is a function of both — that is what the
  holder arm means — so a name keyed alone lets a company refused for the filer inherit the
  resolution obtained through their spouse: 192 stake rows, 23 of them refusing the subject's own
  claim and then publishing it as their link.

A fourth thing the plan could not have known: `person_stake_procurement`'s "most recently
declared" collapse was not a total order, so 8 of 70 served rows could render a board seat as a
shareholding depending on the matview's physical row order. Fixed in the same step (T4a).

---

## Tier 5 — curated party-leader roster

`data/person/party_leaders.json`, on the `data/person/regulators.json` pattern verbatim: one entry
per (party, person, term), sourced to the party's own congress record or a citable public source
per row, attaching **only** via an `mpId` or a resolver-confirmed globally-unique name;
name-ambiguous entries stay `resolved: false` in the file and are not emitted.

Scope: national party chairs from 2001 (the first parliament `oldnsList` reaches), for parties in
`canonical_parties.json`. Roughly 60–80 rows. Renders as a `person_role` of `source='party'`,
role `party_leader` — the same role the filings-derived arm already produces, so the two must
dedupe on (person, party, overlapping term) rather than double-listing a chair who also filed.

Lowest tier because it is the only one whose input has to be *created*, and a wrong row here is a
public claim about a named person with no register behind it.

---

## 6. Deliberately out of scope for v1

- **Ministers.** No source (§0f). A minister roster is its own plan.
- **The ten synthetic candidacies** (§0h). They are invisible today because `hasElectionResults`
  filters them, and removing them touches the candidate-shard emitter that `/candidate/:id`
  depends on. Recorded, not fixed. Revisit if any consumer starts counting `person_role` rows of
  `source='candidate'`.
- **A career timeline band.** The strongest legibility win on this page and the one that needs
  design, not archaeology — every input (mandates, cabinet, ЕП, companies, filings) only becomes
  dated after T2/T3, so it is v2 by dependency.
- **Declaration diff view** („какво се промени спрямо 2023") — `declaration_asset` supports it;
  separate plan.
- **Retiring `/candidate/:id/assets`.** Probably redundant after T1.1, but it is a live URL with
  sitemap `<loc>`s; retiring it is a redirect exercise, not a render change.

## 7. Open decisions

1. **T2.2's ref-shape change** — widen `'<mpId>'` → `'<mpId>:<ns>'` for 859 MPs, or carry the
   dates on the bare row and accept one undated row per multi-mandate MP? The former is cleaner
   and matches the documented shape; the latter touches nothing downstream. Recommend the former,
   gated on the consumer grep in T2.2.
2. **T4's matview columns** — add `holder_name`/`holder_is_declarant` to
   `declaration_stake_company`, or publish the holder arm as a *separate* matview so no existing
   caller can silently start summing spousal holdings? The second is safer and costs one more
   object. Recommend the second unless the caller enumeration comes back short.
3. **T5 sourcing** — is a party's own website acceptable as the per-row source, or do we require a
   Сметна палата / ЦИК trace? Affects how many of the ~60–80 rows are servable.
