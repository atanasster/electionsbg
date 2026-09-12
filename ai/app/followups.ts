import { rollcallContinuations } from "./rollcallContinuations";
import { fundingContinuations } from "./fundingContinuations";
import { procurementContinuations } from "./procurementContinuations";
// A continuation is a catalog intent, never a question for the text router to
// reinterpret. Missing context means omission, rather than an example entity.
import { answerElection } from "../tools/answerContext";
import { STARTERS } from "./starters";
import { questionById } from "../../src/lib/questions/catalog";
import type { Envelope, ToolArgs } from "../tools/types";
import type { Suggestion } from "./suggestions";
import { toChatQuestionIntent } from "./questionAdapter";

export type FollowUp = Suggestion;
/** Tab-completed or copied follow-ups retain the same identity as chip clicks.
 * Only an exact visible-text match is safe; an edited company is a new query. */
export const followUpIntent = (
  text: string,
  lang: "bg" | "en",
  suggestions: FollowUp[],
) => {
  const hit = suggestions.find((s) => s[lang].trim() === text.trim());
  if (hit?.intent) return hit.intent;
  return hit
    ? toChatQuestionIntent(hit.questionId, lang, hit.parameters)
    : undefined;
};
export type AnsweredIntent = { tool: string; args?: ToolArgs };
export type FollowUpPolicy = {
  kind: "related" | "none";
  reason: string;
  questionIds: string[];
};

