# Persons/declarations audit — gap review and fix plan (v1)

Post-implementation audit of `docs/plans/persons-declarations-audit-v1.md` (31 steps,
Tier 1–3, completed 2026-07-24). Everything below was verified against the working tree on
2026-07-24, not recalled.

## Current state — what is actually green

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| `npx vitest run` | 128 files, **2,220 passed / 15 skipped**, 0 failed |
| `npm run build` | succeeds, 1m16s, 67,184 routes prerendered |
| `npm run functions:test` | 26 pass |
| Locale integrity | 5,228 keys each, **no duplicates lost**, bg/en parity exact, all 32 new keys in both |
| `npm run lint` | **RED** — see E1 |

So the shipped code is correct and tested. The gaps below are about **reach, lifecycle and
placement**, not about the figures being wrong.

---

## A. The work is invisible — highest priority

### A1. `/person` is neither prerendered nor in any sitemap

Measured on the fresh `dist/`:

```
dist/person/          — does not exist
grep -c "/person/" dist/sitemap*.xml   → 0, 0, 0
```

Prerendered route groups are `candidate` (26,386), `section` (12,721), `governance` (5,699),
`settlement` (5,375), `officials` (5,001), `sections` (4,230), `product` (3,000) — **no
`person`**.

Consequence: **every surface this plan built is unreachable by search engines.** The wealth
trajectory (T3.1), accumulation gap (T3.2), unified declaration block (T3.3), disposals feed
(T3.4), portfolio composition (T3.6), stake↔procurement (T3.8), cohort benchmark (T3.9) and
watchlist (T3.10) all live on `/person/:slug`, which is a client-only route behind the
Firebase SPA rewrite. Per `feedback_static_seo`, that means crawlers see the shell.

This is also a **decision that was made and never implemented**: the site owner explicitly
chose "All public persons (~58.6k)" for `/person` SEO earlier in this work.

### A2. …and shipping A1 collides with the deploy ceiling

`dist/` is already **202,050 files**. Known-good deploy is ~84k; deploys fail at ~320–340k
(`project_firebase_deploy_ceiling`). Adding 58.6k person pages plus their English mirrors is
roughly **+117k → ~320k**, i.e. straight into the failure band.

A1 and A2 must be planned together. Options, cheapest first:

1. **Tier the person corpus.** Prerender only persons with something to show — a declaration,
   an office, a confirmed stake — rather than all 58.6k. A first cut: persons present in
   `person_wealth_year` or `person_cohort_wealth` (≈6k people), which is exactly the set these
   new surfaces render for. ~12k files with mirrors. Fits comfortably.
2. **Drop the English mirror for person pages** (halves the cost of whatever tier is chosen).
3. **Reduce an existing group.** `candidate` at 26,386 and `section` at 12,721 are the two
   largest; check whether both still earn their place (`project_seo_discovery_gap` already
   records that broad-data pages get ~0 impressions).

**Steps**

- A1.1 Decide the person tier (recommend option 1 — it is self-limiting and matches where the
  content actually is).
- A1.2 Add a `person` body builder to `scripts/prerender/` emitting real `<meta>` + a text
  summary of the declaration block (name, latest declared net worth, offices) so the page has
  indexable content, not just a title.
- A1.3 Add the `<loc>` enumerator to the sitemap generator for the same tier. Per
  `project_sitemap_validity_audit`, every `<loc>` must have a real `dist/<path>/index.html` —
  enumerate from the same source as A1.2 so the two cannot drift.
- A1.4 Measure `find dist -type f | wc -l` before/after; gate on a **staging deploy** before
  production (`npm run staging`), since the ceiling is a deploy-time failure.

---

## B. Lifecycle gaps in what shipped

### B1. `person_cohort_wealth` (097) is never refreshed — anywhere

```
grep -rn "REFRESH.*person_cohort_wealth" scripts/  → no matches
```

097's header documents that a person-resolution run "must REFRESH it". Nothing does. The
matview is only ever populated by its own `CREATE … AS` inside
`load_declarations_pg --resolve`. After a `resolve_persons.ts` run (which TRUNCATEs and
rebuilds `person_role`) or a bare `REFRESH person_wealth_year`, the cohort benchmark serves
stale ranks against a stale peer set — silently, because it still returns well-formed data.

**Fix**: add a guarded `REFRESH MATERIALIZED VIEW CONCURRENTLY person_cohort_wealth` to
`scripts/person/resolve_persons.ts` (the owner of `person_role`), mirroring the pattern
already used for `declaration_stake_company` in `load_tr_pg.ts`. The unique index on
`(person_id, period_year)` makes `CONCURRENTLY` legal.

### B2. `declaration_stake_company` (096) is refreshed by the TR loader only

It joins `person` as well as `tr_*`, so a person re-resolution invalidates it too. Same fix
site as B1 — one guarded refresh covering both matviews.

### B3. Unverified: do 096/097/098 exist in production?

All three are applied **only** inside `load_declarations_pg --resolve`. If the cloud deploy
path does not run that command, `/api/db/person-stake-procurement`,
`person-cohort-benchmark` and `new-filings` fall through `missingMigrationEmpty` and return
empty forever — the sections self-hide, so **this failure is invisible**.

**Fix**: verify against Cloud SQL which of the three functions/matviews exist; if absent, add
them to whatever migration-application path the deploy uses. Add a smoke assertion so a
missing migration is loud rather than silent.

