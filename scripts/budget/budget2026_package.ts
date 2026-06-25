// Independent re-pricing of the FULL ЗДБРБ-2026 (State Budget 2026) consolidation
// package through our policy-simulator engine, measure by measure, over the live
// data/budget/derived/policy_baseline.json.
//
// For every consolidation measure the government tagged with a 2026 euro effect
// (Доклад на министъра + Съобщение за СМО, МФ, 24–25.06.2026) we record:
//   – govEur2026   : the government's stated 2026 budget effect
//   – effMonths    : months the measure is live in 2026 (01.08 → 5, 01.09 → 4)
//   – status       : how WE can treat it —
//        "modeled"  the engine prices it independently (printed: our full-year +
//                   our prorated-to-2026 figure, to compare like-for-like)
//        "asserted" no rate change to model; the gov number is a collection/
//                   admin assertion → run through the collection-realism haircut
//        "oneoff"   non-recurring (concession / fund draw) → counts in 2026 only
//        "neutral"  our model says ≈€0 net as designed (e.g. compensated reform)
//        "todo"     needs an ingestion we haven't built yet (flagged, gov number
//                   carried so the total is complete but honestly labelled)
//
// Usage: npx tsx scripts/budget/budget2026_package.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { resolveMod } from "../../src/lib/bgTax";
import {
  scoreRoadComponentUplift,
  scoreCollectionRealism,
  COLLECTION_REALISM_LOW,
  COLLECTION_REALISM_HIGH,
  VIGNETTE_BASE_EUR,
  scoreSoeSubsidyCut,
  SOE_SUBSIDY_BASE_EUR,
  SOE_SUBSIDY_REALISM_LOW,
  SOE_SUBSIDY_REALISM_HIGH,
  scoreExciseRate,
  EXCISE_CIGARETTE_RATE,
  cigaretteExciseRateEur,
  cigaretteAcceleratedRateEur,
  CIGARETTE_ACCELERATED_2026_BGN,
} from "../../src/lib/bgTaxPolicy";
import {
  scoreScenario,
  scoreDynamicScenario,
  type TaxChange,
} from "../../ai/tools/taxPolicy";
import type { PolicyBaselineFile } from "../../src/data/budget/types";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "../..");
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data/budget/derived/policy_baseline.json"),
    "utf-8",
  ),
) as PolicyBaselineFile;

const M = (v: number): string =>
  `${v >= 0 ? "+" : "−"}€${Math.abs(v / 1e6).toFixed(1)}M`;
const cap = resolveMod(null).mod; // current-law 2026 МОД cap our engine uses

// Engine helpers --------------------------------------------------------------
const dyn = (change: TaxChange): { full: number; band: [number, number] } => {
  const s = scoreScenario(baseline, change);
  const d = scoreDynamicScenario(baseline, change, s);
  return { full: d.headlineEur, band: [d.p5Eur, d.p95Eur] };
};

// МОД cap → €2,300 (full-year, dynamic), plus the "measured from the 2025 cap
// €1,917" view: the increment ratio scales the same dynamic figure.
const modDyn = dyn({ kind: "modCap", capEur: 2300 });
const modFrom2025Full = (modDyn.full * (2300 - 1917)) / (2300 - cap);

// Vignette +30% on the vignette-ONLY slice (the new split lever). Static; the
// vignette base is near-inelastic so we treat the dynamic ≈ static here.
const vignetteFull = scoreRoadComponentUplift("vignette", 0.3);

// Collection realism on the asserted "better collection" lines (+€200M tax,
// +€100M ДОО). These are already 2026 in-year numbers in the gov framing.
const COLLECTION_ASSERTED = 300e6;
const collectionCentral = scoreCollectionRealism(COLLECTION_ASSERTED);
const collectionBand: [number, number] = [
  scoreCollectionRealism(COLLECTION_ASSERTED, COLLECTION_REALISM_LOW),
  scoreCollectionRealism(COLLECTION_ASSERTED, COLLECTION_REALISM_HIGH),
];

// SOE-subsidy "optimisation" €285.3M — bankable share of the ~€316M envelope.
const SOE_ASSERTED = 285.3e6;
const soeCentral = scoreSoeSubsidyCut(SOE_ASSERTED);
const soeBand: [number, number] = [
  scoreSoeSubsidyCut(SOE_ASSERTED, SOE_SUBSIDY_REALISM_LOW),
  scoreSoeSubsidyCut(SOE_ASSERTED, SOE_SUBSIDY_REALISM_HIGH),
];
const soeShareOfEnvelope = SOE_ASSERTED / SOE_SUBSIDY_BASE_EUR;

