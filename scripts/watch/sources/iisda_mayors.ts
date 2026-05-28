// iisda.government.bg "Кметове на общини" registry watcher.
//
// The registry's master list page is xajax-paginated and doesn't expose
// a stable per-page snapshot, but the page header reports the total
// mayor count ("$.pagination(265, ...)"). We fingerprint the count plus
// the first-page IDs (so re-indexed mayors after a successor lands also
// flip the fingerprint even when the count is unchanged).
//
// In practice the roster shifts only on:
//   - regular local-election cycles (~ every 4 years)
//   - chmi partial-election cycles (every few months across the country)
//   - manual resignation / death replacements (rare)
//   - individual zам.-кмет appointments / dismissals (a deputy block on
//     the mayor's detail page changes, but the master-list fingerprint
//     stays the same — these are picked up only when chmi or count flips
//     happen to coincide; a forced rescrape with `--force` catches them)
// so the count itself is a coarse but reliable change signal.
//
// Downstream `update-municipal-contacts` re-scrapes the full 4400..4950
// detail-page range (cached HTML in raw_data/officials/iisda_mayors/)
// when invoked — extracts mayor + every deputy-mayor email per município.
// Cadence: monthly — chmi cycles happen often enough that quarterly
// would lose timely signal, daily would hammer iisda for no useful reason.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint } from "../types";
import { fetchText } from "../fingerprint";

const URL =
  "https://iisda.government.bg/ras/governing_bodies/gb_municipality_administrations";

export const iisdaMayors: WatchSource = {
  id: "iisda_mayors",
  label: "iisda.government.bg — Кметове на общини",
  url: URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(URL);
    if (!html) {
      return { value: "missing", detail: "fetch failed" };
    }
    // The total count is wired into the pagination JS:
    //   $("#pagination").pagination(265, { ... });
    const m = html.match(/pagination\((\d+)\s*,/);
    const count = m ? Number(m[1]) : 0;
    // Also fingerprint the set of governing_body IDs on the first page —
    // if iisda re-indexes (a mayor's ID changes after a successor takes
    // office) the count stays the same but the IDs shift.
    const ids: string[] = [];
    const re = /governing_body\/(\d+)/g;
    let g: RegExpExecArray | null;
    while ((g = re.exec(html)) !== null) ids.push(g[1]);
    const sortedIds = [...new Set(ids)].sort();
    const value = createHash("sha256")
      .update(`${count}|${sortedIds.join(",")}`)
      .digest("hex");
    return {
      value,
      detail: `${count} mayors registered · page-1 sample of ${sortedIds.length} IDs`,
      meta: { count, sampleIds: sortedIds },
    };
  },
};
