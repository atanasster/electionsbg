import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  presidentialRound1Date,
  resolvePresidentialCycle,
} from "./presidential_cycle";

describe("presidential cycle assignment", () => {
  it("rejects impossible calendar dates", () => {
    expect(presidentialRound1Date("2026_02_30_pvr")).toBeNull();
  });
  it("keeps between-round polls in their year and leaves older unknowns unresolved", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-cycle-"));
    try {
      for (const cycle of ["2021_11_14_pvr", "2026_11_08_pvr"])
        fs.mkdirSync(path.join(root, "data", cycle), { recursive: true });
      fs.writeFileSync(
        path.join(root, "data/2021_11_14_pvr/national_summary.json"),
        JSON.stringify({ round2Date: "2021-11-21" }),
      );
      expect(resolvePresidentialCycle(root, "2021-11-18")).toBe(
        "2021_11_14_pvr",
      );
      expect(resolvePresidentialCycle(root, "2021-11-22")).toBeNull();
      expect(resolvePresidentialCycle(root, "2016-10-25")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
