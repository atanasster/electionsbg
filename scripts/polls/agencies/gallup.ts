// Галъп Интернешънъл Болкан (gallup-international.bg) — ordinary WordPress
// posts. This is the SITE arm only; the watcher (a later step) pairs it with
// a press-discovery arm because the site's own TLS configuration has been
// broken since at least 2026-09-05 (every client — curl, Node, headless
// Chromium — rejects the handshake; it is not a challenge a browser could
// clear). This lister needs no special casing for that: it either succeeds
// or throws, like any other, and the watcher decides what an arm failure
// means.

import type { AgencyLister, ListOpts, Publication } from "./types";
import { listWpPosts, titleContainsAny } from "./wp_lister";

const SITE = "https://www.gallup-international.bg";

const ELECTORAL_TERMS = ["electoral", "политическ", "партии", "president"];

export const listPublications = (opts: ListOpts = {}): Promise<Publication[]> =>
  listWpPosts(SITE, {
    limit: opts.limit ?? 25,
    after: opts.after,
    before: opts.before,
  });

export const isElectoral = titleContainsAny(ELECTORAL_TERMS);

export const gallup: AgencyLister = {
  agencyId: "GIB",
  listPublications,
  isElectoral,
};
