# Земеделие (agri) sector audit — v1

Audit date **2026-08-20**, against the local corpus (`electionsbg-pg` :5433).
Skill: `/audit-sectors`. Sibling precedents: `education-sector-audit-v1.md`
(the roster widening), the transport audit (€3.7M shown for a real €348.2M),
the energy audit (Phase 2b beneficiaries).

---

## 1. What the audit found

### 1.1 The money is clean — Phases 1, 2 and 2b all pass

**Phase 1.** `sector_stats.json.agri` is `basis: "payout"` and reconciles to
`agri_payloads` (kind=`overview`) **to the cent at all 30 scopes**:

| scope                              | emitted                                               | source key                       |
| ---------------------------------- | ----------------------------------------------------- | -------------------------------- |
| `all` + every `ns:`                | €1,586,940,416.44 (`year: 2025`)                      | `2025` ✓                         |
| `y:2015` / `y:2016` / `y:2017`     | 1,317,644,446.8 / 1,561,552,029.08 / 1,202,574,042.81 | ✓ ✓ ✓                            |
| `y:2021` … `y:2025`                | 1,437,157,140.4 … 1,586,940,416.44                    | ✓ all five                       |
| `y:2011-14`, `y:2018-20`, `y:2026` | `unavailable: true`                                   | correct — CAP corpus has no rows |

`all` resolving to the LATEST year (not the €11.04bn all-years aggregate that
`agri_payloads['all']` holds) is `annual()`'s documented behaviour, shared with
every budget/payout sector. Not a defect.

**Phase 2.** `agri` is correctly ABSENT from `SECTOR_EIKS` (payout basis, so the
generator never sums contracts for it). The three copies that do exist —
`SECTOR_DASHBOARDS.agri.members`, `SECTOR_BROWSE_PACKS.agri.eiks`, `leadEik` —
all import the single `AGRI_PAYER_EIK` from `src/data/agri/constants.ts`. No
hardcoded digits, no drift.

**Phase 2b.** ДФЗ's own procurement is hygienic: 565 contracts, €131.1M,
**0** null-EIK, **0** null-amount, **0** self-deals, no contracting-authority
beneficiaries, no intra-group circulation. Top beneficiary 21.8% (ЕТ Фантастика
95 — €28.6M). Nothing to fix.

### 1.2 F1 — the destination contradicts its own tile by 550× (Failure mode A)

The hub tile on `/governance/sectors` reads:

> **Земеделие · €1,6 млрд. · ИЗПЛАТЕНО 2025 · ДФЗ · „Субсидии · бенефициенти · САР"**

`/sector/agri` on the default scope (this parliament) renders, verbatim:

> Общо възложени **€2,9 млн.** · Договори **15** · Изпълнители **12** ·
> Топ изпълнител **€767,6 хил. — А1 България ЕАД**

**€2.9M against €1.59bn — 0.18% of the sector's money**, and not one euro of it
is a subsidy. The word does not appear on the page. A reader promised
_субсидии · бенефициенти · САР_ gets a mobile-phone contract (А1), a cleaning
firm (Василка) and a stationery co-op (Панда). The `descKey` is a promise the
destination cannot keep.

### 1.3 F2 — no route from `/sector/agri` to `/subsidies`

`grep -rn subsidies src/screens/sector/` returns **zero hits**. `/subsidies` is a
nine-page module over 2.48M subsidy rows (recipients, schemes, places,
untraceable, concentration, political, cross-programme, browse, coverage).

Governance therefore has two doors to farm money — `/governance` → Субсидии →
the module, and `/governance/sectors` → Земеделие → a dead end — and the door
that displays the €1.6bn is the one that leads nowhere.

### 1.4 F3 — agri is the only payout sector with no pack

| sector   | basis      | pack                  | what the page shows                |
| -------- | ---------- | --------------------- | ---------------------------------- |
| pension  | payout     | `NoiPack` (6 tiles)   | ДОО outlay, fund flow, integrity   |
| health   | payout     | `NzokPack` (20 tiles) | hospital payments, pathways, drugs |
| **agri** | **payout** | **none**              | **ДФЗ's phone bill**               |

