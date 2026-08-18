# Education sector audit (`edu`) — v1

Audit of the `/governance/sectors` **Образование** tile and the `/sector/edu`
dashboard against the raw sources, both sides of the money. Run 2026-08-18 via
`/audit-sectors`.

## What was already correct

- **Phase 1 — the hub headline reconciles exactly.** `sector_stats.json[*].edu` is
  `{kind:"eur", basis:"budget", value:758408400, year:2026}` and equals
  `data/budget/ministries/admin-ministerstvo-na-obrazovanieto-i-naukata.json`
  → `years[fiscalYear=2026].expenditure.amountEur` to the euro. All nine fiscal
  years (2018→2026) reconcile against that file; `y:2011`–`y:2017` correctly carry
  `unavailable:true` because the МОН series starts FY2018 (same behaviour as every
  other budget-basis sector).
- **Failure mode I clean.** The 2026 programme split sums exactly to the header:
  703,080,700 + 48,541,000 + 6,786,700 = 758,408,400.
- **Failure mode E clean.** The EIK-set copies agree — `edu` was a single-member
  collapse on `MON_EIK`, and both `SECTOR_DASHBOARDS.edu.members` and
  `SECTOR_BROWSE_PACKS.edu.eiks` import it from `src/lib/monBenchmarks.ts` rather
  than re-hardcoding the digits.
- **МОН's EIK is genuinely МОН.** 000695114 carries five name variants plus one
  €75.7k row filed by БСУ „Д-р Петър Берон", Прага — an МОН school abroad filing
  under the ministry's own EIK, i.e. correct attribution, not leakage.
- **Failure mode Q clean.** Zero self-deals (`awarder_eik = contractor_eik`).

## Findings

### F1 (major, Failure mode D) — the sector's awarder set is МОН alone

`/sector/edu` rolls up **one** EIK. Measured against the corpus:

| set | all-corpus | contracts | default scope `ns:2026_04_19` |
|---|---|---|---|
| today (МОН only) | €506.2M | 1,097 | **€3.17M over 9 contracts** |
| audited set (126 EIKs) | **€2,112.0M** | 21,999 | **€71.7M over 865 contracts** |

The state higher-education institutions award €1,273.9M and belong to **no
sector at all** — `/education` is the schools/matura tier, so higher education was
covered nowhere on the site. This is the transport-audit shape (€3.7M shown for a
real €348.2M).

Missing bodies found, by universe:

- **agency (16, €130.1M)** — `ССО ЕАД` (Студентски столове и общежития, €70.7M),
  `ИА „Програма за образование"` (€16.3M), `НИОКСО` (€16.5M), `НАЦИД` (€15.1M),
  `Ученически отдих и спорт ЕАД` (€5.5M), `Национален студентски дом` (€2.3M),
  `ЦОИДУЕМ` (€1.9M), **`Институт по образованието` (181260010, €0.65M)**, `ЦОПУО`,
  `Фонд „Научни изследвания"`, `ДАНИИ`, and 5 РУО.
- **higher_education (34 EIKs / 33 institutions)** — every state HEI whose ПРБ is МОН,
  from СУ (€138.0M) down to ВСУ „Любен Каравелов" (€1.2M). 34 rather than 33 because
  Стопанска академия „Д. А. Ценов" changed EIK in 2016 and both halves of its history
  are kept; **institution counts and EIK counts differ here and must not be conflated**.
- **research_ban (47)** — БАН + its institutes and auxiliary units (€147.3M).
- **research_ssa (28)** — Селскостопанска академия + its institutes, научни центрове
  and опитни станции (€54.4M).

`Институт по образованието` is the one no list of the older agency names would
find: it is the 2024 merger that now procures the **ДЗИ/НВО exam papers** and the
Единна информационна система за изпити и прием. Its two predecessors (НИОКСО,
ЦОПУО) are kept alongside it — same pattern as the two Свищов EIKs below — because
each holds real history that the successor does not.

Verified: **all 126 EIKs are unclaimed** by any other `SECTOR_DASHBOARDS` member
list or `SECTOR_BROWSE_PACKS` set, so the "an EIK is a member of two sector
dashboards" gate in `sector_stats.data.test.ts` stays green. All 126 have contracts,
so none needs `noAwarderPage`.

### F2 (Failure mode J → resolved by F1)

On the default scope today the МОН-only window is 9 contracts with **Псит България
ООД at 72.3%** and a five-member consortium at 19.4% — a "leaderboard" that is one
row. With the audited set the same scope has 855 contracts and the top all-corpus
beneficiary is Исубус ООД at **2.73%**. Intra-group circulation is €17.59M of
€2.07bn (**0.85%**), dominated by МОН → Ученически отдих и спорт ЕАД — worth naming
in the reference data, not worth excluding.

### F3 (Failure mode N, corpus-wide artifact — reported, not fixed here)

