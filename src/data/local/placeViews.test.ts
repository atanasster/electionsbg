// Every place link in the app is built here, and the interesting behaviour is entirely in
// the exceptions: Sofia has three codes for one município, its 24 районa are a settlement in
// one tree and a município in another, Пловдив splits into two МИР, and one МИР (Извън
// страната) has no page at all. Those are the cases these tests pin — a straight rewrite
// like `/governance/${obshtina}` needs no test, a fold does.

import { describe, expect, it } from "vitest";
import {
  ABROAD_OBLAST,
  consumptionUrl,
  governanceUrl,
  isAbroadPlace,
  isSofiaCityObshtina,
  isSofiaRayonObshtina,
  localUrl,
  oblastGovernanceUrl,
  parliamentaryUrl,
  placeViewUrl,
} from "./placeViews";

const CYCLE = "2023_10_29_mi";

describe("isSofiaCityObshtina", () => {
  // All three synonyms mean Столична община. SFO_CITY is the officials roster's synthetic
  // code and the one that was missing: it reaches these builders from a /person office row.
  it.each(["SOF00", "SOF", "SFO_CITY"])("accepts %s", (code) => {
    expect(isSofiaCityObshtina(code)).toBe(true);
  });

  it("does not accept a район, which is a distinct office", () => {
    expect(isSofiaCityObshtina("S2401")).toBe(false);
    expect(isSofiaRayonObshtina("S2401")).toBe(true);
  });

  it("is false for an absent code rather than throwing", () => {
    expect(isSofiaCityObshtina(undefined)).toBe(false);
  });
});

describe("governanceUrl", () => {
  it("routes every Sofia city synonym to the one governance id", () => {
    for (const obshtina of ["SOF00", "SOF", "SFO_CITY"]) {
      expect(governanceUrl({ level: "municipality", obshtina })).toBe(
        "/governance/SOF00",
      );
    }
  });

  it("keeps a Sofia район on its own node", () => {
    expect(governanceUrl({ level: "municipality", obshtina: "S2401" })).toBe(
      "/governance/S2401",
    );
  });

  it("has no node for a polling section", () => {
    expect(governanceUrl({ level: "section", ekatte: "68134" })).toBeNull();
  });
});

describe("oblastGovernanceUrl", () => {
  it("points an oblast at its region node", () => {
    expect(oblastGovernanceUrl("KRZ")).toBe("/governance/region/KRZ");
  });

  it("keeps PDV and PDV-00 apart", () => {
    // Пловдив-област and Пловдив-град are two МИР and two pages; the МОН cut has no
    // city/province split, so a row keyed PDV must not land on PDV-00.
    expect(oblastGovernanceUrl("PDV")).toBe("/governance/region/PDV");
    expect(oblastGovernanceUrl("PDV-00")).toBe("/governance/region/PDV-00");
  });

  it("sends Sofia's three МИР to the município dashboard, not a region page", () => {
    // /governance/region/S23 would render a region with no GeoJSON and regions.json's
    // placeholder name ("23"); SOF00 is the city's real node.
    for (const mir of ["S23", "S24", "S25"]) {
      expect(oblastGovernanceUrl(mir)).toBe("/governance/SOF00");
    }
  });

  it("declines 32 (Извън страната), which is in regions.json and has no page", () => {
    // The prerenderer enumerates region routes as `regions.filter(r => r.oblast !== "32")`,
    // so a link here would open a titled shell with empty tiles.
    expect(oblastGovernanceUrl("32")).toBeNull();
  });

  it("returns null rather than a dead link for a code we don't serve", () => {
    expect(oblastGovernanceUrl("XXX")).toBeNull();
  });
});

describe("localUrl", () => {
  it("routes every Sofia city synonym to the SOF bundle, never SOF00", () => {
    // The shard tree is keyed SOF; SOF00 is the governance id and has no bundle.
    for (const obshtina of ["SOF00", "SOF", "SFO_CITY"]) {
      expect(localUrl({ level: "municipality", obshtina }, CYCLE)).toBe(
        `/local/${CYCLE}/SOF`,
      );
    }
  });

  it("routes a Sofia район to its own município page", () => {
    // A район is a settlement in the parliamentary tree and a município here.
    expect(localUrl({ level: "municipality", obshtina: "S2401" }, CYCLE)).toBe(
      `/local/${CYCLE}/S2401`,
    );
  });

  it("gives a settlement its own page and drops a section to it", () => {
    expect(localUrl({ level: "settlement", ekatte: "11394" }, CYCLE)).toBe(
      `/local/${CYCLE}/settlement/11394`,
    );
    expect(localUrl({ level: "section", ekatte: "11394" }, CYCLE)).toBe(
      `/local/${CYCLE}/settlement/11394`,
    );
  });

  it("is null without a cycle, since a local URL has no meaning outside one", () => {
    expect(
      placeViewUrl("local", { level: "municipality", obshtina: "BLG11" }),
    ).toBeNull();
  });
});

