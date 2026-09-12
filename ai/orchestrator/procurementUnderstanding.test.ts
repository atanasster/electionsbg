import { decodeProcurementQuery } from "../../src/lib/procurementQuery";
import { describe, it, expect } from "vitest";
import {
  understandProcurement,
  PROCUREMENT_RISK_ALIASES,
} from "./procurementUnderstanding";
import { route, resolveFollowOn } from "./router";
import { parseModelRoute } from "./routeScope";
const now = new Date("2026-09-12T09:00:00Z");
const ctx = { lang: "bg" as const, election: "2024_06_09" };
const query = (text: string) => {
  const result = understandProcurement(text, { now });
  expect(result.kind).toBe("query");
  if (result.kind !== "query") throw Error(text);
  return result.query;
};
describe("procurement interpretation", () => {
  it.each([
    [
      "какъв процент от обществените поръчки за 2026 са с 1 участник",
      "2026-01-01",
      "2027-01-01",
    ],
    ["Договори от 04/2025 до 01/2026", "2025-04-01", "2026-02-01"],
    ["Contracts from April 2025 to January 2026", "2025-04-01", "2026-02-01"],
    ["Договори от 15.04.2025 до 31.01.2026", "2025-04-15", "2026-02-01"],
    ["Търгове Q2 2026", "2026-04-01", "2026-07-01"],
    ["Търгове второ тримесечие 2026", "2026-04-01", "2026-07-01"],
    ["Contracts last year", "2025-01-01", "2026-01-01"],
    ["Contracts last 12 months", "2025-09-13", "2026-09-13"],
    ["Договори на 29.02.2024", "2024-02-29", "2024-03-01"],
    ["Договори от април 2025", "2025-04-01", undefined],
    ["Договори до януари 2026", undefined, "2026-02-01"],
  ])("captures exact period %s", (text, from, toExclusive) =>
    expect([query(text).from, query(text).toExclusive]).toEqual([
      from,
      toExclusive,
    ]),
  );
  it.each([
    "с 1 участник",
    "с един участник",
    "с една оферта",
    "with one bidder",
    "with a single bid",
  ])("captures one-bid measure %s", (suffix) =>
    expect(
      query("Какъв процент от договорите за 2026 " + suffix),
    ).toMatchObject({ operation: "share", metric: "oneBid" }),
  );
  it.each([
    "Договори на 29.02.2025",
    "Договори от 13/2025 до 01/2026",
    "Договори от 2026 до 2025",
  ])("rejects invalid/ambiguous periods %s", (text) =>
    expect(understandProcurement(text, { now }).kind).toBe("clarification"),
  );
  it("keeps healthcare choices scoped", () => {
    const result = understandProcurement(
      "Процент договори с 1 участник в здравеопазването през 2026",
      { now },
    );
    expect(result.kind).toBe("clarification");
    if (result.kind === "clarification") {
      expect(result.options).toHaveLength(2);
      for (const o of result.options!)
        expect(o.query).toMatchObject({
          from: "2026-01-01",
          metric: "oneBid",
          operation: "share",
        });
    }
  });
  it("keeps buyer, topic and period together", () =>
    expect(query("Търгове за мантинели на АПИ през 2026")).toMatchObject({
      corpus: "tenders",
      topic: "guardrails",
      buyerIds: ["000695089"],
      from: "2026-01-01",
    }));
  it("classifies primary CPV independently of buyer", () =>
    expect(
      query("Договори CPV 33100000-1 ЕИК 123456789 през 2026"),
    ).toMatchObject({ cpvPrefixes: ["33100000"], buyerIds: ["123456789"] }));
  it("does not route cancelled healthcare tenders to budget", () =>
    expect(
      route("Отменени търгове в здравеопазването през 2026", ctx)?.tool,
    ).toBe("procurementQuestion"));
  it("compares two distinct years", () =>
    expect(query("Сравни договорите 2025 и 2026")).toMatchObject({
      operation: "compare",
      from: "2025-01-01",
      toExclusive: "2026-01-01",
      compareFrom: "2026-01-01",
      compareToExclusive: "2027-01-01",
    }));
  it.each([
    "Население на Търговище",
    "Бюджет за здравеопазване",
    "КЗК картели",
    "Омбудсман жалби",
  ])("preserves negative domain %s", (text) =>
    expect(understandProcurement(text, { now }).kind).toBe("none"),
  );
  it("does not silently execute unknown sector", () =>
    expect(
      understandProcurement("Договори в сектор телепортация през 2026", { now })
        .kind,
    ).toBe("clarification"));
  it("preserves unspecified follow-up filters", () => {
    const previous = query("Процент договори с 1 участник CPV 33 през 2026");
    const next = resolveFollowOn("А за 2025?", {
      tool: "procurementQuery",
      args: previous,
    });
    expect(next?.args).toMatchObject({
      metric: "oneBid",
      cpvPrefixes: ["33"],
      from: "2025-01-01",
      toExclusive: "2026-01-01",
    });
  });
  it("model scope omissions cannot override explicit scope", () => {
    const result = parseModelRoute(
      JSON.stringify({ tool: "procurementTotals", args: {} }),
      "какъв процент от обществените поръчки за 2026 са с 1 участник",
    );
    expect(result).toMatchObject({
      tool: "procurementQuery",
      args: { metric: "oneBid", from: "2026-01-01" },
    });
  });
  it("has aliases for every risk catalog member", () =>
    expect(Object.keys(PROCUREMENT_RISK_ALIASES)).toHaveLength(17));
});

