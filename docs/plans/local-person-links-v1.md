# Shared person-name links across local-elections screens + settlement-page cleanup

## Context

Starting point is the local-elections **settlement** page (`/local/:cycle/settlement/:ekatte`, e.g.
`/local/2023_10_29_mi/settlement/03229`), which needs two fixes:

1. **A redundant "← Тунджа" municipality back-link** under the place header — the parent município
   is already a link in the `PlaceHeader` location labels.
2. **Person names render as plain text.** They should link to a person profile — **only when one
   exists**.

The same "plain-text person name beside an `MpAvatar`" pattern repeats on ~15 local screens, so the
deliverable is a **shared person-name link**, applied first to the settlement page and rolled out to
the rest.

> **This plan was rewritten after two audits.** The first (performance) killed the naive per-name
> approach for the 264-mayor national list. The second (correctness) found the resolver itself was
> **wrong**: it targeted `candidate_person`, which is **parliamentary/EP-only** and returns NULL for
> local officials. The correct, already-in-use resolver is the **municipal-officials name index**
> plus the on-record `mpId` — the exact pattern `ChmiFeedScreen` and `MyAreaKmetstvoTile` use today.
> That choice also **eliminates all the runtime machinery** (no batch endpoint, no GET chunking, no
> rate-limit exposure): `mpId` is already on each record, and the officials lookup is one cached
> bulk fetch.

## Audit findings that define the design

**Resolver correctness.** `candidate_person` is loaded only from `data/2*/candidates/by-slug`
(`load_person_elections_pg.ts:133`) — 10 national/European-Parliament cycles, **zero** `_mi`/`_chmi`
dirs. So `candidate_person_by_name('<a local mayor who never ran for parliament>')` → **NULL**. The
municipal-officials index resolves those people instead:

| Person | `candidate_person_by_name` | `findOfficialByName` (chosen) |
|---|---|---|
| Current obshtina mayor / councillor, never in parliament | NULL | **hit** (296 mayors, 4,822 councillors, + deputies/chairs/architects) |
| Current local official who also ran for parliament | hit | hit |
| Former local official no longer serving, once a parliamentary candidate | hit | NULL (roster is current-only) |
| **Village *kmetство* mayor** | NULL | **NULL — absent from the roster** |

**Village kmetство mayors have no profile at all** in the common case: they're absent from the
officials roster *and* `candidate_person`, and `resolve_persons` mints no person_id for them
(it walks only `mayor.elected` + elected councillors, not `kmetstva`). So on the settlement page —
whose **headline is the village-mayor race** — those names correctly stay plain text (the page does
not exist). They link only in the sub-cases where the person also holds a tracked role (mayor/
councillor → officials roster) or was an MP (`mpId`). `MyAreaKmetstvoTile` already documents and
relies on this.

**Officials → person.** `/officials/{slug}` **301s to `/person/{slug}`** server-side
(`officials_redirect.js`, via `officials_person_slug()` / SQL 106) and client-side
(`OfficialProfileRedirect`), query string preserved. So linking via officials reaches the unified
profile; the resolver handles the ~10% of official slugs that differ from the person slug.

**Two officials lookups already exist — pick by page scope, no new backend:**
- **Scoped roster** — `useMunicipalOfficials(obshtina)` (`src/data/officials/useMunicipalOfficials.tsx`):
  ≤96 rows for one município (a few KB), rows carry `officialSlug` (and `personSlug`). For
  single-obshtina pages (settlement, município dashboard). Match on `canonicalName(name)`.
- **Global name index** — `useMunicipalOfficialsByName()`
  (`src/data/officials/useMunicipalOfficialsByName.tsx`): one **~804 KB** fetch, 6,391 rows,
  `staleTime: Infinity`, exposes `findOfficialByName(name, municipality)` (name+muni, name-only
  fallback). For cross-obshtina pages (the 264-mayor national list). One fetch amortized across the
  session and every local page.

**`mpId` is free.** Every local candidate record already carries a stamped `mpId`
(`decorate_local_mp_links.ts`), so an MP links to `/candidate/mp-{id}` (the merged person dashboard)
with **no lookup and no MP-index download** — lighter than ChmiFeedScreen, which additionally calls
`findMpByName` off the ~970 KB roster.

