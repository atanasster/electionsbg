# Local person-name links via a baked `personSlug`, with village mayors materialized + SEO

## Context

Make person names across the ~15 local-elections screens (mayors, councillors, **village
*kmetство* mayors**) link to their `/person/:slug` profile, starting with the settlement page
(`/local/:cycle/settlement/:ekatte`); and remove the redundant "← Тунджа" back-link there (the
parent município is already a link in `PlaceHeader`).

Three audits shaped this: performance killed per-name resolution (264-mayor list); correctness
showed `candidate_person` is parliamentary-only (wrong table); and the operator decisions below
turned it into a **data-pipeline + SEO** change.

**Operator decisions (all taken):**
1. **Village mayors must be linkable** — they have no `/person` page today.
2. **The ~804 KB runtime officials index is not acceptable.**
3. **Local officials must be added to the sitemap AND prerendered** for SEO.

Together these select one architecture: **materialize village mayors in the person layer, bake a
resolved `personSlug` into the local-election JSON, link it directly, and extend the person
prerender/sitemap set to the local officials.** No runtime lookups, no 804 KB index, SEO-visible.

---

## Phase 1 — Person layer: materialize elected village (and район) mayors

`resolve_persons.ts` local walk (L844-907) reads only `mayor.elected` + elected councillors as
`source='local'`. Extend it with a `kmetstva[]` loop (and `districts[]` for Sofia/Plovdiv/Varna),
**elected winner only**:

```ts
for (const k of d.kmetstva) {
  const el = k.elected ?? k.candidates?.find(c => c.isElected);
  if (el?.candidateName)
    add(el.candidateName,
      { id:`local:${d.cycle}:${d.obshtinaCode}:kmetstvo:${k.ekatte||k.kmetstvoName}`,
        source:"local", ref:`${d.cycle}:${d.obshtinaCode}:kmetstvo:${k.ekatte||k.kmetstvoName}`,
        role:"village_mayor" },
      { ...obshtinaPlaceFor(d.obshtinaCode), cParty: el.primaryCanonicalId ?? null, cPlace: place });
}
```

Village mayors become **public + servable automatically**: `is_public_figure` is a pure
`person_source.public_default` OR across roles (`resolve_persons.ts:1292`), and **`local` is
`public_default=true`** (`081_person_identity.sql:38`). `ekatte` can be empty → fall back to
`kmetstvoName` for a stable ref. Identity is name-fold + party/place corroborants (as mayors/
councillors already are). **Verify** `person_role.role` has no CHECK constraint rejecting
`village_mayor` (else reuse `'mayor'` — `place_kind`/ref disambiguates).

## Phase 2 — Bake `personSlug` into the local JSON

**2a. Stamp step — `scripts/parsers_local/decorate_local_person_links.ts` (new).** Mirror
`decorate_local_mp_links.ts` (same four slots), PG-backed: read **`person_slug_lock`** (mention_id →
slug, persisted, never truncated; join `person_slug_retired` for redirects) for `mention_id LIKE
'local:%'`, and stamp `personSlug` onto each bundle record by recomputing the **same mention ref**.
Idempotent, `--dry-run`, in-place. **Runs AFTER `db:resolve:persons`.** Keeps `resolve_persons`
read-only on the data tree.

**2b. Types** — add `personSlug?: string` beside the existing `mpId?` in: `LocalMayorResult`,
`LocalCouncilCandidate` (`scripts/parsers_local/types.ts` + mirror `src/data/local/types.ts`);
`RegionMunicipalityRow.electedMayor`, `LocalCandidateRef` (`build_region_json.ts`);
`MuniMayorTimelineEntry` **and** `PlaceMayorWinner` (`placeTrendsTypes.ts`); `ChmiHistoryEvent`.

**2c. Builders** — copy `personSlug` where `mpId` is copied, and **run them after the stamp** (same
ordering hazard `mpId` has — rollups run during ingest, before the standalone decorate):
`build_region_json.ts` (electedMayor + `LocalCandidateRef`), `build_local_place_trends.ts`
(`mayorTimeline` **and** `resolveMayorWinner`, which reads neither `mpId` nor slug today),
`build_chmi_history.ts`. Order: **stamp → `--local-rollups` → `--local-place-trends` → chmi-history.**

## Phase 3 — Frontend

**Change 1 — remove "← Тунджа".** `LocalSettlementDashboardScreen.tsx`: delete the `extra={…}` prop
(48-57) + dead deps (`muni`/`muniName` 31-34, `findMunicipality`/`useMunicipalities` 12/21, `Link` 9).

