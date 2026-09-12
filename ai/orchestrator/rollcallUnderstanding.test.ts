import { describe, it, expect } from "vitest";
import {
  understandRollcall,
  rollcallDates,
  rollcallCorpus,
} from "./rollcallUnderstanding";
const catalog = {
  councils: [
    { id: "RSE01", name: "Русе" },
    { id: "BGS01", name: "Бургас" },
  ],
};
describe("legislative prompt parameters", () => {
  it.each([
    [
      "покажи ми последните заседания на парламента",
      "parliamentSessions",
      undefined,
    ],
    [
      "покажи ми последните гласувания в парламента",
      "parliamentVotes",
      undefined,
    ],
    [
      "Кои са последните 10 гласувания на Бойко Рашков?",
      "parliamentCasts",
      "Бойко Рашков",
    ],
    [
      "What are Boyko Rashkov's last 10 votes?",
      "parliamentCasts",
      "Boyko Rashkov",
    ],
    [
      "Как гласува Бойко Рашков по бюджета през 2026?",
      "parliamentCasts",
      "Бойко Рашков",
    ],
    [
      "How did Boyko Rashkov vote on healthcare in 2026?",
      "parliamentCasts",
      "Boyko Rashkov",
    ],
    [
      "Как гласува съветникът Иван Иванов в Русе за бюджета през 2025?",
      "councilCasts",
      "Иван Иванов",
    ],
    [
      "How did councillor Ivan Ivanov vote in Ruse on the budget in 2025?",
      "councilCasts",
      "Ivan Ivanov",
    ],
  ])("%s", (question, corpus, name) => {
    const r = understandRollcall(question, { catalog });
    expect(r.kind).toBe("scope");
    if (r.kind !== "scope") return;
    expect(r.draft.corpus).toBe(corpus);
    expect(r.needs).toBeUndefined();
    if (name) expect(r.names).toEqual([name]);
    else expect(r.draft.keyword).toBeUndefined();
  });
  it.each([
    ["от 04/2025 до 01/2026", "2025-04-01", "2026-02-01"],
    ["през 2026", "2026-01-01", "2027-01-01"],
    ["от 28/02/2024 до 29/02/2024", "2024-02-28", "2024-03-01"],
    ["last month", "2026-08-01", "2026-09-01"],
    ["today", "2026-09-13", "2026-09-14"],
  ])("dates %s", (s, from, toExclusive) =>
    expect(rollcallDates(s, new Date("2026-09-12T22:30:00Z"))).toMatchObject({
      from,
      toExclusive,
    }),
  );
  it.each([
    "31/02/2026",
    "от 02/2026 до 01/2026",
    "2026-01-30 to 2026-01-01",
    "13/2026",
  ])("rejects invalid dates %s", (s) =>
    expect(rollcallDates(s).invalid).toBe(true),
  );
  it("captures topics and body independently", () => {
    const r = understandRollcall(
      "Покажи решенията на общинския съвет в Русе за бюджета през 2025",
      { catalog },
    );
    expect(r).toMatchObject({
      draft: {
        councilIds: ["RSE01"],
        topicIds: ["budget"],
        from: "2025-01-01",
        toExclusive: "2026-01-01",
      },
    });
  });
  it("asks for a council instead of defaulting to a city", () =>
    expect(
      understandRollcall("Покажи последните решения на общинския съвет"),
    ).toMatchObject({ needs: "council" }));
  it.each([
    "парламентарни избори 2026",
    "municipal council election seats",
    "Как гласува Висшият съдебен съвет?",
  ])("excludes %s", (s) => expect(rollcallCorpus(s)).toBeNull());
});
it.each([
  "Кой е председателят на парламента?",
  "How many members does parliament have?",
  "Покажи състава на общинския съвет",
  "Кой депутат гласува като Бойко Борисов?",
])("preserves non-record intent %s", (s) =>
  expect(rollcallCorpus(s)).toBeNull(),
);
it.each([
  "Как гласува Бойко Рашков по Изборния кодекс през 2026?",
  "Show parliamentary votes on the Election Code",
])("keeps legislative election-code topic %s", (s) =>
  expect(understandRollcall(s)).toMatchObject({ kind: "scope" }),
);
it.each(["Only April through June 2026", "Само от април до юни 2026"])(
  "named month window %s",
  (s) =>
    expect(rollcallDates(s)).toMatchObject({
      from: "2026-04-01",
      toExclusive: "2026-07-01",
    }),
);
it("mixed endpoint formats keep textual order", () =>
  expect(rollcallDates("от 01/04/2026 до 2026-06-30")).toMatchObject({
    from: "2026-04-01",
    toExclusive: "2026-07-01",
  }));
it("oversized relative windows fail before Date arithmetic", () =>
  expect(rollcallDates("last 999999999999999999999999999 days").invalid).toBe(
    true,
  ));
it.each([
  "Как гласува общинският съвет по бюджета в Русе?",
  "How did the council vote on the budget in Ruse?",
])("institution is not a person %s", (s) =>
  expect(
    understandRollcall(s, {
      catalog: { councils: [{ id: "RSE01", name: "Община Русе" }] },
    }),
  ).toMatchObject({
    draft: {
      corpus: "councilResolutions",
      councilIds: ["RSE01"],
      topicIds: ["budget"],
    },
    names: [],
  }),
);
it("Sofia alias maps the actual capital label", () =>
  expect(
    understandRollcall("Покажи решенията на общинския съвет в София", {
      catalog: { councils: [{ id: "SOF", name: "Столична община" }] },
    }),
  ).toMatchObject({ draft: { councilIds: ["SOF"] } }));
it("who voted against needs a record", () =>
  expect(understandRollcall("Кой гласува против?")).toMatchObject({
    needs: "record",
  }));
it("an explicit city replaces a previous council", () => {
  const first = understandRollcall(
    "Покажи решенията на общинския съвет в Бургас",
    { catalog },
  );
  if (first.kind !== "scope") throw Error();
  const second = understandRollcall(
    "Покажи решенията на общинския съвет в Русе",
    {
      catalog: {
        councils: [
          { id: "BGS01", name: "Община Бургас" },
          { id: "RSE01", name: "Община Русе" },
        ],
      },
      previous:
        first.draft as import("../../src/lib/rollcallQuery").RollcallQuery,
    },
  );
  expect(second).toMatchObject({ draft: { councilIds: ["RSE01"] } });
});
