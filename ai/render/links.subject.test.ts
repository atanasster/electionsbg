import { oblastLocator, muniLocator, settlementLocator } from "../tools/geo";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TOOLS } from "../tools/registry";
import type { Envelope } from "../tools/types";
import reviewedDestinations from "./fixtures/subject-destinations.json";
import { siteLinks } from "./links";

const env = (tool: string, extra: Partial<Envelope> = {}): Envelope => ({
  tool,
  kind: "scalar",
  title: "Answer",
  viz: "none",
  facts: {},
  provenance: [],
  ...extra,
});
const paths = (answer: Envelope) =>
  siteLinks(answer).map((l) => {
    const u = new URL(l.href);
    return u.pathname + u.search;
  });

// Frozen from the reviewed subject inventory, independent of runtime mappings.
const expectedDestinations: Record<string, string[]> = reviewedDestinations;
it("covers exactly the registered capabilities in the reviewed inventory", () => {
  expect(Object.keys(expectedDestinations).sort()).toEqual(
    TOOLS.map((t) => t.name).sort(),
  );
});
const routes = [
  "/reports/settlement/wasted-votes",
  ...[
    ...readFileSync("src/routes.tsx", "utf8").matchAll(/path="([^"]+)"/g),
  ].map((m) => "/" + m[1]),
].map((path) => new RegExp("^" + path.replace(/:[^/]+/g, "[^/]+") + "$"));
for (const tool of TOOLS) {
  it(`${tool.name} has a reviewed destination or requires a resolved ID`, () => {
    const links = paths(env(tool.name, { domain: tool.domain }));
    expect(links).toEqual(expectedDestinations[tool.name]);
    for (const link of links) {
      const path = link.split("?")[0];
      expect(
        routes.some((r) => r.test(path)),
        path,
      ).toBe(true);
    }
  });
}

it("links the exact coffee product by its slug, independently of language", () => {
  for (const product of [
    "МЛЯНО КАФЕ ЛАВАЦА КРЕМА Е ГУСТО 250ГР.",
    "Lavazza coffee",
  ]) {
    expect(
      paths(
        env("productPrice", {
          domain: "indicators",
          facts: { product, slug: "lavazza-crema-e-gusto-250" },
        }),
      ),
    ).toEqual(["/product/lavazza-crema-e-gusto-250"]);
  }
});
it("uses the product catalogue when no product was resolved", () => {
  expect(paths(env("productPrice"))).toEqual(["/consumption/products"]);
});
it("omits links on a chooser or an unknown tool, regardless of domain", () => {
  expect(
    paths(env("productPrice", { clarify: { prompt: "Which?", options: [] } })),
  ).toEqual([]);
  for (const domain of ["local", "indicators", "fiscal", "people"] as const)
    expect(paths(env("new-tool", { domain }))).toEqual([]);
});
it.each([
  [
    "projectLifecycle",
    { url: "/procurement/project/hemus" },
    "/procurement/project/hemus",
  ],
  ["chainProfile", { eik: "131129282" }, "/consumption/chain/131129282"],
  ["personConnections", { person_id: "ivan-123" }, "/person/ivan-123"],
  ["personWealth", { person_id: "ivan-123" }, "/person/ivan-123"],
  ["awarderProcurement", { eik: "000695089" }, "/awarder/000695089"],
  ["subsidiesForEntity", { eik: "123456789" }, "/farm/123456789"],
  ["councilResolutions", { obshtina_id: "RSE27" }, "/council/RSE27"],
] as const)(
  "%s keeps the answer's subject as its only destination",
  (tool, facts, path) => {
    expect(paths(env(tool, { facts }))).toEqual([path]);
  },
);
it("retains historical party elections and fiscal years", () => {
  expect(
    paths(
      env("partyResult", {
        facts: { party: "GERB" },
        provenance: ["2009_07_05/national_summary.json"],
      }),
    ),
  ).toEqual(["/party/GERB?elections=2009_07_05"]);
  expect(paths(env("budgetVariance", { facts: { fiscalYear: 2024 } }))).toEqual(
    ["/budget/deviations?fy=2024"],
  );
  expect(
    paths(
      env("openTenders", { facts: { link_topic: "guardrails", year: 2024 } }),
    ),
  ).toEqual(["/procurement/tenders?topic=guardrails&pscope=y%3A2024"]);
});
it("retains the local and presidential contest instead of changing election types", () => {
  expect(
    paths(
      env("localMayorsWon", {
        domain: "local",
        provenance: ["2019_10_27_mi/index.json"],
      }),
    ),
  ).toEqual(["/local/2019_10_27_mi"]);
  expect(
    paths(
      env("presidentialResults", {
        domain: "elections",
        provenance: ["2021_11_14_pvr/summary.json"],
      }),
    ),
  ).toEqual(["/presidential/2021_11_14_pvr"]);
});

it("keeps a hospital ranking's aggregate page and labels its drilldown", () => {
  const answer = env("nzokHospitals", { facts: { eik_id: "115576405" } });
  expect(paths(answer)).toEqual(["/awarder/121858220", "/company/115576405"]);
  expect(siteLinks(answer)[1].label.en).toContain("Largest hospital");
});
it.each([
  [oblastLocator("VAR", "Varna"), "/governance/region/VAR"],
  [oblastLocator("S23", "Sofia"), "/governance/SOF00"],
  [muniLocator("SOF", "S23", "Sofia"), "/governance/SOF00"],
  [muniLocator("VAR06", "VAR", "Varna"), "/governance/VAR06"],
  [settlementLocator("10135", "VAR06", "Varna"), "/governance/10135"],
])("uses canonical governance routing for locator %j", (geo, expected) => {
  expect(paths(env("governanceProfile", { geo }))).toEqual([expected]);
});

it.each([
  ["municipalityBreakdown", "/municipalities"],
  ["settlementBreakdown", "/settlements"],
])("keeps the requested geographic breakdown for %s", (tool, suffix) => {
  expect(
    paths(
      env(tool, {
        facts: { party: "GERB" },
        provenance: ["2024_10_27/results.json"],
      }),
    ),
  ).toEqual([`/party/GERB${suffix}?elections=2024_10_27`]);
});
it("links prices to the resolved settlement", () => {
  expect(
    paths(
      env("settlementPrices", {
        geo: settlementLocator("10135", "VAR06", "Varna"),
      }),
    ),
  ).toEqual(["/consumption/10135"]);
});
it("links the resolved ministry instead of the budget overview", () => {
  expect(
    paths(env("ministryBudget", { provenance: ["budget/ministries/MF.json"] })),
  ).toEqual(["/budget/ministry/MF"]);
});
it("retains keyword tender searches with encoded punctuation and their fiscal scope", () => {
  expect(
    paths(
      env("openTenders", { facts: { link_q: "roads & bridges", year: 2025 } }),
    ),
  ).toEqual(["/procurement/tenders?q=roads+%26+bridges&pscope=y%3A2025"]);
});
it("rejects a project URL outside the dossier route", () => {
  expect(
    paths(env("projectLifecycle", { facts: { url: "https://example.com" } })),
  ).toEqual(["/procurement/projects"]);
});
it("pins supported budget pages using either year fact without adding unsupported filters", () => {
  expect(paths(env("budgetByFunction", { facts: { year: 2023 } }))).toEqual([
    "/budget/functional?fy=2023",
  ]);
  expect(
    paths(env("budgetPersonnel", { facts: { fiscalYear: 2023 } })),
  ).toEqual(["/budget/personnel"]);
});
