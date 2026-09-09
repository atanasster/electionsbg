// Глобал Метрикс (globalmetrics.eu — NOT .bg, which does not resolve).
// Ordinary WordPress posts with no useful category filter (the site posts
// rarely and on varied topics — HR, health, consumer research — so
// electoral posts are picked out by title). Publisher of the first 2026
// presidential poll (July 2026): the same PDF carries a named-candidate row
// and a party-placeholder block, both handled by the presidential extractor
// (Tier 4), not here.

import type { AgencyLister, ListOpts, Publication } from "./types";
import { listWpPosts, titleContainsAny } from "./wp_lister";

const SITE = "https://globalmetrics.eu";

const ELECTORAL_TERMS = ["нагласи", "президент", "избори"];

export const listPublications = (opts: ListOpts = {}): Promise<Publication[]> =>
  listWpPosts(SITE, {
    limit: opts.limit ?? 25,
    after: opts.after,
    before: opts.before,
  });

export const isElectoral = titleContainsAny(ELECTORAL_TERMS);

export const globalMetrics: AgencyLister = {
  agencyId: "GM",
  listPublications,
  isElectoral,
};
