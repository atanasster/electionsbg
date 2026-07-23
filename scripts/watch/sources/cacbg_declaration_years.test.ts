// Unit tests for the two cacbg declaration-slice watch sources, which resolve
// their declaration year from the register root instead of a pinned constant.
// No network: fetchText is mocked; sha256Short stays real so the fingerprint
// equality semantics are exercised for real. Runs in the `node` Vitest project.

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("../fingerprint", async (importActual) => {
  const actual = await importActual<typeof import("../fingerprint")>();
  return { ...actual, fetchText: vi.fn() };
});

import { fetchText } from "../fingerprint";
import { __resetRegisterYearCache } from "../../lib/cacbg_register";
import { cacbgOfficials } from "./cacbg_officials";
import { cacbgLocal } from "./cacbg_local";
import type { WatchState } from "../types";

const mockedFetchText = vi.mocked(fetchText);

const rootHtml = (years: number[]): string =>
  years.map((y) => `<a href="${y}/index.html">За ${y} година</a>`).join("");

// list.xml in the real nesting: Category > Institution > Person > Position >
// Declaration, with the Sent flag the ingest filters on. One person per file.
const listXml = (categories: { name: string; files: string[] }[]): string =>
  categories
    .map(
      (c) =>
        `<Category Name="${c.name}"><Institution Name="Институция">` +
        c.files
          .map(
            (f) =>
              `<Person><Name>Лице ${f}</Name><Position><Name>роля</Name>` +
              `<Declaration><Sent>True</Sent><xmlFile>${f}</xmlFile></Declaration>` +
              `</Position></Person>`,
          )
          .join("") +
        `</Institution></Category>`,
    )
    .join("");

const EXEC_CATEGORY = "Министър-председател, министри и заместник-министри";
const LOCAL_CATEGORY =
  "Кметове, и зам.-кметове на общини, общинските съветници";

// Wire the mock so the root resolves to `years` and every /<year>/list.xml
// resolves to `xml`.
const wire = (years: number[], xml: string): void => {
  mockedFetchText.mockImplementation(async (url: string) =>
    url.endsWith("/list.xml") ? xml : rootHtml(years),
  );
};

const state = (
  fingerprint: string,
  meta: Record<string, unknown>,
): WatchState => ({
  fingerprint,
  detail: "",
  meta,
  lastChecked: "2026-05-22T06:25:14.640Z",
  lastChanged: "2026-05-22T06:25:14.640Z",
});

beforeEach(() => {
  mockedFetchText.mockReset();
  __resetRegisterYearCache();
});

describe("cacbgOfficials.fingerprint", () => {
  it("probes the newest year advertised by the root, not a pinned one", async () => {
    wire(
      [2024, 2025, 2026],
      listXml([{ name: EXEC_CATEGORY, files: ["a.xml"] }]),
    );
    const fp = await cacbgOfficials.fingerprint();
    expect(fp.meta?.year).toBe(2026);
    expect(mockedFetchText).toHaveBeenCalledWith(
      "https://register.cacbg.bg/2026/list.xml",
      { insecureTls: true },
    );
    expect(fp.detail).toContain("for 2026");
  });

  it("counts only declarations under an in-scope category", async () => {
    wire(
      [2025],
      listXml([
        { name: EXEC_CATEGORY, files: ["a.xml", "b.xml"] },
        { name: "Съдии, прокурори и следователи", files: ["c.xml"] },
      ]),
    );
    const fp = await cacbgOfficials.fingerprint();
    expect(fp.meta?.count).toBe(2);
  });

  it("is order-independent — shuffled upstream emission hashes the same", async () => {
    wire([2025], listXml([{ name: EXEC_CATEGORY, files: ["a.xml", "b.xml"] }]));
    const first = await cacbgOfficials.fingerprint();
    __resetRegisterYearCache();
    wire([2025], listXml([{ name: EXEC_CATEGORY, files: ["b.xml", "a.xml"] }]));
    const second = await cacbgOfficials.fingerprint();
    expect(second.value).toBe(first.value);
  });

  it("throws when the in-scope categories yield nothing", async () => {
    wire([2025], listXml([{ name: "Съдии, прокурори", files: ["c.xml"] }]));
    await expect(cacbgOfficials.fingerprint()).rejects.toThrow(
      /zero declaration xmlFile entries/,
    );
  });
});

describe("cacbgLocal.fingerprint", () => {
  it("probes the newest year and isolates the municipal category", async () => {
    wire(
      [2025, 2026],
      listXml([
        { name: LOCAL_CATEGORY, files: ["m1.xml", "m2.xml", "m3.xml"] },
        { name: EXEC_CATEGORY, files: ["e1.xml"] },
      ]),
    );
    const fp = await cacbgLocal.fingerprint();
    expect(fp.meta).toMatchObject({ year: 2026, count: 3 });
  });
});

describe("describe() on a year rollover", () => {
  it("reports the new cycle instead of a cross-year count delta", async () => {
    wire([2025, 2026], listXml([{ name: EXEC_CATEGORY, files: ["a.xml"] }]));
    const curr = await cacbgOfficials.fingerprint();
    const line = cacbgOfficials.describe!(
      state("old-hash", { count: 489, year: 2025 }),
      curr,
    );
    expect(line).toContain("new declaration year 2025 → 2026");
    // The misleading "-488 declarations" delta must not appear.
    expect(line).not.toContain("-488");
  });

  it("still reports a plain count delta within the same year", async () => {
    wire([2025], listXml([{ name: EXEC_CATEGORY, files: ["a.xml", "b.xml"] }]));
    const curr = await cacbgOfficials.fingerprint();
    const line = cacbgOfficials.describe!(
      state("old-hash", { count: 1, year: 2025 }),
      curr,
    );
    expect(line).toBe("+1 declarations in scope (1 → 2)");
  });

  it("municipal rollover points at the municipal ingest leg", async () => {
    wire([2025, 2026], listXml([{ name: LOCAL_CATEGORY, files: ["m1.xml"] }]));
    const curr = await cacbgLocal.fingerprint();
    const line = cacbgLocal.describe!(
      state("old-hash", { count: 6671, year: 2025 }),
      curr,
    );
    expect(line).toContain("new declaration year 2025 → 2026");
    expect(line).toContain("municipal.ts");
  });
});
