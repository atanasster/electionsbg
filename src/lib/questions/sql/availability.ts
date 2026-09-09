/** Reviewed SQL adapters for existing chat questions. Kept free of SQL text so
 * the chat bundle can expose cross-surface links without importing recipes. */
export const REVIEWED_CHAT_SQL_ADAPTERS: Record<string, string> = {
  topContractors: "topContractors",
  procurementAppeals: "procurementAppeals",
  companyConnections: "companyConnections",
  municipalFiscalRanking: "municipalFiscalRanking",
  personWealth: "personWealth",
};

/** Canonical relations/functions behind each dual-ready capability. Keep this
 * beside availability so chat discovery and SQL coverage report the same
 * provenance without importing SQL text into the AI bundle. */
export const REVIEWED_CHAT_SQL_SOURCES: Record<string, string[]> = {
  topContractors: ["contractor_rank"],
  procurementAppeals: ["kzk_appeals_summary_cache"],
  companyConnections: ["company_political_links"],
  municipalFiscalRanking: ["municipal_fiscal_ranking"],
  personWealth: ["person", "person_wealth_series"],
};

export const questionSqlHref = (
  capabilityId: string,
  version: number,
  parameters: Record<string, string | number | boolean>,
) => {
  const search = new URLSearchParams({ q: capabilityId, v: String(version) });
  for (const [key, value] of Object.entries(parameters))
    search.set(`p.${key}`, String(value));
  return `/db?${search.toString()}`;
};
