// The presidential family's two halves: what the builders emit, and what the committed shard
// submits.
//
// ⚠ THE ENUMERATORS CANNOT DISAGREE ANY MORE — `scripts/sitemap/index.ts` calls the PRERENDER's
// own builders rather than re-deriving the population, so there is one definition and this file
// does not check two against each other. A first cut DID re-derive it, and review found three
// ways the copy could already have drifted without either side looking wrong: an unparseable
// `national_summary.json` skipped a whole cycle on one side only, `tickets.json` was a
// prerender-only skip input the copy never opened, and the prerender required a NAME where the
// copy required only a CODE. All three are gone with the copy.
//
// What remains checkable, and is:
//   • the COMMITTED shard still matches what the builders emit — `npm run sitemap` is a manual
//     command (nothing in `build`/`postbuild` mints it), so „someone changed the builders and
//     did not re-mint" is a real state and this is the only thing that reports it;
//   • the settlement and section levels are in NEITHER — ~87,500 pages across five cycles;
//   • the builders' SKIP RULES, on a synthetic degraded corpus. That suite needs no `data/`
//     tree and therefore runs in CI, which the shard comparison does not: `/data/2*/*` is
//     gitignored, so the corpus is a developer-machine artifact.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __resetPresidentialCycleCache,
  buildPresidentialCycleRoutes,
  buildPresidentialMunicipalityRoutes,
  buildPresidentialRegionRoutes,
  presidentialCyclesFor,
} from "../prerender/presidentialRoutes";
import { reportSkip } from "../lib/report_skip";
import regions from "../../src/data/json/regions.json";
import type { RegionInfo } from "../../src/data/dataTypes";

const ROOT = process.cwd();
const SHARD = path.join(ROOT, "public", "sitemap_presidential.xml");

// ⚠ NAMED `skip…` DELIBERATELY. `report_skip_coverage.test.ts` anchors its scan on the
// DECLARATION name, so a gate called `hasCorpus` is invisible to the ratchet built to keep
// silent skips visible — and this skip is the COMMON case, not the rare one: `/data/2*/*` is
// gitignored, so no CI machine has the corpus.
const skipNoCorpus =
  presidentialCyclesFor(ROOT).length === 0
    ? "no data/*_pvr corpus (gitignored) — nothing to compare the committed shard against"
    : false;
if (skipNoCorpus) reportSkip(import.meta.url, skipNoCorpus);

const emitted = (root: string): string[] =>
  [
    ...buildPresidentialCycleRoutes(root),
    ...buildPresidentialRegionRoutes(root, regions as RegionInfo[]),
    ...buildPresidentialMunicipalityRoutes(root),
  ].map((r) => r.path);

