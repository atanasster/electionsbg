// Тренд (rctrend.bg) — publishes electoral polls as its custom WordPress
// "project" post type. Measured 2026-09-05: `wp-json/wp/v2/project` returns
// the 25 newest with `date`/`link`/`title`, and the endpoint honours
// `after`/`before` for an archive walk. The site's RSS feed is frozen at
// 2018 — never use it as a listing source.

import type { AgencyLister, ListOpts, Publication } from "./types";
import { listWpPosts, titleContainsAny } from "./wp_lister";

const SITE = "https://rctrend.bg";

const ELECTORAL_TERMS = [
  "електорални нагласи",
  "партии",
  "избори",
  "президент",
];

export const listPublications = (opts: ListOpts = {}): Promise<Publication[]> =>
  listWpPosts(SITE, {
    postType: "project",
    limit: opts.limit ?? 25,
    after: opts.after,
    before: opts.before,
  });

// The monthly "Обществени нагласи спрямо основните институции, партии и
// актуални теми" also carries party support figures — it matches on
// "партии" for that reason, deliberately, not as an accident of the rule.
export const isElectoral = titleContainsAny(ELECTORAL_TERMS);

export const trend: AgencyLister = {
  agencyId: "TR",
  listPublications,
  isElectoral,
};
