# Социално подпомагане (МТСП/АСП) sector audit — v1

Audit date **2026-08-15**, via `/audit-sectors sector/social`. Corpus: local
Postgres, `contracts` to 2026-08-13.

## What the audit found CLEAN (do not re-litigate)

- **Headline reconciles exactly at every scope.** `basis='budget'`, source
  `data/budget/ministries/admin-ministerstvo-na-truda-i-sotsialnata-politika.json`.
  `all`/`ns:2026_04_19` → €2,112,455,500 (FY2026); `y:2025` → €1,796,645,056;
  `y:2024` → €1,463,430,360 — each the node's `years[].expenditure.amountEur` to
  the euro. `y:2011`–`y:2017` correctly carry `unavailable: true` (the node's
  series starts FY2018), same shape as environment.
- **Σ(programs) == node expenditure** for all nine fiscal years (max drift €1,
  rounding). `SocialBudgetBridgeTile`'s stacked columns therefore reconcile to
  the hub headline — Failure mode I clean.
- **The EIK-set copies are in lockstep.** Social has **three**, not the audit
  skill's four: `SOCIAL_ENTITIES` → `SECTOR_DASHBOARDS.social.members`, and
  `SOCIAL_SECTOR_EIKS` → `SECTOR_BROWSE_PACKS.social.eiks`. The fourth copy —
  the generator's `SECTOR_EIKS` — correctly does not exist here, because the hub
  headline is budget-basis and no EIK feeds it.
- **No wrong-EIK leakage.** All members real and correctly attributed. The
  МВР ДУССД `129010157` trap (€309M, and the top hit of a „социалн" name sweep)
  is correctly excluded — the reference file's name-regex warning is accurate.
- **Model sub-aggregates reconcile.** `byUnit`/`byCpv`/`byYear` each sum to
  €321,741,230, matching a raw `sum(amount_eur)` over the six EIKs. Category
  split sums to 100%.
- **HHI denominator guard is correct** — Σ suppliers-with-EIK (€321,537,774),
  not the headline (Failure mode F clean). 16 consortium rows, no double-count
  evidence (Σ suppliers < total, never >).

## Findings and their fixes

Operator decisions taken 2026-08-15 are recorded inline.

### Step 1 — EIK set: add НИПА and ДАЗД

`src/lib/socialReferenceData.ts`.

- **НИПА — Национален институт за помирение и арбитраж, EIK `131083803`**
  (€6,647, 2 contracts). Кодекс на труда чл. 4а makes it a юридическо лице към
  министъра на труда и социалната политика and a второстепенен разпоредител с
  бюджет — exactly the small-agency universe АХУ/АКСУ already occupy. A
  Failure-mode-D miss.
- **ДАЗД — Държавна агенция за закрила на детето, EIK `130453541`**
  (€3,526,921, 67 contracts). **Operator decision, against the audit's own
  recommendation**: ЗЗД чл. 17 makes ДАЗД a ПРБ to the **Министерски съвет**,
  not to МТСП, so it is the one member of this set whose budget is NOT inside
  the МТСП node the hub headline reads. Included as an editorial call about what
  „социално подпомагане" covers for a reader. **This must be written into the
  file's header**, because the „every member is an МТСП budget unit" rule is what
  the rest of the allowlist is curated by, and a later sweep that finds ДАЗД
  without the note will read it as leakage and remove it.

Each gets its own `SocialUniverse` (`mediation`, `child`) with BG/EN labels and a
place in `SOCIAL_UNIVERSES`. Group total moves €321,741,230 → €325,274,798; the
hub headline does **not** move (budget basis).

Derive `SocialPack`'s `PackFootnote unitCount={6}` and its `detail` string from
`SOCIAL_ENTITIES` rather than hardcoding, and refresh the "6 social budget units"
comments in `useSocial.tsx` / `socialReferenceData.ts`.

### Step 2 — CPV classifier: relabel div 79, fold div 64 into ИТ

`src/lib/socialAttributes.ts` + `SocialCategoryTile`'s colour map.

„Консултантски и проекти" showed €78.5M / **24.4%** — a reader's sentence is „a
quarter of the social agencies' procurement goes to consultants", and it is not
true. CPV division 79 is *business services incl. printing and security*:

| CPV group | € | what it is |
|---|---|---|
| 7942 | 33.01M | the ФМФИБ financing agreement (see Step 4) |
| 7971 | 10.07M | невъоръжена физическа охрана |
| 7960 | 6.01M | набиране на персонал |
| 7982 | 5.96M | управляеми услуги за печат |
| 7995 | 5.26M | организиране на събития |
| 7941/7940/7931 | ~7.1M | genuine business consultancy |

Social is the **only** sector naming div 79 consultancy — `environmentAttributes`
calls it „услуги", `regionalAttributes` „Административни и стопански услуги".

- Rename the category id `consulting` → `admin_services`, label
  „Административни и стопански услуги" / "Administrative & business services"
  (adopting regional's wording — one definition, not a new one).
- **Operator decision:** also fold **CPV division 64** (telecom SERVICES, €21.4M,
  the БТК/Виваком line) into `it_systems`, where telecom EQUIPMENT (div 32)
  already sits. Today БТК — the group's #3 supplier at €20.4M — leads the
  „Друго" sink while its own equipment contracts sit in „ИТ и системи".

Keep `CATEGORY_CPV_DIVS` mirroring `categoryOfCpv` exactly (it drives the
`/procurement/contracts?cpv=` deep-links and must reproduce the split).

Expected after: `it_systems` €39.5M → ~€60.9M (12% → ~19%), `other` €87.2M →
~€65.8M (27% → ~20%).

### Step 3 — the „Друго" footnote states something false

`SocialCategoryTile` renders „„Друго" са предимно договори без CPV код (27% от
стойността)". Measured: the bucket is €87.2M of which **€11.76M (13.5%)** has no
CPV. The remainder is CPV'd but in unmapped divisions (33 medical €13.2M, 09
energy/fuel €11.5M, 80 training €5.3M, 90 cleaning €4.1M, 34 vehicles €4.0M, 50
repair €3.8M — plus div 64 until Step 2 moves it).

