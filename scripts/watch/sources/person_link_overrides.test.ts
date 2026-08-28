import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SOURCES } from "./index";
import { fingerprintPersonLinkOverrides } from "./person_link_overrides";

const dirs: string[] = [];
const writeRegistry = (value: unknown): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "person-overrides-watch-"));
  dirs.push(dir);
  const file = path.join(dir, "link_overrides.json");
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return file;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true });
});

const decision = {
  kind: "merge",
  refA: "2021:a",
  refB: "2022:b",
  note: "Operator verified the two candidacies",
  decidedBy: "operator",
  decidedAt: "2026-08-28",
  evidence: [],
};

describe("person_link_overrides watcher", () => {
  it("hashes validated bytes and reports the audited decision count", () => {
    const one = fingerprintPersonLinkOverrides(
      writeRegistry({ schemaVersion: 1, overrides: [decision] }),
    );
    const two = fingerprintPersonLinkOverrides(
      writeRegistry({
        schemaVersion: 1,
        overrides: [decision, { ...decision, refA: "2022:b", refB: "2023:c" }],
      }),
    );
    expect(one.meta).toEqual({ decisions: 1 });
    expect(two.meta).toEqual({ decisions: 2 });
    expect(two.value).not.toBe(one.value);
  });

  it("refuses to fingerprint an invalid unaudited registry", () => {
    const file = writeRegistry({
      schemaVersion: 1,
      overrides: [{ ...decision, note: "" }],
    });
    expect(() => fingerprintPersonLinkOverrides(file)).toThrow(
      "note must be a non-empty string",
    );
  });

  it("is registered exactly once", () => {
    expect(
      SOURCES.filter((source) => source.id === "person_link_overrides"),
    ).toHaveLength(1);
  });
});
