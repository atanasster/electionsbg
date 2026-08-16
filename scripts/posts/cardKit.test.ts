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
  renderVersusCard,
  FONT,
  VERSUS_METRICS,
  VERSUS_SIDE_INK,
  THEME,
  placeInt,
  safeColor,
  type GeoFeature,
  type TableCardSpec,
  type PlaceCardSpec,
  type VersusCardSpec,
  type VersusRow,
  type VersusSide,
  type VersusFormClass,
  type VersusMetricKey,
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

  // A settlement with its own кметство gets TWO mayor rows (Step 5 of the
  // settlement-post skill), and the government zone lays those out top-down at
  // a hard 86px floor while pinning the council to the zone's bottom. So its
  // height need grows with its content — 315px against the 268 the `people`
  // zone sets — and a single global floor cannot see that. с. Трайково shipped
  // through the 268 guard on 2026-08-13 and printed the second mayor's
  // "ГЕРБ · първи тур" across the council label; the 190 → 268 widening in
  // August had fixed only the `people` half of the same bug.
  const twoMayors = {
    ...place.government,
    mayors: [
      place.government.mayors[0],
      {
        role: "кмет на общината",
        name: "Цветан Цветанов",
        note: "ГЕРБ",
        pct: 54.9,
      },
    ],
  };

  it("refuses a two-mayor government zone that a one-mayor card would fit", () => {
    // Portrait + 3 cells + 3 benchmarks leaves 297px a zone. That clears the
    // 268 baseline, so the one-mayor form renders — the two-mayor form must not.
    const band = {
      label: benchBand.label,
      cells: [
        { label: "етнически състав", value: "79,7%" },
        { label: "евросредства", value: "163,9 млн. €" },
        { label: "обществени поръчки", value: "118,6 млн. €" },
      ],
      benchmarks: benchBand.benchmarks.slice(0, 3),
    };
    expect(() =>
      renderPlaceCard({ ...place, format: "portrait", municipality: band }),
    ).not.toThrow();
    expect(() =>
      renderPlaceCard({
        ...place,
        format: "portrait",
        government: twoMayors,
        municipality: band,
      }),
    ).toThrow(/do not fit/);
  });

  it("renders two mayors plus a council once the band leaves 315px a zone", () => {
    // Dropping one benchmark row (68px, split across two grid rows) takes the
    // zone from 297 to 331 — the floor the two-mayor form actually needs.
    const png = renderPlaceCard({
      ...place,
      format: "portrait",
      government: twoMayors,
      municipality: {
        label: benchBand.label,
        cells: [
          { label: "етнически състав", value: "79,7%" },
          { label: "евросредства", value: "163,9 млн. €" },
          { label: "обществени поръчки", value: "118,6 млн. €" },
        ],
        benchmarks: benchBand.benchmarks.slice(0, 2),
      },
    });
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
  });

  it("keeps a one-mayor card at the cheaper floor", () => {
    // The raised floor is declared by the government zone, not baked into the
    // constant — so a card with one mayor and a council still renders in the
    // square canvas that a 315 global floor would have rejected.
    const png = renderPlaceCard({
      ...place,
      municipality: {
        label: benchBand.label,
        benchmarks: benchBand.benchmarks.slice(0, 2),
      },
    });
    expect(png.readUInt32BE(20)).toBe(1080);
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

describe("renderVersusCard", () => {
  /** A minimal legal annual-class side. `rows` must carry exactly `metrics`. */
  const side = (
    name: string,
    formClass: VersusFormClass,
    rows: VersusRow[],
    role = "министър",
  ): VersusSide => ({
    name,
    role,
    formLabel:
      formClass === "annual"
        ? "годишна декларация"
        : "декларация при напускане",
    formClass,
    rows,
    total: { label: "активи", value: "475 114 €" },
  });

  const annualRows: VersusRow[] = [
    { key: "bank", value: "160 060 €", magnitude: 160060 },
    { key: "income", value: "77 684 €", magnitude: 77684 },
  ];
  const base: VersusCardSpec = {
    versus: {
      left: side("Бойко Рашков", "annual", annualRows),
      right: side("Иван Демерджиев", "annual", [
        { key: "bank", value: "0 €", magnitude: 0 },
        { key: "income", value: "104 189 €", magnitude: 104189 },
      ]),
    },
    year: 2022,
    basis: "Активи = декларираното без задълженията.",
    metrics: ["bank", "income"],
    source: "Източник: Сметна палата",
  };

  it("renders portrait at 1080×1350, in both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      const png = renderVersusCard({ ...base, theme });
      expect(png.readUInt32BE(16)).toBe(1080);
      expect(png.readUInt32BE(20)).toBe(1350);
    }
  });

  it("refuses two sides filed on different forms", () => {
    // An annual carries income and ~1.4 property rows; an entry/vacate carries
    // ~6.3 property rows and no income table at all. Comparing them prints two
    // false sentences at once.
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: base.versus.left,
          right: side("Иван Демерджиев", "inventory", [
            { key: "bank", value: "0 €", magnitude: 0 },
            { key: "income", value: "0 €", magnitude: 0 },
          ]),
        },
      }),
    ).toThrow(/different forms/);
  });

  it("refuses `real_estate` on an annual card — 50.7% of them show a false zero", () => {
    // Measured over the 3,090 person-years where the same person filed both
    // forms for one period: the annual shows zero properties while the inventory
    // shows some in 1,568 of them.
    const rows: VersusRow[] = [
      { key: "real_estate", value: "0 €", magnitude: 0 },
      { key: "bank", value: "0 €", magnitude: 0 },
    ];
    expect(() =>
      renderVersusCard({
        ...base,
        metrics: ["real_estate", "bank"],
        versus: {
          left: side("А", "annual", rows),
          right: side("Б", "annual", rows),
        },
      }),
    ).toThrow(/not measurable on a annual filing/);
  });

  it("refuses `income` on an inventory card — no such filing carries the table", () => {
    const rows: VersusRow[] = [
      { key: "bank", value: "0 €", magnitude: 0 },
      { key: "income", value: "0 €", magnitude: 0 },
    ];
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: side("А", "inventory", rows),
          right: side("Б", "inventory", rows),
        },
      }),
    ).toThrow(/not measurable on a inventory filing/);
  });

  it("has no `credit_limit` metric — a declared credit line is not a debt", () => {
    expect(VERSUS_METRICS).not.toHaveProperty("credit_limit");
  });

  it("refuses a row that is not in `metrics`, which would render on one side only", () => {
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: {
            ...base.versus.left,
            rows: [...annualRows, { key: "cash", value: "5 €", magnitude: 5 }],
          },
          right: base.versus.right,
        },
      }),
    ).toThrow(/not in `metrics`/);
  });

  it("refuses a side that omits a declared metric rather than inferring a zero", () => {
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: { ...base.versus.left, rows: [annualRows[0]] },
          right: base.versus.right,
        },
      }),
    ).toThrow(/missing metric "income"/);
  });

  it("refuses a negative or non-finite magnitude", () => {
    for (const magnitude of [-1, NaN, Infinity]) {
      expect(() =>
        renderVersusCard({
          ...base,
          versus: {
            left: {
              ...base.versus.left,
              rows: [{ key: "bank", value: "x", magnitude }, annualRows[1]],
            },
            right: base.versus.right,
          },
        }),
      ).toThrow(/magnitude/);
    }
  });

  it("refuses an empty `value`, which draws a bar with no number beside it", () => {
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: {
            ...base.versus.left,
            rows: [{ key: "bank", value: "", magnitude: 1 }, annualRows[1]],
          },
          right: base.versus.right,
        },
      }),
    ).toThrow(/empty `value`/);
  });

  it("refuses a non-integer year — a JSON spec is not type-checked", () => {
    expect(() =>
      renderVersusCard({ ...base, year: "2022" as unknown as number }),
    ).toThrow(/`year` must be an integer/);
  });

  it("refuses a flow-only metric list, which would drop both totals", () => {
    // `total` is required and the basis line explains it, but the total band is
    // drawn from the stock rows — so a flow-only card silently omits a figure
    // the caller computed while keeping the sentence that defines it.
    const rows: VersusRow[] = [{ key: "income", value: "1 €", magnitude: 1 }];
    expect(() =>
      renderVersusCard({
        ...base,
        metrics: ["income"],
        versus: {
          left: side("А", "annual", rows),
          right: side("Б", "annual", rows),
        },
      }),
    ).toThrow(/no stock row/);
  });

  it("refuses sides that disagree on the total's label, which is drawn once", () => {
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: base.versus.left,
          right: {
            ...base.versus.right,
            total: { label: "нетно", value: "0 €" },
          },
        },
      }),
    ).toThrow(/disagree on the total's label/);
  });

  it("refuses a duplicate metric", () => {
    expect(() =>
      renderVersusCard({ ...base, metrics: ["bank", "bank", "income"] }),
    ).toThrow(/duplicate metric/);
  });

  it("counts the WRAPPED basis against the content box, not one line of it", () => {
    // The basis block grows upward from a fixed baseline, so each extra wrapped
    // line eats into the rows' space. Sizing the box against a one-line basis is
    // how a 3-line one printed itself through the last row's label and values,
    // at exit 0. A full annual metric set leaves little slack by design.
    const keys: VersusMetricKey[] = [
      "bank",
      "cash",
      "vehicle",
      "investment",
      "security",
      "receivable",
      "debt",
      "income",
    ];
    const rows: VersusRow[] = keys.map((key) => ({
      key,
      value: "0 €",
      magnitude: 0,
    }));
    const stuffed = {
      ...base,
      metrics: keys,
      versus: {
        left: side("А", "annual", rows),
        right: side("Б", "annual", rows),
      },
    };
    expect(() =>
      renderVersusCard({ ...stuffed, basis: "Активи." }),
    ).not.toThrow();
    expect(() =>
      renderVersusCard({
        ...stuffed,
        basis:
          "Активи = декларираното без задълженията и кредитните лимити; " +
          "стойностите са както са декларирани, а съсобственият имот се " +
          "брои веднъж, не по веднъж на съсобственик.",
      }),
    ).toThrow(/px are free/);
  });

  it("refuses a property count on an annual card", () => {
    // A property COUNT is an inventory claim: on an annual filing „0 имота" is a coin flip
    // (50.7% of people who filed both forms for one period show zero on the annual and real
    // property on the inventory). Same rule as the `real_estate` metric, enforced separately
    // because this band does not go through `metrics`.
    const props = { total: 2, parts: [{ label: "апартамента", n: 2 }] };
    expect(() =>
      renderVersusCard({
        ...base,
        versus: {
          left: { ...base.versus.left, properties: props },
          right: { ...base.versus.right, properties: props },
        },
      }),
    ).toThrow(/only meaningful on an inventory filing/);
  });

  it("refuses a property count on one side only", () => {
    // Symmetric like every row: one side showing a count while the other shows nothing reads
    // as „declared none", which is a different claim from „not measured".
    const inv = (rows: VersusRow[], properties?: VersusSide["properties"]) => ({
      ...side("А", "inventory", rows),
      properties,
    });
    const rows: VersusRow[] = [{ key: "bank", value: "0 €", magnitude: 0 }];
    expect(() =>
      renderVersusCard({
        ...base,
        metrics: ["bank"],
        versus: {
          left: inv(rows, { total: 1, parts: [{ label: "къща", n: 1 }] }),
          right: inv(rows),
        },
      }),
    ).toThrow(/one side carries a property count/);
  });

  it("renders the property band on an inventory card", () => {
    const rows: VersusRow[] = [{ key: "bank", value: "0 €", magnitude: 0 }];
    const png = renderVersusCard({
      ...base,
      metrics: ["bank"],
      versus: {
        left: {
          ...side("А", "inventory", rows),
          properties: {
            total: 24,
            parts: [
              { label: "апартамента", n: 6 },
              { label: "други имота", n: 6 },
              { label: "търговски обекта", n: 4 },
              { label: "къщи", n: 2 },
              { label: "земеделски имота", n: 2 },
              { label: "парцела", n: 2 },
              { label: "гаража", n: 2 },
            ],
          },
        },
        right: {
          ...side("Б", "inventory", rows),
          properties: { total: 0, parts: [] },
        },
      },
    });
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
  });

  it("reserves the separator's MEASURED width out of both name budgets", async () => {
    // VersusSide.name's contract requires the register's own spelling, and cacbg spells full
    // three-part Bulgarian names. `fitText` shrinks a name to fit its column, so a budget
    // that does not subtract the separator does not merely risk a collision — it guarantees
    // one, with the name landing exactly on the separator.
    //
    // Driven with a LONG separator on purpose. The shipped default („с/у") is narrow enough
    // that an assumed 24px reserve also happens to clear it, so a short separator cannot
    // tell a measured reserve from a lucky constant. „срещу" — the original — is 71.9px and
    // does.
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const inkRightOfNames = async (separator: string): Promise<number> => {
      const png = renderVersusCard({
        ...base,
        separator,
        versus: {
          left: {
            ...base.versus.left,
            name: "Христо Александров Проданов",
            role: undefined,
          },
          right: {
            ...base.versus.right,
            name: "Десислава Атанасова Танева",
            role: undefined,
          },
        },
      });
      const img = await loadImage(png);
      const cx = createCanvas(1080, 1350).getContext("2d");
      cx.drawImage(img, 0, 0);
      // The name baseline band, left half only: find the rightmost lit pixel.
      const band = cx.getImageData(0, 190, 540, 44).data;
      let rightmost = 0;
      for (let i = 0; i < band.length; i += 4) {
        const px = (i / 4) % 540;
        // Name ink only. The threshold has to clear `pal.muted` (154,167,189) as well as the
        // background, because the separator itself is drawn in muted and sits inside this
        // window — at 150 the scan found the separator's own left edge and called it a name.
        // `pal.text` is (242,245,248).
        if (band[i] > 220 && band[i + 1] > 220 && band[i + 2] > 220)
          rightmost = Math.max(rightmost, px);
      }
      return rightmost;
    };

    const CX = 540;
    const sepHalf = (() => {
      const m = createCanvas(10, 10).getContext("2d");
      m.font = `600 24px ${FONT}`;
      return m.measureText("срещу").width / 2;
    })();
    expect(sepHalf).toBeGreaterThan(30); // the case a narrow default cannot exercise

    const ink = await inkRightOfNames("срещу");
    expect(ink).toBeGreaterThan(0); // the name really is drawn, or this proves nothing
    expect(ink).toBeLessThan(CX - sepHalf);
  });

  it("draws a small declared sum as a bar, not as the declared-zero mark", async () => {
    // The bar is the encoding the card leads with. Branching on the drawn LENGTH
    // rather than the magnitude painted anything under ~0.5% of the band max in
    // the same grey as a true zero, collapsing "declared €1,200" and "declared
    // nothing" into one mark. Value text is held identical so only the bar can
    // differ between the two renders.
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const render = async (magnitude: number) => {
      const png = renderVersusCard({
        ...base,
        metrics: ["bank", "cash"],
        versus: {
          left: side("А", "annual", [
            { key: "bank", value: "315 054 €", magnitude: 315054 },
            { key: "cash", value: "1 200 €", magnitude },
          ]),
          right: side("Б", "annual", [
            { key: "bank", value: "0 €", magnitude: 0 },
            { key: "cash", value: "0 €", magnitude: 0 },
          ]),
        },
      });
      const img = await loadImage(png);
      const cx = createCanvas(1080, 1350).getContext("2d");
      cx.drawImage(img, 0, 0);
      return Buffer.from(cx.getImageData(0, 0, 1080, 1350).data);
    };
    expect((await render(1200)).equals(await render(0))).toBe(false);
  });
});

