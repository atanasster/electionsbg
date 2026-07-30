# Shared person-name links across local-elections screens + settlement-page cleanup

## Context

Starting point is the local-elections **settlement** page (`/local/:cycle/settlement/:ekatte`, e.g.
`/local/2023_10_29_mi/settlement/03229`), which needs two fixes:

1. **A redundant "← Тунджа" municipality back-link** under the place header — the parent município
   is already a link in the `PlaceHeader` location labels.
2. **Person names render as plain text.** They should link to `/person/:slug` — **only when that
   page exists** (an unambiguous active public figure).

The same "plain-text person name beside an `MpAvatar`" pattern repeats on ~15 local screens, so the
deliverable is a **shared person-name link**, applied first to the settlement page and rolled out
to the rest.

This revision incorporates a **performance + correctness audit** (below): the naive "resolve each
name with its own request" approach fans out to **264 requests on the national municipality list**
and ~130 on a município overview page. The chosen design resolves a whole page in **one** request.

## Audit findings that shaped the design

**Worst-case person names rendered eagerly on one page** (measured against `2023_10_29_mi`; no page
paginates or virtualizes these rows):

| Page | Component(s) | Worst-case names |
|---|---|---|
| National list `/local/:cycle` (+ region) | `DirectoryTable`/`SplitTable`/`IndependentsTable`, full `national.municipalities` | **264** |
| Município overview `/local/:cycle/:code` | kmetstva (96) + districts (24) + mayor race + top-8 councillors + timeline | **~130+** |
| `/local/:cycle/:code/council` | `TopCouncillorsTile` 8 eager; councillor lists lazy per party (up to 61 on expand) | ~69 |
| `/local/:cycle/:code/mayor` | `MayorTable`, all candidates | ~22–24 |
| Settlement dashboard | `LocalSettlementDashboardCards` + `LocalPlaceTrendsTile` | **~5–15** |

**Backend:** the existing single-name route `candidate-person` (`functions/db_routes.js:2745`) is
strictly one name/slug per request. A **batch** route is a small, safe addition — both lookup paths
batch against existing indexes with no schema/index change:
- **slug path** (`candidate_slug = ANY($1)`) uses `idx_candidate_person_slug`. Confirmed:
  `candidate_person` contains an `mp-{id}` row for every MP, in the **same id namespace** as the
  local records' `mpId`, and each slug is person-unique across cycles — so `mp-{mpId}` resolves
  precisely, with no namesake ambiguity. Prefer it whenever `mpId` is present.
- **name path** folds via the `IMMUTABLE` `translit_bg_latin`, probes `idx_candidate_person_name`,
  and preserves the >1-namesake NULL guard with a per-fold `count(DISTINCT person_slug)` window.

The pending uncommitted `db_routes.js` change is an unrelated hunk (~L2335, the `municipal-officials`
route) — adding a `candidate-persons` route will not conflict.

**Ingest-time stamping (the zero-request alternative)** is feasible but heavier: the local pipeline
has no Postgres, so a `personSlug` stamp must run inside the person pipeline after
`db:resolve:persons`; that resolver already walks these bundles but only for **elected** holders
(not all mayor/kmetstvo/district candidates), and it would add a regenerate-and-redeploy step on
every person re-resolve. Deferred — see the end.

## Architecture — runtime batch resolution

Mirror the established `useMunicipalOfficialsByName` "load-once, resolve synchronously" pattern
(`src/data/officials/useMunicipalOfficialsByName.tsx`) and the `MpAvatar` / `MpAvatarView`
connected-vs-presentational split.

### A. Batch endpoint — `functions/db_routes.js`

New route key `"candidate-persons"`. Input: a set of `slugs` (the `mp-{id}` records) and `names`
(the rest). Output: `{ bySlug: {slug: personSlug}, byName: {inputName: personSlug} }`. **Return the
verbatim input name** (not the fold) so the client — which cannot run `translit_bg_latin` — can key
its map by the exact string it sent. Reuse the audited SQL:

