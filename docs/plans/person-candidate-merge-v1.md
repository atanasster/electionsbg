# Person ← Candidate merge (v1)

Merge the per-election **candidate page** into the identity-first **person page** so there
is one dashboard for a human — electoral performance, offices, companies, NGOs, procurement,
EU funds, subsidies, donations, declarations, connections, and integrity flags. Both
`/person/:slug` **and** `/candidate/:id` render the **same** shared dashboard component; the
candidate URLs are kept (no redirect) because they are the biggest organic-traffic draw.

Status: SHIPPED (all 5 phases). Prereqs: person-identity v1
(`docs/plans/person-identity-v1.md`) is live — `person_id`, `person_role`, `person_by_slug`,
`person_connections`.

**Deltas from plan (as built):**
- Money split: funds + subsidies fold into `person_by_slug` (cheap EIK point-joins, ~6ms
  warm); the cabinet-tenure procurement timeline is a separate lazy `person_money()` /
  `/api/db/person-money` (heavier range-join kept off the hot path). No `party_num` in the
  `person_election_stats` PK — a seated MP's dual mp/c shard is deduped to the slug-party row.
- Bug fixed en route: `person_by_slug` summed `current_amount_eur` (2%-populated, vestigial);
  switched all sums to `amount_eur WHERE tag='contract'` (078 basis) — mp-2946 4602 → 1.39M.
- Electoral block: reuses the candidate stat cards via an extracted pure
  `computeCandidateSummary` reducer; PG source `usePersonElections`; cycle selector on
  `?pelect=` (defaults to global `?elections=`).
- Deferred: MP voting scorecard + assets/declarations tiles on the merged page (follow-up);
  DashboardSection grouping of the non-electoral sections (kept as Cards).

## Decisions (locked)

1. **Multi-election** — the electoral block carries its own election selector; it defaults
   to the global header selector (`?elections=`). Switching it re-anchors the block only
   (it does not have to hijack the global date — see the selector-contract section).
2. **Sub-page scope (v1)** — the 9 candidate drill-down sub-pages
   (`/candidate/:id/{regions,municipalities,settlements,sections,donations,connections,
   assets,procurement,funds}`) stay as-is; they are election-scoped, so the shared dashboard
   links *into* them rather than absorbing them.
3. **New plumbing** — include **all** money joins in v1: extend `person_by_slug` with EU
   funds (ИСУН), agri subsidies (ДФЗ), and cabinet-tenure-bucketed procurement.
4. **Design language** — the whole page adopts the `StatCard` / `DashboardSection`
   dashboard idiom and drops `max-w-4xl` (homepage dashboard shell, no tabs).
5. **Shared component, no redirect (SEO)** — `/candidate/:id` keeps its URL and its SEO
   value; it resolves its slug → `person_id` and renders the identical `<PersonDashboard>`
   component. No forced redirect. `/person/:slug` renders the same component. One component,
   two entry routes.
6. **Migrate, don't compose** — re-key the electoral data by `person_id` in Postgres instead
   of fetching name-folder-keyed static shards at render time (the name folders collide on
   namesakes — the error-prone part). The migration also builds an explicit
   candidate-name/slug → `person_id` lookup used to resolve `/candidate/:id`.

## What the merge unlocks (why it's a dedup, not a concat)

The candidate page's MP add-ons — `MpManagementRoles`, `MpConnectionsMini`,
`MpAssetsSummary`, `MpConnectedContractsTile`, `MpConnectedFundsTile` — are **name-keyed**
(the weaker join). The PG person layer computes companies / procurement / connections
**EIK-exact**. The merge lets us delete the name-keyed variants and keep PG as the single
source of truth. Division of labor:

| Concern | Source | Keying |
|---|---|---|
| Identity, offices, companies + procured €, NGOs, connections, sanctions/ДС/regulators, donation count | PG `person_by_slug` / `person_connections` | `person_id`, EIK-exact |
| **NEW** EU funds, agri subsidies, cabinet-timed procurement | PG `person_by_slug` (extend) | person→`tr` EIK graph |
| Electoral dashboard — preferences, paper/machine, regions, trajectory, settlements/sections, financing | **migrated to PG** (`person_election_stats`), was `useCandidateSummary` shards | `(person_id, election)` |
| Voting scorecard, roll-call loyalty, committees, **declared-asset figures** | parliament data (`useMp*`) | MP id / name |

