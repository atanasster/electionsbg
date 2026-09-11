import { BUDGET_QUESTIONS } from "@/lib/questions/contracts/budget";
import { fetchDb } from "./dataClient";
import type { ToolDef, Envelope, Row } from "./types";
const labels: Record<string, [string, string]> = {
  nameBg: ["Институция / община", "Institution / municipality"],
  nameEn: ["Институция / община", "Institution / municipality"],
  plannedEur: ["По закон (€)", "Law (€)"],
  amendedEur: ["Актуализиран план (€)", "Amended plan (€)"],
  executedEur: ["Изпълнение (€)", "Execution (€)"],
  deltaVsLawEur: ["Разлика спрямо закона (€)", "Difference from law (€)"],
  deltaVsAmendedEur: ["Разлика спрямо плана (€)", "Difference from plan (€)"],
  fiscalYear: ["Година", "Year"],
  positionsTotal: ["Щатни бройки", "Established posts"],
  positionsFilled: ["Заети бройки", "Filled posts"],
  positionsVacant: ["Незаети бройки", "Vacant posts"],
  nsiHeadcount: ["Наети лица (НСИ)", "Employees (NSI)"],
  payrollEur: ["Възнаграждения (€)", "Payroll (€)"],
  headcount: ["Изпълнени щатни бройки", "Executed FTE"],
  personnelEur: ["Разходи за персонал (€)", "Personnel costs (€)"],
  avgCostPerFteEur: [
    "Среден разход на щатна бройка (€)",
    "Average cost per FTE (€)",
  ],
  titleBg: ["Документ", "Document"],
  url: ["Източник", "Source"],
  publishedOn: ["Публикуван", "Published"],
  amount: ["Бюджет (€)", "Budget (€)"],
  eikNodeCount: ["Записи със същия ЕИК", "Records sharing the EIK"],
  procurementEur: ["Поръчки (€)", "Procurement (€)"],
  totalEur: ["Общо (€)", "Total (€)"],
  delegatedEur: ["Делегирани дейности (€)", "Delegated activities (€)"],
  equalizationEur: ["Изравнителна субсидия (€)", "Equalization subsidy (€)"],
  capitalEur: ["Капиталова субсидия (€)", "Capital subsidy (€)"],
  projectCount: ["Проекти", "Projects"],
  ownFundsEur: ["Собствени средства (€)", "Own funds (€)"],
  euFundsEur: ["Еврофондове (€)", "EU funds (€)"],
  stateSubsidyEur: ["Държавна субсидия (€)", "State subsidy (€)"],
  agreementEur: ["Договорено (€)", "Agreed (€)"],
  paidEur: ["Платено (€)", "Paid (€)"],
  paidPct: ["Платено (%)", "Paid (%)"],
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const BUDGET_TOOLS: ToolDef[] = BUDGET_QUESTIONS.map((spec) => ({
  name: spec.id,
  domain: "fiscal",
  description: { bg: spec.bg, en: spec.en },
  params:
    "year" in spec
      ? [
          {
            name: "year",
            type: "year",
            default: spec.year,
            description: { bg: "Бюджетна година", en: "Fiscal year" },
          },
        ]
      : [],
  examples: [{ bg: spec.bg, en: spec.en }],
  run: async (args, ctx): Promise<Envelope> => {
    const year = "year" in spec ? Number(args.year ?? spec.year) : undefined;
    const payload = await fetchDb<unknown>(spec.route, { fy: year });
    const body = record(payload) ? payload : {};
    const source = Array.isArray(body[spec.section])
      ? (body[spec.section] as unknown[]).filter(record)
      : [];
    const keys = Object.keys(labels).filter(
      (k) =>
        source.some((row) => k in row) &&
        !(k === "nameEn" && ctx.lang === "bg") &&
        !(k === "nameBg" && ctx.lang === "en"),
    );
    const rows: Row[] = source.map((row) =>
      Object.fromEntries(
        keys.map((k) => [
          k,
          typeof row[k] === "number" || typeof row[k] === "string"
            ? row[k]
            : null,
        ]),
      ),
    );
    const facts: Record<string, string | number> = { records: rows.length };
    if (spec.id === "budgetMunicipalTransfers") {
      facts.municipalities = rows.length;
      facts.record_basis =
        ctx.lang === "bg"
          ? "Всеки ред е община, не отделен трансфер."
          : "Each row is a municipality, not an individual transfer.";
      for (const row of rows.slice(0, 5)) {
        const name = row[ctx.lang === "bg" ? "nameBg" : "nameEn"];
        if (typeof name === "string" && typeof row.totalEur === "number")
          facts[
            `${name} — ${ctx.lang === "bg" ? "общо трансфери (€)" : "total transfers (€)"}`
          ] = row.totalEur;
      }
    }
    for (const key of [
      "fiscalYear",
      "coveredUnits",
      "totalUnits",
      "covered",
      "totalMunicipalities",
      "positionsBasis",
      "headcountBasis",
      "unitBasis",
      "unitsFiscalYear",
      "stalledRule",
    ])
      if (typeof body[key] === "number" || typeof body[key] === "string")
        facts[key] = body[key];
    for (const key of [
      "coverage",
      "covered",
      "sources",
      "unitsCoverage",
      "stalledRule",
    ]) {
      if (record(body[key])) facts[key] = JSON.stringify(body[key]);
    }
    const coverage = record(body.covered) ? body.covered : {};
    const sources = record(body.sources) ? body.sources : {};
    const units = record(body.unitsCoverage) ? body.unitsCoverage : {};
    const bg = ctx.lang === "bg";
    const unknown = bg ? "неизвестно" : "unknown";
    const subtitle =
      spec.id === "budgetCapitalByMunicipality"
        ? bg
          ? `Проекти: ${coverage.municipalityCount ?? unknown} от ${body.totalMunicipalities ?? unknown} общини. Разбивка по източници: ${sources.municipalityCount ?? unknown} общини; отделна, непълна извадка.`
          : `Projects: ${coverage.municipalityCount ?? unknown} of ${body.totalMunicipalities ?? unknown} municipalities. Financing breakdown: ${sources.municipalityCount ?? unknown} municipalities; a separate incomplete sample.`
        : spec.id === "budgetPersonnelByMinistry"
          ? bg
            ? `${body.unitsFiscalYear ?? unknown} г.: ${units.units ?? unknown} институции с публикувани отчети. Изпълнени щатни бройки, не брой служители.`
            : `${body.unitsFiscalYear ?? unknown}: ${units.units ?? unknown} institutions with published reports. Executed FTE, not employee headcount.`
          : spec.id === "budgetVariance"
            ? bg
              ? `Покритие: ${body.coveredUnits ?? unknown} от ${body.totalUnits ?? unknown} институции за ${body.fiscalYear ?? unknown} г.`
              : `Coverage: ${body.coveredUnits ?? unknown} of ${body.totalUnits ?? unknown} institutions for ${body.fiscalYear ?? unknown}.`
            : bg
              ? "Публикувани отчети; липсващи наблюдения не означават нула. Щатни бройки и наети лица са различни показатели."
              : "Published reports; missing observations do not mean zero. Established posts and employees are distinct measures.";
    return {
      tool: spec.id,
      domain: "fiscal",
      kind: "table",
      title: spec[ctx.lang],
      subtitle,
      columns: keys.map((k) => ({
        key: k,
        label: labels[k][ctx.lang === "bg" ? 0 : 1],
        numeric: source.some((row) => typeof row[k] === "number"),
      })),
      rows,
      viz: "none",
      facts,
      provenance: [spec.relation],
    };
  },
}));
