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

// Year the upstream registry currently publishes filings under. Bump when
// the new year's list.xml goes live (early January each year). Keeping a
// single source of truth here matches scripts/officials/index.ts default.
const YEAR = 2025;
const PAGE = `https://register.cacbg.bg/${YEAR}/list.xml`;

// Substring match against verbatim Category Name in list.xml. Must stay in
// sync with CATEGORY_MAP at scripts/officials/index.ts:64 — if you change the
// scope on the ingest side, mirror it here so the watcher tracks the same
// slice.
const CATEGORY_SUBSTRINGS = [
  "Министър-председател",
  "министри и заместник-министри",
  "Областни управители",
  "държавни агенции",
  "изпълнителните агенции",
  "изпълнителни агенции",
];

const categoryMatches = (name: string): boolean => {
  for (const sub of CATEGORY_SUBSTRINGS) {
    if (name.includes(sub)) return true;
  }
  return false;
};

// Pull <xmlFile> values for every Person under a matching Category. Regex is
// permissive on whitespace and attribute order because the upstream XML is
// machine-generated and sometimes adds incidental attributes.
const extractXmlFiles = (xml: string): string[] => {
  const out: string[] = [];
  // Capture each <Category Name="..."> ... </Category> block in turn.
  const catRe = /<Category\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/Category>/g;
  for (const cm of xml.matchAll(catRe)) {
    if (!categoryMatches(cm[1])) continue;
    const xmlFiles = Array.from(
      cm[2].matchAll(/<xmlFile>\s*([^<\s]+)\s*<\/xmlFile>/g),
    ).map((m) => m[1]);
    out.push(...xmlFiles);
  }
  return out;
};

export const cacbgOfficials: WatchSource = {
  id: "cacbg_officials",
  label: "Сметна палата declarations — executive (officials)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // register.cacbg.bg serves an incomplete TLS chain; same workaround as
    // cacbg_declarations.
    const xml = await fetchText(PAGE, { insecureTls: true });
    if (!xml) throw new Error("empty officials list.xml");
    const files = extractXmlFiles(xml);
    if (files.length === 0) {
      throw new Error(
        "officials list.xml yielded zero declaration xmlFile entries — upstream schema may have changed",
      );
    }
    // Stable order — sort so the hash is independent of upstream emission
    // order shuffling.
    files.sort();
    const value = sha256Short(files.join("\n"));
    return {
      value,
      detail: `${files.length} declarations in scope, hash ${value}`,
      meta: { count: files.length, year: YEAR },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevCount = (prev.meta?.count as number | undefined) ?? 0;
    const currCount = (curr.meta?.count as number | undefined) ?? 0;
    const delta = currCount - prevCount;
    if (delta === 0)
      return `${currCount} declarations (content changed, no net add/remove)`;
    return `${delta > 0 ? "+" : ""}${delta} declarations in scope (${prevCount} → ${currCount})`;
  },
};
