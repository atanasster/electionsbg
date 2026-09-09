/**
 * Build the review inventory for the shared chat/SQL question catalog.
 *
 * This is intentionally conservative: topic adjacency never becomes a claim
 * that a question is answerable. The output records current runtime support,
 * editorial review work, and SQL-library support as separate surfaces.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { TOOLS } from "../../ai/tools/registry";
import { STARTERS } from "../../ai/app/starters";
import { ALL_QUERIES } from "../../src/screens/dev/sqlLibrary";

type Status = "ready" | "review" | "unavailable";

type MatrixRow = {
  id: string;
  origin: "chat-starter" | "editorial" | "sql-library";
  category: string;
  subcategory: string;
  question: { bg?: string; en?: string };
  chat: { status: Status; capability?: string; reason?: string };
  sql: {
    status: Status;
    capability?: string;
    legacyId?: string;
    reason?: string;
  };
  parameters: string[];
  sources: string[];
  measure: string;
  grain: string;
  gap: string | null;
  plannedStep: number | null;
  aliases: string[];
};

export type CapabilityMatrix = {
  generatedAt: string;
  scope: string;
  summary: Record<string, number>;
  sourceGroups: Array<{
    id: string;
    label: unknown;
    status: "covered" | "partial" | "unavailable" | "review";
    disposition: string;
  }>;
  questions: MatrixRow[];
};

type EditorialQuestion = {
  id: string;
  category: string;
  subcategory: string;
  bg: string;
  relatedTools: string[];
};

type Probe = {
  tool: string;
  active: boolean;
  responses?: Array<{ provenance?: string[] }>;
};

const readJson = <T>(path: string): T =>
  JSON.parse(fs.readFileSync(path, "utf8")) as T;

const sqlTopic: Record<string, [string, string]> = {
  "top-contractors": ["procurement", "contracts"],
  "companies-by-all-public-money": ["business", "ownership"],
  "contractors-ranked-and-scoped": ["procurement", "contracts"],
  "top-awarders": ["procurement", "contracts"],
  "where-a-buyer-sits": ["procurement", "local"],
  "biggest-tenders": ["procurement", "tenders"],
  "forecast-vs-actual": ["procurement", "contracts"],
  "one-buyer-s-procurement-profile": ["procurement", "local"],
  "single-bidder-contracts": ["procurement", "competition"],
  "riskiest-buyers": ["procurement", "competition"],
  "appeals-and-how-they-ended": ["procurement", "control"],
  "find-a-person": ["institutions", "cabinet"],
  "a-person-s-declared-wealth-by-year": ["business", "assets"],
  "money-declared-abroad": ["business", "assets"],
  "who-owns-a-company": ["business", "ownership"],
  "officers-of-a-company": ["business", "ownership"],
  "politically-connected-companies": ["business", "ownership"],
  "companies-registered-in-a-place": ["demographics", "my-area"],
  "municipal-financial-health": ["public-money", "municipal"],
  "what-is-open-right-now": ["funds", "calls"],
  "base-rates-for-a-procedure": ["funds", "calls"],
  "clean-delivery-register": ["funds", "projects"],
  "interreg-operations": ["funds", "regional"],
  "bulgarian-interreg-partners": ["funds", "regional"],
  "voting-twins": ["institutions", "parliament"],
  "party-cohesion": ["institutions", "parliament"],
  "a-day-in-the-chamber": ["institutions", "parliament"],
  "what-the-health-fund-pays-each-hospital": ["health", "hospitals"],
  "medicine-reimbursement-by-molecule": ["health", "medicines"],
  "contractors-in-the-registry": ["business", "ownership"],
  "both-contracts-and-eu-funds": ["funds", "projects"],
  "officials-who-hold-company-roles": ["business", "ownership"],
  "hospitals-that-also-buy": ["health", "hospitals"],
  "name-search": ["business", "ownership"],
  "unified-search": ["data-coverage", "search"],
  "what-changed-recently": ["data-coverage", "freshness"],
  "corpus-sizes": ["data-coverage", "coverage"],
};

const sqlChatLinks: Record<string, string> = {
  "top-contractors": "topContractors",
  "riskiest-buyers": "procurementRedFlags",
  "appeals-and-how-they-ended": "procurementAppeals",
  "a-person-s-declared-wealth-by-year": "personWealth",
  "politically-connected-companies": "companyConnections",
  "municipal-financial-health": "municipalFiscalProfile",
  "what-is-open-right-now": "openCalls",
  "interreg-operations": "fundsOverview",
  "voting-twins": "mpSimilarity",
  "party-cohesion": "factionCohesion",
  "a-day-in-the-chamber": "voteSearch",
  "what-the-health-fund-pays-each-hospital": "nzokHospitals",
  "medicine-reimbursement-by-molecule": "nzokDrugs",
};

const sqlParams: Record<string, string[]> = {
  "one-buyer-s-procurement-profile": ["awarderEik", "limit"],
  "find-a-person": ["personQuery", "limit"],
  "a-person-s-declared-wealth-by-year": ["personId", "limit"],
  "who-owns-a-company": ["eik", "limit"],
  "officers-of-a-company": ["eik", "limit"],
  "companies-registered-in-a-place": ["ekatte", "limit"],
  "municipal-financial-health": ["year", "quarter", "limit"],
  "base-rates-for-a-procedure": ["procedureCode", "limit"],
  "a-day-in-the-chamber": ["date", "limit"],
  "name-search": ["query", "limit"],
  "unified-search": ["query", "limit"],
};

const relations = (sql: string): string[] => {
  const withoutComments = sql.replace(/--.*$/gm, " ");
  return [...withoutComments.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((v, i, a) => a.indexOf(v) === i);
};

const stepForCategory = (category: string): number => {
  if (["public-money", "business", "procurement"].includes(category)) return 7;
  if (["elections", "water-environment", "education"].includes(category))
    return 8;
  if (
    ["funds", "health", "institutions", "transport-housing"].includes(category)
  )
    return 9;
  return 10;
};

const toolByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

const grainFor = (parameters: string[], category: string): string => {
  if (parameters.includes("section")) return "polling section × election";
  if (parameters.includes("settlement")) return "settlement × period";
  if (parameters.includes("municipality") || parameters.includes("place"))
    return "requested place × period; geographic level must be resolved";
  if (parameters.includes("region"))
    return category === "elections"
      ? "electoral district (MIR) × election"
      : "administrative oblast × period";
  if (parameters.some((p) => /person|mp|candidate/i.test(p)))
    return "one resolved person × period";
  if (parameters.some((p) => /eik|company|contractor|entity/i.test(p)))
    return "one resolved legal entity × period";
  if (parameters.some((p) => /year|quarter|date|election|period/i.test(p)))
    return "national or corpus aggregate × explicit period";
  return "national or corpus aggregate at the capability's declared period";
};

const plannedSqlStep = (
  category: string,
  sources: string[],
  hasExistingRecipe: boolean,
): number => {
  if (hasExistingRecipe) return 4;
  if (
    category === "elections" ||
    category === "water-environment" ||
    category === "education"
  )
    return 8;
  if (sources.length > 0 && sources.every((s) => s.startsWith("db:"))) return 4;
  return stepForCategory(category);
};

const sourceAssessments = (markdown: string): Map<string, string> => {
  const result = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\| ([a-z0-9_]+) \| .*? \| (.+) \|$/);
    if (match) result.set(`src:${match[1]}`, match[2].trim());
  }
  return result;
};

export const buildQuestionCapabilityMatrix = (): CapabilityMatrix => {
  const probes = readJson<{ results: Probe[] }>(
    "docs/audits/ai-chat-starter-execution.json",
  ).results;
  const probeByTool = new Map(probes.map((p) => [p.tool, p]));
  const editorial = readJson<{ questions: EditorialQuestion[] }>(
    "docs/audits/bulgarian-civic-questions.json",
  ).questions;
  const rows: MatrixRow[] = [];
  const reverseSqlLinks = new Map(
    Object.entries(sqlChatLinks).map(([sqlId, tool]) => [tool, sqlId]),
  );

  for (const starter of STARTERS) {
    const probe = probeByTool.get(starter.tool);
    const sources = [
      ...new Set(probe?.responses?.flatMap((r) => r.provenance ?? []) ?? []),
    ];
    const parameters = [
      ...new Set(
        Object.values(starter.args).flatMap((args) => Object.keys(args)),
      ),
    ];
    const tool = toolByName.get(starter.tool);
    const sqlId = reverseSqlLinks.get(starter.tool);
    rows.push({
      id: `chat:${starter.id}`,
      origin: "chat-starter",
      category: starter.category,
      subcategory: starter.subcategory,
      question: { bg: starter.bg, en: starter.en },
      chat: { status: "ready", capability: starter.tool },
      sql: {
        status: "review",
        capability: sqlId,
        legacyId: sqlId,
        reason: sqlId
          ? "Related SQL exists; parameter, measure, grain and coverage parity is not reviewed."
          : "No SQL recipe has been semantically paired in the current catalog.",
      },
      parameters,
      sources,
      measure:
        tool?.description.bg ??
        `Runtime output of the ${starter.tool} capability; metadata missing.`,
      grain: grainFor(parameters, starter.category),
      gap: "SQL measure, grain, parameter and coverage parity review",
      plannedStep: plannedSqlStep(starter.category, sources, false),
      aliases: sqlId ? [`sql:${sqlId}`] : [],
    });
  }

  for (const q of editorial) {
    const direct = STARTERS.find((s) => s.bg === q.bg);
    rows.push({
      id: `editorial:${q.id}`,
      origin: "editorial",
      category: q.category,
      subcategory: q.subcategory,
      question: { bg: q.bg },
      chat: direct
        ? { status: "ready", capability: direct.tool }
        : {
            status: "review",
            reason:
              "Editorial question has not passed exact tool, argument and output validation.",
          },
      sql: {
        status: "review",
        reason:
          "Editorial question has not passed schema, recipe and result validation.",
      },
      parameters: [],
      sources: [],
      measure: `Unresolved editorial measure for: ${q.bg}`,
      grain: `Unresolved editorial grain in ${q.category}/${q.subcategory}`,
      gap: direct ? "SQL parity review" : "Capability and evidence review",
      plannedStep: direct ? 4 : stepForCategory(q.category),
      aliases: direct ? [`chat:${direct.id}`] : [],
    });
  }

  for (const query of ALL_QUERIES) {
    const [category, subcategory] = sqlTopic[query.id] ?? [
      "data-coverage",
      "unclassified",
    ];
    const chatTool = sqlChatLinks[query.id];
    const parameters = sqlParams[query.id] ?? ["limit"];
    rows.push({
      id: `sql:${query.id}`,
      origin: "sql-library",
      category,
      subcategory,
      question: { en: query.answers },
      chat: chatTool
        ? {
            status: "review",
            capability: chatTool,
            reason:
              "Related tool exists or is planned; semantic and parameter parity is not reviewed.",
          }
        : {
            status: "review",
            reason:
              "No semantically equivalent chat capability has been confirmed.",
          },
      sql: { status: "ready", capability: query.id, legacyId: query.id },
      parameters,
      sources: relations(query.sql).map((r) => `db:${r}`),
      measure: query.answers,
      grain: grainFor(parameters, category),
      gap: chatTool
        ? "Chat/SQL measure, grain, parameter and coverage parity review"
        : "Chat capability review",
      plannedStep: 4,
      aliases: chatTool ? [`chat:${chatTool}`] : [],
    });
  }

  const assessments = sourceAssessments(
    fs.readFileSync("docs/audits/ai-chat-audit-2026-09-09.md", "utf8"),
  );
  const sourceAudit = readJson<{
    sources: Array<{ id: string; label: unknown }>;
  }>("docs/audits/ai-chat-wiring.json").sources.map((source) => {
    const disposition = assessments.get(source.id);
    if (!disposition)
      throw new Error(`Missing source-specific assessment for ${source.id}`);
    const lower = disposition.toLowerCase();
    const status =
      /no dedicated|no general|missing|incomplete|partial|limited/.test(lower)
        ? "partial"
        : /unavailable/.test(lower)
          ? "unavailable"
          : /present|extensive|broad|included/.test(lower)
            ? "covered"
            : "review";
    return { id: source.id, label: source.label, status, disposition } as const;
  });

  return {
    generatedAt: new Date().toISOString(),
    scope:
      "Inventory only. ready is surface-specific; aliases are review links and never establish semantic equivalence.",
    summary: {
      rows: rows.length,
      chatStarters: STARTERS.length,
      editorialQuestions: editorial.length,
      sqlQueries: ALL_QUERIES.length,
      sourceGroups: sourceAudit.length,
    },
    sourceGroups: sourceAudit,
    questions: rows,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = buildQuestionCapabilityMatrix();
  fs.writeFileSync(
    "docs/audits/question-capability-matrix.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result.summary, null, 2));
}
