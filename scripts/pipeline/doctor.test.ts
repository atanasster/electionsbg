import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  countTrackedChanges,
  envSetsKey,
  evaluate,
  parseCfTrace,
  pendingManifestFact,
  readLock,
  renderDoctor,
  type Facts,
} from "./doctor";
import { HANDLERS, NEEDS, stepNeeds } from "./registry";

const NOW = new Date("2026-11-12T00:00:00Z");

const healthy: Facts = {
  country: "DE",
  pgLocal: true,
  proxy: true,
  pricesTarget: "/Volumes/Storage/data-bg/raw_data/prices",
  pricesMounted: true,
  trState: true,
  bins: { pdftotext: true, unzip: true, gsutil: true },
  geminiKey: true,
  display: true,
  git: { branch: "main", midOperation: null, dirtyUnderData: 3 },
  lock: null,
  pendingManifest: null,
  shmMb: 1024,
};

describe("evaluate", () => {
  it("reports exactly one egress need unmet for any known country", () => {
    expect([...evaluate(healthy, NOW).unmet.keys()]).toEqual(["egress:bg"]);
    const bg = evaluate({ ...healthy, country: "BG" }, NOW);
    expect([...bg.unmet.keys()]).toEqual(["egress:non-bg"]);
  });

  it("fails both egress needs when the country is unknown, saying why", () => {
    const r = evaluate(
      { ...healthy, country: null, countryError: "timeout" },
      NOW,
    );
    expect(r.unmet.has("egress:bg")).toBe(true);
    expect(r.unmet.has("egress:non-bg")).toBe(true);
    expect(r.unmet.get("egress:bg")).toMatch(/unknown \(timeout\)/);
  });

  it("maps each machine fact to its need", () => {
    const r = evaluate(
      {
        ...healthy,
        pgLocal: false,
        display: false,
        pricesMounted: false,
        trState: false,
        bins: { pdftotext: false, unzip: false, gsutil: true },
        geminiKey: false,
      },
      NOW,
    );
    for (const need of [
      "pg-local",
      "headed",
      "drive:prices",
      "tr-state",
      "bin:pdftotext",
      "bin:unzip",
      "gemini",
    ])
      expect(r.unmet.has(need as never), need).toBe(true);
    expect(r.unmet.get("pg-local")).toMatch(/db:pg:up/);
  });

  it("never turns an info check into an unmet need", () => {
    const r = evaluate(
      {
        ...healthy,
        proxy: false,
        bins: { ...healthy.bins, gsutil: false },
        git: { branch: "feature", midOperation: "rebase", dirtyUnderData: 0 },
        lock: { pid: 1, session: "s", alive: true },
        pendingManifest: { ageH: 100 },
        shmMb: 64,
      },
      NOW,
    );
    expect([...r.unmet.keys()]).toEqual(["egress:bg"]);
    const failing = r.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failing).toEqual(
      expect.arrayContaining([
        "proxy",
        "bin:gsutil",
        "git",
        "lock",
        "pending-manifest",
        "pg-shm",
      ]),
    );
  });

  it("decides every need the registry declares", () => {
    // A need with no check is silently "met" forever — the planner would never
    // block on it.
    const declared = new Set(
      HANDLERS.flatMap((h) => h.steps.flatMap((s) => stepNeeds(h, s))),
    );
    const decided = new Set(evaluate(healthy, NOW).checks.map((c) => c.need));
    expect([...declared].filter((n) => !decided.has(n))).toEqual([]);
  });

  it("renders FAIL for an unmet need and warn for an info problem", () => {
    const text = renderDoctor(
      evaluate({ ...healthy, pgLocal: false, proxy: false }, NOW),
    );
    expect(text).toMatch(/^FAIL pg-local/m);
    expect(text).toMatch(/^warn proxy/m);
    expect(text).toMatch(/need\(s\) unmet: .*pg-local/);
  });
});

describe("parseCfTrace", () => {
  it("reads the loc line and nothing else", () => {
    expect(parseCfTrace("fl=1\nip=x\nloc=BG\ntls=TLSv1.3\n")).toBe("BG");
    expect(parseCfTrace("ip=x\nloc=\n")).toBeNull();
    expect(parseCfTrace("<html>blocked</html>")).toBeNull();
  });
});

