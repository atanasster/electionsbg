import { fundingContinuation } from "../../src/lib/fundingContinuations";
import {
  FUNDING_TEMPLATES,
  fundingTemplate,
} from "../../src/lib/questions/contracts/funding";
import {
  validateFundingQuery,
  type FundingQuery,
  type FundingArgs,
  type FundingCorpus,
  FUNDING_RECIPIENT_PLACES,
} from "../../src/lib/fundingQuery";
import { isQueryDate } from "../../src/lib/queryDates";
export type FundingCatalog = {
  programmes?: {
    code: string;
    label_bg: string;
    label_en?: string;
    corpus: string;
    period: string;
  }[];
  schemes?: { code: string; label: string }[];
  places?: { id: string; name: string; name_en?: string; level: string }[];
  entities?: { eik: string; name: string }[];
  financialYears?: string[];
};
export type FundingUnderstanding =
  | { kind: "none" }
  | {
      kind: "query";
      query: FundingQuery;
      captures: { field: string; value: unknown }[];
    }
  | { kind: "bundle"; queries: FundingQuery[] }
  | {
      kind: "clarification";
      reason: string;
      message: { bg: string; en: string };
      draft: FundingArgs;
      options?: { label: { bg: string; en: string }; query: FundingQuery }[];
    };
const issue = (
  reason: string,
  bg: string,
  en: string,
  draft: FundingArgs,
  options?: { label: { bg: string; en: string }; query: FundingQuery }[],
): FundingUnderstanding => ({
  kind: "clarification",
  reason,
  message: { bg, en },
  draft,
  options,
});
const normalize = (s: string) =>
  s
    .toLocaleLowerCase("bg")
    .normalize("NFC")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