// Tobacco excise calendar acceleration (01.08.2026) — NOT a consolidation line;
// it sits inside the baseline excise-revenue projection. Bottom-up from the
// published ЗАДС calendar: current €114/1000 → accelerated 2027-step €119.6/1000.
const tobaccoLineEur = baseline.revenue.exciseTobaccoEur;
const tobaccoPctChange =
  cigaretteAcceleratedRateEur() / EXCISE_CIGARETTE_RATE - 1;
const tobaccoStaticFull = scoreExciseRate(
  tobaccoLineEur,
  EXCISE_CIGARETTE_RATE,
  cigaretteAcceleratedRateEur(),
);
// Behavioral (Laffer/illicit) via the existing exciseTobacco % lever.
const tobaccoDyn = dyn({
  kind: "exciseTobacco",
  pct: Math.round(tobaccoPctChange * 100),
});

type Side = "rev" | "exp";
type Status = "modeled" | "asserted" | "oneoff" | "neutral" | "todo";
interface Measure {
  side: Side;
  label: string;
  govEur2026: number; // signed: revenue + / spending cut + (improves balance)
  effMonths: number;
  status: Status;
  ourFull?: number; // our full-year independent estimate (modeled only)
  our2026?: number; // our estimate prorated to the 2026 in-year window
  note: string;
}

const PRORATE = (full: number, months: number): number => (full * months) / 12;

