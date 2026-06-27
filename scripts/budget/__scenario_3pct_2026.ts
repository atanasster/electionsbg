// One-off: use the budget-policy-simulator engine to cost lever options that
// would take the 2026 deficit from the budgeted 5.7% (КФП) down to 3% of GDP.
// All levers are INCREMENTAL — on top of what ЗДБРБ-2026 already does (the 10%
// wage-bill cut, МОД→€2,300, subsidy cuts, etc. are already baked into 5.7%).
// Figures are ANNUALISED (steady-state); mid-year starts dampen the 2026 effect.
//
// Usage: npx tsx scripts/budget/__scenario_3pct_2026.ts

import {
  computeVatRevenue,
  VAT_POLICY_CURRENT,
  scorePitFlat,
  scoreCorporate,
  scoreDividend,
  scoreAdminCut,
  scoreWageIndexation,
  scorePensionIndexation,
  scoreCapitalChange,
  scoreCollectionRealism,
  scoreModCap,
  type VatBaseSlice,
} from "../../src/lib/bgTaxPolicy";
import {
  vatBehavioralOffset,
  pitFlatBehavioralOffset,
  corpBehavioralOffset,
  dividendBehavioralOffset,
  modBehavioralOffset,
  VAT_GAP_RESPONSE,
  ETI_EMPLOYMENT,
  CIT_BASE_SEMI_ELAST_PCT_PP,
  DIV_BASE_SEMI_ELAST_PCT_PP,
  SSC_CAP_AVOIDANCE,
} from "../../src/lib/bgBehavioral";
import baseline from "../../data/budget/derived/policy_baseline.json";

const M = (n: number) => `€${(n / 1e6).toFixed(0)}M`;
const bn = (n: number) => `€${(n / 1e9).toFixed(2)}bn`;
const L = (s = "") => console.log(s);
const hr = () => L("─".repeat(74));

// ── the gap ──────────────────────────────────────────────────────────────────
const GDP = 125_247_000_000;
const DEFICIT = 7_191_900_000; // 5.7% КФП
const TARGET = 0.03 * GDP; // 3% of GDP
const GAP = DEFICIT - TARGET; // additional consolidation needed
L("PATH TO A 3% DEFICIT IN 2026 — simulator-costed levers");
L(`Budgeted deficit 5.7% = ${bn(DEFICIT)} | 3% target = ${bn(TARGET)}`);
L(`ADDITIONAL consolidation needed: ${bn(GAP)} (on top of the budget)`);
hr();

// ── revenue levers (static + behaviourally adjusted central) ─────────────────
const rev = baseline.revenue;
const vat = baseline.vat as { slices: VatBaseSlice[]; factor: number };

const vatStatic = (newStd: number) => {
  const base = computeVatRevenue(vat.slices, VAT_POLICY_CURRENT).modeledEur;
  const neu = computeVatRevenue(vat.slices, {
    ...VAT_POLICY_CURRENT,
    standardRate: newStd,
  }).modeledEur;
  return (neu - base) * vat.factor;
};
const vatDyn = (newStd: number) => {
  const s = vatStatic(newStd);
  return s + vatBehavioralOffset(s, VAT_GAP_RESPONSE.central);
};

const pitStatic = (r: number) =>
  scorePitFlat(rev.pitEur, rev.pitRateSensitiveShare, r);
const pitDyn = (r: number) => {
  const rsRev = rev.pitEur * rev.pitRateSensitiveShare;
  return (
    pitStatic(r) +
    pitFlatBehavioralOffset(rsRev, 0.1, r, ETI_EMPLOYMENT.central)
  );
};
const corpStatic = (r: number) => scoreCorporate(rev.corporateEur, r);
const corpDyn = (r: number) =>
  corpStatic(r) +
  corpBehavioralOffset(
    rev.corporateEur,
    0.1,
    r,
    CIT_BASE_SEMI_ELAST_PCT_PP.central,
  );
const divStatic = (r: number) => scoreDividend(rev.dividendEur, r);
const divDyn = (r: number) =>
  divStatic(r) +
  dividendBehavioralOffset(
    rev.dividendEur,
    0.05,
    r,
    DIV_BASE_SEMI_ELAST_PCT_PP.central,
  );

