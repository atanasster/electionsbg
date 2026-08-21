# MP↔TR edges → Postgres (`mp-management`, `companies-by-ekatte`, `companies-by-obshtina`)

Status: **plan, superseded in part**. Measured 2026-08-11 against local Postgres
(`electionsbg`, port 5433) and the committed `data/parliament/` tree.

> **⚠️ Read [data-hub-lateral-edges-v1.md §11](data-hub-lateral-edges-v1.md) first.** After this
> plan was drafted, the TR daily feed was found to publish a **stable per-person EGN hash**
> (`Indent` + `IndentType`) that we currently discard by policy. That changes the premise of §2c
> and §5 below: the confidence model exists because we had no identity key, and for 95.2% of TR
> person rows we do. The tiers here still describe the right destination tables and the right
> retirement order — but **Tier 1 must be built on the person key, not as a verbatim port of the
> name-match confidence model.** §11.4–§11.5 there is the engine; §11.7 is the retirement, which
> supersedes Tier 3 step 5 here. The measurements in §1–§3 below are unaffected and still stand.

Three bucket-served shard families are the last un-migrated members of
`docs/plans/connections-pg-migration-v1.md` §5. They are **one edge set seen from two
grains** — `mp-management` is (MP → company), `companies-by-{ekatte,obshtina}` is the
same edges inverted to (place → company → MPs) — so they migrate together or not at all.

## 1. What is on the bucket today

| Family | Files | Bytes | Content |
|---|---|---|---|
| `parliament/mp-management/{mpId}.json` | 896 | 3.6 MB | 3,023 roles (648 `high`, 2,375 `medium`) over **2,014 distinct (MP, company) pairs**, 896 MPs |
| `parliament/companies-by-ekatte/` | 376 | 2.2 MB | **176 places**, 2,159 companies (Sofia `68134` = 824 / 17 pages) |
| `parliament/companies-by-obshtina/` | 270 | 1.5 MB | **131 places**, 1,335 companies |

All three pass `isExcluded()` in `scripts/bucket_sync_paths.ts` — i.e. they are still
uploaded by every `bucket:sync`, unlike the eight `parliament/` entries already refused
there.

**Readers**

| Hook | Screen | What it needs |
|---|---|---|
| `useMpManagement` | `MpManagementRoles`, `MpProfileSections` (the `/candidate/:id` + `/person/:slug` profile) | one MP's TR roles + confidence badge |
| `useCompaniesHqSummary` | `SettlementCompaniesScreen` **and** `PlaceCompaniesTile` | count/totalPages; on the tile only to decide whether to render the "MP-linked" link |
| `useCompaniesHqPage` | `SettlementCompaniesScreen` (`/settlement/:id/companies`, `/sofia/companies`) | one 50-row page |

**Writers** — `scripts/declarations/tr/integrate.ts` (Phase 5, from
`raw_data/tr/state.sqlite` → `company_persons ⨝ companies`) then
`build_companies_by_settlement.ts` / `build_companies_by_obshtina.ts` over
`companies-index.json`.

## 2. Why they are still on the bucket

Four reasons, in descending order of how much each actually blocks.

**(a) `mp-management` is a BUILD-TIME INPUT, not only a serving artifact.** ⚠️
**[2026-08-21] RESOLVED — this blocker no longer exists, and nothing in it can be acted
on.** Every module it names is deleted: `augment_mp_roles.ts`, `integrateTr`
(`tr/integrate.ts`), `buildCompaniesBySettlement` / `…Obshtina`, and
`companies-index.json` itself, whose "declared keep" in connections-pg-migration-v1 §6 is
struck through there. See `docs/plans/company-page-consolidation-v1.md` Tier 5. Kept below
as the account of why the retirement stalled for as long as it did:

> This is the real blocker and the reason a hook repoint is not enough.
> `scripts/declarations/augment_mp_roles.ts` reads `mp-management/*.json` back off disk to
> write `mpRoles` onto `companies-index.json`, and `build_companies_by_*` then read that.
> The ordering is asserted in `scripts/declarations/index.ts`:
>
> ```
> integrateTr  →  augmentCompaniesIndexWithMpRoles  →  buildCompaniesBySettlement / …Obshtina
> ```
>
> So the files are load-bearing for a pipeline step that has nothing to do with serving.
> Deleting them breaks `companies-index.json`, which is a **declared keep** in
> connections-pg-migration-v1 §6 ("KEEP `companies-index.json` … (load sources)").

