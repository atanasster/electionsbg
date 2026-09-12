// Shared, browser-safe query contract. The functions build bundles this module;
// no backend accepts SQL, arbitrary expressions, or undeclared query fields.
import {
  CATALOG_VERSION,
  RISK_MASK_BITS,
  TENDER_FLAGS,
} from "./riskFlagCatalog";
import { PROCUREMENT_BUYER_SECTORS } from "./procurementBuyerSectors";
import { PROCUREMENT_SUBJECTS } from "./procurementSubjects";
import { TENDER_TOPICS } from "./tenderTopics";
export { PROCUREMENT_BUYER_SECTORS, PROCUREMENT_SUBJECTS };
export const PROCUREMENT_TOPICS = TENDER_TOPICS.map((topic) => ({
  id: topic.slug,
  label: topic.label,
  cpvPrefixes: topic.cpv,
  pattern: topic.pattern.source,
}));

export const PROCUREMENT_QUERY_VERSION = "procurement-records-v1";
export const PROCUREMENT_MAX_ENCODED_SIZE = 16000;
export const PROCUREMENT_CORPORA = [
  "contracts",
  "amendments",
  "tenders",
  "appeals",
  "decisions",
] as const;
export type ProcurementCorpus = (typeof PROCUREMENT_CORPORA)[number];
export const PROCUREMENT_OPERATIONS = [
  "summary",
  "count",
  "share",
  "sum",
  "list",
  "rank",
  "trend",
  "compare",
  "detail",
  "methodology",
] as const;
export type ProcurementOperation = (typeof PROCUREMENT_OPERATIONS)[number];
export const PROCUREMENT_METRICS = [
  "records",
  "value",
  "oneBid",
  "riskCount",
  "cri",
  "appealed",
  "upheld",
  "suspended",
  "risk",
] as const;
export type ProcurementMetric = (typeof PROCUREMENT_METRICS)[number];
export const PROCUREMENT_METRICS_BY_CORPUS = {
  contracts: PROCUREMENT_METRICS,
  amendments: PROCUREMENT_METRICS,
  tenders: [
    "records",
    "value",
    "riskCount",
    "appealed",
    "upheld",
    "suspended",
    "risk",
  ],
  appeals: ["records", "appealed", "upheld", "suspended"],
  decisions: ["records", "upheld", "suspended"],
} as const;
export type ProcurementDateBasis =
  | "record"
  | "published"
  | "signed"
  | "deadline"
  | "complaint"
  | "decision";
export type ProcurementWireArgs = Record<
  string,
  string | number | string[] | undefined
>;
export const PROCUREMENT_RISKS = {
  contracts: [...RISK_MASK_BITS],
  amendments: [...RISK_MASK_BITS],
  tenders: TENDER_FLAGS.map((f) => f.id),
  appeals: [],
  decisions: [],
} as const;
export const PROCUREMENT_DATE_BASES: Record<
  ProcurementCorpus,
  readonly ProcurementDateBasis[]
> = {
  contracts: ["record", "signed"],
  amendments: ["record"],
  tenders: ["published", "deadline"],
  appeals: ["complaint", "decision"],
  decisions: ["decision"],
};
export type PredicateMode = "all" | "any";
export type QueryField = {
  kind: "text" | "number" | "list";
  values?: readonly string[];
  min?: number;
  max?: number;
  integer?: boolean;
};
const text = (values?: readonly string[]): QueryField => ({
  kind: "text",
  values,
});
const number = (
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  integer = true,
): QueryField => ({ kind: "number", min, max, integer });
const list = (): QueryField => ({ kind: "list" });
const validUnicode = (value: string): boolean => {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
};

