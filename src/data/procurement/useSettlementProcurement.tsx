// Per-settlement procurement detail (one EKATTE) — the awarder breakdown + top contracts
// behind /procurement/settlement/:ekatte and the My-Area / settlement tiles.
//
// The LANDING index that used to live here is gone: /procurement/by-settlement now reads a
// server-paginated ranking (the `procurement_settlements` table resource) plus a precomputed
// map payload (useProcurementGeo), so nothing fetches the whole settlement list any more.
//
// Methodology lives in procurement_by_settlement() (migration 030). Buyer HQ is the location
// proxy — central ministries and national state companies are excluded from per-settlement
// pins (they roll up into the "national procurement" card).
//
// SCOPED, as of the ?pscope work: every caller names the time window it wants. The detail
// page passes the reader's scope; the tiles, which sit on pages with no scope control,
// pass CORPUS_WINDOW. See the note on the hook for the half-open bound convention.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ProcurementBySettlementFile } from "@/data/dataTypes";

/** A [from, to) date window for the detail endpoint, or the full corpus. */
export type SettlementWindow = {
  readonly from: string | null;
  readonly to: string | null;
};

/** The full corpus — every year on record.
 *
 *  REQUIRED at every call site, with no default, so that choosing a window is always a
 *  visible decision. The tiles that pass this live on pages with NO scope control: if the
 *  hook silently defaulted to the active scope they would re-anchor to one parliament and
 *  every number on them would change with nothing failing. A default of "corpus" would be
 *  safe today but would make forgetting to wire a new scope-aware caller equally silent —
 *  so neither default is written, and the compiler asks. */
export const CORPUS_WINDOW: SettlementWindow = Object.freeze({
  from: null,
  to: null,
});

/** Per-settlement procurement (one EKATTE), DB-backed (/api/db/procurement-
 *  settlement → procurement_settlement_detail). Null when the settlement has no
 *  local-tier procurement on record in the requested window.
 *
 *  ⚠ The window is HALF-OPEN [from, to), because procurement_settlement_detail filters
 *  `ct.date >= p_from AND ct.date < p_to` (030_procurement_by_settlement.sql).
 *  That is useScopeWindow's shape exactly, so its {from, to} can be handed over as-is.
 *
 *  The codebase carries BOTH conventions, and each one silently loses a day in the other's
 *  endpoint — in opposite directions:
 *    • scopeRange's pair is INCLUSIVE (y:2024 → to "2024-12-31"), for the `date <= to`
 *      endpoints. Passed HERE, `date < '2024-12-31'` DROPS 31 December.
 *    • useScopeWindow's pair is exclusive (y:2024 → to "2025-01-01"). Passed to a
 *      `date <= to` endpoint — such as the contracts DbDataTable's `date` range filter —
 *      it ADMITS 1 January of the next year.
 *  So a table meant to reconcile with THIS payload must stop a day short of `to`. */
export const useSettlementProcurement = (
  ekatte: string | null | undefined,
  win: SettlementWindow,
  /** Ask for the tile shape: totals + the top few buyers instead of all of them.
   *  Read `awarderCount` (never `awarders.length`) for the buyer KPI under this. */
  opts: { slim?: boolean } = {},
) =>
  useQuery({
    // The window is part of the key: without it, flipping the scope control re-renders
    // the previous period's numbers under the new label and never refetches.
    queryKey: [
      "procurement",
      "settlement_detail",
      ekatte,
      win.from,
      win.to,
      opts.slim ? "slim" : "full",
    ] as const,
    queryFn: async (): Promise<ProcurementBySettlementFile | null> => {
      const params = new URLSearchParams({ ekatte: ekatte as string });
      if (win.from) params.set("from", win.from);
      if (win.to) params.set("to", win.to);
      if (opts.slim) params.set("slim", "1");
      const r = await fetch(`/api/db/procurement-settlement?${params}`);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ProcurementBySettlementFile | null;
    },
    enabled: !!ekatte && /^\d{5}$/.test(ekatte),
    staleTime: Infinity,
    // Keep the prior window's payload on screen while a scope switch refetches. Without
    // it every toggle routes the page through its loading branch, which unmounts the
    // scope pill at the moment it is being used — and takes the contracts table's page,
    // sort and search state with it. Same reason useCounterparties does this.
    placeholderData: keepPreviousData,
  });