describe("review regressions", () => {
  it("combines bidder and risk conditions", () => {
    expect(
      query("Процент договори с 1 участник и пряко възлагане през 2026")
        .numeratorPredicates,
    ).toEqual(["oneBid", "risk:directAward"]);
  });
  it("replaces the numerator on a metric follow-up", () => {
    const previous = query("Процент договори със слаба конкуренция през 2026");
    const result = understandProcurement("А с 1 участник?", { previous, now });
    expect(result).toMatchObject({
      kind: "query",
      query: {
        metric: "oneBid",
        numeratorPredicates: ["oneBid"],
        from: "2026-01-01",
      },
    });
  });
  it.each([
    ["Договори без европейско финансиране през 2026", { funding: "notEu" }],
    ["Contracts without EU-funded support in 2026", { funding: "notEu" }],
    ["Договори без рамково споразумение през 2026", { framework: "no" }],
    [
      "Процент договори през 2026 без обжалване",
      { numeratorPredicates: ["!appealed"] },
    ],
    [
      "Contracts below 1 million EUR in 2026",
      { amountMax: 1000000, amountMaxRelation: "lt" },
    ],
    [
      "Contracts at least 1 million EUR in 2026",
      { amountMin: 1000000, amountMinRelation: "gte" },
    ],
    ["Договори с поне 3 участника през 2026", { bidderMin: 3 }],
    ["Contracts with at most 12 bidders in 2026", { bidderMax: 12 }],
  ])("preserves comparisons and negation: %s", (text, expected) =>
    expect(query(text)).toMatchObject(expected),
  );
  it.each([
    "Договори с пряко възлагане",
    "Процент договори със слаба конкуренция",
  ])("does not bypass captured intent: %s", (text) =>
    expect(route(text, ctx)?.tool).toBe("procurementQuery"),
  );
});

it.each([11, 21])("keeps exact %i bidders without one-bid predicate", (n) => {
  const q = query(`Contracts with ${n} bidders in 2026`);
  expect(q).toMatchObject({ bidderMin: n, bidderMax: n });
  expect(q.numeratorPredicates).toBeUndefined();
});
it("at least one is a lower bound", () => {
  const q = query("Contracts with at least 1 bidder in 2026");
  expect(q.bidderMin).toBe(1);
  expect(q.bidderMax).toBeUndefined();
  expect(q.numeratorPredicates).toBeUndefined();
});