**Shared `PersonNameLink` — `src/screens/components/person/PersonNameLink.tsx` (new).** Presentational,
no hooks, no fetch. **Priority: `mpId` first** (→ `/candidate/mp-{id}`, an already-prerendered/indexed
URL, matching ChmiFeedScreen), then `personSlug` (→ `/person/{slug}`, prerendered in Phase 4), else
plain text:

```tsx
const to = mpId != null ? `/candidate/mp-${mpId}`
         : personSlug ? `/person/${personSlug}` : undefined;
return to ? <Link to={to} className={cn("hover:underline", className)}>{titleCaseName(name)}</Link>
          : <span className={className}>{titleCaseName(name)}</span>;
```

Swap every render site to pass `record.personSlug` + `record.mpId` (name text only; leave avatar/
party/votes): settlement page (`LocalPlaceTrendsTile.tsx:68-72`, `LocalSettlementDashboardCards`
:84/:218/:302); national list (`LocalMunicipalityListScreen.tsx:100-103,294-300` — now reads baked
`electedMayor.personSlug`, **no 804 KB index**); `LocalElectionScreen.tsx` (:166,:272-279,:376-377
`c.personSlug`,:548-555,:661-668,:771-776,:1644); tiles (`TopMayorsTile`, `TopCouncillorsTile`
`c.name`, `LocalMayorTimelineTile`, `LocalMidtermComparisonTile`).

