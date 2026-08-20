# Company page consolidation — retire `/mp/company/:slug` and `companies-index.json`

Status: PROPOSED (2026-08-20), audited 2026-08-20. Nothing here is implemented **except the
CLAUDE.md correction in §9 G5, which is already applied** because it fixes a statement that was
inaccurate independently of this plan.

Related: `docs/plans/mp-tr-edges-pg-v1.md` (the same retirement, one layer over),
`docs/plans/persons-pg-retirement-v1.md`, `docs/plans/connections-pg-migration-v1.md`.

Decided during drafting: **`/mp/companies` widens to ALL public office-holders**, not MPs, and
moves to **`/governance/companies`**. That decision drives Tier 4, most of Tier 2, and eight of
the seventeen audit findings — it is not a cosmetic scope change.

---

## 1. Why there are two company pages

They are not two designs. They are **two keys**, and the split is historical.

| | `/mp/company/:slug` | `/company/:eik` |
|---|---|---|
| key | slug of the **declared company NAME** | the **EIK** |
| source | `data/parliament/companies-index.json` (4.16 MB, fetched WHOLE) | `/api/db/company` → Postgres |
| built by | `build_company_index` → `tr/integrate` → `augment_mp_roles` | nothing — served live |
| population | MPs only | every entity in `tr_companies` |
| screen | `src/screens/MpCompanyScreen.tsx` (678 lines) | `src/screens/dev/CompanyDbScreen.tsx` (1,823 lines) |

The declaration form **carries no EIK** — `declaration_stake.uic` is 100% NULL across all
15,304 stake rows and always will be (096's header). So when the declarations pipeline first
needed a company page, the only key available was a slug of the declared string. Everything
since — the TR card, `mpRoles`, the party-financing panel — was bolted onto that name key.
`/company/:eik` arrived later from the procurement side with the real registry identity.

---

## 2. Measured overlap

`data/parliament/companies-index.json`, generated 2026-08-15; PG measured 2026-08-20 local.

| bucket | entries | what it is |
|---|---|---|
| **total** | **2,969** | |
| has `tr.uic`, **no** declared stake | **994** | pure TR-only rows appended by `augment_mp_roles` — 100% duplicates of `/company/:eik` |
| has `tr.uic` **and** declared stakes | **1,159** | the only bucket where the page adds anything |
| **no** `tr.uic` | **816** | declaration-only; **all 816** carry stakes, **none** carries `mpRoles` |
| distinct UICs | 2,120 | |

Of those 2,120 UICs, against Postgres:

| | count |
|---|---|
| exist in `tr_companies` (so `/company/:eik` serves them **today**) | **2,120 / 2,120** |
| have any contract | 139 |
| present in `declaration_stake_company` — the **gated** stake→EIK resolution | **369** |

And in the other direction: **966 UICs that `declaration_stake_company` resolves are absent
from the index entirely**, because 096 covers every declarant tier while `companies-index` is
MP-only.

**The aggregation the name-keyed page exists for is vacuous.** Distinct MPs per entry:

| | 1 MP | 2 | 3+ |
|---|---|---|---|
| no-EIK entries (816) | **808** | 6 | 2 |
| EIK + stakes (1,159) | **1,145** | 14 | 0 |

99% of the EIK-less pages answer "which MPs share this company?" with *one*. That content is
already on that person's `/person` page, where `person_declared_stake_status` (096) splits the
unresolved remainder by reason — „няма такова дружество" vs „регистърът не свързва лицето с
него" — which the company page does not do at all.

### 2b. The all-officials population, sized (G3)

| set | companies |
|---|---|
| active public figure holds a gated `person_role` at source tr/ngo | **17,101** |
| …of those, present in `tr_company_place` (seat resolves to an EKATTE) | **10,373** |
| ∪ `declaration_stake_company` (the gated declared-stake arm) | **17,614** |
| today's `/mp/companies` | 2,969 |

**5.9×.** Server-side is not an optimisation here, it is the only option — and the
`/governance/declarations` hub tile number moves by roughly the same factor.

---

## 3. The four defects the split causes

**3a. The older page asserts identity on the weaker gate.** `tr/integrate.ts` attaches
`tr.uic` on a **name uniqueness check alone** (integrate.ts:314-323). `/company/:eik` and the
whole person layer use 096's three gates (name candidacy → independent registry confirmation of
*the declared holder* → the folded name is not shared by two active people) plus
`tr_name_fold_people` (148). That is the same class of defect that got `COMMON_NAME_TR_ROWS`
deleted from 150 and the `company-connections/` shards retired: **a name match graded instead of
refused**. 1,751 of the index's 2,120 UICs are attributions 096 declines to make.

