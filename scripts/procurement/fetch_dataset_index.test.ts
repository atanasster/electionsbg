// Regression lock for the АОП OCDS dataset walker. АОП switched from one
// dataset per fortnight to one dataset per MONTH with a resource per DAY after
// 2026-06-03, and the walker skipped every monthly dataset as "non-OCDS" for
// four months without an error. The fixtures are real data.egov.bg detail
// pages (trimmed), so a parse that no longer reads them fails here first.

import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UnrecognisedOcdsLabelError,
  fetchBundlesIndex,
  fetchDatasetResources,
  parseDatasetPage,
  parseResourceLabel,
} from "./fetch_dataset_index";
import { entryKind, mergeBundles, selectUningested } from "./bundle_registry";
import type { BundleEntry } from "./types";

const FIX = path.resolve(__dirname, "../../tests/fixtures/procurement/egov");
const fixture = (name: string): string =>
  fs.readFileSync(path.join(FIX, name), "utf8");

const JUNE = "b55dcb49-7d7a-41b0-b1db-4cee4e8ebc4d";
const FORTNIGHT = "082f5f2b-42d1-4ce2-ab94-ddcf214d151e";

describe("parseResourceLabel", () => {
  it("reads the fortnight period", () => {
    expect(
      parseResourceLabel(
        "Автоматично генерирани данни за обявления, публикувани в ЦАИС ЕОП през периода от 21-05-2026 до 03-06-2026, съгласно стандарт OCDS",
      ),
    ).toEqual({
      periodStart: "2026-05-21",
      periodEnd: "2026-06-03",
      kind: "fortnight",
    });
  });

  it("reads a daily resource in BOTH separators АОП uses", () => {
    for (const label of [
      "…публикувани в ЦАИС ЕОП на 30.09.2026 г., съгласно стандарт OCDS",
      "…публикувани в ЦАИС ЕОП на 30-09-2026 г., съгласно стандарт OCDS",
    ])
      expect(parseResourceLabel(label)).toEqual({
        periodStart: "2026-09-30",
        periodEnd: "2026-09-30",
        kind: "daily",
      });
  });

  it("refuses an impossible date rather than inventing a period", () => {
    expect(
      parseResourceLabel("…ЦАИС ЕОП на 31.02.2026 г., съгласно стандарт OCDS"),
    ).toBeNull();
  });

  it("does not read the monthly dataset TITLE as a day", () => {
    expect(
      parseResourceLabel(
        "…публикувани в ЦАИС ЕОП през месец 09.2026 г., съгласно стандарт OCDS",
      ),
    ).toBeNull();
  });
});

describe("parseDatasetPage — monthly dataset (new shape)", () => {
  const page = parseDatasetPage(
    fixture("dataset_monthly_2026_06_rpage1.html"),
    JUNE,
  );

  it("is OCDS and yields EVERY resource on the page, not just the first", () => {
    expect(page.isOcds).toBe(true);
    expect(page.title).toMatch(/през месец 06\.2026/);
    expect(page.entries).toHaveLength(10);
    expect(page.unrecognised).toEqual([]);
  });

  it("gives each daily resource its own one-day period", () => {
    const top = page.entries[0];
    expect(top).toMatchObject({
      datasetUuid: JUNE,
      resourceUuid: "c038c8bb-5aff-4fa0-8437-00bfc8659f95",
      periodStart: "2026-06-30",
      periodEnd: "2026-06-30",
      kind: "daily",
    });
    expect(page.entries.map((e) => e.periodStart)).toEqual(
      [30, 29, 28, 27, 26, 25, 24, 23, 22, 21].map((d) => `2026-06-${d}`),
    );
    expect(new Set(page.entries.map((e) => e.resourceUuid)).size).toBe(10);
  });

  it("reads the resource pager", () => {
    expect(page.nextRpage).toBe(2);
    expect(
      parseDatasetPage(fixture("dataset_monthly_2026_06_rpage3.html"), JUNE)
        .nextRpage,
    ).toBeNull();
  });
});

describe("parseDatasetPage — fortnight dataset (old shape still works)", () => {
  it("yields the one fortnight resource", () => {
    const page = parseDatasetPage(
      fixture("dataset_fortnight_2026_05_21.html"),
      FORTNIGHT,
    );
    expect(page.isOcds).toBe(true);
    expect(page.entries).toEqual([
      expect.objectContaining({
        datasetUuid: FORTNIGHT,
        resourceUuid: "dc1c99f8-c4ca-4def-9072-bdbf5f537ffa",
        periodStart: "2026-05-21",
        periodEnd: "2026-06-03",
        kind: "fortnight",
      }),
    ]);
  });
});

describe("parseDatasetPage — an OCDS label it cannot read is a defect", () => {
  it("reports it as unrecognised instead of dropping the dataset", () => {
    const html = fixture("dataset_monthly_2026_06_rpage1.html").replace(
      "ЕОП на 30.06.2026 г.",
      "ЕОП за седмица 27 на 2026 г.",
    );
    const page = parseDatasetPage(html, JUNE);
    expect(page.isOcds).toBe(true);
    expect(page.entries).toHaveLength(9);
    expect(page.unrecognised).toEqual([
      {
        resourceUuid: "c038c8bb-5aff-4fa0-8437-00bfc8659f95",
        label: expect.stringContaining("за седмица 27"),
      },
    ]);
  });

  it("a non-OCDS dataset is skipped, not reported", () => {
    const page = parseDatasetPage(
      `<h2>Договори и изменения на договори - 2025 (информация от ЦАИС ЕОП)</h2>
       <a href="https://data.egov.bg/data/resourceView/11111111-1111-1111-1111-111111111111">
         <span class="version">&nbsp;&#8211;&nbsp;contracts2025_CE.csv</span></a>`,
      "22222222-2222-2222-2222-222222222222",
    );
    expect(page.isOcds).toBe(false);
    expect(page.entries).toEqual([]);
    expect(page.unrecognised).toEqual([]);
  });
});

