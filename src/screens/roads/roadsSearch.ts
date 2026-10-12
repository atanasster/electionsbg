// The /sector/roads finder's sources — pure data, no JSX. Plan T6.
//
// Three groups:
//
//   · corridors — a CLIENT index over the hub blob's corridor list
//     (data/roads/derived/hub_stats.json). Not over the engine's MOTORWAYS table
//     (unexported) and not over the ~3k-row contract corpus, which the hub must
//     not download (dashboard-hub §1). This group IS sector-scoped.
//   · contractors and contracts — the shared `procurement-search` route, ONE
//     memoised request per needle for both groups (dashboard-hub §4). That route
//     takes no sector argument, so both groups say in their labels that they
//     search the whole register; a group that cannot be scoped is labelled,
//     never presented as scoped (the culture finder's rule).

import { MapPinned } from "lucide-react";
import type {
  HubSearchSource,
  IndexSource,
} from "@/ux/search/hubSearchSources";
import { buildEntityIndex, type EntityIndex } from "@/lib/entitySearchIndex";
import { wholeRegisterSources } from "@/screens/components/search/wholeRegisterSources";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import { formatEurCompact } from "@/lib/currency";
import { ROADS_PATHS } from "./roadsRegistry";

/** Corridors from the blob; each opens the network page focused on it.
 *
 *  ⚠️ NO ОПУ ROWS. The procurement page has no per-oblast filter, and its ОПУ
 *  tile keeps only directorates with ≥3 bid-known contracts, top 12 by share —
 *  so a region hit would land on a list that, for most of the 27, never names
 *  it. A finder row must land somewhere that shows the subject. */
export const roadsPlacesIndex = (
  s: RoadsHubStats,
  lang: string,
  bg: boolean,
): EntityIndex =>
  buildEntityIndex(
    s.corridorIndex,
    (c) => ({
      id: `corridor-${c.corridor}`,
      label: c.corridor,
      sub: `${bg ? "коридор" : "corridor"} · ${formatEurCompact(c.eur, lang)}`,
      href: `${ROADS_PATHS.network}?corridor=${encodeURIComponent(c.corridor)}&pscope=all`,
    }),
    (c) => [c.corridor],
  );

export const roadsSearchSources = (
  s: RoadsHubStats | null | undefined,
  lang: string,
  bg: boolean,
): HubSearchSource[] => [
  // The places group only exists once the blob has loaded — without it there is
  // nothing true to index, and an empty index would answer „no such corridor".
  ...(s
    ? [
        {
          kind: "index",
          id: "places",
          label: { bg: "Пътни коридори", en: "Road corridors" },
          icon: MapPinned,
          limit: 6,
          index: roadsPlacesIndex(s, lang, bg),
        } as IndexSource,
      ]
    : []),
  ...wholeRegisterSources(bg),
];
