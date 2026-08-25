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
    // NOT 0. A bar of zero passes forever — the "cannot tell healthy from
    // frozen" failure this whole file replaced — so "no bar yet" has to be
    // distinguishable, and Gate D fails on null with the mint command.
    expect(b.reached).toBeNull();
  });

  it("raises each field and reports which moved", async () => {
    const { recordBaselines, readBaselines } = await load();
    const raised = recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-08-02",
    );
    // `matched` is NOT here: it is an observation, not a bar. Re-arming a
    // `matched` ratchet reinstates the 2026-08-25 false positive.
    expect(raised.raised.sort()).toEqual(["outcomes", "reached"]);
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.matched).toBe(2860);
    expect(b.reached).toBe(4900);
    expect(b.updatedAt).toBe("2026-08-02");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("NEVER lowers a BAR", async () => {
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-08-02",
    );
    // A run against a half-loaded database must not be able to move the bar down
    // and thereby make its own regression the new normal.
    const raised = recordBaselines(
      { outcomes: 12, matched: 5, reached: 9 },
      "2026-08-03",
    );
    expect(raised.raised).toEqual([]);
    const b = readBaselines();
    expect(b.outcomes).toBe(3014);
    expect(b.reached).toBe(4900);
    expect(b.updatedAt).toBe("2026-08-02"); // unchanged: no BAR moved
  });

  it("DOES lower `matched` — it is an observation, and that is the point", async () => {
    // The counter-test to the one above, and the distinction the Gate D swap
    // rests on. Kept as a running max, `matched` would sit at 2,860 for ever
    // while the matcher reported 2,858 — a committed number describing nothing.
    // A fall in it is how a reader SEES corpus growth withdrawing matches, which
    // is the signal the old gate mistook for a regression.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-08-02",
    );
    const raised = recordBaselines(
      { outcomes: 3014, matched: 2858, reached: 4900 },
      "2026-09-09",
    );
    expect(raised.raised).toEqual([]); // no bar moved, so nothing is "raised"…
    const b = readBaselines();
    expect(b.matched).toBe(2858); // …but the observation was refreshed
    expect(b.updatedAt).toBe("2026-08-02"); // `updatedAt` means "bar", not "write"
  });

  it("an observation-only write is REPORTED, not silent", async () => {
    // The rejoin prints its commit instruction from this return value, and
    // kzk_baselines.json is COMMITTED — so a write nobody is told about leaves a
    // modified tracked file behind, in a repo with a concurrent auto-committer.
    // `reached` holding while `matched` drifts is the STEADY STATE after the
    // 2026-08-25 swap, not a corner case, which is why `wrote` exists apart from
    // `raised` instead of being inferred from it.
    const { recordBaselines } = await load();
    recordBaselines(
      { outcomes: 3078, matched: 2918, reached: 4932 },
      "2026-08-25",
    );
    const before = fs.readFileSync(file, "utf8");
    const res = recordBaselines(
      { outcomes: 3078, matched: 2915, reached: 4932 },
      "2026-09-01",
    );
    expect(fs.readFileSync(file, "utf8")).not.toBe(before); // the file DID move…
    expect(res.wrote).toBe(true); // …and the caller can tell…
    expect(res.raised).toEqual([]); // …without it counting as a raise
  });

  it("reports wrote:false when the file genuinely did not move", async () => {
    // The other half of the pair: `wrote` must discriminate, or the rejoin
    // prints a commit instruction after every run and the operator learns to
    // ignore it.
    const { recordBaselines } = await load();
    recordBaselines(
      { outcomes: 3078, matched: 2918, reached: 4932 },
      "2026-08-25",
    );
    const res = recordBaselines(
      { outcomes: 3078, matched: 2918, reached: 4932 },
      "2026-09-01",
    );
    expect(res.wrote).toBe(false);
    expect(res.raised).toEqual([]);
  });

  it("does not rewrite the file when nothing moved", async () => {
    const { recordBaselines } = await load();
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-08-02",
    );
    const before = fs.readFileSync(file, "utf8");
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-09-09",
    );
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("treats a corrupt ratchet as the floor, not as no bar at all", async () => {
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    expect(readBaselines().outcomes).toBe(2098);
    expect(readBaselines().reached).toBeNull();
  });

  it("reads a file written before the Gate D swap as NO BAR, not a bar of 0", async () => {
    // The realistic transition state: `kzk_baselines.json` is COMMITTED, so any
    // checkout from before 2026-08-25 carries outcomes + matched and no
    // `reached`. Read as 0 that would satisfy `report.reached >= 0` for ever on
    // every database — a gate that never looks, wearing the ratchet's name.
    const { readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        outcomes: 3078,
        matched: 2920,
        updatedAt: "2026-08-21",
      }),
    );
    const b = readBaselines();
    expect(b.outcomes).toBe(3078);
    expect(b.reached).toBeNull();
    expect(b.reached).not.toBe(0);
  });

  it("counts the FIRST mint of a bar as raised, so the operator is told to commit", async () => {
    // null → number is the transition that ARMS Gate D. Reported as "nothing
    // moved" the rejoin prints no commit instruction, the file stays unstaged,
    // and the next run reads no bar again — the mint silently never lands.
    const { recordBaselines, readBaselines } = await load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        outcomes: 3078,
        matched: 2920,
        updatedAt: "2026-08-21",
      }),
    );
    const raised = recordBaselines(
      { outcomes: 3078, matched: 2918, reached: 4932 },
      "2026-08-25",
    );
    expect(raised.raised).toEqual(["reached"]);
    const b = readBaselines();
    expect(b.reached).toBe(4932);
    expect(b.matched).toBe(2918); // the observation follows the matcher down
    expect(b.updatedAt).toBe("2026-08-25");
  });

  it("a null observation cannot erase an existing bar", async () => {
    // Defensive: a caller that fails to compute `reached` must hold the line
    // rather than blank it, for the same reason a half-loaded run may not lower
    // one. Ratchets fail closed.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-08-02",
    );
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: null },
      "2026-09-09",
    );
    expect(readBaselines().reached).toBe(4900);
  });

  it("a NON-FINITE observation cannot erase an existing bar either", async () => {
    // `??` catches null and undefined; NaN sails through Math.max, and
    // JSON.stringify(NaN) is `null` — so without a finiteness guard the bar is
    // not merely held, it is DESTROYED, and Gate D's recovery is a re-mint from
    // the current corpus. That launders whatever regression is live into the new
    // normal, the one direction this file's header forbids.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: 4900 },
      "2026-08-02",
    );
    recordBaselines(
      { outcomes: 3014, matched: 2858, reached: Number.NaN },
      "2026-09-09",
    );
    expect(readBaselines().reached).toBe(4900);
  });

  it("a non-finite observation cannot MINT a bar out of nothing", async () => {
    // The same guard from the other side: with no bar yet, NaN must leave the
    // ratchet unarmed so Gate D keeps failing with the mint command, rather than
    // writing `null` and looking minted.
    const { recordBaselines, readBaselines } = await load();
    recordBaselines(
      { outcomes: 3014, matched: 2860, reached: Number.POSITIVE_INFINITY },
      "2026-08-02",
    );
    expect(readBaselines().reached).toBeNull();
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