Adopt `EnvironmentCategoryTile`'s wording, which is true without needing a
number the tile is not given: „N% от стойността е класифицирана по функция;
останалото е в „Друго" (договори без CPV код или извън тези категории)."

⚠ `DefenseCategoryTile` and `KulturaCategoryTile` carry the identical false
sentence. Out of this audit's scope — flagged for the user, not fixed here.

### Step 4 — label state-body contractors in the leaderboard

The sector's #1 „изпълнител" is **„Фонд мениджър на финансови инструменти в
България" ЕАД (`203740812`)** — 100% state-owned, principal the Министерски
съвет — at **€33,000,000 / 10.3% of the whole corpus**, from ONE contract
(2026-03-26, CPV 79420000): *„Споразумение за финансиране между Управляващия
орган на Програма „Развитие на човешките ресурси" 2021-2027 и ФМФИБ ЕАД"*. It is
a financial-instrument allocation to a state company, not a service bought on a
market. It also accounts for 70% of the €46.9M the peak-year chip calls 2026's
peak, and for 86.7% of the €38.1M (11.84%) a `company_politicians` join would
label „MP/PEP-linked".

**Operator decision: label it, keep it counted** — the energy-audit precedent
(МВР ← АЕЦ Козлодуй). Do NOT filter the row out.

`VikContractorHhiTile` already has exactly this mechanism for IN-GROUP
contractors (`memberEiks` → „в групата" chip + an explanatory note + a muted
bar). ФМФИБ is an out-of-group state body, so:

- add an optional `stateBodyEiks?: readonly string[]` prop mirroring
  `memberEiks` — „държавно" chip, its own note, row still counted in HHI/CR-4;
- add `SOCIAL_STATE_BODY_CONTRACTORS` to `socialReferenceData.ts`, curated by
  EIK with a one-line reason each. **The `contractor_eik ∈ awarder_eik` probe
  over-captures and must not be used raw** — ЗОП's utilities regime makes ЕВН,
  Овергаз, Софийска вода and the private Топлофикации contracting authorities
  too. Verified public for this sector: ФМФИБ `203740812`, Български пощи
  `121396123` (€3.46M), Информационно обслужване `831641791` (€1.14M),
  Топлофикация София `831609046` (€1.28M), БНТ `000672350` (€0.32M);
- pass BOTH `memberEiks={SOCIAL_SECTOR_EIKS}` and the new prop from `SocialPack`.

The tile is shared by water/transport/security/defense/environment; the new prop
is optional, so their behaviour is unchanged.

### Step 5 — two adjacent tiles contradict each other

`SocialEuPeerTile` renders „Разходът не е най-ниският; **проблемът е ефектът
върху бедността** (виж по-горе)", directly under `SocialValueForMoneyTile`'s
„За похарченото резултатът е около очаквания — **лостът е размерът на разхода, не
ефективността**."

The data backs the second: over the tile's own 5-point OLS fit, BG's residual is
**+1.74pp ABOVE** the line (fit 25.2%, actual 26.9%). RO is the one below
(−2.23). The EU-peer sentence is a leftover of the pre-correction framing that
`SocialValueForMoneyTile`'s header comment already records as wrong.

