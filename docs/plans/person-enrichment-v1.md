# Person-profile enrichment — dates of office and company history

Research memo, 2026-08-10. Trigger: `/person/ivan-georgiev-takuchev-c39f00` renders one line
("Chief architect · Ивайловград") where papagal.bg shows four company participations with
`От дата` / `До дата` ranges. Every figure below is measured against local Postgres and
`raw_data/tr/` on 2026-08-10.

The two gaps have different causes and completely different fixes, so they are separated.
Gap 2 also carries an identity decision that is the user's to make, not a coding task.

---

## Gap 1 — dates of office

### What is actually missing

`person_role` **already has `start_date` and `end_date`**. They are empty for everything
except MPs:

| source | roles | with start | with end |
|---|---:|---:|---:|
| local | 25,319 | 0 | 0 |
| official_exec | 8,735 | 0 | 0 |
| ngo | 8,161 | 0 | 0 |
| official_muni | 6,391 | 0 | 0 |
| public_sector | 5,533 | 0 | 0 |
| magistrate | 3,113 | 0 | 0 |
| **mp** | **3,081** | **1,522** | **1,283** |
| donor / diplomat / mep / regulator / ds / president / sanctions | 1,557 | 0 | 0 |

`person_role` holds 315,164 rows in total, but most are not offices and never will be dated
here: `tr` (186,209) is a company-officer link and `candidate` (67,065) a candidacy, neither
of which has a term. **The denominator that matters is the office-bearing sources** — the
ones the profile's "Длъжности" block actually lists (`mp`, `local`, `magistrate`, the
officials roster, `public_sector`, `president`, `mep`, `diplomat`, `regulator`): **52,433
roles, of which 1,522 carry a start date.** Everything below is measured against that.

So it is not a schema gap. And — separately — **even the 1,522 that have one could not be
displayed**: `082_person_api.sql`'s `roles` object built `source / facet / role / ref /
confidence / placeKind / placeCode / placeLabel / placeLabelEn / judicialKind` and omitted
both date columns. The payload is the first thing to fix regardless of which source fills next.

### T0 — emit what we already hold (no new data) — SHIPPED

Add `start`/`end` to the `roles` object in 082, plus a `date_basis` column on `person_role`
(081) so a filing date can never be rendered as a start of office, and render the period in
`src/screens/person/PersonProfileScreen.tsx`. Prerequisite for every tier below.

**It ships as TWO files, 081 first, in one command** — `person_by_slug` is `LANGUAGE sql`
and therefore validated at CREATE time, so applying 082 to a database without the column
fails the whole file with `42703` (`exec()` sends a migration as one implicit transaction):

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts \
  081_person_identity.sql 082_person_api.sql
```

Applying 081 also runs its backfill (`source='mp'` → `'term'`, 1,522 rows), which is what
makes the dates appear on prod without a multi-hour re-resolve.

**The resolver writes the column too, and that is not redundant.** `db:resolve:persons`
DELETEs `person_role` and re-COPYs it from an explicit column list, so a basis that only
ever came from 081's backfill would be dropped on the next resolve — and since the renderer
shows nothing without a basis, the feature would go dark silently rather than fail. Both
writers are pinned by `scripts/db/tests/person_role_date_basis.data.test.ts`.

**How many roles this actually surfaces: 259, not 1,522.** The profile's office list dedupes
to one row per seat, and an MP is one role row per parliament — so of the 562 people with a
dated MP role, 303 have between 2 and 9 terms folded into a single row (960 of the 1,522
roles). `foldOffices` merges the group's span rather than picking one term, so a nine-term
MP reads "2017 – present"; the individual per-parliament rows are still not listed.

### T1 — `local` roles: the date is already inside the ref (25,319 roles) — SHIPPED

**All 25,319 dated, 16,938 with an end** (`scripts/person/localTerms.ts`, `date_basis:
'election'`). The end rule is the part worth stating: a REGULAR cycle (`*_mi`) contests every
local office nationally and so ends every outstanding mandate, while a PARTIAL (`*_chmi`)
contests one seat and ends only that one. Measured on the corpus, 338 mandates across 352
seats end at a by-election rather than at a general election — those are exactly the people a
"next general election" rule would have shown serving years after they were voted out.