`contractor_eik = '000000001'` is a **shared placeholder for nine different foreign
suppliers** (Elsevier B.V. €32.8M, Clarivate €11.2M, Vier Gas Transport,
Plagiat-Sistem…; 16 rows / €45.7M corpus-wide). On МОН's leaderboard it renders as
one contractor at €44.8M — the #2 "supplier" is a fiction merging two publishers.
Cross-sector ingest artifact; per the skill it belongs in the ingest/parser if
anywhere, never in a per-sector filter.

### F4 (Failure mode N, display) — corpus name latching

`min(awarder_name)` / registry resolution latches misleading labels across this set:
`123024538` (Тракийски университет) surfaces as „Медицински факултет към Тракийски
университет"; `831917453` as „„Студентски столове и общежития" ЕАД ЕАД"; and ~40
institutes render SHOUTING or with „Старо наименование" clutter. Fixed the way
`regionalReferenceData` already does it — fold the curated names into
`AWARDER_NAME_OVERRIDES`.

### F5 (Failure mode C avoided) — why this had to be curated by EIK

A „университет" name sweep is catastrophic here: the top eleven hits by € are
university **hospitals** (УМБАЛ „Св. Георги" €1.39bn, ВМА €1.15bn, УМБАЛ „Св. Иван
Рилски" €0.87bn…), which are health/defense. A „%БАН%" sweep matches **БНБ**
(€236.1M) and every община with „Банско"/„баня"/„Бани" in its name. Nothing in this
plan is derived from a name pattern.

### Boundary decisions (confirmed with the user 2026-08-18)

1. **Widest set** — ministry + agencies + state HEIs + БАН and ССА research institutes.
2. **Headline stays the МОН node**, with the sector screen naming what it excludes.
   The node's 2026 higher-education programme is only €48.5M because state
   universities are separate ПРБ drawing their subsidy straight from the central
   budget (they are absent from `budget_admin_node`, which holds 54 first-level ПРБ);
   the municipal school tier is delegated through общините. COFOG GF09 (education,
   S13) is €4.455bn for 2024 against the node's €579.4M.
3. **Academies under another budget principal stay in that principal's sector.** The
   decision was taken on the premise that seven qualified; **verification during the
   Tier 1 review reduced that to four**. `kulturaReferenceData.ts` carries an
   `EXCLUDED_EIKS` ANTI-allowlist alongside its allowlist, and grepping an EIK finds it
   either way — so НХА, НМА, НАТФИЗ and the three БАН museum-institutes (НАИМ, ИЕФЕМ,
   НПМ) read as culture-owned when culture in fact **disclaims** them and names this
   sector as owner (`principal: "ban_mon"`; НАТФИЗ's reason is literally
   „higher-ed / МОН"). НХА and НМА appear in no reference-data file at all. Excluding
   those six would have stranded them in no sector — the F1 defect reproduced — and made
   the Tier 3 footnote assert something false about six named institutions, so they are
   IN: the three art academies under `higher_education`, the three museum-institutes
   under `research_ban`. The four genuinely held elsewhere — ВВМУ, НВУ, Военна академия
   (defense) and Академия на МВР (security) — were verified present in those packs' own
   member lists and stay out. The awarders tile says so rather than pretending the roster
   is the complete ЗВО list. **Rule this establishes: ownership is verified against
   `SECTOR_DASHBOARDS` members / `SECTOR_BROWSE_PACKS` eiks, never against a string's
   presence in a sibling file.**

## Tier 1 — `src/lib/educationReferenceData.ts` (new, canonical)

Model on `socialReferenceData.ts` / `regionalReferenceData.ts`.

- `EducationUniverse = "ministry" | "agency" | "higher_education" | "research_ban" | "research_ssa"`
- `EDU_UNIVERSE_LABEL: Record<EducationUniverse, {bg, en}>`
- `EDU_ENTITIES: EducationEntity[]` — 120 rows, `{ eik, name, universe }`, curated
  Bulgarian labels (the corpus spellings are unusable, see F4).
- `EDU_SECTOR_EIKS` derived from `EDU_ENTITIES`; `EDU_LEAD_EIK` re-exports `MON_EIK`
  from `monBenchmarks.ts` — **do not restate the digits**.
- `educationEntityByEik()`, `EDU_UNIVERSES` (ordered, for the awarders-tile grouping).

Header must carry: the curate-by-EIK rule with F5's measured counter-examples; why
the four military/МВР academies are deliberately absent and why the six
culture-adjacent ones are NOT (boundary decision 3); the two temporally-disjoint Свищов EIKs
(`040624317` 2011-2015 → `000124026` 2016-2026, a genuine EIK change, **not** an
alias double-count — both are needed for full history); the same for
НИОКСО/ЦОПУО → Институт по образованието; and that ССА's budget principal is
МЗХ rather than МОН (the accounting seam, same shape as ДАЗД in social — so the
group's procurement spans three budget principals while the hub headline spans one,
and the two are **not** a ratio).

## Tier 2 — repoint the copies

- `src/screens/sector/sectorDashboards.ts` — `edu.members` maps `EDU_ENTITIES`
  with `group: EDU_UNIVERSE_LABEL[e.universe]` (the `social` pattern verbatim).
  At 120 members the screen's `MEMBER_SEARCH_MIN` auto-enables `SectorMembersSearch`.
- `src/screens/components/procurement/sectorPacks.tsx` — `edu.eiks = EDU_SECTOR_EIKS`;
  drop the now-stale "widen the EIK-set here when a multi-entity roster lands"
  comment for `edu` and relabel the pack „Образование и наука".
- `src/lib/awarderNameOverrides.ts` — fold `EDU_ENTITIES` in, exactly as
  `REGIONAL_OVERRIDES` does.
- `scripts/db/gen_procurement/sector_stats.ts` — `edu` stays in `BUDGET_SECTOR_NODE`
  and out of `SECTOR_EIKS` (basis unchanged). Add a comment recording that the node
  excludes the university tier and the delegated municipal school tier, so a later
  reader does not "fix" the gap by summing the group's procurement onto it.

## Tier 3 — name what the headline excludes

- Add an optional `footnote?: {bg, en}` to `SectorDashboardConfig` and render it in
  `SectorAwardersTile` (today the `footnote` prop is populated only for
  single-member sectors). Generic engine change, one sector uses it now.
- `edu` footnote: the group spans three budget principals (МОН, МЗХ for ССА, БАН's
  own), the hub tile's € is МОН's own enacted budget and covers neither the state
  universities' separate ПРБ budgets nor the delegated municipal school budgets, and
  seven state higher schools sit under МК/МО/МВР and are found in those sectors.
- Update `sector_edu_desc` — „Договори и бюджет на МОН" is no longer what the page
  shows.

## Tier 4 — regression tests

New `scripts/db/tests/sector_stats_education.data.test.ts` (model on
`sector_stats_environment.data.test.ts`; auto-skips when Postgres is down). Bands and
inequalities only, never exact equality:

1. `sector_stats.json[*].edu.basis === "budget"`, and `value` within a band of the
   МОН node's resolved year — pins the Phase 1 reconciliation without pinning a figure
   that a new fiscal year moves.
2. **The EIK-set copies are equal** — `EDU_SECTOR_EIKS` ≡
   `SECTOR_DASHBOARDS.edu.members.map(m => m.eik)` ≡ `SECTOR_BROWSE_PACKS.edu.eiks`,
   as sets, with a floor so an emptied registry cannot pass by comparing nothing.
3. **Anti-allowlist, BOTH halves.** The four externally-held academies (`129004492`,
   `129009094`, `129003305`, `129001232`), НИМХ (`000663814`, environment) and НИП
   (`131177220`, judiciary) are **absent** from `EDU_ENTITIES` — the re-leakage
   tripwire. And the reciprocal half, which is the one that matters: every
   `EDUCATION_EXTERNAL_HIGHER_SCHOOLS` entry must be **really claimed** by the sector it
   names, resolved against that sector's own `SECTOR_DASHBOARDS` members /
   `SECTOR_BROWSE_PACKS` eiks. Without it, "excluded because sector X owns it" is an
   unchecked claim — exactly how six institutions were nearly stranded. Conversely,
   assert the six restored ones (`000670716`, `000670709`, `000670723`, `000670919`,
   `175905773`, `000665612`) ARE present, so a future tidy-up that re-reads culture's
   anti-allowlist as an allowlist fails instead of shipping.
4. **Signature members present with a € floor** — МОН, СУ, ССО ЕАД, БАН,
   Селскостопанска академия, and `181260010` (Институт по образованието, the one a
   name-based list would miss).
5. **Group € band** for a fixed scope (`all`), floor and ceiling.
6. **Beneficiary side** — top-contractor share ceiling for `all` (measured 2.73%;
   assert < 15%), so a rollup change that starts crediting a consortium's full value
   to every member shows up as a share rather than only as a total.
7. **Leaderboard basis equals the headline basis** — Σ of the per-contractor rollup
   from `awarder_group_model` for a scope equals its `head.totalEur` (Failure mode O
   is invisible to every other gate, because both halves are individually correct).
8. Every universe is non-empty and every entity resolves to a real awarder with
   contracts (so `noAwarderPage` stays unnecessary and the awarders tile has no dead chips).
9. **Pin the institution count separately from the EIK count** — `higher_education` is 34
   EIKs and 33 institutions, and prose quoting one where it means the other is how
   „31 universities" reached the first draft of the reference data. Assert both.

Plus a unit test beside the reference data (`educationReferenceData.test.ts`) for the
no-duplicate-EIK and universe-coverage invariants, mirroring
`regionalReferenceData.test.ts`.

## Tier 5 — regenerate + verify

`npm run db:gen-sector-stats` (the edu value must NOT move — basis is unchanged; the
diff should be empty for `edu` and every other sector), `npx tsc -b`, `npm run lint`,
the touched vitest suites, and a live check of `/governance/sectors` and `/sector/edu`
reading the top „Топ изпълнители" row as a sentence.

`sector_stats.json` is regenerated but expected byte-identical here — commit it only
if it actually moves.
