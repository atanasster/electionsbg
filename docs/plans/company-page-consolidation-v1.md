# Company page consolidation — retire `/mp/company/:slug` and `companies-index.json`

Status: **IN PROGRESS (2026-08-21)** — Tiers 1–5 are IMPLEMENTED and committed; Tier 6 is
open. Each tier's "As built" note records where the plan turned out to be wrong; read those
before acting on the prose above them, which is the 2026-08-20 design and is left unedited on
purpose.

Was: "PROPOSED (2026-08-20), audited 2026-08-20. Nothing here is implemented **except the
CLAUDE.md correction in §9 G5**…" — true for one day, and the line eight other plans now link
to, which is why it is the first thing corrected here.

Related: `docs/plans/mp-tr-edges-pg-v1.md` (the same retirement, one layer over),
`docs/plans/persons-pg-retirement-v1.md`, `docs/plans/connections-pg-migration-v1.md`.

**Decisions taken (2026-08-20), all three binding on the tiers below:**

1. **`/mp/companies` widens to ALL public office-holders**, not MPs, and moves to
   **`/governance/companies`**.
2. **The political-links tile KEEPS its declared-stake chip** — so the chip is not dropped, it is
   RE-BASED off the gated layer (Tier 4a). That is the more expensive of the two options and it
   is what pulls `company_politicians` into scope.
3. **`data/officials/derived/company_links.json` is retired inside this plan** (Tier 4b + Tier 6).

Together, 2 and 3 mean **both** arms of `company_politicians` stop being file-fed — which makes
the table PG-native, and makes Tier 4 the largest and riskiest step here. §5 Tier 4 is where the
measured consequences live; they were not in the first two drafts.

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
decision the second arm covers the same population as the new page (G10). Decision 2 keeps the
chip, so both arms are re-based rather than dropped: Tier 4.

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

### Tier 2 — retire `/mp/company/:slug`

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

### Tier 3 — `/mp/companies` → `/governance/companies`, all officials, from Postgres

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

### Tier 4 — re-base `company_politicians` onto the gated person layer (the heavy one)

Decisions 2 and 3 land here. Both arms of `company_politicians` stop being file-fed, which is
what lets Tiers 5 and 6 delete their producers — so **Tier 4 must precede both**.

**4a. The `mp` arm (94 rows / 89 EIKs).** The chip stays, so `relations`' `kind:'stake'` entries
are rebuilt from `declaration_stake_company` instead of `companies-index.json`. The matview
already carries `share_size`, `value_eur` and `stake_year`, so the chip renders identically —
only the population changes. Role kinds come from `person_role` at source tr/ngo.

**4b. The `official` arm (579 rows / 402 EIKs).** Replaced by the same gated query, unrestricted
by tier. This is what retires `company_links.json` (Tier 6).

**4c. The table becomes PG-native.** With no file input left, `load_tr_pg.ts`'s JSON-reading block
and its `TRUNCATE company_politicians` + `copyTable` go away, and the table becomes a matview or a
migration-owned relation refreshed on the person chain. Two things fall out of that:

- **`ref` becomes a real `person_id`.** Today it is a URL STRING — `/officials/<slug>` and
  `/candidate/mp-<id>` — parsed by regex at **five sites in `load_graph_pg.ts`** (184, 192, 204,
  312, 316) and at a sixth in `112_contract_risk_cache.sql` (`ref LIKE '/candidate/mp-%'`). That
  is the brittle bridge whose breakage the graph loader's per-arm preflight exists to catch
  (G20).
- **`/officials/<slug>` is a 301 family**, redirected to `/person/<slug>` by
  `functions/officials_redirect.js`. Every official ref in this table currently points at a
  redirecting URL; the re-base points them at the real one.

#### ⚠️ The measured consequence — this is the largest change in the plan (G19)

`company_politicians` is read by **24 migrations**. The two that matter most are
`033_procurement_risk_indexes.sql`, which publishes `mpConnectedEiks` / `pepConnectedEiks`
straight to the **client-side risk scorer**, and `112_contract_risk_cache.sql`, whose `mp` and
`pep` CTEs feed `041`'s BUYER `connection` and SUPPLIER `connectedSelf` components — i.e. the
per-contract **A–F `risk_grade`**, which is cached, rendered in the contracts browser's risk
column and filterable via `?grade=D,E,F`.

