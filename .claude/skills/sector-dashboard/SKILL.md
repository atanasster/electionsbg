---
name: sector-dashboard
description: Build or rework the DATA LAYER under a sector surface — the EIK register that defines who the sector is, the multi-corpus money union, the coverage declarations, the competition baselines, the people bridge and the grant→contract spine. Use when the user asks to build or fix a sector view (/culture, /judiciary, /defense, /sector/<key>, an awarder pack), to add a sector to the ?sector= filter, to work out "how much money does sector X get", to reconcile two figures about the same sector, or when a sector's headline number looks wrong. Defers to the dashboard-hub skill for the tile grid, bands, scenes, accents and search. Encodes the defect classes this layer reliably produces — a register that silently under-covers, name regexes that invert their own figure in BOTH directions, a rate compared against a baseline from a different window, an EIK filter pointed at a corpus that keys on names, and a figure whose matching nobody wrote down.
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
Nothing shipped wrong to produce it, and the table has no consumer yet. By §14's
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
  drifted that way for two months.
- **`vacuumAfterReload()` after any bulk rewrite**, and list the table in
  `RELOADED` — `test:data` is `db:refresh`'s last link, so an unlisted table
  fails every full refresh at the end.

---

## 12. Gates to write

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
- **Then break each gate's clauses and watch them fire.** Two gates in this run
  passed against a defect they were written to catch: one checked shape where
  width was the issue, one asserted a tautology.

---

## 13. Retrofit checklist

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

The first three retrofits are the test of whether this skill is any good:
`/judiciary`, `/defense`, `/sector/energy`. **If running the checklist on those
three produces no findings, this is a description rather than a tool and should be
cut back to the parts that did.**

---

## 14. Keeping it current

Add a section only when something **shipped wrong** and you can state the
measurement. A rule without its number is advice, and this file is not for advice.

**Open:** whether the 14 generic `/sector/<key>` dashboards should converge on the
hub pattern or stay a lighter shape. Decide from the retrofits, not in advance.
