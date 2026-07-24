# Persons & declarations — full audit + plan (v1)

Audit date: 2026-07-23. Scope: the person-identity layer (`person_*`), the three
declaration ingests (MP / executive officials / municipal officials), the watchers that
trigger them, and every surface that renders declared wealth (`/person/:slug`,
`/candidate/:id`, `/officials/:slug`, `/officials/assets`).

Everything below was verified against the live register (`register.cacbg.bg`), the local
Postgres, and the checked-in data tree — counts are measured, not estimated.

---

## 0. Executive summary

The person **identity spine is healthy**. The **declaration layer under it is not.**

| | measured |
|---|---|
| Officials whose profile renders **no** declarations block despite having declared assets on file | **421 / 1495 (28%)** |
| Officials ranked at **€0 net worth** on `/officials/assets` despite declared assets on file | **525 / 1495 (35%)** |
| Officials index rows carrying a **fabricated** `latestDeclarationYear: 2026` | **434 / 1495 (29%)** |
| Executive declarations with a parsed `positionTitle` | **0 / 4212** |
| `person_role` rows for `official_exec` carrying an institution | **0 / 1495** |
| MPs whose declaration history was **destroyed** by the last single-year run | **244 / 245** |
| Times the MP-declaration watcher has ever flipped | **1** (2026-05-11) |

The three symptoms you reported are all downstream of these:

- **"We don't have Проф. Галин Цоков."** We do. `person_id 11805`,
  `slug galin-borisov-tsokov-080c63`, ranks **#1** in `person_search('Галин Цоков')`, with a
  full FY2023 declaration on file (2 properties, 1 vehicle, income). His page renders an
  empty shell because of **D1+D2**, and his one office row says a bare "Член на кабинета"
  because of **D3+D4**. He *looks* missing.
- **"Демерджиев — public has more, including cars."** Verified at source: his newest
  register filing is the 2023-07-04 *Vacate*, where `Table Num="3"` (МПС) is
  `Declared="False"` — no car in **that** filing. Its 17 real-estate rows do match the
  publicly reported "17 имота". What we are actually missing is (a) his MP-side filings
  entirely — **D5/D7**, (b) pre-2023 executive register years, (c) the *disposal* tables
  2 / 3.5, which is precisely where "sold the Porsche in the prior year" is recorded — **D11**.
- **"Missing positions — he was also a caretaker minister."** The register *does* publish
  the title (`Служебен министър-председател`, `Заместник министър-председател и министър`,
  `Министър`, `Заместник-министър`). We read the wrong XML element and throw it away — **D3**.

---

## 1. Defects

### D1 — Phantom `declarationYear` on non-annual filings ★ root cause

`scripts/declarations/parse_declaration.ts` → `resolveDeclarationYear`

```ts
const declarationYear =
  fiscalYear != null && declType === "Annualy"
    ? fiscalYear + 1
    : (fiscalYear ?? new Date().getFullYear());   // ← wall-clock fallback
```

`Other` filings (декларация за несъвместимост / промяна) carry no `DeclarationData > Year`,
so they are stamped with **today's year**. 294 executive filings currently claim 2026 while
being filed in 2022–2024. Example: Цоков's incompatibility filing —
`declarationYear: 2026, filedAt: "2023-06-28"`.

Cascade: `mergeDeclarations` sorts `b.declarationYear - a.declarationYear`
(`scripts/officials/merge.ts` → `byRecency`), so the phantom row sorts **first** in every per-slug file.

**Fix:** fall back to the `filedAt` year, then to the register folder year
(`folderYearFromSourceUrl`, already written for exactly this class of problem), never to
`Date.now()`. Add a parser assertion that `declarationYear <= registerFolderYear + 1`.

### D2 — "Latest declaration" means "index 0", which is often an empty filing ★

Three independent consumers take `declarations[0]` and treat it as the wealth snapshot:

- `src/screens/person/PersonOfficialAssets.tsx:38` — and returns `null` when it has no
  assets, so **the entire section disappears**
- `src/screens/OfficialProfileScreen.tsx:106`
- `scripts/officials/index.ts` → the index-entry upsert — feeds `assets-rankings.json`

An `Other` filing legitimately has no asset tables. Combined with D1 it sorts to the top.

Measured blast radius: **421** executive + **114** municipal officials render nothing;
**525** are ranked at €0 on `/officials/assets`. The public officials wealth ranking is
wrong for a third of the cohort.