// Also drives the tool's parameter schema and the deployed validation artifact.
export const PROCUREMENT_FIELDS: Record<string, QueryField> = {
  version: text([PROCUREMENT_QUERY_VERSION]),
  corpus: text(PROCUREMENT_CORPORA),
  operation: text(PROCUREMENT_OPERATIONS),
  metric: text(PROCUREMENT_METRICS),
  from: text(),
  toExclusive: text(),
  dateBasis: text([
    "record",
    "published",
    "signed",
    "deadline",
    "complaint",
    "decision",
  ]),
  buyerIds: list(),
  supplierIds: list(),
  buyerSectors: list(),
  subjectSectors: list(),
  cpvPrefixes: list(),
  topic: text(),
  keyword: text(),
  basePredicates: list(),
  baseMode: text(["all", "any"]),
  numeratorPredicates: list(),
  numeratorMode: text(["all", "any"]),
  denominator: text(["all", "positiveKnown", "evaluable", "merits"]),
  bidderMin: number(),
  bidderMax: number(),
  minRiskCount: number(0, 17),
  maxRiskCount: number(0, 17),
  amountMin: number(0, Number.MAX_SAFE_INTEGER, false),
  amountMax: number(0, Number.MAX_SAFE_INTEGER, false),
  amountMinRelation: text(["gte", "gt"]),
  amountMaxRelation: text(["lte", "lt"]),
  currency: text(["EUR", "BGN"]),
  valueBasis: text(["current", "signing", "estimate"]),
  procedure: text(),
  status: text(["all", "cancelled", "notCancelled", "open", "closed"]),
  actKind: text(["решения", "определения", "разпореждания", "unknown"]),
  outcome: text(["уважена", "отхвърлена", "прекратена", "отказана", "unknown"]),
  funding: text(["eu", "notEu", "unknown"]),
  framework: text(["yes", "no", "unknown"]),
  groupBy: text(["buyer", "supplier", "month", "year", "cpv", "outcome"]),
  order: text(["asc", "desc"]),
  minGroupCount: number(),
  minGroupCountBasis: text(["population", "evaluable"]),
  limit: number(1, 100),
  offset: number(0, 10000),
  parentQuery: text(),
  relatedCorpus: text(["appeals", "decisions"]),
  relatedFrom: text(),
  relatedToExclusive: text(),
  relatedDateBasis: text(["complaint", "decision"]),
  compareFrom: text(),
  compareToExclusive: text(),
  asOf: text(),
  key: text(),
};

export interface ProcurementQuery extends ProcurementWireArgs {
  version: typeof PROCUREMENT_QUERY_VERSION;
  corpus: ProcurementCorpus;
  operation: ProcurementOperation;
  metric: ProcurementMetric;
  dateBasis: ProcurementDateBasis;
  denominator: "all" | "positiveKnown" | "evaluable" | "merits";
  baseMode: PredicateMode;
  numeratorMode: PredicateMode;
  valueBasis: "current" | "signing" | "estimate";
  currency: "EUR" | "BGN";
  limit: number;
  offset: number;
  buyerIds?: string[];
  supplierIds?: string[];
  buyerSectors?: string[];
  subjectSectors?: string[];
  cpvPrefixes?: string[];
  basePredicates?: string[];
  numeratorPredicates?: string[];
  from?: string;
  toExclusive?: string;
  compareFrom?: string;
  compareToExclusive?: string;
  relatedFrom?: string;
  relatedToExclusive?: string;
  parentQuery?: string;
  relatedCorpus?: "appeals" | "decisions";
  topic?: string;
  keyword?: string;
  status?: string;
  groupBy?: string;
  asOf?: string;
  key?: string;
}
export type ProcurementValidation =
  | { ok: true; query: ProcurementQuery }
  | { ok: false; errors: Record<string, string> };
export const isProcurementDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
/** Parse only supported complete ISO instants, without Date's overflow normalization. */
export function procurementInstant(value: string): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !match ||
    !isProcurementDate(match[1]) ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4] ?? 0) > 59
  )
    return null;
  const zone = match[6];
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export const procurementPredicateIds = (
  corpus: ProcurementCorpus,
): string[] => [
  ...(corpus === "contracts" || corpus === "amendments" ? ["oneBid"] : []),
  ...(corpus !== "decisions" ? ["appealed"] : []),
  "upheld",
  "suspended",
  ...(["appeals", "decisions"].includes(corpus) ? ["unlinked"] : []),
  ...(corpus === "appeals" ? ["interimRequested"] : []),
  ...PROCUREMENT_RISKS[corpus].map((id) => `risk:${id}`),
];