The suffix test is exact for a reason: `2024_06_23_chmi` also ends in `mi`, so a looser match
would retire the entire country's mandates on the day one village voted.

Known limit, stated rather than hidden: 46 район mayors have no cross-cycle seat key
(`localSeatKey` returns null — their ref is index-based and their typed place is the parent
община), so a by-election that replaced one mid-term is invisible and their term can read up
to four years long. They still get the general-election end, which does not need the key.

Original analysis:

Every `local` role's `ref` **begins with its election cycle**:

```
2023_10_29_mi:SLS07:57:112      councillor, obshtina SLS07
2007_10_28_mi:BLG13:kmetstvo:6  village_mayor, settlement 53727
```

`start_date` is a `split_part(ref, ':', 1)` away, across 66 cycles from `2007_10_28_mi` to
`2026_06_14_chmi`. `end_date` is the next cycle covering that obshtina — and where a partial
(`chmi`) replaced the holder mid-term we already track it in `data/person/kmetstvo_flips*.json`
and `scripts/person/kmetstvo_flips.ts`.

Highest value per unit of work in this memo: no fetch, no new source, largest role count, and
the dates are facts about the election rather than estimates. One caveat to encode rather than
paper over — the mandate legally starts at the constitutive session, not on polling day, so
label it as the election that produced the mandate.

### T2 — Entry/Vacate declarations — SHIPPED

**4,625 roles across 4,417 people**, `date_basis: 'filing'` — `official_exec` 3,986,
`public_sector` 396, `official_muni` 161, `diplomat` 66, `mep` 11, `president` 5. Joined in
the resolver on `declaration.subject_ref = person_role.ref` (the officials slug), earliest
`Entry` → latest `Vacate` per slug. The slug folds in the institution, so one slug is one
POSTING and the bounds describe that posting rather than a career.

Fewer than the 5,596 people who filed one, for two measured reasons — and **not** because of
the roster join, which loses 0 of the 5,274 exec/muni slugs:

- **the `mp` tier is excluded on purpose** (687 people). Its `subject_ref` is an mpId rather
  than an officials slug, and MP roles already carry `term` dates from the parliament
  register — a real mandate, strictly better than a filing date;
- **886 of those slugs have Entry/Vacate filings with no `filed_at` at all**, so there is no
  date to take.

**It does NOT reach the person this plan started from, and that is the predicted outcome
rather than a defect.** `/person/ivan-georgiev-takuchev-c39f00` still renders "Chief
architect · Ивайловград" with no period: he has exactly one filing, an `Annualy` for fiscal
2024, and the municipal register we hold covers a single `register_year` (2025) with 106
Entry + 83 Vacate rows in total. The unlock for him is widening the municipal crawl
backwards — an `update-officials` scope change, not more derivation. Everything derivable
from what we hold is now derived.

Two guards, both needed:

- **The register's out-of-range dates are clamped** (`filed_at BETWEEN 2000-01-01 AND
  today`). There is at least one `Vacate` filed_at of **3023-02-13**, and a typo'd year
  reaching `person_role` would sort to the top of every "most recent" ordering on the site.
- **A backwards period is dropped, not published.** One slug can be entered and vacated more
  than once (the same person returning to the same institution), so `max(Vacate)` can precede
  `min(Entry)`; the end is dropped and the posting reads as open. Measured after the change:
  0 roles with `end_date <= start_date`, on any basis.

Original analysis:

The Сметна палата register distinguishes filing types, and we already store them:

| declaration_type | rows |
|---|---:|
| Annualy | 34,394 |
| Other | 4,895 |
| **Entry** (встъпителна) | **4,450** |
| **Vacate** (при напускане) | **4,244** |

3,929 distinct people have an Entry, 3,143 a Vacate, **5,596 have at least one**. Each carries
`filed_at`. This is the state's own record of taking and leaving office and it is sitting in
the `declaration` table unused by `person_role`.

Two things must be stated on the page rather than smoothed over:

- **It is the FILING date, not the appointment date.** ЗПКОНПИ gives a one-month window, so it
  is an upper bound within roughly 30 days. Render it as "declared on taking office · <date>",
  never as "took office <date>".
- **It barely reaches the municipal tier today.** By tier: `exec` 3,576 Entry + 2,999 Vacate
  (2013-2025), `mp` 768 + 1,162, **`muni` only 106 + 83**. The municipal crawl holds a single
  `register_year` (2025), which is exactly why our chief architect gets nothing from this tier.
  Widening the municipal register crawl backwards is the unlock, and it is an
  `update-officials` scope question, not a new source.

Data-quality note found in passing: the max `Vacate.filed_at` is **3023-02-13** — a source
typo that needs clamping before any of this drives a sort or a range filter.

### T3 — implied span from annual filings (universal, weakest)

Annual filings for fiscal 2019…2024 imply presence in office across those years. Defensible
only if labelled as what it is — a filing span, never a term. For our subject it currently
yields 2025-2025 alone, so it is a floor for the sitewide case rather than a fix for this one.

---

## Gap 2 — company history (the papagal gap)

### Why we have nothing for this person

`Иван Георгиев Такучев` has **zero rows** in `tr_person_roles`, `tr_officers` and
`state.sqlite.company_persons`. Three independent reasons:

1. **CR Deeds is current-state only.** Re-confirmed here, matching
   `docs/plans/cr-deeds-capture-v1.md` §0a: fields carry `fieldEntryDate` / `fieldActionDate`
   and no erasure marker or validity end. `fieldOperation` takes 1/2/3 and does not encode
   erasure.
2. **The CR Deeds capture is 2.9% of the registry** — 29,777 of 1,020,707 companies. Neither
   АЙВИ АРХ (205945260) nor УНИСОН ГРУП (205243218) was ever fetched.
3. **The daily-feed replay starts 2021-01-01 and only knows records it saw *added*.** An
   `Erase` of a pre-2021 record wipes nothing, because nothing is there
   (`parse_daily_filing.ts:158`). His АЙВИ АРХ stake was entered 2019-12-18, so he is invisible
   even though the feed contains the filing that removed him.

### The recovery vector, already on disk: `ShareTransfers` — SHIPPED (parser)

`parse_daily_filing.ts` now emits a `share_transferred` event per `ShareTransfer` record and
`state_replay.ts` records it as an EXIT. Measured over all 1,666 daily files: **161,951
transfer events naming 115,150 distinct transferors**, 93,568 of them sole owners and 68,383
partners.

**The role is always `partner`, the generic shareholder** — the node states none, and the
seller's prior stake is not recoverable from it. A first draft inferred `sole_owner` whenever
the BUYER ended up sole owner; that is the ordinary ООД buy-out (two съдружници at 50%, one
buys the other out) and it asserted 100% ownership for people who held half — 34.2% of the
rows it so labelled. `partner` under-specifies a genuine ЕООД seller instead, which is the
right direction to be wrong in: it invents nothing.

**A recovered row carries `added_at = NULL`, not the filing date.** The transfer says when
the stake was given up and nothing about when it was acquired, and a null start is what
structurally prevents a two-bound period: `PersonTimelineTile` already drops rows with no
start rather than drawing a zero-length bar. Encoding the exit date in both columns would
have made the row indistinguishable from a real one-day tenure.

**The dedupe must match a record erased EARLIER IN THE SAME FILING, not just an active one.**
A SubDeed lists its sections in fixed order and `Partners`/`Erase` precedes `ShareTransfers`,
so on an ООД→ЕООД consolidation the seller is already erased when the transfer replays.
Measured over the feed's first 150 days: matching only active records minted 768 duplicates
of 12,220 rows (6.3%); matching same-filing erasures too brings it to 76 of 10,822 (0.70%),
and the residual is consistent with people who sold one stake while holding another.

**Validation against the case that prompted this**: the parser independently recovers both
of Иван Георгиев Такучев's exits — АЙВИ АРХ on **2022-09-27** and УНИСОН ГРУП on
**2025-08-13** — matching the two `До дата` values papagal publishes, exactly, from a source
we already held. Note this is still a NAME match and settles nothing about whether those two
EIKs belong to the Ивайловград chief architect; see the namesake section below.

The replay stamps an EXISTING active shareholder record where it has one and only mints a row
when it does not, so a person the feed already tracked is not double-counted. A minted row
carries `addedAt === erasedAt`, which is how "exit observed, entry unknown" is recorded — no
consumer may render a period from it.

Original analysis:

The 2022-09-27 filing for АЙВИ АРХ contains, verbatim:

```
ShareTransfers → ShareTransfer
  OldOwner  Name: Иван Георгиев Такучев
  NewOwner  Name: Георги Иванов Такучев
  ShareAmount: 50   Date: 15…
