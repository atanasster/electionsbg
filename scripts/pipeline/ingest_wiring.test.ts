import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dataDirsTouchedIn,
  outputSignatureIn,
  writeManifestSafely,
} from "./ingest_wiring";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe("writeManifestSafely", () => {
  it("merges into an existing manifest", () => {
    const f = path.join(tmp("man-"), "pending.json");
    expect(
      writeManifestSafely(
        { session: "a", paths: ["x"], cloudCommands: [], skills: ["s1"] },
        f,
      ),
    ).toEqual({ ok: true });
    writeManifestSafely(
      { session: "b", paths: ["y"], cloudCommands: [], skills: ["s2"] },
      f,
    );
    expect(JSON.parse(fs.readFileSync(f, "utf8"))).toMatchObject({
      paths: ["x", "y"],
      skills: ["s1", "s2"],
    });
  });

  it("refuses to overwrite a manifest that does not parse", () => {
    const f = path.join(tmp("man-"), "pending.json");
    fs.writeFileSync(f, "{truncated");
    const r = writeManifestSafely(
      { session: "a", paths: ["x"], cloudCommands: [], skills: [] },
      f,
    );
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/does not parse/),
    });
    expect(fs.readFileSync(f, "utf8")).toBe("{truncated");
  });
});

describe("dataDirsTouchedIn", () => {
  it("finds matching dirs written since the start, and survives a broken symlink", () => {
    const d = tmp("data-");
    fs.mkdirSync(path.join(d, "2023_10_29_mi", "shards"), { recursive: true });
    fs.mkdirSync(path.join(d, "2019_10_27_mi"));
    fs.mkdirSync(path.join(d, "procurement"));
    fs.symlinkSync(path.join(d, "nowhere"), path.join(d, "2024_06_23_chmi"));
    const old = new Date("2020-01-01");
    fs.utimesSync(path.join(d, "2019_10_27_mi"), old, old);
    const since = Date.now() - 60_000;
    fs.writeFileSync(path.join(d, "2023_10_29_mi", "shards", "x.json"), "{}");
    expect(
      dataDirsTouchedIn(d, /^\d{4}_\d{2}_\d{2}_(mi|chmi)$/, since),
    ).toEqual(["2023_10_29_mi"]);
  });
});

describe("outputSignatureIn", () => {
  it("sees a file the run wrote even after someone committed it", () => {
    const d = tmp("sig-");
    const g = (...a: string[]) =>
      execFileSync("git", a, { cwd: d, encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    fs.mkdirSync(path.join(d, "data/a"), { recursive: true });
    fs.writeFileSync(path.join(d, "data/a/old.json"), "1");
    g("add", "-A");
    g("commit", "-q", "-m", "init");
    const head = g("rev-parse", "HEAD");
    expect(outputSignatureIn(["data/a"], head, d).size).toBe(0);
    fs.writeFileSync(path.join(d, "data/a/new.json"), "2");
    fs.writeFileSync(path.join(d, "data/a/old.json"), "changed");
    // The auto-committer commits it mid-run: still differs from the run's start.
    g("add", "-A");
    g("commit", "-q", "-m", "auto");
    expect([...outputSignatureIn(["data/a"], head, d).keys()].sort()).toEqual([
      "data/a/new.json",
      "data/a/old.json",
    ]);
  });
});
