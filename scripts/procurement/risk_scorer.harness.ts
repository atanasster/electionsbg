// Behavioural regression harness for the per-contract procurement risk scorer
// (src/data/procurement/computeProcurementRisk.ts) — locks the two refined
// components introduced with the graded weak-competition + direct-award flags:
//
//   weakCompetition = single-bidder (non-structural, non-legally-single market)
//                     OR materially fewer bidders than the 5-digit CPV market
//                     norm (the graded arm).
//   directAward     = procedureBucket()==='direct' OR an explicit no-notice
//                     rationale — NOT публично състезание (which is competitive).
//
// Pure logic, no DB. Run: npx tsx scripts/procurement/risk_scorer.harness.ts
import {
  computeProcurementRisk,
  type RiskScoreArgs,
} from "@/data/procurement/computeProcurementRisk";
import type { ProcurementContract } from "@/data/dataTypes";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures += 1;
};

// A minimal, all-clean contract. Overrides layer the scenario on top.
const base = (over: Partial<ProcurementContract>): ProcurementContract =>
  ({
    key: "k",
    tag: "contract",
    awarderEik: "AW",
    awarderName: "Awarder",
    contractorEik: "CT",
    contractorName: "Contractor",
    ...over,
  }) as unknown as ProcurementContract;

// Baseline args: 45 = structurally single-bid (0.9 ≥ 0.8), 71 = competitive
// (0.2). 71311 market norm = 5 bidders. No debarred/concentration/mp/pep.
const args: RiskScoreArgs = {
  debarredByName: new Map(),
  concentrationByPair: new Map(),
  mpConnectedEiks: new Map(),
  pepConnectedEiks: new Set(),
  cpvSingleBidShare: new Map([
    ["45", 0.9],
    ["71", 0.2],
  ]),
  structuralSingleBidShare: 0.8,
  cpvBidderMedian: new Map([["71311", 5]]),
  normalizeName: (s) => s.trim().toLowerCase(),
};

const flags = (c: ProcurementContract) => computeProcurementRisk(c, args).flags;

console.log("risk scorer — weakCompetition + directAward");

// --- weakCompetition: single-bidder arm --------------------------------------
check(
  "single bidder in a competitive market → weakCompetition",
  flags(base({ cpv: "71311000", numberOfTenderers: 1 })).weakCompetition ===
    true,
);
check(
  "single bidder in a STRUCTURALLY single-bid market → suppressed",
  flags(base({ cpv: "45000000", numberOfTenderers: 1 })).weakCompetition ===
    false,
);
check(
  "single bidder on a legally-single source (22112xxx) → suppressed",
  flags(base({ cpv: "22112000", numberOfTenderers: 1 })).weakCompetition ===
    false,
);

// --- weakCompetition: graded (below-market-norm) arm -------------------------
check(
  "2 bidders where the 71311 market norm is 5 → weakCompetition (graded)",
  flags(base({ cpv: "71311000", numberOfTenderers: 2 })).weakCompetition ===
    true,
);
check(
  "bidders AT the market norm (5 of 5) → not flagged",
  flags(base({ cpv: "71311000", numberOfTenderers: 5 })).weakCompetition ===
    false,
);
check(
  "bidders ABOVE the market norm (6 of 5) → not flagged",
  flags(base({ cpv: "71311000", numberOfTenderers: 6 })).weakCompetition ===
    false,
);
check(
  "multi-bidder in a market with NO norm entry → not flagged",
  flags(base({ cpv: "79999000", numberOfTenderers: 2 })).weakCompetition ===
    false,
);

// --- weakCompetition availability -------------------------------------------
{
  const r = computeProcurementRisk(
    base({ cpv: "71311000" }), // numberOfTenderers undefined
    args,
  );
  const comp = r.components.find((c) => c.key === "weakCompetition");
  check(
    "unknown bid count → weakCompetition component unavailable",
    comp !== undefined && comp.available === false && comp.fired === false,
    JSON.stringify(comp),
  );
}

