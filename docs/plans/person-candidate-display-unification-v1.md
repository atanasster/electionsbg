# Person ↔ candidate display unification

Analysis + plan, 2026-09-03. Follows `person-candidate-merge-v1.md` (which shipped the shared
`PersonDashboard`) and defers every identity decision to
`person-cross-party-candidate-merge-v1.md`.

Reported symptom: `/person/boyan-boychev-1a9q2r` and `/candidate/Боян Иванов Бойчев` are the
same human and do not show the same thing — the candidate page has a donations block the
person page lacks, and „История на преференциите" is drawn differently. Also asked for: a
**history of donations** on both.

Every figure below was measured against local Postgres on 2026-09-03 (`candidate_person`
67,065 rows / `person_election_stats` 66,977 rows).

---

## 1. Why the two pages differ

`/candidate/:id` (`src/screens/CandidateScreen.tsx`) resolves the URL to a person and renders
the SAME `PersonDashboard` on a hit. On a miss it falls through to the legacy `<Candidate>`
body (`CandidateDashboardCards`). So there are **two** distinct divergences, and the reported
one is the second.

### 1.1 The reported page is on the LEGACY path — the name fold is ambiguous

`useCandidatePerson` sends a bare name to `candidate_person_by_name(name, party)` with
`party = NULL`, and that function returns NULL when the fold names more than one person.
Two people carry this fold:

| person | cycles | ballot |
| --- | --- | --- |
| `boyan-boychev-1a9q2r` | 2022_10_02, 2024_10_27 | party 28 (БСП) |
| `boyan-boychev-1a9q2r-2` | 2023_04_02 | party 1 (БСП) |

So the merge declines, and the legacy body renders. Scale:

- **25,625** name folds resolve to exactly one person → those candidate URLs already render
  the merged dashboard.
- **1,478** folds / **4,092** people do not → legacy body.
- The prerendered, indexed candidate family is the **bare-name** form
  (`scripts/prerender/dynamicRoutes.ts:1944`), so this is the URL shape that carries the
  traffic.

⚠️ **The route already accepts the disambiguator nobody passes.** `functions/db_routes.js`
`candidate-person` reads `q.party`, and `candidate_person_by_name` takes it. Measured over the
ambiguous folds:

| key | pairs | resolve to one person | still ambiguous |
| --- | --- | --- | --- |
| fold | 27,103 | 25,625 | **1,478** |
| (fold, election) | 5,393 | 5,163 | **230** |
| (fold, election, party) | — | — | **44** |

The page always knows the election (`?elections=`), so the cheap half of this is free.

⚠️ **The 44 residuals are an IDENTITY split, not a display bug — leave them alone.** Each is
an `mp-{id}` candidacy owned by one person and the matching `c-{party}-…` candidacy owned by
another, i.e. one human split in two (`mp-5182` / `borislav-georgiev-10dhnk`; the shadow holds
`candidate` roles and nothing else). 2,118 persons carry an `mp-{id}` slug and **228** of them
share a name fold with another active public person. `person-cross-party-candidate-merge-v1.md`
already decided the remedy — an audited ref-scoped manual merge, never a weaker resolver — so
this plan must not touch it. It is named here only because it is a second, independent reason
`/candidate/mp-5182` and `/candidate/<that name>` can render different people.

### 1.2 Where the MERGED path is still thinner than the legacy body

For the 25,625 folds that DO merge, three things are missing, so unifying is not only about
resolution:

| legacy `CandidateDashboardCards` | merged `PersonElectoralSection` |
| --- | --- |
| `CandidateDonationsTile` under a `financing` section, gated on `electionStats.hasFinancials` | **nothing** |
| `SectionArticlesProvider` + `articleTopic="votes"/"geography"/"financing"` → the „Свързани анализи" rail | **no rail** (sections carry no `articleTopic`) |
| `CandidateSummaryLine` — the one-line plain-language recap | a heading + `PartyBadge` + list positions |
| `CandidateTrajectoryTile` with **no** `highlightDate` → every bar full opacity | `highlightDate={selectedCycle}` → non-selected bars dimmed |

The trajectory difference is styling only; both charts read the same array. That is the
„chart looks different" in the report.

**Settled by Tier 0** (this table is the record of what a difference between the two pages
now IS — a decision, never an accident):

