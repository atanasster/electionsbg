---
name: audit-dossier
description: Audit a curated procurement project dossier (/procurement/project/:slug) against the raw contracts/tenders corpus. Verifies the included contracts, tenders, companies and totals; catches false positives (contractor-name collisions, lot-per-oblast frameworks, other-road lots leaking via shared procedures, fuel/service supply frameworks) and missing records (predecessor/related buyers); validates derived figures (€/km, method mix, CPV role split); then adds PG-backed regression tests and fixes the issues. Use when the user asks to audit / verify / fact-check a project dossier, after building a new dossier, or when a dossier's totals or contractors look off. Prefers generic engine fixes over per-dossier hacks; proposes any new narrowing parameter as a generic dossiers-hub filter for confirmation, and otherwise auto-fixes via /implement-plan.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - Agent
  - Skill
---

# Audit Dossier skill

A curated **project dossier** (`data/procurement/projects/<slug>.json`, rendered at
`/procurement/project/<slug>`) is a *saved search* — a set of unioned search
threads + manual include/exclude — resolved against the procurement corpus into a
member set, totals, contractors and derived figures. A dossier is only as honest
as its membership: a too-broad term or an un-scoped buyer pulls in **false
positives**; a too-narrow scope drops genuine records. This skill audits that
membership against the raw data and fixes it.

Worked precedents this skill is distilled from: the **Хемус** and
**Русе–Велико Търново** audits (contractor-name collisions, lot over-expansion,
a misleading €/km, a missing predecessor agency).

## How a dossier resolves (what you are auditing)

Client resolver `resolveProjectFile` (`src/data/procurement/useProjectFile.tsx`)
and the offline mirror `resolveMembers` (`scripts/procurement/build_project_members.ts`)
run the **same** pipeline (kept in lockstep via shared pure helpers in
`src/data/procurement/projectFile.ts`):

1. **Seed** — per thread, `/api/db/table` on `contracts`: `global = terms`,
   `globalCols = ["title"]` (title only — NOT contractor/awarder name),
   `columns = [tag=contract, awarder_eik=buyerEik]`, `sort amount_eur desc`,
   `pageSize = SEED_PAGE (60)`. The engine matches `title_fold` via FTS +
   trigram: `(to_tsvector('simple',title_fold) @@ fold_prefix_tsquery($1) OR title_fold %> translit_bg_latin($1))`.
   The exact `count(*)` of that match is the "~N договора" banner.
2. **Confidence gate** — `scoreConfidence(title, thread)`: a row auto-includes
   only if its **title** carries the distinctive token(s) (or all query terms). So
   only title matches ever seed; contractor-name matches score 0 and are dropped.
3. **УНП lineage** — for each seeded contract's procedure (`unp`), pull sibling
   contracts/tenders, then **`guardLineageContracts`** (the lot fan-out guard)
   trims a lot-per-oblast framework to its seeded lot.
4. **Fold** — `foldMembers` → `totalContractedEur` + method mix;
   `foldByContractor` → the Изпълнители table (grouped by EIK, €0 consortium
   members skipped); `computeCorpusEurPerKm` → the value-weighted €/km.

`summarize()` + `resolveMembers()` are exported for tests — drive them directly.

## Setup

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep postgres   # electionsbg-pg :5433 must be up
PG="postgres://postgres:postgres@localhost:5433/electionsbg"
SLUG=<slug>                                                   # e.g. hemus, ruse-veliko-tarnovo
cat data/procurement/projects/$SLUG.json                      # the spec under audit
```

The corpus lives in Postgres (`contracts_list` view = contracts + КЗК-appeal
flag; `tenders` table). Never trust `members.json`/`summaries.json` as the source
of truth for *correctness* — they are the OUTPUT of the resolver; regenerating
them cannot catch a resolver bug on its own.

## Phase 1 — Reproduce the headline against raw data

Reproduce the seed the resolver fires and compare to the displayed count/total.

```bash
# The exact seed match (title-only, buyer-scoped) — should equal "~N договора".
psql "$PG" -tAc "
select count(*) n, round(sum(amount_eur)::numeric,0) eur
from contracts_list
where (to_tsvector('simple',title_fold) @@ fold_prefix_tsquery('<terms>')
       OR title_fold %> translit_bg_latin('<terms>'))
  and tag='contract' and awarder_eik in (<buyerEiks>);"
