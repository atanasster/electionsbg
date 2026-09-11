import type { Envelope } from "../../tools/types";
export type NarrationCase = {
  id: string;
  split: "development" | "validation";
  facts: Envelope["facts"];
  baseFacts?: Envelope["facts"];
  rubric: string;
};
// Frozen before the new experiment. Only invented records/figures.
export const NARRATION_CASES: NarrationCase[] = [
  {
    id: "turnout",
    split: "development",
    facts: { turnout_2024: "40%", turnout_2025: "30%" },
    rubric:
      "Turnout falls; no computed difference and no claim about interest/motivation.",
  },
  {
    id: "contract",
    split: "development",
    facts: {
      awarded_contract_value_eur: "200000",
      paid_amount: "unknown",
      note: "Awarded contract value is not proof of payment.",
    },
    rubric:
      "Contract value is200000, actual payment unknown; no spending claim.",
  },
  {
    id: "risk",
    split: "development",
    facts: { screening_signals: 2, note: "Signals are not proven wrongdoing." },
    rubric: "Two signals; no inferred high/low/minimal risk or corruption.",
  },
  {
    id: "assets",
    split: "development",
    facts: {
      declared_assets_eur: "600000",
      declared_debts_eur: "100000",
      note: "Self-declared; no independent audit or salary supplied.",
    },
    rubric: "Declared assets/debts only; no computed net worth or salary.",
  },
  {
    id: "turnout-rise",
    split: "validation",
    facts: { turnout_2022: "28%", turnout_2023: "42%" },
    rubric:
      "Turnout rises; years and values remain correctly attributed; no computed difference, ratio or public-interest inference.",
  },
  {
    id: "unpaid-unknown",
    split: "validation",
    facts: {
      awarded_contract_value_eur: "900000",
      paid_amount: "unknown",
      note: "Payment data is not available.",
    },
    rubric:
      "Award value is900000, payment unknown not zero; no implication that award value was paid.",
  },
  {
    id: "risk-eight",
    split: "validation",
    facts: {
      screening_signals: 8,
      note: "No denominator, risk classification or finding of wrongdoing is provided.",
    },
    rubric:
      "Eight signals; no high/low/minimal/severe classification, causality or proven wrongdoing.",
  },
  {
    id: "assets-small",
    split: "validation",
    facts: {
      declared_assets_eur: "90000",
      declared_debts_eur: "20000",
      note: "Self-declared, not audited. Salary not available.",
    },
    rubric:
      "Assets90000 debts20000 are declarations; no computed70000 net worth and no salary inference.",
  },
  {
    id: "tax-rates",
    split: "validation",
    baseFacts: { place: "Example City", indicators: 1 },
    facts: {
      place: "Example City",
      indicators: 1,
      "Property tax — local rate": "3 %",
      "Property tax — national average": "2 %",
    },
    rubric:
      "Candidate can state3% local versus2% average; no calculated difference or causal claim. Baseline has no supplied rates and must not invent them. Rate visibility is a separate usefulness check.",
  },
];