| difference | settled as |
| --- | --- |
| `CandidateSummaryLine` | on BOTH surfaces |
| the cycle heading + the bar highlight + `?elections=` on each drill-down | ONE `selector` prop, so they cannot arrive apart. Present on the person page (which has a cycle of its own); absent on `/candidate/:id`, whose cards ARE the header's cycle and whose `CandidateHeader` already prints the ballot badge and the `№pref` chips — a heading there was a third copy |
| the date format inside the block | the dotted Bulgarian form throughout (heading, selector pills, and the summary line, which was `localDate`'s `27/10/2024` ~8px from `27.10.2024`) |
| section ids / titles / article topics | each page's OWN IA, deliberately not unified — `votes`/`geography` carry the candidate page's article rail, `person-electoral`/`person-geography` are the person dashboard's anchors |
| the geography section | gated on the ARRAYS on both, which also fixes an orphaned „География" heading the candidate page rendered whenever both tiles self-hid |
| `CandidatePreferencesCard`'s drill-down | honours `linkSlug` on both (it fell back to the URL-encoded name while every sibling tile used the slug) |
| the card grid on a cycle with no paper/machine split | 3 columns rather than a ragged empty fourth |
| campaign self-funding | settled by Tier 3: the same tile on BOTH surfaces, payload-fed on the person page and shard-fed on the legacy body. The per-cycle HISTORY is person-only — the legacy body has no resolved person, so it has no rows to plot |
| the trajectory ARRAY (`history`) | settled by Tier 2: the prop is GONE and both surfaces plot `summary.history`. On the person page that is now the arc `person_elections()` derives from the person's own rows; on the legacy candidate body it is still the shard's array, which is namesake-polluted — one more reason Tier 1 shrank that body's reach to the genuinely person-less URLs |

⚠️ **„Дарения" already means two different things and both pages print the same word.** The
candidate tile's own hint says „Самофинансиране, декларирано от кандидата към кампанията на
партията" — the money this candidate GAVE to their party's campaign, from each party filing's
`data.fromCandidates`. The person page's `person-donations` block (`PersonProfileScreen.tsx`
:762) lists cycles where the person appears in a party's `fromDonors` — a private donation to
a party, no amount, no rows. Same label `Дарения` (`donations` / `pp_donations`), different
facts. Unifying the two blocks under one heading would merge two claims; they must be named
apart.

---

## 2. The finding neither page survives: the trajectory is namesake-polluted

This was not reported and is the most consequential thing found.

`person_election_stats.stats` is the RAW `preferences_stats.json` `stats` array copied out of
the **name** folder, and that array accumulates the fold's history across every cycle.
`load_person_elections_pg.ts:206` guards it — `ps = isCollision ? null : …` — but
`candidacyRegions`'s `isCollision` is `distinctParties.size > 1` **within one election
folder**. A namesake who ran in a DIFFERENT cycle is invisible to that test, so their bar
passes straight through onto this person's chart.

Measured over every person's chart (the longest `stats` array, entries with a non-empty
`preferences[]` — exactly what `CandidateHistoryChart` draws):

```
55,046  bars drawn today
 5,111  are cycles the person has NO person_election_stats row for   (2,458 people)
 5,111  of those 5,111 are explained by a same-name candidate in that cycle
        belonging to a DIFFERENT person_id                            (100%)
```

The worked example: person 6461's stored `stats` carries
`{"elections_date":"2023_04_02","party":{"number":1,…},"preferences":[{"oblast":"S23","pref":"116","preferences":21}]}`
— person 6462's candidacy, in an МИР 6461 never stood in. Both pages draw it. Screenshots 3
and 4 show that third bar on both.

**The person's own history is fully derivable from their own rows**, so the fix costs no new
data. Verified for person 6461: `party_nick`/`party_color` + `regions[].{oblast,pref,totalVotes}`
reproduce the shard's own entries exactly (2024_10_27 → S24/116/18; 2022_10_02 → S24/111/76).

Consequence of deriving, measured — state it plainly, because most of it is a REDUCTION:

```
50,298  bars after           (−5,111 wrong, +367 currently missing)
   367  bars gained          (300 people — cycles the loader's collision guard had nulled,
                              so those people have no trajectory at all today)
 1,906  people LOSE the trajectory tile  (their only second bar was a namesake's, and
                                          CandidateTrajectoryTile needs ≥2)
    45  people GAIN it
```