```

If the live "~N" is HIGHER than this, the count is being inflated by the other
search arms (`contractor_name`/`awarder_name`) — see Failure mode A.

Then resolve the **actual member set** (post confidence + lineage + guard) and
fold it. The fastest exact reproduction is the offline resolver against live PG:

```bash
# One-off: import resolveMembers + summarize and print totals/members for the slug.
# (Model this on scripts/db/tests/procurement_dossiers.data.test.ts.)
```

Compare `summarize().contractedEur` to the page's "Договорено (ЗОП)". They must
match; if not, the client and offline resolvers have drifted.

## Phase 2 — Validate membership (the core audit)

For every member contract/tender, ask "is this genuinely THIS project?" Work
through the failure-mode checklist and quantify each hit in EUR + count.

### Failure modes (each seen in the real audits)

| # | Symptom | Detect | Root cause / fix |
|---|---------|--------|------------------|
| **A** | "~N договора" >> title match; count includes firms *named* after the landmark | `select ... where contractor_name ilike '%term%' and awarder_eik in (...)` — big-value rows whose **title** is a different object | Seed searches all `search:true` cols. Fix = `globalCols:["title"]` (already shipped). Verify it's still applied. |
| **B** | Total >> Σ(title matches); lineage pulls other regions / other roads / a fuel-supply lot | For each false-positive `unp`: `select lots_count from tenders where unp=...` (often NULL) + `count(*)` siblings | `guardLineageContracts`: unknown `lotsCount` frameworks. Framework = a firm PER region (2+ contractors); a single-contractor campaign (e.g. НАИМ archaeology) is one object. Already shipped — verify per-УНП member-lot counts are small. |
| **C** | €/km absurdly low/high for the class of road | `computeCorpusEurPerKm(members)` + list per-contract €/km | Value-weighted median (shipped). Cheap survey/archaeology contracts span km at tiny €/km; the big construction must set the rate. |
| **D** | Missing records — a predecessor / related agency's work absent | Free-text the term across **all** awarders: `... where title_fold like '%term%' group by awarder_eik order by ...` | Add a second search thread scoped to the other `buyerEik` (e.g. НКСИП `202062287` before АПИ took over Хемус). |
| **E** | Same EIK under two name spellings splits/confuses the contractor table | `foldByContractor` groups by EIK — confirm the page merges them | Usually already correct (keyed by `contractorEik`); flag only if the DB has a bad EIK. |
| **F** | "без код по ЦПВ" is the biggest role bucket | `group by left(cpv,2)` over members | Source lacks CPV; relabelled as missing-metadata (shipped). Optionally the opt-in title→role inference. |
| **G** | Municipality / ЕСО / unrelated-buyer noise in a free-text term | non-scoped free-text hits | The `buyerEik` scope filters these — confirm the thread carries it. |

### Companies

```bash
# Reproduce the Изпълнители table: group by EIK, skip €0 consortium members.
psql "$PG" -F$'\t' -tAc "<members CTE>
select coalesce(contractor_eik,contractor_name), count(*), round(sum(amount_eur)::numeric,0)
from members where tag='contract' and coalesce(consortium_role,'')<>'member'
group by 1 order by 3 desc limit 15;"
```

Check the top contractors are real project participants (not name-collisions),
that a consortium's €0 member rows aren't double-counted, and that name variants
of one EIK merge.

### Cross-dossier sanity

A contractor named after landmark X (e.g. "ДЗЗД ХЕМУС-16320") often belongs to a
DIFFERENT dossier (it built Русе–В.Търново, not Хемус). Confirm each big
contractor's contracts are attributed to the right dossier.

## Phase 3 — Classify fixes

Every fix falls into one of three tiers. **Prefer the highest tier that solves
the class of problem** — never a per-dossier hack for a systemic bug.

1. **Spec-level** (`data/procurement/projects/<slug>.json`) — use the existing
   generic fields:
   - `search[].buyerEik` — scope a thread to a buyer (kills cross-buyer noise).
   - add a `search` thread — a predecessor/related agency, a lexically-disjoint
     sub-topic.
   - `excludes.contractKeys` / `excludes.tenderUnps` — drop a stubborn specific
     false positive (a whole procedure and its money).
   - `includes.contractKeys` — pull in a known member the search missed.
   - `nature` — relabel a member's role for the "по вид" split.
   Bump `verifiedAt` and, if buyers/threads changed, also the `index.json` mirror.

2. **Generic engine** (`src/data/procurement/projectFile.ts` + resolver + builder)
   — when the false positive is a **class**, fix it once for every dossier and
   add unit tests. Precedents: `globalCols` (title-only seed), the
   `guardLineageContracts` unknown-`lotsCount` + single-contractor carve-out,
   value-weighted `computeCorpusEurPerKm`. Keep the client resolver and
   `build_project_members.ts` in lockstep (both call the shared helper).

3. **Dossiers-hub UI filter** — **STOP and propose to the user**. If fixing a
   dossier needs a NEW way to narrow its contracts/tenders that isn't covered by
   (1) or (2) — e.g. "restrict to CPV division 45", "drop contracts under €X",
   "exclude framework procedures", "only new_build work" — do **not** hardcode it
   in the spec. Propose it as a **generic filter** the dossier hub exposes for
   ALL files: a new optional `ProjectFileSpec` field (e.g. `cpvIn`, `minAmountEur`,
   `excludeFrameworks`) plumbed through the seed + a UI control in the DIY builder
   (`ProjectFileScreen` edit mode, alongside the per-thread buyer typeahead). The
   engine already supports column filters (`/api/db/table` `filters.columns`) and
   CPV facets — a new narrowing param should reuse that, not invent a per-slug
   escape hatch. This is a design choice → confirm the field name + scope before
   building.

## Phase 4 — Regression tests (always)

Extend `scripts/db/tests/procurement_dossiers.data.test.ts` (PG-backed,
auto-skips when Postgres is down). For the audited slug, drive `resolveMembers`
+ `summarize` and pin, using **bands and inequalities** (never exact-equality —
the corpus grows fortnightly):

- contracted-total band (ceiling catches re-expansion; floor catches over-trim);
- **per-УНП member-lot count** ≤ K for each false-positive framework (the precise
  fan-out signal — was 4–8 lots, now 1–2);
- a fully-removed false-positive contractor EIK is **absent**;
- a genuine campaign stays whole (e.g. archaeology `unpCount(unp) >= 5`);
- no wrong-sized contract leaked in (`maxContractEur < …`);
- a signature true-positive contractor present;
- `computeCorpusEurPerKm(members) > floor` (catches the €/km regression).

The УНП / EIK identifiers are stable; use them as the anchors.

## Phase 5 — Apply, regenerate, verify

- Rebuild the serving artifacts: `npx tsx scripts/procurement/build_project_members.ts`
  (Хемус/Русе totals print — confirm they moved the expected way and that every
  DROPPED contract is a verified false positive: diff old vs new `members.json`).
- Run the gates: `npx tsc --noEmit`, `npm run lint`, the touched vitest suites,
  and `npx vitest run scripts/db/tests/procurement_dossiers.data.test.ts`.
- Live-check: `/procurement/project/<slug>` on the dev server — totals, count,
  €/km, contractors + their risk pills.
- The changed `data/procurement/projects/*.json` are **bucket-served, not
  Firebase-hosted**: deploy with
  `npm run bucket:sync:paths -- procurement/projects/<slug>.json procurement/projects/index.json procurement/projects/members.json procurement/projects/summaries.json`
  (individual `gsutil cp -Z` — avoids the macOS `gsutil -m` hang). Code changes
  need the frontend deploy (`npm run deploy`, hosting-only) and, if the engine
  changed, the functions deploy (`firebase deploy --only functions`).

## Decision: auto-fix vs confirm

Produce a concise findings summary first (each issue: EUR + count impact, root
cause, proposed fix tier). Then:

- **If any fix needs a user decision** — a new dossiers-hub UI filter (Phase 3
  tier 3), an ambiguous inclusion/exclusion, or a judgment call about what counts
  as "this project" — **STOP and ask**, presenting the specific choice.
- **Otherwise** (clear bug fixes, obvious buyer scoping, missing predecessor
  thread, regression tests) — **automatically proceed to fix via `/implement-plan`**,
  treating the audit's recommended fixes as the plan. Each fix is one step
  (implement → `/code-review` in a subagent → `/code-repair` → commit), with the
  regression tests added as their own step.

One dossier fix = one focused change; keep the client resolver and the offline
builder in lockstep, and commit the regenerated `members.json`/`summaries.json`
alongside the code that produced them.
