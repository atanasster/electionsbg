import { useQuery } from "@tanstack/react-query";
import type { MpAssetsRankings } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

/** One MP-wealth leaderboard row as the /api/db/table `mp_assets_rankings` resource
 *  (matview mp_assets_rankings_table, migration 105) delivers it — the matview columns in
 *  camelCase. The FIGURES ARE NOT THE JSON'S: they come from person_wealth_year, so the ~154
 *  MPs who declare company shares read lower than the retired assets-rankings.json (which
 *  folded those shares in) — one number sitewide, matching the wealth chart and /person.
 *
 *  MONEY ARRIVES AS A STRING — Postgres numeric has no lossless JS number, so node-pg passes
 *  it through as text; use eur() to parse. (persons-pg-retirement-v1 T2.2) */
export interface MpAssetsRankingRow {
  mpId: number;
  personSlug: string | null;
  name: string;
  partyGroupShort: string | null;
  isCurrent: boolean;
  /** When the filing was LODGED (label it). */
  latestDeclarationYear: number | null;
  latestFiscalYear: number | null;
  /** What the filing COVERS — join the wealth chart on this, not latestDeclarationYear. */
  periodYear: number | null;
  /** false = nothing on record; true with a NULL netWorthEur = filed, nothing valued. */
  hasDeclaration: boolean;
  totalAssetsEur: string | null;
  totalDebtsEur: string | null;
  netWorthEur: string | null;
  realEstateCount: number;
  realEstateUnvalued: number;
  deltaPreviousYear: number | null;
  deltaAbsoluteEur: string | null;
  deltaPct: string | null;
}

/** Parse a numeric column; null for a missing figure (so "no declaration" stays distinct
 *  from "declared zero"). */
export const eur = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const queryFn = async (): Promise<MpAssetsRankings | undefined> => {
  const response = await fetch(dataUrl(`/parliament/assets-rankings.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useAssetsRankings = (options?: { enabled?: boolean }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets_rankings"] as [string],
    queryFn,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
  return { rankings: data, isLoading };
};

/** Top-N MP-wealth rows from the PG registry — one page from the server, not the whole file
 *  sliced in the browser. Scoped to an ns bucket ("52" | "all"); pass `mpIds` to restrict to
 *  a region/party set (the empty-set sentinel is handled by the caller). Mirrors
 *  useOfficialsRankingsTop. (persons-pg-retirement-v1 T2.2) */
export const useMpAssetsTopRows = (opts: {
  ns: string;
  mpIds?: number[] | null;
  limit?: number;
  enabled?: boolean;
}): { rows: MpAssetsRankingRow[]; isLoading: boolean } => {
  const { ns, mpIds, limit = 5, enabled = true } = opts;
  const { data, isLoading } = useQuery({
    // mpIds sorted into the key so the same set caches regardless of order.
    queryKey: [
      "mp_assets_top",
      ns,
      mpIds ? [...mpIds].sort((a, b) => a - b) : null,
      limit,
    ] as const,
    queryFn: async (): Promise<MpAssetsRankingRow[]> => {
      const req: Record<string, unknown> = {
        resource: "mp_assets_rankings",
        page: 0,
        pageSize: limit,
        sort: [{ id: "net_worth_eur", desc: true }],
        scope: { col: "ns", val: ns },
      };
      if (mpIds) req.filters = { columns: [{ id: "mp_id", value: mpIds }] };
      const r = await fetch(
        `/api/db/table?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) throw new Error(`mp_assets_rankings: ${r.status} ${r.url}`);
      const page = (await r.json()) as { rows?: MpAssetsRankingRow[] };
      return page.rows ?? [];
    },
    enabled,
    staleTime: Infinity,
  });
  return { rows: data ?? [], isLoading };
};

// Top-50 slim variant. Use from dashboard tiles that render only the top 5
// rows. PartyMpAssetsTile and useMpScorecard still need the full file —
// they look up specific MPs that may be far down the list.
const queryFnTop = async (): Promise<MpAssetsRankings | undefined> => {
  const response = await fetch(dataUrl(`/parliament/assets-rankings-top.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useAssetsRankingsTop = (options?: { enabled?: boolean }) => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_assets_rankings_top"] as [string],
    queryFn: queryFnTop,
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
  return { rankings: data, isLoading };
};
