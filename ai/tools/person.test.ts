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
        place: null,
      },
      {
        source: "candidate",
        facet: "politician",
        sourceLabel: "Кандидати",
        role: "candidate",
        ref: "2022_10_02:mp-2258",
        place: null,
      },
      {
        source: "candidate",
        facet: "politician",
        sourceLabel: "Кандидати",
        role: "candidate",
        ref: "2024_10_27:mp-2258",
        place: null,
      },
      {
        source: "tr",
        facet: "company",
        sourceLabel: "Търговски регистър",
        role: "sole_owner",
        ref: "207747409",
        place: null,
      },
      {
        source: "local",
        facet: "politician",
        sourceLabel: "Местни кандидати и съветници",
        role: "mayor",
        ref: "2023_10_29_mi:BGS01:mayor",
        place: "Бургас",
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
    // The regulatory-body seat is surfaced verbatim (the `regulator` "кой решава" facet).
    expect(String(env.facts["регулаторни органи"])).toContain(
      "Конституционен съд",
    );
    expect(String(env.facts["фирми"])).toContain("СПАК ИНВЕСТ");
    // Office labels use the ROLE for local (Кмет), not the generic source label.
    expect(String(env.facts["длъжности"])).toContain("Народни представители");
    expect(String(env.facts["длъжности"])).toContain("Кмет");
    // NGO board seats are narrated (were previously dropped by the tool).
    expect(String(env.facts["управа на ЮЛНЦ (НПО)"])).toContain(
      "СЪЮЗ НА ВЕТЕРАНИТЕ",
    );
    // The identity disclaimer must always travel with the profile.
    expect(String(env.facts["бележка"])).toMatch(/насока/);
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