`AGRI_PAYER_EIK` is absent from `PACKS` in `sectorPacks.tsx`, so the screen falls
through to the generic contracts group model.

### 1.5 F4 — the roster is 1 EIK; ~€392M of agriculture procurement is in no sector

Measured against the corpus, with ownership checked against **every**
`src/lib/*ReferenceData.ts`:

| body                                                      | EIK         | €       | owned by                      |
| --------------------------------------------------------- | ----------- | ------- | ----------------------------- |
| БАБХ (+ its ОДБХ rows on the same Булстат)                | 176040023   | €217.4M | **nobody**                    |
| МЗХ (ministry)                                            | 831909905   | €107.6M | **nobody** (budget node only) |
| ИАРА (рибарство и аквакултури)                            | 000649519   | €17.9M  | **nobody**                    |
| ДП „Кабиюк“                                               | 127512595   | €17.7M  | **nobody**                    |
| НССЗ                                                      | 130339616   | €4.4M   | **nobody**                    |
| ИАСРЖ, НДНИВМИ, ЦЛВСЕЕ, КТИ, ИАСАС, ИАЛВ, ИА СОСЕЗФ, НСРЗ | —           | €9.6M   | **nobody**                    |
| ОДБХ ×16 + ОДЗ ×8                                         | —           | €17.5M  | **nobody**                    |
| ИАГ + 16 РДГ + 11 природни парка                          | 121486802 … | €73.3M  | **nobody** — see §3a          |
| Напоителни системи                                        | 831160078   | €212.7M | water ✓                       |
| ССА + institutes, УХТ Пловдив                             | 000662107 … | €31M+   | edu ✓                         |

The two claimed families are **correctly** claimed — no leakage, no
double-count, nothing to remove. But the sector named „Земеделие“ carries only
the paying agency while its principal ministry, its largest agency and its entire
forestry administration have no sector page at all. Same shape as the transport
and education audits.

This does **not** move the hub headline (payout basis). It widens the
dashboard's buy-side and the `?sector=agri` browse filter only.

---

## 2. Decisions taken (2026-08-20, confirmed by the operator)

1. **Build an `AgriPack`** — same shape as `NoiPack`/`NzokPack`. Closes F1+F2+F3.
2. **Widen the roster to the МЗХ family** (F4).
3. **Ship a three-basis budget strip** naming CAP payout / ДФЗ ПРБ / МЗХ ПРБ.

---

## 3. The curated roster (38 EIKs)

⚠ **Curate by EIK, never by name regex.** The `%земедел%` sweep that found these
also returns **~15 „Професионална гимназия по земеделие“** — agricultural
vocational schools, which are МОН/municipal bodies, not МЗХ ones (€8M+ combined).
Including any of them is the `7-МО Основно училище` error from the defense audit.
It also returns every ССА institute (edu), Напоителни системи (water) and the
РДГ forestry directorates (environment).

⚠ **`176040023` carries TWO names in the corpus** — „Българска агенция по
безопасност на храните“ (575 contracts, €217.4M) and „Областна дирекция по
безопасност на храните /ОДБХ/ към БАБХ, гр. Благоевград“ (3, €654k). One shared
Булстат, so a GROUP BY on `awarder_eik` folds them correctly and the EIK is
listed **once**. Note Благоевград ALSO has its own separate EIK (176986803) —
both are real, and they do not overlap.

**Universes** (`AGRI_UNIVERSE_LABEL`):

