# Local-election person links & person pages — v2

Follow-on to `local-person-links-v1.md` (which shipped the `personSlug` bake + `PersonNameLink`).
This plan covers what the bake left out, plus three **live defects** found while analyzing the four
reported symptoms — three of the four symptoms are defects, not missing features.

Everything below was measured against the local docker Postgres on 2026-07-31. Cloud SQL was NOT
inspected; every "measured" figure is local-only unless stated.

---

## 0. The four reported symptoms, mapped to causes

| # | Symptom | Cause | Tier |
|---|---|---|---|
| 1 | `Кмет на кметство` — only the first two candidates link | By design: only **elected winners** get a `person_role`, so 85% of local candidate mentions have no page. The 2nd row links only because it happens to be a seated MP. | B1 |
| 2 | Росен Русев's page shows a stranger's 2022 БТР candidacy, no local results, no declarations | Three separate causes: **A1** (stale `person_id` → wrong candidacy), **B2** (no local election content on `/person`), **A2** (`declaration.person_id` all NULL) | A1, A2, B2 |
| 3 | `Кмет на общината — вот в селището`: 2019 Георги Георгиев links, 2023 does not | 2023 he **lost** the община (Ставрев won) → no role, per B1. Separately, the same man's four terms are split across **three** person records (A3). | B1, A3 |
| 4 | Станчо Ставрев's page: no local results, no declarations | **B2** + **A2**. His `muni` filing (Кмет, Тунджа, 2025) exists in `declaration` and simply never joins. | A2, B2 |

---

## Tier A — live defects (fix before any enhancement)

### A1. `candidate_person` / `person_election_stats` are keyed on a stale `person_id` vintage

**Measured: 67,065 of 67,065 `candidate_person` rows (100%) have a `person_id` that disagrees with
their own `person_slug`.**

```
candidate_slug                        person_slug (correct)      person_id  → that id today
c-12-aleksandar-rumenov-pravchev      aleksandar-pravchev-26ufiv       852  → Александър Ивайлов Иванов
c-12-stoyan-violinov-stoyanov         stoyan-stoyanov-1i3ftz         47033  → Росен Господинов Русев
```

That second row **is** symptom #2: `/person/rosen-rusev-a0a8lm` is person 47033, `person_elections()`
looks up `person_election_stats` by `person_id`, and finds the row a previous resolve had stamped
`47033` — which then belonged to Стоян Виолинов Стоянов. The page shows a stranger's candidacy with
his party, preferences and МИР, indistinguishable from real data.

Root cause: `person.person_id` is a **`bigserial`** (`081_person_identity.sql:66`) and
`resolve_persons.ts` DELETEs + rebuilds the derived tables, so **ids are re-minted on every resolve**.
The *slug* is stabilized by `person_slug_lock`; the *id* is not. Two tables persist that id
independently (`candidate_person`, `person_election_stats`, loaded by
`scripts/db/load_person_elections_pg.ts`), so any resolve that is not immediately followed by that
loader silently re-points every candidacy at whoever inherited the number.

`declaration.person_id` has exactly the same shape and is already documented in CLAUDE.md — this is
the second instance of one class, and the class is not named anywhere.

The existing gate misses it: `person_elections.data.test.ts:79` asserts `person_slug` resolves to a
real person, never that `person_id` **agrees** with it.

**Fix**
1. Immediate: re-run `npm run db:load:person-elections:pg` (and `:cloud` — verify prod before
   assuming it is clean; the check is one query, below).
2. Gate: add to `person_elections.data.test.ts` —
   `SELECT count(*) FROM candidate_person cp JOIN person p ON p.slug = cp.person_slug WHERE p.person_id <> cp.person_id` must be 0.
   Same assertion for `person_election_stats` via `candidate_person`.
3. Structural, pick one:
   - **(a) Drop the persisted id.** `person_election_stats` keys on `person_slug` instead of
     `person_id`; slugs are lock-stabilized, so the drift cannot happen. Costs a text PK.
   - **(b) Generation stamp.** `resolve_persons` writes a `person_generation` row (uuid/counter);
     each loader stamps the generation it read and refuses to serve — or the serving function
     refuses to join — when the generation has moved. Makes it loud instead of silent.
   - (a) is the smaller change and removes the failure mode rather than detecting it; (b) also
     covers `declaration.person_id`, which cannot drop its id as cheaply.
4. Document the class in CLAUDE.md next to the existing declarations paragraph: *"`person_id` is not
   stable across resolves. Every table that persists one must be reloaded after `db:resolve:persons`."*
   List them exhaustively (`declaration`, `candidate_person`, `person_election_stats`,
   `person_browse_table`, `official_candidate_link`).