/** Closed wire validation is repeated on the server, including cross-field rules. */
export function validateProcurementQuery(raw: unknown): ProcurementValidation {
  const errors: Record<string, string> = Object.create(null);
  const args: ProcurementWireArgs = Object.create(null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, errors: { query: "object required" } };
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(PROCUREMENT_FIELDS, key)) {
      errors[key] = "unknown field";
      continue;
    }
    if (value === undefined) continue;
    const field = PROCUREMENT_FIELDS[key];
    if (field.kind === "number") {
      const n =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim()
            ? Number(value)
            : NaN;
      if (
        !Number.isFinite(n) ||
        (field.integer && !Number.isSafeInteger(n)) ||
        n < field.min! ||
        n > field.max!
      )
        errors[key] = "invalid number";
      else args[key] = n;
    } else if (field.kind === "list") {
      if (
        !Array.isArray(value) ||
        value.length > 200 ||
        value.some(
          (v) =>
            typeof v !== "string" ||
            !v.trim() ||
            v.length > 256 ||
            !validUnicode(v),
        )
      )
        errors[key] = "invalid list";
      else if (value.length)
        args[key] = [...new Set(value.map((v: string) => v.trim()))].sort();
    } else if (
      typeof value !== "string" ||
      !validUnicode(value) ||
      !value.trim() ||
      value.length > (key === "parentQuery" ? 8000 : 256) ||
      (field.values && !field.values.includes(value))
    )
      errors[key] = "invalid value";
    else args[key] = value.trim();
  }
  if (!PROCUREMENT_CORPORA.includes(args.corpus as ProcurementCorpus))
    errors.corpus = "corpus required";
  const corpus = (args.corpus ?? "contracts") as ProcurementCorpus;
  if (errors.corpus) return { ok: false, errors };
  if (args.parentQuery) {
    try {
      const rawParent = JSON.parse(
        decodeURIComponent(String(args.parentQuery)),
      );
      if (
        rawParent.parentQuery ||
        !["contracts", "tenders"].includes(rawParent.corpus) ||
        !["appeals", "decisions", "tenders"].includes(corpus) ||
        rawParent.corpus === corpus ||
        rawParent.groupBy ||
        rawParent.minGroupCount ||
        ["compare", "methodology", "rank", "trend"].includes(
          rawParent.operation,
        )
      )
        throw Error();
      const parent = validateProcurementQuery(rawParent);
      if (!parent.ok) throw Error();
      args.parentQuery = encodeURIComponent(procurementQueryKey(parent.query));
    } catch {
      errors.parentQuery = "invalid or unsupported parent cohort";
    }
  }
  if (args.actKind && corpus !== "decisions")
    errors.actKind = "act kind requires decisions corpus";
  args.version ??= PROCUREMENT_QUERY_VERSION;
  args.operation ??= "summary";
  args.metric ??= args.operation === "sum" ? "value" : "records";
  args.dateBasis ??= PROCUREMENT_DATE_BASES[corpus][0];
  args.denominator ??= "all";
  args.valueBasis ??= corpus === "tenders" ? "estimate" : "current";
  args.currency ??= "EUR";
  args.baseMode ??= "all";
  args.numeratorMode ??= "all";
  args.limit ??= 20;
  args.offset ??= 0;
  if (
    !(PROCUREMENT_METRICS_BY_CORPUS[corpus] as readonly string[]).includes(
      String(args.metric),
    )
  )
    errors.metric = "unsupported corpus metric";
  if (
    !PROCUREMENT_DATE_BASES[corpus].includes(
      args.dateBasis as ProcurementDateBasis,
    )
  )
    errors.dateBasis = "date basis does not apply to corpus";
  for (const [fromKey, toKey] of [
    ["from", "toExclusive"],
    ["relatedFrom", "relatedToExclusive"],
    ["compareFrom", "compareToExclusive"],
  ]) {
    for (const key of [fromKey, toKey])
      if (args[key] !== undefined && !isProcurementDate(String(args[key])))
        errors[key] = "invalid calendar date";
    if (
      args[fromKey] &&
      args[toKey] &&
      String(args[fromKey]) >= String(args[toKey])
    )
      errors[toKey] = "end must follow start";
  }
  for (const [min, max] of [
    ["bidderMin", "bidderMax"],
    ["amountMin", "amountMax"],
    ["minRiskCount", "maxRiskCount"],
  ])
    if (
      args[min] !== undefined &&
      args[max] !== undefined &&
      Number(args[min]) > Number(args[max])
    )
      errors[max] = "maximum below minimum";
  if (args.amountMinRelation && args.amountMin === undefined)
    errors.amountMin = "lower bound required";
  if (args.amountMaxRelation && args.amountMax === undefined)
    errors.amountMax = "upper bound required";
  const allowed = procurementPredicateIds(corpus);
  for (const [key, catalog] of [
    ["buyerSectors", PROCUREMENT_BUYER_SECTORS],
    ["subjectSectors", PROCUREMENT_SUBJECTS],
  ] as const) {
    if (
      (args[key] as string[] | undefined)?.some(
        (id) => !Object.prototype.hasOwnProperty.call(catalog, id),
      )
    )
      errors[key] = "unknown sector";
  }
  if (args.topic && !TENDER_TOPICS.some((topic) => topic.slug === args.topic))
    errors.topic = "unknown topic";
  for (const key of ["basePredicates", "numeratorPredicates"]) {
    const predicates = args[key] as string[] | undefined;
    if (
      predicates &&
      (predicates.length > 17 ||
        predicates.some((p) => !allowed.includes(p.replace(/^!/, ""))))
    )
      errors[key] = "unsupported predicate";
  }
  for (const key of ["buyerIds", "supplierIds"])
    if (
      (args[key] as string[] | undefined)?.some(
        (id) => !/^(?:\d{9,13}|(?:obed|np|ph)-[a-zA-Z0-9-]+)$/.test(id),
      )
    )
      errors[key] = "invalid identity";
  if (
    (args.cpvPrefixes as string[] | undefined)?.some(
      (cpv) => !/^\d{2,8}$/.test(cpv),
    )
  )
    errors.cpvPrefixes = "invalid CPV prefix";
  const contract = corpus === "contracts" || corpus === "amendments";
  const has = (key: string) => args[key] !== undefined;
  if (!contract)
    for (const key of ["supplierIds", "bidderMin", "bidderMax"])
      if (has(key)) errors[key] = "contract-only field";
  if (!contract && ["oneBid", "cri"].includes(String(args.metric)))
    errors.metric = "contract-only metric";
  if (!["contracts", "amendments", "tenders"].includes(corpus)) {
    for (const key of [
      "amountMin",
      "amountMax",
      "amountMinRelation",
      "amountMaxRelation",
      "minRiskCount",
      "maxRiskCount",
      "procedure",
      "funding",
      "framework",
      "status",
    ])
      if (has(key)) errors[key] = "unsupported corpus filter";
    if (["value", "risk", "riskCount"].includes(String(args.metric)))
      errors.metric = "unsupported corpus metric";
  }
  if (has("status") && corpus !== "tenders")
    errors.status = "tender-only status";
  if (has("outcome") && !["appeals", "decisions"].includes(corpus))
    errors.outcome = "outcome requires an appeals or decisions corpus";
  if (
    (args.valueBasis === "estimate" && corpus !== "tenders") ||
    (corpus === "tenders" && args.valueBasis !== "estimate") ||
    (corpus === "amendments" && args.valueBasis === "signing")
  )
    errors.valueBasis = "incompatible value basis";
  if (args.denominator === "positiveKnown" && !contract)
    errors.denominator = "bid denominator requires contracts";
  if (
    args.denominator === "merits" &&
    !["appeals", "decisions"].includes(corpus)
  )
    errors.denominator = "merits denominator requires KZK";
  if (
    args.metric === "risk" &&
    !(args.numeratorPredicates as string[] | undefined)?.length
  )
    errors.numeratorPredicates = "risk measure requires predicates";
  if (args.operation === "detail" && !args.key)
    errors.key = "detail requires identity";
  if (args.operation === "sum" && args.metric !== "value")
    errors.metric = "sum requires value";
  if (
    args.operation === "share" &&
    (["value", "riskCount", "cri"].includes(String(args.metric)) ||
      (args.metric === "records" &&
        !(args.numeratorPredicates as string[] | undefined)?.length))
  )
    errors.metric = "share requires a predicate measure";
  if (
    (args.minGroupCount !== undefined ||
      args.minGroupCountBasis !== undefined) &&
    !args.groupBy
  )
    errors.groupBy = "minimum sample requires grouping";
  if (args.operation === "rank" && !args.groupBy)
    errors.groupBy = "ranking requires grouping";
  if (
    (args.groupBy === "supplier" && !contract) ||
    (args.groupBy === "outcome" && !["appeals", "decisions"].includes(corpus))
  )
    errors.groupBy = "incompatible grouping";
  if (
    args.operation === "compare" &&
    (!args.compareFrom || !args.compareToExclusive)
  )
    errors.compareFrom = "comparison requires second period";
  if (
    args.operation !== "compare" &&
    (args.compareFrom || args.compareToExclusive)
  )
    errors.operation = "comparison dates require compare";
  if (args.relatedFrom || args.relatedToExclusive || args.relatedDateBasis) {
    if (!args.relatedCorpus) errors.relatedCorpus = "related corpus required";
  }
  if (args.relatedCorpus) {
    if (
      !["contracts", "tenders", "appeals"].includes(corpus) ||
      corpus === args.relatedCorpus
    )
      errors.relatedCorpus = "unsupported relation";
    args.relatedDateBasis ??=
      args.relatedCorpus === "appeals" ? "complaint" : "decision";
    if (
      args.relatedDateBasis !==
      (args.relatedCorpus === "appeals" ? "complaint" : "decision")
    )
      errors.relatedDateBasis = "incompatible related date basis";
  }
  if (args.asOf !== undefined) {
    const instant =
      typeof args.asOf === "string" ? procurementInstant(args.asOf) : null;
    if (!instant) errors.asOf = "valid ISO timestamp with timezone required";
    else args.asOf = instant;
  }
  if (args.status === "open" || args.status === "closed")
    if (!args.asOf) errors.asOf = "open status requires an explicit instant";
  try {
    if (
      encodeURIComponent(procurementQueryKey(args as ProcurementQuery)).length >
      PROCUREMENT_MAX_ENCODED_SIZE
    )
      errors.query = "query too large";
  } catch {
    errors.query = "invalid Unicode";
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, query: args as ProcurementQuery };
}

export function procurementQueryKey(query: ProcurementQuery): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );
}
export function encodeProcurementQuery(query: ProcurementQuery): string {
  const valid = validateProcurementQuery(query);
  if (!valid.ok) throw new Error("Invalid procurement query");
  return encodeURIComponent(procurementQueryKey(valid.query));
}
export function decodeProcurementQuery(value: string): ProcurementValidation {
  if (value.length > PROCUREMENT_MAX_ENCODED_SIZE)
    return { ok: false, errors: { query: "query too large" } };
  try {
    return validateProcurementQuery(JSON.parse(decodeURIComponent(value)));
  } catch {
    return { ok: false, errors: { query: "invalid query encoding" } };
  }
}
export const PROCUREMENT_CAPABILITY = {
  version: PROCUREMENT_QUERY_VERSION,
  catalogVersion: CATALOG_VERSION,
  corpora: PROCUREMENT_CORPORA,
  fields: PROCUREMENT_FIELDS,
};
