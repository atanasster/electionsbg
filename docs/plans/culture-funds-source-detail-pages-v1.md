# Culture funds — standalone source detail pages (v1)

**Ask.** The four rows on `/culture/funds` („ИСУН по ЕИК", „ИСУН по име", „Interreg
тематично", „ДФЗ читалища") each publish a euro figure and a row count and go nowhere.
Give each one a standalone page that names the records behind its number, built to the
dashboard-hub pattern (`HubHead` + KPI band + evidence list + a server-side browse table).

**Status.** **Tier 0 shipped 2026-08-25** — §2's correctness fix: the measured
`eikExactAlsoByName` figure in the blob and its generator, the rewritten copy on
both ИСУН rows (figure *and* relationship clause derived, never frozen), and
`scripts/db/tests/culture_fund_sources.data.test.ts`. Tiers 1–6 unimplemented.

---

## §0 — The one thing that must not happen

`/culture/funds` exists because these four numbers **do not sum**, and its first sentence
says so. Four detail pages multiply the opportunity to break that rule fourfold, in a new
way the parent page never had: a reader who lands on one page directly, from search or a
share, never sees the parent's warning.

So the non-summation rule moves ONTO each page rather than staying behind it:

- Every page states its own basis **above the fold**, in the `HubHead` deck and again as
  a `basis` string under every KPI (`HubKpi.basis` is a required field — that is the
  point of the component).
- Every page carries a **cross-arm strip** naming the other three with their figures and
  the sentence „не се събират / these do not sum". That strip is the parent page's first
  paragraph, distributed.
- No page anywhere renders a total across arms. No shared component may accept the four
  figures as one array with a sum. §10's gate asserts it.

The second rule: **an empty or partial answer must never look like „nothing here".**
`sectorPacks.tsx` already carries this argument at length for these exact corpora —
culture's 63 EIKs reach `fund_projects` and reach neither `agri_subsidies` nor
`interreg_partners`, though the sector demonstrably receives money from both. Each page
therefore publishes its own **coverage figure** (how much of the question this identity
can answer), not just its result.

---

## §1 — Measured facts

Local Postgres, 2026-08-25. These are the four arms exactly as
`scripts/db/gen_culture/hub_stats.ts` derives them.

| arm | rows | € | distinct recipients | linkable | corpus scanned |
| --- | ---: | ---: | ---: | --- | ---: |
| ИСУН by EIK (`beneficiary_eik = ANY(CULTURE_GROUP_EIKS)`) | 47 | €105,920,570 grant | 31 EIKs | 47/47 carry `contract_number` | 82,162 |
| ИСУН by name (`cultureNameSql`) | 1,560 | €147,024,687 grant · €160,423,374 contract · €67,958,083 paid | 1,475 names / 1,364 EIKs | 1,559/1,560 carry an EIK | 82,162 |
| Interreg thematic (`interregThemeSql` on `o.title_en`) | 202 partner rows | €48,807,847 published budget | 168 partners / 144 operations / 14 programmes | 37/202 carry an EIK; every row carries `keep_id` | 12,015 |
| ДФЗ читалища (`chitalishteNameSql`) | 264 payments | €18,341,814 | 212 names / 170 EIKs | 237/264 carry an EIK | 2,481,857 |

Facts the pages should be built around, each measured rather than assumed:

- **ИСУН by name is 83% one programme.** `2021BG-RRP` (ПВУ) is 1,292 rows / €117,274,067
  of the 1,560 / €147.0m. The next largest is €11.4m. A page that does not show this
  leaves the reader thinking „European culture funding" where the answer is „the Recovery
  and Resilience Facility, mostly to читалища".
- **читалища are 1,332 of those 1,560 rows / €22,080,751** — the widest population by
  count, a seventh of the money.
- **Interreg budgets are near-fully published**: 199 of 202 rows `budget_basis =
  'published'`, 3 `unpublished`. 72 of 202 are lead partners.
- **ДФЗ читалища span 2015–2025 across 8 distinct years, 25 oblasts, 15 schemes.** The
  top payments are 2015 scheme `322` at ~€440k each — i.e. the arm is not a flat annual
  trickle and a year axis is worth drawing.