### A2. `declaration.person_id` is NULL on all 47,983 rows locally

So **no `/person` page shows any declaration** — which is symptoms #2 and #4's declarations half.
Ставрев's filing is present and correct (`muni`, `subject_ref=stancho-dimitrov-stavrev-360a14`,
Кмет, Тунджа, 2025); only the join key is missing.

This is the exact failure CLAUDE.md documents for Cloud SQL, now true locally. Fix: run
`npm run db:load:declarations:pg` then `-- --resolve`, then `db:load:persons-browse:pg` (its
`has_declaration` reads `person_id`). Add a data gate: `declaration.person_id` NULL share must be
below a small threshold (it is legitimately non-zero — unmatched declarants exist — so assert a
ceiling, e.g. < 2%, not zero, and print the actual number).

### A3. The same local officeholder is split across cycles

**Measured: 751 (name, obshtina, role) groups spanning 1,663 distinct person records.** Worst cases
are five-term mayors split into five separate pages:

```
Алекси Иванов Кесяков      SFO58  mayor  5 person records
Людмил Димитров Веселинов  TGV24  mayor  5
Николай Кирилов Димитров   BGS15  mayor  5
Георги Стоянов Георгиев    JAM25  mayor  3   ← symptom #3
```

Георгиев's 2015 and 2019 terms merged (`georgi-georgiev-mwskgo`), but 2007 and 2011 each became
their own person. So the merge rule is not just conservative — it is **inconsistent**, which points
at a blocking-key or evidence-threshold detail rather than a deliberate policy.

Same name + same município + same office across cycles is about as strong as name evidence gets
(a village has one mayor). Proposal: add a local-continuity rule to `resolve_persons` —
`(name_fold, obshtina_code, role)` merges across cycles by default; keep a guard for the genuinely
ambiguous case (two different people, same name, same município — flag as
`person_review_candidate` rather than merging). Expect ~900 person records to collapse; every one
of those is a slug retirement, so it needs a `person_slug_retired` map (`raw_data/person/` +
`person:slug-redirects:cloud`) — see `raw_data/person/README.md`.

#### A3 — as built

**Root cause, confirmed in code.** Not a blocking-key detail. `shareCorroborant`'s `weakBoth`
branch needs party AND place, and a local officeholder routinely has NO party — an инициативен
комитет carries `primaryCanonicalId: null`, which is exactly how a village mayor without a party
gets on the ballot. So the only path open to these people was Tier 2, which requires a globally
unique name (`namesakeRisk <= 1`). That is why Георгиев's merge looked "inconsistent": nothing was
deciding per-cycle, some names simply cleared the uniqueness bar and others did not.

**Re-measured after T0–T3 landed: 640 groups / 1,402 person records** (~762 surplus pages), 498 of
them touching the sitting mandate. **637 of the 640 span cycles**; only **3** are within-cycle.

**Shipped as a new Tier-1 corroborant, `sameLocalSeat`** (`scripts/person/cluster.ts`), not as a
separate `(name_fold, obshtina_code, role)` pass — it belongs beside the other corroborants so the
patronymic-conflict veto and the review-candidate machinery apply to it unchanged. Two departures
from the proposal above, both forced by what the data turned out to be:

- **The seat key is per-role, and is NOT `obshtina_code`** (`localSeatKey`, in
  `scripts/parsers_local/localPersonRefs.ts` — beside the ref builders, because which half of a row
  names the seat is a fact about the ref shapes). A mayor keys on the ref; a **village mayor keys
  on the §T2 SETTLEMENT**, which is finer than the proposal and is what stops two same-named
  village mayors in one община being one key. The ref cannot serve there: `ekatte` is empty in
  every bundle, so kmetstvo/district refs fall back to a per-cycle ARRAY INDEX (0 of 8,301 and 0 of
  46 carry a real code), and an index names a different village each cycle. A **район mayor gets no
  key at all** — index-based ref, parent-община place, 46 roles; neither half is stable.
- **The same-cycle guard is a BLOCK-level exclusion, not a pairwise condition.** "Different cycle"
  is an anti-condition and union-find closes transitively over edges, so a pairwise check does not
  survive to the group: three terms of one seat with two in 2023 still fuse through the 2019 row,
  and because review candidates are computed from the FINAL components, the single root also
  DELETES the `identical_fullname` flag meant to carry the case to a human. So any seat-term
  claimed by more than one mention is "contested" and every mention claiming it is excluded from
  the rule — including against a third, uncontested cycle, since if two people held seat S in 2023
  we cannot say which is the S of 2019. This was wrong in the first draft and caught in review;
  live instance is Валери Иванов Василев, VID09, elected from two lists on one council in 2023.

