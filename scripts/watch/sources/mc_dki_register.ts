// Watch МК's ДКИ listing pages — the source of data/culture/dki_register.json.
// Maps to the `update-culture` skill (process-watch-report).
//
// The fingerprint is over the INSTITUTE NAMES the pages parse to, not over the
// raw HTML. That is the whole design: these are WordPress/Elementor pages on a
// ministry site, so the markup churns on every unrelated CMS change, a nonce or
// a menu edit — and a fingerprint that flips weekly for no reason is one nobody
// reads. A theatre opening, closing or being renamed flips this; a template
// tweak does not.
//
// The director names are deliberately OUT of the fingerprint. Directors change
// often, the register is the only place we see it, and folding them in would
// bury „МК added an institute" under a stream of personnel churn. The ingest
// still captures them; this only decides when somebody is told.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { BROWSER_UA, DKI_PAGES } from "../../culture/dki/sources";
import { parseDkiPage } from "../../culture/dki/parse";

const instituteNames = async (): Promise<{
  names: string[];
  down: string[];
}> => {
  const names: string[] = [];
  const down: string[] = [];
  for (const page of DKI_PAGES) {
    // insecureTls: mc.government.bg serves an incomplete certificate chain —
    // see the note in scripts/culture/dki/ingest.ts.
    const html = await fetchText(page.url, {
      headers: { "User-Agent": BROWSER_UA },
      insecureTls: true,
    });
    if (!html) {
      down.push(page.id);
      continue;
    }
    try {
      names.push(
        ...parseDkiPage(html, page).map((e) => `${page.id}:${e.name}`),
      );
    } catch {
      // A template change is not an emptied register.
      down.push(page.id);
    }
  }
  // Every page down is a probe failure, not a ministry that closed the sector.
  if (down.length === DKI_PAGES.length)
    throw new Error(
      `no ДКИ page could be read (${down.join(", ")}) — a probe failure, not an empty register`,
    );
  return { names: names.sort(), down };
};

export const mcDkiRegister: WatchSource = {
  id: "mc_dki_register",
  label: "МК регистър на държавните културни институти (mc.government.bg)",
  url: DKI_PAGES[0].url,
  cadence: "monthly",
  // МК hand-edits these pages: a body is created, renamed or closed by act,
  // never on a schedule. Declared so the cadence ratchet actually binds — it is
  // optional only because 100+ sources predate the field.
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const { names, down } = await instituteNames();
    return {
      // The hash covers only the pages that ANSWERED. Folding an unreachable
      // page in as „zero institutes" is what turns an outage into a data event.
      value: createHash("sha256").update(names.join("\n")).digest("hex"),
      detail:
        `${names.length} държавни културни институти listed` +
        (down.length ? ` · недостъпни: ${down.join(", ")}` : ""),
      meta: { count: names.length, down },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const m = (f: { meta?: unknown }) =>
      (f.meta ?? {}) as { count?: number; down?: string[] };
    const was = m(prev);
    const now = m(curr);
    // ⚠️ A DELTA ACROSS A DIFFERENT PAGE SET IS NOT A DELTA. One of three pages
    // timing out used to report „32 ДКИ listed (was 70) — МК removed 38", write
    // that to state, and then report „МК added 38" on recovery: two false data
    // events from one transient outage, each routed to an operator whose mapped
    // action is to re-run the ingest. 32 of 70 is the sharp case — a plausible
    // number, where 0 would have read as an obvious outage.
    const coverage = (x: { down?: string[] }) =>
      [...(x.down ?? [])].sort().join(",");
    if (coverage(was) !== coverage(now))
      return (
        `${now.count ?? 0} ДКИ listed across a different set of pages than last time ` +
        `(недостъпни сега: ${coverage(now) || "няма"}; преди: ${coverage(was) || "няма"}) ` +
        `— not comparable, re-check when every page answers`
      );
    const a = Number(was.count ?? 0);
    const b = Number(now.count ?? 0);
    if (b > a) return `${b} ДКИ listed (was ${a}) — МК added ${b - a}`;
    if (b < a) return `${b} ДКИ listed (was ${a}) — МК removed ${a - b}`;
    return "an institute was renamed (count unchanged)";
  },
};
