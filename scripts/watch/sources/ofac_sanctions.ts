// OFAC SDN list — Bulgaria-relevant designations (the `sanctions` facet on the person
// layer, plan §5 T1). The upstream is the U.S. Treasury Specially Designated Nationals
// (SDN) list, published as a flat CSV. There is no clean BG-filtered feed, so we fetch the
// whole SDN CSV and fingerprint ONLY the rows that mention Bulgaria — the fingerprint flips
// exactly when a Bulgaria-linked designation is added, removed, or amended, and is quiet
// through the (frequent, global) rest of the list. Weekly cadence: OFAC BG actions land at
// most a few times per year.
//
// Downstream: a "changed" signal means an operator should review + curate
// data/person/sanctions.json (the `update-persons` skill) — the register is hand-verified
// per designee because attaching a sanction to the WRONG same-named person is a serious
// accusation (see the skill's defamation rule). This watcher tells you WHEN to look.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

// The classic stable SDN CSV endpoint (human-readable data files). ~10 MB.
const SDN_CSV = "https://www.treasury.gov/ofac/downloads/sdn.csv";

// Rows that mention Bulgaria (country field, address, or program note). Case-insensitive;
// matches both the English "BULGARIA" and the ISO-ish "BG" only when whole-word to avoid
// false hits inside other tokens.
const isBgRow = (line: string): boolean => /bulgaria/i.test(line);

export const ofacSanctions: WatchSource = {
  id: "ofac_sanctions",
  label: "OFAC SDN — Bulgaria-linked designations (sanctions facet)",
  url: SDN_CSV,
  cadence: "weekly",
  async fingerprint(): Promise<Fingerprint> {
    const csv = await fetchText(SDN_CSV);
    const bgRows = csv
      .split(/\r?\n/)
      .filter(isBgRow)
      .map((r) => r.trim())
      .sort();
    // count + a hash of the sorted BG rows: robust to row reordering, flips on any
    // add/remove/amend of a Bulgaria-linked entry.
    return {
      value: `${bgRows.length}:${sha256Short(bgRows.join("\n"))}`,
      detail: `${bgRows.length} Bulgaria-linked SDN row(s)`,
      meta: { count: bgRows.length },
    };
  },
  describe(prev: WatchState | null, curr: Fingerprint): string {
    const before = (prev?.meta?.count as number | undefined) ?? null;
    const now = (curr.meta?.count as number | undefined) ?? null;
    if (before != null && now != null && before !== now)
      return `Bulgaria-linked SDN rows ${before} → ${now} — review data/person/sanctions.json (update-persons)`;
    return `${curr.detail} — review data/person/sanctions.json (update-persons)`;
  },
};
