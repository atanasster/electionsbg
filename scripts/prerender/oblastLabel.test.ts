import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, it, expect } from "vitest";
import type { RegionInfo } from "@/data/dataTypes";
import {
  buildGovernancePlaceBody,
  buildGovernanceRegionBody,
  buildOblastBody,
  buildSectionBody,
  buildSectionsListBody,
  buildSettlementBody,
} from "./bodyBuilders";
import {
  buildGovernanceRegionRoutes,
  buildLocalRegionRoutes,
  buildOblastRoutes,
} from "./dynamicRoutes";
import type { PrerenderRoute } from "./routes";

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const REGIONS_FILE = path.join(
  PROJECT_ROOT,
  "src",
  "data",
  "json",
  "regions.json",
);
// Parsed exactly as the builders parse it. The assertion is deliberately NOT an
// `import` of the JSON module: `RegionInfo` declares `ekatte` required while
// several rows omit it, so the builders' own `as RegionInfo[]` is load-bearing
// and a structurally-typed import would not compile.
const REGIONS: RegionInfo[] = JSON.parse(
  fs.readFileSync(REGIONS_FILE, "utf-8"),
);

// Prerendered HTML is what the crawler indexes and what GA reports as the page
// title, so a doubled tier word here is the version the outside world sees. Six
// of the 32 rows in regions.json hold a name that already carries its tier — PDV
// ("обл. Пловдив", to tell the province from the PDV-00 city МИР), SFO ("София
// област"), S23/S24/S25 ("София N МИР") and 32 ("Извън страната") — and on the
// 2026-08-08 build ~1.2k pages named one of them with a tier word of their own.
//
// Fixtures come from regions.json rather than being hand-written: the real rows
// put S23's name in `long_name` and set `name: "23"`, so a hand-built fixture can
// pass while a builder that read the wrong field emits "област 23" in production.
// Last entry is the control — a plain name, which must still GET its tier word.
const PROBLEM_CODES = ["PDV", "PDV-00", "SFO", "S23", "32", "BLG"];
const PROBLEM_REGIONS: RegionInfo[] = PROBLEM_CODES.map((code) => {
  const row = REGIONS.find((r) => r.oblast === code);
  if (!row) throw new Error(`regions.json has no row for ${code}`);
  return row;
});

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
    const oblastName = r.long_name || r.name;
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
    const row = (code: string) => {
      const r = REGIONS.find((x) => x.oblast === code);
      if (!r) throw new Error(code);
      return r;
    };
    const h1 = (r: RegionInfo) =>
      /<h1>([^<]*)<\/h1>/.exec(buildOblastBody(r))?.[1];
    expect(h1(row("PDV"))).toBe("Резултати в област Пловдив");
    expect(h1(row("PDV-00"))).toBe("Резултати в МИР Пловдив");
    for (const lang of ["bg", "en"] as const)
      expect(buildGovernanceRegionBody(row("PDV"), [], lang)).not.toBe(
        buildGovernanceRegionBody(row("PDV-00"), [], lang),
      );
  });

  it("still adds the tier word to a plain region name", () => {
    const blg = PROBLEM_REGIONS[PROBLEM_REGIONS.length - 1];
    expect(blg.oblast).toBe("BLG");
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

// The gate the doubling checks cannot provide: a label can be free of doubled
// tier words and still be the WRONG KIND of wrong — identical to another page's.
// Fixing the doubling by baring PDV's "обл." prefix made PDV and PDV-00 collide
// on 4 governance pages and 20 local-election pages (5 cycles x 2 languages),
// every one of them self-canonical and in the sitemap. Asserted on what the real
// builders emit, because the helper-level uniqueness test passes `code` for every
// row while the builders are free to forget it — which is exactly what happened.
describe("no two prerendered region routes declare the same identity", () => {
  const h1 = (html?: string) => /<h1>([^<]*)<\/h1>/.exec(html ?? "")?.[1];

  const expectDistinct = (
    label: string,
    rows: Array<{ key: string; fields: Array<string | undefined> }>,
  ) => {
    expect(rows.length, `${label} produced no routes`).toBeGreaterThan(0);
    const fieldCount = rows[0].fields.length;
    for (let i = 0; i < fieldCount; i++) {
      const seen = new Map<string, string>();
      for (const row of rows) {
        const v = row.fields[i];
        if (!v) continue;
        const clash = seen.get(v);
        expect(
          clash,
          `${label} field ${i}: ${row.key} collides with ${clash} on "${v}"`,
        ).toBeUndefined();
        seen.set(v, row.key);
      }
    }
  };

  it("/municipality/:oblast", () => {
    const routes = buildOblastRoutes(REGIONS_FILE);
    expectDistinct(
      "buildOblastRoutes",
      routes.map((r) => ({
        key: r.path,
        fields: [r.title, r.description, h1(r.bodyHtml)],
      })),
    );
  });

  it("/governance/region/:oblast — BG and EN", () => {
    const routes = buildGovernanceRegionRoutes(PROJECT_ROOT, REGIONS);
    expectDistinct(
      "buildGovernanceRegionRoutes",
      routes.map((r) => ({
        key: r.path,
        fields: [
          r.title,
          r.description,
          h1(r.bodyHtml),
          r.english?.title,
          r.english?.description,
          h1(r.english?.bodyHtml),
        ],
      })),
    );
  });

  const localFields = (r: PrerenderRoute) => ({
    key: r.path,
    fields: [
      r.title,
      r.description,
      h1(r.bodyHtml),
      r.english?.title,
      r.english?.description,
      h1(r.english?.bodyHtml),
    ],
  });

  // buildLocalRegionRoutes takes its region list from each cycle's
  // data/<cycle>/regions_summary.json, and `.gitignore` drops `/data/2*/*` as regenerated
  // pipeline output — so on CI (and any fresh clone) the real tree yields zero routes and
  // this gate would pass by never running. The cycle list is synthesized instead, from the
  // SAME committed regions.json the builder labels against: every code, not just the 29 a
  // given cycle happens to hold, so it is a superset of what the real corpus can cover.
  const SYNTH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "local-regions-"));
  const SYNTH_CYCLES = ["2023_10_29_mi", "2019_10_27_mi"];
  fs.mkdirSync(path.join(SYNTH_ROOT, "src/data/json"), { recursive: true });
  fs.writeFileSync(
    path.join(SYNTH_ROOT, "src/data/json/local_elections.json"),
    JSON.stringify(SYNTH_CYCLES.map((name) => ({ name, kind: "regular" }))),
  );
  for (const cycle of SYNTH_CYCLES) {
    fs.mkdirSync(path.join(SYNTH_ROOT, "data", cycle), { recursive: true });
    fs.writeFileSync(
      path.join(SYNTH_ROOT, "data", cycle, "regions_summary.json"),
      JSON.stringify({ regions: REGIONS.map((r) => ({ oblast: r.oblast })) }),
    );
  }
  afterAll(() => fs.rmSync(SYNTH_ROOT, { recursive: true, force: true }));

  it("/local/:cycle/region/:oblast — BG and EN (every region code)", () => {
    const routes = buildLocalRegionRoutes(SYNTH_ROOT, REGIONS);
    // One route per code per cycle. regions.json carries no SOF row — that code is minted
    // by the local pipeline and dropped by the builder — so nothing is filtered here, and
    // the real-corpus test below is what exercises that branch.
    expect(routes.length).toBe(REGIONS.length * SYNTH_CYCLES.length);
    expectDistinct("buildLocalRegionRoutes", routes.map(localFields));
  });

  // The real corpus adds the two things a synthesized region list cannot: the SOF skip, and
  // a cycle whose own regions_summary.json repeats a code — which would ship two routes
  // under one path.
  const haveCycles = fs
    .readdirSync(path.join(PROJECT_ROOT, "data"))
    .some((f) =>
      fs.existsSync(path.join(PROJECT_ROOT, "data", f, "regions_summary.json")),
    );
  it.skipIf(!haveCycles)(
    "/local/:cycle/region/:oblast — BG and EN (the real cycles)",
    () => {
      const routes = buildLocalRegionRoutes(PROJECT_ROOT, REGIONS);
      expectDistinct("buildLocalRegionRoutes", routes.map(localFields));
    },
  );
});

