import { decodeFundingQuery } from "../../src/lib/fundingQuery";
import { fundingScope } from "./funding";
import { PROCUREMENT_RISK_WORDS } from "../../src/lib/questions/contracts/procurement";
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
  parentRecords?: number;
  parentEvaluable?: number;
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
const predicateLabel = (p: string, lang: "bg" | "en") => {
  const id = p.replace(/^!/, "").replace(/^risk:/, "");
  const label =
    PROCUREMENT_RISK_WORDS[id]?.[lang] ||
    (
      {
        oneBid: lang === "bg" ? "точно една оферта" : "exactly one bid",
        appealed: lang === "bg" ? "обжалвани" : "appealed",
        upheld: lang === "bg" ? "уважен изход" : "recorded upheld outcome",
        suspended: lang === "bg" ? "спрени" : "suspended",
      } as Record<string, string>
    )[id] ||
    id;
  return (
    (p.startsWith("!") ? (lang === "bg" ? "без " : "without ") : "") + label
  );
};
export const procurementScope = (
  q: ProcurementQuery,
  ctx: ToolContext,
): string => {
  const bg = ctx.lang === "bg";
  const parent = q.parentQuery ? decodeProcurementQuery(q.parentQuery) : null;
  const fundingParent = q.fundingParentQuery
    ? decodeFundingQuery(q.fundingParentQuery)
    : null;
  return [
    fundingParent?.ok
      ? `${bg ? "Поръчки на бенефициентите по ЕИК; това не доказва финансиране от проекта" : "Beneficiary procurement by EIK; this does not prove project financing"}: (${fundingScope(fundingParent.query, ctx)})`
      : "",
    units[q.corpus][ctx.lang],
    `${q.from || "…"} ≤ ${({ record: bg ? "дата на записа" : "record date", signed: bg ? "проверена дата на подписване" : "verified signing date", published: bg ? "дата на обявяване" : "publication date", deadline: bg ? "краен срок" : "submission deadline", complaint: bg ? "дата на жалбата" : "complaint date", decision: bg ? "дата на акта" : "act date" } as Record<string, string>)[q.dateBasis]} < ${q.toExclusive || "…"}`,
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
    parent?.ok
      ? `${bg ? "Свързана съвкупност" : "Parent cohort"}: [${procurementScope(parent.query, ctx)}]`
      : "",
    q.topic || "",
    q.keyword || "",
    ...(q.basePredicates || []).map(
      (p) => `${bg ? "Сред" : "Among"}: ${predicateLabel(p, ctx.lang)}`,
    ),
    ...(q.numeratorPredicates || []).map((p) => predicateLabel(p, ctx.lang)),
    q.numeratorMode === "any"
      ? bg
        ? "поне едно условие"
        : "any condition"
      : "",
    q.status ? `${bg ? "Състояние" : "Status"}: ${q.status}` : "",
    q.funding
      ? `${bg ? "Европейско финансиране" : "EU funding"}: ${q.funding}`
      : "",
    q.actKind ? `${bg ? "Вид акт" : "Act kind"}: ${q.actKind}` : "",
    q.outcome ? `${bg ? "Изход" : "Outcome"}: ${q.outcome}` : "",
    q.key ? `${bg ? "Запис" : "Record"}: ${q.key}` : "",
    q.procedureType
      ? `${bg ? "Вид процедура" : "Procedure type"}: ${q.procedureType}`
      : "",
    q.minRiskCount != null
      ? `${bg ? "Поне рискови сигнали" : "Minimum fired checks"}: ${q.minRiskCount}`
      : "",
    q.maxRiskCount != null
      ? `${bg ? "Най-много рискови сигнали" : "Maximum fired checks"}: ${q.maxRiskCount}`
      : "",
    q.minGroupCount != null
      ? `${bg ? "Минимална извадка" : "Minimum sample"}: ${q.minGroupCount} (${q.minGroupCountBasis})`
      : "",
    q.framework ? `${bg ? "Рамково" : "Framework"}: ${q.framework}` : "",
    q.amountMin != null
      ? `${bg ? "Стойност" : "Value"} ${q.amountMinRelation === "gt" ? ">" : "≥"} ${q.amountMin} ${q.currency}`
      : "",
    q.amountMax != null
      ? `${bg ? "Стойност" : "Value"} ${q.amountMaxRelation === "lt" ? "<" : "≤"} ${q.amountMax} ${q.currency}`
      : "",
    q.bidderMin != null ? `${bg ? "Оферти" : "Bids"} ≥ ${q.bidderMin}` : "",
    q.bidderMax != null ? `${bg ? "Оферти" : "Bids"} ≤ ${q.bidderMax}` : "",
    q.relatedCorpus
      ? `${bg ? "Свързани жалби/актове" : "Related complaints/acts"}: ${q.relatedFrom || "…"} – ${q.relatedToExclusive || "…"} (${bg ? "краят е изключен" : "end excluded"})`
      : "",
    q.compareFrom
      ? `${bg ? "Сравнение" : "Compare"}: ${q.compareFrom} – ${q.compareToExclusive}`
      : "",
    q.asOf ? `${bg ? "Към" : "As of"}: ${q.asOf}` : "",
    `${bg ? "Основа на стойността" : "Value basis"}: ${q.valueBasis}`,
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
      procurement: { query: q, result: { status: "success" } },
      facts: {
        ...base.facts,
        answer: bg
          ? "Договорните записи изключват членските редове на обединения. Неизвестните проверки не са отрицателни; рисковете са индикатори, а не доказателства за нарушение."
          : "Contract records exclude consortium-member rows. Unknown checks are not negative results; risk indicators are not proof of wrongdoing.",
      },
    };
  const result = await fetchDb<ProcurementResult>("procurement-query", {
    query: JSON.stringify(q),
  }).catch(
    (): ProcurementResult => ({
      status: "unavailable",
      reason: "query_transport_unavailable",
      query: q,
    }),
  );
  base.procurement = { query: q, result };
  if (result.query && JSON.stringify(result.query) !== JSON.stringify(q)) {
    const applied = validateProcurementQuery(result.query);
    if (
      !applied.ok ||
      JSON.stringify(Object.entries(applied.query).sort()) !==
        JSON.stringify(Object.entries(q).sort())
    )
      throw Error("Applied procurement scope differs from request");
  }
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
  const ratioMetric =
    ["oneBid", "risk", "appealed", "upheld", "suspended"].includes(q.metric) ||
    Boolean(q.numeratorPredicates?.length);
  const isRate =
    q.operation === "share" || (q.operation === "compare" && ratioMetric);
  const denominatorKey =
    q.denominator === "positiveKnown"
      ? "positive_known"
      : q.denominator === "evaluable"
        ? "evaluable"
        : q.denominator === "merits"
          ? "merits"
          : "records";
  const measure = (
    totals: Record<string, number | string | null>,
    rate = isRate,
  ): number | null => {
    if (rate)
      return Number(totals[denominatorKey]) > 0 &&
        !(result.status === "partial" && Number(totals.evaluable) === 0)
        ? (100 * Number(totals.numerator)) / Number(totals[denominatorKey])
        : null;
    const key =
      q.metric === "value"
        ? "value_eur"
        : q.metric === "cri"
          ? "mean_cri"
          : q.metric === "riskCount"
            ? "mean_risk_count"
            : ratioMetric
              ? "numerator"
              : "records";
    return totals[key] == null ? null : Number(totals[key]);
  };
  const value = measure(t);
  const answer =
    value === null
      ? bg
        ? "Няма достатъчно известни данни за показателя."
        : "Insufficient known data for this metric."
      : isRate
        ? `${format(value)}% (${format(n)} / ${format(den)})`
        : `${format(value)}${q.metric === "value" ? " EUR" : ""}`;
  base.facts = {
    ...base.facts,
    status: result.status,
    answer:
      result.status === "partial"
        ? `${bg ? "Наблюдавани резултати (непълен обхват)" : "Observed results (partial coverage)"}: ${answer}`
        : answer,
    ...(result.parentRecords != null
      ? {
          parent_records: result.parentRecords,
          parent_evaluable: result.parentEvaluable ?? 0,
        }
      : {}),
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
    money_note: bg
      ? "Стойностите не са плащания. Рамковите стойности може да са тавани; обща ДДС основа не е потвърдена."
      : "Values are not cash payments. Framework values may be ceilings; a common VAT basis is not verified.",
    ...(q.buyerSectors?.length
      ? {
          roster_basis: bg
            ? "Текуща одитирана принадлежност, приложена към избрания период"
            : "Current audited roster applied to the selected period",
        }
      : {}),
    ...(q.cpvPrefixes?.length || q.subjectSectors?.length
      ? {
          subject_basis: bg
            ? "Основен CPV на записа; допълнителните позиции не са пълно покритие"
            : "Primary record CPV; additional lot codes are not full coverage",
        }
      : {}),
    population: "procurement-records-v1",
    coverage_note: bg
      ? "Пълнотата на периода не е потвърдена. Класификациите, връзките и рисковете отразяват текущите данни; историческият период избира записи."
      : "Period completeness is not verified. Classifications, links and risks reflect current data; the historical period selects records.",
    ...(result.revision
      ? { data_revision: JSON.stringify(result.revision) }
      : {}),
    ...(result.riskCatalog ? { risk_catalog: result.riskCatalog } : {}),
    ...(q.metric === "oneBid" && Number(t.records) > 0
      ? { share_all: (100 * n) / Number(t.records) }
      : {}),
    ...(q.metric === "oneBid" && Number(t.positive_known) > 0
      ? { share_positive_known: (100 * n) / Number(t.positive_known) }
      : {}),
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
  if (q.operation === "compare" && result.comparison) {
    const c = result.comparison,
      other = measure(c);
    base.kind = "table";
    base.rows = [
      {
        period: `${q.from} – ${q.toExclusive}`,
        value,
        records: Number(t.records),
        numerator: n,
        denominator: den,
      },
      {
        period: `${q.compareFrom} – ${q.compareToExclusive}`,
        value: other,
        records: Number(c.records),
        numerator: Number(c.numerator),
        denominator: Number(c[denominatorKey]),
      },
    ];
    base.columns = [
      {
        key: "period",
        label: bg ? "Период (краят е изключен)" : "Period (end excluded)",
      },
      {
        key: "value",
        label: isRate
          ? "%"
          : q.metric === "value"
            ? "EUR"
            : bg
              ? "Показател"
              : "Measure",
        numeric: true,
      },
      { key: "records", label: bg ? "Записи" : "Records", numeric: true },
      ...(isRate
        ? [
            {
              key: "numerator",
              label: bg ? "Съвпадения" : "Matches",
              numeric: true,
            },
            {
              key: "denominator",
              label: bg ? "Знаменател" : "Denominator",
              numeric: true,
            },
          ]
        : []),
    ];
    if (value !== null && other !== null) {
      base.facts[isRate ? "percentage_point_change" : "absolute_change"] =
        other - value;
      if (value !== 0)
        base.facts.relative_percent_change = (100 * (other - value)) / value;
    }
  }
  const rows =
    q.groupBy || q.operation === "trend" ? result.groups : result.rows;
  if (["list", "detail", "rank", "trend"].includes(q.operation)) {
    base.kind = "table";
    base.rows =
      q.groupBy || q.operation === "trend"
        ? (rows || []).map((row) => ({
            ...row,
            measure: measure(
              row as Record<string, number | string | null>,
              ratioMetric,
            ),
            denominator: Number(row[denominatorKey]),
          }))
        : rows || [];
    const names =
      q.groupBy || q.operation === "trend"
        ? [
            "group_key",
            "measure",
            "records",
            "numerator",
            "denominator",
            "value_eur",
          ]
        : ["key", "title", "date", "buyer", "amount_eur"];
    base.columns = names.map((key) => ({
      key,
      label:
        (
          {
            measure: ratioMetric ? "%" : bg ? "Показател" : "Measure",
            denominator: bg ? "Знаменател" : "Denominator",
            group_key: bg ? "Група" : "Group",
            records: bg ? "Записи" : "Records",
            numerator: bg ? "Съвпадения" : "Matches",
            value_eur: bg ? "Стойност EUR" : "Value EUR",
            key: bg ? "Идентификатор" : "Identifier",
            title: bg ? "Предмет" : "Subject",
            date: bg ? "Дата" : "Date",
            buyer: bg ? "Възложител" : "Buyer",
            amount_eur: bg ? "Стойност EUR" : "Value EUR",
          } as Record<string, string>
        )[key] || key,
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
    election: ctx.election,
  });
  if (result.kind === "query") return procurementQuery(result.query, ctx);
  if (result.kind === "bundle") {
    const answers = await Promise.all(
      result.queries.map((q) => procurementQuery(q, ctx)),
    );
    return {
      tool: "procurementQuestion",
      kind: "table",
      title: ctx.lang === "bg" ? "Две отделни справки" : "Two separate queries",
      viz: "none",
      facts: {
        answer: answers
          .map((a) => `${a.title}: ${a.facts.answer} — ${a.subtitle}`)
          .join("\n"),
      },
      provenance: ["db:procurement-query"],
      procurementBundle: answers.flatMap((a) =>
        a.procurement ? [a.procurement] : [],
      ),
      rows: answers.map((a) => ({
        scope: a.subtitle || a.title,
        answer: String(a.facts.answer),
        status: String(a.facts.status || "success"),
      })),
      columns: [
        { key: "scope", label: ctx.lang === "bg" ? "Обхват" : "Scope" },
        { key: "answer", label: ctx.lang === "bg" ? "Отговор" : "Answer" },
        { key: "status", label: ctx.lang === "bg" ? "Състояние" : "Status" },
      ],
    };
  }
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