**The namesake cap applies only to `councillor`.** It came over from `samePartyOffice`, and the
first data run showed it was both the wrong instrument and the only thing still blocking the
rule's headline cases. `namesakeRisk` counts COMPANIES an officer-name appears in — it says
nothing about how many people of that name hold office — so on an exclusive seat it filters a man
only if he happens to sit on many boards. Of the 18,935 people with a local role, 10,766 score 0
and 657 (3.5%) exceed 12.

Those 657 were not a random tail: after the first resolve, **53 groups (121 person records) on an
exclusive seat were still split, and the cap was the sole blocker for all 53** — among them this
plan's own symptom #3, Георги Стоянов Георгиев, кмет на Тунджа 2007–2019 on four records at risk
39, and the кмет of BGS09 on all five cycles as five records. One община has one кмет and one село
one кмет на кметство, so on those seats the SEAT identifies and the name only has to agree; the
same-cycle contest exclusion covers the ambiguous case and is unaffected. A council is not
exclusive, so `councillor` keeps the cap.

**Adjacency was considered as a replacement and rejected as undeliverable against this corpus**:
2011 and 2015 carry zero village-mayor rows, so the recurring "2007, 2019, 2023" shape is a DATA
GAP rather than a career gap, and requiring consecutive terms would refuse a man who served
continuously.

Accepted residue, stated so nobody has to re-derive it: 4 of the 43 village groups bridge a
16-year gap on a mass name (e.g. "Димитър Иванов Димитров", risk 178) with no intervening term.
The patronymic guard excludes a father/son pair but not a grandson sharing his grandfather's full
name, which is possible in a name-concentrated village. Judged acceptable against leaving 121
records split; revisit if a wrong merge is ever reported.

---

## Tier B — the actual enhancements

### B1. Link losing candidates (symptoms #1 and #3)

Today `decorate_local_person_links.ts` stamps winners only. Coverage across all cycles:

| contest | candidate rows | linked | unlinked |
|---|---:|---:|---:|
| Кмет на община | 9,645 | 1,440 | **8,205 (85%)** |
| Кмет на кметство | 30,831 | 10,721 | 20,110 (65%) |
| Кмет на район | 2,128 | 46 | 2,082 |
| Общински съветник | 110,920 | 15,496 | 95,424 |
| **total** | **153,524** | **27,703 (18%)** | **125,821** |

Note the council row: **19,864 candidates are marked `isElected` but only 15,496 carry a slug** —
4,368 *elected* councillors (22%) are unlinked even under today's winner-only rule. Part is the
deliberate Sofia-район replica skip; the remainder is unexplained and should be measured before
widening anything.

Three options, in increasing cost:

- **B1a — link losers who already have a page from another source** (cheap, high value).
  A losing mayor candidate who is a seated MP, a sitting councillor elsewhere, a declarant, or a
  company officer already has a `/person`. Resolve the mention against the existing person set at
  bake time (name fold + município as evidence) and stamp `personSlug` without minting a new person.
  This alone fixes symptom #1 for the recognizable names and symptom #3's 2023 row (Георгиев is
  already a person — he just isn't the 2023 winner).
- **B1b — mint a person for every local candidate.** Turns 153k mentions into ~100k+ new people,
  most of whom appear exactly once, with no disambiguating evidence beyond a name. This is a large
  namesake-risk surface and a large prerender/sitemap surface. **Recommend against** as a blanket
  rule.
- **B1c — mint for runoff finalists and top-N council list positions.** A middle ground: someone who
  reached a mayoral runoff or sat in the top few list positions is a genuine public figure.
  Bounded (~a few thousand), defensible, and it fixes the visible "the top of the table is a mix of
  links and plain text" inconsistency.

Recommendation: **B1a now, B1c as a follow-up**, B1b never as a blanket.

