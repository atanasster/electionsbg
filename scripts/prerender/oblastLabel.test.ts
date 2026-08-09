import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import type { RegionInfo } from "@/data/dataTypes";
import {
  buildGovernancePlaceBody,
  buildGovernanceRegionBody,
  buildOblastBody,
  buildSectionBody,
  buildSectionsListBody,
  buildSettlementBody,
} from "./bodyBuilders";

// Prerendered HTML is what the crawler indexes and what GA reports as the page
// title, so a doubled tier word here is the version the outside world sees. Six
// of the 31 regions hold a name that already carries its tier — PDV ("обл.
// Пловдив", to tell the province from the PDV-00 city МИР), SFO ("София
// област"), S23/S24/S25 ("София N МИР") and 32 ("Извън страната") — and on the
// 2026-08-08 build ~1.2k pages named one of them with a tier word of their own.
const PROBLEM_REGIONS: RegionInfo[] = [
  { oblast: "PDV", name: "обл. Пловдив", name_en: "prov. Plovdiv" },
  { oblast: "SFO", name: "София област", name_en: "Sofia region" },
  { oblast: "S23", name: "София 23 МИР", name_en: "Sofia 23 MMR" },
  { oblast: "32", name: "Извън страната", name_en: "Abroad" },
  // The control: a plain name, which must still GET its tier word.
  { oblast: "BLG", name: "Благоевград", name_en: "Blagoevgrad" },
] as RegionInfo[];

const DOUBLED = [
  /обл\.\s*обл\./i,
  /област\s+обл\./i,
  /обл\.\s+София област/i,
  /Област\s+София област/i,
  /обл\.\s+София \d+ МИР/i,
  /Област\s+София \d+ МИР/i,
  /обл\.\s+Извън страната/i,
  /Област\s+Извън страната/i,
  /(prov\.|province)\s+\S*\s*(prov\.|province)/i,
  /(region|MMR|Abroad)\s+province/i,
];

const expectClean = (label: string, html: string) => {
  for (const bad of DOUBLED)
    expect(html, `${label} matched ${bad}`).not.toMatch(bad);
};

describe("prerendered place bodies never double a region's tier word", () => {
  for (const r of PROBLEM_REGIONS) {
    const oblastName = r.name;
    it(`${r.oblast} (${oblastName})`, () => {
      expectClean(
        `section/${r.oblast}`,
        buildSectionBody({
          section: "162200001",
          settlement: "гр. Карлово",
          oblastName,
          oblastCode: r.oblast,
          ekatte: "36498",
        }),
      );
      expectClean(
        `settlement/${r.oblast}`,
        buildSettlementBody({
          ekatte: "36498",
          settlement: "гр. Карлово",
          oblastName,
          oblastCode: r.oblast,
        }),
      );
      expectClean(
        `governance/${r.oblast}`,
        buildGovernancePlaceBody({
          ekatte: "36498",
          settlement: "гр. Карлово",
          oblastName,
          oblastCode: r.oblast,
        }),
      );
      expectClean(
        `sections/${r.oblast}`,
        buildSectionsListBody({
          ekatte: "36498",
          displayName: "гр. Карлово",
          oblastName,
          oblastCode: r.oblast,
          isDiaspora: false,
          electionDateLabel: "19.04.2026",
          sections: [{ section: "162200001", address: "ул. Тест 1" }],
        }),
      );
      expectClean(`municipality/${r.oblast}`, buildOblastBody(r));
      for (const lang of ["bg", "en"] as const)
        expectClean(
          `governance/region/${r.oblast} (${lang})`,
          buildGovernanceRegionBody(r, [], lang),
        );
    });
  }

  // The province PDV and the градски МИР PDV-00 both hold the name "Пловдив"
  // once the province's "обл." prefix is stripped, and both get a prerendered
  // /municipality page — so the labels have to keep them apart or two pages
  // declare one <title>.
  it("keeps the Пловдив province and the Пловдив-град МИР apart", () => {
    const province = { oblast: "PDV", name: "обл. Пловдив" } as RegionInfo;
    const cityMir = { oblast: "PDV-00", name: "Пловдив" } as RegionInfo;
    const h1 = (r: RegionInfo) =>
      /<h1>([^<]*)<\/h1>/.exec(buildOblastBody(r))?.[1];
    expect(h1(province)).toBe("Резултати в област Пловдив");
    expect(h1(cityMir)).toBe("Резултати в МИР Пловдив");
  });

  it("still adds the tier word to a plain region name", () => {
    const blg = PROBLEM_REGIONS[PROBLEM_REGIONS.length - 1];
    expect(buildOblastBody(blg)).toContain("област Благоевград");
    expect(buildGovernanceRegionBody(blg, [], "en")).toContain(
      "Blagoevgrad province",
    );
    expect(
      buildSettlementBody({
        ekatte: "04279",
        settlement: "гр. Благоевград",
        oblastName: blg.name,
        oblastCode: blg.oblast,
      }),
    ).toContain("гр. Благоевград, обл. Благоевград");
  });
});

// A source-level gate, because the defect is a COMPOSITION pattern rather than
// one wrong string: a new place page that hand-writes `обл. ${name}` is broken
// for the six regions above and green for the other 25, which is exactly how
// this survived. Compose through `oblastLabel` instead.
describe("prerender sources compose region labels through oblastLabel", () => {
  const FORBIDDEN = [
    /обл\.\s\$\{/,
    /[Оо]бласт\s\$\{/,
    // "${displayName} province" / "${en} region" — the EN suffix forms. Scoped to
    // interpolations that name a place so "of ${blob.rankOf} provinces" (a count,
    // not a label) stays legal.
    /\$\{[^}]*(?:ame|isplay|bare|\ben\b)[^}]*\}\sprovince\b/,
    /\$\{[^}]*(?:ame|isplay|bare|\ben\b)[^}]*\}\sregion\b/,
  ];
  for (const file of ["dynamicRoutes.ts", "bodyBuilders.ts"]) {
    it(file, () => {
      const src = fs.readFileSync(path.join(__dirname, file), "utf-8");
      for (const bad of FORBIDDEN)
        expect(
          bad.exec(src)?.[0],
          `${file} composes a region tier word by hand (${bad}) — use oblastLabel() from @/lib/oblastName`,
        ).toBeUndefined();
    });
  }
});
