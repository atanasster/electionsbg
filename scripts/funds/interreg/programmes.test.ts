import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  INTERREG_PROGRAMMES,
  programmeFor,
  programmeByCode,
  isAdmittedProgramme,
  admittedKeepProgrammeIds,
  programmesForPeriod,
  isEligibleNuts,
  warnUnknownProgramme,
  __resetProgrammeWarnings,
} from "./programmes";
import { INTERREG_PERIODS } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const municipalities: { nuts3: string }[] = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../data/municipalities.json"),
    "utf8",
  ),
);

// Filtered, because data/municipalities.json is 294 rows rather than the
// 265-municipality roster and its `nuts3` column carries two non-NUTS values:
// "32" on the six abroad-voting pseudo-municipalities, and BG421-1 on 17
// Пловдив-oblast rows (the PDV-00/PDV split). Leaving them in makes the set
// silently wider than "real NUTS3", which is exactly what an exactness gate
// must not tolerate.
const REAL_NUTS3 = new Set(
  municipalities
    .map((m) => m.nuts3)
    .filter((n) => /^BG\d{3}(-\d+)?$/.test(n ?? "")),
);

/**
 * The plan's §1 tables, transcribed once. THIS FIXTURE IS THE GATE: an edit to
 * the registry that is not also an edit here is a silent data defect.
 *
 * A wrong `keepProgrammeId` is the worst thing that can happen in this file
 * precisely because it does not fail — the ingest fetches a *different real
 * programme* and files its operations under our code.
 */
const PLAN_S1: Record<
  string,
  { keepId: number; cci?: string; nuts: string[] | null }
> = {
  "INTERREG-ROBG-2127": {
    keepId: 342,
    cci: "2021TC16RFCB020",
    nuts: [
      "BG311",
      "BG312",
      "BG313",
      "BG314",
      "BG321",
      "BG323",
      "BG325",
      "BG332",
    ],
  },
  "INTERREG-GRBG-2127": {
    keepId: 343,
    cci: "2021TC16RFCB021",
    nuts: ["BG413", "BG422", "BG424", "BG425"],
  },
  "INTERREG-BGTR-2127": {
    keepId: 305,
    cci: "2021TC16IPCB005",
    nuts: ["BG341", "BG343", "BG422"],
  },
  "INTERREG-BGMK-2127": {
    keepId: 306,
    cci: "2021TC16IPCB006",
    nuts: ["BG413", "BG415"],
  },
  "INTERREG-BGRS-2127": {
    keepId: 307,
    cci: "2021TC16IPCB007",
    nuts: ["BG311", "BG312", "BG313", "BG412", "BG414", "BG415"],
  },
  "INTERREG-BSB-2127": {
    keepId: 387,
    cci: "2021TC16NXTN002",
    nuts: ["BG33", "BG34"],
  },
  "INTERREG-DANUBE-2127": {
    keepId: 369,
    cci: "2021TC16FFTN004",
    nuts: null,
  },
  "INTERREG-EUROMED-2127": {
    keepId: 377,
    cci: "2021TC16FFTN001",
    nuts: null,
  },
  "INTERREG-EUROPE-2127": {
    keepId: 394,
    cci: "2021TC16RFIR001",
    nuts: null,
  },
  "INTERREG-URBACT-2127": {
    keepId: 393,
    cci: "2021TC16FFIR001",
    nuts: null,
  },
  "INTERREG-ESPON-2127": {
    keepId: 395,
    cci: "2021TC16RFIR004",
    nuts: null,
  },
  "INTERREG-ROBG-1420": {
    keepId: 35,
    nuts: [
      "BG311",
      "BG312",
      "BG313",
      "BG314",
      "BG321",
      "BG323",
      "BG325",
      "BG332",
    ],
  },
  "INTERREG-GRBG-1420": {
    keepId: 10,
    nuts: ["BG413", "BG422", "BG424", "BG425"],
  },
  "INTERREG-BGTR-1420": { keepId: 66, nuts: ["BG341", "BG343", "BG422"] },
  "INTERREG-BGRS-1420": {
    keepId: 72,
    nuts: ["BG311", "BG312", "BG313", "BG412", "BG414", "BG415"],
  },
  "INTERREG-BGMK-1420": { keepId: 73, nuts: ["BG413", "BG415"] },
  "INTERREG-BSB-1420": { keepId: 64, nuts: ["BG33", "BG34"] },
  "INTERREG-DANUBE-1420": { keepId: 63, nuts: null },
  "INTERREG-BALKANMED-1420": { keepId: 125, nuts: null },
  "INTERREG-EUROPE-1420": { keepId: 58, nuts: null },
  "INTERREG-URBACT-1420": { keepId: 85, nuts: null },
  "INTERREG-ESPON-1420": { keepId: 69, nuts: null },
};