describe("readLock", () => {
  const tmp = (): string =>
    fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-lock-"));

  it("returns null without a lock file", () => {
    expect(readLock(path.join(tmp(), "lock"))).toBeNull();
  });

  it("sees this process as alive and a dead pid as stale", () => {
    const dir = tmp();
    const f = path.join(dir, "lock");
    fs.writeFileSync(f, JSON.stringify({ pid: process.pid, session: "s1" }));
    expect(readLock(f)).toEqual({
      pid: process.pid,
      session: "s1",
      alive: true,
    });
    fs.writeFileSync(f, JSON.stringify({ pid: 2 ** 22 + 7, session: "s2" }));
    expect(readLock(f)?.alive).toBe(false);
  });

  it("treats an unreadable lock as stale rather than throwing", () => {
    const f = path.join(tmp(), "lock");
    fs.writeFileSync(f, "{oops");
    expect(readLock(f)).toMatchObject({ alive: false });
  });
});

describe("fact shaping", () => {
  it("dates a manifest, and never reports an undatable one as fresh", () => {
    const base = { session: "s", skills: [], paths: [], cloudCommands: [] };
    expect(
      pendingManifestFact({ ...base, createdAt: "2026-11-11T00:00:00Z" }, NOW),
    ).toEqual({ ageH: 24 });
    expect(pendingManifestFact({ ...base, createdAt: "" }, NOW)).toEqual({
      problem: expect.stringMatching(/no valid createdAt/),
    });
    expect(pendingManifestFact(null, NOW)).toEqual({
      problem: expect.stringMatching(/does not parse/),
    });
    const r = evaluate(
      { ...healthy, pendingManifest: { problem: "bad" } },
      NOW,
    ).checks.find((c) => c.id === "pending-manifest");
    expect(r).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/^bad/),
    });
  });

  it("reads GEMINI_API_KEY the way a .env file writes it", () => {
    expect(envSetsKey("GEMINI_API_KEY=abc")).toBe(true);
    expect(envSetsKey("FOO=1\n  export GEMINI_API_KEY = 'abc' # note")).toBe(
      true,
    );
    expect(envSetsKey('GEMINI_API_KEY="abc"')).toBe(true);
    expect(envSetsKey('GEMINI_API_KEY=""')).toBe(false);
    expect(envSetsKey("GEMINI_API_KEY=")).toBe(false);
    expect(envSetsKey("# GEMINI_API_KEY=abc")).toBe(false);
    expect(envSetsKey("OTHER_GEMINI_API_KEY=abc")).toBe(false);
  });

  it("counts tracked changes only, not untracked files", () => {
    expect(
      countTrackedChanges(" M data/a.json\n?? data/new.json\nD  data/b.json\n"),
    ).toBe(2);
    expect(countTrackedChanges("")).toBe(0);
  });

  it("names a detached head and a failed git distinctly", () => {
    const detail = (branch: string | null): string =>
      evaluate(
        { ...healthy, git: { ...healthy.git, branch } },
        NOW,
      ).checks.find((c) => c.id === "git")!.detail;
    expect(detail("HEAD")).toMatch(/detached HEAD/);
    expect(detail(null)).toMatch(/git failed/);
  });

  it("keeps NEEDS in step with the checks evaluate() makes", () => {
    const decided = evaluate(healthy, NOW).checks.flatMap((c) =>
      c.need ? [c.need] : [],
    );
    expect([...decided].sort()).toEqual([...NEEDS].sort());
  });
});

describe("cli", () => {
  // Argument errors must exit 2 BEFORE the machine is probed — so these runs
  // touch no network and print nothing on stdout.
  const run = (...args: string[]) =>
    spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/pipeline/cli/doctor.ts", ...args],
      {
        encoding: "utf8",
      },
    );

  it.each([["--bogus"], ["--require"], ["--require", "pg-local,nope"]])(
    "rejects %j with exit 2 and no report",
    (...args) => {
      const r = run(...args);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
    },
  );
});
