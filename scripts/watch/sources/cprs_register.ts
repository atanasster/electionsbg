// Watch the ЦПРС — Централен професионален регистър на строителя.
// Maps to the `update-procurement` skill (process-watch-report).
//
// The fingerprint is a SAMPLE, not the whole register: the full picture costs
// 1,620 POSTs, which is an ingest, not a probe. Six representative (област ×
// class) cells are fetched and the firm sets hashed — enough to flip when КСБ
// enters or removes builders, cheap enough to run daily.
//
// ⚠️ The TAXONOMY is watched too, and that is the more important half. КСБ adds
// NACE-coded classes to group 5 over time, and `sources.ts` parses the class
// list out of the page for exactly that reason — so a change in the class set is
// a change in what the ingest must crawl, and it must not be discovered by a
// reader noticing a blank eligibility class months later.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import {
  BROWSER_UA,
  CPRS_LIST_URL,
  parseTaxonomy,
} from "../../procurement/cprs/sources";
import { parseFirmList } from "../../procurement/cprs/parse";

/** (Pod, GroupType) probes: Sofia + two regions, across three licence groups. */
const SAMPLE: [string, string][] = [
  ["22", "11"],
  ["22", "21"],
  ["2", "11"],
  ["2", "41"],
  ["4", "11"],
  ["4", "50"],
];

const probe = async (): Promise<{
  classes: number;
  firms: string[];
  down: number;
}> => {
  const seed = await fetchText(CPRS_LIST_URL, {
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!seed) throw new Error("ЦПРС search page unreachable — a probe failure");
  const classes = parseTaxonomy(seed).length;

  const firms = new Set<string>();
  let down = 0;
  for (const [pod, group] of SAMPLE) {
    const html = await fetchText(CPRS_LIST_URL, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        Pod: pod,
        GroupType: group,
        Podphp: pod,
        GroupTypephp: group,
        filter: "Покажи строителите",
      }).toString(),
    }).catch(() => null);
    if (!html) {
      down++;
      continue;
    }
    for (const r of parseFirmList(html)) firms.add(`${group}:${r.eik}`);
  }
  // Every sample cell failing is an outage, not an emptied register.
  if (down === SAMPLE.length)
    throw new Error("no ЦПРС sample cell answered — a probe failure");
  return { classes, firms: [...firms].sort(), down };
};

export const cprsRegister: WatchSource = {
  id: "cprs_register",
  label: "ЦПРС — регистър на строителя (register.ksb.bg)",
  url: CPRS_LIST_URL,
  cadence: "weekly",
  // КСБ enters builders by protocol, on no schedule.
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const { classes, firms, down } = await probe();
    return {
      // `down` cells are excluded from the hash rather than counted as zero —
      // otherwise one timeout reads as „КСБ struck off 200 builders".
      value: createHash("sha256")
        .update(`${classes}\n${firms.join("\n")}`)
        .digest("hex"),
      detail:
        `${classes} licence classes · ${firms.length} firms in the sample` +
        (down ? ` · ${down}/${SAMPLE.length} cells unreachable` : ""),
      meta: { classes, sample: firms.length, down },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const m = (f: { meta?: unknown }) =>
      (f.meta ?? {}) as { classes?: number; sample?: number; down?: number };
    const a = m(prev);
    const b = m(curr);
    if ((a.down ?? 0) !== (b.down ?? 0))
      return `${b.sample ?? 0} firms sampled, but across a different set of cells than last time — not comparable`;
    if ((a.classes ?? 0) !== (b.classes ?? 0))
      return `the licence TAXONOMY changed: ${a.classes} → ${b.classes} classes — re-run \`npm run cprs:ingest -- --apply --refresh\``;
    const d = (b.sample ?? 0) - (a.sample ?? 0);
    if (d > 0) return `${d} builder(s) entered the register (sample)`;
    if (d < 0) return `${-d} builder(s) left the register (sample)`;
    return "a builder's entry changed (sample count unchanged)";
  },
};