L("REVENUE LEVERS                         static      with behaviour");
L(
  `  ДДС 20→21% (+1pp)                    ${M(vatStatic(0.21)).padStart(8)}    ${M(vatDyn(0.21))}`,
);
L(
  `  ДДС 20→22% (+2pp)                    ${M(vatStatic(0.22)).padStart(8)}    ${M(vatDyn(0.22))}`,
);
L(
  `  ДДС 20→23% (+3pp)                    ${M(vatStatic(0.23)).padStart(8)}    ${M(vatDyn(0.23))}`,
);
L(
  `  ДДФЛ 10→11% (+1pp)                   ${M(pitStatic(0.11)).padStart(8)}    ${M(pitDyn(0.11))}`,
);
L(
  `  ДДФЛ 10→12% (+2pp)                   ${M(pitStatic(0.12)).padStart(8)}    ${M(pitDyn(0.12))}`,
);
L(
  `  ДДФЛ 10→13% (+3pp)                   ${M(pitStatic(0.13)).padStart(8)}    ${M(pitDyn(0.13))}`,
);
L(
  `  Корпоративен 10→12%                  ${M(corpStatic(0.12)).padStart(8)}    ${M(corpDyn(0.12))}`,
);
L(
  `  Корпоративен 10→15%                  ${M(corpStatic(0.15)).padStart(8)}    ${M(corpDyn(0.15))}`,
);
L(
  `  Дивидент 5→10%                       ${M(divStatic(0.1)).padStart(8)}    ${M(divDyn(0.1))}`,
);
// МОД lever — INCREMENTAL over the budget's own €2,112→€2,300 move (already in
// the 5.7%). Pareto-tail identity; behaviour = SSC-cap avoidance haircut.
const mod = baseline.modIdentity as {
  capEur: number;
  aboveCapMassEur: number;
  alphaLow: number;
  alphaCentral: number;
  alphaHigh: number;
};
const modStat = (from: number, to: number) =>
  scoreModCap(mod, to, from).centralEur;
const modDyn = (from: number, to: number) => {
  const s = modStat(from, to);
  return s + modBehavioralOffset(s, true, false, SSC_CAP_AVOIDANCE.central);
};
L(
  `  МОД €2 300→€2 500 (над бюджета)      ${M(modStat(2300, 2500)).padStart(8)}    ${M(modDyn(2300, 2500))}`,
);
L(
  `  МОД €2 300→премахнат таван           ${M(modStat(2300, Infinity)).padStart(8)}    ${M(modDyn(2300, Infinity))}`,
);
hr();

// ── expenditure levers ───────────────────────────────────────────────────────
const exp = baseline.expenditure;
const admin10 = scoreAdminCut(exp.administration, 0.1);
const admin20 = scoreAdminCut(exp.administration, 0.2);
const admin30 = scoreAdminCut(exp.administration, 0.3);
// Deepen the public wage-bill cut beyond the −10% already in the budget.
const wage15 = scoreWageIndexation(
  exp.personnel.massEur,
  exp.personnel.exemptShare,
  -15,
  false,
);
const wage20 = scoreWageIndexation(
  exp.personnel.massEur,
  exp.personnel.exemptShare,
  -20,
  false,
);
const wage10 = scoreWageIndexation(
  exp.personnel.massEur,
  exp.personnel.exemptShare,
  -10,
  false,
);
const pensionCpiOnly = scorePensionIndexation(
  {
    massEur: exp.pensions.massEur,
    supplementMassEur: exp.pensions.supplementMassEur,
    cpiPct: exp.pensions.cpiPct,
    wageGrowthPct: exp.pensions.wageGrowthPct,
  },
  { cpiWeight: 1, indexSupplement: true, horizonYears: 1 },
);
const cap10 = scoreCapitalChange(
  exp.capital.planEur,
  exp.capital.executionRate,
  -10,
);
const cap20 = scoreCapitalChange(
  exp.capital.planEur,
  exp.capital.executionRate,
  -20,
);