```sql
-- names → slug, namesake guard per fold, keyed by the raw input string
WITH q AS (SELECT DISTINCT n AS input, translit_bg_latin(n) AS fold FROM unnest($1::text[]) n),
     m AS (
       SELECT q.input, cp.person_slug,
              count(DISTINCT cp.person_slug) OVER (PARTITION BY cp.candidate_name_fold) AS n_persons
         FROM candidate_person cp
         JOIN person p ON p.slug = cp.person_slug
         JOIN q ON q.fold = cp.candidate_name_fold
        WHERE p.status = 'active' AND p.is_public_figure)
SELECT DISTINCT input, person_slug FROM m WHERE n_persons = 1;
-- slugs → slug (covers mp-{id} and c-…), person-unique so no ordering needed
SELECT DISTINCT cp.candidate_slug, cp.person_slug
  FROM candidate_person cp JOIN person p ON p.slug = cp.person_slug
 WHERE cp.candidate_slug = ANY($1::text[]) AND p.status='active' AND p.is_public_figure;
```

No new SQL function and no schema migration — so the only cloud step is `npm run deploy:db` (the
route lives in the `db` function).

**Transport — GET-only, verified (`functions/index.js:516-544`).** The `/api/db` dispatcher rejects
any non-GET with `405 "GET only"` (L529) and passes `req.query` to the route — nothing reads
`req.body`. So the batch **must ride in the GET query string**, and two hard limits follow:
- **URL length.** 264 URL-encoded Cyrillic names (~6 bytes/char) is ~30 KB — far over the ~8 KB
  practical cap. The batch **must chunk**: send `names=` in **deterministic, sorted groups of ~40**
  (≈7 requests for the 264-list, each chunk URL well under 8 KB). Sorting makes the chunk URLs
  stable, so the CDN (`s-maxage=3600`, keyed on the full query string, L576/L602) serves them for an
  hour. Send the `slugs=` list (`mp-{id}`, ASCII/short) as its own single chunk.
- **Rate limit — 120 req/IP/min (`DB_RATE_MAX`, L440).** ~7 chunk requests plus the page's other
  `/api/db` calls stay far under it. (This is also why **per-name** resolution on the 264-list is
  categorically out — it would fire 264 GETs in seconds and trip the limit into 429s.)

The `useCandidatePersons` hook owns the chunking + merge; call sites stay clean.

### B. Batch hook — `src/data/candidates/useCandidatePersons.ts` (new)

`useCandidatePersons(inputs: {name: string; mpId?: number | null}[])`:
- Dedup inputs; split into `slugs = mpId ? mp-${mpId}` and bare `names`; **sort**, then chunk
  `names` into deterministic ~40-name groups (per the GET URL-length limit above).
- One React Query **per chunk** (`useQueries`), `staleTime: Infinity`,
  `queryKey: ["candidate-persons", <sorted chunk>]` — deterministic keys → CDN + client cache hits,
  and distinct pages share overlapping chunks. Merge the chunk results into one lookup.
- Returns `resolve(name, mpId) => string | null | undefined` (undefined while any relevant chunk is
  loading, null = no public person). Prefer the `bySlug` hit when `mpId` is present, else `byName`.

### C. Components — `src/screens/components/person/`

- **`PersonNameLinkView`** (presentational): `{ name, slug, className }`. Renders
  `<Link to={`/person/${slug}`} className="hover:underline">{titleCaseName(name)}</Link>` when
  `slug` is a string, else `<span>{titleCaseName(name)}</span>`. No hooks. Used by every high-count
  page, fed from the page-level `useCandidatePersons` resolver (exactly how `ChmiFeedScreen`
  computes a per-row href from a once-loaded index).
