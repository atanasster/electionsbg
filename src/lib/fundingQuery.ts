import { isQueryDate, queryInstant } from "./queryDates";
import {
  FUNDING_VERSION,
  FUNDING_STATUSES,
  FUNDING_OPERATION_METRICS,
  FUNDING_CORPORA,
  FUNDING_CAPABILITIES,
  FUNDING_OPERATIONS,
  type FundingCorpus,
} from "./fundingCatalog";
export * from "./fundingCatalog";
export const FUNDING_MAX_ENCODED_SIZE = 16000;
type Field = {
  kind: "text" | "list" | "number";
  values?: readonly string[];
  min?: number;
  max?: number;
  integer?: boolean;
};
const text = (values?: readonly string[]): Field => ({ kind: "text", values });
const list = (values?: readonly string[]): Field => ({ kind: "list", values });
const num = (min: number, max: number, integer = true): Field => ({
  kind: "number",
  min,
  max,
  integer,
});
export const FUNDING_FIELDS: Record<string, Field> = {
  version: text([FUNDING_VERSION]),
  corpus: text(FUNDING_CORPORA),
  operation: text(FUNDING_OPERATIONS),
  metric: text([
    "records",
    "amount",
    "paidRatio",
    "hhi",
    "topShare",
    "beneficiaries",
    "organisations",
  ]),
  dateBasis: text([
    "none",
    "financialYear",
    "observed",
    "start",
    "end",
    "overlap",
  ]),
  from: text(),
  toExclusive: text(),
  compareFrom: text(),
  compareToExclusive: text(),
  asOf: text(),
  financialYears: list(),
  compareFinancialYears: list(),
  programmingPeriods: list(["2007-2013", "2014-2020", "2021-2027", "unknown"]),
  programmeIds: list(),
  schemeIds: list(),
  entityIds: list(),
  entityClass: text(["all", "legal", "individual"]),
  fundingMechanisms: list(["EU", "EEA-Norway", "RRP", "other", "unknown"]),
  fundTypes: list(),
  themeIds: list(),
  beneficiarySectors: list(),
  keyword: text(),
  statusIds: list(),
  placeIds: list(),
  placeBasis: text(["implementation", "recipient", "partner", "eligible"]),
  amountBasis: text([
    "grant",
    "projectCost",
    "ownCofinance",
    "paid",
    "direct",
    "market",
    "rural",
    "operationBudget",
    "operationEu",
    "partnerBudget",
    "partnerEu",
  ]),
  amountMin: num(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false),
  amountMax: num(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false),
  amountMinRelation: text(["gt", "gte"]),
  amountMaxRelation: text(["lt", "lte"]),
  currency: text(["EUR"]),
  basePredicates: list(),
  numeratorPredicates: list(),
  baseMode: text(["all", "any"]),
  numeratorMode: text(["all", "any"]),
  denominator: text(["records", "evaluable", "amount"]),
  population: text(["attributable", "gross"]),
  groupBy: text([
    "entity",
    "programme",
    "scheme",
    "financialYear",
    "theme",
    "place",
    "month",
    "year",
  ]),
  order: text(["asc", "desc"]),
  limit: num(1, 100),
  offset: num(0, 10000),
  topN: num(1, 1000),
  minGroupCount: num(1, 100000000),
  key: text(),
  expectedRevision: text(),
  parentQuery: text(),
  relationship: text(["operationsToPartners", "partnersToOperations"]),
};
export type FundingArgs = Record<
  string,
  string | number | string[] | undefined
>;
export type FundingQuery = FundingArgs & {
  version: typeof FUNDING_VERSION;
  corpus: FundingCorpus;
  operation: string;
  metric: string;
  dateBasis: string;
  amountBasis: string;
  currency: "EUR";
  population: string;
  limit: number;
  offset: number;
  financialYears?: string[];
  programmingPeriods?: string[];
  programmeIds?: string[];
  schemeIds?: string[];
  entityIds?: string[];
  themeIds?: string[];
  placeIds?: string[];
  basePredicates?: string[];
  numeratorPredicates?: string[];
  from?: string;
  toExclusive?: string;
  groupBy?: string;
  parentQuery?: string;
};
export type FundingValidation =
  | { ok: true; query: FundingQuery }
  | { ok: false; errors: Record<string, string> };
