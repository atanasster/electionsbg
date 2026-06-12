// Smoke test for the behavioral/dynamic-scoring layer (src/lib/bgBehavioral.ts)
// over the shipped policy_baseline.json: locks the zero-draw identity, the
// Фискален-съвет dividend calibration, sign/scale conventions, the Tier-2
// feedback magnitudes from the grounding doc, the projection-GDP wiring and
// Monte-Carlo determinism before future edits.
//
// Usage:
//   npx tsx scripts/budget/__smoke_behavioral.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  PIT_RATE,
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  VAT_STANDARD_RATE,
  resolveMod,
} from "../../src/lib/bgTax";
import {
  VAT_REDUCED_RATE,
  computeVatRevenue,
  scoreCorporate,
  scoreDividend,
  scoreHealthContribution,
  scoreModCapBands,
  scorePitSchedule,
  type EarningsBand,
  type ModIdentity,
  type PitBracket,
  type VatBaseSlice,
  type VatPolicy,
} from "../../src/lib/bgTaxPolicy";
import {
  PROJECTION_GDP_EUR,
  PROJECTION_YEARS,
  projectFiscalPath,
} from "../../src/lib/bgFiscalProjection";
import {
  MC_DRAWS,
  MC_SEED,
  buildDynamicInput,
  centralDraw,
  computeDynamicScenario,
  computeMacroFeedback,
  dividendShiftRecaptureEur,
  maternityReturnOffset,
  modBehavioralOffset,
  pitBehavioralSensitivityEur,
  sampleDraws,
  zeroDraw,
  type DynamicScenarioInput,
} from "../../src/lib/bgBehavioral";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

interface BaselineFile {
  baselineYear: number;
  revenue: {
    pitEur: number;
    pitNonEmploymentShare: number;
    corporateEur: number;
    dividendEur: number;
  };
  expenditure: { health: { baseEur: number } };
  earnings: { kappa: number; capEur: number; bands: EarningsBand[] };
  vat: { factor: number; slices: VatBaseSlice[] };
  modIdentity: ModIdentity;
}

let failures = 0;
const check = (name: string, ok: boolean): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};
const M = (v: number): string => `€${(v / 1e6).toFixed(1)}M`;

interface Levers {
  vatStd?: number; // percent
  pit?: number; // percent
  nm?: number; // EUR/mo
  corp?: number; // percent
  div?: number; // percent
  mod?: number; // EUR/mo cap
  noCap?: boolean;
  hp?: number; // pp
}

