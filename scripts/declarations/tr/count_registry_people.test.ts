// The privacy guard on the people-counter, asserted on the ARTIFACT and on the SOURCE rather
// than trusted. Same posture as parse_share_transfer.test.ts, which does this for the parser:
// the `Indent` element is a hash+salt of the person's EGN, the repo treats it exactly as the
// EGN, and a script that reads it must be provably incapable of writing it down.
//
//   npm run test:unit

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SRC = path.join(ROOT, "scripts/declarations/tr/count_registry_people.ts");
const OUT = path.join(ROOT, "data/person/tr_name_fold_people.tsv");

const HEX64 = /\b[0-9a-f]{64}\b/;

const H = (n: number): string => String(n).padStart(64, "0");
const party = (name: string, hash: string, type: string): string =>
  `"Indent":[{"_":"${hash}"}],"Name":[{"_":"${name}"}],"IndentType":[{"_":"${type}"}]`;

describe("parties() counts people and only people", () => {
  it("takes EGN and ЛНЧ, and refuses UIC", async () => {
    // THE REGRESSION THIS EXISTS FOR. Matching on the Indent alone counted 154,995 legal
    // entities as people — a company is a party in this feed and carries a hashed Indent too.
    // Asserted on behaviour, not by grepping the regex for the word "IndentType".
    const { parties } = await import("./count_registry_people");
    const text = [
      party("ИВАН ГЕОРГИЕВ ТАКУЧЕВ", H(1), "EGN"),
      party("OLIVIER MARQUET", H(2), "LNCH"),
      party("ОУГАСТ ХОЛДИНГ АД", H(3), "UIC"),
    ].join(",");
    expect(parties(text).map((p) => p.name)).toEqual([
      "ИВАН ГЕОРГИЕВ ТАКУЧЕВ",
      "OLIVIER MARQUET",
    ]);
  });

  it("ignores a Name with no Indent rather than counting an unidentified person", async () => {
    const { parties } = await import("./count_registry_people");
    expect(parties(`"Name":[{"_":"НЯКОЙ БЕЗ ИДЕНТИФИКАТОР"}]`)).toEqual([]);
  });

  it("is re-runnable — the pattern carries no lastIndex between calls", async () => {
    // A module-level /g regex would return results on the first call and fewer on the second.
    const { parties } = await import("./count_registry_people");
    const text = party("ИВАН ПЕТРОВ ИВАНОВ", H(4), "EGN");
    expect(parties(text)).toHaveLength(1);
    expect(parties(text)).toHaveLength(1);
  });
});

describe("writeRefusal — a truncated run must not overwrite a good artifact", () => {
  // Every case here is about failing CLOSED. An under-count is the dangerous direction: Bridge
  // B mints on people_n = 1, so a fold that really holds two people but counts one passes the
  // guard and puts a namesake's companies on a public figure's page.
  it("refuses an empty run", async () => {
    const { writeRefusal } = await import("./count_registry_people");
    expect(writeRefusal(0, 456_398)).toMatch(/empty/);
    // Even with no previous artifact — nothing matched is never a result worth writing.
    expect(writeRefusal(0, 0)).toMatch(/empty/);
  });

  it("refuses a shrink past the floor, and allows the ordinary case", async () => {
    const { writeRefusal } = await import("./count_registry_people");
    expect(writeRefusal(400_000, 456_398)).toMatch(/REFUSING/); // 12% down — a partial feed
    expect(writeRefusal(450_000, 456_398)).toBeNull(); // 1.4% down — ordinary churn
    expect(writeRefusal(456_398, 456_398)).toBeNull();
    expect(writeRefusal(470_000, 456_398)).toBeNull(); // growth is always fine
  });

  it("writes the first artifact, having nothing to compare against", async () => {
    const { writeRefusal } = await import("./count_registry_people");
    expect(writeRefusal(456_398, 0)).toBeNull();
  });

  it("lets an operator override a genuine shrink, explicitly", async () => {
    const { writeRefusal } = await import("./count_registry_people");
    expect(writeRefusal(100, 456_398, true)).toBeNull();
  });
});

describe("count_registry_people — the source cannot persist an EGN hash", () => {
  const src = fs.readFileSync(SRC, "utf8");

  it("digests the hash at the point of capture", () => {
    // The capture group holding the raw hash must be consumed by `digest(...)` and by nothing
    // else. If a future edit stores or returns m[1] anywhere, this fails.
    expect(src).toMatch(/key: digest\(m\[1\]\)/);
    const uses = [...src.matchAll(/m\[1\]/g)];
    expect(
      uses,
      "the raw Indent capture is referenced more than once — it may only reach digest()",
    ).toHaveLength(1);
  });

  it("writes only a fold and an integer", () => {
    // The emitted line shape, asserted against the source: `${fold}\t${s.size}`. A digest or
    // a hash cannot ride along without changing this line.
    expect(src).toMatch(/\$\{fold\}\\t\$\{s\.size\}/);
  });

  it("salts the digest per run, so the heap is not a lookup table either", () => {
    expect(src).toMatch(/randomBytes\(/);
    expect(src).toMatch(/update\(SALT\)/);
  });
});

describe("the committed artifact carries no identifiers", () => {
  // Skips when the artifact has not been minted on this machine (it needs the gitignored
  // 15 GB feed). It is committed, so on a normal checkout this runs.
  const have = fs.existsSync(OUT);

  it.skipIf(!have)("is (fold, count) pairs and nothing else", () => {
    const lines = fs.readFileSync(OUT, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(1000);
    // EXACTLY two tab-separated columns, the second a positive integer. The fold itself is
    // deliberately NOT pattern-matched: translit_bg_latin output includes digits and
    // punctuation because the feed's `Name` is often a sentence describing a person's role
    // (see the note in count_registry_people.ts). What matters is that no third column and no
    // identifier can ride along — which is what the column count and the digest test enforce.
    for (const line of lines) {
      const cols = line.split("\t");
      expect(cols).toHaveLength(2);
      expect(cols[1]).toMatch(/^[1-9]\d*$/);
      expect(cols[0].length).toBeGreaterThan(0);
    }
  });

  it.skipIf(!have)("contains no 64-hex string anywhere", () => {
    expect(HEX64.test(fs.readFileSync(OUT, "utf8"))).toBe(false);
  });

  it.skipIf(!have)(
    "records folds shared by several people — the whole point",
    () => {
      // A file of all-1s would satisfy every shape assertion above while making the guard it
      // feeds a no-op.
      const shared = fs
        .readFileSync(OUT, "utf8")
        .trim()
        .split("\n")
        .filter((l) => Number(l.split("\t")[1]) > 1);
      expect(shared.length).toBeGreaterThan(100);
    },
  );
});
