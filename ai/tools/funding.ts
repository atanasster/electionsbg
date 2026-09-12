import { validateProcurementQuery } from "../../src/lib/procurementQuery";
import { encodeFundingQuery } from "../../src/lib/fundingQuery";
import { loadMunis } from "./place";
import { fetchDb } from "./dataClient";
import {
  understandFunding,
  type FundingCatalog,
} from "../orchestrator/fundingUnderstanding";
import {
  validateFundingQuery,
  decodeFundingQuery,
  fundingQueryKey,
  FUNDING_LABELS,
  FUNDING_SIGNAL_LABELS,
  type FundingQuery,
} from "../../src/lib/fundingQuery";
import { fundingQueryParams } from "./fundingQueryContract";
import type { Envelope, ToolArgs, ToolContext, ToolDef, Row } from "./types";
export type FundingResult = {
  status: "success" | "partial" | "empty" | "unavailable" | "unsupported";
  reason?: string;
  query?: FundingQuery;
  revision?: string;
  totals?: Record<string, number | string | null>;
  rows?: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
  comparisons?: Record<string, unknown>[];
  warnings?: string[];
  groupCount?: number;
};
const primitive = (r: Record<string, unknown>): Row =>
  Object.fromEntries(
    Object.entries(r).filter(
      ([, v]) => typeof v === "string" || typeof v === "number" || v === null,
    ),
  ) as Row;
