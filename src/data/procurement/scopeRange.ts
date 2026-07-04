// Maps a procurement ProcurementScope ("all" | "y:<year>" | "ns") to an
// INCLUSIVE [from, to] date pair (YYYY-MM-DD | null) for the date-scoped DB
// endpoints — awarder_procurement / company_procurement / company-counterparties
// all filter `date >= from AND date <= to`. This is the inclusive-bounds sibling
// of useProcurementWindow (which yields half-open [from, to) for the client-side
// row filtering on the procurement section pages).
//
// Shared by the awarder/company dashboard and its standalone counterparty lists
// so their scope pills resolve to identical windows.

import allElections from "@/data/json/elections.json";
import { scopeYear, type ProcurementScope } from "./useProcurementScope";

const elections = allElections as Array<{ name: string }>;
const dash = (d: string): string => d.replace(/_/g, "-");

export const scopeRange = (
  scope: ProcurementScope,
  selected: string,
): [string | null, string | null] => {
  if (scope === "all") return [null, null];
  const year = scopeYear(scope);
  if (year != null) return [`${year}-01-01`, `${year}-12-31`];
  // "ns": elections.json is newest-first, so the next election sits one index
  // earlier; the last (most recent) parliament is open-ended (to = null).
  const idx = elections.findIndex((e) => e.name === selected);
  return [dash(selected), idx > 0 ? dash(elections[idx - 1].name) : null];
};