**3b. `/company/:eik` already renders declared stakes — from the artifacts we want to retire.**
`company_politicians.relations` carries `{"kind":"stake","shareSize":"95%","valueEur":…}` chips.
That table has **two** name-match producers, and the page shows both:

| arm | rows | producer |
|---|---|---|
| `kind='mp'` | 94 | `companies-index.json` → `cross_reference.ts` → `mp_connected.json` |
| `kind='official'` | 579 | `data/officials/derived/company_links.json` → `pep_connected.json` |

So this is not an additive change. Adding a 096-based block without re-basing **both** arms
leaves two or three opinions about the same fact on one page — and under the all-officials
decision the second arm covers the same population as the new page (G10).

**3c. It is a 4.16 MB eager fetch to render one company.** Both `/mp/companies` and
`/mp/company/:slug` call `useCompanyIndex()`, which fetches the whole file.

**3d. It is JSON generated from Postgres.** `augment_mp_roles.ts` already reads `person_role` at
source tr/ngo — the exact set `mp_tr_roles()` (150) serves live — and freezes it into a file.
That is the `no-JSON-from-PG` rule, and it is the specific failure mode that let a broken query
print "Postgres unreachable" and keep a stale vintage for two days (augment_mp_roles.ts:60-74,
caught 2026-08-14).

---

## 4. Decision

**Retire `/mp/company/:slug` and `companies-index.json`. One company page: `/company/:eik`.**
**`/mp/companies` survives as an ALL-OFFICIALS list, served from Postgres, at
`/governance/companies`.**

The one thing worth carrying over from the retired page is the **declared-stakes / declared-roles
block** — per-company, with per-filing source links and the two footnotes that separate a
shareholding from a directorship. It moves to `/company/:eik`, served from
`declaration_stake_company`.

Three properties of that move, stated so nobody reads them as regressions:

- **It NARROWS on EIK-attribution: 369 of 2,120.** That is the correct price and 096's header
  already argues it — "recall loss is cheaper than false attribution."
- **It WIDENS on population: +966 UICs, all declarant tiers.** The block is therefore
  all-officials from day one, consistent with the `/mp/companies` decision — which means its
  copy must never say „депутати" (G17).
- **It is not a loss for the EIK-less 816.** They keep their stakes on the declarant's `/person`
  page with 096's reason attached.

---

## 5. Tiers

### Tier 1 — declared stakes on `/company/:eik`

New file `scripts/db/schema/pg/1XX_company_declared_stakes.sql`, holding ONE function:

```sql
company_declared_stakes(p_uic text) RETURNS jsonb
```

over `declaration_stake_company` ⨝ `declaration` ⨝ `person`, with 096's privacy gate
(`status='active' AND is_public_figure`).

- **A separate file, not appended to 096.** 096 opens with `DROP MATERIALIZED VIEW … CASCADE`,
  so a body fix there costs a full matview rebuild. Local is 6.1 s — which **proves nothing**:
  the local `tr_*` tables have never been ANALYZEd, and this is the exact matview whose earlier
  form ran **4 h 41 m on Cloud SQL holding an AccessExclusiveLock**. Keep function changes off
  that path.
- **⚠️ Apply AFTER 096, in the same command.** A `LANGUAGE sql` body is validated at CREATE, so
  applying it to a database without `declaration_stake_company` raises 42P01 and rolls the file
  back — the 081→082 trap. Applier: `load_declarations_pg.ts` phase 2, right after
  `STAKE_PROC_SCHEMA`. Standalone ship:
  ```bash
  DATABASE_URL=… npx tsx scripts/db/apply_functions.ts 096_stake_procurement.sql 1XX_company_declared_stakes.sql
  ```
  096's `DROP … CASCADE` does not take the new function — a `LANGUAGE sql` **string** body
  records no `pg_depend` edge. Do not write it as `BEGIN ATOMIC`, which does, and would make
  every 096 re-apply drop it silently.