1,906 tiles disappearing is the correct outcome: a candidate who ran once has no trajectory.

⚠️ **The existing gate cannot see this.** `scripts/db/tests/person_elections.data.test.ts`
asserts no `regions` row mixes parties, that `total_votes` reconciles with `regions`, one row
per `(person, election)`, and no dangling `candidate_person`. It never reads `stats`. The
headline invariant it calls „the namesake collision was SPLIT correctly" is true of `regions`
and false of the history beside it.

`top_settlements` / `top_sections` are NOT affected — those are per-cycle in the shard, and
the per-cycle collision guard does cover them.

---

## 3. Donations: what exists, and what „history of donations" can honestly be

- **Source.** Each party filing `data/{election}/parties/financing/{partyNum}/filing.json`
  carries `data.fromCandidates[] = {name, date, goal, monetary, nonMonetary}` and
  `data.fromDonors[]`. `scripts/smetna_palata/index.ts:170` fans `fromCandidates` out into
  `data/{election}/candidates/{NAME}/donations.json` — **name-keyed**, so it is
  namesake-conflated exactly like the history above, and the `/candidate/:id/donations`
  drill-down reads it by name too.
- **The key we need already exists.** `(election, partyNum, name)` is precisely what
  `candidate_person` disambiguates on, and `load_person_elections_pg.ts` already walks the
  by-slug shards holding `(election, partyNum, person_id)`. So donations re-key by
  `person_id` with no new resolution rule and no new identity claim.
- **Coverage is 3 cycles, and that is the whole series.** `src/data/json/elections.json`
  carries `hasFinancials` per election: true for **2024_06_09, 2024_10_27, 2026_04_19**, false
  for the other ten. 2024_10_27 holds 261 `fromCandidates` rows across 10 parties. So a
  „history of donations" is at most three points per person — a labelled per-cycle list, not
  a trend (and per house style, not a sparkline). Cycles without financing must read „не се
  публикува за този вот", never 0.
- `t("lv")` is `"€"` in both locales — the key is misnamed, the rendering is right. Leave it.

---

## 4. Plan

Tier 0 first: it is the only tier that makes the others land on ONE page instead of two.

### Tier 0 — one electoral body, structurally

Both URLs already share `PersonDashboard`; the electoral block inside it is a partial re-write
of `CandidateDashboardCards`. Fold them:

1. Extract the card grid + regions + trajectory + geography tiles into one presentational
   component (`CandidateElectoralBody`) taking `{summary, history, linkSlug, election,
   highlightDate?, articleTopics?}`.
2. `PersonElectoralSection` and `CandidateDashboardCards` both render it, differing only in
   which hook feeds the summary (`usePersonElections` vs `useCandidateSummary`).
3. Settle the two cosmetic differences ONCE, in that component: `highlightDate` is passed
   whenever a cycle selector is present (person path) and omitted when there is none (legacy),
   and `CandidateSummaryLine` renders on both.
4. Gate: a component test rendering the shared body from both feeds over the same fixture and
   asserting an identical section id list and identical rendered figures.

### Tier 1 — resolve more candidate URLs to their person

1. `candidate_person_by_name(p_name text, p_party int, p_election text)` in
   `085_person_elections.sql` — **add the 3-arg form, keep the 2-arg form**. `exec()` sends a
   migration as one transaction and the deployed function still calls the 2-arg signature, so
   dropping it inverts the deploy order into an outage.
2. `useCandidatePerson(id, { election })` passes `?election=<ElectionContext.selected>`;
   `functions/db_routes.js` and `vite/db-api.ts` forward it. Expected: 1,478 ambiguous folds →
   **230** unresolved (fold, election) pairs.
3. For what is STILL ambiguous, do not fall through to a page that silently conflates two
   humans. Return the candidates instead of NULL — `{personSlug: null, candidates: [{personSlug,
   displayName, election, partyNum, partyNick, candidateSlug}]}` — and render a person-level
   namesake chooser (the `CandidateNamesakeChooser` idiom, keyed on person). A prerendered
   bare-name page whose fold really is two people should say so.
4. **Disclose a resolution the reader did not make.** 385 folds resolve because ≥2 public
   people share the name (up to 9 on one fold) and exactly one of them stood in the requested
   cycle. The dashboard is the right body — but the route returns the namesake set beside the
   hit and the page says so and links to the others, or it asserts a single identity under a
   shared URL on the strength of a default. `personSlug` + ≥2 namesakes IS "the election
   chose": a >1 fold cannot resolve without it, so no extra field is needed to detect it.