| linked-EIK set | today | gated replacement |
|---|---|---|
| `kind='mp'` | 89 | — |
| `kind='official'` | 402 | — |
| **total distinct EIKs** | **464** | **925** (registry-role arm, contract-holding) **+ 127** (declared-stake arm) |

**The politically-connected-supplier population roughly doubles**, while refusing the shared-name
attributions the current set includes. So contracts change grade in both directions, and the
change is user-visible on a filterable column. Nothing in the first two drafts said this.

Required before shipping 4a/4b:

1. Build the replacement beside the current table and **diff the EIK sets**, split by arm — which
   EIKs are gained, which are lost, and for the losses, confirm each is a shared-name refusal
   rather than a bridge bug.
2. Re-derive `contract_risk_cache` on both bases and **report the grade-transition matrix**
   (how many contracts move A→B, C→D, …). A count of changed rows is not enough; the direction
   is the story.
3. Re-check every other money surface that reads the table:
   `contractor_rank.is_mp_tied` (122), 124's four MP-tied aggregates, `procurement_risk_feed`
   (029 → `/procurement/flags`), `tr_company_place.political_n` (133), plus `hub_stats`,
   `awarder_kindex` (039), `ngo_signals` (080), `agri_political` (163) and
   `budget_admin_procurement` (157).
4. Refresh every dependent in one pass. `112`'s own header says a missing dependency here "should
   surface, not be swallowed" — so a partial apply is a hard failure, not a degrade.

### Tier 5 — retire `companies-index.json`

`companies-index.json` is a **build-time input**, not only a serving artifact:

```
companies-index.json ─┬─→ scripts/procurement/cross_reference.ts → mp_connected.json
                      │        → load_tr_pg.ts → company_politicians (008)
                      ├─→ scripts/funds/cross_reference.ts        (EIK → MP-linkage map)
                      ├─→ scripts/db/gen_procurement/cross_reference.ts (the SQL parity verifier)
                      └─→ scripts/db/gen_governance/declarations_hub_stats.ts   [Tier 3]
```

**Tier 4 has already cut the top branch.** Once `company_politicians` is PG-native, nothing loads
`mp_connected.json` into it, and the diff that branch existed to protect was taken in Tier 4 —
so do not re-take it here. What remains is the two branches Tier 4 does not touch: the funds
linkage map and the parity verifier.

1. **`scripts/funds/cross_reference.ts`** builds its own EIK → linkage map straight from the file.
   Point it at Tier 3's gated function. Its output feeds the funds MP-tied payload, so diff that
   payload rather than `mp_connected.json`.
2. **`scripts/db/gen_procurement/cross_reference.ts`** is the sql-migration parity verifier: it
   re-derives `mp_connected` / `pep_connected` from Postgres and byte-compares them to the on-disk
   files. With both files retired it has nothing left to verify on those two arms — retire those
   arms of the verifier rather than leaving it comparing against files that no longer exist, which
   would degrade to a permanent "no live file" log line that reads as passing.
3. **Port the sanity floors** (G15): `procurement/cross_reference.ts:138` and
   `funds/cross_reference.ts:75` both refuse/warn when too few entries carry a `tr.uic`. They are
   the only thing between a broken index and a silently empty `mp_connected`; the PG replacement
   needs an equivalent floor or that failure becomes invisible.

#### As built (2026-08-20) — and the one thing item 1 got wrong

**⚠️ `scripts/procurement/cross_reference.ts` is NOT deleted; it is re-based.** The diagram
above shows `companies-index.json → procurement/cross_reference.ts → mp_connected.json →
load_tr_pg`, and Tier 4 cut only the LAST arrow. `data/procurement/derived/mp_connected.json`
is still a live build input — `scripts/budget/cross_reference.ts` reads it for the
per-ministry MP-connected flag, and three `gen_procurement` verifiers read it — so deleting
its producer would have broken the budget dashboard. Item 3 already implied this by asking for
that file's sanity floor to be ported.

**⚠️ AND THE TWO BUILDERS CANNOT SHARE A SOURCE, which item 1 assumed they could.**
`company_politicians` is **contract-restricted** — its loader inner-joins procurement money, so
every row is "a politically linked CONTRACTOR", which is what the A–F contract grade and every
MP-tied procurement figure mean by it. That is right for the procurement builder, whose join
population IS contractors. It is wrong for the funds builder, whose population is ИСУН
beneficiaries: an MP-linked company that took EU money and never won a public contract is
exactly the row that payload exists to report. **Measured: the restricted set answers 43 of the
funds payload's 303 pairs.** Nor is Tier 3's `official_companies` usable — it is per-COMPANY and
carries no person identity, so it cannot emit `(mpId, EIK)` pairs at all.