it.each([
  ["debarred", "отстранени изпълнители", "debarred suppliers"],
  ["mpConnected", "свързани с депутати", "linked to MPs"],
  ["pepConnected", "длъжностни лица", "public officials"],
  ["awarderConcentration", "концентрация", "concentration"],
  ["amendment", "с анекс", "with amendments"],
  ["annexGrowth", "голямо увеличение на стойността", "large value increase"],
  ["newFirmWinner", "новосъздадени фирми", "newly established firms"],
  ["splitPurchase", "раздробяване", "split purchases"],
  [
    "appealUpheld",
    "свързани с уважена жалба",
    "linked to a recorded upheld appeal",
  ],
  ["weakCompetition", "слаба конкуренция", "weak competition"],
  ["directAward", "пряко възлагане", "direct award"],
  ["shortTenderPeriod", "кратък срок за оферти", "short tender period"],
  ["nkidMismatch", "несъответствие на дейност", "activity mismatch"],
  ["nonOpenProcedure", "неоткрита процедура", "non open procedure"],
  ["rushedDeadline", "кратък срок", "rushed deadline"],
  ["shortDecisionPeriod", "бързо решение", "short decision period"],
  ["awardOverEstimate", "над прогнозната стойност", "award over estimate"],
])("routes complete bilingual catalog %s", (id, bg, en) => {
  const tender = [
    "nonOpenProcedure",
    "rushedDeadline",
    "shortDecisionPeriod",
    "awardOverEstimate",
  ].includes(id);
  for (const text of [
    (tender ? "Търгове " : "Договори ") + bg,
    (tender ? "Tenders " : "Contracts ") + en,
  ]) {
    const r = route(text, ctx);
    if (id === "amendment") {
      expect(r?.tool).toBe("procurementQuestion");
      continue;
    }
    if (r?.tool === "openTenders") {
      const decoded = decodeProcurementQuery(String(r.args.canonical));
      expect(decoded.ok, text).toBe(true);
      if (decoded.ok)
        expect(decoded.query.numeratorPredicates, text).toContain("risk:" + id);
    } else {
      expect(r?.tool, text).toBe("procurementQuery");
      expect(r?.args.numeratorPredicates, text).toContain("risk:" + id);
    }
  }
});
it("invalid saved scope cannot become an unscoped follow-up", () => {
  expect(
    resolveFollowOn("А за 2025?", {
      tool: "procurementQuery",
      args: { version: "future" },
    }),
  ).toMatchObject({
    tool: "procurementQuestion",
    args: { previous: "invalid-saved-scope" },
  });
});
it("G05 correction replaces the rejected year", () =>
  expect(query("Договори не 2026, а 2025").from).toBe("2025-01-01"));
it("A17 selected parliament uses the existing window", () => {
  const result = understandProcurement("Договори за този парламент", {
    now,
    election: "2024_06_09",
  });
  expect(result).toMatchObject({
    kind: "query",
    query: { from: "2024-06-09", toExclusive: "2024-10-27" },
  });
});
it("E13/G03 linked complaints carry a portable parent cohort", () => {
  const previous = query("Покажи търгове за медицинско оборудване през 2026");
  const result = understandProcurement("Покажи свързаните жалби", {
    previous,
    now,
  });
  expect(result.kind).toBe("query");
  if (result.kind !== "query") throw Error();
  expect(result.query.corpus).toBe("appeals");
  expect(result.query.from).toBeUndefined();
  expect(decodeProcurementQuery(result.query.parentQuery!)).toEqual({
    ok: true,
    query: previous,
  });
});
it("G07 nested Boolean intent requires grouping clarification", () =>
  expect(
    understandProcurement(
      "Договори с 1 участник и пряко възлагане или слаба конкуренция през 2026",
    ).kind,
  ).toBe("clarification"));
