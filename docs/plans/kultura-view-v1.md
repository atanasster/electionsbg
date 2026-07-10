# Култура (Culture) view — v1 plan

**Status:** draft, post-audit (rev 2). Ready to scope implementation.
**Owner:** —
**Closest shipped precedent:** [judiciary-vss-v1.md](./judiciary-vss-v1.md) — copy its shape.
**Also read:** [defense-pack-v1.md](./defense-pack-v1.md), [water-view-v1.md](./water-view-v1.md) (draft),
[nzok-health-pack-v1.md](./nzok-health-pack-v1.md).

> **Rev-2 note.** A pre-implementation audit invalidated three assumptions in rev 1:
> (a) МК already has a full ministry budget page — the "budget bridge" hero was
> duplicative; (b) Култура is a *group* of awarder EIKs, not one; (c) the ВСС/judiciary
> pack — not the water draft — is the shipped precedent, and it ships with **zero new
> Postgres tables**. Everything below reflects the audit.

---

## 1. What already exists (do NOT rebuild)

Verified against the working tree and the local PG (`contracts_list`).

| Surface | State | Implication |
|---|---|---|
| **МК ministry page** `/budget/ministry/admin-ministerstvo-na-kulturata` | **Ships today.** 8 yrs (2018–2025) budget, program breakdown, personnel, trend, procurement tile (`contractCount 268`, `totalEur €57,223,207`) that already deep-links to `/awarder/000695160` | **Do not rebuild budget/programs/execution.** Deep-link to it. |
| **`/awarder/000695160`** | Generic awarder page, live | The pack decorates it; generic KPIs/top-contracts/CPV/money-flow/tenders/appeals already render above |
| `ministry_procurement` derived join | Ships (`data/budget/derived/ministry_procurement.json`) | ministry↔procurement already joined |
| `NzokRegionalChoroplethTile`, `ProcurementChoroplethTile` | Ship (two near-copies) | A generic `OblastChoropleth` does **not** exist — extract or clone |

**МК procurement is thin and lumpy** (contracts by year, `tag='contract'`):
`2022 €1.2M · 2023 €6.0M · 2024 €0.55M · 2025 €3.1M · 2026 €0.13M` (2020: €49k).
Against a **€269.4M** annual budget that is **~0.2–2%**. Consequences, both mandatory:
- The pack **must survive a near-empty procurement window** under the default
  `?pscope=ns`. Copy NZOK's `hasModel` nuance: gate each procurement-derived tile
  individually; never `return null` on the whole pack because a scope has no contracts.
- The "Поръчки на година" KPI is statistically noisy at this volume. Show it with the
  year-count hint, or omit it in favour of a subsidy KPI.

## 2. Култура is a GROUP of EIKs

The institutes that *receive* the subsidy are themselves awarders with their own pages.
Confirmed from `contracts_list`:

| Entity | EIK | Note |
|---|---|---|
| Министерство на културата | `000695160` | principal; 2 name variants, one EIK |
| Национален дворец на културата (НДК) | `201570119` | €43M — biggest culture awarder |
| Национален фонд „Култура" (НФК) | `130418031` | tiny procurement (€0.49M); matters as a **grant payer** |
| Народен театър „Иван Вазов" | `000670748` | |
| Софийска опера и балет | `000670805` | |
| Национална галерия | `176812208` | |
| Държавна опера — Русе | `117103220` | |
| Драматичен театър — Ловеч | `000282756` | |
| **ИА „Национален филмов център" (НФЦ)** | **unresolved** | **has no procurement presence** — resolve EIK from Bulstat/TR |