So `armSql` in `load_tr_pg.ts` gained one option, `requireContracts`, and exports
`MP_ARM_ALL_SQL` beside `MP_ARM_SQL` — the same gate, the money join `LEFT` instead of inner
(and `total_eur` therefore NULL, because that column holds procurement money and a zero would
read as "won nothing" rather than "not asked"). `scripts/lib/mp_linkage.ts` owns the query, the
two-state probe and the `mpId` parse; each builder names its scope.

**Measured against the committed payloads:**

| payload | built | committed | only-built | only-committed |
| --- | --- | --- | --- | --- |
| `data/procurement/derived/mp_connected.json` (scope `contractors`) | 94 | 94 | 0 | 0 |
| `data/funds/derived/mp_connected.json` (scope `all`) | 173 | 303 | 19 | 149 |

The procurement half round-trips exactly, which is the parity proof. The funds half is Tier 4's
accepted consequence arriving on a second surface, and the losses partition the same way T4.1b
established: **56 of the 149 are stake-only, and of their 56 EIKs only 11 appear in
`declaration_stake_company` at all — none with `holder_is_declarant`**, i.e. they are spouse
holdings or stakes 096 refuses. The remaining 93 are registry roles the `tr_name_fold_people`
fold refuses. 19 pairs are GAINED, so it is not a subtraction.

**Two defects this step introduced and fixed, both worth remembering:** `Number(null)` is `0`
and `0` is finite, so a `Number.isFinite` guard over a nullable ref accepts a ref-less row as MP
id **0** — every entry collapses onto one id and `writeMpConnectedShards` prunes the real
per-MP shards while writing a single `0.json`, at exit 0. And the source-scan gate initially
failed on its own headers, because those headers NAME `companies-index.json`: it needs
`stripComments`, per that module's rule that prose MENTIONING a pattern is not an occurrence of
it.
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

   **As built (2026-08-21) — and the first draft of this note got the REASON wrong twice, which
   is worth keeping because both errors are the ones this step invites.**

   The run reports `6253 keys · 5709 named · 419 built · 125 plural · 0 dead`. That is not
   because the retired screens' keys turned out to be shared: **15 of the 26 keys those two
   screens used are gone from the corpus**, stranded exactly as G8 predicted and deleted with
   their screens in Tiers 2.3 and 3.3. Tier 5 removes no UI copy at all, so there was nothing
   left here to orphan. The estimate was right; it was simply spent two tiers earlier.

   ⚠️ **AND `0 dead` IS A FLOOR, NOT A PROOF.** `key_usage.ts`'s reachability check is a
   SUBSTRING test, deliberately biased toward keeping — a key survives if its name appears
   anywhere in the scanned sources, including inside a longer identifier or a comment. `tr_eik`
   was kept alive for exactly that reason: the string sits inside `person_slug_tr_eiks` in a
   data test's comment, while its last real call site died with `AllMpCompaniesScreen.tsx` in
   Tier 3.3. It is deleted here by hand. Read the prune as "nothing is PROVABLY dead", and
   check by hand any key a retired screen owned.