it("C03 among-direct-awards is a base filter rather than a numerator", () => {
  const q = query(
    "Процент договори с 1 участник сред пряко възлагане през 2026",
  );
  expect(q.basePredicates).toEqual(["risk:directAward"]);
  expect(q.numeratorPredicates).toEqual(["oneBid"]);
});
it("G10 two questions stay separate and three require selection", () => {
  const r = understandProcurement(
    "Колко договори през 2025? Колко жалби по ЗОП през 2026?",
    { now },
  );
  expect(r.kind).toBe("bundle");
  if (r.kind === "bundle")
    expect(r.queries.map((q) => [q.corpus, q.from])).toEqual([
      ["contracts", "2025-01-01"],
      ["appeals", "2026-01-01"],
    ]);
  expect(
    understandProcurement(
      "Договори през 2025? Търгове през 2026? Жалби през 2026?",
    ).kind,
  ).toBe("unsupported");
});
it.each([
  [
    "Процент договори с 1 участник сред договори без пряко възлагане през 2026",
    ["!risk:directAward"],
    ["oneBid"],
  ],
  [
    "Процент договори с пряко възлагане сред договорите с 1 участник през 2026",
    ["oneBid"],
    ["risk:directAward"],
  ],
])(
  "base and numerator retain independent conditions: %s",
  (text, base, numerator) => {
    const q = query(text);
    expect(q.basePredicates).toEqual(base);
    expect(q.numeratorPredicates).toEqual(numerator);
  },
);
it("amendment base conditions require explicit interpretation", () => {
  expect(
    understandProcurement(
      "Процент договори с 1 участник сред договори с анекс през 2026",
    ).kind,
  ).toBe("clarification");
  expect(
    understandProcurement("Contracts without amendments in 2026").kind,
  ).toBe("clarification");
});

it.each([
  ["Колко решения на КЗК през 2026", "решения"],
  ["How many KZK decisions in 2026", "решения"],
  ["Колко определения на КЗК през 2026", "определения"],
  ["Колко акта на КЗК през 2026", undefined],
])("KZK act kind is explicit: %s", (text, actKind) => {
  const q = query(text);
  expect(q.corpus).toBe("decisions");
  expect(q.actKind).toBe(actKind);
});
it.each([
  ["Колко отхвърлени жалби по ЗОП през 2026", "отхвърлена"],
  ["How many refused KZK complaints in 2026", "отказана"],
  ["Колко прекратени жалби по ЗОП през 2026", "прекратена"],
])("KZK recorded outcome is preserved: %s", (text, outcome) => {
  expect(query(text).outcome).toBe(outcome);
});

it("among OR does not change the numerator's Boolean mode", () => {
  const q = query(
    "Процент договори с 1 участник сред договори с пряко възлагане или слаба конкуренция през 2026",
  );
  expect(q.baseMode).toBe("any");
  expect(q.basePredicates).toEqual(
    expect.arrayContaining(["risk:directAward", "risk:weakCompetition"]),
  );
  expect(q.numeratorPredicates).toEqual(["oneBid"]);
  expect(q.numeratorMode).toBe("all");
});
it.each([
  "Покажи жалби по ЗОП без отказан изход през 2026",
  "Show KZK complaints without refused outcomes in 2026",
])("negated outcome requires clarification: %s", (text) => {
  expect(understandProcurement(text).kind).toBe("clarification");
});

it("English among OR keeps its union denominator", () => {
  const q = query(
    "Percentage of contracts with one bid among contracts with direct award or weak competition in 2026",
  );
  expect(q.baseMode).toBe("any");
  expect(q.basePredicates).toEqual(
    expect.arrayContaining(["risk:directAward", "risk:weakCompetition"]),
  );
  expect(q.numeratorPredicates).toEqual(["oneBid"]);
  expect(q.numeratorMode).toBe("all");
});

it.each([
  "Show rejected or refused KZK complaints in 2026",
  "Покажи отхвърлени или отказани жалби по ЗОП през 2026",
  "Show KZK decisions and orders in 2026",
  "Покажи актове на КЗК без решения през 2026",
])(
  "multiple or excluded act/outcome categories never silently narrow: %s",
  (text) => {
    expect(understandProcurement(text).kind).toBe("clarification");
  },
);
