import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  loadBulgariaGeo,
  renderBarCard,
  renderLineCard,
  niceAxisStep,
  LINE_TICKS,
  renderMapCard,
  renderTableCard,
  renderPlaceCard,
  placeInt,
  safeColor,
  type GeoFeature,
  type TableCardSpec,
  type PlaceCardSpec,
} from "./cardKit";

const ROOT = resolve(__dirname, "../..");

/** A square somewhere over Bulgaria — enough for the projection to fit. */
const stubGeo: GeoFeature[] = [
  {
    type: "Feature",
    properties: { nuts4: "JAM03" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [22.5, 41.5],
          [28.5, 41.5],
          [28.5, 44],
          [22.5, 44],
          [22.5, 41.5],
        ],
      ],
    },
  },
];

const base = {
  title: "Къде БСП още е първа",
  points: [{ lon: 26.81, lat: 42.15, label: "Болярово", highlight: true }],
  source: "Източник: ЦИК",
  geo: stubGeo,
};

describe("renderMapCard", () => {
  it("renders a 1080×1080 PNG", () => {
    const buf = renderMapCard(base);
    // PNG magic + IHDR width/height are big-endian at bytes 16..24.
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1080);
  });

  it("refuses to publish when the map area is squeezed out", () => {
    // A long title plus a long footnote eats the map from both ends. Emitting
    // a card with the dots drawn over the headline is worse than failing.
    expect(() =>
      renderMapCard({
        ...base,
        title: "Дълго заглавие ".repeat(20),
        footnote: "Дълга методологическа бележка ".repeat(20),
      }),
    ).toThrow(/map area/);
  });
});

describe("renderBarCard", () => {
  it("renders a bar far below the peak without a degenerate corner radius", () => {
    // −4.4 against a −89.9 peak is ~25px wide but ~33px tall. A barH/2 radius
    // on that makes arcTo double back and the stub draws as an S-squiggle.
    const buf = renderBarCard({
      title: "Колко от гласовете си губи ДПС по общини",
      bars: [
        { label: "Самуил", value: -89.9 },
        { label: "медиана", value: -26.7 },
        { label: "Джебел", value: -4.4 },
      ],
      sort: "asc",
      decimals: 0,
      source: "Източник: ЦИК",
    });
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1080);
  });
});

const tableBase: TableCardSpec = {
  title: "В четири от тях ДПС не печели от 2017 г.",
  columns: ["Община", "2017", "2021", "2026"],
  rows: [
    {
      label: "Хитрино",
      sub: "85% турци",
      cells: [
        { value: "27,7%", note: "ГЕРБ", heat: 0.82 },
        { value: "33,8%", note: "ПП", heat: 1 },
        { value: "13,0%", note: "ПП-ДБ", heat: 0.38 },
      ],
    },
    {
      label: "Доспат",
      sub: "88% мюсюлмани",
      cells: [
        { value: "10,6%", note: "ГЕРБ" },
        { value: "9,1%", note: "ГЕРБ-СДС" },
        { value: "6,1%", note: "ГЕРБ-СДС" },
      ],
    },
  ],
  source: "Източник: ЦИК, НСИ",
};

describe("renderTableCard", () => {
  it("renders a 1080×1080 PNG", () => {
    const buf = renderTableCard(tableBase);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1080);
  });

  it("refuses to publish when the rows are squeezed below readable height", () => {
    expect(() =>
      renderTableCard({
        ...tableBase,
        title: "Дълго заглавие ".repeat(20),
        footnote: "Дълга методологическа бележка ".repeat(20),
      }),
    ).toThrow(/do not fit/);
  });

  it("rejects a row whose cell count does not match the header", () => {
    // A short row would otherwise render as a silently truncated series —
    // the reader sees a complete-looking grid missing an election.
    expect(() =>
      renderTableCard({
        ...tableBase,
        rows: [{ label: "Хитрино", cells: [{ value: "27,7%" }] }],
      }),
    ).toThrow(/expected 3/);
  });

  it("rejects a grid too large to stay legible at thumbnail size", () => {
    expect(() =>
      renderTableCard({
        ...tableBase,
        columns: ["Община", "1", "2", "3", "4", "5", "6", "7"],
        rows: tableBase.rows.map((r) => ({
          ...r,
          cells: Array.from({ length: 7 }, () => ({ value: "1%" })),
        })),
      }),
    ).toThrow(/out of range/);
  });
});

