// Сметна палата declarations registry — MP slice. Watches the current-year
// list.xml on register.cacbg.bg, filters to the "Народни представители"
// category the /update-connections skill ingests, and fingerprints the set of
// declaration xmlFile references. When new MP filings land — typically
// March-May each year — the fingerprint flips.
//
// This used to hash the registry's ROOT PAGE, which is a Vue SPA shell: 4 KB of
// static HTML that says nothing about who has filed. It flipped exactly once
// (2026-05-11) in the whole time it ran, so the ingest it gates was effectively
// never triggered by new filings, and the MP declaration tree went stale
// unnoticed. Its two siblings — cacbg_officials and cacbg_local — have watched
// the actual filings all along; this is the same shape.
//
// Distinct from those two: they track the executive and municipal categories on
// an annual May cycle, while the MP roster also turns over on a parliament
// cycle, so all three can flip independently.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";
import {
  REGISTER_ROOT,
  latestRegisterYear,
  extractDeclarationXmlFiles,
} from "../../lib/cacbg_register";

// The year is discovered from the register root on every run rather than
// pinned — a pinned constant kept fingerprinting the previous cycle's list.xml
// after a new folder went live, so the new filings read as "unchanged" until
// someone bumped it by hand. Shared with cacbg_officials.ts / cacbg_local.ts.
const listUrl = (year: number): string => `${REGISTER_ROOT}${year}/list.xml`;

// Substring match against the verbatim `Category Name` in list.xml. Must stay
// in sync with fetchYearListing in scripts/declarations/index.ts, which filters
// the same way — the watcher has to fingerprint exactly the set that ingest
// would process.
export const MP_CATEGORY_SUBSTRING = "Народни представители";

const categoryMatches = (name: string): boolean =>
  name.includes(MP_CATEGORY_SUBSTRING);

export const cacbgDeclarations: WatchSource = {
  id: "cacbg_declarations",
  label: "Сметна палата declarations — MPs",
  // Static, for the data map — the probed URL is resolved per run.
  url: REGISTER_ROOT,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // register.cacbg.bg serves an incomplete TLS chain that Node rejects but
    // curl/browsers accept. Override per-source to keep the rest of the
    // watcher's TLS verification strict.
    const year = await latestRegisterYear((u) =>
      fetchText(u, { insecureTls: true }),
    );
    const xml = await fetchText(listUrl(year), { insecureTls: true });
    if (!xml) throw new Error(`empty MP list.xml for ${year}`);
    const files = extractDeclarationXmlFiles(xml, categoryMatches);
    if (files.length === 0) {
      throw new Error(
        `MP list.xml for ${year} yielded zero declaration xmlFile entries — upstream schema may have changed`,
      );
    }
    // Stable order — sort so the hash is independent of upstream emission
    // order shuffling.
    files.sort();
    // The year is deliberately NOT folded into the hash: a new cycle brings a
    // wholly new set of xmlFile GUIDs, so the file set alone already flips the
    // fingerprint.
    const value = sha256Short(files.join("\n"));
    return {
      value,
      detail: `${files.length} MP declarations in scope for ${year}, hash ${value}`,
      meta: { count: files.length, year },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevCount = (prev.meta?.count as number | undefined) ?? 0;
    const currCount = (curr.meta?.count as number | undefined) ?? 0;
    const prevYear = prev.meta?.year as number | undefined;
    const currYear = curr.meta?.year as number | undefined;
    // A year rollover is the headline — the counts belong to different cycles,
    // so a delta between them would be meaningless.
    if (prevYear && currYear && prevYear !== currYear) {
      return `new declaration year ${prevYear} → ${currYear} (${currCount} MP declarations in scope) — run /update-connections`;
    }
    const delta = currCount - prevCount;
    if (delta === 0)
      return `${currCount} MP declarations (content changed, no net add/remove)`;
    return `${delta > 0 ? "+" : ""}${delta} MP declarations in scope (${prevCount} → ${currCount})`;
  },
};
