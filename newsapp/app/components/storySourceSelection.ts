import type { Outlet } from "../data";

export interface StorySource {
  domain: string;
  label: string;
  articleCount: number;
}

const outletRank = (outlet: Outlet | undefined): number =>
  outlet?.rank ?? Number.POSITIVE_INFINITY;

/**
 * Select the publication names shown on a story card without implying a trust
 * or editorial-quality score. Contribution count is the story-local signal;
 * registry rank and name make ties deterministic.
 */
export const selectStorySources = (
  byDomain: Record<string, number>,
  outlets: readonly Outlet[],
  limit: number,
): { visible: StorySource[]; remaining: number; total: number } => {
  const outletByDomain = new Map(
    outlets.map((outlet) => [outlet.domain, outlet]),
  );
  const ranked = Object.entries(byDomain)
    .map(([domain, articleCount]) => ({
      domain,
      label: outletByDomain.get(domain)?.outlet || domain,
      articleCount,
      outlet: outletByDomain.get(domain),
    }))
    .sort(
      (a, b) =>
        b.articleCount - a.articleCount ||
        outletRank(a.outlet) - outletRank(b.outlet) ||
        a.label.localeCompare(b.label, "bg") ||
        a.domain.localeCompare(b.domain),
    );
  const safeLimit = Math.max(1, Math.trunc(limit));

  return {
    visible: ranked.slice(0, safeLimit).map((source) => ({
      domain: source.domain,
      label: source.label,
      articleCount: source.articleCount,
    })),
    remaining: Math.max(0, ranked.length - safeLimit),
    total: ranked.length,
  };
};