- **Grouping happens in SQL.** Port `groupStakes()` / `onePerYearAndBody()` from
  `MpCompanyScreen.tsx:180-260`. The key is `(person, stake_kind, share_size)` and
  **deliberately not** size+value+basis — that splits one holding into a row per filing variant
  (Аврамов's single 50% arrives as 28 stake rows). Those header comments are the specification
  and travel with the code.
- **`holder_is_declarant` and `stake_kind` must both reach the payload.** A spouse's stake is not
  the office-holder's (096: "EVERY MONEY CONSUMER MUST FILTER ON IT"). And 54% of интереси rows
  are board seats, where `table = "11"` means "held before taking office", not "transferred".
- Wire-up: one more `Promise.all` arm on `/api/db/company` with a `.catch` degrading
  42P01/42883 → `null` (the `cleanDelivery` pattern); a new `CompanyDeclaredStakesTile` split
  into the two cards with their footnotes ported verbatim. **Tile copy is office-holder-neutral,
  never MP-worded** (G17).
- Gate: `scripts/db/tests/company_declared_stakes.data.test.ts` — reproduces 096's rows, asserts
  `holder_is_declarant` discriminates, and carries a **mutation check** (drop the holder filter,
  assert the count moves) so a filter-less implementation cannot pass.

### Tier 2 — re-base every weak company↔person claim on that page (do NOT skip; see 3b)

Once Tier 1 ships, `company_politicians` is a second, weaker opinion about the same fact on the
same page — on **both** arms.

**2a. The `mp` arm (94 rows).** Either (i) drop the `stake` relation kind from the political-links
tile and let Tier 1 own the claim, leaving `company_politicians` a procurement-money linkage only,
or (ii) re-base `mp_connected`'s stake arm on `declaration_stake_company` (which Tier 5 does
anyway). Decide from a measured diff.

**2b. The `official` arm (579 rows) — `data/officials/derived/company_links.json` (G10).** This is
the officials-side twin of the artifact being retired: same name-match method, same
`share_percent` source (`build_officials_company_links.ts:158`), and under the all-officials
decision it answers the **same question as the new `/mp/companies`**. Leaving it produces two
different official↔company answers on one site. Minimum: measure its overlap with the gated
person layer in the same pass as 2a, and record the delta. Full retirement is either a Tier 6
here or its own plan — but it must not be silently out of scope, which is what the first draft
did.

⚠️ `company_politicians` is not page-local. It feeds `contractor_rank.is_mp_tied` (122), four of
124's six aggregates, `procurement_risk_feed`, `hub_stats`, and `tr_company_place.political_n`
(133). A row-count diff is not enough: the two arms have different producers and different
populations.

### Tier 3 — retire `/mp/company/:slug`

1. `MpFinancialDeclarations.tsx:50` — stop emitting `/mp/company/${slug}`. Link to `/company/:eik`
   when 096 resolved the stake, and to nothing otherwise. `PersonCompanies.tsx` already does
   exactly this via `useDeclaredStakeStatus`; the candidate-page block adopts that rule rather
   than keeping a second one.
2. `AllMpCompaniesScreen.tsx:102` — link rows to `/company/:eik`.
3. **`public/articles/2026-05-04-mp-connections-{bg,en}.md` link it** (line 216 / 215), and both
   are folded into `public/llms-full.txt` / `llms-full.en.txt` (G1). Rewrite the link and re-run
   the llms build; `buildFull.ts` refuses to rewrite when a section would disappear, so check its
   output rather than assuming.
4. `scripts/snap-connections.mjs:182` hard-codes the same URL (G14).
5. Route: replace `MpCompanyScreen` with a resolver that 301s `/mp/company/:slug` → `/company/:eik`
   when the slug resolves, and → the single declarant's `/person/:slug` when it does not (808 of
   816 have exactly one). No sitemap or prerender entry exists, so nothing is regenerated; this is
   for the article links and bookmarks.
6. Delete `MpCompanyScreen.tsx` + test. **The financing panel does not move**: 5 entries, all
   parties, each already has a `/party/:id` dashboard rendering the same `PartyAnnualReportPanel`.
   Political parties are **not in `tr_companies`** (they register with the Sofia City Court), so
   they can never have a `/company/:eik` — which is exactly why the party case belongs on `/party`.

### Tier 4 — `/mp/companies` → `/governance/companies`, all officials, from Postgres

**Basis:** `augment_mp_roles.ts`'s `MP_ROLES_SQL` **without the MP restriction**, unioned with
`declaration_stake_company`. 17,614 companies.

