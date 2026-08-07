import { describe, it, expect } from "vitest";
import {
  buildPlaceContext,
  resolvePlace,
  resolveAll,
  normPlaceName,
  haversineKm,
  geoConfirms,
  GEO_CONFIRM_KM,
  SOFIA,
  TOWN_ALIASES,
  UNPLACED,
  type PlaceLookups,
} from "./resolve_place";
import fs from "fs";
import { PLACE_BASES, type InterregPartner } from "./types";
import { ROSTER_CONFIRM_KM } from "./resolve_place";

const ctx = buildPlaceContext();

const NO_LOOKUPS: PlaceLookups = {
  seatByEik: new Map(),
  trPlaceByEik: new Map(),
};

const partner = (over: Partial<InterregPartner> = {}): InterregPartner =>
  ({
    keepId: 1,
    partnerSeq: 0,
    keepPartnershipId: 1,
    keepPartnerId: 1,
    isLead: false,
    country: "Bulgaria",
    countryDepartment: null,
    partnerName: "Тест",
    partnerNameEn: null,
    eik: null,
    pic: null,
    orgType: null,
    legalStatus: null,
    budgetEur: 1,
    euFundingEur: null,
    budgetBasis: "published",
    town: null,
    locationRaw: null,
    postcode: null,
    lat: null,
    lng: null,
    ...over,
  }) as InterregPartner;

describe("normPlaceName", () => {
  // The single roster miss the plan records by name.
  it('folds Община "Тунджа" - гр.Ямбол onto Тунджа', () => {
    expect(normPlaceName('Община "Тунджа" - гр.Ямбол')).toBe(
      normPlaceName("Тунджа"),
    );
    expect(normPlaceName("Община Малко Търново")).toBe(
      normPlaceName("Малко Търново"),
    );
  });

  it("strips the settlement and municipality markers keep.eu mixes in", () => {
    expect(normPlaceName("Village of Dobrich")).toBe("dobrich");
    expect(normPlaceName("TOWN OF TOPOLOVGRAD")).toBe("topolovgrad");
    expect(normPlaceName("Mineralni Bani village")).toBe("mineralni bani");
    expect(normPlaceName("гр.София")).toBe("софия");
  });

  it("is insensitive to the four quote styles the corpus uses", () => {
    const want = normPlaceName("Просвета 1914");
    for (const q of ['"Просвета 1914"', "„Просвета 1914“", "«Просвета 1914»"])
      expect(normPlaceName(q)).toBe(want);
  });

  it("never returns punctuation or collapses to a different name", () => {
    expect(normPlaceName("Sofia,")).toBe("sofia");
    expect(normPlaceName("  ")).toBe("");
  });
});

describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    expect(haversineKm(42.7, 23.32, 42.7, 23.32)).toBe(0);
  });

  it("measures Sofia to Varna at roughly 370 km", () => {
    expect(haversineKm(42.6977, 23.3219, 43.2141, 27.9147)).toBeGreaterThan(
      350,
    );
    expect(haversineKm(42.6977, 23.3219, 43.2141, 27.9147)).toBeLessThan(390);
  });
});

describe("geoConfirms — a confirmation, never a source", () => {
  // An absent point is not evidence AGAINST a match; treating it as such would
  // throw away every row in a settlement whose centroid we lack.
  it("passes when there is nothing to check against", () => {
    expect(geoConfirms("68134", partner({ lat: null, lng: null }), ctx)).toBe(
      true,
    );
    expect(geoConfirms("00000", partner({ lat: 42.7, lng: 23.3 }), ctx)).toBe(
      true,
    );
  });

  it("accepts a candidate at the published point and rejects one across the country", () => {
    const inSofia = partner({ lat: SOFIA.lat, lng: SOFIA.lng });
    expect(geoConfirms(SOFIA.ekatte, inSofia, ctx)).toBe(true);
    // 07079 is Бургас — ~370 km away.
    expect(geoConfirms("07079", inSofia, ctx)).toBe(false);
  });

  // Pinning the constant alone would not notice it moving to 200 km. These
  // bracket it: ~11 km accepted, ~30 km refused.
  it("binds at the radius it declares", () => {
    expect(GEO_CONFIRM_KM).toBe(15);
    const sofia = ctx.byEkatte.get(SOFIA.ekatte)!;
    const [lng, lat] = sofia.loc!.split(",").map(Number);
    const near = partner({ lat: lat + 0.1, lng }); // ~11 km north
    const far = partner({ lat: lat + 0.27, lng }); // ~30 km north
    expect(geoConfirms(SOFIA.ekatte, near, ctx)).toBe(true);
    expect(geoConfirms(SOFIA.ekatte, far, ctx)).toBe(false);
    // The roster arm is a different evidence class and gets a wider ceiling.
    expect(geoConfirms(SOFIA.ekatte, far, ctx, ROSTER_CONFIRM_KM)).toBe(true);
    expect(ROSTER_CONFIRM_KM).toBeGreaterThan(GEO_CONFIRM_KM);
  });
});