/**
 * What each distinct declaration must expand to, against the real NUTS3 set.
 *
 * An existence check ("this string prefixes at least one real code") is not
 * enough: declaring BG31 instead of BG311 prefix-matches BG311/312/313/314 AND
 * BG315, so it passes while silently admitting Ловеч — which §1 lists as never
 * eligible for any CBC arm.
 */
const EXPANSION: Record<string, string[]> = {
  "BG311/BG312/BG313/BG314/BG321/BG323/BG325/BG332": [
    "BG311",
    "BG312",
    "BG313",
    "BG314",
    "BG321",
    "BG323",
    "BG325",
    "BG332",
  ],
  "BG413/BG422/BG424/BG425": ["BG413", "BG422", "BG424", "BG425"],
  "BG341/BG343/BG422": ["BG341", "BG343", "BG422"],
  "BG413/BG415": ["BG413", "BG415"],
  "BG311/BG312/BG313/BG412/BG414/BG415": [
    "BG311",
    "BG312",
    "BG313",
    "BG412",
    "BG414",
    "BG415",
  ],
  "BG33/BG34": [
    "BG331",
    "BG332",
    "BG333",
    "BG334",
    "BG341",
    "BG342",
    "BG343",
    "BG344",
  ],
};

describe("the register itself", () => {
  it("matches plan §1 exactly — every keep id, CCI and eligible area", () => {
    expect(INTERREG_PROGRAMMES.length).toBe(Object.keys(PLAN_S1).length);
    for (const [code, want] of Object.entries(PLAN_S1)) {
      const p = programmeByCode(code);
      expect(p, `${code} missing from the register`).toBeDefined();
      expect(p!.keepProgrammeId, `${code} keep id`).toBe(want.keepId);
      expect(p!.cci, `${code} CCI`).toBe(want.cci);
      expect(
        p!.eligibleNuts === null ? null : [...p!.eligibleNuts],
        `${code} eligible NUTS`,
      ).toEqual(want.nuts);
    }
  });

  it("has a unique code and a unique keep.eu id per programme", () => {
    const codes = INTERREG_PROGRAMMES.map((p) => p.code);
    const ids = INTERREG_PROGRAMMES.map((p) => p.keepProgrammeId);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers both periods and nothing outside them", () => {
    for (const p of INTERREG_PROGRAMMES)
      expect(INTERREG_PERIODS).toContain(p.period);
    expect(programmesForPeriod("2021-2027").length).toBe(11);
    expect(programmesForPeriod("2014-2020").length).toBe(11);
    expect(
      programmesForPeriod("2021-2027").length +
        programmesForPeriod("2014-2020").length,
    ).toBe(INTERREG_PROGRAMMES.length);
  });

  it("uses a code whose period suffix agrees with the declared period", () => {
    for (const p of INTERREG_PROGRAMMES) {
      expect(p.code).toMatch(/^INTERREG-[A-Z]+-(1420|2127)$/);
      const suffix = p.period === "2021-2027" ? "2127" : "1420";
      expect(p.code.endsWith(`-${suffix}`)).toBe(true);
    }
  });

  // The failure this guards is a copy-paste: an entry whose nameBg silently
  // holds the English name would render an English programme label on every
  // Bulgarian page with nothing failing.
  it("carries a real Bulgarian name and a real English name for every entry", () => {
    for (const p of INTERREG_PROGRAMMES) {
      expect(p.nameBg.trim().length).toBeGreaterThan(3);
      expect(p.nameEn.trim().length).toBeGreaterThan(3);
      expect(p.nameBg).toMatch(/[А-Яа-я]/);
      expect(p.nameBg).not.toBe(p.nameEn);
    }
  });

  // keep.eu publishes a CCI for 2021-2027 and none at all for 2014-2020.
  it("carries a CCI for every 2021-2027 programme and none for 2014-2020", () => {
    for (const p of programmesForPeriod("2021-2027"))
      expect(p.cci, p.code).toMatch(/^2021TC16[A-Z0-9]+$/);
    for (const p of programmesForPeriod("2014-2020"))
      expect(p.cci, p.code).toBeUndefined();
  });

  it("declares eligible areas that expand to exactly the §1 NUTS3 set", () => {
    for (const p of INTERREG_PROGRAMMES) {
      if (p.eligibleNuts === null) continue;
      for (const area of p.eligibleNuts)
        expect(area, `${p.code} declares ${area}`).toMatch(/^BG\d{2,3}$/);
      const key = p.eligibleNuts.join("/");
      const got = [...REAL_NUTS3]
        .filter((n) => p.eligibleNuts!.some((a) => n.startsWith(a)))
        .sort();
      expect(got, `${p.code} declares ${key}`).toEqual(EXPANSION[key]);
    }
  });

  // §1: "Never eligible for any CBC arm: София-град, Пловдив, Пазарджик,
  // Габрово, Ловеч, Разград."
  it("never admits an oblast §1 says is outside every CBC arm", () => {
    const NEVER = [
      "BG416", // София-град
      "BG417",
      "BG418",
      "BG421", // Пловдив
      "BG421-1",
      "BG423", // Пазарджик
      "BG322", // Габрово
      "BG315", // Ловеч
      "BG324", // Разград
    ];
    for (const p of INTERREG_PROGRAMMES) {
      // Nationwide programmes legitimately include every oblast.
      if (p.eligibleNuts === null) continue;
      for (const n of NEVER)
        expect(isEligibleNuts(p, n), `${p.code} vs ${n}`).toBe(false);
    }
  });

  it("names every programme with a thin or empty keep.eu arm", () => {
    // The four the plan records as gaps must SAY so, so a zero-row programme is
    // never mistaken for a programme with no Bulgarian participation.
    for (const code of [
      "INTERREG-BGRS-2127",
      "INTERREG-ESPON-2127",
      "INTERREG-URBACT-2127",
      "INTERREG-GRBG-2127",
    ])
      expect(programmeByCode(code)?.coverageNote, code).toBeTruthy();
  });

  // keepTitle exists so a registry-vs-keep.eu consistency check can tell a
  // deliberate divergence from a wrong keep id. It must be present exactly
  // where we knowingly differ, and absent everywhere else.
  it("records keep.eu's own title only where we deliberately differ from it", () => {
    const withTitle = INTERREG_PROGRAMMES.filter((p) => p.keepTitle);
    expect(withTitle.map((p) => p.code)).toEqual(["INTERREG-BGMK-1420"]);
    expect(withTitle[0].keepTitle).toContain(
      "Former Yugoslav Republic of Macedonia",
    );
    expect(withTitle[0].keepTitle).not.toBe(withTitle[0].nameEn);
  });

  it("hands out a registry a caller cannot corrupt", () => {
    const p = programmeFor(342)!;
    expect(() => {
      (p as { code: string }).code = "HACKED";
    }).toThrow();
    expect(programmeFor(342)!.code).toBe("INTERREG-ROBG-2127");
    expect(Object.isFrozen(INTERREG_PROGRAMMES)).toBe(true);
  });
});

