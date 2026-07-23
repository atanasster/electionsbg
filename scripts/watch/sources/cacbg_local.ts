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
import { REGISTER_ROOT, latestRegisterYear } from "../../lib/cacbg_register";

// The year is discovered from the register root on every run rather than
// pinned — see the note in cacbg_officials.ts. Shared with that source and
// with scripts/officials/index.ts, which resolves the same way.
const listUrl = (year: number): string => `${REGISTER_ROOT}${year}/list.xml`;

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
  // Static, for the data map — the probed URL is resolved per run.
  url: REGISTER_ROOT,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // register.cacbg.bg serves an incomplete TLS chain; same workaround as
    // cacbg_declarations / cacbg_officials.
    const year = await latestRegisterYear((u) =>
      fetchText(u, { insecureTls: true }),
    );
    const xml = await fetchText(listUrl(year), { insecureTls: true });
    if (!xml) throw new Error(`empty municipal list.xml for ${year}`);
    const files = extractXmlFiles(xml);
    if (files.length === 0) {
      throw new Error(
        `municipal list.xml for ${year} yielded zero declaration xmlFile entries — upstream schema may have changed`,
      );
    }
    // Stable order — sort so the hash is independent of upstream emission
    // order shuffling.
    files.sort();
    // Year deliberately not folded into the hash — see cacbg_officials.ts.
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
    // A year rollover is the headline — the counts belong to different cycles.
    if (prevYear && currYear && prevYear !== currYear) {
      return `new declaration year ${prevYear} → ${currYear} (${currCount} declarations in scope) — run /update-officials (municipal leg: scripts/officials/municipal.ts)`;
    }
    const delta = currCount - prevCount;
    if (delta === 0)
      return `${currCount} declarations (content changed, no net add/remove)`;
    return `${delta > 0 ? "+" : ""}${delta} declarations in scope (${prevCount} → ${currCount})`;
  },
};
