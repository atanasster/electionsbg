import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import { resolveAbroadCity } from "./abroad";
import {
  ABROAD_PREFIX_BY_ERA,
  PREFIX_PURITY_FLOOR,
  placeRound,
  settlementCatalogue,
  type PlacedRound,
} from "./places";
import {
  COMMITTED_ROUND_DIRS,
  CYCLES_OLDEST_FIRST,
  corpusRound,
} from "./testCorpus";

assertCommitted(...COMMITTED_ROUND_DIRS, "data/settlements.json");

const cache = new Map<string, PlacedRound>();
const placed = (cycle: string, round: 1 | 2): PlacedRound => {
  const key = `${cycle}/${round}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = placeRound(corpusRound(cycle, round));
  cache.set(key, p);
  return p;
};

// ⚠⚠ THE TRAP THIS MODULE EXISTS FOR. 2011 ran through the ОИК alongside that year's
// local vote, so its section codes are on the 28-oblast grid; every other era is on the
// 31-МИР parliamentary one. The two disagree at almost every prefix, and at `22` they
// disagree between a capital city and a mountain district.
describe("the two grids", () => {
  it("puts prefix 22 in Sofia in 2011 and in Smolyan everywhere else", () => {
    // The evidence, from the section files themselves.
    expect(
      corpusRound("2011_10_23_pvr", 1).sections.find((s) =>
        s.code.startsWith("22"),
      )!.placeName,
    ).toBe("гр.София");
    expect(
      corpusRound("2021_11_14_pvr", 1).sections.find((s) =>
        s.code.startsWith("22"),
      )!.placeName,
    ).toBe("с.Баните");

    // …and the derived maps follow it. A single shared table would file Sofia's votes in
    // Smolyan with every count still reconciling.
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2011_10_23_pvr",
    )) {
      expect(placed(cycle, 1).prefixOblast.get("22"), cycle).toBe("SML");
    }
    // ⚠ AND 2011's `22` PLACES NOTHING AT ALL, which is the stronger answer. Sofia is one
    // oblast on the ОИК grid and three МИР in the catalogue, so its witnesses split
    // 54/35/12 — a 53.5% plurality. Committing to the winner filed 1,354 sections and
    // 441,328 votes, 13.1% of round 1, in S25, two thirds of them in the wrong МИР. It is
    // now refused; see `PREFIX_PURITY_FLOOR`.
    expect(placed("2011_10_23_pvr", 1).prefixOblast.has("22")).toBe(false);
  });

  it("derives the prefix map per round, never from a constant", () => {
    // ⚠ The safety property, stated as a measurement: the maps genuinely DIFFER between
    // the two grids, so nothing could have produced both from one table. Measured over
    // the prefixes the two rounds share.
    const oik = placed("2011_10_23_pvr", 1).prefixOblast;
    const mir = placed("2021_11_14_pvr", 1).prefixOblast;
    const shared = [...oik.keys()].filter((k) => mir.has(k));
    const disagree = shared.filter((k) => oik.get(k) !== mir.get(k));
    expect(shared.length).toBeGreaterThan(20);
    expect(
      disagree.length,
      "the ОИК and МИР grids disagree on most prefixes",
    ).toBeGreaterThan(10);
  });

  it("uses 29 for abroad in 2011 and 32 in every other era", () => {
    expect(ABROAD_PREFIX_BY_ERA["2011"]).toBe("29");
    for (const era of ["2001", "2006", "2016", "2021"] as const) {
      expect(ABROAD_PREFIX_BY_ERA[era], era).toBe("32");
    }
    // ⚠ On the МИР grid `29` is Хасково, so reading it as abroad there would move a real
    // oblast's votes out of the country — 2021 has 335 sections there.
    expect(placed("2021_11_14_pvr", 1).prefixOblast.get("29")).toBe("HKV");
    expect(
      corpusRound("2021_11_14_pvr", 1).sections.filter((s) =>
        s.code.startsWith("29"),
      ).length,
    ).toBeGreaterThan(300);
    // …and in 2011 the same prefix really is abroad, so it holds no domestic sections at
    // all. Asserted on the SECTIONS rather than on `prefixOblast`, because a prefix
    // treated as abroad never reaches the prefix map in ANY era — that assertion is true
    // by construction and cannot fail.
    expect(
      [...placed("2011_10_23_pvr", 1).domestic.keys()].filter((c) =>
        c.startsWith("29"),
      ),
    ).toHaveLength(0);
    expect(placed("2011_10_23_pvr", 1).abroad.size).toBe(161);
  });
});

describe("nothing is dropped", () => {
  it("places every section of every round, or lists it", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        const p = placed(cycle, round);
        const total = corpusRound(cycle, round).sections.length;
        expect(
          p.domestic.size + p.abroad.size + p.report.unplaced.length,
          `${cycle}/${round}`,
        ).toBe(total);
        // ⚠ 2011 is the one cycle with refusals, and they are refusals rather than
        // losses: 1,354 Sofia and Plovdiv sections whose prefix spans several oblasts.
        // Every other cycle places everything.
        if (cycle === "2011_10_23_pvr") {
          expect(p.report.unplaced.length, cycle).toBeGreaterThan(1_000);
          expect(
            p.report.unplaced.every((u) => u.reason === "ambiguous-prefix"),
            cycle,
          ).toBe(true);
        } else {
          expect(p.report.unplaced, `${cycle}/${round}`).toHaveLength(0);
        }
      }
    }
  });

  it("writes an unresolved abroad section with a null country rather than dropping it", () => {
    // T3.1 is explicit about this. The residue is real votes cast in a consulate the
    // corpus cannot place.
    //
    // ⚠ 6, NOT 22 — the T9 code-group fallback recovers 16 of them. The six that remain are
    // the single-section countries whose group has no resolvable sibling (Луанда, Каракас,
    // Адис Абеба, Хараре, Багдад, Сана); naming those would take world knowledge rather than
    // evidence from the file, which is the line this parser does not cross.
    const p = placed("2001_11_11_pvr", 1);
    expect(p.report.abroadSections).toBe(134);
    expect(p.report.abroadUnresolved).toHaveLength(6);
    expect(p.report.abroadByCodeGroup).toHaveLength(16);
    // ⚠ THE RUNOFF TOO. It is not a mirror — 132 abroad sections against round 1's 134 — so a
    // regression confined to it would pass every round-1 arm.
    const r2 = placed("2001_11_11_pvr", 2);
    expect(r2.report.abroadSections).toBe(132);
    expect(r2.report.abroadUnresolved).toHaveLength(6);
    expect(r2.report.abroadByCodeGroup).toHaveLength(16);
    // Триполи is Libya here because its group-mate is Бенгази — not because the name was
    // matched against a list, which would have had to choose between Libya and Lebanon.
    const tripoli = p.report.abroadByCodeGroup.find((r) =>
      r.city.includes("Триполи"),
    );
    expect(tripoli?.country).toBe("LY");
    for (const u of p.report.abroadUnresolved) {
      expect(p.abroad.get(u.code)!.country, u.city).toBeNull();
      expect(p.abroad.get(u.code)!.city.length, u.code).toBeGreaterThan(1);
    }
  });
});

describe("how a section was placed is carried, not discarded", () => {
  // ⚠ „This section is in Пловдив" and „this section is in a prefix whose other sections
  // are in Пловдив" are different claims, and only the first supports a settlement or
  // municipality figure. The catalogue is missing ~13% of the codes the corpus uses —
  // it carries neither София (68134) nor absorbed quarters like Банево (02573) — so the
  // weaker basis is the common case, not an edge.
  it("gives a prefix-placed section an oblast and nothing finer", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const p = placed(cycle, 1);
      const byPrefix = [...p.domestic.values()].filter(
        (x) => x.basis === "code-prefix",
      );
      // ⚠ 2011 is small here (61) BECAUSE its two big prefixes are refused — the
      // fallback places only what a pure prefix witnesses. Everywhere else it carries
      // the ~13% of sections `data/settlements.json` has no ЕКАТТЕ for.
      expect(byPrefix.length, cycle).toBeGreaterThan(
        cycle === "2011_10_23_pvr" ? 50 : 1_000,
      );
      expect(
        byPrefix.every((x) => x.oblast && !x.obshtina && !x.ekatte),
        cycle,
      ).toBe(true);
    }
  });

  it("gives an ЕКАТТЕ-placed section all three", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const byEkatte = [...placed(cycle, 1).domestic.values()].filter(
        (x) => x.basis === "ekatte",
      );
      expect(byEkatte.length, cycle).toBeGreaterThan(10_000);
      expect(
        byEkatte.every((x) => x.ekatte && x.obshtina && x.oblast),
        cycle,
      ).toBe(true);
    }
  });

  it("agrees with the catalogue on an ЕКАТТЕ-placed section", () => {
    const cat = settlementCatalogue();
    const p = placed("2021_11_14_pvr", 1);
    for (const [code, place] of p.domestic) {
      if (place.basis !== "ekatte") continue;
      const row = cat.get(place.ekatte!)!;
      expect(place.obshtina, code).toBe(row.obshtina);
      expect(place.oblast, code).toBe(row.oblast);
    }
  });

  it("counts the two bases and abroad to the section total", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const { report } = placed(cycle, 1);
      // ⚠ The refused sections are part of the total too — that is what „refused, not
      // lost" means, and a sum that omitted them would be the silent drop this module
      // exists to prevent.
      expect(
        report.placedByEkatte +
          report.placedByPrefix +
          report.abroadSections +
          report.unplaced.length,
        cycle,
      ).toBe(report.sections);
    }
  });
});

// ⚠ AN ЕКАТТЕ CAN CONTRADICT ITS OWN SECTION CODE, and when it does the code wins. These
// are source typos, not relocations: `с.Зверино` is in Мездра, Враца, and the ЕКАТТЕ it is
// recorded with resolves to Чирпан, Стара Загора. The place name is what says which is
// wrong. Trusting the code would file a real village's votes in another oblast under a
// basis claiming to be exact.
describe("an ЕКАТТЕ that names the wrong oblast", () => {
  it("keeps the oblast and gives up the settlement", () => {
    const p = placed("2006_10_22_pvr", 1);
    const zverino = p.report.ekatteOblastConflicts.find((c) =>
      c.placeName.includes("Зверино"),
    );
    expect(zverino).toBeDefined();
    expect(zverino!.ekatteOblast, "the catalogue says Стара Загора").toBe(
      "SZR",
    );
    expect(zverino!.prefixOblast, "the code says Враца").toBe("VRC");
    // …and the placement follows the code, at the weaker basis.
    const place = p.domestic.get(zverino!.code)!;
    expect(place.oblast).toBe("VRC");
    expect(place.basis).toBe("code-prefix");
    expect(place.ekatte, "no settlement claim survives").toBeUndefined();
  });

  it("finds them only in the two oldest cycles", () => {
    // Measured. 2011, 2016 and 2021 have none, which is what makes 2001's and 2006's
    // legible as typos rather than as a systematic grid problem.
    expect(
      placed("2001_11_11_pvr", 1).report.ekatteOblastConflicts,
    ).toHaveLength(7);
    expect(
      placed("2006_10_22_pvr", 1).report.ekatteOblastConflicts,
    ).toHaveLength(5);
    for (const cycle of [
      "2011_10_23_pvr",
      "2016_11_06_pvr",
      "2021_11_14_pvr",
    ]) {
      expect(placed(cycle, 1).report.ekatteOblastConflicts, cycle).toEqual([]);
    }
  });

  it("does not fire on a mere spelling difference", () => {
    // ⚠ The discriminator is the OBLAST, not the name. Hundreds of sections spell their
    // settlement differently from the catalogue — Мусомища/Мосомище, Крайще/Краище — and
    // those ЕКАТТЕ are correct. A name check would refuse them all.
    const p = placed("2021_11_14_pvr", 1);
    const musomishta = p.domestic.get("011100024")!;
    expect(musomishta.basis, "the spelling differs and the code is right").toBe(
      "ekatte",
    );
    expect(musomishta.ekatte).toBe("49432");
    expect(p.report.ekatteOblastConflicts).toEqual([]);
  });
});

describe("prefixes whose sections disagree about their oblast", () => {
  // ⚠ REPORTED, not silenced, because they are not all defects and only a reader can
  // tell them apart.
  it("refuses 2011's Sofia and Plovdiv, which genuinely span oblasts", () => {
    const mixed = placed("2011_10_23_pvr", 1).report.mixedPrefixes;
    const byPrefix = Object.fromEntries(mixed.map((m) => [m.prefix, m]));
    // Sofia: the ОИК grid has ONE София-град; the МИР catalogue splits it into three.
    expect(Object.keys(byPrefix["22"].oblasts).sort()).toEqual([
      "S23",
      "S24",
      "S25",
    ]);
    // Plovdiv: `PDV` is the градски МИР and `PDV-00` the okrug — a real distinction
    // `src/lib/oblastName.ts` documents, and §2.3's „16 is the whole of Пловдив".
    expect(Object.keys(byPrefix["16"].oblasts).sort()).toEqual([
      "PDV",
      "PDV-00",
    ]);
    // Neither places anything, and their purity is far below the floor.
    for (const prefix of ["16", "22"]) {
      expect(byPrefix[prefix].purity, prefix).toBeLessThan(0.6);
      expect(byPrefix[prefix].placesSections, prefix).toBe(false);
    }
  });

  it("reports 2001's and 2006's handful of strays, which are not", () => {
    // A few sections per prefix against hundreds — an ЕКАТТЕ typo or a relocated
    // station, in an era whose grid is otherwise clean.
    for (const cycle of ["2001_11_11_pvr", "2006_10_22_pvr"]) {
      for (const m of placed(cycle, 1).report.mixedPrefixes) {
        expect(m.purity, `${cycle}/${m.prefix}`).toBeGreaterThan(
          PREFIX_PURITY_FLOOR,
        );
        // …so they still place. The floor separates a typo from a prefix that spans
        // oblasts, and no prefix in the corpus sits between 0.975 and 1.0.
        expect(m.placesSections, `${cycle}/${m.prefix}`).toBe(true);
      }
    }
  });

  it("finds none at all in 2016 or 2021", () => {
    // Their codes and the catalogue agree exactly, which is what makes the two older
    // eras' strays legible as strays.
    expect(placed("2016_11_06_pvr", 1).report.mixedPrefixes).toEqual([]);
    expect(placed("2021_11_14_pvr", 1).report.mixedPrefixes).toEqual([]);
  });
});

describe("abroad", () => {
  it("takes 2016 and 2021 from the country the section NAMES", () => {
    // ⚠ Their sections read „Австралия, Канбера", so no city table is involved and none
    // should be — the source says the country outright. Both resolve completely.
    for (const cycle of ["2016_11_06_pvr", "2021_11_14_pvr"]) {
      const p = placed(cycle, 1);
      expect(p.report.abroadSections, cycle).toBeGreaterThan(300);
      expect(p.report.abroadUnresolved, cycle).toHaveLength(0);
    }
    const canberra = placed("2021_11_14_pvr", 1).abroad.get("320100001")!;
    // ⚠ `countryBasis` IS PART OF THE RECORD NOW. „name" here says the section stated its own
    // country, which is the strongest of the four routes and the reason no city table is
    // consulted for this era.
    expect(canberra).toEqual({
      country: "AU",
      city: "Канбера",
      countryBasis: "name",
    });
  });

  it("never finds a code-group holding two different countries", () => {
    // ⚠⚠ THE PREMISE OF THE WHOLE FALLBACK, ASSERTED OVER THE CORPUS RATHER THAN ASSUMED. The
    // second field of an abroad code is a per-round country ordinal; if any group ever held two
    // countries the rule would be attaching stations to a neighbour's country. Measured across
    // every committed cycle and round: not one does — and the rule refuses a mixed group
    // anyway, so this is the check that says the refusal has never had to fire on a real one.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        const p = placed(cycle, round);
        const byGroup = new Map<string, Set<string>>();
        for (const [code, where] of p.abroad) {
          // ⚠ EVIDENCE ONLY. A `code-group` row carries its group's country BY CONSTRUCTION, so
          // including it would let the fallback prove its own premise — and would let a partial
          // override (rewriting only the sections whose city answer disagrees with their group)
          // pass this gate while making the corpus look purer than it is.
          if (!where.country || where.countryBasis === "code-group") continue;
          const g = code.slice(2, 4);
          if (!byGroup.has(g)) byGroup.set(g, new Set());
          byGroup.get(g)!.add(where.country);
        }
        if (byGroup.size === 1) {
          // 2006 and only 2006: a constant `99` field, so its ONE group legitimately spans 48
          // countries. Hoisted out of the loop — the exemption is per ROUND, not per group, and
          // inside the loop it read as the latter.
          expect(cycle).toBe("2006_10_22_pvr");
        } else {
          for (const [g, set] of byGroup)
            expect(set.size, `${cycle} r${round} group ${g}`).toBe(1);
        }
      }
    }
  });

  it("recovers nothing in 2006, whose abroad codes carry a constant field", () => {
    // ⚠ THE REFUSAL, MEASURED. 2006's single group holds 144 sections across 48 countries;
    // adopting its commonest instead of requiring unanimity would file its 9 UNNAMED stations
    // in Turkey — 43 of 135 resolved members, a plurality of nothing. Not all 144: the other
    // 135 already carry a country from the city table, and the fallback only ever fills.
    for (const round of [1, 2] as const) {
      const p = placed("2006_10_22_pvr", round);
      expect(p.report.abroadByCodeGroup, `r${round}`).toHaveLength(0);
      // ⚠ PINNED, not bounded. 9 stations and 1,084 votes stay unattributed by design — the
      // refusal's cost, which `> 0` would let drift in either direction.
      expect(p.report.abroadUnresolved, `r${round}`).toHaveLength(9);
      expect(
        new Set([...p.abroad.keys()].map((c) => c.slice(2, 4))).size,
        `r${round}`,
      ).toBe(1);
    }
  });

  it("never overrides a country the section already named", () => {
    // ⚠ THE DISTRIBUTION, PINNED — not „at least one section kept its basis". That weaker form
    // catches a TOTAL override and misses the likely one: „correct a section whose city-table
    // answer disagrees with its group", which somebody reaches for after reading that Бостън,
    // Оукланд and Триполи are each a real city in two countries. Post-override every group is
    // homogeneous, so the premise test passes too. A `code-group` count that grew, or a
    // `city`/`name` count that shrank, is an override by definition.
    //
    // It doubles as the record that the weakest basis carries 26 of 2,630 abroad sections
    // corpus-wide, and that `file` — the fourth route — occurs nowhere.
    const expected: Record<1 | 2, Record<string, Record<string, number>>> = {
      1: {
        "2001_11_11_pvr": { city: 112, "code-group": 16, none: 6 },
        "2006_10_22_pvr": { city: 135, none: 9 },
        "2011_10_23_pvr": { city: 150, "code-group": 10, none: 1 },
        "2016_11_06_pvr": { name: 325 },
        "2021_11_14_pvr": { name: 750 },
      },
      2: {
        "2001_11_11_pvr": { city: 110, "code-group": 16, none: 6 },
        "2006_10_22_pvr": { city: 135, none: 9 },
        "2011_10_23_pvr": { city: 150, "code-group": 10, none: 1 },
        "2016_11_06_pvr": { name: 325 },
        "2021_11_14_pvr": { name: 749 },
      },
    };
    for (const round of [1, 2] as const)
      for (const cycle of CYCLES_OLDEST_FIRST) {
        const p = placed(cycle, round);
        const tally: Record<string, number> = {};
        for (const a of p.abroad.values()) {
          const key = a.countryBasis ?? "none";
          tally[key] = (tally[key] ?? 0) + 1;
          // ⚠ A BASIS IS PRESENT IFF A COUNTRY IS. The two fields are independent in the type,
          // so `{ country: null, countryBasis: "name" }` typechecks; nothing but the
          // construction of passes 1 and 4 keeps it from occurring.
          expect(Boolean(a.countryBasis), `${cycle} r${round} ${a.city}`).toBe(
            a.country !== null,
          );
        }
        expect(tally, `${cycle} r${round}`).toEqual(expected[round][cycle]);
        // …and the report is the map's own view of the same fact, in both directions.
        expect(p.report.abroadByCodeGroup.length, `${cycle} r${round}`).toBe(
          tally["code-group"] ?? 0,
        );
        for (const row of p.report.abroadByCodeGroup)
          expect(p.abroad.get(row.code)?.countryBasis).toBe("code-group");
      }
  });

  it("falls back to the city table only for the eras that name no country", () => {
    // 2011 publishes a city and nothing else, so its country comes from the derived table —
    // and 11 of its 161 sections were unnameable that way. ⚠ Ten of those are now recovered
    // from their own code-group; the ONE that remains sits alone in its group.
    for (const round of [1, 2] as const) {
      const p = placed("2011_10_23_pvr", round);
      expect(p.report.abroadSections, `r${round}`).toBe(161);
      expect(p.report.abroadUnresolved, `r${round}`).toHaveLength(1);
      expect(p.report.abroadByCodeGroup, `r${round}`).toHaveLength(10);
    }
    const p = placed("2011_10_23_pvr", 1);
    const canberra = [...p.abroad.values()].find((a) => a.city === "Канбера")!;
    expect(canberra.country).toBe("AU");
  });

  // ⚠⚠ THE GUARANTEE THE CITY TABLE'S OWN HEADER RESTS ON, and asserting disjointness is
  // NOT it: the two maps are keyed by the same code and written in exclusive branches, so
  // no section can be in both whatever the abroad predicate says. Verified — with the
  // predicate deliberately set to prefix „23", 668 domestic 2021 sections routed through
  // the city table and the disjointness assertion still passed. What has to be true is
  // that every section the abroad branch claims REALLY IS abroad.
  it("routes only genuinely abroad sections through the city table", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        const p = placed(cycle, round);
        const era = corpusRound(cycle, round).sourceEra;
        const prefix = ABROAD_PREFIX_BY_ERA[era];
        for (const code of p.abroad.keys()) {
          expect(code.startsWith(prefix), `${cycle}/${round}/${code}`).toBe(
            true,
          );
        }
        // …and every section carrying that prefix is claimed, so none is left to fall
        // into the domestic pass.
        const carrying = corpusRound(cycle, round).sections.filter((s) =>
          s.code.startsWith(prefix),
        );
        expect(p.abroad.size, `${cycle}/${round}`).toBe(carrying.length);
      }
    }
  });

  it("would place a domestic name in another country if the gate slipped", () => {
    // The hazard, stated as the measurement that makes the gate load-bearing: the city
    // table answers for 58 real `гр.Димитровград` sections in 2021, and would file them
    // in Serbia.
    const domesticDimitrovgrad = corpusRound(
      "2021_11_14_pvr",
      1,
    ).sections.filter(
      (s) => !s.code.startsWith("32") && s.placeName.includes("Димитровград"),
    );
    expect(domesticDimitrovgrad.length).toBeGreaterThan(20);
    expect(resolveAbroadCity("гр.Димитровград")).toBe("RS");
    // …and none of them is in the abroad map.
    const p = placed("2021_11_14_pvr", 1);
    for (const s of domesticDimitrovgrad) {
      expect(p.abroad.has(s.code), s.code).toBe(false);
      expect(p.domestic.has(s.code), s.code).toBe(true);
    }
  });
});