### B4. The feed's rendered date is timezone-dependent

`to_char(f.first_seen_at, 'YYYY-MM-DD')` on a `timestamptz` renders in the **session**
TimeZone, so the same ingest batch shows as `2026-07-23` or `2026-07-24` depending on the
connection. Low impact, trivially fixed: pin with `AT TIME ZONE 'Europe/Sofia'` (the site's
frame of reference) and say so in the comment.

---

## C. Placement / product gaps

### C1. `WatchlistFilings` is mounted on every person profile

`src/screens/person/PersonProfileScreen.tsx:355` renders it on all ~58k `/person/:slug`
pages. It shows filings for **other** people (whoever the reader follows), and on the
subject's own page it duplicates filings already listed in their declaration block. It
self-hides when the reader follows nobody, so it is not harmful — but the placement is wrong.

**Fix**: give it a home of its own. Recommended: a dedicated route (e.g. `/following`,
`noindex` — it is personal, browser-local state), linked from the header when the watchlist
is non-empty. Keep `PersonFollowButton` on the profile where it belongs.

### C2. The site-wide new-filing feed has no surface

`declaration_new_filings()` is now only consumed as "fetch 200, filter locally". The
site-wide feed itself — "what declarations arrived here recently" — is a genuinely useful
public page and is already built and tested. Surface it on the same route as C1, or on
`/data/updates` alongside the existing changelog (mind `reference_two_changelogs`: this is a
third, distinct thing and must not be conflated with `recent_updates` or `data-changes.json`).

---

## D. Verification gaps

### D1. The three new API routes have no route-level tests

`npm run functions:test` passes 26 tests, **none covering** `person-stake-procurement`,
`person-cohort-benchmark` or `new-filings`. The SQL is well covered by `*.data.test.ts`; the
JS route layer (param clamping, the `Array.isArray → null` degradation, the missing-migration
path) is not.

**Fix**: add cases to the functions gate for each — in particular that `new-filings` ignores
any `slugs` parameter (the T3.10 privacy fix), since nothing currently pins that.

### D2. Two review reports were never read in full, then deleted

The T3.9 review returned **3 critical / 7 warnings / 4 suggestions** and the T3.10 review
**3 critical / 10 warnings / 6 suggestions**. In both cases the criticals were fixed from the
agent's summary, but the report bodies were never read and `CODE_REVIEW_REPORT.md` was
deleted at commit time. **~27 warnings/suggestions are unrecovered.** Some are known from the
summaries and are captured above (B4, C1); the rest are not.

**Fix**: re-run `/code-review` over the shipped state of 096/097/098 and their surfaces,
and this time triage the full report before committing.

### D3. No E2E coverage of the new sections

`npm test` (Playwright) was never run against this work. The new sections are all
self-hiding, so a broken fetch or a thrown render would look identical to "no data".

**Fix**: one smoke spec per section on a person known to have data (e.g. `mp-2946` for
stake↔procurement) asserting the heading renders.

---

## E. Hygiene (not from this work, but blocking)

### E1. `npm run lint` is red

Two `prettier/prettier` errors in `scripts/officials/official_slug.test.ts`. The file is
**staged but uncommitted** (`A `) — in-flight work from the concurrent auto-committer, not
from this plan. It fails the repo's lint gate as it stands. Needs `--fix` and a commit by
whoever owns it.

### E2. A stale git worktree breaks tooling noise

`.claude/worktrees/trusting-volhard-617122` has a `tsconfig.json` extending a missing
`tsconfig.app.json`, so every `vitest` run emits repeated `TSConfckParseError` stack traces.
Harmless but it buries real output. Remove the worktree.

---

## F. Deliberately not shipped — still open

These are recorded so they are not mistaken for oversights. Each was built, measured and
rejected on evidence; the measurements are in the migration headers and in
`docs/plans/persons-declarations-audit-v1.md`.

- **F1 — T3.7, declared vs market value.** Needs an *external* price reference (the property
  AVM, НСИ deals data, or imot.bg asking prices). The declarations cannot benchmark
  themselves, and the `share` column must not be treated as a divisor on the declared price.
- **F2 — T3.9, per-cabinet aggregate.** Needs curated ministerial tenure.
  `data/finance_ministers.json` already does this for one portfolio (18 records with
  `cabinetId`); generalising it to all portfolios is a few-hundred-row curation task that
  would also fix the cohort label's time-invariance (a person's cohort is career-wide today,
  confined only by the filing's tier).
- **F3 — MP-side assets migration** into the unified declaration block (carried over from
  Tier 2).

---

## Suggested order

1. **E1, E2** — unblock the lint gate and clean the tooling noise (minutes).
2. **B1, B2, B4** — lifecycle correctness; small, self-contained, and B1/B2 prevent silent
   staleness (hours).
3. **B3** — verify production actually has the three migrations; this may already be a live
   outage of three features (hours).
4. **D1, D2** — close the route-test gap and recover the ~27 unread review findings before
   they age out (half a day).
5. **C1, C2** — move the watchlist to its own home and surface the site-wide feed (half a day).
6. **A1, A2** — the SEO tier + sitemap + staging-gated deploy. Biggest payoff, biggest risk,
   and the one that needs a decision on the person tier before work starts (1–2 days).
7. **D3** — E2E smoke, once C1 has settled the final layout.
8. **F1–F3** — each blocked on an external input or a curation task; schedule separately.