// A source-level gate, because the defect is a COMPOSITION pattern rather than
// one wrong string: a new place page that hand-writes `обл. ${name}` is broken
// for the six regions above and green for the other 25, which is exactly how
// this survived. Compose through `oblastLabel` instead.
//
// Two things this cannot see, so do not read a green here as full coverage:
// JSX composition (`, област{" "}` + `{regionName}` — gated by
// placeNarrative.test.tsx instead), and a label that is merely INDISTINCT rather
// than doubled (gated by the route-uniqueness suite above).
const FORBIDDEN = [
  /обл\.\s\$\{/,
  /[Оо]бласт\s\$\{/,
  // "${displayName} province" / "${en} region" — the EN suffix forms. Scoped to
  // interpolations that name a place so "of ${blob.rankOf} provinces" (a count,
  // not a label) stays legal.
  /\$\{[^}]*(?:ame|isplay|bare|\ben\b)[^}]*\}\sprovince\b/,
  /\$\{[^}]*(?:ame|isplay|bare|\ben\b)[^}]*\}\sregion\b/,
  // A hand-rolled tier-word strip. PlaceHeader carried `/\s+област$/u` for
  // months — a TRAILING-only strip, so PDV's "обл." prefix passed straight
  // through it. Four such copies existed before the helper; none may come back.
  /replace\(\s*\/\^?\(?(?:обл\\\.|prov\\\.)/,
  /replace\(\s*\/\\s\+(?:област|region)\$/,
];

const expectComposedThroughHelper = (label: string, src: string) => {
  for (const bad of FORBIDDEN)
    expect(
      bad.exec(src)?.[0],
      `${label} composes or strips a region tier word by hand (${bad}) — use oblastLabel()/bareOblastName() from @/lib/oblastName`,
    ).toBeUndefined();
};

describe("prerender sources compose region labels through oblastLabel", () => {
  // All four files this family lives in. The list was dynamicRoutes+bodyBuilders
  // only, so reinstating the pre-fix composition in routes.ts left the suite
  // green — the pattern would have been caught, the file simply was not read.
  for (const file of [
    "dynamicRoutes.ts",
    "bodyBuilders.ts",
    "routes.ts",
    "educationPlaces.ts",
  ]) {
    it(file, () => {
      expectComposedThroughHelper(
        file,
        fs.readFileSync(path.join(__dirname, file), "utf-8"),
      );
    });
  }
});

// The SPA half. There was no gate over `src/` at all, which is why the header
// breadcrumb kept its own trailing-only strip and rendered "област обл. Пловдив"
// on every settlement and município page in Пловдив province.
describe("SPA sources compose region labels through oblastLabel", () => {
  const SRC = path.join(__dirname, "..", "..", "src");
  const HELPER = path.join(SRC, "lib", "oblastName.ts");

  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? walk(path.join(dir, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
            ? [path.join(dir, e.name)]
            : [],
      );

  it("no file under src/ hand-rolls a region tier word", () => {
    const files = walk(SRC).filter((f) => f !== HELPER);
    expect(files.length).toBeGreaterThan(100);
    for (const f of files)
      expectComposedThroughHelper(
        path.relative(SRC, f),
        fs.readFileSync(f, "utf-8"),
      );
  });
});
