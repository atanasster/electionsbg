import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readZip } from "./load_day";
import { makeZip } from "./lib/zip_fixture";

// The КЗП column order, uniform across chains:
// 0 Населено място · 1 Търговски обект · 2 Наименование · 3 Код ·
// 4 Категория · 5 Цена на дребно · 6 Цена в промоция
//
// Semicolon-delimited, because the price column uses a DECIMAL COMMA — a
// comma-delimited file would split "1,99" across two columns. `parseChainCsv`
// picks the delimiter by counting both in the first line.
const header = [
  "Населено място",
  "Търговски обект",
  "Наименование на продукта",
  "Код на продукта",
  "Категория",
  "Цена на дребно",
  "Цена в промоция",
].join(";");
const row = (ekatte: string, name: string, pid: number, price: string) =>
  [ekatte, "Магазин 1", name, "000001", String(pid), price, ""].join(";");

/** A well-formed chain CSV: two priced rows in Sofia. */
const goodCsv = [
  header,
  row("68134", "ХЛЯБ", 1, "1,99"),
  row("68134", "МЛЯКО", 2, "2,49"),
].join("\n");

/** Tokenises fine, yields ZERO usable rows — the FINDING-001 shape. A chain
 *  that appended a currency suffix to its price cell: every row is dropped by
 *  `toPrice`, and nothing throws. */
const emptyCsv = [
  header,
  row("68134", "ХЛЯБ", 1, "1,99 лв."),
  row("68134", "МЛЯКО", 2, "2,49 лв."),
].join("\n");

/** Fails to TOKENISE — a quoting error the csv parser cannot recover from. */
const brokenCsv = [header, `68134;"unterminated;ХЛЯБ;000001;1;1,99;`].join(
  "\n",
);

let dir: string;
const zipAt = (name: string, files: Record<string, string>): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, makeZip(files));
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kzp-readzip-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readZip", () => {
  it("reads a well-formed chain file", async () => {
    const zip = zipAt("good.zip", {
      "Добра (Добра ЕООД)_100000001.csv": goodCsv,
    });
    const r = await readZip(zip);

    expect(r.rows).toHaveLength(2);
    expect(r.parseErrors).toBe(0);
    expect([...r.archiveEiks]).toEqual(["100000001"]);
  });

  // TEST-002 / FINDING-005(1). The ordering this pins is two lines away from
  // being wrong and, since FINDING-001, is what separates "the source stopped
  // filing" from "we could not read the file".
  it("records a chain in archiveEiks even when its file fails to parse", async () => {
    const zip = zipAt("mixed.zip", {
      "Добра (Добра ЕООД)_100000001.csv": goodCsv,
      "Празна (Празна ЕООД)_100000002.csv": emptyCsv,
      "Счупена (Счупена ЕООД)_100000003.csv": brokenCsv,
    });
    const r = await readZip(zip);

    // All three PUBLISHED a file — that is what archiveEiks means.
    expect([...r.archiveEiks].sort()).toEqual([
      "100000001",
      "100000002",
      "100000003",
    ]);
    // Only the good one produced rows.
    expect(new Set(r.rows.map((x) => x.eik))).toEqual(new Set(["100000001"]));
    // …and the chain that yielded nothing did so WITHOUT a parse error, which
    // is precisely why archiveEiks has to carry it.
    expect(r.rows.filter((x) => x.eik === "100000002")).toHaveLength(0);
  });

  it("counts a tokenise failure in parseErrors", async () => {
    const zip = zipAt("broken.zip", {
      "Добра (Добра ЕООД)_100000001.csv": goodCsv,
      "Счупена (Счупена ЕООД)_100000003.csv": brokenCsv,
    });
    const r = await readZip(zip);
    expect(r.parseErrors).toBeGreaterThanOrEqual(1);
  });

  it("keeps a non-chain CSV out of archiveEiks", async () => {
    // A manifest or readme in the archive must not add a junk key that could
    // later mark a real chain absent.
    const zip = zipAt("stray.zip", {
      "Добра (Добра ЕООД)_100000001.csv": goodCsv,
      "README.csv": "just,some,notes",
    });
    const r = await readZip(zip);
    expect([...r.archiveEiks]).toEqual(["100000001"]);
  });

  it("counts rows outside the KZP product set as legacyCodes, not rows", async () => {
    const zip = zipAt("legacy.zip", {
      "Добра (Добра ЕООД)_100000001.csv": [
        header,
        row("68134", "ХЛЯБ", 1, "1,99"),
        row("68134", "НЕЩО", 999, "5,00"),
      ].join("\n"),
    });
    const r = await readZip(zip);
    expect(r.rows).toHaveLength(1);
    expect(r.legacyCodes).toBe(1);
  });
});
