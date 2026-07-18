// Pure formatting / guard helpers exported alongside the price React-Query
// hooks. These carry the display + data-hygiene logic every consumption tile
// relies on (the euro-day artifact guard, the trailing MA that de-noises the
// daily basket, the maps deep-link builder), so they're worth pinning down
// independently of the network hooks. No fetch is touched — the hooks
// themselves aren't exercised here.

import { describe, it, expect } from "vitest";
import {
  movingAverage,
  euroPctSafe,
  EURO_PCT_ARTIFACT,
  fmtEur,
  fmtPct,
  fmtPriceDate,
  priceChangeColor,
  mapsDirectionsUrl,
  findRankPlace,
  type PricePoint,
  type PriceRankingFile,
} from "./usePrices";

describe("euroPctSafe", () => {
  it("passes through plausible since-euro moves", () => {
    expect(euroPctSafe(0)).toBe(0);
    expect(euroPctSafe(42.5)).toBe(42.5);
    expect(euroPctSafe(-30)).toBe(-30);
  });

  it("keeps the boundary value (100 is not an artifact)", () => {
    expect(euroPctSafe(EURO_PCT_ARTIFACT)).toBe(100);
    expect(euroPctSafe(-EURO_PCT_ARTIFACT)).toBe(-100);
  });

  it("nulls out implausible artifacts beyond ±100%", () => {
    // A +429% is a thin euro-day baseline or a per-piece↔per-kg unit flip,
    // never a real grocery move.
    expect(euroPctSafe(429)).toBeNull();
    expect(euroPctSafe(100.01)).toBeNull();
    expect(euroPctSafe(-250)).toBeNull();
  });

  it("nulls out a missing baseline", () => {
    expect(euroPctSafe(null)).toBeNull();
    expect(euroPctSafe(undefined)).toBeNull();
  });
});

describe("movingAverage", () => {
  it("returns the same empty array untouched", () => {
    const empty: PricePoint[] = [];
    expect(movingAverage(empty)).toBe(empty);
  });

  it("preserves length and endpoints (ramps the window up)", () => {
    const pts: PricePoint[] = [
      { d: "2026-01-01", v: 10 },
      { d: "2026-01-02", v: 20 },
      { d: "2026-01-03", v: 30 },
    ];
    const out = movingAverage(pts, 3);
    expect(out).toHaveLength(3);
    // First point: window of 1 → itself.
    expect(out[0]).toEqual({ d: "2026-01-01", v: 10 });
    // Second: mean(10,20)=15. Third: mean(10,20,30)=20.
    expect(out[1].v).toBe(15);
    expect(out[2].v).toBe(20);
  });

  it("slides a trailing window once it is full", () => {
    const pts: PricePoint[] = [
      { d: "d1", v: 2 },
      { d: "d2", v: 4 },
      { d: "d3", v: 6 },
      { d: "d4", v: 8 },
    ];
    const out = movingAverage(pts, 2);
    // Trailing window of 2: [2], [2,4], [4,6], [6,8].
    expect(out.map((p) => p.v)).toEqual([2, 3, 5, 7]);
  });

  it("clamps a window larger than the series to the series length", () => {
    const pts: PricePoint[] = [
      { d: "d1", v: 1 },
      { d: "d2", v: 3 },
    ];
    const out = movingAverage(pts, 99);
    expect(out.map((p) => p.v)).toEqual([1, 2]);
  });

  it("keeps the day labels aligned to the input", () => {
    const pts: PricePoint[] = [
      { d: "2026-06-01", v: 5 },
      { d: "2026-06-08", v: 7 },
    ];
    expect(movingAverage(pts, 7).map((p) => p.d)).toEqual([
      "2026-06-01",
      "2026-06-08",
    ]);
  });
});

describe("fmtEur", () => {
  it("suffixes the euro sign in Bulgarian, prefixes in English", () => {
    expect(fmtEur(1.5, "en")).toBe("€1.50");
    expect(fmtEur(1.5, "bg")).toBe("1,50 €");
  });

  it("honours the decimal-places argument", () => {
    expect(fmtEur(1.899, "en", 0)).toBe("€2");
    expect(fmtEur(1.2, "en", 3)).toBe("€1.200");
  });
});

describe("fmtPct", () => {
  it("prefixes a plus for gains and the unicode minus for losses", () => {
    expect(fmtPct(0.041)).toBe("+4.1%");
    expect(fmtPct(-0.023)).toBe("−2.3%"); // U+2212, not ASCII hyphen
  });

  it("shows no sign at exactly zero", () => {
    expect(fmtPct(0)).toBe("0.0%");
  });

  it("honours the decimal-places argument", () => {
    expect(fmtPct(0.125, 0)).toBe("+13%");
  });
});

describe("priceChangeColor", () => {
  it("is red for a rise, green for a fall, muted for a flat move", () => {
    expect(priceChangeColor(0.05)).toContain("red");
    expect(priceChangeColor(-0.05)).toContain("green");
    expect(priceChangeColor(0)).toBe("text-muted-foreground");
    // Inside the ±0.001 dead zone → muted, not a colour.
    expect(priceChangeColor(0.0005)).toBe("text-muted-foreground");
  });
});

describe("fmtPriceDate", () => {
  it("returns an empty string for a missing date", () => {
    expect(fmtPriceDate(null, "bg")).toBe("");
    expect(fmtPriceDate(undefined, "en")).toBe("");
  });

  it("formats an ISO day with month + year", () => {
    const en = fmtPriceDate("2026-01-02", "en");
    expect(en).toContain("2026");
    expect(en).toContain("Jan");
    expect(en).toContain("2");
  });
});

describe("mapsDirectionsUrl", () => {
  it("joins the non-empty parts into an encoded destination query", () => {
    const url = mapsDirectionsUrl(["Kaufland", "ул. Витоша 1", "София"]);
    expect(url).toContain(
      "https://www.google.com/maps/dir/?api=1&destination=",
    );
    // Comma-joined then URL-encoded.
    expect(url).toContain(encodeURIComponent("Kaufland, ул. Витоша 1, София"));
  });

  it("drops null / empty / whitespace-only parts", () => {
    const url = mapsDirectionsUrl([null, "  ", "Lidl", undefined, ""]);
    expect(url.endsWith(encodeURIComponent("Lidl"))).toBe(true);
  });
});

describe("findRankPlace", () => {
  const ranking = {
    latestDate: "2026-07-08",
    baseline: "2026-01-02",
    commonBasket: [],
    commonBasketSize: 0,
    places: [
      { code: "68134", name: "София" },
      { code: "BLG00", name: "Благоевград" },
    ],
  } as unknown as PriceRankingFile;

  it("finds a place by its code", () => {
    expect(findRankPlace(ranking, "BLG00")?.name).toBe("Благоевград");
  });

  it("returns undefined for an unknown code, null code, or missing ranking", () => {
    expect(findRankPlace(ranking, "NOPE")).toBeUndefined();
    expect(findRankPlace(ranking, null)).toBeUndefined();
    expect(findRankPlace(undefined, "68134")).toBeUndefined();
  });
});