- ⚠️ **NOT `tr_company_place.person_link_n`** (G2). It looks like the ready-made basis — 151
  already uses it and its header documents the same 2,159→10,202 improvement over the shards —
  but it requires a resolvable EKATTE seat and covers **10,373 of 17,101**. Building on it drops
  39% silently at a 200.
- New matview + `db_table.js` registry resource. Columns: name, EIK, seat, status, linked-people
  count, money (`company_public_money`, 127). Refreshed by `load_declarations_pg.ts` phase 2, and
  it **must call `vacuumAfterReload()`** with a matching entry in
  `reload_visibility_map.data.test.ts` — that gate only checks one direction, so a loader that
  vacuums nothing is invisible to it.
- **Rename the URL to `/governance/companies`** (DECIDED 2026-08-20). `/mp/companies` is a lie
  once the scope is all officials, and a bare `/companies` reads as a sibling of `/company/:eik`
  when it is not; `/governance/*` is where the office-holder registers already live. EN mirror is
  `/en/governance/companies`.

  ⚠️ **`governance/:id` (routes.tsx:4351) is a catch-all over that same segment** — the
  município / settlement My-Area node. React Router v7 ranks a static segment above a dynamic
  one, so `governance/companies` wins the way `governance/overview` and `governance/sectors`
  already do; and no place code is the literal string `companies`, so the enumerated `:id` set
  cannot collide. Checked 2026-08-20. Anything that ENUMERATES `governance/:id` for the sitemap
  or prerender must keep excluding the static siblings, as it already does for the five above.

  The rename touches all of the following, and they must land together (G4):
  - `firebase.json` `redirects`, `type: 301`, four entries (BG/EN × slash/no-slash) — precedent
    is the `/index` → `/` pair already in that array;
  - **both** `scripts/sitemap/route_defs.ts` lists (line 140 and line 550);
  - `scripts/prerender/routes.ts:4684` — the `staticPage` path plus its BG+EN `title`,
    `description`, `breadcrumbName` and `bodyHtml`, which say „действащите народни
    представители" / "sitting MP" explicitly;
  - four hub links naming the old path in the same file (4655, 4674, 5702, 5788);
  - `scripts/og/capture-screens.ts:881` — `slug`, `routePath`, and the `waitFor` / `anchor`
    selectors, which target `[data-og="mp-companies-og"] tbody tr`; a server-side DbDataTable
    changes that DOM, so the capture can hang or emit an empty card (G12). Re-capture and look
    at it.
  - the screen file name, the `data-og` attribute, and i18n keys (`all_companies_col_mps`, …);
  - the two article files' prose, which describe the table as "every company any MP…" (G1).
- `scripts/db/gen_governance/declarations_hub_stats.ts:53` reads `companies-index.json` as "the
  /mp/companies destination's OWN fact source", precisely so the tile and the page cannot
  disagree. It moves to the same relation **in the same change**, and its `companies` /
  `companyMps` fields are renamed — `companyMps` becomes people in public office, and a field
  keeping the name lies by name (G13).
- `scripts/db/tests/mp_roles_sql.data.test.ts` **migrates onto the new function** rather than
  being deleted with its caller (G7): it exists because that exact query failed silently for two
  days and the unit tests could not see it, since they mock `allRows`.
- ⚠️ **This page and `place_mp_companies` (151) become the national and local views of ONE
  question** (G16) and must share the predicate. 151's own name is already wrong for the same
  reason — note it there so the two cannot drift.

### Tier 5 — retire the file (heaviest; do last)

`companies-index.json` is a **build-time input**, not only a serving artifact:

```
companies-index.json ─┬─→ scripts/procurement/cross_reference.ts → mp_connected.json
                      │        → load_tr_pg.ts → company_politicians (008)
                      ├─→ scripts/funds/cross_reference.ts        (EIK → MP-linkage map)
                      ├─→ scripts/db/gen_procurement/cross_reference.ts (the SQL parity verifier)
                      └─→ scripts/db/gen_governance/declarations_hub_stats.ts   [Tier 4]
```

Both `cross_reference` modules want one thing: an **EIK → linkage map**. Tier 4's function is
already that map.

1. Land the PG linkage producer beside the file-based one; run both; **diff `mp_connected.json`
   byte-for-byte**. `db:gen-xref` is already a parity verifier and is the natural harness.
2. Expect a diff — the PG set refuses shared names the index keeps (410 of 2,014 measured
   2026-08-12) and is wider elsewhere. Record the measured delta in `company_politicians`, then in
   `contractor_rank.is_mp_tied` and 124's four MP-tied aggregates, before switching.