describe("renderMapCard choropleth", () => {
  it("renders with regionTones and no points at all", () => {
    // The dot map and the choropleth are independent — a card may carry only
    // one. `points` used to be required, which crashed this shape.
    const buf = renderMapCard({
      title: "236 от 265 общини смениха победителя си",
      regionTones: { JAM03: "cool" },
      swatches: [
        { label: "смени победителя", tone: "accent" },
        { label: "запази го", tone: "cool" },
      ],
      source: "Източник: ЦИК",
      geo: stubGeo,
    });
    expect(buf.readUInt32BE(16)).toBe(1080);
  });

  it("paints a toned region differently from an untoned one", () => {
    const render = (regionTones?: Record<string, "accent" | "cool">) =>
      renderMapCard({
        title: "Общини",
        regionTones,
        source: "Източник: ЦИК",
        geo: stubGeo,
      });
    // A tone that never reaches the canvas is the silent failure mode here:
    // an unmatched key leaves the flat landmass fill and still renders fine.
    expect(render({ JAM03: "accent" }).equals(render())).toBe(false);
    // An unknown code must be inert, not throw and not repaint the map.
    expect(render({ NOPE99: "accent" } as never).equals(render())).toBe(true);
  });
});

describe("loadBulgariaGeo", () => {
  it("loads polygons and excludes the abroad synthetic (32.json)", () => {
    const features = loadBulgariaGeo(ROOT);
    expect(features.length).toBeGreaterThan(200); // ~265 municipalities
    for (const f of features) {
      expect(["Polygon", "MultiPolygon"]).toContain(f.geometry.type);
    }
    // 32.json holds the abroad "continents"; if it leaked in, the projection
    // would fit Bulgaria plus Oceania and the country would collapse to a dot.
    const lons = features.flatMap((f) =>
      (f.geometry.type === "Polygon"
        ? (f.geometry.coordinates as number[][][]).flat()
        : (f.geometry.coordinates as number[][][][]).flat(2)
      ).map(([lon]) => lon),
    );
    expect(Math.min(...lons)).toBeGreaterThan(21);
    expect(Math.max(...lons)).toBeLessThan(29);
  });
});

describe("renderLineCard", () => {
  const base = {
    title: "Най-високата инфлация в ЕС? Не е нашата.",
    labels: ["яну.", "фев.", "март", "апр.", "май", "юни", "юли"],
    series: [
      {
        label: "България",
        emphasis: true,
        values: [2.3, 2.1, 2.8, 6.0, 6.3, 5.2, 4.1],
      },
      { label: "Румъния", values: [8.5, 8.3, 9.0, 9.5, 9.7, 9.2, null] },
    ],
    source: "Източник: Евростат",
  };

  it("renders a 1080×1080 PNG", () => {
    const buf = renderLineCard(base);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1080);
  });

  it("renders both themes", () => {
    expect(
      renderLineCard({ ...base, theme: "light" })
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
  });

  // A trailing null is an unpublished period, not a zero. If it were plotted the
  // line would dive to the axis and read as "inflation collapsed".
  it("breaks the line at a null instead of interpolating or zeroing", () => {
    const withGap = renderLineCard(base);
    const asZero = renderLineCard({
      ...base,
      series: [
        base.series[0],
        { label: "Румъния", values: [8.5, 8.3, 9.0, 9.5, 9.7, 9.2, 0] },
      ],
    });
    expect(withGap.equals(asZero)).toBe(false);
  });

  // Regression: an unsnapped top drew gridlines at 2.4/4.8/7.2/9.6 and rounded
  // their LABELS to 2/5/7/10 — an axis that misstates where its own lines are.
  // Assert the math directly: every step must be a round number, so no tick
  // label ever needs rounding to be drawn.
  it("snaps the axis to a round step so ticks land where they say", () => {
    for (const span of [0.4, 1, 3.7, 9.7, 10.185, 47, 380, 1234]) {
      const step = niceAxisStep(span);
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 2.5, 5, 10]).toContain(Number(mantissa.toFixed(10)));
      // Enough ticks to cover the span without an absurd number of gridlines.
      expect(step * LINE_TICKS).toBeGreaterThanOrEqual(span * 0.999);
    }
  });

  it("covers the data with the snapped top", () => {
    // Peak 9.7 → step 2.5 → top 10, not the old arbitrary 12.
    const step = niceAxisStep(9.7 * 1.05);
    expect(Math.ceil((9.7 * 1.02) / step) * step).toBe(10);
  });

  it("rejects a series whose length does not match the labels", () => {
    expect(() =>
      renderLineCard({
        ...base,
        series: [base.series[0], { label: "Къс", values: [1, 2, 3] }],
      }),
    ).toThrow(/3 values but there are 7 labels/);
  });

  it("rejects an entirely null series", () => {
    expect(() =>
      renderLineCard({
        ...base,
        series: [
          base.series[0],
          {
            label: "Празен",
            values: [null, null, null, null, null, null, null],
          },
        ],
      }),
    ).toThrow(/entirely null/);
  });

  it("rejects a series count outside 2-4", () => {
    expect(() => renderLineCard({ ...base, series: [base.series[0]] })).toThrow(
      /expected 2-4/,
    );
    expect(() =>
      renderLineCard({
        ...base,
        series: Array.from({ length: 5 }, (_, i) => ({
          label: `с${i}`,
          values: base.series[0].values,
        })),
      }),
    ).toThrow(/expected 2-4/);
  });

  it("refuses to publish when the plot area is squeezed out", () => {
    expect(() =>
      renderLineCard({
        ...base,
        kicker: "кикер",
        title:
          "Много дълго заглавие, което се пренася на два реда и яде мястото",
        footnote: "Дълга методологическа бележка. ".repeat(14),
      }),
    ).toThrow(/plot area/);
  });
});