const measures: Measure[] = [
  // ---- Revenue measures ----------------------------------------------------
  {
    side: "rev",
    label: "МОД cap €2,112→€2,300 (01.08)",
    govEur2026: 90.8e6,
    effMonths: 5,
    status: "modeled",
    ourFull: modDyn.full,
    our2026: PRORATE(modDyn.full, 5),
    note: `our full-yr ${M(modDyn.full)} [${M(modDyn.band[0])}..${M(modDyn.band[1])}]; gov €90.8M for 5mo ⇒ gov ≈ ${(90.8e6 / PRORATE(modDyn.full, 5)).toFixed(1)}× our run-rate. From-2025-cap view: full-yr ${M(modFrom2025Full)} (gov number consistent with bundling the routine Jan indexation €1,917→€2,112 into the "measure").`,
  },
  {
    side: "rev",
    label: "Min insurable thresholds above МРЗ (01.08)",
    govEur2026: 50.9e6,
    effMonths: 5,
    status: "asserted",
    our2026: scoreCollectionRealism(50.9e6, 0.7),
    note: `BOTTOM-UP BLOCKED AT SOURCE: the 2026 МОД-floor schedule IS the unadopted ЗБДОО-2026 proposal (floors frozen at old levels — mostly €550.66, below the €620.20 МРЗ, so non-binding — "until the budget is adopted"); the affected-worker distribution is non-public. The €50.9M is a НОИ-internal microsim of an unpublished table. Best we can do = realism 0.7 ⇒ bankable ${M(scoreCollectionRealism(50.9e6, 0.7))}.`,
  },
  {
    side: "rev",
    label: "Vignette +30% / toll step (01.08)",
    govEur2026: 53.3e6,
    effMonths: 5,
    status: "modeled",
    ourFull: vignetteFull,
    our2026: PRORATE(vignetteFull, 5),
    note: `NEW split lever: vignette base ${M(VIGNETTE_BASE_EUR)} × 30% = ${M(vignetteFull)}/yr (≈ gov's €53.3M, which is a 2026 in-year figure bundling the residual тол step). The old combined lever over-priced this at ≈€169M.`,
  },
  {
    side: "rev",
    label: 'Tax-collection "better collection" (+€200M) + ДОО (+€100M)',
    govEur2026: COLLECTION_ASSERTED,
    effMonths: 12,
    status: "asserted",
    ourFull: collectionCentral,
    our2026: collectionCentral,
    note: `collection-realism haircut: bankable ${M(collectionCentral)} [${M(collectionBand[0])}..${M(collectionBand[1])}] of €300M asserted ⇒ CREDIBILITY GAP ${M(COLLECTION_ASSERTED - collectionCentral)} (EC VAT-gap closes ~1pp/yr; one-year realisation partial).`,
  },
  {
    side: "rev",
    label: "Gambling package (affiliate fee + 10% player winnings)",
    govEur2026: 100e6,
    effMonths: 12,
    status: "asserted",
    our2026: scoreCollectionRealism(100e6, 0.5),
    note: `BOTTOM-UP PARTIAL: the modelable GGR-fee step (20→25%, ≈+€32M) is a SEPARATE measure our engine already prices (GAMBLING_GGR_FEE_RATE) and is not this €100M line. This €100M = affiliate two-part fee (€6k+10% commission; base non-public) + anti-grey enforcement (blocking unlicensed operators — the 2013 turnover-tax episode shows offshore migration) ⇒ realisation 0.5 ⇒ bankable ${M(scoreCollectionRealism(100e6, 0.5))}.`,
  },
  {
    side: "rev",
    label: "Sofia Airport concession",
    govEur2026: 50e6,
    effMonths: 12,
    status: "oneoff",
    note: "one-off / non-recurring concession revenue — counts in 2026, not a structural improvement.",
  },
  {
    side: "rev",
    label: "Modernisation Fund / EIB project draws",
    govEur2026: 100e6,
    effMonths: 12,
    status: "oneoff",
    note: "earmarked fund draw tied to specific approved projects — non-recurring, not a tax base.",
  },
  // ---- Expenditure measures ------------------------------------------------
  {
    side: "exp",
    label: "Avoided automatic wage mechanism (КТ чл.244 frozen)",
    govEur2026: 564.7e6,
    effMonths: 12,
    status: "asserted",
    note: "an AVOIDED cost, not a cut: the saving exists only vs a counterfactual where the formula fires. Our wage lever prices the +5% one-off applied at −€98M (separate).",
  },
  {
    side: "exp",
    label: "10% personnel-cost cut (01.09; many exemptions)",
    govEur2026: 85e6,
    effMonths: 4,
    status: "asserted",
    note: "carved-out base (MoI/army/municipalities/hospitals exempt); gov's €85M is a 4-month indicative figure.",
  },
  {
    side: "exp",
    label: "State employees self-pay SSC (80:20→full, WITH compensation)",
    govEur2026: 0,
    effMonths: 5,
    status: "neutral",
    note: "our engine: with net-income compensation the reform is ≈€0 in 2026 (the €253M raw saving exists only WITHOUT compensation). Structural/optical, not a 2026 deficit mover.",
  },
  {
    side: "exp",
    label: "SOE subsidy optimisation (БДЖ/НКЖИ/Пощи)",
    govEur2026: 285.3e6,
    effMonths: 12,
    status: "modeled",
    ourFull: soeCentral,
    our2026: soeCentral,
    note: `NEW lever: gov's €285.3M cut = ${(soeShareOfEnvelope * 100).toFixed(0)}% of the ~${M(SOE_SUBSIDY_BASE_EUR)} envelope (БДЖ≈€116M+НКЖИ≈€180M+Пощи≈€20M) — implausible as a hard operating-subsidy cut (PSO/infra contracts; 5% raise came след протести). Bankable ${M(soeCentral)} [${M(soeBand[0])}..${M(soeBand[1])}]; rest is avoided capital-contract indexation, not a realised cut.`,
  },
  {
    side: "exp",
    label:
      "Central-budget optimisation (СБРЗ / ЗОП indexation / асистентска подкрепа)",
    govEur2026: 545.5e6,
    effMonths: 12,
    status: "asserted",
    note: "largest single spending cut and the vaguest — no line detail; least falsifiable item in the package.",
  },
  {
    side: "exp",
    label: "Social-payments + ДОО-unemployment control",
    govEur2026: 220e6,
    effMonths: 12,
    status: "asserted",
    note: "€200M social-payments control + €20M ДОО; assertion of better targeting, no parametric change.",
  },
  {
    side: "exp",
    label: "Religious + party subsidy + COVID-supplement (new pensioners)",
    govEur2026: 10e6,
    effMonths: 6,
    status: "asserted",
    note: "religious €5M + party €2.1M + COVID-supplement €2.9M. Party-subsidy cut already in OUR baseline (€3.00/vote).",
  },
];

// ---------------------------------------------------------------------------
console.log(
  "============================================================================",
);
console.log(
  " ЗДБРБ-2026 consolidation package — independent re-pricing (Наясно engine)",
);
console.log(
  `   baseline year ${baseline.baselineYear}  ·  GDP(2026 proj) €${(baseline.gdpNextEur / 1e9).toFixed(1)}B  ·  current МОД cap €${cap}`,
);
console.log(
  "============================================================================\n",
);

const fmtRow = (m: Measure): void => {
  const ours =
    m.our2026 !== undefined ? `  ours(2026) ${M(m.our2026)}` : "  ours —";
  console.log(`[${m.status.toUpperCase().padEnd(8)}] ${m.label}`);
  console.log(`   gov(2026) ${M(m.govEur2026)}${ours}`);
  console.log(`   ${m.note}\n`);
};