- **`PersonNameLink`** (connected): `{ name, mpId?, className }`. Self-resolves via
  `useCandidatePerson` (one GET each) and delegates to `PersonNameLinkView`. **Only for pages that
  render well under ~40 distinct names** (settlement, `/mayor`, district table, council-on-expand,
  tiles) — one GET per name, no page wiring. Two components rather than one prop-toggled component
  keeps hook usage unconditional (the `MpAvatar`/`MpAvatarView` precedent).

  **The ~40-name ceiling is a hard rule, set by the 120-req/min rate limit** (a page's connected
  links each cost one GET and share the budget with its other `/api/db` calls). Any page above it —
  the 264-mayor national list, the ~130-name município overview, the 96-row kmetstva table — **must**
  use the batched `useCandidatePersons` + `PersonNameLinkView`, never the connected variant.

### D. Resolver refactor — `src/data/candidates/useCandidatePerson.ts`

Convert the hand-rolled `useState`+`fetch` to React Query (`queryKey: ["candidate-person", id]`,
`staleTime: Infinity`), preserving the exact tri-state contract (`undefined`/`null`/slug). This
gives the connected `PersonNameLink` dedup/caching and leaves the two existing consumers
(`CandidateScreen.tsx:17`, `CandidateProfileHeader.tsx:52`) unchanged.

## Change 1 — remove the "← Тунджа" back-link

**File:** `src/screens/LocalSettlementDashboardScreen.tsx`. Delete the `extra={…}` prop on
`<PlaceHeader>` (lines 48-57) and the now-dead code it was the sole consumer of: `muni`/`muniName`
(31-34), `findMunicipality` + `useMunicipalities` import (12, 21), `Link` import (9). The obshtina
stays reachable via `PlaceHeader`'s existing `muniHref`.

## Change 2 — settlement page (the original request), connected variant

Low count (~5–15), scattered across sub-cards — use the connected **`PersonNameLink`** (no page
wiring). Swap the four plain-text sites, name text only (leave `MpAvatar`, party dot, votes):

1. Mayor-per-cycle strip — `dashboard/local/LocalPlaceTrendsTile.tsx:68-72` (keep
   `? … : w.localPartyName`; `PlaceMayorWinner` has no `mpId`, so name-only).
2. Kmetstvo candidate rows — `LocalSettlementDashboardCards.tsx:84` (`MayorCandidateRows`).
3. "Предишни избори" winners — `LocalSettlementDashboardCards.tsx:218` (`KmetstvoMayorCard`).
4. Parent-município mayor ("СЪВЕТИ → Община → КМЕТ") — `LocalSettlementDashboardCards.tsx:302`.

Council figures on this page are party-level (no named councillors) — nothing to link.

## Change 3 — high-count pages, batched variant

For each screen: build the `{name, mpId}` list from the data it already holds, call
`useCandidatePersons(...)` **once** at the screen level, then render `<PersonNameLinkView name
slug={resolve(name, mpId)} />` per row. **One request per page**, 264 names included.

- `src/screens/LocalMunicipalityListScreen.tsx` — enumerate `filtered.map(r =>
  r.electedMayor)`; swap L100-103 (`MayorCell`) and L294-300 (table body). **The 264-name page —
  the headline win of the batch design.**
- `src/screens/LocalElectionScreen.tsx` — the município overview + `/mayor` + `/council` all read
  one `LocalMunicipalityBundle`; enumerate mayor round1/round2/elected, `kmetstva[].winner`,
  `districts[].winner`, and (on `/council`) the elected councillors + top-8. Swap the plain-text
  sites: L166 & L1644 (mayor stat items, name-only), L272-279 (`MayorTable`), L376-377
  (`CouncilPartyRow` elected list; field `c.name`), L548-555 (`KmetstvoMayorsTable`), L661-668
  (район mayors), L771-776 (embedded by-elections table). Councillor lists resolve lazily on expand
  — either seed them into the same batch up front, or let the connected `PersonNameLink` cover the
  expand-only rows (small per-party counts).
- Dashboard tiles under `src/screens/dashboard/local/` fed by the same bundle: `TopMayorsTile.tsx`
  L82-90, `LocalMunicipalityExtras.tsx` L147-155 (`TopCouncillorsTile`, field `c.name`, capped 8),
  `LocalMayorTimelineTile.tsx` L96-102, `LocalMidtermComparisonTile.tsx` L168 (name-only). Low-count
  tiles (`LocalMayorRunoffBar` L39/L52 — keep the L62 `aria-label` plain; map hovers
  `LocalRegionMapTile`/`LocalSofiaRayonMapTile`) may use the connected variant.

