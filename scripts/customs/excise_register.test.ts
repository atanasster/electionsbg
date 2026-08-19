// The address parser, the geocoder and the goods classifier — every function here
// reads free text from an external register, which is the code that fails
// silently. Reachable only because the module guards its entrypoint; before that
// an import fired a live BACIS fetch and opened a Postgres pool.

import { describe, it, expect } from "vitest";
import {
  parseWarehouseAddr,
  Geocoder,
  goodsCategories,
  warehouseCategory,
  cnCategory,
  cleanName,
} from "./excise_register";

describe("parseWarehouseAddr", () => {
  it("reads тип, name and oblast", () => {
    expect(
      parseWarehouseAddr(
        "Област: София Община: Столична Населено място: с. Лозен Улица: Витоша 1",
      ),
    ).toEqual({ type: "с.", name: "Лозен", oblast: "София" });
  });

  it("normalises a spelled-out тип", () => {
    expect(
      parseWarehouseAddr(
        "Област: Варна Община: Варна Населено място: град Варна",
      ),
    ).toMatchObject({ type: "гр.", name: "Варна" });
  });

  it("drops a trailing район / parenthetical", () => {
    expect(
      parseWarehouseAddr(
        "Област: Пловдив Община: Пловдив Населено място: гр. Пловдив, район Южен Улица: X",
      ),
    ).toMatchObject({ name: "Пловдив" });
    expect(
      parseWarehouseAddr(
        "Област: Русе Община: Русе Населено място: гр. Русе (склад 2)",
      ),
    ).toMatchObject({ name: "Русе" });
  });

  it("returns a null тип when the cell omits it", () => {
    expect(
      parseWarehouseAddr("Област: Варна Община: Варна Населено място: Варна"),
    ).toEqual({ type: null, name: "Варна", oblast: "Варна" });
  });

  it("returns null when Населено място is absent", () => {
    expect(parseWarehouseAddr("Област: Варна Община: Варна")).toBeNull();
  });
});

describe("Geocoder.locate", () => {
  const geo = new Geocoder();
  const at = (addr: string) => geo.locate(parseWarehouseAddr(addr), null);

  // FINDING-001 regression. Sofia's oblast code in settlements.json is S23; the
  // pin said S22, which is on no row, so the tiebreak matched nothing, the guard
  // failed OPEN and cands[0] won — с. Лозен (София) was plotted in Велико
  // Търново, ~200 km away, on a map whose whole proposition is a per-city count.
  it("places с. Лозен, Област София in Sofia — not Veliko Tarnovo", () => {
    const loc = at(
      "Област: София Община: Столична Населено място: с. Лозен Улица: X",
    );
    expect(loc).not.toBeNull();
    const [lng, lat] = loc!;
    expect(lng).toBeCloseTo(23.482714, 4);
    expect(lat).toBeCloseTo(42.601663, 4);
  });

  it("places с. Бистрица, Област София in Sofia — not Blagoevgrad", () => {
    const loc = at(
      "Област: София Община: Столична Населено място: с. Бистрица Улица: X",
    );
    expect(loc).not.toBeNull();
    expect(loc![0]).toBeCloseTo(23.359599, 4);
    expect(loc![1]).toBeCloseTo(42.584097, 4);
  });

  it("fails CLOSED when the oblast matches no candidate", () => {
    // An oblast we can resolve but that matches none of the same-named
    // settlements means the address and the index disagree. A counted miss is
    // recoverable; an arbitrary village in another oblast is not.
    const before = geo.misses().length;
    expect(
      at("Област: Бургас Община: X Населено място: с. Лозен Улица: Y"),
    ).toBeNull();
    expect(geo.misses().length).toBeGreaterThan(before);
  });

  it("still resolves an unambiguous name", () => {
    const loc = at("Област: Бургас Община: Камено Населено място: гр. Камено");
    expect(loc).not.toBeNull();
  });

  it("never resolves to a non-settlement row (country / общ. / ман.)", () => {
    // settlements.json carries 88 foreign countries under oblast "32"; indexed as
    // candidates, a village sharing a country's name would be plotted abroad.
    expect(at("Област: X Община: Y Населено място: Австрия")).toBeNull();
  });

  it("backfills the тип for the display place", () => {
    expect(
      geo.displayPlace({ type: null, name: "Камено", oblast: "Бургас" }),
    ).toBe("гр. Камено");
    expect(
      geo.displayPlace({ type: "с.", name: "Лозен", oblast: "София" }),
    ).toBe("с. Лозен");
  });
});

describe("goods classification", () => {
  it("maps CN prefixes to excise categories", () => {
    expect(cnCategory("2204")).toBe("alcohol");
    expect(cnCategory("2402")).toBe("tobacco");
    expect(cnCategory("2710")).toBe("energy");
    expect(cnCategory("9999")).toBe("other");
  });

  it("splits on every delimiter the register uses", () => {
    expect([...goodsCategories("2710, 2204; 2402 · 9999")].sort()).toEqual([
      "alcohol",
      "energy",
      "other",
      "tobacco",
    ]);
  });

  it("ignores tokens that are not CN codes", () => {
    expect([...goodsCategories("виж описание, 2710")]).toEqual(["energy"]);
    expect([...goodsCategories("221")]).toEqual([]); // < 4 digits
  });

  it("prefers the first non-other category in draw order", () => {
    expect(warehouseCategory("9999, 2204, 2710")).toBe("energy");
    expect(warehouseCategory("2204, 2402")).toBe("tobacco");
    expect(warehouseCategory("9999")).toBe("other");
    expect(warehouseCategory("")).toBe("other");
  });
});

describe("cleanName", () => {
  it("strips the register's smart quotes and collapses whitespace", () => {
    expect(cleanName("„ЛУКОЙЛ  БЪЛГАРИЯ” ЕООД")).toBe("ЛУКОЙЛ БЪЛГАРИЯ ЕООД");
  });
});

describe("Sofia oblast family", () => {
  const geo = new Geocoder();
  const at = (addr: string) => geo.locate(parseWarehouseAddr(addr), null);

  // Столична община's settlements are split across S23/S24/S25, so pinning
  // „Област София" to a single code would fail CLOSED on any ambiguous
  // Sofia-city name — safe, but a miss we can avoid.
  it("accepts an S24 Sofia-city village", () => {
    expect(
      at("Област: София Община: Столична Населено място: с. Бусманци"),
    ).not.toBeNull();
  });

  it("accepts an S25 Sofia-city town even when the name is ambiguous", () => {
    // гр. Банкя (S25) vs с. Банкя (PER) — the тип filter alone resolves this one,
    // so ask without a тип to force the oblast tiebreak to do the work.
    const loc = at("Област: София Община: Столична Населено място: Банкя");
    expect(loc).not.toBeNull();
    expect(loc![0]).toBeCloseTo(23.146967, 4);
  });
});
