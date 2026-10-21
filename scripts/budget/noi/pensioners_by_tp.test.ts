// НОИ pensioners by ТП, against the getResourceData payload captured 2026-10-21.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resourceTable } from "../lib/egov_api";
import { parsePensionersByTp, TP_OBLAST } from "./pensioners_by_tp";

const table = resourceTable(
  (
    JSON.parse(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "__fixtures__/pensioners_by_tp.json",
        ),
        "utf8",
      ),
    ) as { data: unknown }
  ).data,
);

describe("parsePensionersByTp", () => {
  const p = parsePensionersByTp(table);

  it("reads 28 placed ТП, the international row and the total, 2010-2025", () => {
    expect(p.years[0]).toBe(2010);
    expect(p.years.at(-1)).toBe(2025);
    expect(p.territories).toHaveLength(28);
    expect(p.total["2025"]).toBe(2058008);
    expect(p.international.oblast).toBeNull();
  });

  it("keeps the capital and Sofia oblast as different units", () => {
    const by = Object.fromEntries(p.territories.map((t) => [t.oblast, t]));
    expect(by.SOFIA_CITY.name).toBe("София-град");
    expect(by.SFO.name).toBe("София-област");
    expect(by.SOFIA_CITY.values["2025"]).toBe(329217);
  });

  it("is 1:1 between ТП and oblast", () => {
    const codes = Object.values(TP_OBLAST).map(([, c]) => c);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("refuses a ТП whose published name the crosswalk does not expect", () => {
    const bad = table.map((r) =>
      r[0] === "21.София-град" ? ["21.София", ...r.slice(1)] : r,
    );
    expect(() => parsePensionersByTp(bad)).toThrow(/ТП 21/);
  });

  it("refuses a year whose ТП rows do not sum to Общо", () => {
    const bad = table.map((r) =>
      r[0] === "1.Благоевград"
        ? [r[0], String(Number(r[1]) + 1), ...r.slice(2)]
        : r,
    );
    expect(() => parsePensionersByTp(bad)).toThrow(/2010: ТП rows sum/);
  });

  it("refuses a missing ТП rather than mapping fewer", () => {
    // Drop ТП 28 AND take its count off Общо, so only the count check can fire.
    const yambol = table.find((r) => r[0] === "28.Ямбол")!;
    const bad = table
      .filter((r) => r !== yambol)
      .map((r) =>
        r[0] === "Общо"
          ? [
              r[0],
              ...r
                .slice(1)
                .map((v, i) => String(Number(v) - Number(yambol[i + 1]))),
            ]
          : r,
      );
    expect(() => parsePensionersByTp(bad)).toThrow(/27 ТП, expected 28/);
  });

  it("refuses a ТП listed twice", () => {
    const yambol = table.find((r) => r[0] === "28.Ямбол")!;
    expect(() => parsePensionersByTp([...table, yambol])).toThrow(
      /listed twice/,
    );
  });

  it("refuses a ТП 29 that is not the international row", () => {
    const bad = table.map((r) =>
      r[0].startsWith("29.") ? ["29.Чужбина", ...r.slice(1)] : r,
    );
    expect(() => parsePensionersByTp(bad)).toThrow(/ТП 29/);
  });
});
