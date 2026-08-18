# Procurement dossiers: shared filter, exact "browse in table", inline edit

## Context

A **project dossier** (`/procurement/project/:slug`, spec = `ProjectFileSpec`) is a
saved, resolved procurement query: unioned `search[]` threads (terms + buyer/
contractor EIK scope) + manual include/exclude, resolved through the shared pure
core `src/data/procurement/projectFile.ts` (client resolver `useProjectFile.tsx`,
offline mirror `scripts/procurement/build_project_members.ts`) into members,
totals, contractors, method-mix and a timeline.

Five gaps motivate this work:

1. **Not re-creatable from the page.** The methodology footer (`ProvenanceFooter`,
   `ProjectFileScreen.tsx`) shows only unioned `terms`, one free-text `authority`,
   verified date, and add/remove *counts* — not per-thread buyer/contractor scopes,
   distinctive/threshold, or the actual include/exclude ids.
2. **Methodology not shown exactly.** Multiple awarders (per-thread `buyerEik`) and
   a contractor scope (`contractorEik`, e.g. Сиела Норма on `mashinno-glasuvane`)
   are invisible.
3. **"Виж всички в търсачката" is lossy.** `seeAllContractsHref`
   (`projectFile.ts:367`) forwards only `?q=<thread[0].terms>&pscope=all&awarder=…`;
   the contracts page's free-text search ORs title+awarder_name+contractor_name
   (no confidence/lineage gating), so it returns a *different, broader* set.
4. **Curated dossiers can't be edited in place.** `editMode` is hard-forced off for
   curated; "Редактирай" navigates away to a `?q=…&edit=1` fork.
5. **The filter surface is thin and not shared.** Only `AwarderSearch` is reused;
   `BuildForm`/`ThreadRow`/`ThreadAdder` are inlined in `ProjectFileScreen.tsx`; the
   contracts page has its own separate CPV/method/single-bidder controls; and a
   dossier can only be narrowed by term + buyer/contractor EIK — no CPV, date or
   amount narrowing (forcing per-slug `excludes` hacks).

## Codebase reconciliation (re-grounded 2026-08-17)

The contracts page (`src/screens/dev/ContractsBrowserDbScreen.tsx`, route
`/procurement/contracts`) is **already** built on shared, URL-backed, extracted
filter infrastructure — it is NOT the local-`useState` screen an earlier pass
assumed. What exists today:

- **`useUrlProcurementFilters({toggleParam, withRisk})`** — the shared URL-filter
  hook for the three procurement browsers; owns `?proc` (bucketed procedure),
  `?cpv`, `?single`, and `?grade` (validated A–F risk set), with setters + a
  `clearFilters`. Extend this hook rather than adding params ad hoc.
- **`useContractColumns({show, ngoByEik, showAppealChip, titleClamp})`**
  (`src/screens/components/procurement/contractColumns.tsx`) — the shared column
  factory. `CompanyContractsDbScreen` + `ContractsBrowserSection` already reuse it.
  **This is the client-table reuse point** — the dossier client table calls the
  same factory for a pixel-identical table.
- Extracted toolbar controls: `CpvFilterCombobox`, `ProcedureBucketSelect`,
  `RiskGradeFilter`, `SingleBidderToggle`; `ContractsAnalysisStrip` (facet-driven
  KPI cards + clickable procedure-mix bar via `useContractsAnalytics`);
  `ContractsAggregatesFooter` + a reactive `onData` server aggregate.
- **A server-side `risk_grade` filter** (migration 112, `contract_risk_cache`;
  registry cols `risk_cri`/`risk_grade`/`risk_fired`/masks, all `viewOnly:true`).
  The registry `select` already returns these, and `useProjectFile` fetches via the
  same `fetchTablePage` mapper — so `model.contracts` rows carry `riskCri`/
  `riskGrade`, and the client table's risk chips render. *(Impl check: confirm the
  snake→camel map covers the risk fields end-to-end.)*

