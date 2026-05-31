// CIK local-elections fingerprint source.
//
// Two kinds of cycle are tracked:
//   • Regular cycles (mi2019, mi2023, future mi2027) ship a downloadable
//     section bundle. We HEAD it and fingerprint on Last-Modified +
//     Content-Length. The bundle URL is NOT a uniform csv.zip — see
//     REGULAR_BUNDLE_URL (mi2023 moved it to tur1/opendata/export.zip).
//   • Partial cycles under a chmi umbrella (chmi2024-2026/<date>_chastichen
//     and _nov) are HTML-only — there is no bundle to HEAD. We enumerate the
//     dated subdirectories from the umbrella index instead; a NEW date folder
//     is the change signal (a council/mayor partial appearing). Both the
//     _chastichen (partial) and _nov (new-election) variants are enumerated.
//
// The source fingerprint is sha256(cycle list joined). When it changes, the
// orchestrator invokes /update-local-elections, which runs one
// `--local-ingest <cycleSlug>` per changed cycle (and `--local-csv <slug>`
// for a regular bundle that re-uploaded).
//
// Cloudflare bypass: cikFetch warms a Playwright cookie once per process and
// reuses it for the rest of the run. See scripts/parsers_local/cik_fetch.ts.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { cikFetchText, cikHead } from "../../parsers_local/cik_fetch";

const ROOT = "https://results.cik.bg";

// Known regular cycles → their downloadable section bundle. Extend when CIK
// publishes a new cycle (mi2027 etc.). Kept static so the watcher doesn't
// fingerprint experimental staging slugs. (2011/2015 are frozen archives —
// intentionally not tracked.)
const REGULAR_BUNDLE_URL: Record<string, string> = {
  mi2019: `${ROOT}/mi2019/csv.zip`,
  mi2023: `${ROOT}/mi2023/tur1/opendata/export.zip`,
};

// Partial-elections umbrellas. Each holds dated subdirectories discovered at
// run time. Extend when CIK rolls a new 4-year umbrella.
const PARTIAL_UMBRELLAS = ["chmi2024-2026"] as const;

type CycleFingerprint = {
  cycle: string; // e.g. "mi2023" or "chmi2024-2026/2024-10-20_chastichen"
  kind: "regular" | "partial";
  bundleUrl: string; // "" for partials (HTML-only, nothing to HEAD)
  lastModified: string | null;
  contentLength: string | null;
  status: number; // partials are existence-based → 200 once discovered
};

const fingerprintRegular = async (cycle: string): Promise<CycleFingerprint> => {
  const bundleUrl = REGULAR_BUNDLE_URL[cycle] ?? `${ROOT}/${cycle}/csv.zip`;
  const head = await cikHead(bundleUrl);
  return {
    cycle,
    kind: "regular",
    bundleUrl,
    lastModified: head.lastModified,
    contentLength: head.contentLength,
    status: head.status,
  };
};

// Discover dated partial-elections subdirectories under an umbrella. CIK's
// root index (which `${ROOT}/<umbrella>/` redirects to) lists every umbrella's
// partials as FULL-URL hrefs with a trailing path, e.g.
//   https://results.cik.bg/chmi2024-2026/2025-10-12_nov/index.html
// so we match the `<umbrella>/<date>_<kind>` segment anywhere in the href.
// Both `_chastichen` (partial) and `_nov` (new election — incl. full council
// re-elections) variants are captured. Existence in the index is the signal.
const discoverPartials = async (umbrella: string): Promise<string[]> => {
  const html = await cikFetchText(`${ROOT}/index.html`, { allow404: true });
  if (!html) return [];
  const found = new Set<string>();
  const re = new RegExp(
    `${umbrella}/(\\d{4}-\\d{2}-\\d{2}_(?:chastichen|nov))`,
    "g",
  );
  for (const m of html.matchAll(re)) {
    found.add(`${umbrella}/${m[1]}`);
  }
  return Array.from(found).sort();
};

type CikResultsMeta = {
  cycles: CycleFingerprint[];
  discoveredAt: string;
};

export const cikResults: WatchSource = {
  id: "cik_results",
  label: "CIK local-elections results bundles",
  url: `${ROOT}/`,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const fps: CycleFingerprint[] = [];
    // Regular cycles: HEAD the bundle. Serialised on purpose — Cloudflare
    // rate-limits concurrent requests more aggressively than sequential ones.
    for (const cycle of Object.keys(REGULAR_BUNDLE_URL)) {
      fps.push(await fingerprintRegular(cycle));
    }
    // Partial cycles: existence-based (HTML-only, no bundle to HEAD). A new
    // date folder appearing in the umbrella index is the signal.
    for (const umbrella of PARTIAL_UMBRELLAS) {
      for (const cycle of await discoverPartials(umbrella)) {
        fps.push({
          cycle,
          kind: "partial",
          bundleUrl: "",
          lastModified: null,
          contentLength: null,
          status: 200,
        });
      }
    }
    // Stable fingerprint string: one line per cycle, sorted by cycle name.
    const value = sha256Short(
      fps
        .slice()
        .sort((a, b) => a.cycle.localeCompare(b.cycle))
        .map(
          (f) =>
            `${f.cycle}\t${f.status}\t${f.lastModified ?? ""}\t${f.contentLength ?? ""}`,
        )
        .join("\n"),
    );
    const regular = fps.filter((f) => f.kind === "regular");
    const partials = fps.filter((f) => f.kind === "partial");
    const reachable = regular.filter((f) => f.status === 200).length;
    const detail = `${reachable}/${regular.length} regular bundle(s) reachable · ${partials.length} partial cycle(s) tracked`;
    const meta: CikResultsMeta = {
      cycles: fps,
      discoveredAt: new Date().toISOString(),
    };
    return { value, detail, meta: meta as unknown as Record<string, unknown> };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const prevCycles =
      (prev?.meta as unknown as CikResultsMeta | undefined)?.cycles ?? [];
    const currCycles =
      (curr.meta as unknown as CikResultsMeta | undefined)?.cycles ?? [];
    const prevByCycle = new Map(prevCycles.map((c) => [c.cycle, c]));
    const changed: string[] = [];
    for (const c of currCycles) {
      const p = prevByCycle.get(c.cycle);
      if (!p) {
        // A newly-appeared cycle: partials are existence-based (always 200);
        // a regular bundle counts only once it's actually reachable.
        if (c.kind === "partial" || c.status === 200) {
          changed.push(`new cycle: ${c.cycle}`);
        }
        continue;
      }
      // Regular bundles also flag on re-upload (Last-Modified/length change).
      if (
        c.kind === "regular" &&
        (c.status !== p.status ||
          c.lastModified !== p.lastModified ||
          c.contentLength !== p.contentLength)
      ) {
        changed.push(`${c.cycle} re-uploaded`);
      }
    }
    if (changed.length === 0) return curr.detail;
    return `${changed.length} cycle(s) changed: ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? "…" : ""}`;
  },
};
