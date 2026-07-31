import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadBulgariaGeo, renderMapCard, type GeoFeature } from "./cardKit";

const ROOT = resolve(__dirname, "../..");

/** A square somewhere over Bulgaria — enough for the projection to fit. */
const stubGeo: GeoFeature[] = [
  {
    type: "Feature",
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