```

We do not parse it. `parse_daily_filing.ts` handles person groups under `Add` and `Erase` only;
`ShareTransfer`, `OldOwner` and `NewOwner` appear nowhere in the codebase outside this memo.

Measured across all 1,666 daily files:

| | |
|---|---:|
| files containing `OldOwner` | 1,362 |
| `OldOwner` records | 161,953 |
| distinct exiting-owner names | 112,623 |
| of those, already known in `tr_person_roles` | 73,511 |
| **names with no TR record of any kind** | **~39,100** |
| names matching a person we track as a public figure | 9,360 |
| **public figures with ZERO company links who appear as an exiting owner** | **995** |

Person 21952 — our chief architect — is confirmed in that 995.

**Scope the claim to what the node proves.** A `ShareTransfer` is an **exit event**: "held a
stake in X until `<filing date>`, transferred to Y". It is not a range. An entry date is
recoverable only when the acquisition also fell inside the 2021-01-01→ window (a matching
`NewOwner` earlier in the feed). Papagal's `От дата` for pre-2021 acquisitions comes from a
source we do not have, and a UI that renders one bound as a range would be inventing the other.

Effort: a parser addition plus a new event kind in the replay. No new fetching, no rate limit,
no crawl — the 7 GB of filings is already in `raw_data/tr/daily/`.

### The identity lever we deliberately declined — a decision for the user

Every `Subject` in the daily feed carries `Indent` with `IndentType: EGN` — a salted hash of
the EGN. In the filing above, `Георги Иванов Такучев`'s `NewOwner.Indent` is byte-identical to
his `SoleCapitalOwner.Indent`, i.e. it is a **stable cross-record person key**.

Three places document a deliberate decision never to extract or store it —
`parse_daily_filing.ts:133`, `types.ts:55`, `sqlite_writer.ts:40` — treating the hash exactly
as the EGN. That decision is precisely why every TR join in this repo is by normalized name,
and why name collisions are unresolvable.

I am not proposing to overturn it. The middle path worth a decision: use the hash **transiently
in memory** during the replay as a join key and persist only an opaque per-run cluster id —
never the hash, never anything reversible. The tradeoff, stated plainly: a cluster id derived
from an EGN hash is still pseudonymous personal data, though what it publishes ("these two
registry records are the same legal person") is what the registry itself publishes. Worth
deciding explicitly, because it is the only thing that resolves the next section.

### Why we should not simply copy papagal — this case is the argument

All four papagal companies sit in one Plovdiv cluster: УНИСОН ГРУП (гр. Пловдив), УНИСОН and
УНИСОН БИЛД (с. Белащица), whose current officers are `Емилия Матеева Такучева` and
`Георги Иванов Такучев`. Our subject is the chief architect of **Ивайловград** (Хасково).

It is plausibly one family — the ShareTransfer passes the stake from Иван Георгиев to Георги
Иванов, the Bulgarian patronymic chain, and АЙВИ АРХ is an architecture firm. But plausible is
not identity, and the evidence actively conflicts: papagal has him sole owner of УНИСОН ГРУП
until 13.08.2025, while his own March 2025 declaration lists **no ownership stakes at all**.
Either papagal is merging two people with the same three-part name, or the declaration
under-reports. We cannot currently tell which, and that is the honest answer to "why don't we
show what papagal shows" — papagal asserts a name match, and this repo has a standing rule
against exactly that. `namesake_risk` on person 21952 is 0, which understates the risk here.

A third, independently valuable use of the same conflict: **cross-check declared
`ownershipStakes` against TR**. Where the registry shows a stake the declaration omits, that is
a finding in its own right, not merely a data-quality signal.

---

## Recommended order

1. **T0 — payload + render** (`082_person_api.sql`, `PersonProfileScreen.tsx`). Prerequisite
   for everything; surfaces 1,522 MP roles today.
2. **T1 — `local` cycle dates.** 25,319 roles, deterministic, derived from a ref we already
   store. Best value in the memo.
3. **`ShareTransfers` parser.** Recovers ~39,100 unseen people and 995 public figures who
   currently show no companies at all, entirely from data on disk. Ship it as an exit event,
   not a range.
4. **T2 — Entry/Vacate → `person_role` dates**, labelled as filing dates. 5,596 people. Pair
   with widening the municipal register crawl backwards, which is what would reach this
   subject.
5. **Decision needed — the `Indent` question.** Until it is settled, TR company attribution for
   common three-part names stays name-based, and cases like this one stay unresolvable rather
   than wrong. That is the right failure direction, but it is a choice and should be a
   conscious one.
6. **Declared-stakes vs TR cross-check** — SHIPPED as a REPORT, not a page:
   `npm run person:declared-vs-registry`.

   Deliberately not a badge on `/person`. "Undeclared holding" is an accusation, and the
   registry link is name-based for all but 57 of 186,152 `tr` roles — so the output is a
   review queue for a human, ordered safest-evidence-first, and nothing is published.

   **Compared against ANNUAL filings only.** An annual declaration is a statement about a
   year, so "held during it and absent from it" is a real discrepancy; an Entry or Vacate
   filing is a snapshot at the moment of taking up or leaving a post and never claimed to
   cover the year around it. The first draft compared against those too and produced provable
   false accusations — 6 of 20 rows, two refuted by their own dates (a holding acquired
   2025-12-11 reported against an Entry filed ten months earlier; one erased 2025-01-29
   reported against a Vacate filed five months later). Note 096's
   `COALESCE(fiscal_year, declaration_year)` is correct for *attributing* a declared stake to
   a year and wrong when inverted into "everything held that year belongs on this filing".

   **The headline is the coverage, not the findings: 14 rows over 178 usable person-years,
   with 2,211 skipped.** A person-year is usable only when EVERY declared stake on
   it resolved to an EIK, because an unresolved row could be the very company that would
   otherwise be reported as missing. `declaration_stake.uic` is NULL on all 14,279 rows —
   the declared side carries no EIK at all — so the join runs through
   `declaration_stake_company` (096), which resolves a company NAME only when it is unique in
   the registry and the registry independently places that person there. Widening that
   resolution, not widening the query, is what would make the exercise representative.

   Three further filters, each removing an innocent explanation: the person must have filed a
   stakes table at all; the registry role must be a SHAREHOLDER one (a manager holds nothing
   to declare under чл.37); and the holding must overlap the fiscal year the filing covers.
   Registry records are collapsed per (person, year, company) — without that, a stake
   re-entered after a capital change printed as several separate findings (35 rows → 20).

## Out of scope / dead ends

- **A history variant of the CR Deeds API.** `?showHistory`, `?historical`, `?includeHistory`
  are ignored and `/CR/api/DeedsHistory/{eik}` returns the SPA shell (§0a). Re-crawling the
  other 97% of companies would still return current state only and would not have recovered
  this person.
- **Backfilling the daily feed before 2021-01-01.** The bulk dump caps at 2022-09-02 and the
  per-resource path is per-company. `ShareTransfers` reaches further back in effect — it names
  people whose stakes predate the window — without any additional fetching.