const cleanString = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 256 &&
  v.trim().length > 0 &&
  ![...v].some((c) => c.charCodeAt(0) < 32) &&
  (() => {
    try {
      encodeURIComponent(v);
      return true;
    } catch {
      return false;
    }
  })();
export function fundingQueryKey(q: FundingQuery): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(q)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
export function validateFundingQuery(raw: unknown): FundingValidation {
  const errors: Record<string, string> = Object.create(null),
    q: FundingArgs = Object.create(null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, errors: { query: "object required" } };
  for (const [key, v] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(FUNDING_FIELDS, key)) {
      errors[key] = "unknown field";
      continue;
    }
    if (v === undefined) continue;
    const f = FUNDING_FIELDS[key];
    if (f.kind === "number") {
      const n =
        typeof v === "number"
          ? v
          : typeof v === "string" && v.trim()
            ? Number(v)
            : NaN;
      if (
        !Number.isFinite(n) ||
        n < f.min! ||
        n > f.max! ||
        (f.integer && !Number.isSafeInteger(n))
      )
        errors[key] = "invalid number";
      else q[key] = n;
    } else if (f.kind === "list") {
      if (
        !Array.isArray(v) ||
        v.length === 0 ||
        v.length > 200 ||
        !v.every(cleanString) ||
        v.some((x) => f.values && !f.values.includes(x.trim()))
      )
        errors[key] = "invalid list";
      else if (v.length)
        q[key] = [...new Set(v.map((x) => x.trim().normalize("NFC")))].sort();
    } else if (key === "parentQuery" || key === "expectedRevision") {
      if (
        typeof v !== "string" ||
        v.length > (key === "parentQuery" ? 8000 : 2000) ||
        !v.length
      )
        errors[key] = "invalid encoding";
      else q[key] = v;
    } else if (!cleanString(v) || (f.values && !f.values.includes(v.trim())))
      errors[key] = "invalid value";
    else q[key] = v.trim().normalize("NFC");
  }
  if (!FUNDING_CORPORA.includes(q.corpus as FundingCorpus))
    errors.corpus = "required corpus";
  if (Object.keys(errors).length) return { ok: false, errors };
  const corpus = q.corpus as FundingCorpus,
    cap = FUNDING_CAPABILITIES[corpus],
    agri = corpus === "agriPayments",
    interreg = corpus.startsWith("interreg");
  Object.assign(q, {
    version: q.version ?? FUNDING_VERSION,
    operation: q.operation ?? "summary",
    metric: q.metric ?? (q.operation === "sum" ? "amount" : "records"),
    dateBasis: q.dateBasis ?? (agri ? "financialYear" : "none"),
    amountBasis: q.amountBasis ?? cap.defaultAmount,
    currency: "EUR",
    population: q.population ?? "attributable",
    limit: q.limit ?? 20,
    offset: q.offset ?? 0,
    baseMode: q.baseMode ?? "all",
    numeratorMode: q.numeratorMode ?? "all",
    denominator: q.denominator ?? "records",
    entityClass: q.entityClass ?? "all",
    order: q.order ?? "desc",
  });
  const arr = (k: string) => (q[k] as string[] | undefined) || [];
  const has = (k: string) => q[k] !== undefined;
  const reject = (k: string, why: string) => {
    errors[k] = why;
  };
  if (
    !FUNDING_OPERATION_METRICS[String(q.operation)].includes(String(q.metric))
  )
    reject("metric", "metric incompatible with operation");
  if (
    arr("statusIds").some(
      (status) => !FUNDING_STATUSES[corpus].includes(status),
    )
  )
    reject("statusIds", "unsupported corpus status");
  if (!(cap.dates as string[]).includes(String(q.dateBasis)))
    reject("dateBasis", "unsupported date basis");
  if (!(cap.amounts as string[]).includes(String(q.amountBasis)))
    reject("amountBasis", "unsupported money basis");
  for (const k of [
    "from",
    "toExclusive",
    "compareFrom",
    "compareToExclusive",
  ]) {
    if (has(k) && !isQueryDate(String(q[k])))
      reject(k, "invalid calendar date");
  }
  for (const [start, end] of [
    ["from", "toExclusive"],
    ["compareFrom", "compareToExclusive"],
  ])
    if (has(start) && has(end) && String(q[start]) >= String(q[end]))
      reject(start, "empty or reversed period");
  if (
    ["from", "toExclusive", "compareFrom", "compareToExclusive"].some(has) &&
    ["none", "financialYear"].includes(String(q.dateBasis))
  )
    reject("dateBasis", "calendar window needs supported event basis");
  if (q.dateBasis === "overlap" && (!has("from") || !has("toExclusive")))
    reject("dateBasis", "overlap needs both bounds");
  for (const k of ["financialYears", "compareFinancialYears"]) {
    if (has(k) && (!agri || !arr(k).every((y) => /^(?:19|20)\d{2}$/.test(y))))
      reject(k, "financial-year scope requires DFZ years");
  }
  if (agri && has("programmingPeriods"))
    reject("programmingPeriods", "DFZ uses financial years");
  if (has("schemeIds") && !agri) reject("schemeIds", "schemes require DFZ");
  if (
    agri &&
    ["programmeIds", "fundingMechanisms", "fundTypes", "themeIds"].some(has)
  )
    reject("corpus", "unsupported DFZ classification");
  if (interreg && ["fundingMechanisms", "fundTypes", "themeIds"].some(has))
    reject(
      "corpus",
      "unsupported Interreg classification; use programme or explicit keyword",
    );
  if (
    corpus === "interregOperations" &&
    ["entityIds", "beneficiarySectors"].some(has)
  )
    reject("entityIds", "partner identity requires partner corpus");
  if (corpus === "interregOperations" && q.entityClass !== "all")
    reject("entityClass", "partner classification requires partner corpus");
  if (arr("entityIds").some((id) => !/^\d{9}(?:\d{4})?$/.test(id)))
    reject(
      "entityIds",
      "verified EIK shape required; personal identifiers not accepted",
    );
  if (
    arr("placeIds").some(
      (id) =>
        !/^\d{5}$|^[A-Z]{3}(?:\d{2})?$|^S\d{4}$|^SFO_CITY$|^BG\d{2,3}$/.test(
          id,
        ),
    )
  )
    reject("placeIds", "invalid canonical place");
  if (has("placeIds") && !has("placeBasis"))
    reject("placeBasis", "geography basis required");
  if (has("placeBasis")) {
    const allowed = agri
      ? ["recipient"]
      : corpus === "isunProjects"
        ? ["implementation"]
        : corpus === "interregPartners"
          ? ["partner", "eligible"]
          : ["eligible"];
    if (!allowed.includes(String(q.placeBasis)))
      reject("placeBasis", "unsupported geography basis");
  }
  if (!agri && q.population === "gross")
    reject("population", "gross source alternative only for DFZ");
  for (const key of ["basePredicates", "numeratorPredicates"]) {
    if (
      arr(key).length > 20 ||
      arr(key).some(
        (p) => !(cap.predicates as string[]).includes(p.replace(/^!/, "")),
      )
    )
      reject(key, "unsupported predicate");
  }
  if (has("amountMinRelation") && !has("amountMin"))
    reject("amountMinRelation", "minimum missing");
  if (has("amountMaxRelation") && !has("amountMax"))
    reject("amountMaxRelation", "maximum missing");
  if (
    has("amountMin") &&
    has("amountMax") &&
    (Number(q.amountMin) > Number(q.amountMax) ||
      (q.amountMin === q.amountMax &&
        (q.amountMinRelation === "gt" || q.amountMaxRelation === "lt")))
  )
    reject("amountMin", "empty amount interval");
  if (has("amountMin")) q.amountMinRelation ??= "gte";
  if (has("amountMax")) q.amountMaxRelation ??= "lte";
  if (has("groupBy") && !(cap.groups as string[]).includes(String(q.groupBy)))
    reject("groupBy", "unsupported grouping");
  if (["month", "year"].includes(String(q.groupBy)) && q.dateBasis === "none")
    reject("groupBy", "time grouping requires date basis");
  if (q.operation === "rank" && !has("groupBy"))
    reject("groupBy", "rank requires group");
  if (q.operation === "trend" && !has("groupBy"))
    q.groupBy = agri ? "financialYear" : "month";
  if (
    q.operation === "trend" &&
    !(agri ? ["financialYear"] : ["month", "year"]).includes(String(q.groupBy))
  )
    reject("groupBy", "trend requires compatible time axis");
  if (q.operation === "trend" && q.dateBasis === "none")
    reject("dateBasis", "trend requires date basis");
  if (q.operation === "detail" && !has("key"))
    reject("key", "detail requires key");
  if (has("key") && q.operation !== "detail")
    reject("key", "key requires detail");
  if (q.operation === "compare") {
    if (has("groupBy")) reject("groupBy", "comparison grouping unsupported");
    if (
      agri
        ? !has("financialYears") || !has("compareFinancialYears")
        : !has("from") ||
          !has("toExclusive") ||
          !has("compareFrom") ||
          !has("compareToExclusive")
    )
      reject(
        "operation",
        "comparison requires two explicit compatible periods",
      );
  } else if (
    ["compareFinancialYears", "compareFrom", "compareToExclusive"].some(has)
  )
    reject("operation", "comparison fields require compare");
  if (
    q.metric === "paidRatio" &&
    (corpus !== "isunProjects" ||
      !["grant", "projectCost"].includes(String(q.amountBasis)))
  )
    reject(
      "metric",
      "paid ratio requires ISUN grant or project-cost denominator",
    );
  if (["hhi", "topShare"].includes(String(q.metric))) {
    if (corpus === "interregOperations")
      reject("metric", "concentration requires recipient/partner grain");
    q.topN ??= 10;
    q.minGroupCount ??= 2;
  }
  if (q.metric === "organisations" && corpus !== "interregPartners")
    reject("metric", "organisation count requires source organisation IDs");
  if (q.metric === "beneficiaries" && corpus === "interregOperations")
    reject("metric", "beneficiary count requires partner grain");
  if (
    q.operation === "share" &&
    !arr("numeratorPredicates").length &&
    !["paidRatio", "topShare"].includes(String(q.metric))
  )
    reject("numeratorPredicates", "share requires numerator");
  if (has("asOf")) {
    const instant = queryInstant(String(q.asOf));
    if (!instant) reject("asOf", "invalid instant");
    else q.asOf = instant;
    if (q.dateBasis !== "overlap")
      reject(
        "asOf",
        "only schedule overlap supports asOf; no historical state snapshots",
      );
  }
  if (has("parentQuery") || has("relationship")) {
    try {
      if (typeof q.parentQuery !== "string") throw Error();
      const parentRaw = JSON.parse(decodeURIComponent(q.parentQuery));
      if (parentRaw?.parentQuery) throw Error();
      const parent = validateFundingQuery(parentRaw);
      if (
        !parent.ok ||
        parent.query.groupBy ||
        ["compare", "rank", "trend", "methodology"].includes(
          parent.query.operation,
        )
      )
        throw Error();
      const valid =
        (q.relationship === "operationsToPartners" &&
          parent.query.corpus === "interregOperations" &&
          corpus === "interregPartners") ||
        (q.relationship === "partnersToOperations" &&
          parent.query.corpus === "interregPartners" &&
          corpus === "interregOperations");
      if (!valid) throw Error();
      q.parentQuery = encodeFundingQuery(parent.query);
      if (q.parentQuery.length > 8000) throw Error();
    } catch {
      reject("parentQuery", "invalid one-hop parent relationship");
    }
  }
  if (!Object.keys(errors).length) {
    try {
      if (
        encodeURIComponent(fundingQueryKey(q as FundingQuery)).length >
        FUNDING_MAX_ENCODED_SIZE
      )
        reject("query", "query too large");
    } catch {
      reject("query", "invalid encoding");
    }
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, query: q as FundingQuery };
}
export function encodeFundingQuery(q: FundingQuery): string {
  return encodeURIComponent(fundingQueryKey(q));
}
export function decodeFundingQuery(value: string): FundingValidation {
  if (value.length > FUNDING_MAX_ENCODED_SIZE)
    return { ok: false, errors: { query: "query too large" } };
  try {
    return validateFundingQuery(JSON.parse(decodeURIComponent(value)));
  } catch {
    return { ok: false, errors: { query: "invalid query encoding" } };
  }
}
