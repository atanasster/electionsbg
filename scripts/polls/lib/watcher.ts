// Shared WatchSource plumbing for the site listers — Trend, Alpha Research,
// Market Links, Sova Harris, Мяра, Global Metrics, and Gallup's site arm.
// `computeSiteArm` is the monotonic-fingerprint logic itself (decision 3,
// §6.1); `makeAgencyPollsWatcher` wraps it into a `WatchSource` for the six
// single-arm agencies. Gallup (`polls_gallup`) calls `computeSiteArm`
// directly for its site half, because its OVERALL state also carries a press
// arm and cannot be keyed the same way `readState(id).meta.newestId` is here.
//
// The press-discovery watcher (`polls_press`, no ascending id at all) does
// not fit this shape and is hand-written — see google_news_rss.ts /
// polls_press.ts.

import type { Fingerprint, WatchSource } from "../../watch/types";
import { readState } from "../../watch/state";
import type { AgencyLister, Publication } from "../agencies/types";

// Every lister returns a bounded window (25 WP posts, 12 AR blog posts, one
// ML news page) — see decision 3. Passing the same limit explicitly keeps
// the watcher's window independent of each lister's own default, so a lister
// change cannot silently widen or narrow what the fingerprint samples.
export const LISTING_WINDOW = 25;

export interface SiteArmMetaItem {
  id: number;
  url: string;
  title: string;
  publishedAt: string | null;
}

export interface SiteArmResult {
  /** The high-water mark — never lower than `prevNewestId`. */
  newestId: number;
  /** Electoral items newer than `prevNewestId` (every electoral item on the
   *  window when `prevNewestId` is null — the first-run backlog). */
  items: SiteArmMetaItem[];
  detail: string;
}

const toMetaItem = (p: Publication): SiteArmMetaItem => ({
  id: p.id,
  url: p.url,
  title: p.title,
  publishedAt: p.publishedAt,
});

/**
 * The monotonic id high-water mark over one lister's listing window
 * (decision 3). `prevNewestId` is `null` only on the very first run.
 *
 * ⚠️ `newestId` is `Math.max(prevNewestId, currentMax)`, NEVER just the
 * current window's max. A bounded window can roll an electoral post off
 * (superseded by newer non-electoral posts) while an OLDER-but-still-visible
 * electoral post remains — e.g. the window held id 500 last run, now holds
 * ids 480-504 with 500 itself rolled off and only 480/490 still electoral.
 * Taking the current max alone (490) would report a regression on a source
 * that has not lost anything; the same wobble `council_minutes.ts` fixed for
 * raw counts, one level up (an id rather than a count).
 */
export const computeSiteArm = (
  listed: Publication[],
  isElectoral: AgencyLister["isElectoral"],
  prevNewestId: number | null,
): SiteArmResult => {
  const electoral = listed.filter(isElectoral);
  const currentMax =
    electoral.length > 0 ? Math.max(...electoral.map((p) => p.id)) : null;
  const newestId = Math.max(prevNewestId ?? 0, currentMax ?? 0);
  // On the FIRST run (no prior state) every electoral item on the page is
  // "new" — the backlog Tier 2 ingests (decision 3).
  const items = electoral.filter(
    (p) => prevNewestId == null || p.id > prevNewestId,
  );
  return {
    newestId,
    items: items.map(toMetaItem),
    detail:
      items.length > 0
        ? `+${items.length} electoral publication(s): ${items
            .map((p) => `${p.title} (${p.publishedAt ?? "?"})`)
            .join("; ")}`
        : electoral.length > 0
          ? `no new electoral publications (newest id ${newestId})`
          : "no electoral publications in the current window",
  };
};

export interface AgencyWatcherOpts {
  /** e.g. "polls_trend" — must match the state filename. */
  id: string;
  /** e.g. "Polls — Тренд (rctrend.bg)". */
  label: string;
  /** The listing page shown in the report — the lister's OWN reachable host,
   *  not necessarily `agencies.json`'s published website (Trend's is
   *  `rc-trend.bg`, which no longer resolves; see `agencies.ts`). */
  url: string;
  lister: AgencyLister;
}

interface StoredSiteArmMeta {
  newestId: number;
  items: SiteArmMetaItem[];
}

export const makeAgencyPollsWatcher = (
  opts: AgencyWatcherOpts,
): WatchSource => ({
  id: opts.id,
  label: opts.label,
  url: opts.url,
  cadence: "daily",
  // Campaign-rhythm agencies publish roughly weekly; a daily probe samples
  // comfortably inside the cadence invariant (T0.4).
  publishes: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const listed = await opts.lister.listPublications({
      limit: LISTING_WINDOW,
    });
    const prev = readState(opts.id);
    const prevNewestId =
      (prev?.meta as Partial<StoredSiteArmMeta> | undefined)?.newestId ?? null;
    const arm = computeSiteArm(listed, opts.lister.isElectoral, prevNewestId);
    return {
      value: String(arm.newestId),
      detail: arm.detail,
      meta: { newestId: arm.newestId, items: arm.items },
    };
  },
  // No `describe` override — the default (types.ts: "shows current detail")
  // already reads as decision 3's "+N electoral publication(s): <title>
  // (<date>)" line.
});