## Information architecture

Drop `max-w-4xl`; render the homepage dashboard shell. Facet-driven — every section hides
when empty, so a pure businessperson never sees an electoral block. No tabs; stacked
`DashboardSection`s.

- **Identity band** (always) — `MpAvatar`, name, facet chips, aliases + an at-a-glance KPI
  strip: last-cycle preferences · offices held · companies · lifetime € procured ·
  connections · risk-flag count.
- **Pinned flags** (if present, top) — Sanctions (OFAC/EU) and ДС/COMDOS, behind CITED
  evidence. Keep pinned as today.
- **1. Изборно представяне** *(has candidacies / MP)* — election selector (default =
  header `?elections=`); always-on cross-election **trajectory** tile; then for the
  selected cycle: the 4 stat cards (prefs, paper/machine, list pos, top region) + regions
  table + top settlements/sections; MP scorecard + roll-call + committees if seated; local
  council/mayor results if `local`. Deep-links go to `/candidate/:id/*` sub-pages.
- **2. Длъжности и мандати** — offices (mp/official/magistrate/local) as a timeline +
  regulator seats ("кой решава").
- **3. Бизнес и организации** — companies (TR roles, per-company procured €) + NGO boards.
- **4. Публични пари** *(differentiator)* — money-footprint KPIs (€ procured · EU funds ·
  subsidies · donated · declared assets) + procurement bucketed by office tenure
  (`person_by_cabinet`, the "money vs power" timeline) + connected-contracts/funds detail +
  donations given.
- **5. Имущество и декларации** — declared asset/income figures + interest declarations.
- **6. Свързани лица** — `person_connections` graph.
- **Footer** — disambiguation disclaimer. Name-bridged (Bridge B, unique-name) money
  attribution is visually distinguished from EIK-exact; "насока, не доказателство" framing
  stays prominent (defamation surface grows with density).

Facet → sections: businessperson = 3,4,5,6; magistrate = 2,3,4,6 + declarations;
politician = all.

## The election-selector contract (§ decision 1)

The electoral block reads its cycle from a local `electionOverride` that **initializes from
`?elections=`** (the global `ElectionContext.selected`). Behavior:

- Default: block shows the person's performance in the globally selected election. If the
  person was not a candidate that cycle, fall back to their most-recent candidacy and show a
  one-line note; the trajectory tile is always full-history regardless.
- The block's own selector lists only the person's actual candidacy cycles (from
  `roles.filter(source==='candidate')`, deduped by election). Picking one sets the local
  override.
- Follow the `cabinetAnchorContext` precedent for a local override that seeds from a global
  URL param but can diverge. Do **not** mutate the global `?elections=` on in-block switch
  (that would ripple to the whole app); encode the block cycle in a dedicated param if we
  want it shareable — proposed `?pelect=YYYY_MM_DD` (omitted when it equals the global
  selector). Reuse the shared Radix `Select` / `PackSelect` (no native `<select>`).

## Backend changes

### 4a. Candidate → person_id lookup (resolves `/candidate/:id`)
The `/candidate/:id` route must resolve any candidate URL form (`c-{party}-{slug}`,
`mp-{id}`, legacy bare name) to a `person_id`/`slug` to mount the shared dashboard. The
mapping already exists implicitly in `person_role` (`source='candidate'`, `ref='{election}:
{slug}'` → `person_id`) plus `person_alias` for bare names — but the migration (§4c) also
materializes an explicit, indexed **`candidate_person`** lookup so resolution is O(1) and
covers every historical slug/name form in one place:

```
candidate_person (
  election_date date, candidate_slug text, candidate_name_fold text,
  party_num int, person_id bigint, person_slug text )
  -- unique (election_date, candidate_slug); index (candidate_name_fold, party_num)
```

