// The officials asset leaderboard, served from Postgres (matview
// officials_rankings_table, migration 100) via the generic /api/db/table registry engine.
// Plan: docs/plans/persons-pg-retirement-v1.md (T1.2).
//
// Replaces the two static files this used to fetch — data/officials/assets-rankings.json
// (960 KB, every row) and assets-rankings-top.json (276 KB) — which the /officials/assets
// explorer downloaded in full just to show 25 rows at a time.
//
// ---------------------------------------------------------------------------
// THE ROW SET IS NOT THE SAME AS THE JSON'S, AND THAT IS THE POINT.
//
// The JSON had one row per officials SLUG (14,496 of them). This has one row per PERSON
// holding an officials role. The difference is the person layer doing its job: one human
// who files once but holds two posts was two rows there and is one here. 100's header
// works the arithmetic; the short version is that per-row parity was never the goal and
// per-PERSON parity is exact.
//
// Two columns are new and must not be rendered as though they were the JSON's:
//   * `slug` is the PERSON slug (the /person URL). `official_slug` is the officials ref,
//     display-only — each person contributes just one of theirs, so it is not a lookup key.
//   * `has_declaration` distinguishes "filed, declared no valued assets" from "no
//     declaration on record", which both render as a NULL net worth. The JSON could not
//     express the second at all, because it was built FROM declarations.

import { useQuery } from "@tanstack/react-query";

/** One leaderboard row as the wire delivers it. The registry engine camelCases column
 *  names on the way out, so these are the matview's columns in camelCase.
 *
 *  MONEY ARRIVES AS A STRING. Postgres `numeric` has no lossless JS number, so node-pg
 *  hands it back as text and the engine passes it through — `"10972598.44"`, not
 *  10972598.44. Typed honestly here so a consumer cannot write `a.netWorthEur - b.…` and
 *  get string concatenation; use eur() below. */
export interface OfficialsRankingRow {
  /** The PERSON slug — the /person/<slug> URL. */
  slug: string;
  /** One of the person's officials refs. Display/debug only; never a lookup key. */
  officialSlug: string | null;
  name: string;
  category: string;
  source: string;
  isExec: boolean;
  isMuni: boolean;
  institution: string | null;
  positionTitle: string | null;
  /** NULL for an official with no wealth row — see hasDeclaration. */
  latestDeclarationYear: number | null;
  /** false = nothing on record. true with a NULL netWorthEur = filed, nothing valued. */
  hasDeclaration: boolean;
  /** >0 means the totals below are INCOMPLETE: 090 could not total an implausible declared
   *  row (a mortgage filed as a security at €3.58bn is the one case in the corpus). Render
   *  a caveat rather than the figures alone — and suppress the year-on-year delta, which
   *  differences a partial total against a whole one and invents a collapse. */
  excludedAssetRows: number;
  totalAssetsEur: string | null;
  totalDebtsEur: string | null;
  netWorthEur: string | null;
  realEstateCount: number;
  realEstateUnvalued: number;
  deltaPreviousYear: number | null;
  deltaAbsoluteEur: string | null;
  deltaPct: string | null;
}

/** Parse a numeric column. Returns null for a missing figure so callers can tell
 *  "no declaration" from "declared zero" — the distinction hasDeclaration exists for. */
export const eur = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface DbTablePage {
  rows: OfficialsRankingRow[];
  total: number;
  totalExact: boolean;
}

/** Top-N by declared net worth, for a dashboard tile. One page from the server, not a
 *  276 KB file sliced in the browser.
 *
 *  `is_exec` scopes it to the executive side, which is what /officials/assets and this
 *  tile have always shown — 503 people hold both an executive and a municipal post, so
 *  filtering on the representative `source` instead would drop 212 of them (100's header).
 *
 *  Rows with no net worth need no filter: buildOrder emits `DESC NULLS LAST`, so they sort
 *  behind every figure and a top-5 never reaches them. */
export const useOfficialsRankingsTop = (limit = 5) => {
  const { data, isLoading } = useQuery({
    queryKey: ["officials_rankings_top", limit] as [string, number],
    queryFn: async (): Promise<DbTablePage | undefined> => {
      const req = {
        resource: "officials_rankings",
        page: 0,
        pageSize: limit,
        sort: [{ id: "net_worth_eur", desc: true }],
        filters: { columns: [{ id: "is_exec", value: true }] },
      };
      const r = await fetch(
        `/api/db/table?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      // Throw rather than returning undefined: swallowing the failure renders an empty
      // tile that is indistinguishable from "no officials have declared assets", and
      // React Query cannot retry or report a resolved promise.
      if (!r.ok) throw new Error(`officials_rankings: ${r.status} ${r.url}`);
      return r.json();
    },
    staleTime: Infinity,
  });
  return { rows: data?.rows ?? [], total: data?.total ?? 0, isLoading };
};
