---
name: sector-dashboard
description: Build or rework the DATA LAYER under a sector surface — the EIK register that defines who the sector is, the multi-corpus money union, the coverage declarations, the competition baselines, the people bridge and the grant→contract spine. Use when the user asks to build or fix a sector view (/culture, /judiciary, /defense, /sector/<key>, an awarder pack), to add a sector to the ?sector= filter, to work out "how much money does sector X get", to reconcile two figures about the same sector, or when a sector's headline number looks wrong. Defers to the dashboard-hub skill for the tile grid, bands, scenes, accents and search. Encodes the defect classes this layer reliably produces — a register that silently under-covers, name regexes that invert their own figure in BOTH directions, a rate compared against a baseline from a different window, an EIK filter pointed at a corpus that keys on names, a figure whose matching nobody wrote down, a register inverted into a claim its source never makes, a corpus that loads locally while production silently keeps the previous vintage because no skill names its :cloud loader, and a committed artifact that is regenerated and committed but never uploaded — chain-green on disk while the bucket serves a 404 or a stale schema. Treats the universe rule, moving an EIK between the four principal lists, changing a headline's basis and excluding a real sector body as design decisions to confirm (presenting the € impact), and otherwise implements via /implement-plan.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - Agent
  - Skill
---

# Sector dashboard skill

A **sector surface** answers "what does the state spend on X, who receives it, and
who is responsible". There are ~20 of them: 14 generic `/sector/<key>` dashboards,
6 bespoke views (`/culture`, `/judiciary`, `/defense`, `/pensions`, water,
`/subsidies`), and **19** browse packs in `SECTOR_BROWSE_PACKS` (18 before this
skill's own culture work added one — re-count, do not quote).

**Related, and overlapping.** `audit-sectors` audits an existing sector surface
against the corpus; this skill builds and fixes the layer. The triggers are close
— both fire on „this sector's number looks wrong" — so: `audit-sectors` to find
out WHETHER a figure is wrong, this one to change the register, matcher, baseline
or filter that produced it.

**`dashboard-hub` owns the layout — tiles, bands, scenes, accents, search, the
prerender/sitemap/og trio. This skill owns the data layer underneath it.** Read
that one for anything you can see; read this one for anything you can count.

**Every figure below was measured on 2026-08-19** against local Postgres
(405,904 rows at `tag='contract'`). Four had drifted within a day of being
written, so re-derive before quoting one.

Sections 1, 2, 5 and 12 gained material the same day from four further ingests
(ЦПРС licences, the ЦАИС dossier, TED, АДФИ) — the branch-ЕИК fold, the
one-fold rule, the three coverage rules and the three unfailable-gate shapes.
Each is here because it shipped or nearly shipped, per §17.

Everything below is a rule **plus the measurement that produced it**. That pairing
is the point: a rule without its number gets argued with, and every number here
came from a defect that shipped or was caught one review before shipping.

---

## 0. Inventory the layer before you extend it

**Start here even when — especially when — the task looks like new work.**

The sector layer is undiscoverable: the EIK registry lives in a `.tsx` under
`screens/components/procurement/`, the `?sector` param is read in two
`screens/dev/*` browsers, and the config tying them together is in
`screens/sector/`. Nothing names the mechanism in one place.

The measured consequence: a careful plan proposed building a `SECTOR_EIKS`
registry and a `?sector=` URL param **that already existed across 18 sectors**,
and mis-counted the browse packs 6-vs-18. Two weeks of designed work, most of it
already shipped.

```bash
# What exists, before you design anything:
grep -n "^  [a-z]*: {" src/screens/components/procurement/sectorPacks.tsx   # the registry
grep -rn 'get("sector")' src/                                              # who READS it
grep -n "browsePackId" src/screens/sector/sectorDashboards.ts              # who EMITS it
ls src/lib/*ReferenceData.ts                                               # per-sector EIK lists
grep -n "members:" src/screens/sector/sectorDashboards.ts                  # a THIRD copy
grep -n "_SECTOR_EIKS" scripts/db/gen_procurement/sector_stats.ts          # a FOURTH, server-side
```

**There are at least FOUR copies of „which EIKs are this sector", not one**: the
browse pack, the dashboard config's `members`, the per-sector reference module,
and the generator's own import list. They are supposed to derive from the
reference module — check that they still do before adding a fifth.

---

## 1. The EIK register — the foundation, and it under-covers silently

A sector is **a set of EIKs**. Every figure is `WHERE eik = ANY(...)`, so the set
IS the definition, and a body missing from it is not merely absent from a total —
it is absent from the roll-up, the roster, the map and the search box **at once**,
with every count still reconciling.

Measured on culture: the register held 23 EIKs and covered **~53% of its own
sector's money** (€146.5m of the €275.7m the corpus sweep found — the „66%" the
original plan carried used a hand-counted €219.7m denominator that the sweep then
retired, which is itself an instance of this section's whole argument). The corpus sweep found **seventeen national art schools in no
list at all** — including the largest buyer in the story that prompted the work,
and the sector's **worst-competing tier** (46.5% single-bid against a 40.9%
national baseline). The hand-written tier table was wrong in five places.

### The rules

**Four declared lists, not three, and never two.** The split that matters is
between _"this is not a body of this kind"_ and _"this is a body of this kind that
answers to somebody else"_:

