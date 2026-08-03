// Gates for the shared oblast dictionaries + the name-collision tiebreak.
//
// The defect these exist to prevent: `parse_local_elections.resolveByName` matched a CIK
// município name against data/municipalities.json with `.find()` — first hit wins. Three
// catalogue names are not unique, so both "Бяла" pages resolved to VAR05 (Варна) and общ.
// Бяла (обл. Русе) vanished from the 2019 and 2023 cycles, its mayor and council discarded
// by the collision merge and 14 of its village mayors published under обл. Варна.
// See docs/plans/village-mayor-attribution-v1.md §T0.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import municipalitiesData from "../../data/municipalities.json";
import {
  OBLAST_NAME_TO_CODE,
  OIK_PREFIX_TO_OBLAST,
  oblastCodeForName,
  oblastCodeForOik,
  pickByOblast,
  normPlaceName,
} from "./oblastNames";

type MunicipalityRef = {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
};
const MUNICIPALITIES = municipalitiesData as MunicipalityRef[];
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Catalogue rows grouped by folded name — computed with the SAME normaliser production
 *  matches with, so this gate cannot stay green while the resolver drifts. */
const groupByName = (): Map<string, MunicipalityRef[]> => {
  const byName = new Map<string, MunicipalityRef[]>();
  for (const m of MUNICIPALITIES) {
    const k = normPlaceName(m.name);
    byName.set(k, [...(byName.get(k) ?? []), m]);
  }
  return byName;
};
const duplicateGroups = () =>
  [...groupByName().values()].filter((v) => v.length > 1);

describe("OBLAST_NAME_TO_CODE", () => {
  // The catalogue's `oblast` column is NOT purely a statistical oblast code — three kinds of
  // value live in it, and only the first is a real oblast:
  //   PDV-00  Пловдив-град's МИР code (the oblast-code shard mismatch this repo already
  //           knows about; PDV22's row carries the constituency, not the oblast)
  //   32      the six out-of-country pseudo-municipalities (Европа, Азия, …) — МИР 32
  //   S2***   Sofia's 24 районни, routed by NAME_ALIASES and never by this map
  // None belongs to a município with a duplicate name, so none is reachable from the
  // tiebreak. Pinned as an explicit exception list so a NEW odd code fails here instead of
  // silently becoming un-disambiguatable.
  const NON_OBLAST_CODES = ["32", "PDV-00"];

  it("the catalogue's non-oblast codes are exactly the known exceptions", () => {
    const mapped = new Set(Object.values(OBLAST_NAME_TO_CODE));
    const unmapped = [
      ...new Set(MUNICIPALITIES.map((m) => m.oblast).filter(Boolean)),
    ]
      .filter((c) => !c.startsWith("S2") && !mapped.has(c))
      .sort();
    expect(unmapped).toEqual(NON_OBLAST_CODES);
  });

  // The assertion that actually protects the tiebreak: every oblast a NON-UNIQUE município
  // name depends on must be in the dictionary, or that pair silently falls back to catalogue
  // order — the Бяла failure.
  it("covers every oblast a duplicate-named município depends on", () => {
    const needed = duplicateGroups()
      .flat()
      .map((m) => m.oblast)
      .filter((c) => !c.startsWith("S2"));
    const mapped = new Set(Object.values(OBLAST_NAME_TO_CODE));
    expect(needed.filter((c) => !mapped.has(c))).toEqual([]);
    expect(needed.length).toBeGreaterThan(0);
  });

  it("resolves a name, and returns null rather than throwing on an unknown one", () => {
    expect(oblastCodeForName("Русе")).toBe("RSE");
    expect(oblastCodeForName("русе")).toBe("RSE");
    expect(oblastCodeForName("  Стара   Загора ")).toBe("SZR");
    expect(oblastCodeForName(null)).toBeNull();
    expect(oblastCodeForName("")).toBeNull();
    expect(oblastCodeForName("Атлантида")).toBeNull();
  });

  // All three spellings of Sofia province, one per CIK generation. `софийска` is the modern
  // one and was missing when this map was hoisted out of the legacy ingest — which switched
  // the tiebreak off on 22 of 265 pages per cycle without any test noticing.
  it("resolves every spelling of Sofia province", () => {
    expect(oblastCodeForName("София")).toBe("SFO");
    expect(oblastCodeForName("София област")).toBe("SFO");
    expect(oblastCodeForName("Софийска")).toBe("SFO");
  });
});

describe("OIK_PREFIX_TO_OBLAST", () => {
  // The fallback that makes pre-2019 cycles resolvable at all: 2011 and 2015 pages carry no
  // oblast, so without this the tiebreak is inert exactly where the data is already wrong.
  it("resolves the OIK prefixes of every duplicate-named município", () => {
    expect(oblastCodeForOik("1804")).toBe("RSE"); // Бяла, Русе
    expect(oblastCodeForOik("0305")).toBe("VAR"); // Бяла, Варна
    expect(oblastCodeForOik("1523")).toBe("PVN"); // Искър, Плевен
    expect(oblastCodeForOik("0206")).toBe("BGS"); // Средец, Бургас
  });

  it("declines a non-OIK, a short code and Sofia city's prefix", () => {
    expect(oblastCodeForOik(null)).toBeNull();
    expect(oblastCodeForOik("")).toBeNull();
    expect(oblastCodeForOik("18")).toBeNull();
    expect(oblastCodeForOik("S2401")).toBeNull();
    // 22 = Столична, which has no catalogue oblast (it is the synthetic SOF bundle).
    expect(oblastCodeForOik("2246")).toBeNull();
  });

  it("maps only codes the catalogue uses, and covers the 27 non-city oblasts", () => {
    const inCatalogue = new Set(MUNICIPALITIES.map((m) => m.oblast));
    expect(
      Object.values(OIK_PREFIX_TO_OBLAST).filter((c) => !inCatalogue.has(c)),
    ).toEqual([]);
    expect(new Set(Object.values(OIK_PREFIX_TO_OBLAST)).size).toBe(
      Object.keys(OIK_PREFIX_TO_OBLAST).length,
    );
  });
});

