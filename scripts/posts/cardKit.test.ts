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
  type GeoFeature,
  type TableCardSpec,
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
