// Guard: the static person↔person connections pipeline was retired (connections-engine-v1 §P4). Its
// hooks + components are deleted; /connections + the /person PersonConnections tile now read the live
// PG graph engine (graph-global / graph-ego / person_connections). This test scans src/** and fails
// if any of the retired symbols is re-imported, so the dead pipeline can't creep back in via a
// copy-paste. (tsc already fails on an import of a deleted FILE; this also catches a re-created
// same-named hook/component.)

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at src/screens/components/connections/ — four levels up is src/.
const SRC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// The retired hooks/components. NOTE: NOT `PersonConnections` (the live person-layer tile) nor
// `GraphCanvas` (the new blob canvas).
//
// ⚠️ `CompanyConnectionsSection` / `useCompanyConnections` WERE exempted here as
// „a separate company-page pipeline", and that exemption outlived the pipeline.
// Measured 2026-08-16 (site-hygiene-v1 T6a): the component was imported by
// NOTHING, so the hook had no caller either. Both are deleted and both names are
// in the list below.
//
// ⚠️ THE SHARDS THEY READ ARE NOT ORPHANED, which is the part to know before
// acting on this. `parliament/company-connections/{eik}.json` is still fetched
// live by the AI chat's `companyConnections` tool (`ai/tools/people.ts`,
// registered in `ai/tools/registry.ts`, routed, regression-tested) — which is
// why `src/data/parliament/useCompanyConnections.ts` survives as a TYPE module.
// A grep over `src/`, `scripts/` and `functions/` reports zero readers and is
// wrong: `ai/` is none of those.
//
// ⚠️ NOT orphaned is NOT the same as maintained. That tree is excluded from
// bucket sync (`bucket_sync_paths.ts:63`), and `rsync -x` excludes from DELETION
// too, so the objects have been frozen at 2026-07-29 — the AI tool serves that
// snapshot at a 200. Deleting the shards would break a live tool; leaving them
// is not the same as them being current.

const RETIRED = [
  "CompanyConnectionsSection",
  "useCompanyConnections",
  "useConnectionsGraph",
  "useConnectionsStats",
  "useConnectionsPartyMatrix",
  "useConnectionsTopPairs",
  "useConnectionsRankings",
  "useConnectionsRankingsTop",
  "useConnectionsSearch",
  "useConnectionsFilters",
  "useMpConnections",
  "ConnectionsCanvas",
  "ConnectionPathRow",
  "FilterRail",
  "TopPairsList",
  "ConnectionsHero",
  "OfficialRankingsCard",
  "MpConnectionsMini",
  "MpConnectionsTile",
];

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e) && !e.endsWith(".test.ts")) out.push(full);
  }
  return out;
};

describe("retired connections pipeline", () => {
  it("no src file imports a retired connections hook/component", () => {
    const files = walk(SRC_DIR);
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // Only flag an IMPORT of a retired symbol (a bare mention in a comment is fine).
      for (const sym of RETIRED) {
        const re = new RegExp(`import[^;]*\\b${sym}\\b[^;]*from`, "m");
        if (re.test(text))
          offenders.push(`${path.relative(SRC_DIR, f)} → ${sym}`);
      }
    }
    expect(
      offenders,
      `retired connections symbols re-imported:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
