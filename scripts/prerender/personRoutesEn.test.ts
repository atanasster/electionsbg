// Every /en person-shaped mirror must be English all the way through its <title>.
//
// They were not, until 2026-08-10: the office label was translated and both proper nouns were
// left in Cyrillic — "Иван Георгиев Такучев — Chief architect in Ивайловград". That is not a
// cosmetic complaint. The /en <title> then carried the IDENTICAL Cyrillic name string as its
// /bg twin, so the two mirrors competed for one Bulgarian query across every sitemap'd URL
// pair, and Google answered „Иван Георгиев Такучев" with the English page.
//
// The gate covers BOTH families, because the candidate routes shipped the same defect on a
// larger set (25,024 of 26,386 titles) and a rule enforced on one family only is a rule that
// gets re-broken on the other.
//
// Runs over the real manifest and the real election folders, so a new place code, role or card
// kind cannot reintroduce a Cyrillic /en title without failing here.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildCandidateRoutes, buildPersonRoutes } from "./dynamicRoutes";
import { transliterateName } from "@/data/candidates/transliterateName";

const ROOT = path.resolve(__dirname, "../..");
const CYRILLIC = /[Ѐ-ӿ]/;

// data/person/prerender_slugs.json is tracked in git, so an absent one is a broken checkout
// rather than a fresh clone — the same position load_place_dim_pg.ts takes on the place files.
// A `skipIf` here would drop the entire regression barrier for this change at exit 0, which
// reads exactly like a covered run.
const MANIFEST = path.join(ROOT, "data/person/prerender_slugs.json");
type Card = { name: string; kind: string };
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8")) as Array<{
  slug: string;
  prerender?: boolean;
  card?: Card;
}>;
const cardBySlug = new Map(
  manifest.filter((e) => e.card).map((e) => [`person/${e.slug}`, e.card!]),
);

const routes = buildPersonRoutes(ROOT);
const h1 = (html: string) => /<h1>([^<]*)<\/h1>/.exec(html)?.[1] ?? "";

describe("buildPersonRoutes — the /en half", () => {
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
    const bad = routes
      .filter((r) => CYRILLIC.test(h1(r.english?.bodyHtml ?? "")))
      .map((r) => `${r.path}: ${h1(r.english?.bodyHtml ?? "")}`);
    expect(bad).toEqual([]);
  });

  // The commit's own justification for touching PersonHeader was that the /en page
  // "prerendered Latin and hydrated Cyrillic". Both sides now call transliterateName, but they
  // live in different packages with different test environments, so nothing but this asserts
  // they agree — and the mismatch class is the one the change exists to close. PersonHeader
  // renders nameForBg(p.name) === transliterateName(p.name) on /en whenever there is no
  // curated parliament.bg name_en, which is every person in this manifest.
  it("prerenders the same English H1 the client hydrates", () => {
    const mismatches = routes
      .map((r) => ({ r, card: cardBySlug.get(r.path) }))
      .filter(
        ({ r, card }) =>
          card &&
          h1(r.english?.bodyHtml ?? "") !== transliterateName(card.name),
      )
      .map(
        ({ r, card }) =>
          `${r.path}: ${h1(r.english!.bodyHtml!)} vs ${transliterateName(card!.name)}`,
      );
    expect(mismatches).toEqual([]);
  });

  // The English page still has to let a reader who arrived from a Bulgarian source confirm
  // it is the same person — the transliteration is a spelling, not an identity claim, and
  // dropping the original would make the two mirrors impossible to match by eye. `lang="bg"`
  // is what stops a screen reader pronouncing it with English phonemes.
  it("keeps the Bulgarian name in the English body as an explicit tagged alias", () => {
    const missing = routes
      .filter(
        (r) =>
          !/<p><small>Bulgarian name: <span lang="bg">[^<]*<\/span><\/small><\/p>/.test(
            r.english?.bodyHtml ?? "",
          ),
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

  const isOfficial = (t: string | undefined) =>
    /declared assets \| electionsbg\.com$/.test(t ?? "");

  // The local branch is the half where "fully English" is actually achievable — it has no
  // untranslatable field — so its description is pinned too. Unpinned, a future card field
  // interpolated into descriptionEn would put Cyrillic into 19.5k meta descriptions with every
  // other assertion here still green.
  it("carries no Cyrillic in a local card's English description", () => {
    const local = routes.filter((r) => !isOfficial(r.english?.title));
    expect(local.length).toBeGreaterThan(19_000);
    expect(
      local
        .filter((r) => CYRILLIC.test(r.english?.description ?? ""))
        .map((r) => r.path),
    ).toEqual([]);
  });

  // Officials keep a Bulgarian institution and position title — 785 institutions and 140
  // position titles with no English source, where transliteration ("Ministerstvo na
  // otbranata") would be strictly worse than the original.
  //
  // The exemption reaches the meta DESCRIPTION as well as the body, and that is asserted here
  // rather than left to a comment: the first version of this test was named "confines the
  // untranslated institution names to the body" and checked only the title, so it passed while
  // 5,651 /en descriptions carried Cyrillic — a test green under a name it did not hold, which
  // is the exact failure mode the assertion was added to prevent.
  it("keeps the untranslated institution out of the title, but deliberately not the description", () => {
    const officials = routes.filter((r) => isOfficial(r.english?.title));
    expect(officials.length).toBeGreaterThan(1_000);
    expect(officials.every((r) => !CYRILLIC.test(r.english?.title ?? ""))).toBe(
      true,
    );
    expect(
      officials.filter((r) => CYRILLIC.test(r.english?.description ?? ""))
        .length,
    ).toBeGreaterThan(5_000);
    // Wherever it does ship, it is tagged, so the exemption is legible to a screen reader and
    // to a crawler rather than looking like an untranslated string.
    const untagged = officials
      .filter((r) => CYRILLIC.test(r.english?.bodyHtml ?? ""))
      .filter((r) => {
        const stripped = (r.english?.bodyHtml ?? "").replace(
          /<span lang="bg">[^<]*<\/span>/g,
          "",
        );
        return CYRILLIC.test(stripped);
      })
      .map((r) => r.path);
    expect(untagged).toEqual([]);
  });
});

describe("buildCandidateRoutes — the /en half", () => {
  const regions = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/data/json/regions.json"), "utf-8"),
  ) as Array<{
    oblast: string;
    name: string;
    name_en?: string;
    long_name?: string;
    long_name_en?: string;
  }>;
  const bg = new Map(regions.map((r) => [r.oblast, r.long_name || r.name]));
  const en = new Map(
    regions.map((r) => [r.oblast, r.long_name_en || r.name_en || r.name]),
  );
  const candidateRoutes = buildCandidateRoutes(path.join(ROOT, "data"), bg, en);

  // mpByName covers MPs only, so before 2026-08-10 every non-MP candidate fell back to the
  // raw Cyrillic name: 25,024 of 26,386 English titles, roughly twice the person family.
  it("carries no Cyrillic in any English title", () => {
    expect(candidateRoutes.length).toBeGreaterThan(20_000);
    const bad = candidateRoutes
      .filter((r) => CYRILLIC.test(r.english?.title ?? ""))
      .map((r) => `${r.path}: ${r.english?.title}`);
    expect(bad).toEqual([]);
  });

  it("keeps the Bulgarian name reachable as a tagged alias", () => {
    const withAlias = candidateRoutes.filter((r) =>
      /<span lang="bg">/.test(r.english?.bodyHtml ?? ""),
    );
    expect(withAlias.length).toBeGreaterThan(20_000);
  });
});