Serve via `person_by_role(p_source, p_ref)` (existing `idx_person_role_source_ref`) or a
thin `candidate_to_person(slug|name)` fn over `candidate_person`. Route:
`GET /api/db/person-by-role?source=candidate&ref=…` in `functions/db_routes.js` +
`vite/db-api.ts`.

**Namesake disambiguation** — the slug path (`c-{party}-{slug}`) is already unique because
the slug embeds `party_num`. For the **name** path (legacy bare-name candidate URLs), a
folded name alone can hit several distinct politicians, so resolution keys on
`(candidate_name_fold, party_num)` — the party disambiguates same-name politicians. Where a
bare-name URL carries no party, fall back to the existing namesake chooser rather than
guessing.

### 4b. Extend `person_by_slug` with all money joins
In `scripts/db/schema/pg/082_person_api.sql`, add LATERAL joins over the person's `tr` EIK
set:
- **EU funds** — `fund_beneficiaries` / `fund_projects` on `eik` → per-company + total
  `fundsEur`, project count.
- **Agri subsidies** — `agri_subsidies` on `eik` (legal entities only; individuals carry no
  EIK) → per-company + total `subsidiesEur`.
- **Cabinet-timed procurement** — fold `person_by_cabinet` output (procurement bucketed by
  the person's own office tenure) into the payload, or expose a sibling
  `/api/db/person-money?slug=` if it bloats the profile blob (decide by EXPLAIN — keep
  `person_by_slug` under the ~5ms budget; per `reference_pg_query_performance` run EXPLAIN
  ANALYZE on the worst-case entity, e.g. a person tied to АПИ-scale EIKs).

### 4c. Migrate electoral data to PG, keyed by person_id
Re-key the electoral summary from name-folder shards to Postgres. New table + serving fn:

```
person_election_stats (
  person_id bigint, election_date date,
  party_num int, party_nick text, party_color text,
  total_votes int, prior_total_votes int, delta_votes int, delta_pct numeric,
  pct_of_party_prefs numeric, party_prefs int,
  paper_votes int, machine_votes int, paper_pct numeric, delta_paper_pct numeric,
  regions jsonb,           -- CandidateRegionRow[] (per-oblast prefs/list-pos/deltas)
  top_settlements jsonb, top_sections jsonb,
  primary key (person_id, election_date, party_num) )
```

`party_num` is in the PK so a person who ran on two lists in the same cycle (rare but real)
doesn't collapse into one row — same as the party-keyed lookup above.

Populated by a migration script that reads the existing
`data/{election}/candidates/{name}/{preferences_stats,regions}.json` shards, resolves each
name folder → `person_id` **through `candidate_person`** (fixing the namesake collisions the
name folders can't), and COPY-loads the rows (`lib/copy.ts`, text format). Serve
`person_elections(p_person_id)` → `person_election_stats[]` (all cycles, newest first) and/or
fold the selected cycle into the profile. This retires `useCandidateSummary`'s static fetch;
the granular sub-page shards (settlements/sections drill-downs) stay slug-addressed for the
`/candidate/:id/*` sub-routes.

Wire the new fields into the `PersonProfile` / a `PersonElections` type. Register the migrated
dataset in `recent_updates` (`feedback_pg_changelog_required`).

## Frontend changes

- **One shared component, two routes** — extract `<PersonDashboard personId|slug>`. Route
  `/person/:slug` resolves by slug; route `/candidate/:id` resolves the candidate slug →
  `person_id` (§4a) then renders the **identical** component. `/candidate/:id` keeps its URL,
  SEO title/description, and sitemap entry. No redirect.
- **Adopt dashboard idiom** — render the PG person sections as `StatCard` / `DashboardSection`
  (currently raw `Card` list). Drop `max-w-4xl`; use the homepage shell. Reuse `MpAvatar`,
  `useTooltip`, shared `Select`/`PackSelect`, formatters.
- **Electoral block from PG** — feed the 4 stat cards + regions table + trajectory from
  `person_elections` (PG), not `useCandidateSummary`. Selected cycle from the block's own
  selector (defaults to `?elections=`; own `?pelect=` param — see selector contract).
- **Delete the name-keyed duplicates** — remove `MpManagementRoles`, `MpConnectionsMini`,
  `MpAssetsSummary`, `MpConnectedContractsTile`, `MpConnectedFundsTile` from the shared
  surface; PG supersedes them. (They may remain on standalone `/candidate/:id/*` sub-pages.)
- **Candidacy chips → cycle switcher** — the "Кандидатури" chips become the electoral-block
  cycle selector instead of outbound links.

## Candidate link inventory (verified — all preserved)

~60 files link to candidates, but the URL vocabulary is fully centralized in
`src/data/candidates/candidateSlug.ts` (`candidateUrlFor` → `candidateUrlForMp` /
`candidateUrlForCik` / `candidateUrlForName`) and the `CandidateLink` component. Every link
site routes through one of those, so **no link site changes** — decision 5 keeps
`/candidate/:id`, only what renders under it changes. The three URL forms map to resolution
tiers:

- `mp-{id}` — always resolvable (gold key), unambiguous.
- `c-{party}-{name}` — resolvable via `(party_num, candidate_name_fold)` — the party
  disambiguates same-name politicians. This is the common case.
- bare name (`candidateUrlForName`) — the only fragile form: no party, folded name may hit
  several people → **keep the existing `CandidateNamesakeChooser`** as the fallback. Do not
  guess.

Keep all candidate links for now (per decision). The migration must therefore populate
`candidate_person` for **every** historical `(election, slug)` so no existing link dead-ends.

## SEO / entry routes (no redirect)

- Both `/person/:slug` and `/candidate/:id` render `<PersonDashboard>`; the candidate URLs
  are the primary organic-traffic draw and are **preserved**. `/candidate/:id` keeps its own
  SEO `<title>`/description (candidate-framed) even though the body is the shared dashboard.
- The 9 sub-routes keep rendering the standalone election-scoped drill-down screens
  (decision 2); the dashboard links into them.
- Person-slug prerender/sitemap (person-identity Phase 6) is still worth doing for the
  `/person/:slug` canonical, but it is **no longer gating** the merge — nothing redirects, so
  candidate SEO cannot regress.
- **KZK** — reachable only via the awarder (`buyer_eik`), not the person; excluded by design.

## Phasing

1. **Lookup + migration** — build `candidate_person` + `person_election_stats` migration;
   `person_by_role` / `candidate_to_person` fn + route. Validate `person_id` re-keying vs the
   old name folders (namesake spot-checks). Register in `recent_updates`.
2. **Money joins** — extend `person_by_slug` with funds / subsidies / cabinet-timed
   procurement (EXPLAIN-gated; split to `/api/db/person-money` if over budget).
3. **Shared dashboard redesign** — extract `<PersonDashboard>`, dashboard shell, StatCard
   sections, money-footprint KPIs, pinned flags, connections. Mount on `/person/:slug`.
4. **Electoral block** — PG-fed stat cards + regions + trajectory + election selector
   (`?pelect=`); candidacy chips as switcher; MP scorecard/voting. Delete the name-keyed MP
   duplicates.
5. **Candidate route swap** — `/candidate/:id` resolves → `person_id` → renders
   `<PersonDashboard>` (candidate-framed SEO tags preserved). Fall-through guard if a slug
   fails to resolve.

## Risks / watch-outs

- **Defamation surface** grows with density — keep the namesake disclaimer, the confidence
  gate (`exact_id`/`high`/`manual` only), and Bridge-B (name-only) money attribution
  visually flagged as indicative.
- **Migration correctness** — the whole point is fixing name-folder namesake collisions;
  validate that per-person electoral totals reconcile against the old shards for a sample of
  both unique and colliding names before cutting over.
- **Two backends on one page** — PG (live) + parliament shards (`useMp*`, static). Loading
  states must be independent so a slow PG call doesn't block the voting/scorecard blocks and
  vice-versa.
- **Blob bloat** — if funds+subsidies+cabinet push `person_by_slug` over budget, split money
  into `/api/db/person-money`. Decide by EXPLAIN ANALYZE, not by feel.
- **PG changelog** — per `feedback_pg_changelog_required`, the migrated electoral dataset and
  any new person-money dataset surfaced here must wire into `recent_updates`.