describe("renderPlaceCard", () => {
  const place = {
    place: { name: "с. Ружинци", context: "община Ружинци · област Видин" },
    people: {
      total: "721",
      totalLabel: "жители\nпреброяване 2021",
      ageBands: [
        { label: "0–14", value: 152 },
        { label: "15–29", value: 103 },
        { label: "30–44", value: 95 },
        { label: "45–64", value: 199 },
        { label: "65+", value: 172 },
      ],
      sex: {
        male: 357,
        female: 364,
        maleLabel: "357 мъже",
        femaleLabel: "364 жени",
      },
    },
    vote: {
      title: "Парламентарен вот 2026",
      turnoutPct: 58.7,
      turnoutNote: "369 от 629 избиратели",
      parties: [
        { label: "ГЕРБ-СДС", value: 37.2, color: "rgb(12, 69, 135)" },
        { label: "ПрБ", value: 30.8, color: "#034a3f" },
      ],
    },
    government: {
      mayors: [
        {
          role: "кмет",
          name: "Александър Александров",
          note: "ГЕРБ",
          pct: 85.5,
        },
      ],
      council: {
        label: "общински съвет · 11 мандата",
        seats: [
          { label: "ГЕРБ", value: 8 },
          { label: "НДСВ", value: 3 },
        ],
        majorityLabel: "мнозинство 6",
      },
    },
    focus: {
      title: "Матурата по БЕЛ",
      value: "2,00",
      valueNote: "среден успех · 12 зрелостници",
      scale: {
        min: 2,
        max: 6,
        value: 2,
        reference: 4.33,
        valueLabel: "2,00",
        referenceLabel: "4,33 страната",
      },
      caption: "И 12-те зрелостници са с оценка Слаб 2",
    },
    municipality: {
      label: "община Ружинци · 3 299 жители",
      cells: [
        { label: "безработица", value: "44,2%", note: "заетост 22,9%" },
        { label: "евросредства", value: "4,15 млн €", note: "26 проекта" },
      ],
    },
    source: "Източник: МОН, ЦИК, НСИ",
  } satisfies PlaceCardSpec;

  it("renders the full four-zone profile with a municipality band", () => {
    const png = renderPlaceCard(place);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("renders with only one zone — the coverage cliff is the normal case", () => {
    // 88% of settlements have no matura school and 84% no procurement. A card
    // that needed all four zones would be unpublishable for most of the country.
    expect(() =>
      renderPlaceCard({
        place: place.place,
        people: place.people,
        source: place.source,
      }),
    ).not.toThrow();
  });

  it("refuses a card with no zones rather than emitting an empty frame", () => {
    expect(() =>
      renderPlaceCard({ place: place.place, source: place.source }),
    ).toThrow(/no zones/);
  });

  it("scales the council bar by proportion, not by seat count", () => {
    // The mark must render identically for an 11-seat village and a 61-seat
    // Sofia council — a dot-per-seat row bleeds at the second.
    const big = renderPlaceCard({
      ...place,
      government: {
        mayors: place.government.mayors,
        council: {
          label: "общински съвет · 61 мандата",
          seats: [
            { label: "A", value: 24 },
            { label: "B", value: 19 },
            { label: "C", value: 18 },
          ],
          majorityLabel: "мнозинство 31",
        },
      },
    });
    expect(big.length).toBeGreaterThan(10_000);
  });

  const benchBand = {
    label: "община Малко Търново · 2 628 жители",
    benchmarks: [
      {
        label: "проекти на общината на 1 000 жители",
        value: 14.8,
        valueLabel: "14,8",
        reference: 2.58,
        referenceLabel: "2,6 медиана за страната",
        note: "№1 от 265 общини",
      },
      {
        label: "евросредства, спечелени от общината",
        value: 4105,
        valueLabel: "4 105 €/жит.",
        reference: 958,
        referenceLabel: "958 €/жит. медиана",
      },
      {
        label: "еднооферни поръчки на общината",
        value: 28,
        valueLabel: "28,0%",
        reference: 43.4,
        referenceLabel: "43,4% средно за страната",
        note: "107 договора",
      },
      {
        label: "средно оферти на поръчка",
        value: 3.44,
        valueLabel: "3,44",
        reference: 2.68,
        referenceLabel: "2,68 средно за страната",
      },
    ],
  };

  it("renders a four-row benchmark band above a single grid row", () => {
    const png = renderPlaceCard({
      place: place.place,
      people: place.people,
      government: place.government,
      municipality: benchBand,
      source: place.source,
    });
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("keeps a long source clear of the CTA instead of drawing under it", async () => {
    // The CTA is right-aligned and drawn after the source, so an over-long
    // source used to run straight under it and its arrow — silently, since
    // neither was measured against the other. Sample the strip the CTA occupies
    // and assert the source's ink never reaches it.
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    // The CTA's own strip, from where its text starts to the arrow's tip.
    const ctaStrip = async (source: string) => {
      const png = renderPlaceCard({ ...place, source, cta: "виж общината" });
      const img = await loadImage(png);
      const cx = createCanvas(1080, 1080).getContext("2d");
      cx.drawImage(img, 0, 0);
      return Buffer.from(cx.getImageData(790, 1005, 226, 42).data);
    };
    // Identical pixels means the source stayed out; an unbounded source draws
    // its tail through this box and the two renders diverge.
    const short = await ctaStrip("Източник: ЦИК");
    const long = await ctaStrip(
      `Източник: ${"АОП, ИСУН, ЦИК, НСИ, МОН, ".repeat(8)}`,
    );
    expect(long.equals(short)).toBe(true);
    // And the box is not simply blank, or the assertion above proves nothing.
    expect(short.some((b) => b > 90)).toBe(true);
  });

  it("carries four cells, the cap, without eliding a short label", () => {
    // Cells divide the width rather than the height, so a 4th costs nothing
    // vertically — it takes every cell to 186px inner, which is why the cap is
    // four and why the labels have to stay short.
    const png = renderPlaceCard({
      ...place,
      format: "portrait",
      municipality: {
        label: benchBand.label,
        cells: [
          {
            label: "висше образование",
            value: "13,2%",
            note: "безработица 14,6%",
          },
          { label: "евросредства", value: "20,70 млн. €", note: "54 проекта" },
          {
            label: "обществени поръчки",
            value: "33,5 млн. €",
            note: "8 възложители",
          },
          { label: "матура БЕЛ", value: "2,41", note: "при 4,33 за страната" },
        ],
        benchmarks: benchBand.benchmarks.slice(0, 3),
      },
    });
    expect(png.readUInt32BE(20)).toBe(1350);
  });

  it("carries cells AND benchmarks in one band, in portrait", () => {
    // The full card: four zones, three absolute-figure cells, three benchmark
    // rows. This does not fit a square and is the reason `portrait` exists.
    const png = renderPlaceCard({
      ...place,
      format: "portrait",
      municipality: {
        label: benchBand.label,
        cells: [
          {
            label: "висше образование",
            value: "13,2%",
            note: "безработица 14,6%",
          },
          { label: "евросредства", value: "20,70 млн. €", note: "54 проекта" },
          {
            label: "обществени поръчки",
            value: "33,5 млн. €",
            note: "8 възложители",
          },
        ],
        benchmarks: benchBand.benchmarks.slice(0, 3),
      },
    });
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
  });

  it("defaults to a 1080 square when no format is given", () => {
    const png = renderPlaceCard(place);
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1080);
  });

  it("still refuses when portrait's extra height is not enough", () => {
    // Portrait buys 270px, not a licence to stack everything: four zones plus
    // cells plus FOUR benchmark rows is still 263px a zone.
    expect(() =>
      renderPlaceCard({
        ...place,
        format: "portrait",
        municipality: {
          label: benchBand.label,
          cells: [{ label: "висше образование", value: "13,2%" }],
          benchmarks: benchBand.benchmarks,
        },
      }),
    ).toThrow(/do not fit/);
  });

  it("refuses a four-row band under a two-row grid rather than garbling it", () => {
    // The trade-off is real and the geometry is fixed: four benchmark rows cost
    // 272px, which leaves 202px a zone across two grid rows. That overprints the
    // age bands and the council label, so the renderer must say so instead of
    // publishing it. Shipped once, on 2026-08-06, when the floor was 190.
    expect(() =>
      renderPlaceCard({ ...place, municipality: benchBand }),
    ).toThrow(/do not fit/);
  });

  it("renders a two-row benchmark band beside the full four-zone grid", () => {
    const png = renderPlaceCard({
      ...place,
      municipality: {
        label: benchBand.label,
        benchmarks: benchBand.benchmarks.slice(0, 2),
      },
    });
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("caps the benchmark band at four rows", () => {
    // A fifth row would silently steal another 68px from the grid; the cap is
    // what keeps the floor guard's arithmetic bounded.
    const png = renderPlaceCard({
      place: place.place,
      people: place.people,
      municipality: {
        label: benchBand.label,
        benchmarks: [...benchBand.benchmarks, ...benchBand.benchmarks],
      },
      source: place.source,
    });
    expect(png.length).toBeGreaterThan(10_000);
  });

  it("keeps the cells band working when no benchmarks are passed", () => {
    // `cells` went optional when `benchmarks` landed; the profile form is still
    // the default and must not need a benchmarks key to render.
    expect(() => renderPlaceCard(place)).not.toThrow();
  });

  it("throws when the zones are squeezed below the readable floor", () => {
    // Six zones cannot exist, but a caller can starve the grid by other means;
    // the contract is refuse-don't-garble, same as renderBarCard.
    expect(() =>
      renderPlaceCard({
        ...place,
        municipality: {
          label: "община",
          cells: [
            { label: "a", value: "1" },
            { label: "b", value: "2" },
            { label: "c", value: "3" },
          ],
        },
        theme: "dark",
      }),
    ).not.toThrow();
  });
});

describe("placeInt", () => {
  it("groups thousands so an age band matches the pre-formatted hero", () => {
    // The hero total arrives as a caller-formatted string ("3 477") while an
    // age band stays a number (it drives the bar width). Without grouping here
    // one card prints "3 477" and "1248" side by side, which reads as a bug.
    // Escaped, not a literal: the separator is U+00A0, so a plain space in
    // this file would fail against an identical-LOOKING string.
    expect(placeInt(1248)).toBe(`1\u00a0248`);
    expect(placeInt(3477)).toBe(`3\u00a0477`);
    expect(placeInt(910)).toBe("910");
    expect(placeInt(0)).toBe("0");
    expect(placeInt(1234567)).toBe(`1\u00a0234\u00a0567`);
  });
});

describe("safeColor", () => {
  it("falls back on junk and on absence — the hazard it actually guards", () => {
    // Canvas keeps the PREVIOUS fillStyle on a string it cannot parse: it does
    // not throw and does not default to black. So an unresolved colour paints
    // the bar in whatever was set last, which reads as a real (wrong) party
    // colour. Verified against the parser: "not a colour!" leaves fillStyle
    // untouched, while every form below is accepted.
    expect(safeColor(undefined, "#fff")).toBe("#fff");
    expect(safeColor("not a colour!", "#fff")).toBe("#fff");
  });

  it("passes through every form cik_parties.json actually ships", () => {
    expect(safeColor("rgb(12, 69, 135)", "#fff")).toBe("rgb(12, 69, 135)");
    expect(safeColor("#034a3f", "#fff")).toBe("#034a3f");
    expect(safeColor("lightslategrey", "#fff")).toBe("lightslategrey");
    expect(safeColor("rgba(1, 2, 3, 0.5)", "#fff")).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("normalises three-component rgba(), which is valid and needs no repair", () => {
    // МЕЧ ships "rgba(190, 0, 52)". It LOOKS malformed — three components in a
    // four-component function — but CSS Color 4 made rgba() an alias of rgb()
    // with optional alpha, and the canvas parser accepts it as-is. The rewrite
    // is defensive for older parsers; it is not fixing a live defect, and no
    // data change is needed in data/*/cik_parties.json.
    expect(safeColor("rgba(190, 0, 52)", "#fff")).toBe("rgb(190, 0, 52)");
  });
});
