import { it, expect, vi, beforeEach } from "vitest";
vi.mock("./dataClient", () => ({ fetchDb: vi.fn() }));
import { fetchDb } from "./dataClient";
import { rollcallQuestion, rollcallQuery } from "./rollcall";
import {
  validateRollcallQuery,
  encodeRollcallQuery,
} from "../../src/lib/rollcallQuery";
import { parseModelRoute } from "../orchestrator/routeScope";
import type { ToolContext } from "./types";
const ctx = { lang: "bg", election: "2024_10_27" } as ToolContext;
const mock = vi.mocked(fetchDb);
beforeEach(() => mock.mockReset());
it("resolves verified composite seats before executing latest person votes", async () => {
  mock.mockImplementation(async (route, args) => {
    if (route === "rollcall-catalog") return {};
    if (route === "rollcall-entities")
      return {
        candidates: [
          {
            label: "Бойко Илиев Рашков",
            verified: true,
            seatIds: ["51:7", "52:8"],
          },
        ],
      };
    if (route !== "rollcall-query") return {};
    const query = JSON.parse(String(args?.query));
    expect(query.seatIds).toEqual(["51:7", "52:8"]);
    expect(query.latestN).toBe(10);
    return {
      status: "success",
      query,
      rows: [],
      totals: { records: 10, cohortRecords: 10 },
      coverage: { latestIndexed: "2026-01-01" },
      revision: "r",
    };
  });
  const r = await rollcallQuestion(
    { question: "Кои са последните 10 гласувания на Бойко Рашков?" },
    ctx,
  );
  expect(r.rollcall?.query.seatIds).toEqual(["51:7", "52:8"]);
  expect(r.facts.answer).toContain("10");
});
it("ambiguous names never execute a broad query", async () => {
  mock.mockImplementation(async (route) =>
    route === "rollcall-catalog"
      ? {}
      : {
          candidates: [
            { label: "Иван Иванов", verified: false, seatIds: ["52:1"] },
            { label: "Иван Иванов", verified: false, seatIds: ["52:2"] },
          ],
        },
  );
  const r = await rollcallQuestion(
    { question: "Как гласува Иван Иванов през 2026?" },
    ctx,
  );
  expect(r.clarify?.options).toHaveLength(2);
  expect(mock.mock.calls.map((c) => c[0])).not.toContain("rollcall-query");
});
it("rejects backend scope drift", async () => {
  const q = validateRollcallQuery({
    corpus: "parliamentVotes",
    from: "2026-01-01",
    toExclusive: "2027-01-01",
  });
  if (!q.ok) throw Error();
  mock.mockResolvedValue({
    status: "success",
    query: { ...q.query, from: "2025-01-01" },
    rows: [],
    totals: { records: 1 },
  });
  expect(
    (await rollcallQuery({ query: encodeRollcallQuery(q.query) }, ctx)).facts
      .status,
  ).toBe("unsupported");
});
it("provider routing retains full legislative question despite an unrelated model tool", () => {
  const question = "покажи ми последните гласувания в парламента";
  expect(
    parseModelRoute('{"tool":"voteSearch","args":{"query":"all"}}', question),
  ).toEqual({
    tool: "rollcallQuestion",
    args: { question, corpus: "parliamentVotes" },
  });
});
it("a newly named person replaces inherited seats and preserves resolver revision", async () => {
  const old = validateRollcallQuery({
    corpus: "parliamentCasts",
    seatIds: ["52:1"],
  });
  if (!old.ok) throw Error();
  mock.mockImplementation(async (route, args) => {
    if (route === "rollcall-catalog") return {};
    if (route === "rollcall-entities")
      return {
        candidates: [
          { label: "Друг Човек", verified: true, seatIds: ["52:2"] },
        ],
        revision: "identity-r",
      };
    if (route !== "rollcall-query") return {};
    const query = JSON.parse(String(args?.query));
    expect(query.seatIds).toEqual(["52:2"]);
    expect(query.expectedRevision).toBe("identity-r");
    return {
      status: "stale",
      reason: "revision_changed",
      query,
      revision: "new-r",
    };
  });
  const r = await rollcallQuestion(
    {
      question: "Как гласува Друг Човек през 2026?",
      previous: encodeRollcallQuery(old.query),
    },
    ctx,
  );
  expect(r.rollcall?.result.status).toBe("stale");
});
it("chooser carries identity revision", async () => {
  mock.mockImplementation(async (route) =>
    route === "rollcall-catalog"
      ? {}
      : {
          candidates: [
            { label: "Иван Иванов", verified: false, seatIds: ["52:1"] },
          ],
          revision: "choice-r",
        },
  );
  const env = await rollcallQuestion(
    { question: "Как гласува Иван Иванов през 2026?" },
    ctx,
  );
  expect(String(env.clarify?.options[0].args.previous)).toContain("choice-r");
});
it("a continuation guard cannot fall through into a broad query", async () => {
  const { resolveFollowOn } = await import("../orchestrator/router");
  const p = validateRollcallQuery({
    corpus: "parliamentVotes",
    expectedRevision: "r",
  });
  if (!p.ok) throw Error();
  const route = resolveFollowOn("Show everyone who voted on the second one.", {
    tool: "rollcallQuery",
    args: { query: encodeRollcallQuery(p.query), records: "[]" },
  });
  expect(route?.args.issue).toBe("record");
  const env = await rollcallQuestion(route!.args, ctx);
  expect(env.facts.status).toBe("unsupported");
  expect(mock).not.toHaveBeenCalled();
});
it("coverage discovery preserves year-only boundaries and limitation", async () => {
  mock.mockResolvedValue({
    revision: "r",
    councils: [
      {
        id: "HKV34",
        name: "Хасково",
        first: "2022-01-01",
        latest: "2022-01-01",
        year_only: true,
        resolutions: 387,
        named: 0,
      },
    ],
  });
  const env = await rollcallQuery(
    { corpus: "councilResolutions", operation: "methodology" },
    ctx,
  );
  expect(JSON.stringify(env.rows)).not.toContain("2022-01-01");
  expect(env.rows?.[0]).toMatchObject({
    first: "2022",
    latest: "2022",
    precision: "Само година",
  });
});
it("sessions expose ordered meaningful columns rather than null cast/tally fields", async () => {
  mock.mockResolvedValue({
    status: "success",
    revision: "r",
    rows: [
      {
        key: "52:2026-09-11",
        date: "2026-09-11",
        item_count: 1,
        title: null,
        name: null,
        choice: null,
        yes: null,
        no: null,
      },
    ],
    totals: { records: 1, cohortRecords: 1 },
    coverage: {},
  });
  const env = await rollcallQuery({ corpus: "parliamentSessions" }, ctx);
  expect(env.columns?.map((c) => c.key)).toEqual(["date", "item_count"]);
});
it("coverage discovery respects revision guards", async () => {
  mock.mockResolvedValue({
    revision: "new",
    assemblies: [{ id: "52", sessions: 1 }],
  });
  const env = await rollcallQuery(
    {
      corpus: "parliamentSessions",
      operation: "methodology",
      expectedRevision: "old",
    },
    ctx,
  );
  expect(env.rollcall?.result.status).toBe("stale");
});
it("coverage register pages deterministically without repeating all bodies", async () => {
  mock.mockResolvedValue({
    revision: "r",
    councils: Array.from({ length: 16 }, (_, i) => ({
      id: "C" + i,
      name: "Council " + i,
      resolutions: 1,
    })),
  });
  const first = await rollcallQuery(
    { corpus: "councilResolutions", operation: "methodology", limit: 10 },
    ctx,
  );
  const next = await rollcallQuery(
    {
      corpus: "councilResolutions",
      operation: "methodology",
      limit: 10,
      offset: 10,
      expectedRevision: "r",
    },
    ctx,
  );
  expect(first.rows).toHaveLength(10);
  expect(next.rows).toHaveLength(6);
  expect(new Set([...first.rows!, ...next.rows!].map((r) => r.id)).size).toBe(
    16,
  );
  expect(next.rollcall?.result.totals?.records).toBe(16);
});
it.each(["bg", "en"] as const)(
  "empty resolver results explain how to refine without an empty chooser (%s)",
  async (lang) => {
    for (const reason of ["too_many_people", undefined]) {
      mock.mockReset();
      mock.mockImplementation(async (route) =>
        route === "rollcall-catalog" ? {} : { candidates: [], reason },
      );
      const r = await rollcallQuestion(
        {
          question: "Покажи последните гласувания на Иван Иванов в парламента",
        },
        { ...ctx, lang },
      );
      expect(r.clarify).toBeUndefined();
      expect(r.facts.answer).toContain(
        reason
          ? lang === "bg"
            ? "трите имена"
            : "full name"
          : lang === "bg"
            ? "Няма съвпадащо лице"
            : "No matching person",
      );
      expect(
        mock.mock.calls.some(([route]) => route === "rollcall-query"),
      ).toBe(false);
    }
  },
);
