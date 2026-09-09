export const MUNICIPAL_FISCAL_LATEST_VALIDATED_YEAR = 2024;
export const MUNICIPAL_FISCAL_MAX_RESULTS = 100;
export const MUNICIPAL_FISCAL_METRICS = [
  "commitments",
  "expense_obligations",
  "arrears",
] as const;
export type MunicipalFiscalMetric = (typeof MUNICIPAL_FISCAL_METRICS)[number];
