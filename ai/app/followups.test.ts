import { expect, it } from "vitest";
import { TOOLS } from "../tools/registry";
import { questionById } from "../../src/lib/questions/catalog";
import { STARTERS } from "./starters";
import { followUps, followUpPolicy } from "./followups";
import { toChatQuestionIntent } from "./questionAdapter";
import type { Envelope } from "../tools/types";
const envelope = (tool: string, facts = {}): Envelope =>
  ({ tool, facts }) as Envelope;
for (const tool of TOOLS) {
  it(`${tool.name} has a relevant continuation policy or an explicit omission`, () => {
    const policy = followUpPolicy(tool.name);
    expect(policy.reason.length).toBeGreaterThan(0);
    const source = STARTERS.find((s) => s.tool === tool.name);
    for (const id of policy.questionIds) {
      const target = STARTERS.find((s) => s.id === id)!;
      expect(target.category).toBe(source?.category);
      expect(target.subcategory).toBe(source?.subcategory);
      expect(target.tool).not.toBe(tool.name);
    }
    for (const s of followUps(envelope(tool.name))) {
      expect(toChatQuestionIntent(s.questionId, "bg", s.parameters).tool).toBe(
        toChatQuestionIntent(s.questionId, "en", s.parameters).tool,
      );
    }
  });
}
it("continues the actual company by stable ID, not a fixed example", () => {
  const s = followUps(
    envelope("topContractors", {
      top_contractor: "Example Ltd",
      top_contractor_eik: "123456789",
    }),
  );
  expect(s[0]).toMatchObject({
    questionId: "contractSearch",
    parameters: { company: "123456789" },
  });
  expect(s[0].en).toContain("Example Ltd");
});
it("omits company drilldown if its stable ID is missing", () => {
  expect(
    followUps(
      envelope("topContractors", { top_contractor: "Example Ltd" }),
    ).some((s) => s.questionId === "contractSearch"),
  ).toBe(false);
});
it("preserves a settlement pin and makes the time window explicit", () => {
  const s = followUps(envelope("settlementResults", { settlement: "Иново" }), {
    place: "ekatte:32898",
    election: "2024_10_27",
  });
  expect(s[0]).toMatchObject({
    questionId: "settlementHistory",
    parameters: { place: "ekatte:32898", years: 5 },
  });
  expect(s[0].en).toContain("5 years");
});
it("retains the selected election for snapshot follow-ups", () => {
  expect(
    followUps(envelope("nationalResults"), { election: "2024_10_27" })[0],
  ).toMatchObject({
    questionId: "turnout",
    parameters: { election: "2024_10_27" },
  });
});
it("does not repeat an answered tool and parameter combination", () => {
  const args = { election: "2024_10_27" };
  const s = followUps(envelope("nationalResults"), args, [
    { tool: "turnout", args },
  ]);
  expect(s.some((s) => s.questionId === "turnout")).toBe(false);
});
it("does not invent an unrelated topic for uncataloged capabilities", () => {
  expect(followUpPolicy("unknown").kind).toBe("none");
  expect(followUps(envelope("unknown"))).toEqual([]);
});

it("historical party continuations retain the party instead of widening to national results", () => {
  const suggestions = followUps(envelope("partyResult", { party: "ГЕРБ" }), {
    party: "ГЕРБ",
    election: "2024_10_27",
  });
  expect(suggestions.some((s) => s.questionId === "nationalResults")).toBe(
    false,
  );
  expect(
    suggestions.find((s) => s.questionId === "regionBreakdown"),
  ).toMatchObject({
    parameters: { party: "ГЕРБ", election: "2024_10_27" },
  });
});

it("does not pivot a specific product to national shopping rankings", () => {
  expect(
    followUps(
      envelope("productPrice", { product: "Лаваца", slug: "lavazza" }),
      {
        product: "product-slug:lavazza",
      },
    ),
  ).toEqual([]);
});

it("never offers a catalog example product, hospital, molecule or buyer as a generic continuation", () => {
  for (const tool of TOOLS) {
    expect(followUpPolicy(tool.name).questionIds).not.toEqual(
      expect.arrayContaining(["productPrice"]),
    );
    for (const id of followUpPolicy(tool.name).questionIds) {
      expect(
        questionById(id)!.parameters.some((p) =>
          ["string", "person", "company", "place"].includes(p.kind),
        ),
      ).toBe(false);
    }
  }
});