Fix the rendered sentence, and the same stale claim in the header comments of
`SocialPovertyImpactTile` („near-EU-average share … buys LESS poverty reduction
per euro" — BG is 14.4% vs the EU's 19.6%, which is not near-average) and
`SocialEuPeerTile`.

### Step 6 — value-for-money source line dates two series to one year

Footnote renders `Eurostat gov_10a_exp (GF10) · ilc_li10 / ilc_li02 (2024)`,
where 2024 is the COFOG year. The y-axis is `poverty.latest` = **2025**. The
sibling `SocialPovertyImpactTile` correctly renders its own `b.year`. Name both
years (Failure mode G).

### Step 7 — hero hardcodes „€15 млрд." beside a computed €15,1 млрд.

`SocialHeroTile`'s sliver caption: „и под 0,2% от **€15 млрд.** социална защита"
/ "under 0.2% of the **€15bn** function", while `whole` (COFOG GF10) is computed
and rendered directly above. Consistent today (0.133% of €15.09bn); the next
COFOG vintage breaks the pairing silently. Interpolate `whole` and derive the
share instead of asserting a threshold.

### Step 8 — a лв. figure on a EUR site

`SocialHeatingAidTile` renders „по **121,34 лв.** на месец" beside „€110 млн." in
the same tile, for the 2025/2026 season. Convert via the `eurRate` the hook
already carries (€62.04/mo) — `useSocialBenefits` computes `amountEur` from
`amountBgn` for exactly this reason and `perHouseholdMonthlyBgn` was missed.

### Step 9 — regression tests

New `scripts/db/tests/sector_stats_social.data.test.ts`, modelled on
`sector_stats_environment.data.test.ts` (same decoupled shape: a budget headline
that a wrong EIK cannot move, so the headline and the EIK-set need separate
gates). Bands and inequalities only — never an exact €, a rank, or a
contractor's absolute value.

- **BASIS** — `basis === 'budget'` unconditionally, all 30 scopes; `value`/`year`/
  `unavailable` reconcile EXACTLY against the МТСП node (the environment
  precedent: a €-band on one scope misses a wrong year or a lost flag).
- **EIK-SET** — lockstep across the three copies; every member is a real awarder;
  an ANTI-allowlist pinning МВР ДУССД `129010157` and НОИ `121082521` OUT (НОИ is
  the redundancy fix — the slot used to duplicate `pension`); НИПА `131083803`
  and ДАЗД `130453541` present.
- **Σ(programs) == node expenditure** per fiscal year, within a rounding
  tolerance — this is what makes the bridge tile reconcile to the hub headline.
- **BENEFICIARY** — a top-contractor share CEILING for a fixed scope (ФМФИБ is
  10.3% of `all` today; a rollup change crediting a consortium's full value to
  every member shows up as a share long before a total moves), and
  `SOCIAL_STATE_BODY_CONTRACTORS ⊇ {203740812}` pinned by EIK so a later
  „clean up the leaderboard" change cannot turn a state transfer back into an
  apparent private vendor.
- **CLASSIFIER** — `CATEGORY_CPV_DIVS` mirrors `categoryOfCpv` for every division
  it names (the deep-link contract), and div 79 is NOT in a category whose label
  contains „консултант"/"consultan" (the Step-2 regression tripwire).

### Not fixed here (reported, no action)

- **Self-dealing register artifact.** Contract `b7728f7357ce` (2020-10-15) has
  `awarder_eik = contractor_eik = 121015056` (АСП) while `contractor_name` is
  „ЗАД БУЛСТРАД ВИЕНА ИНШУРЪНС ГРУП" АД, whose real EIK is `000694286` — the
  buyer landed in the supplier field, €35,790. It is the **only** row the
  intra-group probe returns, so this sector's intra-group circulation is 100%
  artifact and €0 real. Cross-sector (29 rows / €3.87M corpus-wide); fix at the
  ingest/parser if anywhere, never per-sector.
- **The hero mixes two accounting bases in one bar.** COFOG GF10 is general
  government S13 ESA OUTTURN (€15.09bn, 2024); the highlighted МТСП slice is the
  state budget law's ПРИЕТ figure (€1.463bn). The node's own `execution` for 2024
  is €1.025bn executed against €2.032bn amended — so the slice is ~43% larger
  than the outturn-based whole would support, and reads 9.7% where an
  outturn-on-outturn bar would read 6.8%. Changing it changes what the tile
  claims and would put social out of step with every other budget-basis sector,
  so it is a tier-3 call rather than a bug.
- **The remainder segment is labelled „Пенсии и друга соц. защита (НОИ)"** and
  links to `/pensions`. It is €13.63bn, of which ДОО pensions are €11.08bn (81%);
  the rest is municipal social services and other non-НОИ spend. The „и друга"
  hedge carries it, but the „(НОИ)" attribution is looser than the number.
- **The peak-year chip calls 2026 the peak on a partial year** (€46.9M to
  2026-08-13, of which €33.0M is the single ФМФИБ row). `buildPackInsights` is
  shared by every pack; a partial-year guard belongs there, not here.
- **`DefenseCategoryTile` / `KulturaCategoryTile`** carry the same false „Друго"
  sentence as Step 3.
