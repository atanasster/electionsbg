// The two orchestrator skills are prose, and prose drifts from the CLI it
// describes with nothing failing. Three specific drifts would be SILENT and
// each costs the trace rather than the run:
//
//   1. A misspelled `--run` name. `--run process-watch-reprot` is not an
//      error — it opens a THIRD JSONL file that nothing ever reports on, so
//      those steps vanish while every command exits 0.
//   2. A renamed npm script. The skill's copy-paste line stops working, and
//      the recovery an agent reaches for is to run the command WITHOUT the
//      perf wrapper — i.e. the step silently stops being measured.
//   3. A moved manifest path. The ingest writes to one path and the publish
//      reads another, so `/upload-watch-changes` reports "nothing to publish"
//      on a run that produced plenty.
//
// Pure — `node` Vitest project, reads the working tree.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { PENDING } from "../lib/upload-manifest";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SKILLS = path.join(REPO, ".claude/skills");

const INGEST_SKILL = path.join(SKILLS, "process-watch-report/SKILL.md");
const PUBLISH_SKILL = path.join(SKILLS, "upload-watch-changes/SKILL.md");

const read = (p: string): string => fs.readFileSync(p, "utf8");
const pkg = JSON.parse(read(path.join(REPO, "package.json"))) as {
  scripts: Record<string, string>;
};

// The `--run` values the CLI files a trace under. Anything else opens a file
// nothing reports on.
const RUN_NAMES = ["process-watch-report", "upload-watch-changes"] as const;

describe("the perf harness the skills tell you to run exists", () => {
  it.each(["perf:step", "perf:chain", "perf:report", "upload:manifest"])(
    "package.json defines %s",
    (script) => {
      expect(pkg.scripts[script]).toBeTruthy();
    },
  );

  it.each([
    ["scripts/perf/log_step.ts"],
    ["scripts/perf/run_chain.ts"],
    ["scripts/perf/perf_log.ts"],
    ["scripts/perf/chain.ts"],
    ["scripts/upload_manifest.ts"],
    ["scripts/lib/upload-manifest.ts"],
  ])("%s exists", (rel) => {
    expect(fs.existsSync(path.join(REPO, rel))).toBe(true);
  });
});

describe.each([
  ["process-watch-report", INGEST_SKILL, "process-watch-report"],
  ["upload-watch-changes", PUBLISH_SKILL, "upload-watch-changes"],
])("%s SKILL.md", (_name, file, expectedRun) => {
  it("times its steps through the perf CLI", () => {
    const md = read(file);
    expect(md).toMatch(/perf:step -- session/);
    expect(md).toMatch(/perf:step -- run /);
    expect(md).toMatch(/perf:report/);
  });

  it("files its trace under its OWN run name and never the other one", () => {
    const md = read(file);
    const used = [...md.matchAll(/--run (\S+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    // A typo here is invisible at runtime — the row lands in a file no report
    // reads — so every occurrence must be one of the two known names, and this
    // skill must only ever write its own.
    for (const name of used) expect(RUN_NAMES).toContain(name as never);
    expect(new Set(used)).toEqual(new Set([expectedRun]));
  });

  it("names the JSONL trace it writes", () => {
    expect(read(file)).toContain(`state/perf/${expectedRun}.jsonl`);
  });
});

describe("the ingest → publish handoff", () => {
  const manifestRel = path.relative(REPO, PENDING);

  it("both skills name the SAME manifest path the CLI actually writes", () => {
    expect(manifestRel).toBe("state/upload/pending.json");
    expect(read(INGEST_SKILL)).toContain(manifestRel);
    expect(read(PUBLISH_SKILL)).toContain(manifestRel);
  });

  it("the ingest skill WRITES the manifest and the publish skill CLEARS it", () => {
    expect(read(INGEST_SKILL)).toMatch(/upload_manifest\.ts write/);
    expect(read(PUBLISH_SKILL)).toMatch(/upload_manifest\.ts show/);
    expect(read(PUBLISH_SKILL)).toMatch(/upload_manifest\.ts done/);
  });

  it("the ingest skill hands off rather than publishing itself", () => {
    const md = read(INGEST_SKILL);
    expect(md).toContain("/upload-watch-changes");
    // It must ASK. An orchestrator that syncs the bucket or Cloud SQL on its
    // own is the thing this split exists to prevent.
    expect(md).toMatch(/Do NOT invoke `\/upload-watch-changes` yourself/);
  });

  it("the ingest skill commits by pathspec and forbids sweeping the index", () => {
    // `git add -A` here would sweep the concurrent auto-committer's staged work
    // into a data commit under a misleading message — measured, repeatedly.
    const md = read(INGEST_SKILL);
    expect(md).toMatch(/git commit -m .* \\?\n?\s*-- /s);
    expect(md).toMatch(/NEVER `git add -A`/);
  });
});