5. Do NOT add a party hint by resolving the candidate index client-side first — that pulls a
   per-election index for one lookup, the cost `project_mp_avatar_index` exists to avoid.
   ⚠️ The ELECTION arm is what makes that affordable, and it must NARROW rather than filter:
   the first cut applied it as `AND election_date = p_election` and, because `?elections=`
   defaults to the newest cycle while a prerendered URL carries no query string at all, that
   dropped resolution from 25,621 folds to 6,357 — 19,649 URLs pushed onto the very body this
   tier exists to stop reaching. Narrow-then-widen (prefer the election-matching set, fall
   back to the whole fold) measures 26,006, better than both. The legacy body's
   `useCandidateElectionFallback` partly hid it by probing the other twelve cycles and
   rewriting the global selector — 12 extra fetches per URL, i.e. exactly the cost this
   bullet forbids.
5. Gate: extend `person_elections.data.test.ts` with the three resolution rates above as
   floors, plus a mutation check (drop the election argument → the ambiguous count must rise),
   so an assertion satisfied by the old 2-arg behaviour cannot pass.

### Tier 2 — de-pollute the trajectory

1. Build `history` inside `person_elections()` (085) from the person's OWN rows: one entry
   per `person_election_stats` row **with a non-empty `regions`**, `party` from
   `party_nick`/`party_color`, `preferences` from `regions[].{oblast, pref,
   totalVotes→preferences}`, ordered by `election_date`. Same `CandidateStatsYearly` shape, so
   `computeCandidateSummary` and `CandidateHistoryChart` are untouched.
   The result-bearing filter is load-bearing, not tidiness: a roster-only candidacy has no
   bar, so excluding it keeps `history.length` equal to the number of bars drawn — which is
   what stops the tile's `history.length < 2` guard and the chart's own
   `filter(s => s.preferences.length)` from disagreeing. Measured: 16,679 of 66,977 rows are
   roster-only and excluded, and **0** rows are a selectable cycle yet absent from the arc —
   which is also the proof that the deleted `fullHistory` superset fallback was dead code
   rather than merely unlikely.
   - SQL, not the loader: it needs no reload, no shard access, and no `:cloud` data step —
     `apply_functions.ts 085_person_elections.sql` is the whole publish.
2. Drop `fullHistory` from `PersonElectoralSection` — its „longest history is a superset"
   heuristic (and the fallback its own comment flags as unenforced) exists only because the
   array was per-row and polluted. The payload now carries the person's whole arc directly.
3. Leave the `stats` column and the loader alone — but for the RIGHT reason. It is not the
   source of `top_settlements`/`top_sections` (those are separate columns fed by separate
   shard fields); after this change nothing on the serving path reads it at all. It is kept
   because it is the verbatim shard capture and the only in-database evidence the pollution
   existed, which two of the gates below rest on. Comment it so a future reader does not
   "fix" the derivation back to it.
4. Gates, in `person_elections.data.test.ts`:
   - **zero** foreign bars — every entry in the returned `history` is a cycle the person has a
     row for. This is the assertion the file was missing, and it fails on `main` at 5,111.
   - the arc is the person's own result-bearing cycles, once each (both directions: a missing
     cycle shortens a career, a duplicate draws one year twice).
   - every bar's party and per-region figures re-derive from that person's own row — the
     mutation check that stops "the right cycles" passing on an arc of empty bars.
   - a second mutation check over the retired `stats` column, which is still present: it must
     still yield >1,000 foreign bars, or the assertions above have stopped discriminating and
     the reason is the corpus rather than the fix.
   - a shard-FIDELITY gate: each arc bar must equal the same cycle's entry inside that row's
     own `stats`. Gate 3 compares the function against its own input and cannot make this
     check; this one can, only while the retired column is still there (49,828 pairs, 0
     differing, measured 2026-09-04). It skips with a distinct reason once `stats` is dropped.
   - Measured after the change: **50,298 bars** (from 55,046), 9,556 people keep the tile.
     The payload SHRINKS on average — 7,300 → 6,896 bytes per person over all 29,715 public
     people, 216.9 MB → 204.9 MB corpus-wide, 90.4% of payloads smaller — because a shard
     entry for a cycle the person skipped was empty while an arc entry is populated by
     construction. The worst case grows (67,280 → 73,001 bytes on a 10-candidacy MP), which
     is where the per-row repetition of the arc shows.