8. **Docs.** *(Done in Tier 5.2's repair pass — the review confirmed the sweep against that
   tree, and a confirmed finding is fixed in the step that surfaces it.)* `README.md` names the
   file in four places — the `procurement/` and `funds/` module
   descriptions (327, 328) and the `update-procurement` / `update-funds` skill table rows (366,
   367), each saying "EIK-keyed against `companies-index.json`" (G11). Also the
   `update-connections`, `update-procurement`, `update-funds` and `dashboard-hub` SKILL.md files,
   and CLAUDE.md's `tr_owner_share` section (already corrected — see G5).

   ⚠️ **The worst single line was `update-connections`'s YAML front-matter `description`** — the
   text the skill picker shows — which said the skill "rebuilds the companies-index" and told an
   operator to run it "after a fresh git clone if `public/parliament/companies-index.json` is
   missing". A missing copy is now the CORRECT state, so that line sent someone to run a
   pipeline that can no longer produce the file.

   **EIGHT other plans named it as a live dependency and were corrected too (2026-08-21).** A
   retirement is not finished while another plan still schedules work against the retired
   thing — and the first pass here found two of the eight, which is why the review caught it.
   ⚠️ The count and the section numbers in this table were BOTH wrong in their first draft
   (seven, and two mis-cited sections); a citation in a plan is copied forward by whoever
   reads it next, so grep the retirement rather than following the table:

   | plan | what it said |
   |---|---|
   | `connections-pg-migration-v1.md` | §6's **"KEEP `companies-index.json` + `company_links.json` (load sources)"** — the ORIGINAL declaration every other plan cites. Struck, with a banner at the head of the file. |
   | `mp-tr-edges-pg-v1.md` | §2(a) called the file a blocker and Tier 3 step 1 said to edit `augment_mp_roles.ts`; step 4 said to keep the `tr` block, which was `integrate.ts`'s last output. |
   | `data-hub-lateral-edges-v1.md` | §11.7 step 1 ("cut the build-time loop") and §11.7 step 4's **"Keep `companies-index.json`"**; §11.8b step 7 cited it as the example of a load source. |
   | `ngo-risk-signals-v1.md` | ⚠️ TWO sites, and only the small one was obvious. The MP-on-board bullet said the leg "still needs `companies-index.json` rebuilt via `update-connections` (a scrape)". §A2, "the critical build", is the bigger one: its whole diagnosis — that the ONLY thing starving NGOs is `buildMpConnectedFrom`'s `if (!contractor) continue` gate — was invalidated by Tier 5.1, which moved the contract restriction UPSTREAM of the linkage map. Both remedies it prescribes now reach nothing. |
   | `direct-db-ingest-v1.md` | §4's bucket-B row listed the file under "Not-yet-in-PG — build PG tables + API, then retire JSON"; the "Source of truth today" paragraph below it named the deleted builder. |
   | `donors-connections.md` | told a future implementer to bridge donor UICs against `companies-index.json`'s `mpRoles` — which was also the wrong source on its own terms, its registry arm being the ungated name match the bullet's own „drop identical normalised names" clause gropes at. |
   | `persons-pg-retirement-v1.md` | THREE sites. §2 told a future implementer to MOVE the file out of `data/` to cut sync enumeration (deleting it is the cheaper outcome); Tier 3 carried a SECOND copy of connections-pg-migration §6's "declared keep", which striking the original did not reach; and its hook inventory still listed `useCompanyIndex`. |
   | `consumption-pg-v1-implementation.md` | cited its deleted module as one of three existing slug helpers. |

   ⚠️ **The lesson generalises past this file.** A stale *description* is a nuisance; a stale
   *diagnosis* — §A2 — survives review because it reads as reasoning rather than as a fact,
   and the next implementer spends the day discovering it is wrong.


### Tier 6 — retire `company_links.json`

Decision 3. Depends on Tier 4b having already replaced its only serving path.

**What it is (G18).** `scripts/declarations/build_officials_company_links.ts` →
`data/officials/derived/company_links.json`: **70,525 links over 9,659 officials and 22,960
distinct UICs**, of which **60,317 (85.5%) are low-confidence**. Its confidence model is the
discredited one, stated in its own header — "high only when the name is rare on BOTH sides:
unique among officials AND mapped to a single TR company" — i.e. the `isUniqueName`
one-company straitjacket that 158's header calls wrong in both directions.

**Why the serving risk is nevertheless small.** `pep_connected.ts` gates to HIGH confidence AND
to companies that actually hold contracts, so only ~579 (official, EIK) pairs of the 70,525 links
ever reach `company_politicians`. The file is a large latent liability, not a large live surface.

Chain to unwind:

```
company_links.json → pep_connected.ts → derived/pep_connected.json + derived/pep-by-eik/
                                      → load_tr_pg.ts → company_politicians (kind='official')
                                      → derived.ts (journalism payload)
                                      → risk_feed.ts → derived/risk_feed.json
                                                     + derived/person_procurement_index.json
```

**Most of that chain is already dead on the serving side — verify, do not assume (G21).**
`/procurement/people` is retired (`TopMpsScreen` replaced the scanner) and `useRiskIndexes` reads
`/api/db/procurement-risk-indexes` rather than the static files, so `pep-by-eik/` and
`person_procurement_index.json` have no client reader; `/procurement/flags` reads
`procurement_risk_feed` (029), which reads `company_politicians`, not the JSON. Confirm each with
a fresh grep before deleting — the `company-connections/` precedent is that a reader hid in `ai/`,
which is not under `src/ scripts/ functions/`.

