# Туризъм (МТ) sector audit — v1

`/audit-sectors sector/tourism`, 2026-08-20. Local Postgres `electionsbg-pg:5433`,
corpus `contracts` through 2026-05-13.

The buyer side came back clean at every scope and on both EIK sweeps. The findings
are all on the **beneficiary** side and in the **copy** — the shape the energy
audit predicted: a headline exact to the euro, a leaderboard that means something
other than what it appears to mean.

## Phase 1 — the hub headline reconciles exactly, 30/30 scopes

`basis: 'budget'`, node `admin-ministerstvo-na-turizma`
(`data/budget/ministries/`, EIK 176789478 — matches `TOURISM_MINISTRY_EIK`).

| scope | emitted | node `years[].expenditure.amountEur` |
|---|---|---|
| `all`, every `ns:*` | €14,462,400 (year 2026) | 2026 = 14,462,400 ✓ |
| `y:2018 … y:2026` | 9,764,652 · 9,894,930 · 10,046,119 · 12,809,395 · 13,888,324 · 14,446,296 · 14,491,188 · 14,734,461 · 14,462,400 | exact, each to its own year ✓ |
| `y:2011 … y:2017` | `unavailable: true` | the node's series starts FY2018 ✓ |

`formatSectorMetric` renders `—` and `sectorMetricCaption` renders „няма данни за
`<year>`" on the seven `unavailable` scopes, so no 2026 figure is ever captioned
2011. Same behaviour as environment.

## Phase 2 — EIK-set and tiles: no defect

- **Single member** `176789478` — 335 contracts, **€28,780,437**, 2014-12-30 →
  2026-05-13. The start date is right: МТ was split out in Nov 2014.
- **Anti-allowlist holds against the corpus.** TWO patterns, not one —
  „туристически" contains *турис* and not *туриз*, so the БТС row below is
  unreachable from the туриз sweep alone. `%туриз%` returns 35 awarders: МТ, 32
  `Професионална гимназия по туризъм` vocational schools (principal МОН /
  municipal, €0.04–1.5M each), МИЕ `130169256` (corpus name „Министерство на
  икономиката и енергетиката /МИЕ/", carrying МИЕТ as its старо наименование —
  grep for МИЕ; €21,279,264 over 2011-01-06→2015-07-13, mixed
  economy/energy/tourism mandate) and „Обединено счетоводство — Община Айтос"
  `000056764` (€142,119, whose own name lists a municipal „…спорт и туризъм"
  directorate). `%турис%` returns one more, Сдружение „Български туристически
  съюз" `000690918` (€310,571, an NGO). None has leaked in.
- **No missing sibling.** Swept the resort / spa / holiday families:
  ИА „Военни клубове и военно-почивно дело" €93.1M (принципал МО),
  ПРО ЕАД €6.2M (МТСП/НОИ), Ученически отдих и спорт ЕАД €5.5M (МОН),
  Балнеологичен център „Камена" €1.6M (municipal/health). None answers to the
  Minister of Tourism, and all four are now in the file's durable anti-allowlist —
  the artifact a future editor greps — rather than only in this plan. ДАТ (the
  pre-2009 Държавна агенция по туризъм) is absent from the corpus entirely, so
  there is no predecessor gap to close beyond the documented МИЕ decision.
- **The copies are in lockstep**, all deriving from the export:
  `TOURISM_SECTOR_EIKS` = `SECTOR_DASHBOARDS.tourism.members` =
  `SECTOR_BROWSE_PACKS.tourism.eiks` = `["176789478"]`. The generator's
  `SECTOR_EIKS` has no `tourism` key — correct, the basis is budget.
- **Hygiene.** 0 self-deals, 0 NULL amounts, 9 consortium rows all correctly
  carrier-holds-value / member-holds-€0, no EIK↔name fragmentation, 7 rows with no
  contractor EIK (natural persons, €27,734 = 0.1%).
- **`visitors.json` internals reconcile.** `summerShareForeign` 0.789569 = Jun–Sep
  foreign / total foreign exactly; `winterShareForeign` 0.099915 = Dec–Mar exactly;
  `peakMonth` 8 = the actual argmax. The source-markets tile divides by the FULL
  foreign total (14,751,606), not the top-10 sum (10,706,490), so its shares are
  right, and each tile names its own year (seasonality 2025, markets 2024).

## F1 — the leaderboard renders municipalities as market vendors, and one is already badged a state body elsewhere

On the page's **default** scope (`ns:2026_04_19`) МТ's window is 5 contracts /
€312,500, and **4 rows / €262,500 = 84%** are municipal bodies:

| contractor | € | share | what it is |
|---|---|---|---|
| Столична община `000696327` | 75,000 | 24.0% | municipality (6,513 contracts as an awarder) |
| Община Велико Търново `000133634` | 62,500 | 20.0% | municipality (1,331 as an awarder) |
| Общинска фондация „Пловдив 2019" `176182033` | 62,500 | 20.0% | founded by and reporting to Община Пловдив under чл.19(8) of its учредителен акт (`council_resolution` `PDV01-2026-prot10-r229`; ГФО accepted by `PDV01-2026-prot9-r194`); 16 contracts as an awarder |
| Фондация „Бургас - 2032" `208188531` | 62,500 | 20.0% | founded by Община Бургас (`council_resolution` `BGS01-2025-prot19-r16564`), which accepts its annual report + ГФО (`BGS01-2026-prot39-r18522`) |
| Фест продакшън ЕООД `204663621` | 50,000 | 16.0% | private |

