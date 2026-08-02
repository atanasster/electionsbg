// The ratchet replaces a floor that could never fail. Its one safety property —
// it only ever moves UP — is what stops a bad run laundering a regression into
// the new normal, so it is worth testing directly.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let file: string;

// The module resolves its path at import time, so each case gets a fresh temp
// file and a fresh module registry.
const load = async () => {
  vi.resetModules();
  vi.doMock("node:url", async (orig) => ({
    ...(await orig<typeof import("node:url")>()),
    fileURLToPath: () => path.join(dir, "scripts", "procurement", "x.ts"),
  }));
  return import("./kzk_baselines");
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kzk-baselines-"));
  file = path.join(dir, "data", "procurement", "derived", "kzk_baselines.json");
});

afterEach(() => {
  vi.doUnmock("node:url");
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("kzk baselines ratchet", () => {
  it("falls back to the historical floor when no file exists", async () => {
    const { readBaselines } = await load();
    const b = readBaselines();
    expect(b.outcomes).toBe(2098);
    expect(b.matched).toBe(0);
  });

  it("raises each field and reports which moved", async () => {
    const { recordBaselines, readBaselines } = await load();
    const raised = recordBaselines(
      { outcomes: 3014, matched: 2860 },
      "2026-08-02",
    );
    expect(raised.sort()).toEqual(["matched", "outcomes"]);
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.matched).toBe(2860);
    expect(b.updatedAt).toBe("2026-08-02");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("NEVER lowers a recorded value", async () => {
    const { recordBaselines, readBaselines } = await load();
    recordBaselines({ outcomes: 3014, matched: 2860 }, "2026-08-02");
    // A run against a half-loaded database must not be able to move the bar down
    // and thereby make its own regression the new normal.
    const raised = recordBaselines({ outcomes: 12, matched: 5 }, "2026-08-03");
    expect(raised).toEqual([]);
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.matched).toBe(2860);
    expect(b.updatedAt).toBe("2026-08-02"); // unchanged: nothing moved
  });

  it("does not rewrite the file when nothing moved", async () => {
    const { recordBaselines } = await load();
    recordBaselines({ outcomes: 3014, matched: 2860 }, "2026-08-02");
    const before = fs.readFileSync(file, "utf8");
    recordBaselines({ outcomes: 3014, matched: 2860 }, "2026-09-09");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("treats a corrupt ratchet as the floor, not as no bar at all", async () => {
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    expect(readBaselines().outcomes).toBe(2098);
  });

  it("never ratchets handSeeded — that population is closed", async () => {
    const mod = await load();
    // The only way the observed count can rise is the laundering hazard, so the
    // floor is a CONSTANT. Raising it would make that corruption self-certifying.
    expect(mod.HAND_SEEDED_FLOOR).toBe(2098);
    expect(Object.keys(mod.readBaselines())).not.toContain("handSeeded");
  });

  it("fills a missing field from the floor rather than reading it as zero", async () => {
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ outcomes: 3014 }));
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.matched).toBe(0);
  });
});