it("keeps a person's stable identity in bilingual continuations", () => {
  const suggestions = followUps(
    envelope("personProfile", {
      person_id: "ivan-123",
      public_person_id: "ivan-123",
      name: "Иван Иванов",
    }),
  );
  expect(suggestions.map((s) => s.questionId)).toEqual([
    "personWealth",
    "personConnections",
  ]);
  for (const s of suggestions) {
    expect(s.parameters).toEqual({ name: "ivan-123" });
    expect(s.bg).toContain("Иван Иванов");
    expect(s.en).toContain("Иван Иванов");
  }
});

it("does not lose a semantic filter or a selected assembly", () => {
  expect(followUps(envelope("nzokDrugs"), { inn: "metformin" })).toEqual([]);
  const next = followUps(envelope("mpAttendance"), { ns: 49 });
  expect(next.length).toBeGreaterThan(0);
  for (const s of next) {
    expect(s.parameters).toMatchObject({ ns: 49 });
    expect(s.en).toContain("49");
  }
});

it("replaces a catalog fiscal year when inheriting a different year", () => {
  const answered = followUpPolicy("budgetOverview")
    .questionIds.filter((id) => id !== "budgetVariance")
    .map((id) => {
      const intent = toChatQuestionIntent(id, "bg");
      return {
        tool: intent.tool,
        args: {
          ...intent.args,
          ...(questionById(id)!.parameters.some((p) => p.id === "year")
            ? { year: 2025 }
            : {}),
        },
      };
    });
  const next = followUps(
    envelope("budgetOverview"),
    { year: 2025 },
    answered,
  ).find((s) => s.questionId === "budgetVariance");
  expect(next).toBeDefined();
  expect(next!.bg).not.toContain("2024");
  expect(next!.en).toContain("2025");
});

it("does not advertise contracts for a chain without recorded supplier contracts", () => {
  expect(
    followUps(
      envelope("chainProfile", { chain: "Example", eik: "123456789" }),
    ).some((s) => s.questionId === "contractSearch"),
  ).toBe(false);
  expect(
    followUps(
      envelope("chainProfile", {
        chain: "Example",
        eik: "123456789",
        as_supplier_contracts: 3,
      }),
    ).some((s) => s.questionId === "contractSearch"),
  ).toBe(true);
});

it("uses the answer election instead of the catalog example when arguments omit it", () => {
  const env = {
    ...envelope("turnout"),
    provenance: ["2024_10_27/national_summary.json"],
  };
  const chip = followUps(env).find((s) => s.questionId === "machineVoteShare")!;
  for (const lang of ["bg", "en"] as const) {
    expect(
      toChatQuestionIntent(chip.questionId, lang, chip.parameters).args
        .election,
    ).toBe("2024_10_27");
    expect(chip[lang]).toContain("2024-10-27");
    expect(chip[lang]).not.toContain("2023");
  }
});
it("does not turn an unknown or multi-election period into a sample election", () => {
  for (const provenance of [[], ["2024_10_27/a.json", "2023_04_02/a.json"]]) {
    const suggestions = followUps({ ...envelope("turnoutSeries"), provenance });
    expect(
      suggestions.some((s) =>
        ["turnout", "machineVoteShare"].includes(s.questionId!),
      ),
    ).toBe(false);
  }
});
it.each([{ years: 3 }, { n: 4 }])(
  "retains the series window %j without a competing sample default",
  (args) => {
    const chip = followUps(envelope("turnoutSeries"), args).find(
      (s) => s.questionId === "machineVoteSeries",
    )!;
    expect(chip).toBeDefined();
    for (const lang of ["bg", "en"] as const) {
      expect(
        toChatQuestionIntent(
          chip.questionId,
          lang,
          JSON.parse(JSON.stringify(chip.parameters)),
        ).args,
      ).toEqual(args);
    }
    expect(chip.en).toContain(args.years ? "3 years" : "4 elections");
    expect(chip.en).not.toContain("7");
  },
);
it("does not offer public-person tools for a name-only business portfolio", () => {
  expect(
    followUps(
      envelope("personProfile", {
        person_id: "Иван Иванов",
        name: "Иван Иванов",
      }),
    ),
  ).toEqual([]);
});