**(b) Their replacements arrived from a different direction, so the plan rows were
never ticked.** `PlaceCompaniesTile` (3560d4d420, "ask which companies are registered
here, not which one matched an MP's name") replaced `CompaniesHqTile` with a live PG
route (`place_companies()`, migration 133). That satisfied the *tile* but left the
*shards* powering a page nobody re-pointed — and left `useCompaniesHqSummary` wired into
the new tile purely as a link gate, which is why one bucket fetch still fires on every
governance dashboard.

**(c) The confidence model has no PG home, and the person layer refuses to build one.**
*(Superseded — see the banner. The reason it has no home is that it was solving the wrong
problem: the TR feed publishes an identity key and we discard it. Retained here because the
description of the current behaviour is still accurate.)*
`integrate.ts` mints an MP↔company edge from a **name match**, graded `high` when
corroborated (TR seat ∈ MP region, or the MP declared a stake in that UIC, or a
same-party MP did) and `medium` otherwise, then applies the name-frequency guard
(`COMMON_NAME_TR_ROWS = 11`, c97af171c7). The PG person layer reaches the opposite
conclusion by design — Bridge B only mints an identity for a unique full name with a
≤5-company footprint — so `person_role` cannot reproduce the medium tier and was never
going to. A migration therefore needs a **new table**, not a query over existing ones.
That is a modelling decision, which is why it kept being deferred.

**(d) The pain went away before the migration did.** Once the tile stopped reading the
shards and the name-frequency guard cut the namesake blast radius from 319 companies to
0 for the worst case, what remained was one gating fetch and a page most users never
reach. 7.3 MB across 1,542 files is small next to the trees already retired.

## 3. What Postgres already holds

| PG object | Rows | Relevance |
|---|---|---|
| `tr_person_roles` (003) | 1,340,793 | **the same `company_persons` table `integrate.ts` reads**, already in PG with `uic, name, role, share, added_at, erased_at, position_label, name_fold` |
| `person_role` where `source IN ('tr','ngo')` (081) | 200,849 | bridged person↔company edges |
| `tr_company_place` (133) | 324,039 | `uic → ekatte/obshtina` + denormalized `money_eur`, `political_n`, and **partial indexes on `political_n > 0`** |
| `company_politicians` (008) | 522 | politician↔company, but **money-restricted** — built from `mp_connected.json`/`pep_connected.json`, i.e. contractors only |
| `declaration_stake_company` (096) | 2,147 | declared stakes |

So the **facts** are all in Postgres already. What is missing is the join and the grade.

### Measured overlap — `mp-management` vs `person_role`

Join is `split_part(person_role.ref, ':', 1)` for `source='mp'` — the ref carries two
shapes (`3011` and `3011:44`), and a bare-`ref` join silently drops the second
(`reference_mp_id_not_person_key`).

| | |
|---|---|
| file pairs | **2,014** |
| file MPs, all of which have a `person` row | 896 |
| file pairs already in `person_role` (tr/ngo, same person) | **1,294 (64%)** |
| `high` file pairs already in `person_role` | **220 of 396 (56%)** |
| `person_role` tr/ngo pairs for these MPs | 1,551 |
| ⇒ **file-only** pairs | **720** |
| ⇒ **PG-only** pairs | 257 |

Read that as: the person layer is not a superset. It **misses 176 corroborated
(`high`) pairs** — a real gap, since corroboration by region/stake/party is evidence
Bridge B's name-uniqueness rule cannot see — and it **adds 257** it reaches through
declared stakes and exact-id paths the name matcher misses.

### Measured coverage — the place family vs a PG-native query

`tr_company_place ⨝ person_role(tr,ngo) ⨝ person(active, is_public_figure)`:

| | static shards | PG-native |
|---|---|---|
| ekatte places served | 176 | **1,548** (8.8×) |
| companies | 2,159 | **13,567** (6.3×) |

`place_companies()`'s existing `politicalCount` is **not** this — it reads
`political_n`, which is `company_politicians`-derived and therefore money-restricted:
only **113 companies at 43 places** carry `political_n > 0`. The place family's PG
replacement has to read `person_role`, not that column.

**Perf, Sofia (`ekatte=68134`, the worst case):** the naive form is **121 ms / 13,459
buffers** — it sorts all ~110k Sofia rows before the semi-join. Not servable at
dashboard-hub budget. The fix is the shape `tr_company_place` already uses twice:
denormalize a counter and index it partially.

## 4. Plan

Behaviour-preserving migration first; the content question (should the `medium` tier
exist at all?) is deliberately **out of scope** — it is a judgement about what we
publish, and it should not ride on an infrastructure change.

### Tier 1 — `mp_tr_role` (migration 147) ~~verbatim~~ **keyed on `person_key`**

> **Revised.** The shape below is right; the fill rule is not. `confidence`/`confidence_reason`
> stay, but they describe only the **fold arm** — the 4.8% of rows with no key — and the table
> gains `person_key` + `match_basis`. The three outcomes are `identity` (key matches the MP's
> anchor), `candidate` (no key), `evicted` (key present and different). See
> [data-hub-lateral-edges-v1.md §11.4](data-hub-lateral-edges-v1.md). The parity gate below
> changes with it: it becomes a **reconciliation** — every file pair must be reproduced OR
> explained by a named outcome, and the eviction count is a reported finding, not a failure.

New table owned by a new loader, filled from **Postgres** rather than from the SQLite,
so `raw_data/tr/state.sqlite` stops being a second reader of the same facts:

```sql
CREATE TABLE IF NOT EXISTS mp_tr_role (
  mp_id            integer NOT NULL,
  uic              text    NOT NULL,
  role             text    NOT NULL,
  position_label   text,
  share_percent    numeric,
  added_at         timestamptz,
  erased_at        timestamptz,          -- NULL = current
  confidence       text    NOT NULL,     -- 'high' | 'medium'
  confidence_reason text   NOT NULL,
  PRIMARY KEY (mp_id, uic, role, added_at)
);
```

- `scripts/db/load_mp_tr_roles_pg.ts` re-implements `integrate.ts`'s decision — the
  cohort filter, the three high-confidence arms, `applyNameFrequencyGuard`,
  `tr_match_suppressions.json` — reading `tr_person_roles ⨝ tr_companies` plus the
  parliament roster and `declaration_stake_company`. **Import `applyNameFrequencyGuard`
  and `COMMON_NAME_TR_ROWS` from `integrate.ts` rather than restating them**; that guard
  has already shipped one defect (c97af171c7) and a second copy is a second chance to
  get it wrong.
- Serving fn `mp_tr_roles(mp_id integer) → jsonb`, same payload shape as
  `MpManagementFile`, and route `/api/db/mp-management`.
- Stage-merge, not TRUNCATE — the table is on a serving path
  (`reference_stage_merge_reload`).
- **Parity gate before anything is repointed:** a `.data.test.ts` that reads the 896
  committed files and asserts the table reproduces all 2,014 pairs and all 3,023 roles
  with identical `confidence` + `confidence_reason`. This is the whole safety argument
  for Tier 1; do not proceed on a spot check.

### Tier 2 — `place_mp_companies()` (migration 148)

Serve the place family from `person_role`, **not** from a port of the shard builders —
§3 shows the PG-native answer strictly dominates (8.8× places, person-linked rows
instead of namesake matches), and it is the same argument that produced
`PlaceCompaniesTile`.

- Add `person_link_n integer NOT NULL DEFAULT 0` to `tr_company_place`, denormalized
  from `person_role(tr,ngo) ⨝ person(active, is_public_figure)` exactly as `political_n`
  is denormalized from `company_politicians` — plus
  `idx_tr_company_place_{ekatte,obshtina}_person` partial on `person_link_n > 0`,
  mirroring the two existing `political_n` partials. This is what takes Sofia off the
  110k-row sort. Follow 003's rule: **column declared twice** (CREATE + reconcile
  `ADD COLUMN IF NOT EXISTS`), since `load_tr_company_place_pg.ts` applies 133 on every
  run.