Whatever is chosen, the UI needs a rule for the unlinked case. Today a linked and an unlinked name
are visually near-identical, which reads as a bug (it is what prompted symptom #1). Either style
unlinked names distinctly, or — better — make every name clickable to a *disambiguation/search*
result when no profile exists, so the affordance is uniform.

### B2. Put local elections on the person page (symptoms #2 and #4)

`person_role` for `source='local'` carries **`source_row = NULL` on all 27,703 rows** — only
`role` + `place_code`. So `/person` can render "Кмет · Тунджа" and nothing else: no cycle, no votes,
no percentage, no party, no round-1/round-2 split, no opponent.

Meanwhile the parliamentary side has a full `PersonElectoralSection` fed by
`person_election_stats`. The asymmetry is the whole of symptoms #2 and #4: a four-term mayor's page
shows less about his elections than a one-time parliamentary list filler's.

Proposal — a `person_local_elections` table + serving function, mirroring `person_election_stats`:

- Populate from the local bundles during the same walk that mints the refs
  (`scripts/parsers_local/localPersonRefs.ts` already resolves winners; extend it to emit the row).
- Per (person, cycle, contest): office, município/settlement, party (localPartyNum + colour),
  votes, share, round, elected flag, and the field the contest was won against (runner-up name +
  margin).
- Serve via `person_local_elections(slug)`; render a `PersonLocalElectoralSection` with a
  timeline of terms (the "four consecutive terms" story is the most valuable thing on such a page)
  plus a per-cycle detail card.
- Deep-link each cycle back to `/local/<cycle>/<obshtinaCode>/mayor` etc., closing the loop with
  Tier B1's links.

Sub-items worth designing in the same pass:
- **Term continuity tile** — "Кмет на Тунджа 2007–2023, 4 мандата", derived once A3 merges the
  fragments. This is the single most legible thing the local data can say about a person.
- **Council attendance / votes** where `data/council/` has per-councillor named votes
  (`update-council-minutes` covers a subset of municipalities) — the local analogue of
  `PersonMpSections`.
- **Cross-tier arc** — Ставрев is councillor → кмет → народен представител. The roles block lists
  those three flat, with no dates and no order. A single ordered career timeline across `local`,
  `mp`, `exec`, `muni` and `magistrate` roles would serve every person page, not just local ones.

### B3. Declarations coverage: кметове на кметства are missing entirely

`declaration` tier `muni` breaks down as:

```
Общински съветник   4,827
Заместник кмет        694
Кмет                  305
Главен архитект       300
Председател на ОбС    262
```

There is no `Кмет на кметство` row at all, against ~2,800 village mayors nationally — and 10,721
`village_mayor` roles in `person_role`. So symptom #2's "no declarations" is partly A2 and partly a
genuine ingest gap: Русев has no filing in the corpus to show.

Action: confirm against register.cacbg.bg whether кметове на кметства are published under a distinct
declarant category, and if so extend the `update-officials` municipal roster. If they are genuinely
absent from the register, the page should **say so** ("не подлежи на деклариране / няма публикувана
декларация") rather than silently omitting the section — an empty section is currently
indistinguishable from A2's broken join.

### B4. Link plumbing cleanups

- **Two canonical URLs per MP.** 2,207 people have `person.slug = 'mp-{id}'`, so
  `/person/mp-3080` and `/candidate/mp-3080` both render the same dashboard. `PersonNameLink`
  prefers `/candidate/`. Pick one canonical form, `<link rel=canonical>` the other, and make the
  sitemap emit only the canonical one (see `project_sitemap_validity_audit`).
- **`PersonNameLink` is the only link component but not the only link path** —
  `LocalMayorTimelineTile`, `LocalPlaceTrendsTile` and `MyAreaKmetstvoTile` each pass their own
  `personSlug`/`mpId` shape. Worth a single `useLocalPersonHref` so a future change to the
  preference order (B4 above) lands in one place, exactly as `useAwarderHref` does for
  `/awarder/`.
- **Hover card.** With Tier B2 in place, a name hover could show office + term + party without a
  navigation — the highest-leverage UX win on the local dashboards, where names appear in dense
  tables.

---

## Suggested sequencing

1. **A1 + A2** — reload, then land both gates. Nothing else is trustworthy until these are green.
   (A1's structural fix (a) or (b) can follow the reload; the gate is what stops the recurrence.)
2. **B1a** — link mentions that already have a person. Immediate visible fix for #1 and #3, no new
   people, no slug churn.
3. **A3** — the cycle-continuity merge, with its slug-retirement map. Do it **before** B2, so the
   term timeline has whole people to describe.
4. **B2** — `person_local_elections` + the section. The substantive feature.
5. **B3**, **B4**, then **B1c** if the coverage gap still reads badly.

## Verification queries (paste-able)

```sql
-- A1: must be 0
SELECT count(*) FROM candidate_person cp
  JOIN person p ON p.slug = cp.person_slug WHERE p.person_id <> cp.person_id;

-- A2: NULL share must be small, not 100%
SELECT count(*) FILTER (WHERE person_id IS NULL), count(*) FROM declaration;

-- A3: split officeholders
SELECT count(*) FROM (
  SELECT translit_bg_latin(p.display_name), split_part(r.ref,':',2), r.role
  FROM person_role r JOIN person p USING (person_id) WHERE r.source='local'
  GROUP BY 1,2,3 HAVING count(DISTINCT r.person_id) > 1) x;
```
