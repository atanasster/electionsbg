# Person page: election results + voting redesign

**Status:** design/plan only — no code changed. **Author's note:** written from a live
codebase audit (2026-08-25), not from memory; every file/line cite below was re-verified
against the current tree, not against docs/plans references.

## 1. What this fixes

The person profile page (`/person/:slug`, `/candidate/:id` — both render the identical
`PersonDashboard`/`PersonDashboardBody` in `src/screens/person/PersonProfileScreen.tsx`) has
two problems today:

1. **The election-results block reads as a clean card for a sparse candidate and as a dense
   spreadsheet for a prolific one.** It is genuinely ONE component
   (`PersonElectoralSection.tsx`) built from the same `StatCard`-based tiles throughout — the
   density difference is a pure data-volume artifact (`CandidateRegionsTile` caps at 10 rows
   in a tight grid, `CandidateHistoryChart` draws one bar-group per cycle with no ceiling), not
   two different designs. An MP with 8 candidacies across many provinces gets the identical
   markup as a local candidate with one, and it shows.
2. **"Гласуване в парламента" (parliament voting) sits far from the election results it
   explains**, after offices, wealth trajectory, accumulation gap, cohort benchmark, stake
   procurement, and declaration events (`PersonProfileScreen.tsx:558-594`). A reader who just
   learned how someone got elected has to scroll past six unrelated sections to see how they
   then voted.
3. **A mayor/councillor's actual election performance and voting record are invisible.**
   `person_role.source === 'local'` produces exactly one line in the offices list — a title and
   a link out to `/local/:cycle/:obshtinaCode` — and nothing else. There is no card showing
   preferences received, list position, or (this is the part that actually matters, see §4) how
   they voted once seated. For someone who has been BOTH a councillor/mayor and later an MP (or
   the reverse), the page today shows one office-tenure line for the local seat and a full
   national block for the parliamentary one — no shared shape, no sequencing logic.

A mockup of the target layout — two clearly labelled career tracks, each pairing its own
election-results card directly with its own voting card — was shown inline in this
conversation.

## 2. What's already there vs. what's genuinely new

This matters for scoping: **the local voting card (§4) needs almost no backend work.**
Migration `161_council_serving.sql` already ships `council_councillor(p_person_id bigint)`
(`scripts/db/schema/pg/161_council_serving.sql:368-459`) — councilCode/councilName, votes/
for/against/abstain, against-majority dissent metrics, a `recent` array of up to 20 resolution
rows, and the same `attendanceBasis`/`dissentBasis` caveat-string pattern `useMpLoyalty`
already uses. It's wired at `functions/db_routes.js:5934-5949` as `/api/db/council-councillor`.
**Nothing on the frontend calls it, and no person-page component renders it.** Its own SQL
comment (`161_council_serving.sql:363-367`) says outright: *"What CouncilActivitySection was
meant to be, keyed on person_id … Reachable from /person."* This plan is largely that comment,
finished.

By contrast, **local election RESULTS (preferences received, list position) have no
person_id-linked home in Postgres at all** — only the win (via `person_role`) is known. That's
a real data-pipeline gap, scoped separately in §6 rather than blocking the rest.

## 3. Tier 1 — Redesign the election-results block (visual only, zero new data)

Target: `PersonElectoralSection.tsx` and its tiles
(`src/screens/dashboard/cards/Candidate*.tsx`, `CandidateRegionsTile.tsx`,
`CandidateHistoryChart.tsx`/`CandidateTrajectoryTile.tsx`, `CandidateTopSettlementsTile.tsx`,
`CandidateTopSectionsTile.tsx`). All already sit on the `StatCard`/`DashboardSection`
foundation (`src/screens/dashboard/StatCard.tsx`, `src/screens/dashboard/DashboardSection.tsx`)
— the fix is inside the dense tiles, not a new visual system.

