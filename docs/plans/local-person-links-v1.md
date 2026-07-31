# Local person-name links via a baked `personSlug` (village mayors included)

## Context

On the local-elections **settlement** page (`/local/:cycle/settlement/:ekatte`) and ~15 sibling
local screens, person names (mayors, councillors, village mayors) render as plain text and should
link to their `/person/:slug` profile. Plus a small cleanup: remove the redundant "← Тунджа"
back-link (the parent município is already a link in the `PlaceHeader` location labels).

> **This plan went through three audits.** Performance killed per-name resolution for the 264-mayor
> list; correctness showed `candidate_person` is parliamentary-only (wrong table for local
> officials); the third scoped the two operator decisions below. Those decisions **change the shape
> of the solution** from a frontend tweak into a data-pipeline change.

**Operator decisions taken:**
1. **Village *kmetство* mayors must be linkable.** Today they have no `/person` page at all —
   `resolve_persons` never materializes them.
2. **The ~804 KB runtime officials index is not acceptable** for the national list.

Both point to one answer: **bake a resolved `personSlug` into the local-election JSON at build time**
and have the frontend link `/person/${personSlug}` directly — zero runtime lookups, no 804 KB fetch,
and village mayors become linkable. Because the runtime index is rejected, **the bake is a
prerequisite for essentially all linking** (only the already-stamped `mpId` MP subset could link
without it). Net cost: a person-layer extension, a new stamp step, threading the field through ~4
builders and ~6 types, and ops wiring — materially larger than a frontend-only change.

## Why baking, confirmed by audit

- **`is_public_figure` is a pure `person_source.public_default` OR across roles**
  (`resolve_persons.ts:1292`), and **`local` is `public_default=true`** (`081_person_identity.sql:38`).
  So a person whose only role is a local candidacy is already public and servable
  (`person_by_slug`, `082_person_api.sql:17`). Village mayors are unlinkable **only** because the
  walk never reads `kmetstva[]` — not for any privacy reason.
- **`person_slug_lock` (mention_id → slug)** is persisted, never truncated, redirect-aware — the
  clean read-side for a stamp step, so `resolve_persons` stays read-only on `data/`.
- Every downstream artifact already carries `mpId` copied from the bundle; `personSlug` mirrors it
  one-for-one — except `PlaceMayorWinner`, which carries neither and needs the field added.
- `/person` pages are **Cloud-SQL-served** (update the instant `db:resolve:persons` runs); only the
  **bucket-served** local JSON that links out needs a re-sync.

## Phase 1 — Person layer: materialize elected village (and district) mayors

**File:** `scripts/person/resolve_persons.ts`, the local walk (L844-907).

Add a `kmetstva[]` loop mirroring the `mayor.elected` block (and the same for `districts[]` for
Sofia/Plovdiv/Varna), **elected winner only** (not losing candidates — keeps scope to office holders,
as mayors/councillors already are, and avoids materializing thousands of losers):

```ts
for (const k of d.kmetstva) {
  const el = k.elected ?? k.candidates?.find(c => c.isElected);
  if (el?.candidateName)
    add(el.candidateName,
      { id: `local:${d.cycle}:${d.obshtinaCode}:kmetstvo:${k.ekatte || k.kmetstvoName}`,
        source: "local", ref: `${d.cycle}:${d.obshtinaCode}:kmetstvo:${k.ekatte || k.kmetstvoName}`,
        role: "village_mayor" },
      { ...obshtinaPlaceFor(d.obshtinaCode), cParty: el.primaryCanonicalId ?? null, cPlace: place });
}
```

Notes: `ekatte` can be empty in the bundle → fall back to `kmetstvoName` for a stable ref. Identity
is name-fold based with party+place corroborants (same recipe as mayors/councillors). Check whether
`person_role.role` has a CHECK/enum; if so, add `village_mayor` (or reuse `mayor` — `place_kind`/ref
disambiguates). No other schema change. `person_slug_lock` picks up the new mention ids automatically.