describe("the catalogue's non-unique município names", () => {
  // The premise the tiebreak rests on. A FOURTH duplicate fails here, and whoever adds it
  // learns that name-only resolution is unsafe for it too.
  it("are exactly бяла / искър / средец", () => {
    const dupes = [...groupByName().entries()]
      .filter(([, v]) => v.length > 1)
      .map(([k]) => k)
      .sort();
    expect(dupes).toEqual(["бяла", "искър", "средец"]);
  });
});

describe("pickByOblast", () => {
  const matchesFor = (name: string) =>
    MUNICIPALITIES.filter((m) => normPlaceName(m.name) === name);

  it("routes Бяла to Варна or Русе by oblast name", () => {
    const matches = matchesFor("бяла");
    expect(matches).toHaveLength(2);
    expect(pickByOblast(matches, "Варна").pick?.obshtina).toBe("VAR05");
    expect(pickByOblast(matches, "Русе").pick?.obshtina).toBe("RSE04");
    expect(pickByOblast(matches, "Варна").ambiguous).toBe(false);
  });

  it("routes Бяла by OIK code when the page has no oblast", () => {
    const matches = matchesFor("бяла");
    expect(pickByOblast(matches, "", "1804").pick?.obshtina).toBe("RSE04");
    expect(pickByOblast(matches, null, "0305").pick?.obshtina).toBe("VAR05");
    expect(pickByOblast(matches, null, "1804").ambiguous).toBe(false);
  });

  it("prefers the page oblast over the OIK when both are present", () => {
    // Contrived: a Русе heading on a Варна OIK. The heading is the more specific signal.
    expect(
      pickByOblast(matchesFor("бяла"), "Русе", "0305").pick?.obshtina,
    ).toBe("RSE04");
  });

  // Latent today only because Sofia районни are fanned out of the SOF bundle and never
  // arrive as their own tur1 page. A catalogue reorder would make them live.
  it("routes Искър and Средец to the province, not the Sofia район", () => {
    expect(pickByOblast(matchesFor("искър"), "Плевен").pick?.obshtina).toBe(
      "PVN23",
    );
    expect(pickByOblast(matchesFor("средец"), "Бургас").pick?.obshtina).toBe(
      "BGS06",
    );
  });

  it("falls back to the first match and flags it when nothing can narrow", () => {
    const matches = matchesFor("бяла");
    for (const oblast of [null, undefined, "", "Атлантида"]) {
      const { pick, ambiguous } = pickByOblast(matches, oblast, "9999");
      expect(pick?.obshtina).toBe(matches[0].obshtina);
      expect(ambiguous).toBe(true);
    }
  });

  it("a unique name is never ambiguous, with or without an oblast", () => {
    const tundzha = matchesFor("тунджа");
    expect(tundzha).toHaveLength(1);
    expect(pickByOblast(tundzha, null).pick?.obshtina).toBe("JAM25");
    expect(pickByOblast(tundzha, null).ambiguous).toBe(false);
    expect(pickByOblast(tundzha, "Ямбол").ambiguous).toBe(false);
  });

  it("flags a unique match whose oblast contradicts the page", () => {
    const tundzha = matchesFor("тунджа"); // JAM
    expect(pickByOblast(tundzha, "Ямбол").oblastMismatch).toBe(false);
    expect(pickByOblast(tundzha, "Русе").oblastMismatch).toBe(true);
  });

  it("treats PDV-00 and PDV as the same oblast", () => {
    const plovdiv = MUNICIPALITIES.filter((m) => m.obshtina === "PDV22");
    expect(plovdiv[0].oblast).toBe("PDV-00");
    expect(pickByOblast(plovdiv, "Пловдив").oblastMismatch).toBe(false);
  });

  it("no matches yields no pick and no ambiguity", () => {
    expect(pickByOblast([], "Русе")).toEqual({
      pick: null,
      ambiguous: false,
      oblastMismatch: false,
    });
  });
});

// The gate that would have caught the missing `софийска` key: the other tests all validate
// the dictionary against data/municipalities.json (the CODE side) and never against the
// oblast strings CIK actually publishes (the NAME side). Hoisting a dictionary to a new
// caller without re-validating it against that caller's inputs is the drift this module
// exists to prevent.
describe("against the oblast strings CIK actually publishes", () => {
  const CYCLES = ["2019_10_27_mi", "2023_10_29_mi"];
  const dirs = CYCLES.map((c) =>
    path.join(ROOT, "raw_data", c, "html", "tur1"),
  ).filter((d) => fs.existsSync(d));

  // raw_data is gitignored, so a fresh clone has nothing to sweep.
  it.skipIf(dirs.length === 0)(
    "resolves every `област X` heading in the cached tur1 pages",
    () => {
      const seen = new Set<string>();
      for (const dir of dirs)
        for (const f of fs
          .readdirSync(dir)
          .filter((f) => /^\d{4}\.html$/.test(f)))
          for (const m of fs
            .readFileSync(path.join(dir, f), "utf-8")
            .matchAll(/област\s+([А-Яа-яЁё\s-]+?)\s*[<|"]/g))
            seen.add(m[1].trim());
      expect(seen.size).toBeGreaterThan(20);
      expect([...seen].filter((n) => oblastCodeForName(n) === null)).toEqual(
        [],
      );
    },
  );
});
