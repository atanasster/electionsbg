import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  positiveInt,
  parseArgs,
  readManifest,
  deriveStopId,
  unionRows,
  ManifestCorruptError,
  UnsafeIncrementalError,
  MANIFEST_VERSION,
  type Manifest,
} from "./crawl";
import type { AdmittedRow } from "./keep_fetch";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "interreg-crawl-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const manifestFile = (): string => path.join(dir, "index_manifest.json");

const writeManifest = (m: Partial<Manifest>): string => {
  const file = manifestFile();
  fs.writeFileSync(file, JSON.stringify(m));
  return file;
};

const row = (keepId: number, keepProgrammeId = 342): AdmittedRow => ({
  keepId,
  keepProgrammeId,
  programmeCode: "INTERREG-ROBG-2127",
});

const complete = (rows: AdmittedRow[]): Manifest => ({
  version: MANIFEST_VERSION,
  walkedAt: "2026-08-06T00:00:00.000Z",
  lastFullWalkAt: "2026-08-06T00:00:00.000Z",
  complete: true,
  indexTotal: 32702,
  pagesFetched: 5451,
  rows,
});

describe("positiveInt — CLI arguments", () => {
  it.each(["abc", "0", "-1", "", "1.5", "NaN", " "])(
    "rejects %o rather than silently becoming NaN",
    (v) => {
      expect(() => positiveInt(v, "--concurrency")).toThrow(/positive integer/);
    },
  );

  it("accepts a positive integer and passes undefined through", () => {
    expect(positiveInt("8", "--concurrency")).toBe(8);
    expect(positiveInt(undefined, "--concurrency")).toBeUndefined();
  });

  it("enforces a ceiling", () => {
    expect(() => positiveInt("99", "--concurrency", 8)).toThrow(/at most 8/);
  });
});

describe("parseArgs", () => {
  it("defaults concurrency rather than inheriting a NaN", () => {
    expect(parseArgs([]).concurrency).toBe(8);
    expect(parseArgs([]).full).toBe(false);
  });

  it("reads the flags it documents", () => {
    const a = parseArgs(["--full", "--index-only", "--max-pages", "30"]);
    expect(a).toMatchObject({ full: true, indexOnly: true, maxPages: 30 });
  });

  // The exact invocation that walked 1 page of 5,451 and exited 0.
  it("refuses --concurrency abc instead of walking one page and reporting success", () => {
    expect(() => parseArgs(["--concurrency", "abc"])).toThrow(
      /positive integer/,
    );
  });

  it("refuses --concurrency 0 instead of spinning forever", () => {
    expect(() => parseArgs(["--concurrency", "0"])).toThrow(/positive integer/);
  });
});

describe("readManifest — absent vs corrupt", () => {
  it("returns null when the file is absent", () => {
    expect(readManifest(manifestFile())).toBeNull();
  });

  it("reads a well-formed manifest", () => {
    const file = writeManifest(complete([row(100)]));
    expect(readManifest(file)?.rows).toHaveLength(1);
  });

  // Swallowing this to `null` is what made a truncated manifest look like a
  // first run, and let the walk rewrite it with a handful of rows at exit 0.
  it("throws on an unparseable manifest rather than returning null", () => {
    const file = manifestFile();
    fs.writeFileSync(file, '{"rows": [{"keepId": 1');
    expect(() => readManifest(file)).toThrow(ManifestCorruptError);
    expect(() => readManifest(file)).toThrow(/--full/);
  });

  it("throws when rows[] is missing", () => {
    const file = writeManifest({ version: MANIFEST_VERSION, walkedAt: "x" });
    expect(() => readManifest(file)).toThrow(ManifestCorruptError);
  });

  it("refuses a manifest from another schema version", () => {
    const file = writeManifest({ ...complete([row(1)]), version: 99 });
    expect(() => readManifest(file)).toThrow(/version 99/);
  });
});

describe("deriveStopId — the two-store trap", () => {
  it("takes the highest id from the manifest", () => {
    expect(
      deriveStopId(complete([row(10), row(50), row(30)]), {
        full: false,
        cachedCount: 3,
      }),
    ).toBe(50);
  });

  it("is undefined under --full, however full the cache is", () => {
    expect(
      deriveStopId(complete([row(50)]), { full: true, cachedCount: 1930 }),
    ).toBeUndefined();
  });

  it("is undefined on a genuine first run", () => {
    expect(deriveStopId(null, { full: false, cachedCount: 0 })).toBeUndefined();
  });

  // The exact collapse: manifest gone, cache intact. Deriving the stop id from
  // the cache would stop the walk within two waves and rewrite the manifest
  // with a handful of rows, at exit 0.
  it("REFUSES an incremental walk when the manifest is gone but the cache is not", () => {
    expect(() =>
      deriveStopId(null, { full: false, cachedCount: 1930 }),
    ).toThrow(UnsafeIncrementalError);
    expect(() =>
      deriveStopId(null, { full: false, cachedCount: 1930 }),
    ).toThrow(/--full/);
  });

  // Checkpointing introduces this one: a partial manifest is a legitimate file
  // whose rows are NOT the whole corpus.
  it("REFUSES an incremental walk over an incomplete manifest", () => {
    const partial = { ...complete([row(50)]), complete: false };
    expect(() =>
      deriveStopId(partial, { full: false, cachedCount: 5 }),
    ).toThrow(UnsafeIncrementalError);
  });

  it("is undefined when a complete manifest holds no rows", () => {
    expect(
      deriveStopId(complete([]), { full: false, cachedCount: 0 }),
    ).toBeUndefined();
  });
});

describe("unionRows", () => {
  it("keeps prior rows an incremental walk did not re-see", () => {
    expect(
      unionRows([row(10), row(9)], [row(12)]).map((r) => r.keepId),
    ).toEqual([12, 10, 9]);
  });

  it("prefers the fresh row and never duplicates an id", () => {
    const merged = unionRows([row(10, 342)], [row(10, 35)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].programmeCode).toBe("INTERREG-ROBG-1420");
  });

  // Without re-validation the union is a one-way door: de-admitting a programme
  // would leave its operations in the manifest for ever, even under --full.
  it("drops a carried-forward row whose programme left the register", () => {
    expect(unionRows([row(1, 999)], [])).toEqual([]);
  });

  it("re-derives the programme code rather than trusting the stored one", () => {
    const stale = { keepId: 7, keepProgrammeId: 342, programmeCode: "OLD" };
    expect(unionRows([stale], [])[0].programmeCode).toBe("INTERREG-ROBG-2127");
  });

  it("returns ids in descending order, matching the index", () => {
    const ids = unionRows([row(3), row(9)], [row(5)]).map((r) => r.keepId);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});