describe("Tier L — an EIK outranks every geographic signal", () => {
  const eik = "000057086"; // Община Малко Търново
  const inMT = { lat: 41.9781, lng: 27.5233 };

  it("L1 places from awarder_seats", () => {
    const lookups: PlaceLookups = {
      seatByEik: new Map([[eik, { ekatte: "46663", oblast: "BGS" }]]),
      trPlaceByEik: new Map(),
    };
    const r = resolvePlace(partner({ eik, ...inMT }), lookups, ctx);
    expect(r.ekatte).toBe("46663");
    expect(r.placeBasis).toBe("eik:awarder_seats");
    expect(r.obshtina).toBe("BGS12");
  });

  it("L2 falls to tr_company_place when awarder_seats does not know the EIK", () => {
    const lookups: PlaceLookups = {
      seatByEik: new Map(),
      trPlaceByEik: new Map([[eik, { ekatte: "46663" }]]),
    };
    expect(
      resolvePlace(partner({ eik, ...inMT }), lookups, ctx).placeBasis,
    ).toBe("eik:tr");
  });

  it("L3 falls through to Tier P when neither crosswalk knows it", () => {
    const r = resolvePlace(
      partner({ eik, town: "Malko Tarnovo", ...inMT }),
      NO_LOOKUPS,
      ctx,
    );
    expect(r.ekatte).toBe("46663");
    expect(r.placeBasis).not.toMatch(/^eik:/);
  });

  // A crosswalk row can be stale, and a silent 400 km disagreement with
  // keep.eu's own point is worth not publishing.
  it("refuses a crosswalk seat the published point contradicts", () => {
    const lookups: PlaceLookups = {
      // Claims Варна for a partner keep.eu puts in Малко Търново.
      seatByEik: new Map([[eik, { ekatte: "10135" }]]),
      trPlaceByEik: new Map(),
    };
    expect(resolvePlace(partner({ eik, ...inMT }), lookups, ctx)).toEqual(
      UNPLACED,
    );
  });
});

describe("Tier P — geography only", () => {
  it("P1 maps the Latin town to Cyrillic and resolves it", () => {
    const r = resolvePlace(
      partner({ town: "Nikopol", postcode: "5940" }),
      NO_LOOKUPS,
      ctx,
    );
    expect(r.ekatte).toBeTruthy();
    expect(r.obshtina).toBeTruthy();
    expect(ctx.byEkatte.get(r.ekatte!)?.name).toBe("Никопол");
  });

  // settlements.json has no Sofia row — the capital is 24 district shards — so
  // 176 of 201 otherwise-unplaced rows were Sofia alone. buildPlaceContext
  // seeds a synthetic one; see the dedicated block below for why that has to
  // happen there and not in the cascade.
  it("places Sofia", () => {
    const r = resolvePlace(
      partner({ town: "Sofia", lat: SOFIA.lat, lng: SOFIA.lng }),
      NO_LOOKUPS,
      ctx,
    );
    expect(r.ekatte).toBe(SOFIA.ekatte);
    expect(r.obshtina).toBe("S22");
  });

  it("does not place Sofia when the published point is somewhere else", () => {
    // Варна's coordinates with Sofia's name — a contradiction, not a match.
    expect(
      resolvePlace(
        partner({ town: "Sofia", lat: 43.2141, lng: 27.9147 }),
        NO_LOOKUPS,
        ctx,
      ).ekatte,
    ).not.toBe(SOFIA.ekatte);
  });

  // The map's job is TRANSLATION, not resolution: an ambiguous Cyrillic name
  // still needs a postcode or a point, which the real corpus supplies.
  it("names a real settlement for every curated exonym", () => {
    const byName = new Set([...ctx.byEkatte.values()].map((s) => s.name));
    for (const [alias, cyrillic] of Object.entries(TOWN_ALIASES)) {
      if (cyrillic === "София") continue; // Sofia has no settlements.json row
      expect(byName.has(cyrillic), `${alias} → ${cyrillic}`).toBe(true);
    }
  });

  // Every entry must be a spelling settlements.json does NOT already carry —
  // a redundant alias is a second place for the same fact to be wrong.
  it("carries no alias the settlement data already resolves", () => {
    const en = new Set(
      [...ctx.byEkatte.values()].map((s) => normPlaceName(s.name_en ?? "")),
    );
    for (const alias of Object.keys(TOWN_ALIASES))
      expect(en.has(alias), `${alias} is redundant`).toBe(false);
  });

  it("resolves an exonym end to end once the row carries real signal", () => {
    const r = resolvePlace(
      partner({ town: "Bourgas", postcode: "8000" }),
      NO_LOOKUPS,
      ctx,
    );
    expect(ctx.byEkatte.get(r.ekatte!)?.name).toBe("Бургас");
  });

  it("P2 matches the closed municipality roster, and only it", () => {
    const r = resolvePlace(
      partner({ partnerName: 'Община "Тунджа" - гр.Ямбол' }),
      NO_LOOKUPS,
      ctx,
    );
    expect(r.placeBasis).toBe("roster");
    // A name outside the 265 is never matched — this is the bound that keeps
    // P2 from being the name-matching the identity rule forbids.
    expect(
      resolvePlace(partner({ partnerName: "Фирма ЕООД" }), NO_LOOKUPS, ctx),
    ).toEqual(UNPLACED);
  });

  it("P4 leaves a row unplaced rather than guessing", () => {
    expect(
      resolvePlace(partner({ town: "Nowhereville" }), NO_LOOKUPS, ctx),
    ).toEqual(UNPLACED);
    expect(resolvePlace(partner(), NO_LOOKUPS, ctx)).toEqual(UNPLACED);
  });
});