**Render counts (why the global index, not per-name, on big pages)** — measured, no page paginates:
national list **264** mayors; município overview ~130 (kmetstva 96 + districts 24 + …); `/mayor` ~24;
`/council` 8 eager + up to 61 on expand; settlement **~5–15**. With this design none of these issue
per-name requests — `mpId` is on-record and officials is one bulk lookup — so the counts only matter
for the officials-index amortization, not for request fan-out.

## The shared building blocks

### 1. Resolver helper — `src/screens/components/person/personHref.ts` (new)

Pure function, generalizing the ChmiFeedScreen precedence:

```ts
type OfficialResolver = (name: string, municipality?: string | null)
  => { slug: string } | undefined;

export const localPersonHref = (
  rec: { name: string; mpId?: number | null },
  obshtina: string | undefined,
  resolveOfficial: OfficialResolver,
): To | undefined => {
  if (rec.mpId != null) return `/candidate/mp-${rec.mpId}`;
  const hit = resolveOfficial(rec.name, /* municipality if the page has it */ undefined);
  return hit ? { pathname: `/officials/${encodeURIComponent(hit.slug)}`,
                 search: obshtina ? `from=${obshtina}` : undefined } : undefined;
};
```

### 2. Component — `src/screens/components/person/PersonNameLink.tsx` (new)

Presentational: `{ name, to, className }`. Renders `<Link to={to} className={cn("hover:underline",
className)}>{titleCaseName(name)}</Link>` when `to` is set, else `<span>{titleCaseName(name)}</span>`.
No hooks, no requests — the page computes `to` via `localPersonHref` and the scope-appropriate
resolver. (Mirrors `MpAvatar`/`MpAvatarView`: the page owns the data hook, the leaf is presentational.)

The page wiring per screen: call `useMunicipalOfficials(obshtina)` (single-obshtina) **or**
`useMunicipalOfficialsByName()` (cross-obshtina) once, wrap it as an `OfficialResolver`, then per row
`<PersonNameLink name={r.candidateName} to={localPersonHref(r, obshtina, resolve)} />`.

## Change 1 — remove the "← Тунджа" back-link

**File:** `src/screens/LocalSettlementDashboardScreen.tsx`. Delete the `extra={…}` prop on
`<PlaceHeader>` (48-57) and its now-dead deps: `muni`/`muniName` (31-34), `findMunicipality` +
`useMunicipalities` import (12, 21), `Link` import (9). The obshtina stays reachable via
`PlaceHeader`'s existing `muniHref`.

## Change 2 — settlement page (the original request)

Single obshtina → use the **scoped roster** `useMunicipalOfficials(obshtina)`; build a resolver over
its `entries` (match `canonicalName(name)`, return `{ slug }`). Swap the four plain-text sites to
`<PersonNameLink name to={localPersonHref(...)} />`, name text only:

1. Mayor-per-cycle strip — `dashboard/local/LocalPlaceTrendsTile.tsx:68-72` (keep the party-name
   fallback; `PlaceMayorWinner` has no `mpId`, so name-only resolution).
2. Kmetstvo candidate rows — `LocalSettlementDashboardCards.tsx:84` (`MayorCandidateRows`).
3. "Предишни избори" winners — `LocalSettlementDashboardCards.tsx:218` (`KmetstvoMayorCard`).
4. Parent-município mayor ("СЪВЕТИ → Община → КМЕТ") — `LocalSettlementDashboardCards.tsx:302`.

