// Every registered watch source must have a row in the orchestrator's source→skill map.
//
// ⚠ A SOURCE WITH NO ROW IS WATCHED DAILY AND ROUTED NOWHERE. `process-watch-report` logs
// „skipped — no handler" and moves on, so the fingerprint flips, the report says something
// changed, and no ingest runs — a silence that looks exactly like a quiet day. Adding a
// source is two edits in two directories and nothing connected them; this is the connection.
//
// The repo already has this gate shape for a different registry:
// `scripts/db/cloud_loader_coverage.test.ts` reads the same SKILL.md and fails on an unmapped
// loader. Pure — no network, no database.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCES } from "./sources";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MAP = path.join(REPO, ".claude/skills/process-watch-report/SKILL.md");

/** Sources the map deliberately does not route, each with the reason.
 *
 *  ⚠ AN ENTRY HERE IS A DECISION, NOT A TODO. A stale exemption fails too — the test below
 *  refuses a name that is no longer registered — so this list cannot become the place an
 *  unrouted source hides. */
const UNROUTED: Record<string, string> = {
  // Measured 2026-09-06: the map discusses both at length under a different heading —
  // „Interreg (programme re-imports)" and „Ember Yearly Electricity Data" — so each IS
  // routed; what it does not do is spell the source id. Exempted rather than renamed,
  // because editing a prose runbook to satisfy a regex is the wrong direction.
  interreg_calls: "routed under the Interreg programme re-imports heading",
  ember_generation: "routed under the Ember Yearly Electricity Data heading",
};

describe("the orchestrator's source→skill map", () => {
  const map = fs.readFileSync(MAP, "utf-8");

  it("names every registered source somewhere in the map", () => {
    // ⚠ MATCHED ON THE ID, NOT THE LABEL. The map's row headings are shortened, human-facing
    // versions of a source's label — measured, only 35 of 125 labels appear verbatim while
    // 122 of the ids do. A label match would need 90 exemptions, which is the same as no gate.
    const missing = SOURCES.filter(
      (s) => !UNROUTED[s.id] && !map.includes(s.id) && !map.includes(s.label),
    ).map((s) => `${s.id} (${s.label})`);
    expect(
      missing.slice(0, 10),
      `${missing.length} registered source(s) have no row in ${path.relative(REPO, MAP)} — ` +
        "they would be watched daily and routed nowhere",
    ).toEqual([]);
    // Non-vacuity: an empty registry, or a SKILL.md that failed to read, would pass above.
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(map.length).toBeGreaterThan(10_000);
  });

  it("carries no exemption for a source that is no longer registered", () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const id of Object.keys(UNROUTED))
      expect(
        ids.has(id),
        `${id} is exempted here and no longer registered`,
      ).toBe(true);
  });
});