describe("programmeFor — the admission gate", () => {
  beforeEach(() => __resetProgrammeWarnings());

  it("admits a registered keep.eu programme id", () => {
    const robg = programmeFor(342);
    expect(robg?.code).toBe("INTERREG-ROBG-2127");
    expect(robg?.period).toBe("2021-2027");
    expect(isAdmittedProgramme(342)).toBe(true);
  });

  it("refuses an unregistered id rather than inventing a code", () => {
    // 339 is Interreg VI-A NEXT Romania - Rep.Moldova: a real keep.eu
    // programme with no Bulgarian participation.
    expect(programmeFor(339)).toBeUndefined();
    expect(isAdmittedProgramme(339)).toBe(false);
    expect(programmeFor(-1)).toBeUndefined();
  });

  it("warns once per unknown programme, not once per row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnUnknownProgramme(339, "Romania - Rep.Moldova");
    warnUnknownProgramme(339, "Romania - Rep.Moldova");
    warnUnknownProgramme(400);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("339");
    warn.mockRestore();
  });

  it("exposes every admitted id for the index walk", () => {
    const ids = admittedKeepProgrammeIds();
    expect(ids).toContain(342);
    expect(ids).toContain(64);
    expect(ids).not.toContain(339);
    expect(ids.length).toBe(INTERREG_PROGRAMMES.length);
  });
});