describe("card ink contrast", () => {
  /** WCAG relative luminance of a #rrggbb string. */
  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // WCAG 1.4.11: a graphical object carrying information needs 3:1 against its
  // surface. This codifies the rule the LINE_SERIES comment states in prose —
  // and which the versus card's first cut broke by reaching past that fix to the
  // raw brand coral, giving one named person weaker bars than the other.
  it("every side-bar ink clears 3:1 against its own surface", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const ink of VERSUS_SIDE_INK[theme]) {
        expect(ratio(ink, THEME[theme].bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("the two sides' inks are within 1.5x of each other, so neither reads as favoured", () => {
    for (const theme of ["dark", "light"] as const) {
      const [a, b] = VERSUS_SIDE_INK[theme].map((ink) =>
        ratio(ink, THEME[theme].bg),
      );
      expect(Math.max(a, b) / Math.min(a, b)).toBeLessThan(1.5);
    }
  });
});

describe("refusal-guard contract", () => {
  // Every renderer that can be over-stuffed carries a "refuse rather than emit
  // garbage" guard, and each was tested only inside its own describe — so the
  // newest renderer shipped with no guard test at all. This table is the one
  // place that answers "does every renderer refuse an over-stuffed spec?", the
  // question that goes unasked on the day another is added.
  //
  // The four here are the ones whose over-stuffed spec is cheap to build.
  // renderMapCard and renderPlaceCard are guarded too and are covered in their
  // own describes above (/map area/ and /do not fit/) — their fixtures need the
  // base geometry and a full zone set respectively, so they are referenced
  // rather than rebuilt. A new renderer belongs in this table.
  //
  // A card is published as an image: an overrun is not a layout wobble but a
  // euro figure with a caveat line struck through it, at exit 0.
  const overStuffed: [string, () => unknown][] = [
    [
      "renderBarCard",
      () =>
        renderBarCard({
          title: "Заглавие",
          bars: Array.from({ length: 14 }, (_, i) => ({
            label: `ред ${i}`,
            value: 10 - i,
          })),
          source: "Източник: тест",
          footnote: "Бележка. ".repeat(40),
        }),
    ],
    [
      "renderLineCard",
      () =>
        renderLineCard({
          title: "Много дълго заглавие, ".repeat(12),
          labels: ["2020", "2021", "2022"],
          series: [{ label: "БГ", values: [1, 2, 3] }],
          source: "Източник: тест",
          footnote: "Бележка. ".repeat(40),
        }),
    ],
    [
      "renderTableCard",
      () =>
        renderTableCard({
          title: "Заглавие",
          columns: ["община", "2021", "2023"],
          rows: Array.from({ length: 6 }, (_, i) => ({
            label: `община ${i}`,
            sub: "подзаглавие",
            cells: [{ value: "27,7%" }, { value: "31,2%" }],
          })),
          source: "Източник: тест",
          footnote: "Бележка. ".repeat(40),
        }),
    ],
    [
      "renderVersusCard",
      () => {
        const keys: VersusMetricKey[] = [
          "bank",
          "cash",
          "vehicle",
          "investment",
          "security",
          "receivable",
          "debt",
          "income",
        ];
        const rows: VersusRow[] = keys.map((key) => ({
          key,
          value: "0 €",
          magnitude: 0,
        }));
        const s = (name: string): VersusSide => ({
          name,
          formLabel: "годишна декларация",
          formClass: "annual",
          rows,
          total: { label: "активи", value: "0 €" },
        });
        return renderVersusCard({
          versus: { left: s("А"), right: s("Б") },
          year: 2022,
          basis: "Активи = декларираното без задълженията. ".repeat(4),
          metrics: keys,
          source: "Източник: тест",
        });
      },
    ],
  ];

  it.each(overStuffed)("%s refuses an over-stuffed spec", (_name, build) => {
    expect(build).toThrow();
  });
});
