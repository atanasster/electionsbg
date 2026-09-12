import { expect, it } from "vitest";
import {
  FUNDING_TEMPLATES,
  fundingTemplate,
} from "../../src/lib/questions/contracts/funding";
import { toChatQuestionIntent } from "./questionAdapter";
import { understandFunding } from "../orchestrator/fundingUnderstanding";
import { resolveFollowOn } from "../orchestrator/router";
import { fundingContinuations } from "./fundingContinuations";
import {
  validateFundingQuery,
  decodeFundingQuery,
  encodeFundingQuery,
} from "../../src/lib/fundingQuery";
import { siteLinks } from "../render/links";
import { fundingTemplateReady } from "./useFundingCapabilities";
import { procurementPageCsv } from "../../src/lib/procurementExport";
import type { Envelope } from "../tools/types";
it.each(FUNDING_TEMPLATES.filter((t) => t.query))(
  "$id starter typed/clicked/copy parity",
  (t) => {
    for (const lang of ["bg", "en"] as const) {
      const intent = toChatQuestionIntent("funding-query-" + t.id, lang);
      const r = understandFunding(intent.text);
      expect(r.kind).toBe("query");
      if (r.kind === "query") expect(r.query).toEqual(intent.args);
      expect(intent.args).toEqual(
        fundingTemplate("funding-query-" + t.id, lang).args,
      );
    }
  },
);
it("year and programme controls replace only their own scope", () => {
  const a = toChatQuestionIntent("funding-query-S10", "en", { year: 2024 });
  expect(a.args.financialYears).toEqual(["2024"]);
  expect(a.args.entityClass).toBe("legal");
  expect(a.text).toContain("2024");
  const b = toChatQuestionIntent("funding-query-S01", "bg", {
    period: "2014-2020",
  });
  expect(b.args.programmingPeriods).toEqual(["2014-2020"]);
  expect(b.text).toContain("2014-2020");
});
const p = validateFundingQuery({
  corpus: "interregOperations",
  operation: "count",
  programmingPeriods: ["2021-2027"],
  limit: 1,
});
if (!p.ok) throw Error();
const env: Envelope = {
  tool: "fundingQuery",
  kind: "scalar",
  title: "Funding",
  viz: "none",
  facts: {},
  provenance: [],
  funding: {
    query: p.query,
    result: { status: "success", revision: "revision-1" },
  },
};
it("typed and clicked continuations retain canonical state", () => {
  for (const c of fundingContinuations(env))
    for (const text of [c.en, c.bg]) {
      const r = resolveFollowOn(text, { tool: "fundingQuery", args: p.query });
      expect(r?.tool).toBe(c.intent?.tool);
      if (r?.tool === "fundingQuery") expect(r.args).toEqual(c.intent?.args);
      else expect(r?.args.previous).toBe(c.intent?.args.previous);
    }
  const child = fundingContinuations(env).find(
    (c) => c.questionId === "funding-followup-P09",
  )!;
  expect(child.intent?.args.parentQuery).toBe(encodeFundingQuery(p.query));
  expect(child.intent?.args.corpus).toBe("interregPartners");
});
it("links restore the same query and revision and reject invalid saved versions", () => {
  const url = new URL(siteLinks(env)[0].href);
  expect(decodeFundingQuery(url.searchParams.get("query")!)).toEqual({
    ok: true,
    query: p.query,
  });
  expect(url.searchParams.get("revision")).toBe("revision-1");
  expect(
    resolveFollowOn("And by programme?", {
      tool: "fundingQuery",
      args: { version: "future" },
    }),
  ).toMatchObject({
    tool: "fundingQuestion",
    args: { previous: "invalid-saved-scope" },
  });
});
it("capabilities hide unavailable starters and page CSV escapes formula text", () => {
  expect(fundingTemplateReady("funding-query-S08", null)).toBe(false);
  expect(fundingTemplateReady("funding-query-S01", null)).toBe(false);
  const csv = procurementPageCsv(
    [{ title: "=CMD()", amount: 100 }],
    "FY 2025",
    "revision-1",
  );
  expect(csv).toContain("'=CMD()");
  expect(csv).toContain("Current page only");
  expect(csv).toContain("FY 2025");
});
it.each(
  FUNDING_TEMPLATES.filter(
    (t) => t.query?.financialYears && !t.query.compareFinancialYears,
  ),
)("$id edited-year copy parity", (t) => {
  for (const lang of ["bg", "en"] as const) {
    const i = toChatQuestionIntent("funding-query-" + t.id, lang, {
      year: 2024,
    });
    const r = understandFunding(i.text);
    expect(r.kind === "query" && r.query).toEqual(i.args);
  }
});
it("a new election or procurement topic does not inherit funding scope", () => {
  const previous = validateFundingQuery({
    corpus: "agriPayments",
    financialYears: ["2025"],
  });
  if (!previous.ok) throw Error();
  for (const question of [
    "Who won the parliamentary election in 2024?",
    "Show procurement contracts in 2026",
  ])
    expect(understandFunding(question, { previous: previous.query })).toEqual({
      kind: "none",
    });
});
it("S13 selected entity, year and scheme preserve bilingual canonical identity", () => {
  for (const lang of ["bg", "en"] as const) {
    const i = toChatQuestionIntent("funding-query-S13", lang, {
      eik: "111111111",
      year: 2025,
      scheme: "S1",
    });
    expect(i.tool).toBe("fundingQuery");
    expect(i.args).toMatchObject({
      entityIds: ["111111111"],
      financialYears: ["2025"],
      schemeIds: ["S1"],
    });
    expect(understandFunding(i.text)).toMatchObject({
      kind: "query",
      query: i.args,
    });
  }
  expect(toChatQuestionIntent("funding-query-S13", "en").tool).toBe(
    "fundingQuestion",
  );
});
it("P16 executes two compatible same-place populations and preserves incompatible scope", () => {
  const p = validateFundingQuery({
    corpus: "isunProjects",
    operation: "sum",
    metric: "amount",
    placeIds: ["RSE27"],
    placeBasis: "implementation",
  });
  if (!p.ok) throw Error();
  const r = understandFunding(
    "Show ISUN and Interreg separately for the same municipality.",
    { previous: p.query },
  );
  expect(r.kind).toBe("bundle");
  if (r.kind === "bundle")
    expect(r.queries).toMatchObject([
      { corpus: "isunProjects", placeIds: ["RSE27"], amountBasis: "grant" },
      {
        corpus: "interregPartners",
        placeIds: ["RSE27"],
        amountBasis: "partnerBudget",
      },
    ]);
  const bad = understandFunding(
    "Show ISUN and Interreg separately for the same municipality.",
    {
      previous: {
        ...p.query,
        from: "2026-01-01",
        toExclusive: "2027-01-01",
        dateBasis: "observed",
      },
    },
  );
  expect(bad).toMatchObject({
    kind: "clarification",
    draft: { placeIds: ["RSE27"], from: "2026-01-01" },
  });
});
it.each([
  "isunProjects",
  "agriPayments",
  "interregOperations",
  "interregPartners",
])("unrelated prose cannot replay %s history", (corpus) => {
  const p = validateFundingQuery({ corpus });
  if (!p.ok) throw Error();
  for (const text of [
    "Tell me a joke",
    "What is the capital of France in 2026?",
    "What is the weather?",
  ])
    expect(understandFunding(text, { previous: p.query })).toEqual({
      kind: "none",
    });
});
it("a fully restated query can recover from invalid or bundled history", () => {
  for (const prev of [
    { tool: "fundingQuestion", args: { previous: "ambiguous-bundle" } },
    { tool: "fundingQuery", args: { version: "future" } },
  ])
    expect(
      resolveFollowOn(
        "How many ISUN projects are in 2021–2027 programmes?",
        prev,
      ),
    ).toMatchObject({
      tool: "fundingQuery",
      args: { corpus: "isunProjects", programmingPeriods: ["2021-2027"] },
    });
});

it("starter readiness requires every ratio and annual-payment prerequisite", () => {
  const cap = {
    version: "funding-records-v1",
    corpora: {
      isunProjects: {
        ready: true,
        dates: ["none"],
        amounts: ["grant", "paid"],
        predicates: [],
      },
      agriPayments: {
        ready: true,
        dates: ["financialYear"],
        amounts: ["paid"],
        predicates: [],
        financialYears: ["2025"],
      },
    },
  };
  expect(fundingTemplateReady("funding-query-S05", cap)).toBe(true);
  for (const amounts of [["grant"], ["paid"], []])
    expect(
      fundingTemplateReady("funding-query-S05", {
        ...cap,
        corpora: {
          ...cap.corpora,
          isunProjects: { ...cap.corpora.isunProjects, amounts },
        },
      }),
    ).toBe(false);
  expect(fundingTemplateReady("funding-query-S13", cap)).toBe(true);
  for (const missing of [
    { amounts: [] },
    { dates: [] },
    { financialYears: [] },
  ])
    expect(
      fundingTemplateReady("funding-query-S13", {
        ...cap,
        corpora: {
          ...cap.corpora,
          agriPayments: { ...cap.corpora.agriPayments, ...missing },
        },
      }),
    ).toBe(false);
});
