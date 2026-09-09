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

  it.each([
    [personProfile, "personProfile"],
    [personConnections, "personConnections"],
    [personWealth, "personWealth"],
  ] as const)("preserves ambiguity for %s", async (run, tool) => {
    setDbFetcher(async (route) => {
      if (route === "person-profile") return null;
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
      if (route === "person-lookup") return [];
      throw new Error(`unexpected ${route}`);
    });
    const answer = await personProfile({ name: "Nobody Here" }, en);
    expect(answer.clarify).toBeUndefined();
    expect(answer.title).toContain("No person found");
  });
});
