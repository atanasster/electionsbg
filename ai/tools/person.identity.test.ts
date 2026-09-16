import { followUps } from "../app/followups";
import { siteLinks } from "../render/links";
import { afterEach, describe, expect, it } from "vitest";
import { clearDataCache, setDbFetcher } from "./dataClient";
import { personConnections, personProfile, personWealth } from "./person";
import type { ToolContext } from "./types";

const bg = { lang: "bg", election: "2024_10_27" } as ToolContext;
const en = { lang: "en", election: "2024_10_27" } as ToolContext;

const profile = (slug: string, name: string) => ({
  slug,
  name,
  namesakeRisk: 0,
  facets: [],
  roles: [],
  companies: [],
  ngos: [],
  procuredEur: 0,
  fundsEur: 0,
  subsidiesEur: 0,
  sanctions: [],
  ds: [],
  regulators: [],
});

afterEach(() => clearDataCache());

describe("person identity resolution", () => {
  it("resolves one Latin-script lookup hit through its stable slug", async () => {
    setDbFetcher(async (route, params) => {
      if (route === "person-profile" && params.name) return null;
      if (route === "person-search") return null;
      if (route === "person-lookup")
        return [{ slug: "ivan-ivanov", name: "Иван Иванов" }];
      if (route === "person-profile" && params.slug)
        return profile("ivan-ivanov", "Иван Иванов");
      throw new Error(`unexpected ${route}`);
    });
    const answer = await personProfile({ name: "Ivan Ivanov" }, en);
    expect(answer.title).toBe("Иван Иванов");
    expect(answer.clarify).toBeUndefined();
  });

  it("resolves a 2-word name to a unique 3-word person despite fuzzy candidates with different surnames", async () => {
    setDbFetcher(async (route, params) => {
      if (route === "person-profile" && params.name) return null;
      if (route === "person-search") return null;
      if (route === "person-lookup")
        return [
          { slug: "georgi-kalchev", name: "Георги Кънчев Калчев" },
          { slug: "georgi-kandev", name: "Георги Димитров Кандев" },
          { slug: "georgi-uzunov", name: "Георги Кънев Узунов" },
        ];
      if (route === "person-profile" && params.slug === "georgi-kandev")
        return profile("georgi-kandev", "Георги Димитров Кандев");
      if (route === "person-wealth" && params.slug === "georgi-kandev")
        return { slug: "georgi-kandev", series: [], markers: [] };
      throw new Error(`unexpected ${route}`);
    });
    const answer = await personWealth({ name: "Георги Кандев" }, bg);
    expect(answer.clarify).toBeUndefined();
    expect(answer.title).toContain("Георги Димитров Кандев");
  });

  it.each([
    [personProfile, "personProfile"],
    [personConnections, "personConnections"],
    [personWealth, "personWealth"],
  ] as const)("preserves ambiguity for %s", async (run, tool) => {
    setDbFetcher(async (route) => {
      if (route === "person-profile") return null;
      if (route === "person-search") return null;
      if (route === "person-lookup")
        return [
          { slug: "ivan-a", name: "Иван Иванов А" },
          { slug: "ivan-b", name: "Иван Иванов Б" },
        ];
      throw new Error(`unexpected ${route}`);
    });
    const answer = await run({ name: "Ivan Ivanov" }, bg);
    expect(answer.clarify?.options).toHaveLength(2);
    expect(answer.clarify?.options.map((option) => option.tool)).toEqual([
      tool,
      tool,
    ]);
    expect(answer.title).toContain("Кое лице");
  });

  it("distinguishes a missing person from an ambiguous one", async () => {
    setDbFetcher(async (route) => {
      if (route === "person-profile") return null;
      if (route === "person-search") return null;
      if (route === "person-lookup") return [];
      throw new Error(`unexpected ${route}`);
    });
    const answer = await personProfile({ name: "Nobody Here" }, en);
    expect(answer.clarify).toBeUndefined();
    expect(answer.title).toContain("No person found");
  });
});

describe("public-person navigation identity", () => {
  for (const ctx of [bg, en]) {
    for (const populated of [false, true]) {
      it(`retains the subject in wealth answers (${ctx.lang}, data=${populated})`, async () => {
        setDbFetcher(async (route) => {
          if (route === "person-profile")
            return profile("ivan-resolved", "Иван Иванов");
          if (route === "person-wealth")
            return {
              slug: "ivan-resolved",
              series: populated
                ? [
                    {
                      year: 2025,
                      assetsEur: 100,
                      debtsEur: 10,
                      netEur: 90,
                      incomeEur: 20,
                      filings: 1,
                      tier: "P",
                    },
                  ]
                : [],
              markers: [],
            };
          throw new Error(`unexpected ${route}`);
        });
        const env = await personWealth({ name: "Иван" }, ctx);
        expect(env.facts.person_id).toBe("ivan-resolved");
        expect(env.facts.public_person_id).toBe("ivan-resolved");
        expect(new URL(siteLinks(env)[0].href).pathname).toBe(
          "/person/ivan-resolved",
        );
        expect(followUps(env)).toEqual([
          expect.objectContaining({
            questionId: "personConnections",
            parameters: { name: "ivan-resolved" },
          }),
        ]);
      });
      it(`retains the subject in connection answers (${ctx.lang}, data=${populated})`, async () => {
        setDbFetcher(async (route) => {
          if (route === "person-profile")
            return profile("ivan-resolved", "Иван Иванов");
          if (route === "person-connections")
            return {
              subject: { slug: "ivan-resolved", name: "Иван Иванов" },
              related: populated
                ? [
                    {
                      slug: "petar",
                      name: "Петър",
                      sharedCount: 1,
                      companies: [{ eik: "123456789", name: "Фирма" }],
                    },
                  ]
                : [],
              disclaimer: "Name match",
            };
          throw new Error(`unexpected ${route}`);
        });
        const env = await personConnections({ name: "Иван" }, ctx);
        expect(env.facts.person_id).toBe("ivan-resolved");
        expect(env.facts.public_person_id).toBe("ivan-resolved");
        expect(new URL(siteLinks(env)[0].href).pathname).toBe(
          "/person/ivan-resolved",
        );
        expect(followUps(env)).toEqual([
          expect.objectContaining({
            questionId: "personWealth",
            parameters: { name: "ivan-resolved" },
          }),
        ]);
      });
    }
  }
});