describe("the shape of every answer", () => {
  it("returns a basis exactly when it returns an ekatte", () => {
    const rows = [
      partner({ town: "Nikopol", postcode: "5940" }),
      partner({ town: "Sofia", lat: SOFIA.lat, lng: SOFIA.lng }),
      partner({ partnerName: "Община Ямбол" }),
      partner({ town: "Nowhereville" }),
      partner(),
    ];
    for (const p of rows) {
      const r = resolvePlace(p, NO_LOOKUPS, ctx);
      expect(r.ekatte === null).toBe(r.placeBasis === null);
      if (r.placeBasis) expect(PLACE_BASES).toContain(r.placeBasis);
      // The 137 CHECK: obshtina/oblast cannot exist without an ekatte.
      if (!r.ekatte) {
        expect(r.obshtina).toBeNull();
        expect(r.oblast).toBeNull();
      }
    }
  });

  it("resolveAll keys by (keepId, partnerSeq) and counts what it placed", () => {
    const rows = [
      partner({ keepId: 1, partnerSeq: 0, town: "Nikopol", postcode: "5940" }),
      partner({ keepId: 1, partnerSeq: 1, town: "Nowhereville" }),
    ];
    const { places, stats } = resolveAll(rows, NO_LOOKUPS, ctx);
    expect(places.get("1:0")?.ekatte).toBeTruthy();
    expect(places.get("1:1")).toEqual(UNPLACED);
    expect(stats).toMatchObject({ total: 2, placed: 1 });
  });
});

describe("the roster is a closed set with no silent losses", () => {
  // Optional-dot folded the MUNICIPALITY Добрич-селска onto Добрич, and the geo
  // check cannot catch it because Добрич-селска's seat IS Добрич city.
  it("does not fold a hyphenated municipality onto its first element", () => {
    expect(normPlaceName("Добрич-селска")).not.toBe(normPlaceName("Добрич"));
    expect(normPlaceName("Длъхчево-Сабляр")).toBe("длъхчево сабляр");
    expect(normPlaceName("Сан-Стефано")).toBe("сан стефано");
    // …while the case the rule exists for still folds.
    expect(normPlaceName('Община "Тунджа" - гр.Ямбол')).toBe("тунджа");
  });

  it("keeps every municipality reachable, including the four shared names", () => {
    const munis = JSON.parse(
      fs.readFileSync("data/municipalities.json", "utf8"),
    ) as { name: string; obshtina: string }[];
    const reachable = new Set(
      [...ctx.roster.values()].flat().map((m) => m.obshtina),
    );
    for (const m of munis)
      expect(reachable.has(m.obshtina), `${m.name} ${m.obshtina}`).toBe(true);
    // Бяла (Русе/Варна), Искър (Плевен/София-район) and Средец (Бургас/
    // София-район) each name two municipalities. Добрич-селска is NOT among
    // them — that collision was the optional-dot bug, not a real shared name.
    const shared = [...ctx.roster.entries()].filter(([, v]) => v.length > 1);
    expect(shared.map(([k]) => k).sort()).toEqual(["бяла", "искър", "средец"]);
  });

  it("refuses a shared roster name the point cannot settle", () => {
    // "Община Бяла" with no coordinates names two municipalities (Русе and
    // Варна) — two candidates, so no answer rather than the first one.
    expect(
      resolvePlace(partner({ partnerName: "Община Бяла" }), NO_LOOKUPS, ctx),
    ).toEqual(UNPLACED);
    // With a point near Русе's Бяла it settles.
    const r = resolvePlace(
      partner({ partnerName: "Община Бяла", lat: 43.4633, lng: 25.7361 }),
      NO_LOOKUPS,
      ctx,
    );
    expect(r.placeBasis).toBe("roster");
    expect(r.oblast).toBe("RSE");
  });
});