const main = (): void => {
  const b = JSON.parse(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "data/budget/derived/policy_baseline.json"),
      "utf-8",
    ),
  ) as BaselineFile;
  const currentCap = resolveMod(null).mod;
  const e = b.earnings;

  // Mirror of the simulator's static scenario composition for the revenue
  // levers the behavioral layer touches (expenditure levers carry no offsets).
  const buildInput = (lv: Levers): DynamicScenarioInput => {
    const vatStd = (lv.vatStd ?? 100 * VAT_STANDARD_RATE) / 100;
    const pit = (lv.pit ?? 100 * PIT_RATE) / 100;
    const corp = (lv.corp ?? 100 * CORP_TAX_RATE) / 100;
    const div = (lv.div ?? 100 * DIVIDEND_TAX_RATE) / 100;
    const nm = lv.nm ?? 0;
    const targetCap = lv.noCap ? Infinity : (lv.mod ?? currentCap);

    const current: VatPolicy = {
      standardRate: VAT_STANDARD_RATE,
      reducedRate: VAT_REDUCED_RATE,
      regimes: {},
    };
    const policy: VatPolicy = {
      standardRate: vatStd,
      reducedRate: VAT_REDUCED_RATE,
      regimes: {},
    };
    const vatDelta =
      (computeVatRevenue(b.vat.slices, policy).modeledEur -
        computeVatRevenue(b.vat.slices, current).modeledEur) *
      b.vat.factor;

    const brackets: PitBracket[] = [];
    if (nm > 0) brackets.push({ fromEur: 0, rate: 0 });
    brackets.push({ fromEur: nm, rate: pit });
    const pitEmp = scorePitSchedule(e.bands, e.capEur, brackets, e.kappa);
    const pitNonEmp =
      b.revenue.pitEur * b.revenue.pitNonEmploymentShare * (pit / PIT_RATE - 1);

    const corpDelta = scoreCorporate(b.revenue.corporateEur, corp);
    const divDelta = scoreDividend(b.revenue.dividendEur, div);
    const modCentral = scoreModCapBands(
      e.bands,
      currentCap,
      targetCap,
      pit,
    ).totalEur;
    const healthDelta = lv.hp
      ? scoreHealthContribution(b.expenditure.health.baseEur, lv.hp)
      : 0;

    // Route through the SAME assembly helper the screen and the chat tool
    // use, so this test exercises the real wiring (FINDING-005).
    return buildDynamicInput(
      b,
      {
        totalEur:
          vatDelta +
          pitEmp +
          pitNonEmp +
          corpDelta +
          divDelta +
          modCentral +
          healthDelta,
        vatDeltaEur: vatDelta,
        pitEmploymentDeltaEur: pitEmp,
        pitNonEmploymentDeltaEur: pitNonEmp,
        corpDeltaEur: corpDelta,
        divDeltaEur: divDelta,
        modCentralEur: modCentral,
        healthDeltaEur: healthDelta,
        minWageDeltaEur: 0,
        expenditureBalanceNonPensionEur: 0,
        brackets,
      },
      {
        pitNewRate: pit,
        corpNewRate: corp,
        divNewRate: div,
        modTargetCapEur: targetCap,
        modCurrentCapEur: currentCap,
      },
    );
  };

  const draws = sampleDraws(MC_DRAWS, MC_SEED, b.modIdentity);
  const zero = [zeroDraw(b.modIdentity.alphaCentral)];

  // ---- 1. Zero-draw identity: every parameter at 0 reproduces static -------
  const fat = buildInput({
    vatStd: 22,
    pit: 12,
    nm: 620,
    corp: 15,
    div: 10,
    mod: currentCap + 500,
    hp: 1,
  });
  const fatZero = computeDynamicScenario(fat, zero);
  check(
    `zero draw ≡ static on a fat scenario (${M(fatZero.p5Eur)} vs ${M(fat.staticTotalEur)})`,
    Math.abs(fatZero.p5Eur - fat.staticTotalEur) <= 1 &&
      Math.abs(fatZero.p95Eur - fat.staticTotalEur) <= 1,
  );
  const zeroFb = computeMacroFeedback(
    1e9,
    1e9,
    1e9,
    undefined,
    zeroDraw(b.modIdentity.alphaCentral),
  );
  check(
    "zero draw: macro feedback path is identically 0",
    zeroFb.feedbackByYearEur.every((v) => v === 0) &&
      zeroFb.gdpDeltaByYearEur.every((v) => v === 0),
  );

  // ---- 2. Dividend reconciliation (Фискален съвет calibration target) ------
  const divIn = buildInput({ div: 10 });
  const divDyn = computeDynamicScenario(divIn, draws);
  const divLever = divIn.staticDivDeltaEur + divDyn.offsets.dividend;
  check(
    `dividend 5→10%: dynamic lever ${M(divLever)} ∈ [€35M, €55M] (static ${M(divIn.staticDivDeltaEur)}, ФС ≤ €50M)`,
    divLever >= 35e6 && divLever <= 55e6 && divLever < divIn.staticDivDeltaEur,
  );
  check(
    `dividend 5→10%: headline ${M(divDyn.dynamicHeadlineEur)} ∈ [€30M, €55M] after Tier-2`,
    divDyn.dynamicHeadlineEur >= 30e6 && divDyn.dynamicHeadlineEur <= 55e6,
  );

  // ---- 3. VAT direction -----------------------------------------------------
  const vatIn = buildInput({ vatStd: 21 });
  const vatDyn = computeDynamicScenario(vatIn, draws);
  const vatLever = vatIn.staticVatDeltaEur + vatDyn.offsets.vat;
  check(
    `VAT 20→21: dynamic lever ${M(vatLever)} < static ${M(vatIn.staticVatDeltaEur)} and ≥ 0.75×static`,
    vatLever < vatIn.staticVatDeltaEur &&
      vatLever >= 0.75 * vatIn.staticVatDeltaEur,
  );

  // ---- 4. PIT schedules: untaxed minimum + extremes stay finite -------------
  const nmOnly: PitBracket[] = [
    { fromEur: 0, rate: 0 },
    { fromEur: 620, rate: PIT_RATE },
  ];
  check(
    "untaxed minimum alone: behavioral sensitivity is exactly 0 (τ_new=0 below, τ unchanged above)",
    pitBehavioralSensitivityEur(e.bands, e.capEur, e.kappa, nmOnly) === 0,
  );
  const extreme1 = pitBehavioralSensitivityEur(e.bands, e.capEur, e.kappa, [
    { fromEur: 0, rate: 0 },
  ]);
  const extreme2 = pitBehavioralSensitivityEur(e.bands, e.capEur, e.kappa, [
    { fromEur: 0, rate: 0.9 },
  ]);
  check(
    "extreme schedules (0% flat, 90% flat) produce finite sensitivities",
    Number.isFinite(extreme1) && Number.isFinite(extreme2) && extreme1 === 0,
  );

  // ---- 5. CIT magnitude ------------------------------------------------------
  const citIn = buildInput({ corp: 11 });
  const citDyn = computeDynamicScenario(citIn, draws);
  const citRatio = citDyn.offsets.corp / citIn.staticCorpDeltaEur;
  check(
    `CIT +1пп: offset/static ${(citRatio * 100).toFixed(1)}% ∈ [−12%, −6%]`,
    citRatio >= -0.12 && citRatio <= -0.06,
  );

  // ---- 6. Offsets oppose static, smaller in magnitude ------------------------
  const opposing: [string, Levers, "vat" | "pit" | "corp" | "dividend"][] = [
    ["VAT 22", { vatStd: 22 }, "vat"],
    ["VAT 18", { vatStd: 18 }, "vat"],
    ["PIT 15", { pit: 15 }, "pit"],
    ["PIT 8", { pit: 8 }, "pit"],
    ["corp 15", { corp: 15 }, "corp"],
    ["corp 7", { corp: 7 }, "corp"],
    ["div 10", { div: 10 }, "dividend"],
    ["div 3", { div: 3 }, "dividend"],
  ];
  for (const [name, lv, key] of opposing) {
    const inp = buildInput(lv);
    const dyn = computeDynamicScenario(inp, draws);
    const stat =
      key === "vat"
        ? inp.staticVatDeltaEur
        : key === "pit"
          ? inp.staticPitEmploymentDeltaEur + inp.staticPitNonEmploymentDeltaEur
          : key === "corp"
            ? inp.staticCorpDeltaEur
            : inp.staticDivDeltaEur;
    const off = dyn.offsets[key];
    check(
      `${name}: offset opposes static and |offset| < |static| (${M(off)} vs ${M(stat)})`,
      Math.sign(off) === -Math.sign(stat) && Math.abs(off) < Math.abs(stat),
    );
  }
  check(
    "МОД lowering carries no avoidance haircut",
    modBehavioralOffset(-100e6, false, false, 0.1) === 0,
  );
  // МРЗ freeze: no Tier-1 offset AND no Tier-2 impulse (the foregone SSC/PIT
  // reads as loosening but frozen private wages are an opposing income hit —
  // net demand ≈ 0), so dynamic ≡ static for this lever.
  const mrzIn = { ...buildInput({}), staticMinWageDeltaEur: -280e6 };
  mrzIn.staticTotalEur = -280e6;
  const mrzDyn = computeDynamicScenario(mrzIn, draws);
  check(
    `МРЗ freeze: dynamic ≡ static (${M(mrzDyn.dynamicHeadlineEur)} vs ${M(mrzIn.staticTotalEur)}, band collapsed)`,
    Math.abs(mrzDyn.dynamicHeadlineEur - mrzIn.staticTotalEur) <= 1 &&
      Math.abs(mrzDyn.p95Eur - mrzDyn.p5Eur) <= 1,
  );

  // ---- 7. Tier-2 magnitudes reproduce the grounding doc ----------------------
  const cd = centralDraw(b.modIdentity.alphaCentral);
  const taxFb = computeMacroFeedback(0, 1e9, 0, undefined, cd);
  const taxRatio = taxFb.feedbackByYearEur[0] / 1e9;
  check(
    `Tier-2: €1B tax consolidation → year-1 feedback ${(taxRatio * 100).toFixed(1)}% ∈ [−16%, −10%]`,
    taxRatio >= -0.16 && taxRatio <= -0.1,
  );
  const spendFb = computeMacroFeedback(0, 0, 1e9, undefined, cd);
  check(
    `Tier-2: €1B spending cut → year-1 feedback ${(Math.abs(spendFb.feedbackByYearEur[0] / 1e9) * 100).toFixed(1)}% ≤ 2%`,
    Math.abs(spendFb.feedbackByYearEur[0]) <= 0.02 * 1e9,
  );
  let decays = true;
  for (let i = 1; i < taxFb.feedbackByYearEur.length; i++) {
    const growth = PROJECTION_GDP_EUR[i] / PROJECTION_GDP_EUR[i - 1];
    if (
      Math.abs(taxFb.feedbackByYearEur[i]) >
      Math.abs(taxFb.feedbackByYearEur[i - 1]) * growth
    )
      decays = false;
  }
  check("Tier-2: feedback decays relative to the GDP-scaled impulse", decays);

  // ---- 8. Projection wiring ---------------------------------------------------
  const proj = projectFiscalPath(0);
  check(
    "PROJECTION_GDP_EUR matches projectFiscalPath's own GDP path (€1 tol)",
    PROJECTION_YEARS.length === PROJECTION_GDP_EUR.length &&
      proj.years.every(
        (y, i) => Math.abs(y.gdpEur - PROJECTION_GDP_EUR[i]) <= 1,
      ),
  );

  // ---- 9. Monte Carlo: determinism + coherence --------------------------------
  const drawsAgain = sampleDraws(MC_DRAWS, MC_SEED, b.modIdentity);
  check(
    "MC: same seed → element-wise identical draws",
    draws.every(
      (d, i) =>
        d.etiEmployment === drawsAgain[i].etiEmployment &&
        d.modAlpha === drawsAgain[i].modAlpha &&
        d.persistence === drawsAgain[i].persistence,
    ),
  );
  const mixed = buildInput({ vatStd: 22, pit: 12, corp: 15, div: 10 });
  const mixedDyn = computeDynamicScenario(mixed, draws);
  check(
    `MC: p5 ${M(mixedDyn.p5Eur)} ≤ central ${M(mixedDyn.dynamicHeadlineEur)} ≤ p95 ${M(mixedDyn.p95Eur)}`,
    mixedDyn.p5Eur <= mixedDyn.dynamicHeadlineEur &&
      mixedDyn.dynamicHeadlineEur <= mixedDyn.p95Eur,
  );
  const nullDyn = computeDynamicScenario(buildInput({}), draws);
  check(
    "MC: current-law scenario → p5 = p95 = 0",
    Math.abs(nullDyn.p5Eur) <= 1 &&
      Math.abs(nullDyn.p95Eur) <= 1 &&
      Math.abs(nullDyn.dynamicHeadlineEur) <= 1,
  );

  // ---- 10. Extremes stay finite ------------------------------------------------
  const extremes = computeDynamicScenario(
    buildInput({ vatStd: 27, pit: 0, corp: 30, div: 0, noCap: true }),
    draws,
  );
  check(
    "all-extremes scenario: every output finite",
    Number.isFinite(extremes.dynamicHeadlineEur) &&
      Number.isFinite(extremes.p5Eur) &&
      Number.isFinite(extremes.p95Eur) &&
      Object.values(extremes.offsets).every(Number.isFinite),
  );

  // ---- 11. Second-order recaptures (maternity return-to-work, div↔salary) ----
  // Maternity: cutting the paid second year sends a share of mothers back to
  // work → PIT+SSC recapture ON TOP of the benefit saving. Positive, scales
  // with months cut, 0 at no cut / no return (zero-draw identity component).
  const matFull = maternityReturnOffset(12, 0.45);
  check(
    `maternity full cut (45% return): recapture ${M(matFull)} ∈ [€55M, €72M]`,
    matFull >= 55e6 && matFull <= 72e6,
  );
  check(
    "maternity: 0 at no cut and at 0% return; ~half at 6 months",
    maternityReturnOffset(0, 0.45) === 0 &&
      maternityReturnOffset(12, 0) === 0 &&
      Math.abs(maternityReturnOffset(6, 0.45) - matFull / 2) < 1,
  );
  // Integration: a full maternity-cut scenario saves MORE dynamically than
  // statically (the recapture adds to the saving), bounded by the central band.
  const matIn: DynamicScenarioInput = {
    ...buildInput({}),
    maternityMonthsCut: 12,
    staticTotalEur: 154.2e6,
  };
  const matDyn = computeDynamicScenario(matIn, draws);
  check(
    `maternity cut: dynamic saving ${M(matDyn.dynamicHeadlineEur)} > static ${M(matIn.staticTotalEur)} by €30–80M`,
    matDyn.dynamicHeadlineEur > matIn.staticTotalEur + 30e6 &&
      matDyn.dynamicHeadlineEur < matIn.staticTotalEur + 80e6,
  );

  // Dividend↔salary: small, sign tracks the rate move (raise gains, cut loses),
  // and OFF the dividend line (the ФС dividend calibration in gate 2 is intact).
  const divRev = b.revenue.dividendEur;
  const shiftRaise = dividendShiftRecaptureEur(divRev, 0.05, 0.1, 4.5, 0.008);
  const shiftCut = dividendShiftRecaptureEur(divRev, 0.05, 0.03, 4.5, 0.008);
  const divLeverGate2 = divIn.staticDivDeltaEur + divDyn.offsets.dividend;
  check(
    `div↔salary: raise gains (${M(shiftRaise)}>0), cut loses (${M(shiftCut)}<0), |recapture| < 25% of the dividend lever`,
    shiftRaise > 0 &&
      shiftCut < 0 &&
      Math.abs(shiftRaise) < 0.25 * Math.abs(divLeverGate2) &&
      dividendShiftRecaptureEur(divRev, 0.05, 0.05, 4.5, 0.008) === 0,
  );

  if (failures > 0) {
    throw new Error(`${failures} behavioral invariant(s) failed`);
  }
  console.log("\nAll behavioral invariants hold.");
};

main();
