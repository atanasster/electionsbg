// One-off: check the Draft Budgetary Plan 2027 (ПБП-2027, МФ, 15.10.2026)
// against the budget-policy-simulator engine and the plan's own tables.
// Source PDF: EC DBP 2027 page, 2027_dbp_bg_bg.pdf (Tables 1а, 3, 4, 5, 6).
//
// Usage: npx tsx scripts/budget/__scenario_dbp_2027.ts

import {
  computeVatRevenue,
  VAT_POLICY_CURRENT,
  scorePitFlat,
  scoreCorporate,
  scoreModCap,
  scoreModCapBands,
  scoreCollectionRealism,
  scoreAdminCut,
  scoreCapitalChange,
  scorePensionIndexation,
  scoreExciseRate,
  cigaretteExciseRateEur,
  type VatBaseSlice,
  type EarningsBand,
} from "../../src/lib/bgTaxPolicy";
import { capMonths } from "../../src/lib/bgTax";
import {
  vatBehavioralOffset,
  pitFlatBehavioralOffset,
  corpBehavioralOffset,
  modBehavioralOffset,
  exciseBehavioralOffset,
  VAT_GAP_RESPONSE,
  ETI_EMPLOYMENT,
  CIT_BASE_SEMI_ELAST_PCT_PP,
  SSC_CAP_AVOIDANCE,
  EXCISE_TOBACCO_RESPONSE,
} from "../../src/lib/bgBehavioral";
import { projectFiscalPath } from "../../src/lib/bgFiscalProjection";
import baseline from "../../data/budget/derived/policy_baseline.json";

const M = (n: number) => `€${(n / 1e6).toFixed(0)}M`;
const bn = (n: number) => `€${(n / 1e9).toFixed(2)}bn`;
const pp = (n: number) => `${n.toFixed(2)}pp`;
const L = (s = "") => console.log(s);
const hr = () => L("─".repeat(78));

// ── the plan's macro frame (Табл. 3) ─────────────────────────────────────────
const GDP25 = 116.0e9;
const GDP26 = GDP25 * 1.124;
const GDP27 = GDP26 * 1.083;
L("ПБП-2027 — arithmetic checks");
L(
  `GDP 2025 ${bn(GDP25)} · 2026 ${bn(GDP26)} (+12.4%) · 2027 ${bn(GDP27)} (+8.3%)`,
);
hr();

// ── 1. headline balance in euro ──────────────────────────────────────────────
const def26 = 0.05 * GDP26;
const def27 = 0.043 * GDP27;
L(`Deficit 2026 5.0% = ${bn(def26)} · 2027 4.3% = ${bn(def27)}`);
L(
  `Revenue 2027 stated €51.064bn → ${((51.064e9 / GDP27) * 100).toFixed(1)}% of GDP (Табл. 4: 36.1%)`,
);
L(
  `Debt 40.6 → 47.1bn: +${bn(47.1e9 - 40.6e9)} vs deficit ${bn(def27)} (stock-flow ${bn(47.1e9 - 40.6e9 - def27)})`,
);
// June-2026 АСБП frame for comparison (our 2026-07-25 article): 2027 ESA 3.9%,
// state debt €44.7bn = 33.2% → implied GDP 2027 ≈ 134.6bn.
const gdp27June = 44.7e9 / 0.332;
L(
  `June frame: 2027 ESA 3.9% of ~${bn(gdp27June)} = ${bn(0.039 * gdp27June)} → now ${bn(def27)} (+${bn(def27 - 0.039 * gdp27June)})`,
);
L(
  `Debt ratio: June GG 35.7% (~${bn(0.357 * gdp27June)}) → now 33.3% (${bn(47.1e9)}) — denominator effect`,
);
hr();

// ── 2. what the 7.4% → 4.3% gap is made of (Табл. 4 vs Табл. 6, 2027) ──────
L("PLAN vs NO-POLICY-CHANGE, 2027 (% GDP)        plan   no-pol   Δ    €");
const rows: [string, number, number][] = [
  ["Revenue total", 36.1, 34.3],
  ["  taxes on production/imports", 13.8, 13.2],
  ["  income/wealth taxes", 7.1, 6.6],
  ["  social contributions", 9.2, 8.6],
  ["  other current revenue", 5.0, 4.7],
  ["Expenditure total", 40.4, 41.8],
  ["  compensation of employees", 11.0, 11.4],
  ["  intermediate consumption", 4.9, 5.1],
  ["  social transfers (cash)", 12.5, 12.7],
  ["  subsidies", 1.6, 1.7],
  ["  GFCF", 4.3, 4.7],
  ["Balance", -4.3, -7.4],
];
for (const [k, a, b] of rows)
  L(
    `  ${k.padEnd(40)} ${a.toFixed(1).padStart(5)} ${b.toFixed(1).padStart(7)} ${(a - b).toFixed(1).padStart(5)}  ${M(((a - b) / 100) * GDP27)}`,
  );
