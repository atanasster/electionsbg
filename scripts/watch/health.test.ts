import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  egressMismatch,
  readHealth,
  standingProblem,
  updateHealth,
  writeHealth,
  reachable,
} from "./health";
import { renderJsonReport, renderReport } from "./report";
import type { ReportEntry, WatchSource } from "./types";

describe("updateHealth", () => {
  it("counts a failure streak and resets it on the next good run", () => {
    let h = updateHealth(
      {},
      [{ id: "a", status: "error", error: "boom" }],
      "t1",
    );
    h = updateHealth(
      h,
      [{ id: "a", status: "error", error: "boom again" }],
      "t2",
    );
    expect(h.a).toEqual({
      consecutiveErrors: 2,
      firstFailedAt: "t1",
      lastError: "boom again",
    });
    h = updateHealth(h, [{ id: "a", status: "unchanged" }], "t3");
    expect(h.a).toEqual({ consecutiveErrors: 0, lastOkAt: "t3" });
  });

  it("leaves the error streak untouched for an off-cadence or blocked run", () => {
    const h0 = updateHealth(
      {},
      [{ id: "a", status: "error", error: "x" }],
      "t1",
    );
    const h1 = updateHealth(
      h0,
      [
        { id: "a", status: "skipped" },
        { id: "a", status: "blocked" },
      ],
      "t2",
    );
    expect(h1.a).toEqual({ ...h0.a, consecutiveBlocked: 1 });
  });

  it("counts a blocked streak, and escalates it as a standing problem", () => {
    let h = {};
    for (const t of ["t1", "t2", "t3"])
      h = updateHealth(h, [{ id: "a", status: "blocked" }], t);
    expect(standingProblem((h as Record<string, never>).a)).toMatch(
      /blocked 3 runs in a row/,
    );
    h = updateHealth(h, [{ id: "a", status: "unchanged" }], "t4");
    expect(standingProblem((h as Record<string, never>).a)).toBeNull();
  });

  it("round-trips through the file, and reads a missing or corrupt file as empty", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "health-")),
      "_health.json",
    );
    expect(readHealth(f)).toEqual({});
    writeHealth({ a: { consecutiveErrors: 1 } }, f);
    expect(readHealth(f)).toEqual({ a: { consecutiveErrors: 1 } });
    fs.writeFileSync(f, "{bad");
    expect(readHealth(f)).toEqual({});
  });
});

describe("egressMismatch", () => {
  it("blocks only a declared, known mismatch", () => {
    expect(egressMismatch("non-bg", "BG")).toMatch(/NON-Bulgarian/);
    expect(egressMismatch("bg", "DE")).toMatch(
      /needs a Bulgarian exit; this run exits via DE/,
    );
    expect(egressMismatch("non-bg", "DE")).toBeNull();
    expect(egressMismatch("bg", "BG")).toBeNull();
    expect(egressMismatch(undefined, "BG")).toBeNull();
    // Unknown country: probe anyway rather than guess.
    expect(egressMismatch("non-bg", null)).toBeNull();
  });
});

describe("reports", () => {
  const src = (id: string): WatchSource =>
    ({
      id,
      label: `label ${id}`,
      url: "u",
      cadence: "daily",
      fingerprint: async () => ({ value: "", detail: "" }),
    }) as WatchSource;
  const entries: ReportEntry[] = [
    { source: src("ok"), status: "unchanged", line: "fine", durationMs: 120 },
    {
      source: src("bad"),
      status: "error",
      line: "timeout",
      error: "timeout",
      durationMs: 300000,
      consecutiveErrors: 4,
    },
    {
      source: src("vpn"),
      status: "blocked",
      line: "needs a NON-Bulgarian exit",
      consecutiveBlocked: 5,
    },
  ];

  it("renders a Blocked section and a failure streak in markdown", () => {
    const md = renderReport(entries, "2026-11-12T00:00:00Z");
    expect(md).toMatch(
      /## Blocked \(wrong exit country — not probed\)\n- label vpn: needs a NON-Bulgarian exit _\(blocked 5 runs in a row\)_/,
    );
    expect(md).toMatch(
      /\*\*label bad\*\*: timeout _\(failing 4 runs in a row\)_/,
    );
  });

  it("renders every source as data in the JSON report", () => {
    const j = renderJsonReport(entries, "2026-11-12T00:00:00Z", "BG");
    expect(j).toMatchObject({ schema: 1, egress: "BG" });
    expect(j.sources[2]).toMatchObject({ consecutiveBlocked: 5 });
    expect(
      renderJsonReport(entries, "2026-11-12T00:00:00Z", null, "HTTP 503"),
    ).toMatchObject({ egress: null, egressError: "HTTP 503" });
    expect(j.sources.map((s) => [s.id, s.status])).toEqual([
      ["ok", "unchanged"],
      ["bad", "error"],
      ["vpn", "blocked"],
    ]);
    expect(j.sources[1]).toMatchObject({
      durationMs: 300000,
      consecutiveErrors: 4,
      error: "timeout",
    });
  });
});

describe("reachable — the egress gate asks the host before skipping", () => {
  const ok = (async () => new Response("x", { status: 403 })) as typeof fetch;
  const dead = (async () => {
    throw new Error("connect ETIMEDOUT");
  }) as typeof fetch;
  it("treats ANY HTTP status as reachable (a bot-wall 403 is still a live host)", async () => {
    expect(await reachable("https://example.test/", ok)).toBe(true);
  });
  it("treats a thrown fetch (timeout / TLS / connect) as unreachable", async () => {
    expect(await reachable("https://example.test/", dead)).toBe(false);
  });
});
