// A continuation is a catalog intent, never a question for the text router to
// reinterpret. Missing context means omission, rather than an example entity.
import { STARTERS } from "./starters";
import { questionById } from "../../src/lib/questions/catalog";
import type { Envelope, ToolArgs } from "../tools/types";
import type { Suggestion } from "./suggestions";
import { toChatQuestionIntent } from "./questionAdapter";

export type FollowUp = Suggestion;
export type AnsweredIntent = { tool: string; args?: ToolArgs };
export type FollowUpPolicy = {
  kind: "related" | "none";
  reason: string;
  questionIds: string[];
};

const ENTITY_PARAMS = new Set([
  "party",
  "place",
  "oblast",
  "name",
  "company",
  "agency",
  "chain",
  "person",
  "municipality",
  "school",
  "section",
  "a",
  "b",
]);

// Every registered tool can be evaluated, including a newly added capability
// without a catalog entry. No unrelated domain is used as a fallback.
export const followUpPolicy = (tool: string): FollowUpPolicy => {
  const source = STARTERS.find((s) => s.tool === tool);
  if (!source)
    return {
      kind: "none",
      reason: "No catalog topic for this capability",
      questionIds: [],
    };
  const questionIds = STARTERS.filter((s) => {
    if (
      s.tool === tool ||
      s.category !== source.category ||
      s.subcategory !== source.subcategory
    )
      return false;
    const question = questionById(s.id)!;
    // A generic related question must not smuggle in the catalog's sample entity.
    return !question.parameters.some(
      (p) =>
        ENTITY_PARAMS.has(p.id) ||
        ["person", "company", "place"].includes(p.kind),
    );
  }).map((s) => s.id);
  return {
    kind: questionIds.length ? "related" : "none",
    reason: questionIds.length
      ? "Related questions in the same subtopic"
      : "No entity-free related question in this subtopic",
    questionIds,
  };
};

const value = (env: Envelope, key: string): string | undefined => {
  const v = env.facts?.[key];
  return v != null && String(v).trim() && v !== "—" ? String(v) : undefined;
};
const key = (tool: string, args: ToolArgs = {}): string =>
  JSON.stringify([
    tool,
    Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);

export const followUps = (
  env: Envelope,
  args: ToolArgs = {},
  answered: AnsweredIntent[] = [],
): FollowUp[] => {
  if (env.clarify) return [];
  const out: FollowUp[] = [];
  const add = (
    questionId: string,
    parameters?: ToolArgs,
    labels?: { bg: string; en: string },
  ) => {
    const question = questionById(questionId);
    if (!question || question.chat.status !== "ready") return;
    // Copy only compatible period parameters; make the period visible too.
    const context: ToolArgs = {};
    if (args.election && question.parameters.some((p) => p.id === "election"))
      context.election = args.election;
    if (
      env.tool.startsWith("budget") &&
      question.chat.capabilityId?.startsWith("budget") &&
      args.year &&
      question.parameters.some((p) => p.id === "year")
    )
      context.year = args.year;
    let bg = labels?.bg ?? question.question.bg;
    let en = labels?.en ?? question.question.en;
    if (context.election) {
      const period = String(context.election).replace(/_/g, "-");
      bg = `${bg
        .replace(/последните\s+/gi, "")
        .replace(/последния вот/gi, "вота")
        .replace(/сега/gi, "")
        .trim()} (${period})`;
      en = `${en.replace(/latest |last |now/gi, "").trim()} (${period})`;
    }
    if (context.year) {
      bg = /\b20\d{2}\b/.test(bg)
        ? bg.replace(/\b20\d{2}\b/g, String(context.year))
        : `${bg} (${context.year})`;
      en = /\b20\d{2}\b/.test(en)
        ? en.replace(/\b20\d{2}\b/g, String(context.year))
        : `${en} (${context.year})`;
    }
    out.push({ questionId, parameters: { ...context, ...parameters }, bg, en });
  };
  const party = value(env, "party");
  if (
    party &&
    [
      "partyResult",
      "partyTimeline",
      "partyFinance",
      "regionBreakdown",
      "municipalityBreakdown",
      "settlementBreakdown",
    ].includes(env.tool)
  ) {
    if (env.tool !== "regionBreakdown")
      add(
        "regionBreakdown",
        { party },
        { bg: `Къде е силна ${party}?`, en: `Where is ${party} strongest?` },
      );
    if (env.tool !== "partyTimeline")
      add(
        "partyTimeline",
        { party },
        {
          bg: `Как се представя ${party} през годините?`,
          en: `How has ${party} performed over time?`,
        },
      );
  }
  const place = typeof args.place === "string" ? args.place : undefined;
  const placeLabel =
    value(env, "settlement") ?? value(env, "municipality") ?? place;
  if (
    place &&
    placeLabel &&
    [
      "settlementResults",
      "settlementHistory",
      "municipalityResults",
      "municipalityHistory",
    ].includes(env.tool)
  ) {
    const settlement = env.tool.startsWith("settlement");
    const trend = env.tool.endsWith("History");
    add(
      settlement
        ? trend
          ? "settlementResults"
          : "settlementHistory"
        : trend
          ? "municipalityResults"
          : "municipalityHistory",
      { place, ...(!trend ? { years: 5 } : {}) },
      {
        bg: trend
          ? `Резултати в ${placeLabel}`
          : `Резултати в ${placeLabel} през последните 5 години`,
        en: trend
          ? `Results in ${placeLabel}`
          : `Results in ${placeLabel} over the last 5 years`,
      },
    );
  }
  if (["topContractors", "chainProfile", "contractSearch"].includes(env.tool)) {
    const eik =
      value(env, "top_contractor_eik") ??
      value(env, "eik_id") ??
      value(env, "eik");
    const name =
      value(env, "top_contractor") ??
      value(env, "company") ??
      value(env, "chain");
    if (eik && /^\d{9,13}$/.test(eik) && name) {
      if (env.tool !== "contractSearch")
        add(
          "contractSearch",
          { company: eik },
          {
            bg: `Покажи договорите на ${name}`,
            en: `Show contracts won by ${name}`,
          },
        );
      add(
        "companyConnections",
        { company: eik },
        {
          bg: `Свързана ли е ${name} с депутати?`,
          en: `Is ${name} connected to MPs?`,
        },
      );
    }
  }
  // Snapshot questions retain the selected contest; trend questions say so.
  if (
    [
      "nationalResults",
      "regionBreakdown",
      "machineVoteShare",
      "machineVoteSeries",
    ].includes(env.tool)
  )
    add("turnout", undefined, {
      bg: "Каква беше избирателната активност?",
      en: "What was the election turnout?",
    });
  if (env.tool === "turnout")
    add("machineVoteShare", undefined, {
      bg: "Какъв беше делът на машинното гласуване?",
      en: "What was the machine-voting share?",
    });
  for (const id of followUpPolicy(env.tool).questionIds) add(id);

  const seen = new Set(
    [...answered, { tool: env.tool, args }].map((a) => key(a.tool, a.args)),
  );
  return out
    .filter((s) => {
      const intent = toChatQuestionIntent(s.questionId, "bg", s.parameters);
      const id = key(intent.tool, intent.args);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 3);
};
