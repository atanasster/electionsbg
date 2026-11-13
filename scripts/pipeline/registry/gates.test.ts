import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  at,
  jsonNumber,
  len,
  makeGateCtx,
  noShrink,
  noiYearsLoaded,
  outputLacks,
  runGates,
  snapshotBaselines,
  type GateCtx,
} from "./gates";

const ctxOf = (
  files: Record<string, unknown>,
  head: Record<string, unknown> = {},
  output = "",
): GateCtx => ({
  output,
  readJson: (f) => {
    if (!(f in files)) throw new Error(`ENOENT ${f}`);
    return files[f];
  },
  baselineJson: (f) => head[f],
});

describe("jsonNumber", () => {
  const g = jsonNumber("n", "a.json", (j) => len(at(j, "items")), {
    min: 2,
    max: 3,
  });

  it("passes in range and fails outside, reporting the observed value", () => {
    expect(g.check(ctxOf({ "a.json": { items: [1, 2] } }))).toEqual({
      ok: true,
      expected: "a.json: >= 2 and <= 3",
      observed: "2",
    });
    expect(g.check(ctxOf({ "a.json": { items: [1] } }))).toMatchObject({
      ok: false,
      observed: "1",
    });
  });

  it("fails — never throws — on a missing file or a missing field", () => {
    expect(g.check(ctxOf({}))).toMatchObject({
      ok: false,
      observed: expect.stringMatching(/cannot read: ENOENT/),
    });
    expect(g.check(ctxOf({ "a.json": { other: 1 } }))).toMatchObject({
      ok: false,
      observed: expect.stringMatching(/not a list or object/),
    });
    expect(g.check(ctxOf({ "a.json": null }))).toMatchObject({
      ok: false,
      observed: expect.stringMatching(/no field items/),
    });
  });

  it("supports an exact value", () => {
    const eq = jsonNumber("e", "a.json", (j) => len(at(j, "x")), { eq: 5 });
    expect(eq.check(ctxOf({ "a.json": { x: [1, 2, 3, 4, 5] } })).ok).toBe(true);
    expect(eq.check(ctxOf({ "a.json": { x: [1, 2, 3, 4] } })).ok).toBe(false);
  });
});

describe("noShrink", () => {
  const g = noShrink("s", "a.json", (j) => len(at(j, "items")), 5);

  it("fails on a drop beyond the threshold and allows growth", () => {
    const items = (n: number) => ({
      items: Array.from({ length: n }, (_, i) => i),
    });
    expect(
      g.check(ctxOf({ "a.json": items(90) }, { "a.json": items(100) })),
    ).toMatchObject({
      ok: false,
      observed: "100 → 90 (-10.0%)",
    });
    expect(
      g.check(ctxOf({ "a.json": items(96) }, { "a.json": items(100) })).ok,
    ).toBe(true);
    expect(
      g.check(ctxOf({ "a.json": items(120) }, { "a.json": items(100) }))
        .observed,
    ).toBe("100 → 120 (+20.0%)");
  });

  it("passes a file with no committed copy, and says so", () => {
    expect(g.check(ctxOf({ "a.json": { items: [1] } }))).toMatchObject({
      ok: true,
      observed: "1 (no earlier copy to compare)",
    });
  });
});

describe("outputLacks", () => {
  it("fails on a matching output line and quotes it", () => {
    const g = outputLacks(
      "o",
      /SKIPPED/,
      "a skipped year means a missing year",
    );
    expect(
      g.check(ctxOf({}, {}, "ok\n⚠ 2019 SKIPPED (layout)\ndone")),
    ).toMatchObject({
      ok: false,
      observed: "⚠ 2019 SKIPPED (layout)",
    });
    expect(g.check(ctxOf({}, {}, "all good")).ok).toBe(true);
  });
});

describe("runGates", () => {
  it("evaluates only gates whose sources moved, and survives a throwing gate", () => {
    const gates = [
      outputLacks("always", /x/, "w"),
      outputLacks("scoped", /x/, "w", ["s2"]),
      {
        id: "boom",
        check: () => {
          throw new Error("bad gate");
        },
      },
    ];
    const r = runGates(gates, new Set(["s1"]), ctxOf({}));
    expect(r.map((x) => x.id)).toEqual(["always", "boom"]);
    expect(r[1]).toMatchObject({ ok: false, observed: "gate threw: bad gate" });
  });
});

