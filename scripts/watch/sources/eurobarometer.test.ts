// Unit tests for the Eurobarometer watch source — the pure title parser and the
// "highest wave wins" reducer in fingerprint(). No network: fetchJson is mocked.
// Runs in the `node` Vitest project (see docs/testing-standards.md).

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the fingerprint helper so fingerprint() gets synthetic ODP rows.
vi.mock("../fingerprint", () => ({ fetchJson: vi.fn() }));
import { fetchJson } from "../fingerprint";
import { eurobarometer, parseWave } from "./eurobarometer";

const mockedFetchJson = vi.mocked(fetchJson);

const row = (title: unknown) => ({ title });

describe("parseWave", () => {
  it("extracts num + season from a canonical title", () => {
    expect(parseWave("Standard Eurobarometer 105 - Spring 2026")).toEqual({
      num: 105,
      season: "Spring 2026",
    });
  });

  it("extracts the wave from the ODP compound title (skips the STDnn prefix)", () => {
    // Real ODP shape: "Standard Eurobarometer STD105 : Standard Eurobarometer 105 - Spring 2026"
    expect(
      parseWave(
        "Standard Eurobarometer STD105 : Standard Eurobarometer 105 - Spring 2026",
      ),
    ).toEqual({ num: 105, season: "Spring 2026" });
  });

  it("handles a title with no season segment", () => {
    expect(parseWave("Standard Eurobarometer 90")).toEqual({
      num: 90,
      season: "",
    });
  });

  it("returns null for Special / Flash Eurobarometer titles", () => {
    expect(parseWave("Special Eurobarometer 549")).toBeNull();
    expect(parseWave("Flash Eurobarometer 500 - Spring 2025")).toBeNull();
  });

  it("returns null for a non-matching title", () => {
    expect(parseWave("Некакво друго заглавие")).toBeNull();
  });
});

describe("eurobarometer.fingerprint", () => {
  beforeEach(() => mockedFetchJson.mockReset());

  it("selects the highest wave number across mixed rows", async () => {
    mockedFetchJson.mockResolvedValue({
      result: {
        results: [
          row({ en: "Standard Eurobarometer 104 - Autumn 2025" }),
          row({ en: "Standard Eurobarometer 105 - Spring 2026" }),
          row({ en: "Special Eurobarometer 999" }), // higher number, wrong series → ignored
          row({ bg: "Стандартен евробарометър 103" }), // localized-only → not parsed
        ],
      },
    });
    const fp = await eurobarometer.fingerprint();
    expect(fp.value).toBe("STD105");
    expect(fp.meta).toMatchObject({ latestWave: 105, season: "Spring 2026" });
  });

  it("throws when the portal returns no datasets", async () => {
    mockedFetchJson.mockResolvedValue({ result: { results: [] } });
    await expect(eurobarometer.fingerprint()).rejects.toThrow(
      /no Eurobarometer datasets/,
    );
  });

  it("throws when no row yields a parseable Standard EB wave", async () => {
    mockedFetchJson.mockResolvedValue({
      result: { results: [row({ en: "Special Eurobarometer 549" })] },
    });
    await expect(eurobarometer.fingerprint()).rejects.toThrow(
      /could not parse/,
    );
  });
});
