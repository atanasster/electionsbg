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
// Round-2 (балотаж) for a mayoral partial publishes into the SAME date folder
// ~7 days after round 1, under tur2/. Round-1 HTML marks BOTH runoff finalists
// as elected, so the round-1 ingest can't name the winner — we must re-ingest
// once the runoff is in. There is no reliable server signal to probe (CIK
// serves a populated tur2/ shell even for roundless `_nov` cycles that never
// have a runoff), so we schedule re-ingests purely off the election date in the
// slug: each partial first seen under this mechanism advances a `runoffStage`
// at fixed day offsets (RUNOFF_RECHECK_DAYS), and every advance re-flags the
// cycle so /update-local-elections re-ingests and resolves the real winner.
// Pre-existing partials are grandfathered (never re-flagged) so the rollout is
// a no-op. See resolveRunoff().
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
import { readState } from "../state";
import { cikFetchText, cikHead } from "../../parsers_local/cik_fetch";

const ROOT = "https://results.cik.bg";
const SOURCE_ID = "cik_results";

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
  // Partial only: round-2 runoff re-ingest scheduling. `runoffTracked` is true
  // for partials first seen after this mechanism shipped (pre-existing partials
  // are grandfathered → never re-flagged). `runoffStage` advances monotonically
  // through RUNOFF_RECHECK_DAYS as the election ages; each advance re-flags the
  // cycle so /update-local-elections re-ingests and picks up the runoff.
  runoffTracked: boolean;
  runoffStage: number;
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
    // Regular cycles ship both rounds in one bundle (re-upload is the signal),
    // so the partial-only runoff-recheck machinery doesn't apply.
    runoffTracked: false,
    runoffStage: 0,
  };
};

// Round-2 (балотаж) for a mayoral partial is held a fixed ~7 days after round 1
// and its results publish into the SAME date folder under tur2/. There is no
// reliable existence signal to probe — CIK serves a populated tur2/ navigation
// shell even for roundless `_nov` cycles that never have a runoff — so instead
// of sniffing the server we schedule re-ingests purely off the election date in
// the slug. At each RUNOFF_RECHECK_DAYS threshold the cycle's `runoffStage`
// advances by one, which changes its fingerprint line and re-flags it; the
// re-ingest is idempotent (already-mirrored round-1 pages are skipped) and
// picks up whatever tur2 pages have since appeared. Two thresholds cover both
// the usual 7-day runoff (caught at day 9) and a 14-day schedule or a late CIK
// upload (caught at day 16).
const RUNOFF_RECHECK_DAYS = [9, 16] as const;

const electionAgeDays = (cycle: string): number | null => {
  const m = cycle.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const day = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (Number.isNaN(day)) return null;
  return (Date.now() - day) / 86_400_000;
};

const stageForAge = (age: number): number =>
  RUNOFF_RECHECK_DAYS.filter((d) => age >= d).length;

// Decide the runoff-recheck bookkeeping for a partial. Pre-existing partials
// (present in prior state but never tracked) are grandfathered — frozen at
// stage 0 so they never re-flag and the fingerprint stays byte-identical on
// rollout. A partial first seen now is tracked from birth; its stage only ever
// advances (monotonic), so a transient clock/age quirk can't walk it backwards.
const resolveRunoff = (
  cycle: string,
  kind: "regular" | "partial",
  prev: CycleFingerprint | undefined,
): { runoffTracked: boolean; runoffStage: number } => {
  if (kind !== "partial") return { runoffTracked: false, runoffStage: 0 };
  const tracked = prev ? (prev.runoffTracked ?? false) : true;
  if (!tracked) return { runoffTracked: false, runoffStage: 0 };
  const age = electionAgeDays(cycle);
  const stage = Math.max(
    prev?.runoffStage ?? 0,
    age === null ? 0 : stageForAge(age),
  );
  return { runoffTracked: true, runoffStage: stage };
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
  id: SOURCE_ID,
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
    // date folder appearing in the umbrella index is the round-1 signal; the
    // runoff is then caught by the date-driven re-ingest stages (resolveRunoff).
    // We consult the previous state to grandfather already-tracked partials and
    // to keep each cycle's runoff stage monotonic.
    const prevByCycle = new Map(
      (
        (readState(SOURCE_ID)?.meta as unknown as CikResultsMeta | undefined)
          ?.cycles ?? []
      ).map((c) => [c.cycle, c] as const),
    );
    for (const umbrella of PARTIAL_UMBRELLAS) {
      for (const cycle of await discoverPartials(umbrella)) {
        fps.push({
          cycle,
          kind: "partial",
          bundleUrl: "",
          lastModified: null,
          contentLength: null,
          status: 200,
          ...resolveRunoff(cycle, "partial", prevByCycle.get(cycle)),
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
            `${f.cycle}\t${f.status}\t${f.lastModified ?? ""}\t${f.contentLength ?? ""}${f.runoffTracked && f.runoffStage > 0 ? `\tr2:${f.runoffStage}` : ""}`,
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
      // A partial entering a runoff-recheck stage — round 1 was ingested
      // earlier (both finalists stubbed as elected); re-ingesting now picks up
      // the tur2 pages published since and resolves the real winner.
      if (c.kind === "partial" && c.runoffStage > (p.runoffStage ?? 0)) {
        changed.push(`${c.cycle} тур2 (runoff) re-check`);
      }
    }
    if (changed.length === 0) return curr.detail;
    return `${changed.length} cycle(s) changed: ${changed.slice(0, 4).join(", ")}${changed.length > 4 ? "…" : ""}`;
  },
};
