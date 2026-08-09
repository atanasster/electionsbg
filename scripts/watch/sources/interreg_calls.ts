// Interreg cross-border calls — the third open-calls source, and the only one spread across
// several independent websites.
//
// cadence: daily. Same reasoning as `isun_procedures`: the quantity at stake is a DEADLINE, and
// Greece-Bulgaria's Small Projects Fund calls run ~5-week windows (15/05/2026 → 22/06/2026 on
// the 6th call), so a week's lag costs a reader a fifth of their preparation time.
// `publishes: "irregular"` is accurate rather than evasive — a programme opens a call when its
// Monitoring Committee approves one.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// PER-PROGRAMME, AND A DOWN PROGRAMME IS NOT A CHANGE. This is the one thing this watcher must
// get right and `isun_procedures` never faces.
//
// ИСУН is a single register, so a fetch that fails is a failed probe and throwing is correct.
// Here there are two independent sites, and three MORE Bulgarian cross-border programmes are
// already unreachable (measured 2026-08-09, see interreg_parse.ts). Folding a down programme
// into the fingerprint as „zero calls" would report „2 затворени" on a day nothing changed —
// crying wolf on exactly the signal a reader is supposed to trust — and „2 нови" when the site
// came back. So an unreachable programme is EXCLUDED from the hash and named in the detail line.
//
// BE PRECISE ABOUT WHAT THAT BUYS, because an earlier draft of this comment overclaimed and a
// reviewer disproved it by stubbing a 503: the hash covers only the programmes that answered, so
// dropping one still CHANGES the hash and the run still counts as a change. What exclusion fixes
// is the REPORT — `describe` says „недостъпни: interreg-bsb" instead of „2 свалени", and on
// recovery „отново достъпна" instead of „2 нови". A watcher cannot suppress the event itself
// without prev state, which `fingerprint()` does not receive; the honest goal is that the line a
// human reads names an outage as an outage.
//
// The failure that DOES throw: every programme unreachable. That is a probe failure, not a
// finding, and it must not be recorded as a stable fingerprint.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { sha256Short, fetchText } from "../fingerprint";
import type { Fingerprint, WatchSource, WatchState } from "../types";
import {
  PROGRAMMES,
  parseIndex,
  callSlug,
} from "../../opencalls/interreg_parse";

interface InterregCallsMeta {
  /** Programme code → its call slugs, sorted. Only programmes that answered. */
  slugs: Record<string, string[]>;
  /** Programmes whose index could not be read on this run. */
  down: string[];
}

export const interregCalls: WatchSource = {
  id: "interreg_calls",
  label: "Interreg — трансгранични покани",
  url: PROGRAMMES[0].indexUrl,
  cadence: "daily",
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const slugs: Record<string, string[]> = {};
    const down: string[] = [];

    // Serial, not Promise.all: two small programme secretariats, and the watcher runs daily.
    for (const p of PROGRAMMES) {
      try {
        // `fetchText` returns NULL on failure rather than throwing. Relying on the downstream
        // `html.matchAll` to crash would work by accident and break the moment `parseIndex`
        // grew a null guard of its own — with the failure mode being „programme up, 0 calls",
        // i.e. every call reported closed.
        const html = await fetchText(p.indexUrl, { retries: 2 });
        if (html === null) {
          down.push(p.code);
          continue;
        }
        const found = parseIndex(html, p).map(callSlug).sort();
        // Zero links from a 200 is a markup change or an interstitial, not an empty programme —
        // both of these indexes have always listed at least two calls. Treating it as „down"
        // keeps it out of the hash instead of reporting every call as closed.
        if (found.length === 0) down.push(p.code);
        else slugs[p.code] = found;
      } catch {
        down.push(p.code);
      }
    }

    if (Object.keys(slugs).length === 0)
      throw new Error(
        `no Interreg programme index could be read (${down.join(", ")}) — a probe failure, not an empty register`,
      );

    const total = Object.values(slugs).reduce((n, s) => n + s.length, 0);
    return {
      // `down` programmes contribute NOTHING to the hash — including them would make an outage
      // look like a change. (The programme code is in the hashed string for readability when
      // debugging a diff, NOT as a collision defence: the sorted-code ordering and the `|`
      // separator already partition the slug sets, and mutation-testing confirmed no test can
      // distinguish the keyed form from the keyless one. Stated so nobody defends it as a
      // property it does not have.)
      value: sha256Short(
        Object.keys(slugs)
          .sort()
          .map((code) => `${code}:${slugs[code].join(",")}`)
          .join("|"),
      ),
      detail:
        `${total} покани от ${Object.keys(slugs).length} програми` +
        (down.length ? ` · недостъпни: ${down.join(", ")}` : ""),
      meta: { slugs, down } satisfies InterregCallsMeta,
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = ((prev.meta ?? {}) as Partial<InterregCallsMeta>).slugs ?? {};
    const c = ((curr.meta ?? {}) as Partial<InterregCallsMeta>).slugs ?? {};
    const down = ((curr.meta ?? {}) as Partial<InterregCallsMeta>).down ?? [];

    const bits: string[] = [];
    // Only programmes present in BOTH runs are diffed. A programme that was down last time has
    // no previous slug set, so „everything is new" would be an artefact of the outage.
    for (const code of Object.keys(c).sort()) {
      if (!(code in p)) {
        bits.push(`${code}: отново достъпна`);
        continue;
      }
      const before = new Set(p[code]);
      const after = new Set(c[code]);
      const added = [...after].filter((s) => !before.has(s)).length;
      const gone = [...before].filter((s) => !after.has(s)).length;
      // Both directions: a closure is what makes the archive and the base rates possible, so a
      // day of pure closures must not read as a no-op.
      if (added || gone)
        bits.push(
          `${code}: ${[added && `${added} нови`, gone && `${gone} свалени`]
            .filter(Boolean)
            .join(", ")}`,
        );
    }
    if (down.length) bits.push(`недостъпни: ${down.join(", ")}`);
    return bits.length ? bits.join(" · ") : curr.detail;
  },
};