Then: delete the builder, `scripts/run-officials-links-only.ts`, `pep_connected.ts`'s file arm,
the `pep_connected`/`pep-by-eik` outputs, the `formats.ts` pretty-format entry, and the two
operator hints that name the rebuild command
(`officials/remerge_collision_slugs.ts:250`, `officials/migrate_slug_normalisation.ts:473`).
Check `bucket_sync_paths.ts` for the outputs, as in Tier 5.5 — an exclusion freezes, it does not
retire.

#### As built (2026-08-21) — and the parity check it was nearly signed off with

**`pep_connected.json` is NOT deleted; it is re-based.** The plan says to delete
"`pep_connected.ts`'s file arm" — but four artifacts read `PepConnectedFile`
(`derived.ts`'s `buildFlow`, `by_ns.ts`, `risk_feed.ts` and the `index.json` summary), so
cutting the arm would have left every one of them producing a half-graph at exit 0. It reads
`company_politicians` at `kind='official'` instead, through a new `readOfficialLinkRows` in
`scripts/lib/mp_linkage.ts` — the exact move Tier 5.1 made for the mp side. The funds
political-economy join and the NGO board-links loader, both of which read the file and neither
of which the plan lists, were handled the same way.

**Two gates were dropped as redundant and one kept**, verified against `armSql`'s `gated` CTE:
`confidence === "high"` and `namesakeCount === 1` have nothing left to drop, because migration
148's `tr_name_fold_people` fold already REFUSES a shared name. The 9-digit EIK clause STAYS —
it is a different rule (skip the 13-digit BULSTAT sub-units).

⚠️ **THE FIRST PARITY CHECK WAS INVALID, AND IT LOOKED PERFECT.** Rebuilding `pep_connected`
from Postgres reproduced the committed file at **579 pairs / 561 officials, 0 either way** —
which review showed was the retired `company_links.json` round-tripping through a
`company_politicians` still holding its PRE-2026-08-20 vintage, compared on PAIR IDENTITY
only. Field-by-field the same run was `roleDiff 0 · tierDiff 48 · relDiff 579`. Three defects
hid behind it:

- **`role` is the OFFICE, and `company_politicians.role` is not it.** Every consumer contracts
  that field as the person's office (`NsTopOfficial.role`; `PoliticalOfficialLink.category`
  falls back to it) — `councillor`, `deputy_minister`, `state_enterprise`. It reads as right
  today only because the stored vintage came from `pep_connected.json`, where `role` WAS the
  office; the re-based `OFFICIAL_ARM_SQL` sets it to the COMPANY relationship, so the next
  `db:load:tr:pg` would have flipped the vocabulary to `director 393 / manager 236 / stake 54`
  and published "director" as a public office. The reader takes `person_role.role` from the
  join it already had.
- **The relation key differs by vintage.** Stored rows are `[{"role":"director"}]`; the
  re-based arm emits `[{"kind":"manager","isCurrent":true}]`. Reading only `kind` yields
  `undefined` on every current row — and the `?? r.role` fallback then substituted the OFFICE
  into the relation, rendering „държавно предприятие · държавно предприятие" on `/company/:eik`
  and the literal `tr` on the funds row. Both keys are accepted; there is no fallback to the
  office, and a relation with neither key is DROPPED rather than invented.
- **The soft skip was lost.** `buildPepConnected` used to return an empty payload when its
  file was absent; five procurement CLIs call it AFTER writing the corpus, so the throw would
  have aborted an ingest at the very end on any machine without Postgres. Restored, with the
  absent/empty split this plan uses everywhere.

**One genuine narrowing, found and closed:** `officials/index.json` is the EXECUTIVE index and
resolves **0 of the 116 municipal** linked officials, so re-basing without a second join took
every councillor's `municipality` to null. `data/officials/municipal/index.json` restores all
116. `tier` legitimately differs on 48 rows: the retired file had two buckets and the person
layer has four sources under this arm (`public_sector` 46, `mep` 2), which pass through as
themselves rather than being filed under a government tier they are not in.

---

⚠️ **`build_officials_company_links.ts` is the LAST rendering consumer of `owner_share.ts`**
(it reads `share_percent` at line 158). Retiring it does **not** make the twin dead code — the
twin still writes `company_persons.share_percent`, which `load_tr_pg.ts:360` COPYs into
`tr_person_roles.share`. CLAUDE.md now states this explicitly (G5); do not undo it.

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