3. **Port the sanity floors** (G15): `procurement/cross_reference.ts:138` and
   `funds/cross_reference.ts:75` both refuse/warn when too few entries carry a `tr.uic`. They are
   the only thing between a broken index and a silently empty `mp_connected`; the PG replacement
   needs an equivalent floor or that failure becomes invisible.
4. Delete `build_company_index.ts`, `tr/integrate.ts`'s index arm, `augment_mp_roles.ts`,
   `useCompanyIndex.tsx`, and the pipeline phases in `scripts/declarations/index.ts` (2.5, 5, the
   augment step) + `rebuild_post.ts`.
5. **Deleting the producer does not delete the file or the bucket object** (G6).
   `data/parliament/companies-index.json` is committed (4.16 MB) — remove it in the same commit.
   It has **no `isExcluded` entry** in `scripts/bucket_sync_paths.ts`, so it is currently synced;
   per this repo's own rule an exclusion FREEZES rather than retires, so removal is an explicit
   `gsutil rm`. Adding the exclusion without the `rm` leaves a frozen copy on the bucket.
6. Drop `MpOwnershipStake.companySlug` (G9) — `dataTypes.ts:518`, written by declarations phase
   2.5 into every per-MP shard. ⚠️ That rewrites `public/parliament/declarations/*.json`; keep
   `formats.ts`'s compact form unchanged so the diff is the dropped field, not 1.4M lines of
   reformatting.
7. `npm run i18n:prune` (G8) — ~10 keys orphan. It is dry-run by default and deliberately in no
   chain, so it is a named manual step. Several keys are shared (`stake_transferred` has 4 use
   sites) — do not delete blind; `key_usage.test.ts` is the gate.
8. **Docs.** `README.md` names the file in four places — the `procurement/` and `funds/` module
   descriptions (327, 328) and the `update-procurement` / `update-funds` skill table rows (366,
   367), each saying "EIK-keyed against `companies-index.json`" (G11). Also the
   `update-connections`, `update-procurement`, `update-funds` and `dashboard-hub` SKILL.md files,
   and CLAUDE.md's `tr_owner_share` section (already corrected — see G5).

---

## 6. What is deliberately NOT done

- **No name-keyed company page survives.** Building `/company/name/:slug` for the 816 re-creates
  the thing being retired, on the key that caused the problem, for a page that is single-declarant
  99% of the time.
- **The EIK-less stakes are not resolved harder to fill the gap.** They are already published on
  the declarant's own page with 096's reason. Loosening a gate to grow a company page is the
  inversion this whole plan is against.
- **`company_person_roles` (022) is not touched** — it is the per-officer table behind
  `/company/:eik/officers` and answers a different question.
- **`owner_share.ts` is NOT retired.** Killing a rendering consumer does not make it dead code:
  it still writes `company_persons.share_percent`, which `load_tr_pg.ts:360` COPYs into
  `tr_person_roles.share`. See G5.

---

## 7. Open questions

1. **Tier 2a (i) or (ii)** — does the political-links tile keep a declared-stake chip once Tier 1
   owns that claim?
2. **Tier 2b scope** — is `company_links.json` retired inside this plan (a Tier 6) or given its
   own? It supplies 579 of `company_politicians`' 673 rows and is the last remaining rendering
   consumer of `owner_share.ts`.

CLOSED: the new URL is `/governance/companies` (decided 2026-08-20).

---

## 8. Suggested order

Tier 1 → Tier 3 → Tier 4 → Tier 2 → Tier 5.

Tier 1 first: purely additive and reversible. Tier 3 next: the visible win, depends only on Tier 1.
Tier 4 builds the function Tier 5 then reuses. Tier 2 and Tier 5 move numbers on
`/procurement/contractors` and the risk feed, and both want a measured diff before they ship.

---

## 9. Audit log — findings against the first draft (2026-08-20)

Every entry is folded into a tier above; the section number is given so nothing lives only here.