// ── network walk, with fetch stubbed to the fixtures ──────────────────────

const LISTING_P1 = `<a href="https://data.egov.bg/data/view/${JUNE}"><h2>x</h2></a>`;
const LISTING_P2 = `<a href="https://data.egov.bg/data/view/${FORTNIGHT}"><h2>x</h2></a>`;

const stubFetch = (routes: Record<string, string>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = routes[url];
      if (body == null) throw new Error(`unstubbed ${url}`);
      return new Response(body, { status: 200 });
    }),
  );

const monthlyRoutes = {
  [`https://data.egov.bg/data/view/${JUNE}`]: fixture(
    "dataset_monthly_2026_06_rpage1.html",
  ),
  [`https://data.egov.bg/data/view/${JUNE}?rpage=2`]: fixture(
    "dataset_monthly_2026_06_rpage2.html",
  ),
  [`https://data.egov.bg/data/view/${JUNE}?rpage=3`]: fixture(
    "dataset_monthly_2026_06_rpage3.html",
  ),
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchDatasetResources", () => {
  it("walks every rpage — the whole month, 04..30 June", async () => {
    stubFetch(monthlyRoutes);
    const ds = await fetchDatasetResources(JUNE, { perPageDelayMs: 0 });
    const days = ds.entries.map((e) => e.periodStart).sort();
    expect(days).toHaveLength(27);
    expect(days[0]).toBe("2026-06-04");
    expect(days.at(-1)).toBe("2026-06-30");
  });
});

describe("fetchBundlesIndex", () => {
  const listing = (p: number) =>
    `https://data.egov.bg/data?org%5B0%5D=502&page=${p}`;

  it("walks past a page of KNOWN datasets and reuses fortnights without refetching", async () => {
    const knownFortnight: BundleEntry = {
      datasetUuid: FORTNIGHT,
      resourceUuid: "dc1c99f8-c4ca-4def-9072-bdbf5f537ffa",
      periodStart: "2026-05-21",
      periodEnd: "2026-06-03",
      label: "…",
    };
    stubFetch({
      ...monthlyRoutes,
      [listing(1)]: LISTING_P1,
      [listing(2)]: LISTING_P2,
      [listing(3)]: "<html></html>",
      // no route for the fortnight detail page: refetching it would throw
    });
    const entries = await fetchBundlesIndex({
      known: [knownFortnight],
      delayMs: 0,
      perDatasetDelayMs: 0,
    });
    expect(entries).toHaveLength(28);
    expect(entries.at(-1)).toEqual(knownFortnight);
  });

  it("FAILS LOUD on an OCDS label it cannot read", async () => {
    stubFetch({
      ...monthlyRoutes,
      [`https://data.egov.bg/data/view/${JUNE}`]: fixture(
        "dataset_monthly_2026_06_rpage1.html",
      ).replace("ЕОП на 30.06.2026 г.", "ЕОП за седмица 27 на 2026 г."),
      [listing(1)]: LISTING_P1,
      [listing(2)]: "<html></html>",
    });
    await expect(
      fetchBundlesIndex({ delayMs: 0, perDatasetDelayMs: 0 }),
    ).rejects.toBeInstanceOf(UnrecognisedOcdsLabelError);
  });
});

// ── registry ───────────────────────────────────────────────────────────────

const day = (d: string, resourceUuid: string, extra = {}): BundleEntry => ({
  datasetUuid: JUNE,
  resourceUuid,
  periodStart: d,
  periodEnd: d,
  kind: "daily",
  label: d,
  ...extra,
});

describe("bundle registry", () => {
  it("keys on resourceUuid, so a known monthly dataset still gains new days", () => {
    const prev = [day("2026-06-29", "r29", { ingestedAt: "T1" })];
    const merged = mergeBundles(prev, [
      day("2026-06-30", "r30"),
      day("2026-06-29", "r29"),
    ]);
    expect(merged.map((e) => [e.resourceUuid, e.ingestedAt])).toEqual([
      ["r30", undefined],
      ["r29", "T1"],
    ]);
  });

  it("a monthly dataset with rows on disk is NOT assumed fully ingested", () => {
    const registry = [
      day("2026-06-29", "r29", { ingestedAt: "T1" }),
      day("2026-06-30", "r30"),
    ];
    const todo = selectUningested(registry, registry, new Set([JUNE]));
    expect(todo.map((e) => e.resourceUuid)).toEqual(["r30"]);
  });

  it("a legacy unstamped fortnight still counts as ingested via the shard scan", () => {
    const legacy: BundleEntry = {
      datasetUuid: FORTNIGHT,
      resourceUuid: "dc1c",
      periodStart: "2026-05-21",
      periodEnd: "2026-06-03",
      label: "…",
    };
    expect(entryKind(legacy)).toBe("fortnight");
    expect(selectUningested([legacy], [legacy], new Set([FORTNIGHT]))).toEqual(
      [],
    );
    expect(selectUningested([legacy], [legacy], new Set())).toEqual([legacy]);
  });
});
