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
//
// ⚠️ WHAT THIS DOES NOT COVER: `isExcluded` is a pure string predicate over
// bucket:sync's -x rule set — it never stats the filesystem, deliberately, so that
// the two gitignored dists (2026_04_19/cik_parties.json, 2023_10_29_mi/index.json)
// cannot fail the gate on a fresh clone, and a gate that fails on a fresh clone
// gets deleted. A `dist` that is merely MISSING from data/ — a typo, a rename, a
// retired artifact — is therefore invisible here and 404s exactly like
// procurement/index.json did. Closing that later without losing the fresh-clone
// property means asserting existence only for dists whose file is git-tracked.
import { describe, expect, it } from "vitest";
import { isExcluded } from "../bucket_sync_paths";
import { buildDataCatalog, CATALOG_SPECS, EN_HOME, SITE_URL } from "./routes";

type Dataset = Record<string, unknown>;
const datasetsOf = (lang: "bg" | "en"): Dataset[] =>
  (buildDataCatalog(lang) as { dataset: Dataset[] }).dataset;

// Re-derived from the URL contract in CLAUDE.md rather than imported from
// routes.ts: a gate that asks the implementation what it emits and then checks
// the answer against itself proves nothing.
const expectedUrl = (lang: "bg" | "en", page: string) =>
  page === ""
    ? lang === "en"
      ? `${SITE_URL}/en`
      : `${SITE_URL}/`
    : `${SITE_URL}/${lang === "en" ? "en/" : ""}${page}`;

describe("CATALOG_SPECS", () => {
  // Non-vacuity: every `dist`-iterating assertion below goes green precisely by
  // losing the thing it guards. Deliberately asserts only that downloads exist —
  // NOT that some entry lacks one. A catalog where every corpus has gained a
  // genuinely bucket-served artifact is a correct future state, not a regression.
  it("still declares downloads to check", () => {
    expect(CATALOG_SPECS.filter((s) => s.dist).length).toBeGreaterThan(0);
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
  it("emits one dataset per spec, in order", () => {
    // The per-index lookups below rest on this, and `.map` order is the only
    // thing that makes a spec and a dataset the same row.
    for (const lang of ["bg", "en"] as const) {
      const ds = datasetsOf(lang);
      expect(ds.length).toBe(CATALOG_SPECS.length);
      ds.forEach((d, i) =>
        expect(d.url).toBe(expectedUrl(lang, CATALOG_SPECS[i].page)),
      );
    }
  });

  it("emits no `distribution` key for the PG-served corpora", () => {
    for (const page of ["funds", "procurement"]) {
      const specs = CATALOG_SPECS.filter((s) => s.page === page);
      // A duplicate `page` is legal — the two `parliament` entries are one — so
      // every match is checked. A `find` here silently inspects only the first,
      // and a second `procurement` entry carrying a dist would pass unnoticed.
      expect(specs.length, `no CATALOG_SPECS entry for ${page}`).toBe(1);
      for (const s of specs)
        expect(
          s.dist,
          `${page} is served from Cloud SQL — if this corpus has genuinely ` +
            `gained a bucket-served artifact, add it to the allowlist in ` +
            `isExcluded() and change this test deliberately`,
        ).toBeUndefined();

      // Exact URL, never endsWith: `.../sector/procurement` would shadow it.
      const hits = datasetsOf("bg").filter(
        (d) => d.url === expectedUrl("bg", page),
      );
      expect(hits.length).toBe(specs.length);
      for (const d of hits) {
        expect("distribution" in d, `${page} must advertise no download`).toBe(
          false,
        );
        // ...and it is still a complete Dataset, not a stub: dropping the
        // download must not cost the entry its listing.
        expect(d).toMatchObject({
          "@type": "Dataset",
          isAccessibleForFree: true,
        });
        expect(d.license).toBeTruthy();
        expect(d.description).toBeTruthy();
      }
    }
  });

  it("gets both root inversions right", () => {
    // The bare BG root is the ONE path that keeps its slash; the EN root is /en,
    // never /en/ (hosting 301s it). See EN_HOME's header. The trailing-slash net
    // below cannot see either: it would pass on a BG root that dropped its slash
    // and on an EN root of /en/data.
    const i = CATALOG_SPECS.findIndex((s) => s.page === "");
    expect(i, "no home entry in CATALOG_SPECS").toBeGreaterThanOrEqual(0);
    expect(datasetsOf("bg")[i].url).toBe(`${SITE_URL}/`);
    expect(datasetsOf("en")[i].url).toBe(EN_HOME);
  });

  it("names no URL that redirects", () => {
    for (const lang of ["bg", "en"] as const)
      for (const d of datasetsOf(lang)) {
        if (lang === "bg" && d.url === `${SITE_URL}/`) continue;
        expect(String(d.url), "dataset url must not end in /").not.toMatch(
          /\/$/,
        );
      }
  });

  it("keeps every description inside Google's 50-5000 char window", () => {
    // Asserts the PROPERTY, not that buildDatasetLd still throws on it — that
    // throw is one line, and softening it to a warn (the degrade style used
    // everywhere else here) would otherwise leave this passing silently.
    for (const lang of ["bg", "en"] as const)
      for (const d of datasetsOf(lang)) {
        const len = String(d.description).length;
        expect(
          len,
          `${lang} "${String(d.name)}" description is ${len} chars`,
        ).toBeGreaterThanOrEqual(50);
        expect(len).toBeLessThanOrEqual(5000);
      }
  });
});
