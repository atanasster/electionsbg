// Сметна палата annual party-report year index.
//
// The per-year catalogue of which parties filed their annual financial report
// — and whether on time / late / non-compliant — lives in the gfopp WebForms
// register and is ingested by scripts/financing/scrape_reports.ts. A new year
// becomes available there each spring, once the 31 March filing deadline for
// the prior year passes.
//
// We do NOT fingerprint gfopp directly: its root defaults to the oldest year
// (2011), and reaching a specific year needs an ASP.NET session handshake.
// The cleanest, chrome-immune signal for "a new annual-report year exists" is
// the year list on the bulnao otcheti-na-partii index — the same page
// scrape_index.ts parses, and the page whose entries link into gfopp. We
// fingerprint the *extracted year set*, not the raw HTML, so the fingerprint
// flips only on a real year addition/removal — never on the bulnao CMS's
// per-request csrf-token / chrome churn.
//
// Cadence is monthly: annual-report data turns over once a year, so a monthly
// probe catches the spring publication well within a useful window without 52
// needless fetches a year. (The sibling `smetna_palata` source stays weekly —
// it watches the broad financing section for any structural change.)

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE =
  "https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/";

// Same matcher scripts/financing/scrape_index.ts uses to enumerate the
// annual-report years published on this page.
const extractYears = (html: string): number[] => {
  const years = new Set<number>();
  for (const m of html.matchAll(/Годишни[^<]*?за\s*(20\d{2})\s*г\.?/g)) {
    years.add(parseInt(m[1], 10));
  }
  return [...years].sort((a, b) => a - b);
};

export const financingReports: WatchSource = {
  id: "financing_reports",
  label: "Сметна палата annual-report index",
  url: PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty otcheti-na-partii page");
    const years = extractYears(html);
    if (years.length === 0) {
      throw new Error(
        "no annual-report years parsed — otcheti-na-partii structure changed",
      );
    }
    const value = sha256Short(years.join(","));
    return {
      value,
      detail: `${years.length} years, latest ${years[years.length - 1]}`,
      meta: { years, latest: years[years.length - 1] },
    };
  },

  // Name the specific new year so the report points straight at the action.
  describe(prev: WatchState | null, curr: Fingerprint): string {
    const prevYears = (prev?.meta?.years as number[] | undefined) ?? [];
    const currYears = (curr.meta?.years as number[] | undefined) ?? [];
    const added = currYears.filter((y) => !prevYears.includes(y));
    if (added.length > 0) {
      return (
        `new annual-report year(s): ${added.join(", ")} — run /update-financing ` +
        `(scrape_index.ts + scrape_reports.ts)`
      );
    }
    return curr.detail;
  },
};
