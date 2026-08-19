// The gate over the /data DataCatalog — offline, no database, no network.
//
// WHY: `CATALOG_SPECS` turns each entry's `dist` into a `DataDownload.contentUrl`
// against the GCS bucket, and until 2026-08-19 two of eleven advertised files
// bucket:sync refuses to upload. `procurement/index.json` had never been uploaded
// and 404'd — loud. `funds/index.json` had been, once, before `^funds/.*` joined
// bucket:sync's -x regex, so it answered 200 with a 2026-06-28 vintage against a
// local file seven weeks newer, and could never self-heal: an -x match is excluded
// from DELETION as well as upload, and scripts/funds/ has no upload path at all.
//
// The silent one is the reason this file exists. Nothing went red for seven weeks,
// and both were found by a human reading isExcluded() rather than by any check.
import { describe, expect, it } from "vitest";
import { isExcluded } from "../bucket_sync_paths";
import { buildDataCatalog, CATALOG_SPECS, SITE_URL } from "./routes";

type Dataset = Record<string, unknown>;
const datasetsOf = (lang: "bg" | "en"): Dataset[] =>
  (buildDataCatalog(lang) as { dataset: Dataset[] }).dataset;

describe("CATALOG_SPECS", () => {
  // Non-vacuity. Every assertion below that iterates `dist` passes trivially on a
  // catalog where nobody declares one, so the suite would go green precisely by
  // losing the thing it guards.
  it("still declares downloads to check", () => {
    const withDist = CATALOG_SPECS.filter((s) => s.dist);
    expect(withDist.length).toBeGreaterThan(0);
    expect(CATALOG_SPECS.length).toBeGreaterThan(withDist.length); // ...and PG-served ones
  });

  it("never advertises a download bucket:sync refuses to upload", () => {
    // Read `s.dist` dynamically rather than compare against a literal list: the
    // elections entry's dist is built from LATEST_ELECTION and moves every cycle.
    const refused = CATALOG_SPECS.flatMap((s) => {
      if (!s.dist) return [];
      const reason = isExcluded(s.dist.replace(/^\//, ""));
      return reason ? [`${s.page || "<home>"} → ${s.dist} (${reason})`] : [];
    });
    expect(refused, "dist paths bucket:sync refuses to upload").toEqual([]);
  });

  it("pairs `dist` with a `distName` in both languages, or omits all three", () => {
    // The union in routes.ts makes this a compile error, so this arm guards the
    // data rather than the type — a cast or a JSON-sourced spec would slip past tsc.
    for (const s of CATALOG_SPECS) {
      for (const lang of ["bg", "en"] as const) {
        expect(
          Boolean(s[lang].distName),
          `${s.page || "<home>"}/${lang}: distName must be present iff dist is`,
        ).toBe(Boolean(s.dist));
      }
    }
  });
});

describe("buildDataCatalog", () => {
  it("emits no `distribution` key for the PG-served corpora", () => {
    for (const page of ["funds", "procurement"]) {
      const ds = datasetsOf("bg").find((d) =>
        String(d.url).endsWith(`/${page}`),
      );
      expect(ds, `${page} dataset missing from the catalog`).toBeTruthy();
      expect("distribution" in ds!, `${page} must advertise no download`).toBe(
        false,
      );
      // ...and it is still a complete Dataset, not a stub: dropping the download
      // must not cost the entry its listing.
      expect(ds).toMatchObject({
        "@type": "Dataset",
        isAccessibleForFree: true,
      });
      expect(ds!.license).toBeTruthy();
      expect(ds!.description).toBeTruthy();
    }
  });

  it("names no URL that redirects", () => {
    // `/en/` 301s to `/en`; the bare BG root is the one path that keeps its slash.
    for (const lang of ["bg", "en"] as const) {
      for (const d of datasetsOf(lang)) {
        if (lang === "bg" && d.url === `${SITE_URL}/`) continue;
        expect(String(d.url), "dataset url must not end in /").not.toMatch(
          /\/$/,
        );
      }
      expect(
        datasetsOf(lang).map((d) => String(d.url)),
        "the EN root is /en, never /en/",
      ).not.toContain(`${SITE_URL}/en/`);
    }
  });

  it("keeps every description inside Google's 50-5000 char window", () => {
    // buildDatasetLd throws outside it; catch that at unit speed rather than at
    // minute ~10 of a vite build.
    expect(() => buildDataCatalog("bg")).not.toThrow();
    expect(() => buildDataCatalog("en")).not.toThrow();
  });
});