## Phase 2 — Bake `personSlug` into the local JSON

### 2a. New stamp step — `scripts/parsers_local/decorate_local_person_links.ts` (new)

Mirror `decorate_local_mp_links.ts` (same four slots: `mayor.round1/round2/elected`,
`council[].candidates`, `kmetstva[].candidates`, `districts[].candidates`), but **PG-backed**: read
`person_slug_lock` (join `person_slug_retired` for redirects) for `mention_id LIKE 'local:%'`, build a
`ref → personSlug` map, and stamp `personSlug` onto each bundle record by recomputing the **same
mention ref** used in Phase 1 (`local:${cycle}:${code}:mayor`, `:${partyNum}:${listPos}`,
`:kmetstvo:${ekatte||name}`). Idempotent, `--dry-run`, writes bundles in place. **Runs AFTER
`db:resolve:persons`.** (Recommended over stamping inside `resolve_persons`, which must stay
read-only on the data tree.)

### 2b. Types — add `personSlug?: string`

`scripts/parsers_local/types.ts` **and** its frontend mirror `src/data/local/types.ts`:
`LocalMayorResult`, `LocalCouncilCandidate`; plus `RegionMunicipalityRow.electedMayor`,
`LocalCandidateRef` (`build_region_json.ts`); `MuniMayorTimelineEntry` **and** `PlaceMayorWinner`
(`src/data/local/placeTrendsTypes.ts`); `ChmiHistoryEvent` (`build_chmi_history.ts`). Place it right
beside the existing `mpId?` field everywhere.

### 2c. Builders — copy `personSlug` from the stamped bundle

Each is a bundle-only additive pass; add the copy where `mpId` is copied today, and **run them AFTER
the stamp** (same ordering hazard as `mpId` — the rollups run during ingest, before the standalone
decorate, so they must be regenerated after):
- `build_region_json.ts` — `electedMayor` (`:442`), independent list (`:485`), `LocalCandidateRef`
  (`:366`). Feeds `national_municipalities.json` + region rollups + leader tiles.
- `build_local_place_trends.ts` — `mayorTimeline` (`:316`) **and** `resolveMayorWinner` (`:117-145`),
  which today reads neither `mpId` nor slug: look up `personSlug` on the matched candidate and set it
  on the emitted `PlaceMayorWinner` (the settlement/район mayor strip).
- `build_chmi_history.ts` — copy `personSlug: m.personSlug` beside `mpId` on each event.

Run order after a re-resolve: **stamp → `--local-rollups` → `--local-place-trends` → chmi-history.**

## Phase 3 — Frontend

**Change 1 — remove "← Тунджа".** `src/screens/LocalSettlementDashboardScreen.tsx`: delete the
`extra={…}` prop (48-57) and its now-dead deps (`muni`/`muniName` 31-34, `findMunicipality` +
`useMunicipalities` import 12/21, `Link` import 9).

**Shared component — `src/screens/components/person/PersonNameLink.tsx` (new).** Presentational, no
hooks, no fetch:

```tsx
export const PersonNameLink: FC<{ name: string; personSlug?: string | null;
  mpId?: number | null; className?: string }> = ({ name, personSlug, mpId, className }) => {
  const to = personSlug ? `/person/${personSlug}` : mpId != null ? `/candidate/mp-${mpId}` : undefined;
  return to
    ? <Link to={to} className={cn("hover:underline", className)}>{titleCaseName(name)}</Link>
    : <span className={className}>{titleCaseName(name)}</span>;
};
```

`personSlug` (baked) is preferred; `mpId` is the fallback for records the bake missed; else plain
text. Swap every render site to pass `record.personSlug` + `record.mpId`:
- **Settlement page:** `LocalPlaceTrendsTile.tsx:68-72` (mayor strip), `LocalSettlementDashboardCards`
  `MayorCandidateRows` :84, `KmetstvoMayorCard` :218, `ParentMunicipalityCard` :302.
- **National list:** `LocalMunicipalityListScreen.tsx` :100-103, :294-300 — now reads the baked
  `electedMayor.personSlug`, **no 804 KB index**.