- `ministry` — МЗХ `831909905`
- `paying_agency` — ДФЗ `121100421` _(lead)_
- `food_safety` — БАБХ `176040023`, НДНИВМИ `176986785`, ЦЛВСЕЕ `176986461`,
  НСРЗ `000698562` _(predecessor body, folded into БАБХ in 2011 — its €246k is
  genuinely this sector's history)_
- `agency` — ИАРА `000649519`, НССЗ `130339616`, ИАСРЖ `130925885`,
  КТИ `121710037`, ИАСАС `130209583`, ИАЛВ `130297067`,
  ИА „Сертификационен одит на средствата от европейските земеделски фондове“ `177057545`
- `state_enterprise` — ДП „Кабиюк“ `127512595`
- `regional_odbh` — 17 ОДБХ: `176986760 176986657 176986664 176987022 176986568
176987111 176986949 176986600 176986803 176986109 176986618 176987034
176987175 176986739 176987264 176986689` _(+ the rows under 176040023 above)_
- `regional_odz` — 8 ОДЗ: `175810250 175812447 175811879 175818051 175811434
175808349 175811402 175809860`

### 3a. The forestry correction — caught by the step-1 review

The first cut excluded **ИА по горите `121486802` „to environment"** on the strength
of a grep. That was backwards, and it is the anti-allowlist trap CLAUDE.md documents:
`environmentReferenceData.ts`'s ADJACENT-BUT-EXCLUDED block names the EIK in order to
**disclaim it to the agriculture universe**, and `sector_stats_environment.data.test.ts`
pins its absence from `ENV_ENTITIES` — so grepping the EIK finds it whether environment
claims it or refuses it, and both read the same. The whole forestry administration —
ИАГ + 16 РДГ + 11 дирекции на **природни** паркове, **28 EIKs / €73.3M** — was
therefore in no sector at all, the exact stranding this audit exists to end,
reproduced inside the file whose header describes it.

They are now roster members, in two universes (`forestry`, `nature_park`).
⚠ A **природен** park is МЗХ; a **национален** park (Рила, Пирин, Централен Балкан)
is МОСВ. The names read alike and only those eleven belong here.

**Deliberately still out: the state forestry ENTERPRISES** — the six чл. 163 ЗГ
държавни предприятия and their териториални поделения (ДГС/ДЛС). МЗХ bodies, but
commercial timber undertakings rather than administration. A Phase 3 tier-3
boundary call, not a curation slip — §5 records it as open.

⚠ **No total is quoted for that family, and the absence is deliberate.** Four
name-based attempts gave four answers, each wrong in a new way — €911.3M (sweeps in
ДП „Пристанищна инфраструктура", ДП РВД, ДП „Радиоактивни отпадъци", the sports
totalizator), €146.1M (undercounts: parent and ТП share a Булстат), €622.8M (pulls
in Лесотехнически университет's whole €23.5M, an **edu** member, plus six ПГ по
горско стопанство), €992.2M (`териториално поделение` is a generic phrase). Two of
those reached committed files before the step-4 gate measured them. The exclusion is
therefore stated as a KIND of body, and the gate asserts MEMBERSHIP over the 66
known roster EIKs rather than a magnitude no name pattern can pin down.

**Verified:** all 66 EIKs bear contracts, **zero** appear in any other sector's
member list, and the roster totals **€597.0M over 3,885 contracts** (vs €131.1M /
565 today — a 4.6× widening).

---

## 4. Implementation steps

### Step 1 — `src/lib/agriReferenceData.ts` + the three-copy rewire

New file modelled on `educationReferenceData.ts`:

- `AGRI_ENTITIES[]` — one row per EIK: `{ eik, name, universe }`, with the
  header documenting §3's two ⚠ traps (the ПГ schools, the shared БАБХ Булстат)
  and the three deliberate absences (Напоителни→water, ИАГ→environment,
  ССА+УХТ→edu), each **verified present** in that pack, not assumed —
  `AGRI_EXTERNAL_BODIES` as the machine-readable form.
- `AGRI_SECTOR_EIKS` — derived, the single source of truth.
- `AGRI_UNIVERSE_LABEL` — bg/en labels for the awarders-tile `group` chips.
- `agriFootnote(bg)` — derived counts (never hand-typed numerals), stating the
  роster spans one ПРБ (МЗХ) and that the headline is CAP payout, not this.

Rewire, importing the export rather than re-hardcoding:

- `sectorDashboards.agri.members` → `AGRI_ENTITIES.map(...)` with `group`,
  `leadEik` stays `AGRI_PAYER_EIK`, add `footnote`.
- `SECTOR_BROWSE_PACKS.agri.eiks` → `AGRI_SECTOR_EIKS`.
- `AGRI_PAYER_EIK` stays in `src/data/agri/constants.ts` (it is the ДФЗ payer
  identity used by `/company`, `/subsidies` and the ingest, not a sector roster).

`SECTOR_EIKS` in `gen_procurement/sector_stats.ts` is **NOT** touched — agri is
payout-basis and must stay out of it, or the hub headline changes basis.

The members list crosses `MEMBER_SEARCH_MIN`, so `SectorMembersSearch` turns on
for free — which is the point of that auto-enable.

### Step 2 — `AgriPack`

`src/screens/components/procurement/agri/AgriPack.tsx`, registered as
`[AGRI_PAYER_EIK]: AgriPack` in `PACKS`. Structure mirrors `NoiPack`: a payout
hero, then `PackSection`s. **Zero new ingest, zero new API routes** — every
figure comes from `useAgriHubStats` (`/api/db/agri-hub-stats`, migration 162) and
`useAgriOverview` (`agri_payloads`), both already shipped and serving `/subsidies`.

Scope: the pack resolves `?pscope` through `agriScopeToKey` and therefore sets
**`packOwnsScope: true`** (the CAP financial years are 2015-17 + 2021-25, not the
procurement window) and renders `PackScopeControl` itself. `AgriScopeGate` already
exists for the „няма данни за 2019“ state — reuse it, do not re-implement it.

Tiles, each with the basis in its caption:

| tile                     | figures (2025)                                                                          | the sentence                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Payout hero**          | €1.59bn · 230,214 payment rows · 281 schemes · 28 oblasti                               | the number the hub tile promised                                                                                                                                                                                                 |
| **Фирми срещу хора**     | €804.2M / 8,396 entities **vs** €782.8M / 24,727 individuals                            | 49.3% of CAP money reaches recipients with **no EIK**                                                                                                                                                                            |
| **Непроследими**         | €196.4M company-shaped (`noEikCompanyShapedEurFloor` — a **FLOOR**, say so)             | → `/subsidies/untraceable`                                                                                                                                                                                                       |
| **Концентрация**         | top-1000 = 56.3% of entity money, top-100 = 14.8%; Lorenz from `overview.concentration` | 0.1% of recipients take over half. Basis is `legal-entities` — name it                                                                                                                                                           |
| **Топ схема**            | „I.А.1-1 основно подпомагане на доходите“ €382.7M = 24%                                 | → `/subsidies/schemes`                                                                                                                                                                                                           |
| **По области**           | София (столица) €127.9M / 8.06%                                                         | ⚠ **reuse the declared basis verbatim from `SubsidiesPlacesScreen.tsx:76`** — the oblast is the recipient's REGISTERED SEAT, not where the land is. Rendering this without that sentence is the „right number, false claim“ trap |
| **Политически свързани** | 239 EIKs / 260 people / €21.5M in-year                                                  | EIK-keyed (`agri_political_link`), never a name match. `politicalBasisBuilt === false` → render „not built“, never 0                                                                                                             |
| **Двоен корпус**         | 373 farms also hold public contracts · 2,278 also hold ИСУН projects                    | → `/subsidies/cross-programme`                                                                                                                                                                                                   |
| **ДФЗ като възложител**  | €131.1M / 565 contracts                                                                 | the CURRENT page content, demoted to one tile and correctly labelled as the agency's own running costs — **not** the sector's money                                                                                              |

Set `packRendersOwnContractsLink: true` and render the buy-side link into
`/procurement/contracts?sector=agri` (now 66 EIKs) plus a prominent
„Виж всички получатели →“ into `/subsidies`, which closes F2.

`useAgriHubStats` returns `null` (not `undefined`) for „no figures“ — a tile must
render its named empty state, never a zero. That distinction is in the hook's
header; honour it.

### Step 3 — the three-basis budget strip

One tile naming all three side by side, so no reader can sum them:

- **CAP изплатено** €1.59bn (2025) — EU money passing THROUGH ДФЗ, `agri_payloads`
- **Бюджет на ДФЗ (ПРБ)** €300.9M (2026) — `data/budget/ministries/admin-darzhaven-fond-zemedelie.json`
- **Бюджет на МЗХ (ПРБ)** €200.3M (2026) — `admin-ministerstvo-na-zemedelieto-i-hranite.json`,
  with its four-programme split (земеделие и селски райони €114.4M · гори и дивеч
  €18.2M · администрация €11.7M · рибарство €3.7M)

Both files are committed, already parsed by the budget pipeline, and **read by no
sector page today**. The caption must say these are three DIFFERENT questions —
what the CAP pays out, what running the paying agency costs, what running the
ministry costs — because a strip of three euro figures otherwise invites addition.

### Step 4 — regression tests (`scripts/db/tests/sector_stats.data.test.ts`)

Extend the existing file. Bands and inequalities only — the corpus reloads
fortnightly.

- **headline band**: `stats.all.agri.basis === "payout"`, `value` within ±15% of
  `agri_payloads` key `2025`'s `headline.totalEur`, and `year === 2025`-or-later.
- **three-copy lockstep**: `AGRI_SECTOR_EIKS`, `SECTOR_DASHBOARDS.agri.members
.map(m=>m.eik)` and `SECTOR_BROWSE_PACKS.agri.eiks` are the SAME SET. This is
  the drift tripwire the sector did not need at one EIK and does at 38.
- **agri is NOT in `SECTOR_EIKS`** — an explicit assert, because adding it there
  silently flips the hub headline from payout to procurement.
- **anti-allowlist**: no „Професионална гимназия“ EIK is in `AGRI_ENTITIES`
  (pin `000847248`, `000183295`, `000014128`); Напоителни `831160078`,
  ИАГ `121486802`, ССА `000662107` and УХТ `000455440` are absent AND still
  present in water/environment/edu respectively (the education-audit pattern —
  assert both halves, or an EIK can fall into no sector at all).
- **signature members present with money**: `176040023` (БАБХ) and `831909905`
  (МЗХ) each `> €50M` all-scope.
- **roster floor**: the 66-EIK sum `> €450M` all-scope (today €597.0M) — catches
  an over-trim; ceiling `< €800M` — catches re-leakage of Напоителни/ССА, and low enough that the forestry-enterprise family (€622.8M) cannot be folded in unnoticed.
- **`src/lib/agriReferenceData.test.ts`** (no Postgres) carries the anti-allowlist in
  BOTH directions — every `AGRI_EXTERNAL_BODIES` row is really claimed by the sector
  it names, and no roster EIK is claimed by another sector. Mutation-checked against
  the ИАГ bug above.
- the existing cross-sector „no EIK is a member of two sector dashboards“ gate
  (already in this file) covers the new roster automatically — verify it does.

### Step 5 — regenerate, gate, verify

- `npm run db:gen-sector-stats`, diff old vs new `sector_stats.json` — **agri must
  NOT move** (payout basis is untouched by a roster change). Any movement means
  Step 1 leaked into `SECTOR_EIKS`.
- `npx tsc -b`, `npm run lint`, the touched vitest suites,
  `npx vitest run scripts/db/tests/sector_stats.data.test.ts`.
- Live-check `/governance/sectors` (tile unchanged at €1.6bn) and `/sector/agri`:
  read the page as a sentence — does it now answer „субсидии · бенефициенти ·
  САР“? Check the awarders tile shows 38 chips grouped by universe, and that the
  oblast tile carries the registered-seat caveat.
- `sector_stats.json` is bucket-served, not Firebase-hosted. If it moved at all,
  deploy with `npm run bucket:sync:paths -- procurement/derived/sector_stats.json`.
  Code changes need `npm run deploy`. No SQL, no `deploy:db`, no `061` re-apply —
  nothing in this plan touches a migration or a function.

---

## 5. Open — not decided by this audit

**Do the state forestry ENTERPRISES belong in „Земеделие"?** The six чл. 163 ЗГ
държавни предприятия and their териториални поделения. They are МЗХ bodies, so the
„one budget principal" rule that built this roster would admit them; but they are
commercial timber undertakings rather than administration, and on any of the four
measurements attempted they are comparable to or larger than the entire rest of the
roster — enough to make logging the sector's dominant activity by contract count.
Excluded for now on KIND. ⚠ Anyone re-taking this decision must first settle how the
family is delimited: see §3a, and do it by EIK, not by name.