| list         | means                                       | in the roll-up?                             |
| ------------ | ------------------------------------------- | ------------------------------------------- |
| roll-up      | the sector proper, by budget principal      | yes — this is what every € means            |
| verify       | principal genuinely unsettled               | no; listed so it cannot drift               |
| **adjacent** | a real body of this kind, another principal | no; **shown**, never denied                 |
| excluded     | not a body of this kind at all              | no; kept so a name-match cannot re-admit it |

Collapsing _adjacent_ into _excluded_ is what made €28.6m of art-academy
procurement look considered-and-rejected when it had simply never been decided.
A national museum in an anti-allowlist reads as a denial.

**A gate that sweeps the CORPUS, not the file.** Enumerate candidates from
`contracts` AND `tenders` by name, subtract the declared lists, fail on anything
left above a money floor. Membership checks cannot find what nobody listed.

- Sweep **both corpora**. A contracts-only sweep is blind to a buyer with
  published procedures and no award — measured, that hid two state puppet
  theatres that belong in the roll-up.
- Floor on **money**, not on row count. A procedure count is not a proxy for
  size; thresholding on one turns the gate into an enumeration of every regional
  museum in the country.
- `NULL` ids must fail loudly, not group away silently.

**MEMBERSHIP IS NOT REACHABILITY, and this file has now watched it happen
twice.** The roll-up set is `awarder_eik IN (…)`, but the roster tile, the
institution finder, the awarders list and the procurement screen build their rows
from a NAMED union. Add EIKs to the first and not the second and every total
moves while the bodies stay findable only by someone who already knows the
number.

- 15 art schools went in first as a bare EIK list — every figure correct, all
  fifteen absent from the two surfaces a reader actually clicks.
- Nine ДКИ theatres repeated it eight months later: **+€7,485,705, +4.7%**, and
  nine bodies reachable by no link on the site. The gate written after the first
  incident is what caught the second.

Give every roll-up entry a NAME at the moment you add it, and make the gate's
`rendered` union the same union the surfaces build from.

**A REGISTER'S AUTHORITY IS ASYMMETRIC — decisive against silence, merely
suggestive against evidence.** When the ministry publishes a body on its own
roster and nothing in the repo contradicts it, that settles principal: 18 of 19
disagreements moved on exactly that basis. When a SECOND source makes its own
claim, the roster stops being decisive — Театър „Българска армия" is listed by
МК _and_ sits in `MO_ENTITIES` under an EIK in the `1290…` block every Ministry
of Defence body occupies, so it stays `adjacent`. Do not let a single primary
source overturn a competing one just because it is the source you happen to have
ingested.

**The universe rule must be decided before the register is written**, because it
decides the headline: _principal = X_ and _everything a reader would call X_ are
different pages with different numbers, and both are defensible. Decide, write it
in the file's header, and let the gate enforce it.

---

## 2. Name matching — it fails in TWO directions and only one is visible

**This is the most expensive section here. Read it twice.**

Where a corpus has no EIK dimension you must match on names. Both failure modes
are live, and they are not symmetric.

### Too WIDE — a stem that sits INSIDE an unrelated word

Usually an INFIX, not a prefix — ко**опера**ция, аква**култури**,
P**art**nership — which is why anchoring has to be two-sided.

Bulgarian (and English) culture words sit inside other, unrelated words:

| stem          | also matches                                          | measured cost                                                                                             |
| ------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `опера`       | опер**атор**, опер**ация**, ко**опера**ция            | **€189,443,288** from ONE row: the national electricity grid operator, published as "EU money to culture" |
| `култур`      | аква**култури**, агро**култури**, фуражни **култури** | €6.6m on the ДФЗ corpus — real, and **not** the big one; see below                                        |
| `изкуств`     | **изкуствен** интелект                                | €4,868,890, one digital-innovation hub                                                                    |
| `art` (EN)    | P**art**nership, P**art**icipation, Sm**art**         | 121 of 361 operations, 24% of the money                                                                   |
| `cultur` (EN) | agri**cultur**e, aqua**cultur**e, viti**cultur**e     | 21 operations, 7.6% of the arm                                                                            |

A too-wide figure is **inflated**, and a base rate that looks absurd eventually
catches it. The headline it produced was 3.2x the sector's procurement; guarded,
it is the same size.