The lower three tie exactly at €62,500 and are ordered by `eik` ASC, so ranks 2–4
are a tiebreak position rather than a property of the body — which is why step 4
pins a share ceiling and never a rank.

**Five separate** „Договаряне без предварително обявление" procedures — УНП
`05024-2026-0005/0006/0008/0009/0011`, five distinct ocid, published
2026-04-21…2026-04-30 — all CPV 79340000, every row single-bid, each citing
`tenders.legal_basis` = „Чл. 79, ал. 1, т.3, б.в от ЗОП" (joined on УНП;
`contracts.procurement_method_rationale` is empty on all five, and the corpus
spelling carries no quote marks around „в"). МТ paying the host cities to stage
the international cycling tour. „One procedure split across four municipalities"
and „five separate negotiated awards" are different procurement structures, so
the distinction is not pedantic. Across all 30 scopes **БНТ `000672350`** is
displayed at four and is rank 2 at two of them (`y:2024`, `ns:2023_04_02`);
€1,073,528 is its all-scope and `y:2024` figure.

`SectorTopContractorsTile` already carries the mechanism — a `stateBodyEiks`
prop, the „държавно" chip whose tooltip reads „държавна или общинска структура",
the dimmed bar, and a footnote saying the money „остават вътре в държавата".
**`SectorDashboardScreen` never passes it**, so no generic `/sector/:id` gets it.
Three call sites pass such a list today, but only ONE of them to this component:
`AdministrationScreen.tsx:1035` → `SectorTopContractorsTile`, while
`MvrPack.tsx:363` and `SocialPack.tsx:351` → **`VikContractorHhiTile`**, a
different component. So tourism gets the chip, the dimmed bar and the footnote and
**no HHI / `internalShare`** — those live in the ВиК tile and `/sector/tourism`
renders no HHI tile. `securityReferenceData.ts`'s claim that such a list "ALSO
drives the market-only HHI line" is true for МВР and will not be true here.

⚠ **БНТ is already in `SOCIAL_STATE_BODY_CONTRACTORS`.** So today it is badged
„държавно" at rank N on `/sector/social` and unbadged at rank 2 on
`/sector/tourism` — precisely the state `securityReferenceData.ts` calls "a worse
defect than an unused entry" where it carries Български пощи below its own bar.
That is what makes this an application of an existing editorial line rather than a
new one: nothing is excluded, no € moves, and not doing it is itself the
inconsistency.

**Fix (tier 2 + tier 1).** `SectorDashboardConfig.stateBodyContractors`, passed
through to the tile, plus a curated `TOURISM_STATE_BODY_CONTRACTORS`. Curated by
EIK and never derived from "is this EIK an awarder somewhere" — on this corpus that
probe answers ЕВН България Електроснабдяване and Електрохолд Продажби, both
private regulated utilities, exactly the 44%-wrong over-capture the water audit
measured.

Bar for membership, same as the security list: **every public body that reaches a
displayed rank (top-8) at some scope**, plus anything already badged on a sibling
page.

