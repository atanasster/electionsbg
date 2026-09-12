import { fetchDb } from "./dataClient";
import { understandProcurement } from "../orchestrator/procurementUnderstanding";
import {
  validateProcurementQuery,
  decodeProcurementQuery,
  type ProcurementQuery,
  PROCUREMENT_BUYER_SECTORS,
  PROCUREMENT_SUBJECTS,
} from "../../src/lib/procurementQuery";
import { procurementQueryParams } from "./procurementQueryContract";
import type { Envelope, ToolArgs, ToolContext, ToolDef } from "./types";
export type ProcurementResult = {
  status: "success" | "empty" | "partial" | "unavailable" | "unsupported";
  query?: ProcurementQuery;
  populationVersion?: string;
  reason?: string;
  revision?: Record<string, string>;
  riskCatalog?: string;
  warnings?: string[];
  totals?: Record<string, number | string | null>;
  comparison?: Record<string, number | string | null>;
  rows?: Record<string, string | number | null>[];
  groups?: Record<string, string | number | null>[];
};
const units = {
  contracts: { bg: "Договорни записи", en: "Contract records" },
  amendments: { bg: "Изменения на договори", en: "Amendment events" },
  tenders: { bg: "Процедури", en: "Procedures" },
  appeals: { bg: "Жалби", en: "Complaints" },
  decisions: { bg: "Актове на КЗК", en: "KZK acts" },
};
export const procurementScope = (
  q: ProcurementQuery,
  ctx: ToolContext,
): string => {
  const bg = ctx.lang === "bg";
  return [
    units[q.corpus][ctx.lang],
    `${q.from || "…"} ≤ ${q.dateBasis} < ${q.toExclusive || "…"}`,
    ...(q.buyerSectors || []).map(
      (id) => PROCUREMENT_BUYER_SECTORS[id].label[ctx.lang],
    ),
    ...(q.subjectSectors || []).map(
      (id) => PROCUREMENT_SUBJECTS[id].label[ctx.lang],
    ),
    q.buyerIds?.length
      ? `${bg ? "Възложител" : "Buyer"}: ${q.buyerIds.join(", ")}`
      : "",
    q.supplierIds?.length
      ? `${bg ? "Изпълнител" : "Supplier"}: ${q.supplierIds.join(", ")}`
      : "",
    q.cpvPrefixes?.length ? "CPV " + q.cpvPrefixes.join(", ") : "",
    q.topic || "",
    q.keyword || "",
    ...(q.basePredicates || []),
    ...(q.numeratorPredicates || []),
    q.status || "",
  ]
    .filter(Boolean)
    .join(" · ");
};
export async function procurementQuery(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> {
  const parsed = validateProcurementQuery(args);
  if (!parsed.ok)
    throw Error(
      "Invalid procurement query: " + Object.keys(parsed.errors).join(", "),
    );
  const q = parsed.query,
    bg = ctx.lang === "bg";
  const base: Envelope = {
    tool: "procurementQuery",
    kind: "scalar",
    title: units[q.corpus][ctx.lang],
    subtitle: procurementScope(q, ctx),
    viz: "none",
    facts: { scope: procurementScope(q, ctx) },
    provenance: ["db:procurement-query"],
  };
  if (q.operation === "methodology")
    return {
      ...base,
      facts: {
        ...base.facts,
        answer: bg
          ? "Договорните записи изключват членските редове на обединения. Неизвестните проверки не са отрицателни; рисковете са индикатори, а не доказателства за нарушение."
          : "Contract records exclude consortium-member rows. Unknown checks are not negative results; risk indicators are not proof of wrongdoing.",
      },
    };
  const result = await fetchDb<ProcurementResult>("procurement-query", {
    query: JSON.stringify(q),
  });
  base.procurement = { query: q, result };
  if (!result.totals || ["unavailable", "unsupported"].includes(result.status))
    return {
      ...base,
      facts: {
        ...base.facts,
        status: result.status,
        answer: bg
          ? "Справката не е налична за този обхват. Филтрите са запазени."
          : "This query is unavailable for the requested scope. Its filters are preserved.",
      },
    };
  const t = result.totals;
  const n = Number(t.numerator),
    den = Number(
      t[
        q.denominator === "positiveKnown"
          ? "positive_known"
          : q.denominator === "evaluable"
            ? "evaluable"
            : q.denominator === "merits"
              ? "merits"
              : "records"
      ],
    );
  const format = (value: number) =>
    new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
      maximumFractionDigits: 2,
    }).format(value);
  const value =
    q.operation === "share"
      ? den > 0 && !(result.status === "partial" && Number(t.evaluable) === 0)
        ? (100 * n) / den
        : null
      : q.metric === "value"
        ? t.value_eur === null
          ? null
          : Number(t.value_eur)
        : q.metric === "cri"
          ? t.mean_cri === null
            ? null
            : Number(t.mean_cri)
          : q.metric === "riskCount"
            ? t.mean_risk_count === null
              ? null
              : Number(t.mean_risk_count)
            : q.numeratorPredicates?.length ||
                ["oneBid", "risk", "appealed", "upheld", "suspended"].includes(
                  q.metric,
                )
              ? n
              : Number(t.records);
  const answer =
    value === null
      ? bg
        ? "Няма достатъчно известни данни за показателя."
        : "Insufficient known data for this metric."
      : q.operation === "share"
        ? `${format(value)}% (${format(n)} / ${format(den)})`
        : `${format(value)}${q.metric === "value" ? " EUR" : ""}`;
  base.facts = {
    ...base.facts,
    status: result.status,
    answer,
    records: Number(t.records),
    ...(q.operation === "share"
      ? { numerator: n, denominator: den, denominator_basis: q.denominator }
      : {}),
    ...(t.missing_bids !== undefined
      ? { missing_bids: Number(t.missing_bids), zero_bids: Number(t.zero_bids) }
      : {}),
    ...(t.evaluable !== undefined ? { evaluable: Number(t.evaluable) } : {}),
    ...(t.value_eur != null ? { current_value_eur: String(t.value_eur) } : {}),
    ...(t.numerator_value_eur != null
      ? { matching_value_eur: String(t.numerator_value_eur) }
      : {}),
    ...(t.unlinked != null ? { unlinked: Number(t.unlinked) } : {}),
    ...(t.interim_requested != null
      ? { interim_requested: Number(t.interim_requested) }
      : {}),
    value_basis: q.valueBasis,
    population: "procurement-records-v1",
  };
  if (result.warnings?.includes("current_cancellation_state"))
    base.facts.cancellation = bg
      ? "Отмяната е по текущото състояние в регистъра."
      : "Cancellation reflects the current register state.";
  if (["appeals", "decisions"].includes(q.corpus))
    base.facts.outcome_note = bg
      ? "Уважените изходи може да включват частични/смесени актове; не доказват пълен успех на всяка страна."
      : "Recorded upheld outcomes may include partial/mixed acts; they do not establish full success for each party.";
  if (value !== null) base.value = value;
  const rows =
    q.groupBy || q.operation === "trend" ? result.groups : result.rows;
  if (
    ["list", "detail", "rank", "trend"].includes(q.operation) &&
    rows?.length
  ) {
    base.kind = "table";
    base.rows = rows;
    const names =
      q.groupBy || q.operation === "trend"
        ? ["group_key", "records", "numerator", "value_eur"]
        : ["key", "title", "date", "buyer", "amount_eur"];
    base.columns = names.map((key) => ({
      key,
      label: key,
      numeric: ["records", "numerator"].includes(key),
    }));
  }
  return base;
}
export async function procurementQuestion(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> {
  const previous =
    typeof args.previous === "string"
      ? decodeProcurementQuery(args.previous)
      : null;
  if (previous && !previous.ok)
    return {
      tool: "procurementQuestion",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? "Невалиден предишен обхват"
          : "Invalid previous scope",
      viz: "none",
      facts: {
        answer:
          ctx.lang === "bg"
            ? "Предишният обхват не може да се възстанови. Задайте целия въпрос отново."
            : "The previous scope cannot be restored. Please restate the complete question.",
      },
      provenance: [],
    };
  const result = understandProcurement(String(args.question || ""), {
    previous: previous?.ok ? previous.query : undefined,
    lang: ctx.lang,
  });
  if (result.kind === "query") return procurementQuery(result.query, ctx);
  const message =
    result.kind === "none"
      ? {
          bg: "Уточнете въпроса за обществените поръчки.",
          en: "Please clarify the procurement question.",
        }
      : result.message;
  return {
    tool: "procurementQuestion",
    kind: "scalar",
    title: message[ctx.lang],
    viz: "none",
    facts: { answer: message[ctx.lang] },
    provenance: [],
    ...(result.kind === "clarification" && result.options?.length
      ? {
          clarify: {
            prompt: message[ctx.lang],
            options: result.options.map((option) => ({
              label: option.label[ctx.lang],
              tool: "procurementQuery",
              args: option.query,
            })),
          },
        }
      : {}),
  };
}
export const PROCUREMENT_TOOLS: ToolDef[] = [
  {
    name: "procurementQuery",
    domain: "fiscal",
    description: {
      bg: "Проверена справка за договори, търгове и КЗК с точен обхват.",
      en: "Validated contract, tender and KZK analytics with exact scope.",
    },
    params: procurementQueryParams,
    examples: [],
    run: procurementQuery,
  },
  {
    name: "procurementQuestion",
    domain: "fiscal",
    description: {
      bg: "Разпознава или уточнява целия въпрос за обществени поръчки.",
      en: "Resolves or clarifies a complete procurement question.",
    },
    params: [
      {
        name: "question",
        type: "text",
        required: true,
        description: { bg: "Въпрос", en: "Question" },
      },
      {
        name: "previous",
        type: "text",
        description: { bg: "Предишен обхват", en: "Previous query" },
      },
    ],
    examples: [],
    run: procurementQuestion,
  },
];
