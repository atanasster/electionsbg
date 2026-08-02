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
// `CompanyConnectionsSection` / `useCompanyConnections` (a separate company-page pipeline) nor
// `GraphCanvas` (the new blob canvas) — only the person↔person static-JSON cluster.
const RETIRED = [
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
