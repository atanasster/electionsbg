# Shared `PersonNameLink` + settlement-page cleanup, with reuse across local-elections screens

## Context

Starting point is the local-elections **settlement** page (`/local/:cycle/settlement/:ekatte`, e.g.
`/local/2023_10_29_mi/settlement/03229`), which needs two fixes:

1. **A redundant "← Тунджа" municipality back-link** under the place header. The parent município
   is *already* a link inside the `PlaceHeader` breadcrumb/location labels, so this is duplicate
   navigation.

2. **Person names render as plain text.** They should link to the unified `/person/:slug` profile —
   **but only when such a page exists** (an unambiguous active public figure).

Across the whole local-elections tree this same "plain-text person name beside an `MpAvatar`"
pattern is repeated on ~15 screens (see inventory below). So the core deliverable is **one shared
`PersonNameLink` component**, applied first to the settlement page, then rolled out to the other
local screens.

## Change 1 — remove the "← Тунджа" back-link

**File:** `src/screens/LocalSettlementDashboardScreen.tsx`

- Delete the `extra={ … }` prop on `<PlaceHeader>` (lines 48-57).
- Remove the now-dead code it was the sole consumer of: the `muni` / `muniName` locals (31-34),
  the `findMunicipality` call + `useMunicipalities` import (12, 21), and the `Link` import (9).
  Confirm none are referenced elsewhere in the file (they are not).

The obshtina stays reachable — `PlaceHeader` already renders it as `muniHref` in the location
narrative, which is what the user confirmed ("already in the location labels above").

## Change 2 — the shared component + resolver refactor

### 2a. Make the resolver cache/dedupe

**File:** `src/data/candidates/useCandidatePerson.ts`

Convert the hand-rolled `useState`+`useEffect`+`fetch` to **React Query** (`queryKey:
["candidate-person", id]`, `staleTime: Infinity`), preserving the exact tri-state contract:
`undefined` = resolving, `null` = no public person, `string` = slug (map from
`isLoading ? undefined : data.personSlug ?? null`). Required because these screens render many
name instances (often the same person repeated); the raw `fetch` version has no dedup and fires
one uncached request per instance. The two existing consumers (`CandidateScreen.tsx:17`,
`CandidateProfileHeader.tsx:52`) are unaffected — identical return contract.

Resolution is already correct for "if they exist": the `name=` path hits `candidate_person_by_name`
(`scripts/db/schema/pg/085_person_elections.sql:108`), returning a slug **only** for an unambiguous
`status='active' AND is_public_figure` person; a miss or a >1 namesake returns `null`. **No
backend/SQL/migration change.**

### 2b. New shared component `PersonNameLink`

**New file:** `src/screens/components/person/PersonNameLink.tsx` (net-new — no
`PersonNameLink`/`MaybePersonLink` exists today).

```tsx
import { FC } from "react";
import { Link } from "react-router-dom";
import { useCandidatePerson } from "@/data/candidates/useCandidatePerson";
import { titleCaseName, cn } from "@/lib/utils";

export const PersonNameLink: FC<{
  name: string;
  /** When present, resolve by the exact `mp-{id}` slug (no namesake ambiguity)
   *  and only fall back to the name path when absent. */
  mpId?: number | null;
  className?: string;
}> = ({ name, mpId, className }) => {
  const slug = useCandidatePerson(mpId != null ? `mp-${mpId}` : name);
  const label = titleCaseName(name);
  if (slug) {
    return (
      <Link to={`/person/${slug}`} className={cn("hover:underline", className)}>
        {label}
      </Link>
    );
  }
  return <span className={className}>{label}</span>; // resolving or no public person
};
```

Notes:
- Accepting `mpId` lets the component reuse the precise `mp-{id}` resolution the neighbouring
  `MpAvatar` already gets, avoiding namesake collisions where the id is known.
- One hook call **per component instance** (one `PersonNameLink` per row) is idiomatic React, not
  a hook-in-a-loop. With 2a's cache, distinct ids fetch at most once; repeats are free.
- Callers keep any party-name fallback branch (e.g. the mayor strip's
  `w.candidateName ? <PersonNameLink …/> : w.localPartyName`).
- It only replaces the **name text**; the surrounding `MpAvatar`, party dot, truncation wrappers,
  votes columns, and any `aria-label` strings stay untouched.

## Change 3 — adopt on the settlement page (the original request)

Swap the four plain-text sites to `<PersonNameLink name={…} mpId={…} />`:

1. Mayor-per-cycle strip — `src/screens/dashboard/local/LocalPlaceTrendsTile.tsx:68-72`
   (keep the `? … : w.localPartyName` fallback; `PlaceMayorWinner` has no `mpId`, so name-only).
