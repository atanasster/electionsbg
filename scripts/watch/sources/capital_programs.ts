// Municipal capital programmes watcher.
//
// Each of the 5 ingested общини (Sofia, Plovdiv, Burgas, Stara Zagora,
// Ruse) publishes an annual "Капиталова програма" / "Поименен списък на
// обектите за капиталови разходи" on its own website. URLs are opaque
// and change every year (some include the date, some a content hash),
// so the catalogue is hand-curated below — mirrors the SOURCE_URLS map
// in each município's parser under scripts/budget/capital_programs/.
//
// This watcher HEADs each catalogued URL; a re-upload (content-length /
// last-modified / etag change) surfaces as `changed`. Adding a new year
// to the catalogue triggers `added`, prompting the operator to:
//   1. fetch the file into raw_data/budget/capital_programs/
//      (sofia: .xlsx, plovdiv: .pdf, burgas: .xlsx, stara_zagora: .pdf
//       — extracted from the budget docket ZIP, ruse: .xlsx)
//   2. run the relevant ingest:
//      tsx scripts/budget/capital_programs/sofia.ts --year YYYY
//      tsx scripts/budget/capital_programs/plovdiv.ts --year YYYY
//      tsx scripts/budget/capital_programs/burgas.ts --year YYYY
//      tsx scripts/budget/capital_programs/stara_zagora.ts --year YYYY
//      tsx scripts/budget/capital_programs/ruse.ts --year YYYY
//
// Cadence: weekly. Municipal capital programmes publish once per fiscal
// year (March-May of the same year, alongside the council's budget
// adoption decision); weekly probes are cheap.
//
// WAF notes:
//   - sofia.bg, plovdiv.bg, starazagora.bg work fine with a browser UA
//     on HEAD; verified that all three return content-length and/or
//     last-modified.
//   - burgas.bg redirects http→https / non-www→www; `redirect: "follow"`
//     handles this transparently.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// Hand-curated catalogue: per-fiscal-year, per-município source URL.
// Keep in sync with the SOURCE_URLS in each parser file under
// scripts/budget/capital_programs/.
type Municipality = "sofia" | "plovdiv" | "burgas" | "stara_zagora" | "ruse";

export const CAPITAL_PROGRAM_URLS: Record<
  number,
  Partial<Record<Municipality, string>>
> = {
  2025: {
    sofia:
      "https://www.sofia.bg/documents/d/guest/prilozenie-_3-kapitalova-programa-2025",
    plovdiv:
      "https://www.plovdiv.bg/wp-content/uploads/2025/04/RazchetZaFinansiraneNaKapitaloviteRazhodiPrez2025g..pdf",
    burgas:
      "https://burgas.bg/uploads/posts/2025/88b526bffed7c988521911ecb2eb0086.xlsx",
    // Stara Zagora ships the capital programme inside the council's
    // budget-decision ZIP — the ZIP itself is what we fingerprint.
    stara_zagora:
      "https://www.starazagora.bg/uploads/posts/2025/2025_05_29_prilozhenia_byudzhet_2025.zip",
    // Ruse publishes a year-end revised plan in late February of T+1,
    // with quarterly snapshots throughout the year. The year-end file
    // is the canonical artifact for the fiscal-year recap.
    ruse: "https://obshtinaruse.bg/editor/files/Бюджет/Разчет за пап. разходи/2025/Kapitalov_razchet_31.12.2025_publ._27.02.2026.xlsx",
  },
};

const probe = async (url: string): Promise<string> => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "follow",
    });
    if (res.status !== 200) return `status:${res.status}`;
    const len = res.headers.get("content-length") ?? "?";
    const mod = res.headers.get("last-modified") ?? "?";
    const etag = res.headers.get("etag") ?? "?";
    return `${len}|${mod}|${etag}`;
  } catch (e) {
    return `err:${(e as Error).message.slice(0, 40)}`;
  }
};

// Build a stable per-(year, município) key for signature dict + diff.
const key = (year: number, m: Municipality): string => `${year}/${m}`;

export const capitalPrograms: WatchSource = {
  id: "capital_programs",
  label: "Общински капиталови програми (per-municipality capital lists)",
  url: "https://www.sofia.bg/", // representative — actual sources vary
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const years = Object.keys(CAPITAL_PROGRAM_URLS)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => a - b);
    const signatures: Record<string, string> = {};
    for (const year of years) {
      const byMuni = CAPITAL_PROGRAM_URLS[year];
      for (const m of Object.keys(byMuni) as Municipality[]) {
        const url = byMuni[m];
        if (!url) continue;
        signatures[key(year, m)] = await probe(url);
      }
    }
    const sortedKeys = Object.keys(signatures).sort();
    const value = createHash("sha256")
      .update(sortedKeys.map((k) => `${k}=${signatures[k]}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    const latest = years[years.length - 1];
    const muniCount = Object.keys(CAPITAL_PROGRAM_URLS[latest] ?? {}).length;
    return {
      value,
      detail: `${sortedKeys.length} programme(s) tracked across ${years.length} year(s) · latest ${latest} (${muniCount} муни) · hash ${value}`,
      meta: { signatures, latestYear: latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevSigs = (prev.meta?.signatures as Record<string, string>) ?? {};
    const currSigs = (curr.meta?.signatures as Record<string, string>) ?? {};
    const added = Object.keys(currSigs).filter((k) => !(k in prevSigs));
    const removed = Object.keys(prevSigs).filter((k) => !(k in currSigs));
    const changed: string[] = [];
    for (const [k, sig] of Object.entries(currSigs)) {
      if (prevSigs[k] != null && prevSigs[k] !== sig) changed.push(k);
    }
    if (added.length > 0) {
      return (
        `${added.length} new capital programme(s) added to catalogue: ` +
        `${added.join(", ")} — fetch each file to raw_data/budget/capital_programs/ ` +
        `and run the matching tsx scripts/budget/capital_programs/<muni>.ts --year <yyyy>`
      );
    }
    if (changed.length > 0) {
      return (
        `${changed.length} capital programme(s) re-uploaded: ${changed.join(", ")} ` +
        `— re-fetch and re-run the matching ingest script`
      );
    }
    if (removed.length > 0) {
      return `${removed.length} entry(ies) removed from catalogue: ${removed.join(", ")}`;
    }
    return `${curr.detail} (no change)`;
  },
};