const themes: Record<string, RegExp> = {
  health: /здравеопаз|болниц|healthcare|health projects/,
  roads: /пътищ|пътни|road/,
  schools: /училищ|school/,
  agriculture: /земеделски проекти|agricultural projects/,
  "guest-houses": /къщи за гости|guest houses/,
  "municipal-infrastructure":
    /общинска инфраструктура|municipal infrastructure/,
};
export function understandFunding(
  question: string,
  options: {
    previous?: FundingQuery;
    catalog?: FundingCatalog;
    now?: Date;
    forcedCorpus?: FundingCorpus;
  } = {},
): FundingUnderstanding {
  if (options.previous) {
    const c = fundingContinuation(question, options.previous);
    if (c?.query)
      return {
        kind: "query",
        query: c.query,
        captures: Object.entries(c.query).map(([field, value]) => ({
          field,
          value,
        })),
      };
    if (c?.reason === "P16") {
      const old = options.previous;
      const incompatible = [
        "from",
        "toExclusive",
        "financialYears",
        "compareFinancialYears",
        "compareFrom",
        "compareToExclusive",
        "asOf",
        "programmeIds",
        "schemeIds",
        "basePredicates",
        "numeratorPredicates",
        "themeIds",
        "beneficiarySectors",
        "fundingMechanisms",
        "fundTypes",
        "statusIds",
        "parentQuery",
        "amountMin",
        "amountMax",
        "keyword",
      ].some((k) => old[k] !== undefined);
      if (
        old.placeIds &&
        old.placeBasis &&
        ["implementation", "partner"].includes(String(old.placeBasis)) &&
        !incompatible &&
        ["records", "amount", "beneficiaries"].includes(old.metric)
      ) {
        const queries = ["isunProjects", "interregPartners"].map((corpus) =>
          validateFundingQuery({
            ...old,
            corpus,
            placeBasis:
              corpus === "isunProjects" ? "implementation" : "partner",
            amountBasis: corpus === "isunProjects" ? "grant" : "partnerBudget",
            dateBasis: "none",
            offset: 0,
            expectedRevision: undefined,
          }),
        );
        if (queries.every((p) => p.ok))
          return {
            kind: "bundle",
            queries: queries.flatMap((p) => (p.ok ? [p.query] : [])),
          };
      }
      return issue(
        "P16",
        "Запазете общината и задайте отделните периоди и условия за ИСУН и Interreg.",
        "Retain the municipality and specify separate periods and conditions for ISUN and Interreg.",
        old,
      );
    }
    if (c?.reason === "P01") {
      const choices =
        options.previous.corpus === "isunProjects"
          ? [
              {
                label: {
                  bg: "Тема на проекта: здравеопазване",
                  en: "Project theme: healthcare",
                },
                patch: { themeIds: ["health"] },
              },
              {
                label: {
                  bg: "Конкретни институции от регистъра МЗ/НЗОК",
                  en: "Specific MZ/NHIF roster institutions",
                },
                patch: { beneficiarySectors: ["nzok"] },
              },
            ]
          : [];
      return issue(
        "healthcare_basis",
        "Изберете тема на проекта или конкретния регистър на институциите.",
        "Choose project theme or the specific institution roster.",
        options.previous,
        choices.flatMap((c) => {
          const p = validateFundingQuery({
            ...options.previous,
            ...c.patch,
            offset: 0,
          });
          return p.ok ? [{ label: c.label, query: p.query }] : [];
        }),
      );
    }
    if (c?.reason)
      return issue(
        c.reason,
        "Уточнете промяната, като запазите обхвата на предишния отговор.",
        "Clarify the change while retaining the previous answer scope.",
        options.previous,
      );
  }
  if (!options.previous) {
    for (const t of FUNDING_TEMPLATES) {
      for (const lang of ["bg", "en"] as const) {
        const years = [...question.matchAll(/20\d{2}/g)].map((m) => m[0]);
        const values: Record<string, unknown> = {};
        if (
          t.query?.financialYears &&
          !t.query.compareFinancialYears &&
          years.length === 1
        )
          values.year = Number(years[0]);
        const period = question.match(/(2007|2014|2021)[–-](2013|2020|2027)/);
        if (t.query?.programmingPeriods && period)
          values.period = period[1] + "-" + period[2];
        if (t.id === "S13") {
          const eik = question.match(/(?:ЕИК|EIK)\s+(\d{9}|\d{13})\b/i),
            scheme = question.match(/(?:схема|scheme)\s+([a-zа-я0-9-]+)/i);
          if (eik && scheme && years.length === 1) {
            values.eik = eik[1];
            values.scheme = scheme[1];
            values.year = years[0];
          }
        }
        const candidate = fundingTemplate(
          "funding-query-" + t.id,
          lang,
          values,
        );
        if (normalize(candidate.text) === normalize(question)) {
          if (!t.query && t.id !== "S13")
            return issue(
              "template_parameters",
              "Посочете конкретните параметри на справката.",
              "Specify concrete query parameters.",
              {},
            );
          if (candidate.tool === "fundingQuestion")
            return issue(
              "template_parameters",
              "Попълнете ЕИК, година и схема.",
              "Provide EIK, year and scheme.",
              {},
            );
          const p = validateFundingQuery(candidate.args);
          if (p.ok)
            return {
              kind: "query",
              query: p.query,
              captures: Object.entries(p.query).map(([field, value]) => ({
                field,
                value,
              })),
            };
        }
      }
    }
    const legacyDiscovery = [
      "Кой получава европейски средства?",
      "Колко европейски средства са усвоени по програма?",
      "Регионално развитие — европейски средства по области",
      "Премахване на партийните субсидии",
      "Колко европейски пари усвоява транспортът?",
      "What is the БДЖ subsidy per passenger?",
      "Каква е субсидията за БДЖ на пътник?",
      "Коя област получава най-много европейски пари на човек?",
      "Европейски пари за околна среда",
      "Колко субсидии раздава ДФ Земеделие?",
      "Break down state transfers to municipalities by type: delegated activities, equalisation and capital subsidies.",
      "Разпредели държавните трансфери към общините по вид: делегирани дейности, изравнителна и капиталова субсидия.",
      "EU funds by oblast",
      "Европейски средства по области",
      "Кой получава най-много европейски средства?",
      "Who gets the most EU funds?",
      "Кой получава най-много земеделски субсидии?",
      "Who gets the most farm subsidies?",
      "Земеделски субсидии по схема",
      "Farm subsidies by scheme",
      "Колко европейски средства са усвоени?",
      "How much EU funding has actually been absorbed?",
    ];
    if (legacyDiscovery.some((s) => normalize(s) === normalize(question)))
      return { kind: "none" };
  }
  const clauses = question
    .split(
      /[?;]\s+(?=(?:how|what|show|count|колко|как|покажи|кои)\s)|\s+(?:and separately|и отделно)\s+/i,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    if (clauses.length > 2)
      return issue(
        "bundle_limit",
        "Най-много две отделни справки наведнъж.",
        "At most two independent queries at once.",
        {},
      );
    const results = clauses.map((c) => understandFunding(c, options));
    if (results.every((r) => r.kind === "query"))
      return {
        kind: "bundle",
        queries: results.map(
          (r) => (r as Extract<FundingUnderstanding, { kind: "query" }>).query,
        ),
      };
    return issue(
      "bundle_scope",
      "Уточнете източника и периода на всеки от двата въпроса.",
      "Clarify the source and period for each question.",
      {},
    );
  }
  const text = normalize(question),
    cat = options.catalog || {},
    now = options.now || new Date();
  if (
    /(?:покажи показателя|show the indicator)|(?:which ngos are flagged|кои нпо имат сигнал)/.test(
      text,
    )
  )
    return { kind: "none" };
  if (
    options.previous &&
    /парламентар|parliamentary|election|избор|weather|времето|procurement|обществените поръчки|поръчки|tenders/.test(
      text,
    )
  )
    return { kind: "none" };
  const explicitIsun =
    /исун|isun|еврофонд|европейск(?:и|ите) (?:средства|фондове|пари)|eu funds|eu funding/.test(
      text,
    );
  const explicitAgri =
    /дфз|дф.?[ „"]*земеделие|земеделски субсид|farm subsid|agricultural subsid|cap payments/.test(
      text,
    );
  const explicitInterreg = /interreg|интеррег/.test(text);
  if (
    /кандидатствам|кандидатстване|отворени процедури|open calls|apply for|eligible to apply/.test(
      text,
    )
  )
    return { kind: "none" };
  if (
    /филм|кино|читалищ|film|community centres|влак|железниц|железопът|railway|пенсии|pension|общински трансфери|municipal transfer/.test(
      text,
    ) &&
    !/исун|isun/.test(text) &&
    !explicitInterreg &&
    !explicitAgri
  )
    return { kind: "none" };
  if (/поръчк|procurement|tenders?/.test(text) && !options.previous) {
    if (!/исун|isun|interreg|интеррег|бенефициент|beneficiar/.test(text))
      return { kind: "none" };
    return issue(
      "funded_procurement_link",
      "Посочете дали търсите поръчките на бенефициентите или доказано финансирани от конкретен проект поръчки. Съвпадение по ЕИК не доказва финансиране.",
      "Specify procurement of beneficiaries or procurement proven to be financed by a project. A shared company ID does not prove funding.",
      {},
    );
  }
  const domains = options.forcedCorpus
    ? [options.forcedCorpus]
    : ([
        explicitIsun ? "isunProjects" : null,
        explicitAgri ? "agriPayments" : null,
        explicitInterreg
          ? /партньор|partner|organisation|организаци/.test(text)
            ? "interregPartners"
            : "interregOperations"
          : null,
      ].filter(Boolean) as FundingCorpus[]);
  if (!domains.length && !options.previous) {
    if (/субсиди|subsid/.test(text))
      return issue(
        "subsidy_family",
        "Кои субсидии: земеделски, филмови или друг вид?",
        "Which subsidies: farm, film or another family?",
        {},
      );
    return { kind: "none" };
  }
  if (domains.length > 1) {
    if (domains.length > 2)
      return issue(
        "bundle_limit",
        "Сравнете най-много два отделни корпуса наведнъж.",
        "Compare at most two separate corpora at once.",
        {},
      );
    if (/20\d{2}|above|below|над|под|how many|how much|колко/.test(text))
      return issue(
        "bundle_scope",
        "Задайте отделен въпрос за всеки източник.",
        "Use a separate question for each source.",
        {},
      );
    const results = domains.map((c) =>
      understandFunding(question, {
        ...options,
        previous: undefined,
        forcedCorpus: c,
      }),
    );
    if (results.every((r) => r.kind === "query"))
      return {
        kind: "bundle",
        queries: results.map(
          (r) => (r as Extract<FundingUnderstanding, { kind: "query" }>).query,
        ),
      };
    return issue(
      "bundle_scope",
      "Уточнете съвместими периоди и отделни парични показатели за двата корпуса.",
      "Specify compatible periods and separate money measures for both corpora.",
      {},
    );
  }
  if (
    options.previous &&
    !domains.length &&
    !/^(?:(?:а|and|за|for|през|in|не|not) )?20\d{2}(?:[ ?.]*$)|grant|paid|programme|scheme|beneficiar|political|unpaid|health|road|municipality|финанс|изплат|безвъзмезд|програм|схем|бенефициент|политическ|здравеопаз|пътищ|община|еик|eik|largest|highest|lowest/.test(
      text,
    )
  )
    return { kind: "none" };
  if (
    /per.capita|на глава от населението|на човек|headquarters|headquartered|седалище на бенефициент/.test(
      text,
    )
  )
    return issue(
      "unsupported_measure_basis",
      "Няма проверена база за този показател или местоположение. Уточнете поддържания обхват.",
      "No verified denominator or location basis supports this request. Specify a supported scope.",
      options.previous || { corpus: domains[0] },
    );
  const corpus = domains[0] || options.previous!.corpus;
  const q: FundingArgs = options.previous
    ? { ...options.previous, limit: 20, offset: 0 }
    : { corpus };
  delete q.expectedRevision;
  q.corpus = corpus;
  const agri = corpus === "agriPayments",
    interreg = corpus.startsWith("interreg");
  if (options.previous && options.previous.corpus !== corpus)
    return issue(
      "corpus_scope_conflict",
      "Смяната на източника изисква потвърждение на запазените филтри. Задайте целия въпрос с новия източник.",
      "Changing source requires reconciling the retained filters. Restate the complete question with the new source.",
      q,
    );
  type Pending = {
    reason: string;
    bg: string;
    en: string;
    choices?: { field: string; value: FundingArgs[string]; label: string }[];
  };
  const pending: Pending[] = [];
  const defer = (
    reason: string,
    bg: string,
    en: string,
    choices?: Pending["choices"],
  ) => pending.push({ reason, bg, en, choices });
  const corrected = text.replace(
    /(?:not|не)\s*(20\d{2})\s*,?\s*(?:but|а)\s*(20\d{2})/g,
    "$2",
  );
  const periods = [
    ...corrected.matchAll(/(2007|2014|2021)\s*-\s*(2013|2020|2027)/g),
  ].map((m) => m[0].replace(/\s/g, ""));
  let rest = corrected.replace(/(2007|2014|2021)\s*-\s*(2013|2020|2027)/g, "");
  if (periods.length) {
    if (agri)
      defer(
        "financial_not_programming",
        "ДФЗ се отчита по финансови години.",
        "DFZ uses financial years.",
      );
    else q.programmingPeriods = periods;
  }
  const fullDates = [...rest.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(
    (m) => m[1],
  );
  if (fullDates.length) {
    defer(
      "explicit_day_interval",
      "Уточнете включването на крайната дата.",
      "Clarify end-date inclusion.",
    );
    for (const d of fullDates) rest = rest.replace(d, "");
  }
  const range = rest.match(
    /(?:от|from)?\s*(\d{2})\/(\d{4})\s*(?:до|to|-)\s*(\d{2})\/(\d{4})/,
  );
  let from: string | undefined, to: string | undefined;
  if (range) {
    if ([Number(range[1]), Number(range[3])].some((m) => m < 1 || m > 12))
      defer("invalid_date", "Невалиден месец.", "Invalid month.");
    else {
      from = `${range[2]}-${range[1]}-01`;
      to = new Date(Date.UTC(Number(range[4]), Number(range[3]), 1))
        .toISOString()
        .slice(0, 10);
      if (!isQueryDate(from) || from >= to)
        defer("invalid_date", "Невалиден период.", "Invalid interval.");
    }
    rest = rest.replace(range[0], "");
  }
  const yearRange = rest.match(/(20\d{2})\s*-\s*(20\d{2})/);
  let years = [...rest.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]);
  if (/тази година|this year/.test(rest)) years.push(String(now.getFullYear()));
  if (/миналата година|last year/.test(rest))
    years.push(String(now.getFullYear() - 1));
  if (/последната налична|latest available/.test(rest) && agri) {
    if (cat.financialYears?.length)
      years.push([...cat.financialYears].sort().at(-1)!);
    else
      defer(
        "latest_year_lookup",
        "Проверете последната налична финансова година.",
        "Check the latest available financial year.",
      );
  }
  const compare =
    /сравни|сравнете|спрямо .*20\d{2}|compare|versus| vs /.test(rest) &&
    years.length === 2;
  if (yearRange && !compare) {
    const start = Number(yearRange[1]),
      end = Number(yearRange[2]);
    if (end < start || end - start > 100)
      defer(
        "invalid_date",
        "Невалиден диапазон от години.",
        "Invalid year range.",
      );
    else
      years = Array.from({ length: end - start + 1 }, (_, i) =>
        String(start + i),
      );
  }
  if (agri) {
    if (
      range ||
      fullDates.length ||
      /календарн|calendar|месеч|monthly/.test(text)
    )
      defer(
        "annual_only",
        "Налични са финансови години; календарни или месечни периоди не се заменят автоматично.",
        "Only financial years are available; calendar or monthly windows cannot be substituted automatically.",
      );
    if (years.length) {
      q.financialYears = compare ? [years[0]] : [...new Set(years)];
      if (compare) {
        q.compareFinancialYears = [years[1]];
        q.operation = "compare";
      } else {
        delete q.compareFinancialYears;
        if (q.operation === "compare") q.operation = "summary";
      }
    }
  } else if (range || years.length) {
    if (!range) {
      const unique = [...new Set(years)].sort();
      if (
        !compare &&
        unique.some((y, i) => i > 0 && Number(y) !== Number(unique[i - 1]) + 1)
      )
        defer(
          "disjoint_years",
          "Използвайте две отделни справки за несъседни години.",
          "Use two separate queries for non-adjacent years.",
        );
      from = `${compare ? years[0] : unique[0]}-01-01`;
      to = `${Number(compare ? years[0] : unique.at(-1)) + 1}-01-01`;
    }
    if (!interreg && !/наблюдаван|видян|observed|first seen/.test(text))
      defer(
        "isun_event_unavailable",
        "ИСУН няма проверени дати на подписване или платежни събития. Програмният период и първото наблюдение са различни обхвати.",
        "ISUN has no verified signing or payment-event dates. Programming period and first observation are distinct scopes.",
      );
    const basis = !interreg
      ? "observed"
      : /започ|стартира|start/.test(text)
        ? "start"
        : /приключ|завърш|ending|end date/.test(text)
          ? "end"
          : /актив|active|overlap/.test(text)
            ? "overlap"
            : null;
    if (from && to) {
      q.from = from;
      q.toExclusive = to;
    }
    if (basis) q.dateBasis = basis;
    else
      defer(
        "interreg_date_basis",
        "Започнали, приключващи или активни по график операции?",
        "Operations starting, ending or scheduled to be active?",
        ["start", "end", "overlap"].map((value) => ({
          field: "dateBasis",
          value,
          label:
            value === "start"
              ? "Начало / Start"
              : value === "end"
                ? "Край / End"
                : "Активни по график / Scheduled activity",
        })),
      );
    if (compare) {
      q.operation = "compare";
      q.compareFrom = `${years[1]}-01-01`;
      q.compareToExclusive = `${Number(years[1]) + 1}-01-01`;
    } else if (years.length || range) {
      delete q.compareFrom;
      delete q.compareToExclusive;
      if (q.operation === "compare") q.operation = "summary";
    }
  }
  if (
    /подписан|signed|платени през|payments during|paid during/.test(text) &&
    interreg
  )
    defer(
      "interreg_event_unavailable",
      "Interreg съдържа график и бюджети, не дати на подписване или плащане.",
      "Interreg contains schedules and budgets, not signing or payment dates.",
    );
  const metricReplacement =
    /value only|само стойност|само сума|grant value|amount ranking/.test(text);
  if (
    options.previous &&
    (metricReplacement ||
      /най-|top |largest|highest|lowest|rank|how many|count|колко проекта/.test(
        text,
      ))
  ) {
    delete q.metric;
    delete q.topN;
    delete q.minGroupCount;
    delete q.denominator;
    if (metricReplacement) {
      q.operation = "sum";
      q.metric = "amount";
      delete q.numeratorPredicates;
    }
  }
  if (!compare) {
    if (/покажи|списък|show|list|who received|кой получи/.test(text))
      q.operation = "list";
    else if (/най-|top |largest|highest|lowest|rank/.test(text))
      q.operation = "rank";
    else if (/процент|дял|share|percent/.test(text)) q.operation = "share";
    else if (/брой|колко проекта|колко операции|how many|count/.test(text))
      q.operation = "count";
    else if (
      /сума|стойност|колко.*изплат|размер|how much|amount|total/.test(text)
    )
      q.operation = "sum";
  }
  if (!options.previous) q.operation ??= "summary";
  if (
    q.operation === "share" &&
    /share of (?:grant |funding )?(?:value|amount)|дял от (?:стойността|сумата)/.test(
      text,
    )
  ) {
    q.metric = "amount";
    q.denominator = "amount";
  }
  if (/бенефициент|beneficiar/.test(text) && q.operation === "count")
    q.metric = "beneficiaries";
  if (
    /организаци|organisations?/.test(text) &&
    q.operation === "count" &&
    corpus === "interregPartners"
  )
    q.metric = "organisations";
  if (/концентраци|concentration|hhi/.test(text)) q.metric = "hhi";
  if (
    /изплатеното спрямо|paid.*(?:share of|\/|relative to)|paid.*grant ratio/.test(
      text,
    )
  ) {
    q.metric = "paidRatio";
    q.operation = "share";
    q.amountBasis = /обща|project cost/.test(text) ? "projectCost" : "grant";
  } else if (/собствено съфинансиране|own cofinanc/.test(text))
    q.amountBasis = "ownCofinance";
  else if (/обща стойност|project cost/.test(text) && !interreg)
    q.amountBasis = "projectCost";
  else if (/безвъзмезд|grant/.test(text) && !interreg && !agri)
    q.amountBasis = "grant";
  else if (/изплат|paid/.test(text) && !interreg) q.amountBasis = "paid";
  if (
    interreg &&
    /eu contribution|европейското съфинансиране|принос на ес/.test(text)
  )
    q.amountBasis = corpus === "interregPartners" ? "partnerEu" : "operationEu";
  if (agri && /директни|direct payment/.test(text)) q.amountBasis = "direct";
  if (agri && /пазарни мерки|market measures/.test(text))
    q.amountBasis = "market";
  if (agri && /развитие на селските|rural development/.test(text))
    q.amountBasis = "rural";
  if (q.operation === "sum") q.metric = "amount";
  if (q.operation === "rank" || /по програми|by programme/.test(text))
    q.groupBy = /кои програми|which programmes|по програми|by programme/.test(
      text,
    )
      ? "programme"
      : /схем|scheme/.test(text)
        ? "scheme"
        : "entity";
  if (/по години|по месеци|trend|by year|by month/.test(text)) {
    q.operation = "trend";
    q.groupBy = agri
      ? "financialYear"
      : /месец|month/.test(text)
        ? "month"
        : "year";
  }
  if (/най-мал|lowest|ascending/.test(text)) q.order = "asc";
  if (q.operation === "rank" && !q.metric) q.metric = "amount";
  const eiks = [...text.matchAll(/(?:еик|eik|company id)\s*[: ]\s*(\d+)/g)].map(
    (m) => m[1],
  );
  if (eiks.length) q.entityIds = eiks;
  if (/пву|rrp|recovery/.test(text) && !interreg && !agri)
    q.fundingMechanisms = ["RRP"];
  if (/норвег|eea|norway/.test(text) && !interreg && !agri)
    q.fundingMechanisms = ["EEA-Norway"];
  const recipientSector =
    /бенефициент.{0,30}здравеопаз|healthcare beneficiar/.test(text);
  if (recipientSector)
    defer(
      "limited_sector_roster",
      "Наличният списък обхваща конкретни институции МЗ/НЗОК, не всички здравни бенефициенти.",
      "The available MZ/NHIF roster contains specific institutions, not all healthcare beneficiaries.",
      [
        {
          field: "beneficiarySectors",
          value: ["nzok"],
          label: "Само списък МЗ/НЗОК / MZ–NHIF roster only",
        },
      ],
    );
  const topicMatches = Object.entries(themes).filter(([, re]) => re.test(text));
  if (interreg && topicMatches.length > 1)
    defer(
      "multiple_interreg_topics",
      "Уточнете общо или отделно търсене по темите.",
      "Clarify combined or separate topic searches.",
    );
  for (const [id, re] of Object.entries(themes))
    if (re.test(text) && !agri && !recipientSector) {
      if (interreg) {
        q.keyword = (
          {
            health: "health",
            roads: "road",
            schools: "school",
            agriculture: "agriculture",
            "guest-houses": "tourism",
            "municipal-infrastructure": "infrastructure",
          } as Record<string, string>
        )[id];
      } else q.themeIds = [...((q.themeIds as string[]) || []), id];
    }
  const amounts = [
    ...text.matchAll(
      /(над|повече от|поне|под|до|above|over|at least|below|under|at most)\s*(eur|евро|€|bgn|лв\.?|usd|\$)?\s*(\d(?:[\d ]*\d)?(?:[.,]\d+)?)\s*(млн\.?|милион\w*|million|хил\.?|thousand)?\s*(евро|eur|€|bgn|лв\.?|usd|\$)?/g,
    ),
  ];
  const currency = amounts.map((m) => (m[2] || m[5] || "").toLowerCase());
  if (
    amounts.length &&
    currency.some((c) => c && !["eur", "евро", "€"].includes(c))
  )
    defer(
      "amount_unit",
      "Паричните прагове трябва да са в евро.",
      "Money thresholds must be expressed in EUR.",
    );
  if (amounts.length && !currency.some((c) => ["eur", "евро", "€"].includes(c)))
    defer(
      "amount_unit",
      "Уточнете валутата на всеки паричен праг.",
      "Specify the currency of each money threshold.",
    );
  if (amounts.length > 1 && / или | or /.test(text))
    defer(
      "money_boolean",
      "Уточнете отделни справки за алтернативни парични диапазони.",
      "Use separate queries for alternative money ranges.",
    );
  for (const m of amounts) {
    const n =
      Number(m[3].replace(/ /g, "").replace(",", ".")) *
      (/млн|милион|million/.test(m[4] || "")
        ? 1e6
        : /хил|thousand/.test(m[4] || "")
          ? 1e3
          : 1);
    const min = /над|повече|поне|above|over|at least/.test(m[1]),
      key = min ? "amountMin" : "amountMax",
      relation = min ? "amountMinRelation" : "amountMaxRelation",
      strict = min ? !/поне|at least/.test(m[1]) : !/до|at most/.test(m[1]);
    if (
      q[key] === undefined ||
      (min ? n > Number(q[key]) : n < Number(q[key]))
    ) {
      q[key] = n;
      q[relation] = min ? (strict ? "gt" : "gte") : strict ? "lt" : "lte";
    } else if (q[key] === n && strict) q[relation] = min ? "gt" : "lt";
  }
  const signals: Record<string, RegExp> = {
    political: /политическ|публичн.{0,10}фигур|public.figure|political/,
    zeroPaid: /нулев.{0,12}изплат|без изплат|zero paid|unpaid/,
    debarredName: /отстранени доставчици|debarred/,
    serialWinner: /повече от една програма|multiple programmes|serial winner/,
    otherFunding: /друг.{0,10}финансиран|other funding/,
    unpublishedBudget: /непубликуван.{0,10}бюджет|unpublished budget/,
    publishedZero: /нулев.{0,10}бюджет|zero budget/,
    unidentified: /без еик|missing eik|without eik/,
    unplaced: /неустановено местоположение|unplaced/,
    lead: /водещ.{0,10}партньор|lead partner/,
    bulgarian: /българск.{0,15}партньор|bulgarian partner/,
  };
  const extractSignals = (span: string) =>
    Object.entries(signals)
      .filter(([, re]) => re.test(span))
      .map(([id, re]) => {
        const at = span.search(re);
        return /без |without |not /.test(span.slice(Math.max(0, at - 12), at))
          ? "!" + id
          : id;
      });
  let baseSpan = "",
    numeratorSpan = text;
  const among = text.match(
    /(?:among|сред)\s+(.+?)(?:,\s*(?:what|какъв|колко)|$)/,
  );
  if (among) {
    baseSpan = among[1];
    numeratorSpan = text.replace(among[0], "");
  } else if (q.operation === "share") {
    const split = text.match(
      /(?:share of|дял от|процент от)\s+(.+?)\s+(?:are|са)\s+(.+)/,
    );
    if (split) {
      baseSpan = split[1];
      numeratorSpan = split[2];
    }
  }
  const setSignals = (span: string, target: "base" | "numerator") => {
    const ids = extractSignals(span);
    if (!ids.length) return;
    if (/(?: и | and )/.test(span) && /(?: или | or )/.test(span))
      defer(
        "predicate_boolean",
        "Уточнете вложените И/ИЛИ условия.",
        "Clarify nested AND/OR conditions.",
      );
    q[target + "Predicates"] = ids;
    q[target + "Mode"] = /(?: или | or )/.test(span) ? "any" : "all";
  };
  if (q.operation === "share") {
    setSignals(baseSpan, "base");
    setSignals(numeratorSpan, "numerator");
  } else if (extractSignals(text).length) {
    setSignals(text, "base");
    delete q.numeratorPredicates;
    delete q.numeratorMode;
  }
  if (
    /корупц|fraud|corrupt|рисков|risk|една оферта|един участник|one bidder|single.bid/.test(
      text,
    )
  )
    return issue(
      "unsupported_signal",
      "Изберете конкретен наличен показател за този източник. Показателите за поръчки не се пренасят върху субсидиите.",
      "Choose a supported signal for this source. Procurement indicators do not transfer to grants or subsidies.",
      q,
    );
  if (/брутен|gross/.test(text) && agri) q.population = "gross";
  // Stable IDs and quoted names are resolved from source catalogs, never highest-value first match.
  const named =
    text.match(
      /(?:програма|programme|схема|scheme|фирма|company|бенефициент|beneficiary)\s*[„“"]([^„“"]+)[“"]/,
    ) ||
    text.match(
      /(?:програма|programme|схема|scheme|фирма|company|бенефициент|beneficiary)\s+([a-zа-я][a-zа-я0-9 .-]*?)(?=\s+(?:за|по|с|от|над|под|през|in|for|with|above|below|grant|paid)\s|[?;,]|$)/,
    );
  if (
    named &&
    !(
      /^(?=.*[a-z])(?=.*\d)[a-z0-9-]+(?:\s|$)/.test(named[1]) &&
      /програма|programme|схема|scheme/.test(named[0])
    )
  ) {
    const company = /фирма|company|бенефициент|beneficiary/.test(named[0]),
      scheme = /схема|scheme/.test(named[0]);
    const rows = company
      ? cat.entities?.map((e) => ({ id: e.eik, label: e.name }))
      : scheme
        ? cat.schemes?.map((s) => ({ id: s.code, label: s.label }))
        : cat.programmes
            ?.filter(
              (p) =>
                p.corpus ===
                  (interreg ? "interregOperations" : "isunProjects") &&
                (!q.programmingPeriods ||
                  (q.programmingPeriods as string[]).includes(p.period)),
            )
            .map((p) => ({ id: p.code, label: p.label_bg }));
    const matches = rows?.filter(
      (r) => normalize(r.label) === named[1] || normalize(r.id) === named[1],
    );
    if (matches?.length === 1)
      q[company ? "entityIds" : scheme ? "schemeIds" : "programmeIds"] = [
        matches[0].id,
      ];
    else
      defer(
        "catalog_name_lookup",
        "Името изисква проверка; изберете точния запис.",
        "Resolve the name and select the exact record.",
        matches?.map((m) => ({
          field: company ? "entityIds" : scheme ? "schemeIds" : "programmeIds",
          value: [m.id],
          label: m.label + " — " + m.id,
        })),
      );
  }

  const code = text.match(
    /(?:програма|programme|схема|scheme)\s+((?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]*\d[a-z0-9-]*)/,
  );
  if (code)
    q[/схема|scheme/.test(code[0]) ? "schemeIds" : "programmeIds"] = [
      code[1].toUpperCase(),
    ];
  const place = text.match(
    /(?:в|in)\s+(?:област|province|region)\s+([^,?.]+?)(?=\s+(?:for|with|за|с|през)\s|[?.,]|$)/,
  );
  if (place) {
    const names = Object.entries(FUNDING_RECIPIENT_PLACES).filter(
      ([, n]) => normalize(n) === place[1],
    );
    if (names.length === 1) {
      q.placeIds = [names[0][0]];
      q.placeBasis = agri
        ? "recipient"
        : interreg
          ? "partner"
          : "implementation";
    } else
      defer(
        "place_lookup",
        "Уточнете областта чрез нейния код или име в каталога.",
        "Resolve the province using its catalog code or name.",
      );
  }
  const municipality = text.match(
    /(?:община|municipality)\s+([^,?.]+?)(?=\s+(?:for|with|за|с|през)\s|[?.,]|$)/,
  );
  if (municipality) {
    const hits = cat.places?.filter(
      (p) =>
        p.level === "municipality" &&
        [p.name, p.name_en].some((n) => n && normalize(n) === municipality[1]),
    );
    if (hits?.length === 1) {
      q.placeIds = [hits[0].id];
      q.placeBasis = interreg ? "partner" : "implementation";
    } else
      defer(
        "place_lookup",
        "Уточнете общината от каталога, като запазите останалите филтри.",
        "Resolve the municipality from the catalog while retaining the other filters.",
      );
  }
  const top = text.match(/(?:топ|top)\s*(\d+)/);
  if (top) {
    if (q.operation === "share") {
      q.metric = "topShare";
      q.topN = Number(top[1]);
    } else q.limit = Number(top[1]);
  }
  if (
    q.themeIds &&
    (q.themeIds as string[]).length > 1 &&
    / и | and /.test(text)
  )
    return issue(
      "theme_boolean",
      "Уточнете дали проектите трябва да съвпадат с всички теми или с някоя от тях.",
      "Clarify whether projects must match every theme or any theme.",
      q,
    );
  if (/юридически лица|legal (?:entities|recipients)/.test(text))
    q.entityClass = "legal";
  if (/физически лица|natural persons|individual recipients/.test(text))
    q.entityClass = "individual";
  const statusMatches = [
    ...text.matchAll(
      /прекратени|terminated|приключени|completed|closed|в изпълнение|ongoing/g,
    ),
  ];
  if (statusMatches.length) {
    const negated = statusMatches.some((m) =>
      /not |не |без |without /.test(
        text.slice(Math.max(0, (m.index || 0) - 10), m.index),
      ),
    );
    if (negated || (statusMatches.length > 1 && !/ или | or /.test(text)))
      defer(
        "status_boolean",
        "Изберете конкретните положителни състояния или уточнете логиката.",
        "Choose explicit positive statuses or clarify the Boolean condition.",
      );
    else
      q.statusIds = [
        ...new Set(
          statusMatches.map((m) =>
            /прекратени|terminated/.test(m[0])
              ? "terminated"
              : /приключени|completed|closed/.test(m[0])
                ? interreg
                  ? "closed"
                  : "completed"
                : interreg
                  ? "ongoing"
                  : "in-progress",
          ),
        ),
      ];
  }
  if (
    /(?:над|под|поне|above|below|over|under|at least)\s*-?\d/.test(text) &&
    !amounts.length
  )
    return issue(
      "amount_unit",
      "Уточнете паричния праг и валутата; тази справка използва евро.",
      "Specify the money threshold and currency; this query uses EUR.",
      q,
    );
  if (
    /тримесеч|quarter|\bq[1-4]\b|последните \d+ месеца|last \d+ months/.test(
      text,
    )
  )
    return issue(
      "time_precision",
      "Уточнете точните граници на периода.",
      "Specify exact period boundaries.",
      q,
    );
  if (/депутат|members? of parliament|\bmp-linked\b/.test(text) && !q.entityIds)
    return issue(
      "connection_subset",
      "Наличният показател е за публични фигури общо, не само за депутати. Уточнете дали приемате този обхват.",
      "The available signal covers public figures generally, not MPs alone. Clarify whether this scope is intended.",
      q,
    );
  if (pending.length) {
    const first = pending[0];
    const choices = pending.length === 1 ? first.choices : undefined;
    return issue(
      first.reason,
      pending.map((p) => p.bg).join(" "),
      pending.map((p) => p.en).join(" "),
      q,
      choices?.flatMap((c) => {
        const v = validateFundingQuery({ ...q, [c.field]: c.value });
        return v.ok
          ? [{ label: { bg: c.label, en: c.label }, query: v.query }]
          : [];
      }),
    );
  }
  const parsed = validateFundingQuery(q);
  if (!parsed.ok)
    return issue(
      "incompatible_scope",
      "Заявеният обхват съдържа несъвместими параметри: " +
        Object.keys(parsed.errors).join(", "),
      "The requested scope contains incompatible parameters: " +
        Object.keys(parsed.errors).join(", "),
      q,
    );
  return {
    kind: "query",
    query: parsed.query,
    captures: Object.entries(parsed.query).map(([field, value]) => ({
      field,
      value,
    })),
  };
}
