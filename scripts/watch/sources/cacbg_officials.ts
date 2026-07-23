// Сметна палата declarations registry — executive-branch slice. Watches the
// current-year list.xml on register.cacbg.bg, filters to the categories the
// /update-officials skill ingests (cabinet, state-agency heads, regional
// governors) and fingerprints the set of declaration xmlFile references.
// When new filings land for any of those categories — typically annually
// around May — the fingerprint flips.
//
// Distinct from `cacbg_declarations`, which is mapped to /update-connections
// (the MP scope) and watches the registry's root index page. The two sources
// can flip independently: the MP roster updates on a parliament cycle, while
// executive filings update on the annual May cycle.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";
import {
  REGISTER_ROOT,
  latestRegisterYear,
  extractDeclarationXmlFiles,
} from "../../lib/cacbg_register";
import { CATEGORY_MAP } from "../../officials/categorise";

// The year is discovered from the register root on every run rather than
// pinned — a pinned constant kept fingerprinting the previous cycle's
// list.xml after a new folder went live, so the new filings read as
// "unchanged" until someone bumped it by hand. Shared with cacbg_local.ts
// and scripts/officials/index.ts, which resolves the same way.
const listUrl = (year: number): string => `${REGISTER_ROOT}${year}/list.xml`;

// Derived from the ingest's own CATEGORY_MAP rather than restated here. The
// watcher has to fingerprint exactly the set the ingest would process — a
// hand-kept copy drifted once already, leaving two of three buckets unwatched
// and 489 of 548 declarations tracked. Deriving it makes drift impossible;
// scripts/officials/watcher_lockstep.test.ts still asserts the equivalence so
// the intent is documented in a test rather than only in this comment.
//
// categorise.ts is import-safe (no CLI at import) — that is why it was split
// out of officials/index.ts.
export const CATEGORY_SUBSTRINGS = CATEGORY_MAP.flatMap((b) => b.substrings);

const categoryMatches = (name: string): boolean => {
  for (const sub of CATEGORY_SUBSTRINGS) {
    if (name.includes(sub)) return true;
  }
  return false;
};

const extractXmlFiles = (xml: string): string[] =>
  extractDeclarationXmlFiles(xml, categoryMatches);

export const cacbgOfficials: WatchSource = {
  id: "cacbg_officials",
  label: "Сметна палата declarations — executive (officials)",
  // Static, for the data map — the probed URL is resolved per run.
  url: REGISTER_ROOT,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // register.cacbg.bg serves an incomplete TLS chain; same workaround as
    // cacbg_declarations.
    const year = await latestRegisterYear((u) =>
      fetchText(u, { insecureTls: true }),
    );
    const xml = await fetchText(listUrl(year), { insecureTls: true });
    if (!xml) throw new Error(`empty officials list.xml for ${year}`);
    const files = extractXmlFiles(xml);
    if (files.length === 0) {
      throw new Error(
        `officials list.xml for ${year} yielded zero declaration xmlFile entries — upstream schema may have changed`,
      );
    }
    // Stable order — sort so the hash is independent of upstream emission
    // order shuffling.
    files.sort();
    // The year is deliberately NOT folded into the hash: a new cycle brings a
    // wholly new set of xmlFile GUIDs, so the file set alone already flips the
    // fingerprint. Hashing the year too would spuriously mark the current
    // cycle as changed on the first run after this change landed.
    const value = sha256Short(files.join("\n"));
    return {
      value,
      detail: `${files.length} declarations in scope for ${year}, hash ${value}`,
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
      return `new declaration year ${prevYear} → ${currYear} (${currCount} declarations in scope) — run /update-officials (executive leg: scripts/officials/index.ts)`;
    }
    const delta = currCount - prevCount;
    if (delta === 0)
      return `${currCount} declarations (content changed, no net add/remove)`;
    return `${delta > 0 ? "+" : ""}${delta} declarations in scope (${prevCount} → ${currCount})`;
  },
};