- **Município overview + `/mayor` + `/council`:** `LocalElectionScreen.tsx` :166, :272-279, :376-377
  (`c.personSlug`), :548-555, :661-668, :771-776, :1644.
- **Tiles:** `TopMayorsTile` :82-90, `LocalMunicipalityExtras` (`TopCouncillorsTile`) :147-155,
  `LocalMayorTimelineTile` :96-102, `LocalMidtermComparisonTile` :168.

**Consolidate the two existing implementations.** `ChmiFeedScreen.tsx:184-201` and
`MyAreaKmetstvoTile.tsx:84-120` hand-roll officials-index resolution — switch both to
`PersonNameLink` reading the baked `personSlug`, dropping their `useMunicipalOfficialsByName` /
roster dependency (and its 804 KB fetch) entirely.

**Leave alone:** already-linked `TopCandidatesStrip`/`PartyTopCandidatesTile`/`CandidateLink`; and
`LocalLeaderTiles`/`LocalExtraordinaryTile` where the name is already inside a município `<Link>`
(don't nest anchors).

## Phase 4 — Ops wiring (do not skip — this is where prod goes stale)

The `data/<cycle>/municipalities/` and `data/local_place_trends/` trees are **gitignored, served only
from `gs://data-electionsbg-com` via `npm run bucket:sync`**. A slug change in `db:resolve:persons`
makes every baked link stale until re-stamped and re-synced. Wire the new step in:
- **`db:refresh`** — after `db:resolve:persons`, run the decorate + the three builder rebuilds
  (locally).
- **`update-local-elections` skill (Step 5)** — add `decorate_local_person_links` right after
  `decorate_local_mp_links`, then the builder rebuilds, then `bucket:sync`.
- **`update-persons` skill** — after a re-resolve, run the decorate + rebuilds + `bucket:sync` so the
  linking JSON tracks the new slugs.
- **`process-watch-report`** — map `cik_results` / persons re-resolve to re-trigger the above.

No Cloud SQL migration, no `deploy:db`. `/person` pages update on `db:resolve:persons:cloud`; only the
bucket-served local JSON needs the extra sync.

## Decisions & risks to confirm

1. **SEO sprawl.** Materializing elected village mayors adds ~3,000 new `/person` pages. In-app links
   work regardless (Cloud-SQL-served). Confirm whether these should also enter the sitemap /
   prerender set (`project_sitemap_validity_audit`, `project_firebase_deploy_ceiling`) or stay
   in-app-only. **Recommend in-app-only for v1.**
2. **Scope = elected only.** Losing kmetstvo/mayor candidates get no page and stay plain text on the
   settlement page's headline race — correct "if they exist" behavior.
3. **Ops coupling.** The bake couples local JSON freshness to person slugs; the wiring above is
   mandatory or links rot. `person_slug_retired` 301s cover residual drift between syncs.

## Tests

- `resolve_persons` data test: an elected village mayor materializes as an active public person with a
  servable slug.
- `decorate_local_person_links`: stamps `personSlug` from `person_slug_lock`; `--dry-run` counts;
  idempotent; leaves losers unstamped.
- `PersonNameLink` unit test: `/person` (slug) vs `/candidate/mp-{id}` (fallback) vs plain text.
- Regression: `mpId` path unchanged; builders still emit `mpId`.

## Verification

1. `db:refresh` (or the manual chain), then `/local/2023_10_29_mi/settlement/03229`: "← Тунджа" gone;
   the **elected village mayor now links** to a real `/person` page; a losing candidate stays plain
   text; the parent-município mayor links. **No `municipal-officials-name-index` (804 KB) fetch** in
   the Network tab — links come from baked data.
2. `/local/2023_10_29_mi` national list: 264 mayors link from baked `electedMayor.personSlug`, no
   per-name requests, no big index fetch.
3. Confirm a baked slug survives a re-resolve (lock-stable), and a retired one 301s to the survivor.