5. Optional, separate: `scripts/reports/save_preferences.ts` writes the polluted array in the
   first place, so `/candidate/:id/*` legacy drill-downs and the shard consumers stay wrong.
   Out of scope here — Tier 1 shrinks that path to a chooser — but worth its own ticket.

### Tier 3 — donations, per person, with a per-cycle history

1. **DONE.** In `load_person_elections_pg.ts`, read each `(election, partyNum)` filing's
   `data.fromCandidates`, fold rows by the candidate's name within that party, and add to
   `person_election_stats`: `donated_monetary_eur double precision`,
   `donated_nonmonetary_eur double precision`, `donation_count int`,
   `donations jsonb` (the filing's own rows, so the existing tile renders unchanged — the
   same „raw shard arrays" contract the table already documents).
   - `double precision`, never `numeric`: node-postgres serialises `numeric` as a string and
     every money cell renders blank with the value present in the payload (the 142 lesson).
   - Declared in BOTH the `CREATE TABLE` and the reconcile `ALTER TABLE … ADD COLUMN IF NOT
     EXISTS` block, this file's own convention for `party_nick`/`party_color` and the
     `003_tr_search.sql` lesson: a canonical definition that describes a narrower table than
     exists sends the next reader — or a future shape gate — to the wrong schema.
   - Payload cost, recorded on the same basis as Tier 2's: **avg 7,102 bytes** per person
     (from 6,896, +206 B / +3.0%), max 73,901 (from 73,001), **211.0 MB** corpus-wide (from
     204.9 MB). ~99.2% of rows carry the four keys at zero. Accepted rather than optimised —
     omitting them on zero rows would contradict the non-optional frontend type.
   - **Publish (nothing runs it automatically, and the change is INERT until the loader
     re-runs — the columns sit at their `DEFAULT 0` with every row count reconciling):**

     ```bash
     npm run db:load:person-elections:pg          # local: applies 085, fills the columns
     npm run db:load:person-elections:pg:cloud    # the serving database
     npm run deploy:db                            # no route change, but 085's new body
     npm run deploy                               # the four keys on PersonElectionRow
     ```

     085 must be applied as a WHOLE file: `person_elections()`'s body selects the four
     columns and a `LANGUAGE sql` body is validated at CREATE, so the ALTERs must precede the
     function (they do). Order matters in one direction only — `PersonElectionRow` types the
     four keys as non-optional, so hosting shipping ahead of the loader hands the client
     `undefined` where the type promises a number. No consumer reads them until Tier 3b, so
     today that is latent.
   - ⚠️ **The PARTY is part of the key and is not optional.** ЕРИК's table is „дарения от
     кандидати **и членове**", so a donor need not be a candidate at all. Measured 2026-09-04:
     756 of 886 filing rows (85.3%) join on (election, party, name).
   - ⚠️ **The 130 unmatched rows are 65 on another party's list and 65 absent from the ballot
     under the filed spelling — and part of the second group is LOST rather than refused.**
     The first 65 are correctly refused: matching them pays one party's donation to another
     party's same-named candidate. Of the **66** rows absent from every ballot in their cycle,
     one is nonetheless attributed through an inferred-party `mp-{id}` shard (which is why
     756 attribute against 755 exact (party, name) matches), ~56 are genuine party members —
     correctly unattributed, and still visible on the party's own financing page — and **10
     rows / €7,284.85 across 7 candidates ARE on their own party's list under a shortened
     spelling** — a missing patronymic
     („Даниел Георгиев" → „Даниел Георгиев Илчев") or hyphen spacing („Мая Манолова -
     Найденова" → „Мая Божидарова Манолова-Найденова", €5,155 of the total). Case and
     whitespace folding recover **0** of them. Closing that gap needs a name-token rule with
     its own ambiguity refusal — the `aop_expert_person_links()` shape — and is its own tier;
     do NOT loosen this key to chase it. It is not a regression (the retired name-keyed shard
     could not render Мая Манолова either — her folder holds a `donations.json` and no
     `regions.json`), but it is the reason **no surface may render a zero here as „gave
     nothing"**: absence of a figure is absence of an attribution, and the tile self-hides on
     an empty row set.
   - The donor NAME is stripped from the stored rows: it is this person by construction, and a
     name inside a per-person payload reads as evidence of identity on exactly the shared-name
     pages where it is not.
   - Loaded: **756 rows attributed**, and each cycle's total is split by basis because the mix
     swings too far to leave implicit — in-kind is 48% of one cycle and 3% of another, so a
     combined figure reads as money given:

     | cycle | people | cash | in-kind |
     | --- | --- | --- | --- |
     | 2024_06_09 | 212 | €201,337 | €184,964 |
     | 2024_10_27 | 173 | €585,179 | €18,523 |
     | 2026_04_19 | 151 | €240,170 | €38,730 |
2. **DONE.** `person_elections()` returns the four fields per cycle, and
   `PersonElectoralSection` renders `PersonSelfFunding` beneath the electoral block — the
   selected cycle's figure through the SAME `CandidateDonationsTile` the candidate page uses,
   fed from the payload rather than from the name-keyed shard.
   - The tile gained a `rows` prop, and the FETCH moved into a child component that only
     mounts when `rows` is absent. `enabled: false` still requires a QueryClientProvider up
     the tree, which would have made „nothing is fetched" true of the network and false of
     the component — the person dashboard would carry a dependency on a fetch layer it does
     not use, and so would every test of it.
   - Gated on the SELECTED CYCLE's `hasFinancials`, from `ElectionContext.stats` (the whole
     elections table is already in the bundle, so it costs no request) — not the global
     `electionStats`, which is the header's cycle and not the person's.
