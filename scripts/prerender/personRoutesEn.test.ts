// The /en person mirrors must be English all the way through their <title>.
//
// They were not, until 2026-08-10: the office label was translated and both proper nouns were
// left in Cyrillic — "Иван Георгиев Такучев — Chief architect in Ивайловград". That is not a
// cosmetic complaint. The /en <title> then carried the IDENTICAL Cyrillic name string as its
// /bg twin, so the two mirrors competed for one Bulgarian query across 25,167 sitemap'd URL
// pairs, and Google answered „Иван Георгиев Такучев" with the English page.
//
// Runs over the real manifest, so a new place code, a new role or a new card kind cannot
// reintroduce a Cyrillic /en title without failing here.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildPersonRoutes } from "./dynamicRoutes";

const ROOT = path.resolve(__dirname, "../..");
const CYRILLIC = /[Ѐ-ӿ]/;
const hasManifest = fs.existsSync(
  path.join(ROOT, "data/person/prerender_slugs.json"),
);

describe.skipIf(!hasManifest)("buildPersonRoutes — the /en half", () => {
  const routes = buildPersonRoutes(ROOT);

  it("emits a route for every prerendered person", () => {
    expect(routes.length).toBeGreaterThan(20_000);
    expect(routes.every((r) => r.english?.title)).toBe(true);
  });

  it("carries no Cyrillic in any English title", () => {
    const bad = routes
      .filter((r) => CYRILLIC.test(r.english?.title ?? ""))
      .map((r) => `${r.path}: ${r.english?.title}`);
    expect(bad).toEqual([]);
  });

  it("carries no Cyrillic in the English <h1>", () => {
    const h1 = (html: string) => /<h1>([^<]*)<\/h1>/.exec(html)?.[1] ?? "";
    const bad = routes
      .filter((r) => CYRILLIC.test(h1(r.english?.bodyHtml ?? "")))
      .map((r) => `${r.path}: ${h1(r.english?.bodyHtml ?? "")}`);
    expect(bad).toEqual([]);
  });

  // The English page still has to let a reader who arrived from a Bulgarian source confirm
  // it is the same person — the transliteration is a spelling, not an identity claim, and
  // dropping the original would make the two mirrors impossible to match by eye.
  it("keeps the Bulgarian name in the English body as an explicit alias", () => {
    const missing = routes
      .filter(
        (r) => !/<p>Bulgarian name: [^<]*<\/p>/.test(r.english?.bodyHtml ?? ""),
      )
      .map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("leaves the Bulgarian half Bulgarian", () => {
    const sample = routes.find(
      (r) => r.path === "person/ivan-georgiev-takuchev-c39f00",
    );
    expect(sample?.title).toBe(
      "Иван Георгиев Такучев — Главен архитект в Ивайловград | electionsbg.com",
    );
    expect(sample?.english?.title).toBe(
      "Ivan Georgiev Takuchev — Chief architect in Ivaylovgrad | electionsbg.com",
    );
  });

  // Officials keep a Bulgarian institution and position title in the English BODY — 785
  // institutions and 140 position titles with no English source, where transliteration
  // ("Ministerstvo na otbranata") would be strictly worse than the original. Asserted rather
  // than left implicit so the exemption stays a decision and stays confined to the body.
  it("confines the untranslated institution names to the body", () => {
    const officials = routes.filter((r) =>
      /declared assets \| electionsbg\.com$/.test(r.english?.title ?? ""),
    );
    expect(officials.length).toBeGreaterThan(1_000);
    expect(
      officials.some((r) => CYRILLIC.test(r.english?.bodyHtml ?? "")),
    ).toBe(true);
    expect(officials.every((r) => !CYRILLIC.test(r.english?.title ?? ""))).toBe(
      true,
    );
  });
});