## 7. Decisions taken

All three open questions are closed (2026-08-20):

1. **`/mp/companies` scope** → ALL public office-holders. §2b, Tier 3.
2. **The new URL** → `/governance/companies`. Tier 3.
3. **The declared-stake chip** → KEPT, and re-based off the gated layer rather than dropped.
   Tier 4a.
4. **`company_links.json`** → retired inside this plan. Tier 4b + Tier 6.

No open questions remain. What is still UNKNOWN rather than undecided is the grade-transition
matrix in Tier 4 — that is a measurement to take during implementation, not a decision to make
now.

## 8. Suggested order

**Tier 1 → 2 → 3 → 4 → 5 → 6.**

- **Tier 1** first: purely additive, reversible, and the only tier that ships reader value on its
  own.
- **Tier 2** next: the visible win, depends only on Tier 1.
- **Tier 3** builds the gated all-officials function that Tier 4 then reuses.
- **Tier 4 is the gate for everything after it.** Both files stay alive until it lands, because it
  is what replaces their only serving path — and it is the step that moves the contract risk
  grade. Do not start 5 or 6 before its diff is measured and accepted.
- **Tiers 5 and 6** are then deletions with no behaviour left in them.

Tier 4 is also the one to split across more than one commit: 4a and 4b can be measured
independently, and 4c (the PG-native rewrite plus `ref` → `person_id`) should not ride in the same
change as either.

## 9. Audit log — findings against the first draft (2026-08-20)

Every entry is folded into a tier above; the section number is given so nothing lives only here.

