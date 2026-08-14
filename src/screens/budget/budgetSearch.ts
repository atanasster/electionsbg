// The /budget finder's sources — pure data, no JSX.
//
// Plan: docs/plans/budget-hub-v1.md T5.4. Fourteen tiles front the module, and a
// reader who arrives already knowing their subject — „Министерство на отбраната",
// „Пловдив" — had to guess which tile contained it.
//
// ===========================================================================
// TWO SUBJECTS, BOTH SERVER-BACKED, AND NO SCOPE SPLIT.
//
// The subjects are the two things this module names: the 55 ПЪРВОСТЕПЕННИ
// РАЗПОРЕДИТЕЛИ and the 265 ОБЩИНИ. Both are server sources — each list is
// already behind a route the sub-pages use, so there is nothing to download and
// nothing to fold at build time.
//
// NO `scopedSources` HERE, deliberately. The scope rule exists for a hub whose
// selector would otherwise FILTER — /parliament splits by the selected
// Assembly, so a member of the 44th stays findable from the 52nd. /budget's
// year selector lives on the SUB-PAGES, not on the hub, and both destinations
// already list every subject regardless of year: `/budget/ministries` lists
// every unit ever so each `/budget/ministry/:id` stays reachable, and
// `/budget/municipal` carries all 265 in every year it has. A split here would
// invent a scope the corpus does not have and produce a permanently empty
// second group.
// ===========================================================================

import { Building2, Landmark } from "lucide-react";
import type { SearchItem } from "@/ux/search/EntitySearchTile";
import type { HubSearchSource } from "@/ux/search/hubSearchSources";

interface AdminHit {
  nodeId: string;
  nameBg: string | null;
  nameEn: string | null;
  amount: number | null;
}
interface MuniHit {
  obshtina: string;
  nameBg: string | null;
  nameEn: string | null;
}

/** Throw rather than return []: HubSearch tells a failed fetch apart from an
 *  empty one and omits a failed group from its „searched in: …" sentence. */
const json = async <T>(url: string, signal: AbortSignal): Promise<T> => {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
};

const fetchUnits = async (
  query: string,
  signal: AbortSignal,
  fy: number | null,
  bg: boolean,
): Promise<SearchItem[]> => {
  const params = new URLSearchParams({ q: query });
  if (fy != null) params.set("fy", String(fy));
  const body = await json<{ rows?: AdminHit[] }>(
    `/api/db/budget-ministries?${params}`,
    signal,
  );
  return (body.rows ?? []).slice(0, 6).map((r) => ({
    id: r.nodeId,
    // Straight to the unit's own page — the one parameterised route this module
    // has, and the reason its picker exists.
    to: `/budget/ministry/${r.nodeId}`,
    primary: (bg ? r.nameBg || r.nameEn : r.nameEn || r.nameBg) || r.nodeId,
    icon: Landmark,
  }));
};

const fetchMunicipalities = async (
  query: string,
  signal: AbortSignal,
  fy: number | null,
  bg: boolean,
): Promise<SearchItem[]> => {
  const params = new URLSearchParams({ q: query, limit: "6" });
  if (fy != null) params.set("fy", String(fy));
  const body = await json<{ rows?: MuniHit[] }>(
    `/api/db/budget-municipal?${params}`,
    signal,
  );
  return (body.rows ?? []).slice(0, 6).map((r) => ({
    id: r.obshtina,
    // There is no per-municipality budget PAGE, so the row lands on the list
    // filtered to it — a destination that can actually serve the query, which
    // is the rule a „see all" broke twice on other hubs.
    to: `/budget/municipal?q=${encodeURIComponent(
      (bg ? r.nameBg || r.nameEn : r.nameEn || r.nameBg) || r.obshtina,
    )}`,
    primary: (bg ? r.nameBg || r.nameEn : r.nameEn || r.nameBg) || r.obshtina,
    icon: Building2,
  }));
};

export const budgetSearchSources = (opts: {
  /** The hub's fiscal year, passed through so a hit's figures match the page
   *  the reader lands on. NOT a filter: both routes list every subject. */
  fy: number | null;
  bg: boolean;
}): HubSearchSource[] => {
  const { fy, bg } = opts;
  return [
    {
      id: "units",
      kind: "server",
      label: { bg: "Разпоредители с бюджет", en: "Spending units" },
      icon: Landmark,
      limit: 6,
      // `/budget/ministries` READS `?q` — verified against the screen (it seeds
      // its search box from it), which is the check a see-all needs before it
      // may exist at all. A link advertising a filtered destination and
      // delivering an unfiltered one has shipped twice on other hubs.
      seeAll: (q) => ({
        label: bg ? "Всички разпоредители" : "All spending units",
        to: `/budget/ministries?q=${encodeURIComponent(q)}`,
      }),
      fetch: (q, signal) => fetchUnits(q, signal, fy, bg),
    },
    {
      id: "municipalities",
      kind: "server",
      label: { bg: "Общини", en: "Municipalities" },
      icon: Building2,
      limit: 6,
      // `/budget/municipal` reads `?q` too, and sends it to the server.
      seeAll: (q) => ({
        label: bg ? "Всички общини" : "All municipalities",
        to: `/budget/municipal?q=${encodeURIComponent(q)}`,
      }),
      fetch: (q, signal) => fetchMunicipalities(q, signal, fy, bg),
    },
  ];
};