2. Kmetstvo mayoral candidate rows — `LocalSettlementDashboardCards.tsx:84` (`MayorCandidateRows`).
3. "Предишни избори" previous winners — `LocalSettlementDashboardCards.tsx:218` (`KmetstvoMayorCard`).
4. Parent-município mayor ("СЪВЕТИ → Община → КМЕТ") — `LocalSettlementDashboardCards.tsx:302`
   (`ParentMunicipalityCard`).

**Council scope note:** the council figures on this page (the trend chart + the "ОБЩИНСКИ СЪВЕТ"
list) are party-level, not named councillors — nothing to link here. Individual councillors are
listed on the município `/council` page, covered in Change 4.

## Change 4 — reuse across the rest of the local-elections screens

Same one-line swap (`{name}` / `titleCaseName(name)` → `<PersonNameLink name=… mpId=… />`),
grouped by page. Records use `candidateName` (+ `mpId`) unless noted; councillor rows use `name`.
Recommend shipping in this order so the highest-traffic pages land first.

**Município dashboard + mayor/council races — `src/screens/LocalElectionScreen.tsx`** (currently
has zero person links):
- L166 — "Кмет" stat item (name-only, no avatar).
- L272-279 — `MayorTable` full mayor ranking (`/mayor`).
- L376-377 — `CouncilPartyRow` expandable **elected-councillor** list (`/council`); field `c.name`.
- L548-555 — `KmetstvoMayorsTable` (leave the adjacent settlement `/settlement/` link alone).
- L661-668 — район mayors table (Sofia).
- L771-776 — embedded recent-by-elections table (plain text here).
- L1644-1645 — `RayonLocalResults` "Кмет" stat item (name-only).

**Município mayor list — `src/screens/LocalMunicipalityListScreen.tsx`:** L100-103 (`MayorCell`),
L294-300 (table body mayor column).

**Dashboard tiles (under `src/screens/dashboard/local/`):**
- `TopMayorsTile.tsx` L82-90.
- `LocalMunicipalityExtras.tsx` L147-155 (`TopCouncillorsTile`; field `c.name`).
- `LocalMayorTimelineTile.tsx` L96-102.
- `LocalMidtermComparisonTile.tsx` L168 (name-only).
- `LocalMayorRunoffBar.tsx` L39/L52 (low priority; keep the L62 `aria-label` plain text).
- `LocalRegionMapTile.tsx` L93 / `LocalSofiaRayonMapTile.tsx` L175 (low priority; map hovers).

## Sites to evaluate separately (NOT a blind swap)

- **Nested in a non-person `<Link>`** — wrapping would nest anchors. `LocalLeaderTiles.tsx:77-81`
  and `LocalExtraordinaryTile.tsx:73-77` already wrap the name in a `/local/:obshtinaCode` link.
  Decide per-tile whether the person link or the município link wins; do not nest.
- **Different resolution mechanism** — `ChmiFeedScreen.tsx:184-217` and
  `MyAreaKmetstvoTile.tsx:112-119` already resolve names to `/candidate/` or `/officials/` via
  `findMpById`/`findOfficialByName`/roster match, linking only their else-branch is plain text.
  `PersonNameLink` could slot in as the **fallback** for the currently-unlinked branch, but that is
  a deliberate change to their existing behaviour — treat as a follow-up, not part of the sweep.
- **Already `/candidate/` or `/person/` links (EXCLUDE):** `TopCandidatesStrip`,
  `PartyTopCandidatesTile`, `PreferencesTable`/`CandidateLink` — all use `candidateUrlFor`. Leave.

## Verification

1. `npm run dev`, open `/local/2023_10_29_mi/settlement/03229?elections=2026_04_19`.
2. Confirm "← Тунджа" is gone and Тунджа is still clickable in the header location labels.
3. Confirm mayor names render as `/person/:slug` links (hover underline; click lands on the
   profile) and a name with no public person stays plain text — no dead `/person/` link. Check the
   Network tab: `candidate-person` requests are deduped (one per distinct id).
4. Spot-check one Change-4 page per group after adopting it (e.g. `/local/2023_10_29_mi/SOF`
   dashboard, `/local/2023_10_29_mi/<code>/council` councillor list, `/local/:cycle/municipalities`).
5. `npm run lint` + typecheck via `npm run build` (plain `tsc --noEmit` checks nothing here) — also
   catches the removed-import cleanup in Change 1.
6. Sanity-check the two existing `useCandidatePerson` consumers still resolve after the RQ refactor:
   `/candidate/mp-…` and a bare-name `/candidate/<name>` URL.

## Deferred alternative (not doing now)

A bulk `candidate-person` batch endpoint + client-side name-index (the
`useMunicipalOfficialsByName`/`ChmiFeedScreen` "load-once index, resolve synchronously" pattern)
would scale better for the highest-cardinality tables (full council candidate lists), but needs a
new backend route + SQL function + Cloud SQL migration + `deploy:db`. The React-Query per-id
approach is the minimal correct fit for these pages; note this as the scale-up path if a very large
list ever proves too chatty.
