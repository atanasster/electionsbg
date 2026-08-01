import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  loadBulgariaGeo,
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