const ENTITY_PARAMS = new Set([
  "product",
  "inn",
  "eik",
  "awarder",
  "key",
  "contract",
  "producer",
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

// Explicit subject groups. Sharing a catalog subcategory alone is not evidence
// of relevance (a product, a chain and national shopping rankings share one).
const RELATED_TOOLS = [
  ["nationalResults", "parliamentSeats", "seatsHistory"],
  ["turnout", "turnoutSeries", "machineVoteShare", "machineVoteSeries"],
  ["pollAccuracy", "accuracyTrend", "latestPolls"],
  [
    "budgetOverview",
    "budgetTrend",
    "budgetByFunction",
    "budgetExecution",
    "budgetVariance",
  ],
  ["budgetPersonnel", "budgetPersonnelByMinistry", "institutionMaintenance"],
  ["budgetCapitalByMunicipality", "budgetInvestmentPayments"],
  ["municipalTransfers", "budgetMunicipalTransfers", "municipalFiscalRanking"],
  [
    "ngoOverview",
    "ngoTopFunded",
    "ngoConflictAwarders",
    "ngoRiskSignals",
    "ngoBySignal",
  ],
  [
    "judiciaryBudget",
    "judiciaryCaseload",
    "judiciaryWorkload",
    "judiciaryCourtLoad",
  ],
  ["defenseSpending", "defensePeerCompare", "armsExports", "defenseReadiness"],
  ["transportSpending", "transportEuFunds", "railSubsidy"],
  ["socialSpending", "socialPovertyImpact", "socialBenefits"],
  ["environmentSpending", "environmentFunds"],
  ["generationMix", "powerPlants"],
  ["nzokDrugs", "nzokDrugGrowth", "nzokDrugSavings"],
  ["nzokHospitals", "nzokPublicPrivate", "nzokPrivateHospitals"],
  ["procurementTotals", "topContractors"],
  ["procurementRedFlags", "procurementSingleBidSectors", "procurementNormalcy"],
  ["subsidiesOverview", "subsidiesByScheme"],
  [
    "cultureOverview",
    "topCultureGrantees",
    "cultureGrantSuccess",
    "cultureCommissions",
    "cultureMunicipal",
  ],
  ["noiPensionDistribution", "noiPensionByOblast", "noiPensionSeries"],
  ["mpAssetsTop", "mpAssetsByParty"],
  ["priceIndex", "basketVsInflation", "euFoodPriceLevels"],
  ["wastedVotes", "wastedVotesByParty", "wastedVotesTrend"],
  ["diasporaVote", "diasporaVoteTrend"],
  ["mpLoyalty", "mpAttendance", "factionCohesion"],
  ["administrationOverview", "digitalSkills"],
  ["tourismSeasonality", "tourismSourceMarkets"],
];

export const followUpPolicy = (tool: string): FollowUpPolicy => {
  const related = RELATED_TOOLS.find((group) => group.includes(tool)) ?? [];
  const source = STARTERS.find((s) => s.tool === tool);
  const questionIds = STARTERS.filter((s) => {
    if (
      s.tool === tool ||
      !related.includes(s.tool) ||
      s.category !== source?.category ||
      s.subcategory !== source?.subcategory
    )
      return false;
    return !questionById(s.id)!.parameters.some(
      (p) =>
        ENTITY_PARAMS.has(p.id) ||
        ["string", "person", "company", "place"].includes(p.kind),
    );
  }).map((s) => s.id);
  return {
    kind: questionIds.length ? "related" : "none",
    reason: questionIds.length
      ? "Reviewed questions about the same subject"
      : "No reviewed continuation without changing the subject",
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
  if (env.rollcall) return rollcallContinuations(env);
  if (env.funding) return fundingContinuations(env);
  if (env.procurement) return procurementContinuations(env);
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
    const election = answerElection(env, args);
    if (question.parameters.some((p) => p.id === "election")) {
      if (!election) return;
      context.election = election;
    }
    let bg = labels?.bg ?? question.question.bg;
    let en = labels?.en ?? question.question.en;
    for (const id of ["ns", "cycle", "year"]) {
      if (args[id] != null && question.parameters.some((p) => p.id === id))
        context[id] = args[id];
    }
    const window =
      args.years != null ? "years" : args.n != null ? "n" : undefined;
    if (window && question.parameters.some((p) => p.id === window)) {
      context[window] = args[window];
      const bgWindow = `последните ${args[window]} ${window === "years" ? "години" : "избора"}`;
      const enWindow = `last ${args[window]} ${window === "years" ? "years" : "elections"}`;
      const bgPattern = /последните\s+\d+\s+(?:години|избора)/i;
      const enPattern = /last\s+\d+\s+(?:years|elections)/i;
      bg = bgPattern.test(bg)
        ? bg.replace(bgPattern, bgWindow)
        : `${bg} (${bgWindow})`;
      en = enPattern.test(en)
        ? en.replace(enPattern, enWindow)
        : `${en} (${enWindow})`;
    }
    if (context.ns) {
      bg += ` (${context.ns}-о НС)`;
      en += ` (Assembly ${context.ns})`;
    }
    if (context.cycle) {
      bg += ` (${context.cycle})`;
      en += ` (${context.cycle})`;
    }
    if (context.election) {
      const period = String(context.election).replace(/_/g, "-");
      const replaceSampleDate = (text: string) =>
        text.replace(/\b20\d{2}(?:[_-]\d{2}[_-]\d{2})?\b/g, (date) =>
          date.length === 4 ? period.slice(0, 4) : period,
        );
      bg = replaceSampleDate(bg);
      en = replaceSampleDate(en);
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
  if (
    ["personProfile", "personWealth", "personConnections"].includes(env.tool)
  ) {
    const person = value(env, "public_person_id");
    const name = value(env, "name") ?? value(env, "име");
    if (person && name) {
      if (env.tool !== "personWealth")
        add(
          "personWealth",
          { name: person },
          {
            bg: `Какво имущество декларира ${name}?`,
            en: `What assets does ${name} declare?`,
          },
        );
      if (env.tool !== "personConnections")
        add(
          "personConnections",
          { name: person },
          {
            bg: `Какви публични връзки има ${name}?`,
            en: `What public connections does ${name} have?`,
          },
        );
    }
  }
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
      if (
        env.tool !== "contractSearch" &&
        (env.tool !== "chainProfile" ||
          Number(env.facts?.as_supplier_contracts) > 0)
      )
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
          bg: `Свързана ли е ${name} с лица от властта?`,
          en: `Is ${name} connected to public officials?`,
        },
      );
    }
  }
  // Snapshot questions retain the selected contest; trend questions say so.
  if (
    ["nationalResults", "machineVoteShare", "machineVoteSeries"].includes(
      env.tool,
    )
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
  // A scoped answer must not silently widen to a national/default/example subject.
  const scoped = Object.entries(args).some(
    ([id, v]) =>
      v !== undefined &&
      v !== "" &&
      ![
        "election",
        "ns",
        "year",
        "cycle",
        "years",
        "n",
        "limit",
        "top",
      ].includes(id),
  );
  if (!scoped) for (const id of followUpPolicy(env.tool).questionIds) add(id);

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