console.log("──── REVENUE ────────────────────────────────────────────────\n");
measures.filter((m) => m.side === "rev").forEach(fmtRow);
console.log("──── EXPENDITURE ────────────────────────────────────────────\n");
measures.filter((m) => m.side === "exp").forEach(fmtRow);

// Totals --------------------------------------------------------------------
const govTotal = measures.reduce((a, m) => a + m.govEur2026, 0);
// Our independent 2026 total: use our2026 where modeled/asserted; for "todo" we
// carry the gov number (can't independently dispute yet); "oneoff" counts but is
// flagged separately; "neutral" contributes 0.
const ourTotal = measures.reduce((a, m) => {
  if (m.status === "neutral") return a + 0;
  if (m.our2026 !== undefined) return a + m.our2026;
  return a + m.govEur2026; // todo / asserted-without-model / oneoff
}, 0);
const oneoffTotal = measures
  .filter((m) => m.status === "oneoff")
  .reduce((a, m) => a + m.govEur2026, 0);
const collectionGap = COLLECTION_ASSERTED - collectionCentral;

console.log(
  "============================================================================",
);
console.log(" HEADLINE");
console.log(
  "============================================================================",
);
console.log(`  Government consolidation total (2026):   ${M(govTotal)}`);
console.log(`  Наясно independent total (2026):         ${M(ourTotal)}`);
console.log(
  `  Gap (gov over our estimate):             ${M(govTotal - ourTotal)}`,
);
console.log("");
console.log(
  `  – Collection-realism credibility gap:    ${M(collectionGap)} (of €300M asserted, ${M(collectionCentral)} bankable)`,
);
console.log(
  `  – Non-recurring (one-off) revenue:       ${M(oneoffTotal)} (airport + fund draws — not structural)`,
);
console.log(
  `  – МОД cap front-loading: gov books €90.8M/5mo vs our ${M(PRORATE(modDyn.full, 5))} for the same window`,
);
console.log(
  `  – Self-pay SSC reform nets ≈€0 (compensated), not a 2026 deficit mover`,
);
console.log("");
console.log(
  `  – SOE subsidy €285.3M = ${((285.3e6 / SOE_SUBSIDY_BASE_EUR) * 100).toFixed(0)}% of the ~${M(SOE_SUBSIDY_BASE_EUR)} envelope; bankable ${M(soeCentral)} (rest = avoided indexation)`,
);
console.log("");
console.log(
  "============================================================================",
);
console.log(
  " BASELINE EXCISE — ЗАДС tobacco-calendar acceleration (NOT in the total above)",
);
console.log(
  "============================================================================",
);
console.log(
  `  Bottom-up from the published ЗАДС calendar: 01.08.2026 pulls the 2027 step`,
);
console.log(
  `  (${CIGARETTE_ACCELERATED_2026_BGN} BGN ≈ €${cigaretteAcceleratedRateEur().toFixed(1)}/1000) forward from the 2026 level (€${cigaretteExciseRateEur(2026).toFixed(1)}/1000 ≈ €${EXCISE_CIGARETTE_RATE} default).`,
);
console.log(
  `  Step ≈ +${(tobaccoPctChange * 100).toFixed(1)}% on the €${(tobaccoLineEur / 1e6).toFixed(0)}M tobacco line:`,
);
console.log(
  `     static full-yr ${M(tobaccoStaticFull)}  ·  dynamic (Laffer/illicit) ${M(tobaccoDyn.full)}  [${M(tobaccoDyn.band[0])}..${M(tobaccoDyn.band[1])}]`,
);
console.log(
  `     prorated to Aug–Dec 2026 (5mo): static ${M(PRORATE(tobaccoStaticFull, 5))} · dynamic ${M(PRORATE(tobaccoDyn.full, 5))}`,
);
console.log(
  `  This is inside the baseline excise PROJECTION, not a consolidation line — it`,
);
console.log(
  `  tests whether the budget's excise-revenue growth assumption is realistic.`,
);
console.log("");
console.log(
  " BOTTOM-UP INGESTION SCORECARD: tobacco = real (published calendar). Gambling €100M",
);
console.log(
  " + МОД-floors €50.9M = blocked at source (affiliate base + 2026 ЗБДОО МОД annex are",
);
console.log(
  " non-public) → realism-haircut is the honest ceiling; see the notes above.",
);
