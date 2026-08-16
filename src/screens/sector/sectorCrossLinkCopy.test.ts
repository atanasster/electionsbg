// What this file protects is one boolean: which of two sentences a member page
// gets. Both render, both link to the same URL, and both look right in a
// screenshot — so a swapped branch is invisible to every other gate in the repo
// and shows up only as a claim about somebody's money that isn't true.

import { describe, expect, it } from "vitest";
import { MZ_EIK } from "@/lib/healthReferenceData";
import { sectorCrossLinkCopy } from "./sectorCrossLinkCopy";
import { SECTOR_DASHBOARDS } from "./sectorDashboards";

const health = SECTOR_DASHBOARDS.health;

describe("sectorCrossLinkCopy", () => {
  it("tells the LEAD its content moved to the dashboard", () => {
    expect(
      sectorCrossLinkCopy(health, health.leadEik, true, "Здравеопазване"),
    ).toContain("таблото на сектора");
    expect(
      sectorCrossLinkCopy(health, health.leadEik, false, "Health"),
    ).toContain("on the sector dashboard");
  });

  it("never tells a MEMBER its content moved — the €2.84bn falsehood", () => {
    // /sector/health's body is НЗОК's budget bridge. МЗ's €2.84bn is not on it,
    // so the lead's sentence would be a false claim about where its money went.
    const bg = sectorCrossLinkCopy(health, MZ_EIK, true, "Здравеопазване");
    expect(bg).toContain("Част от сектор „Здравеопазване“");
    expect(bg).not.toContain("Разпределените средства");
    expect(bg).not.toContain("таблото");

    const en = sectorCrossLinkCopy(health, MZ_EIK, false, "Health");
    expect(en).toBe("Part of the Health sector");
    expect(en).not.toContain("disbursed");
  });

  it("names the sector rather than saying „таблото“", () => {
    // The old copy said only „Към таблото" and left the reader to guess which
    // sector this body had been filed under.
    for (const [title, expected] of [
      ["Сигурност", "Част от сектор „Сигурност“"],
      ["Регионално развитие", "Част от сектор „Регионално развитие“"],
      ["Социално подпомагане", "Част от сектор „Социално подпомагане“"],
    ] as const)
      expect(sectorCrossLinkCopy(health, MZ_EIK, true, title)).toBe(expected);
  });

  it("uses Bulgarian quotation marks, not straight ones", () => {
    const s = sectorCrossLinkCopy(health, MZ_EIK, true, "Здравеопазване");
    expect(s).toMatch(/„[^“]+“/u);
    expect(s).not.toContain('"');
  });

  it("carries no subject noun — members include ЕАД/ЕООД companies", () => {
    // АЕЦ Козлодуй, НЕК, ЕСО … are commercial companies, not институции.
    const s = sectorCrossLinkCopy(health, MZ_EIK, true, "Енергетика");
    expect(s).not.toContain("институция");
    expect(s).not.toContain("Тази");
  });

  it("branches on the EIK, so every lead in the config gets the lead line", () => {
    for (const c of Object.values(SECTOR_DASHBOARDS)) {
      expect(sectorCrossLinkCopy(c, c.leadEik, true, "X")).toContain("таблото");
      // …and any other EIK does not, whichever sector it is.
      expect(sectorCrossLinkCopy(c, "000000000", true, "X")).toBe(
        "Част от сектор „X“",
      );
    }
  });
});
