// Сова Харис (sovaharris.com) — ordinary WordPress posts, filtered by
// per-YEAR categories ("Проекти 2026", "Прогнозни 2026") that the site
// creates anew each January, so the ids are resolved by NAME on every call
// rather than hardcoded (they would otherwise go stale every year).

import type { AgencyLister, ListOpts, Publication } from "./types";
import { listWpPosts, resolveCategoryIds } from "./wp_lister";

const SITE = "https://sovaharris.com";

const categoryNamesForYears = (years: number[]): string[] =>
  years.flatMap((y) => [`Проекти ${y}`, `Прогнозни ${y}`]);

export const listPublications = async (
  opts: ListOpts = {},
): Promise<Publication[]> => {
  const thisYear = new Date().getUTCFullYear();
  // Two years, so a January run still reaches December's late polls filed
  // under the closing year's category before the site has finished tagging
  // the new one.
  const ids = await resolveCategoryIds(
    SITE,
    categoryNamesForYears([thisYear, thisYear - 1]),
  );
  if (ids.length === 0) return [];
  return listWpPosts(SITE, {
    categories: ids,
    limit: opts.limit ?? 25,
    after: opts.after,
    before: opts.before,
  });
};

// Exit polls are excluded (decision 17): "Изборите за Президент … — балотаж"
// and the round-1-day posts measure who actually voted, not who intends to —
// a different question from a pre-election poll, and neither corpus scores
// it.
const EXIT_POLL_TERMS = ["екзит", "паралелно преброяване"];
const ELECTORAL_TERMS = [
  "политически нагласи",
  "електорални",
  "прогноз",
  "президент",
];

export const isElectoral = (p: Publication): boolean => {
  const title = p.title.toLowerCase();
  if (EXIT_POLL_TERMS.some((t) => title.includes(t))) return false;
  return ELECTORAL_TERMS.some((t) => title.includes(t));
};

export const sovaHarris: AgencyLister = {
  agencyId: "SH",
  listPublications,
  isElectoral,
};
