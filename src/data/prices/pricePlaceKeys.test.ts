// resolvePriceKeys maps a place (obshtina, ekatte) to the keys the КЗП price
// tree is actually stored under. Two quirks it centralizes — a Sofia район
// falling back to the city bundle, and Sofia city being keyed SOF46 rather than
// SOF00 — were live bugs when copy-pasted, so they're worth pinning here. Pure:
// the Sofia predicates are regex checks, no network.

import { describe, it, expect } from "vitest";
import { resolvePriceKeys } from "./pricePlaceKeys";

describe("resolvePriceKeys", () => {
  it("passes a regular município through untouched", () => {
    expect(resolvePriceKeys("BLG00", "56789")).toEqual({
      priceObshtina: "BLG00",
      priceEkatte: "56789",
    });
  });

  it("leaves the settlement key undefined when none is given", () => {
    expect(resolvePriceKeys("BLG00")).toEqual({
      priceObshtina: "BLG00",
      priceEkatte: undefined,
    });
  });

  it("remaps Sofia city (SOF00 / SOF) to the SOF46 price key", () => {
    expect(resolvePriceKeys("SOF00").priceObshtina).toBe("SOF46");
    expect(resolvePriceKeys("SOF").priceObshtina).toBe("SOF46");
  });

  it("falls a Sofia район back to the SOF46 obshtina + city EKATTE", () => {
    // S2xxx район carries no basket of its own → show the capital's prices.
    expect(resolvePriceKeys("S2001")).toEqual({
      priceObshtina: "SOF46",
      priceEkatte: "68134",
    });
  });

  it("keeps an explicit (non-Sofia) settlement over the район city fallback", () => {
    expect(resolvePriceKeys("S2001", "12345")).toEqual({
      priceObshtina: "SOF46",
      priceEkatte: "12345",
    });
  });

  it("maps a Sofia район composite EKATTE (68134-xxxx) to the city shard", () => {
    // The район page passes its own composite ekatte, which has NO shard — the
    // regression that showed an empty "Пълна кошница". Must fold to the city.
    expect(resolvePriceKeys("S2401", "68134-2401")).toEqual({
      priceObshtina: "SOF46",
      priceEkatte: "68134",
    });
  });

  it("maps the Sofia city EKATTE (68134) to itself", () => {
    expect(resolvePriceKeys("SOF00", "68134").priceEkatte).toBe("68134");
  });

  it("does not mistake a non-Sofia 5-digit EKATTE for Sofia", () => {
    // 68135 shares a prefix with 68134 but is a different settlement.
    expect(resolvePriceKeys("BLG00", "68135").priceEkatte).toBe("68135");
  });
});