| # | finding | severity | folded into |
|---|---|---|---|
| **G1** | **The first draft claimed the only inbound links were two in-app call sites. False.** `public/articles/2026-05-04-mp-connections-{bg,en}.md` link `/mp/company/<slug>` (216/215) **and** `/mp/companies` (208/207), and both are folded into `llms-full.txt` / `llms-full.en.txt`. The prose also describes the table as MP-only, so the widening makes indexed content inaccurate in two languages. | **high** | Tier 2.3, Tier 3 |
| **G2** | `tr_company_place.person_link_n` looks like the ready-made all-officials basis and is not: it needs a resolvable EKATTE seat and covers **10,373 of 17,101** companies. Building Tier 4 on it drops 39% silently at a 200. | **high** | Tier 3 |
| **G4** | The rename surface was understated: URL, 4× 301s, **both** `route_defs` lists, prerender title/description/bodyHtml in BG+EN, four hub link labels, og slug + `data-og` + `waitFor` selectors, screen file name, i18n keys, article prose. | **high** | Tier 3 |
| **G10** | `data/officials/derived/company_links.json` is the officials-side twin of the retired artifact (579 of `company_politicians`' 673 rows) and was put out of scope. Under the all-officials decision it answers the SAME question as the new page, by the old method. | **high** | Tier 4b, Tier 6, §3b |
| **G3** | All-officials sizing was unmeasured: **17,614** vs today's 2,969 — 5.9×. Confirms server-side is mandatory and that the hub tile number moves ~6×. | medium | §2b, Tier 3 |
| **G5** | CLAUDE.md's `tr_owner_share` section named `/mp-company/:eik` — a route that does not exist (it is `/mp/company/:slug`, keyed by declared name) — as the reason the TypeScript twin exists. Verified the view derives from `share_amount` + `share_currency` via `tr_share_eur` and **never reads the stored `tr_person_roles.share`**, which is what the twin populates. So the twin and the view share no column: they are two outputs of one rule, which is why the gate compares implementations. A reader following the old wording would delete a live twin. **APPLIED — CLAUDE.md corrected.** | medium | §6, Tier 5.8, Tier 6 |
| **G6** | `companies-index.json` has **no `isExcluded` entry** in `bucket_sync_paths.ts`, so it is bucket-synced. Deleting from git leaves the object; an exclusion freezes rather than retires. | medium | Tier 5.5 |
| **G7** | `mp_roles_sql.data.test.ts` exists because that query silently failed for two days (unit tests mock `allRows`). It should migrate onto the new function, not be deleted with its caller. | medium | Tier 3 |
| **G9** | `MpOwnershipStake.companySlug` is written into every per-MP declaration shard. Removing it rewrites `public/parliament/declarations/*.json` — keep the compact format unchanged so the diff is one field. | medium | Tier 5.6 |
| **G15** | Both `cross_reference` modules carry a "too few `tr.uic` entries" floor that is the only guard against a silently empty `mp_connected`. The PG replacement needs an equivalent. | medium | Tier 5.3 |
| **G16** | Tier 4 and `place_mp_companies` (151) become the national and local views of one question and must share a predicate. 151's name is already wrong for the same reason. | medium | Tier 3 |
| **G8** | ~10 i18n keys orphan; `key_usage.test.ts` fails; `i18n:prune` is dry-run and in no chain. Several keys are shared and must not be deleted blind. | low | Tier 5.7 |
| **G11** | `README.md` names `companies-index.json` in four places — the `procurement/` and `funds/` module descriptions (327, 328) and two skill-table rows (366, 367). | low | Tier 5.8 |
| **G12** | The og capture waits on `[data-og="mp-companies-og"] tbody tr`; a server-side table changes that DOM and the capture can hang or emit an empty card. | low | Tier 3 |
| **G13** | `declarations_hub_stats`' `companies` / `companyMps` fields keep MP-shaped names under an all-officials basis. | low | Tier 3 |
| **G14** | `scripts/snap-connections.mjs:182` hard-codes a `/mp/company/…` URL. | low | Tier 2.4 |
| **G17** | The Tier 1 block is all-officials from day one (966 of its UICs are non-MP), so its tile copy must never say „депутати". | low | §4, Tier 1 |
| **G19** | **The re-base changes the per-contract A–F `risk_grade`, and nothing in the first two drafts said so.** `company_politicians` is read by **24 migrations**; `112_contract_risk_cache.sql`'s `mp` / `pep` CTEs feed `041`'s BUYER `connection` and SUPPLIER `connectedSelf` components, and `033` publishes the two EIK sets straight to the client-side risk scorer. The linked-EIK population goes **464 → ~925 + 127**, roughly doubling, on a column that is cached, rendered and filterable via `?grade=`. | **high** | Tier 4 |
| **G18** | `company_links.json` is **70,525 links / 9,659 officials / 22,960 UICs, 85.5% low-confidence**, on the "name rare on BOTH sides" model its own header describes — the `isUniqueName` straitjacket 158 calls wrong in both directions. Only ~579 pairs reach serving (`pep_connected` gates to high + contract-holding), so it is a large latent liability rather than a large live surface. | **high** | Tier 6 |
| **G20** | `company_politicians.ref` is a URL STRING (`/officials/<slug>`, `/candidate/mp-<id>`) parsed by regex at **five sites in `load_graph_pg.ts`** and a sixth in `112`. `/officials/*` is itself a 301 family, so every official ref points at a redirecting URL. The re-base replaces it with a real `person_id` and removes the bridge. | medium | Tier 4c |
| **G21** | Most of the `pep_connected` chain is already dead on the serving side — `/procurement/people` is retired (`TopMpsScreen`), `useRiskIndexes` reads `/api/db/procurement-risk-indexes`, and `/procurement/flags` reads `procurement_risk_feed`. So `pep-by-eik/` and `person_procurement_index.json` have no client reader. Verify with a fresh grep INCLUDING `ai/` — the `company-connections/` precedent is a reader that hid there. | medium | Tier 6 |

**Verified-and-clear (no action).** `/mp/company/:slug` genuinely has no sitemap `<loc>`, no
prerender entry and no og:image. `scripts/llms/buildIndex.ts` carries no `/mp/companies` entry.
All 2,120 index UICs exist in `tr_companies`, so `/company/:eik` cannot hit its dead-end branch
(`!company && !institution && !hasProcurement`) for any of them. `declaration_stake_company` has
no matview dependents, so 096 re-applies cleanly (6.1 s local — a figure that says nothing about
Cloud SQL, per the ANALYZE caveat in Tier 1). `governance/:id` (routes.tsx:4351) cannot shadow
`/governance/companies`: React Router ranks static above dynamic, and no place code is the literal
string `companies`. ESLint covers only `.ts/.tsx`, so neither this plan nor CLAUDE.md can break
the `npm run lint` predeploy hook.

**Final audit pass (2026-08-20, third).** Triggered by decisions 2 and 3, which moved
`company_politicians` from a side note into the plan's largest step. It added G18–G21 and
restructured §5 into six tiers; G19 in particular is the finding that reorders the work, since it
makes Tier 4 the gate for both retirements rather than a cleanup after them.