**Fix:** introduce `latestAssetDeclaration = declarations.find(d => d.assets?.length)`
and use it for the wealth snapshot everywhere, keeping `declarations[0]` only for
"most recent filing" metadata. Fix in one shared selector, not three times.

### D3 — `positionTitle` is read from the wrong element ★

`scripts/officials/index.ts` → `fetchYearListing`

```ts
const position = $(person).find("Position > Position").first().text().trim() || null;
```

Verified against the live `register.cacbg.bg/2025/list.xml`: the element is
`Position > Name`. The municipal ingest already reads it correctly
(`scripts/officials/municipal.ts:101`). Result: **4212 / 4212 executive declarations have
`positionTitle: null`.**

What we are throwing away, verbatim from the register:
`Министър-председател` · `Заместник министър-председател` ·
`Заместник министър-председател и министър` · `Служебен министър-председател` ·
`Министър` · `Заместник-министър`.

This one-line fix is what resolves your issues #3 (caretaker/deputy positions missing) and
half of #4 (what office, not just "cabinet").

### D4 — The institution never reaches the person layer ★

`official_roster` (`scripts/db/schema/pg/080_ngo_signals.sql:51`) is `(name, slug, role, tier)` —
no institution, no position title, no declaration years. `resolve_persons.ts:195` selects
exactly those four columns, so **every** `official_exec` / `official_muni` role lands with
`place = NULL`.