## Sites to evaluate separately (NOT a blind swap)

- **Nested in a non-person `<Link>`** — would nest anchors: `LocalLeaderTiles.tsx:77-81`,
  `LocalExtraordinaryTile.tsx:73-77` (name already inside a `/local/:obshtinaCode` link). Decide
  per tile which link wins; do not nest.
- **Different resolver** — `ChmiFeedScreen.tsx:184-217`, `MyAreaKmetstvoTile.tsx:112-119` already
  resolve to `/candidate/` or `/officials/` via `findMpById`/`findOfficialByName`. `PersonNameLink`
  could slot into their currently-plain else-branch, but that changes their behaviour — follow-up.
- **Already `/candidate/` or `/person/` links (EXCLUDE):** `TopCandidatesStrip`,
  `PartyTopCandidatesTile`, `PreferencesTable`/`CandidateLink` (all `candidateUrlFor`).

## Correctness notes

- `mp-{mpId}` resolution is person-precise (unique across cycles); the name path keeps the exact
  namesake guard, so an ambiguous name renders plain text — never a wrong-person link.
- If a baked/resolved slug later goes stale, `person_slug_redirect()` 301s it to the surviving
  person (migration 103 + `collapse_slug_chains`), so links degrade gracefully.

## Verification

1. `npm run dev`, open `/local/2023_10_29_mi/settlement/03229?elections=2026_04_19`: "← Тунджа"
   gone, Тунджа still clickable in the header; mayor names link to `/person/:slug`; a no-public
   name stays plain text (no dead link).
2. Open `/local/2023_10_29_mi` (national list) and a large município overview (`…/SOF`): confirm the
   Network tab shows a **handful of chunked** `candidate-persons` GETs (~7 for the 264-list, sorted
   query strings), **no per-name fan-out, and no 429s**; 264 / 130 names resolve; scroll stays
   smooth. Reload and confirm the chunk GETs are served from cache (deterministic query strings).
3. `EXPLAIN ANALYZE` both batch queries with the worst-case input (a 40-name chunk / the full Sofia
   bundle) against Postgres — confirm index scans on `idx_candidate_person_name` /
   `idx_candidate_person_slug`, per the DB-perf playbook.
4. `npm run lint` + typecheck via `npm run build` (plain `tsc --noEmit` checks nothing here) — also
   catches the removed-import cleanup in Change 1.
5. Sanity-check the two existing `useCandidatePerson` consumers after the RQ refactor:
   `/candidate/mp-…` and a bare-name `/candidate/<name>`.

## Deploy / ops

- `deploy:db` (route lives in the `db` function) **before** any hosting deploy that depends on it.
  No SQL migration — the route reuses existing functions/indexes.
- No data regeneration, no cloud-side reload wiring, no staleness window (unlike option C).

## Deferred alternative — ingest-time `personSlug` stamp (zero requests + SEO)

A PG-backed decorate step after `db:resolve:persons` (template: `decorate_local_mp_links.ts`, but
querying `candidate_person`) would bake `personSlug` into the local JSON — zero runtime requests and
prerenderable person links for SEO. Costs: extend coverage beyond elected holders, a new pipeline +
cloud reload hook (else prod links go stale — the "migrated-family watch reload" class), larger
JSON, and regenerate-and-redeploy on each person re-resolve. Revisit only if person links need to be
in the static HTML for SEO or the one-request-per-page ever proves too chatty.

The GET-only + URL-chunking friction confirmed above does raise C's appeal **specifically for the two
huge pages** (national list, município overview): baking their slugs sidesteps chunking, the URL cap
and the rate limit entirely. A reasonable escalation path is to ship the runtime batch first (it
covers every page uniformly) and only move the two huge pages to baked slugs later if the chunked
GETs prove unsatisfactory — the `PersonNameLinkView` call sites don't change, only where the slug
comes from.
