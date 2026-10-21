// The Constitutional Court roster parser, against a real capture of /bg/judges
// (2026-10-21). No network.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseJudges, regulatorRosters } from "./regulator_rosters";

const html = fs.readFileSync(
  path.join(__dirname, "../../../tests/fixtures/watch/constcourt_judges.html"),
  "utf8",
);

describe("parseJudges", () => {
  it("reads all 12 seats and the chair", () => {
    const judges = parseJudges(html);
    expect(judges).toHaveLength(12);
    expect(judges.filter((j) => j.seat === "Председател")).toEqual([
      { name: "Павлина Панова", seat: "Председател" },
    ]);
    expect(judges.map((j) => j.name)).toContain("Орлин Колев");
  });

  it("does not pick up the administration staff listed in the footer", () => {
    const names = parseJudges(html).map((j) => j.name);
    expect(names).not.toContain("Надежда Милковска");
  });
});

describe("describe", () => {
  const fp = (judges: { name: string; seat: string }[], value: string) => ({
    value,
    detail: "d",
    meta: { judges },
  });
  const a = [
    { name: "Павлина Панова", seat: "Председател" },
    { name: "Орлин Колев", seat: "Съдия" },
  ];
  const b = [
    { name: "Павлина Панова", seat: "Председател" },
    { name: "Иван Иванов", seat: "Съдия" },
  ];

  it("names who joined and who left", () => {
    const prev = { fingerprint: "x", meta: { judges: a } } as never;
    const out = regulatorRosters.describe!(prev, fp(b, "y"));
    expect(out).toContain("+[Иван Иванов|Съдия]");
    expect(out).toContain("−[Орлин Колев|Съдия]");
  });

  it("does not claim a change on the first run after the format switch", () => {
    const prev = { fingerprint: "old-page-hash" } as never;
    expect(regulatorRosters.describe!(prev, fp(b, "y"))).toContain(
      "no roster change implied",
    );
  });
});
