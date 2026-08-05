// The crawler-facing half of the education place card.
//
// Two things make this worth its own gate. The static body is minted from the
// COMMITTED schools index, so it must build on a checkout with no database —
// and degrade to today's body, not to a half-written section, when that index
// is missing. And every URL it emits is the no-slash form the whole repo
// commits to; a `/school/{id}/` here would be 279 region pages linking through
// a 301 on both languages.

import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import {
  educationBodyFor,
  readEducationPlaces,
  readMuniNamesEn,
} from "./educationPlaces";
import { buildGovernanceRegionBody } from "./bodyBuilders";
import type { RegionInfo } from "@/data/dataTypes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const smolyan = {
  oblast: "SML",
  name: "Смолян",
  name_en: "Smolyan",
  long_name: "Смолян",
  long_name_en: "Smolyan",
} as unknown as RegionInfo;

const places = readEducationPlaces(ROOT);
const namesEn = readMuniNamesEn(ROOT);
const bodyFor = (code: string) => educationBodyFor(places, namesEn, code);

describe("readEducationPlaces", () => {
  it("reads the committed index, with no database in sight", () => {
    expect(places.size).toBeGreaterThan(28);
    const sml = places.get("SML");
    expect(sml?.grain).toBe("region");
    expect(sml?.avg).toBeGreaterThan(2);
    expect(sml?.avg).toBeLessThanOrEqual(6);
    expect(sml?.examinees).toBeGreaterThan(0);
  });

  it("keys Sofia city as S23, the way the corpus does", () => {
    // МОН publishes Столична община as one aggregate; there is no SOF oblast.
    expect(places.get("S23")?.schools).toBeGreaterThan(0);
    expect(places.get("SOF")).toBeUndefined();
  });

  it("states no residual, since the regression is the loader's", () => {
    // A static body may quote the level and the spread; the context-adjusted
    // reading needs a fit this side never runs.
    for (const blob of places.values()) {
      expect(blob.above).toEqual([]);
      expect(blob.meanResidual).toBeNull();
    }
  });

  it("returns nothing rather than half a section without the index", () => {
    expect(readEducationPlaces("/nonexistent-checkout").size).toBe(0);
  });
});

describe("buildGovernanceRegionBody with education", () => {
  const body = buildGovernanceRegionBody(
    smolyan,
    [{ obshtina: "SML10", name: "Смолян", name_en: "Smolyan" }],
    "bg",
    bodyFor("SML"),
  );

  it("names the year, the average and the cohort", () => {
    expect(body).toMatch(/<h2>Матура в област Смолян<\/h2>/);
    expect(body).toMatch(/зрелостни/);
    expect(body).toMatch(/\d,\d\d/);
  });

  it("carries the same methodology caveat the page does", () => {
    // Otherwise the indexed text and the rendered page state two different
    // averages with no explanation of why.
    expect(body).toMatch(/2,00/);
  });

  it("emits only no-slash URLs", () => {
    const urls = [...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).not.toMatch(/\/$/);
    expect(urls.some((u) => u.includes("/school/"))).toBe(true);
    expect(urls.some((u) => u.includes("/governance/SML"))).toBe(true);
  });

  it("degrades to the body it had before when the place has no blob", () => {
    const without = buildGovernanceRegionBody(
      smolyan,
      [{ obshtina: "SML10", name: "Смолян", name_en: "Smolyan" }],
      "bg",
      undefined,
    );
    expect(without).not.toMatch(/<h2>Матура/);
    expect(without).toMatch(/<h1>Управление — област Смолян<\/h1>/);
    expect(without).toMatch(/Общини в област Смолян/);
  });

  it("writes the English body in English, names included", () => {
    const en = buildGovernanceRegionBody(
      smolyan,
      [{ obshtina: "SML10", name: "Смолян", name_en: "Smolyan" }],
      "en",
      bodyFor("SML"),
    );
    expect(en).toMatch(/<h2>Matura in Smolyan province<\/h2>/);
    expect(en).toMatch(/graduates/);
    // Municipality names too — the list below this section prints them in
    // English, and two spellings of the same place in one document is worse
    // than either.
    expect(en).toMatch(/Smolyan/);
    expect(en).not.toMatch(/<li><a[^>]*>Неделино</);
  });

  it("only /en-prefixes links whose target has an EN mirror", () => {
    // /en/school/:id is prerendered; /en/governance/:obshtina is NOT — it would
    // serve the EN homepage shell on 242 links across 27 pages.
    const en = buildGovernanceRegionBody(
      smolyan,
      [{ obshtina: "SML10", name: "Смолян", name_en: "Smolyan" }],
      "en",
      bodyFor("SML"),
    );
    const urls = [...en.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(urls.some((u) => u.includes("/en/school/"))).toBe(true);
    expect(urls.filter((u) => u.includes("/en/governance/"))).toEqual([]);
    for (const u of urls) expect(u).not.toMatch(/\/$/);
  });

  it("discloses whose numbers a Sofia МИР page is showing", () => {
    // The live tile says it; the static body has to say the same thing, or the
    // indexed text states Столична община's average as МИР-23's.
    for (const mir of ["S23", "S24", "S25"]) {
      const body = buildGovernanceRegionBody(
        { ...smolyan, oblast: mir, name: `София ${mir}` } as RegionInfo,
        [],
        "bg",
        bodyFor(mir),
      );
      expect(body).toMatch(/Столична община общо/);
    }
  });

  it("gives the Plovdiv city constituency the province's numbers, and says so", () => {
    const body = buildGovernanceRegionBody(
      { ...smolyan, oblast: "PDV-00", name: "Пловдив" } as RegionInfo,
      [],
      "bg",
      bodyFor("PDV-00"),
    );
    expect(body).toMatch(/област Пловдив общо/);
  });

  it("has no education section for a place the corpus doesn't cover", () => {
    // МИР 32 (abroad) — no schools, so no section and no promise of one.
    expect(bodyFor("32")).toBeUndefined();
  });

  it("links only schools the prerender actually writes a page for", () => {
    // Third emitter of /school/:id after buildSchoolRoutes and the sitemap.
    const ids = [...body.matchAll(/\/school\/([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
  });
});

describe("the two rules the loader and the prerender share", () => {
  it("keys Sofia's município to the МИР the corpus uses, not to a SOF oblast", async () => {
    const { oblastOfObshtina, latestYearOf, dziSeriesOf } = await import(
      "../db/lib/school_places"
    );
    expect(oblastOfObshtina("SOF00")).toBe("S23");
    expect(oblastOfObshtina("SML10")).toBe("SML");

    // A year counts only when the index has BOTH a score and a cohort.
    const series = dziSeriesOf(
      { "2022": { dzi_bel: 4.1 }, "2026": { dzi_bel: 4.5 } },
      { "2022": { dzi_bel: 18 } },
    );
    expect(series).toEqual([
      { year: 2022, score: 4.1, n: 18 },
      { year: 2026, score: 4.5 },
    ]);

    // The declared year wins; the fallback ignores an uncounted year, so both
    // sides land on the same headline year.
    expect(latestYearOf(2026, [])).toBe(2026);
    expect(latestYearOf(null, [{ series }])).toBe(2022);
    expect(latestYearOf(undefined, [])).toBeNull();
  });
});