/** The committed shard's paths, split by language. */
const shardPaths = (): { bg: string[]; en: string[] } => {
  const xml = fs.readFileSync(SHARD, "utf-8");
  const bg: string[] = [];
  const en: string[] = [];
  for (const m of xml.matchAll(
    /<loc>https:\/\/electionsbg\.com\/([^<]+)<\/loc>/g,
  ))
    (m[1].startsWith("en/") ? en : bg).push(m[1].replace(/^en\//, ""));
  return { bg, en };
};

describe.skipIf(skipNoCorpus)("the committed presidential shard", () => {
  it("exists — an absent shard is a broken working copy, not a skip", () => {
    // ⚠ IT IS A COMMITTED ARTIFACT served from `public/`, and `npm run sitemap` PRUNES every
    // `sitemap_*.xml` before writing — so a mint on a machine without the corpus deletes it,
    // drops it from the index and exits 0. `families.data.test.ts` carries the floor that
    // catches that in CI; this only catches it here.
    expect(
      fs.existsSync(SHARD),
      `${SHARD} is missing — run npm run sitemap`,
    ).toBe(true);
  });

  it("submits exactly what the builders emit, in both languages", () => {
    const want = new Set(emitted(ROOT));
    const { bg, en } = shardPaths();
    // ⚠ BOTH DIRECTIONS. A `<loc>` with no page is a soft-404; a page with no `<loc>` is a
    // page nobody is told about, which is the whole point of prerendering it.
    const missing = [...want].filter((p) => !bg.includes(p));
    const extra = bg.filter((p) => !want.has(p));
    expect(
      missing.slice(0, 5),
      `${missing.length} prerendered page(s) not submitted — re-run npm run sitemap`,
    ).toEqual([]);
    expect(
      extra.slice(0, 5),
      `${extra.length} submitted URL(s) with no prerendered page — re-run npm run sitemap`,
    ).toEqual([]);
    expect([...en].sort()).toEqual([...bg].sort());
    // Non-vacuity: an empty corpus satisfies every comparison above.
    expect(want.size).toBeGreaterThan(1_000);
  });

  it("submits no settlement or section URL", () => {
    // ⚠ ~87,500 PAGES ACROSS FIVE CYCLES, against a `dist/` already holding ~248k files and a
    // Firebase deploy that has FAILED at 453k.
    const { bg, en } = shardPaths();
    for (const p of [...bg, ...en]) {
      expect(p, `${p} is a settlement URL`).not.toMatch(/\/settlement\//);
      expect(p, `${p} is a section URL`).not.toMatch(/\/section\//);
    }
  });

  it("names every cycle, and gives each ONE abroad page", () => {
    const { bg } = shardPaths();
    for (const cycle of presidentialCyclesFor(ROOT)) {
      expect(bg, cycle).toContain(`presidential/${cycle}`);
      // ⚠ ONE PER CYCLE, never one per country — the route takes no id, so a per-country
      // `<loc>` would resolve to the same page 68 times.
      expect(
        bg.filter((p) => p === `presidential/${cycle}/abroad`).length,
        cycle,
      ).toBe(1);
    }
  });
});

describe.skipIf(skipNoCorpus)("the presidential og:image set", () => {
  it("declares a card for exactly the two levels that render one", () => {
    // ⚠ TWO PRODUCERS, ONE SET. `scripts/og/generate.ts` renders a card per cycle and per
    // (cycle, oblast); these builders declare `ogImage` on the same two levels and on no
    // other. A declared card nothing renders is a 404 in every social preview; a rendered
    // card nothing declares is a PNG the build ships and no page names. Neither side can see
    // the other, so this is the only thing comparing them.
    const withCard = new Map<string, string>();
    for (const r of [
      ...buildPresidentialCycleRoutes(ROOT),
      ...buildPresidentialRegionRoutes(ROOT, regions as RegionInfo[]),
      ...buildPresidentialMunicipalityRoutes(ROOT),
    ])
      if (r.ogImage) withCard.set(r.path, r.ogImage);

    for (const [routePath, og] of withCard) {
      // A cycle page or a region page — never a municipality or the abroad page.
      expect(routePath, og).toMatch(
        /^presidential\/[^/]+$|^presidential\/[^/]+\/region\/[^/]+$/,
      );
      expect(og, routePath).toMatch(/^\/og\/presidential\//);
    }
    // …and the two levels that carry none really carry none.
    for (const r of buildPresidentialMunicipalityRoutes(ROOT))
      expect(r.ogImage, r.path).toBeUndefined();
    for (const r of buildPresidentialCycleRoutes(ROOT))
      if (r.path.endsWith("/abroad")) expect(r.ogImage, r.path).toBeUndefined();
    // Non-vacuity: 5 cycles + 155 regions today.
    expect(withCard.size).toBeGreaterThan(100);
  });
});

// ─── the skip rules, on a synthetic corpus ──────────────────────────────────────────────────
//
// ⚠ NO `data/` TREE, SO THIS RUNS IN CI. Every rule below is invisible on the healthy corpus —
// measured, all four fire zero times — and each one decides whether ~604 pages exist. A rule
// that silently stopped firing would emit pages naming an identifier, or a cycle with no
// summary to describe.

type Damage = (dir: string) => void;

const SUMMARY = {
  round1Date: "2021-11-14",
  decidedInRound: 2,
  winner: { president: "П", vicePresident: "В" },
  rounds: [
    {
      round: 1,
      ranking: [
        { president: "П", vicePresident: "В", votes: 10, shareOfValid: 0.5 },
      ],
      votes: { valid: 20 },
      turnout: { pct: 0.2 },
      abroad: { sections: 1, countries: 1, ballotsFound: 2 },
    },
  ],
};

const rollup = (key: string) => ({
  entries: [{ key, results: { votes: [{ partyNum: 1, totalVotes: 5 }] } }],
});

const fixture = (damage?: Damage): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-"));
  const cycle = path.join(root, "data", "2021_11_14_pvr");
  fs.mkdirSync(path.join(cycle, "tur1"), { recursive: true });
  fs.writeFileSync(
    path.join(cycle, "national_summary.json"),
    JSON.stringify(SUMMARY),
  );
  fs.writeFileSync(
    path.join(cycle, "tickets.json"),
    JSON.stringify({
      tickets: [{ number: 1, president: "П", vicePresident: "В" }],
    }),
  );
  fs.writeFileSync(
    path.join(cycle, "tur1", "region_votes.json"),
    JSON.stringify(rollup("BLG")),
  );
  fs.writeFileSync(
    path.join(cycle, "tur1", "municipality_votes.json"),
    JSON.stringify(rollup("BLG04")),
  );
  fs.writeFileSync(
    path.join(root, "data", "municipalities.json"),
    JSON.stringify([{ obshtina: "BLG04", name: "Разлог", name_en: "Razlog" }]),
  );
  damage?.(cycle);
  __resetPresidentialCycleCache();
  return root;
};

describe("the builders' skip rules", () => {
  it("emits the whole family for a healthy cycle — the control", () => {
    const paths = emitted(fixture());
    expect(paths).toEqual([
      "presidential/2021_11_14_pvr",
      "presidential/2021_11_14_pvr/abroad",
      "presidential/2021_11_14_pvr/region/BLG",
      "presidential/2021_11_14_pvr/municipality/BLG04",
    ]);
  });

  it.each([
    [
      "no national_summary.json",
      (d: string) => fs.rmSync(path.join(d, "national_summary.json")),
    ],
    [
      "a summary with rounds: []",
      (d: string) =>
        fs.writeFileSync(
          path.join(d, "national_summary.json"),
          JSON.stringify({ ...SUMMARY, rounds: [] }),
        ),
    ],
    [
      "an unparseable summary",
      (d: string) =>
        fs.writeFileSync(path.join(d, "national_summary.json"), "{ broken"),
    ],
  ])("emits NOTHING for a cycle with %s", (_label, damage) => {
    // ⚠ THE WHOLE CYCLE, not just the country page. Every level's body quotes the summary, so
    // a cycle without one has no page that can say anything — and the sitemap enumerates from
    // these same builders, so it cannot submit URLs the prerender will not write.
    expect(emitted(fixture(damage))).toEqual([]);
  });

  it("skips a PLACE whose ticket is missing, and keeps the cycle", () => {
    // ⚠ A place page names the leading PAIR; with no `tickets.json` there is no pair to name,
    // and „води двойка №1" is a page about a ballot position.
    const paths = emitted(
      fixture((d) => fs.writeFileSync(path.join(d, "tickets.json"), "{}")),
    );
    expect(paths).toEqual([
      "presidential/2021_11_14_pvr",
      "presidential/2021_11_14_pvr/abroad",
    ]);
  });

  it("skips a place the name dictionary cannot name", () => {
    // ⚠ „Президентски избори — община BLG04" is a title about an identifier, and the sitemap
    // would submit it.
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "data", "municipalities.json"),
      JSON.stringify([]),
    );
    __resetPresidentialCycleCache();
    expect(emitted(root)).not.toContain(
      "presidential/2021_11_14_pvr/municipality/BLG04",
    );
    // …and the region, whose dictionary is the real `regions.json`, still emits — so the
    // assertion above is the rule firing rather than the fixture being empty.
    expect(emitted(root)).toContain("presidential/2021_11_14_pvr/region/BLG");
  });

  it("skips a place that cast no votes", () => {
    const paths = emitted(
      fixture((d) =>
        fs.writeFileSync(
          path.join(d, "tur1", "municipality_votes.json"),
          JSON.stringify({
            entries: [
              {
                key: "BLG04",
                results: { votes: [{ partyNum: 1, totalVotes: 0 }] },
              },
            ],
          }),
        ),
      ),
    );
    expect(paths).not.toContain(
      "presidential/2021_11_14_pvr/municipality/BLG04",
    );
  });
});
