// Retriever gate for the personProfile tool (plan §7d, risk #1 — a tool that isn't
// retrieved is dead code). Hermetic: the fuse index is built from the registry, no DB.
// Asserts personProfile is retrieved for its own utterances AND that adding it did not
// evict a sample of incumbents from their own top-k (no-regression on the retriever).

import { describe, it, expect, afterEach } from "vitest";
import { retrieveToolNames } from "../llm/retrieve";
import { personProfile, personConnections } from "./person";
import { setDbFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

// The retriever pads to k, so use the k the constrained router actually feeds the model.
const K = 8;

describe("personProfile retrieval", () => {
  const utterances = [
    "Какъв е профилът на Бойко Борисов?",
    "What is the profile of Boyko Borisov?",
    "Какви фирми притежава този депутат?",
    "What companies does this MP own?",
    "В кои дружества е собственик даден магистрат?",
    "Покажи всичко за едно лице — длъжности и фирми",
  ];

  it.each(utterances)("retrieves personProfile for: %s", (q) => {
    expect(retrieveToolNames(q, K)).toContain("personProfile");
  });

  // No-regression: a frozen sample of existing intents must still retrieve their own
  // tool at k after personProfile joined the index.
  const incumbents: [string, string][] = [
    ["Какви са резултатите от последните избори?", "nationalResults"],
    ["Кои депутати са най-богати?", "mpAssetsTop"],
    ["Кои са правителствата от 2005?", "governments"],
  ];
  it.each(incumbents)("incumbent survives: %s -> %s", (q, tool) => {
    expect(retrieveToolNames(q, K)).toContain(tool);
  });
});

describe("personConnections retrieval", () => {
  const utterances = [
    "С кого е свързан Бойко Борисов?",
    "Who is Boyko Borisov connected to?",
    "Кои са свързаните лица на този депутат?",
    "С кои други политици има обща фирма?",
    "Покажи връзките на едно лице по обща фирма",
  ];
  it.each(utterances)("retrieves personConnections for: %s", (q) => {
    expect(retrieveToolNames(q, K)).toContain("personConnections");
  });
});

describe("personProfile run()", () => {
  afterEach(() => clearDataCache());
  const ctx = { lang: "bg" } as ToolContext;

  const payload = {
    slug: "mp-2258",
    name: "Георги Владимиров Юруков",
    namesakeRisk: 1,
    facets: ["company", "politician"],
    roles: [
      {
        source: "mp",
        facet: "politician",
        sourceLabel: "Народни представители",
        role: "mp",
        ref: "2258",
        placeKind: null,
        placeCode: null,
        placeLabel: null,
        placeLabelEn: null,
        judicialKind: null,
      },
      {
        source: "candidate",
        facet: "politician",
        sourceLabel: "Кандидати",
        role: "candidate",
        ref: "2022_10_02:mp-2258",
        placeKind: null,
        placeCode: null,
        placeLabel: null,
        placeLabelEn: null,
        judicialKind: null,
      },
      {
        source: "candidate",
        facet: "politician",
        sourceLabel: "Кандидати",
        role: "candidate",
        ref: "2024_10_27:mp-2258",
        placeKind: null,
        placeCode: null,
        placeLabel: null,
        placeLabelEn: null,
        judicialKind: null,
      },
      {
        source: "tr",
        facet: "company",
        sourceLabel: "Търговски регистър",
        role: "sole_owner",
        ref: "207747409",
        placeKind: null,
        placeCode: null,
        placeLabel: null,
        placeLabelEn: null,
        judicialKind: null,
      },
      {
        source: "local",
        facet: "politician",
        sourceLabel: "Местни кандидати и съветници",
        role: "mayor",
        ref: "2023_10_29_mi:BGS01:mayor",
        placeKind: null,
        placeCode: null,
        placeLabel: "Бургас",
        placeLabelEn: null,
        judicialKind: null,
      },
    ],
    companies: [
      { eik: "207747409", name: "СПАК ИНВЕСТ", roles: ["sole_owner"] },
    ],
    ngos: [{ eik: "130161380", name: "СЪЮЗ НА ВЕТЕРАНИТЕ" }],
    procuredEur: 1234567,
    sanctions: [
      {
        program: "US Global Magnitsky",
        authority: "OFAC",
        date: "2021-06-02",
      },
    ],
    ds: [
      {
        decisionNo: "14",
        decisionDate: "2007-09-04",
        body: "Народен представител (37, 39–40 НС)",
        category: "агент",
        pseudonyms: ["Стоев"],
      },
    ],
    regulators: [
      {
        body: "Конституционен съд",
        seat: "constitutional_judge",
        termStart: "2021",
      },
    ],
  };

  it("builds a grounded profile envelope", async () => {
    setDbFetcher(async () => payload);
    const env = await personProfile({ name: "Юруков" }, ctx);
    expect(env.tool).toBe("personProfile");
    expect(env.title).toContain("Георги Владимиров Юруков");
    // Grounded facts: exact counts + the named company, never computed prose.
    expect(env.facts["фирми (брой)"]).toBe(1);
    expect(env.facts["кандидатури (брой)"]).toBe(2);
    // Procurement take is grounded verbatim (rounded integer), never computed in prose.
    expect(env.facts["обществени поръчки (EUR)"]).toBe(1234567);
    // The official sanction is surfaced verbatim.
    expect(String(env.facts["санкции"])).toContain("US Global Magnitsky");
    // The ДС/COMDOS finding is surfaced verbatim, cited to its решение № + date.
    expect(String(env.facts["принадлежност към ДС"])).toContain("агент");
    expect(String(env.facts["принадлежност към ДС"])).toContain("Стоев");
    expect(String(env.facts["принадлежност към ДС"])).toContain(
      "реш. № 14/2007-09-04",
    );
    // The regulatory-body seat is surfaced verbatim (the `regulator` "кой решава" facet).
    expect(String(env.facts["регулаторни органи"])).toContain(
      "Конституционен съд",
    );
    // THE BASIS RIDES ON THE KEY, and that is the assertion — not an incidental rename.
    // The fixture's company and board seat carry no `linkBasis`, which is what a serving
    // database on an older 082 sends, and absent must read as a name match. So the model
    // sees „фирми — по съвпадение на име: СПАК ИНВЕСТ" rather than a bare claim it can
    // assert. Looking the value up under the qualified key is what pins that: the plain key
    // must NOT exist, or the caveat could be detached from the names by any consumer that
    // asks for the short one.
    expect(String(env.facts["фирми — по съвпадение на име"])).toContain(
      "СПАК ИНВЕСТ",
    );
    expect(env.facts).not.toHaveProperty("фирми");
    // Office labels use the ROLE for local (Кмет), not the generic source label.
    expect(String(env.facts["длъжности"])).toContain("Народни представители");
    expect(String(env.facts["длъжности"])).toContain("Кмет");
    // NGO board seats are narrated (were previously dropped by the tool), and carry the same
    // qualifier for the same reason — this is the surface a model turns into a sentence about
    // a named person, and 5,670 of 5,727 seats in the corpus rest on a folded name.
    expect(
      String(env.facts["управа на ЮЛНЦ (НПО) — по съвпадение на име"]),
    ).toContain("СЪЮЗ НА ВЕТЕРАНИТЕ");
    expect(env.facts).not.toHaveProperty("управа на ЮЛНЦ (НПО)");
    // The identity disclaimer must always travel with the profile.
    expect(String(env.facts["бележка"])).toMatch(/насока/);
  });

  it("does NOT qualify a register-confirmed footprint", async () => {
    // The mutation guard on the case above: if the qualifier were unconditional, both tests
    // would pass while the annotation said nothing. A curated (Bridge-A) link is one a
    // register put on this person, so it earns the plain key — and the reassurance has to be
    // earned, exactly as the „по име" chip's absence does on /person. Note this is not the
    // same as "confirmed identity": the officer row inside a declared company is still a name
    // match, which is why the always-on „бележка" disclaimer below still travels with it.
    setDbFetcher(async () => ({
      ...payload,
      companies: [{ ...payload.companies[0], linkBasis: "declared" as const }],
      ngos: [{ ...payload.ngos[0], linkBasis: "declared" as const }],
    }));
    const env = await personProfile({ name: "Юруков" }, ctx);
    expect(String(env.facts["фирми"])).toContain("СПАК ИНВЕСТ");
    expect(String(env.facts["управа на ЮЛНЦ (НПО)"])).toContain(
      "СЪЮЗ НА ВЕТЕРАНИТЕ",
    );
    expect(env.facts).not.toHaveProperty("фирми — по съвпадение на име");
    // The blanket identity disclaimer is NOT the per-link basis and must survive either way.
    expect(String(env.facts["бележка"])).toMatch(/насока/);
  });

  it("qualifies a MIXED footprint — one name-matched row is enough", async () => {
    // Mirrors PersonCompanies' per-row mark: a block-level qualifier that fired only when
    // EVERY row rested on a name would leave the mixed case — the common one — unqualified.
    setDbFetcher(async () => ({
      ...payload,
      companies: [
        { ...payload.companies[0], linkBasis: "declared" as const },
        { eik: "111", name: "ВТОРА", roles: ["manager"] },
      ],
    }));
    const env = await personProfile({ name: "Юруков" }, ctx);
    expect(String(env.facts["фирми — по съвпадение на име"])).toContain(
      "ВТОРА",
    );
    expect(env.facts).not.toHaveProperty("фирми");
  });

  it("returns a clean not-found for an unknown name", async () => {
    setDbFetcher(async () => null);
    const env = await personProfile({ name: "Няма Такъв" }, ctx);
    expect(env.title).toContain("Не е намерено лице");
    expect(env.facts).not.toHaveProperty("фирми (брой)");
  });
});

describe("personConnections run()", () => {
  afterEach(() => clearDataCache());
  const ctx = { lang: "bg" } as ToolContext;

  const profile = { slug: "mp-2258", name: "Георги Юруков" };
  const connections = {
    subject: profile,
    related: [
      {
        slug: "petya-genan-139btl",
        name: "Петя Генън",
        sharedCount: 1,
        companies: [{ eik: "207741840", name: "ОБЩЕСТВЕН СЪВЕТ СОФИЯ" }],
      },
    ],
    disclaimer:
      "Връзките са по съвпадение на име и обща фирма — насока, не категорично доказателство.",
  };
  // Route the two fetchDb calls the tool makes (person-profile then person-connections).
  const fetcher = async (route: string) =>
    route === "person-profile" ? profile : connections;

  it("narrates only the payload's public-safe links, disclaimer always in facts", async () => {
    setDbFetcher(fetcher as never);
    const env = await personConnections({ name: "Юруков" }, ctx);
    expect(env.tool).toBe("personConnections");
    expect(env.facts["свързани лица (брой)"]).toBe(1);
    expect(String(env.facts["лица"])).toContain("Петя Генън");
    // The disclaimer rides FROM the grounded payload — it must always be present.
    expect(String(env.facts["бележка"])).toMatch(
      /не категорично доказателство/,
    );
    // The row set equals the payload — the tool never invents a link.
    expect(env.rows).toHaveLength(1);
  });

  it("says 'no public connections' when the payload has none", async () => {
    setDbFetcher((async (route: string) =>
      route === "person-profile"
        ? profile
        : { subject: profile, related: [], disclaimer: "x" }) as never);
    const env = await personConnections({ name: "Юруков" }, ctx);
    expect(env.title).toContain("Няма намерени публични връзки");
    expect(env.facts["свързани лица (брой)"]).toBe(0);
  });
});