**Consolidate** `ChmiFeedScreen.tsx:184-201` and `MyAreaKmetstvoTile.tsx:84-120` onto `PersonNameLink`
reading the baked field — dropping their `useMunicipalOfficialsByName`/roster dependency (and its
804 KB fetch). Leave `TopCandidatesStrip`/`PartyTopCandidatesTile`/`CandidateLink` (already linked)
and the município-`<Link>`-nested `LocalLeaderTiles`/`LocalExtraordinaryTile` (don't nest anchors).

## Phase 4 — SEO: sitemap + prerender the local officials

Both are driven by the **`prerender` flag** in `data/person/prerender_slugs.json`
(`emit_prerender_slugs.ts`); the sitemap (`enumeratePersons`) and prerenderer (`buildPersonRoutes`)
both gate on it, so **widening the selection drives both** — no sitemap code change.

**Today:** the flag is set only for `officials_rankings_table WHERE is_exec`, and
`is_exec = bool_or(source <> 'official_muni')` (`100_officials_rankings.sql`) — the exact filter
excluding municipal officials and village mayors, capped at `OFFICIALS_STATIC_PAGE_LIMIT = 5000`.

**4a. `emit_prerender_slugs.ts` — broaden the selection + build cards:**
- **Municipal declarant officials** (mayors/councillors) already have `officials_rankings_table`
  rows (`is_muni`) with a net-worth card → drop the `is_exec` scoping to admit them; the **existing
  officials card + `buildPersonRoutes` template work unchanged** (the template already handles a
  null net worth).
- **Village mayors** (`source='local'`, no declaration) are **not** in `officials_rankings_table`,
  so they need a **new card** built from `person_role (source='local')` + the place dimension (name,
  role = village mayor, settlement/obshtina label, cycle/year) — a new `PersonPrerenderCard` variant
  (discriminated by category, or an added `local` block), and a **new `buildPersonRoutes` body/meta
  template** (title "<name> — кмет на <село>, <община>"; description = local office + election
  context; body = role/place + link to the `/local/:cycle/:obshtina` dashboard; breadcrumb to
  `/local`). Real indexable content, not just a title (per `persons-audit-gaps` A1.2).
- **Raise/replace the 5,000 cap** — either lift `OFFICIALS_STATIC_PAGE_LIMIT` or add a separate
  municipal+local budget admitting the full ~9k local-official set (they're bounded, unlike the 38k
  full-G6 tail).

**4b. Deploy-ceiling gate (mandatory).** `dist/` is **201,394 files** today; deploys fail at
**320k–340k**. Local officials ≈ ~9k persons × 2 langs ≈ **+18k → ~219k** — comfortably under the
band (full G6's +77k would not be). Still: run `find dist -type f | wc -l` before/after and **gate on
a `npm run staging` deploy before prod** (`persons-pg-retirement-v1.md §0.5`, `persons-audit-gaps`
A1.4). Record this as a deliberate, measured widening of the net-neutral cap.

## Phase 5 — Ops wiring (skip this and prod rots)

The local `data/<cycle>/municipalities/` + `data/local_place_trends/` trees are **gitignored, served
only from `gs://data-electionsbg-com` via `bucket:sync`**; `/person` pages are **Cloud-SQL-served**
(update on `db:resolve:persons:cloud`); the prerendered HTML ships in the **hosting deploy**. So a
re-resolve touches three surfaces. Wire:
- **`db:refresh`** — after `db:resolve:persons`: run the new decorate + the three builder rebuilds
  (locally); `emit_prerender_slugs` already runs here (extend it per 4a).
- **`update-local-elections` skill (Step 5)** — add `decorate_local_person_links` after
  `decorate_local_mp_links`, then builder rebuilds, then `bucket:sync`.
- **`update-persons` skill** — after a re-resolve: decorate + rebuilds + `bucket:sync`, and (on a
  content build) `emit_prerender_slugs` → prerender → sitemap → hosting deploy.
- **`process-watch-report`** — map `cik_results` / persons re-resolve to re-trigger the above.

No Cloud SQL migration, no `deploy:db`. New SEO pages ride the normal `build → postbuild
(prerender) → deploy` flow.

---

## Final audit — residual risks & consistency checks

1. **Link target priority.** `PersonNameLink` prefers `mpId → /candidate/mp-{id}` (already
   prerendered/indexed) over `personSlug → /person`, matching ChmiFeedScreen — so MPs don't point at
   a possibly-unprerendered `/person`. Local-only persons correctly use `/person` (prerendered in
   Phase 4). No redirect hop (we link `/person` directly, not `/officials`→301).
2. **Card-source split is load-bearing.** Municipal officials reuse the officials card; **village
   mayors need the new local card** (they're absent from `officials_rankings_table`). Missing this
   means village mayors get `prerender:true` but **no `card` → `buildPersonRoutes` skips them**
   (`if (!entry.prerender || !entry.card) continue`), a silent no-op — the one gap most likely to
   ship broken.
3. **Coupling guarantees no soft-404s.** Sitemap `<loc>` and prerendered HTML both key off the same
   `prerender` flag, so every emitted `<loc>` has a real `dist/.../index.html` (the
   `sitemap-validity` invariant).
4. **Scope = elected only.** Losing mayoral/kmetstvo candidates aren't materialized → no page → stay
   plain text (correct "if they exist"). On the settlement page's headline race, only the winner
   links.
5. **Ceiling headroom is real but bounded.** ~219k projected vs 320k–340k failure. Do **not** later
   lift the cap to the full 38k indexable set without re-measuring — that lands in the warned band.
6. **Freshness.** Baked slugs are lock-stable (`person_slug_lock`); a retired one 301s via
   `person_slug_retired`. But the bake couples local JSON + prerendered HTML to person slugs, so the
   Phase-5 wiring is mandatory, not optional.
7. **Sitemap size.** Sharded at 49k/file; +18k person locs land in the `static` bucket — fine.
8. **This is a large, multi-surface change.** It can ship in two shippable slices: **A** = Phases
   1-3 + Phase 5 bucket wiring (in-app links live), **B** = Phase 4 + its ops (SEO). A delivers the
   user-visible feature; B delivers discovery.

## Tests

- `resolve_persons` data test: an elected village mayor materializes as active + public with a
  servable slug.
- `decorate_local_person_links`: stamps `personSlug` from `person_slug_lock`; `--dry-run` counts;
  idempotent; leaves losers unstamped.
- `emit_prerender_slugs`: a municipal official and a village mayor both get `prerender:true` **and a
  card**; assert `dist` file-count delta stays under a threshold in CI.
- `PersonNameLink` unit test: mpId → `/candidate/mp-{id}`; else personSlug → `/person`; else plain.
- Regression: `mpId` path + existing officials prerender unchanged.

## Verification

1. `db:refresh` (or the manual chain) → `/local/2023_10_29_mi/settlement/03229`: "← Тунджа" gone; the
   **elected village mayor links** to a real `/person` page; a losing candidate stays plain text.
   **No `municipal-officials-name-index` (804 KB) fetch.**
2. National list `/local/2023_10_29_mi`: 264 mayors link from baked slugs, no per-name fan-out.
3. `npm run build` → `find dist -type f | wc -l` before/after (~201k → ~219k); a village-mayor
   `dist/person/<slug>/index.html` exists with a real `<title>`/`<meta>` and JSON-LD; its `<loc>` is
   in the sitemap. **`npm run staging` deploy succeeds** before any prod ship.
4. `EXPLAIN`/spot-check the new `emit_prerender_slugs` local-card query on the worst-case obshtina.