Consequences on `/person/:slug`:
- the office row renders a bare "Член на кабинета" with no ministry (your issue #4);
- `PersonProfileScreen.tsx:107` dedupes offices by `(source, role, place)` — with `place`
  always null, a person who served in **two** ministries collapses to **one** row (your
  issue #3).

The data already exists: `data/officials/index.json` carries `institution` per official
(191 distinct values) and `categoryRaw`.

**Fix:** widen `official_roster` to `(name, slug, role, tier, institution, position_title,
first_year, last_year)`, populate it in `scripts/ngo/load_ngo_board_links_pg.ts`, and map
`institution → person_role.place`, `position_title → person_role.role` (or a new
`role_label` column) in the resolver.

### D5 — MP declarations are destructively overwritten ★

`scripts/declarations/index.ts` → the per-MP writer

```ts
for (const [mpId, decls] of byMp.entries()) {
  decls.sort(...);
  fs.writeFileSync(path.join(outDir, `${mpId}.json`), stringify(decls));  // no merge
}
```

The officials ingest has `scripts/officials/merge.ts` written for precisely this hazard
("a run is AUTHORITATIVE FOR ITS TARGET YEAR and additive elsewhere"). The MP ingest has
no equivalent — it writes only what this run fetched.

Measured: of the **245** MPs with a 2025 filing, **244 have *only* 2025 on file.** Their
2021–2024 declarations were silently deleted by the last `DECL_YEARS=2025` run.

This has already destroyed most of the history the requested wealth chart needs. Recovery
is possible — `raw_data/declarations/{2021_nc,2022,2023,2024,2025}` still holds the source
XMLs, so a re-parse rebuilds them offline without touching the network.

### D6 — The MP-declaration watcher is blind ★

`scripts/watch/sources/cacbg_declarations.ts` fingerprints the **Vue SPA shell** at
`register.cacbg.bg/` — 4085 bytes of static HTML that does not change when filings land.
`state/watch/cacbg_declarations.json` has flipped exactly **once**, on 2026-05-11.

The sibling `cacbg_officials.ts` does it right: resolve the newest register year, filter
`list.xml` to the categories the ingest owns, hash the sorted `xmlFile` set, and report
`+N declarations in scope`.

So `/update-connections` — the skill that refreshes MP declarations — is effectively never
triggered by new filings. This is the "errors in our watchers / process-watch-report" you
suspected, and it is the mechanism by which an ex-minister's page goes stale.

**Fix:** rewrite `cacbg_declarations` in the shape of `cacbg_officials`, filtering
`Category Name` on `Народни представители`, reusing `latestRegisterYear` +
`extractDeclarationXmlFiles` from `scripts/lib/cacbg_register.ts`. Extend
`cacbg_declaration_years.test.ts` to cover it.

### D7 — MP year scope is a hardcoded literal

`scripts/declarations/index.ts` → `DECL_YEARS` — `process.env.DECL_YEARS ?? "2025"`. The officials
ingest resolves the newest published year from the register itself and explicitly documents
why a pinned constant is wrong. When the 2026 folder opens (it 404s today), the MP leg will
keep ingesting 2025 until someone edits the literal.

**Fix:** default to `latestRegisterYear()`; keep `DECL_YEARS` as an explicit backfill
override; pair with the D5 merge so a single-year run is additive.

### D8 — The person page picks an arbitrary official identity

`src/screens/person/PersonProfileScreen.tsx:125`

```ts
const officialSlug = p.roles.find(
  (r) => r.source === "official_exec" || r.source === "official_muni",
)?.ref;
```

`.find()` over an unordered role array. **112 people hold more than one official slug**
(123 extra slugs) — a deputy minister who later ran an agency, a councillor who became a
mayor. Only one institution's declarations are ever shown, and which one is arbitrary.

There is also no link from `/person/:slug` to the much richer `/officials/:slug` page.

### D9 — The officials wealth block is a stub next to the MP one

| | lines | shows |
|---|---|---|
| `PersonMpSections` → `MpAssetsSummary` + `MpFinancialDeclarations` | 355 + 172 | net/assets/debts, **per-category breakdown with counts**, annual income table, business interests, "Виж детайли →" |
| `PersonOfficialAssets` | 111 | three stat cards |

This is your "MPs' declarations seem more complete" — it is a *rendering* asymmetry, not a
data one. `/officials/:slug` (635 lines) already renders the full breakdown; the person page
just doesn't reuse it. Note that even when an official **does** declare a car, today's
person page cannot show it.

### D10 — No ingest stamp for the person layer

There is no `state/ingest/update-persons.json`, so `/process-watch-report` cannot tell when
`db:resolve:persons` last ran, and the "run update-persons after any people source" rule in
the skill has nothing to check against.

### D11 — Whole declaration tables are never parsed

`parse_declaration.ts` covers tables 1/1.1/1.2, 3/3.1–3.4, 4, 5, 6, 7, 8, 9, 10, 11, 12.
Not parsed:

| table | content | why it matters |
|---|---|---|
| 2 | real estate **transferred** in the prior year | the disposal event |
| 3.5 | vehicles **transferred** in the prior year | Демерджиев's filing has this `Declared="True"` |
| 13 | securities given / expenses made **in the declarant's favour by third parties** | a de-facto gifts register |
| 14 | expenses paid by third parties for the declarant / spouse / children | ditto |

Skipping 2 and 3.5 in the *totals* is correct (documented at `parse_declaration.ts:546`)
— but they should still be **captured** as events. 13 and 14 are the highest
corruption-signal tables in the whole form and we ignore them entirely.

### D12 — Declarations live in three JSON trees, not in Postgres

`data/parliament/declarations/*.json` (744) · `data/officials/declarations/*.json` (1495) ·
`data/officials/municipal/declarations/*.json` (6278) — plus `magistrate` in PG separately.
No `declaration` table exists. Consequences: no cross-tier query, no time series, no join to
`contracts` / `funds` / `agri` / `company`, three different renderers, and three different
definitions of "net worth".

This is your point #7, and it is the precondition for every feature in §3.

---

## 2. Plan

### Tier 0 — Correctness (no schema change; makes ~1000 profiles render)

| # | change | files |
|---|---|---|
| 0.1 | `declarationYear` falls back to `filedAt` year → register folder year, never wall-clock. Assert `<= folderYear + 1`. | `scripts/declarations/parse_declaration.ts` → `resolveDeclarationYear` |
| 0.2 | Shared `latestAssetDeclaration()` selector; use it for every wealth snapshot. | new `src/lib/declarations.ts`; `PersonOfficialAssets.tsx:38`, `OfficialProfileScreen.tsx:106`, `scripts/officials/index.ts` → the index-entry upsert |
| 0.3 | Read `Position > Name`. | `scripts/officials/index.ts` → `fetchYearListing` |
| 0.4 | Deterministic official-slug pick: prefer the slug with the newest asset-bearing filing; render every official identity, not one. Link out to `/officials/:slug`. | `PersonProfileScreen.tsx:125`, `PersonOfficialAssets.tsx` |
| 0.5 | Re-derive from cache — `scripts/declarations/rebuild_all_from_cache.ts` + `npx tsx scripts/officials/index.ts` per cached year (offline, `raw_data/` is already populated). | — |

Regression tests: a fixture `Other` filing must not claim the current year; an official whose
newest filing is asset-less must still rank and render; `positionTitle` must be non-null for
≥95% of executive rows.

Acceptance: `/person/galin-borisov-tsokov-080c63` shows "Министър на образованието и науката"
with an FY2023 wealth block; `/officials/assets` has ≤50 (not 571) zero-net rows.

### Tier 1 — Ingestion integrity

| # | change |
|---|---|
| 1.1 | Give the MP ingest the officials' merge semantics — extract `scripts/officials/merge.ts` into `scripts/declarations/merge.ts` and use it on both legs. |
| 1.2 | MP year default = `latestRegisterYear()`; `DECL_YEARS` becomes a backfill override. |
| 1.3 | Rebuild the destroyed MP history from `raw_data/declarations/*` (offline). |
| 1.4 | Rewrite `cacbg_declarations` as a real year+xmlFile-set watcher; extend `cacbg_declaration_years.test.ts`. |
| 1.5 | Backfill executive years 2015–2021 that are cached but not fully merged; add a per-year coverage report. |
| 1.6 | Parse tables 2, 3.5, 13, 14 into a new `events` array (excluded from totals, surfaced as a timeline). |
| 1.7 | Stamp `state/ingest/update-persons.json`; add the person layer to the watcher→skill map check. |
| 1.8 | Decide the `/person` prerender + sitemap policy (G6). **Decided — see G6: prerender + `<loc>` for persons above a content floor; the thin tail stays SPA/DB-only + `noindex`, no static file. Build in Tier 2, gated on a staging deploy at the new file count.** |

### Tier 2 — Declarations into Postgres (the consolidation you asked for)

Migration `089_declarations.sql`:

```
declaration          declaration_id, person_id, tier(mp|exec|muni|magistrate),
                     subject_ref, declarant_name, institution, position_title,
                     category, declaration_type, fiscal_year, register_year,
                     filed_at, entry_number, control_hash, source_url
declaration_asset    declaration_id, seq, category, description, detail, location,
                     municipality, ekatte, area_sqm, built_area_sqm, acquired_year,
                     share, currency, amount, value_eur, holder_name, is_spouse,
                     legal_basis, funds_origin
declaration_income   declaration_id, seq, parent, category, eur_declarant, eur_spouse
declaration_stake    declaration_id, seq, table_num, company_name, uic, holder_name,
                     share_size, value_eur, registered_office, company_slug
declaration_event    declaration_id, seq, kind(disposal_property|disposal_vehicle|
                     third_party_expense|guarantee), … , value_eur     -- Tier 1.6
```

Derived, refreshed with the loader:

```
person_wealth_year   MATERIALIZED VIEW
                     person_id, fiscal_year, assets_eur, debts_eur, net_eur,
                     income_eur, by_category jsonb, filings int, tiers text[]
```

Serving fns (082-style): `person_declarations(slug)`, `person_wealth_series(slug)`,
`declaration_detail(id)`. `person_by_slug` gains a `wealth` block so the profile stops
fetching three JSON trees.

`person_id` is the join key, so declared wealth becomes queryable against `contracts`,
`fund_payloads`, `agri`, `company`, `tr_person_roles`, `magistrate` and the elections
tables in one place. Per `reference_funds_pg_only` / `feedback_no_json_from_pg`: PG is the
serving engine, the JSON tree stays the ingest artifact — do **not** generate JSON back out
of PG. Wire into `db:refresh` **before** `db:resolve:persons`, and into the cloud publish
list in `/process-watch-report` step 8.

Index every entity FK and both sides of each join key (`reference_pg_query_performance`),
and `EXPLAIN ANALYZE` the series query on the worst-case person (a 20-year councillor with
~40 filings) before shipping.

### Tier 3 — Features

**3.1 Wealth trajectory chart** (your request). Assets / liabilities / net by fiscal year
from `person_wealth_series`, with mandate and cabinet bands behind it, and a marker on every
`Entry` / `Vacate` filing so "what he was worth entering vs leaving office" reads off the
chart. Self-gates at ≥2 asset-bearing filings. Follow `/dataviz`; reuse the existing
`PersonMoneyTimeline` shell.

**3.2 Accumulation gap** — Δnet worth between two filings vs cumulative declared income over
the same span. This is the metric КПКОНПИ is statutorily meant to check, and nobody publishes
it. Requires a stated, conservative methodology (unvalued real estate, inheritance,
spouse-side income, restitution) and a visible "declared, not audited" caveat.

**3.3 Unified declaration block** — one component for MP / executive / municipal /
magistrate, off the PG payload. Retires D9 and the three divergent net-worth definitions.

**3.4 Disposals & third-party expenses feed** (Tier 1.6 data) — per person and site-wide:
"what officials sold in the year before leaving office", "who paid for whose travel".

**3.5 Filed vs required** — the register lists the roster *and* the filings, so
`Sent != True` is a computable "не е подал декларация". Coverage by institution and year.

**3.6 Portfolio composition over time** — stacked area (real estate / vehicles / cash / bank
/ securities / funds). Reuse `build_car_makes.ts` for the vehicle leaderboard, extended to
officials.

**3.7 Declared vs market value** — join declared acquisition price + area + settlement to the
property AVM (`project_property_avm`). "Declared €21k for a 43 m² flat in Поморие" against a
market estimate is the single most legible integrity signal we could ship.

**3.8 Stake ↔ procurement, time-aligned** — a declared company stake that won public
contracts **while the person held office**. The pieces exist (`declaration_stake.uic` →
`contracts`, tenure from Entry/Vacate); PG makes it one query.

**3.9 Cohort benchmarks** — percentile within (ministers | deputy ministers | governors |
agency heads | mayors | councillors) and per-cabinet aggregate wealth.

**3.10 Watchlist / alerts** — a new filing for a followed person; feeds `/naiasno-post`
DATA cards.

### Suggested order

Tier 0 → publish (the 28%/35% fixes are visible immediately) → Tier 1 → Tier 2 → 3.1, 3.3,
then 3.2 / 3.7 / 3.8.

---

## 3. Gap audit of the plan above (second pass)

The §1/§2 pass audited the *defects*. This pass audits the *plan* — what it failed to
cover. Seven of these change the plan materially; **G1/G3 are larger than anything in §1.**

### G1 — Register category coverage ★★ the real "we don't have some officials"

`register.cacbg.bg/2025/list.xml` publishes **53 categories**. `CATEGORY_MAP`
(`scripts/officials/index.ts` → `CATEGORY_MAP`) matches **four substrings**, covering three of them
(446 persons in 2025), plus the municipal tier (6402) via a separate ingest.

**~9,000 declarants per year are simply never fetched.** By 2025 person count:

| persons | category | pack it would feed |
|---|---|---|
| 6213 | boards of state & municipal enterprises (ОП/ДП, чл. 13 ал. 4 ЗПФ) | the ownership layer over state companies |
| 456 | hospital directors funded by НЗОК | `project_nzok_health_pack` |
| 442 | ОДБХ / РЗИ / ДНСК / **ДФ „Земеделие"** / ГДИН / РИОСВ regional heads | agri + health + environment |
| **261** | **officials authorised under ЗОП to run procurement and sign contracts** | **the procurement corpus — named signatories** |
| 188 | state forestry & hunting enterprise boards | landuse |
| 126 | general secretaries (НС, President, МС, ministries, МнВР, МО) | administration |
| 107 / 49 | Агенция „Митници" / НАП leadership | customs + revenue packs |
| 99 / 93 / 38 | ДАНС·ДАР·ДАТО·НСО / МВР main-directorate heads / top military command | `project_police_mvr_view`, `project_defense_pack` |
| 92 | heads of diplomatic missions | the empty `diplomat` facet |
| 72 | НЕК / БЕХ / ЕСО boards | energy |
| 44 | БАН president + state university rectors | the empty `academic` facet |
| 42 | **leaders of parties receiving state subsidy** | party financing |
| 37 | chiefs of ministerial political cabinets | governance |
| 33 / 20 | НЗОК + РЗОК / НОИ leadership | health + `project_noi_pension_view` |
| 17 / 2 | MEPs / **President and Vice-President** | the empty `mep` / `president` facets |
| ~140 | КЕВР 8 · КРС 7 · СЕМ 5 · КЗК 13 · КЗД 12 · КФН 7 · ЦИК 15 · БНБ 8 · **Конституционен съд 12** · Сметна палата 7 · КПК/КОНПИ 17 · ББР 10 · НБКСРС 7 · АППК 7 · ФГВБ 6 | the `regulator` facet — see G3 |
| 3 | director-generals of БНТ / БНР / БТА | the empty `media` facet |

**Cost to fix: a wider filter, not new parsing.** I fetched the КЕВР chairman's 2025
declaration (`407143B1-…201851.xml`) — byte-for-byte the same schema, and the existing
parser handles it as-is (tables 3/4/5/8/12 all `Declared="True"`). The work is
`CATEGORY_MAP` + a category→kind vocabulary + UI facets. No parser change.

### G2 — Nine of 21 `person_source` keys hold zero rows

`mep` · `president` · `academic` · `diplomat` · `media` · `professional` · `concession` ·
`honours` · `historic_mp` — all declared in `person_source` with labels and tiers, all with
**0** rows in `person_role`. The facets exist in the schema and in the UI; nothing fills
them. **Six of the nine are fillable directly from G1.**

### G3 — The `regulator` register is hand-curated on a false premise ★

`update-persons` states that `regulator_rosters` must be manually curated because there is
no machine-readable feed, and 32 seats are maintained by hand under a defamation rule.

There **is** a feed. Sampled and verified in the live 2025 `list.xml`:

```
КЕВР                    Иван Николаев Иванов        | Председател
Конституционен съд      Атанас Марков Семов         | Съдия
ЦИК                     Георги Славчев Баханов      | Член
Президентство           Румен Георгиев Радев        | Президент
                        Илияна Малинова Йотова      | Вицепрезидент
```

Names, seat titles **and** filings, from a register with a statutory filing obligation —
strictly better provenance than scraping each body's web page. This should replace most of
`data/person/regulators.json`, keeping the curated file only for bodies the register omits.

### G4 — `deputy_minister` is a dead bucket

`OfficialCategoryKind` has it and `officials_cat_deputy_minister` is translated in both
locales, but `categoriseRaw` (`officials/index.ts` → `categoriseRaw`) deliberately folds deputies into
`cabinet` — a documented v1 shortcut. So 399 `cabinet` rows conflate PM, deputy PMs,
caretaker ministers, ministers and deputy ministers. **D3's `Position > Name` fix makes the
split free** — the register already says which is which.

### G5 — The MP leaderboard fails differently than the officials one

`build_assets_rankings.ts` → the zero-total skip skips an MP whose latest declaration totals zero:

```ts
if (totals.totalAssetsEur === 0 && totals.totalDebtsEur === 0) continue;
```

So instead of a €0 row (the officials failure), the MP gets **no `mp-assets/{id}.json` at
all** → silently absent from the leaderboard *and* no declarations block on their person
page. Only 3 MPs today, but the D5 history rebuild will multiply multi-filing MPs, so fix
0.2 must cover both failure shapes, not just the officials one.

### G6 — `/person/:slug` is neither prerendered nor in the sitemap

`route_defs.ts` covers `officials/assets` and `officials/:id`; `/person/:name` is a lazy SPA
route with no static HTML and no `<loc>`. Per `feedback_static_seo`, ~49k profile pages are
invisible to search — the single largest un-indexed surface on the site.

**DECIDED (2026-07-24): index every public person who clears a content floor; give the thin
tail a working page but no static file. Build pending — this is the policy, executed in
Tier 2 (the `/person` prerender + sitemap step), not code that ships in this commit.**

Measured against the current tree rather than the 49k estimate this defect was written from:

| | count |
|---|---|
| persons in the layer | 59,900 |
| `is_public_figure` | 58,617 |
| of those, holding an elected or appointed office | 33,772 |
| of those, having filed a declaration | 23,898 |
| of those, one role row and nothing else | 36,152 |
| of those, a single candidacy and nothing else | 20,687 |
| files in `dist/` today | 201,452 |

**The file ceiling is a binding constraint, and this is where the "prerender all 58,617"
answer breaks.** Two files per person (BG + EN) is ~117k new files, landing `dist/` at
~318k. `project_firebase_deploy_ceiling` records that deploys **die at 320–340k uploaded
files** — 453k was where it was first hit, not a safe bound; the known-good size is ~84k.
So ~318k is not headroom, it is inside the failure band. Prerendering the whole public
cohort as static files is not viable on the current deploy.

**What is prerendered vs. what is only served.** Split the cohort by a **content floor**,
not by a job-title cohort:

- **Above the floor** — has a declaration, an elected/appointed office, a company role, or
  an election *result* (not merely a candidacy). ~24k–34k persons depending on where the
  office line falls. These get a prerendered BG+EN static file **and** a sitemap `<loc>`.
  That adds ~48k–68k files → `dist/` ~250k–270k: still inside the warned band, so shipping
  it is **gated on a trial/staging deploy at the new file count** before it goes to prod —
  not asserted safe here.
- **Below the floor** — a page whose whole body is "stood for election in 2021." Thin
  content, and shipping 20k of them invites Google to discount the whole directory. These
  stay **SPA-only, DB-served** (the `db` Cloud Function via `person_by_slug` already renders
  the route at runtime — `082_person_api.sql`, `src/routes.tsx`). The SPA sets
  `<meta name="robots" content="noindex,follow">` from its own runtime head for these, so
  they are reachable and crawlable for their links but do not ask to be indexed. **No static
  file, no `<loc>`.** The moment a source gives such a person a second fact they clear the
  floor and the next build promotes them to a prerendered, indexed page on its own.

This still gives **every public person a working page** — the intent behind "all public
persons" — while spending file budget only on the pages worth indexing. It also sidesteps a
capability the prerender pipeline does not have: because the noindexed tail is never
prerendered, `renderSeoBlock` never needs to emit a per-page `robots` meta (it does not
today, and `index.html` hardcodes `index, follow` outside the replaceable SEO block — a
collision to avoid, not to build into).

**The manifest the two builders share.** The `is_public_figure` flag and the floor predicate
live only in Postgres, and neither the sitemap nor the prerender builder reads PG (both read
JSON off disk). So the person ingest emits one enumeration manifest —
`data/person/prerender_slugs.json`, `{slug, indexable}` per person — exactly as the
PG-backed products enumerator already does via `data/prices/product_slugs.json`. A build-time
manifest is the accepted shape for PG→prerender (`feedback_no_json_from_pg` forbids *serving*
JSON generated from PG, not an enumeration list). `enumerateProducts`-style sitemap code and
a new `buildPersonRoutes` both read it, so the prerendered set, the `<loc>` set and the
`indexable` flag are computed once and cannot drift. A `<loc>` with no
`dist/<path>/index.html` is a soft-404 (`project_sitemap_validity_audit`) and a `<loc>`
carrying `noindex` is a contradiction crawlers punish — the manifest's single `indexable`
boolean is what keeps all three aligned.

G7 (municipal officials missing from the sitemap entirely) is absorbed by this: the person
layer covers all 6,235 distinct municipal persons (6,278 declaration filings; 43 slugs
dedupe on merge), and every one that clears the floor — which a filed declaration does by
itself — gets a `<loc>`.

**Shipped in T2.4:** the content-floor manifest — `scripts/person/emit_prerender_slugs.ts`
writes `data/person/prerender_slugs.json` (`{slug, indexable}` per public person; 58,617
slugs, 37,930 indexable) from the resolved person layer, wired into `db:refresh` after the
person load and gated by a data-test (`emit_prerender_slugs.data.test.ts`). This is the
shared artifact both the sitemap enumerator and the prerender builder read, so they cannot
disagree about which pages are thin.

**Remaining (deploy-gated build):** the `buildPersonRoutes` prerender bodies consuming the
manifest, the sitemap `<loc>` enumerator for the indexable set, and the SPA runtime
`noindex` on below-floor pages. These add ~48k–68k files (dist → ~250k–270k, inside the
warned band) so they are gated on a staging deploy at the new file count — which is why
they are split out from the manifest that this step lands.

### G7 — Municipal officials have no profile pages in the sitemap

`enumerateOfficials` (`scripts/sitemap/index.ts:683`) enumerates from
`assets-rankings.json`, which is executive-only. The 6,278 municipal officials are reachable
only through `/settlement/:obshtina` shards.

### G8 — Position-title i18n is unplanned

`pp_role_*` covers 12 roles. `Position > Name` is free text with 50+ distinct values across
53 categories. Needs a verbatim→stable-key mapping table with a passthrough fallback
(the pattern `magistrateRoleKey` already uses), not 50 hand-written keys per locale.

### G9 — Tier 3.2 needs the same editorial gate as sanctions/ДС ★

`update-persons` carries a non-negotiable defamation rule for the sanctions and ДС facets.
An **accumulation-gap / unexplained-enrichment** metric on named individuals is the same
class of risk, and §2 only promised "a visible caveat". It needs the same treatment,
written before the feature: a defined public-figure tier it may be computed for (not the
~4,700 municipal councillors), a published methodology page, descriptive-not-accusatory
language, and a correction/right-of-reply path. Note also that unvalued real estate is
common in the corpus (`realEstateUnvalued` is already tracked) — a gap computed over
partly-unvalued assets is not defensible without stating the denominator.

### G10 — Family data policy

Declarations carry spouse names (`holderName: "Галин и Антония Цокови"`, `isSpouse: true`)
and minor children. We already render a spouse income column. Consolidating into a queryable
PG table and charting it is the moment to set an explicit policy — spouses and children are
not public figures, and "queryable" is a different exposure from "shown on one page".

### G11 — Test coverage is near zero for everything being changed

Four unit tests in scope: `parse_registered_office`, `officials/merge`, `person/cluster`,
`person/nameParts`; plus `person_resolve` / `person_search` / `person_elections` PG data
tests. **Nothing** covers `parse_declaration`'s table extraction, `build_assets_rankings`,
the officials index build, or any of the three declaration renderers — i.e. every module
Tier 0 touches. Per `docs/testing-standards.md`, each fix lands with the first test in its
module.

### G12 — Operational cost is uncosted

- Tier 0's re-derive rewrites ~8.5k JSON files under `data/officials` + `data/parliament`,
  all bucket-served: `bucket:sync` needs `cp -Z` (`reference_gcs_bucket_compression`) and
  `gsutil -m` hangs on macOS (`reference_gsutil_macos_multiprocessing`).
- G1 multiplies the executive corpus ~7× (≈1.5k → ≈10k officials/year). At the 150 ms
  politeness sleep, ~9k new declarants ≈ 25–40 min **per register year**; 11 cached years is
  a multi-hour staged backfill, not one run.
- Stage it: newest year first, verify, then backfill years descending.

### G13 — Tier 2 has a load-order circularity

§2 says wire the declarations load into `db:refresh` *before* `db:resolve:persons`, but
`declaration.person_id` cannot exist until `person` does — and the resolver reads
`official_roster`, which the declaration ingest feeds. Correct order: load declarations
keyed by `(tier, subject_ref)` with `person_id` **nullable** → `db:resolve:persons` →
post-resolve `UPDATE` to fill `person_id` → refresh `person_wealth_year`. State it
explicitly or the first cold bootstrap deadlocks.

### G14 — No changelog wiring

`feedback_pg_changelog_required`: every PG-migrated dataset wires into `recent_updates`.
Tier 2 adds one and §2 never mentioned it — nor `scripts/append-data-change.ts` for
`data-changes.json`. Keep the two changelogs distinct (`reference_two_changelogs`).

### G15 — No AI tool for the new data

The chat has `personProfile` / `personConnections` / `person_elections` but nothing for
declared wealth. Tier 2 should ship a `personWealth` tool alongside the serving fns —
otherwise the grounded-number gate (`project_ai_chat_grounding_gate`) will reject every
wealth figure the assistant tries to state.

### Revised tiering

G1/G3/G4 are cheap (a filter + a vocabulary, no parser work) and unlock the empty facets,
the regulator register and six sector packs — they belong at the **front**, not in a
someday bucket:

- **Tier 0** — unchanged (§2), plus **G5** (MP omission shape) and **G4** (deputy split,
  free once D3 lands).
- **Tier 0.5 (new)** — widen `CATEGORY_MAP` to the full register; category→kind vocabulary
  + i18n mapping (G8); backfill newest year only; fill `person_source` facets (G2); retire
  the hand-curated regulator rows the register covers (G3). Highest value per line changed
  in the whole plan.
- **Tier 1** — unchanged, plus the G6 prerender/sitemap **decision** (decide here, build in 2).
- **Tier 2** — unchanged, plus G13 load order, G14 changelog, G15 AI tool, G7 municipal
  sitemap.
- **Tier 3** — unchanged, with G9/G10 as a written gate that blocks 3.2 and 3.7.

Cross-cutting: G11 (a first test per touched module) and G12 (staged backfill) apply to
every tier.

---

## 4. Non-defects (checked, working)

- Identity resolution: 49,062 persons, 114,500 roles across 12 sources; Цоков and
  Демерджиев both resolve correctly and rank first in `person_search`.
- The euro conversion, the real-estate/vehicle typo auto-corrections, and the row dedupe in
  `parse_declaration.ts` all behave as documented.
- Демерджиев's parsed 2023 filing is **faithful to source** — 17 real-estate rows, no
  vehicle table, `Table 3 Declared="False"`. The gap is coverage and unparsed tables, not
  a mis-parse.
- `cacbg_officials` / `cacbg_local` are correctly built watchers and are the template for
  fixing `cacbg_declarations`.
- `scripts/officials/merge.ts` is the right design; it just needs to be shared with the MP leg.