**Hard rule: the culture entity set is an explicit EIK allowlist, never a name regex.**
The substring `опера` matches `опер**атор**` / `опер**ации**` — a naive regex pulls in
Електроенергиен системен оператор, ДАТО and жандармерия. (A word-boundary regex still
returned 182 "culture" awarders, including МО's Национален военноисторически музей.)
Store the curated list in `src/lib/kulturaReferenceData.ts` with each entity's principal
(МК vs МО vs община), mirroring `vssReferenceData.ts` / the water plan's 26-subsidiary list.

Roster surface: replicate VSS's `JudicialAwardersTile` — a roster of culture awarders,
each deep-linking to its own `/awarder/<eik>`, with a `hasPack` badge on МК.

## 3. Architecture — follow the ВСС/judiciary split

The judiciary is the shipped answer to "entity pack + dedicated view". Copy it exactly.

- **`/culture` (dedicated view) = the half money can't tell.** Per-recipient subsidies:
  НФЦ film awards, НФК grants, repeat-winner concentration, jury↔recipient conflict lens,
  per-capita-by-oblast map, theatre productivity. Plus the awarder roster (§2).
  **This is the product.** Data: `data/culture/*.json`.
- **`/awarder/000695160` (`KulturaPack`) = the money-as-buyer half.** Only the
  procurement-unique tiles (CPV→function category tile, statutory-supplier context).
  **No budget bridge** — link to the ministry page (§1) instead.
- Cross-link, never duplicate. The pack footnote links to `/culture`; the roster tile on
  `/culture` links into each `/awarder/<eik>`.

**Nav (corrected).** Per `sectorPacks.tsx` L39–43, VSS deliberately exports **no**
`VSS_AWARDER_PATH` because both nav surfaces point at the dedicated view. Do the same:
- `reportMenus.ts` `menu_group_state_entities`: `{ title: "culture_nav", link: "/culture" }`
  (hardcoded string, like `judiciary_nav` at L287).
- `ProcurementNav.tsx` `secondaryItems`: `{ to: "/culture", icon: Palette, key:
  "culture_nav", unscoped: true }` — `unscoped` because `/culture` has no `?pscope`.
- **Do NOT export `KULTURA_AWARDER_PATH`.** Still register `[KULTURA_EIK]: KulturaPack`
  in the `PACKS` map.

## 4. Storage decision — JSON first, PG only if forced

**The judiciary pack ships with zero new PG tables**: no `scripts/db/schema/pg/*.sql`,
no loader, no `recordIngestBatch`. Its artifacts are committed JSON under `data/`,
synced via `bucket:sync`, reusing the generic `/api/db/awarder-contracts` for procurement.
NZOK/agri *do* use PG — so PG is a **choice**, driven by whether row-level data must be
queried server-side.

**Decision for v1: JSON.** The НФЦ film register is on the order of thousands of rows
(2014–2025), well within a committed JSON artifact. Ship `data/culture/films.json`,
`data/culture/grants.json`, `data/culture/entities.json`.

**Escalate to PG only when** the grants browser needs server-side paging/search
(a `DbDataTable` over tens of thousands of award rows). At that point:
- Schema convention (corrected — there is **no migration framework**):
  add `scripts/db/schema/pg/048_kultura_subsidies.sql`, idempotent
  (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), and have the ingest
  script `readFileSync` + execute it directly (exactly as `scripts/agri/ingest.ts` does
  with `046_agri_subsidies.sql`). Next free number is **048**.
- Then, and only then, `recordIngestBatch` → `recent_updates` becomes mandatory
  (`feedback_pg_changelog_required`), and a `functions/db_table.js` REGISTRY entry.

If v1 stays JSON, **§9 (changelog) and the PG parts of §7 do not apply** — but the
dataset still needs a `data/updates` presence via the data map.

## 5. Data & ingest (ranked by value × ease)

1. **НФЦ Единен публичен регистър** — direct `.xls`, 2014–2025, no WAF. Schema:
   `Вид · Наименование · Рег.№ · Продуцент · Субсидия(лв) · Бюджет · Протокол`.
   **⚠ `Продуцент` is a NAME, not an EIK.** See §6.
2. **МК program-budget execution** `.xlsx` — *already ingested* into the ministry page.
   Reuse; do not re-parse. Only pull what the ministry page doesn't model.
3. **НФК grant results** — PDFs (Google-Sheets exports, extractable). Powers success rates.
4. **Sofia Програма „Култура"** — per-project HTML/PDF. **Municipal, not МК** — label it
   "извън държавния бюджет" wherever shown (the water plan's Софийска вода lesson).
5. **Читалища** — reconstruct €88.3M from ДВ per-unit standard × subsidized-unit counts.

Confirmed figures: МК 2026 budget **€269.4M**; читалища 2026 **€11,240/unit × 7,856 ≈
€88.3M**; НФК 2026 **18.3M лв ≈ €9.36M**; Sofia 2026 **€2.3M, 119/455 funded**.
All of mc.government.bg / nfc.bg / ncf.bg serve plainly (no WAF).

## 6. Entity resolution — the biggest data risk

The НФЦ register keys recipients by **producer name**, and НФК grants go to **individual
artists** as well as companies. Therefore:

- **Name→EIK matching is required** to join awards to the TR/connections graph. This walks
  directly into the namesake false-positive class already fixed once
  (`project_procurement_namesake_fix`). Reuse that matcher; do **not** hand-roll one.
- Follow the agri precedent: ДФЗ's СЕУ years also lack an EIK column and are "recovered by
  name-match" — copy that code path and its confidence gating.
- **Store the raw name verbatim** alongside any resolved EIK, and render the raw name when
  confidence is low. Never assert a person↔company link on a name alone.
- **Individuals are recipients.** Physical-person names appear in public grant registers,
  but decide explicitly whether to (a) publish them as published, (b) suppress a
  connections lookup for physical persons. Recommend (a) + no auto-linking to the
  connections graph without an EIK.
- **The jury↔recipient conflict lens is NOT yet sourceable.** Research did not confirm
  that НФЦ художествени комисии membership is published in machine-readable form. Treat
  it as a **hypothesis to validate before designing the tile**, not a v1 deliverable.

**Currency:** НФЦ amounts are historical BGN → convert at ingest (÷1.95583). Post
2026-01-01 sources are natively EUR — handle the mixed regime explicitly
(`feedback_bg_uses_eur`). Sum in EUR per row, never per-currency convert
(`reference_procurement_eur_sum_basis`).

## 7. Query performance

`EXPLAIN ANALYZE` every new/changed query on the worst-case entity (`feedback_db_query_perf`).

Corrections from the audit:
- **`contracts_list` is a VIEW; `date` is `text`** (ISO strings — `left(date,4)` and
  lexicographic range filters work). Not a `date` column.
- The pack's core query (`awarder_eik = '000695160'` + window) is **already covered** by
  `idx_contracts_awarder_date`. No new index needed for the pack.
- **Group roll-up** (`awarder_eik IN (<culture allowlist>)`) is the new worst case —
  verify it index-scans rather than seq-scanning the corpus.
- If PG lands (§4): index `(recipient_eik)`, `(program, year)`, `(discipline, year)`;
  precompute the corpus-wide repeat-winner group-by and the oblast map into a
  `kultura_payloads` blob (global-hot, >200ms live). jsonb builders follow
  `reference_pg_payload_determinism` (ROUND sums, rounded sort keys + eik tiebreaks,
  `COLLATE "C"` MINs). Derive oblast from the obshtina prefix, never `area.oblast`
  (`project_oblast_code_shard_mismatch`).

## 8. Watchers & process-watch-report

`WatchSource` (`scripts/watch/types.ts`): `id`, `label`, `url`, `cadence`,
`fingerprint()`, optional `describe(prev,curr)`. One file each under
`scripts/watch/sources/`, added to `SOURCES` in `scripts/watch/sources/index.ts`.
Follow the VSS precedent: put shared URLs/table maps in a single `scripts/culture/sources.ts`
consumed by BOTH the watcher and the parser.

| Source file | `id` | cadence | fingerprint |
|---|---|---|---|
| `nfc_film_register.ts` | `nfc_film_register` | monthly | hash of latest `Registar-finansirani-filmi-*.xls` link/date |
| `ncf_grant_results.ts` | `ncf_grant_results` | weekly | hash of класиране post list on ncf.bg/bg/novini |

**No `mc_budget_execution` watcher** — МК budget already rides `update-budget`'s existing
`budget_law` / `ministry_execution_reports` watchers (VSS's `__write_judiciary.ts` does
exactly this: piggyback on the cached law HTML, no new fetch).

Mapping rows in `.claude/skills/process-watch-report/SKILL.md` (canonical table):
`nfc_film_register → update-culture`, `ncf_grant_results → update-culture`.

Skill `.claude/skills/update-culture/SKILL.md` (shape on `update-judiciary`). Stamps
`state/ingest/update-culture.json` via
`npx tsx scripts/stamp-ingest.ts update-culture --summary "…"`. Backfills behind
`--backfill` (`feedback_one_off_backfills`).

## 9. Verification (VSS has no tests — copy its discipline instead)

No dedicated tests exist for the judiciary/VSS work. Its ingest scripts **self-verify**:
Σ-reconciliation asserts that **throw and write nothing on failure**. Adopt the same:
- Assert Σ(per-film subsidy) == the register's own reported total per year.
- Assert Σ(grant awards) == НФК's published session total.
- Assert every emitted `eik` resolves in the entity allowlist.
- Refuse to write a partial artifact.

If PG lands, add a `scripts/db/tests/` data test alongside `copy.data.test.ts`.

## 10. AI chat tools

Create `ai/tools/culture.ts`; edit `ai/tools/registry.ts` (imports + `ToolDef` in `TOOLS`),
`ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts` (cases).
Tools return an `Envelope` and **never compute numbers in prose** — narrate pre-computed
`env.facts` only.

Tools (domain `fiscal`): `cultureOverview`, `topCultureGrantees`, `cultureForEntity`,
`filmSubsidyForProducer`, `culturePerCapitaByOblast`.

Router keywords: `култур|театр|филм|кино|опера|читалищ|музей|грант|субсид|culture|theatre|
film|grant`. **Disambiguation (VSS lesson):** gate on an explicit culture reference so bare
`опера` / `музей` doesn't misfire, and route "кой спечели поръчка на МК" to the awarder
**contract** tool, not `cultureOverview`.

Provenance: `culture/*.json` (or `db:culture-*` if PG). Any `/culture/*.json` path an ai/
tool reads MUST have an `AI_PATH_RULES` entry (§12) or the prebuild fails.

## 11. Data Map & README

`scripts/data_map/model.ts` — `npm run data:map`; **prebuild fails on an unplaced watcher
source or an unmapped ai/ path.** §8 and this section must land together.
- `SOURCE_GROUPS`: `src:culture` — `origin:"state"`, `members:["nfc_film_register",
  "ncf_grant_results"]`, `skills:["update-culture"]`, `tags:["fiscal","culture"]`.
- `DATASETS`: `ds:culture`, `path: "data/culture/"`.
- `FEATURES`: `f:culture`, `route: "/culture"`.
- `EDGES`: `["src:culture","ds:culture"]`, `["ds:culture","f:culture"]`, and the
  **cross-feed** `["ds:budget","f:culture"]` (mirrors `["ds:budget","f:judiciary"]` — the
  data-map expression of the budget fusion).
- `AI_PATH_RULES`: `{ pattern: /^\/culture\//, dataset: "culture" }`.

README: `data/culture/` row in the data-layout table; source-provenance entries for the
НФЦ register + НФК results (with gotchas + verified figures, as the judiciary entries do);
the `update-culture` CLI + `--backfill`.

**i18n reality:** only the nav key `culture_nav` goes in `src/locales/{bg,en}/translation.json`
(next to `judiciary_nav`). All rich tile copy is **inline BG/EN ternaries on `lang`** in the
components — that's the house style, not translation.json.

## 12. SEO surfaces — TWO of everything (dedicated view + pack)

Because Култура has both a dedicated view and an awarder pack, each surface needs two entries.

**Awarder pack** (`/awarder/000695160`):
- One `InstitutionPack` entry appended to `INSTITUTION_PACKS` in
  `scripts/prerender/institutions.ts` (`eik`, `slug: "kultura"`, bilingual title/desc/body,
  `ogAnchor`, `ogSettleMs`). This **one append** feeds sitemap + prerender + OG capture —
  `scripts/sitemap/index.ts` and `scripts/og/capture-screens.ts` both loop the array.
- OG: `[data-og="kultura-bridge"]` on the pack's hero tile → `public/og/awarder/kultura.png`.

**Dedicated view** (`/culture`):
- `scripts/prerender/routes.ts` — a route entry with a build-time `cultureFacts()` reader
  (mirror `judiciaryFacts` at L84–96, which reads real numbers out of the JSON at build time)
  and `ogImage: "/og/culture.png"`.
- `scripts/sitemap/route_defs.ts` — add `"culture"` + its path/screen file (mirror
  `"judiciary"` at L51 / L97–98).
- `scripts/og/capture-screens.ts` — a capture entry, anchor `[data-og="culture-hero"]`
  → `/og/culture.png`.
- `src/routes.tsx` — lazy import + `<Route path="culture">`.

**Give the two heroes distinct `data-og` anchors** (`kultura-bridge` vs `culture-hero`).

**OG hero choice — has a dependency.** The per-capita-by-oblast choropleth makes the
strongest card, but **`OblastChoropleth` does not exist**. Two near-copies do
(`ProcurementChoroplethTile`, `NzokRegionalChoroplethTile`). Either (a) extract a generic
`OblastChoropleth` (low-moderate: parameterize data source, ramp, formatter; consolidates
2–3 copies) — coordinate with the water plan, which proposes the same extraction — or
(b) clone `NzokRegionalChoroplethTile`. **Decide before Phase 1**; the OG card blocks on it.

**Sitemap validity** (`project_sitemap_validity_audit`): every `<loc>` needs a real
prerendered `dist/<path>/index.html` — so sitemap and prerender ship together, never alone.

## 13. Deploy & launch

- Artifacts are committed JSON → `bucket:sync data/culture/`. GCS serves identity: use
  `cp -Z` (`reference_gcs_bucket_compression`); avoid `gsutil -m` on macOS
  (`reference_gsutil_macos_multiprocessing`).
- If a by-id shard tree is ever added for per-grant pages, check the **Firebase deploy file
  ceiling** (`project_firebase_deploy_ceiling`) — a 453k-file dist fails to deploy.
- Launch: a `naiasno-post` **DATASET** post when the corpus lands and a **FEATURE** post for
  `/culture`, pinned ~2 weeks.

## 14. Phasing

A phase isn't "done" until its data is watched (§8), self-verified (§9), on the data map
(§11), prerendered + in the sitemap with an OG card (§12), and its queries EXPLAIN-checked
(§7). The data-map validator fails the build if a source ships unplaced.

**Phase 0 (decide, ~1 day):**
- Resolve the НФЦ EIK (Bulstat/TR) and freeze the culture EIK allowlist (§2).
- Choose `OblastChoropleth` extract-vs-clone (§12), coordinating with the water plan.
- Validate whether НФЦ jury membership is published at all (§6). If not, drop the conflict
  tile from scope.

**Phase 1 (the product):** `data/culture/films.json` from the НФЦ `.xls` (JSON, no PG) +
the `/culture` dedicated view: film-awards tile, repeat-winner concentration, awarder
roster (§2), per-capita map. Nav → `/culture`. Both prerender entries, both OG cards,
sitemap, data map, `update-culture` skill + `nfc_film_register` watcher, AI tools
`cultureOverview`/`topCultureGrantees`/`filmSubsidyForProducer`, README, launch post.

**Phase 2 (the pack + grants):** `KulturaPack` on `/awarder/000695160` — CPV→function
category tile + statutory-supplier context, **no budget bridge** (link the ministry page);
`hasModel` gating for the thin corpus (§1). Plus НФК grants + success rates
(`ncf_grant_results` watcher, `cultureForEntity` tool). Escalate to PG (§4) only if the
grants browser needs server-side paging.

**Phase 3 (depth):** theatre subsidy-per-ticket productivity (МК's published 120%-overspend
lists + ДВ standards; may need ЗДОИ); Sofia program; читалища; per-grant `/culture/grant/:id`
records (clone the `/procurement/contract/:id` stack) if grant volume justifies it.

## 15. Open questions

1. **НФЦ EIK** — unresolved; it has no procurement footprint. Blocks the roster entry.
2. **Jury/commission data** — sourceability unvalidated. The conflict-of-interest lens is
   the headline differentiator; if the data doesn't exist, the story changes.
3. **Theatre subsidy-per-ticket** — per-institute delegated budgets aren't published;
   МК's own overspend lists give a partial path without a ЗДОИ. Ship Phase 1 without it?
4. **Physical-person recipients** — publish names as published (recommended), and suppress
   auto-linking to the connections graph absent an EIK?
5. **`OblastChoropleth`** — who owns the extraction, this plan or the water plan?