export function fundingScope(
  q: FundingQuery,
  ctx: Pick<ToolContext, "lang">,
): string {
  const bg = ctx.lang === "bg";
  const label: Record<string, string> = bg
    ? {
        programmeIds: "Програми",
        schemeIds: "Схеми",
        entityIds: "ЕИК",
        themeIds: "Теми",
        beneficiarySectors: "Сектор на бенефициента",
        placeIds: "Места",
        placeBasis: "Основа на местоположението",
        basePredicates: "Условия",
        numeratorPredicates: "Условия за дела",
        amountMin: "Минимална сума",
        amountMax: "Максимална сума",
        population: "Съвкупност",
        grant: "Безвъзмездна помощ",
        paid: "Изплатена сума",
        projectCost: "Обща стойност",
        ownCofinance: "Собствено съфинансиране",
        direct: "Директни плащания",
        market: "Пазарни мерки",
        rural: "Развитие на селските райони",
        operationBudget: "Бюджет на операцията",
        operationEu: "Принос на ЕС за операцията",
        partnerBudget: "Собствен бюджет на партньора",
        partnerEu: "Принос на ЕС за партньора",
        observed: "Първо наблюдение",
        start: "Начало по график",
        end: "Край по график",
        overlap: "Активност по график",
        attributable: "Получатели без ДФЗ като платец",
        gross: "Всички изходни записи",
        implementation: "Изпълнение",
        recipient: "Седалище на получателя",
        partner: "Местоположение на партньора",
        eligible: "Допустима територия",
      }
    : {
        programmeIds: "Programmes",
        schemeIds: "Schemes",
        entityIds: "Company IDs",
        themeIds: "Themes",
        beneficiarySectors: "Beneficiary sector",
        placeIds: "Places",
        placeBasis: "Geography basis",
        basePredicates: "Conditions",
        numeratorPredicates: "Share conditions",
        amountMin: "Minimum amount",
        amountMax: "Maximum amount",
        population: "Population",
        grant: "Grant",
        paid: "Paid amount",
        projectCost: "Project cost",
        ownCofinance: "Own cofinance",
        direct: "Direct payments",
        market: "Market measures",
        rural: "Rural development",
        operationBudget: "Whole operation budget",
        operationEu: "Operation EU contribution",
        partnerBudget: "Own partner budget",
        partnerEu: "Partner EU contribution",
        observed: "First observed",
        start: "Scheduled start",
        end: "Scheduled end",
        overlap: "Scheduled activity",
        attributable: "Recipients excluding DFZ payer entries",
        gross: "All source records",
        implementation: "Implementation",
        recipient: "Recipient seat",
        partner: "Partner location",
        eligible: "Eligible area",
      };
  const value = (raw: string) => {
    const id = raw.replace(/^!/, ""),
      s = FUNDING_SIGNAL_LABELS[id]?.[ctx.lang] || label[id] || id;
    return raw.startsWith("!") ? (bg ? "без " : "without ") + s : s;
  };
  const extra: Record<string, [string, string]> = {
    statusIds: ["Състояния", "Statuses"],
    entityClass: ["Вид получател", "Recipient class"],
    fundingMechanisms: ["Механизми", "Mechanisms"],
    fundTypes: ["Фондове", "Fund types"],
    keyword: ["Търсене в заглавието", "Title search"],
    compareFinancialYears: [
      "Сравнявани финансови години",
      "Comparison financial years",
    ],
    compareFrom: ["Сравнение от (включително)", "Comparison from (inclusive)"],
    compareToExclusive: [
      "Сравнение до (изключително)",
      "Comparison to (exclusive)",
    ],
    denominator: ["Знаменател", "Denominator"],
    baseMode: ["Логика на условията", "Condition logic"],
    numeratorMode: ["Логика на дела", "Share logic"],
    asOf: ["Към момент", "As of"],
    metric: ["Показател", "Measure"],
    groupBy: ["Групиране", "Grouping"],
    topN: ["Първи N", "Top N"],
    minGroupCount: ["Минимален брой в група", "Minimum group size"],
  };
  Object.entries(extra).forEach(([k, v]) => {
    label[k] = v[bg ? 0 : 1];
  });
  Object.assign(
    label,
    bg
      ? {
          all: "всички",
          any: "поне едно",
          legal: "юридически лица",
          individual: "физически лица",
          records: "записи",
          evaluable: "записи с известен показател",
          amount: "сума",
          completed: "приключени",
          terminated: "прекратени",
          "in-progress": "в изпълнение",
          ongoing: "текущи",
          closed: "приключени",
        }
      : {
          all: "all",
          any: "any",
          legal: "legal entities",
          individual: "natural persons",
          evaluable: "records with known evidence",
        },
  );
  const parent = q.parentQuery ? decodeFundingQuery(q.parentQuery) : null;
  return [
    FUNDING_LABELS[q.corpus][ctx.lang],
    q.financialYears?.length
      ? `${bg ? "Финансови години" : "Financial years"}: ${q.financialYears.join(", ")}`
      : "",
    q.programmingPeriods?.length
      ? `${bg ? "Програмни периоди" : "Programming periods"}: ${q.programmingPeriods.join(", ")}`
      : "",
    q.from || q.toExclusive
      ? `${label[q.dateBasis] || q.dateBasis}: ${q.from || "…"} ≤ ${bg ? "дата" : "date"} < ${q.toExclusive || "…"}`
      : "",
    `${label[q.amountBasis] || q.amountBasis} · EUR`,
    q.amountMin !== undefined
      ? `${bg ? "Сума" : "Amount"} ${q.amountMinRelation === "gt" ? ">" : "≥"} ${q.amountMin} EUR`
      : "",
    q.amountMax !== undefined
      ? `${bg ? "Сума" : "Amount"} ${q.amountMaxRelation === "lt" ? "<" : "≤"} ${q.amountMax} EUR`
      : "",
    parent?.ok
      ? `${bg ? "Цяла родителска съвкупност" : "Entire parent population"}: (${fundingScope(parent.query, ctx)})`
      : "",
    ...[
      ...Object.keys(extra),
      "programmeIds",
      "schemeIds",
      "entityIds",
      "themeIds",
      "beneficiarySectors",
      "placeIds",
      "placeBasis",
      "basePredicates",
      "numeratorPredicates",
      ...(q.corpus === "agriPayments" ? ["population"] : []),
    ].flatMap((k) =>
      !(k === "denominator" && ["paidRatio", "topShare"].includes(q.metric)) &&
      q[k] !== undefined
        ? [
            `${label[k]}: ${Array.isArray(q[k]) ? (q[k] as string[]).map(value).join(", ") : value(String(q[k]))}`,
          ]
        : [],
    ),
  ]
    .filter(Boolean)
    .join(" · ");
}
export async function fundingQuery(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> {
  const parsed = validateFundingQuery(args),
    bg = ctx.lang === "bg";
  const failed = (reason: string, query?: FundingQuery): Envelope => ({
    tool: "fundingQuery",
    kind: "scalar",
    title: bg ? "Обхватът не може да се изпълни" : "Scope cannot be executed",
    viz: "none",
    facts: {
      answer: reason,
      status: "unavailable",
      scope: query ? fundingScope(query, ctx) : "",
    },
    ...(query
      ? {
          subtitle: fundingScope(query, ctx),
          funding: {
            query,
            result: { status: "unavailable" as const, reason },
          },
        }
      : {}),
    provenance: [],
  });
  if (!parsed.ok)
    return failed(
      Object.entries(parsed.errors)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    );
  const q = parsed.query;
  let result: FundingResult;
  try {
    result = await fetchDb<FundingResult>("funding-query", {
      query: JSON.stringify(q),
    });
  } catch {
    return failed(
      bg
        ? "Справката временно не е налична. Запазете обхвата и опитайте отново."
        : "The query is temporarily unavailable. Retain the scope and retry.",
      q,
    );
  }
  if (result.query) {
    const applied = validateFundingQuery(result.query);
    if (!applied.ok || fundingQueryKey(applied.query) !== fundingQueryKey(q))
      return failed(
        bg
          ? "Полученият обхват не съвпада със заявения."
          : "Returned scope differs from requested scope.",
        q,
      );
  }
  if (["success", "partial", "empty"].includes(result.status) && !result.query)
    return failed("Missing applied query", q);
  const totals = result.totals || {},
    metric =
      q.operation === "share" && !["paidRatio", "topShare"].includes(q.metric)
        ? "share"
        : (
            {
              amount: "amount",
              paidRatio: "paid_ratio",
              hhi: "hhi",
              topShare: "top_share",
              beneficiaries: "beneficiaries",
              organisations: "organisations",
            } as Record<string, string>
          )[q.metric] || "records";
  const value = totals[metric];
  const available = ["success", "partial", "empty"].includes(result.status);
  let answer = available
    ? `${value === null || value === undefined ? (bg ? "Няма изчислим показател" : "Measure unavailable") : Number(value).toLocaleString(bg ? "bg-BG" : "en-GB", { maximumFractionDigits: 2 })}${metric === "amount" ? " EUR" : ["share", "paid_ratio", "top_share"].includes(metric) ? "%" : ""}${result.status === "partial" ? (bg ? " — непълно покритие" : " — partial coverage") : ""}`
    : result.reason || (bg ? "Недостъпна справка" : "Query unavailable");
  const formatMeasure = (v: unknown) =>
    v === null || v === undefined
      ? bg
        ? "неизвестно"
        : "unknown"
      : Number(v).toLocaleString(bg ? "bg-BG" : "en-GB", {
          maximumFractionDigits: 2,
        });
  if (available && q.operation === "compare")
    answer = (result.comparisons || [])
      .map(
        (r) =>
          `${r.cohort_window === "current" ? (bg ? "Основен период" : "Current period") : bg ? "Сравняван период" : "Comparison period"}: ${formatMeasure(r[metric])}${metric === "amount" ? " EUR" : ["share", "paid_ratio", "top_share"].includes(metric) ? "%" : ""}`,
      )
      .join("; ");
  const ratioEvidence =
    q.metric === "paidRatio"
      ? [totals.ratio_numerator, totals.ratio_denominator]
      : q.metric === "topShare"
        ? [totals.top_amount, totals.concentration_amount]
        : null;
  const evidence = available
    ? [
        `${bg ? "Записи" : "Records"}: ${totals.records ?? 0}`,
        ratioEvidence
          ? `${bg ? "Числител / знаменател (EUR)" : "Numerator / denominator (EUR)"}: ${formatMeasure(value == null ? null : ratioEvidence[0])} / ${formatMeasure(value == null ? null : ratioEvidence[1])}${q.metric === "topShare" ? (bg ? " — известни суми на идентифицирани получатели" : " — known amounts of identified recipients") : ""}`
          : q.operation === "share"
            ? `${bg ? "Числител / знаменател" : "Numerator / denominator"}: ${formatMeasure(q.denominator === "amount" ? totals.numerator_amount : totals.numerator_records)} / ${formatMeasure(q.denominator === "amount" ? totals.amount : q.denominator === "evaluable" ? totals.evaluable : totals.records)}`
            : "",
        q.numeratorPredicates?.length
          ? `${bg ? "Оценим показател" : "Evaluable signal"}: ${totals.evaluable ?? 0}/${totals.records ?? 0}`
          : "",
        `${bg ? "Известна сума" : "Known amount"}: ${totals.known_amount ?? 0}/${totals.records ?? 0}`,
        q.metric === "paidRatio"
          ? `${bg ? "Известно изплатено" : "Known paid"}: ${totals.known_paid ?? 0}/${totals.records ?? 0}`
          : "",
        q.metric === "organisations"
          ? `${bg ? "Известна организация" : "Known organisation"}: ${totals.known_organisation ?? 0}/${totals.records ?? 0}`
          : "",
        bg ? "Текуща снимка на източника." : "Current source snapshot.",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const rows =
    (q.operation === "compare"
      ? result.comparisons
      : q.groupBy
        ? result.groups
        : result.rows
    )?.map(primitive) || [];
  return {
    tool: "fundingQuery",
    domain: "fiscal",
    kind: rows.length ? "table" : "scalar",
    title: FUNDING_LABELS[q.corpus][ctx.lang],
    subtitle: fundingScope(q, ctx),
    viz: "none",
    facts: {
      answer,
      scope: fundingScope(q, ctx),
      coverage_note: evidence,
      status: result.status,
      records: totals.records ?? "unknown",
      knownMoney: totals.known_amount ?? "unknown",
      amount: totals.amount ?? "unknown",
      revision: result.revision || "",
      warnings: (result.warnings || []).join("; "),
    },
    rows,
    columns: Object.keys(rows[0] || {})
      .filter(
        (k) =>
          !["group_key", "cohort_window"].includes(k) ||
          q.groupBy ||
          q.operation === "compare",
      )
      .map((key) => ({
        key,
        label: key,
        numeric: typeof rows[0]?.[key] === "number",
      })),
    provenance: ["db:funding-query"],
    funding: { query: q, result },
  };
}
export async function fundingQuestion(
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> {
  const previous =
    typeof args.previous === "string"
      ? decodeFundingQuery(args.previous)
      : null;
  const invalid = previous && !previous.ok;
  if (previous?.ok && args.handoff === "openCalls") {
    const { openCalls } = await import("./fiscal");
    const result = await openCalls(
      {
        audience:
          previous.query.corpus === "agriPayments" ? "farmer" : undefined,
      },
      ctx,
    );
    const scope = fundingScope(previous.query, ctx);
    return {
      ...result,
      tool: "fundingQuestion",
      subtitle: scope,
      facts: {
        ...result.facts,
        scope,
        coverage_note:
          ctx.lang === "bg"
            ? "Отворени приеми сега. Периодът на отпуснатото финансиране не се прилага. Темата и мястото са контекст, не потвърдена допустимост. Interreg не е включен."
            : "Open calls now. The award period is not applied. Theme and place are context, not confirmed eligibility. Interreg is not included.",
      },
    };
  }
  let catalog: FundingCatalog = {};
  const question = String(args.question || "");
  if (/община|municipality/i.test(question)) {
    try {
      catalog.places = (await loadMunis()).map((m) => ({
        id: m.obshtina === "SOF" ? "SFO_CITY" : m.obshtina,
        name: m.name,
        name_en: m.nameEn,
        level: "municipality",
      }));
    } catch {
      /* Keep place unresolved. */
    }
  }
  let r = invalid
    ? null
    : understandFunding(question, {
        previous: previous?.ok ? previous.query : undefined,
        catalog,
      });
  if (
    r?.kind === "clarification" &&
    ["catalog_name_lookup", "latest_year_lookup"].includes(r.reason)
  ) {
    try {
      catalog = {
        ...catalog,
        ...(await fetchDb<FundingCatalog>("funding-catalog", {
          corpus: String(r.draft.corpus || ""),
        })),
      };
      r = understandFunding(question, {
        previous: previous?.ok ? previous.query : undefined,
        catalog,
      });
    } catch {
      /* Preserve unresolved scope. */
    }
  }
  if (r?.kind === "clarification" && r.reason === "catalog_name_lookup") {
    const named = question.match(
      /(?:фирма|company|бенефициент|beneficiary)\s*[„“"]?([^„“"]+?)(?=[“"]|\s+(?:за|по|с|от|над|под|през|in|for|with|above|below|grant|paid)\s|[?;,]|$)/i,
    );
    if (named) {
      try {
        catalog.entities = await fetchDb("funding-entities", {
          name: named[1],
          corpus: String(r.draft.corpus || ""),
        });
        r = understandFunding(question, {
          previous: previous?.ok ? previous.query : undefined,
          catalog,
        });
      } catch {
        /* Preserve unresolved scope. */
      }
    }
  }
  if (r?.kind === "query") return fundingQuery(r.query, ctx);
  if (r?.kind === "bundle") {
    const answers = await Promise.all(
      r.queries.map((q) => fundingQuery(q, ctx)),
    );
    return {
      tool: "fundingQuestion",
      domain: "fiscal",
      kind: "table",
      title:
        ctx.lang === "bg"
          ? "Отделни източници и парични основи"
          : "Separate sources and money bases",
      viz: "none",
      facts: {
        answer: answers.map((a) => `${a.title}: ${a.facts.answer}`).join("\n"),
      },
      rows: answers.map((a) => ({
        scope: a.subtitle || a.title,
        answer: String(a.facts.answer),
        status: String(a.facts.status),
      })),
      columns: [
        { key: "scope", label: "Scope" },
        { key: "answer", label: "Answer" },
        { key: "status", label: "Status" },
      ],
      provenance: ["db:funding-query"],
      fundingBundle: answers.flatMap((a) => (a.funding ? [a.funding] : [])),
    };
  }
  if (r?.kind === "clarification" && previous?.ok && r.reason === "P11") {
    const year = new Date().getFullYear();
    const child = validateProcurementQuery({
      corpus: "contracts",
      operation: "list",
      fundingParentQuery: encodeFundingQuery(previous.query),
      from: `${year}-01-01`,
      toExclusive: `${year + 1}-01-01`,
    });
    const message =
      ctx.lang === "bg"
        ? `Поръчки на бенефициентите по ЕИК, не доказано финансирани от проекта. Изберете отделния период за поръчките (${year}) или го напишете в целия въпрос.`
        : `Beneficiary procurement by EIK, without proof of project financing. Choose the independent procurement period (${year}) or specify it in a complete question.`;
    return {
      tool: "fundingQuestion",
      kind: "scalar",
      title: message,
      viz: "none",
      facts: { answer: message, scope: fundingScope(previous.query, ctx) },
      provenance: [],
      ...(child.ok
        ? {
            clarify: {
              prompt: message,
              options: [
                {
                  label: String(year),
                  tool: "procurementQuery",
                  args: child.query,
                },
              ],
            },
          }
        : {}),
    };
  }
  if (r?.kind === "clarification" && previous?.ok && r.reason === "P15") {
    const message =
      ctx.lang === "bg"
        ? "Отворените приеми са възможности сега. Старият период на финансиране не се прилага; темата и мястото се запазват като контекст, не като проверена допустимост. Interreg не е включен."
        : "Open calls are opportunities now. The prior award period does not apply; theme and place remain context, not verified eligibility. Interreg is not included.";
    return {
      tool: "fundingQuestion",
      kind: "scalar",
      title: message,
      viz: "none",
      facts: { answer: message, scope: fundingScope(previous.query, ctx) },
      provenance: [],
      clarify: {
        prompt: message,
        options: [
          {
            label:
              ctx.lang === "bg"
                ? "Покажи отворените приеми"
                : "Show open calls",
            tool: "fundingQuestion",
            args: {
              question: String(args.question),
              previous: encodeFundingQuery(previous.query),
              handoff: "openCalls",
            },
          },
        ],
      },
    };
  }
  const message =
    r?.kind === "clarification"
      ? r.message[ctx.lang]
      : ctx.lang === "bg"
        ? "Уточнете целия въпрос и източника на финансиране."
        : "Restate the complete question and funding source.";
  return {
    tool: "fundingQuestion",
    domain: "fiscal",
    kind: "scalar",
    title: message,
    viz: "none",
    facts: { answer: message, status: "unsupported" },
    provenance: [],
    ...(r?.kind === "clarification" && r.options?.length
      ? {
          clarify: {
            prompt: message,
            options: r.options.map((o) => ({
              label: o.label[ctx.lang],
              tool: "fundingQuery",
              args: o.query,
            })),
          },
        }
      : {}),
  };
}
export const FUNDING_TOOLS: ToolDef[] = [
  {
    name: "fundingQuery",
    domain: "fiscal",
    description: {
      bg: "Проверена справка за ИСУН, ДФЗ и Interreg с точен обхват.",
      en: "Validated ISUN, DFZ and Interreg analytics with exact scope.",
    },
    params: fundingQueryParams,
    examples: [],
    run: fundingQuery,
  },
  {
    name: "fundingQuestion",
    domain: "fiscal",
    description: {
      bg: "Разпознава или уточнява целия въпрос за финансиране.",
      en: "Resolves or clarifies a complete funding question.",
    },
    params: [
      {
        name: "handoff",
        type: "text",
        description: {
          bg: "Преход към отворени приеми",
          en: "Open-call handoff",
        },
      },
      {
        name: "question",
        type: "text",
        required: true,
        description: { bg: "Въпрос", en: "Question" },
      },
      {
        name: "previous",
        type: "text",
        description: { bg: "Предишен обхват", en: "Previous scope" },
      },
    ],
    examples: [],
    run: fundingQuestion,
  },
];