L(
  "Itemised discretionary measures (Табл. 5, 2027): revenue +1.39pp, spending −0.04pp",
);
L(
  `→ revenue side explained ${pp(1.39)} of ${pp(1.8)}; spending side explains ${pp(0.04)} of ${pp(1.4)}`,
);
L(
  `→ un-itemised spending restraint vs no-policy ≈ ${pp(1.36)} ≈ ${M(0.0136 * GDP27)}`,
);
hr();

// ── 3. net-expenditure arithmetic & the windfall tax (Табл. 1а, 4) ───────────
const nep26 = 0.382 * GDP26; // row 29, before revenue measures
const nep27 = 0.371 * GDP27;
const revMeas27 = 1958.5e6;
const windfall = 800e6;
const g = (rm: number) => ((nep27 - rm) / nep26 - 1) * 100;
L(
  `Net nationally financed primary exp. (row 29): ${bn(nep26)} → ${bn(nep27)} (+${((nep27 / nep26 - 1) * 100).toFixed(1)}% gross)`,
);
L(
  `  net of €1,958.5M revenue measures: ${g(revMeas27).toFixed(1)}%   (plan Табл. 1а: 1.3%, ceiling 3.4%)`,
);
L(`  without the €800M windfall tax:   ${g(revMeas27 - windfall).toFixed(1)}%`);
L(`  without ANY 2027 revenue measure: ${g(0).toFixed(1)}%`);
const wfPct = (windfall / GDP27) * 100;
L(
  `Control account after defence flex: 0.4pp (ceiling 0.6pp). Windfall = ${pp(wfPct)} of GDP`,
);
L(
  `  → without the windfall tax ≈ ${pp(0.4 + wfPct)} → ${0.4 + wfPct > 0.6 ? "ABOVE" : "within"} the 0.6pp ceiling`,
);
L(`  before defence flex: 1.0pp → ${pp(1.0 + wfPct)} without it`);
L(
  `2028 cliff: lapse of a ${M(windfall)} temporary measure ≈ +${((windfall / nep27) * 100).toFixed(1)} growth points on a 3.4% ceiling`,
);
// effective rate and implied base
const effRate = 0.33 * 0.7;
L(
  `Windfall: 33% with 30% rebated → effective ${(effRate * 100).toFixed(1)}% → implied avg 2020–25 profit base ${bn(windfall / effRate)}`,
);
L(
  `  (if the 30% "reinvested" share is NOT netted: base ${bn(windfall / 0.33)})`,
);
hr();

// ── 4. simulator check: МОД €2,400 from 1.1.2027 (plan: €265.1M) ──────────────
const earnings = baseline.earnings as { bands: EarningsBand[] };
const from26 = capMonths(2026);
L(`2026 cap schedule (engine): ${JSON.stringify(from26)}`);
const bands = scoreModCapBands(earnings.bands, from26, 2400);
const cf = scoreModCap(baseline.modIdentity, 2400, from26);
const dyn =
  bands.totalEur +
  modBehavioralOffset(bands.totalEur, true, false, SSC_CAP_AVOIDANCE.central);
L(`МОД 2026 schedule → €2,400 all year (baseline-wage terms):`);
L(
  `  bands model  SSC ${M(bands.sscEur)}  PIT offset ${M(bands.pitOffsetEur)}  net ${M(bands.totalEur)}  (with avoidance ${M(dyn)})`,
);
L(
  `  Pareto band  ${M(cf.lowEur)}–${M(cf.highEur)} (central ${M(cf.centralEur)})`,
);
// carry-over of the Aug-2026 €2,300 step alone (5 → 12 months)
const carry = scoreModCapBands(earnings.bands, from26, 2300);
L(
  `  of which carry-over of the €2,300 step (Jan–Jul 2027 at 2,300): ${M(carry.sscEur)} SSC`,
);
// Bands sit at 2025 wages; 2027 comp/employee is +8.5% then +6.2%. A fixed cap
// over a Pareto tail grows its increment ~ (wage)^α, so bracket both scalings.
const w = 1.085 * 1.062;
L(
  `  wage-scaled to 2027: linear ${M(bands.sscEur * w)} · tail-leveraged ${M(bands.sscEur * Math.pow(w, 2.27))}   plan: €265.1M`,
);
L(
  `  (same engine prices the Aug-2026 €2,112→€2,300 step at ${M((scoreModCapBands(earnings.bands, [{ capEur: 2111.64, months: 12 }], 2300).sscEur * 5) / 12)} vs МФ €90.8M)`,
);
hr();

