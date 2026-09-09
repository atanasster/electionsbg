// Мяра (myara.bg) — ordinary WordPress posts, filtered by two FIXED category
// ids (measured 2026-09-05: 98 "Електорални нагласи" BG, 114 "Electoral
// attitudes" EN — the site tags posts in both languages under separate
// category ids for the same topic). Every post in these categories carries
// party support figures, so isElectoral is unconditional.

import type { AgencyLister, ListOpts, Publication } from "./types";
import { listWpPosts } from "./wp_lister";

const SITE = "https://myara.bg";
const CATEGORY_ELECTORAL_BG = 98;
const CATEGORY_ELECTORAL_EN = 114;

export const listPublications = (opts: ListOpts = {}): Promise<Publication[]> =>
  listWpPosts(SITE, {
    categories: [CATEGORY_ELECTORAL_BG, CATEGORY_ELECTORAL_EN],
    limit: opts.limit ?? 25,
    after: opts.after,
    before: opts.before,
  });

// Typed via the interface's own method signature (rather than a named,
// unused `Publication` parameter) so callers can still pass one — the
// category scoping in `listPublications` above is the real filter; every
// post reaching this predicate is already electoral.
export const isElectoral: AgencyLister["isElectoral"] = () => true;

export const myara: AgencyLister = {
  agencyId: "MY",
  listPublications,
  isElectoral,
};
