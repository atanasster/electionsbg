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

// NOT a bare „нагласи" ("attitudes"): it opens almost every GM title, so it
// listed prosecutors', magistrates', education and child-policy surveys
// (pubs 186/203/275/487) as electoral and they failed extraction nightly. The
// one real electoral post („Президентски избори 2026: обществени нагласи юли")
// is caught by the other terms anyway.
const ELECTORAL_TERMS = ["политически нагласи", "президент", "избори"];

export const listPublications = (opts: ListOpts = {}): Promise<Publication[]> =>
  listWpPosts(SITE, {
    archive: opts.archive,
    limit: opts.limit,
    after: opts.after,
    before: opts.before,
  });

export const isElectoral = titleContainsAny(ELECTORAL_TERMS);

export const globalMetrics: AgencyLister = {
  agencyId: "GM",
  listPublications,
  isElectoral,
};