// --- directAward -------------------------------------------------------------
check(
  "пряко договаряне (bucket direct) → directAward",
  flags(base({ procurementMethod: "Пряко договаряне" })).directAward === true,
);
check(
  "договаряне без обявление → directAward",
  flags(base({ procurementMethod: "Договаряне без предварително обявление" }))
    .directAward === true,
);
check(
  "ПУБЛИЧНО СЪСТЕЗАНИЕ (competitive) → NOT directAward (the narrowing)",
  flags(base({ procurementMethod: "Публично състезание" })).directAward ===
    false,
);
check(
  "Открита процедура (open) → NOT directAward",
  flags(base({ procurementMethod: "Открита процедура" })).directAward === false,
);
check(
  "open procedure WITH a no-notice rationale → directAward (rationale arm)",
  flags(
    base({
      procurementMethod: "Открита процедура",
      procurementMethodRationale: "чл. 79 ал.1 т.3",
    }),
  ).directAward === true,
);
{
  const r = computeProcurementRisk(base({}), args); // no method, no rationale
  const comp = r.components.find((c) => c.key === "directAward");
  check(
    "no method + no rationale → directAward component unavailable",
    comp !== undefined && comp.available === false,
    JSON.stringify(comp),
  );
}

// --- scoring: weights + CRI = fired/available -------------------------------
{
  const clean = computeProcurementRisk(
    base({ cpv: "71311000", numberOfTenderers: 6 }),
    args,
  );
  check(
    "all-clean contract → cri 0, score 0",
    clean.cri === 0 && clean.score === 0,
  );

  const single = computeProcurementRisk(
    base({ cpv: "71311000", numberOfTenderers: 1 }),
    args,
  );
  check(
    "single-bidder contributes +40 to the score",
    single.score === 40,
    `score=${single.score}`,
  );
  check(
    "cri = round(100 * fired/available) and is > 0 when a flag fires",
    single.cri ===
      Math.round((100 * single.firedCount) / single.availableCount) &&
      single.cri > 0,
    `fired=${single.firedCount}/${single.availableCount} cri=${single.cri}`,
  );

  const direct = computeProcurementRisk(
    base({
      procurementMethod: "Пряко договаряне",
      numberOfTenderers: 6,
      cpv: "71311000",
    }),
    args,
  );
  check(
    "direct award contributes +20 to the score",
    direct.score === 20,
    `score=${direct.score}`,
  );

  // Annex value growth (ЗОП чл.116 ал.2 cap = 50% cumulative).
  const grewToCap = flags(base({ signingAmountEur: 100, amountEur: 150 }));
  check(
    "signed 100 → current 150 (+50%) → annexGrowth fires",
    grewToCap.annexGrowth === true && grewToCap.annexGrowthPct === 0.5,
  );
  const grewBelowCap = computeProcurementRisk(
    base({ signingAmountEur: 100, amountEur: 120 }),
    args,
  );
  check(
    "signed 100 → current 120 (+20%) → annexGrowth available but NOT fired",
    grewBelowCap.flags.annexGrowth === false &&
      grewBelowCap.components.find((c) => c.key === "annexGrowth")
        ?.available === true,
  );
  const noAnnex = computeProcurementRisk(base({ amountEur: 100 }), args);
  check(
    "no signingAmountEur → annexGrowth UNAVAILABLE",
    noAnnex.components.find((c) => c.key === "annexGrowth")?.available ===
      false,
  );

  // New-firm winner (contractor founded < 12 months before the award).
  const founded = { ...args, foundedByEik: new Map([["CT", "2024-01-01"]]) };
  const newFirm = computeProcurementRisk(
    base({ contractorEik: "CT", dateSigned: "2024-04-01" }),
    founded,
  );
  check(
    "founded 2024-01, award 2024-04 (~3mo) → newFirmWinner fires",
    newFirm.flags.newFirmWinner === true && newFirm.flags.newFirmMonths === 2,
    `months=${newFirm.flags.newFirmMonths}`,
  );
  const oldFirm = computeProcurementRisk(
    base({ contractorEik: "CT", dateSigned: "2028-01-01" }),
    founded,
  );
  check(
    "founded 2024-01, award 2028-01 (48mo) → available but NOT fired",
    oldFirm.flags.newFirmWinner === false &&
      oldFirm.components.find((c) => c.key === "newFirmWinner")?.available ===
        true,
  );
  const unknownFirm = computeProcurementRisk(
    base({ contractorEik: "OTHER", dateSigned: "2024-04-01" }),
    founded,
  );
  check(
    "contractor not in foundedByEik → newFirmWinner UNAVAILABLE",
    unknownFirm.components.find((c) => c.key === "newFirmWinner")?.available ===
      false,
  );
}

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — risk scorer weakCompetition + directAward`,
);
process.exit(failures === 0 ? 0 : 1);