**Expected coverage on this page (state it in the PR, it's not a bug):** the parent-município mayor
(#4) and the *current* município mayors in the strip (#1) link; the **headline kmetство village-mayor
candidates (#2, #3) mostly stay plain text** because those people have no profile — they link only
when the person is also an MP (`mpId`) or holds a tracked municipal role. This is the honest "if they
exist" behavior, matching `MyAreaKmetstvoTile`.

`LocalPlaceTrendsTile` is shared with the район settlement page — the same treatment applies there.

## Change 3 — roll out to the other local screens

Same wiring; pick the resolver by page scope.

**Cross-obshtina → `useMunicipalOfficialsByName()` (one 804 KB fetch):**
- `src/screens/LocalMunicipalityListScreen.tsx` — the **264-mayor** national list; swap L100-103
  (`MayorCell`) and L294-300. Pass each row's município name to `findOfficialByName` for namesake
  disambiguation.

**Single-obshtina → `useMunicipalOfficials(obshtina)` (the page already fetches its bundle):**
- `src/screens/LocalElectionScreen.tsx` (município overview + `/mayor` + `/council`): swap L166 &
  L1644 (mayor stat items), L272-279 (`MayorTable`), L376-377 (`CouncilPartyRow` elected list, field
  `c.name`), L548-555 (`KmetstvoMayorsTable`), L661-668 (район mayors), L771-776 (embedded
  by-elections). Councillors/mayors resolve via the roster; kmetство winners mostly stay plain text
  (as above).
- Dashboard tiles fed by the same bundle: `dashboard/local/TopMayorsTile.tsx` L82-90,
  `LocalMunicipalityExtras.tsx` L147-155 (`TopCouncillorsTile`, field `c.name`),
  `LocalMayorTimelineTile.tsx` L96-102, `LocalMidtermComparisonTile.tsx` L168. Low-value:
  `LocalMayorRunoffBar` L39/L52 (keep L62 `aria-label` plain), map hovers.

## Change 4 — consolidate the two existing implementations (DRY)

`ChmiFeedScreen.tsx:184-201` and `MyAreaKmetstvoTile.tsx:84-120` already hand-roll this exact
resolution. Refactor both to use `localPersonHref` + `PersonNameLink` so there is one implementation.
(ChmiFeedScreen additionally does `findMpByName` off the full MP index; keep that as an extra branch
there if its coverage matters, or drop it — the on-record `mpId` covers the common case.)

## Sites to leave alone

- **Already `/candidate/` or `/person/` links (EXCLUDE):** `TopCandidatesStrip`,
  `PartyTopCandidatesTile`, `PreferencesTable`/`CandidateLink` (all `candidateUrlFor`).
- **Nested in a município `<Link>`:** `LocalLeaderTiles.tsx:77-81`, `LocalExtraordinaryTile.tsx:73-77`
  — decide per tile which link wins; do not nest anchors.

## Decisions to confirm

1. **Village kmetство mayors** are unlinkable with today's data (no person_id). Accept plain text
   (recommended — matches `MyAreaKmetstvoTile`), **or** commit to a larger follow-up: extend
   `resolve_persons` to mint person_ids for village mayors + a new `person-by-name` route over
   `person_role source='local'`. Out of scope for v1.
2. **Ex-official-with-a-parliamentary-past** (the one case only `candidate_person` catches): a rare
   edge. Recommend **skip** — adding `candidate_person_by_name` as a secondary fallback reintroduces
   per-name requests (rate-limit exposure on big pages) for marginal coverage.

## Tests

- Unit-test `localPersonHref` (mpId → `/candidate/mp-{id}`; official hit → `/officials/{slug}?from=…`;
  no match → undefined) and `PersonNameLink` (renders `<Link>` vs plain text). Reuse the existing
  `norm`/`canonicalName` helpers; follow `useMunicipalOfficialsByName.test.ts`.

## Verification

1. `npm run dev`, `/local/2023_10_29_mi/settlement/03229?elections=2026_04_19`: "← Тунджа" gone,
   Тунджа still clickable in the header; the parent-município mayor links to a profile; a village
   mayor with no profile stays plain text (no dead link). Network tab shows **no per-name requests** —
   only the one roster fetch.
2. `/local/2023_10_29_mi` national list: one ~804 KB `municipal-officials-name-index` fetch (cached
   on reload), 264 mayors resolve where a roster/`mpId` match exists, no fan-out, no 429s.
3. Click through several links → confirm the `/officials/{slug}` → `/person` 301 lands on the right
   profile.
4. `npm run lint` + typecheck via `npm run build` (plain `tsc --noEmit` checks nothing here) — also
   catches the Change-1 import cleanup.

## Ops

- **No backend change, no migration, no `deploy:db`, no data regeneration.** Reuses existing
  `/api/db` routes and client hooks. Ships as a hosting-only deploy.

## Deferred — ingest-time `personSlug` stamp (SEO / zero-fetch)

If person links ever need to be in the prerendered HTML for SEO, or the 804 KB index proves too heavy
on the national list, a PG-backed decorate step after `db:resolve:persons` could bake the resolved
person/official slug into the local JSON (template: `decorate_local_mp_links.ts`, querying the
officials/person tables). Costs: a new pipeline + cloud reload hook (else prod links go stale — the
"migrated-family watch reload" class) and regenerate-and-redeploy on each re-resolve. Not needed for
v1; the `PersonNameLink` call sites wouldn't change, only where `to` comes from.
