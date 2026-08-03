import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readIndexableProcedures } from "./procedures_index";

const write = (obj: unknown): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proc-idx-"));
  const file = path.join(dir, "index.json");
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
};

const good = {
  procedureCode: "BG16RFOP002-2.089",
  procedureName: null,
  programCode: "2014BG16RFOP002",
  programName: "Иновации и конкурентоспособност",
  contractCount: 4356,
  beneficiaryCount: 4356,
  totalEur: 111180402,
  paidEur: 111180402,
};

afterEach(() => vi.restoreAllMocks());

describe("readIndexableProcedures", () => {
  it("returns the catalogue's entries", () => {
    expect(readIndexableProcedures(write({ procedures: [good] }))).toEqual([
      good,
    ]);
  });

  it("returns [] for a missing file rather than throwing", () => {
    expect(readIndexableProcedures("/nope/does/not/exist.json")).toEqual([]);
  });

  it("warns and returns [] on unparseable JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proc-idx-"));
    const file = path.join(dir, "index.json");
    fs.writeFileSync(file, "{ not json");
    // Silence would delete 987 pages while the sitemap kept listing them.
    expect(readIndexableProcedures(file)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("warns and returns [] when `procedures` is not an array", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readIndexableProcedures(write({ procedures: "nope" }))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("drops an entry with an empty code", () => {
    // An empty code writes into dist/funds/procedure/ itself, replacing the
    // parent's index.html.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = readIndexableProcedures(
      write({ procedures: [good, { ...good, procedureCode: "   " }] }),
    );
    expect(rows).toHaveLength(1);
  });

  it("drops an entry carrying a non-finite figure", () => {
    // Would render "€NaN" into a <title>.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = readIndexableProcedures(
      write({
        procedures: [
          good,
          { ...good, procedureCode: "X-1.001", totalEur: null },
        ],
      }),
    );
    expect(rows.map((r) => r.procedureCode)).toEqual(["BG16RFOP002-2.089"]);
  });
});