- `place_mp_companies(p_ekatte, p_obshtina, p_page, p_page_size) → jsonb` returning
  `{ count, mpCount, totalPages, companies[] }` — one function for both the summary and
  the page, since they differ only in `p_page_size`. Route `/api/db/place-mp-companies`.
- Rows carry the **person slug**, so `SettlementCompaniesScreen` links `/person/:slug`
  instead of `/mp/:id`. The MP-name/avatar chip stays (`MpAvatar` where an mp role
  exists), but the row is no longer asserting "this company matched an MP's name".
- Keep `place_companies()`'s `politicalCount` as is — it answers a different question
  (money-linked politicians) and the tile renders it under its own label.

Because the answer set changes, the gate is a **coverage** assertion, not parity: every
place the shards serve must still be served, and no place may lose companies.

### Tier 3 — cut the build-time loop, then untrack

The order matters; (a) is what unblocks the retirement.

1. ~~**`augment_mp_roles.ts` reads `mp_tr_role`, not the files.** It already documents
   that it re-derives from mp-management; swap the source to a query. `mpRoles` on
   `companies-index.json` is unchanged, so `build_companies_by_*` keep working while
   both paths are live.~~ ⚠️ **[2026-08-21] DONE, THEN DELETED.** The swap shipped; the
   module, `mpRoles` and `companies-index.json` were then retired outright
   (`docs/plans/company-page-consolidation-v1.md` Tier 5.2). There is nothing to edit here.
