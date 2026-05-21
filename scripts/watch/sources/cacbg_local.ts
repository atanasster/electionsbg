// Сметна палата declarations registry — municipal-government slice. Watches
// the current-year list.xml on register.cacbg.bg and filters to the local
// tier: mayors, deputy-mayors, district mayors, municipal-council chairs,
// municipal councillors and chief architects. When new filings land for any
// of those roles — typically annually around the May 15 deadline — the
// fingerprint flips.
//
// This is the third independent slice of the same register:
//   - cacbg_declarations → MP scope        (→ /update-connections)
//   - cacbg_officials    → executive scope (→ /update-officials)
//   - cacbg_local        → municipal scope (this file)
// The three flip on different cycles (MPs on a parliament cycle, executive +
// municipal on the annual May filing cycle) so they are kept separate.
//
// Scope note: the register lists ~6,700 municipal declarants but carries no
// party affiliation. Mapping a mayor/councillor to the coalition that
// nominated them needs the ЦИК local-election (МИ) results — that upstream
// sits behind Cloudflare (see ./cik.ts) and is a separate ingest concern.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

// Year the upstream registry currently publishes filings under. Bump when
// the new year's list.xml goes live (early January each year). Kept in sync
// with cacbg_officials.ts and scripts/officials/index.ts.
const YEAR = 2025;
const PAGE = `https://register.cacbg.bg/${YEAR}/list.xml`;

// Substring match against the verbatim Category Name in list.xml. Every
// municipal-tier category label begins with "Кметове" (e.g. "Кметове, и
// зам.-кметове на общини … председателите на общинските съвети, общинските
// съветници и гл. архитекти …"). No executive or MP category contains that
// token, so a single substring cleanly isolates the local-government slice.
const CATEGORY_SUBSTRINGS = ["Кметове"];

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

export const cacbgLocal: WatchSource = {
  id: "cacbg_local",
  label: "Сметна палата declarations — municipal (mayors & councillors)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // register.cacbg.bg serves an incomplete TLS chain; same workaround as
    // cacbg_declarations / cacbg_officials.
    const xml = await fetchText(PAGE, { insecureTls: true });
    if (!xml) throw new Error("empty municipal list.xml");
    const files = extractXmlFiles(xml);
    if (files.length === 0) {
      throw new Error(
        "municipal list.xml yielded zero declaration xmlFile entries — upstream schema may have changed",
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
