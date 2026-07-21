// Unit gate for the projectLifecycle tool (§10 Phase 3). Hermetic — the data
// fetcher is swapped for an in-memory fixture, no bucket, no DB. Covers the three
// invariants the review called out: (1) every surfaced figure is grounded in the
// payload (never invented), and specifically the `unspecified` award bucket is
// kept OUT of noOpenShare (FINDING-001); (2) the no-slug branch lists dossiers;
// (3) a missing summaries.json degrades to an empty list without throwing.

import { describe, it, expect, afterEach } from "vitest";
import { projectLifecycle } from "./projectLifecycle";
import { setFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const ctx = { lang: "bg" } as ToolContext;

// zapadna-daga-like: 100% method-unstated — the case FINDING-001 guards. hemus-like:
// a real 3-way split so the shares are distinguishable.
const summaries = {
  hemus: {
    title: { bg: "Магистрала Хемус", en: "Hemus motorway" },
    thesis: { bg: "теза", en: "thesis" },
    contractedEur: 1000,
    contractCount: 4,
    procedureCount: 3,
    contractorCount: 2,
    methodMix: { competitive: 200, nonCompetitive: 300, unspecified: 500 },
    topContractors: [
      { name: "Автомагистрали ЕАД", eik: "831646048", eur: 700 },
      { name: "ПЪТПЕРФЕКТ", eik: "111", eur: 300 },
    ],
  },
  "zapadna-daga": {
    title: { bg: "Западна дъга", en: "Western arc" },
    contractedEur: 400,
    contractCount: 5,
    procedureCount: 8,
    contractorCount: 3,
    methodMix: { competitive: 0, nonCompetitive: 0, unspecified: 400 },
    topContractors: [{ name: "Изпълнител", eik: "222", eur: 400 }],
  },
};

describe("projectLifecycle run()", () => {
  afterEach(() => clearDataCache());

  it("lists the available dossiers when called with no slug", async () => {
    setFetcher(async () => summaries);
    const env = await projectLifecycle({}, ctx);
    expect(env.tool).toBe("projectLifecycle");
    expect((env.rows ?? []).map((r) => r.slug).sort()).toEqual([
      "hemus",
      "zapadna-daga",
    ]);
    // Count is grounded in the payload, not computed prose.
    expect(env.facts.count).toBe("2");
  });

  it("degrades to an empty list when summaries.json is missing", async () => {
    setFetcher(async () => {
      throw new Error("404");
    });
    const env = await projectLifecycle({ project: "hemus" }, ctx);
    // No throw; falls through to the (empty) listing branch.
    expect(env.rows ?? []).toEqual([]);
  });

  it("keeps the unspecified bucket out of noOpenShare (FINDING-001)", async () => {
    setFetcher(async () => summaries);
    // zapadna-daga is 100% method-unstated: it must NOT report 100% no-open-tender.
    const env = await projectLifecycle({ project: "zapadna-daga" }, ctx);
    expect(env.facts.openShare).toBe("0%");
    expect(env.facts.noOpenShare).toBe("0%");
    expect(env.facts.unspecifiedShare).toBe("100%");
  });

  it("grounds every award share verbatim from the payload fold", async () => {
    setFetcher(async () => summaries);
    const env = await projectLifecycle({ project: "hemus" }, ctx);
    // 200 / 300 / 500 of 1000 — three separate shares, summing to the whole.
    expect(env.facts.openShare).toBe("20%");
    expect(env.facts.noOpenShare).toBe("30%");
    expect(env.facts.unspecifiedShare).toBe("50%");
    expect(env.facts.contracts).toBe("4");
    expect(env.facts.procedures).toBe("3");
    expect(env.facts.topContractor).toBe("Автомагистрали ЕАД");
    expect(env.facts.url).toBe("/procurement/project/hemus");
  });
});
