// Retriever gate for the personProfile tool (plan §7d, risk #1 — a tool that isn't
// retrieved is dead code). Hermetic: the fuse index is built from the registry, no DB.
// Asserts personProfile is retrieved for its own utterances AND that adding it did not
// evict a sample of incumbents from their own top-k (no-regression on the retriever).

import { describe, it, expect, afterEach } from "vitest";
import { retrieveToolNames } from "../llm/retrieve";
import { personProfile } from "./person";
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
    ],
    companies: [
      { eik: "207747409", name: "СПАК ИНВЕСТ", roles: ["sole_owner"] },
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
    expect(String(env.facts["фирми"])).toContain("СПАК ИНВЕСТ");
    expect(String(env.facts["длъжности"])).toContain("Народни представители");
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