describe("parliamentaryUrl / consumptionUrl", () => {
  it("sends Sofia city to /sofia, which fans the three МИР", () => {
    for (const obshtina of ["SOF00", "SOF", "SFO_CITY"]) {
      expect(parliamentaryUrl({ level: "municipality", obshtina })).toBe(
        "/sofia",
      );
    }
  });

  it("uses the off-by-one route naming: a município is /settlement/:obshtina", () => {
    expect(parliamentaryUrl({ level: "municipality", obshtina: "BLG11" })).toBe(
      "/settlement/BLG11",
    );
    expect(parliamentaryUrl({ level: "settlement", ekatte: "11394" })).toBe(
      "/sections/11394",
    );
  });

  it("mirrors the governance tiers for consumption, Sofia fold included", () => {
    expect(
      consumptionUrl({ level: "municipality", obshtina: "SFO_CITY" }),
    ).toBe("/consumption/SOF00");
    expect(consumptionUrl({ level: "section", ekatte: "11394" })).toBeNull();
  });
});

describe("placeViewUrl", () => {
  it("dispatches to the builder for the named view", () => {
    const place = { level: "municipality" as const, obshtina: "BLG11" };
    expect(placeViewUrl("governance", place)).toBe("/governance/BLG11");
    expect(placeViewUrl("parliamentary", place)).toBe("/settlement/BLG11");
    expect(placeViewUrl("consumption", place)).toBe("/consumption/BLG11");
    expect(placeViewUrl("local", place, CYCLE)).toBe(`/local/${CYCLE}/BLG11`);
  });
});

describe("an abroad place has ONE view, and the others refuse", () => {
  // ⚠ МИР 32's "settlements" ARE COUNTRIES. They carry ISO codes where an EKATTE would be, so
  // every builder here templated them happily: measured 2026-09-04 on `/sections/IT`, the place
  // digest rendered links to `/governance/IT` and `/consumption/IT` — pages that do not exist
  // and cannot — captioned „депутатите и общинският съвет", about Italy.
  //
  // ⚠ AND IT SURVIVED BECAUSE THE FIX WAS IN THE WRONG LAYER. `PlaceHeaderView` held `isAbroad`
  // as a RENDERING flag and dropped the switcher, so the pills were correctly absent while a
  // second consumer of the same builders kept them. A rule one component knows is not a rule.

  const italy = {
    level: "settlement" as const,
    ekatte: "IT",
    oblast: ABROAD_OBLAST,
  };
  const pazardzhik = {
    level: "settlement" as const,
    ekatte: "55155",
    oblast: "PAZ",
  };

  it("recognises the district by its code", () => {
    expect(isAbroadPlace(italy)).toBe(true);
    expect(isAbroadPlace(pazardzhik)).toBe(false);
    // ⚠ AN OBLAST-LESS REF IS NOT ABROAD. Callers that omit it get the domestic answer, which
    // is why `SectionsScreen` passes the field — the predicate cannot infer it from an id.
    expect(isAbroadPlace({ level: "settlement", ekatte: "IT" })).toBe(false);
  });

  it("refuses governance, consumption and local", () => {
    expect(governanceUrl(italy)).toBeNull();
    expect(consumptionUrl(italy)).toBeNull();
    expect(localUrl(italy, CYCLE)).toBeNull();
    expect(placeViewUrl("governance", italy)).toBeNull();
    expect(placeViewUrl("consumption", italy)).toBeNull();
  });

  it("keeps the parliamentary view, which is the one that exists", () => {
    // ⚠ THE DISCRIMINATING HALF. Refusing all four would leave an abroad reader with no route
    // at all — and abroad results are the entire reason these pages exist.
    expect(parliamentaryUrl(italy)).toBe("/sections/IT");
    expect(placeViewUrl("parliamentary", italy)).toBe("/sections/IT");
  });

  it("leaves a domestic settlement untouched", () => {
    // Without this the guard could be an unconditional `return null` and every assertion above
    // would still pass.
    expect(governanceUrl(pazardzhik)).toBe("/governance/55155");
    expect(consumptionUrl(pazardzhik)).toBe("/consumption/55155");
    expect(localUrl(pazardzhik, CYCLE)).toBe(
      `/local/${CYCLE}/settlement/55155`,
    );
  });
});