// ── 5. tobacco calendar (plan: €220.2M excise+VAT for 2027) ──────────────────
const tob = baseline.revenue.exciseTobaccoEur;
const r26 = cigaretteExciseRateEur(2026),
  r27 = cigaretteExciseRateEur(2027),
  r28 = cigaretteExciseRateEur(2028);
const sched = scoreExciseRate(tob, r26, r27);
const accel = scoreExciseRate(tob, r27, r28) * (10 / 12); // 2028 level from 1 March 2027
L(
  `Tobacco excise base ${M(tob)}; calendar 2026 €${r26.toFixed(2)} · 2027 €${r27.toFixed(2)} · 2028 €${r28.toFixed(2)}/1000`,
);
L(
  `  scheduled 2027 step (static) ${M(sched)}; pulling 2028 level to 1 Mar 2027 ${M(accel)} (+VAT ×1.2 ${M(accel * 1.2)}; with demand response ${M((accel + exciseBehavioralOffset(tob, r28 / r27 - 1, EXCISE_TOBACCO_RESPONSE.central) * (10 / 12)) * 1.2)}); plan: €220.2M`,
);
hr();

// ── 6. path to 3% in 2027 — incremental over the plan ────────────────────────
const gap = def27 - 0.03 * GDP27;
const scale = GDP27 / baseline.gdpEur; // 2025-terms levers → 2027 money
L(
  `Gap 4.3% → 3.0% in 2027: ${bn(gap)} (levers scaled ×${scale.toFixed(3)} from 2025 base)`,
);
const rev = baseline.revenue;
const vat = baseline.vat as { slices: VatBaseSlice[]; factor: number };
const vatDyn = (r: number) => {
  const b0 = computeVatRevenue(vat.slices, VAT_POLICY_CURRENT).modeledEur;
  const s =
    (computeVatRevenue(vat.slices, { ...VAT_POLICY_CURRENT, standardRate: r })
      .modeledEur -
      b0) *
    vat.factor;
  return (s + vatBehavioralOffset(s, VAT_GAP_RESPONSE.central)) * scale;
};
const pitDyn = (r: number) =>
  (scorePitFlat(rev.pitEur, rev.pitRateSensitiveShare, r) +
    pitFlatBehavioralOffset(
      rev.pitEur * rev.pitRateSensitiveShare,
      0.1,
      r,
      ETI_EMPLOYMENT.central,
    )) *
  scale;
const corpDyn = (r: number) =>
  (scoreCorporate(rev.corporateEur, r) +
    corpBehavioralOffset(
      rev.corporateEur,
      0.1,
      r,
      CIT_BASE_SEMI_ELAST_PCT_PP.central,
    )) *
  scale;
const exp = baseline.expenditure;
const pensionCpi =
  Math.abs(
    scorePensionIndexation(
      {
        massEur: exp.pensions.massEur,
        supplementMassEur: exp.pensions.supplementMassEur,
        cpiPct: exp.pensions.cpiPct,
        wageGrowthPct: exp.pensions.wageGrowthPct,
      },
      { cpiWeight: 1, indexSupplement: true, horizonYears: 1 },
    ),
  ) * scale;
const admin20 = Math.abs(scoreAdminCut(exp.administration, 0.2).netEur);
const cap10 =
  Math.abs(
    scoreCapitalChange(exp.capital.planEur, exp.capital.executionRate, -10),
  ) * scale;
const levers: [string, number][] = [
  ["ДДС 20→21%", vatDyn(0.21)],
  ["ДДФЛ 10→11%", pitDyn(0.11)],
  ["Корпоративен 10→12%", corpDyn(0.12)],
  ["Пенсии: само по ИПЦ (вместо швейцарско правило)", pensionCpi],
  ["Администрация щат −20%", admin20],
  ["Капиталови −10%", cap10],
  ["Събираемост +€1bn заявени @0.40", scoreCollectionRealism(1e9)],
];
for (const [k, v] of levers)
  L(
    `  ${k.padEnd(50)} ${M(v).padStart(8)}  (${((v / gap) * 100).toFixed(0)}% of gap)`,
  );
L(
  `  No-rate-change package (pensions CPI + admin −20% + capex −10% + collection): ${M(pensionCpi + admin20 + cap10 + scoreCollectionRealism(1e9))}`,
);
hr();

// ── 7. our projection engine vs the plan ─────────────────────────────────────
const p = projectFiscalPath(0);
for (const y of p.years.slice(0, 2))
  L(
    `engine ${y.year}: GDP ${bn(y.gdpEur)} balance ${y.baselineBalancePctGdp.toFixed(1)}% debt ${y.baselineDebtPctGdp.toFixed(1)}% (${bn(y.baselineDebtEur)})`,
  );
L(
  `plan   2026: GDP ${bn(GDP26)} balance −5.0% debt 31.1% (€40.6bn); 2027: ${bn(GDP27)} −4.3% 33.3% (€47.1bn)`,
);
