// The two open-calls decisions in the alert builder that a careless edit would silently invert.
//
// `scripts/myarea/` had no test file, and the sibling Interreg arm is untested too — but these two
// are different in kind, because both are arguments the code makes about MEANING rather than shape:
//
//   1. THE EVENT DATE IS `first_seen_at`, NOT THE DEADLINE. Every other row in this feed is
//      "something happened, on this date", and the feed sorts by date desc. Dating a call by its
//      CLOSING date would park it permanently at the top and quietly redefine the axis for every
//      other event. The deadline belongs in the headline, where it is the actionable fact.
//   2. NULL MONEY IS OMITTED, NEVER ZEROED. ИСУН's procedure page carries no budget at all, so a
//      „€0" in an alert would be a fabricated figure about a real procedure.
//
// Plus the name→code bridge, where the rayon exclusion is the difference between a Burgas call
// reaching Burgas and reaching a Sofia district.

import { describe, expect, it } from "vitest";
import { buildOpenCallEvents, buildCodesByName } from "./build_alerts";
import type { OpenCallAlertRow } from "../db/lib/opencalls_alerts";

const row = (over: Partial<OpenCallAlertRow> = {}): OpenCallAlertRow => ({
  obshtina: "Своге",
  code: "BG16RFPR001-1.011",
  title: "Внедряване на иновации",
  programmeName: "Програма „Конкурентоспособност“",
  closesAt: "2026-12-01T13:30:00.000Z",
  daysLeft: 114,
  budgetEur: null,
  grantMaxEur: null,
  sourceUrl: "https://eumis2020.government.bg/x",
  source: "isun",
  firstSeenAt: "2026-08-01T06:00:00.000Z",
  ...over,
});

describe("buildOpenCallEvents", () => {
  it("dates the event by first_seen_at and puts the DEADLINE in the headline", () => {
    const [e] = buildOpenCallEvents([row()]);
    expect(e.date).toBe("2026-08-01");
    expect(e.date).not.toBe("2026-12-01");
    expect(e.headline_bg).toContain("2026-12-01");
    expect(e.headline_en).toContain("2026-12-01");
  });

  it("omits amountEur — and any figure — when the register published no budget", () => {
    const [e] = buildOpenCallEvents([row({ budgetEur: null })]);
    expect(e.amountEur).toBeUndefined();
    expect(e.headline_bg).not.toMatch(/€/u);
    expect(e.headline_en).not.toMatch(/€/u);
  });

  it("does carry a budget the source DID publish", () => {
    const [e] = buildOpenCallEvents([row({ budgetEur: 10_000_000 })]);
    expect(e.amountEur).toBe(10_000_000);
    expect(e.headline_bg).toMatch(/€/u);
  });

  it("carries the days-left and links out to the source register", () => {
    // We are an index; the application happens in ИСУН or ДФЗ.
    const [e] = buildOpenCallEvents([row({ daysLeft: 6 })]);
    expect(e.headline_bg).toMatch(/6 дни/u);
    expect(e.link).toBe("https://eumis2020.government.bg/x");
    expect(e.kind).toBe("open_call");
  });

  it("omits the countdown when there is none rather than printing null", () => {
    const [e] = buildOpenCallEvents([row({ daysLeft: null })]);
    expect(e.headline_bg).not.toMatch(/null|NaN|undefined/u);
  });
});

describe("buildCodesByName", () => {
  const MUNIS = [
    { name: "Бяла", obshtina: "VAR05" },
    { name: "Бяла", obshtina: "RSE04" },
    { name: "Искър", obshtina: "PVN23" },
    { name: "Искър", obshtina: "S2414" },
    { name: "Средец", obshtina: "BGS06" },
    { name: "Средец", obshtina: "S2401" },
    { name: "Своге", obshtina: "SFO23" },
  ];

  it("EXCLUDES Sofia rayons, so a Burgas call cannot land in a Sofia district", () => {
    // Средец is both a Burgas municipality and a Sofia rayon. A territory is written at
    // municipality grain („на територията на община Средец"), so it never denotes the rayon — and
    // fanning out would put the call in a feed for a place it has nothing to do with.
    expect(buildCodesByName(MUNIS).get("Средец")).toEqual(["BGS06"]);
    expect(buildCodesByName(MUNIS).get("Искър")).toEqual(["PVN23"]);
  });

  it("DOES fan out a genuine cross-oblast collision", () => {
    // Бяла is two real municipalities, in Варна and Русе, and the territory string cannot
    // distinguish them. Picking one would be silently wrong half the time.
    expect(buildCodesByName(MUNIS).get("Бяла")).toEqual(["VAR05", "RSE04"]);
  });

  it("keeps an unambiguous name as a single code", () => {
    expect(buildCodesByName(MUNIS).get("Своге")).toEqual(["SFO23"]);
  });

  it("matches the collisions actually present in data/municipalities.json", async () => {
    // Pinned against the real file: the comment at the call site names exactly three collisions,
    // and a fourth appearing (or one of these being resolved upstream) should make someone reread
    // the rayon-exclusion argument rather than discover it by a misfiled alert.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const munis = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "data", "municipalities.json"),
        "utf-8",
      ),
    ) as { name: string; obshtina: string }[];
    const byName = new Map<string, string[]>();
    for (const m of munis)
      byName.set(m.name, [...(byName.get(m.name) ?? []), m.obshtina]);
    const collisions = [...byName.entries()]
      .filter(([, codes]) => codes.length > 1)
      .map(([n]) => n)
      .sort();
    expect(collisions).toEqual(["Бяла", "Искър", "Средец"]);
    // And after the rayon exclusion only the genuine one is left ambiguous.
    const resolved = buildCodesByName(munis);
    expect(resolved.get("Искър")).toHaveLength(1);
    expect(resolved.get("Средец")).toHaveLength(1);
    expect(resolved.get("Бяла")).toHaveLength(2);
  });
});