describe("makeGateCtx", () => {
  it("reads the working copy and the committed copy separately", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gates-"));
    const g = (...a: string[]) =>
      execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ v: 1 }));
    g("add", "a.json");
    g("commit", "-q", "-m", "x");
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ v: 2 }));
    const ctx = makeGateCtx("", undefined, dir);
    expect(ctx.readJson("a.json")).toEqual({ v: 2 });
    // No snapshot: falls back to HEAD.
    expect(ctx.baselineJson("a.json")).toEqual({ v: 1 });
    expect(ctx.baselineJson("missing.json")).toBeUndefined();
  });

  it("prefers the pre-run snapshot over HEAD — the auto-committer case", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gates-"));
    const g = (...a: string[]) =>
      execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    const items = (n: number) =>
      JSON.stringify({ items: Array.from({ length: n }, (_, i) => i) });
    fs.writeFileSync(path.join(dir, "a.json"), items(100));
    const gate = noShrink("s", "a.json", (j) => len(at(j, "items")), 5);
    const snap = snapshotBaselines([gate], dir);
    // The handler shrinks the file, and someone commits it before the gates run.
    fs.writeFileSync(path.join(dir, "a.json"), items(50));
    g("add", "a.json");
    g("commit", "-q", "-m", "auto");
    expect(gate.check(makeGateCtx("", snap, dir))).toMatchObject({
      ok: false,
      observed: "100 → 50 (-50.0%)",
    });
    // Against HEAD alone the same check would compare the file with itself.
    expect(gate.check(makeGateCtx("", undefined, dir)).ok).toBe(true);
  });
});

describe("noiYearsLoaded", () => {
  const ctx = (sigs: Record<string, string>, years: number[]) =>
    ctxOf({
      "state/watch/nssi_b1.json": { meta: { signatures: sigs } },
      "data/budget/noi/funds.json": {
        years: years.map((fiscalYear) => ({ fiscalYear })),
      },
    });

  it("fails when a year the watcher saw published is missing from funds.json", () => {
    const r = noiYearsLoaded().check(
      ctx(
        { "2025-12-5500": "len:1234|lm:x", "2026-12-5500": "status:302" },
        [2023, 2024],
      ),
    );
    expect(r).toMatchObject({
      ok: false,
      observed: "published but not loaded: 2025",
    });
  });

  it("passes when every published year is loaded and ignores unpublished ones", () => {
    const r = noiYearsLoaded().check(
      ctx(
        { "2025-12-5500": "len:1234|lm:x", "2026-12-5500": "status:302" },
        [2024, 2025],
      ),
    );
    expect(r.ok).toBe(true);
  });
});

describe("rollcallSessionsLoaded", () => {
  const W = "state/watch/parliament_votes.json";
  const S = "data/parliament/votes/sessions";
  const watcher = (newSinceLast: unknown) => ({
    [W]: { meta: { maxId: 2, newSinceLast } },
  });

  it("fails when an announced roll-call session has no file", async () => {
    const { rollcallSessionsLoaded } = await import("./gates");
    const g = rollcallSessionsLoaded();
    const announced = [
      { id: 1, date: "2026-11-11", hasRollcall: true },
      { id: 2, date: "2026-11-12", hasRollcall: false },
    ];
    expect(g.check(ctxOf(watcher(announced)))).toMatchObject({
      ok: false,
      observed: "announced but not loaded: 2026-11-11",
    });
    expect(
      g.check(ctxOf({ ...watcher(announced), [`${S}/2026-11-11.json`]: {} })),
    ).toMatchObject({ ok: true });
  });

  it("passes when nothing was announced, and fails on unreadable watcher state", async () => {
    const { rollcallSessionsLoaded } = await import("./gates");
    const g = rollcallSessionsLoaded();
    expect(g.check(ctxOf(watcher([])))).toMatchObject({ ok: true });
    expect(g.check(ctxOf({}))).toMatchObject({ ok: false });
  });
});