Deliberately OUT: the sports federations (волейбол, джудо, хандбал), the guide
associations (Асоциация/Съюз на екскурзоводите, „Планини и хора"), and
Германо-българската камара — all `ngo_assoc` in `tr_companies`, subsidised but not
government. Интер експо център `121122275` is an `EOOD` company. България ЕР is
private.

Residual, not fixed: the „Топ изпълнител" KPI card has no chip slot, so on the
current window it reads „€75 хил. · Столична Община" unlabelled. The labelled tile
and its footnote sit directly beneath it.

## F2 — the spend↔nights tile's legend names half of what its bars plot

`TourismSpendVsNightsTile` is titled „Реклама и чужди нощувки" / "Marketing spend
vs foreign nights" and legends its bars „разход за реклама (€)" / "marketing spend
(€)", while summing **every** МТ contract in the year. By the page's own CPV
classifier (`tourismCategories.ts`), all-scope:

| bucket | € | share |
|---|---|---|
| Реклама и медиа | 14,686,799 | **51.0%** |
| Продукция и материали | 4,649,907 | 16.2% |
| Оперативни и други | 3,383,279 | 11.8% |
| Събития и промоция | 2,480,683 | 8.6% |
| Дигитал и ИТ | 2,475,289 | 8.6% |
| Проучвания и консултации | 1,104,478 | 3.8% |

So the bars are ~2× the quantity the legend names — the remainder is fuel,
electricity, cleaning, vehicles, translation and IT. The tile's own comment says
"contracts only, to match the headline", so summing everything is the INTENT and
the label is the drift. **Fix the sentence, not the filter**: narrowing to
advertising CPVs would break basis-agreement with the KPI row directly above it
(Failure mode O), which is a worse defect than a loose word.

## F3 — the reference data's header contradicts the shipped basis

`src/lib/tourismReferenceData.ts` (written 2026-07-15, `6143b9e05b`) states
„procurement € is the honest headline metric (unlike health/agri whose real money
is a payout)". The next day `e27eb2496d` put tourism under `BUDGET_SECTOR_NODE`,
and it has been budget at every scope ever since. A future roster editor reads that
header and concludes that widening the allowlist moves the tile — it cannot, by
construction. `educationReferenceData.ts` carries the corrected form of exactly
this note. Also „~€27M" is now €28.78M.

## Reported, no action

- **L (statutory sole-source).** The current window is 100% single-bid and every
  row cites Чл. 79, ал. 1, т. 3, б. „в". Nothing on the page claims a competition
  failure from it: the category tile self-suppresses at one category
  (`cats.length < 2`) and the generic KPI row carries no single-bid figure. The
  all-scope single-bid share is **59.6%** — 168 of the **282** contracts that
  carry a tenderer count, since `awarderModel.ts`'s `singleBidShare` is
  `singleBidN / bidKnownN` and 53 rows carry no count. 168/335 = 50.1% is the
  share of ALL rows and is not what any surface renders; step 4 asserts the
  definition rather than either literal. A finding about МТ, not a defect.
- **J (concentration).** 24% of a €312,500 window in one row. Fixed by F1's chip +
  footnote rather than by touching the number; the row is real and stays.
- **M/N.** Consortium rollup and EIK-vs-name keying are both correct here.

## Steps

1. `TOURISM_STATE_BODY_CONTRACTORS` in `src/lib/tourismReferenceData.ts`, and
   rewrite the header prose for the budget basis (F3, same file). Plus
   `tourismReferenceData.test.ts` — the network-free invariants (well-formed
   deduped EIKs, disjoint from the roster, the two below-bar entries named, the
   three-copy lockstep, `members` covering the roster) and one arm with reach
   beyond this sector: the four `*_STATE_BODY_CONTRACTORS` lists share four EIKs
   with no registry binding them, so this asserts they agree on every shared one.
   A shared `stateBodyOwnership.ts` registry is the structural fix and is **open
   work**, deliberately out of this audit's scope.
2. `SectorDashboardConfig.stateBodyContractors` → `SectorDashboardScreen` →
   `SectorTopContractorsTile`, and wire `tourism`. Generic plumbing; only tourism
   populated — every other generic sector needs its own audit before it gets a list.
3. F2: relabel the spend↔nights title/legend/caption to the quantity actually
   plotted, in both languages.
4. `scripts/db/tests/sector_stats_tourism.data.test.ts` — basis+value exact at all
   30 scopes incl. the `unavailable` flag; anti-allowlist (МИЕ, the vocational
   schools, the four sibling holiday operators) with a non-vacuity check; every
   curated state body still a МТ contractor and still outside the roster; the four
   host-city rows still classified; a top-contractor share CEILING (never a rank
   or an absolute € — ranks 2–4 are a tie); the single-bid share asserted through
   `singleBidN / bidKnownN` rather than a literal; and `Σ(CPV buckets) == headline`
   (to a documented €2 per-CPV rounding tolerance) so F2's basis-agreement cannot
   silently break. The three-copy lockstep is already held, network-free, by
   step 1's unit test.

## Open work this audit deliberately did not do

- **A shared `stateBodyOwnership.ts` registry.** Four `*_STATE_BODY_CONTRACTORS`
  lists now hold 20 entries over 16 EIKs, four of them in more than one list, and
  their agreement on a shared EIK is maintained by hand. `tourismReferenceData.test.ts`
  asserts the agreement, which is the cheap half; making it structural means moving
  the ownership label into one map that every sector indexes into.
- **`stateBodyContractors` on the other eligible sectors.** Only three of fourteen
  reach the generic KPI/leaderboard branch at all (tourism, energy, and edu via
  `packIsThematic`), and `sectorDashboards.test.ts` now fails if a list is set on a
  pack-backed one. Energy and edu need their own beneficiary passes first: an
  INCOMPLETE list badges some state transfers and leaves the rest reading as market
  awards, which is a claim rather than an omission.
- **A shared `scripts/db/tests/lib/sectorStats.ts` harness.** The seven
  `sector_stats_*.data.test.ts` files share ~120 lines of scaffolding and a
  near-identical hub-headline reconcile body. That duplication is where this file's
  own `unavailableSeen` floor started out fragile (a hardcoded 5 against a measured
  7 that legitimately shrinks) — a parameterised helper would have made it one
  documented meaning instead of seven copies.
- **CPV 98000000.** Six contracts, €693,802, titled „Заплащане на наемната цена за
  атрактивни рекламни площи" — rented advertising space landing in the `other` sink
  because CPV 98 is unmapped, a fifth of that bucket. Mapping it needs someone to
  read all six rows; until then it is recorded in `tourismCategories.ts`'s header as
  one of the two reasons every surface quoting the advertising share says „по CPV".