describe("Sofia is coded exactly one way, on every path", () => {
  // Special-casing Sofia only in the P1 branch left the crosswalks and the
  // resolver writing three further codings, and 22 rows carrying €15.86m were
  // "placed" with no municipality at all.
  it("is a real settlement row, so every path resolves it identically", () => {
    expect(ctx.byEkatte.get(SOFIA.ekatte)?.obshtina).toBe("S22");
    const viaTown = resolvePlace(
      partner({ town: "Sofia", lat: SOFIA.lat, lng: SOFIA.lng }),
      NO_LOOKUPS,
      ctx,
    );
    const viaSeat = resolvePlace(
      partner({ eik: "000695317", lat: SOFIA.lat, lng: SOFIA.lng }),
      {
        // awarder_seats stores the oblast as a NAME and has no obshtina at all.
        seatByEik: new Map([
          ["000695317", { ekatte: SOFIA.ekatte, oblast: "София (столица)" }],
        ]),
        trPlaceByEik: new Map(),
      },
      ctx,
    );
    expect(viaTown.ekatte).toBe(SOFIA.ekatte);
    expect(viaSeat.ekatte).toBe(SOFIA.ekatte);
    expect(viaSeat.obshtina).toBe(viaTown.obshtina);
    // The crosswalk's NAME must never reach the column.
    expect(viaSeat.oblast).toBe("S22");
  });

  it("resolves the Sofia spellings that actually occur", () => {
    for (const town of ["Sofia", "Софиа", "Sofie"])
      expect(
        resolvePlace(
          partner({ town, lat: SOFIA.lat, lng: SOFIA.lng }),
          NO_LOOKUPS,
          ctx,
        ).ekatte,
        town,
      ).toBe(SOFIA.ekatte);
  });
});

describe("a placed row is always a complete place", () => {
  // The reverse implication alone (!ekatte ⇒ !obshtina) let 22 rows through
  // with an ekatte and no municipality — invisible to the per-capita ranking
  // this ingest exists for, and passing 137's IFF CHECK.
  it("carries an obshtina and an oblast whenever it carries an ekatte", () => {
    const rows = [
      partner({ town: "Nikopol", postcode: "5940" }),
      partner({ town: "Sofia", lat: SOFIA.lat, lng: SOFIA.lng }),
      partner({ partnerName: "Община Ямбол" }),
      partner({ town: "Bourgas", postcode: "8000" }),
    ];
    for (const p of rows) {
      const r = resolvePlace(p, NO_LOOKUPS, ctx);
      expect(r.ekatte, p.town ?? p.partnerName).toBeTruthy();
      expect(r.obshtina, p.town ?? p.partnerName).toBeTruthy();
      expect(r.oblast, p.town ?? p.partnerName).toBeTruthy();
      // Codes, not the names the crosswalks store.
      expect(r.obshtina).toMatch(/^[A-Z]{3}\d{2}$|^S\d{2}/);
    }
  });
});

describe("resolveAll's diagnostics", () => {
  it("counts every geo rejection, not only the awarder_seats ones", () => {
    const inSofia = { lat: SOFIA.lat, lng: SOFIA.lng };
    const rows = [
      // Tier P: town says Варна, the point says София.
      partner({ keepId: 1, partnerSeq: 0, town: "Varna", ...inSofia }),
      // Tier L via tr only: crosswalk says Варна, the point says София.
      partner({ keepId: 1, partnerSeq: 1, eik: "111111111", ...inSofia }),
    ];
    const { stats } = resolveAll(
      rows,
      {
        seatByEik: new Map(),
        trPlaceByEik: new Map([["111111111", { ekatte: "10135" }]]),
      },
      ctx,
    );
    // The old inference saw neither of these — it only looked at seatByEik.
    expect(stats.geoRejected).toBeGreaterThanOrEqual(2);
  });

  it("counts placements the geo check could not test", () => {
    const { stats } = resolveAll(
      [partner({ town: "Nikopol", postcode: "5940", lat: null, lng: null })],
      NO_LOOKUPS,
      ctx,
    );
    expect(stats).toMatchObject({ placed: 1, geoUncheckable: 1 });
  });
});
