// /api/db/open-calls — what a reader can apply to right now.
//
// THREE GROUPS, NEVER ONE LIST. The route returns them separately and this hook keeps them
// separate, because merging them is the single most misleading thing this feature could do:
//   calls         — a real application procedure, with an exact deadline
//   indicative    — the ДФЗ forecast window; a MONTH RANGE, no deadline exists yet
//   consultations — draft guidance out for public COMMENT; applications are not open
// See docs/plans/funds-module-v2.md invariants 2 and 7.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/data/judiciary/fetchJson";

/** One row as the route serves it.
 *
 *  The field set is NARROW ON PURPOSE and matches the route's projection: `docs` and `objective`
 *  were 56% of the payload with nothing rendering either, on a hub page every visitor loads. Add
 *  a field back here AND in the route's SELECT when a consumer actually displays it.
 *
 *  Money fields are NULL unless the source published them structurally or a human reviewed an
 *  extraction (migration 142's `enrichment` CHECK), so anything non-null here is vouched for. */
export interface OpenCallRow {
  id: number;
  source: string;
  sourceKey: string;
  code: string | null;
  kind: "call" | "consultation";
  title: string;
  programmeName: string | null;
  /** Derived at QUERY TIME from closes_at (142) — never stored, so a dead crawler under-reports
   *  rather than showing an expired call as open. `upcoming` shares the calls group and MUST be
   *  marked in the UI: it is a real call that has not opened yet. */
  status: "open" | "upcoming" | "indicative" | "consultation" | "closed";
  opensAt: string | null;
  closesAt: string | null;
  periodLabel: string | null;
  /** NULL for an indicative window AND for a call whose deadline has passed — a closed call
   *  has no days left, it has none. Never 0-clamped. */
  daysLeft: number | null;
  budgetEur: number | null;
  aidRatePct: number | null;
  grantMaxEur: number | null;
  audience: string[];
  sourceUrl: string;
  enrichment: "none" | "source" | "auto" | "reviewed";
}

/** Per-source freshness. SEPARATE from the rows so „this source returned nothing“ and „we
 *  never looked“ stay distinguishable — the banner needs to say which. */
export interface OpenCallsCrawl {
  source: string;
  crawledAt: string;
  rowsSeen: number;
  ok: boolean;
  note: string | null;
}

export interface OpenCallsResponse {
  calls: OpenCallRow[];
  indicative: OpenCallRow[];
  consultations: OpenCallRow[];
  crawl: OpenCallsCrawl[];
  /** How many rows each group HAS, not how many were returned. The tile is a preview and the
   *  route is limited, so `calls.length` is the page size — a heading counting it announced 20
   *  beside a /funds/calls page showing 45. Never derive a displayed count from the array. */
  totals: { calls: number; indicative: number; consultations: number };
}

export const useOpenCalls = (
  opts: {
    limit?: number;
    /** Array-containment facet ('business' | 'farmer' | 'municipality' | …). Wired through to
     *  the route and covered by its tests; no UI passes it yet — the audience picker is a later
     *  stage of the plan. Kept here so the query key already partitions on it. */
    audience?: string;
  } = {},
) => {
  const { limit = 20, audience } = opts;
  return useQuery({
    queryKey: ["open-calls", limit, audience ?? ""] as const,
    queryFn: async (): Promise<OpenCallsResponse> => {
      const p = new URLSearchParams({ limit: String(limit) });
      // A blank audience must not reach the route: `audience @> ARRAY['']` matches nothing, so
      // it would silently empty every group.
      if (audience && audience.trim() !== "") p.set("audience", audience);
      // The route degrades a missing/unpopulated table to empty groups, so a first deploy
      // before the loader runs renders an empty section rather than an error. A genuine
      // failure (500) still rejects and React Query surfaces it as `isError`, which the tile
      // must distinguish from „no open calls" — see OpenCallsTile.
      return await fetchJson<OpenCallsResponse>(`/api/db/open-calls?${p}`);
    },
    // NOT `staleTime: Infinity`, which is the house default for the static JSON tree. This
    // payload is the one dataset whose value IS its freshness: `daysLeft` and the „Проверено на"
    // stamp are computed server-side per request, so a tab left open across a crawl — or across
    // midnight — would keep presenting yesterday's countdown as current. That is the thing
    // invariant 3 exists to prevent, one layer up.
    staleTime: 15 * 60_000,
  });
};

/** The newest successful crawl across all sources, or null when nothing has ever run.
 *  `null` is the state the banner must NAME rather than hide. */
export const newestCrawl = (crawl: OpenCallsCrawl[]): OpenCallsCrawl | null =>
  crawl
    .filter((c) => c.ok)
    .reduce<OpenCallsCrawl | null>(
      (a, c) => (!a || c.crawledAt > a.crawledAt ? c : a),
      null,
    );

/** Hours since the newest successful crawl; Infinity when there is none. */
export const crawlAgeHours = (
  crawl: OpenCallsCrawl[],
  now = Date.now(),
): number => {
  const newest = newestCrawl(crawl);
  if (!newest) return Number.POSITIVE_INFINITY;
  return (now - new Date(newest.crawledAt).getTime()) / 3_600_000;
};

/** The freshness SLA. Beyond this the UI must SAY the list may be out of date rather than
 *  implying it is current — the crawl is daily, so 48 h means at least one run was missed. */
export const STALE_AFTER_HOURS = 48;

// Sofia's calendar year, used to decide whether a stamp needs its year spelled out. Hoisted
// because the answer for `now` is constant across a render of 25 rows.
const sofiaYearFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  timeZone: "Europe/Sofia",
});
const sofiaYear = (d: Date): string => sofiaYearFmt.format(d);

/** Format an INSTANT (a deadline, or a crawl stamp) for display.
 *
 *  NOT `useDayLabel` — that hook takes a plain calendar day ("2026-07-31") and appends
 *  `T00:00:00Z`, so handing it a full ISO instant yields `Invalid Date`. These are instants,
 *  and their time of day is load-bearing: ИСУН publishes cut-offs like 16:30.
 *
 *  Fixed to Europe/Sofia rather than the viewer's zone, because the deadline is a fact about
 *  Bulgarian office hours — „до 16:30“ is the same moment whether you read it from Sofia or
 *  Berlin, and rendering 15:30 to a reader in Berlin would misstate the rule they must meet.
 *  `hourCycle: "h23"` and not `hour12: false`, which is ignored by some ICU builds.
 *
 *  Deadlines and crawl stamps deliberately share ONE formatter: both are Sofia instants shown
 *  to the minute, and two copies of the same Intl options is how they drift apart.
 *
 *  THE YEAR IS SHOWN WHENEVER IT IS NOT THE CURRENT ONE, and that is a correctness fix rather
 *  than polish. Technical-assistance procedures run to the end of the programming period, so the
 *  register really does hold deadlines in 2027-2029 — and bg-BG renders `month: "short"` as a
 *  NUMBER, so a 2029 cut-off printed as „31.12" reads as this December. Measured on the live
 *  page: „31.12" beside „остават 1240 дни", two facts that cannot both be about the same year.
 *  Eliding a same-year year keeps the common row short, which is why it is conditional. */
export const formatSofiaStamp = (
  iso: string,
  lang: string,
  now = new Date(),
): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    // Compared in SOFIA's calendar, not the viewer's: on 1 January a Sofia reader is already
    // in the new year while a viewer two zones west is not, and the year we print must be the
    // one the deadline belongs to.
    ...(sofiaYear(d) === sofiaYear(now) ? {} : { year: "numeric" as const }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Sofia",
  }).format(d);
};
