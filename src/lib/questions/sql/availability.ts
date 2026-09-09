/** Reviewed SQL adapters for existing chat questions. Kept free of SQL text so
 * the chat bundle can expose cross-surface links without importing recipes. */
export const REVIEWED_CHAT_SQL_ADAPTERS: Record<string, string> = {
  topContractors: "topContractors",
  procurementAppeals: "procurementAppeals",
  companyConnections: "companyConnections",
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