2. Repoint `useMpManagement` → `/api/db/mp-management`; `useCompaniesAtSettlement` →
   `/api/db/place-mp-companies`.
3. **Drop `useCompaniesHqSummary` from `PlaceCompaniesTile` entirely** — it is a link
   gate, and `place_mp_companies` can return the gate as a field on the tile's own call
   instead of a second fetch per dashboard.
4. Delete `buildCompaniesBySettlement` / `buildCompaniesByObshtina` and the
   `mp-management` write in `integrate.ts` ~~(keep the `companies-index.json` `tr` block —
   that output is unrelated and still consumed)~~. **[2026-08-21] The parenthesis is
   superseded**: that `tr` block was `integrate.ts`'s LAST remaining output, so the module
   and the file were deleted together (company-page-consolidation-v1 Tier 5.2).
5. Add all three to `bucket_sync_paths.ts` — an `isExcluded` refusal **and** a
   `CHILD_EXCLUDES` entry each, since `parliament/` is still synced for `photos/`;
   one without the other lets `bucket:sync:paths -- parliament` re-upload them
   (the same trap `parliament/company-connections` documents). Then a scoped
   `--delete`, then git-untrack.

### Ops wiring (per CLAUDE.md conventions)

- `db:load:mp-tr-roles:pg` joins `db:refresh` **after `db:load:tr:pg`** (its
  `tr_person_roles` source) and **after `db:load:declarations:pg`** (the declared-stake
  corroboration arm) — add both as `ORDER_PAIRS` entries in
  `refresh_coverage.test.ts`, and the loader to the chain, or the coverage gate fails.
- `tr_company_place`'s new counter widens **that** loader's re-run triggers: it must now
  also re-run after `db:resolve:persons`, since `person_link_n` is denormalized from
  `person_role`. Document it in CLAUDE.md's `tr_company_place` section alongside the
  existing `company_public_money` / `company_politicians` triggers.
- Cloud side, nothing is automatic — the publish order is
  `db:load:tr:pg:cloud` → `db:resolve:persons:cloud` → `db:load:mp-tr-roles:pg:cloud` →
  `db:load:tr-company-place:pg:cloud` → `deploy:db`. The two routes should
  `missingMigration`-degrade so ordering is cosmetic rather than breaking; a **stale**
  table still serves the previous vintage at a 200, which is the usual trap.
- **Neither surface takes a changelog row.** Corrected during the §12 audit: `mp_tr_role`,
  `tr_person` and `person_name_ambiguity` are DERIVED serving layers, so they follow the
  `db:load:graph:pg` precedent — no `recent_updates` row and no standalone
  `data/data-changes.json` entry. The `/data/updates` feed is stamped per-skill by
  `process-watch-report`, and the source skill (`tr-daily-refresh`) already stamps it. A
  changelog row here would report the same TR movement twice under two names.

### Sequencing

Tier 1 and Tier 2 are independent and can land in either order. Tier 3 requires both.
Tier 1's parity gate is the one step that must not be skipped or narrowed.

## 5. Open question for the owner — **narrowed, not closed**

Tier 1 as originally drafted preserved the `medium` tier — 2,375 of 3,023 roles,
uncorroborated name matches carrying a confidence badge. Two of this repo's own decisions
already pointed the other way: the name-frequency guard (c97af171c7) and Bridge B's
≤5-company rule both concluded a bare name match is not evidence of identity.

**The EGN key changes the shape of this question rather than answering it.** 95.2% of TR
person rows can now be decided by identity instead of graded by heuristic, and 12.0% of
rows sit under a name shared by more than one human — including „Георги Иванов Георгиев",
**135 distinct people**, the exact name behind c97af171c7. So the population still needing
a judgement call shrinks to the ~4.8% `cr`-projected and pre-2021 rows that carry no key.

What remains to decide, and it is still a publishing decision rather than an
infrastructure one:

- Do the residual keyless fold matches get published at all, or only counted?
- If published, does the row carry the `person_name_ambiguity` number ("this name belongs
  to N people in the Commerce Registry") — which is honest, and is also the first time a
  page could say it?

Worth deciding **before** Tier 1 is built. A smaller residue is easier to decide; it is
not self-deciding.