- **`CandidateRegionsTile`** (provinces table): keep the current columns, but cap visible rows
  at ~4-5 with the same top-N + "виж всички (N)" pattern already established in this codebase
  (`IVSS_FILINGS_SHOWN`/`IvssFilings` in `PersonDeclarations.tsx`, and
  `PersonMagistrateHoldingsTile`'s `FILINGS_SHOWN`) — don't invent a fourth pagination idiom.
  Bump the row height and font size a step so a 1-2 row case (a local list candidate) reads as
  spacious, matching the target mockup, rather than shrinking a 10-row case to fit.
- **`CandidateHistoryChart`**: no cap needed (a bar chart degrades more gracefully than a
  table), but add a highlighted "current" bar and a hover/tap tooltip with the exact cycle
  date + count, since dense multi-cycle charts currently rely on axis labels alone.
- **`CandidateTopSettlementsTile` / `CandidateTopSectionsTile`**: same top-N + expand
  treatment as the regions tile; consider the two-column side-by-side layout from the mockup
  (settlements | sections) instead of two full-width stacked tables, so both fit above the fold
  on a typical viewport even at 10+10 rows.
- Keep `CandidatePreferencesCard`/`CandidatePaperMachineCard`/`CandidateBallotCard`/
  `CandidateTopRegionCard` as-is — they're already the clean-card baseline everything else
  should match.

This tier is a pure UI change: no new hooks, no new routes, no schema. Existing component
tests (`CandidateRegionsTile.test.tsx` etc. — verify exact filenames at implementation time)
need updating for the new row cap/expand behavior; no data-shape changes.

## 4. Tier 2 — Move parliament voting up, restyle to match

- In `PersonProfileScreen.tsx`, move the `PersonMpSections` render call
  (currently `:588-594`) to immediately after `PersonElectoralSection` (currently `:468-472`)
  — before the offices section, wealth trajectory, accumulation gap, cohort benchmark, stake
  procurement, and declaration events. `id="parliament"` (set by `MpVotingSection`) is an
  anchor-based deep link, not index-based, so reordering is safe for existing `#parliament`
  links (verify no code assumes a specific DOM position rather than the id).
- `MpVotingTile.tsx`/`MpDissentsSection.tsx` already use the `StatCard`/loyalty-percentage
  visual language the mockup follows closely (loyalty %, a compact votes/with/against row, a
  "voted against the group" preview list, a recent-sessions list) — this tier is mostly
  re-ordering plus a light pass to tighten spacing/typography to match Tier 1's refreshed
  election cards, not a rebuild.
- `PersonMpSections` is gated on `mpId` (from `useMpEntry`/`CandidateMpProvider`), a DIFFERENT
  identity axis from the `slug`/`person_id` the rest of the profile uses — leave that gate
  exactly as-is; only the render POSITION moves.

## 5. Tier 3 — New: council voting card for local officials

- **Frontend hook**: `useCouncilCouncillor` (new, `src/data/council/` alongside the existing
  `useCouncilHub.tsx`), calling `/api/db/council-councillor`.
- **⚠️ Concrete gap to close first**: the route takes `personId` (a numeric id), but
  `PersonProfile` (`usePersonProfile.ts:94-121`) carries only `slug` — no numeric person_id
  reaches the client anywhere on this page today (unlike `usePersonDeclarations`, which is
  already slug-keyed via `/api/db/person-declarations?slug=`). Don't expose a raw internal id
  on a public payload to work around this — add a slug-resolving variant instead, matching the
  pattern already used elsewhere on this page: either a thin `council_councillor_by_slug(text)`
  SQL wrapper, or have the `council-councillor` route resolve `slug → person_id` itself before
  calling the existing function body. Either is a small, additive change; no migration to the
  already-shipped 161 function itself.
- **New component**: `CouncilVotingTile`/`CouncilVotingSection` (mirroring
  `MpVotingTile`/`MpVotingSection`'s file split), rendering: council name, loyalty-style
  votes/for/against/abstain row, the against-majority dissent list (from the `recent` array),
  and the `attendanceBasis`/`dissentBasis` caveat strings the payload already carries — those
  captions are not optional trim; this repo's convention (declared-wealth captions, `declared_
  label()`, etc.) is that a derived-metric caption ships with the metric, not as a follow-up.
- **Gating**: mount for any person carrying a `person_role` with `role === 'councillor'` (or
  the equivalent local-elected role value — confirm the exact enum at implementation time; the
  offices list already reads this same field via `foldOffices`, so no new classification logic
  is needed, only a new consumer of it).

## 6. Tier 4 — Sequencing for a person with both a local and a national career

Per-track layout (results card, then that track's voting card directly beneath it) is
symmetric for local and national — the only new logic is **which order the tracks render in
when a person has both**.

- **Recommendation: chronological, earliest first**, consistent with the existing
  `foldOffices`/`mergeRuns` convention (`src/screens/person/offices.ts:56-61`, which already
  sorts office spans ascending by start date) — don't introduce a second, differently-ordered
  convention on the same page for the same underlying `person_role` data.
- **Each track gets its own header** (a small pill — "Местни избори" / "Парламентарни
  избори" — plus the role title and date range), never a blended chronological feed of
  individual votes/cycles across both bodies. This is deliberate, not a placeholder: a
  councillor's resolution and an MP's roll-call vote are not comparable units, and interleaving
  them by raw date would read as one continuous voting record when it is two different bodies
  with two different loyalty baselines.
- **Degrades cleanly to today's page for the common case**: a pure MP with no local service
  renders exactly the national track (Tier 1 + Tier 2 content), byte-identical in spirit to
  today's page, just reordered and restyled. A pure councillor/mayor with no national candidacy
  renders exactly the local track. Only someone with both gets two track headers — this must
  not become chrome that appears for everyone "just in case."

## 7. Tier 5 (follow-on, not blocking 1-4) — local election RESULTS data bridge

The mockup's local-track results card ("Преференции 1,240 · 18.4% от бюлетините",
"Позиция в листата #4") shows data that **does not exist as a `person_id`-linked query
today** — confirmed in the audit: no `data/{date}/candidates/` shard tree exists for any
`_mi`/`_chmi` election date (only the 13 national-parliamentary dates do), and
`person_election_stats` (the table `PersonElectoralSection` reads) is loaded exclusively from
those national shards.

What exists instead: per-município candidate rankings in `data/<cycle>/municipalities/
<obshtinaCode>.json` (mayor R1+R2, council party breakdown — see the "Local-elections routes"
section of `CLAUDE.md`), keyed by candidate NAME within that município, with no `person_id`
bridge. Building the local-results card for real needs, roughly:

1. A name→person_id matching pass over the local-candidate shards, almost certainly reusing
   the SAME fold/bridge machinery `official_candidate_link` (migration 108) and the TR-owner
   bridge already use elsewhere in this repo, rather than inventing a fifth matcher (see
   CLAUDE.md's repeated warnings about that class of defect).
2. A new small serving table/function analogous to `person_election_stats`, scoped to local
   candidacies, with its own loader (`db:load:*:pg` + `:cloud` twin, per this repo's every-
   migration-needs-an-applier convention).
3. Its own data test, its own `REFRESH_EXCLUSIONS`/`db:refresh` wiring decision (local-election
   shards are committed, unlike most gitignored inputs this file warns about, so this is
   likely an in-chain loader, not an excluded one — confirm at implementation time).

**Recommendation: scope this as its own follow-on plan**, separate from Tiers 1-4. It is a
real backend/data project with its own migration, loader, and test surface — not a UI
redesign task — and Tiers 1-4 deliver the bulk of the visible improvement (a mayor's own
VOTING record, via the already-built `council_councillor()`, is more informative than a bare
vote count would be on its own) without waiting on it. When it ships, the local-track results
card slots into the SAME layout Tier 4 already establishes — no rework of the sequencing or
track-header logic.

## 8. Suggested build order

1. Tier 1 (election-results redesign) — biggest visible win, zero data risk, ships alone.
2. Tier 2 (move + restyle parliament voting) — small, mostly a cut-and-paste of render order
   plus a styling pass; pairs naturally with Tier 1 since both touch the same page region.
3. Tier 3 (council voting card) — new hook + component + the slug-resolution adapter; the
   PG side is a two-line addition on top of already-shipped work.
4. Tier 4 (dual-track sequencing) — thin composition logic in `PersonProfileScreen.tsx` tying
   1-3 together; naturally follows once both track types exist independently.
5. Tier 5 (local results data bridge) — separate plan, scheduled independently.

Each tier is independently shippable and testable; none blocks the others except that Tier 4
needs both Tier 2's national track and Tier 3's local track to exist first.