describe("isEligibleNuts — prefix, not equality", () => {
  const bsb = programmeByCode("INTERREG-BSB-2127")!;
  const robg = programmeByCode("INTERREG-ROBG-2127")!;
  const danube = programmeByCode("INTERREG-DANUBE-2127")!;

  it("matches a NUTS3 against a NUTS2 eligible area", () => {
    // The Black Sea programmes declare BG34; Бургас is BG341. Equality here
    // would exclude every Black Sea row.
    expect(isEligibleNuts(bsb, "BG341")).toBe(true);
    expect(isEligibleNuts(bsb, "BG332")).toBe(true);
    expect(isEligibleNuts(bsb, "BG311")).toBe(false);
  });

  it("matches a NUTS3 eligible area exactly", () => {
    expect(isEligibleNuts(robg, "BG311")).toBe(true);
    expect(isEligibleNuts(robg, "BG341")).toBe(false);
  });

  it("treats a null eligible area as the whole country", () => {
    // Every real BG NUTS3 — including Sofia city and the never-CBC-eligible
    // oblasts — is inside a nationwide programme.
    expect(REAL_NUTS3.size).toBe(31);
    for (const n of REAL_NUTS3) expect(isEligibleNuts(danube, n), n).toBe(true);
  });

  it("answers false for a foreign NUTS code or an absent one", () => {
    expect(isEligibleNuts(danube, "RO31")).toBe(false);
    expect(isEligibleNuts(bsb, "RO223")).toBe(false);
    expect(isEligibleNuts(danube, null)).toBe(false);
    expect(isEligibleNuts(danube, undefined)).toBe(false);
    expect(isEligibleNuts(danube, "")).toBe(false);
  });

  // A bare `false` for a malformed Bulgarian code reads as "no Interreg money
  // here", which is the more dangerous of the two wrong answers.
  it("throws on a Bulgarian code too coarse or malformed to answer", () => {
    expect(() => isEligibleNuts(robg, "BG31")).toThrow(/expected a Bulgarian/);
    expect(() => isEligibleNuts(robg, "BG3")).toThrow(/expected a Bulgarian/);
    expect(() => isEligibleNuts(robg, "bg311")).toThrow(/expected a Bulgarian/);
    expect(() => isEligibleNuts(robg, " BG311")).toThrow(
      /expected a Bulgarian/,
    );
    expect(() => isEligibleNuts(danube, "BG31")).toThrow();
  });

  it("accepts the BG421-1 split code the reference data really contains", () => {
    expect(() => isEligibleNuts(danube, "BG421-1")).not.toThrow();
    expect(isEligibleNuts(danube, "BG421-1")).toBe(true);
    expect(isEligibleNuts(robg, "BG421-1")).toBe(false);
  });
});