Consequences woven into the phases below: **do not "replace the bespoke controls"**
(there are none — reuse the shared pieces); the "shared filter" goal is *already
met* on the contracts side, so the genuine extraction is the **thread editor**
(dossier-only); the client-table Mode-M path **loses** the server infra
(`useContractsAnalytics` facet KPIs, `onData` aggregates, server `risk_grade`
filter) and must recompute those from the member array, reusing
`ContractsAnalysisStrip`/`ContractsAggregatesFooter` as presentational pieces.

## Locked decisions

- Unify the model: a dossier *is* a saved, resolved **`ProcurementQuery`**; one
  shared filter component across the hub, the dossier page, and the contracts page.
- Methodology footer renders the **full** filter (so a dossier is reproducible).
- Curated inline edit just **produces a new DIY dossier at a new `?q=` URL** —
  **no write-back, no save button, no auth**.
- **Exact "browse the dossier's contracts in a filterable table" for BOTH curated
  and ad-hoc DIY dossiers**, via a **client-rendered table over the already-
  resolved member set**.
- **Membership filters and view filters are separate concepts** (see below).

### Why client-rendered (not a server membership scope)

`functions/` is CommonJS, **no-build, deploy-raw-`.js`** (can't import the TS
`projectFile.ts`), and `/api/db/table` is a **GET with the request JSON in `?q=`**
(can't carry thousands of keys). The server alternatives each add a second place
membership is computed — a PG `member_sets` cache fed by client-resolved keys
(needs the *first* PG **write** path: write-capable role + new secret + POST upsert,
against the deliberate `app_readonly` posture) or a ported CJS resolver in
`functions/` (a third resolver copy / a functions build step). Both erode the
single-resolver invariant the shared core exists to protect.

The **client resolver already produces the exact member set** for every dossier.
Feeding that bounded set (≤ `BUYER_ANCHOR_MAX` = 3000 rows) into the existing client
`DataTable` (`src/ux/data_table/DataTable.tsx`; same `DataTableColumnDef` type as
the server browser; 31 usages) gives an exact, filterable, sortable table with
**zero new backend, zero write surface, one resolver**.

---

## Architecture: `ProcurementQuery` = recall + membership narrowing

The load-bearing distinction: **membership filters change what the project IS;
view filters change what you are LOOKING AT.** Conflating them silently mutates the
headline ("€67.6M" quietly becomes "€40M, of the single-bid subset") and makes the
methodology footer lie.

```ts
// src/data/procurement/projectFile.ts (pure core)

/** Narrowing that changes MEMBERSHIP — persisted in the spec, resolver-visible,
 *  changes the headline total, contractor table, members.json and AI summary. */
export interface MembershipNarrowing {
  cpvIn?: string[];                                // -> cpv (prefix)
  dateFrom?: string; dateTo?: string;              // -> date (range)
  minAmountEur?: number; maxAmountEur?: number;    // -> amount_eur (range)
  euFunded?: boolean;                              // -> eu_funded = 1 (int col)
}

export interface ProcurementQuery extends MembershipNarrowing {
  search: SearchThread[];        // SearchThread MAY also carry MembershipNarrowing
  includes?: MemberIds; excludes?: MemberIds;
  totalBasis?: "members" | "corpus";
}

/** Analysis lenses — NEVER persisted in the spec, applied AFTER the fold. Each
 *  reuses an EXISTING shared control (ProcedureBucketSelect / SingleBidderToggle /
 *  RiskGradeFilter) and, in Mode S, an EXISTING useUrlProcurementFilters param. */
export interface ViewFilters {
  procBucket?: ProcedureBucket | null;   // ProcedureBucketSelect / ?proc
  singleBidder?: boolean;                // SingleBidderToggle / ?single
  riskGrade?: RiskGradeLetter[];         // RiskGradeFilter / ?grade (migration 112)
  appealed?: boolean; annexed?: boolean;
}
// ProjectFileSpec extends ProcurementQuery + editorial fields.
```

**Column allowlist.** Membership: `cpv`, `date`, `amount_eur`, `eu_funded`. View:
`procurement_method`(bucketed), `number_of_tenderers`(single-bidder), **`risk_grade`
(A–F, migration 112 — already a shared filter)**, appealed, annexed. Risk grade is a
*view* lens: "the D–F contracts of this project" is a filtered look, not a redefinition
of what the project contains.
**Deliberately refused: `awarder_name` / `contractor_name` (`filter:"text"`)** —
exposing name-substring matching as a dossier filter reintroduces exactly the
false-positive vector the `globalCols:["title"]` fix eliminated (firms *named*
after a landmark). Entity scoping stays EIK-based via `AwarderSearch`. Also skip
`joint_kind`/`consortium_role`/`consortium_eik`/`tag` (internal mechanics already
handled in the folds).

`cpvIn` also retires the audit-dossier skill's long-wanted generic tier-3 filters —
a systemic win instead of per-slug `excludes` hacks.

### Where narrowing applies (the lineage-leak hazard)

Applying narrowing only at **seed** time is wrong: УНП lineage then re-admits
siblings that violate it (exclude design work → design contracts reappear via a
seeded construction lot's lineage). Rules:

1. Narrowing is **authoritative as a final member-set predicate** (post-lineage,
   post lot-guard), via one shared pure helper `applyNarrowing(members, narrowing,
   includeKeys)` in `projectFile.ts` — so the client resolver and the offline
   builder cannot drift (same discipline as `guardLineageContracts`).
2. It is **also mirrored into the seed WHERE** (`seedContractFilter`) purely for
   recall efficiency.
3. **Precedence mirrors `resolveSeedIds`:** manual `includes` **bypass** narrowing
   (explicit user intent wins); `excludes` always win.
4. **Grain:** effective narrowing = **query-level ∩ thread-level**
   (`seedContractFilter(thread, query)` already receives both). Expose query-level
   in the UI now; per-thread later behind "advanced" — no model change needed then.
5. **Per-resource column mapping:** tenders use *different* names —
   `publication_date` (not `date`), `estimated_value_eur` (not `amount_eur`), and
   have no `number_of_tenderers`. The merge helper needs a per-resource map, not a
   shared key list.
6. **`applyNarrowing` covers tenders too**, using that same map — a procedure
   outside `dateFrom/dateTo` must stop being a member, since `procedureCount` feeds
   `summaries.json` and the AI `projectLifecycle` tool. Contract membership stays
   governed by the *contract-level* predicate: a contract is **not** dropped merely
   because its parent procedure was narrowed out.
7. **Narrowing applies to spend rows** (`tag='contract'`, non-consortium-member).
   `minAmountEur` must not strand a joint award by dropping its €0
   consortium-member placeholders while keeping the carrier (or vice versa) — the
   carrier decides, members follow it.
8. **`euFunded` is tri-state:** `undefined` = no filter, `true` = `eu_funded = 1`,
   `false` = `eu_funded = 0`. Without this an accidental `false` in a shared URL
   silently narrows to non-EU-funded work.

---

## Phase 1 — Unified type + shared filter component (asks 1, 5)

- **`projectFile.ts`**: add `MembershipNarrowing` / `ProcurementQuery` /
  `ViewFilters`; add the pure `applyNarrowing` helper (rules above); extend
  `seedContractFilter(thread, query?)` and `seedTenderFilter(thread, query?)` to
  mirror narrowing into the seed with the per-resource column map. Add colocated
  pure transforms `withCpvIn`/`withDateRange`/`withAmountRange`/`withEuFunded`
  beside the existing `withThread*`.
- **Resolve the dead `mode` field.** `SearchThread.mode`
  (`"any"|"all-words"|"phrase"`) is **declared but never read** anywhere in the
  resolution path — a curated author can set `mode:"phrase"` today and it silently
  does nothing. Grep `data/procurement/projects/*.json`; if no spec sets it, **delete
  it** from the type + `parseProjectSpec`. Only wire it (phrase → exact-phrase FTS,
  all-words → require all tokens) if a spec depends on it — that changes recall for
  existing dossiers and needs a members/summaries regeneration + re-audit.
- **Untrusted-input clamps** (`useProjectFile.tsx` `parseProjectSpec` ~L472-485):
  it is a **passthrough base + allowlist sanitizers** — unknown fields pass through
  raw, so every new field MUST be an explicit clamped key in the return block. Add a
  `bool()` helper beside `num()`/`str()`; `clampCpvIn` (strings, `/^\d{2,8}$/`, cap
  ~50); `min/maxAmountEur` via `num()` `>=0`; `date{From,To}` via `str()` +
  `/^\d{4}-\d{2}-\d{2}$/`; `euFunded` via `bool()`. **`ViewFilters` are never parsed
  from the spec** (URL/UI only). Add the membership fields to the `ProjectFileSpec`
  interface AND to the `curatedForkHref` `copy` object (L499-511 cherry-picks —
  new fields drop on fork/edit unless added).
- **New `src/screens/components/procurement/ProcurementQueryFilter.tsx`**: extract
  the genuinely-unshared **thread editor** — `BuildForm` + `ThreadRow` +
  `ThreadAdder` from `ProjectFileScreen.tsx` — into one **controlled** component
  (`value: ProcurementQuery` + `onChange`). Reuse the shared `AwarderSearch` (buyer
  + `group="companies"` contractor) for recall scope, and reuse the **existing**
  narrowing controls (`CpvFilterCombobox`, plus date/amount inputs) — do NOT
  reimplement them. **Progressive disclosure:** threads are primary; membership
  narrowing lives in a collapsible "Стесни" section; view filters render on the
  *table toolbar* (the existing `RiskGradeFilter`/`SingleBidderToggle`/
  `ProcedureBucketSelect`), never in the dossier-defining form.
- **Scope: the contracts toolbar is already shared** (`useUrlProcurementFilters` +
  the extracted controls), so this component is mounted only where a **thread
  editor** is needed: the hub build form and the dossier inline editor. It is NOT
  mounted on the corpus contracts browse (which has one free-text box, no threads) —
  that page keeps its current toolbar; the dossier just reuses the same underlying
  controls for consistency.

## Phase 2 — Methodology-exact footer (asks 1, 2)

Rewrite `ProvenanceFooter` to iterate `spec.search[]` and render **each thread's
full scope**: terms, every awarder chip (`buyerName`/`buyerEik`), the contractor
chip, distinctive/threshold, the actual include/exclude ids (not counts), and the
**membership narrowing** (cpv/date/amount/euFunded). View filters are deliberately
absent — they aren't part of what the dossier *is*.

## Phase 3 — Inline edit → new URL (ask 4)

Drop `editMode = curatedMode ? false : …` (~L396). Change the curated "Редактирай"
from `<Link to={forkHref}>` to a button that `navigate(curatedForkHref(spec))` —
same route element, so `ProjectFileScreen` re-renders in place (no hub trip);
`?edit=1` opens the inline editor already wired (~L401-412). Drop the "Копие: …"
prefix; preserve scroll. No save button — the live `?q=` URL is the persistence.

## Phase 4 — Contracts page shows the dossier's contracts (ask 3, DIY-exact)

Dossier mode on `ContractsBrowserDbScreen.tsx`. **Param naming matters: `?q=` is
already taken on this page** as the free-text search seed (`initialSearch=
{params.get("q")}`, L283), so the DIY spec must NOT reuse it or the page would feed
a JSON spec into the search box. Use `?dossier=<slug>` (curated →
`useCuratedProjectSpec`) and `?dspec=<spec>` (DIY); give view filters their own
namespaced params (`?vmethod=`, `?vsingle=`) so they never collide with the spec.

Resolve with `useProjectFile`, then branch on the resolved model:

- **Bounded dossier** — **the DIY-exact path.** Render the **client `DataTable`**
  over `model.contracts` (exact resolved members) with columns from the **shared
  `useContractColumns({show:[…], showAppealChip:true})`** factory — the *same* one
  the server browser uses, so the table is pixel-identical. *(Verified:
  `model.contracts` is `ProcurementContract[]` carrying `riskCri`/`riskGrade` from
  the registry `select`, so risk chips render.)* **View filters** (the shared
  `RiskGradeFilter`/`SingleBidderToggle`/`ProcedureBucketSelect`) filter the
  in-memory array; the headline + a `ContractsAnalysisStrip`/`ContractsAggregatesFooter`
  are computed from the member array.
  - **Divergence to own (Mode M only):** this path forgoes the server infra the
    corpus browse leans on — `useContractsAnalytics` (facet KPIs + mix bar),
    `onData` server aggregates, and server-side `risk_grade` filtering. Reimplement
    each over the bounded member array (reusing the presentational strip/footer
    components); risk-grade becomes a client array filter on `riskGrade`. This is
    the maintenance cost of exact DIY membership — contained to data plumbing, not
    the UI.
- **Truncated / program dossier** — no exact full member set exists, so "see all
  the ~N" uses the **server `DbDataTable`** (Mode S) with a **seed reproduction**:
  `globalCols:["title"]` + `globalFtsOnly` + buyer/contractor scope + membership
  narrowing + `pscope=all`. Mode S keeps ALL the existing server infra (analysis
  strip, facets, `risk_grade`) unchanged — it *is* the corpus browser with extra
  scope.

**Discriminator — use contract-side truncation, not `model.truncated`.** The
existing `truncated` (`useProjectFile.tsx:675`) fires when **either** the contract
**or** the tender seed hits its cap; the code immediately below documents that "a
tender-only truncation must not claim contracts were trimmed" (which is why
`matchedTotal` uses the contract-only `matchedContractTotal`). Branching on
`truncated` would route a dossier with a *complete* contract member set but a capped
tender seed away from the exact client table. **Add `contractsTruncated: boolean` to
`ProjectFileModel`** (contract side only) and branch on that.

**Table details that must reconcile with the headline.** `model.contracts` includes
€0 `consortiumRole === "member"` placeholders (the folds skip them; the footer's
"Членове" count filters them). Display them like the server browser does (with the
"обед." chip) but exclude them from any client-side aggregate, so row count and
totals still reconcile with the dossier headline. The **headline renders above the
table** and always shows the **full member total**, with a "филтриран изглед"
marker when view filters are active. Note the client `DataTable`'s built-in global
search box is itself a **view** filter (`includesString`) — it must never be
confused with the spec's `terms`.

**Promotion UX.** "Запази като досие" promotes the *view* filters into
**membership** narrowing on a new `?q=` DIY dossier — explicitly, with a warning
that it changes the headline total (that is exactly the membership/view boundary
being crossed).

Supporting changes:
- **`DbDataTable`**: forward `globalCols` + `globalFtsOnly` (the engine already
  accepts them — no `db_table.js` change).
- **Contracts page**: add a `?contractor=<eik,eik>` scope as a **sibling to the
  existing `awarderScope`** (`ContractsBrowserDbScreen.tsx:97-107`) — `contractor_eik`
  is whitelisted but unused; used by the Mode-S seed-repro. Reconcile scope precedence
  (today sector > awarder; dossier is most specific). **In dossier mode force
  `pscope=all`** — the dossier's own `dateFrom/dateTo` is membership, the parliament
  window is a view scope, double-bounding is confusing. The page already folds
  `awarderScope` into `scopeBase` and every facet request, so the analysis strip
  matches the rows — **extend that same fold to `contractorScope`** (don't
  reintroduce the corpus-wide-facet bug). Route the dossier/view params through
  `useUrlProcurementFilters` (which already owns `?grade`/`?single`/`?cpv`), not a
  parallel param system.
- **`seeAllContractsHref`**: emit `?dossier=<slug>` (curated) or `?dspec=<spec>`
  (DIY); the page picks client-vs-server by `contractsTruncated`. Update callers +
  the existing test.
- **Cold deep-link cost.** A fresh `/procurement/contracts?dossier=X` pays a full
  resolve before the table renders (seed + lineage round-trips; a buyer-anchored
  3000-row dossier walks ~30 pages at 100/page). The dossier page already pays this
  and React Query caches it, but the deep link does not. Render a progressive
  loading state, and for curated slugs seed the headline from the precomputed
  `summaries.json` while the member set resolves.

**No** migration, `project_members` table, `db_table.js` filter, write endpoint, or
functions resolver.

## Phase 5 — tests (always)

- Unit (vitest, no DB):
  - **`applyNarrowing`**: the **lineage-leak case** (a CPV-violating sibling pulled
    in via УНП lineage is dropped from the final member set); **`includes` bypass**
    narrowing; `excludes` still win; query ∩ thread grain.
  - **View filters never affect the fold** — `foldMembers`/headline identical with
    and without them.
  - `parseProjectSpec` **clamps each new membership field** (hostile `?q=` with an
    out-of-range amount / non-string cpv / bad date is rejected) and **ignores any
    `ViewFilters` keys** in a spec.
  - Extended `seedContractFilter`/`seedTenderFilter` emit the right per-resource
    columns (`date` vs `publication_date`, `amount_eur` vs `estimated_value_eur`).
  - **`applyNarrowing` on tenders** (per-resource map: `publication_date` /
    `estimated_value_eur`), the spend-row/consortium rule, and `euFunded`
    tri-state (`undefined` ≠ `false`).
  - **`contractsTruncated`**: a tender-only truncation leaves it `false` (so the
    exact client table is still chosen) while `truncated` stays `true`.
  - The new `with*` transforms; `seeAllContractsHref` mode + param selection
    (`?dspec=`, never `?q=`); `ProcurementQueryFilter` in both modes.
  - Client-table dossier-mode render test — **must mock `useProjectFile`**: unit
    tests never touch the network (an unstubbed `fetch` throws in jsdom, per
    CLAUDE.md), so the resolver is stubbed rather than fetched. Assert consortium
    €0 rows render with the chip but don't move the total.
- PG-backed (`scripts/db/tests/procurement_dossiers.data.test.ts`, auto-skips when
  Postgres is down): bounded slug (`mashinno-glasuvane`) — `resolveMembers` keys +
  fold match the headline; program slug (`sanirane-jilishta`) — seed count within a
  band of the displayed "~N"; **a narrowing-applied variant** resolves to a strict
  subset of the unnarrowed set.

## Accepted limitations / out of scope

- **Truncated dossiers have no exact full member set** — the client table shows the
  resolved top-N; the server seed-repro shows the full ~N. Inherent.
- **Truncated *multi-thread* dossiers** can't be reproduced in one flat query; Mode
  S falls back to the first thread (today's behavior), noted in the banner.
- **Per-thread narrowing UI deferred** (the model supports it from day one).
- **Tenders "browse in table" deferred** — contracts-first.
- Adding narrowing to an existing **curated** spec requires regenerating
  `members.json`/`summaries.json` and re-running `/audit-dossier` (it changes the
  headline, incl. `totalBasis:"corpus"` program totals).

## Verification (end-to-end)

1. `npm run dev`; `/procurement/project/mashinno-glasuvane`:
   - footer lists **both awarders** + the **Сиела Норма contractor** + include/
     exclude ids + any narrowing;
   - "Разгледай договорите в таблица" renders a client table of exactly the member
     contracts, total matches the headline; toolbar view filters narrow the rows
     while the **headline total stays put** with a "филтриран изглед" marker;
     "запази като досие" warns about the total change and yields a new `?q=` URL.
2. Add `cpvIn:["45"]` to a DIY spec → design/supervision contracts disappear
   **including ones that arrive via УНП lineage** (the leak test, live).
3. `/procurement/project/sanirane-jilishta` → "Виж всички" reproduces the ~4538
   seed count (title-only), not the broader awarder/contractor-name OR.
4. Curated **Редактирай** opens the editor **inline**; URL becomes `?q=…&edit=1`;
   edits persist on reopen.
5. Gates: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` (touched suites),
   `npx vitest run scripts/db/tests/procurement_dossiers.data.test.ts`.
6. Deploy: **frontend only** (`npm run deploy`, hosting) — no migration, no
   functions/engine change, no Cloud SQL work.