3. **DONE.** The history is the person's own rows: a per-cycle list (cycle · contributions ·
   cash · in-kind), newest first, cash and in-kind in separate columns. Three cycles maximum.
   Not a sparkline.
   - It renders only from TWO funded cycles up: one point is the figure already on the card
     above it.
   - ⚠️ **A zero is never rendered as „gave nothing", at either level** — a cycle with no
     attributed rows is omitted from the history, and a person with nothing attributed
     anywhere gets no section. That is §1's residue talking: 10 filing rows / €7,284.85 do
     not attribute because ЕРИК spells the name shorter than the ballot does, so absence of a
     figure is absence of an ATTRIBUTION. The distinction between „nothing was declared" and
     „this vote publishes no campaign financing" is spelled out in words for the same reason.
   - History is person-only, and that asymmetry is deliberate: the legacy candidate body has
     no resolved person and therefore no rows.
4. **DONE.** The two facts are named apart. The tile is „Самофинансиране" under a
   „Самофинансиране на кампанията" section — money the person GAVE to their own party's
   campaign — and the person dashboard's „Дарения" block keeps its name but now carries a
   basis line saying it is presence in a party's donor list, not an amount. Both may appear
   on one page; neither borrows the other's heading.
   - Two rendering defects fell out of putting the tile on a page where in-kind is usually
     zero: `formatThousands(0)` returns the EMPTY STRING, so the sub-line read „511 парични ·
     непарични" — a label with no number, which reads as a missing value rather than as zero
     — and the count read „1 дарения". Now „511 парични" (only the bases that carry money)
     and „1 вноска" (a plural key, and „вноска" rather than „дарение", which is the other
     direction).
5. `fromDonors` amounts are reachable by the same `(election, partyNum, displayName)` key that
   `person_role(source='donor').ref` already stores, so the presence-only block can become a
   figure later. Deliberately NOT in this tier: `source='donor'` is `public_default=false`, so
   attaching an amount to a named private individual is a decision, not a rendering change.
