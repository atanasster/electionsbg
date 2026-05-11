// Сметна палата declarations registry (register.cacbg.bg). Filings index per
// MP changes when new yearly declarations are published — typically March-May
// each year. Fingerprint is a content hash of the registry's MP-list page;
// any structural change (new filing year, new MP, etc.) flips it.
//
// The site is a Vue SPA so the HTML alone won't reflect new filings; the API
// path used by /update-connections is more specific but per-MP. For watcher
// purposes the index page is sufficient — when it flips, we trigger a deeper
// /update-connections run to see what actually changed.

import type { WatchSource, Fingerprint } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE = "https://register.cacbg.bg/";

export const cacbgDeclarations: WatchSource = {
  id: "cacbg_declarations",
  label: "Сметна палата declarations registry",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty registry page");
    // Strip volatile bits (CSRF tokens, build hashes) before hashing so the
    // fingerprint reflects actual content drift.
    const stable = html
      .replace(/name="csrf-token"[^>]*content="[^"]*"/g, "")
      .replace(/\?id=[a-f0-9]+/g, "")
      .replace(/<meta name="generator"[^>]*>/g, "");
    const value = sha256Short(stable);
    return {
      value,
      detail: `index hash ${value}`,
      meta: { bytes: stable.length },
    };
  },
};
