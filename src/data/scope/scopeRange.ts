// Maps a Scope ("all" | "y:<year>" | "ns") to an
// INCLUSIVE [from, to] date pair (YYYY-MM-DD | null) for the date-scoped DB
// endpoints — awarder_procurement / company_procurement / company-counterparties
// all filter `date >= from AND date <= to`. This is the inclusive-bounds sibling
// of useScopeWindow (which yields half-open [from, to) for the client-side
// row filtering on the procurement section pages).
//
// Shared by the awarder/company dashboard and its standalone counterparty lists
// so their scope pills resolve to identical windows.

import allElections from "@/data/json/elections.json";
import { scopeYear, type Scope } from "./useScope";
import { newestFirst } from "./windows";

const elections = allElections as Array<{ name: string }>;
const dash = (d: string): string => d.replace(/_/g, "-");

// One calendar day before a YYYY-MM-DD date (UTC, so no timezone drift). The
// date-scoped DB endpoints filter `date <= to` (inclusive), so the "ns" window's
// upper bound must be the day *before* the next election to keep the parliament
// windows half-open — a contract dated exactly on the next election day belongs
// to that next parliament only. Mirrors the half-open [from, to) of
// useScopeWindow.
const dayBefore = (isoDash: string): string => {
  const d = new Date(`${isoDash}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export const scopeRange = (
  scope: Scope,
  selected: string,
): [string | null, string | null] => {
  if (scope === "all") return [null, null];
  const year = scopeYear(scope);
  if (year != null) return [`${year}-01-01`, `${year}-12-31`];
  // "ns": the next election sits one index earlier once the list is newest-first, and
  // the last (most recent) parliament is open-ended (to = null).
  //
  // SORTED, not assumed. windows.ts sorts explicitly and says why — "rather than trusting
  // the file's order" — and the settlement page reconciles the two helpers: its KPI cards
  // take their window from windows.ts and its contracts table from here. If elections.json
  // ever lands out of order, an unsorted read here would give the two halves DIFFERENT ns
  // windows, and the page would show one period's total above another period's rows.
  const sorted = newestFirst(elections);
  const idx = sorted.findIndex((e) => e.name === selected);
  return [
    dash(selected),
    idx > 0 ? dayBefore(dash(sorted[idx - 1].name)) : null,
  ];
};