L("EXPENDITURE / EFFICIENCY LEVERS (annualised net saving)");
L(
  `  Администрация: щат −10%              ${M(Math.abs(admin10.netEur))}  (${Math.max(0, Math.round(exp.administration.positionsTotal * 0.1 - exp.administration.positionsVacant))} real layoffs; rest absorbed by vacancies)`,
);
L(`  Администрация: щат −20%              ${M(Math.abs(admin20.netEur))}`);
L(`  Администрация: щат −30%              ${M(Math.abs(admin30.netEur))}`);
L(
  `  ФРЗ: задълбочаване −10%→−15%         ${M(Math.abs(wage15) - Math.abs(wage10))}  (incremental over the budget's −10%)`,
);
L(
  `  ФРЗ: задълбочаване −10%→−20%         ${M(Math.abs(wage20) - Math.abs(wage10))}  (incremental)`,
);
L(
  `  Пенсии: индексация само по ИПЦ       ${M(Math.abs(pensionCpiOnly))}  (vs швейцарското правило; ~half in 2026, 1 July start)`,
);
L(`  Капиталови разходи −10%              ${M(Math.abs(cap10))}`);
L(`  Капиталови разходи −20%              ${M(Math.abs(cap20))}`);
L(
  `  Събираемост/сива икономика (+€1bn заявени, banked @0.40)  ${M(scoreCollectionRealism(1e9))}`,
);
hr();

// ── three illustrative packages to €3.43bn ───────────────────────────────────
const pkg = (name: string, items: [string, number][]) => {
  const total = items.reduce((a, [, v]) => a + v, 0);
  L(`PACKAGE: ${name}`);
  for (const [label, v] of items)
    L(`   ${label.padEnd(46)} ${M(v).padStart(8)}`);
  L(`   ${"—".repeat(46)} ${"—".repeat(8)}`);
  L(
    `   ${"ОБЩО".padEnd(46)} ${bn(total).padStart(8)}   (gap ${bn(GAP)} → ${total >= GAP ? "REACHES 3%" : "short by " + M(GAP - total)})`,
  );
  L("");
};

pkg("A · Изцяло по приходите (revenue-only)", [
  ["ДДС 20→23% (+3pp)", vatDyn(0.23)],
  ["ДДФЛ 10→13% (+3pp)", pitDyn(0.13)],
  ["Корпоративен 10→12%", corpDyn(0.12)],
  ["Дивидент 5→10%", divDyn(0.1)],
  ["Събираемост (+€1.25bn заявени @0.40)", scoreCollectionRealism(1.25e9)],
]);

pkg("B · Балансиран (mixed)", [
  ["ДДС 20→22% (+2pp)", vatDyn(0.22)],
  ["ДДФЛ 10→12% (+2pp)", pitDyn(0.12)],
  ["Дивидент 5→10%", divDyn(0.1)],
  ["Пенсии: индексация само по ИПЦ", Math.abs(pensionCpiOnly)],
  ["Администрация щат −20%", Math.abs(admin20.netEur)],
  ["ФРЗ −10%→−20% (доп.)", Math.abs(wage20) - Math.abs(wage10)],
  ["Капиталови −10%", Math.abs(cap10)],
  ["Събираемост (+€1.3bn заявени @0.40)", scoreCollectionRealism(1.3e9)],
]);

pkg("C · Максимум по разходите + минимален данък (spending-led)", [
  ["Пенсии: индексация само по ИПЦ", Math.abs(pensionCpiOnly)],
  ["Администрация щат −30%", Math.abs(admin30.netEur)],
  ["ФРЗ −10%→−20% (доп.)", Math.abs(wage20) - Math.abs(wage10)],
  ["Капиталови −20%", Math.abs(cap20)],
  ["ДДС 20→23% (+3pp) — пак неизбежен", vatDyn(0.23)],
  ["Събираемост (+€1.5bn заявени @0.40)", scoreCollectionRealism(1.5e9)],
]);

L(
  "Note: admin/wage/capital levers are structurally capped (the non-exempt public",
);
L(
  "wage bill is only ~€2.8bn), so NO package reaches 3% on spending cuts alone —",
);
L(
  "the arithmetic forces either a broad tax rise (ДДС/ДДФЛ) or touching pensions.",
);