6. Gates (six, in `person_elections.data.test.ts`): the person-keyed totals reconcile against
   a fresh, INDEPENDENT read of the party filings, with a mutation arm that moves every stored
   monetary figure by €1 and requires none of them to still reconcile; self-funding is
   attributed only for cycles that publish financing, with the publishing set DERIVED from the
   corpus (a hardcoded year turns green into red the first time an earlier cycle is
   backfilled); `person_elections()` publishes the four columns under the right KEYS, compared
   on rows whose cash and in-kind figures DIFFER so a swapped pair cannot satisfy it — and in
   `float8`, since casting a `double precision` to `numeric` rounds to 15 significant digits
   and reports 13 of 20 correct rows as mismatched; the stored rows carry no donor name and
   their sum equals the stored total; coverage has not COLLAPSED against the filings (756/886
   measured, floored at 70% because the residue's size legitimately moves); and self-funding
   reaches a second person ONLY where the identity layer has already split one human in two.
   Plus the client-side contract tests in `personDataCycles.test.ts` and, from Tier 3b,
   `CandidateDonationsTile.test.tsx` (the tile's heading, the per-basis sub-line, the plural,
   the zero guard, no-request-on-payload, the drill-down cycle, and the surviving shard arm)
   and `PersonSelfFunding.test.tsx`.
   - ⚠️ The reconciliation is the ONLY gate that compares against an external source, so its
     corpus-absent path goes through `reportSkip`, not `console.warn` — vitest's default
     reporter swallows `console.*` when stdout is piped, i.e. every CI run, and a silent
     stand-down there means the tier reports green having checked nothing. Reachable in the
     mixed state `db:sync:cloud` leaves: Postgres populated, shard trees absent.
   - ⚠️ Two 1:N shapes the reconciliation had to be taught, both identity artifacts rather
     than defects in this tier: **88** (person, cycle) pairs hold more than one candidacy
     shard and **50** of those hold two different `mp-{id}` shards (one person resolved from
     two parliament ids), so the gate checks that the figure came from a filing row keyed by
     ONE OF the person's own candidacies. And **1** donation-carrying (fold, cycle, party)
     triple is owned by two person rows — the `mp-{id}`/`c-{party}` split
     (`person-cross-party-candidate-merge-v1.md`) — so that one figure legitimately shows on
     two pages, and the gate caps rather than forbids it.
   - The reconciliation keys on the **shard's** name, not `person.display_name`: for a seated
     MP the resolver's canonical name is the parliament.bg spelling, and 5 attributed rows key
     on a name their person row does not carry.

### Tier 4 — the two remaining parity gaps

1. **DONE.** The person dashboard's electoral / geography / self-funding sections are wrapped
   in `SectionArticlesProvider order={["votes","geography","financing"]}` — the same order as
   the candidate body, so an article's placement does not depend on which URL a reader
   arrived by — and each declares its `articleTopic`.
   - The provider is not optional decoration: `SectionArticlesStrip` falls back to filtering
     the article list per section when there is none, so a rail still renders and an article
     tagged both `votes` and `geography` appears in BOTH. The provider assigns each article to
     the FIRST topic in the order, once.
   - `SectionArticlesProvider` gained an optional `election`, and the person page passes the
     BLOCK's cycle. It filters `article.election !== selected` against the global
     `?elections=` by default, which is right for a page whose whole body is that cycle — but
     the person page's electoral block rides `?pelect`, so without the override an
     election-scoped article is matched against the header's cycle while sitting under a
     heading describing a different one. Not a type error and not a visible one.
   - The order lives ONCE, in `sectionTopics.ts`, imported by both surfaces — it decides which
     section a multi-topic article lands in, so a second copy would let a reader's URL decide
     what they find.
   - All three topics are declared in `PersonElectoralSection`, including the financing one it
     passes DOWN to `PersonSelfFunding`. A topic declared in another component cannot say
     whether that component is inside the provider, and outside one the strip silently reverts
     to filtering per section — against the header's cycle, and double-listing.
   - Gate: `sectionArticlesRail.test.tsx` (10 tests) — the first-topic assignment AND its
     anti-property (without a provider the same article double-lists), the block-cycle
     override in three directions (override, empty override, none), each section bound to its
     OWN topic as a PAIR, the containment of the financing section inside the provider, the
     shared order, and that no rendered copy carries an unresolved `{{…}}`.
     ⚠️ Its first cut was itself the defect it now guards: it asserted that the provider
     existed and that the three topic STRINGS appeared in the file — which the provider's own
     order array satisfied — and passed on a person page where NO section declared a topic and
     the rail rendered nowhere. It typechecked. It was found by opening the page. Four further
     proxy assertions the review then found are closed and mutation-checked: mounting the
     financing section before the provider, swapping two topics, reversing the shared order,
     and declaring the topic in the child all fail it now.
   - ⚠️ TWO of the three destinations are CONDITIONAL, the hazard the candidate body already
     records: `person-geography` is omitted with no settlement/section rows, and
     `person-self-funding` when nothing is attributed — 487 of 29,715 people (1.6%). An
     article tagged ONLY `financing` renders nowhere on the other 98.4%.
   - Measured 2026-09-04: no article is both election-scoped and tagged one of the three, and
     none carries `geography` or `financing` at all. So the override and the dedupe are
     correct and INERT today; they are wired now rather than discovered on the day an article
     lands.
   - ⚠️ Consequence worth knowing: the section now mounts a react-query child, so a test of
     any section carrying an `articleTopic` needs either a QueryClient or a stub of
     `useListedArticles`. `PersonSelfFunding.test.tsx` stubs it, which also keeps its
     no-request assertion about the donations path.
   - ⚠️ And a CLS consequence, which is why `/person/<slug>` joins BOTH lists in
     `tests/perf.spec.ts`: the rail arrives with its own ~25 KB fetch and lands INSIDE an
     already-mounted section, pushing everything below it down. The person profile had been in
     neither budget despite being the same multi-card, per-card-query shape as `/candidate/*`
     — flagged in Tier 0's review and closed here. The chosen slug is prerendered and has
     three candidacy cycles, so it exercises the electoral block, the geography block and the
     rail.
2. **DONE in Tier 0** — `CandidateSummaryLine` renders on both surfaces.
3. **DONE, as a decision rather than a change.** The two id sets stay different, and §1.2
   records why: `votes`/`geography`/`financing` carry the candidate page's article rail and
   are that page's anchors; `person-electoral`/`person-geography`/`person-self-funding` are
   the person dashboard's. The parity gate asserts the CONTENT matches and deliberately does
   not assert the ids do. What DID change page-wide is `headingLevel` — all ~17 person-profile
   sections are real `<h2>`s now, gated by `personHeadingOutline.test.ts`.

---

## 5. Publish

Nothing here is automatic on the cloud side.

| change | publish |
| --- | --- |
| Tier 1 SQL + Tier 2 derivation (085) | `apply_functions.ts 085_person_elections.sql` on Cloud SQL, **then** `deploy:db` (the route's new `election` arg), then `deploy` |
| Tier 3 columns + data | 085 first (the `ADD COLUMN` reconcile), then `npm run db:load:person-elections:pg:cloud`, then `deploy:db`, then `deploy` |
| Tier 0 / 4 (client only) | `npm run deploy` |

Two ordering rules bind:

- 085 is `LANGUAGE sql`, validated at CREATE, so the columns must exist before the function
  that selects them — one file, columns declared above the functions.
- The 3-arg `candidate_person_by_name` must reach the database BEFORE the `deploy:db` that
  calls it; keeping the 2-arg form makes the reverse order survivable instead of a 500 on
  every `/candidate/<bare name>`.
- `db:load:person-elections:pg` is stage-merged (`person_election_stats` is read by
  `person_by_slug` and `person_connections`), so Tier 3's reload is reader-safe — do not
  replace it with a TRUNCATE.

Changelog: `load_person_elections_pg.ts` already calls `recordIngestBatch`, so the donations
columns ride the existing `recent_updates` wiring; no new `data-changes.json` entry (the
electoral data is derived from shards the election skills already stamp).

---

## 6. What this plan deliberately does not do

- **No identity changes.** The Боян Иванов Бойчев split, the 44 (fold, election, party)
  residuals and the 228 `mp-{id}` name-sharing persons are all the class
  `person-cross-party-candidate-merge-v1.md` covers, whose decision is an audited ref-scoped
  manual merge. Weakening the resolver to make two pages agree would merge real strangers.
- **No amount attached to a private donor.** Tier 3 §5.
- **No retirement of the legacy candidate body.** After Tier 1 it serves only the genuinely
  person-less URLs (an unknown name, a private or review-state person) — the chooser is its
  own component. Deleting it is a separate call.
- **The eight `/candidate/:id/*` sub-page BODIES stay name-keyed.** Tier 1 repairs their
  HEADER for free (`CandidateProfileHeader` calls the same resolver), but `/regions`,
  `/municipalities`, `/settlements`, `/sections`, `/donations`, `/assets`, `/procurement` and
  `/funds` each read the name-folder shards directly, so for a genuinely shared name they
  still publish the conflation — with no chooser and no notice. Closing that means either
  rendering the chooser on those routes too or carrying `SharedNameNotice` into
  `CandidateProfileHeader`; it is deliberately out of Tier 1, whose scope is
  `/candidate/{name}` itself.
- **No fix to the name-keyed shards** (`save_preferences.ts`, `donations.json`) — noted in
  Tier 2 §5 as its own ticket.