- **`fund_projects` has NO date columns** (ИСУН's beneficiary export publishes none —
  CLAUDE.md states this for the `/funds` wire). So neither ИСУН page can have a year
  axis, a „new this year" figure, or a trend. Say so on the page rather than leaving a
  reader to wonder; do not substitute an ingest date.

---

## §2 — A correctness finding the build must fix first

`/culture/funds` currently tells the reader the ИСУН-by-EIK row is „**Подмножество на
реда отдолу**" / „A subset of the row below". **It is not.** Measured:

```
EIK arm                                   47 rows
EIK arm ∩ name arm                        46 rows
```

The one row outside is `000669802` — **Национална професионална гимназия по полиграфия и
фотография**, €185,906. It is in `CULTURE_GROUP_EIKS` as a national art school, and its
NAME carries no culture stem (`cultureMatch.ts` matches „художествен", „изкуств", „теат"
… — „полиграфия и фотография" matches none of them). So the EIK arm is *almost* a subset
and the two figures are not nested the way the copy claims.

This is small in euros and load-bearing in meaning: „a subset" is the sentence that lets
a reader reason about the €106m and the €147m together at all. Three consequences:

1. Fix the parent page's copy to the measured statement: *46 of the 47 EIK-matched
   projects are also name-matched; one is not, because the school's name carries no
   culture word.*
2. The by-name page must render that row as a **named exclusion**, not drop it silently.
   „Не се хваща по име" is a finding about the matcher, and it is the only visible
   evidence a reader has that the name rule has an edge at all.
3. §10 gets a gate that re-derives the overlap and fails when the copy's claim and the
   corpus disagree — the same shape as `culture_hub_figures.data.test.ts`, which exists
   because this page's figures were once frozen strings.

⚠ Do **not** "fix" this by adding a stem to `cultureMatch.ts`. That file's header
documents four measured ways a widened stem inverts a figure, and „полиграф" would be a
fifth candidate nobody has measured. The roster is the right identity for this school;
the name rule is correctly failing to reach it.

---

## §3 — URLs and routes

Four **static** paths, mirroring the four bases:

| path | arm |
| --- | --- |
| `/culture/funds/isun-eik` | ИСУН, EIK-exact over the register |
| `/culture/funds/isun-name` | ИСУН, name-matched |
| `/culture/funds/interreg` | Interreg, thematic |
| `/culture/funds/dfz` | ДФЗ, народни читалища |

Static, not `/culture/funds/:source`, for the reason `cultureRegistry.ts` states in its
own header („NO SEEDED `:param` DESTINATIONS"): every one of these needs its own sitemap
`<loc>`, its own prerendered body and its own og:image, and a param route makes each of
those an enumeration problem instead of a list entry.

One shared screen component behind them, so the four are one implementation:

```
src/screens/culture/CultureFundsSourceScreen.tsx      // the shared page
src/screens/culture/cultureFundSources.ts             // the registry: 4 entries, pure data
```

`cultureFundSources.ts` carries per-arm: id, path, labels (bg/en), the resource name, the
basis sentence, the coverage sentence, the KPI spec, the facet spec, the row-link builder
and the accent token. Pure data, no JSX — same rule as `cultureRegistry.ts`, so it stays
out of the entry chunk (`src/entryGraph.test.ts`).

`routes.tsx` gets four `<Route>` entries and one `lazy()` import.

---

## §4 — The serving layer

### §4.1 The problem

`src/lib/cultureMatch.ts` is the ONE definition of these predicates and it is TypeScript.
Its own header says why: *„nothing that serves a request needs it … these matchers are for
LOADERS, GENERATORS and DATA TESTS."* That stops being true the moment a browse table has
to page through the name-matched rows — a Cloud Function route cannot import TypeScript.

Three of the four arms need the predicate at request time. Only `isun-eik` does not (it is
an EIK set, and `?sector=culture` on `fund_projects` is already sanctioned by
`SECTOR_BROWSE_PACKS.culture.beneficiaryCorpora = ["fund_projects"]`).

### §4.2 The decision: generate the SQL, don't store a flag

**Measured first, because it decides the design.** Both name predicates are already served
by existing trigram indexes:

```
agri_subsidies  WHERE name ~* 'читалищ'
  → Bitmap Index Scan on idx_agri_name_trgm
    264 rows, 370 buffers, 1.8 ms          -- over 2,481,857 rows

fund_projects   WHERE beneficiary_name ~* '<the full culture pattern>'
  → Bitmap Index Scan on idx_fund_projects_bname
    1,560 rows, 1,525 buffers, 13.7 ms     -- over 82,162 rows
```

Both are inside the per-view budget by a wide margin and far under the 10 s pool
`statement_timeout`. So the whole „materialize it" branch is unnecessary:

- ❌ **No matview.** Nothing to refresh, nothing to go stale, no `SCOPED_MATVIEWS` entry,
  no extra loader trigger in a chain that already has 65 steps.
- ❌ **No stored boolean column** on `fund_projects` / `agri_subsidies`. That would need a
  backfill after every `TRUNCATE`+`COPY` reload and would go stale invisibly whenever the
  rule changed without a corpus reload — the exact failure class CLAUDE.md documents for
  `is_declared_holding` / `value_basis` / `held_scope`.
- ✅ **Four thin VIEWs, generated from the TypeScript.**

### §4.3 The generator

Follow `scripts/db/gen_sql/shlyo_query_fold.ts` exactly — it is the house precedent for
„a rule lives in TS and must also exist in SQL":

```
scripts/db/gen_sql/culture_match.ts          # emits the migration
scripts/db/gen_sql/culture_match.test.ts     # the drift gate (--check)
scripts/db/schema/pg/189_culture_match.sql   # GENERATED — never hand-edited
package.json:  "gen:culture-sql": "tsx scripts/db/gen_sql/culture_match.ts"
```

`189_culture_match.sql` contains four views and nothing else:

| view | definition |
| --- | --- |
| `culture_isun_by_eik` | `SELECT * FROM fund_projects WHERE beneficiary_eik = ANY(ARRAY[…63 EIKs…])` |
| `culture_isun_by_name` | `SELECT * FROM fund_projects WHERE <cultureNameSql('beneficiary_name')>` |
| `culture_agri_chitalishta` | `SELECT * FROM agri_subsidies WHERE <chitalishteNameSql('name')>` |
| `culture_interreg_thematic` | `interreg_partners p JOIN interreg_operations o USING (keep_id) WHERE p.country='Bulgaria' AND <interregThemeSql('o.title_en')>`, projecting the partner row plus `o.keep_id / programme_code / period / title_en / title_bg / start_date / end_date / status` |

Naming note: `culture_isun_by_eik` is a view over the same EIK set the sector pack already
carries. It exists so the four pages share one shape and one gate; the pack seam stays the
canonical mechanism for `/procurement/*` and is not replaced.

Properties that must hold, each for a stated reason:

- **`CREATE OR REPLACE VIEW`, never `DROP`.** A `DROP … CASCADE` in a file a loader
  applies is the silent-data-loss shape CLAUDE.md documents for `003_tr_search.sql` (three
  matviews deleted on every TR load, exit 0). These views have no dependents today, which
  is exactly when the rule is cheapest to keep.
- **Applied by a loader AND by `apply_functions.ts`.** Give it an applier or it repeats
  migration 144's defect (`db:refresh` fails at its final `test:data` step on any database
  nobody hand-patched). `db:load:funds:pg` is the natural home (it owns `fund_projects`);
  `db:load:agri:pg` and `db:load:interreg:pg` should apply it too, so no single loader's
  absence leaves a page 500-ing. All three are cheap: a view rewrite touches no rows.
- **`GRANT SELECT … TO app_readonly`, role-guarded** in the 117/130 shape CLAUDE.md
  describes — an unguarded `GRANT` raises 42704 on a cold bootstrap and rolls the whole
  file back.
- **`--check` mode**, run in CI, failing when the committed SQL and the freshly rendered
  TS disagree. Without it the browse pages and `hub_stats.json` compute the same „culture"
  from two definitions and both look like they work.

⚠ **The generator must render the predicates through `cultureMatch.ts`'s own
`cultureNameSql` / `chitalishteNameSql` / `interregThemeSql` helpers**, never re-assemble
the term lists. Those helpers already carry the anchoring and the exclusion halves, and
the file's header records four measured inversions from getting an anchor wrong.

### §4.4 The resources

Four new `db_table.js` resources, each `base:` one of the four views. Column sets are the
underlying tables' minus what the arm cannot answer:

**`culture_isun_eik`** and **`culture_isun_name`** — mirror the existing `fund_projects`
resource (`beneficiary_name` searchable, `program_name` / `status` / `org_type` / `oblast`
faceted, `total_eur` / `grant_eur` / `paid_eur` sortable + summed). `contract_number` stays
`filter: "in"` so a row links to `/funds/contract/:contractNumber`.

**`culture_agri_chitalishta`** — mirror `agri_subsidies` (`name` searchable, `year` /
`oblast` / `scheme` faceted, `total_eur` sorted + summed). ⚠ Keep `scheme_desc` out of the
global search for the reason the existing resource states: no trigram index, so OR-ing it
in forces a 2.5M-row seq scan per keystroke.

**`culture_interreg`** — new shape, no precedent resource. Searchable: `partner_name`,
`title_en`. Faceted: `programme_code`, `period`, `is_lead`, `budget_basis`, `country_department`.
Sorted + summed: `budget_eur`, `eu_funding_eur`. `keep_id` `filter: "in"` for the row link.

All four: `defaultSort` by the money column desc, `maxPageSize: 100`, aggregates
`count` + `sum`.

⚠ **Deploy ordering is BREAKING for these four, not cosmetic.** A DbDataTable resource has
no `missingMigration` degrade — the registry engine reads the base relation unconditionally
and `badRequest()` rethrows anything that is not a `DbRequestError`. So a `deploy:db` that
ships the resources before 189 reaches the target **500s** each page. Same rule as
`cpv_catalog` / `contractor_rank` / `company_browse_table`. See §9.

---

## §5 — The page design

One layout, four instances. Built on `HubHead` (`src/ux/infographic/HubHead.tsx`) because
it is the component that encodes the rules this subject needs — `HubKpi.basis` is a
**required** field, and `HubEvidence.basis` names what a ranked list is ranked BY.

⚠ `HubHead` renders the page's `<h1>` **and** its `<SEO>`. A screen using it must NOT also
render `<Title>` — that emits two h1s. The current `CultureFundsScreen` uses `<Title>`;
the new screen uses `HubHead` instead.

### §5.1 Above the fold

```
SectorBreadcrumb        Управление › Обществени поръчки › Държавни сектори › Култура › Еврофондове › <arm>
HubHead
  eyebrow      „Култура · Еврофондове"           freshness  „данни към <generatedAt>"
  h1           the arm's name, with its basis IN the title, e.g.
               „ИСУН — по име на бенефициента"
  deck         one sentence: what this number IS, and the one thing it is not.
  search       the arm's own search box (HubSearch-style), seeding the table's ?q=
  evidence     „Най-големи получатели"  basis: „по договорена безвъзмездна помощ"
               5 rows, each linking to that recipient's page
  kpis         3–4, each with a required `basis` — see per-arm table below
  kpiNote      the non-summation sentence
```

### §5.2 The basis card — the block that makes this page honest

Directly under the head, before any table: a bordered card, not a footnote, carrying three
labelled lines the reader can act on.

- **Основа** — what one row is. („Стойност на договора по ИСУН" / „Публикуван бюджет на
  партньора" / „Земеделско плащане".)
- **Как се стига до тези редове** — the identity used, in words. („Точно съвпадение по ЕИК
  срещу регистъра на сектора" / „Съвпадение по име, с изключения срещу „аквакултури" и
  „изкуствен интелект"".)
- **Какво този ред НЕ отговаря** — the coverage limit, with its number. („Само 37 от 202
  участия носят ЕИК, така че филтър по ЕИК отговаря на около една пета от въпроса.")

The third line is the one that must never be dropped to save space. It is the difference
between a page that answers a question and a page that looks like it did.

### §5.3 The cross-arm strip

Four compact cards (the current arm shown as the active one, unlinked), each with its
figure, its row count and a two-word basis label, under the heading „Другите три потока —
**не се събират**". This is the parent page's opening paragraph rendered as navigation, and
it is what protects a reader who arrived from search.

### §5.4 One chart per page, and only where there is something to compare

Per the house rule, no sparklines and no stat card where a comparison exists. The
`/culture` hub's own scene vocabulary (`cultureScenes.tsx`, `TILE_ACCENTS`) supplies the
palette.

| page | chart | why this one |
| --- | --- | --- |
| `isun-eik` | horizontal bars, 31 beneficiaries by grant | 47 rows over 31 bodies — the whole arm fits on one axis, and concentration is the story |
| `isun-name` | stacked bar, programme split | ПВУ is €117.3m of €147.0m. Without this the reader mis-reads the arm's subject |
| `interreg` | grouped bars, programme × published budget, with the lead/partner split | 14 programmes, 72 leads of 202 rows |
| `dfz` | year × € columns, 2015–2025, scheme as the series | 8 distinct years, front-loaded in 2015 — a flat total hides that |

Every chart measures its own width (no fallback width — in a grid item the guess latches
and blows out mobile).

### §5.5 The table

`DbDataTable` on the arm's resource, with the arm's facets in the toolbar, the aggregate
footer showing Σ over the **whole filtered set** (the reason the server-side table exists),
and a row link per §6.

---

## §6 — Per-arm specifics

### `/culture/funds/isun-eik` — ИСУН, по ЕИК

- **KPIs**: €105.9m *(basis: „договорена помощ по ИСУН, ЕИК-точно съвпадение")* · 47
  проекта · 31 бенефициента *(of 63 in the register — the other 32 have no ИСУН row)* ·
  7 програми.
- **Facets**: program_name, status, org_type, oblast. 39 of 47 rows carry an oblast — the
  facet must say „8 без област", never silently drop them.
- **Row link**: `/funds/contract/:contractNumber` (47/47 available).
- **Recipient link**: `/company/:eik`.
- **The page's own caveat**: this is the *reproducible* arm — anyone with the register and
  the corpus gets this number. Say so; it is the arm's whole value.

### `/culture/funds/isun-name` — ИСУН, по име

- **KPIs**: €147.0m *(basis: „договорена помощ, съвпадение по име")* · 1,560 проекта ·
  1,475 получателя · ПВУ дял 80% *(basis: „€117,3 млн. от €147,0 млн.")*.
- **Facets**: program_name, status, org_type, oblast (30 oblasts — all covered).
- **Row link**: `/funds/contract/:contractNumber`.
- **Two named sections this page owes the reader**, both from §2:
  - „Читалищата тук" — 1,332 rows / €22.1m, with a link across to `/culture/funds/dfz`
    (the same population under a different register).
  - „Един ред от ЕИК-списъка не се хваща по име" — the single `000669802` row, named,
    with the reason. This is the visible edge of the matcher.
- **Do not** put a „precision" or „confidence" score on rows. The matcher is a stated rule,
  not a score, and inventing a grade would imply per-row verification nobody did.

### `/culture/funds/interreg` — Interreg, тематично

- **KPIs**: €48.8m *(basis: „публикуван бюджет на партньора, не стойност на договор")* ·
  202 участия · 168 партньора · 144 операции.
- **Coverage line, mandatory**: 37 of 202 rows carry an EIK (18%); 199 of 202 budgets are
  published, 3 are not.
- **Facets**: programme_code, period (2014-2020 / 2021-2027), is_lead, budget_basis.
- **Row link**: `/funds/interreg/:keepId` — ⚠ function-served (`functions/spa_page.js`),
  so `deploy:db` must precede `deploy` when anything about that family changes.
- **The trap to keep off the page**: this arm is joined through the OPERATION's THEME, not
  through a set of culture bodies. „Interreg culture money reaching Bulgaria" and „culture
  institutions doing Interreg" are ~4.4x apart. The h1 and the deck must say *thematic*;
  a page headed „Култура в Interreg" answers the other question.

### `/culture/funds/dfz` — ДФЗ, народни читалища

- **KPIs**: €18.3m *(basis: „изплатени земеделски субсидии")* · 264 плащания · 212
  читалища · 2015–2025.
- **Coverage line, mandatory**: **0 rows reachable by EIK.** `sectorPacks.tsx` already
  records the measurement and the reason — the only EIK-side match is one national music
  school on „Училищни схеми" (€5,416 over 2016–2017), which would understate the arm by
  ~3,400x while looking answered. The page must state that this arm is reachable **only by
  name**, and that no state cultural institution appears in it at all.
- **Facets**: year, oblast, scheme.
- **Row link**: `/farm/:eik` where present (237/264); plain text for the other 27 — never a
  link to a page that cannot resolve.
- **Scheme labels**: `scheme` is a bare code (`322`). Render the code with `scheme_desc`
  beside it, or the facet is unusable.

---

## §7 — Changes to the parent page

`CultureFundsScreen.tsx`:

1. Each of the four `<li>` rows becomes a link to its detail page, keeping the figure, the
   sub-line and the basis paragraph exactly as they are. The rows are already the right
   shape; they only lack a destination.
2. Fix the „Подмножество на реда отдолу" copy per §2 (both languages).
3. Keep the opening „не се събират" paragraph. It is now stated in five places rather than
   one, which is correct for a rule this easy to break.
4. The `#chitalishta` section gains links to both читалища populations (`isun-name`'s
   section and `/culture/funds/dfz`), since it currently quotes both figures with nowhere
   to go.

`cultureRegistry.ts`: the `funds` hub tile keeps its destination (`/culture/funds`) — the
parent stays the entry point. No new hub tiles; four tiles for four bases would put the
non-summation rule on the hub, where there is no room to state it.

---

## §8 — The three artifacts every new page owes

Per the dashboard-hub rule, and none of these is automatic:

1. **Prerendered body** — `scripts/prerender/routes.ts`, one entry per page per language.
   ⚠ The bodies must NOT quote the four figures as frozen strings: that is the exact defect
   `culture_hub_figures.data.test.ts` was written for. Either interpolate from
   `data/culture/derived/hub_stats.json` at build time (as the `/culture` body already does
   from `overview.json`) or write bodies that describe the arm without a number.
2. **Sitemap `<loc>` in BOTH lists** of `scripts/sitemap/route_defs.ts` (the path list at
   ~line 110 and the `{path, file}` list at ~line 242), then `npm run sitemap`.
   `ogAndSitemapCoverage.test.ts` and `scripts/sitemap/families.data.test.ts` both fail
   until a `<loc>` has a real `dist/<path>/index.html` behind it.
3. **og:image** — four entries in `scripts/og/capture-screens.ts`, each anchored on that
   page's own chart via a `data-og="…"` attribute, then `npm run og`. Sharing four pages
   that all fall back to `/og/culture.png` (a film-subsidy hero) is the „share card that
   describes a different page" defect.

**i18n**: bg + en copy lives beside the registry in `cultureFundSources.ts`, following
`CULTURE_HUB_COPY`'s precedent — these strings exist once, on four pages, and a corpus key
per string is a key nobody else can reuse. ⚠ If any string does go into the i18n corpus, it
belongs in the core `translation.json` unless the bundle analysis proves exclusivity
(`scripts/i18n/bundles.ts`); a key in the wrong bundle renders as its own identifier at a
200.

⚠ **Never read a prerendered page through `npm run preview`** — it serves the SPA fallback
at the no-slash URL, so `/culture/funds/dfz` returns the HOMEPAGE prerender. Read
`dist/<path>/index.html` directly.

---

## §9 — Deploy order

Local:

```bash
npm run gen:culture-sql                 # rewrite 189 from the TS
npm run db:load:funds:pg                # applies 189 (or apply_functions.ts, below)
npm run test:data
```

Ship a view-body change on its own with the usual hatch:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts 189_culture_match.sql
```

Cloud, **in this order** — the first step is not optional and the ordering is breaking:

```bash
DATABASE_URL=…:5434/… npx tsx scripts/db/apply_functions.ts 189_culture_match.sql   # 1
npm run deploy:db                                                                    # 2  the four resources
npm run deploy                                                                       # 3  the pages
```

Step 2 before step 1 is a **500** on all four pages (§4.4). Step 3 before step 2 points
four live URLs at a function that cannot serve them. And since step 3 moves the bundle
hash, the `/person/**` three-step rule in CLAUDE.md applies if that family is touched in
the same release.

`hub_stats.json` is unaffected — it is a committed file shipped by `bucket:sync`, and these
pages read Postgres directly rather than the blob for their row-level content. The KPI band
reads the blob (so the four pages and the parent agree to the byte); the tables read PG. ⚠
That means the two can disagree between a corpus reload and a `db:gen-culture-hub-stats`
run. Decide this explicitly — see §12.

---

## §10 — Gates

New: `scripts/db/tests/culture_fund_sources.data.test.ts`

1. **Each view reconciles with its `hub_stats.json` arm** — row count and €, per arm. This
   is the drift detector between the blob the KPI band reads and the view the table reads.
2. **The overlap claim** (§2): `EIK ∩ name` re-derived, and the parent page's copy checked
   against it. Fails when the corpus moves the relationship.
3. **The generated SQL is not stale** — `npm run gen:culture-sql -- --check`, in CI, no
   Postgres needed.
4. **Coverage figures are non-vacuous**: Interreg `with_eik / rows` strictly between 0 and
   1; ДФЗ EIK-arm reach is exactly 0 rows *and the pack still declares the withholding*
   (`sector_beneficiary_reach.data.test.ts` already owns half of this).
5. **A mutation check on each name arm** — re-run each view's predicate with
   `withExclusions: false` and require strictly more rows. An assertion satisfied by a view
   that had silently stopped excluding „аквакултури" is not an assertion.
6. **No cross-arm total exists.** A static scan (in the `entryGraph.test.ts` /
   `key_usage.test.ts` style, over the four source files with comments stripped) failing on
   any expression that adds two arms' euro figures.
7. **Query cost ceilings**, anchored on the view's own scan node: ≤ 3,000 buffers for the
   ИСУН name arm, ≤ 1,000 for ДФЗ. Measured today at 1,525 and 370. This is what catches a
   future rule change that defeats the trigram index — the failure would otherwise be a
   slow page nobody times.

Component tests: `CultureFundsSourceScreen.test.tsx` — one per arm asserting the basis card
renders all three lines, the coverage number is present, and the cross-arm strip names the
other three. Plus a test that the word „общо" / „total" appears nowhere across the four.

---

## §11 — Tiers

| tier | content | ships |
| --- | --- | --- |
| **0** ✅ | §2's correctness fix: parent-page copy + the overlap gate | **shipped 2026-08-25** |
| **1** | `gen:culture-sql` + `189_culture_match.sql` + appliers + the `--check` gate | no UI change |
| **2** | The four `db_table.js` resources + `deploy:db` | no UI change; verify each resource by hand against §1's table |
| **3** | `cultureFundSources.ts` + `CultureFundsSourceScreen.tsx` + 4 routes, tables only (no charts) | the pages become real |
| **4** | `HubHead` band, basis card, cross-arm strip, evidence lists | the hub-grade UI |
| **5** | The four charts (§5.4) | |
| **6** | Prerender bodies + sitemap `<loc>`s + og captures + parent-page row links | the pages become indexable and reachable |

Tier 0 is separable and worth shipping first: it is a published claim that is currently
false, and it does not wait on any of the machinery.

---

## §12 — Decisions I need from you

1. **KPI source — blob or live?** The KPI band can read `hub_stats.json` (so the four pages
   and the parent agree exactly, at the cost of going stale between a corpus reload and the
   next `db:gen-culture-hub-stats`) or read the view's own aggregate live (always current,
   at the cost of the parent and the child disagreeing for a day). My recommendation: **the
   blob**, with gate §10.1 as the drift alarm — a hub and its sub-page publishing two
   different numbers for the same thing is the worse failure.
2. **URL for the ДФЗ arm** — `/culture/funds/dfz` (basis-named, my preference) or
   `/culture/funds/chitalishta` (population-named). The second reads better and is
   ambiguous: читалища are also 1,332 rows of the ИСУН arm.
3. **Interreg beyond culture.** The `culture_interreg_thematic` view is the first
   theme-keyed Interreg surface. Should it be built as a culture-only view, or as a general
   `interreg_by_theme(pattern)` seam other sectors can reuse? v1 as written is culture-only.

---

## §13 — Explicitly out of scope

- **Widening `cultureMatch.ts`.** No new stems. §2 explains why the one un-matched row
  stays un-matched.
- **A combined „all culture money" figure or page.** That is the thing §0 forbids.
- **An approval or success rate anywhere.** ИСУН publishes no rejected applications, so the
  denominator does not exist (`funds_fit_procedure`'s rule, one corpus over).
- **A year axis on either ИСУН page.** `fund_projects` has no date columns.
- **Retiring `hub_stats.json`'s funds/agri/interreg arms.** They front the `/culture` hub
  and stay.
