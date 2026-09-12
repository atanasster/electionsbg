import { it, expect } from "vitest";
import {
  ROLLCALL_TEMPLATES,
  rollcallTemplate,
  matchRollcallTemplate,
  ROLLCALL_QUESTIONS,
} from "../../src/lib/questions/contracts/rollcall";
import { toChatQuestionIntent } from "./questionAdapter";
import { understandRollcall } from "../orchestrator/rollcallUnderstanding";
import { rollcallTemplateReady } from "./useRollcallCapabilities";
import { ROLLCALL_FOLLOWUPS } from "../../src/lib/rollcallContinuations";
import { rollcallContinuations } from "./rollcallContinuations";
import { resolveFollowOn } from "../orchestrator/router";
import {
  validateRollcallQuery,
  encodeRollcallQuery,
} from "../../src/lib/rollcallQuery";
import type { Envelope } from "../tools/types";
const values = {
  person: "Бойко Рашков",
  personA: "Бойко Рашков",
  personB: "Иван Иванов",
  councillor: "Иван Иванов",
  municipality: "Русе",
  assembly: 52,
  year: 2026,
  yearA: 2025,
  yearB: 2026,
  from: "2025-04-01",
  to: "2026-01-31",
  date: "2026-01-02",
  topic: "budget",
  party: "ГЕРБ-СДС",
  vote: "52:2026-01-02:1",
  resolution: "rse-resolution-1",
};
it.each(ROLLCALL_TEMPLATES)(
  "$id bilingual selector, typed and catalog parameter parity",
  (t) => {
    for (const lang of ["bg", "en"] as const) {
      const params = Object.fromEntries(
        ROLLCALL_QUESTIONS.find(
          (q) => q.id === "rollcall-query-" + t.id,
        )!.parameters.map((p) => [p.id, values[p.id as keyof typeof values]]),
      );
      const intent = toChatQuestionIntent(
        "rollcall-query-" + t.id,
        lang,
        params,
      );
      expect(intent.args).toEqual(
        rollcallTemplate("rollcall-query-" + t.id, lang, params).args,
      );
      expect(intent.text).not.toMatch(/\{\w+\}/);
      const matched = matchRollcallTemplate(intent.text);
      expect(matched).not.toBeNull();
      const understood = understandRollcall(intent.text, {
        catalog: { councils: [{ id: "RSE01", name: "Община Русе" }] },
      });
      expect(understood.kind).toBe("scope");
      if (understood.kind !== "scope") return;
      expect(understood.needs).toBeUndefined();
      expect(understood.draft.corpus).toBe(t.corpus);
      if (params.year) expect(understood.draft.from).toBe("2026-01-01");
    }
  },
);
it("all 28 starters and 20 followups are present, and missing parameters ask rather than broaden", () => {
  expect(ROLLCALL_TEMPLATES).toHaveLength(28);
  expect(ROLLCALL_FOLLOWUPS).toHaveLength(20);
  expect(
    matchRollcallTemplate(rollcallTemplate("rollcall-query-S06", "en").text)
      ?.missing,
  ).toBe("scope");
  expect(rollcallTemplateReady("rollcall-query-S01", null)).toBe(false);
});
it("typed and clicked applicable followups preserve the same canonical scope", () => {
  const p = validateRollcallQuery({
    corpus: "parliamentCasts",
    seatIds: ["52:7"],
    from: "2026-01-01",
    toExclusive: "2027-01-01",
    topicIds: ["budget"],
    expectedRevision: "r",
  });
  if (!p.ok) throw Error();
  const env = {
    tool: "rollcallQuery",
    kind: "table",
    title: "Votes",
    viz: "none",
    facts: {},
    provenance: [],
    rows: [{ key: "52:2026-01-01:1::7" }],
    rollcall: {
      query: p.query,
      result: {
        status: "success",
        revision: "r",
        rows: [{ key: "52:2026-01-01:1::7" }],
      },
    },
  } as Envelope;
  for (const f of rollcallContinuations(env))
    for (const text of [f.bg, f.en]) {
      const route = resolveFollowOn(text, {
        tool: "rollcallQuery",
        args: {
          query: encodeRollcallQuery(p.query),
          records: JSON.stringify(env.rollcall!.result.rows),
        },
      });
      expect(route?.tool).toBe(f.intent?.tool);
      if (route?.tool === "rollcallQuery")
        expect(route.args.query).toBe(f.intent?.args.query);
      else expect(route?.args.previous).toBe(f.intent?.args.previous);
    }
});
it("starter readiness requires its operation and parent detail capability", () => {
  const operations = [
    "list",
    "detail",
    "rank",
    "share",
    "compare",
    "methodology",
  ];
  const cap = {
    version: "rollcall-records-v1",
    corpora: Object.fromEntries(
      [
        "parliamentSessions",
        "parliamentVotes",
        "parliamentCasts",
        "councilSessions",
        "councilResolutions",
        "councilCasts",
      ].map((c) => [
        c,
        {
          ready: true,
          metrics: ["records", "contested", "choiceShare", "agreement"],
          operations,
        },
      ]),
    ),
    councils: [
      { id: "SOF", name: "София", named: 1, resolutions: 1, year_only: false },
    ],
  };
  for (const [id, corpus, operation] of [
    ["S01", "parliamentSessions", "list"],
    ["S11", "parliamentVotes", "detail"],
    ["S12", "parliamentVotes", "rank"],
    ["S13", "parliamentCasts", "share"],
    ["S16", "parliamentVotes", "methodology"],
    ["S27", "councilResolutions", "compare"],
    ["S28", "councilResolutions", "methodology"],
  ]) {
    const actualCorpus = ROLLCALL_TEMPLATES.find((t) => t.id === id)!.corpus;
    expect(rollcallTemplateReady("rollcall-query-" + id, cap), corpus).toBe(
      true,
    );
    expect(
      rollcallTemplateReady("rollcall-query-" + id, {
        ...cap,
        corpora: {
          ...cap.corpora,
          [actualCorpus]: {
            ...cap.corpora[actualCorpus],
            operations: operations.filter((o) => o !== operation),
          },
        },
      }),
    ).toBe(false);
  }
  expect(
    rollcallTemplateReady("rollcall-query-S09", {
      ...cap,
      corpora: {
        ...cap.corpora,
        parliamentVotes: {
          ...cap.corpora.parliamentVotes,
          operations: ["list"],
        },
      },
    }),
  ).toBe(false);
});
it("followups respect final pages, result status, group totals and metric support", () => {
  const make = (
    args: Record<string, unknown>,
    result: Record<string, unknown>,
  ) => {
    const p = validateRollcallQuery({ corpus: "parliamentVotes", ...args });
    if (!p.ok) throw Error(p.errors.join(","));
    return {
      tool: "rollcallQuery",
      kind: "table",
      title: "Votes",
      viz: "none",
      facts: {},
      provenance: [],
      rows: [],
      rollcall: {
        query: p.query,
        result: {
          status: "success",
          revision: "r",
          totals: { records: 70, cohortRecords: 70 },
          ...result,
        },
      },
    } as Envelope;
  };
  const ids = (env: Envelope) =>
    rollcallContinuations(env).map((x) => x.questionId);
  expect(
    ids(make({ limit: 25 }, { totals: { records: 25, cohortRecords: 25 } })),
  ).not.toContain("rollcall-followup-F17");
  for (const status of ["empty", "stale", "unavailable"])
    expect(ids(make({}, { status }))).not.toContain("rollcall-followup-F17");
  expect(
    ids(make({ groupBy: "month", operation: "trend" }, { groupCount: 1 })),
  ).not.toContain("rollcall-followup-F17");
  const next = rollcallContinuations(make({ limit: 25 }, {})).find(
    (x) => x.questionId === "rollcall-followup-F17",
  )!;
  expect(next.en).toBe("Show the next 25.");
  expect(
    ids(
      make(
        {
          corpus: "parliamentCasts",
          seatIds: ["52:7"],
          comparatorSeatIds: ["52:8"],
          metric: "agreement",
        },
        {},
      ),
    ),
  ).not.toContain("rollcall-followup-F11");
});