⚠️ **Attribute the damage to the RIGHT stem — the memorable culprit is usually not
the expensive one.** The famous ДФЗ figure, €166.3m against a true €18.3m, is
always told as the crops story („полски **култури**"). Decomposed, it is not:

| family                                                      | € on `agri_subsidies` |
| ----------------------------------------------------------- | --------------------- |
| `опера` → ко**операция** (and оператор / оператив / операц) | **€140,666,322**      |
| `култур` → аква / агро / фуражни / полски култури           | €6,572,273            |

The crop exclusion everyone remembers is worth 4% of the collapse; **`кооперат`
is worth 95%**. Ship the memorable guard, skip the other, and you have fixed
almost nothing while believing the case is closed — which is exactly why an
exclusion list is tested by its EFFECT (rule 4 below) and never by looking
complete.

### The ID looks canonical and is not — a 13-digit ЕИК is a BRANCH

A Bulgarian ЕИК is 9 digits; a 13-digit one is that parent plus a 4-digit branch
suffix. Registers disagree about which they publish, and the mismatch produces a
finding rather than a blank.

Measured on the TED cross-check: TED files ЕСО's regional districts under branch
numbers (`1752013040134` = `175201304` + `0134`) while the contracts corpus
awards them all under the parent. Reconciling raw reported **318 buyers "missing
from the national corpus" for 2024, of which 252 were branches whose parent
awards 920 contracts that year** — 252 false claims that a named public body's
procurement is absent from the register. With the fold: 66.

`left(eik, 9)` when `eik ~ '^[0-9]{13}$'`, and put it in ONE function both the
loader and the gate call. Note the direction of the damage: this defect does not
suppress a figure, it _manufactures_ the exact finding the dataset exists to
surface, which is the shape nobody looks for.

### One fold, one definition — a second copy diverges immediately

Write the name fold once and import it. Not "document it in two places" — one
exported function.

Measured: the АДФИ loader folded names in TypeScript and its gate reimplemented
the same fold as a `regexp_replace` chain in SQL. They disagreed on their first
run — the SQL copy stripped neither the `, гр. Варна` tail nor the dash in
`Топлофикация - София`, so the gate flagged **nine correct matches as false
accusations** against named public bodies. A gate that cannot reproduce the
decision it is checking is not checking that decision; it is checking a second
implementation nobody uses. This is `councilNameKey()` in CLAUDE.md, one dataset
over, and it will keep recurring because the SQL copy always looks like the
cheaper option.

### Too NARROW — a fugitive vowel, and NOTHING catches it

Bulgarian nouns drop a vowel between the singular and the plural/adjective:
театър→театри, ансамбъл→ансамбли, кинотеатър→кинотеатри. **A stem taken from the
adjective cannot match the singular** — which is how every institution writes its
own name.

Measured: `театр` missed **24 theatres and €14,641,941** — including Народен
театър „Иван Вазов", a member of the repo's own curated register — while still
matching nine adjectival rows, so no count reached zero, no base rate looked odd,
and every test stayed green. **The deflated number is the one that reads as
careful.**

### The rules

1. **Publish the matcher.** One exported module, imported by every consumer, with
   a test pinning each figure. A number whose matching exists only in someone's
   shell history is not reproducible, and the largest figure in a plan was exactly
   that.
2. **For each stem run BOTH checks** — what else does it match, and does it
   survive the singular. Write the stem short enough to survive the vowel
   (`теат`, `ансамб`), then check what it catches.
3. **Anchor what cannot be shortened** (`\yопера\y`, `\yart\y`). Use `(?![0-9])`
   or an explicit form rather than `\y` where a suffix may follow with no
   separator.
4. **Every exclusion list ships with a test that it CHANGES the number.** A guard
   that does not move the figure it guards is a guard someone deletes.
5. **The only thing that catches a false negative is AGREEMENT with an
   independent register.** Require every curated member with a row in the matched
   corpus to be admitted by the matcher. No count-based or base-rate assertion
   substitutes: both defects above leave every count plausible.
6. **Normalise, do not reject, a canonical-form variant.** Where the source is
   hand-typed against a fixed-width register (`-30` for `-0030`), pad. Measured:
   the strict form dropped 5 real edges, the unbounded form stored them as
   distinct entities, padding recovered all 5. And assert the register really is
   uniform — padding is a canonicalisation only while it is.

---

## 3. Every headline needs its baseline — ON THE SAME WINDOW

A sector rate alone asserts something false. Culture's single-bid rate is 42.0%
against a national 40.9% — **typical**, and shown alone it reads as an indictment.

**And the baseline must come from the same window as the figure.** This is the
one that survived a review and shipped: the sector rate was scoped by the page's
scope control, the baseline came from a whole-corpus blob.

| window             | sector | true national | the page said                               |
| ------------------ | ------ | ------------- | ------------------------------------------- |
| default parliament | 55.3%  | 47.7%         | "at 40.9% nationally" — +14.4 pts, not +7.6 |
| 2023+              | 42.0%  | 44.4%         | sector WORSE — it is BETTER                 |

The sign inverts. Use `national_competition(from, to)` (167) or its equivalent;
return numerator and denominator **un-divided** so both sides are derived the same
way. A mismatched baseline reads as rigour.

---

## 4. One question, several corpora, several bases

A sector's money arrives on incompatible bases. Culture: seven streams, five
bases, €11.0m to €269.1m.

- **Follow migration 127's four-arm union** (`contracts ∪ agri_subsidies ∪
fund_beneficiaries ∪ interreg_partners`) — it is the canonical spec with a data
  test pinning it.
- **Put the basis in the label, never a footnote.** `eikExactEur` and `byNameEur`
  are 56% apart and both true; a field called `fundsEur` invites a consumer to
  pick a denominator by accident.
- **Never sum across bases** — and note that a magnitude-SORTED list is itself a
  claim. A per-year budget line ranked against cumulative corpora says "EU money
  is 1.8× the national budget" when over the same window it is roughly the
  inverse. Order by source, or normalise, or drop the ranking.
- **Edges are not entities.** 949 tender links over 947 procedures; naming an edge
  count `linkedTenders` is the same basis ambiguity one layer down.

---

## 5. Coverage is a first-class field

An EIK-keyed filter over a corpus that keys on names answers a fraction of the
question **at a 200**.

- Only **18%** of Bulgarian partner rows on culture-themed Interreg operations
  carry an EIK.
- `tender_search_text` backs a live search at **0.78%** corpus coverage.
- The grant→contract spine covers the **RRF slice only**; ЕФРР and ЕСФ contracts
  carry no code, so a spine without its coverage tells every non-RRF reader their
  project bought nothing.

**Return coverage from the query and render it beside the figure** — the pattern
is `/api/db/tender-search-coverage`.

### The corollary that costs the most: reach is PER CORPUS

A single "is this sector also a recipient?" flag is not enough. Culture is
genuinely both, and of three recipient corpora its 45 EIKs reach exactly one:

| corpus              | ∩ register       | the sector's real money there            |
| ------------------- | ---------------- | ---------------------------------------- |
| `fund_projects`     | 40 rows / €94.1m | answerable by EIK ✅                     |
| `agri_subsidies`    | **0 rows**       | €18.3m — to читалища, a NAME population  |
| `interreg_partners` | **0 rows**       | ~€11m — partner rows mostly carry no EIK |

An empty result is not "nothing here", it is **"not answerable this way"**, and
the two must not look alike. Declare reachable corpora per corpus, and gate it in
BOTH directions: a declared corpus matching nothing is the empty-page defect; an
undeclared corpus matching plenty is a filter withholding an answer it could give.

---

### „Never asked" is a THIRD answer, and it must not be a NULL column

A form field the source does not carry is not a `false`. Model it as the
**absence of a row**, not a nullable column, or every consumer reading that
column renders the missing question as an answer.

Measured on the ЗОП subcontractor declarations: 53,854 of 212,961 notices carry
the question at all. Storing the other 159,107 as `has_subcontractors = NULL`
would have let any surface state, about a named contract, that the winner
performed it alone when nobody said so.

⚠️ The model leaks at the SERVING boundary, and that is the half that gets
missed: an **ungrouped aggregate returns one row over an empty set**, so
`tender_subcontracting_for('unknown-unp')` came back with `has_subcontractors =
NULL` — reintroducing the exact confusion the table avoids. `GROUP BY` so an
unknown key returns _no rows_, and assert that in a gate.

### A coverage FLOOR travels with the rows, not in a header comment

When a source starts partway through history, „no record found" and „never
happened" are different claims and only the data can tell them apart. Return the
floor from the same function that returns the rows.

Measured: АДФИ publishes inspection subjects only from 2024-02-09 (earlier ones
are bare PDFs with no subject column), so `adfi_for_buyer()` returns
`covered_from` beside every row — otherwise an empty result reads as „never
inspected" rather than „none since February 2024", about a named public body.

### An external index's RAMP is not a trend

An API's coverage deepening looks exactly like the underlying activity growing.
Measured on TED: 0 Bulgarian notices for 2015, 4,687 for 2016, ~17,000 for 2019.
Plotted raw that is procurement quadrupling; it is the index backfilling.

Two rules follow. **Drop the empty years rather than storing zeros** — a stored
`2015: 0` plots as „this country published nothing above the EU threshold that
year", which is the precise false finding a completeness dataset exists to
prevent. And **store the per-year counts** so the ramp stays visible, then make
any cross-corpus comparison take an explicit window: an all-time reconciliation
silently mixes years the API barely indexed with years it fully did, and the
resulting „missing" figure is dominated by the API's own history.

## 6. Two questions that look like one

"Culture bodies doing Interreg" (€11.0m / 67 bodies) versus "Interreg culture
money reaching Bulgaria" (€48.8m / 168 partners): ~4.4× apart, different join,
barely-overlapping populations — the second is mostly общини and NGOs.

A **thematic** arm joins through the operation; an **institutional** arm through
the beneficiary set. A surface picks one and labels it.

---

## 7. The people layer

Every sector has directors who file declarations and officers who run its
tenders, and none of them are linked to their institution, because
`declaration.institution` is a **group label**: "Културни институти и институции"
covers every culture filing; "Процедури по ЗОП" covers 3,129 and describes none
of them.

`declaration.filed_institution` — the filing's own `<Personal><Work>` — is the
declarant's actual employer: 61,741 of 61,743 filings, 21,398 distinct spellings.
Resolve it to an EIK and 29.0% of filings, and 41.5% of procurement-officer
filings, land on a buyer.

**A name match is not an identity**, so:

- **Refuse an ambiguous fold; never grade it.** And refuse against every
  independent register, not just the one you are joining to: „средно училище
  „Бачо Киро"" names exactly ONE buyer and TWO REAL SCHOOLS, so a buyer-side
  check alone attributed declarants on a coin flip.
- **Group by person id, not by name.** The register spells one filer's name more
  than one way — a typo made one director render as two named public officials,
  one of whom does not exist.
- **Filter on the declarant's own position, not the register's category.**
  Filtering on `category` hid four institutes' directors and showed ZERO for the
  entire art-school tier, because those filings are categorised `school`.
- **Keep unresolved filers visible.** A missing profile means "no page to link
  to", never "not a real person"; dropping them narrows a register of named
  public officials to whoever your resolver reached, and looks tidier for it.
- Say precisely what the surface claims: _this person declared they work here_ —
  not that they signed anything, nor that they still hold the post.

---

## 8. The money spine generalises

`fund_projects.contract_number` IS the ПИИ code, and the same code is written into
`tenders.subject` and `contracts.title` — so grant → institution → procedure →
contract → contractor is already joinable. 262 of 264 codes match (99.2%).

Build it once as a shared object, not a per-sector chart.

⚠️ **This is the one section here that is a CAPABILITY rather than a defect.**
Nothing shipped wrong to produce it, and the table has no consumer yet. By §17's
own standard that makes it advice; it is kept on one condition — the 99.2% join
rate is measured, so „this is possible" is checkable rather than hopeful. If it
still has no consumer at the next retrofit, cut it.

---

## 9. Sector risk needs a peer group

`nearCeilingAward` looks damning at €0.29 under a €454,611.59 ceiling and turns
out to be **common** for small buyers — six of eight procedures sat at 98.8–100%.

Score against a sector/size peer group, publish the base rate beside the flag, and
word every signal „за проверка". Note `contract_risk_cache`'s bit order is a
contract: **append only, never renumber**, or historic masks silently re-map.

---

## 10. Not every surface can take the filter

`?sector` is a predicate on the **buyer**. `contractor_rank` (122) aggregates
**contractors** and has no buyer dimension, so `/procurement/contractors?sector=`
has nothing to filter on — and adding a dimension re-opens that resource's
existing rollup-bucket double-count.

**Before a hub links a filtered destination, confirm the destination's base
relation carries the filtered dimension.** A precomputed leaderboard usually does
not, and the failure is a tile whose link silently ignores its own filter — the
reader trusts the number, clicks, and finds a different world.

Where the answer genuinely does not exist, **re-point rather than fake it**, and
record the refusal where someone would otherwise undo it (a `⛔` block in the
hook's header plus a test that fails if the param reappears — comment-stripped
first, or the gate trips on its own documentation).

---

## 11. Deployment

Every sector table needs a `db:load:*:pg:cloud`, a watcher, a `recent_updates`
row and a Data Map entry (`reference_migrated_family_watch_reload`).

- **A FUNCTION carrying no data has no natural applier**, and no route that lacks
  a `missingMigration` degrade survives without one. Two migrations shipped with
  no applier anywhere in this run; each would have been a permanent 500 on Cloud
  SQL while every local test passed. Give each one an owning loader — the one that
  owns the table it reads.
- **`SET check_function_bodies = false`** in any migration whose `LANGUAGE sql`
  body reads a table that may not exist. `exec()` sends a file as ONE transaction,
  so a 42P01 at CREATE time rolls the whole file back and the target ends with
  **no table at all**.
- **A generator's chain slot must follow its LAST input**, not sit beside its
  siblings. Declare inputs machine-readably and do not declare one you do not
  read — a false input makes the preflight refuse a database that would have
  produced a good artifact.
- **A committed artifact needs a gate that re-derives it**, or it serves the
  previous vintage at a 200 forever. `hub_stats.json` and `sector_stats.json`
  drifted that way for two months. ⚠️ That is only the BUILD half — see the
  subsection below, which is the half that shipped a 404.
- **`vacuumAfterReload()` after any bulk rewrite**, and list the table in
  `RELOADED` — `test:data` is `db:refresh`'s last link, so an unlisted table
  fails every full refresh at the end.

### A committed artifact has TWO halves, and the second one is not a `:cloud` loader

**A sector's headline number lives in a committed artifact, not in a table.**
`data/procurement/derived/sector_stats.json` — one entry per sector, written by
`db:gen-sector-stats` — is what `/governance/sectors` renders, and it is a static
blob fetched from GCS. So the reload path above does NOT cover it: there is no
`:cloud` loader to name, because production reads a bucket object, not Cloud SQL.

The registry is `REFRESH_GENERATORS` in `scripts/db/refresh_coverage.ts`. Adding a
sector means the artifact must be **regenerated** (`npm run db:gen-sector-stats`,
or a full `db:refresh`) **and published**:

```bash
npm run bucket:sync:paths -- procurement/derived/sector_stats.json
npm run db:check-generated     # byte-compares all four against the live bucket
```

⚠️ **THE PUBLISH TRIGGER IS NOT THE OWNING SKILL'S TRIGGER, and that is what makes
this class invisible.** Until 2026-08-21 the registry asserted only that each
artifact was chain-built, git-tracked and referenced by its generator — all
properties of the file on DISK. Every gate was green for
`culture/derived/hub_stats.json` from the day it shipped while the bucket object
returned **404 for two days**: committed, generator in the chain, and nothing had
ever uploaded it. `/culture` rendered its tiles without numbers at a **200**,
because the hook degrades a 404 to „no figure" on purpose.

The mechanism generalises to any sector artifact. `db:gen-culture-hub-stats` reads
contracts, tenders, fund_projects, agri_subsidies, person_role and
interreg_partners — so it moves when **`db:refresh`** runs, i.e. under
`update-procurement` — while the skill that owns `data/culture/` and names its sync
is woken only by nfc/ncf/dki watcher flips. **The skill holding the PATH is never
woken by the thing that changes the CONTENT**, so no per-skill instruction can close
it; only an unconditional check keyed on the registry can. `process-watch-report`
step 8 runs `db:check-generated` for exactly this reason.

The sibling found the same day is the shape to fear more, because it is not an
absence: `governance/declarations_hub_stats.json` was **4 days stale across a SCHEMA
change** (`companies`/`companyMps` → `organisations`/`organisationPeople`), so the
deployed bundle was reading keys the served blob did not carry. A missing blob is at
least uniform; a stale one renders confidently and only some tiles go blank.

Three rules for a NEW generated artifact:

1. **Register it in `REFRESH_GENERATORS` with a `bucketPath`.** Two gates enforce
   it: the path must COVER the artifact, and `bucket_sync_paths.isExcluded` must not
   refuse it.
2. **Check that second gate before choosing a home.** `funds/`, `opencalls/`,
   `council/`, `budget/municipal_fiscal/` and all of `procurement/` bar a four-file
   allowlist plus `procurement/projects/` are REFUSED by the scoped sync — a
   generator writing into one of them is unpublishable by that route, and the sync
   prints „✗ refusing" into a log nobody reads.
   `procurement/derived/sector_stats.json` is on that allowlist; a fifth procurement
   artifact would have to be added to it in **both** `bucket_sync_paths.ts` and the
   `-x` regex in `package.json`, which are kept in lockstep by hand.
3. **Do not restate the publish path in an `update-*` skill.** That is where this
   knowledge lived when it failed. A full `npm run bucket:sync` would also have
   caught all four (neither `culture/` nor `governance/` is excluded from it) — but
   nobody runs the ~30-minute full-tree sync day to day, and the scoped
   `bucket:sync:paths` argument list is assembled per skill. That assembly is the
   gap.

### The reload path is part of the dataset, not paperwork after it

A `:cloud` loader is the ONLY way a corpus reaches production, and nothing runs
one automatically. So a dataset is not finished when it loads locally — it is
finished when someone downstream is _told to reload it_. Three things, and the
third is the one that gets skipped:

1. a **watcher** in `scripts/watch/sources/` (+ registered in `SOURCES`);
2. a **`process-watch-report` mapping row** naming the owning `update-*` skill;
3. **the `:cloud` command written INSIDE that row.**

Measured on the session that produced this section: five new datasets shipped
with working watchers, registered, fingerprinting correctly — and **not one of
their `:cloud` loaders was named in any skill**. The failure that buys is
specific and silent: the watcher fires, an operator re-ingests locally, commits,
and production keeps the previous vintage **at a 200 with every row count
reconciling**. Nothing is red. It is the same class as a stale matview, one layer
further out.

`scripts/db/cloud_loader_coverage.test.ts` is the gate, and it found the problem
is not confined to new work — **23 of 75 `:cloud` scripts had no owning skill**,
22 of them pre-existing. Those are parked as `kind: 'unreviewed'` with the count
capped, so the gate stays non-vacuous for new loaders while the backlog stays
visible instead of being blanket-passed.

⚠️ **Registering a watcher is not the same as wiring it, and the `SOURCES` array
will lie to you about it.** A `WatchSource` imported into the wrong block of
`sources/index.ts` — inside an `export … from` rather than beside the plain
imports — type-checks, appears in the file, and is absent at runtime. Only
`tsc -b --force` surfaced it. Assert membership by _running_ the array, not by
grepping the file.

⚠️ **A watcher must throw on a refusal, never report zero.** Both WAF shapes on
2020.eufunds.bg (the „Please enable JavaScript" challenge and the 245-byte
„Request Rejected") are served as **HTTP 200**, so `res.ok` is blind to them. A
fingerprint that folds a refusal into „0 rows" reports the collapse of the source
as news — on a clean-delivery register that reads as _every project losing its
clean status_.

---

## 12. The page layer — sitemap, prerendered HTML, and actually look at it

A sector's work is not done when the data is right. Four things sit between a
correct corpus and a page anyone can find, and each fails quietly.

- **Every sector page needs a prerender entry** (`scripts/prerender/routes.ts`).
  Without one the URL serves the SPA shell — i.e. the HOMEPAGE's `<title>`,
  description and canonical — so to a crawler every page of the sector is a
  duplicate of the homepage. Nothing errors; the page looks perfect to a human.
- **Every sector page needs a sitemap entry** (`scripts/sitemap/route_defs.ts`),
  in BOTH languages, and every `<loc>` needs a real `dist/<path>/index.html`
  behind it. `scripts/sitemap/families.data.test.ts` is the gate, and it only
  sees a `dist/` that exists — run it AFTER `npm run build`, not before.
- **A per-record sub-family is a DECISION, not an oversight.** 944 film records
  of one card each are the thin-content shape: no `<loc>` and no prerender is the
  right call, the same one `/council/resolution/**` made. But that call is only
  half-made until the family gets a real head from `functions/spa_page.js` —
  otherwise it is not "excluded from the index", it is "serving the homepage's
  title and canonical on 944 URLs". Decide, then write the decision down.
- **Open every page and look at it, in both languages.** Then compare what the
  RUNTIME renders against what the PRERENDER declares — `document.title` and the
  `<h1>`, per page.

That last check is not padding. Measured on `/culture`: when the film body moved
from `/culture` to `/culture/subsidies`, the prerender entry was repointed and the
screen's own `<Title>` was not — so the prerendered head correctly said „Филмови
субсидии" while the page a reader actually saw was headed „Култура", identical to
the hub one level up. Two different answers for one URL, with the wrong one on the
side a human sees. Every test passed, the body was completely correct, and no gate
in this file would have caught it: it is only visible by opening the page.

**A moved path is the trigger.** When a body changes URL, three things must move
together — the route, the prerender entry, and the screen's own title/`<h1>`. The
first two are in the diff; the third is in a file nobody re-reads.

---

## 13. Gates to write

- Every buyer above a money floor is in exactly one declared list — swept from
  BOTH corpora.
- Every exclusion list **changes** the number it guards.
- Every curated register member present in a matched corpus is **admitted** by the
  matcher (the only false-negative catch).
- A tolerance band is **narrower** than the smallest guard effect it sits over, and
  a test asserts that relationship — otherwise the figure test goes blind to the
  guard's removal.
- Every figure recomputed from its declared basis, with **rejected** bases asserted
  as `notEqual`.
- Every `?sector` a tile emits is read by its destination; every fragment it emits
  exists there.
- Coverage is returned and rendered; reach is declared per corpus and gated both
  ways.
- Every stored identifier is **canonical** (check width, not just shape).
- Every committed artifact the sector's figures come from is **on the bucket and
  byte-identical to local** — `npm run db:check-generated`. „Regenerated and
  committed" is not „published"; `culture/derived/hub_stats.json` was both and
  served 404 for two days (§11).
- **Then break each gate's clauses and watch them fire.** Two gates in this run
  passed against a defect they were written to catch: one checked shape where
  width was the issue, one asserted a tautology.

**Three shapes that CANNOT FAIL, all found in committed gates, all of which read
as thorough:**

1. **`LIMIT n` with a length assertion above `n`.** `SELECT … LIMIT 5` then
   `assert(rows.length < 100)` is true at every corpus size. Count without a
   limit and assert a SHARE.
2. **A denominator that is the thing under test.** A coverage gate divided stored
   rows by the loader's own `WHERE` predicate, so numerator and denominator moved
   together and the ratio stayed ~1.0 whatever happened — a label change in the
   upstream form would have left it green while every new record went unseen,
   which is verbatim what its failure message claimed to detect. Pick a
   denominator the change cannot touch (there, the word ROOT: 77,914 mentions
   against 53,858 carrying the labelled field).
3. **`if (!example) return` when the corpus has no example.** A fold gate sampled
   one mixed case and returned silently if none existed — so „the case never
   occurs" and „the fold is correct" were indistinguishable. Assert the example
   EXISTS, then assert the behaviour.

Say it as a rule: **a gate must be able to fail on today's data if you break the
code, and you must have watched it do so.**

---

## 14. Retrofit checklist

Run against an existing sector surface, in order:

1. **Inventory** (§0) — where is this sector's EIK set, who reads `?sector`?
2. **Register** (§1) — how many lists? Sweep the corpus; what is unclassified
   above the floor?
3. **Matchers** (§2) — is any figure produced by a regex nobody wrote down? Run
   both checks on every stem.
4. **Baselines** (§3) — is any rate shown without one, or against a different
   window?
5. **Bases** (§4) — do any two figures on the page sit on different bases without
   saying so? Is a magnitude sort claiming something?
6. **Coverage** (§5) — is any EIK-keyed figure over a name-keyed corpus?
7. **Destinations** (§10) — does every filtered link's destination carry that
   dimension?
8. **Deploy** (§11) — does every function have an applier?
9. **Pages** (§12) — is every page prerendered AND in the sitemap, in both
   languages? Open each one and check its rendered title and `<h1>` against what
   the prerender declares.
10. **Reload path** (§11) — does every `:cloud` loader appear in a
    `process-watch-report` mapping row, and does its watcher exist AND resolve in
    `SOURCES` at runtime? Run `cloud_loader_coverage.test.ts`.
11. **Publish path** (§11) — the half a `:cloud` loader does NOT cover. Is every
    committed artifact this sector's figures come from registered in
    `REFRESH_GENERATORS` with a `bucketPath`, and does the bucket currently serve
    the same bytes? Run `npm run db:check-generated`. Do this even when the sector
    has no artifact of its own: adding a sector moves
    `procurement/derived/sector_stats.json`, which is one.
12. **Source shape** (§16) — is any figure derived by INVERTING a register that
    publishes only one side? Is a suspected export cap actually a cap, per the
    source's own total?

The first three retrofits are the test of whether this skill is any good:
`/judiciary`, `/defense`, `/sector/energy`. **If running the checklist on those
three produces no findings, this is a description rather than a tool and should be
cut back to the parts that did.**

Then take the findings to §15 and implement them through `/implement-plan` —
stopping only on the four decisions listed there.

---

## 15. Implementing — hand the work to `/implement-plan`

This skill decides WHAT the data layer should be. It does not hand-build it step
by step: once the shape is settled, the register edits, the matcher, the loaders,
the migrations and the gates go through **`/implement-plan`**, which drives each
one implement → `/code-review` in a subagent → `/code-repair` → path-scoped
commit. Same contract as `audit-sectors`.

**One step per unit of work, and the gates are their own step** — not an
afterthought appended to the last one. A workable decomposition for a new or
retrofitted sector:

1. the matching definitions (§2), published once and imported everywhere;
2. the EIK register and its corpus-sweep gate (§1);
3. the browse pack / `?sector` wiring and destination reachability (§10);
4. each corpus arm with its coverage declaration (§4, §5);
5. the baselines (§3);
6. the loaders, migrations and `:cloud` commands (§11);
7. the page layer (§12) — prerender entry, sitemap entry, and a look at every
   page in both languages;
8. the reload path (§11) — watcher, `process-watch-report` row, and the `:cloud`
   command written inside it;
9. the gates (§13) — always last, always separate.

### STOP and ask — the decisions this skill must not make for you

These change what every € on the page MEANS, so they are the user's call even
when the evidence looks one-sided:

- **The universe rule** (§1) — `principal = X` versus „everything a reader would
  call X". Two defensible pages with different numbers.
- **Moving an EIK between the four lists.** Measured: nine theatres moving from
  `verify` into the roll-up took the culture headline **€157,944,723 →
  €165,430,429 (+4.7%)**. Present the € impact WITH the ruling — the decision is
  not answerable without it.
- **Changing a headline's basis**, or which corpus a figure is drawn from.
- **Excluding a body that genuinely belongs to the sector**, for any reason.

### Otherwise, proceed

Everything else is a bug fix and goes straight through `/implement-plan` without
asking: a stem that over- or under-matches, an unfolded branch ЕИК, a fold
written twice, a missing coverage declaration, a NULL rendered as an answer, a
rate without its baseline, a roll-up entry with no name, a gate that cannot fail,
a page missing its prerender or sitemap entry, a screen whose title no longer
matches the URL it moved to, a `:cloud` loader no skill names, a watcher that
reports zero where it should throw.
None of those is a judgement call — they are wrong, and the measurement in the
matching section of this file is the argument.

⚠️ **Regenerate and commit the derived artifact alongside the code that produced
it.** `hub_stats.json` / `sector_stats.json` are committed and PG-derived, so a
register change that lands without them leaves the page serving the previous
vintage at a 200 with every row count reconciling.

---

## 16. What the source IS — four ways a register is not what it looks like

Every one of these cost real work in one session, and each would have shipped a
number that was wrong in a direction nobody could walk back.

### The state publishes the ACHIEVEMENT list, not the complement

ИСУН publishes „Проекти без наложени финансови корекции" — projects that ended
with **no** correction. The tempting move is subtraction: everything else must be
the corrected ones. It is not. A project can be absent because it finished LATE,
was terminated, or is still in final verification, and the individual
irregularity records go to OLAF's IMS, which is **confidential** — the complement
is not published anywhere, by design.

Measured: subtracting that list from `fund_projects` would have asserted a
financial correction against **41,126** completed projects, including 87% of
ОПИК's. Not a wrong statistic — an accusation against thousands of named
companies, in the one direction that cannot be corrected later.

The rule that generalises: **before inverting any register, ask whether the
source publishes the other half at all.** If it does not, the inversion is your
inference, not its data. Model it so the inversion is unreachable rather than
merely discouraged — the coverage row's caveat column is `NOT NULL`, the serving
function returns that sentence beside every figure, and the tile refuses to draw
a zero (see §12).

### „Looks like an export cap" is not a cap — read the source's own total

Two reports on the same register returned 9,940 and 41,530. The first sat in a
9,949-row sheet: a ~10,000 ceiling, obviously, the same shape BULSTAT's 999 and
ЦПРС's cartesian product both have. The correct response looked like partitioning
the export per programme.

It was not a cap. Each listing prints its own pager — „Страница (1/398)" and
„(1/1359)" — and 398 × 25 = 9,950 against 9,940 exported, 1359 × 25 = 33,975
against 33,954. **Both exports were complete**, and the 4× gap is real: the two
reports count different populations. Partitioning would have meant `ProgrammeId`
round-trips against a WAF that blocks its own autocomplete endpoint, to fix
nothing.

**Find the source's own count — a pager, an „Общо: N", a result header — before
you design around a ceiling.** Two figures disagreeing is evidence about the
figures, not automatically about truncation.

### A register can be DEAD, and „current" must then be derived, never stored

The АОП external-experts register: **88 experts, 0 still valid**, newest expiry
2023-01-01, nobody added since 2020-01-01. It cannot answer „who is available
now" — only „who was approved between 2017 and 2023". Ingest it, but every
surface must be past-tense, and the coverage row carries the window so no page
re-derives it.

Store no `is_current` flag: it is only true until the clock passes it. Derive it
at query time in a view — the rule `open_calls` already follows. Postgres
enforces this by accident and usefully: `CURRENT_DATE` is not immutable, so a
`GENERATED` column is refused outright.

⚠️ **The expected state of such a source is „unchanged, forever", which makes its
watcher unusual**: it is not watching for an update, it is watching for the
register to REOPEN — which would invalidate the historical framing in the
migration, the gate and the docs at once. Say so in the mapping row, or the next
operator will treat a fire as routine.

### A fingerprint at a FINER grain than your fold is a free grain check

The АОП watcher hashes `(id, valid_from, valid_until)` and reported **92**; the
ingest's fold, keyed on id alone, wrote **88**. The gap was the finding:
validity belongs to `(expert, competence area)`, not to the expert — 4 of 88 were
admitted to a second area later and carry a different window there. A scalar pair
on the parent stores one of two true answers, chosen by whichever area the crawl
visited first.

No test caught it. No row count could: 88 is the right number of experts. It
surfaced only because two independent counts of the same corpus disagreed. **Key
the watcher on the fields you believe are functionally dependent on the id** —
when they are not, it tells you for free.

### Related: two smaller ones from the same work

- **A source that publishes fewer name parts than your identity layer demands
  REFUSAL, not scoring.** АОП prints given + family; `person` holds three. 58 of
  88 matched a person, only **25** matched exactly one. The other 33 are refused
  and reported, never graded — the same rule §2 states for name matching, and it
  binds hardest when the source is the weaker side.
- **`Response.text()` decodes UTF-8 ALWAYS**, per the fetch spec, regardless of
  the `Content-Type` charset. A windows-1251 register (АОП's `ets.php`; the ЦПРС
  family is the same vintage) therefore does not throw — it yields a corpus of
  mojibake names that passes every row count. `fetchText` takes an `encoding` for
  exactly this.

---

## 17. Keeping it current

Add a section only when something **shipped wrong** and you can state the
measurement. A rule without its number is advice, and this file is not for advice.

**Open:** whether the 14 generic `/sector/<key>` dashboards should converge on the
hub pattern or stay a lighter shape. Decide from the retrofits, not in advance.

**Update it in the same session that taught you something.** This file went one
full working session without an update while four ingests were producing exactly
the defect classes it exists to hold — the branch-ЕИК fold that manufactured 252
false „missing from the corpus" claims, and a name fold written twice that
flagged nine correct matches as false accusations. Neither would have been here
if the question had not been asked. The cost of the delay is not the writing; it
is that the next reader hits the same defect with the file looking complete.
