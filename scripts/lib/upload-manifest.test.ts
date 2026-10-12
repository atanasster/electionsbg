// The manifest is the ONLY record of what an ingest run left unpublished. The
// two things that must not go wrong are losing work (a merge that replaces
// instead of unions drops a subtree, and nothing anywhere reports it) and
// losing the audit trail (a clear that deletes instead of archiving makes the
// publish trace unjoinable to what it published).
//
// Pure — `node` Vitest project, tmpdir only.

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPending,
  csv,
  mergeManifest,
  readPending,
  writePending,
  type UploadManifest,
  generatedPathsTouched,
  parseNameOnly,
} from "./upload-manifest";

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "upl-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const manifest = (over: Partial<UploadManifest> = {}): UploadManifest => ({
  session: "S1",
  createdAt: "2026-08-29T08:00:00.000Z",
  skills: ["update-procurement"],
  paths: ["myarea"],
  cloudCommands: ["npm run db:load:pg:cloud"],
  ...over,
});

describe("mergeManifest", () => {
  it("UNIONS a second ingest run into a pending one instead of replacing it", () => {
    // Two ingest runs before one publish is ordinary (an interrupted session,
    // or the upload deferred to the evening). Replacing would silently drop
    // the first run's subtree from the scoped sync.
    const merged = mergeManifest(manifest(), {
      session: "S2",
      skills: ["update-funds"],
      paths: ["funds", "data_map.json"],
      cloudCommands: ["npm run db:load:funds:pg:cloud -- --full"],
    });
    expect(merged.skills).toEqual(["update-procurement", "update-funds"]);
    expect(merged.paths).toEqual(["myarea", "funds", "data_map.json"]);
    expect(merged.cloudCommands).toEqual([
      "npm run db:load:pg:cloud",
      "npm run db:load:funds:pg:cloud -- --full",
    ]);
  });

  it("keeps the OLDEST createdAt — the debt is as old as its oldest half", () => {
    const merged = mergeManifest(
      manifest(),
      { session: "S2" },
      "2026-08-30T00:00:00.000Z",
    );
    expect(merged.createdAt).toBe("2026-08-29T08:00:00.000Z");
  });

  it("dedupes a command repeated across runs, preserving first-seen order", () => {
    // Cloud loader order is load-bearing (a loader reading another's output
    // must follow it), so dedupe must not reorder.
    const merged = mergeManifest(manifest({ cloudCommands: ["a", "b"] }), {
      session: "S2",
      cloudCommands: ["b", "c"],
    });
    expect(merged.cloudCommands).toEqual(["a", "b", "c"]);
  });

  it("starts fresh when nothing is pending", () => {
    const merged = mergeManifest(
      null,
      { session: "S1", paths: ["budget"] },
      "T",
    );
    expect(merged).toMatchObject({
      session: "S1",
      createdAt: "T",
      paths: ["budget"],
    });
    expect(merged.skills).toEqual([]);
  });
});

describe("pending file lifecycle", () => {
  it("round-trips a manifest", () => {
    const d = tmp();
    const file = path.join(d, "pending.json");
    writePending(manifest(), file);
    expect(readPending(file)).toEqual(manifest());
  });

  it("reads an absent or corrupt pending file as null, not as a throw", () => {
    const d = tmp();
    const file = path.join(d, "pending.json");
    expect(readPending(file)).toBeNull();
    fs.writeFileSync(file, "{ not json");
    expect(readPending(file)).toBeNull();
  });

  it("ARCHIVES on clear rather than deleting the record", () => {
    // Without the history line, state/perf/upload-watch-changes.jsonl records
    // how long a publish took and nothing records WHAT it published.
    const d = tmp();
    const pending = path.join(d, "pending.json");
    const history = path.join(d, "history.jsonl");
    writePending(manifest(), pending);
    const cleared = clearPending("PUB1", { pending, history });
    expect(cleared?.session).toBe("S1");
    expect(fs.existsSync(pending)).toBe(false);
    const row = JSON.parse(fs.readFileSync(history, "utf8").trim());
    expect(row).toMatchObject({ session: "S1", publishSession: "PUB1" });
    expect(row.publishedAt).toMatch(/^\d{4}-/);
  });

  it("appends to history so earlier publishes are never overwritten", () => {
    const d = tmp();
    const pending = path.join(d, "pending.json");
    const history = path.join(d, "history.jsonl");
    writePending(manifest({ session: "S1" }), pending);
    clearPending("PUB1", { pending, history });
    writePending(manifest({ session: "S2" }), pending);
    clearPending("PUB2", { pending, history });
    expect(fs.readFileSync(history, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("clearing nothing is a no-op, not an error", () => {
    const d = tmp();
    expect(
      clearPending("PUB1", {
        pending: path.join(d, "pending.json"),
        history: path.join(d, "history.jsonl"),
      }),
    ).toBeNull();
  });
});

describe("csv", () => {
  it("trims and drops empties so `--paths a, ,b` is two paths", () => {
    expect(csv("a, ,b ")).toEqual(["a", "b"]);
    expect(csv(undefined)).toEqual([]);
  });
});

describe("generatedPathsTouched", () => {
  it("maps a commit's changed files onto the registered bucket paths", async () => {
    const { publishedArtifacts } = await import("../db/refresh_coverage");
    const registry = publishedArtifacts();
    // A db:refresh commit: the procurement blobs a skill was asked about, plus
    // the roads and water blobs the chain rewrote beside them.
    const touched = generatedPathsTouched(
      [
        "data/procurement/derived/sector_stats.json",
        "data/roads/derived/hub_stats.json",
        "data/water/derived/hub_stats.json",
        "data/water/flood_maintenance.json",
        "src/screens/water/WaterHubScreen.tsx",
      ],
      registry,
    );
    expect(touched.sort()).toEqual(
      [
        "procurement/derived/sector_stats.json",
        "roads/derived/hub_stats.json",
        "water/derived/hub_stats.json",
        "water/flood_maintenance.json",
      ].sort(),
    );
  });

  it("adds nothing for a commit that touched no registered artifact", () => {
    expect(
      generatedPathsTouched(
        ["src/a.ts"],
        [{ artifact: "data/x.json", bucketPath: "x.json" }],
      ),
    ).toEqual([]);
  });
});

describe("parseNameOnly + merge", () => {
  it("reads git's name-only output, blank lines and trailing newline included", () => {
    expect(
      parseNameOnly("\ndata/roads/derived/hub_stats.json\nsrc/a.ts\n\n"),
    ).toEqual(["data/roads/derived/hub_stats.json", "src/a.ts"]);
  });

  it("lists a path given both by hand and by the commit once", () => {
    const m = mergeManifest(null, {
      session: "s",
      paths: [
        "roads/derived/hub_stats.json",
        "myarea",
        "roads/derived/hub_stats.json",
      ],
    });
    expect(m.paths).toEqual(["roads/derived/hub_stats.json", "myarea"]);
  });
});
