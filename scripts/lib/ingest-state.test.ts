// The orchestrator (/process-watch-report) decides what to run by comparing
// `state/watch/<source>.json:lastChanged` against
// `state/ingest/<skill>.json:lastSuccessfulIngest`. That comparison is a
// filename lookup, so a marker filed under a name the map never asks for is a
// marker that does not exist: the skill reads as "never ran" and is queued on
// every single orchestrator run, forever, with nothing anywhere reporting an
// error.
//
// That is exactly what happened to the person layer — the marker was written to
// `state/ingest/persons.json` while the map queues `update-persons`. These tests
// pin the shape so it cannot happen silently again.
//
// Pure — `node` Vitest project, no network and no database. It scans the
// WORKING TREE's state/ingest/, so a marker a local ingest just wrote is
// checked before it can be committed.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import {
  INGEST_STATE_DIR,
  readAllIngestStates,
  readIngestState,
  writeIngestState,
} from "./ingest-state";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SKILLS_DIR = path.join(REPO, ".claude/skills");
const WATCH_SKILL = path.join(SKILLS_DIR, "process-watch-report", "SKILL.md");

const markerFiles = (): string[] =>
  fs
    .readdirSync(INGEST_STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

describe("ingest markers", () => {
  // A marker whose `skill` field disagrees with its filename is unreachable
  // from one side or the other: `readIngestState` finds it by filename,
  // `readAllIngestStates` keys it by the field.
  it("names every marker file for the skill it records", () => {
    const names = markerFiles();
    // Guards a broken glob: 81 markers today, and both loops below would pass
    // vacuously over an empty list.
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) {
      const state = readIngestState(name);
      expect(state, `state/ingest/${name}.json is unreadable`).not.toBeNull();
      // Per-source watermarks are a different shape written by a different
      // path — allow-listed by NAME, not by "has no skill field", so a real
      // skill marker that lost its field still fails here.
      if (/^(local_taxes_|cik_local$)/.test(name)) continue;
      expect(state?.skill, `state/ingest/${name}.json`).toBe(name);
    }
  });

  it("stamps an ISO timestamp, not a locale string", () => {
    for (const name of markerFiles()) {
      const at = readIngestState(name)?.lastSuccessfulIngest;
      expect(at, `state/ingest/${name}.json`).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(Number.isNaN(Date.parse(at ?? ""))).toBe(false);
    }
  });
});

// The person layer is the case that motivated this file: it is a pure
// re-derivation downstream of EVERY people source, so it is the marker the
// orchestrator consults most often and the one whose absence costs the most.
describe("the person-layer marker", () => {
  const SKILL = "update-persons";

  it("exists under the name the orchestrator looks up", () => {
    expect(readIngestState(SKILL)).not.toBeNull();
  });

  it("names a skill that actually exists", () => {
    expect(fs.existsSync(path.join(SKILLS_DIR, SKILL, "SKILL.md"))).toBe(true);
  });

  // The map is what turns "a people source changed" into "run update-persons".
  // If it stopped naming the skill, the marker would go unread again.
  it("is the skill the watcher→skill map queues for the person layer", () => {
    const map = fs.readFileSync(WATCH_SKILL, "utf-8");
    expect(
      map.includes(`\`${SKILL}\``),
      `${WATCH_SKILL} no longer queues \`${SKILL}\` — the marker would go unread again`,
    ).toBe(true);
  });

  // The tests above pin the ARTIFACT. Without this one, renaming the constant
  // in the resolver leaves the committed marker on disk, every test green, and
  // the marker frozen at its last value — the original bug, vouched for.
  // `INGEST_SKILL` cannot be imported: the module runs main() on import.
  it("is the name the resolver actually stamps", () => {
    const src = fs.readFileSync(
      path.join(REPO, "scripts/person/resolve_persons.ts"),
      "utf-8",
    );
    expect(src).toContain(`const INGEST_SKILL = "${SKILL}"`);
    expect(src).toContain("writeIngestState(INGEST_SKILL");
    expect(src).toContain('process.argv.includes("--no-stamp")');
  });

  // The resolve stamps itself; nothing about the layer should route through the
  // old hand-rolled path or the old filename.
  it("leaves no reference to the old marker name", () => {
    const skill = fs.readFileSync(
      path.join(SKILLS_DIR, SKILL, "SKILL.md"),
      "utf-8",
    );
    expect(skill).not.toContain("state/ingest/persons.json");
    expect(fs.existsSync(path.join(INGEST_STATE_DIR, "persons.json"))).toBe(
      false,
    );
  });
});

// The module's own contract. The filename-vs-field split is what caused the bug
// this file exists for: `readIngestState` looks a marker up by FILENAME while
// `readAllIngestStates` keys it by the `skill` FIELD, so a mismatched pair is
// invisible from one side or the other.
describe("ingest-state I/O", () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-"));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    while (dirs.length)
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("round-trips through the filename the reader looks up", () => {
    const dir = tmp();
    writeIngestState(
      "update-x",
      { summary: "s", at: "2026-07-24T00:00:00.000Z" },
      dir,
    );
    expect(readIngestState("update-x", dir)).toEqual({
      skill: "update-x",
      lastSuccessfulIngest: "2026-07-24T00:00:00.000Z",
      summary: "s",
    });
    expect(Object.keys(readAllIngestStates(dir))).toEqual(["update-x"]);
  });

  // The module promises byte-stable output so an unchanged marker is a zero
  // git diff — sorted keys, trailing newline.
  it("writes byte-identical output for identical input", () => {
    const dir = tmp();
    const at = "2026-07-24T00:00:00.000Z";
    writeIngestState("update-x", { summary: "s", at }, dir);
    const first = fs.readFileSync(path.join(dir, "update-x.json"), "utf-8");
    writeIngestState("update-x", { summary: "s", at }, dir);
    expect(fs.readFileSync(path.join(dir, "update-x.json"), "utf-8")).toBe(
      first,
    );
    expect(first.endsWith("\n")).toBe(true);
  });

  it("returns null for malformed JSON rather than throwing", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "update-x.json"), "{", "utf-8");
    expect(readIngestState("update-x", dir)).toBeNull();
    expect(readAllIngestStates(dir)).toEqual({});
  });

  it("returns null for a marker that does not exist", () => {
    expect(readIngestState("no-such-skill", tmp())).toBeNull();
  });
});
