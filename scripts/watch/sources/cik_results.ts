// CIK local-elections fingerprint source.
//
// Tracks the csv.zip bundles for every regular cycle (mi2019, mi2023, future
// mi2027) and every partial-elections cycle umbrella (chmi2024-2026, future
// chmi2028-...). For each cycle we HEAD csv.zip and use Last-Modified +
// Content-Length as the per-cycle fingerprint; the source's overall fingerprint
// is sha256(cycle list joined). When the value changes, the orchestrator
// invokes /update-local-elections which downloads the changed bundle(s) and
// runs the parser tree under scripts/parsers_local/.
//
// Cloudflare bypass: cikFetch warms a Playwright cookie once per process and
// reuses it for the rest of the run. See scripts/parsers_local/cik_fetch.ts.
//
// The watcher must also enumerate dated subdirectories under each chmi
// umbrella (e.g. chmi2024-2026/2024-10-20_chastichen/). We scrape the
// umbrella index page for those — the index is HTML, ~5 KB.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { cikFetchText, cikHead } from "../../parsers_local/cik_fetch";

// Known regular-elections cycles to fingerprint. Extend when CIK publishes a
// new cycle (mi2027 etc.) — we keep this static so the watcher doesn't
// accidentally fingerprint experimental staging slugs.
const REGULAR_CYCLES = ["mi2019", "mi2023"] as const;

// Partial-elections umbrellas. Each holds dated subdirectories we discover
// at run time. Extend when CIK rolls a new 4-year umbrella.
const PARTIAL_UMBRELLAS = ["chmi2024-2026"] as const;

const ROOT = "https://results.cik.bg";

type CycleFingerprint = {
  cycle: string; // e.g. "mi2023" or "chmi2024-2026/2024-10-20_chastichen"
  csvZipUrl: string;
  lastModified: string | null;
  contentLength: string | null;
  status: number;
};

const fingerprintCycle = async (cycle: string): Promise<CycleFingerprint> => {
  const csvZipUrl = `${ROOT}/${cycle}/csv.zip`;
  const head = await cikHead(csvZipUrl);
  return {
    cycle,
    csvZipUrl,
    lastModified: head.lastModified,
    contentLength: head.contentLength,
    status: head.status,
  };
};

// Discover dated partial-elections subdirectories under an umbrella.
// The umbrella index HTML contains <a href="2024-10-20_chastichen/">…</a>
// links — extract via a forgiving regex (CIK's HTML changes between cycles).
const discoverPartials = async (umbrella: string): Promise<string[]> => {
  const indexUrl = `${ROOT}/${umbrella}/`;
  const html = await cikFetchText(indexUrl, { allow404: true });
  if (!html) return [];
  const found = new Set<string>();
  const re = /href="(\d{4}-\d{2}-\d{2}_chastichen)\/?"/g;
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
    const cycles: string[] = [...REGULAR_CYCLES];
    for (const umbrella of PARTIAL_UMBRELLAS) {
      const partials = await discoverPartials(umbrella);
      cycles.push(...partials);
    }
    const fps: CycleFingerprint[] = [];
    for (const cycle of cycles) {
      // Serialised on purpose — Cloudflare rate-limits concurrent requests
      // more aggressively than sequential ones with the same clearance cookie.
      fps.push(await fingerprintCycle(cycle));
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
    const okCount = fps.filter((f) => f.status === 200).length;
    const detail = `${okCount}/${fps.length} csv.zip bundles reachable (${REGULAR_CYCLES.length} regular + ${fps.length - REGULAR_CYCLES.length} partial)`;
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
        if (c.status === 200) changed.push(`new cycle: ${c.cycle}`);
        continue;
      }
      if (
        c.status !== p.status ||
        c.lastModified !== p.lastModified ||
        c.contentLength !== p.contentLength
      ) {
        changed.push(`${c.cycle} re-uploaded`);
      }
    }
    if (changed.length === 0) return curr.detail;
    return `${changed.length} cycle(s) changed: ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? "…" : ""}`;
  },
};