| # | finding | severity | folded into |
|---|---|---|---|
| **G1** | **The first draft claimed the only inbound links were two in-app call sites. False.** `public/articles/2026-05-04-mp-connections-{bg,en}.md` link `/mp/company/<slug>` (216/215) **and** `/mp/companies` (208/207), and both are folded into `llms-full.txt` / `llms-full.en.txt`. The prose also describes the table as MP-only, so the widening makes indexed content inaccurate in two languages. | **high** | Tier 3.3, Tier 4 |
| **G2** | `tr_company_place.person_link_n` looks like the ready-made all-officials basis and is not: it needs a resolvable EKATTE seat and covers **10,373 of 17,101** companies. Building Tier 4 on it drops 39% silently at a 200. | **high** | Tier 4 |
| **G4** | The rename surface was understated: URL, 4× 301s, **both** `route_defs` lists, prerender title/description/bodyHtml in BG+EN, four hub link labels, og slug + `data-og` + `waitFor` selectors, screen file name, i18n keys, article prose. | **high** | Tier 4 |
| **G10** | `data/officials/derived/company_links.json` is the officials-side twin of the retired artifact (579 of `company_politicians`' 673 rows) and was put out of scope. Under the all-officials decision it answers the SAME question as the new page, by the old method. | **high** | Tier 2b, §3b, OQ 2 |
| **G3** | All-officials sizing was unmeasured: **17,614** vs today's 2,969 — 5.9×. Confirms server-side is mandatory and that the hub tile number moves ~6×. | medium | §2b |
| **G5** | CLAUDE.md's `tr_owner_share` section named `/mp-company/:eik` — a route that does not exist (it is `/mp/company/:slug`, keyed by declared name) — as the reason the TypeScript twin exists. Verified the view derives from `share_amount` + `share_currency` via `tr_share_eur` and **never reads the stored `tr_person_roles.share`**, which is what the twin populates. So the twin and the view share no column: they are two outputs of one rule, which is why the gate compares implementations. A reader following the old wording would delete a live twin. **APPLIED — CLAUDE.md corrected.** | medium | §6, Tier 5.8 |
| **G6** | `companies-index.json` has **no `isExcluded` entry** in `bucket_sync_paths.ts`, so it is bucket-synced. Deleting from git leaves the object; an exclusion freezes rather than retires. | medium | Tier 5.5 |
| **G7** | `mp_roles_sql.data.test.ts` exists because that query silently failed for two days (unit tests mock `allRows`). It should migrate onto the new function, not be deleted with its caller. | medium | Tier 4 |
| **G9** | `MpOwnershipStake.companySlug` is written into every per-MP declaration shard. Removing it rewrites `public/parliament/declarations/*.json` — keep the compact format unchanged so the diff is one field. | medium | Tier 5.6 |
| **G15** | Both `cross_reference` modules carry a "too few `tr.uic` entries" floor that is the only guard against a silently empty `mp_connected`. The PG replacement needs an equivalent. | medium | Tier 5.3 |
| **G16** | Tier 4 and `place_mp_companies` (151) become the national and local views of one question and must share a predicate. 151's name is already wrong for the same reason. | medium | Tier 4 |
| **G8** | ~10 i18n keys orphan; `key_usage.test.ts` fails; `i18n:prune` is dry-run and in no chain. Several keys are shared and must not be deleted blind. | low | Tier 5.7 |
| **G11** | `README.md` names `companies-index.json` in four places — the `procurement/` and `funds/` module descriptions (327, 328) and two skill-table rows (366, 367). | low | Tier 5.8 |
| **G12** | The og capture waits on `[data-og="mp-companies-og"] tbody tr`; a server-side table changes that DOM and the capture can hang or emit an empty card. | low | Tier 4 |
| **G13** | `declarations_hub_stats`' `companies` / `companyMps` fields keep MP-shaped names under an all-officials basis. | low | Tier 4 |
| **G14** | `scripts/snap-connections.mjs:182` hard-codes a `/mp/company/…` URL. | low | Tier 3.4 |
| **G17** | The Tier 1 block is all-officials from day one (966 of its UICs are non-MP), so its tile copy must never say „депутати". | low | §4, Tier 1 |

**Verified-and-clear (no action).** `/mp/company/:slug` genuinely has no sitemap `<loc>`, no
prerender entry and no og:image. `scripts/llms/buildIndex.ts` carries no `/mp/companies` entry.
All 2,120 index UICs exist in `tr_companies`, so `/company/:eik` cannot hit its dead-end branch
(`!company && !institution && !hasProcurement`) for any of them. `declaration_stake_company` has
no matview dependents, so 096 re-applies cleanly (6.1 s local — a figure that says nothing about
Cloud SQL, per the ANALYZE caveat in Tier 1).
