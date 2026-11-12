import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changedUnder, commitPaths, parsePorcelainZ, stagedUnder } from "./git";
import { findResumableIn, manifestDigest } from "./publish";
import { writeRecord, type RunRecord, type StepRecord } from "./report/record";

const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const repo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-git-"));
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.email", "t@example.invalid");
  g(dir, "config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "state/upload"), { recursive: true });
  fs.writeFileSync(path.join(dir, "state/upload/pending.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "other.txt"), "x\n");
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "init");
  return dir;
};

describe("commitPaths", () => {
  it("commits a deletion and a new file under its paths, and nothing else", () => {
    const dir = repo();
    fs.rmSync(path.join(dir, "state/upload/pending.json"));
    fs.writeFileSync(path.join(dir, "state/upload/history.jsonl"), "{}\n");
    fs.writeFileSync(path.join(dir, "other.txt"), "changed by someone else\n");
    g(dir, "add", "other.txt"); // someone else's staged work, outside our paths
    const r = commitPaths("publish: test", ["state/upload"], dir);
    expect(r.status).toBe("committed");
    expect(
      g(dir, "show", "--no-renames", "--name-status", "--format=", "HEAD").split("\n").sort(),
    ).toEqual([
      "A\tstate/upload/history.jsonl",
      "D\tstate/upload/pending.json",
    ]);
    // The other session's staged change is still staged, uncommitted.
    expect(stagedUnder(["other.txt"], dir)).toEqual(["other.txt"]);
  });

  it("reports nothing to commit rather than an empty commit", () => {
    expect(commitPaths("x", ["state/upload"], repo()).status).toBe("nothing");
  });

  it("handles a path with spaces and non-ASCII characters", () => {
    const dir = repo();
    const name = "state/upload/рез ултат.json";
    fs.writeFileSync(path.join(dir, name), "{}\n");
    expect(changedUnder(["state/upload"], dir)).toEqual([name]);
    expect(commitPaths("x", ["state/upload"], dir).status).toBe("committed");
  });
});

describe("parsePorcelainZ", () => {
  it("skips a rename's source field", () => {
    expect(parsePorcelainZ("R  new.json\0old.json\0 M a.json\0")).toEqual([
      "new.json",
      "a.json",
    ]);
  });
});

describe("findResumableIn", () => {
  const m = {
    session: "i",
    createdAt: "t",
    commit: "c",
    skills: ["x"],
    paths: ["p"],
    cloudCommands: ["pnpm run a:cloud", "pnpm run b:cloud"],
  };
  const digest = manifestDigest(m);
  const st = (
    seq: number,
    id: string,
    status: StepRecord["status"],
    firstError?: string,
  ): StepRecord => ({
    seq,
    id,
    command: id,
    phase: "publish",
    status,
    exitCode: status === "ok" ? 0 : 1,
    durationMs: 1,
    log: "",
    firstError,
  });
  const write = (
    root: string,
    session: string,
    steps: StepRecord[],
    d = digest,
  ): void => {
    const rec: RunRecord = {
      schema: 1,
      session,
      kind: "publish",
      startedAt: "t",
      git: { shaStart: null },
      env: {},
      units: [{ id: "cloud", status: "failed", steps, gates: [] }],
      needsOperator: [],
      needsAgent: [],
      findings: [],
      manifestDigest: d,
    };
    writeRecord(rec, path.join(root, session));
  };

  it("finds the run of this manifest that failed exactly there", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
    write(root, "20261101T000000Z-a", [
      st(1, "a:cloud", "ok"),
      st(2, "b:cloud", "error"),
    ]);
    expect(findResumableIn("b:cloud", digest, root)).toBe("20261101T000000Z-a");
    expect(findResumableIn("a:cloud", digest, root)).toBeNull(); // a succeeded
    expect(findResumableIn("b:cloud", "other-digest", root)).toBeNull();
  });

  it("only the NEWEST run of the manifest decides", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
    write(root, "20261101T000000Z-a", [
      st(1, "a:cloud", "ok"),
      st(2, "b:cloud", "error"),
    ]);
    write(root, "20261102T000000Z-b", [
      st(1, "a:cloud", "error"),
      st(2, "b:cloud", "skipped", "not run"),
    ]);
    expect(findResumableIn("b:cloud", digest, root)).toBeNull();
  });

  it("accepts a chain of resumes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-"));
    write(root, "20261103T000000Z-c", [
      st(1, "a:cloud", "skipped", "--start-at b:cloud (done in x)"),
      st(2, "b:cloud", "error"),
    ]);
    expect(findResumableIn("b:cloud", digest, root)).toBe("20261103T000000Z-c");
  });

  it("changes the digest when the work list changes, not when timestamps do", () => {
    expect(manifestDigest({ ...m, createdAt: "other", session: "other" })).toBe(
      digest,
    );
    expect(manifestDigest({ ...m, paths: ["p", "q"] })).not.toBe(digest);
  });
});
