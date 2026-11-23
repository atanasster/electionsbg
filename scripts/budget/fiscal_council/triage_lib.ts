// Pure half of the Фискален съвет triage (triage.ts): the lever catalogue the
// model is asked about, the evidence gate over its answer, and the verdict.
//
// The question a new opinion raises is narrow: does it COST, or change the
// current-law value of, anything the budget simulator scores? (/budget/simulator;
// engine in src/lib/bgTaxPolicy.ts, grounding in docs/budget_simulator_grounding.md.)
// The model answers it measure by measure, and every measure must carry a
// verbatim quote from the publication. A quote that is not in the text drops
// the measure — the model's say-so is never the evidence.
//
// What the verdict may do is deliberately asymmetric:
//   none       — closes the operator item; the ledger keeps every measure the
//                model read and why it touches no lever, so the call is auditable;
//   lever      — at least one quoted measure affects a lever; stays OPEN until a
//                human updates the simulator (or rules it out) and resolves it;
//   unverified — the model named measures but none survived the gate, or it read
//                nothing at all; stays OPEN, because an unevidenced "nothing here"
//                is the one answer this step must never accept.

/** One entry per scoring function in bgTaxPolicy.ts. triage_lib.test.ts fails
 *  when a `score*` export has no entry, so a new lever cannot be invisible here. */
export const LEVERS: Record<string, string> = {
  scorePitFlat: "Personal income tax: the flat 10% rate",
  scorePitSchedule: "Personal income tax: a progressive schedule / brackets",
  scorePitUpperBracketsRange: "Personal income tax: upper-bracket ranges",
  scorePitNonEmployment:
    "Personal income tax on non-employment income (rent, freelance, capital)",
  scoreCorporate: "Corporate income tax rate (10%)",
  scoreDividend: "Dividend withholding tax rate (5%)",
  scoreModCap:
    "Social-security contributions: the maximum insurable income (МОД cap)",
  scoreModCapBands: "Social-security contributions: banded МОД cap variants",
  scorePensionIndexation:
    "Pension indexation rule (the чл. 100 КСО Swiss rule — CPI/wage weights)",
  scorePensionFloorRaise: "Minimum pension level",
  scoreAdminCut: "Public administration headcount / payroll cut",
  scoreMinWageFreeze: "Minimum wage (МРЗ) increase or freeze",
  scoreWageIndexation: "Public-sector wage indexation",
  scoreTeachersPeg: "Teachers' pay peg to the average wage",
  scoreMaternityMonths: "Maternity / child-raising benefit duration",
  scoreMpPayFreeze: "MPs' pay",
  scorePartySubsidy: "State subsidy for political parties",
  scoreDefenseTarget: "Defence spending as % of GDP",
  scoreCapitalChange: "Public capital (investment) spending",
  scoreSscSelfPaid:
    "Budget-paid contributions for state servants, police, military (shifting them to the employee)",
  scoreSscSelfPaidRetained:
    "Budget-paid contributions — variant with a compensating gross-up",
  scoreHealthContribution: "Health-insurance contribution rate (8%)",
  scoreExciseRate: "Excise rates (tobacco, fuel, alcohol)",
  scoreExcise: "Excise duties — general",
  scoreWineExcise: "Excise on wine",
  scoreGamblingGgr: "Gambling tax on gross gaming revenue",
  scoreRoadCharges: "Road charges (vignette, tolls)",
  scoreRoadComponentUplift: "Road-charge component uplift",
  scoreCollectionRealism:
    "Tax-collection realism (VAT gap, revenue over-forecast)",
  scoreSoeSubsidyCut: "Subsidies to state-owned enterprises",
  scoreSpendingChange: "Generic spending change by function",
};

export interface Measure {
  summary: string;
  quote: string;
  lever: string | null;
  affects: boolean;
  reason: string;
}

export type Verdict = "none" | "lever" | "unverified";

/** Whitespace, case, quote marks and hyphenation from pdftotext are noise;
 *  wording is not. */
const fold = (s: string): string =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[„“”"«»'‘’]/g, "")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A quote passes when it is in the text and long enough to say something. */
export const quoteInText = (quote: string, text: string): boolean => {
  const q = fold(quote);
  return q.length >= 20 && fold(text).includes(q);
};

export const gateMeasures = (
  measures: Measure[],
  text: string,
): { kept: Measure[]; dropped: Measure[] } => {
  const kept: Measure[] = [];
  const dropped: Measure[] = [];
  for (const m of measures) {
    const leverOk = m.lever == null || m.lever in LEVERS;
    (quoteInText(m.quote, text) && leverOk ? kept : dropped).push(m);
  }
  return { kept, dropped };
};

export const verdictOf = (kept: Measure[], dropped: Measure[]): Verdict => {
  if (kept.some((m) => m.affects && m.lever)) return "lever";
  // A lever claim that failed the gate is still a claim nobody checked.
  if (dropped.some((m) => m.affects)) return "unverified";
  if (kept.length === 0) return "unverified";
  return "none";
};

/** Publication slugs on the listing page, newest first, de-duplicated —
 *  the same parse the fiscal_council_bg watcher fingerprints. */
export const listingSlugs = (html: string): string[] => [
  ...new Set(
    [...html.matchAll(/href="\/bg\/publikacii\/([a-z0-9-]+)"/g)].map(
      (m) => m[1],
    ),
  ),
];

export interface LedgerEntry {
  verdict: Verdict | "pre-ledger";
  triagedAt: string;
  source?: string;
  model?: string;
  measures?: Measure[];
  dropped?: Measure[];
  /** Set by `--resolve <slug>` once a human has acted on a lever/unverified call. */
  resolvedAt?: string;
  resolution?: string;
}
export type Ledger = Record<string, LedgerEntry>;

/** The operator item is closed when the newest publication is triaged and no
 *  entry is left open. */
export const ledgerClosed = (
  ledger: Ledger,
  latest: string | undefined,
): boolean =>
  latest != null &&
  latest in ledger &&
  Object.values(ledger).every(
    (e) =>
      e.verdict === "none" ||
      e.verdict === "pre-ledger" ||
      e.resolvedAt != null,
  );
